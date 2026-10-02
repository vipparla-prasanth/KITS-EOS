-- Migration 057: Transactional Outbox for Storage Cleanup Queue & Canonical Deletion Authority
-- 1. Defines public.storage_cleanup_status ENUM with 5 lifecycle states
-- 2. Creates public.storage_cleanup_queue table with strict namespace and bucket constraints
-- 3. Implements concurrency-safe public.claim_storage_cleanup_jobs() using FOR UPDATE SKIP LOCKED
-- 4. Implements public.complete_storage_cleanup_job() with strict attempt count and failure state transitions
-- 5. Updates canonical public.admin_delete_historical_data() to atomically enqueue banner cleanup jobs
-- 6. Aligns public.admin_delete_event() and public.admin_delete_sub_event() to delegate directly to canonical RPC

-- 1. Storage cleanup status enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_cleanup_status') THEN
        CREATE TYPE public.storage_cleanup_status AS ENUM (
            'PENDING',
            'PROCESSING',
            'COMPLETED',
            'FAILED_RETRYABLE',
            'FAILED_PERMANENT'
        );
    END IF;
END $$;

-- 2. Storage cleanup queue table
CREATE TABLE IF NOT EXISTS public.storage_cleanup_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_bucket VARCHAR(50) NOT NULL DEFAULT 'events',
    storage_path TEXT NOT NULL,
    asset_type VARCHAR(50) NOT NULL,
    source_entity_type VARCHAR(50) NOT NULL,
    source_entity_id UUID,
    operation VARCHAR(50) NOT NULL,
    status public.storage_cleanup_status NOT NULL DEFAULT 'PENDING',
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    processing_started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT chk_storage_bucket_events CHECK (storage_bucket = 'events'),
    CONSTRAINT chk_storage_path_banner_namespace CHECK (
        (storage_path LIKE 'events/banners/%' AND length(storage_path) > 15 AND storage_path NOT LIKE '%..%' AND storage_path NOT LIKE '%//%')
        OR
        (storage_path LIKE 'subevents/banners/%' AND length(storage_path) > 18 AND storage_path NOT LIKE '%..%' AND storage_path NOT LIKE '%//%')
    ),
    CONSTRAINT chk_asset_type_banners CHECK (asset_type IN ('EVENT_BANNER', 'SUB_EVENT_BANNER'))
);

CREATE INDEX IF NOT EXISTS idx_storage_cleanup_queue_claimable 
ON public.storage_cleanup_queue (status, created_at)
WHERE status IN ('PENDING', 'FAILED_RETRYABLE', 'PROCESSING');

-- Enable RLS on storage_cleanup_queue
ALTER TABLE public.storage_cleanup_queue ENABLE ROW LEVEL SECURITY;

-- Admins and service role have full access
DROP POLICY IF EXISTS "Admins and service role manage cleanup queue" ON public.storage_cleanup_queue;
CREATE POLICY "Admins and service role manage cleanup queue"
ON public.storage_cleanup_queue
FOR ALL
TO authenticated, service_role
USING (public.is_admin() OR auth.role() = 'service_role')
WITH CHECK (public.is_admin() OR auth.role() = 'service_role');


