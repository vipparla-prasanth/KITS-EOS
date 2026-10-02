-- ==============================================================================
-- Migration 083: Feedback Gated Participation Certificates
-- ==============================================================================
-- 1. Updates trigger_issue_participation_certificate on public.attendance_records:
--    - Attendance record insert creates PARTICIPANT certificate immediately.
--    - If feedback exists for that registration, status = 'UNLOCKED', issued_at = NOW().
--    - If feedback does not exist, status = 'LOCKED', issued_at = NULL.
--    - Fully idempotent via ON CONFLICT (team_member_id, sub_event_id, type) DO NOTHING.
-- 2. Updates submit_event_feedback_and_unlock_certificate RPC:
--    - Atomically updates status = 'UNLOCKED', issued_at = COALESCE(issued_at, NOW())
--      for all locked certificates belonging to that team and sub-event.
--    - Strictly idempotent.
-- 3. Updates unlock_student_certificate RPC:
--    - Ensures feedback completion is required before unlock.
--    - Decouples PARTICIPANT certificates from results_published requirement.
-- 4. Backfill existing PARTICIPANT certificates:
--    - Feedback completed -> UNLOCKED
--    - Feedback not completed -> LOCKED
--    - Preserves achievement certificates, certificate IDs, and codes.
-- ==============================================================================

-- 1. UPDATE ATTENDANCE TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.trigger_issue_participation_certificate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_cert_code TEXT;
    v_is_confirmed BOOLEAN := FALSE;
    v_has_feedback BOOLEAN := FALSE;
    v_status public.certificate_status := 'LOCKED';
