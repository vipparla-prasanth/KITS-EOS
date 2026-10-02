-- Migration: 102_fix_registration_enum_and_payment_status.sql
-- Fixes PostgreSQL enum mismatch in trigger_notify_on_registration_created:
-- Replaces invalid enum literal 'PENDING' with canonical 'PENDING_PAYMENT'::public.registration_status.
-- Enriches student_register_atomic return object with authoritative status.
-- Corrects confirm_bulk_payments by removing invalid non-existent column references (p.currency, r.mode, paid_at).

-- 1. Correct registration notification trigger function
CREATE OR REPLACE FUNCTION public.trigger_notify_on_registration_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_sub_event RECORD;
BEGIN
    SELECT se.name, e.name AS parent_event_name
    INTO v_sub_event
    FROM public.sub_events se
    LEFT JOIN public.events e ON e.id = se.event_id
    WHERE se.id = NEW.sub_event_id;

    IF NEW.status = 'CONFIRMED' THEN
        INSERT INTO public.notifications (
            user_id, coordinator_id, recipient_role, notification_type,
            category, entity_type, entity_id, title, message, event_key,
            metadata, is_read, created_at
        ) VALUES (
            NEW.leader_id, NULL, 'STUDENT', 'REGISTRATION_CONFIRMED',
            'REGISTRATION', 'REGISTRATION', NEW.id,
            'Registration Confirmed',
            'Your registration for ' || COALESCE(v_sub_event.name, 'the event') || ' under ' || COALESCE(v_sub_event.parent_event_name, 'KITS-EOS') || ' has been confirmed.',
            'REG_CONFIRMED:' || NEW.id::text,
            jsonb_build_object('registration_id', NEW.id, 'sub_event_id', NEW.sub_event_id),
            FALSE, NOW()
        ) ON CONFLICT (event_key) DO NOTHING;

    ELSIF NEW.status = 'PENDING_PAYMENT' THEN
        INSERT INTO public.notifications (
            user_id, coordinator_id, recipient_role, notification_type,
            category, entity_type, entity_id, title, message, event_key,
            metadata, is_read, created_at
        ) VALUES (
            NEW.leader_id, NULL, 'STUDENT', 'REGISTRATION_SUBMITTED',
            'REGISTRATION', 'REGISTRATION', NEW.id,
            'Registration Submitted',
            'Your registration for ' || COALESCE(v_sub_event.name, 'the event') || ' has been submitted. Payment is pending verification by the assigned coordinator.',
            'REG_SUBMITTED:' || NEW.id::text,
            jsonb_build_object('registration_id', NEW.id, 'sub_event_id', NEW.sub_event_id),
            FALSE, NOW()
        ) ON CONFLICT (event_key) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

-- Ensure trigger exists on public.registrations
DROP TRIGGER IF EXISTS trg_notify_on_registration_created ON public.registrations;
CREATE TRIGGER trg_notify_on_registration_created
AFTER INSERT ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION public.trigger_notify_on_registration_created();

