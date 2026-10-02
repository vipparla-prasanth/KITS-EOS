-- ==============================================================================
-- Migration 080: Payment Manager Main Event Filtering & Authoritative Metrics
-- ==============================================================================
-- Enhancements:
-- 1. Adds p_event_id parameter to get_pending_cod_payments() for event-scoped querying.
-- 2. Calculates authoritative live metrics directly from PostgreSQL:
--    - total_pending: count of PENDING payments under the selected Main Event
--    - total_collected: SUM(amount) WHERE status = 'SUCCESS' under the selected Main Event
--    - total_pending_amount: SUM(amount) WHERE status = 'PENDING' under the selected Main Event
-- 3. Enforces strict security:
--    - REVOKES ALL EXECUTE from anon and PUBLIC.
--    - GRANTS EXECUTE to authenticated and service_role ONLY.
--    - Unauthenticated callers are rejected with 42501 error.
--    - Admin/Payment Manager can view all permitted events.
--    - Coordinators are strictly restricted to their assigned sub-events.
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
    v_can_view_all boolean := false;
    v_assigned_sub_events uuid[];
    v_result jsonb;
    v_stats record;
    v_is_service_or_admin boolean := false;
BEGIN
    v_actor_id := auth.uid();
    v_is_service_or_admin := (COALESCE(auth.role(), '') = 'service_role' OR current_user IN ('postgres', 'supabase_admin'));

    -- 1. Strictly require authentication (no anon access allowed)
    IF v_actor_id IS NULL AND NOT v_is_service_or_admin THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required to view pending COD payments.'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Check if authenticated user is ADMIN or PAYMENT_MANAGER
    IF v_is_service_or_admin THEN
        v_can_view_all := true;
    ELSIF v_actor_id IS NOT NULL THEN
        SELECT role, status INTO v_user_role, v_user_status
        FROM public.users
        WHERE id = v_actor_id;

        IF v_user_status = 'ACTIVE' AND (v_user_role = 'ADMIN' OR v_user_role = 'PAYMENT_MANAGER') THEN
            v_can_view_all := true;
        ELSE
            SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;
            SELECT id INTO v_coord_id
            FROM public.coordinators
            WHERE (user_id = v_actor_id OR id = v_actor_id OR lower(username) = lower(v_actor_email))
              AND status = 'ACTIVE'
            LIMIT 1;
        END IF;
    END IF;

    -- 3. Fallback to passed coordinator id ONLY IF caller is an active coordinator
    IF NOT v_can_view_all AND v_coord_id IS NULL AND p_coordinator_id IS NOT NULL THEN
        SELECT id INTO v_coord_id
        FROM public.coordinators
        WHERE id = p_coordinator_id AND status = 'ACTIVE';
    END IF;

    IF NOT v_can_view_all AND v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Valid administrative or coordinator session required.'
            USING ERRCODE = '42501';
    END IF;

    -- 4. If coordinator, restrict strictly to assigned sub-events
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

-- Revoke legacy and current overloads from anon and PUBLIC
REVOKE ALL ON FUNCTION public.get_pending_cod_payments(text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_pending_cod_payments(text, uuid, uuid, uuid) FROM PUBLIC, anon;

-- Grant strictly to authenticated users and service_role
GRANT EXECUTE ON FUNCTION public.get_pending_cod_payments(text, uuid, uuid, uuid) TO authenticated, service_role;
