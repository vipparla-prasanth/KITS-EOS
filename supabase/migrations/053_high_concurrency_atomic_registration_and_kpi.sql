-- Migration 053: High-Concurrency Atomic Registration, Capacity Management, and Backend Performance
-- KITS-EOS Production Backend Scalability Phase
--
-- 1. Sub-event capacity extensions (max_capacity, registered_count, non-negative constraint)
-- 2. Anomaly-checked backfill matching capacity-consuming statuses ('CONFIRMED', 'PENDING_PAYMENT')
-- 3. Atomic registration RPC (public.student_register_atomic) within a single PostgreSQL transaction
-- 4. Server-side authorized, idempotent cancellation RPC (public.cancel_registration_idempotent)
-- 5. AFTER DELETE trigger on registrations to maintain capacity counter consistency during event cascade deletion
-- 6. Authoritative Admin KPI aggregation RPC (public.admin_get_dashboard_metrics)
-- 7. Set-based CTE optimization for coordinator roster (public.get_coordinator_sub_event_roster)
-- 8. Explicit administrative capacity reconciliation tool (public.admin_reconcile_sub_event_capacity)

-- ============================================================================
-- 1. SCHEMA EXTENSIONS & INVARIANT CONSTRAINTS
-- ============================================================================

ALTER TABLE public.sub_events
    ADD COLUMN IF NOT EXISTS max_capacity INTEGER DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS registered_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.sub_events
    DROP CONSTRAINT IF EXISTS check_registered_count_non_negative,
    ADD CONSTRAINT check_registered_count_non_negative CHECK (registered_count >= 0);

-- Safe Anomaly-Checked Backfill matching authoritative lifecycle
DO $$
DECLARE
    r RECORD;
    v_actual INTEGER;
BEGIN
    FOR r IN SELECT id, name, max_capacity FROM public.sub_events LOOP
        SELECT COUNT(*) INTO v_actual
        FROM public.registrations
        WHERE sub_event_id = r.id
          AND status IN ('CONFIRMED'::public.registration_status, 'PENDING_PAYMENT'::public.registration_status);

        IF r.max_capacity IS NOT NULL AND v_actual > r.max_capacity THEN
            RAISE WARNING 'Anomaly detected during backfill: Sub-event % (%) has % active registrations exceeding max_capacity %',
                r.name, r.id, v_actual, r.max_capacity;
        END IF;

        UPDATE public.sub_events
        SET registered_count = v_actual
        WHERE id = r.id;
    END LOOP;
END $$;

