-- ============================================================================
-- PROPOSAL: Concurrency-Safe Deadline Finalization & Fairness Patch
-- Target: Staging / QA Validation (agzgxwfutajwawwtsbco)
-- Status: PROPOSAL ONLY - PENDING EXPLICIT HUMAN APPROVAL
-- Objectives:
--   1. Decouples Answer Freeze (strict deadline) from Finalization Grace (15s).
--   2. Eliminates false 'EXPIRED' status caused by connection pool queue delays.
--   3. Prevents answer modifications during the 15-second grace window.
--   4. Fully preserves idempotent resubmission behavior for network retries.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. HARDEN student_autosave_answer WITH ANSWER FREEZE BOUNDARY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_autosave_answer(
    p_attempt_id UUID,
    p_question_id UUID,
    p_selected_option_id UUID DEFAULT NULL,
    p_selected_boolean BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_attempt RECORD;
    v_asm RECORD;
    v_q RECORD;
    v_key RECORD;
    v_existing RECORD;
    v_is_correct BOOLEAN := false;
    v_points_awarded NUMERIC(8,2) := 0.00;
    v_eos_points NUMERIC(8,2) := 0.00;
    v_response_time_seconds NUMERIC(10,2) := 0.00;
    v_started_at TIMESTAMPTZ;
    v_answered_at TIMESTAMPTZ;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_total_q_score NUMERIC(8,2) := 0.00;
    v_total_eos_points NUMERIC(8,2) := 0.00;
    v_total_resp_time NUMERIC(10,2) := 0.00;
    v_correct_count INT := 0;
    v_answered_count INT := 0;
    v_finalize_res JSONB;
    c_grace_window CONSTANT INTERVAL := interval '15 seconds';
BEGIN
    -- 1. Validate Attempt Ownership with Row Exclusive Lock
    SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Access denied: attempt does not belong to the calling student' USING ERRCODE = '42501';
    END IF;

    -- If attempt is already finalized, return idempotent success
    IF v_attempt.status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED') THEN
        RETURN jsonb_build_object(
            'success', false,
            'already_finalized', true,
            'status', v_attempt.status,
            'message', 'Assessment is no longer active'
        );
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = v_attempt.assessment_id;

    -- 2. Authoritative Two-Phase Deadline Enforcement
    -- Phase A: If beyond deadline + 15s grace window, definitively finalize as EXPIRED
    IF v_now > (v_attempt.deadline + c_grace_window) 
       OR (v_asm.end_time IS NOT NULL AND v_now > (v_asm.end_time + c_grace_window))
    THEN
        v_finalize_res := public.internal_finalize_attempt(v_attempt.id, 'EXPIRED', 'Autosave after grace window elapsed');
        RETURN jsonb_build_object('success', false, 'status', 'EXPIRED', 'message', 'Assessment deadline has elapsed');
    END IF;

    -- Phase B: If past strict deadline but within 15s grace window, FREEZE answers
    -- (Disallows any new answer submission or change, but avoids penalizing in-flight packets)
    IF v_now > v_attempt.deadline OR (v_asm.end_time IS NOT NULL AND v_now > v_asm.end_time) THEN
        RETURN jsonb_build_object(
            'success', false,
            'deadline_frozen', true,
            'status', 'IN_PROGRESS',
            'message', 'Assessment deadline elapsed; answers are frozen awaiting submission.'
        );
    END IF;

    -- 3. Validate Question Belongs to Assessment
    SELECT * INTO v_q FROM public.assessment_questions 
    WHERE id = p_question_id AND assessment_id = v_attempt.assessment_id;
    IF v_q IS NULL THEN
        RAISE EXCEPTION 'Question does not belong to this assessment' USING ERRCODE = '22023';
    END IF;

    -- 4. Server-Side Correctness Check (Isolated Answer Keys)
    SELECT * INTO v_key FROM public.assessment_question_keys WHERE question_id = p_question_id;
    IF FOUND AND v_key.id IS NOT NULL THEN
        IF v_q.question_type = 'MCQ' THEN
            IF p_selected_option_id IS NOT NULL AND v_key.option_id IS NOT NULL AND p_selected_option_id = v_key.option_id THEN
                v_is_correct := true;
            END IF;
        ELSIF v_q.question_type = 'TRUE_FALSE' THEN
            IF p_selected_boolean IS NOT NULL AND v_key.correct_boolean IS NOT NULL AND p_selected_boolean = v_key.correct_boolean THEN
                v_is_correct := true;
            END IF;
        END IF;
    END IF;

    v_points_awarded := CASE WHEN v_is_correct THEN COALESCE(v_q.points, 0.00) ELSE 0.00 END;

    -- 5. Inspect Existing Answer for Idempotency
    SELECT * INTO v_existing FROM public.assessment_attempt_answers
    WHERE attempt_id = p_attempt_id AND question_id = p_question_id;

    IF v_existing IS NOT NULL THEN
        v_started_at := COALESCE(v_existing.question_started_at, v_attempt.started_at, v_now);

        IF v_existing.selected_option_id IS NOT DISTINCT FROM p_selected_option_id
           AND v_existing.selected_boolean IS NOT DISTINCT FROM p_selected_boolean
        THEN
            RETURN jsonb_build_object('success', true, 'status', 'IN_PROGRESS', 'saved_at', v_existing.answered_at);
        ELSE
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

    -- 6. Upsert Answer Record
    INSERT INTO public.assessment_attempt_answers (
        attempt_id, question_id, selected_option_id, selected_boolean,
        is_correct, points_awarded, eos_points, speed_bonus_awarded,
        response_time_seconds, question_started_at, answered_at
    ) VALUES (
        p_attempt_id, p_question_id, p_selected_option_id, p_selected_boolean,
        v_is_correct, v_points_awarded, v_eos_points, v_eos_points,
        v_response_time_seconds, v_started_at, v_answered_at
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

    -- 7. Covering Index Aggregation
    SELECT 
        COALESCE(SUM(points_awarded), 0.00),
        COALESCE(SUM(eos_points), 0.00),
        COALESCE(SUM(response_time_seconds), 0.00),
        COUNT(*) FILTER (WHERE is_correct = true),
        COUNT(*) FILTER (WHERE selected_option_id IS NOT NULL OR selected_boolean IS NOT NULL)
    INTO v_total_q_score, v_total_eos_points, v_total_resp_time, v_correct_count, v_answered_count
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

    -- 8. Debounced Milestone Telemetry Stream
    IF v_existing IS NULL AND (v_answered_count = 1 OR v_answered_count % 5 = 0 OR v_answered_count >= v_asm.total_questions_count) THEN
        INSERT INTO public.assessment_live_events (
            assessment_id, student_id, student_name, event_type, question_context, metadata
        ) VALUES (
            v_attempt.assessment_id, v_attempt.student_id, 'Candidate',
            'ANSWER_SAVED',
            'Answer milestone: ' || v_answered_count || ' of ' || v_asm.total_questions_count || ' answered',
            jsonb_build_object(
                'eos_points', v_total_eos_points,
                'question_score', v_total_q_score,
                'correct_count', v_correct_count,
                'answered_count', v_answered_count
            )
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'IN_PROGRESS', 'saved_at', v_answered_at);
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. HARDEN student_submit_attempt WITH FAIRNESS WINDOW CLASSIFICATION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_submit_attempt(p_attempt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt RECORD;
    v_asm RECORD;
    v_student_name TEXT := 'Candidate';
    v_final_status TEXT := 'SUBMITTED';
    v_reason TEXT := 'Student voluntary submission';
    v_finalize_res JSONB;
    v_now TIMESTAMPTZ := clock_timestamp();
    c_grace_window CONSTANT INTERVAL := interval '15 seconds';
BEGIN
    SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Access denied: attempt does not belong to calling student' USING ERRCODE = '42501';
    END IF;

    -- Idempotency check: Already finalized attempts return existing score immediately
    IF v_attempt.status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED') THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_submitted', true,
            'status', v_attempt.status,
            'score', v_attempt.score,
            'question_score', v_attempt.question_score,
            'eos_points', v_attempt.eos_points,
            'speed_bonus_score', v_attempt.speed_bonus_score
        );
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = v_attempt.assessment_id;

    -- FAIRNESS CLASSIFICATION:
    -- If submission arrives within deadline + 15s grace window: classify as SUBMITTED (timely)
    -- If submission arrives beyond deadline + 15s grace window: classify as EXPIRED
    IF v_now > (v_attempt.deadline + c_grace_window)
       OR (v_asm.end_time IS NOT NULL AND v_now > (v_asm.end_time + c_grace_window))
    THEN
        v_final_status := 'EXPIRED';
        v_reason := 'Submitted after deadline and grace window elapsed';
    END IF;

    v_finalize_res := public.internal_finalize_attempt(v_attempt.id, v_final_status, v_reason);

    SELECT full_name INTO v_student_name FROM public.student_profiles WHERE user_id = v_attempt.student_id;

    INSERT INTO public.assessment_live_events (
        assessment_id, student_id, student_name, event_type, question_context, metadata
    ) VALUES (
        v_attempt.assessment_id,
        v_attempt.student_id,
        COALESCE(v_student_name, 'Candidate'),
        CASE WHEN v_final_status = 'SUBMITTED' THEN 'ATTEMPT_SUBMITTED' ELSE 'ATTEMPT_EXPIRED' END,
        'Examination completed & finalized',
        jsonb_build_object(
            'status', v_final_status,
            'score', v_finalize_res->'score',
            'question_score', v_finalize_res->'question_score',
            'eos_points', v_finalize_res->'eos_points'
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'status', v_final_status,
        'score', v_finalize_res->'score',
        'question_score', v_finalize_res->'question_score',
        'eos_points', v_finalize_res->'eos_points',
        'correct_count', v_finalize_res->'correct_count'
    );
END;
$$;

COMMIT;
