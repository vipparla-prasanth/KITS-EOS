-- Migration 115: Fix Privilege Escalation, Stall Banner Storage Ownership, and Neutralize Benchmark Functions
--
-- 1. Eliminates insecure email-to-coordinator-username matching in confirm_bulk_payments & get_pending_cod_payments (Fixes F-05).
-- 2. Enforces strict owner/admin verification on stall-banners storage UPDATE policy (Fixes F-07).
-- 3. Safely decommissions and revokes execute on benchmark & test functions (Fixes F-11).

-- =========================================================================
-- 1. REMOVE PRIVILEGE ESCALATION FROM public.confirm_bulk_payments
-- =========================================================================
CREATE OR REPLACE FUNCTION public.confirm_bulk_payments(
    p_payment_ids uuid[],
    p_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
    v_actor_id uuid;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_coord_id uuid := NULL;
    v_coord_type text := NULL;
    v_actor_role text := 'UNKNOWN';
    v_clean_token text := NULL;
    v_unassigned_count integer := 0;
    v_invalid_count integer := 0;
    v_approved_count integer := 0;
    v_total_amount numeric := 0;
    v_pid uuid;
    v_payment record;
    v_pending_ids uuid[] := '{}';
    v_event_key text;
    v_notif_title text;
    v_notif_msg text;
BEGIN
    -- 0. Validate input
    IF p_payment_ids IS NULL OR array_length(p_payment_ids, 1) = 0 THEN
        RAISE EXCEPTION 'Validation error: At least one payment ID is required' USING ERRCODE = '22023';
    END IF;

    -- 1. Identify actor from Supabase Auth session (Admin or Payment Manager)
    v_actor_id := auth.uid();

    IF v_actor_id IS NOT NULL THEN
        SELECT role, status INTO v_user_role, v_user_status
        FROM public.users 
        WHERE id = v_actor_id;

        IF v_user_status = 'ACTIVE' THEN
            IF v_user_role = 'ADMIN' THEN
                v_actor_role := 'ADMIN';
            ELSIF v_user_role = 'PAYMENT_MANAGER' THEN
                v_actor_role := 'PAYMENT_MANAGER';
            END IF;
        END IF;

        -- Strictly verify coordinator linkage via foreign key or PK.
        -- NEVER match lower(username) = lower(v_actor_email) to prevent student email spoofing.
        IF v_actor_role = 'UNKNOWN' THEN
            SELECT id, coordinator_type INTO v_coord_id, v_coord_type
            FROM public.coordinators
            WHERE (user_id = v_actor_id OR id = v_actor_id)
              AND status = 'ACTIVE'
            LIMIT 1;

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_actor_role := 'PAYMENT_MANAGER';
            ELSIF v_coord_id IS NOT NULL THEN
                v_actor_role := 'COORDINATOR';
            END IF;
        END IF;
    END IF;

    -- 2. Cryptographic Session Token Verification (for coordinator / payment-manager portal)
    IF v_actor_role = 'UNKNOWN' AND p_token IS NOT NULL AND trim(p_token) <> '' THEN
        v_clean_token := regexp_replace(trim(p_token), '^Bearer\s+', '', 'i');
        v_coord_id := public.get_coordinator_id_by_token(v_clean_token);

        IF v_coord_id IS NOT NULL THEN
            SELECT coordinator_type INTO v_coord_type
            FROM public.coordinators
            WHERE id = v_coord_id AND status = 'ACTIVE';

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_actor_role := 'PAYMENT_MANAGER';
            ELSE
                v_actor_role := 'COORDINATOR';
            END IF;
        END IF;
    END IF;

    -- 3. Strict authentication gate: Reject unauthenticated callers immediately
    IF v_actor_role = 'UNKNOWN' AND v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Valid administrative or coordinator session required.'
            USING ERRCODE = '42501';
    END IF;

    -- 4. Check if all target payment records exist
    SELECT count(*) INTO v_invalid_count
    FROM unnest(p_payment_ids) AS pid
    WHERE NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = pid);

    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION 'Validation error: One or more payment records do not exist' USING ERRCODE = 'P0002';
    END IF;

    -- 5. If regular coordinator (not Admin or Payment Manager), verify assignment for ALL target sub-events
    IF v_actor_role = 'COORDINATOR' AND v_coord_id IS NOT NULL THEN
        SELECT count(*) INTO v_unassigned_count
        FROM public.payments p
        JOIN public.registrations r ON r.id = p.registration_id
        WHERE p.id = ANY(p_payment_ids)
          AND NOT EXISTS (
              SELECT 1 FROM public.coordinator_assignments ca
              WHERE ca.coordinator_id = v_coord_id AND ca.sub_event_id = r.sub_event_id
          );

        IF v_unassigned_count > 0 THEN
            RAISE EXCEPTION 'Forbidden: You are not assigned to manage payments for one or more selected registrations.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 6. Enforce final authorization check
    IF v_actor_role NOT IN ('ADMIN', 'PAYMENT_MANAGER', 'COORDINATOR') THEN
        RAISE EXCEPTION 'Unauthorized: Only event administrators, payment managers, or assigned coordinators can verify payments.'
            USING ERRCODE = '42501';
    END IF;

    -- Filter to payments that actually need update (status <> 'SUCCESS')
    SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_pending_ids
    FROM public.payments
    WHERE id = ANY(p_payment_ids) AND status <> 'SUCCESS';

    IF v_pending_ids IS NULL OR array_length(v_pending_ids, 1) IS NULL OR array_length(v_pending_ids, 1) = 0 THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_total_amount
        FROM public.payments
        WHERE id = ANY(p_payment_ids);

        RETURN jsonb_build_object(
            'success', true,
            'message', 'Selected payments are already marked as verified',
            'approved_count', array_length(p_payment_ids, 1),
            'total_amount', v_total_amount,
            'payment_ids', p_payment_ids,
            'status', 'SUCCESS'
        );
    END IF;

    -- 7. Calculate total amount for all pending payments being approved and update transactionally
    SELECT COALESCE(SUM(amount), 0) INTO v_total_amount
    FROM public.payments
    WHERE id = ANY(v_pending_ids);

    -- 8. Lock target payments in deterministic order (pids ASC) to prevent deadlocks
    PERFORM id
    FROM public.payments
    WHERE id = ANY(v_pending_ids)
    ORDER BY id ASC
    FOR UPDATE;

    -- 9. Process each pending payment atomically
    FOREACH v_pid IN ARRAY v_pending_ids LOOP
        SELECT p.id, p.registration_id, p.amount, p.status AS old_status,
               r.id AS reg_id, r.leader_id, r.status AS reg_status, r.sub_event_id,
               se.name AS sub_event_name, se.event_id, se.participation_type, e.name AS event_name,
               t.team_name
        INTO v_payment
        FROM public.payments p
        JOIN public.registrations r ON r.id = p.registration_id
        JOIN public.sub_events se ON se.id = r.sub_event_id
        LEFT JOIN public.events e ON e.id = se.event_id
        LEFT JOIN public.teams t ON t.registration_id = r.id
        WHERE p.id = v_pid;

        IF FOUND AND v_payment.old_status <> 'SUCCESS' THEN
            UPDATE public.payments
            SET status = 'SUCCESS'
            WHERE id = v_pid;

            UPDATE public.registrations
            SET status = 'CONFIRMED'
            WHERE id = v_payment.reg_id;

            v_event_key := 'PAYMENT_CONFIRMED:' || v_pid::text;
            v_notif_title := 'Payment Confirmed';
            
            IF (v_payment.participation_type = 'TEAM' OR v_payment.team_name IS NOT NULL) AND v_payment.team_name IS NOT NULL AND trim(v_payment.team_name) <> '' THEN
                v_notif_msg := 'Payment for team "' || v_payment.team_name || '" has been verified successfully. Your team registration for ' || v_payment.sub_event_name || ' is now confirmed. Event credentials are available.';
            ELSE
                v_notif_msg := 'Your payment of ₹' || v_payment.amount || ' for ' || v_payment.sub_event_name || ' has been verified successfully. Your registration is now confirmed and your event credentials are available.';
            END IF;

            IF v_payment.leader_id IS NOT NULL THEN
                INSERT INTO public.notifications (
                    user_id,
                    coordinator_id,
                    recipient_role,
                    notification_type,
                    category,
                    entity_type,
                    entity_id,
                    title,
                    message,
                    event_key,
                    metadata,
                    is_read,
                    created_at
                ) VALUES (
                    v_payment.leader_id,
                    NULL,
                    'STUDENT',
                    'PAYMENT_CONFIRMED',
                    'REGISTRATION',
                    'PAYMENT',
                    v_pid,
                    v_notif_title,
                    v_notif_msg,
                    v_event_key,
                    jsonb_build_object(
                        'payment_id', v_pid,
                        'registration_id', v_payment.reg_id,
                        'sub_event_id', v_payment.sub_event_id,
                        'amount', v_payment.amount
                    ),
                    FALSE,
                    NOW()
                )
                ON CONFLICT (event_key) DO NOTHING;
            END IF;

            INSERT INTO public.audit_logs (
                actor_id,
                action,
                entity_type,
                entity_id,
                metadata,
                created_at
            ) VALUES (
                COALESCE(v_actor_id, v_coord_id),
                'PAYMENT_VERIFIED',
                'payments',
                v_pid,
                jsonb_build_object(
                    'payment_id', v_pid,
                    'registration_id', v_payment.reg_id,
                    'sub_event_id', v_payment.sub_event_id,
                    'amount', v_payment.amount,
                    'verified_by_role', v_actor_role,
                    'verified_by_id', COALESCE(v_actor_id, v_coord_id)
                ),
                now()
            );

            v_approved_count := v_approved_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'message', format('Successfully verified %s payment(s)', v_approved_count),
        'approved_count', v_approved_count,
        'total_amount', v_total_amount,
        'payment_ids', v_pending_ids,
        'status', 'SUCCESS'
    );
