-- 034_authoritative_event_lifecycle_and_integrity.sql
-- Hardens database constraints, individual team attendance, payment idempotency, and certificate issuance logic.

-- 1. Uniqueness: ONE registration per student (leader) per sub-event (active)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_leader_sub_event 
ON public.registrations(leader_id, sub_event_id) 
WHERE status != 'CANCELLED';

-- 2. Uniqueness: ONE successful payment per registration
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_successful_payment_per_registration 
ON public.payments(registration_id) 
WHERE status = 'SUCCESS';

-- 3. Hardening Attendance: Individual Member Scan -> Individual Attendance
-- Drop old constraint that only allowed one attendance per team
ALTER TABLE public.attendance_records 
  DROP CONSTRAINT IF EXISTS attendance_records_sub_event_id_team_id_key;

-- Ensure individual member uniqueness per sub-event
ALTER TABLE public.attendance_records 
  DROP CONSTRAINT IF EXISTS attendance_records_sub_event_id_scanned_member_id_key;

ALTER TABLE public.attendance_records 
  ADD CONSTRAINT attendance_records_sub_event_id_scanned_member_id_key 
  UNIQUE (sub_event_id, scanned_member_id);

-- Create helpful index for fast team attendance aggregation
CREATE INDEX IF NOT EXISTS idx_attendance_sub_event_team 
ON public.attendance_records(sub_event_id, team_id);

-- 4. Update get_coordinator_sub_event_roster RPC to return individual attendance details
CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_roster(
    p_coordinator_id UUID,
    p_sub_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_authorized BOOLEAN := false;
    v_registrations JSONB;
    v_attendance JSONB;
    v_sub_event RECORD;
BEGIN
    -- Check if coordinator is assigned or if the caller is an admin
    IF is_admin() THEN
        v_is_authorized := true;
    ELSIF p_coordinator_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.coordinator_assignments ca
            JOIN public.coordinators c ON c.id = ca.coordinator_id
            WHERE ca.coordinator_id = p_coordinator_id 
              AND ca.sub_event_id = p_sub_event_id 
              AND c.status = 'ACTIVE'
        ) INTO v_is_authorized;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: You do not have active assignment to operate on this sub-event.'
        );
    END IF;

    -- Fetch sub-event metadata
    SELECT id, name, participation_type, results_locked, results_published
    INTO v_sub_event
    FROM public.sub_events
    WHERE id = p_sub_event_id;

    -- Fetch confirmed registrations with all team members
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'sub_event_id', r.sub_event_id,
            'status', r.status,
            'created_at', r.created_at,
            'teams', (
                SELECT jsonb_build_object(
                    'id', t.id,
                    'team_name', t.team_name,
                    'team_members', (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'id', tm.id,
                                'team_id', tm.team_id,
                                'snapshot_name', tm.snapshot_name,
                                'snapshot_roll_number', tm.snapshot_roll_number,
                                'snapshot_college', tm.snapshot_college,
                                'snapshot_department', tm.snapshot_department,
                                'snapshot_year', tm.snapshot_year,
                                'is_leader', tm.is_leader,
                                'manual_token', tm.manual_token,
                                'qr_identity', tm.qr_identity,
                                'is_attended', EXISTS (
                                    SELECT 1 FROM public.attendance_records ar
                                    WHERE ar.sub_event_id = p_sub_event_id AND ar.scanned_member_id = tm.id
                                )
                            ) ORDER BY tm.is_leader DESC, tm.snapshot_name ASC
                        )
                        FROM public.team_members tm
                        WHERE tm.team_id = t.id
                    )
                )
                FROM public.teams t
                WHERE t.registration_id = r.id
                LIMIT 1
            )
        ) ORDER BY r.created_at ASC
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    WHERE r.sub_event_id = p_sub_event_id
      AND r.status = 'CONFIRMED';

    -- Fetch attendance records with check_in_time and scanned_member_id
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ar.id,
            'team_id', ar.team_id,
            'sub_event_id', ar.sub_event_id,
            'scanned_member_id', ar.scanned_member_id,
            'check_in_time', ar.check_in_time,
            'checked_in_by', ar.checked_in_by
        )
    ), '[]'::jsonb)
    INTO v_attendance
    FROM public.attendance_records ar
    WHERE ar.sub_event_id = p_sub_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'sub_event', jsonb_build_object(
            'id', v_sub_event.id,
            'name', v_sub_event.name,
            'participation_type', v_sub_event.participation_type,
            'results_locked', v_sub_event.results_locked,
            'results_published', v_sub_event.results_published
        ),
        'registrations', v_registrations,
        'attendance_records', v_attendance
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(UUID, UUID) TO anon, authenticated;

-- 5. Hardening Result Publishing & Certificate Generation: Team Leader Podium Entitlement
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
    v_leader RECORD;
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

    -- 4. Process Winner Team Leader (Podium entitlement goes to registered Team Leader)
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
            'UNLOCKED',
            v_cert_code,
            NOW()
        )
        ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
            type = 'WINNER',
            status = 'UNLOCKED',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
            issued_at = COALESCE(public.certificates.issued_at, NOW());

        v_winner_count := 1;
        v_cert_count := v_cert_count + 1;
    END IF;

    -- 5. Process Runner-Up Team Leader
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
            'UNLOCKED',
            v_cert_code,
            NOW()
        )
        ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
            type = 'RUNNER',
            status = 'UNLOCKED',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
            issued_at = COALESCE(public.certificates.issued_at, NOW());

        v_runner_count := 1;
        v_cert_count := v_cert_count + 1;
    END IF;

    -- 6. Process Third Place Team Leader (if declared)
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

            v_third_count := 1;
            v_cert_count := v_cert_count + 1;
        END IF;
    END IF;

    -- 7. Process all registered members who attended (Participation Certificates)
    FOR v_member IN (
        SELECT tm.id, tm.snapshot_name
        FROM public.team_members tm
        JOIN public.teams t ON tm.team_id = t.id
        JOIN public.registrations r ON t.registration_id = r.id
        WHERE r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED'
          AND NOT EXISTS (
              SELECT 1 FROM public.certificates c 
              WHERE c.team_member_id = tm.id AND c.sub_event_id = p_sub_event_id AND c.type IN ('WINNER', 'RUNNER', 'THIRD_PLACE')
          )
          AND (
              EXISTS (
                  SELECT 1 FROM public.attendance_records ar 
                  WHERE ar.sub_event_id = p_sub_event_id AND (ar.scanned_member_id = tm.id OR ar.team_id = t.id)
              )
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
        v_actor_id,
        'PUBLISH_RESULTS_AND_CERTIFICATES',
        'sub_events',
        p_sub_event_id,
        jsonb_build_object(
            'sub_event_id', p_sub_event_id,
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
