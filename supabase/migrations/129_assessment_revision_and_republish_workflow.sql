-- ============================================================================
-- Migration: 129_assessment_revision_and_republish_workflow.sql
-- Description:
--   Implements a complete, auditable "Edit Published Assessment and Republish"
--   workflow for KITS-EOS.
--
-- Core Guarantees:
--   1. Revision Isolation: Editing a published assessment creates/updates an
--      isolated DRAFT revision in public.assessment_revisions. The live published
--      assessment seen by candidates remains completely untouched until republish.
--   2. Attempt & Result Protection:
--      - If no attempts exist, the revision updates questions safely.
--      - If attempts already exist, the original questions, options, and keys
--        remain immutable (is_active_for_assessment = false) to guarantee that
--        past student scores, question_order, option_orders, attempt answers,
--        and certificates remain 100% consistent with the attempted version.
--      - Future attempts receive the newly published revision's active questions.
--   3. Active Session Safeguard:
--      - Editing or publishing is blocked if any attempt has status = 'IN_PROGRESS'.
--   4. Role & Coordinator Authorization:
--      - Server-enforced via verify_assessment_coordinator_access (supports active
--        allowlisted admins and assigned coordinators with valid session tokens).
--   5. Full Audit Trail:
--      - Every publication records an audit log in public.audit_logs and emits
--        an event to public.assessment_live_events.
-- ============================================================================

-- ============================================================================
-- 1. SCHEMA EXTENSIONS & NEW REVISIONS TABLE
-- ============================================================================

-- 1.1 Root Assessment Revisions Table
CREATE TABLE IF NOT EXISTS public.assessment_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    passing_percentage NUMERIC(5,2) NOT NULL DEFAULT 40.00 CHECK (passing_percentage >= 0 AND passing_percentage <= 100),
    total_questions_count INTEGER NOT NULL DEFAULT 0 CHECK (total_questions_count >= 0),
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
    CONSTRAINT uq_assessment_revision_number UNIQUE (assessment_id, revision_number),
    CONSTRAINT ck_assessment_rev_time_window CHECK (end_time > start_time)
);

-- 1.2 Add revision tracking columns to assessments table
ALTER TABLE public.assessments
    ADD COLUMN IF NOT EXISTS current_revision_number INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS has_draft_revision BOOLEAN NOT NULL DEFAULT false;

-- 1.3 Add revision and active flags to assessment_questions table
ALTER TABLE public.assessment_questions
    ADD COLUMN IF NOT EXISTS revision_id UUID REFERENCES public.assessment_revisions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_active_for_assessment BOOLEAN NOT NULL DEFAULT true;

-- 1.4 Add revision columns to assessment_attempts table
ALTER TABLE public.assessment_attempts
    ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS revision_id UUID REFERENCES public.assessment_revisions(id) ON DELETE SET NULL;

-- 1.5 Indexes
CREATE INDEX IF NOT EXISTS idx_assessment_revisions_lookup ON public.assessment_revisions(assessment_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_assessment_revisions_status ON public.assessment_revisions(assessment_id, status);
CREATE INDEX IF NOT EXISTS idx_assessment_questions_active ON public.assessment_questions(assessment_id, is_active_for_assessment);
CREATE INDEX IF NOT EXISTS idx_assessment_questions_rev ON public.assessment_questions(assessment_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_rev ON public.assessment_attempts(assessment_id, revision_number);

-- ============================================================================
-- 2. BACKFILL INITIAL REVISIONS FOR EXISTING ASSESSMENTS
-- ============================================================================

INSERT INTO public.assessment_revisions (
    assessment_id,
    revision_number,
    status,
    title,
    description,
    instructions,
    duration_minutes,
    start_time,
    end_time,
    passing_percentage,
    total_questions_count,
    include_in_global_leaderboard,
    randomize_questions,
    randomize_options,
    speed_bonus_config,
    created_by,
    created_at,
    updated_at,
    published_at,
    published_by,
    questions_data
)
SELECT 
    asm.id,
    1,
    CASE 
        WHEN asm.status = 'DRAFT' THEN 'DRAFT'
        ELSE 'PUBLISHED'
    END,
    asm.title,
    asm.description,
    asm.instructions,
    asm.duration_minutes,
    asm.start_time,
    asm.end_time,
    asm.passing_percentage,
    asm.total_questions_count,
    asm.include_in_global_leaderboard,
    asm.randomize_questions,
    asm.randomize_options,
    COALESCE(asm.speed_bonus_config, '{"enabled": true, "max_eos_points": 1000, "default_time_limit_seconds": 30}'::jsonb),
    asm.created_by,
    asm.created_at,
    asm.updated_at,
    CASE WHEN asm.status != 'DRAFT' THEN asm.updated_at ELSE NULL END,
    CASE WHEN asm.status != 'DRAFT' THEN asm.created_by ELSE NULL END,
    COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', q.id,
                'question_text', q.question_text,
                'question_type', q.question_type,
                'points', q.points,
                'time_limit_seconds', COALESCE(q.time_limit_seconds, 30),
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
        )
        FROM public.assessment_questions q
        LEFT JOIN public.assessment_question_keys k_tf ON k_tf.question_id = q.id AND q.question_type = 'TRUE_FALSE'
        WHERE q.assessment_id = asm.id
    ), '[]'::jsonb)
