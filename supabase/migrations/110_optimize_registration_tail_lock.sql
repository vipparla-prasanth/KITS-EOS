-- Migration 110: Optimize Registration Tail Lock & Atomic Subtransaction Protection
-- Relocates public.sub_events capacity increment to transaction tail.
-- Encloses DML in a savepoint block to guarantee clean rollback if capacity is reached.

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
SET search_path = public
AS $$
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

    -- 3. Fetch sub-event record snapshot
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

        IF EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1 AND length(trim(COALESCE(elem->>'snapshot_name', elem->>'name', ''))) = 0
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_TEAM_MEMBER_NAME', 'message', 'All team members must have a valid full name.');
        END IF;

        IF EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1 AND length(trim(COALESCE(elem->>'snapshot_roll_number', elem->>'roll_number', ''))) = 0
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_TEAM_MEMBER_ROLL', 'message', 'All team members must have a valid, non-empty roll number.');
        END IF;

        IF EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1 AND length(trim(COALESCE(elem->>'snapshot_department', elem->>'department', ''))) = 0
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_TEAM_MEMBER_DEPARTMENT', 'message', 'All team members must specify a valid department or branch.');
        END IF;

        IF EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1 AND length(trim(COALESCE(elem->>'snapshot_college', elem->>'college', ''))) < 2
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_TEAM_MEMBER_COLLEGE', 'message', 'All team members must specify a valid college or institution.');
        END IF;

        IF EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1 AND UPPER(trim(COALESCE(elem->>'snapshot_roll_number', elem->>'roll_number', ''))) = v_auth_leader_roll
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'LEADER_CANNOT_BE_TEAMMATE', 'message', 'Teammate roll number cannot match the team leader roll number.');
        END IF;

        IF (
            SELECT COUNT(*) 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1
        ) <> (
            SELECT COUNT(DISTINCT UPPER(trim(COALESCE(elem->>'snapshot_roll_number', elem->>'roll_number', '')))) 
            FROM jsonb_array_elements(p_team_members) WITH ORDINALITY AS m(elem, idx)
            WHERE idx > 1
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'DUPLICATE_TEAMMATE_ROLL', 'message', 'Duplicate roll numbers detected among teammates. Each team member must have a unique roll number.');
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
        v_fee := CASE WHEN p_mode = 'TEAM' THEN COALESCE(v_sub_event.fee_amount_team, 0) ELSE COALESCE(v_sub_event.fee_amount_solo, 0) END;
        
        IF v_fee <= 0 THEN
            RETURN jsonb_build_object('success', false, 'code', 'PAYMENT_REQUIRED', 'message', 'Payment is required for this paid sub-event');
        END IF;

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

    -- ATOMIC MUTATION BLOCK (Steps 13 through 20)
    -- Enclosed in a subtransaction savepoint to guarantee atomic rollback if capacity is reached at the tail
    BEGIN
        -- 13. Insert registration
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

        -- 14. Insert team
        v_team_title := CASE WHEN p_mode = 'TEAM' THEN trim(p_team_name) ELSE 'Solo Participant' END;
        INSERT INTO public.teams (
            registration_id,
            team_name
        ) VALUES (
            v_reg_id,
            v_team_title
        ) RETURNING id INTO v_team_id;

        v_token_prefix := COALESCE(v_sub_event.attendance_token_prefix, v_sub_event.name, 'EVENT');

        -- 15. Insert team members
        FOR v_m IN SELECT * FROM jsonb_array_elements(p_team_members) LOOP
            v_idx := v_idx + 1;
            v_is_leader := (v_idx = 1);
            v_manual_token := public.generate_attendance_token(v_token_prefix);
            v_qr_identity := gen_random_uuid();

            IF v_is_leader THEN
                v_member_name := COALESCE(NULLIF(trim(v_leader_profile.full_name), ''), trim(COALESCE(v_m->>'snapshot_name', v_m->>'name', 'Participant')));
                v_member_roll := v_auth_leader_roll;
                v_member_college := trim(COALESCE(NULLIF(trim(v_leader_profile.college), ''), v_m->>'snapshot_college', v_m->>'college', 'KITS Akshar Institute of Technology'));
                v_member_dept := trim(COALESCE(NULLIF(trim(v_leader_profile.department), ''), v_m->>'snapshot_department', v_m->>'department', ''));
                v_member_year := COALESCE(v_leader_profile.year_of_study, (v_m->>'snapshot_year')::integer, (v_m->>'year_of_study')::integer, 3);
            ELSE
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

        -- 16. Attach uploaded documents if any
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

        -- 17. Attach payments (ONLY FOR PAID SUB-EVENTS)
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

        -- 18. Audit log
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

        -- 19. TAIL UPDATE: Atomic capacity increment at the very end of transaction
        -- Row-exclusive lock on sub_events is held only for this statement (~0.29ms)
        UPDATE public.sub_events
        SET registered_count = registered_count + 1
        WHERE id = p_sub_event_id
          AND status = 'ACTIVE'::public.event_status
          AND (max_capacity IS NULL OR registered_count < max_capacity);

        IF NOT FOUND THEN
            IF EXISTS (SELECT 1 FROM public.sub_events WHERE id = p_sub_event_id AND status <> 'ACTIVE'::public.event_status) THEN
                RAISE EXCEPTION 'EVENT_CLOSED' USING ERRCODE = 'P0002';
            ELSE
                RAISE EXCEPTION 'CAPACITY_REACHED' USING ERRCODE = 'P0003';
            END IF;
        END IF;

    EXCEPTION
        WHEN SQLSTATE 'P0002' THEN
            RETURN jsonb_build_object('success', false, 'code', 'EVENT_CLOSED', 'message', 'This sub-event is currently closed for registration');
        WHEN SQLSTATE 'P0003' THEN
            RETURN jsonb_build_object('success', false, 'code', 'CAPACITY_REACHED', 'message', 'Registration capacity for this sub-event is full.');
    END;

    -- 20. Return authoritative success response
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
$$;

REVOKE ALL ON FUNCTION public.student_register_atomic(uuid, varchar, varchar, jsonb, jsonb, varchar, varchar) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_register_atomic(uuid, varchar, varchar, jsonb, jsonb, varchar, varchar) TO authenticated, service_role;
