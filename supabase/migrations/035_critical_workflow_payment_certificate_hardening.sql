-- Migration 035: Critical Workflow, Payment Idempotency, COD Verification, and 4-State Certificate Lifecycle Hardening

-- 1. Ensure coordinators table has optional user_id link
ALTER TABLE public.coordinators ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Secure COD Payment Confirmation RPC
-- Allows Admin (via auth.uid()) OR assigned Coordinator (via auth.uid() or p_coordinator_id)
CREATE OR REPLACE FUNCTION public.confirm_cod_payment(
    p_payment_id UUID,
    p_coordinator_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_payment RECORD;
    v_reg RECORD;
    v_actor_id UUID;
    v_actor_email TEXT;
    v_is_admin BOOLEAN := false;
    v_coord_id UUID := NULL;
    v_is_assigned BOOLEAN := false;
    v_actor_role TEXT := 'UNKNOWN';
BEGIN
    v_actor_id := auth.uid();

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

    -- If payment is already SUCCESS, return idempotently
    IF v_payment.status = 'SUCCESS' THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Payment is already marked as verified',
            'payment_id', p_payment_id,
            'amount', v_payment.amount,
            'status', 'SUCCESS'
        );
    END IF;

    -- Determine authorization
    IF v_actor_id IS NOT NULL THEN
        SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;
        
        -- Check if Admin
        SELECT EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = v_actor_id AND role = 'ADMIN' AND status = 'ACTIVE'
        ) INTO v_is_admin;
        
        IF v_is_admin THEN
            v_actor_role := 'ADMIN';
        ELSE
            -- Check if authenticated user links to a coordinator
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

    -- If not yet authorized by auth.uid(), check p_coordinator_id (e.g. from Coordinator session)
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

    IF v_actor_role = 'UNKNOWN' THEN
        RAISE EXCEPTION 'Unauthorized: Only event administrators or assigned coordinators can verify COD payments.';
    END IF;

    -- Update payment status to SUCCESS
    UPDATE public.payments
    SET status = 'SUCCESS'
    WHERE id = p_payment_id;

    -- Update registration status to CONFIRMED
    UPDATE public.registrations
    SET status = 'CONFIRMED'
    WHERE id = v_payment.registration_id;

    -- Log Audit Trail
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
            'confirmed_at', NOW()
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

GRANT EXECUTE ON FUNCTION public.confirm_cod_payment(UUID, UUID) TO anon, authenticated, service_role;

