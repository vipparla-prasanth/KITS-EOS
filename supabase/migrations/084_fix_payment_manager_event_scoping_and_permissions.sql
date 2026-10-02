-- ==============================================================================
-- Migration 084: Fix Payment Manager Event Scoping & RPC Session Permissions
-- ==============================================================================
-- Enhancements:
-- 1. Updates get_pending_cod_payments to recognize coordinator session tokens
--    where coordinator_type = 'PAYMENT_MANAGER' (v_can_view_all := true).
-- 2. Permits execution by anon, authenticated, and service_role while strictly
--    authenticating the caller inside the function body (matching confirm_cod_payment).
-- 3. Ensures event-scoped metrics calculation and payment queries work seamlessly
--    for Payment Managers authenticated via coordinator session.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_pending_cod_payments(
    p_search_query text DEFAULT NULL,
    p_sub_event_id uuid DEFAULT NULL,
    p_coordinator_id uuid DEFAULT NULL,
    p_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
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

    -- 2. Fallback to passed coordinator id if coordinator session token is used
    IF NOT v_can_view_all AND v_coord_id IS NULL AND p_coordinator_id IS NOT NULL THEN
        SELECT id, coordinator_type INTO v_coord_id, v_coord_type
        FROM public.coordinators
        WHERE id = p_coordinator_id AND status = 'ACTIVE';

        IF v_coord_type = 'PAYMENT_MANAGER' THEN
            v_can_view_all := true;
        END IF;
    END IF;

    -- 3. Reject unauthenticated/unauthorized callers
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
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_cod_payments(text, uuid, uuid, uuid) TO anon, authenticated, service_role;
