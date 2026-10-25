-- ============================================================================
-- Migration: 117_assessment_system_foundation.sql
-- Description: Core schema, tables, triggers, RPCs, and RLS policies for the
--              KITS-EOS Assessment Platform.
-- Security:
--   - Administrative question authoring strictly gated via public.is_admin().
--   - Points constraint rejects NULL, non-positive, NaN, and Infinity.
--   - Realtime projection table contains zero attempt IDs or private student metadata.
--   - Inverted deduplication via assessment_attempts.leaderboard_event_id.
--   - Foreign-key-safe deletion order (keys before options).
--   - Transaction-safe expiry finalization with non-aborting client responses.
-- ============================================================================

-- ============================================================================
-- 1. TABLES AND RELATIONAL SCHEMAS
-- ============================================================================

-- 1.1 Root Assessments Table
CREATE TABLE IF NOT EXISTS public.assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED')),
    include_in_global_leaderboard BOOLEAN NOT NULL DEFAULT false,
    randomize_questions BOOLEAN NOT NULL DEFAULT false,
    randomize_options BOOLEAN NOT NULL DEFAULT false,
    event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
    sub_event_id UUID REFERENCES public.sub_events(id) ON DELETE SET NULL,
    passing_percentage NUMERIC(5,2) NOT NULL DEFAULT 40.00 CHECK (passing_percentage >= 0 AND passing_percentage <= 100),
    total_questions_count INTEGER NOT NULL DEFAULT 0 CHECK (total_questions_count >= 0),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_assessment_time_window CHECK (end_time > start_time)
);

-- 1.2 Assessment Questions Table
CREATE TABLE IF NOT EXISTS public.assessment_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL CHECK (length(trim(question_text)) > 0),
    question_type TEXT NOT NULL CHECK (question_type IN ('MCQ', 'TRUE_FALSE')),
    points NUMERIC(8,2) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_assessment_question_points CHECK (
        points IS NOT NULL 
        AND points > 0 
        AND points != 'NaN'::numeric 
        AND points::text NOT IN ('NaN', 'Infinity', '-Infinity', '+Infinity')
    )
);

-- 1.3 Assessment Question Options Table
CREATE TABLE IF NOT EXISTS public.assessment_question_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES public.assessment_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL CHECK (length(trim(option_text)) > 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.4 Assessment Question Answer Keys Table (Private - Revoked from Students)
CREATE TABLE IF NOT EXISTS public.assessment_question_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL UNIQUE REFERENCES public.assessment_questions(id) ON DELETE CASCADE,
    option_id UUID REFERENCES public.assessment_question_options(id) ON DELETE CASCADE,
    correct_boolean BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_key_mutual_exclusive CHECK (
        (option_id IS NOT NULL AND correct_boolean IS NULL) OR 
        (option_id IS NULL AND correct_boolean IS NOT NULL)
    )
);

-- 1.5 Sanitized Realtime Leaderboard Projection Table (Added to Realtime)
CREATE TABLE IF NOT EXISTS public.assessment_leaderboard_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    student_name TEXT NOT NULL,
    score NUMERIC(8,2) NOT NULL,
    finalized_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.6 Assessment Attempts Table
CREATE TABLE IF NOT EXISTS public.assessment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'TERMINATED')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deadline TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ,
    score NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    correct_answers_count INTEGER NOT NULL DEFAULT 0,
    strike_count INTEGER NOT NULL DEFAULT 0 CHECK (strike_count >= 0 AND strike_count <= 3),
    question_order UUID[] DEFAULT NULL,
    option_orders JSONB DEFAULT NULL,
    leaderboard_event_id UUID UNIQUE REFERENCES public.assessment_leaderboard_events(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_student_assessment_attempt UNIQUE (assessment_id, student_id)
);

-- 1.7 Assessment Attempt Answers Table
CREATE TABLE IF NOT EXISTS public.assessment_attempt_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.assessment_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.assessment_questions(id) ON DELETE CASCADE,
    selected_option_id UUID REFERENCES public.assessment_question_options(id) ON DELETE SET NULL,
    selected_boolean BOOLEAN,
    is_correct BOOLEAN,
    points_awarded NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_attempt_question UNIQUE (attempt_id, question_id),
    CONSTRAINT ck_attempt_answer_mutual_exclusive CHECK (
        (selected_option_id IS NOT NULL AND selected_boolean IS NULL) OR 
        (selected_option_id IS NULL AND selected_boolean IS NOT NULL)
    )
);

