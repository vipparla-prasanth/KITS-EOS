-- ==============================================================================
-- Migration 064: Fix Payment Manager COD Confirmation Authorization
-- ==============================================================================
-- Root Cause:
-- The Payment Manager authenticates via the custom coordinator session architecture.
-- As a result, the frontend browser client operates under the PostgreSQL 'anon' role
-- rather than an authenticated Supabase GoTrue JWT. While get_pending_cod_payments
-- was granted EXECUTE to 'anon', confirm_cod_payment only granted EXECUTE to
-- 'authenticated' and 'service_role'. Consequently, when the Payment Manager confirmed
-- a COD payment, PostgreSQL rejected the call with error 42501 (insufficient_privilege):
-- "permission denied for function confirm_cod_payment".
--
-- Solution:
-- 1. Grant EXECUTE ON FUNCTION public.confirm_cod_payment(uuid, uuid) TO anon, authenticated, service_role.
-- 2. Ensure both 2-argument and 1-argument overloads are aligned, secure, and executable by anon,
--    while maintaining strict internal role validation (requiring an active PAYMENT_MANAGER
--    coordinator, assigned coordinator, or admin).
-- ==============================================================================

-- 1. Overload 1: confirm_cod_payment(p_payment_id uuid, p_coordinator_id uuid DEFAULT NULL)
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
    v_coord_type text := NULL;
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

        -- Check if actor is in coordinators table
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

    -- 2. Fallback to passed coordinator id if session token used (e.g. Payment Manager or Coordinator portal)
    IF v_actor_role = 'UNKNOWN' AND p_coordinator_id IS NOT NULL THEN
        SELECT coordinator_type INTO v_coord_type
        FROM public.coordinators
        WHERE id = p_coordinator_id AND status = 'ACTIVE';

        IF v_coord_type = 'PAYMENT_MANAGER' THEN
            v_coord_id := p_coordinator_id;
            v_actor_role := 'PAYMENT_MANAGER';
        ELSIF v_coord_type IS NOT NULL THEN
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

-- 2. Overload 2: confirm_cod_payment(p_payment_id uuid) [Wraps 2-arg function for backward compatibility]
CREATE OR REPLACE FUNCTION public.confirm_cod_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT public.confirm_cod_payment(p_payment_id, NULL::uuid);
$$;

-- 3. Authoritative Permissions
GRANT EXECUTE ON FUNCTION public.confirm_cod_payment(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_cod_payment(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_cod_payments(text, uuid, uuid) TO anon, authenticated, service_role;
