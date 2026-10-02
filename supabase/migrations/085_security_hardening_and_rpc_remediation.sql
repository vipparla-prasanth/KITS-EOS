-- ============================================================================
-- Migration 085: Security Hardening, Cryptographic RPC Remediation & Legacy Cleanup
-- ============================================================================
-- Objective:
-- 1. Drop insecure legacy RPC overloads that accepted raw unverified coordinator IDs
--    or lacked authorization checks (Finding 1 & Finding 2).
-- 2. Harden `confirm_cod_payment` to cryptographically verify coordinator session tokens
--    via `public.get_coordinator_id_by_token(p_token)` or Supabase Auth Admin/Payment Manager.
--    Reject unverified `p_coordinator_id` parameters entirely.
-- 3. Harden `get_pending_cod_payments` to cryptographically verify coordinator session tokens
--    via `public.get_coordinator_id_by_token(p_token)` or Supabase Auth Admin/Payment Manager.
--    Reject unverified `p_coordinator_id` parameters entirely.
-- 4. Defense-in-depth: Remove deceptive unused policy on `public.coordinators` and ensure
--    zero public/anon exposure of coordinator password hashes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Step 1: Drop Insecure Legacy Overloads
-- ----------------------------------------------------------------------------

-- 1.1 Drop legacy 1-arg get_coordinator_sub_event_roster (had ZERO authorization checks)
DROP FUNCTION IF EXISTS public.get_coordinator_sub_event_roster(uuid);

-- 1.2 Drop legacy 2-arg get_sub_event_documents_for_coordinator (accepted raw coordinator_id without token)
DROP FUNCTION IF EXISTS public.get_sub_event_documents_for_coordinator(uuid, uuid);

-- 1.3 Drop legacy mark_all_coordinator_notifications_read (accepted raw coordinator_id without token)
DROP FUNCTION IF EXISTS public.mark_all_coordinator_notifications_read(uuid);

-- 1.4 Drop legacy mark_coordinator_notification_read (accepted raw coordinator_id without token)
DROP FUNCTION IF EXISTS public.mark_coordinator_notification_read(uuid, uuid);

-- 1.5 Drop legacy 3-arg get_pending_cod_payments
DROP FUNCTION IF EXISTS public.get_pending_cod_payments(text, uuid, uuid);


-- ----------------------------------------------------------------------------
-- Step 2: Cryptographically Harden `confirm_cod_payment`
-- ----------------------------------------------------------------------------

-- Drop old 2-argument signature to replace with hardened version
DROP FUNCTION IF EXISTS public.confirm_cod_payment(uuid, uuid);
DROP FUNCTION IF EXISTS public.confirm_cod_payment(uuid);

CREATE OR REPLACE FUNCTION public.confirm_cod_payment(
    p_payment_id uuid,
    p_coordinator_id uuid DEFAULT NULL::uuid,
    p_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
    v_payment record;
    v_reg record;
    v_actor_id uuid;
    v_actor_email text;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_coord_id uuid := NULL;
    v_coord_type text := NULL;
    v_is_assigned boolean := false;
    v_actor_role text := 'UNKNOWN';
    v_clean_token text := NULL;
BEGIN
    -- 1. Validate payment and associated registration
    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_reg FROM public.registrations WHERE id = v_payment.registration_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated registration record not found' USING ERRCODE = 'P0002';
    END IF;

    -- Idempotent return if already SUCCESS
    IF v_payment.status = 'SUCCESS' THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Payment is already marked as verified',
            'payment_id', p_payment_id,
            'amount', v_payment.amount,
            'status', 'SUCCESS'
        );
    END IF;

    v_actor_id := auth.uid();

    -- 2. Identify actor from Supabase Auth session (Admin or Payment Manager)
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

        -- Check if actor is in coordinators table linked to auth.users
        IF v_actor_role = 'UNKNOWN' THEN
            SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

            SELECT id, coordinator_type INTO v_coord_id, v_coord_type
            FROM public.coordinators
            WHERE (user_id = v_actor_id OR id = v_actor_id OR lower(username) = lower(v_actor_email))
              AND status = 'ACTIVE'
            LIMIT 1;

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_actor_role := 'PAYMENT_MANAGER';
            ELSIF v_coord_id IS NOT NULL THEN
                SELECT EXISTS (
                    SELECT 1 FROM public.coordinator_assignments
                    WHERE coordinator_id = v_coord_id AND sub_event_id = v_reg.sub_event_id
                ) INTO v_is_assigned;

                IF v_is_assigned THEN
                    v_actor_role := 'COORDINATOR';
                END IF;
            END IF;
        END IF;
    END IF;

    -- 3. Cryptographic Session Token Verification (for coordinator / payment-manager portal)
    IF v_actor_role = 'UNKNOWN' AND p_token IS NOT NULL AND trim(p_token) <> '' THEN
        v_clean_token := regexp_replace(trim(p_token), '^Bearer\s+', '', 'i');
        v_coord_id := public.get_coordinator_id_by_token(v_clean_token);

        IF v_coord_id IS NOT NULL THEN
            SELECT coordinator_type INTO v_coord_type
            FROM public.coordinators
            WHERE id = v_coord_id AND status = 'ACTIVE';

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_actor_role := 'PAYMENT_MANAGER';
            ELSIF v_coord_type IS NOT NULL THEN
                SELECT EXISTS (
                    SELECT 1 FROM public.coordinator_assignments
                    WHERE coordinator_id = v_coord_id AND sub_event_id = v_reg.sub_event_id
                ) INTO v_is_assigned;

                IF v_is_assigned THEN
                    v_actor_role := 'COORDINATOR';
                END IF;
            END IF;
        END IF;
    END IF;

    -- 4. Enforce strict server-side authorization
    -- NOTE: Raw `p_coordinator_id` is NEVER trusted without valid session token or Supabase Auth
    IF v_actor_role = 'UNKNOWN' THEN
        RAISE EXCEPTION 'Unauthorized: Only event administrators, payment managers, or assigned coordinators with an active session can verify COD payments.'
            USING ERRCODE = '42501';
    END IF;

    IF v_actor_role = 'COORDINATOR' AND NOT v_is_assigned THEN
        RAISE EXCEPTION 'Forbidden: You are not assigned to manage payments for this sub-event.'
            USING ERRCODE = '42501';
    END IF;

    -- 5. Atomic state update inside transaction
    UPDATE public.payments
    SET status = 'SUCCESS'
    WHERE id = p_payment_id;

    UPDATE public.registrations
    SET status = 'CONFIRMED'
    WHERE id = v_payment.registration_id;

    -- 6. Immutable audit logging
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        COALESCE(v_actor_id, v_coord_id),
        'CONFIRM_COD_PAYMENT',
        'PAYMENT',
        p_payment_id,
        jsonb_build_object(
            'payment_id', p_payment_id,
            'registration_id', v_payment.registration_id,
            'reference_id', v_payment.reference_id,
            'amount', v_payment.amount,
            'actor_role', v_actor_role,
            'coordinator_id', v_coord_id,
            'actor_id', COALESCE(v_actor_id, v_coord_id),
            'confirmed_at', pg_catalog.now()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Payment confirmed and verified successfully',
        'payment_id', p_payment_id,
        'amount', v_payment.amount,
        'status', 'SUCCESS'
    );