-- 1.8 Assessment Attempt Violations Table (Proctoring Tab-Switch Tracking)
CREATE TABLE IF NOT EXISTS public.assessment_attempt_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.assessment_attempts(id) ON DELETE CASCADE,
    episode_id UUID NOT NULL,
    violation_type TEXT NOT NULL DEFAULT 'TAB_SWITCH',
    violation_number INTEGER NOT NULL DEFAULT 1 CHECK (violation_number >= 1 AND violation_number <= 3),
    question_id UUID REFERENCES public.assessment_questions(id) ON DELETE SET NULL,
    attempted_questions_count INTEGER NOT NULL DEFAULT 0 CHECK (attempted_questions_count >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_attempt_violation_episode UNIQUE (attempt_id, episode_id)
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_assessments_status ON public.assessments(status);
CREATE INDEX IF NOT EXISTS idx_assessments_schedule ON public.assessments(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_assessments_sub_event_id ON public.assessments(sub_event_id);
CREATE INDEX IF NOT EXISTS idx_assessments_event_id ON public.assessments(event_id);
CREATE INDEX IF NOT EXISTS idx_assessment_questions_assessment_id ON public.assessment_questions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_question_options_question_id ON public.assessment_question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_assessment_id ON public.assessment_attempts(assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_student_id ON public.assessment_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_status_deadline ON public.assessment_attempts(status, deadline);
CREATE INDEX IF NOT EXISTS idx_assessment_attempt_answers_attempt_id ON public.assessment_attempt_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_assessment_attempt_violations_attempt_id ON public.assessment_attempt_violations(attempt_id);
CREATE INDEX IF NOT EXISTS idx_assessment_leaderboard_events_assessment_id ON public.assessment_leaderboard_events(assessment_id);

-- ============================================================================
-- 3. TRIGGERS FOR DATA IMMUTABILITY
-- ============================================================================

-- 3.1 Defense-in-depth trigger: question options can only be modified in DRAFT status
CREATE OR REPLACE FUNCTION public.trg_check_question_options_mutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT asm.status INTO v_status
        FROM public.assessments asm
        JOIN public.assessment_questions q ON q.assessment_id = asm.id
        WHERE q.id = OLD.question_id;

        -- If parent assessment/question is being cascade-deleted (v_status IS NULL), allow deletion
        IF v_status IS NOT NULL AND v_status IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'Cannot modify question options for assessment in status %', v_status
                USING ERRCODE = '22023';
        END IF;
        RETURN OLD;
    END IF;

    SELECT asm.status INTO v_status
    FROM public.assessments asm
    JOIN public.assessment_questions q ON q.assessment_id = asm.id
    WHERE q.id = NEW.question_id;

    IF v_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'Cannot modify question options for assessment in status %', v_status
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_question_options_immutable ON public.assessment_question_options;
CREATE TRIGGER trg_enforce_question_options_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.assessment_question_options
FOR EACH ROW EXECUTE FUNCTION public.trg_check_question_options_mutable();

-- ============================================================================
-- 4. SERVER-SIDE RPCs
-- ============================================================================

-- 4.1 Admin Save Question and Options (MCQ and True/False)
CREATE OR REPLACE FUNCTION public.admin_save_question_and_options(
    p_assessment_id UUID,
    p_question_id UUID,
    p_question_text TEXT,
    p_question_type TEXT,
    p_points NUMERIC,
    p_options JSONB, -- Array of objects: [{ "option_text": "...", "is_correct": true }]
    p_correct_boolean BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_existing_assessment_id UUID;
    v_opt JSONB;
    v_opt_id UUID;
    v_opt_text TEXT;
    v_is_correct BOOLEAN;
    v_correct_count INT := 0;
    v_opt_count INT := 0;
BEGIN
    -- 0. AUTHORIZATION CHECK: Enforce Active Allowlisted Admin or Service Role
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: administrative privileges required'
            USING ERRCODE = '42501';
    END IF;

    -- 1. HARDENED INPUT VALIDATION (Pre-Lock & Pre-DML)
    IF p_assessment_id IS NULL THEN
        RAISE EXCEPTION 'Assessment ID cannot be NULL' USING ERRCODE = '22023';
    END IF;

    IF p_question_text IS NULL OR length(trim(p_question_text)) = 0 THEN
        RAISE EXCEPTION 'Question text cannot be NULL, empty, or whitespace' USING ERRCODE = '22023';
    END IF;

    IF p_question_type IS NULL OR p_question_type NOT IN ('MCQ', 'TRUE_FALSE') THEN
        RAISE EXCEPTION 'Invalid question type: % (must be strictly MCQ or TRUE_FALSE)', p_question_type
            USING ERRCODE = '22023';
    END IF;

    IF p_points IS NULL 
       OR p_points = 'NaN'::numeric 
       OR p_points <= 0 
       OR p_points::text IN ('NaN', 'Infinity', '-Infinity', '+Infinity') THEN
        RAISE EXCEPTION 'Points must be a positive, finite non-NULL numeric value' USING ERRCODE = '22023';
    END IF;

    IF p_question_type = 'MCQ' THEN
        IF p_options IS NULL OR jsonb_typeof(p_options) != 'array' THEN
            RAISE EXCEPTION 'MCQ options must be a non-NULL JSON array' USING ERRCODE = '22023';
        END IF;

        v_opt_count := jsonb_array_length(p_options);
        IF v_opt_count < 3 OR v_opt_count > 5 THEN
            RAISE EXCEPTION 'MCQ questions must have between 3 and 5 options (received %)', v_opt_count
                USING ERRCODE = '22023';
        END IF;

        FOR v_opt IN SELECT * FROM jsonb_array_elements(p_options) LOOP
            IF jsonb_typeof(v_opt) != 'object' THEN
                RAISE EXCEPTION 'Malformed option element: option must be a JSON object' USING ERRCODE = '22023';
            END IF;

            v_opt_text := trim(v_opt->>'option_text');
            IF v_opt_text IS NULL OR length(v_opt_text) = 0 THEN
                RAISE EXCEPTION 'Option text cannot be NULL, empty, or whitespace' USING ERRCODE = '22023';
            END IF;

            IF v_opt->'is_correct' IS NULL OR jsonb_typeof(v_opt->'is_correct') != 'boolean' THEN
                RAISE EXCEPTION 'Option is_correct must be a non-NULL boolean' USING ERRCODE = '22023';
            END IF;

            IF (v_opt->>'is_correct')::BOOLEAN IS TRUE THEN
                v_correct_count := v_correct_count + 1;
            END IF;
        END LOOP;

        IF v_correct_count != 1 THEN
            RAISE EXCEPTION 'MCQ question must have exactly one correct option (found %)', v_correct_count
                USING ERRCODE = '22023';
        END IF;

    ELSIF p_question_type = 'TRUE_FALSE' THEN
        IF p_correct_boolean IS NULL THEN
            RAISE EXCEPTION 'True/False questions require a non-NULL boolean correct answer' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 2. ROOT LOCK: Serializes against concurrent publication and edits
    SELECT status INTO v_status
    FROM public.assessments
    WHERE id = p_assessment_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'Assessment is in % status and cannot be modified', v_status
            USING ERRCODE = '22023';
    END IF;

    -- 3. QUESTION OWNERSHIP VALIDATION: Prevent cross-assessment corruption
    IF p_question_id IS NOT NULL THEN
        SELECT assessment_id INTO v_existing_assessment_id
        FROM public.assessment_questions
        WHERE id = p_question_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Question % not found', p_question_id USING ERRCODE = 'P0002';
        END IF;

        IF v_existing_assessment_id IS DISTINCT FROM p_assessment_id THEN
            RAISE EXCEPTION 'Cross-assessment modification rejected: question % belongs to assessment %, not %',
                p_question_id, v_existing_assessment_id, p_assessment_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 4. ATOMIC MUTATION WITH FOREIGN-KEY-SAFE DELETION ORDER
    IF p_question_type = 'MCQ' THEN
        IF p_question_id IS NULL THEN
            INSERT INTO public.assessment_questions (id, assessment_id, question_text, question_type, points)
            VALUES (gen_random_uuid(), p_assessment_id, trim(p_question_text), 'MCQ', p_points)
            RETURNING id INTO p_question_id;
        ELSE
            UPDATE public.assessment_questions
            SET question_text = trim(p_question_text),
                question_type = 'MCQ',
                points = p_points,
                updated_at = clock_timestamp()
            WHERE id = p_question_id AND assessment_id = p_assessment_id;
        END IF;

        -- FK-SAFE DELETION ORDER: Delete child keys before referenced options!
        DELETE FROM public.assessment_question_keys WHERE question_id = p_question_id;
        DELETE FROM public.assessment_question_options WHERE question_id = p_question_id;

        FOR v_opt IN SELECT * FROM jsonb_array_elements(p_options) LOOP
            INSERT INTO public.assessment_question_options (question_id, option_text)
            VALUES (p_question_id, trim(v_opt->>'option_text'))
            RETURNING id INTO v_opt_id;

            IF (v_opt->>'is_correct')::BOOLEAN IS TRUE THEN
                INSERT INTO public.assessment_question_keys (question_id, option_id, correct_boolean)
                VALUES (p_question_id, v_opt_id, NULL);
            END IF;
        END LOOP;

    ELSIF p_question_type = 'TRUE_FALSE' THEN
        IF p_question_id IS NULL THEN
            INSERT INTO public.assessment_questions (id, assessment_id, question_text, question_type, points)
            VALUES (gen_random_uuid(), p_assessment_id, trim(p_question_text), 'TRUE_FALSE', p_points)
            RETURNING id INTO p_question_id;
        ELSE
            UPDATE public.assessment_questions
            SET question_text = trim(p_question_text),
                question_type = 'TRUE_FALSE',
                points = p_points,
                updated_at = clock_timestamp()
            WHERE id = p_question_id AND assessment_id = p_assessment_id;
        END IF;

        -- FK-SAFE DELETION ORDER: Delete child keys before referenced options!
        DELETE FROM public.assessment_question_keys WHERE question_id = p_question_id;
        DELETE FROM public.assessment_question_options WHERE question_id = p_question_id;

        INSERT INTO public.assessment_question_keys (question_id, option_id, correct_boolean)
        VALUES (p_question_id, NULL, p_correct_boolean);
    END IF;

    -- Update total questions count on parent assessment
    UPDATE public.assessments
    SET total_questions_count = (SELECT count(*) FROM public.assessment_questions WHERE assessment_id = p_assessment_id),
        updated_at = clock_timestamp()
    WHERE id = p_assessment_id;

    RETURN jsonb_build_object('success', true, 'question_id', p_question_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_question_and_options(UUID, UUID, TEXT, TEXT, NUMERIC, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_question_and_options(UUID, UUID, TEXT, TEXT, NUMERIC, JSONB, BOOLEAN) TO authenticated, service_role;

-- 4.2 Admin Get Assessment Questions (RPC-only key inspection)
CREATE OR REPLACE FUNCTION public.admin_get_assessment_questions(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: administrative privileges required'
            USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', q.id,
            'assessment_id', q.assessment_id,
            'question_text', q.question_text,
            'question_type', q.question_type,
            'points', q.points,
            'sort_order', q.sort_order,
            'options', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'id', opt.id,
                        'option_text', opt.option_text,
                        'sort_order', opt.sort_order,
                        'is_correct', (k.option_id = opt.id)
                    ) ORDER BY opt.sort_order ASC, opt.created_at ASC
                ), '[]'::jsonb)
                FROM public.assessment_question_options opt
                LEFT JOIN public.assessment_question_keys k ON k.question_id = q.id
                WHERE opt.question_id = q.id
            ),
            'correct_boolean', k_tf.correct_boolean
        ) ORDER BY q.sort_order ASC, q.created_at ASC
    ), '[]'::jsonb) INTO v_result
    FROM public.assessment_questions q
    LEFT JOIN public.assessment_question_keys k_tf ON k_tf.question_id = q.id AND q.question_type = 'TRUE_FALSE'
    WHERE q.assessment_id = p_assessment_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_assessment_questions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_assessment_questions(UUID) TO authenticated, service_role;

