-- ============================================================================
-- Migration: 131_assessment_reports_and_automatic_closure.sql
-- Description: Post-Assessment Reporting, Student Performance Analytics, and 
--              Automatic Authoritative Assessment Closure & Finalization.
--
-- Features:
-- 1. Adds report_finalized_at, closed_at, and closed_by to public.assessments.
-- 2. Creates idempotent close_and_finalize_assessment(UUID, TEXT, UUID) function.
-- 3. Updates coordinator_close_assessment_early to use close_and_finalize_assessment.
-- 4. Updates assessment_scheduled_expiry_worker to automatically close assessments
--    whose scheduled end_time has passed and finalize lingering in-progress attempts.
-- 5. Creates get_assessment_report(UUID, TEXT) RPC returning:
--    - Comprehensive summary metrics & explicit denominators (eligible, participants, completed, incomplete)
--    - Student-level performance records with separate academic scores and EOS points
--    - Per-question response breakdown, accuracy rates, difficult questions flagging, and option distributions
--    - Optional post-assessment feedback statistics (if sub-event is linked)
--    - Server-side authorization via verify_assessment_coordinator_access
-- ============================================================================

-- 1. Schema Alterations
ALTER TABLE public.assessments
ADD COLUMN IF NOT EXISTS report_finalized_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS closed_by TEXT DEFAULT NULL;

COMMENT ON COLUMN public.assessments.report_finalized_at IS
'Timestamp when assessment results were frozen and post-assessment analytics were finalized.';

COMMENT ON COLUMN public.assessments.closed_at IS
'Authoritative server timestamp when examination was transitioned to CLOSED status.';

COMMENT ON COLUMN public.assessments.closed_by IS
'Entity responsible for closing examination: SYSTEM_SCHEDULE, COORDINATOR, or ADMIN.';