-- 2. Update student_register_atomic to explicitly return status and registration_status
CREATE OR REPLACE FUNCTION public.student_register_atomic(
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
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
    v_leader_id UUID;
    v_user_status VARCHAR;
    v_leader_profile public.student_profiles;
    v_auth_leader_roll TEXT;
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
    v_member_college TEXT;
    v_member_dept TEXT;
    v_member_year INTEGER;
    v_created_members JSONB := '[]'::jsonb;
    v_doc JSONB;
    v_pay_status public.payment_status := 'SUCCESS';
    v_pay_ref TEXT := trim(COALESCE(p_payment_reference, ''));
    v_pay_method VARCHAR := UPPER(trim(COALESCE(p_payment_method, '')));
    v_payment RECORD;
    v_payment_json JSONB := NULL;
    v_sub_event_payment_mode TEXT;
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

    -- 2. Query authoritative student profile for the authenticated leader
    SELECT * INTO v_leader_profile 
    FROM public.student_profiles 
    WHERE user_id = v_leader_id;

    IF v_leader_profile.user_id IS NULL OR v_leader_profile.roll_number IS NULL OR length(trim(v_leader_profile.roll_number)) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'LEADER_PROFILE_INCOMPLETE',
            'message', 'Your student profile must have a valid roll number to register.'
        );
    END IF;

    v_auth_leader_roll := UPPER(trim(v_leader_profile.roll_number));

    IF p_sub_event_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'sub_event_id is required');
    END IF;

    IF p_mode NOT IN ('SOLO', 'TEAM') THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'mode must be SOLO or TEAM');
    END IF;

    IF p_team_members IS NULL OR jsonb_typeof(p_team_members) <> 'array' OR jsonb_array_length(p_team_members) = 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'At least one participant is required');
    END IF;

    -- 3. Fetch sub-event record
    SELECT * INTO v_sub_event
    FROM public.sub_events
    WHERE id = p_sub_event_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'message', 'Sub-event not found');
    END IF;

    v_is_free := COALESCE(v_sub_event.is_free, false);

    -- 4. Archive hierarchy validation
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

    -- 5. Authoritative Main Event Registration Gate Enforcement
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

    -- 6. Sub-event Registration Availability Enforcement
    IF v_sub_event.end_time IS NOT NULL AND clock_timestamp() >= v_sub_event.end_time THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_COMPLETED', 'message', 'This competition has already concluded');
    END IF;

    IF v_sub_event.max_capacity IS NOT NULL AND v_sub_event.registered_count >= v_sub_event.max_capacity THEN
        RETURN jsonb_build_object('success', false, 'code', 'CAPACITY_REACHED', 'message', 'Registration capacity for this sub-event is full.');
    END IF;

    IF v_sub_event.status_mode = 'MANUAL' AND v_sub_event.manual_status IN ('REGISTRATIONS CLOSED', 'COMPLETED') THEN
        RETURN jsonb_build_object('success', false, 'code', 'REGISTRATIONS_CLOSED', 'message', 'Registrations are currently closed for this competition');
    END IF;

    -- 7. Participation type validation
    IF v_sub_event.participation_type = 'SOLO' AND p_mode <> 'SOLO' THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'This sub-event only permits SOLO registrations');
    END IF;
    IF v_sub_event.participation_type = 'TEAM' AND p_mode <> 'TEAM' THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'This sub-event requires TEAM registration');
    END IF;

    -- 8. TEAM REGISTRATION STRUCTURE & STRICT MEMBER FIELD VALIDATION
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

        -- A. Teammate name must be non-empty (Reject NULL, "", "   ")
        IF EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1 AND length(trim(COALESCE(elem->>'snapshot_name', elem->>'name', ''))) = 0
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_TEAM_MEMBER_NAME',
                'message', 'All team members must have a valid full name.'
            );
        END IF;

        -- B. Teammate roll number must be non-empty (Reject NULL, "", "   ")
        IF EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1 AND length(trim(COALESCE(elem->>'snapshot_roll_number', elem->>'roll_number', ''))) = 0
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_TEAM_MEMBER_ROLL',
                'message', 'All team members must have a valid, non-empty roll number.'
            );
        END IF;

        -- C. Teammate department must be non-empty (Reject NULL, "", "   ")
        IF EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1 AND length(trim(COALESCE(elem->>'snapshot_department', elem->>'department', ''))) = 0
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_TEAM_MEMBER_DEPARTMENT',
                'message', 'All team members must specify a valid department or branch.'
            );
        END IF;

        -- D. Teammate college must be non-empty (Reject NULL, "", "   ")
        IF EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1 AND length(trim(COALESCE(elem->>'snapshot_college', elem->>'college', ''))) < 2
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_TEAM_MEMBER_COLLEGE',
                'message', 'All team members must specify a valid college or institution.'
            );
        END IF;

        -- E. Teammate roll number must NOT match the authoritative authenticated leader roll
        IF EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1 AND UPPER(trim(COALESCE(elem->>'snapshot_roll_number', elem->>'roll_number', ''))) = v_auth_leader_roll
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'LEADER_CANNOT_BE_TEAMMATE',
                'message', 'Teammate roll number cannot match the team leader roll number.'
            );
        END IF;

        -- F. No two teammates may share the same normalized roll number
        IF (
            SELECT COUNT(*) 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1
        ) <> (
            SELECT COUNT(DISTINCT UPPER(trim(COALESCE(elem->>'snapshot_roll_number', elem->>'roll_number', '')))) 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'DUPLICATE_TEAMMATE_ROLL',
                'message', 'Duplicate roll numbers detected among teammates. Each team member must have a unique roll number.'
            );
        END IF;
    END IF;

    -- 9. Advisory locks on roll numbers to prevent concurrent double-booking
    SELECT ARRAY(
        SELECT DISTINCT r
        FROM (
            SELECT v_auth_leader_roll AS r
            UNION
            SELECT UPPER(trim(COALESCE(m->>'snapshot_roll_number', m->>'roll_number', ''))) AS r
            FROM jsonb_array_elements(p_team_members) AS m
            WHERE COALESCE(m->>'snapshot_roll_number', m->>'roll_number') IS NOT NULL 
              AND length(trim(COALESCE(m->>'snapshot_roll_number', m->>'roll_number', ''))) > 0
        ) sub
        ORDER BY 1 ASC
    ) INTO v_sorted_rolls;

    IF v_sorted_rolls IS NOT NULL AND array_length(v_sorted_rolls, 1) > 0 THEN
        FOREACH v_roll IN ARRAY v_sorted_rolls LOOP
            v_lock_key := ('x' || substr(md5('kits_eos_sub_roll:' || p_sub_event_id::text || ':' || v_roll), 1, 16))::bit(64)::bigint;
            PERFORM pg_advisory_xact_lock(v_lock_key);
        END LOOP;
    END IF;

    -- 10. Check if leader already registered
    IF EXISTS (
        SELECT 1 FROM public.registrations
        WHERE sub_event_id = p_sub_event_id
          AND leader_id = v_leader_id
          AND status <> 'CANCELLED'::public.registration_status
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'ALREADY_REGISTERED', 'message', 'You already have an active registration for this sub-event');
    END IF;

    -- 11. Check duplicate participants across prior existing registrations
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

    -- 12. FREE vs PAID Fee and Status Resolution
    IF v_is_free THEN
        v_fee := 0;
        v_is_cod := false;
        v_initial_status := 'CONFIRMED'::public.registration_status;
    ELSE
        -- PAID sub-event
        v_fee := CASE WHEN p_mode = 'TEAM' THEN COALESCE(v_sub_event.fee_amount_team, 0) ELSE COALESCE(v_sub_event.fee_amount_solo, 0) END;
        
        -- Guard against zero/negative fee configuration on paid sub-event
        IF v_fee <= 0 THEN
            RETURN jsonb_build_object('success', false, 'code', 'PAYMENT_REQUIRED', 'message', 'Payment is required for this paid sub-event');
        END IF;

        -- Strictly validate normalized payment method for PAID events against payment_mode
        v_sub_event_payment_mode := COALESCE(v_sub_event.payment_mode, 'BOTH');

        IF v_pay_method = 'FREE' THEN
            RETURN jsonb_build_object('success', false, 'code', 'PAYMENT_REQUIRED', 'message', 'Payment is required for this paid sub-event');
        ELSIF v_sub_event_payment_mode = 'UPI_ONLY' AND v_pay_method <> 'UPI' THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_PAYMENT_METHOD', 'message', 'This sub-event only accepts online UPI payments.');
        ELSIF v_sub_event_payment_mode IN ('CASH_ONLY', 'REGISTER_ONLINE_PAY_OFFLINE') AND v_pay_method <> 'COD' THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_PAYMENT_METHOD', 'message', 'This sub-event requires payment directly to the event coordinator.');
        ELSIF v_pay_method NOT IN ('UPI', 'COD') THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_PAYMENT_METHOD', 'message', 'Invalid payment method. Allowed methods: UPI, COD');
        END IF;

        v_is_cod := (v_pay_method = 'COD');
        v_initial_status := CASE WHEN v_is_cod THEN 'PENDING_PAYMENT'::public.registration_status ELSE 'CONFIRMED'::public.registration_status END;
    END IF;

    -- 13. Atomic capacity increment
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

    -- 14. Insert registration
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

    -- 15. Insert team
    v_team_title := CASE WHEN p_mode = 'TEAM' THEN trim(p_team_name) ELSE 'Solo Participant' END;
    INSERT INTO public.teams (
        registration_id,
        team_name
    ) VALUES (
        v_reg_id,
        v_team_title
    ) RETURNING id INTO v_team_id;

    v_token_prefix := COALESCE(v_sub_event.attendance_token_prefix, v_sub_event.name, 'EVENT');

    -- 16. Insert team members with INDEPENDENT college, department, and year details
    FOR v_m IN SELECT * FROM jsonb_array_elements(p_team_members) LOOP
        v_idx := v_idx + 1;
        v_is_leader := (v_idx = 1);
        v_manual_token := public.generate_attendance_token(v_token_prefix);
        v_qr_identity := gen_random_uuid();

        IF v_is_leader THEN
            -- Authoritative leader identity enforcement: uses verified student profile
            v_member_name := COALESCE(NULLIF(trim(v_leader_profile.full_name), ''), trim(COALESCE(v_m->>'snapshot_name', v_m->>'name', 'Participant')));
            v_member_roll := v_auth_leader_roll;
            v_member_college := trim(COALESCE(NULLIF(trim(v_leader_profile.college), ''), v_m->>'snapshot_college', v_m->>'college', 'KITS Akshar Institute of Technology'));
            v_member_dept := trim(COALESCE(NULLIF(trim(v_leader_profile.department), ''), v_m->>'snapshot_department', v_m->>'department', ''));
            v_member_year := COALESCE(v_leader_profile.year_of_study, (v_m->>'snapshot_year')::integer, (v_m->>'year_of_study')::integer, 3);
        ELSE
            -- Teammate: STRICTLY independent participant record; NEVER copied from leader
            v_member_name := trim(COALESCE(v_m->>'snapshot_name', v_m->>'name', 'Participant'));
            v_member_roll := UPPER(trim(COALESCE(v_m->>'snapshot_roll_number', v_m->>'roll_number', '')));
            v_member_college := trim(COALESCE(v_m->>'snapshot_college', v_m->>'college', ''));
            IF length(v_member_college) = 0 THEN
                v_member_college := 'KITS Akshar Institute of Technology';
            END IF;
            v_member_dept := trim(COALESCE(v_m->>'snapshot_department', v_m->>'department', ''));
            v_member_year := COALESCE((v_m->>'snapshot_year')::integer, (v_m->>'year_of_study')::integer, 3);
        END IF;

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
            v_member_college,
            v_member_dept,
            v_member_year,
            v_is_leader,
            v_manual_token,
            v_qr_identity
        );

        v_created_members := v_created_members || jsonb_build_object(
            'id', v_qr_identity,
            'name', v_member_name,
            'roll_number', v_member_roll,
            'college', v_member_college,
            'department', v_member_dept,
            'year', v_member_year,
            'is_leader', v_is_leader,
            'manual_token', v_manual_token,
            'qr_identity', v_qr_identity
        );
    END LOOP;

    -- 17. Attach uploaded documents if any
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

    -- 18. Attach payments (ONLY FOR PAID SUB-EVENTS)
    IF v_is_free THEN
        v_payment_json := NULL;
    ELSE
        IF v_pay_method = 'COD' THEN
            v_pay_status := 'PENDING';
            IF v_pay_ref = '' THEN v_pay_ref := 'COD-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'); END IF;
        ELSIF v_pay_method = 'UPI' THEN
            v_pay_status := 'SUCCESS';
            IF v_pay_ref = '' THEN v_pay_ref := 'UPI-DEMO-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'); END IF;
        ELSE
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_PAYMENT_METHOD', 'message', 'Invalid payment method');
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

    -- 19. Audit log
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
            'status', v_initial_status::text,
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
        'status', v_initial_status,
        'registration_status', v_initial_status,
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
$function$;

GRANT EXECUTE ON FUNCTION public.student_register_atomic(uuid, character varying, character varying, jsonb, jsonb, character varying, character varying) TO anon, authenticated, service_role;

-- 3. Correct confirm_bulk_payments RPC to remove non-existent p.currency, r.mode, and paid_at columns
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
    v_actor_email text;
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

GRANT EXECUTE ON FUNCTION public.confirm_bulk_payments(uuid[], text) TO anon, authenticated, service_role;
