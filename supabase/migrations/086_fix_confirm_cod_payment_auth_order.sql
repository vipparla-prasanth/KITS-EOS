-- ============================================================================
-- Migration 086: Enforce Strict Authorization Prior to Idempotent Return in confirm_cod_payment
-- ============================================================================
-- Vulnerability Identified in Adversarial Red-Team Testing:
-- The idempotent check (`IF v_payment.status = 'SUCCESS'`) was evaluated prior to
-- verifying caller identity and role. An unauthenticated caller supplying an
-- existing successful payment ID could bypass authorization and inspect payment
-- status and amount.
--
-- Remediation:
-- Re-order `confirm_cod_payment` so that authentication and authorization checks
-- (Supabase Auth Admin/Payment-Manager OR cryptographic coordinator session token)
-- are strictly enforced FIRST before any payment status inspection or return.
-- ============================================================================

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

        IF v_actor_role = 'UNKNOWN' THEN
            SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

            SELECT id, coordinator_type INTO v_coord_id, v_coord_type
            FROM public.coordinators
            WHERE (user_id = v_actor_id OR id = v_actor_id OR lower(username) = lower(v_actor_email))
              AND status = 'ACTIVE'
            LIMIT 1;

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_actor_role := 'PAYMENT_MANAGER';
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
            END IF;
        END IF;
    END IF;

    -- 3. Strict authentication gate: Reject unauthenticated callers immediately
    IF v_actor_role = 'UNKNOWN' AND v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Valid administrative or coordinator session required.'
            USING ERRCODE = '42501';
    END IF;

    -- 4. Validate target payment and associated registration
    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_reg FROM public.registrations WHERE id = v_payment.registration_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated registration record not found' USING ERRCODE = 'P0002';
    END IF;

    -- 5. If regular coordinator (not Admin or Payment Manager), verify assignment to this sub-event
    IF v_actor_role = 'UNKNOWN' AND v_coord_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.coordinator_assignments
            WHERE coordinator_id = v_coord_id AND sub_event_id = v_reg.sub_event_id
        ) INTO v_is_assigned;

        IF v_is_assigned THEN
            v_actor_role := 'COORDINATOR';
        ELSE
            RAISE EXCEPTION 'Forbidden: You are not assigned to manage payments for this sub-event.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 6. Enforce final authorization check
    IF v_actor_role NOT IN ('ADMIN', 'PAYMENT_MANAGER', 'COORDINATOR') THEN
        RAISE EXCEPTION 'Unauthorized: Only event administrators, payment managers, or assigned coordinators can verify COD payments.'
            USING ERRCODE = '42501';
    END IF;

    -- 7. Idempotent return (ONLY reached if caller is strictly authorized)
    IF v_payment.status = 'SUCCESS' THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Payment is already marked as verified',
            'payment_id', p_payment_id,
            'amount', v_payment.amount,
            'status', 'SUCCESS'
        );
    END IF;

    -- 8. Atomic state update inside transaction
    UPDATE public.payments
    SET status = 'SUCCESS'
    WHERE id = p_payment_id;

    UPDATE public.registrations
    SET status = 'CONFIRMED'
    WHERE id = v_payment.registration_id;

    -- 9. Immutable audit logging
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
