-- ============================================================================
-- Migration 133: Harmonize Assessment Live Host Telemetry Contract
-- ============================================================================
-- Objective:
--   Preserve full backward and forward compatibility for assessment live host
--   telemetry by returning both 'recent_activity' and 'recent_events' in the
--   JSON payload of public.get_assessment_live_host_snapshot.
--
-- Safety & Governance Guarantees:
--   1. Strictly read-only query enhancement; modifies no schema tables or attempt records.
--   2. Preserves existing authorization enforcement via verify_assessment_coordinator_access.
--   3. Preserves institutional data, student attempts, speed bonuses, and RLS policies.
--   4. Prepared for explicit administrator review; NOT deployed until approved.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_assessment_live_host_snapshot(
    p_assessment_id UUID,
    p_coordinator_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_asm RECORD;
    v_overview JSONB;
    v_participants JSONB;
    v_question_progress JSONB;
    v_recent_events JSONB;
    v_registered_count INT := 0;
    v_started_count INT := 0;
    v_active_count INT := 0;
    v_submitted_count INT := 0;
    v_expired_count INT := 0;
    v_terminated_count INT := 0;
    v_avg_score NUMERIC(8,2) := 0.00;
    v_high_score NUMERIC(8,2) := 0.00;
    v_tab_switch_total INT := 0;
    v_scoreboard JSONB;
    v_total_assessment_points NUMERIC(8,2) := 0.00;
BEGIN
    -- 1. Authoritative Permission Verification (Admin or assigned Coordinator)
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    -- Total points of active questions
    SELECT COALESCE(sum(points), 0.00) INTO v_total_assessment_points
    FROM public.assessment_questions
    WHERE assessment_id = p_assessment_id AND is_active_for_assessment = true;

    IF v_asm.sub_event_id IS NOT NULL THEN
        SELECT count(*) INTO v_registered_count
        FROM public.registrations
        WHERE sub_event_id = v_asm.sub_event_id AND status = 'CONFIRMED';
    ELSE
        SELECT count(DISTINCT student_id) INTO v_registered_count
        FROM public.assessment_attempts
        WHERE assessment_id = p_assessment_id;
    END IF;

    SELECT count(*) INTO v_started_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id;

    SELECT count(*) INTO v_active_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'IN_PROGRESS';

    SELECT count(*) INTO v_submitted_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'SUBMITTED';

    SELECT count(*) INTO v_expired_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'EXPIRED';

    SELECT count(*) INTO v_terminated_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'TERMINATED';

    SELECT
        COALESCE(round(avg(question_score), 2), 0.00),
        COALESCE(max(question_score), 0.00)
    INTO v_avg_score, v_high_score
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED');

    SELECT COALESCE(sum(strike_count), 0) INTO v_tab_switch_total
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id;

    -- 2. Participant Snapshots (Projecting sp.college as college_name)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'attempt_id', att.id,
            'student_id', att.student_id,
            'student_name', COALESCE(sp.full_name, 'Candidate'),
            'roll_number', sp.roll_number,
            'college_name', COALESCE(sp.college, ''),
            'status', att.status,
            'started_at', att.started_at,
            'deadline', att.deadline,
            'submitted_at', att.submitted_at,
            'strike_count', att.strike_count,
            'answered_count', (
                SELECT count(*)
                FROM public.assessment_attempt_answers ans
                WHERE ans.attempt_id = att.id
                  AND (ans.selected_option_id IS NOT NULL OR ans.selected_boolean IS NOT NULL)
            ),
            'total_questions', v_asm.total_questions_count,
            'score', CASE WHEN att.status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED') THEN att.score ELSE att.question_score END,
            'question_score', att.question_score,
            'eos_points', att.eos_points,
            'speed_bonus_score', att.eos_points,
            'revision_number', COALESCE(att.revision_number, 1),
            'percentage', CASE
                WHEN v_total_assessment_points > 0
                THEN round((att.question_score * 100.0 / v_total_assessment_points), 2)
                ELSE NULL
            END,
            'is_passed', CASE
                WHEN v_total_assessment_points > 0
                THEN ((att.question_score * 100.0 / v_total_assessment_points) >= v_asm.passing_percentage)
                ELSE false
            END,
            'rank', cert.rank
        ) ORDER BY att.started_at DESC
    ), '[]'::jsonb)
    INTO v_participants
    FROM public.assessment_attempts att
    LEFT JOIN public.student_profiles sp ON sp.user_id = att.student_id
    LEFT JOIN public.assessment_certificates cert ON cert.attempt_id = att.id
    WHERE att.assessment_id = p_assessment_id;

    -- 3. Active Question Progress
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'question_id', q.id,
            'question_text', q.question_text,
            'question_type', q.question_type,
            'sort_order', q.sort_order,
            'points', q.points,
            'time_limit_seconds', q.time_limit_seconds,
            'answered_count', (
                SELECT count(DISTINCT ans.attempt_id)
                FROM public.assessment_attempt_answers ans
                JOIN public.assessment_attempts at2 ON at2.id = ans.attempt_id
                WHERE ans.question_id = q.id
                  AND at2.assessment_id = p_assessment_id
                  AND (ans.selected_option_id IS NOT NULL OR ans.selected_boolean IS NOT NULL)
            ),
            'total_attempts', v_started_count,
            'participation_pct', CASE
                WHEN v_started_count > 0 THEN round((
                    SELECT count(DISTINCT ans.attempt_id) * 100.0 / v_started_count
                    FROM public.assessment_attempt_answers ans
                    JOIN public.assessment_attempts at2 ON at2.id = ans.attempt_id
                    WHERE ans.question_id = q.id
                      AND at2.assessment_id = p_assessment_id
                      AND (ans.selected_option_id IS NOT NULL OR ans.selected_boolean IS NOT NULL)
                ), 1)
                ELSE 0
            END
        ) ORDER BY q.sort_order ASC, q.created_at ASC
    ), '[]'::jsonb)
    INTO v_question_progress
    FROM public.assessment_questions q
    WHERE q.assessment_id = p_assessment_id AND q.is_active_for_assessment = true;

    -- 4. Recent Live Activity
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ev.id,
            'event_type', ev.event_type,
            'student_name', ev.student_name,
            'question_context', ev.question_context,
            'metadata', ev.metadata,
            'created_at', ev.created_at
        ) ORDER BY ev.created_at DESC
    ), '[]'::jsonb)
    INTO v_recent_events
    FROM (
        SELECT * FROM public.assessment_live_events
        WHERE assessment_id = p_assessment_id
        ORDER BY created_at DESC
        LIMIT 50
    ) ev;

    -- 5. Live Scoreboard (Projecting sp.college as college_name)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'student_id', att.student_id,
            'student_name', COALESCE(sp.full_name, 'Candidate'),
            'roll_number', sp.roll_number,
            'college_name', COALESCE(sp.college, ''),
            'question_score', att.question_score,
            'eos_points', att.eos_points,
            'total_score', (att.question_score + att.eos_points),
            'answered_count', (
                SELECT count(*)
                FROM public.assessment_attempt_answers ans
                WHERE ans.attempt_id = att.id
                  AND (ans.selected_option_id IS NOT NULL OR ans.selected_boolean IS NOT NULL)
            ),
            'last_active_at', att.updated_at
        ) ORDER BY (att.question_score + att.eos_points) DESC, att.total_response_time_seconds ASC, att.started_at ASC
    ), '[]'::jsonb)
    INTO v_scoreboard
    FROM (
        SELECT att.*
        FROM public.assessment_attempts att
        WHERE att.assessment_id = p_assessment_id
          AND att.status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'TERMINATED')
        ORDER BY (att.question_score + att.eos_points) DESC, att.total_response_time_seconds ASC
        LIMIT 20
    ) att
    LEFT JOIN public.student_profiles sp ON sp.user_id = att.student_id;

    RETURN jsonb_build_object(
        'assessment', jsonb_build_object(
            'id', v_asm.id,
            'title', v_asm.title,
            'status', v_asm.status,
            'duration_minutes', v_asm.duration_minutes,
            'passing_percentage', v_asm.passing_percentage,
            'total_questions_count', v_asm.total_questions_count,
            'start_time', v_asm.start_time,
            'end_time', v_asm.end_time,
            'speed_bonus_config', v_asm.speed_bonus_config,
            'current_revision_number', v_asm.current_revision_number,
            'has_draft_revision', v_asm.has_draft_revision
        ),
        'overview', jsonb_build_object(
            'registered_count', v_registered_count,
            'started_count', v_started_count,
            'active_count', v_active_count,
            'submitted_count', v_submitted_count,
            'expired_count', v_expired_count,
            'terminated_count', v_terminated_count,
            'avg_score', v_avg_score,
            'high_score', v_high_score,
            'tab_switch_total', v_tab_switch_total
        ),
        'participants', v_participants,
        'question_progress', v_question_progress,
        'recent_activity', v_recent_events,
        'recent_events', v_recent_events,
        'scoreboard', v_scoreboard
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) IS
'Authoritative live host telemetry snapshot. Returns both recent_activity and recent_events for full client compatibility.';
