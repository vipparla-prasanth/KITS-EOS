-- ============================================================================
-- Migration: 124_admin_reopen_assessment.sql
-- Description: Adds a safe, atomic, admin-authorized assessment reopen mechanism.
-- Security & Integrity:
--   1. Strictly gated to verified administrators via public.is_admin() or service_role.
--   2. Enforces valid lifecycle status: ONLY assessments in 'CLOSED' status can be reopened.
--      (Rejects DRAFT, PUBLISHED, ARCHIVED, or soft-deleted assessments).
--   3. Window validation: If scheduled closing time (end_time) has passed, administrator
--      MUST explicitly provide a new valid future end_time. Deadlines are never silently extended.
--   4. Preserves 100% of historical attempts, student scores, proctoring violations,
--      leaderboards, and issued certificates without alteration or invalidation.
--   5. Atomic execution with FOR UPDATE row-level locking against race conditions.
--   6. Comprehensive audit trail logged to public.audit_logs and real-time live events.
-- ============================================================================

-- 1. ADD TRACKING COLUMNS TO ASSESSMENTS TABLE
ALTER TABLE public.assessments 
ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_reopened_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_reopened_by UUID REFERENCES public.users(id);

-- 2. CREATE DEDICATED ADMIN REOPEN ASSESSMENT RPC
CREATE OR REPLACE FUNCTION public.admin_reopen_assessment(
    p_assessment_id UUID,
    p_new_start_time TIMESTAMPTZ DEFAULT NULL,
    p_new_end_time TIMESTAMPTZ DEFAULT NULL,
    p_reason TEXT DEFAULT 'Reopened by administrator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_asm RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_target_start TIMESTAMPTZ;
    v_target_end TIMESTAMPTZ;
    v_schedule_modified BOOLEAN := false;
BEGIN
    -- 1. AUTHORIZATION CHECK: Enforce active allowlisted admin or service role
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: administrative privileges required'
            USING ERRCODE = '42501';
    END IF;

    -- 2. INPUT VALIDATION
    IF p_assessment_id IS NULL THEN
        RAISE EXCEPTION 'Assessment ID cannot be NULL'
            USING ERRCODE = '22023';
    END IF;

    -- 3. EXCLUSIVE ROW-LEVEL LOCK (Concurrency Safety)
    SELECT * INTO v_asm 
    FROM public.assessments 
    WHERE id = p_assessment_id 
    FOR UPDATE;

    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment % not found', p_assessment_id
            USING ERRCODE = 'P0002';
    END IF;

    -- 4. LIFECYCLE & ELIGIBILITY ENFORCEMENT
    IF v_asm.status = 'ARCHIVED' OR v_asm.is_deleted IS TRUE THEN
        RAISE EXCEPTION 'Cannot reopen an archived or deleted assessment. Please restore the assessment first.'
            USING ERRCODE = '22023';
    END IF;

    IF v_asm.status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'Assessment is already published and open.'
            USING ERRCODE = '22023';
    END IF;

    IF v_asm.status = 'DRAFT' THEN
        RAISE EXCEPTION 'Cannot reopen assessment in DRAFT status. Please use Publish Assessment instead.'
            USING ERRCODE = '22023';
    END IF;

    IF v_asm.status != 'CLOSED' THEN
        RAISE EXCEPTION 'Cannot reopen assessment with status % (only CLOSED assessments can be reopened)', v_asm.status
            USING ERRCODE = '22023';
    END IF;

    -- 5. WINDOW & SCHEDULE VALIDATION
    v_target_start := COALESCE(p_new_start_time, v_asm.start_time);
    v_target_end := COALESCE(p_new_end_time, v_asm.end_time);

    IF v_target_start IS DISTINCT FROM v_asm.start_time OR v_target_end IS DISTINCT FROM v_asm.end_time THEN
        v_schedule_modified := true;
    END IF;

    -- Enforce future closing time: If the previous scheduled closing time has elapsed,
    -- a new future closing time MUST be explicitly provided by the administrator.
    IF v_target_end <= v_now THEN
        RAISE EXCEPTION 'Cannot reopen assessment: scheduled closing time (%) has already passed. A new future closing time must be explicitly configured.',
            to_char(v_target_end, 'YYYY-MM-DD HH24:MI:SS TZ')
            USING ERRCODE = '22023';
    END IF;

    -- Enforce chronology: end_time must be strictly greater than start_time
    IF v_target_end <= v_target_start THEN
        RAISE EXCEPTION 'Closing time (%) must be strictly after start time (%)',
            to_char(v_target_end, 'YYYY-MM-DD HH24:MI:SS TZ'),
            to_char(v_target_start, 'YYYY-MM-DD HH24:MI:SS TZ')
            USING ERRCODE = '22023';
    END IF;

    -- 6. ATOMIC STATUS & SCHEDULE UPDATE
    -- Note: All existing assessment_attempts, assessment_attempt_answers,
    -- assessment_attempt_violations, assessment_certificates, and leaderboards
    -- remain completely intact and untouched.
    UPDATE public.assessments
    SET status = 'PUBLISHED',
        start_time = v_target_start,
        end_time = v_target_end,
        reopen_count = COALESCE(reopen_count, 0) + 1,
        last_reopened_at = v_now,
        last_reopened_by = v_admin_id,
        updated_at = v_now
    WHERE id = p_assessment_id;

    -- 7. AUDIT TRAIL LOGGING
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_admin_id,
        'ASSESSMENT_REOPENED',
        'assessments',
        p_assessment_id,
        jsonb_build_object(
            'assessment_id', p_assessment_id,
            'title', v_asm.title,
            'previous_status', 'CLOSED',
            'new_status', 'PUBLISHED',
            'previous_start_time', v_asm.start_time,
            'previous_end_time', v_asm.end_time,
            'new_start_time', v_target_start,
            'new_end_time', v_target_end,
            'schedule_modified', v_schedule_modified,
            'reopen_count', COALESCE(v_asm.reopen_count, 0) + 1,
            'reason', p_reason,
            'reopened_at', v_now
        ),
        v_now
    );

    -- 8. REALTIME LIVE EVENT (Notification to host & monitor dashboards)
    INSERT INTO public.assessment_live_events (
        assessment_id,
        student_id,
        student_name,
        event_type,
        question_context,
        metadata,
        created_at
    ) VALUES (
        p_assessment_id,
        NULL,
        'ADMINISTRATOR',
        'ASSESSMENT_REOPENED',
        'Examination Session Reopened',
        jsonb_build_object(
            'reopened_by', v_admin_id,
            'reason', p_reason,
            'new_start_time', v_target_start,
            'new_end_time', v_target_end,
            'status', 'PUBLISHED'
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Assessment successfully reopened and published',
        'assessment_id', p_assessment_id,
        'status', 'PUBLISHED',
        'start_time', v_target_start,
        'end_time', v_target_end,
        'schedule_modified', v_schedule_modified,
        'reopened_at', v_now
    );
END;
$$;

-- 3. SECURITY & PERMISSIONS
REVOKE ALL ON FUNCTION public.admin_reopen_assessment(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reopen_assessment(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated, service_role;

-- 4. COMMENT FOR SCHEMA DOCUMENTATION
COMMENT ON FUNCTION public.admin_reopen_assessment(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) IS 
'Safely and atomically reopens an eligible CLOSED assessment. Validates future closing window, preserves historical attempts and awards, and logs audit trail.';
