-- 075_registration_lifecycle_and_free_paid_subevents.sql
-- Production Migration:
-- 1. Adds public.sub_events.is_free BOOLEAN NOT NULL DEFAULT false
-- 2. Updates public.main_event_registration_gate:
--    - ACTIVE + AUTOMATIC: UPCOMING, REGISTRATIONS OPEN, ONGOING -> TRUE; COMPLETED -> FALSE
--    - ACTIVE + MANUAL: UPCOMING, REGISTRATIONS OPEN, ONGOING -> TRUE; REGISTRATIONS CLOSED, COMPLETED -> FALSE
-- 3. Updates public.sub_event_registration_available:
--    - ONGOING sub-events (start_time <= NOW() < end_time) remain open for registration
--    - Locks only when parent gate closed, archived/inactive, end_time reached, capacity full, or manual closure
-- 4. Updates public.effective_status for sub_events
-- 5. Updates student_register_atomic:
--    - FREE sub-events: status CONFIRMED, NO payments table row created, payment: null
--    - PAID sub-events: fee enforced, existing UPI demo / COD payment flow preserved
-- 6. Adds database trigger trg_check_sub_event_payment_type_immutable preventing Free <-> Paid edits when registrations exist

-- ============================================================================
-- 1. ADD is_free COLUMN TO SUB_EVENTS & INITIALIZE
-- ============================================================================

ALTER TABLE public.sub_events 
ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing records: an event is free if both solo and team fees are 0
UPDATE public.sub_events
SET is_free = (COALESCE(fee_amount_solo, 0) = 0 AND COALESCE(fee_amount_team, 0) = 0);

-- ============================================================================
-- 2. UPDATE MAIN EVENT REGISTRATION GATE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.main_event_registration_gate(p_ev public.events)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    -- Archived / non-active events cannot accept registrations
    IF p_ev.status <> 'ACTIVE'::public.event_status THEN
        RETURN false;
    END IF;

    -- MANUAL Mode:
    -- UPCOMING, REGISTRATIONS OPEN, ONGOING -> TRUE
    -- REGISTRATIONS CLOSED, COMPLETED -> FALSE
    IF p_ev.status_mode = 'MANUAL' THEN
        RETURN (p_ev.manual_status IN ('UPCOMING', 'REGISTRATIONS OPEN', 'ONGOING'));
    END IF;

    -- AUTOMATIC Mode:
    -- > 10 days before start (UPCOMING): OPEN (TRUE)
    -- Within 10 days before start (REGISTRATIONS OPEN): OPEN (TRUE)
    -- At/after start and before end (ONGOING): OPEN (TRUE)
    -- At/after end (COMPLETED): CLOSED (FALSE)
    IF p_ev.end_date IS NOT NULL AND v_now >= p_ev.end_date THEN
        RETURN false;
    END IF;

    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.main_event_registration_gate(p_event_id UUID)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_ev public.events;
BEGIN
    SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
    IF NOT FOUND THEN RETURN false; END IF;
    RETURN public.main_event_registration_gate(v_ev);
END;
$$;

-- ============================================================================
-- 3. UPDATE SUB-EVENT REGISTRATION AVAILABILITY PIPELINE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sub_event_registration_available(p_sub public.sub_events)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_ev public.events;
    v_cat public.categories;
BEGIN
    -- 1. Sub-event must be ACTIVE
    IF p_sub.status <> 'ACTIVE'::public.event_status THEN
        RETURN false;
    END IF;

    -- 2. Physical schedule: If sub-event end_time is reached, registration is locked.
    -- (Important: start_time does NOT lock registration; ONGOING remains registerable)
    IF p_sub.end_time IS NOT NULL AND v_now >= p_sub.end_time THEN
        RETURN false;
    END IF;

    -- 3. Capacity: If max_capacity is reached, registration is locked
    IF p_sub.max_capacity IS NOT NULL AND p_sub.registered_count >= p_sub.max_capacity THEN
        RETURN false;
    END IF;

    -- 4. Check category archive status if attached
    IF p_sub.category_id IS NOT NULL THEN
        SELECT * INTO v_cat FROM public.categories WHERE id = p_sub.category_id;
        IF v_cat.id IS NOT NULL AND v_cat.status <> 'ACTIVE'::public.event_status THEN
            RETURN false;
        END IF;
    END IF;

    -- 5. Resolve parent Main Event
    SELECT e.* INTO v_ev
    FROM public.events e
    WHERE e.id = p_sub.event_id
       OR e.id = (SELECT c.event_id FROM public.categories c WHERE c.id = p_sub.category_id);

    IF v_ev.id IS NULL THEN
        RETURN false;
    END IF;

    -- 6. Main Event Registration Gate check
    IF NOT public.main_event_registration_gate(v_ev) THEN
        RETURN false;
    END IF;

    -- 7. Sub-event manual override
    IF p_sub.status_mode = 'MANUAL' AND p_sub.manual_status IN ('REGISTRATIONS CLOSED', 'COMPLETED') THEN
        RETURN false;
    END IF;

    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.sub_event_registration_available(p_sub_event_id UUID)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_sub public.sub_events;