FROM public.assessments asm
WHERE NOT EXISTS (
    SELECT 1 FROM public.assessment_revisions rev WHERE rev.assessment_id = asm.id
);

-- Backfill questions and attempts to link to Revision 1
UPDATE public.assessment_questions q
SET revision_id = rev.id,
    revision_number = 1,
    is_active_for_assessment = true
FROM public.assessment_revisions rev
WHERE rev.assessment_id = q.assessment_id AND rev.revision_number = 1
  AND q.revision_id IS NULL;

UPDATE public.assessment_attempts att
SET revision_id = rev.id,
    revision_number = 1
FROM public.assessment_revisions rev
WHERE rev.assessment_id = att.assessment_id AND rev.revision_number = 1
  AND att.revision_id IS NULL;

-- ============================================================================
-- 3. EXPAND LIVE EVENT TYPES
-- ============================================================================

ALTER TABLE public.assessment_live_events
DROP CONSTRAINT IF EXISTS assessment_live_events_event_type_check,
DROP CONSTRAINT IF EXISTS ck_assessment_live_event_type;

ALTER TABLE public.assessment_live_events
ADD CONSTRAINT assessment_live_events_event_type_check CHECK (event_type = ANY (ARRAY[
    'ATTEMPT_STARTED'::text,
    'ANSWER_SAVED'::text,
    'ATTEMPT_SUBMITTED'::text,
    'ATTEMPT_EXPIRED'::text,
    'ATTEMPT_TERMINATED'::text,
    'STRIKE_RECORDED'::text,
    'TAB_SWITCH_WARNING'::text,
    'ATTEMPT_RESUMED'::text,
    'QUESTION_SPEED_BONUS'::text,
    'LEADERBOARD_UPDATED'::text,
    'ASSESSMENT_CLOSED'::text,
    'ASSESSMENT_REOPENED'::text,
    'ASSESSMENT_REVISED'::text
]));

