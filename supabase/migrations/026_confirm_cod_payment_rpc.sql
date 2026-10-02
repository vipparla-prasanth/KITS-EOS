-- 026_confirm_cod_payment_rpc.sql

CREATE OR REPLACE FUNCTION confirm_cod_payment(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_payment RECORD;
    v_reg RECORD;
    v_actor_id UUID;
    v_actor_email TEXT;
BEGIN
    v_actor_id := auth.uid();
    
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Fetch caller email
    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

    -- Check if payment exists
    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record not found';
    END IF;

    -- Fetch registration
    SELECT * INTO v_reg FROM public.registrations WHERE id = v_payment.registration_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated registration record not found';
    END IF;

    -- Authorization check: caller must be ADMIN
    IF NOT (is_admin()) THEN
        RAISE EXCEPTION 'Administrative privileges required to confirm payment';
    END IF;

    -- Update payment status to SUCCESS
    UPDATE public.payments
    SET status = 'SUCCESS'
    WHERE id = p_payment_id;

    -- Ensure registration status is CONFIRMED
    UPDATE public.registrations
    SET status = 'CONFIRMED'
    WHERE id = v_payment.registration_id;

    -- Insert Audit Log (entity_id is UUID)
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_actor_id,
        'CONFIRM_COD_PAYMENT',
        'PAYMENT',
        p_payment_id,
        jsonb_build_object(
            'payment_id', p_payment_id,
            'registration_id', v_payment.registration_id,
            'reference_id', v_payment.reference_id,
            'amount', v_payment.amount,
            'confirmed_by', COALESCE(v_actor_email, v_actor_id::text)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Payment confirmed successfully',
        'payment_id', p_payment_id,
        'amount', v_payment.amount
    );
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_cod_payment(UUID) TO authenticated;
