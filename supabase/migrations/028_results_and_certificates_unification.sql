-- 028_results_and_certificates_unification.sql

-- 1. Extend certificate_type enum to include THIRD_PLACE
ALTER TYPE certificate_type ADD VALUE IF NOT EXISTS 'THIRD_PLACE';

-- 2. Extend sub_events table with winner tracking & publish state
ALTER TABLE public.sub_events
  ADD COLUMN IF NOT EXISTS winner_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS runner_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS third_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS results_published BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS results_published_at TIMESTAMPTZ;

-- 3. Extend certificates table with unique certificate_code and issued_at
ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS certificate_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_certificates_code ON public.certificates(certificate_code) WHERE certificate_code IS NOT NULL;

-- 4. Backfill existing certificates with unique KITS-EOS-CERT-XXXXXXXXXX codes
DO $$
DECLARE
  r RECORD;
  v_code TEXT;
BEGIN
  FOR r IN (SELECT id FROM public.certificates WHERE certificate_code IS NULL) LOOP
    v_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
    UPDATE public.certificates SET certificate_code = v_code WHERE id = r.id;
  END LOOP;
END $$;

-- 5. Explicit table-level grants for authenticated and anon roles (evaluated under RLS)
GRANT SELECT, UPDATE ON public.sub_events TO authenticated;
GRANT SELECT, UPDATE ON public.events TO authenticated;
GRANT SELECT, UPDATE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_responses TO authenticated;

