-- ==============================================================================
-- Migration 132 ROLLBACK SNAPSHOT: Exact Deployed State Prior to Migration 132
-- Project: jngmmjbmimxpndpoloib (KITS-AKSHAR-EOS)
-- Snapshot Timestamp: 2026-10-18T19:56:00+05:30
-- ==============================================================================

-- 1. ROLLBACK public.student_autosave_answer to Migration 127 definition
CREATE OR REPLACE FUNCTION public.student_autosave_answer(
    p_attempt_id uuid,
    p_question_id uuid,
    p_selected_option_id uuid DEFAULT NULL::uuid,
    p_selected_boolean boolean DEFAULT NULL::boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_attempt RECORD;
    v_asm RECORD;
    v_q RECORD;
    v_key RECORD;
    v_existing RECORD;
    v_student_name TEXT := 'Candidate';
    v_now TIMESTAMPTZ := clock_timestamp();
    v_started_at TIMESTAMPTZ;
    v_answered_at TIMESTAMPTZ;
    v_response_time_seconds NUMERIC(8,2);
    v_is_correct BOOLEAN := false;
    v_points_awarded NUMERIC(8,2) := 0.00;
    v_eos_points NUMERIC(8,2) := 0.00;
    v_total_q_score NUMERIC(8,2) := 0.00;
    v_total_eos_points NUMERIC(8,2) := 0.00;
    v_total_resp_time NUMERIC(10,2) := 0.00;
    v_correct_count INT := 0;
    v_finalize_res JSONB;
BEGIN
    SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Access denied: attempt does not belong to the calling student' USING ERRCODE = '42501';
    END IF;

    IF v_attempt.status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED') THEN
        RETURN jsonb_build_object('success', false, 'already_finalized', true, 'status', v_attempt.status);
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = v_attempt.assessment_id;

    -- Deadline check
    IF v_now >= v_attempt.deadline OR v_now >= v_asm.end_time OR v_asm.status = 'CLOSED' THEN
        v_finalize_res := public.internal_finalize_attempt(v_attempt.id, 'EXPIRED', 'Autosave after deadline elapsed');
        RETURN jsonb_build_object('success', false, 'expired', true, 'status', 'EXPIRED', 'score', v_finalize_res->'score');
    END IF;

    -- Validate Question
    SELECT * INTO v_q FROM public.assessment_questions WHERE id = p_question_id AND assessment_id = v_attempt.assessment_id;
    IF v_q IS NULL THEN
        RAISE EXCEPTION 'Question does not belong to this assessment' USING ERRCODE = '22023';
    END IF;

    -- Check private correctness key securely
    SELECT * INTO v_key FROM public.assessment_question_keys WHERE question_id = p_question_id;
    IF v_q.question_type = 'MCQ' THEN
        IF p_selected_option_id IS NOT NULL AND v_key IS NOT NULL AND p_selected_option_id = v_key.option_id THEN
            v_is_correct := true;
        END IF;
    ELSIF v_q.question_type = 'TRUE_FALSE' THEN
        IF p_selected_boolean IS NOT NULL AND v_key IS NOT NULL AND p_selected_boolean = v_key.correct_boolean THEN
            v_is_correct := true;
        END IF;
    END IF;

    v_points_awarded := CASE WHEN v_is_correct THEN COALESCE(v_q.points, 0.00) ELSE 0.00 END;

    -- Inspect existing answer for idempotency & timing preservation
    SELECT * INTO v_existing FROM public.assessment_attempt_answers
    WHERE attempt_id = p_attempt_id AND question_id = p_question_id;

    IF v_existing IS NOT NULL THEN
        v_started_at := COALESCE(v_existing.question_started_at, v_attempt.started_at, v_now);

        -- If candidate re-saves identical answer (retry/reconnect): preserve original answered_at & score
        IF v_existing.selected_option_id IS NOT DISTINCT FROM p_selected_option_id
           AND v_existing.selected_boolean IS NOT DISTINCT FROM p_selected_boolean
        THEN
            RETURN jsonb_build_object('success', true, 'status', 'IN_PROGRESS', 'saved_at', v_existing.answered_at);
        ELSE
            -- Candidate changed their answer! Evaluated at current timestamp
            v_answered_at := v_now;
            v_response_time_seconds := ROUND(GREATEST(0.00, EXTRACT(EPOCH FROM (v_answered_at - v_started_at)))::numeric, 2);
            v_eos_points := public.calculate_dynamic_eos_points(
                v_is_correct,
                v_response_time_seconds,
                v_q.time_limit_seconds,
                v_asm.speed_bonus_config
            );
        END IF;
    ELSE
        -- First time answering this question
        v_started_at := COALESCE(v_attempt.started_at, v_now);
        v_answered_at := v_now;
        v_response_time_seconds := ROUND(GREATEST(0.00, EXTRACT(EPOCH FROM (v_answered_at - v_started_at)))::numeric, 2);
        v_eos_points := public.calculate_dynamic_eos_points(
            v_is_correct,
            v_response_time_seconds,
            v_q.time_limit_seconds,
            v_asm.speed_bonus_config
        );
    END IF;

    -- Upsert answer record
    INSERT INTO public.assessment_attempt_answers (
        attempt_id,
        question_id,
        selected_option_id,
        selected_boolean,
        is_correct,
        points_awarded,
        eos_points,
        speed_bonus_awarded,
        response_time_seconds,
        question_started_at,
        answered_at
    ) VALUES (
        p_attempt_id,
        p_question_id,
        p_selected_option_id,
        p_selected_boolean,
        v_is_correct,
        v_points_awarded,
        v_eos_points,
        v_eos_points,
        v_response_time_seconds,
        v_started_at,
        v_answered_at
    )
    ON CONFLICT (attempt_id, question_id) DO UPDATE
    SET selected_option_id = EXCLUDED.selected_option_id,
        selected_boolean = EXCLUDED.selected_boolean,
        is_correct = EXCLUDED.is_correct,
        points_awarded = EXCLUDED.points_awarded,
        eos_points = EXCLUDED.eos_points,
        speed_bonus_awarded = EXCLUDED.speed_bonus_awarded,
        response_time_seconds = EXCLUDED.response_time_seconds,
        answered_at = EXCLUDED.answered_at;

    -- Atomically update attempt aggregate scores & live telemetry
    SELECT 
        COALESCE(SUM(points_awarded), 0.00),
        COALESCE(SUM(eos_points), 0.00),
        COALESCE(SUM(response_time_seconds), 0.00),
        COUNT(*) FILTER (WHERE is_correct = true)
    INTO v_total_q_score, v_total_eos_points, v_total_resp_time, v_correct_count
    FROM public.assessment_attempt_answers
    WHERE attempt_id = p_attempt_id;

    UPDATE public.assessment_attempts
    SET question_score = v_total_q_score,
        score = v_total_q_score,
        eos_points = v_total_eos_points,
        speed_bonus_score = v_total_eos_points,
        total_response_time_seconds = v_total_resp_time,
        correct_answers_count = v_correct_count,
        updated_at = v_now
    WHERE id = p_attempt_id;

    SELECT full_name INTO v_student_name FROM public.student_profiles WHERE user_id = v_attempt.student_id;

    INSERT INTO public.assessment_live_events (
        assessment_id, student_id, student_name, event_type, question_context, metadata
    ) VALUES (
        v_attempt.assessment_id,
        v_attempt.student_id,
        COALESCE(v_student_name, 'Candidate'),
        'ANSWER_SAVED',
        'Answer recorded for question ' || v_q.sort_order,
        jsonb_build_object(
            'eos_points', v_total_eos_points,
            'question_score', v_total_q_score,
            'correct_count', v_correct_count
        )
    );

    RETURN jsonb_build_object('success', true, 'status', 'IN_PROGRESS', 'saved_at', v_answered_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) TO authenticated, service_role;


-- 2. ROLLBACK public.get_assessment_live_host_snapshot to Migration 129 definition
CREATE OR REPLACE FUNCTION public.get_assessment_live_host_snapshot(
    p_assessment_id uuid,
    p_coordinator_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

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

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'attempt_id', att.id,
            'student_id', att.student_id,
            'student_name', COALESCE(sp.full_name, 'Candidate'),
            'roll_number', sp.roll_number,
            'college_name', sp.college_name,
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

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'student_id', att.student_id,
            'student_name', COALESCE(sp.full_name, 'Candidate'),
            'roll_number', sp.roll_number,
            'college_name', sp.college_name,
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
        'recent_events', v_recent_events,
        'scoreboard', v_scoreboard
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) TO anon, authenticated, service_role;