-- ============================================================================
-- 2. HELPER TOKEN GENERATION FUNCTION (Deterministic in SQL)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_attendance_token(p_prefix TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_clean_prefix TEXT;
    v_rand_digits TEXT;
BEGIN
    v_clean_prefix := UPPER(regexp_replace(COALESCE(p_prefix, 'EVENT'), '[^A-Z0-9]+', '-', 'g'));
    v_clean_prefix := trim(both '-' from v_clean_prefix);
    IF length(v_clean_prefix) = 0 THEN
        v_clean_prefix := 'EVENT';
    END IF;

    v_rand_digits := lpad(floor(random() * 10000000000)::text, 10, '0');
    RETURN 'KITS-EOS-' || v_clean_prefix || '-' || v_rand_digits;
END;
$$;

-- ============================================================================
-- 3. SINGLE-TRANSACTION ATOMIC REGISTRATION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.student_register_atomic(
    p_sub_event_id UUID,
    p_mode VARCHAR,
    p_team_name VARCHAR,
    p_team_members JSONB,
    p_uploaded_documents JSONB,
    p_payment_method VARCHAR,
    p_payment_reference VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_leader_id UUID;
    v_user_status VARCHAR;
    v_sub_event RECORD;
    v_fee NUMERIC;
    v_is_cod BOOLEAN;
    v_initial_status public.registration_status;
    v_reg_id UUID;
    v_team_id UUID;
    v_team_title VARCHAR;
    v_sorted_rolls TEXT[];
    v_roll TEXT;
    v_lock_key BIGINT;
    v_duplicate_roll TEXT;
    v_token_prefix TEXT;
    v_m JSONB;
    v_idx INTEGER := 0;
    v_is_leader BOOLEAN;
    v_manual_token TEXT;
    v_qr_identity UUID;
    v_member_name TEXT;
    v_member_roll TEXT;
    v_created_members JSONB := '[]'::jsonb;
    v_doc JSONB;
    v_pay_status public.payment_status := 'SUCCESS';
    v_pay_ref TEXT := trim(COALESCE(p_payment_reference, ''));
    v_pay_method VARCHAR := trim(COALESCE(p_payment_method, 'UPI'));
    v_payment RECORD;
BEGIN
    -- 1. Strictly derive authenticated student identity from PostgreSQL session
    v_leader_id := auth.uid();
    IF v_leader_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: valid student JWT session expected';
    END IF;

    -- 2. Validate student user status in public.users
    SELECT status INTO v_user_status FROM public.users WHERE id = v_leader_id;
    IF v_user_status IS NULL OR v_user_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Account is inactive or suspended';
    END IF;

    -- 3. Validate Basic Request Payload
    IF p_sub_event_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'sub_event_id is required');
    END IF;

    IF p_mode NOT IN ('SOLO', 'TEAM') THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'mode must be SOLO or TEAM');
    END IF;

    IF p_team_members IS NULL OR jsonb_typeof(p_team_members) <> 'array' OR jsonb_array_length(p_team_members) = 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'At least one participant is required');
    END IF;

    -- 4. Non-blocking MVCC read of sub-event rules and status
    SELECT id, name, participation_type, max_team_size, fee_amount_solo, fee_amount_team,
           attendance_token_prefix, status, max_capacity, registered_count
    INTO v_sub_event
    FROM public.sub_events
    WHERE id = p_sub_event_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'message', 'Sub-event not found');
    END IF;

    IF v_sub_event.status <> 'ACTIVE'::public.event_status THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_CLOSED', 'message', 'This sub-event is currently closed for registration');
    END IF;

    -- Participation mode validations
    IF v_sub_event.participation_type = 'SOLO' AND p_mode <> 'SOLO' THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'This sub-event only permits SOLO registrations');
    END IF;
    IF v_sub_event.participation_type = 'TEAM' AND p_mode <> 'TEAM' THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'This sub-event requires TEAM registration');
    END IF;

    IF p_mode = 'TEAM' THEN
        IF jsonb_array_length(p_team_members) < 2 THEN
            RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'Team registration requires at least 2 members');
        END IF;
        IF jsonb_array_length(p_team_members) > COALESCE(v_sub_event.max_team_size, 4) THEN
            RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', format('Team size cannot exceed maximum limit of %s', COALESCE(v_sub_event.max_team_size, 4)));
        END IF;
        IF p_team_name IS NULL OR length(trim(p_team_name)) = 0 THEN
            RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'Team name is required for team participation');
        END IF;
    END IF;

    -- 5. Deterministic Deadlock-Safe Advisory Locking on Member Roll Numbers
    -- Normalize -> Deduplicate -> Sort (ASC) -> Lock sequentially
    SELECT ARRAY(
        SELECT DISTINCT UPPER(trim(m->>'snapshot_roll_number'))
        FROM jsonb_array_elements(p_team_members) AS m
        WHERE m->>'snapshot_roll_number' IS NOT NULL AND length(trim(m->>'snapshot_roll_number')) > 0
        ORDER BY 1 ASC
    ) INTO v_sorted_rolls;

    IF v_sorted_rolls IS NOT NULL AND array_length(v_sorted_rolls, 1) > 0 THEN
        FOREACH v_roll IN ARRAY v_sorted_rolls LOOP
            v_lock_key := ('x' || substr(md5('kits_eos_sub_roll:' || p_sub_event_id::text || ':' || v_roll), 1, 16))::bit(64)::bigint;
            PERFORM pg_advisory_xact_lock(v_lock_key);
        END LOOP;
    END IF;

    -- 6. Leader Duplicate Prevention (scoped to this sub-event)
    IF EXISTS (
        SELECT 1 FROM public.registrations
        WHERE sub_event_id = p_sub_event_id
          AND leader_id = v_leader_id
          AND status <> 'CANCELLED'::public.registration_status
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'ALREADY_REGISTERED', 'message', 'You already have an active registration for this sub-event');
    END IF;

    -- 7. Team Member Duplicate Prevention (scoped strictly to this sub-event)
    IF v_sorted_rolls IS NOT NULL AND array_length(v_sorted_rolls, 1) > 0 THEN
        SELECT tm.snapshot_roll_number INTO v_duplicate_roll
        FROM public.team_members tm
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE r.sub_event_id = p_sub_event_id
          AND r.status IN ('CONFIRMED'::public.registration_status, 'PENDING_PAYMENT'::public.registration_status)
          AND UPPER(trim(tm.snapshot_roll_number)) = ANY(v_sorted_rolls)
        LIMIT 1;

        IF v_duplicate_roll IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'MEMBER_ALREADY_REGISTERED',
                'message', format('Participant with roll number %s is already registered for this sub-event.', v_duplicate_roll)
            );
        END IF;
    END IF;

    -- 8. Fee Calculation & Authoritative Status Determination
    v_fee := CASE WHEN p_mode = 'TEAM' THEN COALESCE(v_sub_event.fee_amount_team, 0) ELSE COALESCE(v_sub_event.fee_amount_solo, 0) END;
    v_is_cod := (v_fee > 0 AND v_pay_method = 'COD');
    v_initial_status := CASE WHEN v_is_cod THEN 'PENDING_PAYMENT'::public.registration_status ELSE 'CONFIRMED'::public.registration_status END;

    -- 9. Atomic Guarded Capacity Reservation (executes in the SAME transaction)
    UPDATE public.sub_events
    SET registered_count = registered_count + 1
    WHERE id = p_sub_event_id
      AND status = 'ACTIVE'::public.event_status
      AND (max_capacity IS NULL OR registered_count < max_capacity)
    RETURNING id, name, attendance_token_prefix
    INTO v_sub_event;

    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.sub_events WHERE id = p_sub_event_id AND status <> 'ACTIVE'::public.event_status) THEN
            RETURN jsonb_build_object('success', false, 'code', 'EVENT_CLOSED', 'message', 'This sub-event is currently closed for registration');
        ELSE
            RETURN jsonb_build_object('success', false, 'code', 'CAPACITY_REACHED', 'message', 'Registration capacity for this sub-event is full.');
        END IF;
    END IF;

    -- 10. Atomic Registration Envelope Creation
    INSERT INTO public.registrations (
        sub_event_id,
        leader_id,
        status,
        created_at
    ) VALUES (
        p_sub_event_id,
        v_leader_id,
        v_initial_status,
        NOW()
    ) RETURNING id INTO v_reg_id;

    -- 11. Atomic Team Record Creation
    v_team_title := CASE WHEN p_mode = 'TEAM' THEN trim(p_team_name) ELSE 'Solo Participant' END;
    INSERT INTO public.teams (
        registration_id,
        team_name
    ) VALUES (
        v_reg_id,
        v_team_title
    ) RETURNING id INTO v_team_id;

    -- 12. Atomic Team Members Insertion
    v_token_prefix := COALESCE(v_sub_event.attendance_token_prefix, v_sub_event.name, 'EVENT');

    FOR v_m IN SELECT * FROM jsonb_array_elements(p_team_members) LOOP
        v_idx := v_idx + 1;
        v_is_leader := (v_idx = 1);
        v_manual_token := public.generate_attendance_token(v_token_prefix);
        v_qr_identity := gen_random_uuid();
        v_member_name := trim(COALESCE(v_m->>'snapshot_name', v_m->>'name', 'Participant'));
        v_member_roll := UPPER(trim(COALESCE(v_m->>'snapshot_roll_number', v_m->>'roll_number', '')));

        INSERT INTO public.team_members (
            team_id,
            user_id,
            snapshot_name,
            snapshot_roll_number,
            snapshot_college,
            snapshot_department,
            snapshot_year,
            is_leader,
            manual_token,
            qr_identity
        ) VALUES (
            v_team_id,
            CASE WHEN v_is_leader THEN v_leader_id ELSE NULL END,
            v_member_name,
            v_member_roll,
            trim(COALESCE(v_m->>'snapshot_college', v_m->>'college', 'KITS Akshar Institute of Technology')),
            trim(COALESCE(v_m->>'snapshot_department', v_m->>'department', '')),
            COALESCE((v_m->>'snapshot_year')::integer, (v_m->>'year_of_study')::integer, 3),
            v_is_leader,
            v_manual_token,
            v_qr_identity
        );

        v_created_members := v_created_members || jsonb_build_object(
            'id', v_qr_identity,
            'name', v_member_name,
            'roll_number', v_member_roll,
            'is_leader', v_is_leader,
            'manual_token', v_manual_token,
            'qr_identity', v_qr_identity
        );
    END LOOP;

    -- 13. Process Document Uploads (if any)
    IF p_uploaded_documents IS NOT NULL AND jsonb_typeof(p_uploaded_documents) = 'array' AND jsonb_array_length(p_uploaded_documents) > 0 THEN
        FOR v_doc IN SELECT * FROM jsonb_array_elements(p_uploaded_documents) LOOP
            INSERT INTO public.documents (
                owner_id,
                entity_type,
                entity_id,
                storage_path,
                file_name,
                mime_type,
                size_bytes,
                uploaded_at
            ) VALUES (
                v_leader_id,
                'REGISTRATION'::public.document_entity_type,
                v_reg_id,
                v_doc->>'storage_path',
                COALESCE(v_doc->>'file_name', 'document'),
                COALESCE(v_doc->>'mime_type', 'application/octet-stream'),
                COALESCE((v_doc->>'size_bytes')::bigint, 0),
                NOW()
            );
        END LOOP;
    END IF;

    -- 14. Process Payment Record
    IF v_fee = 0 THEN
        v_pay_method := 'FREE';
        v_pay_status := 'SUCCESS';
        IF v_pay_ref = '' THEN v_pay_ref := 'FREE-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'); END IF;
    ELSIF v_pay_method = 'COD' THEN
        v_pay_status := 'PENDING';
        IF v_pay_ref = '' THEN v_pay_ref := 'COD-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'); END IF;
    ELSIF v_pay_method = 'ONLINE' THEN
        v_pay_status := 'SUCCESS';
        IF v_pay_ref = '' THEN v_pay_ref := 'ONLINE-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'); END IF;
    ELSE
        v_pay_method := 'UPI';
        v_pay_status := 'SUCCESS';
        IF v_pay_ref = '' THEN v_pay_ref := 'UPI-DEMO-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'); END IF;
    END IF;

    INSERT INTO public.payments (
        registration_id,
        amount,
        reference_id,
        payment_method,
        status,
        created_at
    ) VALUES (
        v_reg_id,
        v_fee,
        v_pay_ref,
        v_pay_method,
        v_pay_status,
        NOW()
    ) RETURNING id, amount, reference_id, payment_method, status INTO v_payment;

    -- 15. Audit Log (within same transaction)
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_leader_id,
        'REGISTRATION_CREATED',
        'registrations',
        v_reg_id,
        jsonb_build_object(
            'sub_event_id', p_sub_event_id,
            'sub_event_name', v_sub_event.name,
            'mode', p_mode,
            'team_id', v_team_id,
            'team_name', v_team_title,
            'members_count', v_idx,
            'payment_method', v_pay_method,
            'payment_status', v_pay_status,
            'fee_amount', v_fee
        ),
        NOW()
    );

    -- 16. Return Exact Authoritative JSON Contract
    RETURN jsonb_build_object(
        'success', true,
        'registration_id', v_reg_id,
        'team_id', v_team_id,
        'members_count', v_idx,
        'payment', jsonb_build_object(
            'id', v_payment.id,
            'status', v_payment.status,
            'amount', v_payment.amount,
            'payment_method', v_payment.payment_method,
            'reference_id', v_payment.reference_id
        ),
        'members', v_created_members
    );

EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
        'success', false,
        'code', 'ALREADY_REGISTERED',
        'message', 'You already have an active registration for this sub-event'
    );
END;
$$;

-- Least-Privilege Permissions on student_register_atomic
REVOKE ALL ON FUNCTION public.student_register_atomic(UUID, VARCHAR, VARCHAR, JSONB, JSONB, VARCHAR, VARCHAR) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.student_register_atomic(UUID, VARCHAR, VARCHAR, JSONB, JSONB, VARCHAR, VARCHAR) TO authenticated;

-- ============================================================================
-- 4. SERVER-SIDE AUTHORIZED IDEMPOTENT CANCELLATION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_registration_idempotent(
    p_registration_id UUID,
    p_reason TEXT DEFAULT 'Cancelled by user/admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_sub_event_id UUID;
    v_leader_id UUID;
    v_current_status public.registration_status;
    v_current_count INTEGER;
    v_caller_id UUID := auth.uid();
    v_is_admin BOOLEAN := FALSE;
BEGIN
    -- 1. Ensure authenticated session
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: valid JWT session expected';
    END IF;

    -- 2. Verify caller role
    v_is_admin := public.is_admin();

    -- 3. Fetch registration and lock for transition
    SELECT sub_event_id, leader_id, status
    INTO v_sub_event_id, v_leader_id, v_current_status
    FROM public.registrations
    WHERE id = p_registration_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'message', 'Registration not found.');
    END IF;

    -- 4. Server-Side Authorization Enforcement:
    -- Caller must be either the student leader who owns this registration OR an active administrator
    IF NOT v_is_admin AND (v_leader_id IS NULL OR v_caller_id <> v_leader_id) THEN
        RAISE EXCEPTION 'Forbidden: You are not authorized to cancel this registration.';
    END IF;

    -- 5. Idempotency Check: if already CANCELLED, return released = false (no duplicate decrement)
    IF v_current_status = 'CANCELLED'::public.registration_status THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Registration was already cancelled; no capacity release needed.',
            'released', false
        );
    END IF;

    -- 6. Transition status to CANCELLED
    UPDATE public.registrations
    SET status = 'CANCELLED'::public.registration_status
    WHERE id = p_registration_id;

    -- 7. Guarded Capacity Decrement & Non-Silent Anomaly Detection
    SELECT registered_count
    INTO v_current_count
    FROM public.sub_events
    WHERE id = v_sub_event_id
    FOR UPDATE;

    IF v_current_count > 0 THEN
        UPDATE public.sub_events
        SET registered_count = registered_count - 1
        WHERE id = v_sub_event_id;
    ELSE
        -- Detect and report counter anomaly instead of silently hiding it
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
        VALUES (
            v_caller_id,
            'ANOMALY_COUNTER_UNDERFLOW_PREVENTED',
            'sub_events',
            v_sub_event_id,
            jsonb_build_object(
                'registration_id', p_registration_id,
                'registered_count_found', v_current_count,
                'warning', 'Active registration cancelled but registered_count was already 0 or negative.'
            ),
            NOW()
        );
    END IF;

    -- 8. Audit Log Cancellation
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_caller_id,
        'REGISTRATION_CANCELLED',
        'registrations',
        p_registration_id,
        jsonb_build_object(
            'sub_event_id', v_sub_event_id,
            'previous_status', v_current_status,
            'reason', p_reason,
            'cancelled_by', CASE WHEN v_is_admin THEN 'ADMIN' ELSE 'LEADER' END
        ),
        NOW()
    );

    RETURN jsonb_build_object('success', true, 'released', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_registration_idempotent(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_registration_idempotent(UUID, TEXT) TO authenticated;

-- ============================================================================
-- 5. AFTER DELETE CAPACITY SYNC TRIGGER (Preserves admin_execute_event_deletion)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trig_sync_registration_delete_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only sync if the deleted registration consumed capacity
    IF OLD.status IN ('CONFIRMED'::public.registration_status, 'PENDING_PAYMENT'::public.registration_status) THEN
        -- Only update if parent sub_event exists (not deleted in the same cascade)
        UPDATE public.sub_events
        SET registered_count = registered_count - 1
        WHERE id = OLD.sub_event_id
          AND registered_count > 0;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_registration_delete ON public.registrations;
CREATE TRIGGER tr_sync_registration_delete
AFTER DELETE ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION public.trig_sync_registration_delete_capacity();

-- ============================================================================
-- 6. AUTHORITATIVE ADMIN KPI AGGREGATION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_dashboard_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied: Administrator privileges required';
    END IF;

    RETURN jsonb_build_object(
        'totalEvents', (SELECT COUNT(*) FROM public.events WHERE status <> 'PERMANENTLY_DELETED'::public.event_status),
        'totalCategories', (SELECT COUNT(*) FROM public.categories WHERE status <> 'PERMANENTLY_DELETED'::public.event_status),
        'totalSubEvents', (SELECT COUNT(*) FROM public.sub_events WHERE status <> 'PERMANENTLY_DELETED'::public.event_status),
        'totalCoordinators', (SELECT COUNT(*) FROM public.coordinators c WHERE c.status = 'ACTIVE'::public.user_status AND c.username NOT LIKE 'coord-%@coordinator.kits-eos.internal' AND c.username NOT LIKE 'coord-%'),
        'totalRegistrations', (SELECT COUNT(*) FROM public.registrations),
        'confirmedRegistrations', (SELECT COUNT(*) FROM public.registrations WHERE status = 'CONFIRMED'::public.registration_status),
        'totalRevenue', (SELECT COALESCE(SUM(amount), 0) FROM public.payments WHERE status = 'SUCCESS'::public.payment_status),
        'totalAttendance', (SELECT COUNT(*) FROM public.attendance_records),
        'totalCertificates', (SELECT COUNT(*) FROM public.certificates),
        'totalFeedback', (SELECT COUNT(*) FROM public.feedback_responses),
        'openComplaints', (SELECT COUNT(*) FROM public.complaints WHERE status = 'OPEN'),
        'recentLogs', (
            SELECT COALESCE(jsonb_agg(log_row), '[]'::jsonb)
            FROM (
                SELECT id, actor_id, action, entity_type, entity_id, metadata, created_at
                FROM public.audit_logs
                ORDER BY created_at DESC
                LIMIT 6
            ) log_row
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_dashboard_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_dashboard_metrics() TO authenticated, service_role;

-- ============================================================================
-- 7. SET-BASED CTE OPTIMIZATION FOR COORDINATOR ROSTER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_roster(p_sub_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN;
    v_registrations JSONB;
    v_attendance JSONB;
BEGIN
    SELECT public.get_current_coordinator_id() INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    -- Strict server-side assignment check
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.sub_events se ON se.id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord_id
          AND ca.sub_event_id = p_sub_event_id
          AND se.status = 'ACTIVE'::public.event_status
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RAISE EXCEPTION 'You are not assigned to this sub-event';
    END IF;

    -- Set-Based CTE Aggregation (Zero Correlated Scalar Subqueries)
    WITH pre_payments AS (
        SELECT p.registration_id,
               COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'id', p.id,
                       'status', p.status,
                       'amount', p.amount,
                       'payment_method', p.payment_method,
                       'reference_id', p.reference_id,
                       'created_at', p.created_at
                   ) ORDER BY p.created_at DESC
               ), '[]'::jsonb) AS payments_json
        FROM public.payments p
        JOIN public.registrations r ON r.id = p.registration_id
        WHERE r.sub_event_id = p_sub_event_id
        GROUP BY p.registration_id
    ),
    pre_members AS (
        SELECT tm.team_id,
               COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'id', tm.id,
                       'user_id', tm.user_id,
                       'is_leader', tm.is_leader,
                       'manual_token', tm.manual_token,
                       'qr_identity', tm.qr_identity,
                       'snapshot_name', tm.snapshot_name,
                       'snapshot_roll_number', tm.snapshot_roll_number,
                       'snapshot_college', tm.snapshot_college,
                       'snapshot_department', tm.snapshot_department,
                       'snapshot_year', tm.snapshot_year,
                       'attendance_token', tm.manual_token,
                       'student_id', tm.user_id,
                       'student_profiles', jsonb_build_object(
                           'user_id', sp.user_id,
                           'full_name', sp.full_name,
                           'roll_number', sp.roll_number,
                           'college', sp.college_name,
                           'department', sp.department,
                           'year_of_study', sp.year_of_study,
                           'phone', sp.phone
                       )
                   ) ORDER BY tm.is_leader DESC, tm.snapshot_name ASC
               ), '[]'::jsonb) AS members_json
        FROM public.team_members tm
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        LEFT JOIN public.student_profiles sp ON sp.user_id = tm.user_id
        WHERE r.sub_event_id = p_sub_event_id
        GROUP BY tm.team_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'sub_event_id', r.sub_event_id,
            'leader_id', r.leader_id,
            'status', r.status,
            'created_at', r.created_at,
            'teams', CASE WHEN t.id IS NOT NULL THEN jsonb_build_object(
                'id', t.id,
                'name', t.team_name,
                'leader_id', r.leader_id,
                'team_members', COALESCE(pm.members_json, '[]'::jsonb)
            ) ELSE NULL END,
            'student_profiles', CASE WHEN sp_lead.user_id IS NOT NULL THEN jsonb_build_object(
                'user_id', sp_lead.user_id,
                'full_name', sp_lead.full_name,
                'roll_number', sp_lead.roll_number,
                'college', sp_lead.college_name,
                'department', sp_lead.department,
                'year_of_study', sp_lead.year_of_study,
                'phone', sp_lead.phone
            ) ELSE NULL END,
            'payments', COALESCE(pp.payments_json, '[]'::jsonb)
        ) ORDER BY r.created_at ASC
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    LEFT JOIN public.teams t ON t.registration_id = r.id
    LEFT JOIN public.student_profiles sp_lead ON sp_lead.user_id = r.leader_id
    LEFT JOIN pre_members pm ON pm.team_id = t.id
    LEFT JOIN pre_payments pp ON pp.registration_id = r.id
    WHERE r.sub_event_id = p_sub_event_id;

    -- Fetch Authoritative Attendance Records
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'sub_event_id', a.sub_event_id,
            'team_id', a.team_id,
            'scanned_member_id', a.scanned_member_id,
            'checked_in_at', a.check_in_time,
            'checked_in_by', a.checked_in_by
        ) ORDER BY a.check_in_time DESC
    ), '[]'::jsonb)
    INTO v_attendance
    FROM public.attendance_records a
    WHERE a.sub_event_id = p_sub_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'registrations', COALESCE(v_registrations, '[]'::jsonb),
        'attendance', COALESCE(v_attendance, '[]'::jsonb)
    );