BEGIN
    SELECT * INTO v_sub FROM public.sub_events WHERE id = p_sub_event_id;
    IF NOT FOUND THEN RETURN false; END IF;
    RETURN public.sub_event_registration_available(v_sub);
END;
$$;

-- ============================================================================
-- 4. UPDATE AUTHORITATIVE SUB-EVENT LIFECYCLE RESOLVER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.effective_status(p_sub public.sub_events)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_ev public.events;
    v_parent_status TEXT;
BEGIN
    -- Priority 1: Physical Schedule Precedence
    -- A. COMPLETED: NOW() >= end_time
    IF p_sub.end_time IS NOT NULL AND v_now >= p_sub.end_time THEN
        RETURN 'COMPLETED';
    END IF;

    -- B. ONGOING: NOW() >= start_time AND NOW() < end_time
    IF p_sub.start_time IS NOT NULL AND v_now >= p_sub.start_time THEN
        RETURN 'ONGOING';
    END IF;

    -- Priority 2: Sub-event Manual Override (Applicable before start_time)
    IF p_sub.status_mode = 'MANUAL' AND p_sub.manual_status IS NOT NULL THEN
        RETURN p_sub.manual_status;
    END IF;

    -- Priority 3: Sub-event capacity check
    IF p_sub.max_capacity IS NOT NULL AND p_sub.registered_count >= p_sub.max_capacity THEN
        RETURN 'REGISTRATIONS CLOSED';
    END IF;

    -- Priority 4: Parent Main Event Registration Gate & Lifecycle
    SELECT e.* INTO v_ev
    FROM public.events e
    WHERE e.id = p_sub.event_id
       OR e.id = (SELECT c.event_id FROM public.categories c WHERE c.id = p_sub.category_id);

    IF v_ev.id IS NOT NULL THEN
        IF v_ev.status <> 'ACTIVE'::public.event_status THEN
            RETURN 'REGISTRATIONS CLOSED';
        END IF;

        v_parent_status := public.effective_status(v_ev);
        IF v_parent_status = 'REGISTRATIONS OPEN' THEN
            RETURN 'REGISTRATIONS OPEN';
        ELSIF v_parent_status = 'UPCOMING' THEN
            RETURN 'UPCOMING';
        ELSIF v_parent_status = 'COMPLETED' THEN
            RETURN 'COMPLETED';
        ELSIF v_parent_status = 'ONGOING' THEN
            RETURN 'ONGOING';
        ELSE
            RETURN 'REGISTRATIONS CLOSED';
        END IF;
    END IF;

    RETURN 'UPCOMING';
END;
$$;

