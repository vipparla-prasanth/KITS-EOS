-- ==============================================================================
-- Migration 063: COD Payment Management Role, RLS Policies, and Secure RPCs
-- ==============================================================================

-- 1. Extend user_role enum with PAYMENT_MANAGER
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'PAYMENT_MANAGER';

-- 2. Grant RLS SELECT on payments and registrations for PAYMENT_MANAGER
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'payments' AND policyname = 'Payment managers can read all payments'
    ) THEN
        CREATE POLICY "Payment managers can read all payments"
        ON public.payments FOR SELECT
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid() AND role = 'PAYMENT_MANAGER' AND status = 'ACTIVE'
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'registrations' AND policyname = 'Payment managers can read all registrations'
    ) THEN
        CREATE POLICY "Payment managers can read all registrations"
        ON public.registrations FOR SELECT
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid() AND role = 'PAYMENT_MANAGER' AND status = 'ACTIVE'
            )
        );
    END IF;
END $$;

-- 3. Function to retrieve pending COD payments with strict role-based access
CREATE OR REPLACE FUNCTION public.get_pending_cod_payments(
    p_search_query text DEFAULT NULL,
    p_sub_event_id uuid DEFAULT NULL,
    p_coordinator_id uuid DEFAULT NULL
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
BEGIN
    v_actor_id := auth.uid();

    -- Check if authenticated user is ADMIN or PAYMENT_MANAGER
    IF v_actor_id IS NOT NULL THEN
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

    -- Fallback to passed coordinator id if not an auth user
    IF NOT v_can_view_all AND v_coord_id IS NULL AND p_coordinator_id IS NOT NULL THEN
        SELECT id INTO v_coord_id
        FROM public.coordinators
        WHERE id = p_coordinator_id AND status = 'ACTIVE';
    END IF;

    IF NOT v_can_view_all AND v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required to view pending COD payments.';
    END IF;

    -- If coordinator, get their assigned sub-events
    IF NOT v_can_view_all THEN
        SELECT array_agg(sub_event_id) INTO v_assigned_sub_events
        FROM public.coordinator_assignments
        WHERE coordinator_id = v_coord_id;

        IF v_assigned_sub_events IS NULL OR array_length(v_assigned_sub_events, 1) = 0 THEN
            RETURN jsonb_build_object(
                'success', true,
                'payments', '[]'::jsonb,
                'metrics', jsonb_build_object('total_pending', 0, 'total_amount', 0)
            );
        END IF;
    END IF;

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
            'total_pending', count(fp.*),
            'total_amount', COALESCE(sum(fp.amount), 0)
        )
    ) INTO v_result
    FROM filtered_payments fp;

    RETURN v_result;
END;
$$;

-- 4. Function to atomically confirm COD payment with server-side authorization and audit trail
CREATE OR REPLACE FUNCTION public.confirm_cod_payment(
    p_payment_id uuid,
    p_coordinator_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_payment record;
    v_reg record;
    v_actor_id uuid;
    v_actor_email text;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_coord_id uuid := NULL;
    v_is_assigned boolean := false;
    v_actor_role text := 'UNKNOWN';
BEGIN
    v_actor_id := auth.uid();

    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record not found';
    END IF;

    SELECT * INTO v_reg FROM public.registrations WHERE id = v_payment.registration_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated registration record not found';
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

    -- 1. Identify actor role from Supabase Auth (Admin or Payment Manager)
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

        -- Check if actor is a coordinator in coordinators table
        IF v_actor_role = 'UNKNOWN' THEN
            SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

            SELECT id INTO v_coord_id
            FROM public.coordinators
            WHERE (user_id = v_actor_id OR id = v_actor_id OR lower(username) = lower(v_actor_email))
              AND status = 'ACTIVE'
            LIMIT 1;

            IF v_coord_id IS NOT NULL THEN
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

    -- 2. Fallback to coordinator token / passed coordinator id if session token used
    IF v_actor_role = 'UNKNOWN' AND p_coordinator_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.coordinators
            WHERE id = p_coordinator_id AND status = 'ACTIVE'
        ) INTO v_is_assigned;

        IF v_is_assigned THEN
            SELECT EXISTS (
                SELECT 1 FROM public.coordinator_assignments
                WHERE coordinator_id = p_coordinator_id AND sub_event_id = v_reg.sub_event_id
            ) INTO v_is_assigned;

            IF v_is_assigned THEN
                v_coord_id := p_coordinator_id;
                v_actor_role := 'COORDINATOR';
            END IF;
        END IF;
    END IF;

    -- 3. Enforce strict server-side authorization
    IF v_actor_role = 'UNKNOWN' THEN
        RAISE EXCEPTION 'Unauthorized: Only event administrators, payment managers, or assigned coordinators can verify COD payments.';
    END IF;

    IF v_actor_role = 'COORDINATOR' AND NOT v_is_assigned THEN
        RAISE EXCEPTION 'Forbidden: You are not assigned to manage payments for this sub-event.';
    END IF;

    -- 4. Atomic updates
    UPDATE public.payments
    SET status = 'SUCCESS'
    WHERE id = p_payment_id;

    UPDATE public.registrations
    SET status = 'CONFIRMED'
    WHERE id = v_payment.registration_id;

    -- 5. Audit log
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
$$;

-- 5. Permissions
GRANT EXECUTE ON FUNCTION public.get_pending_cod_payments(text, uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.confirm_cod_payment(uuid, uuid) TO authenticated, anon;
