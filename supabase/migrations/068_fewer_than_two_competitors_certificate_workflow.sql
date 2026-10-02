-- =============================================================================
-- Migration 068: Direct Certificate Publishing for Sub-Events with < 2 Competitors
-- =============================================================================
-- Enhances publish_sub_event_results_and_certificates to support sub-events with
-- fewer than 2 eligible competitors (0 or 1 competitor/team).
--
-- Business Rules:
-- 1. Competition Unit:
--    - SOLO sub-event: 1 competitor = 1 registered participant.
--    - TEAM sub-event: 1 competitor = 1 registered team (regardless of team member count).
-- 2. Authoritative Eligibility:
--    - Only CONFIRMED registrations with at least 1 attended check-in (attendance_records)
--      are counted as competing units eligible for certificates/results.
-- 3. Workflow Branches:
--    - If eligible competitors >= 2: requires distinct Winner & Runner-up. Issues WINNER,
--      RUNNER, optional THIRD_PLACE, and PARTICIPANT certificates.
--    - If eligible competitors < 2 (0 or 1): winner selection and result locking are NOT
--      required. All attended participants receive PARTICIPANT certificates directly.
--      Results are locked and published immediately.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.publish_sub_event_results_and_certificates(
    p_sub_event_id UUID,
    p_winner_team_id UUID DEFAULT NULL,
    p_runner_team_id UUID DEFAULT NULL,
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
    v_eligible_competitors INT := 0;
    v_is_direct_publish BOOLEAN := FALSE;
BEGIN
    -- 1. Authorization Check: Admin Only
    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can publish results and issue certificates.';
    END IF;

    -- 2. Verify sub-event exists
    SELECT * INTO v_sub_event FROM public.sub_events WHERE id = p_sub_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found: %', p_sub_event_id;
    END IF;

    -- 3. Count authoritative eligible competitors
    -- Reuses existing eligibility: CONFIRMED registration + attended check-in
    -- SOLO counts distinct attended participants; TEAM counts distinct attended teams
    IF v_sub_event.participation_type = 'SOLO' THEN
        SELECT COUNT(DISTINCT tm.id) INTO v_eligible_competitors
        FROM public.team_members tm
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id AND ar.sub_event_id = p_sub_event_id
        WHERE r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED';
    ELSE
        SELECT COUNT(DISTINCT t.id) INTO v_eligible_competitors
        FROM public.teams t
        JOIN public.registrations r ON r.id = t.registration_id
        JOIN public.attendance_records ar ON ar.team_id = t.id AND ar.sub_event_id = p_sub_event_id
        WHERE r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED';
    END IF;

    -- Determine if this qualifies for direct certificate publishing (< 2 competitors)
    IF v_eligible_competitors < 2 THEN
        v_is_direct_publish := TRUE;
    ELSE
        v_is_direct_publish := FALSE;
    END IF;

    -- 4. Normal Workflow Validation (if >= 2 competitors)
    IF NOT v_is_direct_publish THEN
        IF p_winner_team_id IS NULL OR p_runner_team_id IS NULL THEN
            RAISE EXCEPTION 'Winner and Runner-Up teams are required for sub-events with 2 or more competitors (found % eligible competitors).', v_eligible_competitors;
        END IF;

        IF p_winner_team_id = p_runner_team_id THEN
            RAISE EXCEPTION 'Winner and Runner-Up cannot be the same team.';
        END IF;

        IF p_third_team_id IS NOT NULL THEN
            IF p_third_team_id = p_winner_team_id OR p_third_team_id = p_runner_team_id THEN
                RAISE EXCEPTION 'Third Place cannot be the same as Winner or Runner-Up.';
            END IF;
        END IF;

        -- 4a. Process Winner Team
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

        -- 4b. Process Runner-Up Team
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

        -- 4c. Process Optional Third Place Team
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
    END IF;

    -- 5. Process PARTICIPANT certificates for ALL other attended participants
    -- Safe against NULL winner/runner values using robust condition matching
    FOR v_member IN
        SELECT DISTINCT tm.id, tm.snapshot_name
        FROM public.attendance_records ar
        JOIN public.team_members tm ON tm.id = ar.scanned_member_id
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE ar.sub_event_id = p_sub_event_id
          AND r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED'
          AND (p_winner_team_id IS NULL OR tm.team_id <> p_winner_team_id)
          AND (p_runner_team_id IS NULL OR tm.team_id <> p_runner_team_id)
          AND (p_third_team_id IS NULL OR tm.team_id <> p_third_team_id)
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

    -- 6. Unlock all certificates for this sub-event so students can access them
    UPDATE public.certificates
    SET status = 'UNLOCKED'
    WHERE sub_event_id = p_sub_event_id;

    -- 7. Update sub_events table with locked & published status
    IF v_is_direct_publish THEN
        UPDATE public.sub_events
        SET results_locked = TRUE,
            results_published = TRUE,
            results_published_at = NOW(),
            winner_team_id = NULL,
            runner_team_id = NULL,
            third_team_id = NULL
        WHERE id = p_sub_event_id;
    ELSE
        UPDATE public.sub_events
        SET results_locked = TRUE,
            results_published = TRUE,
            results_published_at = NOW(),
            winner_team_id = p_winner_team_id,
            runner_team_id = p_runner_team_id,
            third_team_id = p_third_team_id
        WHERE id = p_sub_event_id;
    END IF;

    -- 8. Audit Log
    INSERT INTO public.audit_logs (
        action,
        user_id,
        table_name,
        record_id,
        new_data
    ) VALUES (
        CASE WHEN v_is_direct_publish THEN 'DIRECT_PUBLISH_RESULTS' ELSE 'PUBLISH_RESULTS' END,
        auth.uid(),
        'sub_events',
        p_sub_event_id,
        jsonb_build_object(
            'is_direct_publish', v_is_direct_publish,
            'eligible_competitors', v_eligible_competitors,
            'winner_team_id', p_winner_team_id,
            'runner_team_id', p_runner_team_id,
            'third_team_id', p_third_team_id,
            'winner_count', v_winner_count,
            'runner_count', v_runner_count,
            'third_count', v_third_count,
            'participant_count', v_participant_count,
            'total_certificates', v_cert_count
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'mode', CASE WHEN v_is_direct_publish THEN 'DIRECT_PUBLISHED' ELSE 'NORMAL_PUBLISHED' END,
        'is_direct_publish', v_is_direct_publish,
        'eligible_competitors', v_eligible_competitors,
        'winner_count', v_winner_count,
        'runner_count', v_runner_count,
        'third_count', v_third_count,
        'participant_count', v_participant_count,
        'total_certificates', v_cert_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_sub_event_results_and_certificates(UUID, UUID, UUID, UUID) TO authenticated, service_role;