-- 6. RPC: lock_sub_event_podium_position (Persisting Stage Locks to survive refresh)
CREATE OR REPLACE FUNCTION public.lock_sub_event_podium_position(
    p_sub_event_id UUID,
    p_position TEXT,
    p_team_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub_event RECORD;
    v_actor_id UUID;
    v_actor_email TEXT;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (is_admin()) THEN
        RAISE EXCEPTION 'Administrative privileges required to lock podium positions.';
    END IF;

    SELECT * INTO v_sub_event FROM public.sub_events WHERE id = p_sub_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found.';
    END IF;

    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

    IF p_position = 'WINNER' THEN
        IF p_team_id IS NULL THEN
            RAISE EXCEPTION 'Winner team ID is required.';
        END IF;
        UPDATE public.sub_events
        SET winner_team_id = p_team_id
        WHERE id = p_sub_event_id;

    ELSIF p_position = 'RUNNER' THEN
        IF p_team_id IS NULL THEN
            RAISE EXCEPTION 'Runner-Up team ID is required.';
        END IF;
        IF p_team_id = v_sub_event.winner_team_id THEN
            RAISE EXCEPTION 'Runner-Up cannot be the same team as the Winner.';
        END IF;
        UPDATE public.sub_events
        SET runner_team_id = p_team_id
        WHERE id = p_sub_event_id;

    ELSIF p_position = 'THIRD_PLACE' THEN
        IF p_team_id IS NULL THEN
            RAISE EXCEPTION 'Third place team ID is required.';
        END IF;
        IF p_team_id = v_sub_event.winner_team_id OR p_team_id = v_sub_event.runner_team_id THEN
            RAISE EXCEPTION 'Third Place cannot be the same as Winner or Runner-Up.';
        END IF;
        UPDATE public.sub_events
        SET third_team_id = p_team_id
        WHERE id = p_sub_event_id;

    ELSIF p_position = 'SKIP_THIRD' THEN
        UPDATE public.sub_events
        SET third_team_id = NULL
        WHERE id = p_sub_event_id;

    ELSE
        RAISE EXCEPTION 'Invalid position: %', p_position;
    END IF;

    -- Record audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_actor_id,
        'LOCK_PODIUM_POSITION',
        'sub_events',
        p_sub_event_id,
        jsonb_build_object(
            'sub_event_id', p_sub_event_id,
            'position', p_position,
            'team_id', p_team_id,
            'locked_by', COALESCE(v_actor_email, v_actor_id::text)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'position', p_position,
        'team_id', p_team_id
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.lock_sub_event_podium_position(UUID, TEXT, UUID) TO authenticated;

-- 7. RPC: publish_sub_event_results_and_certificates (Atomic Server-Side Finalization)
CREATE OR REPLACE FUNCTION public.publish_sub_event_results_and_certificates(
    p_sub_event_id UUID,
    p_winner_team_id UUID,
    p_runner_team_id UUID,
    p_third_team_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub_event RECORD;
    v_actor_id UUID;
    v_actor_email TEXT;
    v_cert_code TEXT;
    v_member RECORD;
    v_cert_count INT := 0;
    v_winner_count INT := 0;
    v_runner_count INT := 0;
    v_third_count INT := 0;
    v_participant_count INT := 0;
BEGIN
    -- 1. Authorization check
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (is_admin()) THEN
        RAISE EXCEPTION 'Administrative privileges required to publish results and certificates.';
    END IF;

    -- 2. Sub-event check
    SELECT * INTO v_sub_event FROM public.sub_events WHERE id = p_sub_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found.';
    END IF;

    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

    -- 3. Validate podium distinctness
    IF p_winner_team_id IS NULL THEN
        RAISE EXCEPTION 'Winner team must be selected.';
    END IF;
    IF p_runner_team_id IS NULL THEN
        RAISE EXCEPTION 'Runner-Up team must be selected.';
    END IF;
    IF p_winner_team_id = p_runner_team_id THEN
        RAISE EXCEPTION 'Winner and Runner-Up cannot be the same team.';
    END IF;
    IF p_third_team_id IS NOT NULL THEN
        IF p_third_team_id = p_winner_team_id OR p_third_team_id = p_runner_team_id THEN
            RAISE EXCEPTION 'Third Place cannot be the same as Winner or Runner-Up.';
        END IF;
    END IF;

    -- 4. Process Winner Team Members
    FOR v_member IN (
        SELECT tm.id, tm.snapshot_name 
        FROM public.team_members tm 
        WHERE tm.team_id = p_winner_team_id
    ) LOOP
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
            'WINNER',
            'UNLOCKED',
            v_cert_code,
            NOW()
        )
        ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
            type = 'WINNER',
            status = 'UNLOCKED',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
            issued_at = COALESCE(public.certificates.issued_at, NOW());

        v_winner_count := v_winner_count + 1;
        v_cert_count := v_cert_count + 1;
    END LOOP;

    -- 5. Process Runner-Up Team Members
    FOR v_member IN (
        SELECT tm.id, tm.snapshot_name 
        FROM public.team_members tm 
        WHERE tm.team_id = p_runner_team_id
    ) LOOP
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
            'RUNNER',
            'UNLOCKED',
            v_cert_code,
            NOW()
        )
        ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
            type = 'RUNNER',
            status = 'UNLOCKED',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
            issued_at = COALESCE(public.certificates.issued_at, NOW());

        v_runner_count := v_runner_count + 1;
        v_cert_count := v_cert_count + 1;
    END LOOP;

    -- 6. Process Third Place (if declared)
    IF p_third_team_id IS NOT NULL THEN
        FOR v_member IN (
            SELECT tm.id, tm.snapshot_name 
            FROM public.team_members tm 
            WHERE tm.team_id = p_third_team_id
        ) LOOP
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
                'THIRD_PLACE',
                'UNLOCKED',
                v_cert_code,
                NOW()
            )
            ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
                type = 'THIRD_PLACE',
                status = 'UNLOCKED',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
                issued_at = COALESCE(public.certificates.issued_at, NOW());

            v_third_count := v_third_count + 1;
            v_cert_count := v_cert_count + 1;
        END LOOP;
    END IF;

    -- 7. Process all other registered team members who attended
    FOR v_member IN (
        SELECT tm.id, tm.snapshot_name
        FROM public.team_members tm
        JOIN public.teams t ON tm.team_id = t.id
        JOIN public.registrations r ON t.registration_id = r.id
        WHERE r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED'
          AND t.id NOT IN (p_winner_team_id, p_runner_team_id, COALESCE(p_third_team_id, '00000000-0000-0000-0000-000000000000'::UUID))
          AND EXISTS (
              SELECT 1 FROM public.attendance_records ar 
              WHERE ar.sub_event_id = p_sub_event_id AND ar.team_id = t.id
          )
    ) LOOP
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
            'UNLOCKED',
            v_cert_code,
            NOW()
        )
        ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
            type = 'PARTICIPANT',
            status = 'UNLOCKED',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
            issued_at = COALESCE(public.certificates.issued_at, NOW());

        v_participant_count := v_participant_count + 1;
        v_cert_count := v_cert_count + 1;
    END LOOP;

    -- 8. Mark Sub-Event as Results Published & Locked
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
        v_actor_id,
        'PUBLISH_RESULTS_AND_CERTIFICATES',
        'sub_events',
        p_sub_event_id,
        jsonb_build_object(
            'sub_event_id', p_sub_event_id,
            'sub_event_name', v_sub_event.name,
            'winner_team_id', p_winner_team_id,
            'runner_team_id', p_runner_team_id,
            'third_team_id', p_third_team_id,
            'winner_certs', v_winner_count,
            'runner_certs', v_runner_count,
            'third_certs', v_third_count,
            'participant_certs', v_participant_count,
            'total_certificates', v_cert_count,
            'published_by', COALESCE(v_actor_email, v_actor_id::text)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Results published and certificates generated successfully.',
        'sub_event_id', p_sub_event_id,
        'winner_certs', v_winner_count,
        'runner_certs', v_runner_count,
        'third_certs', v_third_count,
        'participant_certs', v_participant_count,
        'total_certificates', v_cert_count
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.publish_sub_event_results_and_certificates(UUID, UUID, UUID, UUID) TO authenticated;

-- 8. RPC: verify_certificate (Public Verification)
CREATE OR REPLACE FUNCTION public.verify_certificate(cert_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'is_valid', true,
    'certificate_id', c.id,
    'certificate_code', c.certificate_code,
    'type', c.type,
    'status', c.status,
    'student_name', tm.snapshot_name,
    'roll_number', tm.snapshot_roll_number,
    'college', tm.snapshot_college,
    'department', tm.snapshot_department,
    'year', tm.snapshot_year,
    'sub_event_name', se.name,
    'event_name', COALESCE(e.name, (SELECT ev.name FROM public.categories cat JOIN public.events ev ON cat.event_id = ev.id WHERE cat.id = se.category_id)),
    'issued_at', c.issued_at,
    'verified_at', NOW()
  )
  INTO v_result
  FROM public.certificates c
  JOIN public.team_members tm ON c.team_member_id = tm.id
  JOIN public.sub_events se ON c.sub_event_id = se.id
  LEFT JOIN public.events e ON se.event_id = e.id
  WHERE (
    c.certificate_code = UPPER(TRIM(cert_query)) 
    OR c.id::text = LOWER(TRIM(cert_query))
  )
  AND c.status = 'UNLOCKED';

  IF v_result IS NULL THEN
    RETURN jsonb_build_object(
      'is_valid', false,
      'message', 'Certificate not found or not yet officially unlocked.'
    );
  END IF;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.verify_certificate(TEXT) TO anon, authenticated;

-- 9. RPC: submit_event_feedback_and_unlock_certificate (Fixed Schema & Validation)
CREATE OR REPLACE FUNCTION public.submit_event_feedback_and_unlock_certificate(
    p_registration_id UUID,
    p_rating_1 INT,
    p_rating_2 INT,
    p_rating_3 INT,
    p_rating_4 INT,
    p_rating_5 INT,
    p_comments TEXT DEFAULT NULL
)
RETURNS JSONB
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
            'is_attended', v_is_attended
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'feedback_submitted', true,
        'is_attended', v_is_attended,
        'message', 'Thank you! Your feedback has been recorded successfully.'
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_event_feedback_and_unlock_certificate(UUID, INT, INT, INT, INT, INT, TEXT) TO authenticated;