-- 4.3 Admin Publish Assessment
CREATE OR REPLACE FUNCTION public.admin_publish_assessment(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_q_count INT := 0;
    v_invalid_mcq_count INT := 0;
    v_invalid_tf_count INT := 0;
BEGIN
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: administrative privileges required' USING ERRCODE = '42501';
    END IF;

    -- Exclusive root lock
    SELECT status INTO v_status FROM public.assessments WHERE id = p_assessment_id FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'Cannot publish assessment in % status', v_status USING ERRCODE = '22023';
    END IF;

    -- Validate question count
    SELECT count(*) INTO v_q_count FROM public.assessment_questions WHERE assessment_id = p_assessment_id;
    IF v_q_count < 1 THEN
        RAISE EXCEPTION 'Assessment must have at least one question before publication' USING ERRCODE = '22023';
    END IF;

    -- Validate each MCQ has exactly 1 valid answer key and 3-5 options
    SELECT count(*) INTO v_invalid_mcq_count
    FROM public.assessment_questions q
    WHERE q.assessment_id = p_assessment_id
      AND q.question_type = 'MCQ'
      AND (
          (SELECT count(*) FROM public.assessment_question_options opt WHERE opt.question_id = q.id) NOT BETWEEN 3 AND 5
          OR (SELECT count(*) FROM public.assessment_question_keys k WHERE k.question_id = q.id AND k.option_id IS NOT NULL) != 1
      );

    IF v_invalid_mcq_count > 0 THEN
        RAISE EXCEPTION 'Cannot publish: % MCQ question(s) have invalid option counts or missing/multiple keys', v_invalid_mcq_count
            USING ERRCODE = '22023';
    END IF;

    -- Validate each True/False has 0 options and exactly 1 boolean key
    SELECT count(*) INTO v_invalid_tf_count
    FROM public.assessment_questions q
    WHERE q.assessment_id = p_assessment_id
      AND q.question_type = 'TRUE_FALSE'
      AND (
          (SELECT count(*) FROM public.assessment_question_options opt WHERE opt.question_id = q.id) != 0
          OR (SELECT count(*) FROM public.assessment_question_keys k WHERE k.question_id = q.id AND k.correct_boolean IS NOT NULL) != 1
      );

    IF v_invalid_tf_count > 0 THEN
        RAISE EXCEPTION 'Cannot publish: % True/False question(s) have child options or missing boolean keys', v_invalid_tf_count
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.assessments
    SET status = 'PUBLISHED',
        total_questions_count = v_q_count,
        updated_at = clock_timestamp()
    WHERE id = p_assessment_id;

    RETURN jsonb_build_object('success', true, 'status', 'PUBLISHED', 'questions_count', v_q_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_publish_assessment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_publish_assessment(UUID) TO authenticated, service_role;

-- 4.3 Internal Finalize Attempt (Atomic, Idempotent, Unified Timestamp)
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
    v_finalized_at TIMESTAMPTZ;
    v_total_score NUMERIC(8,2) := 0.00;
    v_correct_count INT := 0;
    v_event_id UUID;
    v_rec RECORD;
    v_is_correct BOOLEAN;
    v_awarded NUMERIC(8,2);
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
            'score', v_attempt.score
        );
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = v_attempt.assessment_id;
    SELECT full_name INTO v_student_name FROM public.student_profiles WHERE user_id = v_attempt.student_id;
    v_student_name := COALESCE(NULLIF(trim(v_student_name), ''), 'Anonymous Candidate');

    -- Capture single authoritative timestamp
    v_finalized_at := clock_timestamp();

    -- Calculate scores from saved answers against private question keys
    FOR v_rec IN 
        SELECT 
            ans.id AS answer_id,
            ans.selected_option_id,
            ans.selected_boolean,
            q.question_type,
            q.points,
            k.option_id AS correct_option_id,
            k.correct_boolean AS correct_boolean
        FROM public.assessment_attempt_answers ans
        JOIN public.assessment_questions q ON q.id = ans.question_id
        LEFT JOIN public.assessment_question_keys k ON k.question_id = q.id
        WHERE ans.attempt_id = p_attempt_id
    LOOP
        v_is_correct := false;
        v_awarded := 0.00;

        IF v_rec.question_type = 'MCQ' THEN
            IF v_rec.selected_option_id IS NOT NULL AND v_rec.selected_option_id = v_rec.correct_option_id THEN
                v_is_correct := true;
                v_awarded := v_rec.points;
            END IF;
        ELSIF v_rec.question_type = 'TRUE_FALSE' THEN
            IF v_rec.selected_boolean IS NOT NULL AND v_rec.selected_boolean = v_rec.correct_boolean THEN
                v_is_correct := true;
                v_awarded := v_rec.points;
            END IF;
        END IF;

        IF v_is_correct THEN
            v_total_score := v_total_score + v_awarded;
            v_correct_count := v_correct_count + 1;
        END IF;

        UPDATE public.assessment_attempt_answers
        SET is_correct = v_is_correct,
            points_awarded = v_awarded
        WHERE id = v_rec.answer_id;
    END LOOP;

    -- Insert into sanitized leaderboard projection table
    INSERT INTO public.assessment_leaderboard_events (
        assessment_id, student_name, score, finalized_at
    )
    VALUES (
        v_attempt.assessment_id, COALESCE(v_student_name, 'Anonymous Candidate'), v_total_score, v_finalized_at
    )
    RETURNING id INTO v_event_id;

    -- Update attempt record synchronously
    UPDATE public.assessment_attempts
    SET status = p_final_status,
        submitted_at = v_finalized_at,
        score = v_total_score,
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
            'score', v_total_score,
            'correct_count', v_correct_count,
            'finalized_at', v_finalized_at
        ),
        v_finalized_at
    );

    RETURN jsonb_build_object(
        'success', true,
        'status', p_final_status,
        'score', v_total_score,
        'correct_count', v_correct_count,
        'finalized_at', v_finalized_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.internal_finalize_attempt(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_finalize_attempt(UUID, TEXT, TEXT) TO service_role;

-- 4.4 Student Start or Resume Attempt
CREATE OR REPLACE FUNCTION public.student_start_or_resume_attempt(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_asm RECORD;
    v_existing RECORD;
    v_user_rec RECORD;
    v_profile_status TEXT;
    v_calculated_deadline TIMESTAMPTZ;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_new_id UUID;
    v_q_order UUID[];
    v_opt_orders JSONB;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- 0. Server-side Student Status Verification (Item 4)
    SELECT status, role INTO v_user_rec FROM public.users WHERE id = v_uid;
    IF v_user_rec IS NULL OR v_user_rec.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Account is not active or eligible to take assessments' USING ERRCODE = '42501';
    END IF;

    SELECT account_status INTO v_profile_status FROM public.student_profiles WHERE user_id = v_uid;
    IF v_profile_status IS NOT NULL AND v_profile_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Student account is suspended and cannot take assessments' USING ERRCODE = '42501';
    END IF;

    -- 1. Check existing attempt (Item 5 & Item 6)
    SELECT * INTO v_existing 
    FROM public.assessment_attempts 
    WHERE assessment_id = p_assessment_id AND student_id = v_uid;

    IF v_existing IS NOT NULL THEN
        -- If in progress, check if deadline elapsed
        IF v_existing.status = 'IN_PROGRESS' AND v_now >= v_existing.deadline THEN
            PERFORM public.internal_finalize_attempt(v_existing.id, 'EXPIRED', 'Deadline elapsed during resume check');
            SELECT * INTO v_existing FROM public.assessment_attempts WHERE id = v_existing.id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'is_resumed', true,
            'attempt_id', v_existing.id,
            'status', v_existing.status,
            'deadline', v_existing.deadline,
            'score', v_existing.score,
            'strike_count', v_existing.strike_count,
            'question_order', v_existing.question_order,
            'option_orders', v_existing.option_orders
        );
    END IF;

    -- 2. Verify Assessment Eligibility
    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_asm.status != 'PUBLISHED' THEN
        RAISE EXCEPTION 'Assessment is not currently published' USING ERRCODE = '22023';
    END IF;

    IF v_now < v_asm.start_time THEN
        RAISE EXCEPTION 'Assessment has not started yet' USING ERRCODE = '22023';
    END IF;

    IF v_now >= v_asm.end_time THEN
        RAISE EXCEPTION 'Assessment window has closed' USING ERRCODE = '22023';
    END IF;

    -- Calculate authoritative immutable deadline (Item 6: earlier of duration and end_time)
    v_calculated_deadline := LEAST(v_now + (v_asm.duration_minutes || ' minutes')::INTERVAL, v_asm.end_time);

    -- 3. Generate Stable Randomized Question & Option Layout (Item 3)
    IF v_asm.randomize_questions THEN
        SELECT array_agg(id ORDER BY random()) INTO v_q_order
        FROM public.assessment_questions
        WHERE assessment_id = p_assessment_id;
    ELSE
        SELECT array_agg(id ORDER BY sort_order ASC, created_at ASC) INTO v_q_order
        FROM public.assessment_questions
        WHERE assessment_id = p_assessment_id;
    END IF;

    IF v_asm.randomize_options THEN
        SELECT jsonb_object_agg(q_id, opt_ids) INTO v_opt_orders
        FROM (
            SELECT 
                opt.question_id::text AS q_id,
                jsonb_agg(opt.id ORDER BY random()) AS opt_ids
            FROM public.assessment_question_options opt
            JOIN public.assessment_questions q ON q.id = opt.question_id
            WHERE q.assessment_id = p_assessment_id
            GROUP BY opt.question_id
        ) sub;
    ELSE
        SELECT jsonb_object_agg(q_id, opt_ids) INTO v_opt_orders
        FROM (
            SELECT 
                opt.question_id::text AS q_id,
                jsonb_agg(opt.id ORDER BY opt.sort_order ASC, opt.created_at ASC) AS opt_ids
            FROM public.assessment_question_options opt
            JOIN public.assessment_questions q ON q.id = opt.question_id
            WHERE q.assessment_id = p_assessment_id
            GROUP BY opt.question_id
        ) sub;
    END IF;

    -- Create new attempt with stable persisted order
    INSERT INTO public.assessment_attempts (
        assessment_id, student_id, status, started_at, deadline, question_order, option_orders
    )
    VALUES (
        p_assessment_id, v_uid, 'IN_PROGRESS', v_now, v_calculated_deadline, v_q_order, v_opt_orders
    )
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'success', true,
        'is_resumed', false,
        'attempt_id', v_new_id,
        'status', 'IN_PROGRESS',
        'deadline', v_calculated_deadline,
        'score', 0,
        'strike_count', 0,
        'question_order', v_q_order,
        'option_orders', v_opt_orders
    );
END;
$$;

REVOKE ALL ON FUNCTION public.student_start_or_resume_attempt(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_start_or_resume_attempt(UUID) TO authenticated, service_role;

-- 4.5 Student Autosave Answer (Transaction-Safe Expiry)
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
    v_finalize_res JSONB;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    -- 1. Row Lock & Ownership Assertion
    SELECT * INTO v_attempt 
    FROM public.assessment_attempts 
    WHERE id = p_attempt_id 
    FOR UPDATE;

    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Access denied: attempt does not belong to the calling student'
            USING ERRCODE = '42501';
    END IF;

    -- If already finalized, exit gracefully
    IF v_attempt.status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED') THEN
        RETURN jsonb_build_object(
            'success', false,
            'expired', (v_attempt.status = 'EXPIRED'),
            'status', v_attempt.status,
            'message', 'Attempt is already finalized.',
            'score', v_attempt.score
        );
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = v_attempt.assessment_id;

    -- 2. Transaction-Safe Expiry Check
    IF v_now >= v_attempt.deadline OR v_now >= v_asm.end_time OR v_asm.status = 'CLOSED' THEN
        v_finalize_res := public.internal_finalize_attempt(
            v_attempt.id, 'EXPIRED', 'Autosave rejected: deadline elapsed or assessment closed'
        );

        -- Clean commit with structured response
        RETURN jsonb_build_object(
            'success', false,
            'expired', true,
            'status', 'EXPIRED',
            'message', 'Assessment deadline has elapsed. Your attempt has been finalized.',
            'score', v_finalize_res->'score'
        );
    END IF;

    -- 3. Verify Question and Answer Types
    SELECT * INTO v_q FROM public.assessment_questions 
    WHERE id = p_question_id AND assessment_id = v_attempt.assessment_id;
    
    IF v_q IS NULL THEN
        RAISE EXCEPTION 'Question % does not belong to this assessment', p_question_id USING ERRCODE = '22023';
    END IF;

    IF v_q.question_type = 'MCQ' THEN
        IF p_selected_option_id IS NULL OR p_selected_boolean IS NOT NULL THEN
            RAISE EXCEPTION 'MCQ questions require selected_option_id and NULL selected_boolean' USING ERRCODE = '22023';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM public.assessment_question_options WHERE id = p_selected_option_id AND question_id = p_question_id) THEN
            RAISE EXCEPTION 'Selected option does not belong to question %', p_question_id USING ERRCODE = '22023';
        END IF;
    ELSIF v_q.question_type = 'TRUE_FALSE' THEN
        IF p_selected_boolean IS NULL OR p_selected_option_id IS NOT NULL THEN
            RAISE EXCEPTION 'True/False questions require selected_boolean and NULL selected_option_id' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 4. Persist Answer
    INSERT INTO public.assessment_attempt_answers (
        attempt_id, question_id, selected_option_id, selected_boolean, answered_at
    )
    VALUES (
        v_attempt.id, p_question_id, p_selected_option_id, p_selected_boolean, v_now
    )
    ON CONFLICT (attempt_id, question_id) 
    DO UPDATE SET 
        selected_option_id = EXCLUDED.selected_option_id,
        selected_boolean = EXCLUDED.selected_boolean,
        answered_at = EXCLUDED.answered_at;

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) TO authenticated, service_role;

