-- ============================================================================
-- Migration: 127_eos_speed_bonus_and_live_podium.sql
-- Description: Dynamic EOS Speed Points, Real-Time Rankings, and Kahoot Podium.
--
-- Security & Integrity Guarantees:
--   - Replaces old fixed-rank bonuses (+100, +75, +50) with dynamic response-time
--     EOS speed scoring: ROUND(1000 * MAX(0, 1 - (response_time / time_limit) / 2)).
--   - Separate scores: Academic question marks (question_score) and competitive
--     EOS points (eos_points) are preserved separately.
--   - Maximum 1,000 EOS points per eligible question by default.
--   - Incorrect answers earn 0 EOS points.
--   - Scores are strictly independent of answer rank or processing order.
--   - Server-authoritative timing: response time measured from trusted server timestamps.
--   - Re-saving identical option preserves original timestamp and score (idempotency).
--   - Changed answers are evaluated at the timestamp of the new choice, preventing exploits.
--   - Realtime leaderboard updates live as answers are evaluated without leaking keys.
--   - Deterministic tie-breaking: EOS points DESC, correct count DESC, response time ASC,
--     submitted_at ASC, student_id ASC.
--   - Historical completed assessments and certificates are strictly preserved.
-- ============================================================================

-- 1. CONFIGURATION & BREAKDOWN SCHEMA ENHANCEMENTS
-- ============================================================================

-- 1.1 Configurable Speed Scoring on Assessments Table
ALTER TABLE public.assessments
ADD COLUMN IF NOT EXISTS speed_bonus_config JSONB NOT NULL DEFAULT '{
    "enabled": true,
    "max_eos_points": 1000,
    "default_time_limit_seconds": 30
}'::jsonb;

-- 1.2 Question Time Limit on Assessment Questions Table
ALTER TABLE public.assessment_questions
ADD COLUMN IF NOT EXISTS time_limit_seconds INTEGER NOT NULL DEFAULT 30 CHECK (time_limit_seconds > 0);