END;
$function$;

-- =========================================================================
-- 2. REMOVE PRIVILEGE ESCALATION FROM public.get_pending_cod_payments
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_pending_cod_payments(
    p_token text DEFAULT NULL::text,
    p_event_id uuid DEFAULT NULL::uuid,
    p_sub_event_id uuid DEFAULT NULL::uuid,
    p_search_query text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
    v_actor_id uuid;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_coord_id uuid := NULL;
    v_coord_type text := NULL;
    v_can_view_all boolean := false;
    v_assigned_sub_events uuid[];
    v_result jsonb;
    v_stats record;
    v_is_service_role boolean := false;
    v_clean_token text := NULL;
BEGIN
    v_actor_id := auth.uid();
    v_is_service_role := (COALESCE(auth.role(), '') = 'service_role');

    IF v_is_service_role THEN
        v_can_view_all := true;
    ELSIF v_actor_id IS NOT NULL THEN
        SELECT role, status INTO v_user_role, v_user_status
        FROM public.users
        WHERE id = v_actor_id;

        IF v_user_status = 'ACTIVE' AND (v_user_role = 'ADMIN' OR v_user_role = 'PAYMENT_MANAGER') THEN
            v_can_view_all := true;
        ELSE
            -- Strictly verify coordinator linkage via foreign key or PK.
            -- NEVER match lower(username) = lower(v_actor_email).
            SELECT id, coordinator_type INTO v_coord_id, v_coord_type
            FROM public.coordinators
            WHERE (user_id = v_actor_id OR id = v_actor_id)
              AND status = 'ACTIVE'
            LIMIT 1;

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_can_view_all := true;
            END IF;
        END IF;
    END IF;

    IF NOT v_can_view_all AND v_coord_id IS NULL AND p_token IS NOT NULL AND trim(p_token) <> '' THEN
        v_clean_token := regexp_replace(trim(p_token), '^Bearer\s+', '', 'i');
        v_coord_id := public.get_coordinator_id_by_token(v_clean_token);

        IF v_coord_id IS NOT NULL THEN
            SELECT coordinator_type INTO v_coord_type
            FROM public.coordinators
            WHERE id = v_coord_id AND status = 'ACTIVE';

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_can_view_all := true;
            END IF;
        END IF;
    END IF;

    IF NOT v_can_view_all AND v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Valid administrative or coordinator session required.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT v_can_view_all THEN
        SELECT array_agg(sub_event_id) INTO v_assigned_sub_events
        FROM public.coordinator_assignments
        WHERE coordinator_id = v_coord_id;

        IF v_assigned_sub_events IS NULL OR array_length(v_assigned_sub_events, 1) = 0 THEN
            RETURN jsonb_build_object(
                'success', true,
                'payments', '[]'::jsonb,
                'metrics', jsonb_build_object(
                    'total_pending', 0,
                    'total_collected', 0,
                    'total_pending_amount', 0
                )
            );
        END IF;
    END IF;

    SELECT 
        COALESCE(COUNT(DISTINCT CASE WHEN p.status = 'PENDING' THEN p.id END), 0) AS total_pending,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' THEN p.amount ELSE 0 END), 0) AS total_collected,
        COALESCE(SUM(CASE WHEN p.status = 'PENDING' THEN p.amount ELSE 0 END), 0) AS total_pending_amount
    INTO v_stats
    FROM public.payments p
    JOIN public.registrations r ON r.id = p.registration_id
    JOIN public.sub_events se ON se.id = r.sub_event_id
    LEFT JOIN public.categories cat ON cat.id = se.category_id
    LEFT JOIN public.events ev ON ev.id = COALESCE(se.event_id, cat.event_id)
    WHERE (p_event_id IS NULL OR ev.id = p_event_id)
      AND (p_sub_event_id IS NULL OR se.id = p_sub_event_id)
      AND (v_can_view_all OR se.id = ANY(v_assigned_sub_events));

    WITH filtered_payments AS (
        SELECT 
            p.id AS payment_id,
            p.registration_id,
            p.amount,
            p.payment_method,
            p.status AS payment_status,
            p.reference_id,
            p.created_at AS payment_created_at,
            r.id AS reg_id,
            r.status AS reg_status,
            r.created_at AS reg_created_at,
            se.id AS sub_event_id,
            se.name AS sub_event_name,
            se.venue,
            se.participation_type,
            COALESCE(ev.name, 'Flagship Event') AS event_name,
            COALESCE(cat.name, 'General') AS category_name,
            COALESCE(lead_sp.full_name, 'Participant') AS student_name,
            COALESCE(lead_sp.roll_number, 'N/A') AS student_roll_number,
            COALESCE(lead_sp.department, 'N/A') AS student_department,
            COALESCE(lead_sp.college, 'N/A') AS student_college,
            COALESCE(lead_sp.phone, 'N/A') AS student_phone,
            t.team_name,
            CASE WHEN t.id IS NOT NULL THEN true ELSE false END AS is_team
        FROM public.payments p
        JOIN public.registrations r ON r.id = p.registration_id
        JOIN public.sub_events se ON se.id = r.sub_event_id
        LEFT JOIN public.categories cat ON cat.id = se.category_id
        LEFT JOIN public.events ev ON ev.id = COALESCE(se.event_id, cat.event_id)
        LEFT JOIN public.student_profiles lead_sp ON lead_sp.user_id = r.leader_id
        LEFT JOIN public.teams t ON t.registration_id = r.id
        WHERE p.status = 'PENDING'
          AND (p.payment_method = 'COD' OR p.payment_method ILIKE '%COD%')
          AND (p_event_id IS NULL OR ev.id = p_event_id)
          AND (p_sub_event_id IS NULL OR se.id = p_sub_event_id)
          AND (v_can_view_all OR se.id = ANY(v_assigned_sub_events))
          AND (
              p_search_query IS NULL 
              OR trim(p_search_query) = ''
              OR lead_sp.full_name ILIKE '%' || trim(p_search_query) || '%'
              OR lead_sp.roll_number ILIKE '%' || trim(p_search_query) || '%'
              OR p.reference_id ILIKE '%' || trim(p_search_query) || '%'
              OR r.id::text ILIKE '%' || trim(p_search_query) || '%'
              OR t.team_name ILIKE '%' || trim(p_search_query) || '%'
              OR se.name ILIKE '%' || trim(p_search_query) || '%'
              OR ev.name ILIKE '%' || trim(p_search_query) || '%'
          )
        ORDER BY p.created_at DESC
    )
    SELECT jsonb_build_object(
        'success', true,
        'payments', COALESCE(jsonb_agg(row_to_json(fp)), '[]'::jsonb),
        'metrics', jsonb_build_object(
            'total_pending', v_stats.total_pending,
            'total_collected', v_stats.total_collected,
            'total_pending_amount', v_stats.total_pending_amount
        )
    ) INTO v_result
    FROM filtered_payments fp;

    RETURN v_result;
END;
$function$;

-- Overload supporting 5 parameters (called by admin-coordinator PaymentManagement portal)
CREATE OR REPLACE FUNCTION public.get_pending_cod_payments(
    p_search_query text DEFAULT NULL::text,
    p_sub_event_id uuid DEFAULT NULL::uuid,
    p_coordinator_id uuid DEFAULT NULL::uuid,
    p_event_id uuid DEFAULT NULL::uuid,
    p_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
    v_actor_id uuid;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_coord_id uuid := NULL;
    v_coord_type text := NULL;
    v_can_view_all boolean := false;
    v_assigned_sub_events uuid[];
    v_result jsonb;
    v_stats record;
    v_is_service_role boolean := false;
    v_clean_token text := NULL;
BEGIN
    v_actor_id := auth.uid();
    v_is_service_role := (COALESCE(auth.role(), '') = 'service_role');

    IF v_is_service_role THEN
        v_can_view_all := true;
    ELSIF v_actor_id IS NOT NULL THEN
        SELECT role, status INTO v_user_role, v_user_status
        FROM public.users
        WHERE id = v_actor_id;

        IF v_user_status = 'ACTIVE' AND (v_user_role = 'ADMIN' OR v_user_role = 'PAYMENT_MANAGER') THEN
            v_can_view_all := true;
        ELSE
            -- Strictly verify coordinator linkage via foreign key or PK.
            -- NEVER match lower(username) = lower(v_actor_email) to prevent student email spoofing.
            SELECT id, coordinator_type INTO v_coord_id, v_coord_type
            FROM public.coordinators
            WHERE (user_id = v_actor_id OR id = v_actor_id)
              AND status = 'ACTIVE'
            LIMIT 1;

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_can_view_all := true;
            END IF;
        END IF;
    END IF;

    IF NOT v_can_view_all AND v_coord_id IS NULL AND p_token IS NOT NULL AND trim(p_token) <> '' THEN
        v_clean_token := regexp_replace(trim(p_token), '^Bearer\s+', '', 'i');
        v_coord_id := public.get_coordinator_id_by_token(v_clean_token);

        IF v_coord_id IS NOT NULL THEN
            SELECT coordinator_type INTO v_coord_type
            FROM public.coordinators
            WHERE id = v_coord_id AND status = 'ACTIVE';

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_can_view_all := true;
            END IF;
        END IF;
    END IF;

    IF NOT v_can_view_all AND v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Valid administrative or coordinator session required.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT v_can_view_all THEN
        SELECT array_agg(sub_event_id) INTO v_assigned_sub_events
        FROM public.coordinator_assignments
        WHERE coordinator_id = v_coord_id;

        IF v_assigned_sub_events IS NULL OR array_length(v_assigned_sub_events, 1) = 0 THEN
            RETURN jsonb_build_object(
                'success', true,
                'payments', '[]'::jsonb,
                'metrics', jsonb_build_object(
                    'total_pending', 0,
                    'total_collected', 0,
                    'total_pending_amount', 0
                )
            );
        END IF;
    END IF;

    SELECT 
        COALESCE(COUNT(DISTINCT CASE WHEN p.status = 'PENDING' THEN p.id END), 0) AS total_pending,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' THEN p.amount ELSE 0 END), 0) AS total_collected,
        COALESCE(SUM(CASE WHEN p.status = 'PENDING' THEN p.amount ELSE 0 END), 0) AS total_pending_amount
    INTO v_stats
    FROM public.payments p
    JOIN public.registrations r ON r.id = p.registration_id
    JOIN public.sub_events se ON se.id = r.sub_event_id
    LEFT JOIN public.categories cat ON cat.id = se.category_id
    LEFT JOIN public.events ev ON ev.id = COALESCE(se.event_id, cat.event_id)
    WHERE (p_event_id IS NULL OR ev.id = p_event_id)
      AND (p_sub_event_id IS NULL OR se.id = p_sub_event_id)
      AND (v_can_view_all OR se.id = ANY(v_assigned_sub_events));

    WITH filtered_payments AS (
        SELECT 
            p.id AS payment_id,
            p.registration_id,
            p.amount,
            p.payment_method,
            p.status AS payment_status,
            p.reference_id,
            p.created_at AS payment_created_at,
            r.id AS reg_id,
            r.status AS reg_status,
            r.created_at AS reg_created_at,
            se.id AS sub_event_id,
            se.name AS sub_event_name,
            se.venue,
            se.participation_type,
            COALESCE(ev.name, 'Flagship Event') AS event_name,
            COALESCE(cat.name, 'General') AS category_name,
            COALESCE(lead_sp.full_name, 'Participant') AS student_name,
            COALESCE(lead_sp.roll_number, 'N/A') AS student_roll_number,
            COALESCE(lead_sp.department, 'N/A') AS student_department,
            COALESCE(lead_sp.college, 'N/A') AS student_college,
            COALESCE(lead_sp.phone, 'N/A') AS student_phone,
            t.team_name,
            CASE WHEN t.id IS NOT NULL THEN true ELSE false END AS is_team
        FROM public.payments p
        JOIN public.registrations r ON r.id = p.registration_id
        JOIN public.sub_events se ON se.id = r.sub_event_id
        LEFT JOIN public.categories cat ON cat.id = se.category_id
        LEFT JOIN public.events ev ON ev.id = COALESCE(se.event_id, cat.event_id)
        LEFT JOIN public.student_profiles lead_sp ON lead_sp.user_id = r.leader_id
        LEFT JOIN public.teams t ON t.registration_id = r.id
        WHERE p.status = 'PENDING'
          AND (p.payment_method = 'COD' OR p.payment_method ILIKE '%COD%')
          AND (p_event_id IS NULL OR ev.id = p_event_id)
          AND (p_sub_event_id IS NULL OR se.id = p_sub_event_id)
          AND (v_can_view_all OR se.id = ANY(v_assigned_sub_events))
          AND (
              p_search_query IS NULL 
              OR trim(p_search_query) = ''
              OR lead_sp.full_name ILIKE '%' || trim(p_search_query) || '%'
              OR lead_sp.roll_number ILIKE '%' || trim(p_search_query) || '%'
              OR p.reference_id ILIKE '%' || trim(p_search_query) || '%'
              OR r.id::text ILIKE '%' || trim(p_search_query) || '%'
              OR t.team_name ILIKE '%' || trim(p_search_query) || '%'
              OR se.name ILIKE '%' || trim(p_search_query) || '%'
              OR ev.name ILIKE '%' || trim(p_search_query) || '%'
          )
        ORDER BY p.created_at DESC
    )
    SELECT jsonb_build_object(
        'success', true,
        'payments', COALESCE(jsonb_agg(row_to_json(fp)), '[]'::jsonb),
        'metrics', jsonb_build_object(
            'total_pending', v_stats.total_pending,
            'total_collected', v_stats.total_collected,
            'total_pending_amount', v_stats.total_pending_amount
        )
    ) INTO v_result
    FROM filtered_payments fp;

    RETURN v_result;
END;
$function$;

-- =========================================================================
-- 3. FIX F-07 STALL-BANNER STORAGE OWNERSHIP POLICY
-- =========================================================================
ALTER POLICY "Admin and owners can update stall banners" ON storage.objects
USING (
    bucket_id = 'stall-banners'
    AND (
        auth.uid() = owner
        OR public.is_admin()
    )
)
WITH CHECK (
    bucket_id = 'stall-banners'
    AND (
        auth.uid() = owner
        OR public.is_admin()
    )
);

-- =========================================================================
-- 4. FIX F-11 DECOMMISSION AND REVOKE BENCHMARK & TEST FUNCTIONS
-- =========================================================================
CREATE OR REPLACE FUNCTION public.student_register_atomic_bench_tail(
    p_sub_event_id uuid, 
    p_mode character varying, 
    p_team_name character varying DEFAULT NULL::character varying, 
    p_team_members jsonb DEFAULT '[]'::jsonb, 
    p_uploaded_documents jsonb DEFAULT '[]'::jsonb, 
    p_payment_method character varying DEFAULT 'UPI'::character varying, 
    p_payment_reference character varying DEFAULT NULL::character varying
) 
RETURNS jsonb 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$ 
BEGIN 
    RAISE EXCEPTION 'Decommissioned: benchmark function is permanently disabled'; 
END; 
$$;
REVOKE ALL ON FUNCTION public.student_register_atomic_bench_tail(uuid, character varying, character varying, jsonb, jsonb, character varying, character varying) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.test_fn() 
RETURNS integer 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$ 
BEGIN 
    RAISE EXCEPTION 'Decommissioned: test function is permanently disabled'; 
END; 
$$;
REVOKE ALL ON FUNCTION public.test_fn() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_admin_test() 
RETURNS boolean 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$ 
BEGIN 
    RAISE EXCEPTION 'Decommissioned: test function is permanently disabled'; 
END; 
$$;
REVOKE ALL ON FUNCTION public.is_admin_test() FROM PUBLIC, anon, authenticated;