-- 4.6 Student Submit Attempt
CREATE OR REPLACE FUNCTION public.student_submit_attempt(p_attempt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt RECORD;
    v_asm RECORD;
    v_final_status TEXT := 'SUBMITTED';
    v_reason TEXT := 'Student voluntary submission';
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
            'already_finalized', true,
            'status', v_attempt.status,
            'score', v_attempt.score
        );
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = v_attempt.assessment_id;

    -- If past deadline, finalize as EXPIRED rather than SUBMITTED
    IF clock_timestamp() >= v_attempt.deadline OR clock_timestamp() >= v_asm.end_time OR v_asm.status = 'CLOSED' THEN
        v_final_status := 'EXPIRED';
        v_reason := 'Submitted after deadline elapsed';
    END IF;

    v_finalize_res := public.internal_finalize_attempt(v_attempt.id, v_final_status, v_reason);

    RETURN jsonb_build_object(
        'success', true,
        'status', v_finalize_res->'status',
        'score', v_finalize_res->'score'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.student_submit_attempt(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_submit_attempt(UUID) TO authenticated, service_role;

-- 4.7 Student Record Proctoring Violation (Atomic Deduplication & Context Logging)
CREATE OR REPLACE FUNCTION public.student_record_violation(
    p_attempt_id UUID,
    p_episode_id UUID,
    p_violation_type TEXT DEFAULT 'TAB_SWITCH',
    p_question_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt RECORD;
    v_asm RECORD;
    v_inserted BOOLEAN := false;
    v_new_strike_count INT;
    v_attempted_count INT := 0;
    v_now TIMESTAMPTZ := clock_timestamp();
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
            'success', false,
            'already_finalized', true,
            'status', v_attempt.status
        );
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = v_attempt.assessment_id;

    -- Check expiry first
    IF v_now >= v_attempt.deadline OR v_now >= v_asm.end_time OR v_asm.status = 'CLOSED' THEN
        v_finalize_res := public.internal_finalize_attempt(v_attempt.id, 'EXPIRED', 'Violation recorded after deadline elapsed');
        RETURN jsonb_build_object(
            'success', false,
            'expired', true,
            'status', 'EXPIRED',
            'score', v_finalize_res->'score'
        );
    END IF;

    -- Compute attempted questions count at time of violation
    SELECT count(*) INTO v_attempted_count
    FROM public.assessment_attempt_answers
    WHERE attempt_id = v_attempt.id
      AND (selected_option_id IS NOT NULL OR selected_boolean IS NOT NULL);

    v_new_strike_count := v_attempt.strike_count + 1;

    -- Deduplicate episode_id via UNIQUE constraint
    BEGIN
        INSERT INTO public.assessment_attempt_violations (
            attempt_id, episode_id, violation_type, violation_number, question_id, attempted_questions_count, recorded_at
        )
        VALUES (
            v_attempt.id, p_episode_id, p_violation_type, v_new_strike_count, p_question_id, v_attempted_count, v_now
        );
        v_inserted := true;
    EXCEPTION WHEN unique_violation THEN
        v_inserted := false;
    END;

    IF NOT v_inserted THEN
        RETURN jsonb_build_object(
            'success', true,
            'deduplicated', true,
            'strike_count', v_attempt.strike_count
        );
    END IF;

    IF v_new_strike_count >= 3 THEN
        v_finalize_res := public.internal_finalize_attempt(v_attempt.id, 'TERMINATED', 'Three strikes exceeded: proctoring violations');
        UPDATE public.assessment_attempts SET strike_count = 3 WHERE id = v_attempt.id;
        RETURN jsonb_build_object(
            'success', true,
            'terminated', true,
            'strike_count', 3,
            'status', 'TERMINATED',
            'score', v_finalize_res->'score'
        );
    ELSE
        UPDATE public.assessment_attempts SET strike_count = v_new_strike_count, updated_at = v_now WHERE id = v_attempt.id;
        RETURN jsonb_build_object(
            'success', true,
            'terminated', false,
            'strike_count', v_new_strike_count
        );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.student_record_violation(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_record_violation(UUID, UUID, TEXT, UUID) TO authenticated, service_role;

-- 4.9 Get Assessment Leaderboard (Independent of include_in_global_leaderboard)
CREATE OR REPLACE FUNCTION public.get_assessment_leaderboard(p_assessment_id UUID)
RETURNS TABLE (
    rank BIGINT,
    student_name TEXT,
    score NUMERIC(8,2)
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
                a.score DESC,
                EXTRACT(EPOCH FROM (a.submitted_at - a.started_at)) ASC,
                a.submitted_at ASC,
                COALESCE(NULLIF(trim(st.full_name), ''), 'Anonymous Candidate') ASC,
                a.id ASC
        ) AS rank,
        COALESCE(NULLIF(trim(st.full_name), ''), 'Anonymous Candidate') AS student_name,
        a.score
    FROM public.assessment_attempts a
    LEFT JOIN public.student_profiles st ON st.user_id = a.student_id
    WHERE a.assessment_id = p_assessment_id
      AND a.status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED')
    ORDER BY rank ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_assessment_leaderboard(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assessment_leaderboard(UUID) TO anon, authenticated, service_role;

-- 4.10 Get Global Assessment Leaderboard (Strictly Aggregates include_in_global_leaderboard = true)
CREATE OR REPLACE FUNCTION public.get_global_assessment_leaderboard()
RETURNS TABLE (
    rank BIGINT,
    student_name TEXT,
    total_score NUMERIC(8,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH student_aggregates AS (
        SELECT
            a.student_id,
            COALESCE(NULLIF(trim(st.full_name), ''), 'Anonymous Candidate') AS student_name,
            SUM(a.score) AS total_score,
            COUNT(DISTINCT a.assessment_id) AS assessments_completed_count,
            SUM(a.correct_answers_count) AS total_correct_answers,
            SUM(EXTRACT(EPOCH FROM (a.submitted_at - a.started_at)))::BIGINT AS cumulative_time_seconds,
            MAX(a.submitted_at) AS latest_attempt_completed_at
        FROM public.assessment_attempts a
        JOIN public.assessments asm ON asm.id = a.assessment_id
        LEFT JOIN public.student_profiles st ON st.user_id = a.student_id
        WHERE asm.status IN ('PUBLISHED', 'CLOSED')
          AND asm.include_in_global_leaderboard = true
          AND a.status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED')
        GROUP BY a.student_id, COALESCE(NULLIF(trim(st.full_name), ''), 'Anonymous Candidate')
    )
    SELECT
        DENSE_RANK() OVER (
            ORDER BY
                sa.total_score DESC,
                sa.assessments_completed_count DESC,
                sa.total_correct_answers DESC,
                sa.cumulative_time_seconds ASC,
                sa.latest_attempt_completed_at ASC,
                sa.student_name ASC,
                sa.student_id ASC
        ) AS rank,
        sa.student_name,
        sa.total_score
    FROM student_aggregates sa
    ORDER BY rank ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_global_assessment_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_global_assessment_leaderboard() TO anon, authenticated, service_role;

-- 4.11 Assessment Scheduled Expiry Worker (Autonomous Background Sweeper)
CREATE OR REPLACE FUNCTION public.assessment_scheduled_expiry_worker()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt RECORD;
    v_processed_count INT := 0;
BEGIN
    -- Security verification: Only internal postgres session (pg_cron), service_role, or active allowlisted ADMIN
    IF SESSION_USER != 'postgres' AND COALESCE(auth.role(), '') != 'service_role' THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'Access denied. Administrator privileges or service_role required.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    FOR v_attempt IN
        SELECT a.id
        FROM public.assessment_attempts a
        JOIN public.assessments asm ON asm.id = a.assessment_id
        WHERE a.status = 'IN_PROGRESS'
          AND (clock_timestamp() >= a.deadline OR clock_timestamp() >= asm.end_time OR asm.status = 'CLOSED')
        ORDER BY a.deadline ASC
        LIMIT 50
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        PERFORM public.internal_finalize_attempt(v_attempt.id, 'EXPIRED', 'Scheduled background worker expiry');
        v_processed_count := v_processed_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'processed_count', v_processed_count,
        'timestamp', clock_timestamp()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.assessment_scheduled_expiry_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_scheduled_expiry_worker() TO service_role, postgres;

-- 4.12 Admin Update Assessment Metadata (DRAFT only)
CREATE OR REPLACE FUNCTION public.admin_update_assessment(
    p_assessment_id UUID,
    p_title TEXT,
    p_description TEXT,
    p_instructions TEXT,
    p_duration_minutes INT,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_passing_percentage NUMERIC,
    p_include_in_global_leaderboard BOOLEAN,
    p_randomize_questions BOOLEAN,
    p_randomize_options BOOLEAN,
    p_event_id UUID DEFAULT NULL,
    p_sub_event_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: administrative privileges required' USING ERRCODE = '42501';
    END IF;

    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
        RAISE EXCEPTION 'Assessment title cannot be empty' USING ERRCODE = '22023';
    END IF;

    IF p_duration_minutes <= 0 THEN
        RAISE EXCEPTION 'Duration must be greater than 0' USING ERRCODE = '22023';
    END IF;

    IF p_end_time <= p_start_time THEN
        RAISE EXCEPTION 'End time must be after start time' USING ERRCODE = '22023';
    END IF;

    IF p_passing_percentage < 0 OR p_passing_percentage > 100 THEN
        RAISE EXCEPTION 'Passing percentage must be between 0 and 100' USING ERRCODE = '22023';
    END IF;

    SELECT status INTO v_status FROM public.assessments WHERE id = p_assessment_id FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_status != 'DRAFT' THEN
        RAISE EXCEPTION 'Only DRAFT assessments can be modified' USING ERRCODE = '22023';
    END IF;

    UPDATE public.assessments
    SET title = trim(p_title),
        description = COALESCE(trim(p_description), ''),
        instructions = COALESCE(trim(p_instructions), ''),
        duration_minutes = p_duration_minutes,
        start_time = p_start_time,
        end_time = p_end_time,
        passing_percentage = p_passing_percentage,
        include_in_global_leaderboard = p_include_in_global_leaderboard,
        randomize_questions = p_randomize_questions,
        randomize_options = p_randomize_options,
        event_id = p_event_id,
        sub_event_id = p_sub_event_id,
        updated_at = clock_timestamp()
    WHERE id = p_assessment_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_assessment(UUID, TEXT, TEXT, TEXT, INT, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_assessment(UUID, TEXT, TEXT, TEXT, INT, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, UUID, UUID) TO authenticated, service_role;

-- 4.13 Student Get Candidate Questions (Ordered strictly by attempt's stable layout)
CREATE OR REPLACE FUNCTION public.student_get_attempt_questions(p_attempt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt RECORD;
    v_result JSONB;
BEGIN
    SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id;
    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied: attempt does not belong to the calling student' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', q.id,
            'assessment_id', q.assessment_id,
            'question_text', q.question_text,
            'question_type', q.question_type,
            'points', q.points,
            'sort_order', array_position(v_attempt.question_order, q.id),
            'options', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'id', opt.id,
                        'question_id', opt.question_id,
                        'option_text', opt.option_text,
                        'sort_order', opt_order_idx
                    ) ORDER BY opt_order_idx ASC
                ), '[]'::jsonb)
                FROM public.assessment_question_options opt
                LEFT JOIN LATERAL (
                    SELECT COALESCE(
                        (SELECT pos::int - 1 FROM jsonb_array_elements_text(v_attempt.option_orders->(q.id::text)) WITH ORDINALITY arr(val, pos) WHERE val = opt.id::text),
                        opt.sort_order
                    ) AS opt_order_idx
                ) ord ON true
                WHERE opt.question_id = q.id
            )
        )
        ORDER BY array_position(v_attempt.question_order, q.id) ASC
    ), '[]'::jsonb) INTO v_result
    FROM public.assessment_questions q
    WHERE q.assessment_id = v_attempt.assessment_id
      AND q.id = ANY(COALESCE(v_attempt.question_order, ARRAY[]::UUID[]));

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.student_get_attempt_questions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_get_attempt_questions(UUID) TO authenticated, service_role;

-- 4.14 Student Get Closed Assessment Solutions (Revealed ONLY after closing time)
CREATE OR REPLACE FUNCTION public.student_get_closed_assessment_solutions(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asm RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_result JSONB;
BEGIN
    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    -- STRICT INTEGRITY INVARIANT: Never reveal solutions before closing time
    IF NOT (v_asm.status = 'CLOSED' OR v_now >= v_asm.end_time OR public.is_admin()) THEN
        RAISE EXCEPTION 'Solutions and answer keys remain confidential until the assessment closing time'
            USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'question_id', q.id,
            'question_type', q.question_type,
            'correct_option_id', k.option_id,
            'correct_boolean', k.correct_boolean
        )
    ), '[]'::jsonb) INTO v_result
    FROM public.assessment_questions q
    LEFT JOIN public.assessment_question_keys k ON k.question_id = q.id
    WHERE q.assessment_id = p_assessment_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.student_get_closed_assessment_solutions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_get_closed_assessment_solutions(UUID) TO authenticated, service_role;

-- 4.15 Scoped Assessment Attempts for Admins & Assigned Coordinators
CREATE OR REPLACE FUNCTION public.get_assessment_attempts_scoped(
    p_assessment_id UUID,
    p_coordinator_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asm RECORD;
    v_is_admin BOOLEAN := false;
    v_coord_id UUID := NULL;
    v_clean_token TEXT;
    v_result JSONB;
BEGIN
    v_is_admin := public.is_admin();

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_is_admin THEN
        -- Resolve coordinator identity
        IF p_coordinator_token IS NOT NULL AND trim(p_coordinator_token) <> '' THEN
            v_clean_token := regexp_replace(trim(p_coordinator_token), '^Bearer\s+', '', 'i');
            v_coord_id := public.get_coordinator_id_by_token(v_clean_token);
        ELSIF auth.uid() IS NOT NULL THEN
            SELECT id INTO v_coord_id FROM public.coordinators WHERE user_id = auth.uid();
        END IF;

        IF v_coord_id IS NULL THEN
            RAISE EXCEPTION 'Access denied: Administrator or coordinator session required' USING ERRCODE = '42501';
        END IF;

        -- Check sub-event assignment
        IF v_asm.sub_event_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.coordinator_assignments
            WHERE coordinator_id = v_coord_id AND sub_event_id = v_asm.sub_event_id
        ) THEN
            RAISE EXCEPTION 'Access denied: coordinator is not assigned to this linked assessment' USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'assessment_id', a.assessment_id,
            'student_id', a.student_id,
            'student_name', COALESCE(st.full_name, 'Anonymous Candidate'),
            'roll_number', st.roll_number,
            'college_name', st.college,
            'status', a.status,
            'started_at', a.started_at,
            'deadline', a.deadline,
            'submitted_at', a.submitted_at,
            'score', a.score,
            'correct_answers_count', a.correct_answers_count,
            'strike_count', a.strike_count,
            'created_at', a.created_at
        ) ORDER BY a.score DESC, a.submitted_at ASC
    ), '[]'::jsonb) INTO v_result
    FROM public.assessment_attempts a
    LEFT JOIN public.student_profiles st ON st.user_id = a.student_id
    WHERE a.assessment_id = p_assessment_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_assessment_attempts_scoped(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assessment_attempts_scoped(UUID, TEXT) TO authenticated, service_role;

-- 4.16 Scoped Attempt Violations for Admins & Assigned Coordinators
CREATE OR REPLACE FUNCTION public.get_attempt_violations_scoped(
    p_attempt_id UUID,
    p_coordinator_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_asm RECORD;
    v_is_admin BOOLEAN := false;
    v_coord_id UUID := NULL;
    v_clean_token TEXT;
    v_result JSONB;
BEGIN
    v_is_admin := public.is_admin();

    SELECT * INTO v_att FROM public.assessment_attempts WHERE id = p_attempt_id;
    IF v_att IS NULL THEN
        RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = v_att.assessment_id;

    IF NOT v_is_admin THEN
        IF p_coordinator_token IS NOT NULL AND trim(p_coordinator_token) <> '' THEN
            v_clean_token := regexp_replace(trim(p_coordinator_token), '^Bearer\s+', '', 'i');
            v_coord_id := public.get_coordinator_id_by_token(v_clean_token);
        ELSIF auth.uid() IS NOT NULL THEN
            SELECT id INTO v_coord_id FROM public.coordinators WHERE user_id = auth.uid();
        END IF;

        IF v_coord_id IS NULL THEN
            RAISE EXCEPTION 'Access denied: Administrator or coordinator session required' USING ERRCODE = '42501';
        END IF;

        IF v_asm.sub_event_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.coordinator_assignments
            WHERE coordinator_id = v_coord_id AND sub_event_id = v_asm.sub_event_id
        ) THEN
            RAISE EXCEPTION 'Access denied: coordinator is not assigned to this linked assessment' USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', v.id,
            'attempt_id', v.attempt_id,
            'episode_id', v.episode_id,
            'violation_type', v.violation_type,
            'violation_number', v.violation_number,
            'question_id', v.question_id,
            'question_text', q.question_text,
            'attempted_questions_count', v.attempted_questions_count,
            'recorded_at', v.recorded_at
        ) ORDER BY v.recorded_at ASC
    ), '[]'::jsonb) INTO v_result
    FROM public.assessment_attempt_violations v
    LEFT JOIN public.assessment_questions q ON q.id = v.question_id
    WHERE v.attempt_id = p_attempt_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_attempt_violations_scoped(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attempt_violations_scoped(UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_question_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_leaderboard_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_attempt_violations ENABLE ROW LEVEL SECURITY;

-- 5.1 Assessments: Active visible to authenticated; full access to Admin
CREATE POLICY "View active assessments"
ON public.assessments FOR SELECT TO authenticated
USING (status IN ('PUBLISHED', 'CLOSED') OR public.is_admin());

CREATE POLICY "Admin manage assessments"
ON public.assessments FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 5.2 Questions: Active visible to authenticated; full access to Admin
CREATE POLICY "View active questions"
ON public.assessment_questions FOR SELECT TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.assessments asm WHERE asm.id = assessment_questions.assessment_id AND asm.status IN ('PUBLISHED', 'CLOSED'))
    OR public.is_admin()
);