-- 1.3 Attempt Score Breakdown & Timing Columns
ALTER TABLE public.assessment_attempts
ADD COLUMN IF NOT EXISTS question_score NUMERIC(8,2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS eos_points NUMERIC(8,2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS speed_bonus_score NUMERIC(8,2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS total_response_time_seconds NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Backfill existing historical attempts: question_score matches score, eos_points = 0
UPDATE public.assessment_attempts
SET question_score = score,
    eos_points = 0.00,
    speed_bonus_score = 0.00
WHERE question_score = 0.00 AND score > 0.00;

-- 1.4 Attempt Answers Breakdown & Timing Columns
ALTER TABLE public.assessment_attempt_answers
DROP CONSTRAINT IF EXISTS ck_attempt_answer_mutual_exclusive;

ALTER TABLE public.assessment_attempt_answers
ADD CONSTRAINT ck_attempt_answer_mutual_exclusive
CHECK (
    (selected_option_id IS NOT NULL AND selected_boolean IS NULL)
    OR (selected_option_id IS NULL AND selected_boolean IS NOT NULL)
    OR (selected_option_id IS NULL AND selected_boolean IS NULL)
);

ALTER TABLE public.assessment_attempt_answers
ADD COLUMN IF NOT EXISTS points_awarded NUMERIC(8,2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS eos_points NUMERIC(8,2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS speed_bonus_awarded NUMERIC(8,2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS speed_bonus_rank INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS response_time_seconds NUMERIC(8,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS question_started_at TIMESTAMPTZ DEFAULT NULL;

-- 1.5 Realtime Leaderboard Events Breakdown Columns
ALTER TABLE public.assessment_leaderboard_events
ADD COLUMN IF NOT EXISTS question_score NUMERIC(8,2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS eos_points NUMERIC(8,2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS speed_bonus_score NUMERIC(8,2) NOT NULL DEFAULT 0.00;

UPDATE public.assessment_leaderboard_events
SET question_score = score,
    eos_points = 0.00,
    speed_bonus_score = 0.00
WHERE question_score = 0.00 AND score > 0.00;

-- 1.6 Supporting Indexes for Concurrent Live Queries
CREATE INDEX IF NOT EXISTS idx_assessment_attempt_answers_attempt_q
ON public.assessment_attempt_answers(attempt_id, question_id);

CREATE INDEX IF NOT EXISTS idx_assessment_attempts_eos_rank
ON public.assessment_attempts(assessment_id, eos_points DESC, correct_answers_count DESC);

-- 2. DYNAMIC EOS SPEED POINTS CALCULATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_dynamic_eos_points(
    p_is_correct BOOLEAN,
    p_response_time_seconds NUMERIC,
    p_time_limit_seconds INT DEFAULT 30,
    p_config JSONB DEFAULT NULL
)
RETURNS NUMERIC(8,2)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_enabled BOOLEAN := true;
    v_max_eos_points NUMERIC := 1000.00;
    v_time_limit NUMERIC := 30.00;
    v_response_time NUMERIC;
    v_factor NUMERIC;
    v_calculated NUMERIC;
BEGIN
    -- Only correct answers receive EOS speed points
    IF p_is_correct IS NOT TRUE THEN
        RETURN 0.00;
    END IF;

    -- Evaluate assessment config
    IF p_config IS NOT NULL THEN
        IF (p_config->>'enabled') IS NOT NULL AND (p_config->>'enabled')::boolean = false THEN
            RETURN 0.00;
        END IF;
        IF (p_config->>'max_eos_points') IS NOT NULL AND (p_config->>'max_eos_points')::numeric > 0 THEN
            v_max_eos_points := (p_config->>'max_eos_points')::numeric;
        END IF;
        IF (p_config->>'default_time_limit_seconds') IS NOT NULL AND (p_config->>'default_time_limit_seconds')::numeric > 0 THEN
            v_time_limit := (p_config->>'default_time_limit_seconds')::numeric;
        END IF;
    END IF;

    IF p_time_limit_seconds IS NOT NULL AND p_time_limit_seconds > 0 THEN
        v_time_limit := p_time_limit_seconds::numeric;
    END IF;

    -- Negative response time (from clock discrepancies) clamped to 0
    v_response_time := GREATEST(0.00, COALESCE(p_response_time_seconds, 0.00));

    -- Kahoot-inspired dynamic speed formula:
    -- EOS points = ROUND(1000 * MAX(0, 1 - (response_time_seconds / question_time_limit_seconds) / 2))
    v_factor := GREATEST(0.00, 1.00 - ((v_response_time / v_time_limit) / 2.00));
    v_calculated := ROUND(v_max_eos_points * v_factor);

    -- Strict cap between 0 and max_eos_points
    RETURN LEAST(v_max_eos_points, GREATEST(0.00, v_calculated));
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_dynamic_eos_points(BOOLEAN, NUMERIC, INT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_dynamic_eos_points(BOOLEAN, NUMERIC, INT, JSONB) TO anon, authenticated, service_role;

-- Backward compatibility function: removes fixed-rank schedule completely
CREATE OR REPLACE FUNCTION public.calculate_eos_speed_bonus(
    p_rank INT,
    p_config JSONB DEFAULT NULL
)
RETURNS NUMERIC(8,2)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    -- Fixed rank bonuses are strictly deprecated and removed.
    -- Dynamic calculations must use calculate_dynamic_eos_points with response time.
    RETURN 0.00;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_eos_speed_bonus(INT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_eos_speed_bonus(INT, JSONB) TO anon, authenticated, service_role;

-- 3. QUESTION START INITIALIZER RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.student_start_question(
    p_attempt_id UUID,
    p_question_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_existing RECORD;
BEGIN
    SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id;
    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Access denied: attempt does not belong to the calling student' USING ERRCODE = '42501';
    END IF;

    IF v_attempt.status != 'IN_PROGRESS' THEN
        RETURN jsonb_build_object('success', false, 'status', v_attempt.status);
    END IF;

    SELECT * INTO v_existing FROM public.assessment_attempt_answers
    WHERE attempt_id = p_attempt_id AND question_id = p_question_id;

    IF v_existing IS NULL THEN
        INSERT INTO public.assessment_attempt_answers (
            attempt_id, question_id, question_started_at, answered_at
        ) VALUES (
            p_attempt_id, p_question_id, v_now, v_now
        )
        ON CONFLICT (attempt_id, question_id) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('success', true, 'started_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.student_start_question(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_start_question(UUID, UUID) TO authenticated, service_role;

-- 4. HARDENED AUTOSAVE (DYNAMIC EOS SCORING & ZERO KEY LEAKAGE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.student_autosave_answer(
    p_attempt_id UUID,
    p_question_id UUID,
    p_selected_option_id UUID DEFAULT NULL,
    p_selected_boolean BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
        score = v_total_q_score, -- Academic question marks remain canonical score
        eos_points = v_total_eos_points,
        speed_bonus_score = v_total_eos_points,
        total_response_time_seconds = v_total_resp_time,
        correct_answers_count = v_correct_count,
        updated_at = v_now
    WHERE id = p_attempt_id;

    -- Student name for live event stream
    SELECT full_name INTO v_student_name FROM public.student_profiles WHERE user_id = v_attempt.student_id;

    -- Emit ANSWER_SAVED live event for Realtime host leaderboard
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

    -- Strict Security Boundary: Return only saved status to student during exam
    RETURN jsonb_build_object('success', true, 'status', 'IN_PROGRESS', 'saved_at', v_answered_at);
END;
$$;

REVOKE ALL ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) TO authenticated, service_role;

-- 5. ATOMIC INTERNAL ATTEMPT FINALIZATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.internal_finalize_attempt(
    p_attempt_id UUID,
    p_final_status TEXT, -- 'SUBMITTED', 'EXPIRED', 'TERMINATED'
    p_reason TEXT DEFAULT 'Finalized'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt RECORD;
    v_asm RECORD;
    v_student_name TEXT;
    v_finalized_at TIMESTAMPTZ := clock_timestamp();
    v_question_score NUMERIC(8,2) := 0.00;
    v_eos_points NUMERIC(8,2) := 0.00;
    v_total_resp_time NUMERIC(10,2) := 0.00;
    v_correct_count INT := 0;
    v_event_id UUID;
BEGIN
    IF p_final_status NOT IN ('SUBMITTED', 'EXPIRED', 'TERMINATED') THEN
        RAISE EXCEPTION 'Invalid final status: %', p_final_status USING ERRCODE = '22023';
    END IF;

    -- Lock attempt row exclusively
    SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt % not found', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    -- If already finalized, exit gracefully with existing score (idempotent)
    IF v_attempt.status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED') THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_finalized', true,
            'status', v_attempt.status,
            'score', v_attempt.score,
            'question_score', v_attempt.question_score,
            'eos_points', v_attempt.eos_points,
            'speed_bonus_score', v_attempt.speed_bonus_score
        );
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = v_attempt.assessment_id;
    SELECT full_name INTO v_student_name FROM public.student_profiles WHERE user_id = v_attempt.student_id;
    v_student_name := COALESCE(NULLIF(trim(v_student_name), ''), 'Anonymous Candidate');

    -- Aggregate final scores
    SELECT 
        COALESCE(SUM(points_awarded), 0.00),
        COALESCE(SUM(eos_points), 0.00),
        COALESCE(SUM(response_time_seconds), 0.00),
        COUNT(*) FILTER (WHERE is_correct = true)
    INTO v_question_score, v_eos_points, v_total_resp_time, v_correct_count
    FROM public.assessment_attempt_answers
    WHERE attempt_id = p_attempt_id;

    -- If attempt was terminated for cheating, zero out competitive EOS points
    IF p_final_status = 'TERMINATED' THEN
        v_eos_points := 0.00;
    END IF;

    -- Insert into sanitized leaderboard projection table
    INSERT INTO public.assessment_leaderboard_events (
        assessment_id, student_name, score, question_score, eos_points, speed_bonus_score, finalized_at
    )
    VALUES (
        v_attempt.assessment_id,
        v_student_name,
        v_question_score,
        v_question_score,
        v_eos_points,
        v_eos_points,
        v_finalized_at
    )
    RETURNING id INTO v_event_id;

    -- Update attempt record synchronously
    UPDATE public.assessment_attempts
    SET status = p_final_status,
        submitted_at = v_finalized_at,
        score = v_question_score,
        question_score = v_question_score,
        eos_points = v_eos_points,
        speed_bonus_score = v_eos_points,
        total_response_time_seconds = v_total_resp_time,
        correct_answers_count = v_correct_count,
        leaderboard_event_id = v_event_id,
        updated_at = v_finalized_at
    WHERE id = p_attempt_id;

    -- Write audit record
    INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata, created_at)
    VALUES (
        'ASSESSMENT_ATTEMPT_FINALIZED',
        'ASSESSMENT_ATTEMPT',
        p_attempt_id,
        jsonb_build_object(
            'final_status', p_final_status,
            'reason', p_reason,
            'question_score', v_question_score,
            'eos_points', v_eos_points,
            'correct_count', v_correct_count,
            'finalized_at', v_finalized_at
        ),
        v_finalized_at
    );

    RETURN jsonb_build_object(
        'success', true,
        'status', p_final_status,
        'score', v_question_score,
        'question_score', v_question_score,
        'eos_points', v_eos_points,
        'speed_bonus_score', v_eos_points,
        'correct_count', v_correct_count,
        'finalized_at', v_finalized_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.internal_finalize_attempt(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_finalize_attempt(UUID, TEXT, TEXT) TO service_role;

-- 6. STUDENT SUBMIT ATTEMPT RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.student_submit_attempt(p_attempt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt RECORD;
    v_student_name TEXT := 'Candidate';
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

    v_finalize_res := public.internal_finalize_attempt(v_attempt.id, 'SUBMITTED', 'Student submitted assessment manually');

    SELECT full_name INTO v_student_name FROM public.student_profiles WHERE user_id = v_attempt.student_id;

    -- Live Event: ATTEMPT_SUBMITTED
    INSERT INTO public.assessment_live_events (
        assessment_id,
        student_id,
        student_name,
        event_type,
        question_context,
        metadata
    ) VALUES (
        v_attempt.assessment_id,
        v_attempt.student_id,
        COALESCE(v_student_name, 'Candidate'),
        'ATTEMPT_SUBMITTED',
        'Examination completed & submitted',
        jsonb_build_object(
            'score', v_finalize_res->'score',
            'question_score', v_finalize_res->'question_score',
            'eos_points', v_finalize_res->'eos_points'
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'status', 'SUBMITTED',
        'score', v_finalize_res->'score',
        'question_score', v_finalize_res->'question_score',
        'eos_points', v_finalize_res->'eos_points',
        'correct_count', v_finalize_res->'correct_count'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.student_submit_attempt(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_submit_attempt(UUID) TO authenticated, service_role;

-- 7. LIVE HOST SNAPSHOT RPC WITH DYNAMIC EOS SCOREBOARD & PODIUM DATA
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
    v_coord_info RECORD;
    v_total_eligible INT := 0;
    v_started_count INT := 0;
    v_in_progress_count INT := 0;
    v_submitted_count INT := 0;
    v_expired_count INT := 0;
    v_terminated_count INT := 0;
    v_participants JSONB := '[]'::jsonb;
    v_question_progress JSONB := '[]'::jsonb;
    v_recent_activity JSONB := '[]'::jsonb;
    v_scoreboard JSONB := '[]'::jsonb;
BEGIN
    -- Verify authorized access for coordinator or admin
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    -- Coordinator profile info
    SELECT id, username, display_name INTO v_coord_info
    FROM public.coordinators
    WHERE id = v_asm.coordinator_id;

    -- Eligible candidate count
    SELECT count(*) INTO v_total_eligible
    FROM public.student_profiles
    WHERE account_status = 'ACTIVE';

    -- Attempt counts
    SELECT count(*) INTO v_started_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id;

    SELECT count(*) INTO v_in_progress_count
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

    -- Participant Roster with separate academic & EOS scores
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'attempt_id', att.id,
            'student_id', att.student_id,
            'student_name', COALESCE(sp.full_name, 'Candidate ' || substr(att.student_id::text, 1, 8)),
            'roll_number', COALESCE(sp.roll_number, 'N/A'),
            'college', COALESCE(sp.college, 'N/A'),
            'status', att.status,
            'started_at', att.started_at,
            'submitted_at', att.submitted_at,
            'deadline', att.deadline,
            'elapsed_seconds', CASE 
                WHEN att.submitted_at IS NOT NULL THEN round(extract(epoch from (att.submitted_at - att.started_at)))
                ELSE round(extract(epoch from (clock_timestamp() - att.started_at)))
            END,
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
            'percentage', CASE 
                WHEN (SELECT sum(points) FROM public.assessment_questions WHERE assessment_id = p_assessment_id) > 0 
                THEN round((att.question_score * 100.0 / (SELECT sum(points) FROM public.assessment_questions WHERE assessment_id = p_assessment_id)), 2)
                ELSE NULL 
            END,
            'is_passed', CASE 
                WHEN (SELECT sum(points) FROM public.assessment_questions WHERE assessment_id = p_assessment_id) > 0 
                THEN ((att.question_score * 100.0 / (SELECT sum(points) FROM public.assessment_questions WHERE assessment_id = p_assessment_id)) >= v_asm.passing_percentage)
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

    -- Question level progress aggregates
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
    WHERE q.assessment_id = p_assessment_id;

    -- Recent Live Activity (latest 50 events)
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
    INTO v_recent_activity
    FROM (
        SELECT * FROM public.assessment_live_events
        WHERE assessment_id = p_assessment_id
        ORDER BY created_at DESC
        LIMIT 50
    ) ev;

    -- Current Live Scoreboard & Podium rankings
    -- Strictly ranked by dynamic EOS points with deterministic tie-breaking:
    -- 1. Total accumulated EOS Points DESC
    -- 2. Correct answers count DESC
    -- 3. Total response time ASC (faster cumulative speed)
    -- 4. Submitted At ASC
    -- 5. Student ID ASC (deterministic tie-breaker)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'rank', sb.computed_rank,
            'student_name', sb.student_name,
            'score', sb.score,
            'question_score', sb.question_score,
            'eos_points', sb.eos_points,
            'speed_bonus_score', sb.eos_points,
            'status', sb.status,
            'submitted_at', sb.submitted_at,
            'correct_answers_count', sb.correct_answers_count,
            'total_response_time_seconds', sb.total_response_time_seconds
        )
    ), '[]'::jsonb)
    INTO v_scoreboard
    FROM (
        SELECT 
            ROW_NUMBER() OVER (
                ORDER BY 
                    COALESCE(att.eos_points, 0.00) DESC,
                    att.correct_answers_count DESC,
                    COALESCE(att.total_response_time_seconds, EXTRACT(EPOCH FROM (COALESCE(att.submitted_at, att.deadline) - att.started_at))) ASC,
                    att.submitted_at ASC NULLS LAST,
                    att.student_id ASC
            ) as computed_rank,
            COALESCE(sp.full_name, 'Candidate ' || substr(att.student_id::text, 1, 8)) as student_name,
            att.score,
            att.question_score,
            COALESCE(att.eos_points, 0.00) as eos_points,
            att.status,
            att.submitted_at,
            att.correct_answers_count,
            att.total_response_time_seconds
        FROM public.assessment_attempts att
        LEFT JOIN public.student_profiles sp ON sp.user_id = att.student_id
        WHERE att.assessment_id = p_assessment_id 
          AND att.status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED')
        LIMIT 50
    ) sb;

    RETURN jsonb_build_object(
        'assessment', jsonb_build_object(
            'id', v_asm.id,
            'title', v_asm.title,
            'description', v_asm.description,
            'status', v_asm.status,
            'duration_minutes', v_asm.duration_minutes,
            'start_time', v_asm.start_time,
            'end_time', v_asm.end_time,
            'passing_percentage', v_asm.passing_percentage,
            'total_questions_count', v_asm.total_questions_count,
            'coordinator_name', v_coord_info.display_name,
            'coordinator_username', v_coord_info.username,
            'speed_bonus_config', v_asm.speed_bonus_config
        ),
        'overview', jsonb_build_object(
            'total_eligible', v_total_eligible,
            'started_count', v_started_count,
            'in_progress_count', v_in_progress_count,
            'submitted_count', v_submitted_count,
            'expired_count', v_expired_count,
            'terminated_count', v_terminated_count,
            'not_started_count', GREATEST(0, v_total_eligible - v_started_count),
            'completion_rate', CASE 
                WHEN v_started_count > 0 THEN round(v_submitted_count * 100.0 / v_started_count, 1)
                ELSE 0.0 
            END
        ),
        'participants', v_participants,
        'question_progress', v_question_progress,
        'recent_activity', v_recent_activity,
        'scoreboard', v_scoreboard,
        'server_time', timezone('utc'::text, now())
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) TO anon, authenticated, service_role;

-- 8. PUBLIC & CANDIDATE LEADERBOARD RPC
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_assessment_leaderboard(UUID);

CREATE OR REPLACE FUNCTION public.get_assessment_leaderboard(p_assessment_id UUID)
RETURNS TABLE (
    rank BIGINT,
    student_name TEXT,
    score NUMERIC(8,2),
    question_score NUMERIC(8,2),
    eos_points NUMERIC(8,2),
    speed_bonus_score NUMERIC(8,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM public.assessments WHERE id = p_assessment_id;
    IF v_status IS NULL OR v_status NOT IN ('PUBLISHED', 'CLOSED') THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'Assessment not found or not active' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        DENSE_RANK() OVER (
            ORDER BY 
                COALESCE(a.eos_points, 0.00) DESC,
                a.correct_answers_count DESC,
                COALESCE(a.total_response_time_seconds, EXTRACT(EPOCH FROM (COALESCE(a.submitted_at, a.deadline) - a.started_at))) ASC,
                a.submitted_at ASC NULLS LAST,
                COALESCE(NULLIF(trim(st.full_name), ''), 'Anonymous Candidate') ASC,
                a.id ASC
        ) AS rank,
        COALESCE(NULLIF(trim(st.full_name), ''), 'Anonymous Candidate') AS student_name,
        a.score,
        COALESCE(a.question_score, a.score) AS question_score,
        COALESCE(a.eos_points, 0.00) AS eos_points,
        COALESCE(a.eos_points, 0.00) AS speed_bonus_score
    FROM public.assessment_attempts a
    LEFT JOIN public.student_profiles st ON st.user_id = a.student_id
    WHERE a.assessment_id = p_assessment_id
      AND a.status IN ('SUBMITTED', 'EXPIRED')
    ORDER BY rank ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_assessment_leaderboard(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assessment_leaderboard(UUID) TO anon, authenticated, service_role;