-- ============================================================================
-- 5. ATOMIC REGISTRATION RPC (FREE & PAID DIFFERENTIATION)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.student_register_atomic(
    p_sub_event_id UUID,
    p_mode VARCHAR,
    p_team_name VARCHAR,
    p_team_members JSONB,
    p_uploaded_documents JSONB DEFAULT '[]'::jsonb,
    p_payment_reference TEXT DEFAULT NULL,
    p_payment_method VARCHAR DEFAULT 'UPI'
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
    v_parent_event public.events;
    v_cat_status public.event_status;
    v_parent_effective_status TEXT;
    v_is_free BOOLEAN := false;
    v_fee NUMERIC := 0;
    v_is_cod BOOLEAN := false;
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
    v_payment_json JSONB := NULL;
BEGIN
    v_leader_id := auth.uid();
    IF v_leader_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: valid student JWT session expected';
    END IF;

    -- 1. Validate student account status (Reject DEACTIVATED / ANONYMIZED)
    SELECT status INTO v_user_status FROM public.users WHERE id = v_leader_id;
    IF v_user_status IS NULL OR v_user_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Account is inactive, suspended, or deactivated';
    END IF;

    IF p_sub_event_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'sub_event_id is required');
    END IF;

    IF p_mode NOT IN ('SOLO', 'TEAM') THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'mode must be SOLO or TEAM');
    END IF;

    IF p_team_members IS NULL OR jsonb_typeof(p_team_members) <> 'array' OR jsonb_array_length(p_team_members) = 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'At least one participant is required');
    END IF;

    -- 2. Fetch sub-event record
    SELECT * INTO v_sub_event
    FROM public.sub_events
    WHERE id = p_sub_event_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'message', 'Sub-event not found');
    END IF;

    v_is_free := COALESCE(v_sub_event.is_free, false);

    -- 3. Archive hierarchy validation
    IF v_sub_event.status <> 'ACTIVE'::public.event_status THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_ARCHIVED', 'message', 'This sub-event is archived and closed for registration');
    END IF;

    IF v_sub_event.category_id IS NOT NULL THEN
        SELECT status INTO v_cat_status FROM public.categories WHERE id = v_sub_event.category_id;
        IF v_cat_status IS NOT NULL AND v_cat_status <> 'ACTIVE'::public.event_status THEN
            RETURN jsonb_build_object('success', false, 'code', 'CATEGORY_ARCHIVED', 'message', 'This category track is archived and closed for new registrations');
        END IF;
    END IF;

    SELECT e.* INTO v_parent_event
    FROM public.events e
    WHERE e.id = v_sub_event.event_id 
       OR e.id = (SELECT c.event_id FROM public.categories c WHERE c.id = v_sub_event.category_id);

    IF v_parent_event.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_NOT_FOUND', 'message', 'Parent event not found');
    END IF;

    IF v_parent_event.status <> 'ACTIVE'::public.event_status THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_ARCHIVED', 'message', 'This event is archived and closed for new registrations');
    END IF;

    -- 4. Authoritative Main Event Registration Gate Enforcement
    IF NOT public.main_event_registration_gate(v_parent_event) THEN
        v_parent_effective_status := public.effective_status(v_parent_event);
        IF v_parent_effective_status = 'REGISTRATIONS CLOSED' THEN
            RETURN jsonb_build_object('success', false, 'code', 'EVENT_REGISTRATIONS_CLOSED', 'message', 'Registrations are closed for this event');
        ELSIF v_parent_effective_status = 'COMPLETED' THEN
            RETURN jsonb_build_object('success', false, 'code', 'EVENT_COMPLETED', 'message', 'This event has concluded; registrations are closed');
        ELSE
            RETURN jsonb_build_object('success', false, 'code', 'EVENT_REGISTRATION_LOCKED', 'message', 'Registration gate for this event is closed');
        END IF;
    END IF;

    -- 5. Sub-event Registration Availability Enforcement
    IF v_sub_event.end_time IS NOT NULL AND clock_timestamp() >= v_sub_event.end_time THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_COMPLETED', 'message', 'This competition has already concluded');
    END IF;

    -- NOTE: v_sub_event.start_time does NOT lock registrations anymore! ONGOING is registerable!

    IF v_sub_event.max_capacity IS NOT NULL AND v_sub_event.registered_count >= v_sub_event.max_capacity THEN
        RETURN jsonb_build_object('success', false, 'code', 'CAPACITY_REACHED', 'message', 'Registration capacity for this sub-event is full.');
    END IF;

    IF v_sub_event.status_mode = 'MANUAL' AND v_sub_event.manual_status IN ('REGISTRATIONS CLOSED', 'COMPLETED') THEN
        RETURN jsonb_build_object('success', false, 'code', 'REGISTRATIONS_CLOSED', 'message', 'Registrations are currently closed for this competition');
    END IF;

    -- 6. Participation type validation
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

    -- 7. Advisory locks on roll numbers to prevent concurrent double-booking
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

    -- 8. Check if leader already registered
    IF EXISTS (
        SELECT 1 FROM public.registrations
        WHERE sub_event_id = p_sub_event_id
          AND leader_id = v_leader_id
          AND status <> 'CANCELLED'::public.registration_status
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'ALREADY_REGISTERED', 'message', 'You already have an active registration for this sub-event');
    END IF;

    -- 9. Check duplicate participants
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

    -- 10. FREE vs PAID Fee and Status Resolution
    IF v_is_free THEN
        v_fee := 0;
        v_is_cod := false;
        v_initial_status := 'CONFIRMED'::public.registration_status;
    ELSE
        -- PAID sub-event
        v_fee := CASE WHEN p_mode = 'TEAM' THEN COALESCE(v_sub_event.fee_amount_team, 0) ELSE COALESCE(v_sub_event.fee_amount_solo, 0) END;
        
        -- Guard against attempting FREE registration on a paid sub-event
        IF p_payment_method = 'FREE' OR v_fee <= 0 THEN
            RETURN jsonb_build_object('success', false, 'code', 'PAYMENT_REQUIRED', 'message', 'Payment is required for this paid sub-event');
        END IF;

        v_is_cod := (v_pay_method = 'COD');
        v_initial_status := CASE WHEN v_is_cod THEN 'PENDING_PAYMENT'::public.registration_status ELSE 'CONFIRMED'::public.registration_status END;
    END IF;

    -- 11. Atomic capacity increment
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

    -- 12. Insert registration
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

    -- 13. Insert team
    v_team_title := CASE WHEN p_mode = 'TEAM' THEN trim(p_team_name) ELSE 'Solo Participant' END;
    INSERT INTO public.teams (
        registration_id,
        team_name
    ) VALUES (
        v_reg_id,
        v_team_title
    ) RETURNING id INTO v_team_id;

    v_token_prefix := COALESCE(v_sub_event.attendance_token_prefix, v_sub_event.name, 'EVENT');

    -- 14. Insert team members with immutable snapshot details
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

    -- 15. Attach uploaded documents if any
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

    -- 16. Attach payments (ONLY FOR PAID SUB-EVENTS; FREE SUB-EVENTS CREATE NO PAYMENT RECORD)
    IF v_is_free THEN
        v_payment_json := NULL;
    ELSE
        IF v_pay_method = 'COD' THEN
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

        v_payment_json := jsonb_build_object(
            'id', v_payment.id,
            'status', v_payment.status,
            'amount', v_payment.amount,
            'payment_method', v_payment.payment_method,
            'reference_id', v_payment.reference_id
        );
    END IF;

    -- 17. Audit log
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
            'is_free', v_is_free,
            'payment_method', CASE WHEN v_is_free THEN 'NONE' ELSE v_pay_method END,
            'payment_status', CASE WHEN v_is_free THEN 'NONE' ELSE v_pay_status::text END,
            'fee_amount', v_fee
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'registration_id', v_reg_id,
        'team_id', v_team_id,
        'members_count', v_idx,
        'is_free', v_is_free,
        'payment', v_payment_json,
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

REVOKE ALL ON FUNCTION public.student_register_atomic(UUID, VARCHAR, VARCHAR, JSONB, JSONB, TEXT, VARCHAR) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_register_atomic(UUID, VARCHAR, VARCHAR, JSONB, JSONB, TEXT, VARCHAR) TO authenticated;

-- ============================================================================
-- 6. TRIGGER TO PREVENT UNSAFE FREE <-> PAID EDITS WHEN REGISTRATIONS EXIST
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_sub_event_payment_type_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (OLD.is_free IS DISTINCT FROM NEW.is_free) THEN
        IF EXISTS (
            SELECT 1 FROM public.registrations
            WHERE sub_event_id = OLD.id
              AND status <> 'CANCELLED'::public.registration_status
        ) THEN
            RAISE EXCEPTION 'Cannot change payment type (Free ↔ Paid) because active registrations already exist for this sub-event.'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_sub_event_payment_type_immutable ON public.sub_events;
CREATE TRIGGER trg_check_sub_event_payment_type_immutable
BEFORE UPDATE ON public.sub_events
FOR EACH ROW
EXECUTE FUNCTION public.check_sub_event_payment_type_immutable();