BEGIN
    -- Fast indexed check: ensure registration is CONFIRMED
    SELECT (r.status = 'CONFIRMED') INTO v_is_confirmed
    FROM public.teams t
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE t.id = NEW.team_id;

    IF v_is_confirmed IS TRUE THEN
        -- Check if feedback was already submitted for this registration and sub-event
        SELECT EXISTS (
            SELECT 1 FROM public.feedback_responses fr
            JOIN public.teams t ON t.registration_id = fr.registration_id
            WHERE t.id = NEW.team_id AND fr.sub_event_id = NEW.sub_event_id
        ) INTO v_has_feedback;

        IF v_has_feedback IS TRUE THEN
            v_status := 'UNLOCKED';
        ELSE
            v_status := 'LOCKED';
        END IF;

        -- Lightweight idempotency check: only generate if PARTICIPANT cert does not exist
        IF NOT EXISTS (
            SELECT 1 FROM public.certificates
            WHERE team_member_id = NEW.scanned_member_id
              AND sub_event_id = NEW.sub_event_id
              AND type = 'PARTICIPANT'
        ) THEN
            LOOP
                v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
            END LOOP;

            -- Atomically insert participation certificate: GENERATED + LOCKED (or UNLOCKED if feedback already existed)
            INSERT INTO public.certificates (
                team_member_id,
                sub_event_id,
                type,
                status,
                certificate_code,
                issued_at
            ) VALUES (
                NEW.scanned_member_id,
                NEW.sub_event_id,
                'PARTICIPANT',
                v_status,
                v_cert_code,
                CASE WHEN v_status = 'UNLOCKED' THEN NOW() ELSE NULL END
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 2. UPDATE submit_event_feedback_and_unlock_certificate RPC
CREATE OR REPLACE FUNCTION public.submit_event_feedback_and_unlock_certificate(
    p_registration_id uuid,
    p_rating_1 integer,
    p_rating_2 integer,
    p_rating_3 integer,
    p_rating_4 integer,
    p_rating_5 integer,
    p_comments text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub_event_id UUID;
    v_leader_id UUID;
    v_team_id UUID;
    v_sub_event_name VARCHAR;
    v_user_id UUID;
    v_is_attended BOOLEAN := false;
    v_unlocked_count INT := 0;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Student must be authenticated to submit feedback.';
    END IF;

    SELECT r.sub_event_id, r.leader_id, t.id, se.name
    INTO v_sub_event_id, v_leader_id, v_team_id, v_sub_event_name
    FROM public.registrations r
    JOIN public.teams t ON t.registration_id = r.id
    JOIN public.sub_events se ON se.id = r.sub_event_id
    WHERE r.id = p_registration_id;

    IF v_sub_event_id IS NULL THEN
        RAISE EXCEPTION 'Registration not found.';
    END IF;

    IF v_leader_id != v_user_id THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.team_members 
            WHERE team_id = v_team_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'Unauthorized: You are not a registered participant of this event.';
        END IF;
    END IF;

    IF p_rating_1 NOT BETWEEN 1 AND 5 OR
       p_rating_2 NOT BETWEEN 1 AND 5 OR
       p_rating_3 NOT BETWEEN 1 AND 5 OR
       p_rating_4 NOT BETWEEN 1 AND 5 OR
       p_rating_5 NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'All 5 feedback ratings must be between 1 and 5 stars.';
    END IF;

    -- Upsert feedback response
    INSERT INTO public.feedback_responses (
        sub_event_id,
        registration_id,
        rating_1,
        rating_2,
        rating_3,
        rating_4,
        rating_5,
        comments
    )
    VALUES (
        v_sub_event_id,
        p_registration_id,
        p_rating_1,
        p_rating_2,
        p_rating_3,
        p_rating_4,
        p_rating_5,
        p_comments
    )
    ON CONFLICT (registration_id) DO UPDATE SET
        rating_1 = EXCLUDED.rating_1,
        rating_2 = EXCLUDED.rating_2,
        rating_3 = EXCLUDED.rating_3,
        rating_4 = EXCLUDED.rating_4,
        rating_5 = EXCLUDED.rating_5,
        comments = EXCLUDED.comments;

    -- Check attendance
    SELECT EXISTS (
        SELECT 1 FROM public.attendance_records
        WHERE sub_event_id = v_sub_event_id AND team_id = v_team_id
    ) INTO v_is_attended;

    -- Atomically UNLOCK certificates for all attended members in this team/registration
    UPDATE public.certificates
    SET status = 'UNLOCKED',
        issued_at = COALESCE(issued_at, NOW())
    WHERE sub_event_id = v_sub_event_id
      AND team_member_id IN (
          SELECT tm.id FROM public.team_members tm
          WHERE tm.team_id = v_team_id
      )
      AND status = 'LOCKED';

    GET DIAGNOSTICS v_unlocked_count = ROW_COUNT;

    -- Audit log
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_user_id,
        'STUDENT_FEEDBACK_SUBMITTED',
        'registrations',
        p_registration_id,
        jsonb_build_object(
            'sub_event_id', v_sub_event_id,
            'sub_event_name', v_sub_event_name,
            'is_attended', v_is_attended,
            'unlocked_certificates_count', v_unlocked_count
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'feedback_submitted', true,
        'is_attended', v_is_attended,
        'unlocked_certificates_count', v_unlocked_count,
        'message', 'Thank you! Your feedback has been recorded successfully and your certificate is unlocked.'
    );
END;
$$;

-- 3. UPDATE unlock_student_certificate RPC
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

    -- 2. Resolve student identity to authorized team_member in this sub-event
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

    -- 3. Check Attendance Verification
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

    -- 4. Check Feedback Completion (Authoritative Gate)
    SELECT EXISTS (
        SELECT 1 FROM public.feedback_responses
        WHERE sub_event_id = p_sub_event_id AND registration_id = v_member.registration_id
    ) INTO v_has_feedback;

    IF NOT v_has_feedback THEN
        RAISE EXCEPTION 'Feedback required: You must complete the event feedback form before unlocking your certificate.';
    END IF;

    -- 5. Check existing certificate record
    SELECT * INTO v_cert 
    FROM public.certificates
    WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id AND type = 'PARTICIPANT';

    -- 6. If certificate is already UNLOCKED, return idempotently
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

    -- 7. If certificate exists but is LOCKED, unlock it atomically
    IF v_cert.id IS NOT NULL THEN
        UPDATE public.certificates
        SET status = 'UNLOCKED',
            issued_at = COALESCE(issued_at, NOW())
        WHERE id = v_cert.id
        RETURNING * INTO v_cert;
    ELSE
        -- 8. Insert UNLOCKED participant certificate if somehow absent
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
            'PARTICIPANT',
            'UNLOCKED',
            v_cert_code,
            NOW()
        )
        RETURNING * INTO v_cert;
    END IF;

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

-- 4. BACKFILL EXISTING PARTICIPANT CERTIFICATES
-- Feedback completed -> UNLOCKED
-- Feedback not completed -> LOCKED
UPDATE public.certificates c
SET status = CASE 
    WHEN EXISTS (
        SELECT 1 FROM public.feedback_responses fr
        JOIN public.registrations r ON r.id = fr.registration_id
        JOIN public.teams t ON t.registration_id = r.id
        JOIN public.team_members tm ON tm.team_id = t.id
        WHERE tm.id = c.team_member_id AND fr.sub_event_id = c.sub_event_id
    ) THEN 'UNLOCKED'::public.certificate_status
    ELSE 'LOCKED'::public.certificate_status
END
WHERE c.type = 'PARTICIPANT';