CREATE POLICY "Admin manage questions"
ON public.assessment_questions FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 5.3 Question Options: Active visible to authenticated; full access to Admin
CREATE POLICY "View active question options"
ON public.assessment_question_options FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.assessment_questions q
        JOIN public.assessments asm ON asm.id = q.assessment_id
        WHERE q.id = assessment_question_options.question_id AND asm.status IN ('PUBLISHED', 'CLOSED')
    )
    OR public.is_admin()
);

CREATE POLICY "Admin manage question options"
ON public.assessment_question_options FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 5.4 Question Keys: Strictly RPC-only boundary (inaccessible to PUBLIC, anon, authenticated)
-- Direct table access is completely revoked from all client roles.
-- Administrative reads are mediated via public.admin_get_assessment_questions(UUID).
-- Administrative writes are mediated via public.admin_save_question_and_options(...).
-- Scoring reads are mediated via public.internal_finalize_attempt(...).
REVOKE ALL ON public.assessment_question_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.assessment_question_keys TO service_role;

-- 5.5 Leaderboard Events: Select only for active assessments
REVOKE ALL ON public.assessment_leaderboard_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.assessment_leaderboard_events TO service_role;
GRANT SELECT ON public.assessment_leaderboard_events TO authenticated;

CREATE POLICY "View active assessment leaderboard events"
ON public.assessment_leaderboard_events FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.assessments asm
        WHERE asm.id = assessment_leaderboard_events.assessment_id
          AND asm.status IN ('PUBLISHED', 'CLOSED')
    )
    OR public.is_admin()
);