-- 3. Dedicated RPC: unlock_student_certificate
-- Implements the strict safe chain:
-- auth.uid() -> authorized registration/team_member -> exact sub-event -> attendance/result/feedback -> that person's certificate
CREATE OR REPLACE FUNCTION public.unlock_student_certificate(
    p_sub_event_id UUID,
    p_registration_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_member RECORD;
    v_sub_event RECORD;
    v_cert RECORD;
    v_is_attended BOOLEAN := false;
    v_has_feedback BOOLEAN := false;
    v_cert_code TEXT;
    v_cert_type certificate_type := 'PARTICIPANT';
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to unlock certificates.';
    END IF;

    -- 1. Fetch Sub-Event details
    SELECT * INTO v_sub_event FROM public.sub_events WHERE id = p_sub_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found.';
    END IF;

    -- 2. Check Result Publication (State 1 Guard)
    IF NOT COALESCE(v_sub_event.results_published, false) THEN
        RAISE EXCEPTION 'Results not released: Official results for this sub-event have not yet been published.';
    END IF;

    -- 3. Resolve student identity to authorized team_member in this sub-event
    SELECT tm.id, tm.team_id, tm.is_leader, tm.snapshot_name, tm.snapshot_roll_number,
           tm.snapshot_department, tm.snapshot_college, tm.snapshot_year,
           t.registration_id, t.team_name, r.leader_id, r.status AS reg_status
    INTO v_member
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE r.sub_event_id = p_sub_event_id
      AND (p_registration_id IS NULL OR r.id = p_registration_id)
      AND (
          tm.user_id = v_user_id
          OR (r.leader_id = v_user_id AND tm.is_leader = true)
      )
    ORDER BY tm.is_leader DESC, tm.id ASC
    LIMIT 1;

    IF v_member.id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: You are not a registered participant in this sub-event.';
    END IF;

    IF v_member.reg_status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Registration has been cancelled.';
    END IF;

    -- 4. Check Attendance Verification
    SELECT EXISTS (
        SELECT 1 FROM public.attendance_records
        WHERE sub_event_id = p_sub_event_id AND scanned_member_id = v_member.id
    ) INTO v_is_attended;

    IF NOT v_is_attended THEN
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_records
            WHERE sub_event_id = p_sub_event_id AND team_id = v_member.team_id
        ) INTO v_is_attended;
    END IF;

    IF NOT v_is_attended THEN
        RAISE EXCEPTION 'Attendance required: Official attendance was not recorded for your participation in this sub-event.';
    END IF;

    -- 5. Check Feedback Completion (State 2 Guard)
    SELECT EXISTS (
        SELECT 1 FROM public.feedback_responses
        WHERE sub_event_id = p_sub_event_id AND registration_id = v_member.registration_id
    ) INTO v_has_feedback;

    IF NOT v_has_feedback THEN
        RAISE EXCEPTION 'Feedback required: You must complete the event feedback form before unlocking your certificate.';
    END IF;

    -- 6. Check existing certificate record
    SELECT * INTO v_cert 
    FROM public.certificates
    WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id;

    -- 7. If certificate is already UNLOCKED, return idempotently (DO NOT regenerate code or reset timestamp)
    IF v_cert.id IS NOT NULL AND v_cert.status = 'UNLOCKED' THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Certificate already unlocked',
            'certificate', jsonb_build_object(
                'id', v_cert.id,
                'team_member_id', v_cert.team_member_id,
                'sub_event_id', v_cert.sub_event_id,
                'type', v_cert.type,
                'status', v_cert.status,
                'certificate_code', v_cert.certificate_code,
                'issued_at', v_cert.issued_at,
                'student_name', v_member.snapshot_name,
                'roll_number', v_member.snapshot_roll_number,
                'department', v_member.snapshot_department,
                'college', v_member.snapshot_college,
                'year', v_member.snapshot_year,
                'sub_event_name', v_sub_event.name
            )
        );
    END IF;

    -- 8. If certificate exists but is LOCKED, unlock it atomically
    IF v_cert.id IS NOT NULL THEN
        v_cert_code := v_cert.certificate_code;
        IF v_cert_code IS NULL THEN
            LOOP
                v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
            END LOOP;
        END IF;

        UPDATE public.certificates
        SET status = 'UNLOCKED',
            issued_at = COALESCE(issued_at, NOW()),
            certificate_code = v_cert_code
        WHERE id = v_cert.id
        RETURNING * INTO v_cert;
    ELSE
        -- 9. Determine podium entitlement if certificate row was not pre-inserted
        IF v_sub_event.winner_team_id = v_member.team_id AND v_member.is_leader THEN
            v_cert_type := 'WINNER';
        ELSIF v_sub_event.runner_team_id = v_member.team_id AND v_member.is_leader THEN
            v_cert_type := 'RUNNER';
        ELSE
            v_cert_type := 'PARTICIPANT';
        END IF;

        LOOP
            v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
            EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
        END LOOP;

        INSERT INTO public.certificates (
            team_member_id,
            sub_event_id,
            type,
            status,
            certificate_code,
            issued_at
        ) VALUES (
            v_member.id,
            p_sub_event_id,
            v_cert_type,
            'UNLOCKED',
            v_cert_code,
            NOW()
        )
        RETURNING * INTO v_cert;
    END IF;

    -- Audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_user_id,
        'UNLOCK_CERTIFICATE',
        'certificates',
        v_cert.id,
        jsonb_build_object(
            'certificate_code', v_cert.certificate_code,
            'sub_event_id', p_sub_event_id,
            'team_member_id', v_member.id,
            'type', v_cert.type,
            'unlocked_at', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Certificate unlocked successfully',
        'certificate', jsonb_build_object(
            'id', v_cert.id,
            'team_member_id', v_cert.team_member_id,
            'sub_event_id', v_cert.sub_event_id,
            'type', v_cert.type,
            'status', v_cert.status,
            'certificate_code', v_cert.certificate_code,
            'issued_at', v_cert.issued_at,
            'student_name', v_member.snapshot_name,
            'roll_number', v_member.snapshot_roll_number,
            'department', v_member.snapshot_department,
            'college', v_member.snapshot_college,
            'year', v_member.snapshot_year,
            'sub_event_name', v_sub_event.name
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlock_student_certificate(UUID, UUID) TO authenticated;

-- 4. Update publish_sub_event_results_and_certificates
-- Ensures certificates are initially created with status = 'LOCKED'
CREATE OR REPLACE FUNCTION public.publish_sub_event_results_and_certificates(
    p_sub_event_id UUID,
    p_winner_team_id UUID,
    p_runner_team_id UUID,
    p_third_team_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_sub_event RECORD;
    v_winner_team RECORD;
    v_runner_team RECORD;
    v_third_team RECORD;
    v_leader RECORD;
    v_member RECORD;
    v_cert_code TEXT;
    v_cert_count INT := 0;
    v_winner_count INT := 0;
    v_runner_count INT := 0;
    v_third_count INT := 0;
    v_participant_count INT := 0;
BEGIN
    -- 1. Authorization Check
    IF NOT (is_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can publish results and issue certificates.';
    END IF;

    -- 2. Verify sub-event
    SELECT * INTO v_sub_event FROM public.sub_events WHERE id = p_sub_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found.';
    END IF;

    -- 3. Verify Winner & Runner-up are distinct
    IF p_winner_team_id = p_runner_team_id THEN
        RAISE EXCEPTION 'Winner and Runner-Up cannot be the same team.';
    END IF;
    IF p_third_team_id IS NOT NULL THEN
        IF p_third_team_id = p_winner_team_id OR p_third_team_id = p_runner_team_id THEN
            RAISE EXCEPTION 'Third Place cannot be the same as Winner or Runner-Up.';
        END IF;
    END IF;

    -- 4. Process Winner Team Leader (Podium entitlement: Team Leader receives WINNER cert initially LOCKED)
    SELECT tm.id, tm.snapshot_name INTO v_leader
    FROM public.team_members tm
    WHERE tm.team_id = p_winner_team_id
    ORDER BY tm.is_leader DESC, tm.id ASC
    LIMIT 1;

    IF v_leader.id IS NOT NULL THEN
        SELECT certificate_code INTO v_cert_code FROM public.certificates WHERE team_member_id = v_leader.id AND sub_event_id = p_sub_event_id;
        IF v_cert_code IS NULL THEN
            LOOP
                v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
            END LOOP;
        END IF;

        INSERT INTO public.certificates (
            team_member_id,
            sub_event_id,
            type,
            status,
            certificate_code,
            issued_at
        ) VALUES (
            v_leader.id,
            p_sub_event_id,
            'WINNER',
            'LOCKED',
            v_cert_code,
            NULL
        )
        ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
            type = 'WINNER',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

        v_winner_count := 1;
        v_cert_count := v_cert_count + 1;
    END IF;

    -- 5. Process Runner-Up Team Leader (RUNNER cert initially LOCKED)
    SELECT tm.id, tm.snapshot_name INTO v_leader
    FROM public.team_members tm
    WHERE tm.team_id = p_runner_team_id
    ORDER BY tm.is_leader DESC, tm.id ASC
    LIMIT 1;

    IF v_leader.id IS NOT NULL THEN
        SELECT certificate_code INTO v_cert_code FROM public.certificates WHERE team_member_id = v_leader.id AND sub_event_id = p_sub_event_id;
        IF v_cert_code IS NULL THEN
            LOOP
                v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
            END LOOP;
        END IF;

        INSERT INTO public.certificates (
            team_member_id,
            sub_event_id,
            type,
            status,
            certificate_code,
            issued_at
        ) VALUES (
            v_leader.id,
            p_sub_event_id,
            'RUNNER',
            'LOCKED',
            v_cert_code,
            NULL
        )
        ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
            type = 'RUNNER',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

        v_runner_count := 1;
        v_cert_count := v_cert_count + 1;
    END IF;

    -- 6. Process Optional Third Place Team Leader
    IF p_third_team_id IS NOT NULL THEN
        SELECT tm.id, tm.snapshot_name INTO v_leader
        FROM public.team_members tm
        WHERE tm.team_id = p_third_team_id
        ORDER BY tm.is_leader DESC, tm.id ASC
        LIMIT 1;

        IF v_leader.id IS NOT NULL THEN
            SELECT certificate_code INTO v_cert_code FROM public.certificates WHERE team_member_id = v_leader.id AND sub_event_id = p_sub_event_id;
            IF v_cert_code IS NULL THEN
                LOOP
                    v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
                END LOOP;
            END IF;

            INSERT INTO public.certificates (
                team_member_id,
                sub_event_id,
                type,
                status,
                certificate_code,
                issued_at
            ) VALUES (
                v_leader.id,
                p_sub_event_id,
                'PARTICIPANT',
                'LOCKED',
                v_cert_code,
                NULL
            )
            ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
                type = 'PARTICIPANT',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

            v_third_count := 1;
            v_cert_count := v_cert_count + 1;
        END IF;
    END IF;

    -- 7. Process all other ATTENDED participants (PARTICIPANT cert initially LOCKED)
    FOR v_member IN
        SELECT tm.id, tm.snapshot_name, tm.team_id
        FROM public.attendance_records ar
        JOIN public.team_members tm ON (tm.id = ar.scanned_member_id OR tm.team_id = ar.team_id)
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE ar.sub_event_id = p_sub_event_id
          AND r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED'
          AND NOT (tm.team_id = p_winner_team_id AND tm.is_leader = true)
          AND NOT (tm.team_id = p_runner_team_id AND tm.is_leader = true)
          AND NOT (p_third_team_id IS NOT NULL AND tm.team_id = p_third_team_id AND tm.is_leader = true)
        GROUP BY tm.id, tm.snapshot_name, tm.team_id
    LOOP
        SELECT certificate_code INTO v_cert_code FROM public.certificates WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id;
        IF v_cert_code IS NULL THEN
            LOOP
                v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
            END LOOP;
        END IF;

        INSERT INTO public.certificates (
            team_member_id,
            sub_event_id,
            type,
            status,
            certificate_code,
            issued_at
        ) VALUES (
            v_member.id,
            p_sub_event_id,
            'PARTICIPANT',
            'LOCKED',
            v_cert_code,
            NULL
        )
        ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
            type = 'PARTICIPANT',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

        v_participant_count := v_participant_count + 1;
        v_cert_count := v_cert_count + 1;
    END LOOP;

    -- 8. Atomically update sub-event state
    UPDATE public.sub_events
    SET winner_team_id = p_winner_team_id,
        runner_team_id = p_runner_team_id,
        third_team_id = p_third_team_id,
        results_locked = true,
        results_published = true,
        results_published_at = NOW()
    WHERE id = p_sub_event_id;

    -- 9. Insert Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        auth.uid(),
        'PUBLISH_RESULTS_AND_CERTIFICATES',
        'sub_events',
        p_sub_event_id,
        jsonb_build_object(
            'winner_team_id', p_winner_team_id,
            'runner_team_id', p_runner_team_id,
            'third_team_id', p_third_team_id,
            'total_certificates_created', v_cert_count,
            'winner_certificates', v_winner_count,
            'runner_certificates', v_runner_count,
            'third_certificates', v_third_count,
            'participant_certificates', v_participant_count,
            'initial_status', 'LOCKED',
            'published_at', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Results published successfully. Certificates initialized in LOCKED state pending feedback.',
        'sub_event_id', p_sub_event_id,
        'total_certificates_created', v_cert_count,
        'winner_certificates', v_winner_count,
        'runner_certificates', v_runner_count,
        'third_certificates', v_third_count,
        'participant_certificates', v_participant_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_sub_event_results_and_certificates(UUID, UUID, UUID, UUID) TO authenticated;

-- 5. Helper RPC to get registration documents with secure coordinator authorization check
CREATE OR REPLACE FUNCTION public.get_sub_event_documents_for_coordinator(
    p_coordinator_id UUID,
    p_sub_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_is_assigned BOOLEAN;
    v_docs JSONB;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments
        WHERE coordinator_id = p_coordinator_id AND sub_event_id = p_sub_event_id
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RAISE EXCEPTION 'Unauthorized: Coordinator is not assigned to this sub-event.';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', d.id,
            'entity_id', d.entity_id,
            'file_name', d.file_name,
            'mime_type', d.mime_type,
            'size_bytes', d.size_bytes,
            'uploaded_at', d.uploaded_at,
            'storage_path', d.storage_path
        ) ORDER BY d.uploaded_at DESC
    ), '[]'::jsonb)
    INTO v_docs
    FROM public.documents d
    JOIN public.registrations r ON r.id = d.entity_id
    WHERE r.sub_event_id = p_sub_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'documents', v_docs
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sub_event_documents_for_coordinator(UUID, UUID) TO anon, authenticated;
