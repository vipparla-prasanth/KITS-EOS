-- ============================================================================
-- Migration 134: Optimize Assessment Autosave, Live Telemetry & Snapshot Aggregation
-- ============================================================================
-- Objectives:
--   1. [F-DB-01] Eliminate write amplification and Wal bloat in student_autosave_answer:
--      - Remove repetitive student_profiles joins on every autosave.
--      - Throttle/debounce unlogged assessment_live_events stream logging to milestones.
--      - Create a covering index for instantaneous attempt answer aggregations.
--   2. [F-DB-02] Eliminate correlated scalar subqueries in get_assessment_live_host_snapshot:
--      - Combine 7 separate attempt status scalar queries into 1 single aggregate scan.
--      - Replace per-participant scalar subqueries with a grouped LEFT JOIN.
--      - Guarantee both 'recent_activity' and 'recent_events' keys are projected.
--   3. [F-WORK-01] Fix question start timestamp drift during non-sequential navigation:
--      - Introduce lightweight public.student_view_question(attempt_id, question_id).
--   4. [F-SEC-02] Enforce 15-minute coordinator session idle inactivity timeout:
--      - Invalidate sessions where last_active_at < (now() - interval '15 minutes').
--
-- Safety & Governance Guarantees:
--   - 100% server-authoritative scoring preserved: academic marks and EOS speed points decoupled.
--   - Non-linear Kahoot speed bonus decay formula preserved:
--     ROUND(max_eos_points * MAX(0, 1.0 - (response_time_seconds / (2.0 * question_time_limit_seconds))))
--   - Row-Level Security (RLS) policies and answer key isolation strictly maintained.
--   - Zero assessment certificates generated (Rule: assessments must never issue certificates).
--   - Prepared for staged developer review; NOT executed against production directly.
-- ============================================================================

-- ------------------------------------------------------------------------------
-- 1. COVERING INDEX FOR ATTEMPT ANSWERS AGGREGATION
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_assessment_attempt_answers_scoring_cov
ON public.assessment_attempt_answers (attempt_id)
INCLUDE (points_awarded, eos_points, response_time_seconds, is_correct);

-- ------------------------------------------------------------------------------
-- 2. LIGHTWEIGHT QUESTION VIEW PING (Eliminates Out-of-Order Drift)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_view_question(
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
    v_q RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    -- 1. Validate Caller Ownership
    SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id;
    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt % not found', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Access denied: attempt does not belong to the calling student' USING ERRCODE = '42501';
    END IF;

    IF v_attempt.status != 'IN_PROGRESS' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'Attempt is not in progress');
    END IF;

    -- 2. Validate Question Belongs to Assessment
    SELECT * INTO v_q FROM public.assessment_questions
    WHERE id = p_question_id AND assessment_id = v_attempt.assessment_id;
    IF v_q IS NULL THEN
        RAISE EXCEPTION 'Question does not belong to this assessment' USING ERRCODE = '22023';
    END IF;

    -- 3. Atomically Record question_started_at if not previously recorded
    INSERT INTO public.assessment_attempt_answers (
        attempt_id,
        question_id,
        question_started_at
    ) VALUES (
        p_attempt_id,
        p_question_id,
        v_now
    )
    ON CONFLICT (attempt_id, question_id) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'question_started_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.student_view_question(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_view_question(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.student_view_question(UUID, UUID) IS
'Lightweight timestamp ping recording question_started_at upon initial view to ensure accurate non-sequential speed bonus scoring.';

