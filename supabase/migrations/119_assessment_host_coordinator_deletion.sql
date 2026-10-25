-- ============================================================================
-- Migration: 119_assessment_host_coordinator_deletion.sql
-- Description: Live Assessment Host Dashboard, Dedicated Coordinator Assignment,
--              Safe Assessment Deletion/Archival, and Realtime Activity Events.
-- ============================================================================

-- 1. SCHEMA EXTENSIONS
-- ============================================================================

-- 1.1 Add coordinator and soft-deletion columns to assessments
ALTER TABLE public.assessments 
    ADD COLUMN IF NOT EXISTS coordinator_id UUID REFERENCES public.coordinators(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_assessments_coordinator_id ON public.assessments(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_assessments_is_deleted ON public.assessments(is_deleted);

-- 1.2 Dedicated Standalone Assessment Coordinator Assignments Table
CREATE TABLE IF NOT EXISTS public.assessment_coordinator_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_assessment_coordinator_asm UNIQUE (assessment_id),
    CONSTRAINT uq_assessment_coordinator_coord UNIQUE (coordinator_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_coord_assignments_coord ON public.assessment_coordinator_assignments(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_assessment_coord_assignments_asm ON public.assessment_coordinator_assignments(assessment_id);

-- 1.3 Assessment Live Activity Events Table (For Realtime Host Monitoring)
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
        'ATTEMPT_RESUMED',
        'ASSESSMENT_CLOSED'
    )),
    question_context TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_assessment_live_events_asm_created ON public.assessment_live_events(assessment_id, created_at DESC);

-- 1.4 Register in Supabase Realtime Publication
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
              AND schemaname = 'public' 
              AND tablename = 'assessment_live_events'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.assessment_live_events;
        END IF;
    END IF;
END $$;

-- 2. ROW LEVEL SECURITY & PERMISSIONS
-- ============================================================================

ALTER TABLE public.assessment_coordinator_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_live_events ENABLE ROW LEVEL SECURITY;

-- Revoke direct mutations
REVOKE ALL ON public.assessment_coordinator_assignments FROM PUBLIC, anon;
REVOKE ALL ON public.assessment_live_events FROM PUBLIC, anon;

GRANT SELECT ON public.assessment_coordinator_assignments TO authenticated, service_role;
GRANT SELECT ON public.assessment_live_events TO authenticated, service_role;

-- RLS: Coordinators Assignment
DROP POLICY IF EXISTS "assessment_coord_admin_all" ON public.assessment_coordinator_assignments;
CREATE POLICY "assessment_coord_admin_all" ON public.assessment_coordinator_assignments
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "assessment_coord_read" ON public.assessment_coordinator_assignments;
CREATE POLICY "assessment_coord_read" ON public.assessment_coordinator_assignments
    FOR SELECT TO authenticated
    USING (true);

-- RLS: Live Events
DROP POLICY IF EXISTS "assessment_live_events_admin_all" ON public.assessment_live_events;
CREATE POLICY "assessment_live_events_admin_all" ON public.assessment_live_events
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "assessment_live_events_read" ON public.assessment_live_events;
CREATE POLICY "assessment_live_events_read" ON public.assessment_live_events
    FOR SELECT TO authenticated
    USING (true);

-- RLS: Update Assessments Select Policy to exclude soft-deleted assessments
DROP POLICY IF EXISTS "View active assessments" ON public.assessments;
CREATE POLICY "View active assessments"
ON public.assessments FOR SELECT TO authenticated
USING (
    ((status IN ('PUBLISHED', 'CLOSED')) AND (is_deleted IS NOT TRUE))
    OR public.is_admin()
);

-- 3. COORDINATOR ACCESS AUTHORIZATION HELPER
-- ============================================================================

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
    -- 1. Check if caller is authenticated admin
    IF auth.uid() IS NOT NULL AND public.is_admin() THEN
        RETURN auth.uid();
    END IF;

    -- 2. Validate assessment existence
    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    -- 3. Check coordinator token
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

    IF v_session.expires_at <= now() THEN
        DELETE FROM public.coordinator_sessions WHERE token_hash = v_token_hash;
        RAISE EXCEPTION 'Coordinator session expired. Please log in again.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_coord
    FROM public.coordinators
    WHERE id = v_session.coordinator_id;

    IF v_coord IS NULL OR v_coord.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Coordinator account is inactive or not found' USING ERRCODE = '42501';
    END IF;

    -- 4. Check Standalone Assignment
    IF v_asm.coordinator_id = v_coord.id THEN
        v_is_assigned := true;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM public.assessment_coordinator_assignments
            WHERE assessment_id = p_assessment_id AND coordinator_id = v_coord.id
        ) INTO v_is_assigned;
    END IF;

    -- 5. If not standalone assigned, check Event-linked assignment
    IF NOT v_is_assigned AND v_asm.sub_event_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.coordinator_assignments
            WHERE sub_event_id = v_asm.sub_event_id AND coordinator_id = v_coord.id
        ) INTO v_is_assigned;
    END IF;

    IF NOT v_is_assigned THEN
        RAISE EXCEPTION 'Access denied: You are not authorized to host or view this assessment' 
            USING ERRCODE = '42501';
    END IF;

    RETURN v_coord.id;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_assessment_coordinator_access(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_assessment_coordinator_access(UUID, TEXT) TO authenticated, service_role;

-- 4. ADMIN COORDINATOR ASSIGNMENT RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_assign_assessment_coordinator(
    p_assessment_id UUID,
    p_coordinator_name TEXT,
    p_username TEXT,
    p_password TEXT,
    p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
    v_asm RECORD;
    v_clean_username TEXT;
    v_clean_name TEXT;
    v_password_hash TEXT;
    v_coord_id UUID;
    v_prev_coord_id UUID;
    v_existing_coord RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrative privileges required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    v_clean_username := lower(trim(p_username));
    v_clean_name := trim(p_coordinator_name);

    IF v_clean_username = '' OR length(v_clean_username) < 3 THEN
        RAISE EXCEPTION 'Username must be at least 3 characters long' USING ERRCODE = '22023';
    END IF;

    IF v_clean_name = '' THEN
        RAISE EXCEPTION 'Coordinator display name is required' USING ERRCODE = '22023';
    END IF;

    IF p_password IS NULL OR length(trim(p_password)) < 6 THEN
        RAISE EXCEPTION 'Password must be at least 6 characters long' USING ERRCODE = '22023';
    END IF;

    -- Compute SHA-256 password hash (automatically upgradeable by coordinator-login)
    v_password_hash := encode(extensions.digest(trim(p_password), 'sha256'), 'hex');

    -- Check if coordinator already exists with this username
    SELECT * INTO v_existing_coord FROM public.coordinators WHERE lower(username) = v_clean_username;

    IF v_existing_coord IS NOT NULL THEN
        -- Check if assigned to another assessment
        IF EXISTS (
            SELECT 1 FROM public.assessment_coordinator_assignments 
            WHERE coordinator_id = v_existing_coord.id AND assessment_id != p_assessment_id
        ) THEN
            RAISE EXCEPTION 'Coordinator username % is already assigned to another assessment', v_clean_username
                USING ERRCODE = '22023';
        END IF;

        -- Update coordinator profile & password
        UPDATE public.coordinators
        SET display_name = v_clean_name,
            password_hash = v_password_hash,
            phone_number = p_phone,
            coordinator_type = 'ASSESSMENT_COORDINATOR',
            status = 'ACTIVE'
        WHERE id = v_existing_coord.id;

        v_coord_id := v_existing_coord.id;
    ELSE
        -- Create new coordinator
        INSERT INTO public.coordinators (
            username,
            password_hash,
            display_name,
            phone_number,
            coordinator_type,
            status
        ) VALUES (
            v_clean_username,
            v_password_hash,
            v_clean_name,
            p_phone,
            'ASSESSMENT_COORDINATOR',
            'ACTIVE'
        )
        RETURNING id INTO v_coord_id;
    END IF;

    -- Check previous assignment
    SELECT coordinator_id INTO v_prev_coord_id 
    FROM public.assessment_coordinator_assignments 
    WHERE assessment_id = p_assessment_id;

    -- Upsert assignment
    INSERT INTO public.assessment_coordinator_assignments (
        assessment_id,
        coordinator_id,
        assigned_by
    ) VALUES (
        p_assessment_id,
        v_coord_id,
        auth.uid()
    )
    ON CONFLICT (assessment_id) DO UPDATE
    SET coordinator_id = EXCLUDED.coordinator_id,
        assigned_by = EXCLUDED.assigned_by,
        assigned_at = timezone('utc'::text, now());

    -- Update fast lookup pointer on assessments
    UPDATE public.assessments
    SET coordinator_id = v_coord_id,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_assessment_id;

    -- Audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        auth.uid(),
        CASE WHEN v_prev_coord_id IS NOT NULL AND v_prev_coord_id != v_coord_id 
             THEN 'ASSESSMENT_COORDINATOR_REASSIGNED' 
             ELSE 'ASSESSMENT_COORDINATOR_ASSIGNED' END,
        'assessments',
        p_assessment_id,
        jsonb_build_object(
            'assessment_title', v_asm.title,
            'coordinator_id', v_coord_id,
            'coordinator_username', v_clean_username,
            'coordinator_name', v_clean_name,
            'previous_coordinator_id', v_prev_coord_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Coordinator successfully assigned to assessment',
        'coordinator', jsonb_build_object(
            'id', v_coord_id,
            'username', v_clean_username,
            'display_name', v_clean_name,
            'phone_number', p_phone,
            'coordinator_type', 'ASSESSMENT_COORDINATOR'
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_assessment_coordinator(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_assessment_coordinator(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 5. STANDALONE PUBLICATION COORDINATOR ENFORCEMENT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_publish_assessment(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_asm RECORD;
    v_q_count INT;
    v_coord_assigned BOOLEAN := false;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrative privileges required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_asm.status = 'PUBLISHED' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Assessment is already published');
    END IF;

    -- Verify questions count
    SELECT count(*) INTO v_q_count FROM public.assessment_questions WHERE assessment_id = p_assessment_id;
    IF v_q_count = 0 THEN
        RAISE EXCEPTION 'Cannot publish an assessment with zero questions. Add at least one question first.'
            USING ERRCODE = '22023';
    END IF;

    -- Standalone Coordinator Restriction: Standalone assessments must have exactly one assigned coordinator
    IF v_asm.event_id IS NULL AND v_asm.sub_event_id IS NULL THEN
        IF v_asm.coordinator_id IS NOT NULL THEN
            v_coord_assigned := true;
        ELSE
            SELECT EXISTS (
                SELECT 1 FROM public.assessment_coordinator_assignments WHERE assessment_id = p_assessment_id
            ) INTO v_coord_assigned;
        END IF;

        IF NOT v_coord_assigned THEN
            RAISE EXCEPTION 'Standalone assessments must have an assigned coordinator before publication'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE public.assessments
    SET status = 'PUBLISHED',
        total_questions_count = v_q_count,
        is_deleted = false,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_assessment_id;

    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        auth.uid(),
        'ASSESSMENT_PUBLISHED',
        'assessments',
        p_assessment_id,
        jsonb_build_object(
            'title', v_asm.title,
            'questions_count', v_q_count,
            'coordinator_id', v_asm.coordinator_id
        )
    );

    RETURN jsonb_build_object('success', true, 'status', 'PUBLISHED', 'total_questions_count', v_q_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_publish_assessment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_publish_assessment(UUID) TO authenticated, service_role;

-- 6. SAFE ASSESSMENT DELETION & ARCHIVAL RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_assessment(
    p_assessment_id UUID,
    p_force_archive BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_asm RECORD;
    v_attempts_count INT := 0;
    v_certs_count INT := 0;
    v_leaderboard_events_count INT := 0;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrative privileges required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    -- Count protected historical records
    SELECT count(*) INTO v_attempts_count 
    FROM public.assessment_attempts 
    WHERE assessment_id = p_assessment_id;

    SELECT count(*) INTO v_certs_count 
    FROM public.assessment_certificates 
    WHERE assessment_id = p_assessment_id;

    SELECT count(*) INTO v_leaderboard_events_count 
    FROM public.assessment_leaderboard_events 
    WHERE assessment_id = p_assessment_id;

    -- Protected Data Evaluation:
    -- If there are attempts or issued certificates, permanent deletion is strictly prohibited
    -- to prevent corruption of student transcripts or academic credentials.
    IF v_attempts_count > 0 OR v_certs_count > 0 OR p_force_archive THEN
        UPDATE public.assessments
        SET status = 'ARCHIVED',
            is_deleted = TRUE,
            deleted_at = timezone('utc'::text, now()),
            updated_at = timezone('utc'::text, now())
        WHERE id = p_assessment_id;

        INSERT INTO public.audit_logs (
            actor_id, action, entity_type, entity_id, metadata
        ) VALUES (
            auth.uid(),
            'ASSESSMENT_ARCHIVED_PROTECTED_DATA',
            'assessments',
            p_assessment_id,
            jsonb_build_object(
                'title', v_asm.title,
                'attempts_count', v_attempts_count,
                'certificates_count', v_certs_count,
                'reason', 'Permanent deletion prevented to protect student historical records. Assessment safely archived and hidden from candidates.'
            )
        );

        RETURN jsonb_build_object(
            'success', true,
            'action', 'ARCHIVED',
            'is_permanent', false,
            'attempts_count', v_attempts_count,
            'certificates_count', v_certs_count,
            'message', 'Assessment contains participant attempts or issued certificates. To safeguard academic records, the assessment has been safely archived instead of permanently deleted.'
        );
    ELSE
        -- No student attempts or certificates exist: safe to permanently delete draft/empty assessment
        DELETE FROM public.assessment_coordinator_assignments WHERE assessment_id = p_assessment_id;
        DELETE FROM public.assessment_live_events WHERE assessment_id = p_assessment_id;
        DELETE FROM public.assessment_leaderboard_events WHERE assessment_id = p_assessment_id;
        DELETE FROM public.assessment_questions WHERE assessment_id = p_assessment_id;
        DELETE FROM public.assessments WHERE id = p_assessment_id;

        INSERT INTO public.audit_logs (
            actor_id, action, entity_type, entity_id, metadata
        ) VALUES (
            auth.uid(),
            'ASSESSMENT_PERMANENTLY_DELETED',
            'assessments',
            p_assessment_id,
            jsonb_build_object(
                'title', v_asm.title,
                'status', v_asm.status
            )
        );

        RETURN jsonb_build_object(
            'success', true,
            'action', 'PERMANENTLY_DELETED',
            'is_permanent', true,
            'attempts_count', 0,
            'certificates_count', 0,
            'message', 'Assessment and all associated draft questions were permanently deleted.'
        );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_assessment(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_assessment(UUID, BOOLEAN) TO authenticated, service_role;

-- 7. LIVE ASSESSMENT HOST SNAPSHOT RPC
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

    -- Build Participant Roster with sanitized data
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
            'score', CASE WHEN att.status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED') THEN att.score ELSE NULL END,
            'percentage', CASE 
                WHEN att.status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED') AND (
                    SELECT sum(points) FROM public.assessment_questions WHERE assessment_id = p_assessment_id
                ) > 0 THEN round((att.score * 100.0 / (SELECT sum(points) FROM public.assessment_questions WHERE assessment_id = p_assessment_id)), 2)
                ELSE NULL 
            END,
            'is_passed', CASE 
                WHEN att.status IN ('SUBMITTED', 'EXPIRED') AND (
                    SELECT sum(points) FROM public.assessment_questions WHERE assessment_id = p_assessment_id
                ) > 0 THEN (
                    (att.score * 100.0 / (SELECT sum(points) FROM public.assessment_questions WHERE assessment_id = p_assessment_id)) >= v_asm.passing_percentage
                )
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

    -- Question level progress aggregates (answers distribution without leaking keys)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'question_id', q.id,
            'question_text', q.question_text,
            'question_type', q.question_type,
            'sort_order', q.sort_order,
            'points', q.points,
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

    -- Current Scoreboard
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'rank', sb.computed_rank,
            'student_name', sb.student_name,
            'score', sb.score,
            'status', sb.status,
            'submitted_at', sb.submitted_at
        )
    ), '[]'::jsonb)
    INTO v_scoreboard
    FROM (
        SELECT 
            ROW_NUMBER() OVER (
                ORDER BY att.score DESC, 
                extract(epoch from (COALESCE(att.submitted_at, att.deadline) - att.started_at)) ASC, 
                att.submitted_at ASC
            ) as computed_rank,
            COALESCE(sp.full_name, 'Candidate ' || substr(att.student_id::text, 1, 8)) as student_name,
            att.score,
            att.status,
            att.submitted_at
        FROM public.assessment_attempts att
        LEFT JOIN public.student_profiles sp ON sp.user_id = att.student_id
        WHERE att.assessment_id = p_assessment_id 
          AND att.status IN ('SUBMITTED', 'EXPIRED')
        LIMIT 20
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
            'coordinator_username', v_coord_info.username
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

REVOKE ALL ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) TO authenticated, service_role;

-- 8. EARLY CLOSURE AUDITED RPC
-- ============================================================================

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
    v_asm RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_att RECORD;
BEGIN
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id FOR UPDATE;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_asm.status = 'CLOSED' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Assessment is already closed');
    END IF;

    -- Update status and clamp end_time
    UPDATE public.assessments
    SET status = 'CLOSED',
        end_time = LEAST(end_time, v_now),
        updated_at = v_now
    WHERE id = p_assessment_id;

    -- Finalize any lingering attempts whose deadlines passed
    FOR v_att IN 
        SELECT id FROM public.assessment_attempts 
        WHERE assessment_id = p_assessment_id AND status = 'IN_PROGRESS' AND deadline <= v_now
    LOOP
        PERFORM public.internal_finalize_attempt(v_att.id, 'EXPIRED', 'Assessment closed early: deadline elapsed');
    END LOOP;

    -- Log live event
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
        'HOST COORDINATOR',
        'ASSESSMENT_CLOSED',
        'Examination Terminated Early',
        jsonb_build_object('reason', p_reason, 'closed_by', v_caller_id)
    );

    -- Audit log
    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_caller_id,
        'ASSESSMENT_CLOSED_EARLY',
        'assessments',
        p_assessment_id,
        jsonb_build_object(
            'title', v_asm.title,
            'reason', p_reason,
            'closed_at', v_now
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Assessment closed early and finalized successfully',
        'status', 'CLOSED',
        'closed_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.coordinator_close_assessment_early(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coordinator_close_assessment_early(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 9. COORDINATOR ASSESSMENT LOGIN RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.coordinator_assessment_login(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
    v_clean_username TEXT;
    v_coord RECORD;
    v_input_hash TEXT;
    v_raw_token TEXT;
    v_token_hash TEXT;
    v_expires_at TIMESTAMPTZ;
    v_assignment RECORD;
    v_asm RECORD;
BEGIN
    v_clean_username := lower(trim(p_username));

    SELECT * INTO v_coord
    FROM public.coordinators
    WHERE lower(username) = v_clean_username;

    IF v_coord IS NULL THEN
        -- Artificial delay against brute-force timing attacks
        PERFORM pg_sleep(0.25);
        RAISE EXCEPTION 'Invalid credentials. Please check your username and password.' USING ERRCODE = '42501';
    END IF;

    IF v_coord.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Coordinator account is inactive or suspended' USING ERRCODE = '42501';
    END IF;

    -- Verify password hash (supports SHA-256)
    v_input_hash := encode(extensions.digest(trim(p_password), 'sha256'), 'hex');

    IF v_coord.password_hash != v_input_hash THEN
        -- If password_hash doesn't match raw sha256, test pgcrypto crypt if hash is bcrypt
        IF v_coord.password_hash LIKE '$2%' THEN
            IF extensions.crypt(trim(p_password), v_coord.password_hash) != v_coord.password_hash THEN
                PERFORM pg_sleep(0.25);
                RAISE EXCEPTION 'Invalid credentials. Please check your username and password.' USING ERRCODE = '42501';
            END IF;
        ELSE
            PERFORM pg_sleep(0.25);
            RAISE EXCEPTION 'Invalid credentials. Please check your username and password.' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Generate cryptographically secure session token
    v_raw_token := 'ctk_' || encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text || v_coord.id::text, 'sha256'), 'hex');
    v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');
    v_expires_at := now() + interval '1 hour';

    -- Insert session
    INSERT INTO public.coordinator_sessions (
        coordinator_id,
        token_hash,
        expires_at
    ) VALUES (
        v_coord.id,
        v_token_hash,
        v_expires_at
    );

    -- Look up assigned assessment
    SELECT * INTO v_assignment
    FROM public.assessment_coordinator_assignments
    WHERE coordinator_id = v_coord.id;

    IF v_assignment IS NOT NULL THEN
        SELECT id, title, status INTO v_asm 
        FROM public.assessments 
        WHERE id = v_assignment.assessment_id;
    ELSE
        SELECT id, title, status INTO v_asm 
        FROM public.assessments 
        WHERE coordinator_id = v_coord.id;
    END IF;

    -- Audit log (strictly zero credential exposure)
    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_coord.id,
        'COORDINATOR_LOGIN',
        'coordinators',
        v_coord.id,
        jsonb_build_object(
            'username', v_coord.username,
            'coordinator_type', v_coord.coordinator_type,
            'assigned_assessment_id', v_asm.id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_raw_token,
        'role', 'ASSESSMENT_COORDINATOR',
        'coordinator', jsonb_build_object(
            'id', v_coord.id,
            'username', v_coord.username,
            'display_name', v_coord.display_name,
            'phone_number', v_coord.phone_number,
            'coordinator_type', v_coord.coordinator_type,
            'status', v_coord.status
        ),
        'access_state', 'AUTHORIZED',
        'assigned_assessment', CASE WHEN v_asm.id IS NOT NULL THEN jsonb_build_object(
            'id', v_asm.id,
            'title', v_asm.title,
            'status', v_asm.status
        ) ELSE NULL END,
        'expires_at', v_expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.coordinator_assessment_login(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coordinator_assessment_login(TEXT, TEXT) TO anon, authenticated, service_role;

-- 10. INSTRUMENT STUDENT RPCS TO EMIT LIVE MONITORING EVENTS
-- ============================================================================

-- 10.1 Student Start or Resume Attempt with Live Broadcast
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
            -- Emit ATTEMPT_RESUMED
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
            'option_orders', v_existing.option_orders
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

    -- Question randomization
    IF v_asm.randomize_questions THEN
        SELECT array_agg(id ORDER BY random()) INTO v_q_order
        FROM public.assessment_questions
        WHERE assessment_id = p_assessment_id;
    ELSE
        SELECT array_agg(id ORDER BY sort_order ASC, created_at ASC) INTO v_q_order
        FROM public.assessment_questions
        WHERE assessment_id = p_assessment_id;
    END IF;

    -- Option randomization
    IF v_asm.randomize_options THEN
        SELECT jsonb_object_agg(q_id, opt_ids) INTO v_opt_orders
        FROM (
            SELECT o.question_id AS q_id, jsonb_agg(o.id ORDER BY random()) AS opt_ids
            FROM public.assessment_question_options o
            JOIN public.assessment_questions q ON q.id = o.question_id
            WHERE q.assessment_id = p_assessment_id
            GROUP BY o.question_id
        ) sub;
    END IF;

    -- Create new attempt
    INSERT INTO public.assessment_attempts (
        assessment_id,
        student_id,
        status,
        started_at,
        deadline,
        question_order,
        option_orders
    ) VALUES (
        p_assessment_id,
        v_uid,
        'IN_PROGRESS',
        v_now,
        v_calculated_deadline,
        v_q_order,
        v_opt_orders
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
        'Examination attempt initialized'
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
        'option_orders', v_opt_orders
    );
END;
$$;

REVOKE ALL ON FUNCTION public.student_start_or_resume_attempt(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_start_or_resume_attempt(UUID) TO authenticated, service_role;

-- 10.2 Student Autosave Answer with Live Activity
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
    v_student_name TEXT := 'Candidate';
    v_q RECORD;
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

    -- Upsert Answer
    INSERT INTO public.assessment_attempt_answers (
        attempt_id, question_id, selected_option_id, selected_boolean, answered_at
    ) VALUES (
        p_attempt_id, p_question_id, p_selected_option_id, p_selected_boolean, v_now
    )
    ON CONFLICT (attempt_id, question_id) DO UPDATE
    SET selected_option_id = EXCLUDED.selected_option_id,
        selected_boolean = EXCLUDED.selected_boolean,
        answered_at = EXCLUDED.answered_at;

    UPDATE public.assessment_attempts SET updated_at = v_now WHERE id = p_attempt_id;

    -- Fetch student display name
    SELECT full_name INTO v_student_name FROM public.student_profiles WHERE user_id = v_attempt.student_id;

    -- Live Event: ANSWER_SAVED
    INSERT INTO public.assessment_live_events (
        assessment_id, student_id, student_name, event_type, question_context
    ) VALUES (
        v_attempt.assessment_id,
        v_attempt.student_id,
        COALESCE(v_student_name, 'Candidate'),
        'ANSWER_SAVED',
        'Answer recorded for question ' || v_q.sort_order
    );

    RETURN jsonb_build_object('success', true, 'status', 'IN_PROGRESS', 'saved_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_autosave_answer(UUID, UUID, UUID, BOOLEAN) TO authenticated, service_role;

-- 10.3 Student Submit Attempt with Live Activity
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
            'score', v_attempt.score
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
        jsonb_build_object('score', v_finalize_res->'score')
    );

    RETURN jsonb_build_object(
        'success', true,
        'status', 'SUBMITTED',
        'score', v_finalize_res->'score',
        'correct_count', v_finalize_res->'correct_count'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.student_submit_attempt(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_submit_attempt(UUID) TO authenticated, service_role;

-- 10.4 Student Record Violation with Live Activity
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
    v_student_name TEXT := 'Candidate';
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

    -- Insert violation record (deduplicated by episode_id)
    INSERT INTO public.assessment_attempt_violations (
        attempt_id, episode_id, violation_type, violation_number, question_id, attempted_questions_count, recorded_at
    ) VALUES (
        p_attempt_id, p_episode_id, COALESCE(p_violation_type, 'TAB_SWITCH'), v_new_strike_count, p_question_id, v_attempted_count, v_now
    )
    ON CONFLICT (attempt_id, episode_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    SELECT full_name INTO v_student_name FROM public.student_profiles WHERE user_id = v_attempt.student_id;

    IF v_inserted THEN
        UPDATE public.assessment_attempts
        SET strike_count = v_new_strike_count,
            updated_at = v_now
        WHERE id = p_attempt_id;

        -- If strike count >= 3, terminate attempt immediately
        IF v_new_strike_count >= 3 THEN
            v_finalize_res := public.internal_finalize_attempt(p_attempt_id, 'TERMINATED', 'Proctoring violation: 3 strikes exceeded');

            -- Live Event: ATTEMPT_TERMINATED
            INSERT INTO public.assessment_live_events (
                assessment_id, student_id, student_name, event_type, question_context, metadata
            ) VALUES (
                v_attempt.assessment_id,
                v_attempt.student_id,
                COALESCE(v_student_name, 'Candidate'),
                'ATTEMPT_TERMINATED',
                'Tab-switch violation: 3 strikes exceeded',
                jsonb_build_object('strike_count', 3)
            );

            RETURN jsonb_build_object(
                'success', true,
                'terminated', true,
                'strike_count', 3,
                'status', 'TERMINATED',
                'score', v_finalize_res->'score'
            );
        ELSE
            -- Live Event: STRIKE_RECORDED
            INSERT INTO public.assessment_live_events (
                assessment_id, student_id, student_name, event_type, question_context, metadata
            ) VALUES (
                v_attempt.assessment_id,
                v_attempt.student_id,
                COALESCE(v_student_name, 'Candidate'),
                'STRIKE_RECORDED',
                'Tab-switch warning (Strike ' || v_new_strike_count || ' of 3)',
                jsonb_build_object('strike_count', v_new_strike_count)
            );

            RETURN jsonb_build_object(
                'success', true,
                'terminated', false,
                'strike_count', v_new_strike_count,
                'status', 'IN_PROGRESS'
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'duplicate_episode', true,
        'strike_count', v_attempt.strike_count,
        'status', v_attempt.status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.student_record_violation(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_record_violation(UUID, UUID, TEXT, UUID) TO authenticated, service_role;