END;
$function$;

-- 1-arg backward-compatible wrapper for Admin portal callers
CREATE OR REPLACE FUNCTION public.confirm_cod_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
    SELECT public.confirm_cod_payment(p_payment_id, NULL::uuid, NULL::text);
$function$;

REVOKE ALL ON FUNCTION public.confirm_cod_payment(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_cod_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_cod_payment(uuid, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_cod_payment(uuid) TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- Step 3: Cryptographically Harden `get_pending_cod_payments`
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_pending_cod_payments(text, uuid, uuid, uuid);

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
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    v_actor_id uuid;
    v_actor_email text;
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

    -- 1. Check service_role or authenticated user (ADMIN or PAYMENT_MANAGER) via Supabase Auth
    IF v_is_service_role THEN
        v_can_view_all := true;
    ELSIF v_actor_id IS NOT NULL THEN
        SELECT role, status INTO v_user_role, v_user_status
        FROM public.users
        WHERE id = v_actor_id;

        IF v_user_status = 'ACTIVE' AND (v_user_role = 'ADMIN' OR v_user_role = 'PAYMENT_MANAGER') THEN
            v_can_view_all := true;
        ELSE
            SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;
            SELECT id, coordinator_type INTO v_coord_id, v_coord_type
            FROM public.coordinators
            WHERE (user_id = v_actor_id OR id = v_actor_id OR lower(username) = lower(v_actor_email))
              AND status = 'ACTIVE'
            LIMIT 1;

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_can_view_all := true;
            END IF;
        END IF;
    END IF;

    -- 2. Cryptographic session token verification (for coordinator / payment-manager portal)
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

    -- 3. Reject unauthenticated/unauthorized callers
    -- Raw `p_coordinator_id` is intentionally ignored unless validated via p_token or auth.uid()
    IF NOT v_can_view_all AND v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Valid administrative or coordinator session required.'
            USING ERRCODE = '42501';
    END IF;

    -- 4. If regular coordinator (not PAYMENT_MANAGER / ADMIN), restrict strictly to assigned sub-events
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

    -- 5. Calculate authoritative event-level metrics dynamically from live payments
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

    -- 6. Collect filtered pending COD payments list
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

REVOKE ALL ON FUNCTION public.get_pending_cod_payments(text, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_cod_payments(text, uuid, uuid, uuid, text) TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- Step 4: Defense-in-Depth on Coordinators Table
-- ----------------------------------------------------------------------------

-- Remove deceptive unused public policy on coordinators table
DROP POLICY IF EXISTS "Public can view active coordinator contacts" ON public.coordinators;

-- Re-assert explicit revocation
REVOKE ALL ON public.coordinators FROM PUBLIC, anon;
