-- ============================================================================
-- QA ASSESSMENT SCHEMA BOOTSTRAP SCRIPT (PROPOSAL ONLY - DO NOT RUN DIRECTLY)
-- Target Database: QA Project (agzgxwfutajwawwtsbco)
-- Source: Verified Local Migrations 108, 117-134
-- Purpose: Bootstraps complete assessment subsystem in QA without touching production
-- Guarantee: 100% server-authoritative scoring; ZERO assessment certificates
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. PREREQUISITES & EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Prerequisite from Migration 108: Stable is_admin() function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_admin_allowlist text[] := ARRAY[
        'prasanthv865@gmail.com',
        'hruthvikmanoj4608@gmail.com',
        'saideepak4408@gmail.com',
        'nerellabhavanilakshmi@gmail.com',
        'principal@kitsakshar.ac.in',
        'qa.admin@kitsakshar.ac.in',
        'jnvsravankumar@gmail.com'
    ];
BEGIN
    IF v_uid IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = v_uid 
          AND role = 'ADMIN' 
          AND status = 'ACTIVE'
          AND lower(trim(email)) = ANY(v_admin_allowlist)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- Partial index on active admins
CREATE INDEX IF NOT EXISTS idx_users_active_admin 
ON public.users (id, role, status) 
WHERE (role = 'ADMIN' AND status = 'ACTIVE');

-- ----------------------------------------------------------------------------
-- 1. ASSESSMENT CORE TABLES
-- ----------------------------------------------------------------------------

-- 1.1 assessments
CREATE TABLE IF NOT EXISTS public.assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED')),
    passing_percentage NUMERIC(5,2) NOT NULL DEFAULT 40.00 CHECK (passing_percentage >= 0 AND passing_percentage <= 100),
    total_questions_count INT NOT NULL DEFAULT 0 CHECK (total_questions_count >= 0),
    include_in_global_leaderboard BOOLEAN NOT NULL DEFAULT false,
    randomize_questions BOOLEAN NOT NULL DEFAULT false,
    randomize_options BOOLEAN NOT NULL DEFAULT false,
    event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
    sub_event_id UUID REFERENCES public.sub_events(id) ON DELETE SET NULL,
    coordinator_id UUID REFERENCES public.coordinators(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    reopen_count INT NOT NULL DEFAULT 0,
    last_reopened_at TIMESTAMPTZ,
    last_reopened_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    speed_bonus_config JSONB NOT NULL DEFAULT '{"enabled": true, "max_eos_points": 1000, "default_time_limit_seconds": 30}'::jsonb,
    current_revision_number INT NOT NULL DEFAULT 1,
    has_draft_revision BOOLEAN NOT NULL DEFAULT false,
    report_finalized_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    closed_by TEXT
);

-- 1.2 assessment_revisions
CREATE TABLE IF NOT EXISTS public.assessment_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    revision_number INT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    passing_percentage NUMERIC(5,2) NOT NULL DEFAULT 40.00 CHECK (passing_percentage >= 0 AND passing_percentage <= 100),
    total_questions_count INT NOT NULL DEFAULT 0 CHECK (total_questions_count >= 0),
    include_in_global_leaderboard BOOLEAN NOT NULL DEFAULT false,
    randomize_questions BOOLEAN NOT NULL DEFAULT false,
    randomize_options BOOLEAN NOT NULL DEFAULT false,
    speed_bonus_config JSONB NOT NULL DEFAULT '{"enabled": true, "max_eos_points": 1000, "default_time_limit_seconds": 30}'::jsonb,
    questions_data JSONB NOT NULL DEFAULT '[]'::jsonb,
    change_summary TEXT DEFAULT '',
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT assessment_revisions_unique_rev UNIQUE (assessment_id, revision_number)
);

-- 1.3 assessment_questions
CREATE TABLE IF NOT EXISTS public.assessment_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL CHECK (length(trim(question_text)) > 0),
    question_type TEXT NOT NULL CHECK (question_type IN ('MCQ', 'TRUE_FALSE')),
    points NUMERIC(6,2) NOT NULL DEFAULT 1.00 CHECK (points > 0),
    sort_order INT NOT NULL DEFAULT 0,
    time_limit_seconds INT NOT NULL DEFAULT 30 CHECK (time_limit_seconds > 0),
    revision_id UUID REFERENCES public.assessment_revisions(id) ON DELETE SET NULL,
    revision_number INT NOT NULL DEFAULT 1,
    is_active_for_assessment BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.4 assessment_question_options