-- 3. Concurrency-safe job claiming function
CREATE OR REPLACE FUNCTION public.claim_storage_cleanup_jobs(
    p_batch_size INT DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    storage_bucket VARCHAR(50),
    storage_path TEXT,
    asset_type VARCHAR(50),
    source_entity_type VARCHAR(50),
    source_entity_id UUID,
    operation VARCHAR(50),
    attempt_count INT,
    max_attempts INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
#variable_conflict use_column
BEGIN
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Unauthorized: Administrative or service privileges required.';
    END IF;

    RETURN QUERY
    WITH claimable AS (
        SELECT 
            q.id AS job_id,
            q.status AS prev_status,
            q.processing_started_at AS prev_processing_started_at
        FROM public.storage_cleanup_queue q
        WHERE 
            -- Completed or permanently failed jobs must NEVER be reclaimed
            q.status NOT IN ('COMPLETED', 'FAILED_PERMANENT')
            AND (
                -- 1. Standard pending jobs within attempt budget
                (q.status = 'PENDING' AND q.attempt_count < q.max_attempts)
                OR
                -- 2. Retryable failed jobs within attempt budget
                (q.status = 'FAILED_RETRYABLE' AND q.attempt_count < q.max_attempts)
                OR
                -- 3. Deliberate stale processing recovery (worker crashed or hung > 5 minutes)
                (q.status = 'PROCESSING' AND q.processing_started_at < timezone('utc'::text, now()) - INTERVAL '5 minutes' AND q.attempt_count < q.max_attempts)
            )
        ORDER BY q.created_at ASC
        LIMIT LEAST(p_batch_size, 50)
        FOR UPDATE SKIP LOCKED
    ),
    reclaimed AS (
        UPDATE public.storage_cleanup_queue u
        SET 
            status = 'PROCESSING',
            processing_started_at = timezone('utc'::text, now())
        FROM claimable c
        WHERE u.id = c.job_id
        RETURNING 
            u.id,
            u.storage_bucket,
            u.storage_path,
            u.asset_type,
            u.source_entity_type,
            u.source_entity_id,
            u.operation,
            u.attempt_count,
            u.max_attempts,
            c.prev_status,
            c.prev_processing_started_at
    ),
    audit_stale AS (
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
        SELECT 
            auth.uid(),
            'BANNER_STORAGE_CLEANUP_STALE_RECLAIMED',
            r.source_entity_type,
            COALESCE(r.source_entity_id, r.id),
            jsonb_build_object(
                'job_id', r.id,
                'storage_bucket', r.storage_bucket,
                'storage_path', r.storage_path,
                'attempt_count', r.attempt_count,
                'previous_started_at', r.prev_processing_started_at,
                'reclaimed_at', timezone('utc'::text, now())
            ),
            timezone('utc'::text, now())
        FROM reclaimed r
        WHERE r.prev_status = 'PROCESSING'
    )
    SELECT 
        r.id,
        r.storage_bucket,
        r.storage_path,
        r.asset_type,
        r.source_entity_type,
        r.source_entity_id,
        r.operation,
        r.attempt_count,
        r.max_attempts
    FROM reclaimed r;
END;
$$;

-- 4. Job completion & error tracking function
CREATE OR REPLACE FUNCTION public.complete_storage_cleanup_job(
    p_job_id UUID,
    p_success BOOLEAN,
    p_error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_job public.storage_cleanup_queue%ROWTYPE;
    v_new_status public.storage_cleanup_status;
    v_new_attempt_count INT;
BEGIN
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Unauthorized: Administrative or service privileges required.';
    END IF;

    SELECT * INTO v_job FROM public.storage_cleanup_queue WHERE id = p_job_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found in cleanup queue.', p_job_id;
    END IF;

    -- Guard: Terminal jobs (COMPLETED or FAILED_PERMANENT) must never be re-transitioned
    IF v_job.status IN ('COMPLETED', 'FAILED_PERMANENT') THEN
        RETURN jsonb_build_object(
            'success', false,
            'job_id', p_job_id,
            'status', v_job.status::text,
            'message', 'Job is already in a terminal state.'
        );
    END IF;

    IF p_success THEN
        v_new_status := 'COMPLETED';
        UPDATE public.storage_cleanup_queue
        SET status = v_new_status,
            completed_at = timezone('utc'::text, now()),
            last_error = NULL
        WHERE id = p_job_id;

        -- Record audit log for completion
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
        VALUES (
            auth.uid(),
            'BANNER_STORAGE_CLEANUP_COMPLETED',
            v_job.source_entity_type,
            COALESCE(v_job.source_entity_id, p_job_id),
            jsonb_build_object(
                'job_id', p_job_id,
                'storage_bucket', v_job.storage_bucket,
                'storage_path', v_job.storage_path,
                'asset_type', v_job.asset_type,
                'operation', v_job.operation,
                'attempts', v_job.attempt_count
            ),
            timezone('utc'::text, now())
        );

        RETURN jsonb_build_object(
            'success', true,
            'job_id', p_job_id,
            'status', v_new_status::text,
            'attempts', v_job.attempt_count,
            'max_attempts', v_job.max_attempts
        );
    ELSE
        -- Increment attempt_count upon failed processing attempt
        v_new_attempt_count := v_job.attempt_count + 1;

        -- If post-failure attempts reach or exceed max_attempts, mark permanently failed
        IF v_new_attempt_count >= v_job.max_attempts THEN
            v_new_status := 'FAILED_PERMANENT';
        ELSE
            v_new_status := 'FAILED_RETRYABLE';
        END IF;

        UPDATE public.storage_cleanup_queue
        SET status = v_new_status,
            attempt_count = v_new_attempt_count,
            last_error = p_error_message
        WHERE id = p_job_id;

        -- Record audit log for failure
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
        VALUES (
            auth.uid(),
            'BANNER_STORAGE_CLEANUP_FAILED',
            v_job.source_entity_type,
            COALESCE(v_job.source_entity_id, p_job_id),
            jsonb_build_object(
                'job_id', p_job_id,
                'storage_bucket', v_job.storage_bucket,
                'storage_path', v_job.storage_path,
                'asset_type', v_job.asset_type,
                'operation', v_job.operation,
                'attempts', v_new_attempt_count,
                'max_attempts', v_job.max_attempts,
                'status', v_new_status::text,
                'error', p_error_message
            ),
            timezone('utc'::text, now())
        );

        RETURN jsonb_build_object(
            'success', false,
            'job_id', p_job_id,
            'status', v_new_status::text,
            'attempts', v_new_attempt_count,
            'max_attempts', v_job.max_attempts
        );
    END IF;
END;
$$;

-- 5. Canonical Deletion RPC: admin_delete_historical_data
CREATE OR REPLACE FUNCTION public.admin_delete_historical_data(
    p_scope TEXT,
    p_entity_id UUID,
    p_confirmation_phrase TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage, pg_catalog
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_email TEXT;
    v_scope TEXT;
    v_entity_name TEXT;
    v_event_name TEXT;
    v_category_name TEXT;
    v_sub_event_name TEXT;
    v_status event_status;
    v_sub_event_ids UUID[] := '{}';
    v_category_ids UUID[] := '{}';
    v_registration_ids UUID[] := '{}';
    v_team_ids UUID[] := '{}';
    v_team_member_ids UUID[] := '{}';
    v_raw_banner_paths TEXT[] := '{}';
    v_deleted_banner_paths TEXT[] := '{}';
    v_path TEXT;
    v_clean_path TEXT;
    v_categories_count INT := 0;
    v_sub_events_count INT := 0;
    v_registrations_count INT := 0;
    v_teams_count INT := 0;
    v_team_members_count INT := 0;
    v_attendance_count INT := 0;
    v_payments_count INT := 0;
    v_feedback_count INT := 0;
    v_certificates_count INT := 0;
    v_documents_count INT := 0;
    v_queued_cleanup_count INT := 0;
BEGIN
    -- 1. Verify caller authentication & admin role
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL AND auth.role() != 'service_role' THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Administrative privileges required to delete historical data.';
    END IF;

    IF v_actor_id IS NOT NULL THEN
        SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;
    END IF;

    v_scope := UPPER(TRIM(p_scope));
    IF v_scope NOT IN ('EVENT', 'CATEGORY', 'SUB_EVENT') THEN
        RAISE EXCEPTION 'Invalid scope: %. Must be EVENT, CATEGORY, or SUB_EVENT.', p_scope;
    END IF;

    -- 2. Validate entity & status
    IF v_scope = 'EVENT' THEN
        SELECT name, status INTO v_event_name, v_status FROM public.events WHERE id = p_entity_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Event not found.';
        END IF;
        IF v_status != 'ARCHIVED' THEN
            RAISE EXCEPTION 'Event "%" is currently ACTIVE. You must ARCHIVE it before permanent deletion.', v_event_name;
        END IF;

        v_entity_name := v_event_name;

        -- Collect event banner
        SELECT ARRAY_AGG(banner_path) INTO v_raw_banner_paths FROM public.events WHERE id = p_entity_id AND banner_path IS NOT NULL;
        v_raw_banner_paths := COALESCE(v_raw_banner_paths, '{}');

        SELECT ARRAY_AGG(id) INTO v_category_ids FROM public.categories WHERE event_id = p_entity_id;
        SELECT ARRAY_AGG(id) INTO v_sub_event_ids FROM public.sub_events 
        WHERE event_id = p_entity_id OR category_id = ANY(COALESCE(v_category_ids, '{}'));

    ELSIF v_scope = 'CATEGORY' THEN
        SELECT c.name, c.status, e.name INTO v_category_name, v_status, v_event_name 
        FROM public.categories c
        LEFT JOIN public.events e ON c.event_id = e.id
        WHERE c.id = p_entity_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Category not found.';
        END IF;
        IF v_status != 'ARCHIVED' THEN
            RAISE EXCEPTION 'Category "%" is currently ACTIVE. You must ARCHIVE it before permanent deletion.', v_category_name;
        END IF;

        v_entity_name := v_category_name;
        v_category_ids := ARRAY[p_entity_id];

        SELECT ARRAY_AGG(id) INTO v_sub_event_ids FROM public.sub_events WHERE category_id = p_entity_id;

    ELSIF v_scope = 'SUB_EVENT' THEN
        SELECT se.name, se.status, c.name, e.name INTO v_sub_event_name, v_status, v_category_name, v_event_name 
        FROM public.sub_events se
        LEFT JOIN public.categories c ON se.category_id = c.id
        LEFT JOIN public.events e ON se.event_id = e.id OR c.event_id = e.id
        WHERE se.id = p_entity_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Sub-event not found.';
        END IF;
        IF v_status != 'ARCHIVED' THEN
            RAISE EXCEPTION 'Sub-event "%" is currently ACTIVE. You must ARCHIVE it before permanent deletion.', v_sub_event_name;
        END IF;

        v_entity_name := v_sub_event_name;
        v_sub_event_ids := ARRAY[p_entity_id];
    END IF;

    -- 3. Validate confirmation phrase strictly: ONLY exact 'CONFIRM' is accepted.
    IF p_confirmation_phrase IS NULL OR p_confirmation_phrase != 'CONFIRM' THEN
        RAISE EXCEPTION 'Confirmation phrase mismatch. Expected "CONFIRM", received "%".', p_confirmation_phrase;
    END IF;

    -- Normalize arrays
    v_category_ids := COALESCE(v_category_ids, '{}');
    v_sub_event_ids := COALESCE(v_sub_event_ids, '{}');
    v_categories_count := COALESCE(array_length(v_category_ids, 1), 0);
    v_sub_events_count := COALESCE(array_length(v_sub_event_ids, 1), 0);

    -- Collect sub-event banner paths
    IF v_sub_events_count > 0 THEN
        DECLARE
            v_sub_banners TEXT[];
        BEGIN
            SELECT ARRAY_AGG(banner_path) INTO v_sub_banners FROM public.sub_events WHERE id = ANY(v_sub_event_ids) AND banner_path IS NOT NULL;
            IF v_sub_banners IS NOT NULL THEN
                v_raw_banner_paths := v_raw_banner_paths || v_sub_banners;
            END IF;
        END;
    END IF;

    -- Clean & filter banner paths strictly within allowed namespaces
    FOREACH v_path IN ARRAY v_raw_banner_paths LOOP
        v_clean_path := public.extract_event_storage_path(v_path);
        IF v_clean_path IS NOT NULL AND NOT (v_clean_path = ANY(v_deleted_banner_paths)) THEN
            v_deleted_banner_paths := array_append(v_deleted_banner_paths, v_clean_path);
        END IF;
    END LOOP;

    -- 4. Atomically insert banner cleanup jobs into Transactional Outbox (storage_cleanup_queue)
    FOREACH v_clean_path IN ARRAY v_deleted_banner_paths LOOP
        INSERT INTO public.storage_cleanup_queue (
            storage_bucket,
            storage_path,
            asset_type,
            source_entity_type,
            source_entity_id,
            operation,
            status
        ) VALUES (
            'events',
            v_clean_path,
            CASE WHEN v_clean_path LIKE 'events/banners/%' THEN 'EVENT_BANNER' ELSE 'SUB_EVENT_BANNER' END,
            v_scope,
            p_entity_id,
            'DELETE',
            'PENDING'
        );
        v_queued_cleanup_count := v_queued_cleanup_count + 1;
    END LOOP;

    -- 5. Collect affected entities for atomic deletion & metrics
    IF v_sub_events_count > 0 THEN
        SELECT ARRAY_AGG(id) INTO v_registration_ids FROM public.registrations WHERE sub_event_id = ANY(v_sub_event_ids);
        v_registration_ids := COALESCE(v_registration_ids, '{}');
        v_registrations_count := COALESCE(array_length(v_registration_ids, 1), 0);

        IF v_registrations_count > 0 THEN
            SELECT ARRAY_AGG(id) INTO v_team_ids FROM public.teams WHERE registration_id = ANY(v_registration_ids);
            v_team_ids := COALESCE(v_team_ids, '{}');
            v_teams_count := COALESCE(array_length(v_team_ids, 1), 0);

            IF v_teams_count > 0 THEN
                SELECT ARRAY_AGG(id) INTO v_team_member_ids FROM public.team_members WHERE team_id = ANY(v_team_ids);
                v_team_member_ids := COALESCE(v_team_member_ids, '{}');
                v_team_members_count := COALESCE(array_length(v_team_member_ids, 1), 0);
            END IF;
        END IF;

        -- Unset podium references on sub_events
        UPDATE public.sub_events
        SET winner_team_id = NULL, runner_team_id = NULL, third_team_id = NULL
        WHERE id = ANY(v_sub_event_ids);

        -- Delete Certificates
        DELETE FROM public.certificates 
        WHERE sub_event_id = ANY(v_sub_event_ids) OR team_member_id = ANY(v_team_member_ids);
        GET DIAGNOSTICS v_certificates_count = ROW_COUNT;

        -- Delete Attendance Records
        DELETE FROM public.attendance_records 
        WHERE sub_event_id = ANY(v_sub_event_ids) OR team_id = ANY(v_team_ids) OR scanned_member_id = ANY(v_team_member_ids);
        GET DIAGNOSTICS v_attendance_count = ROW_COUNT;

        -- Delete Feedback Responses
        DELETE FROM public.feedback_responses 
        WHERE sub_event_id = ANY(v_sub_event_ids) OR registration_id = ANY(v_registration_ids);
        GET DIAGNOSTICS v_feedback_count = ROW_COUNT;

        -- Delete Payments
        DELETE FROM public.payments 
        WHERE registration_id = ANY(v_registration_ids);
        GET DIAGNOSTICS v_payments_count = ROW_COUNT;

        -- Delete Team Members
        DELETE FROM public.team_members 
        WHERE team_id = ANY(v_team_ids);

        -- Delete Teams
        DELETE FROM public.teams 
        WHERE registration_id = ANY(v_registration_ids);

        -- Clean up registration document metadata from public.documents
        -- (NOTE: Physical files in 'documents' storage bucket remain preserved per strict requirement!)
        IF v_registrations_count > 0 THEN
            DELETE FROM public.documents
            WHERE (entity_type = 'REGISTRATION' AND entity_id = ANY(v_registration_ids))
               OR (entity_id = ANY(v_team_member_ids))
               OR (entity_id = ANY(v_team_ids));
            GET DIAGNOSTICS v_documents_count = ROW_COUNT;
        END IF;

        -- Delete Registrations
        DELETE FROM public.registrations 
        WHERE sub_event_id = ANY(v_sub_event_ids);

        -- Delete Coordinator Assignments
        DELETE FROM public.coordinator_assignments 
        WHERE sub_event_id = ANY(v_sub_event_ids);

        -- Delete Sub-Events
        DELETE FROM public.sub_events 
        WHERE id = ANY(v_sub_event_ids);
    END IF;

    -- Delete Category / Event parent scopes
    IF v_scope = 'CATEGORY' THEN
        DELETE FROM public.categories WHERE id = p_entity_id;
    ELSIF v_scope = 'EVENT' THEN
        IF v_categories_count > 0 THEN
            DELETE FROM public.categories WHERE id = ANY(v_category_ids);
        END IF;
        DELETE FROM public.events WHERE id = p_entity_id;
    END IF;

    -- 6. Record Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_actor_id,
        'ADMIN_HISTORICAL_DATA_DELETION',
        v_scope,
        p_entity_id,
        jsonb_build_object(
            'scope', v_scope,
            'entity_id', p_entity_id,
            'entity_name', v_entity_name,
            'deleted_counts', jsonb_build_object(
                'categories', v_categories_count,
                'sub_events', v_sub_events_count,
                'registrations', v_registrations_count,
                'teams', v_teams_count,
                'team_members', v_team_members_count,
                'attendance_records', v_attendance_count,
                'payments', v_payments_count,
                'feedback_responses', v_feedback_count,
                'certificates', v_certificates_count,
                'documents', v_documents_count
            ),
            'deleted_banner_paths', v_deleted_banner_paths,
            'queued_cleanups', v_queued_cleanup_count,
            'deleted_by', COALESCE(v_actor_email, v_actor_id::text, 'service_role'),
            'deleted_at', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Historical data permanently deleted and banner cleanups queued.',
        'scope', v_scope,
        'entity_id', p_entity_id,
        'entity_name', v_entity_name,
        'deleted_banner_paths', v_deleted_banner_paths,
        'queued_cleanups', v_queued_cleanup_count,
        'deleted_counts', jsonb_build_object(
            'categories', v_categories_count,
            'sub_events', v_sub_events_count,
            'registrations', v_registrations_count,
            'teams', v_teams_count,
            'team_members', v_team_members_count,
            'attendance_records', v_attendance_count,
            'payments', v_payments_count,
            'feedback_responses', v_feedback_count,
            'certificates', v_certificates_count,
            'documents', v_documents_count
        )
    );
END;
$$;

-- 6. Canonical Delegation: admin_delete_event delegates to admin_delete_historical_data
CREATE OR REPLACE FUNCTION public.admin_delete_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage, pg_catalog
AS $$
BEGIN
    -- Delegates to the canonical deletion authority
    RETURN public.admin_delete_historical_data('EVENT', p_event_id, 'CONFIRM');
END;
$$;

-- 7. Canonical Delegation: admin_delete_sub_event delegates to admin_delete_historical_data
CREATE OR REPLACE FUNCTION public.admin_delete_sub_event(p_sub_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage, pg_catalog
AS $$
BEGIN
    -- Delegates to the canonical deletion authority
    RETURN public.admin_delete_historical_data('SUB_EVENT', p_sub_event_id, 'CONFIRM');
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.claim_storage_cleanup_jobs(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_storage_cleanup_jobs(INT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.complete_storage_cleanup_job(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_storage_cleanup_job(UUID, BOOLEAN, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_historical_data(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_historical_data(text, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_event(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_sub_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_sub_event(uuid) TO authenticated, service_role;

GRANT ALL ON public.storage_cleanup_queue TO authenticated, service_role;