-- ------------------------------------------------------------------------------
-- 3. OPTIMIZED public.student_autosave_answer
-- ------------------------------------------------------------------------------
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
BEGIN
    -- 1. Validate Attempt Ownership
    SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Access denied: attempt does not belong to the calling student' USING ERRCODE = '42501';
    END IF;

    IF v_attempt.status != 'IN_PROGRESS' THEN
        RETURN jsonb_build_object(
            'success', false,
            'status', v_attempt.status,
            'message', 'Assessment is no longer active'
        );
    END IF;

    -- 2. Enforce Hard Expiry Boundary
    SELECT * INTO v_asm FROM public.assessments WHERE id = v_attempt.assessment_id;
    IF v_now > v_attempt.deadline OR (v_asm.end_time IS NOT NULL AND v_now > v_asm.end_time) THEN
        v_finalize_res := public.internal_finalize_attempt(v_attempt.id, 'EXPIRED', 'Autosave after deadline elapsed');
        RETURN jsonb_build_object('success', false, 'status', 'EXPIRED', 'message', 'Assessment deadline elapsed');
    END IF;

    -- 3. Validate Question Belongs to Assessment
    SELECT * INTO v_q FROM public.assessment_questions
    WHERE id = p_question_id AND assessment_id = v_attempt.assessment_id;
    IF v_q IS NULL THEN
        RAISE EXCEPTION 'Question does not belong to this assessment' USING ERRCODE = '22023';
    END IF;

    -- 4. Authoritative Server-Side Correctness Check (Isolated Answer Keys)
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

    -- 5. Inspect Existing Answer for Idempotency & Accurate Timing
    SELECT * INTO v_existing FROM public.assessment_attempt_answers
    WHERE attempt_id = p_attempt_id AND question_id = p_question_id;

    IF v_existing IS NOT NULL THEN
        v_started_at := COALESCE(v_existing.question_started_at, v_attempt.started_at, v_now);

        -- Idempotent check: candidate re-saving identical option preserves original timestamp & score
        IF v_existing.selected_option_id IS NOT DISTINCT FROM p_selected_option_id
           AND v_existing.selected_boolean IS NOT DISTINCT FROM p_selected_boolean
        THEN
            RETURN jsonb_build_object('success', true, 'status', 'IN_PROGRESS', 'saved_at', v_existing.answered_at);
        ELSE
            -- Answer modified: Evaluate at new timestamp
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
        -- First answer submission
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

    -- 7. High-Performance Index-Covered Aggregate Query
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

    -- 8. Debounced Milestone Telemetry Stream (Write Amplification Reduction)
    -- Log live event only on meaningful milestones: first question, every 5 answers, or final question
    IF v_existing IS NULL AND (v_answered_count = 1 OR v_answered_count % 5 = 0 OR v_answered_count >= v_asm.total_questions_count) THEN
        INSERT INTO public.assessment_live_events (
            assessment_id, student_id, student_name, event_type, question_context, metadata
        ) VALUES (
            v_attempt.assessment_id,
            v_attempt.student_id,
            'Candidate',
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

    -- Security Boundary: Return only saved confirmation to student during exam
    RETURN jsonb_build_object('success', true, 'status', 'IN_PROGRESS', 'saved_at', v_answered_at);
END;
$$;

REVOKE ALL ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. OPTIMIZED public.get_assessment_live_host_snapshot (Single-Scan Overview + Joined Aggregates)
-- ------------------------------------------------------------------------------
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
    -- 1. Authoritative Permission Verification
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
    END IF;

    -- Unified Single Aggregate Scan over assessment_attempts (Replaces 7 individual queries)
    SELECT
        count(*),
        count(*) FILTER (WHERE status = 'IN_PROGRESS'),
        count(*) FILTER (WHERE status = 'SUBMITTED'),
        count(*) FILTER (WHERE status = 'EXPIRED'),
        count(*) FILTER (WHERE status = 'TERMINATED'),
        COALESCE(round(avg(question_score) FILTER (WHERE status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED')), 2), 0.00),
        COALESCE(max(question_score) FILTER (WHERE status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED')), 0.00),
        COALESCE(sum(strike_count), 0)
    INTO
        v_started_count,
        v_active_count,
        v_submitted_count,
        v_expired_count,
        v_terminated_count,
        v_avg_score,
        v_high_score,
        v_tab_switch_total
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id;

    -- 2. Participant Snapshots via Grouped JOIN (Eliminates Correlated Scalar Subqueries)
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
            'answered_count', COALESCE(ans_agg.answered_count, 0),
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
            END
        ) ORDER BY att.started_at DESC
    ), '[]'::jsonb)
    INTO v_participants
    FROM public.assessment_attempts att
    LEFT JOIN public.student_profiles sp ON sp.user_id = att.student_id
    LEFT JOIN (
        SELECT attempt_id, count(*) AS answered_count
        FROM public.assessment_attempt_answers
        WHERE selected_option_id IS NOT NULL OR selected_boolean IS NOT NULL
        GROUP BY attempt_id
    ) ans_agg ON ans_agg.attempt_id = att.id
    WHERE att.assessment_id = p_assessment_id;

    -- 3. Active Question Progress
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'question_id', q.id,
            'question_text', q.question_text,
            'sort_order', q.sort_order,
            'points', q.points,
            'time_limit_seconds', q.time_limit_seconds,
            'answered_count', (
                SELECT count(*)
                FROM public.assessment_attempt_answers ans
                JOIN public.assessment_attempts att ON att.id = ans.attempt_id
                WHERE ans.question_id = q.id
                  AND att.assessment_id = p_assessment_id
                  AND (ans.selected_option_id IS NOT NULL OR ans.selected_boolean IS NOT NULL)
            )
        ) ORDER BY q.sort_order ASC
    ), '[]'::jsonb)
    INTO v_question_progress
    FROM public.assessment_questions q
    WHERE q.assessment_id = p_assessment_id AND q.is_active_for_assessment = true;

    -- 4. Recent Realtime Activity Events
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', e.id,
            'event_type', e.event_type,
            'student_name', e.student_name,
            'question_context', e.question_context,
            'metadata', e.metadata,
            'created_at', e.created_at
        ) ORDER BY e.created_at DESC
    ), '[]'::jsonb)
    INTO v_recent_events
    FROM (
        SELECT *
        FROM public.assessment_live_events
        WHERE assessment_id = p_assessment_id
        ORDER BY created_at DESC
        LIMIT 25
    ) e;

    -- 5. Top-20 Live Scoreboard via Grouped JOIN
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'attempt_id', att.id,
            'student_id', att.student_id,
            'student_name', COALESCE(sp.full_name, 'Candidate'),
            'roll_number', sp.roll_number,
            'college_name', COALESCE(sp.college, ''),
            'question_score', att.question_score,
            'eos_points', att.eos_points,
            'total_score', (att.question_score + att.eos_points),
            'answered_count', COALESCE(ans_agg.answered_count, 0),
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
    LEFT JOIN public.student_profiles sp ON sp.user_id = att.student_id
    LEFT JOIN (
        SELECT attempt_id, count(*) AS answered_count
        FROM public.assessment_attempt_answers
        WHERE selected_option_id IS NOT NULL OR selected_boolean IS NOT NULL
        GROUP BY attempt_id
    ) ans_agg ON ans_agg.attempt_id = att.id;

    -- Return full contract with both recent_activity and recent_events
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

