-- ==============================================================================
-- Migration 097: Comprehensive Coordinator Result & Certificate View
-- ==============================================================================
-- Enhances public.get_coordinator_sub_event_result_status RPC to provide:
--   1. Full podium cards (Winner, Runner-Up, Third Place) with team & leader info,
--      complete member arrays with individual snapshots and certificate statuses.
--   2. Complete eligible attended participant roster (e.g., all 44 candidates)
--      sorted by authoritative podium rank then name.
--   3. Individual member snapshots (name, college, department, year, roll_number)
--      strictly preserving inter-college team members without overwriting with leader's college.
--   4. Dual certificate tracking:
--      - Achievement Certificate: 'WINNER — ISSUED', 'RUNNER-UP — ISSUED', 'THIRD PLACE — ISSUED', 'NOT APPLICABLE'
--      - Participation Certificate: 'UNLOCKED', 'LOCKED' (feedback-gated)
--   5. Summary statistics counters (eligible candidates/members, winners, runners, third, achievement certs, participation certs).
--   6. Audit metadata (result_edit_count, result_edited_at, published_at).
--   7. Strictly read-only for assigned coordinators.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_result_status(
    p_token TEXT,
    p_sub_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN := FALSE;
    v_sub_event RECORD;
    v_submission RECORD;
    v_winner_name TEXT;
    v_runner_name TEXT;
    v_third_name TEXT;
    v_eligible_count INT := 0;
    v_eligible_participants JSONB := '[]'::jsonb;
    v_winner_card JSONB := NULL;
    v_runner_card JSONB := NULL;
    v_third_card JSONB := NULL;
    v_summary_counts JSONB := '{}'::jsonb;
BEGIN
    -- 1. Authenticate coordinator via session token
    v_coord_id := public.get_coordinator_id_by_token(p_token);
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required: Invalid or expired session token.';
    END IF;

    -- 2. Strict server-side verification: Coordinator must be assigned to this sub-event
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.sub_events se ON se.id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord_id
          AND ca.sub_event_id = p_sub_event_id
          AND se.status <> 'PERMANENTLY_DELETED'
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RAISE EXCEPTION 'Unauthorized: You are not assigned as a coordinator for this sub-event.';
    END IF;

    -- 3. Verify sub-event exists and is active
    SELECT * INTO v_sub_event 
    FROM public.sub_events 
    WHERE id = p_sub_event_id AND status <> 'PERMANENTLY_DELETED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found or deleted.';
    END IF;

    -- 4. Count eligible attended competitors (teams / solo candidates with at least 1 check-in)
    SELECT COUNT(DISTINCT ar.team_id) INTO v_eligible_count
    FROM public.attendance_records ar
    JOIN public.teams t ON t.id = ar.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE ar.sub_event_id = p_sub_event_id
      AND r.sub_event_id = p_sub_event_id
      AND r.status = 'CONFIRMED';

    -- 5. Build Comprehensive Eligible Participants and Roster with Dual Certificates
    WITH attended_teams AS (
        SELECT DISTINCT ar.team_id, t.registration_id, t.team_name, r.leader_id, r.created_at AS reg_created_at
        FROM public.attendance_records ar
        JOIN public.teams t ON t.id = ar.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE ar.sub_event_id = p_sub_event_id
          AND r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED'
    ),
    team_certs AS (
        SELECT c.team_member_id, c.type::text AS cert_type, c.status::text AS cert_status, c.certificate_code
        FROM public.certificates c
        WHERE c.sub_event_id = p_sub_event_id
    ),
    team_member_details AS (
        SELECT 
            tm.team_id,
            tm.id AS member_id,
            tm.user_id,
            tm.snapshot_name,
            tm.snapshot_roll_number,
            tm.snapshot_college,
            tm.snapshot_department,
            tm.snapshot_year,
            tm.is_leader,
            CASE WHEN ar.id IS NOT NULL THEN 'PRESENT' ELSE 'ABSENT' END AS attendance_status,
            ar.check_in_time,
            ach_c.cert_type AS ach_type,
            ach_c.cert_status AS ach_status,
            ach_c.certificate_code AS ach_code,
            part_c.cert_status AS part_status,
            part_c.certificate_code AS part_code
        FROM public.team_members tm
        JOIN attended_teams at ON at.team_id = tm.team_id
        LEFT JOIN public.attendance_records ar 
            ON ar.scanned_member_id = tm.id AND ar.sub_event_id = p_sub_event_id
        LEFT JOIN team_certs ach_c 
            ON ach_c.team_member_id = tm.id AND ach_c.cert_type IN ('WINNER', 'RUNNER', 'THIRD_PLACE')
        LEFT JOIN team_certs part_c 
            ON part_c.team_member_id = tm.id AND part_c.cert_type = 'PARTICIPANT'
    ),
    aggregated_teams AS (
        SELECT 
            at.team_id,
            at.team_name,
            at.registration_id,
            at.leader_id,
            at.reg_created_at,
            (v_sub_event.participation_type = 'TEAM' OR COUNT(tmd.member_id) > 1) AS is_team,
            CASE 
                WHEN at.team_id = v_sub_event.winner_team_id THEN 'WINNER'
                WHEN at.team_id = v_sub_event.runner_team_id THEN 'RUNNER_UP'
                WHEN at.team_id = v_sub_event.third_team_id THEN 'THIRD_PLACE'
                ELSE 'PARTICIPANT'
            END AS result_rank,
            CASE 
                WHEN at.team_id = v_sub_event.winner_team_id THEN 'WINNER'
                WHEN at.team_id = v_sub_event.runner_team_id THEN 'RUNNER-UP'
                WHEN at.team_id = v_sub_event.third_team_id THEN 'THIRD PLACE'
                ELSE 'PARTICIPANT'
            END AS result_rank_display,
            CASE 
                WHEN at.team_id = v_sub_event.winner_team_id THEN 1
                WHEN at.team_id = v_sub_event.runner_team_id THEN 2
                WHEN at.team_id = v_sub_event.third_team_id THEN 3
                ELSE 4
            END AS rank_order,
            COUNT(tmd.member_id) AS total_members,
            COUNT(tmd.member_id) FILTER (WHERE tmd.attendance_status = 'PRESENT') AS attended_members,
            COUNT(tmd.member_id) FILTER (WHERE tmd.ach_status = 'UNLOCKED') AS achievement_certs_count,
            COUNT(tmd.member_id) FILTER (WHERE tmd.part_status = 'UNLOCKED') AS participation_unlocked_count,
            COUNT(tmd.member_id) FILTER (WHERE tmd.part_status = 'LOCKED') AS participation_locked_count,
            COALESCE(
                jsonb_agg(DISTINCT tmd.snapshot_college) FILTER (WHERE tmd.snapshot_college IS NOT NULL),
                '[]'::jsonb
            ) AS colleges,
            COALESCE(
                jsonb_agg(DISTINCT tmd.snapshot_department) FILTER (WHERE tmd.snapshot_department IS NOT NULL),
                '[]'::jsonb
            ) AS departments,
            -- Leader Details
            COALESCE(
                (SELECT tmd_lead.snapshot_name FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id AND tmd_lead.is_leader = true LIMIT 1),
                (SELECT tmd_lead.snapshot_name FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id LIMIT 1),
                'Participant'
            ) AS leader_name,
            (SELECT tmd_lead.snapshot_roll_number FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id AND tmd_lead.is_leader = true LIMIT 1) AS leader_roll_number,
            (SELECT tmd_lead.snapshot_college FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id AND tmd_lead.is_leader = true LIMIT 1) AS leader_college,
            (SELECT tmd_lead.snapshot_department FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id AND tmd_lead.is_leader = true LIMIT 1) AS leader_department,
            (SELECT tmd_lead.snapshot_year FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id AND tmd_lead.is_leader = true LIMIT 1) AS leader_year,
            -- Full Member Snapshots with individual colleges, departments, rolls, attendance & certs
            jsonb_agg(
                jsonb_build_object(
                    'id', tmd.member_id,
                    'user_id', tmd.user_id,
                    'name', tmd.snapshot_name,
                    'roll_number', tmd.snapshot_roll_number,
                    'college', tmd.snapshot_college,
                    'department', tmd.snapshot_department,
                    'year', tmd.snapshot_year,
                    'is_leader', tmd.is_leader,
                    'attendance_status', tmd.attendance_status,
                    'check_in_time', tmd.check_in_time,
                    'achievement_status', CASE 
                        WHEN tmd.ach_status = 'UNLOCKED' THEN 'ISSUED'
                        WHEN tmd.ach_status = 'REVOKED' THEN 'REVOKED'
                        ELSE 'NOT_APPLICABLE'
                    END,
                    'achievement_type', tmd.ach_type,
                    'achievement_code', tmd.ach_code,
                    'achievement_display', CASE
                        WHEN tmd.ach_status = 'UNLOCKED' AND tmd.ach_type = 'WINNER' THEN 'WINNER — ISSUED'
                        WHEN tmd.ach_status = 'UNLOCKED' AND tmd.ach_type = 'RUNNER' THEN 'RUNNER-UP — ISSUED'
                        WHEN tmd.ach_status = 'UNLOCKED' AND tmd.ach_type = 'THIRD_PLACE' THEN 'THIRD PLACE — ISSUED'
                        WHEN tmd.ach_status = 'REVOKED' THEN 'REVOKED'
                        ELSE 'NOT APPLICABLE'
                    END,
                    'participation_status', COALESCE(tmd.part_status, 'NOT_GENERATED'),
                    'participation_code', tmd.part_code,
                    'participation_display', CASE
                        WHEN tmd.part_status = 'UNLOCKED' THEN 'UNLOCKED'
                        WHEN tmd.part_status = 'LOCKED' THEN 'LOCKED'
                        ELSE 'PENDING'
                    END
                ) ORDER BY tmd.is_leader DESC, tmd.snapshot_name ASC
            ) AS members
        FROM attended_teams at
        JOIN team_member_details tmd ON tmd.team_id = at.team_id
        GROUP BY at.team_id, at.team_name, at.registration_id, at.leader_id, at.reg_created_at
    ),
    formatted_teams AS (
        SELECT 
            agt.team_id,
            agt.registration_id,
            agt.team_name,
            agt.is_team,
            CASE 
                WHEN agt.is_team THEN COALESCE(NULLIF(agt.team_name, 'Solo Participant'), 'Team ' || SUBSTRING(agt.team_id::text, 1, 6))
                ELSE agt.leader_name
            END AS display_name,
            agt.result_rank,
            agt.result_rank_display,
            agt.rank_order,
            agt.total_members,
            agt.attended_members,
            agt.achievement_certs_count,
            agt.participation_unlocked_count,
            agt.participation_locked_count,
            agt.colleges,
            agt.departments,
            jsonb_build_object(
                'name', agt.leader_name,
                'roll_number', agt.leader_roll_number,
                'college', agt.leader_college,
                'department', agt.leader_department,
                'year', agt.leader_year
            ) AS leader,
            agt.members
        FROM aggregated_teams agt
    )
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'team_id', ft.team_id,
                'registration_id', ft.registration_id,
                'team_name', ft.team_name,
                'display_name', ft.display_name,
                'is_team', ft.is_team,
                'result_rank', ft.result_rank,
                'result_rank_display', ft.result_rank_display,
                'rank_order', ft.rank_order,
                'total_members', ft.total_members,
                'attended_members', ft.attended_members,
                'achievement_certs_count', ft.achievement_certs_count,
                'participation_unlocked_count', ft.participation_unlocked_count,
                'participation_locked_count', ft.participation_locked_count,
                'colleges', ft.colleges,
                'departments', ft.departments,
                'leader', ft.leader,
                'members', ft.members
            ) ORDER BY ft.rank_order ASC, ft.display_name ASC
        ), '[]'::jsonb),
        jsonb_build_object(
            'total_eligible_candidates', COUNT(*),
            'total_eligible_members', COALESCE(SUM(ft.attended_members), 0),
            'winners_count', COUNT(*) FILTER (WHERE ft.result_rank = 'WINNER'),
            'runners_count', COUNT(*) FILTER (WHERE ft.result_rank = 'RUNNER_UP'),
            'third_count', COUNT(*) FILTER (WHERE ft.result_rank = 'THIRD_PLACE'),
            'achievement_certs_count', COALESCE(SUM(ft.achievement_certs_count), 0),
            'participation_unlocked_count', COALESCE(SUM(ft.participation_unlocked_count), 0),
            'participation_locked_count', COALESCE(SUM(ft.participation_locked_count), 0)
        )
    INTO 
        v_eligible_participants,
        v_summary_counts
    FROM formatted_teams ft;

    -- Extract podium cards directly from aggregated participants
    IF v_sub_event.winner_team_id IS NOT NULL THEN
        SELECT elem INTO v_winner_card
        FROM jsonb_array_elements(v_eligible_participants) elem
        WHERE (elem->>'team_id')::uuid = v_sub_event.winner_team_id
        LIMIT 1;
    END IF;

    IF v_sub_event.runner_team_id IS NOT NULL THEN
        SELECT elem INTO v_runner_card
        FROM jsonb_array_elements(v_eligible_participants) elem
        WHERE (elem->>'team_id')::uuid = v_sub_event.runner_team_id
        LIMIT 1;
    END IF;

    IF v_sub_event.third_team_id IS NOT NULL THEN
        SELECT elem INTO v_third_card
        FROM jsonb_array_elements(v_eligible_participants) elem
        WHERE (elem->>'team_id')::uuid = v_sub_event.third_team_id
        LIMIT 1;
    END IF;

    -- 6. If results are published, return comprehensive APPROVED / PUBLISHED status
    IF v_sub_event.results_published IS TRUE THEN
        -- Resolve winner display name
        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_winner_name
        FROM public.teams t WHERE t.id = v_sub_event.winner_team_id;

        -- Resolve runner display name
        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_runner_name
        FROM public.teams t WHERE t.id = v_sub_event.runner_team_id;

        -- Resolve third display name
        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_third_name
        FROM public.teams t WHERE t.id = v_sub_event.third_team_id;

        RETURN jsonb_build_object(
            'success', true,
            'sub_event_id', p_sub_event_id,
            'sub_event_name', v_sub_event.name,
            'status', 'APPROVED',
            'results_published', true,
            'results_locked', true,
            'published_at', v_sub_event.results_published_at,
            'result_edit_count', COALESCE(v_sub_event.result_edit_count, 0),
            'result_edited_at', v_sub_event.result_edited_at,
            'winner_team_id', v_sub_event.winner_team_id,
            'winner_name', v_winner_name,
            'runner_team_id', v_sub_event.runner_team_id,
            'runner_name', v_runner_name,
            'third_team_id', v_sub_event.third_team_id,
            'third_name', v_third_name,
            'eligible_count', v_eligible_count,
            'podium', jsonb_build_object(
                'winner', v_winner_card,
                'runner', v_runner_card,
                'third', v_third_card
            ),
            'eligible_participants', v_eligible_participants,
            'summary_counts', COALESCE(v_summary_counts, '{}'::jsonb)
        );
    END IF;

    -- 7. Fetch latest submission for this sub-event if not published yet
    SELECT * INTO v_submission
    FROM public.result_submissions
    WHERE sub_event_id = p_sub_event_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_winner_name
        FROM public.teams t WHERE t.id = v_submission.winner_team_id;

        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_runner_name
        FROM public.teams t WHERE t.id = v_submission.runner_team_id;

        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_third_name
        FROM public.teams t WHERE t.id = v_submission.third_team_id;

        RETURN jsonb_build_object(
            'success', true,
            'sub_event_id', p_sub_event_id,
            'sub_event_name', v_sub_event.name,
            'status', v_submission.status,
            'submission_id', v_submission.id,
            'submitted_at', v_submission.submitted_at,
            'reviewed_at', v_submission.reviewed_at,
            'rejection_reason', v_submission.rejection_reason,
            'winner_team_id', v_submission.winner_team_id,
            'winner_name', v_winner_name,
            'runner_team_id', v_submission.runner_team_id,
            'runner_name', v_runner_name,
            'third_team_id', v_submission.third_team_id,
            'third_name', v_third_name,
            'eligible_count', v_eligible_count,
            'eligible_participants', v_eligible_participants,
            'summary_counts', COALESCE(v_summary_counts, '{}'::jsonb)
        );
    END IF;

    -- 8. Default: NOT_SUBMITTED
    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'sub_event_name', v_sub_event.name,
        'status', 'NOT_SUBMITTED',
        'eligible_count', v_eligible_count,
        'eligible_participants', v_eligible_participants,
        'summary_counts', COALESCE(v_summary_counts, '{}'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_result_status(TEXT, UUID) TO anon, authenticated, service_role;