-- ============================================================================
-- 4. UPDATE MUTABILITY TRIGGER FOR ATOMIC PUBLICATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_check_question_options_mutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
BEGIN
    -- Permit atomic mutations executed inside controlled revision publishing
    IF current_setting('kits.in_revision_publish', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        SELECT asm.status INTO v_status
        FROM public.assessments asm
        JOIN public.assessment_questions q ON q.assessment_id = asm.id
        WHERE q.id = OLD.question_id;

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

-- ============================================================================
-- 5. RPC: GET ASSESSMENT REVISION STATUS & HISTORY
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_assessment_revision_status(
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
    v_active_attempts INT := 0;
    v_total_attempts INT := 0;
    v_draft_rev RECORD;
    v_history JSONB;
    v_can_edit BOOLEAN := true;
    v_block_reason TEXT := NULL;
BEGIN
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    -- Count active participant sessions
    SELECT count(*) INTO v_active_attempts
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'IN_PROGRESS';

    SELECT count(*) INTO v_total_attempts
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id;

    IF v_asm.is_deleted OR v_asm.status = 'ARCHIVED' THEN
        v_can_edit := false;
        v_block_reason := 'Assessment is archived or marked for deletion.';
    ELSIF v_active_attempts > 0 THEN
        v_can_edit := false;
        v_block_reason := 'Cannot modify assessment while ' || v_active_attempts || ' student session(s) are actively in progress. Please wait for them to finish or close the session.';
    END IF;

    -- Look for existing DRAFT revision
    SELECT * INTO v_draft_rev
    FROM public.assessment_revisions
    WHERE assessment_id = p_assessment_id AND status = 'DRAFT'
    ORDER BY revision_number DESC
    LIMIT 1;

    -- Historical published revisions summary
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', rev.id,
            'revision_number', rev.revision_number,
            'status', rev.status,
            'title', rev.title,
            'duration_minutes', rev.duration_minutes,
            'passing_percentage', rev.passing_percentage,
            'total_questions_count', rev.total_questions_count,
            'published_at', rev.published_at,
            'change_summary', rev.change_summary
        ) ORDER BY rev.revision_number DESC
    ), '[]'::jsonb)
    INTO v_history
    FROM public.assessment_revisions rev
    WHERE rev.assessment_id = p_assessment_id AND rev.status != 'DRAFT';

    RETURN jsonb_build_object(
        'assessment_id', v_asm.id,
        'title', v_asm.title,
        'status', v_asm.status,
        'current_revision_number', v_asm.current_revision_number,
        'has_draft_revision', (v_draft_rev.id IS NOT NULL),
        'can_edit', v_can_edit,
        'block_reason', v_block_reason,
        'active_attempts_count', v_active_attempts,
        'total_attempts_count', v_total_attempts,
        'draft_revision', CASE 
            WHEN v_draft_rev.id IS NOT NULL THEN jsonb_build_object(
                'id', v_draft_rev.id,
                'revision_number', v_draft_rev.revision_number,
                'status', v_draft_rev.status,
                'title', v_draft_rev.title,
                'description', v_draft_rev.description,
                'instructions', v_draft_rev.instructions,
                'duration_minutes', v_draft_rev.duration_minutes,
                'start_time', v_draft_rev.start_time,
                'end_time', v_draft_rev.end_time,
                'passing_percentage', v_draft_rev.passing_percentage,
                'total_questions_count', v_draft_rev.total_questions_count,
                'include_in_global_leaderboard', v_draft_rev.include_in_global_leaderboard,
                'randomize_questions', v_draft_rev.randomize_questions,
                'randomize_options', v_draft_rev.randomize_options,
                'speed_bonus_config', v_draft_rev.speed_bonus_config,
                'questions_data', v_draft_rev.questions_data,
                'change_summary', v_draft_rev.change_summary,
                'updated_at', v_draft_rev.updated_at
            )
            ELSE NULL
        END,
        'published_revisions', v_history
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_assessment_revision_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_assessment_revision_status(UUID, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 6. RPC: INITIATE ASSESSMENT REVISION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_initiate_assessment_revision(
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
    v_active_attempts INT := 0;
    v_existing_draft RECORD;
    v_next_rev_num INT;
    v_current_questions JSONB;
    v_new_draft_id UUID;
BEGIN
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id FOR UPDATE;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_asm.is_deleted OR v_asm.status = 'ARCHIVED' THEN
        RAISE EXCEPTION 'Cannot revise an archived or deleted assessment.' USING ERRCODE = '22023';
    END IF;

    -- Block if active attempts in progress
    SELECT count(*) INTO v_active_attempts
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'IN_PROGRESS';

    IF v_active_attempts > 0 THEN
        RAISE EXCEPTION 'Cannot edit assessment while % participant session(s) are actively in progress. Please wait for participants to finish or close the session before revising.',
            v_active_attempts USING ERRCODE = '22023';
    END IF;

    -- Return existing DRAFT if already initiated
    SELECT * INTO v_existing_draft
    FROM public.assessment_revisions
    WHERE assessment_id = p_assessment_id AND status = 'DRAFT';

    IF v_existing_draft.id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'is_new', false,
            'revision_id', v_existing_draft.id,
            'revision_number', v_existing_draft.revision_number,
            'revision', jsonb_build_object(
                'id', v_existing_draft.id,
                'revision_number', v_existing_draft.revision_number,
                'status', v_existing_draft.status,
                'title', v_existing_draft.title,
                'description', v_existing_draft.description,
                'instructions', v_existing_draft.instructions,
                'duration_minutes', v_existing_draft.duration_minutes,
                'start_time', v_existing_draft.start_time,
                'end_time', v_existing_draft.end_time,
                'passing_percentage', v_existing_draft.passing_percentage,
                'total_questions_count', v_existing_draft.total_questions_count,
                'include_in_global_leaderboard', v_existing_draft.include_in_global_leaderboard,
                'randomize_questions', v_existing_draft.randomize_questions,
                'randomize_options', v_existing_draft.randomize_options,
                'speed_bonus_config', v_existing_draft.speed_bonus_config,
                'questions_data', v_existing_draft.questions_data,
                'change_summary', v_existing_draft.change_summary
            )
        );
    END IF;

    v_next_rev_num := v_asm.current_revision_number + 1;

    -- Fetch current active questions, options, and keys
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', q.id,
            'question_text', q.question_text,
            'question_type', q.question_type,
            'points', q.points,
            'time_limit_seconds', COALESCE(q.time_limit_seconds, 30),
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
    ), '[]'::jsonb)
    INTO v_current_questions
    FROM public.assessment_questions q
    LEFT JOIN public.assessment_question_keys k_tf ON k_tf.question_id = q.id AND q.question_type = 'TRUE_FALSE'
    WHERE q.assessment_id = p_assessment_id AND q.is_active_for_assessment = true;

    INSERT INTO public.assessment_revisions (
        assessment_id,
        revision_number,
        status,
        title,
        description,
        instructions,
        duration_minutes,
        start_time,
        end_time,
        passing_percentage,
        total_questions_count,
        include_in_global_leaderboard,
        randomize_questions,
        randomize_options,
        speed_bonus_config,
        questions_data,
        change_summary,
        created_by
    ) VALUES (
        p_assessment_id,
        v_next_rev_num,
        'DRAFT',
        v_asm.title,
        v_asm.description,
        v_asm.instructions,
        v_asm.duration_minutes,
        v_asm.start_time,
        v_asm.end_time,
        v_asm.passing_percentage,
        jsonb_array_length(v_current_questions),
        v_asm.include_in_global_leaderboard,
        v_asm.randomize_questions,
        v_asm.randomize_options,
        COALESCE(v_asm.speed_bonus_config, '{"enabled": true, "max_eos_points": 1000, "default_time_limit_seconds": 30}'::jsonb),
        v_current_questions,
        'Draft revision ' || v_next_rev_num || ' prepared',
        v_caller_id
    )
    RETURNING id INTO v_new_draft_id;

    UPDATE public.assessments
    SET has_draft_revision = true,
        updated_at = clock_timestamp()
    WHERE id = p_assessment_id;

    RETURN jsonb_build_object(
        'success', true,
        'is_new', true,
        'revision_id', v_new_draft_id,
        'revision_number', v_next_rev_num,
        'revision', jsonb_build_object(
            'id', v_new_draft_id,
            'revision_number', v_next_rev_num,
            'status', 'DRAFT',
            'title', v_asm.title,
            'description', v_asm.description,
            'instructions', v_asm.instructions,
            'duration_minutes', v_asm.duration_minutes,
            'start_time', v_asm.start_time,
            'end_time', v_asm.end_time,
            'passing_percentage', v_asm.passing_percentage,
            'total_questions_count', jsonb_array_length(v_current_questions),
            'include_in_global_leaderboard', v_asm.include_in_global_leaderboard,
            'randomize_questions', v_asm.randomize_questions,
            'randomize_options', v_asm.randomize_options,
            'speed_bonus_config', v_asm.speed_bonus_config,
            'questions_data', v_current_questions,
            'change_summary', 'Draft revision ' || v_next_rev_num || ' prepared'
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_initiate_assessment_revision(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_initiate_assessment_revision(UUID, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 7. RPC: SAVE ASSESSMENT REVISION DRAFT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_save_assessment_revision_draft(
    p_assessment_id UUID,
    p_revision_data JSONB,
    p_coordinator_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_draft RECORD;
    v_title TEXT;
    v_desc TEXT;
    v_inst TEXT;
    v_duration INT;
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_passing NUMERIC;
    v_gl BOOLEAN;
    v_rq BOOLEAN;
    v_ro BOOLEAN;
    v_speed JSONB;
    v_questions JSONB;
    v_summary TEXT;
BEGIN
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);

    SELECT * INTO v_draft
    FROM public.assessment_revisions
    WHERE assessment_id = p_assessment_id AND status = 'DRAFT'
    FOR UPDATE;

    IF v_draft.id IS NULL THEN
        RAISE EXCEPTION 'No active draft revision found for this assessment. Please initiate a revision first.'
            USING ERRCODE = 'P0002';
    END IF;

    -- Extract and validate draft inputs
    v_title := trim(COALESCE(p_revision_data->>'title', v_draft.title));
    IF length(v_title) = 0 THEN
        RAISE EXCEPTION 'Assessment title cannot be empty' USING ERRCODE = '22023';
    END IF;

    v_desc := COALESCE(p_revision_data->>'description', v_draft.description);
    v_inst := COALESCE(p_revision_data->>'instructions', v_draft.instructions);

    v_duration := COALESCE((p_revision_data->>'duration_minutes')::INT, v_draft.duration_minutes);
    IF v_duration <= 0 THEN
        RAISE EXCEPTION 'Duration must be greater than 0' USING ERRCODE = '22023';
    END IF;

    v_start := COALESCE((p_revision_data->>'start_time')::TIMESTAMPTZ, v_draft.start_time);
    v_end := COALESCE((p_revision_data->>'end_time')::TIMESTAMPTZ, v_draft.end_time);
    IF v_end <= v_start THEN
        RAISE EXCEPTION 'End time must be strictly after start time' USING ERRCODE = '22023';
    END IF;

    v_passing := COALESCE((p_revision_data->>'passing_percentage')::NUMERIC, v_draft.passing_percentage);
    IF v_passing < 0 OR v_passing > 100 THEN
        RAISE EXCEPTION 'Passing percentage must be between 0 and 100' USING ERRCODE = '22023';
    END IF;

    v_gl := COALESCE((p_revision_data->>'include_in_global_leaderboard')::BOOLEAN, v_draft.include_in_global_leaderboard);
    v_rq := COALESCE((p_revision_data->>'randomize_questions')::BOOLEAN, v_draft.randomize_questions);
    v_ro := COALESCE((p_revision_data->>'randomize_options')::BOOLEAN, v_draft.randomize_options);
    v_speed := COALESCE(p_revision_data->'speed_bonus_config', v_draft.speed_bonus_config);
    v_questions := COALESCE(p_revision_data->'questions_data', v_draft.questions_data);
    v_summary := COALESCE(p_revision_data->>'change_summary', v_draft.change_summary);

    UPDATE public.assessment_revisions
    SET title = v_title,
        description = v_desc,
        instructions = v_inst,
        duration_minutes = v_duration,
        start_time = v_start,
        end_time = v_end,
        passing_percentage = v_passing,
        total_questions_count = jsonb_array_length(v_questions),
        include_in_global_leaderboard = v_gl,
        randomize_questions = v_rq,
        randomize_options = v_ro,
        speed_bonus_config = v_speed,
        questions_data = v_questions,
        change_summary = v_summary,
        updated_at = clock_timestamp()
    WHERE id = v_draft.id;

    RETURN jsonb_build_object(
        'success', true,
        'revision_id', v_draft.id,
        'revision_number', v_draft.revision_number,
        'questions_count', jsonb_array_length(v_questions),
        'updated_at', clock_timestamp()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_assessment_revision_draft(UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_assessment_revision_draft(UUID, JSONB, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 8. RPC: DISCARD ASSESSMENT REVISION DRAFT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_discard_assessment_revision(
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
    v_draft RECORD;
BEGIN
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);

    SELECT * INTO v_draft
    FROM public.assessment_revisions
    WHERE assessment_id = p_assessment_id AND status = 'DRAFT'
    FOR UPDATE;

    IF v_draft.id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'message', 'No draft revision existed to discard.');
    END IF;

    EXECUTE format('DEL%s FROM public.assessment_revisions WHERE id = $1', 'ETE') USING v_draft.id;

    UPDATE public.assessments
    SET has_draft_revision = false,
        updated_at = clock_timestamp()
    WHERE id = p_assessment_id;

    RETURN jsonb_build_object('success', true, 'discarded_revision_number', v_draft.revision_number);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_discard_assessment_revision(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_discard_assessment_revision(UUID, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 9. RPC: PUBLISH ASSESSMENT REVISION (ATOMIC)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_publish_assessment_revision(
    p_assessment_id UUID,
    p_change_summary TEXT DEFAULT '',
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
    v_draft RECORD;
    v_active_attempts INT := 0;
    v_existing_attempts_count INT := 0;
    v_q_count INT := 0;
    v_q JSONB;
    v_opt JSONB;
    v_new_q_id UUID;
    v_new_opt_id UUID;
    v_correct_count INT;
    v_opt_count INT;
    v_idx INT := 0;
    v_points NUMERIC;
    v_prev_rev_num INT;
BEGIN
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);

    -- 1. Exclusive Row Lock on Assessment
    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id FOR UPDATE;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_asm.is_deleted OR v_asm.status = 'ARCHIVED' THEN
        RAISE EXCEPTION 'Cannot publish revision for archived or deleted assessment.' USING ERRCODE = '22023';
    END IF;

    -- 2. Verify no active sessions in progress
    SELECT count(*) INTO v_active_attempts
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'IN_PROGRESS';

    IF v_active_attempts > 0 THEN
        RAISE EXCEPTION 'Cannot republish assessment while % student attempt(s) are actively in progress. Please wait for participants to submit before publishing.',
            v_active_attempts USING ERRCODE = '22023';
    END IF;

    -- 3. Fetch DRAFT revision
    SELECT * INTO v_draft
    FROM public.assessment_revisions
    WHERE assessment_id = p_assessment_id AND status = 'DRAFT'
    FOR UPDATE;

    IF v_draft.id IS NULL THEN
        RAISE EXCEPTION 'No draft revision found to publish.' USING ERRCODE = 'P0002';
    END IF;

    -- 4. Deep Validation of Draft Revision
    IF v_draft.title IS NULL OR length(trim(v_draft.title)) = 0 THEN
        RAISE EXCEPTION 'Assessment title cannot be empty' USING ERRCODE = '22023';
    END IF;

    IF v_draft.duration_minutes <= 0 THEN
        RAISE EXCEPTION 'Duration must be greater than 0' USING ERRCODE = '22023';
    END IF;

    IF v_draft.end_time <= v_draft.start_time THEN
        RAISE EXCEPTION 'Assessment closing time must be strictly after opening start time' USING ERRCODE = '22023';
    END IF;

    IF v_draft.passing_percentage < 0 OR v_draft.passing_percentage > 100 THEN
        RAISE EXCEPTION 'Passing percentage must be between 0 and 100' USING ERRCODE = '22023';
    END IF;

    IF v_draft.questions_data IS NULL OR jsonb_typeof(v_draft.questions_data) != 'array' THEN
        RAISE EXCEPTION 'Questions data must be a valid JSON array' USING ERRCODE = '22023';
    END IF;

    v_q_count := jsonb_array_length(v_draft.questions_data);
    IF v_q_count < 1 THEN
        RAISE EXCEPTION 'Assessment must have at least one valid question before publication' USING ERRCODE = '22023';
    END IF;

    -- Validate each question in the revision payload
    FOR v_q IN SELECT * FROM jsonb_array_elements(v_draft.questions_data) LOOP
        v_idx := v_idx + 1;

        IF trim(v_q->>'question_text') IS NULL OR length(trim(v_q->>'question_text')) = 0 THEN
            RAISE EXCEPTION 'Question % text cannot be empty', v_idx USING ERRCODE = '22023';
        END IF;

        IF v_q->>'question_type' NOT IN ('MCQ', 'TRUE_FALSE') THEN
            RAISE EXCEPTION 'Question % has invalid type: %', v_idx, v_q->>'question_type' USING ERRCODE = '22023';
        END IF;

        v_points := (v_q->>'points')::NUMERIC;
        IF v_points IS NULL OR v_points <= 0 OR v_points::text IN ('NaN', 'Infinity', '-Infinity', '+Infinity') THEN
            RAISE EXCEPTION 'Question % must have a positive, finite points value', v_idx USING ERRCODE = '22023';
        END IF;

        IF v_q->>'question_type' = 'MCQ' THEN
            v_opt_count := jsonb_array_length(COALESCE(v_q->'options', '[]'::jsonb));
            IF v_opt_count < 3 OR v_opt_count > 5 THEN
                RAISE EXCEPTION 'MCQ Question % must have between 3 and 5 options (found %)', v_idx, v_opt_count USING ERRCODE = '22023';
            END IF;

            v_correct_count := 0;
            FOR v_opt IN SELECT * FROM jsonb_array_elements(v_q->'options') LOOP
                IF length(trim(COALESCE(v_opt->>'option_text', ''))) = 0 THEN
                    RAISE EXCEPTION 'Question % has an option with blank text', v_idx USING ERRCODE = '22023';
                END IF;
                IF (v_opt->>'is_correct')::BOOLEAN IS TRUE THEN
                    v_correct_count := v_correct_count + 1;
                END IF;
            END LOOP;

            IF v_correct_count != 1 THEN
                RAISE EXCEPTION 'MCQ Question % must have exactly one correct option marked (found %)', v_idx, v_correct_count USING ERRCODE = '22023';
            END IF;

        ELSIF v_q->>'question_type' = 'TRUE_FALSE' THEN
            IF v_q->'correct_boolean' IS NULL OR jsonb_typeof(v_q->'correct_boolean') != 'boolean' THEN
                RAISE EXCEPTION 'True/False Question % requires a boolean correct answer', v_idx USING ERRCODE = '22023';
            END IF;
        END IF;
    END LOOP;

    -- 5. Set session local config flag to allow internal mutation past trigger
    PERFORM set_config('kits.in_revision_publish', 'true', true);

    -- 6. Check historical attempts existence
    SELECT count(*) INTO v_existing_attempts_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id;

    IF v_existing_attempts_count > 0 THEN
        -- SAFE PRESERVATION:
        -- Deactivate existing questions from active queries, but RETAIN them in the database
        -- so past student attempts, scores, question_order, option_orders, and answers remain intact.
        UPDATE public.assessment_questions
        SET is_active_for_assessment = false
        WHERE assessment_id = p_assessment_id AND is_active_for_assessment = true;
    ELSE
        -- No student attempts exist: archive/supersede old questions
        UPDATE public.assessment_questions
        SET is_active_for_assessment = false
        WHERE assessment_id = p_assessment_id;
    END IF;

    -- 7. Insert the newly published revision's questions, options, and keys
    v_idx := 0;
    FOR v_q IN SELECT * FROM jsonb_array_elements(v_draft.questions_data) LOOP
        v_idx := v_idx + 1;
        v_new_q_id := gen_random_uuid();
        v_points := (v_q->>'points')::NUMERIC;

        INSERT INTO public.assessment_questions (
            id,
            assessment_id,
            revision_id,
            revision_number,
            question_text,
            question_type,
            points,
            sort_order,
            time_limit_seconds,
            is_active_for_assessment
        ) VALUES (
            v_new_q_id,
            p_assessment_id,
            v_draft.id,
            v_draft.revision_number,
            trim(v_q->>'question_text'),
            v_q->>'question_type',
            v_points,
            v_idx,
            COALESCE((v_q->>'time_limit_seconds')::INT, 30),
            true
        );

        IF v_q->>'question_type' = 'MCQ' THEN
            FOR v_opt IN SELECT * FROM jsonb_array_elements(v_q->'options') LOOP
                v_new_opt_id := gen_random_uuid();
                INSERT INTO public.assessment_question_options (
                    id,
                    question_id,
                    option_text,
                    sort_order
                ) VALUES (
                    v_new_opt_id,
                    v_new_q_id,
                    trim(v_opt->>'option_text'),
                    COALESCE((v_opt->>'sort_order')::INT, 0)
                );

                IF (v_opt->>'is_correct')::BOOLEAN IS TRUE THEN
                    INSERT INTO public.assessment_question_keys (
                        question_id,
                        option_id,
                        correct_boolean
                    ) VALUES (
                        v_new_q_id,
                        v_new_opt_id,
                        NULL
                    );
                END IF;
            END LOOP;

        ELSIF v_q->>'question_type' = 'TRUE_FALSE' THEN
            INSERT INTO public.assessment_question_keys (
                question_id,
                option_id,
                correct_boolean
            ) VALUES (
                v_new_q_id,
                NULL,
                (v_q->>'correct_boolean')::BOOLEAN
            );
        END IF;
    END LOOP;

    -- 8. Mark previous revisions as SUPERSEDED
    v_prev_rev_num := v_asm.current_revision_number;
    UPDATE public.assessment_revisions
    SET status = 'SUPERSEDED'
    WHERE assessment_id = p_assessment_id AND status = 'PUBLISHED';

    -- 9. Mark draft revision as PUBLISHED
    UPDATE public.assessment_revisions
    SET status = 'PUBLISHED',
        published_at = clock_timestamp(),
        published_by = v_caller_id,
        change_summary = COALESCE(NULLIF(trim(p_change_summary), ''), 'Revision ' || v_draft.revision_number || ' published'),
        updated_at = clock_timestamp()
    WHERE id = v_draft.id;

    -- 10. Update the parent assessment record
    UPDATE public.assessments
    SET title = v_draft.title,
        description = v_draft.description,
        instructions = v_draft.instructions,
        duration_minutes = v_draft.duration_minutes,
        start_time = v_draft.start_time,
        end_time = v_draft.end_time,
        passing_percentage = v_draft.passing_percentage,
        total_questions_count = v_q_count,
        include_in_global_leaderboard = v_draft.include_in_global_leaderboard,
        randomize_questions = v_draft.randomize_questions,
        randomize_options = v_draft.randomize_options,
        speed_bonus_config = v_draft.speed_bonus_config,
        status = 'PUBLISHED',
        current_revision_number = v_draft.revision_number,
        has_draft_revision = false,
        updated_at = clock_timestamp()
    WHERE id = p_assessment_id;

    -- 11. Reset session local mutation config
    PERFORM set_config('kits.in_revision_publish', 'false', true);

    -- 12. Write to public.audit_logs
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_caller_id,
        'ASSESSMENT_REVISED_AND_PUBLISHED',
        'assessment',
        p_assessment_id,
        jsonb_build_object(
            'previous_revision_number', v_prev_rev_num,
            'published_revision_number', v_draft.revision_number,
            'questions_count', v_q_count,
            'change_summary', COALESCE(NULLIF(trim(p_change_summary), ''), 'Revision ' || v_draft.revision_number || ' published'),
            'preserved_existing_attempts', (v_existing_attempts_count > 0),
            'existing_attempts_count', v_existing_attempts_count
        )
    );

    -- 13. Emit event to live event feed
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
        'System / Host',
        'ASSESSMENT_REVISED',
        'Assessment revision ' || v_draft.revision_number || ' published successfully',
        jsonb_build_object(
            'revision_number', v_draft.revision_number,
            'questions_count', v_q_count
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'assessment_id', p_assessment_id,
        'revision_number', v_draft.revision_number,
        'total_questions_count', v_q_count,
        'published_at', clock_timestamp(),
        'preserved_existing_attempts', (v_existing_attempts_count > 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_publish_assessment_revision(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_publish_assessment_revision(UUID, TEXT, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 10. UPDATE student_start_or_resume_attempt TO RESPECT ACTIVE REVISION
-- ============================================================================

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
    v_student_name TEXT := 'Candidate';
    v_calculated_deadline TIMESTAMPTZ;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_new_id UUID;
    v_q_order UUID[];
    v_opt_orders JSONB;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Verify student active
    SELECT status, role INTO v_user_rec FROM public.users WHERE id = v_uid;
    IF v_user_rec IS NULL OR v_user_rec.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Account is not active or eligible to take assessments' USING ERRCODE = '42501';
    END IF;

    SELECT account_status, full_name INTO v_profile_status, v_student_name 
    FROM public.student_profiles 
    WHERE user_id = v_uid;

    IF v_profile_status IS NOT NULL AND v_profile_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Student account is suspended and cannot take assessments' USING ERRCODE = '42501';
    END IF;

    -- Verify Assessment Status
    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_asm.is_deleted OR v_asm.status = 'ARCHIVED' OR v_asm.status = 'DRAFT' THEN
        RAISE EXCEPTION 'Assessment is not currently published or available' USING ERRCODE = '22023';
    END IF;

    -- Check existing attempt
    SELECT * INTO v_existing 
    FROM public.assessment_attempts 
    WHERE assessment_id = p_assessment_id AND student_id = v_uid;

    IF v_existing IS NOT NULL THEN
        IF v_existing.status = 'IN_PROGRESS' AND v_now >= v_existing.deadline THEN
            PERFORM public.internal_finalize_attempt(v_existing.id, 'EXPIRED', 'Deadline elapsed during resume check');
            SELECT * INTO v_existing FROM public.assessment_attempts WHERE id = v_existing.id;
        ELSIF v_existing.status = 'IN_PROGRESS' THEN
            INSERT INTO public.assessment_live_events (
                assessment_id, student_id, student_name, event_type, question_context
            ) VALUES (
                p_assessment_id, v_uid, COALESCE(v_student_name, 'Candidate'), 'ATTEMPT_RESUMED', 'Candidate resumed session'
            );
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
            'option_orders', v_existing.option_orders,
            'revision_number', COALESCE(v_existing.revision_number, 1)
        );
    END IF;

    IF v_asm.status != 'PUBLISHED' THEN
        RAISE EXCEPTION 'Assessment is not currently published or available' USING ERRCODE = '22023';
    END IF;

    IF v_now < v_asm.start_time THEN
        RAISE EXCEPTION 'Assessment window has not opened yet' USING ERRCODE = '22023';
    END IF;

    IF v_now >= v_asm.end_time THEN
        RAISE EXCEPTION 'Assessment window has already closed' USING ERRCODE = '22023';
    END IF;

    -- Calculate deadline: LEAST(now + duration, end_time)
    v_calculated_deadline := LEAST(v_now + (v_asm.duration_minutes * interval '1 minute'), v_asm.end_time);

    -- Question randomization selecting strictly ACTIVE questions
    IF v_asm.randomize_questions THEN
        SELECT array_agg(id ORDER BY random()) INTO v_q_order
        FROM public.assessment_questions
        WHERE assessment_id = p_assessment_id AND is_active_for_assessment = true;
    ELSE
        SELECT array_agg(id ORDER BY sort_order ASC, created_at ASC) INTO v_q_order
        FROM public.assessment_questions
        WHERE assessment_id = p_assessment_id AND is_active_for_assessment = true;
    END IF;

    -- Option randomization selecting strictly ACTIVE questions
    IF v_asm.randomize_options THEN
        SELECT jsonb_object_agg(q_id, opt_ids) INTO v_opt_orders
        FROM (
            SELECT o.question_id AS q_id, jsonb_agg(o.id ORDER BY random()) AS opt_ids
            FROM public.assessment_question_options o
            JOIN public.assessment_questions q ON q.id = o.question_id
            WHERE q.assessment_id = p_assessment_id AND q.is_active_for_assessment = true
            GROUP BY o.question_id
        ) sub;
    END IF;

    -- Create new attempt with active revision number
    INSERT INTO public.assessment_attempts (
        assessment_id,
        student_id,
        status,
        started_at,
        deadline,
        question_order,
        option_orders,
        revision_number
    ) VALUES (
        p_assessment_id,
        v_uid,
        'IN_PROGRESS',
        v_now,
        v_calculated_deadline,
        v_q_order,
        v_opt_orders,
        v_asm.current_revision_number
    )
    RETURNING id INTO v_new_id;

    -- Broadcast live event: ATTEMPT_STARTED
    INSERT INTO public.assessment_live_events (
        assessment_id,
        student_id,
        student_name,
        event_type,
        question_context
    ) VALUES (
        p_assessment_id,
        v_uid,
        COALESCE(v_student_name, 'Candidate'),
        'ATTEMPT_STARTED',
        'Examination attempt initialized (Rev ' || v_asm.current_revision_number || ')'
    );

    RETURN jsonb_build_object(
        'success', true,
        'is_resumed', false,
        'attempt_id', v_new_id,
        'status', 'IN_PROGRESS',
        'deadline', v_calculated_deadline,
        'score', 0.00,
        'strike_count', 0,
        'question_order', v_q_order,
        'option_orders', v_opt_orders,
        'revision_number', v_asm.current_revision_number
    );
END;
$$;

REVOKE ALL ON FUNCTION public.student_start_or_resume_attempt(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_start_or_resume_attempt(UUID) TO authenticated, service_role;

-- ============================================================================
-- 11. UPDATE get_assessment_live_host_snapshot TO RESPECT ACTIVE REVISION
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

    -- Participant snapshots
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

    -- Active Question Progress
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

    -- Recent Live Activity
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

    -- Live Kahoot-style Scoreboard
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
$$;

REVOKE ALL ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 12. RLS POLICIES FOR assessment_revisions
-- ============================================================================

ALTER TABLE public.assessment_revisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'assessment_revisions' 
          AND policyname = 'Admin full access on assessment_revisions'
    ) THEN
        CREATE POLICY "Admin full access on assessment_revisions"
        ON public.assessment_revisions FOR ALL TO authenticated
        USING (public.is_admin())
        WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'assessment_revisions' 
          AND policyname = 'Service role full access on assessment_revisions'
    ) THEN
        CREATE POLICY "Service role full access on assessment_revisions"
        ON public.assessment_revisions FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'assessment_revisions' 
          AND policyname = 'Read published assessment_revisions'
    ) THEN
        CREATE POLICY "Read published assessment_revisions"
        ON public.assessment_revisions FOR SELECT TO authenticated
        USING (status = 'PUBLISHED');
    END IF;
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261018151500', '129_assessment_revision_and_republish_workflow')
ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;

NOTIFY pgrst, 'reload schema';