END;
$$;

-- Secure Permissions on Coordinator Roster RPC (Zero anonymous execution paths)
REVOKE ALL ON FUNCTION public.get_coordinator_sub_event_roster(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(UUID) TO authenticated;

-- Also revoke anon from any legacy overload if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'get_coordinator_sub_event_roster'
          AND pg_get_function_identity_arguments(p.oid) = 'p_token text, p_sub_event_id uuid'
    ) THEN
        REVOKE ALL ON FUNCTION public.get_coordinator_sub_event_roster(TEXT, UUID) FROM PUBLIC, anon;
    END IF;
END $$;

-- ============================================================================
-- 8. EXPLICIT ADMINISTRATIVE CAPACITY RECONCILIATION MAINTENANCE TOOL
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_reconcile_sub_event_capacity(p_sub_event_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_report JSONB := '[]'::jsonb;
    r RECORD;
    v_actual_count INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied: Administrator privileges required';
    END IF;

    FOR r IN
        SELECT id, name, registered_count
        FROM public.sub_events
        WHERE (p_sub_event_id IS NULL OR id = p_sub_event_id)
        FOR UPDATE
    LOOP
        SELECT COUNT(*) INTO v_actual_count
        FROM public.registrations
        WHERE sub_event_id = r.id
          AND status IN ('CONFIRMED'::public.registration_status, 'PENDING_PAYMENT'::public.registration_status);

        IF r.registered_count <> v_actual_count THEN
            UPDATE public.sub_events
            SET registered_count = v_actual_count
            WHERE id = r.id;

            INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
            VALUES (
                auth.uid(),
                'CAPACITY_RECONCILED',
                'sub_events',
                r.id,
                jsonb_build_object('stored_count', r.registered_count, 'actual_count', v_actual_count),
                NOW()
            );

            v_report := v_report || jsonb_build_object(
                'sub_event_id', r.id,
                'name', r.name,
                'previous_count', r.registered_count,
                'reconciled_count', v_actual_count,
                'drift', v_actual_count - r.registered_count
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'reconciled_events', v_report);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reconcile_sub_event_capacity(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_sub_event_capacity(UUID) TO authenticated, service_role;