CREATE TABLE IF NOT EXISTS public.assessment_question_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES public.assessment_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL CHECK (length(trim(option_text)) > 0),
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.5 assessment_question_keys (ISOLATED SERVER-ONLY ANSWER KEYS)
CREATE TABLE IF NOT EXISTS public.assessment_question_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL UNIQUE REFERENCES public.assessment_questions(id) ON DELETE CASCADE,
    option_id UUID REFERENCES public.assessment_question_options(id) ON DELETE CASCADE,
    correct_boolean BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.6 assessment_leaderboard_events (Sanitized projections)
CREATE TABLE IF NOT EXISTS public.assessment_leaderboard_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    student_name TEXT NOT NULL,
    score NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    question_score NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    eos_points NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    speed_bonus_score NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    finalized_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.7 assessment_attempts
CREATE TABLE IF NOT EXISTS public.assessment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'TERMINATED')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deadline TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ,
    score NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    question_score NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    eos_points NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    speed_bonus_score NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    total_response_time_seconds NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    correct_answers_count INT NOT NULL DEFAULT 0,
    strike_count INT NOT NULL DEFAULT 0 CHECK (strike_count >= 0 AND strike_count <= 3),
    question_order UUID[],
    option_orders JSONB,
    leaderboard_event_id UUID UNIQUE REFERENCES public.assessment_leaderboard_events(id) ON DELETE SET NULL,
    revision_number INT NOT NULL DEFAULT 1,
    revision_id UUID REFERENCES public.assessment_revisions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT assessment_attempts_one_per_student UNIQUE (assessment_id, student_id)
);

-- 1.8 assessment_attempt_answers
CREATE TABLE IF NOT EXISTS public.assessment_attempt_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.assessment_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.assessment_questions(id) ON DELETE CASCADE,
    selected_option_id UUID REFERENCES public.assessment_question_options(id) ON DELETE SET NULL,
    selected_boolean BOOLEAN,
    is_correct BOOLEAN,
    points_awarded NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    eos_points NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    speed_bonus_awarded NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    speed_bonus_rank INT,
    response_time_seconds NUMERIC(10,2),
    question_started_at TIMESTAMPTZ,
    answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT assessment_attempt_answers_unique_q UNIQUE (attempt_id, question_id)
);

-- 1.9 assessment_attempt_violations
CREATE TABLE IF NOT EXISTS public.assessment_attempt_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.assessment_attempts(id) ON DELETE CASCADE,
    episode_id UUID NOT NULL,
    violation_type TEXT NOT NULL DEFAULT 'TAB_SWITCH',
    violation_number INT NOT NULL DEFAULT 1 CHECK (violation_number >= 1 AND violation_number <= 3),
    question_id UUID REFERENCES public.assessment_questions(id) ON DELETE SET NULL,
    attempted_questions_count INT NOT NULL DEFAULT 0 CHECK (attempted_questions_count >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT assessment_attempt_violations_unique_episode UNIQUE (attempt_id, episode_id)
);

-- 1.10 assessment_coordinator_assignments
CREATE TABLE IF NOT EXISTS public.assessment_coordinator_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL UNIQUE REFERENCES public.assessments(id) ON DELETE CASCADE,
    coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 1.11 assessment_live_events (Check constraint includes ASSESSMENT_REOPENED & ASSESSMENT_REVISED)
CREATE TABLE IF NOT EXISTS public.assessment_live_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    student_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    student_name TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'ATTEMPT_STARTED',
        'ANSWER_SAVED',
        'ATTEMPT_SUBMITTED',
        'ATTEMPT_EXPIRED',
        'ATTEMPT_TERMINATED',
        'STRIKE_RECORDED',
        'TAB_SWITCH_WARNING',
        'ATTEMPT_RESUMED',
        'QUESTION_SPEED_BONUS',
        'LEADERBOARD_UPDATED',
        'ASSESSMENT_CLOSED',
        'ASSESSMENT_REOPENED',
        'ASSESSMENT_REVISED'
    )),
    question_context TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 1.12 assessment_certificates (DUMMY TABLE FOR SCHEMA CONTRACT ONLY; 100% NEUTRALIZED BY MIGRATION 130)