-- 5.6 Attempts: Student views own attempt; Admin views all; Assigned Coordinators view linked sub-event attempts
CREATE POLICY "Student views own attempt"
ON public.assessment_attempts FOR SELECT TO authenticated
USING (
    student_id = auth.uid() 
    OR public.is_admin()
    OR (
        assessment_id IN (
            SELECT asm.id FROM public.assessments asm
            JOIN public.coordinator_assignments ca ON ca.sub_event_id = asm.sub_event_id
            JOIN public.coordinators c ON c.id = ca.coordinator_id
            WHERE c.user_id = auth.uid()
        )
    )
);

CREATE POLICY "Student creates own attempt"
ON public.assessment_attempts FOR INSERT TO authenticated
WITH CHECK (student_id = auth.uid());

-- 5.7 Answers: Student views own answers; Admin views all
CREATE POLICY "Student views own answers"
ON public.assessment_attempt_answers FOR SELECT TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.assessment_attempts att WHERE att.id = assessment_attempt_answers.attempt_id AND att.student_id = auth.uid())
    OR public.is_admin()
);

-- 5.8 Violations: Student views own violations; Admin views all; Assigned Coordinators view linked sub-event violations
CREATE POLICY "Student views own violations"
ON public.assessment_attempt_violations FOR SELECT TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.assessment_attempts att WHERE att.id = assessment_attempt_violations.attempt_id AND att.student_id = auth.uid())
    OR public.is_admin()
    OR (
        attempt_id IN (
            SELECT att.id FROM public.assessment_attempts att
            JOIN public.assessments asm ON asm.id = att.assessment_id
            JOIN public.coordinator_assignments ca ON ca.sub_event_id = asm.sub_event_id
            JOIN public.coordinators c ON c.id = ca.coordinator_id
            WHERE c.user_id = auth.uid()
        )
    )
);

-- Service role full access across all assessment tables
CREATE POLICY "Service role full access assessments" ON public.assessments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access questions" ON public.assessment_questions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access options" ON public.assessment_question_options FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access keys" ON public.assessment_question_keys FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access events" ON public.assessment_leaderboard_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access attempts" ON public.assessment_attempts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access answers" ON public.assessment_attempt_answers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access violations" ON public.assessment_attempt_violations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- 6. REALTIME PUBLICATION REGISTRATION
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
              AND schemaname = 'public' 
              AND tablename = 'assessment_leaderboard_events'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.assessment_leaderboard_events;
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 7. PG_CRON SCHEDULER REGISTRATION (Conditional / Idempotent)
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('kits-eos-assessment-expiry-worker')
        WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kits-eos-assessment-expiry-worker');

        PERFORM cron.schedule(
            'kits-eos-assessment-expiry-worker',
            '* * * * *',
            'SELECT public.assessment_scheduled_expiry_worker();'
        );
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron scheduler registration deferred: %', SQLERRM;
END $$;

-- 8. PostgREST Schema Cache Reload Notification
NOTIFY pgrst, 'reload schema';
