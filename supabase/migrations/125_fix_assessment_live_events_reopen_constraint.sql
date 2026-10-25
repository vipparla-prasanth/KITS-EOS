-- ============================================================================
-- Migration: 125_fix_assessment_live_events_reopen_constraint.sql
-- Description: Extends assessment_live_events_event_type_check to permit 'ASSESSMENT_REOPENED'
--              and hardens public.admin_reopen_assessment RPC.
-- Problem:
--   Calling admin_reopen_assessment raised PostgreSQL error 23514:
--   "new row for relation 'assessment_live_events' violates check constraint 'assessment_live_events_event_type_check'"
--   because the constraint only allowed:
--   ('ATTEMPT_STARTED', 'ANSWER_SAVED', 'ATTEMPT_SUBMITTED', 'ATTEMPT_EXPIRED',
--    'ATTEMPT_TERMINATED', 'STRIKE_RECORDED', 'ATTEMPT_RESUMED', 'ASSESSMENT_CLOSED').
-- Solution:
--   1. Recreate constraint to include 'ASSESSMENT_REOPENED' while preserving all 8 existing types.
--   2. Maintain strict transactional consistency across assessments, audit_logs, and live events.
-- ============================================================================

-- 1. UPDATE CHECK CONSTRAINT ON assessment_live_events
ALTER TABLE public.assessment_live_events 
    DROP CONSTRAINT IF EXISTS assessment_live_events_event_type_check;

ALTER TABLE public.assessment_live_events 
    ADD CONSTRAINT assessment_live_events_event_type_check 
    CHECK (event_type IN (
        'ATTEMPT_STARTED',
        'ANSWER_SAVED',
        'ATTEMPT_SUBMITTED',
        'ATTEMPT_EXPIRED',
        'ATTEMPT_TERMINATED',
        'STRIKE_RECORDED',
        'ATTEMPT_RESUMED',
        'ASSESSMENT_CLOSED',
        'ASSESSMENT_REOPENED'
    ));

-- 2. HARDEN public.admin_reopen_assessment RPC
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
    v_clean_reason TEXT;
BEGIN
    -- 1. AUTHORIZATION CHECK: Enforce active allowlisted admin, service role, or postgres superuser
    IF NOT (current_user = 'postgres' OR public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: administrative privileges required'
            USING ERRCODE = '42501';
    END IF;

    -- 2. DEFENSIVE ACTOR SANITIZATION
    -- If caller is service_role or actor not in public.users, avoid FK violation on last_reopened_by
    IF v_admin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_admin_id) THEN
        v_admin_id := NULL;
    END IF;

    v_clean_reason := COALESCE(NULLIF(TRIM(p_reason), ''), 'Reopened by administrator');

    -- 3. INPUT VALIDATION
    IF p_assessment_id IS NULL THEN
        RAISE EXCEPTION 'Assessment ID cannot be NULL'
            USING ERRCODE = '22023';
    END IF;

    -- 4. EXCLUSIVE ROW-LEVEL LOCK (Concurrency Safety)
    SELECT * INTO v_asm 
    FROM public.assessments 
    WHERE id = p_assessment_id 
    FOR UPDATE;

    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment % not found', p_assessment_id
            USING ERRCODE = 'P0002';
    END IF;

    -- 5. LIFECYCLE & ELIGIBILITY ENFORCEMENT
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

    -- 6. WINDOW & SCHEDULE VALIDATION
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

    -- 7. ATOMIC STATUS & SCHEDULE UPDATE
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

    -- 8. AUDIT TRAIL LOGGING
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
            'reason', v_clean_reason,
            'reopened_at', v_now
        ),
        v_now
    );

    -- 9. REALTIME LIVE EVENT (Notification to host & monitor dashboards)
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
            'reason', v_clean_reason,
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

-- 3. PERMISSIONS & DOCUMENTATION
REVOKE ALL ON FUNCTION public.admin_reopen_assessment(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reopen_assessment(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated, service_role;

COMMENT ON CONSTRAINT assessment_live_events_event_type_check ON public.assessment_live_events IS 
'Restricts event_type to valid attempt lifecycle and administrative assessment status events including ASSESSMENT_CLOSED and ASSESSMENT_REOPENED.';