CREATE TABLE IF NOT EXISTS public.assessment_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL UNIQUE REFERENCES public.assessment_attempts(id) ON DELETE CASCADE,
    award_type TEXT NOT NULL CHECK (award_type IN ('FIRST_PLACE', 'SECOND_PLACE', 'THIRD_PLACE', 'ACHIEVEMENT')),
    rank INT NOT NULL CHECK (rank >= 1),
    certificate_code TEXT NOT NULL UNIQUE,
    score NUMERIC(8,2) NOT NULL CHECK (score >= 0),
    total_points NUMERIC(8,2) NOT NULL CHECK (total_points > 0),
    percentage NUMERIC(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
    template_version TEXT NOT NULL DEFAULT 'v1',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked BOOLEAN NOT NULL DEFAULT false,
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. COVERING INDEXES & SCALABILITY OPTIMIZATIONS
-- ----------------------------------------------------------------------------
-- Covering index from Migration 134 for instantaneous scoring aggregation
CREATE INDEX IF NOT EXISTS idx_assessment_attempt_answers_scoring_cov
ON public.assessment_attempt_answers (attempt_id)
INCLUDE (points_awarded, eos_points, response_time_seconds, is_correct);

CREATE INDEX IF NOT EXISTS idx_assessment_attempts_assessment_status
ON public.assessment_attempts (assessment_id, status);

CREATE INDEX IF NOT EXISTS idx_assessment_attempts_student_active
ON public.assessment_attempts (student_id)
WHERE status = 'IN_PROGRESS';

CREATE INDEX IF NOT EXISTS idx_assessment_live_events_lookup
ON public.assessment_live_events (assessment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_questions_order
ON public.assessment_questions (assessment_id, sort_order)
WHERE is_active_for_assessment = true;

CREATE INDEX IF NOT EXISTS idx_assessment_revisions_lookup
ON public.assessment_revisions (assessment_id, revision_number DESC);

-- ----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_question_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_attempt_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_live_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_coordinator_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_leaderboard_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_certificates ENABLE ROW LEVEL SECURITY;

-- Strict answer key isolation: Zero direct read for anon/authenticated
DROP POLICY IF EXISTS "Keys are server-only" ON public.assessment_question_keys;
CREATE POLICY "Keys are server-only" ON public.assessment_question_keys
    FOR ALL USING (false);

-- Published assessments viewable by authenticated students
DROP POLICY IF EXISTS "View active assessments" ON public.assessments;
CREATE POLICY "View active assessments" ON public.assessments
    FOR SELECT TO authenticated
    USING (status IN ('PUBLISHED', 'CLOSED') AND NOT is_deleted);

-- Attempts viewable only by attempt owner
DROP POLICY IF EXISTS "Student views own attempt" ON public.assessment_attempts;
CREATE POLICY "Student views own attempt" ON public.assessment_attempts
    FOR SELECT TO authenticated
    USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Student views own answers" ON public.assessment_attempt_answers;
CREATE POLICY "Student views own answers" ON public.assessment_attempt_answers
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.assessment_attempts att
        WHERE att.id = attempt_id AND att.student_id = auth.uid()
    ));

-- ----------------------------------------------------------------------------
-- 4. CORE PROCEDURAL FUNCTIONS (Migrations 127, 130, 134)
-- ----------------------------------------------------------------------------

-- 4.1 EOS Kahoot Speed Bonus Decay Formula (100% authoritative preserved)
CREATE OR REPLACE FUNCTION public.calculate_dynamic_eos_points(
    p_is_correct BOOLEAN,
    p_response_time_seconds NUMERIC,
    p_time_limit_seconds INT,
    p_speed_bonus_config JSONB
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_enabled BOOLEAN := true;
    v_max_eos_points NUMERIC := 1000.0;
    v_time_limit NUMERIC;
    v_resp_time NUMERIC;
    v_decay NUMERIC;
    v_result NUMERIC;
BEGIN
    IF NOT p_is_correct THEN
        RETURN 0.00;
    END IF;

    IF p_speed_bonus_config IS NOT NULL THEN
        v_enabled := COALESCE((p_speed_bonus_config->>'enabled')::boolean, true);
        v_max_eos_points := COALESCE((p_speed_bonus_config->>'max_eos_points')::numeric, 1000.0);
    END IF;

    IF NOT v_enabled THEN
        RETURN 0.00;
    END IF;

    v_time_limit := GREATEST(1.0, COALESCE(p_time_limit_seconds, 30)::numeric);
    v_resp_time := GREATEST(0.0, COALESCE(p_response_time_seconds, 0.0));

    -- Kahoot Decay: ROUND(max_eos_points * MAX(0, 1.0 - (response_time / (2.0 * time_limit))))
    v_decay := GREATEST(0.0, 1.0 - (v_resp_time / (2.0 * v_time_limit)));
    v_result := ROUND(v_max_eos_points * v_decay, 2);

    RETURN v_result;
END;
$$;

-- 4.2 student_view_question (Migration 134)
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
    SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id;
    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt % not found', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Access denied: attempt does not belong to calling student' USING ERRCODE = '42501';
    END IF;

    IF v_attempt.status != 'IN_PROGRESS' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'Attempt is not in progress');
    END IF;

    SELECT * INTO v_q FROM public.assessment_questions 
    WHERE id = p_question_id AND assessment_id = v_attempt.assessment_id;
    IF v_q IS NULL THEN
        RAISE EXCEPTION 'Question does not belong to this assessment' USING ERRCODE = '22023';
    END IF;

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

