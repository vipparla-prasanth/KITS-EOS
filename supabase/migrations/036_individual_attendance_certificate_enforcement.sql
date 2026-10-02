-- Migration 036: Individual Attendance Certificate Eligibility Enforcement
-- Universal Server-Side Rule:
-- INDIVIDUAL CERTIFICATE ELIGIBILITY = INDIVIDUAL ATTENDANCE + RESULT/PARTICIPATION ELIGIBILITY
-- An individual whose authoritative attendance status is NOT ATTENDED must NEVER receive a certificate of any type.
-- Team podium identity remains: TEAM is the podium candidate, while certificates are generated per-attended member.

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
    v_member RECORD;
    v_cert_code TEXT;
    v_cert_count INT := 0;
    v_winner_count INT := 0;
    v_runner_count INT := 0;
    v_third_count INT := 0;
    v_participant_count INT := 0;
BEGIN
    -- 1. Authorization Check: Admin Only
    IF NOT (is_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can publish results and issue certificates.';
    END IF;

    -- 2. Verify sub-event exists
    SELECT * INTO v_sub_event FROM public.sub_events WHERE id = p_sub_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found: %', p_sub_event_id;
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

    -- 4. Process Winner Team: ONLY members who actually ATTENDED get WINNER certificate
    FOR v_member IN
        SELECT tm.id, tm.snapshot_name
        FROM public.team_members tm
        JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
        WHERE tm.team_id = p_winner_team_id
          AND ar.sub_event_id = p_sub_event_id
    LOOP
        SELECT certificate_code INTO v_cert_code 
        FROM public.certificates 
        WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id;

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
            'LOCKED',
            v_cert_code,
            NOW()
        )
        ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
            type = 'WINNER',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

        v_winner_count := v_winner_count + 1;
        v_cert_count := v_cert_count + 1;
    END LOOP;

    -- 5. Process Runner-Up Team: ONLY members who actually ATTENDED get RUNNER certificate
    FOR v_member IN
        SELECT tm.id, tm.snapshot_name
        FROM public.team_members tm
        JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
        WHERE tm.team_id = p_runner_team_id
          AND ar.sub_event_id = p_sub_event_id
    LOOP
        SELECT certificate_code INTO v_cert_code 
        FROM public.certificates 
        WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id;

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
            'LOCKED',
            v_cert_code,
            NOW()
        )
        ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
            type = 'RUNNER',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

        v_runner_count := v_runner_count + 1;
        v_cert_count := v_cert_count + 1;
    END LOOP;

    -- 6. Process Optional Third Place Team: ONLY members who actually ATTENDED get THIRD_PLACE certificate
    IF p_third_team_id IS NOT NULL THEN
        FOR v_member IN
            SELECT tm.id, tm.snapshot_name
            FROM public.team_members tm
            JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
            WHERE tm.team_id = p_third_team_id
              AND ar.sub_event_id = p_sub_event_id
        LOOP
            SELECT certificate_code INTO v_cert_code 
            FROM public.certificates 
            WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id;

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
                'LOCKED',
                v_cert_code,
                NOW()
            )
            ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
                type = 'THIRD_PLACE',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

            v_third_count := v_third_count + 1;
            v_cert_count := v_cert_count + 1;
        END LOOP;
    END IF;

    -- 7. Process ALL other ATTENDED participants (PARTICIPANT certificate, initially LOCKED)
    -- STRICT RULE: ONLY scanned members in attendance_records who are NOT in podium teams
    FOR v_member IN
        SELECT DISTINCT tm.id, tm.snapshot_name
        FROM public.attendance_records ar
        JOIN public.team_members tm ON tm.id = ar.scanned_member_id
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE ar.sub_event_id = p_sub_event_id
          AND r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED'
          AND tm.team_id NOT IN (
              p_winner_team_id, 
              p_runner_team_id, 
              COALESCE(p_third_team_id, '00000000-0000-0000-0000-000000000000'::UUID)
          )
    LOOP
        SELECT certificate_code INTO v_cert_code 
        FROM public.certificates 
        WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id;

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
            NOW()
        )
        ON CONFLICT (team_member_id, sub_event_id) DO UPDATE SET
            type = 'PARTICIPANT',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

        v_participant_count := v_participant_count + 1;
        v_cert_count := v_cert_count + 1;
    END LOOP;

    -- 8. Atomically update sub_event results publication state
    UPDATE public.sub_events
    SET winner_team_id = p_winner_team_id,
        runner_team_id = p_runner_team_id,
        third_team_id = p_third_team_id,
        results_locked = true,
        results_published = true,
        results_published_at = NOW(),
        updated_at = NOW()
    WHERE id = p_sub_event_id;

    -- 9. Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        auth.uid(),
        'RESULTS_PUBLISHED_AND_CERTIFICATES_GENERATED',
        'sub_events',
        p_sub_event_id,
        jsonb_build_object(
            'sub_event_id', p_sub_event_id,
            'winner_team_id', p_winner_team_id,
            'runner_team_id', p_runner_team_id,
            'third_team_id', p_third_team_id,
            'total_certificates', v_cert_count,
            'winner_certificates', v_winner_count,
            'runner_certificates', v_runner_count,
            'third_certificates', v_third_count,
            'participant_certificates', v_participant_count,
            'enforcement', 'STRICT_INDIVIDUAL_ATTENDANCE'
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'total_certificates', v_cert_count,
        'winner_certificates', v_winner_count,
        'runner_certificates', v_runner_count,
        'third_certificates', v_third_count,
        'participant_certificates', v_participant_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_sub_event_results_and_certificates(UUID, UUID, UUID, UUID) TO authenticated;