-- ------------------------------------------------------------------------------
-- 5. COORDINATOR 15-MINUTE IDLE INACTIVITY TIMEOUT
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_assessment_coordinator_access(
    p_assessment_id UUID,
    p_coordinator_token TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
    v_session RECORD;
    v_coord RECORD;
    v_asm RECORD;
    v_is_assigned BOOLEAN := false;
BEGIN
    -- 1. Allowlisted Administrator Bypass
    IF auth.uid() IS NOT NULL AND public.is_admin() THEN
        RETURN auth.uid();
    END IF;

    -- 2. Validate Assessment
    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    -- 3. Cryptographically Validate Coordinator Session Token
    IF p_coordinator_token IS NULL OR trim(p_coordinator_token) = '' THEN
        RAISE EXCEPTION 'Authentication required: neither administrator session nor coordinator token provided'
            USING ERRCODE = '42501';
    END IF;

    v_token_hash := encode(extensions.digest(trim(p_coordinator_token), 'sha256'), 'hex');

    SELECT * INTO v_session
    FROM public.coordinator_sessions
    WHERE token_hash = v_token_hash;

    IF v_session IS NULL THEN
        RAISE EXCEPTION 'Invalid coordinator session token' USING ERRCODE = '42501';
    END IF;

    -- Enforce absolute 1-hour expiration AND 15-minute idle inactivity timeout
    IF v_session.expires_at <= now()
       OR v_session.created_at <= (now() - interval '1 hour')
       OR (v_session.last_active_at IS NOT NULL AND v_session.last_active_at < (now() - interval '15 minutes'))
    THEN
        DELETE FROM public.coordinator_sessions WHERE token_hash = v_token_hash;
        RAISE EXCEPTION 'Coordinator session expired due to inactivity. Please log in again.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_coord
    FROM public.coordinators
    WHERE id = v_session.coordinator_id;

    IF v_coord IS NULL OR v_coord.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Coordinator account is inactive or not found' USING ERRCODE = '42501';
    END IF;

    -- Update last_active_at touch timestamp
    UPDATE public.coordinator_sessions
    SET last_active_at = now()
    WHERE token_hash = v_token_hash;

    -- 4. Verify Explicit Assessment Assignment
    IF v_asm.coordinator_id = v_coord.id THEN
        v_is_assigned := true;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM public.assessment_coordinator_assignments
            WHERE assessment_id = p_assessment_id AND coordinator_id = v_coord.id
        ) INTO v_is_assigned;
    END IF;

    IF NOT v_is_assigned THEN
        RAISE EXCEPTION 'Access denied: coordinator is not assigned to host this assessment'
            USING ERRCODE = '42501';
    END IF;

    RETURN v_coord.id;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_assessment_coordinator_access(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_assessment_coordinator_access(UUID, TEXT) TO authenticated, service_role;