-- 4.3 internal_finalize_attempt (Migration 127)
CREATE OR REPLACE FUNCTION public.internal_finalize_attempt(
    p_attempt_id UUID,
    p_final_status TEXT,
    p_reason TEXT DEFAULT 'Finalized'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt RECORD;
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

    SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt % not found', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

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

    SELECT full_name INTO v_student_name FROM public.student_profiles WHERE user_id = v_attempt.student_id;
    v_student_name := COALESCE(NULLIF(trim(v_student_name), ''), 'Anonymous Candidate');

    SELECT 
        COALESCE(SUM(points_awarded), 0.00),
        COALESCE(SUM(eos_points), 0.00),
        COALESCE(SUM(response_time_seconds), 0.00),
        COUNT(*) FILTER (WHERE is_correct = true)
    INTO v_question_score, v_eos_points, v_total_resp_time, v_correct_count
    FROM public.assessment_attempt_answers
    WHERE attempt_id = p_attempt_id;

    IF p_final_status = 'TERMINATED' THEN
        v_eos_points := 0.00;
    END IF;

    INSERT INTO public.assessment_leaderboard_events (
        assessment_id, student_name, score, question_score, eos_points, speed_bonus_score, finalized_at
    ) VALUES (
        v_attempt.assessment_id, v_student_name, v_question_score, v_question_score, v_eos_points, v_eos_points, v_finalized_at
    ) RETURNING id INTO v_event_id;

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

-- 4.4 student_submit_attempt (Migration 127)
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
        RAISE EXCEPTION 'Access denied: attempt does not belong to calling student' USING ERRCODE = '42501';
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

    INSERT INTO public.assessment_live_events (
        assessment_id, student_id, student_name, event_type, question_context, metadata
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

-- 4.5 student_autosave_answer (Migration 134)
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
    SELECT * INTO v_attempt FROM public.assessment_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt IS NULL THEN
        RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Access denied: attempt does not belong to the calling student' USING ERRCODE = '42501';
    END IF;

    IF v_attempt.status != 'IN_PROGRESS' THEN
        RETURN jsonb_build_object('success', false, 'status', v_attempt.status, 'message', 'Assessment is no longer active');
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = v_attempt.assessment_id;
    IF v_now > v_attempt.deadline OR (v_asm.end_time IS NOT NULL AND v_now > v_asm.end_time) THEN
        v_finalize_res := public.internal_finalize_attempt(v_attempt.id, 'EXPIRED', 'Autosave after deadline elapsed');
        RETURN jsonb_build_object('success', false, 'status', 'EXPIRED', 'message', 'Assessment deadline elapsed');
    END IF;

    SELECT * INTO v_q FROM public.assessment_questions 
    WHERE id = p_question_id AND assessment_id = v_attempt.assessment_id;
    IF v_q IS NULL THEN
        RAISE EXCEPTION 'Question does not belong to this assessment' USING ERRCODE = '22023';
    END IF;

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
REVOKE ALL ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) TO authenticated, service_role;

-- 4.6 verify_assessment_coordinator_access (Migration 134)
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
    IF auth.uid() IS NOT NULL AND public.is_admin() THEN
        RETURN auth.uid();
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

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

    UPDATE public.coordinator_sessions
    SET last_active_at = now()
    WHERE token_hash = v_token_hash;

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

-- 4.7 get_assessment_live_host_snapshot (Migration 134)
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
    END IF;

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
        v_started_count, v_active_count, v_submitted_count, v_expired_count, v_terminated_count,
        v_avg_score, v_high_score, v_tab_switch_total
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id;

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
        SELECT * FROM public.assessment_live_events
        WHERE assessment_id = p_assessment_id
        ORDER BY created_at DESC
        LIMIT 25
    ) e;

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
        SELECT att.* FROM public.assessment_attempts att
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

-- 4.8 Neutralized Assessment Certificates (Rule from Migration 130: Assessments have NO certificates)
CREATE OR REPLACE FUNCTION public.admin_process_assessment_awards(p_assessment_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Assessment certificates have been permanently discontinued as a feature. Academic marks, EOS points, and leaderboard standings remain authoritative.'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_assessment_certificate(p_assessment_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_assessment_certificates(p_assessment_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN '[]'::jsonb;
END;
$$;

COMMIT;