-- 2. Authoritative Assessment Closure & Report Finalization Routine
CREATE OR REPLACE FUNCTION public.close_and_finalize_assessment(
    p_assessment_id UUID,
    p_caller_type TEXT DEFAULT 'SYSTEM',
    p_caller_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_asm RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_att RECORD;
    v_closed_attempts_count INT := 0;
BEGIN
    -- Exclusively lock assessment record to serialize concurrent closure requests
    SELECT * INTO v_asm 
    FROM public.assessments 
    WHERE id = p_assessment_id 
    FOR UPDATE;

    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    -- If already CLOSED, ensure report_finalized_at is stamped and sweep lingering attempts
    IF v_asm.status = 'CLOSED' THEN
        IF v_asm.report_finalized_at IS NULL THEN
            UPDATE public.assessments
            SET report_finalized_at = COALESCE(v_asm.closed_at, v_now),
                updated_at = v_now
            WHERE id = p_assessment_id;
        END IF;

        -- Sweep any lingering active attempts just in case
        FOR v_att IN 
            SELECT id FROM public.assessment_attempts 
            WHERE assessment_id = p_assessment_id AND status = 'IN_PROGRESS'
        LOOP
            PERFORM public.internal_finalize_attempt(v_att.id, 'EXPIRED', 'Assessment closed: deadline elapsed');
            v_closed_attempts_count := v_closed_attempts_count + 1;
        END LOOP;

        RETURN jsonb_build_object(
            'success', true,
            'already_closed', true,
            'message', 'Assessment is already closed and finalized.',
            'finalized_at', COALESCE(v_asm.report_finalized_at, v_now),
            'expired_attempts_swept', v_closed_attempts_count
        );
    END IF;

    -- Transition status to CLOSED atomically
    UPDATE public.assessments
    SET status = 'CLOSED',
        end_time = LEAST(end_time, v_now),
        closed_at = v_now,
        closed_by = COALESCE(p_caller_type, 'SYSTEM'),
        report_finalized_at = v_now,
        updated_at = v_now
    WHERE id = p_assessment_id;

    -- Finalize all active attempts for this assessment
    FOR v_att IN 
        SELECT id FROM public.assessment_attempts 
        WHERE assessment_id = p_assessment_id AND status = 'IN_PROGRESS'
    LOOP
        PERFORM public.internal_finalize_attempt(v_att.id, 'EXPIRED', 'Assessment window closed: deadline elapsed');
        v_closed_attempts_count := v_closed_attempts_count + 1;
    END LOOP;

    -- Broadcast live event: ASSESSMENT_CLOSED
    INSERT INTO public.assessment_live_events (
        assessment_id,
        student_id,
        student_name,
        event_type,
        question_context,
        metadata
    ) VALUES (
        p_assessment_id,
        NULL,
        CASE WHEN p_caller_type = 'COORDINATOR' THEN 'HOST COORDINATOR' ELSE 'SYSTEM AUTOMATION' END,
        'ASSESSMENT_CLOSED',
        'Examination Finalized & Closed',
        jsonb_build_object(
            'caller_type', p_caller_type,
            'caller_id', p_caller_id,
            'timestamp', v_now,
            'expired_attempts_swept', v_closed_attempts_count
        )
    );

    -- Record Audit Log
    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, metadata, created_at
    ) VALUES (
        p_caller_id,
        'ASSESSMENT_CLOSED_AND_FINALIZED',
        'assessments',
        p_assessment_id,
        jsonb_build_object(
            'title', v_asm.title,
            'caller_type', p_caller_type,
            'finalized_at', v_now,
            'expired_attempts_swept', v_closed_attempts_count
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'closed', true,
        'finalized_at', v_now,
        'expired_attempts_swept', v_closed_attempts_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_and_finalize_assessment(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_and_finalize_assessment(UUID, TEXT, UUID) TO authenticated, service_role;

-- 3. Update coordinator_close_assessment_early to use close_and_finalize_assessment
CREATE OR REPLACE FUNCTION public.coordinator_close_assessment_early(
    p_assessment_id UUID,
    p_coordinator_token TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT 'Early closure triggered by host coordinator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
BEGIN
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);
    RETURN public.close_and_finalize_assessment(p_assessment_id, 'COORDINATOR', v_caller_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.coordinator_close_assessment_early(UUID, TEXT, TEXT) TO anon, authenticated, service_role;

-- 4. Update Scheduled Expiry Worker to Auto-Close Assessments at Scheduled End Time
CREATE OR REPLACE FUNCTION public.assessment_scheduled_expiry_worker()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asm RECORD;
    v_attempt RECORD;
    v_closed_assessments_count INT := 0;
    v_processed_attempts_count INT := 0;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    -- Security verification: Only internal postgres session (pg_cron), service_role, or active allowlisted ADMIN
    IF SESSION_USER != 'postgres' AND COALESCE(auth.role(), '') != 'service_role' THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'Access denied. Administrator privileges or service_role required.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 1. Automatically close published assessments whose scheduled end_time has arrived
    FOR v_asm IN
        SELECT id
        FROM public.assessments
        WHERE status = 'PUBLISHED'
          AND v_now >= end_time
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.close_and_finalize_assessment(v_asm.id, 'SCHEDULED_WORKER', NULL);
        v_closed_assessments_count := v_closed_assessments_count + 1;
    END LOOP;

    -- 2. Finalize any remaining lingering attempts whose individual deadline or assessment end_time elapsed
    FOR v_attempt IN
        SELECT a.id
        FROM public.assessment_attempts a
        JOIN public.assessments asm ON asm.id = a.assessment_id
        WHERE a.status = 'IN_PROGRESS'
          AND (v_now >= a.deadline OR v_now >= asm.end_time OR asm.status = 'CLOSED')
        ORDER BY a.deadline ASC
        LIMIT 100
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        PERFORM public.internal_finalize_attempt(v_attempt.id, 'EXPIRED', 'Scheduled background worker expiry');
        v_processed_attempts_count := v_processed_attempts_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'closed_assessments_count', v_closed_assessments_count,
        'processed_attempts_count', v_processed_attempts_count,
        'timestamp', v_now
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assessment_scheduled_expiry_worker() TO service_role, postgres;

-- 5. Comprehensive Post-Assessment Report & Analytics RPC
CREATE OR REPLACE FUNCTION public.get_assessment_report(
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
    v_now TIMESTAMPTZ := clock_timestamp();
    v_total_points NUMERIC(8,2) := 0.00;
    v_eligible_count INT := 0;
    v_participants_count INT := 0;
    v_completed_count INT := 0;
    v_expired_count INT := 0;
    v_terminated_count INT := 0;
    v_in_progress_count INT := 0;
    v_avg_academic_score NUMERIC(8,2) := 0.00;
    v_highest_academic_score NUMERIC(8,2) := 0.00;
    v_lowest_academic_score NUMERIC(8,2) := 0.00;
    v_avg_academic_percentage NUMERIC(5,2) := 0.00;
    v_avg_eos_points NUMERIC(8,2) := 0.00;
    v_highest_eos_points NUMERIC(8,2) := 0.00;
    v_avg_response_time_seconds NUMERIC(8,2) := 0.00;
    v_total_answers_submitted INT := 0;
    v_total_correct_answers INT := 0;
    v_avg_accuracy_percentage NUMERIC(5,2) := 0.00;
    v_completion_rate NUMERIC(5,2) := 0.00;
    v_students_json JSONB := '[]'::jsonb;
    v_questions_json JSONB := '[]'::jsonb;
    v_feedback_json JSONB := NULL;
    v_earliest_start TIMESTAMPTZ;
    v_latest_submit TIMESTAMPTZ;
BEGIN
    -- 1. Enforce strict authorization
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    -- 2. Self-healing closure: If assessment is PUBLISHED and end_time has passed, finalize it now
    IF v_asm.status = 'PUBLISHED' AND v_now >= v_asm.end_time THEN
        PERFORM public.close_and_finalize_assessment(p_assessment_id, 'AUTO_ON_REPORT_FETCH', v_caller_id);
        SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    END IF;

    -- 3. Calculate total possible points of active questions
    SELECT COALESCE(SUM(points), 0.00) INTO v_total_points
    FROM public.assessment_questions
    WHERE assessment_id = p_assessment_id AND is_active_for_assessment = true;

    -- 4. Calculate Explicit Participation Denominators
    -- Eligible Candidates: Confirmed sub-event registrations if sub-event is linked, else active student count
    IF v_asm.sub_event_id IS NOT NULL THEN
        SELECT count(*) INTO v_eligible_count
        FROM public.registrations
        WHERE sub_event_id = v_asm.sub_event_id AND status = 'CONFIRMED';
    ELSE
        SELECT count(*) INTO v_eligible_count
        FROM public.users
        WHERE role = 'STUDENT' AND status = 'ACTIVE';
    END IF;

    -- Distinct students who actually started an attempt
    SELECT count(DISTINCT student_id) INTO v_participants_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id;

    -- Completion status breakdowns
    SELECT count(*) INTO v_completed_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'SUBMITTED';

    SELECT count(*) INTO v_expired_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'EXPIRED';

    SELECT count(*) INTO v_terminated_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'TERMINATED';

    SELECT count(*) INTO v_in_progress_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'IN_PROGRESS';

    IF v_participants_count > 0 THEN
        v_completion_rate := round((v_completed_count * 100.0 / v_participants_count), 2);
    ELSE
        v_completion_rate := 0.00;
    END IF;

    -- Timing stats
    SELECT MIN(started_at), MAX(submitted_at) 
    INTO v_earliest_start, v_latest_submit
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id;

    -- 5. Calculate Score & Accuracy Aggregates across finalized attempts
    SELECT 
        COALESCE(round(avg(question_score), 2), 0.00),
        COALESCE(max(question_score), 0.00),
        COALESCE(min(question_score), 0.00),
        COALESCE(round(avg(eos_points), 2), 0.00),
        COALESCE(max(eos_points), 0.00),
        COALESCE(round(avg(total_response_time_seconds), 2), 0.00)
    INTO 
        v_avg_academic_score,
        v_highest_academic_score,
        v_lowest_academic_score,
        v_avg_eos_points,
        v_highest_eos_points,
        v_avg_response_time_seconds
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id 
      AND status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED');

    IF v_total_points > 0 THEN
        v_avg_academic_percentage := round((v_avg_academic_score * 100.0 / v_total_points), 2);
    ELSE
        v_avg_academic_percentage := 0.00;
    END IF;

    -- Accuracy: overall correct answers / total answers submitted
    SELECT 
        count(*),
        count(*) FILTER (WHERE ans.is_correct = true)
    INTO v_total_answers_submitted, v_total_correct_answers
    FROM public.assessment_attempt_answers ans
    JOIN public.assessment_attempts att ON att.id = ans.attempt_id
    WHERE att.assessment_id = p_assessment_id
      AND (ans.selected_option_id IS NOT NULL OR ans.selected_boolean IS NOT NULL);

    IF v_total_answers_submitted > 0 THEN
        v_avg_accuracy_percentage := round((v_total_correct_answers * 100.0 / v_total_answers_submitted), 2);
    ELSE
        v_avg_accuracy_percentage := 0.00;
    END IF;

    -- 6. Build Ranked Student Performance List (1 row per student's official attempt)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'rank', ranked_attempts.computed_rank,
            'student_id', ranked_attempts.student_id,
            'student_name', COALESCE(ranked_attempts.full_name, 'Anonymous Candidate'),
            'roll_number', COALESCE(ranked_attempts.roll_number, 'N/A'),
            'college_name', COALESCE(ranked_attempts.college_name, 'KITS Akshar'),
            'email', ranked_attempts.email,
            'attempt_id', ranked_attempts.id,
            'attempt_status', ranked_attempts.status,
            'academic_score', ranked_attempts.question_score,
            'max_score', v_total_points,
            'academic_percentage', CASE 
                WHEN v_total_points > 0 
                THEN round((ranked_attempts.question_score * 100.0 / v_total_points), 2)
                ELSE 0.00 
            END,
            'eos_points', ranked_attempts.eos_points,
            'correct_count', COALESCE(ranked_attempts.correct_count, 0),
            'incorrect_count', COALESCE(ranked_attempts.incorrect_count, 0),
            'unanswered_count', GREATEST(0, v_asm.total_questions_count - COALESCE(ranked_attempts.correct_count, 0) - COALESCE(ranked_attempts.incorrect_count, 0)),
            'total_response_time_seconds', COALESCE(ranked_attempts.total_response_time_seconds, 0.00),
            'started_at', ranked_attempts.started_at,
            'submitted_at', ranked_attempts.submitted_at,
            'is_passed', CASE 
                WHEN v_total_points > 0 
                THEN ((ranked_attempts.question_score * 100.0 / v_total_points) >= v_asm.passing_percentage)
                ELSE false 
            END
        ) ORDER BY ranked_attempts.computed_rank ASC, ranked_attempts.roll_number ASC
    ), '[]'::jsonb)
    INTO v_students_json
    FROM (
        SELECT 
            att.id,
            att.student_id,
            att.status,
            att.question_score,
            att.eos_points,
            att.total_response_time_seconds,
            att.started_at,
            att.submitted_at,
            sp.full_name,
            sp.roll_number,
            sp.college AS college_name,
            u.email,
            (
                SELECT count(*) 
                FROM public.assessment_attempt_answers ans 
                WHERE ans.attempt_id = att.id AND ans.is_correct = true
            ) AS correct_count,
            (
                SELECT count(*) 
                FROM public.assessment_attempt_answers ans 
                WHERE ans.attempt_id = att.id 
                  AND ans.is_correct = false 
                  AND (ans.selected_option_id IS NOT NULL OR ans.selected_boolean IS NOT NULL)
            ) AS incorrect_count,
            DENSE_RANK() OVER (
                ORDER BY att.question_score DESC, 
                         att.total_response_time_seconds ASC, 
                         att.started_at ASC
            ) AS computed_rank
        FROM public.assessment_attempts att
        LEFT JOIN public.student_profiles sp ON sp.user_id = att.student_id
        LEFT JOIN public.users u ON u.id = att.student_id
        WHERE att.assessment_id = p_assessment_id
    ) ranked_attempts;

    -- 7. Build Question-Level Performance Breakdown
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'question_id', q_stats.id,
            'question_number', q_stats.q_num,
            'sort_order', q_stats.sort_order,
            'question_text', q_stats.question_text,
            'question_type', q_stats.question_type,
            'points', q_stats.points,
            'time_limit_seconds', q_stats.time_limit_seconds,
            'total_responses', q_stats.total_responses,
            'correct_count', q_stats.correct_count,
            'incorrect_count', q_stats.incorrect_count,
            'unanswered_count', GREATEST(0, v_participants_count - q_stats.total_responses),
            'correct_percentage', CASE 
                WHEN v_participants_count > 0 
                THEN round((q_stats.correct_count * 100.0 / v_participants_count), 1)
                ELSE 0.0 
            END,
            'incorrect_percentage', CASE 
                WHEN v_participants_count > 0 
                THEN round((q_stats.incorrect_count * 100.0 / v_participants_count), 1)
                ELSE 0.0 
            END,
            'avg_response_time_seconds', q_stats.avg_resp_time,
            'is_difficult', (v_participants_count > 0 AND (q_stats.correct_count * 100.0 / v_participants_count) < 40.0),
            'correct_answer_preview', q_stats.correct_answer_text,
            'options_breakdown', q_stats.options_distribution
        ) ORDER BY q_stats.sort_order ASC, q_stats.q_num ASC
    ), '[]'::jsonb)
    INTO v_questions_json
    FROM (
        SELECT 
            q.id,
            q.sort_order,
            q.question_text,
            q.question_type,
            q.points,
            q.time_limit_seconds,
            ROW_NUMBER() OVER (ORDER BY q.sort_order ASC, q.created_at ASC) AS q_num,
            (
                SELECT count(*)
                FROM public.assessment_attempt_answers ans
                JOIN public.assessment_attempts att ON att.id = ans.attempt_id
                WHERE ans.question_id = q.id 
                  AND att.assessment_id = p_assessment_id
                  AND (ans.selected_option_id IS NOT NULL OR ans.selected_boolean IS NOT NULL)
            ) AS total_responses,
            (
                SELECT count(*)
                FROM public.assessment_attempt_answers ans
                JOIN public.assessment_attempts att ON att.id = ans.attempt_id
                WHERE ans.question_id = q.id 
                  AND att.assessment_id = p_assessment_id
                  AND ans.is_correct = true
            ) AS correct_count,
            (
                SELECT count(*)
                FROM public.assessment_attempt_answers ans
                JOIN public.assessment_attempts att ON att.id = ans.attempt_id
                WHERE ans.question_id = q.id 
                  AND att.assessment_id = p_assessment_id
                  AND ans.is_correct = false
                  AND (ans.selected_option_id IS NOT NULL OR ans.selected_boolean IS NOT NULL)
            ) AS incorrect_count,
            COALESCE((
                SELECT round(avg(ans.response_time_seconds), 2)
                FROM public.assessment_attempt_answers ans
                JOIN public.assessment_attempts att ON att.id = ans.attempt_id
                WHERE ans.question_id = q.id 
                  AND att.assessment_id = p_assessment_id
                  AND ans.response_time_seconds IS NOT NULL
            ), 0.00) AS avg_resp_time,
            (
                CASE 
                    WHEN q.question_type = 'TRUE_FALSE' THEN 
                        CASE WHEN (SELECT k.correct_boolean FROM public.assessment_question_keys k WHERE k.question_id = q.id LIMIT 1) IS TRUE THEN 'True' ELSE 'False' END
                    ELSE
                        (
                            SELECT opt.option_text 
                            FROM public.assessment_question_options opt
                            JOIN public.assessment_question_keys k ON k.option_id = opt.id
                            WHERE opt.question_id = q.id 
                            LIMIT 1
                        )
                END
            ) AS correct_answer_text,
            (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'option_id', opt.id,
                        'option_text', opt.option_text,
                        'sort_order', opt.sort_order,
                        'is_correct', (k.option_id = opt.id),
                        'selected_count', (
                            SELECT count(*)
                            FROM public.assessment_attempt_answers ans
                            JOIN public.assessment_attempts att ON att.id = ans.attempt_id
                            WHERE ans.selected_option_id = opt.id AND att.assessment_id = p_assessment_id
                        )
                    ) ORDER BY opt.sort_order ASC
                ), '[]'::jsonb)
                FROM public.assessment_question_options opt
                LEFT JOIN public.assessment_question_keys k ON k.question_id = q.id
                WHERE opt.question_id = q.id
            ) AS options_distribution
        FROM public.assessment_questions q
        WHERE q.assessment_id = p_assessment_id AND q.is_active_for_assessment = true
    ) q_stats;

    -- 8. Optional Feedback Aggregation
    IF v_asm.sub_event_id IS NOT NULL THEN
        SELECT jsonb_build_object(
            'has_feedback', (count(*) > 0),
            'total_responses', count(*),
            'avg_rating', COALESCE(round(avg((rating_1 + rating_2 + rating_3 + rating_4 + rating_5) / 5.0), 2), 0.00),
            'rating_1_avg', COALESCE(round(avg(rating_1), 2), 0.00),
            'rating_2_avg', COALESCE(round(avg(rating_2), 2), 0.00),
            'rating_3_avg', COALESCE(round(avg(rating_3), 2), 0.00),
            'rating_4_avg', COALESCE(round(avg(rating_4), 2), 0.00),
            'rating_5_avg', COALESCE(round(avg(rating_5), 2), 0.00),
            'sample_comments', COALESCE((
                SELECT jsonb_agg(comments)
                FROM (
                    SELECT comments 
                    FROM public.feedback_responses 
                    WHERE sub_event_id = v_asm.sub_event_id 
                      AND comments IS NOT NULL 
                      AND length(trim(comments)) > 0
                    LIMIT 10
                ) sub_c
            ), '[]'::jsonb)
        )
        INTO v_feedback_json
        FROM public.feedback_responses
        WHERE sub_event_id = v_asm.sub_event_id;
    END IF;

    -- 9. Construct Authoritative Comprehensive Report Payload
    RETURN jsonb_build_object(
        'success', true,
        'assessment', jsonb_build_object(
            'id', v_asm.id,
            'title', v_asm.title,
            'description', v_asm.description,
            'instructions', v_asm.instructions,
            'status', v_asm.status,
            'duration_minutes', v_asm.duration_minutes,
            'start_time', v_asm.start_time,
            'end_time', v_asm.end_time,
            'actual_start_time', COALESCE(v_earliest_start, v_asm.start_time),
            'actual_end_time', COALESCE(v_asm.closed_at, v_latest_submit, v_asm.end_time),
            'passing_percentage', v_asm.passing_percentage,
            'total_questions_count', v_asm.total_questions_count,
            'total_points', v_total_points,
            'report_finalized_at', COALESCE(v_asm.report_finalized_at, v_asm.closed_at, v_now),
            'closed_at', v_asm.closed_at,
            'closed_by', v_asm.closed_by,
            'is_closed', (v_asm.status = 'CLOSED')
        ),
        'summary', jsonb_build_object(
            'total_eligible', v_eligible_count,
            'total_participants', v_participants_count,
            'completed_attempts', v_completed_count,
            'expired_attempts', v_expired_count,
            'terminated_attempts', v_terminated_count,
            'in_progress_attempts', v_in_progress_count,
            'completion_rate', v_completion_rate,
            'avg_academic_score', v_avg_academic_score,
            'avg_academic_percentage', v_avg_academic_percentage,
            'highest_academic_score', v_highest_academic_score,
            'lowest_academic_score', v_lowest_academic_score,
            'avg_eos_points', v_avg_eos_points,
            'highest_eos_points', v_highest_eos_points,
            'avg_response_time_seconds', v_avg_response_time_seconds,
            'total_answers_submitted', v_total_answers_submitted,
            'total_correct_answers', v_total_correct_answers,
            'avg_accuracy_percentage', v_avg_accuracy_percentage
        ),
        'students', v_students_json,
        'questions', v_questions_json,
        'feedback', v_feedback_json,
        'generated_at', v_now
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_assessment_report(UUID, TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_assessment_report(UUID, TEXT) IS
'Authoritative post-assessment report generator. Generates Kahoot-inspired aggregate metrics, student performance standings with distinct marks and EOS points, and question difficulty breakdown. Restricted to assigned coordinators and authorized administrators.';
