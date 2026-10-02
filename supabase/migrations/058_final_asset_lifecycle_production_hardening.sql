-- Migration 058: Final Production Hardening for Asset Lifecycle & Storage Outbox
-- 1. Partial UNIQUE index on active queue paths to prevent duplicate in-flight jobs
-- 2. Optimized FIFO index for claim_storage_cleanup_jobs() (Index Scan without Sort)
-- 3. Hardened admin_delete_historical_data() with row-level FOR UPDATE locking & idempotency
-- 4. Admin maintenance RPC: admin_purge_completed_storage_cleanup_jobs()
-- 5. Admin failure visibility RPC: admin_get_storage_cleanup_failures()

-- 1. Partial Unique Index: Prevent duplicate concurrent active cleanup jobs for same bucket + path
-- Only applies to active jobs ('PENDING', 'PROCESSING', 'FAILED_RETRYABLE')
-- Completed and permanently failed jobs are allowed multiple historical entries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_cleanup_queue_active_path
ON public.storage_cleanup_queue (storage_bucket, storage_path)
WHERE status IN ('PENDING', 'PROCESSING', 'FAILED_RETRYABLE');

-- 2. FIFO Claiming Performance Index
-- Enables PostgreSQL to perform an Index Scan ordered by created_at ASC with zero sort cost
CREATE INDEX IF NOT EXISTS idx_storage_cleanup_queue_claimable_fifo
ON public.storage_cleanup_queue (created_at ASC)
WHERE status IN ('PENDING', 'FAILED_RETRYABLE', 'PROCESSING');

-- 3. Hardened Canonical Deletion RPC with Row-Level FOR UPDATE Locking & Idempotency
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

    -- 2. Validate confirmation phrase strictly: ONLY exact 'CONFIRM' is accepted.
    IF p_confirmation_phrase IS NULL OR p_confirmation_phrase != 'CONFIRM' THEN
        RAISE EXCEPTION 'Confirmation phrase mismatch. Expected "CONFIRM", received "%".', p_confirmation_phrase;
    END IF;

    -- 3. Validate entity & status with FOR UPDATE row locking (prevents replacement race)
    IF v_scope = 'EVENT' THEN
        SELECT name, status INTO v_event_name, v_status 
        FROM public.events 
        WHERE id = p_entity_id 
        FOR UPDATE;

        IF NOT FOUND THEN
            -- Idempotency Check: Was this event already permanently deleted previously?
            IF EXISTS (
                SELECT 1 FROM public.audit_logs 
                WHERE entity_id = p_entity_id 
                  AND action = 'ADMIN_HISTORICAL_DATA_DELETION'
            ) THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'already_deleted', true,
                    'message', 'Event was already permanently deleted.',
                    'scope', v_scope,
                    'entity_id', p_entity_id,
                    'deleted_banner_paths', '{}'::text[],
                    'queued_cleanups', 0,
                    'deleted_counts', jsonb_build_object(
                        'categories', 0,
                        'sub_events', 0,
                        'registrations', 0,
                        'teams', 0,
                        'team_members', 0,
                        'attendance_records', 0,
                        'payments', 0,
                        'feedback_responses', 0,
                        'certificates', 0,
                        'documents', 0
                    )
                );
            ELSE
                RAISE EXCEPTION 'Event not found.';
            END IF;
        END IF;

        IF v_status != 'ARCHIVED' THEN
            RAISE EXCEPTION 'Event "%" is currently ACTIVE. You must ARCHIVE it before permanent deletion.', v_event_name;
        END IF;

        v_entity_name := v_event_name;

        -- Collect event banner
        SELECT ARRAY_AGG(banner_path) INTO v_raw_banner_paths FROM public.events WHERE id = p_entity_id AND banner_path IS NOT NULL;
        v_raw_banner_paths := COALESCE(v_raw_banner_paths, '{}');

        SELECT ARRAY_AGG(id) INTO v_category_ids FROM public.categories WHERE event_id = p_entity_id;
        
        -- Lock child sub-events FOR UPDATE as well to avoid mid-deletion modifications
        SELECT ARRAY_AGG(id) INTO v_sub_event_ids FROM (
            SELECT id FROM public.sub_events 
            WHERE event_id = p_entity_id OR category_id = ANY(COALESCE(v_category_ids, '{}'))
            FOR UPDATE
        ) se;

    ELSIF v_scope = 'CATEGORY' THEN
        SELECT c.name, c.status, e.name INTO v_category_name, v_status, v_event_name 
        FROM public.categories c
        LEFT JOIN public.events e ON c.event_id = e.id
        WHERE c.id = p_entity_id
        FOR UPDATE OF c;

        IF NOT FOUND THEN
            IF EXISTS (
                SELECT 1 FROM public.audit_logs 
                WHERE entity_id = p_entity_id 
                  AND action = 'ADMIN_HISTORICAL_DATA_DELETION'
            ) THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'already_deleted', true,
                    'message', 'Category was already permanently deleted.',
                    'scope', v_scope,
                    'entity_id', p_entity_id,
                    'deleted_banner_paths', '{}'::text[],
                    'queued_cleanups', 0,
                    'deleted_counts', jsonb_build_object(
                        'categories', 0,
                        'sub_events', 0,
                        'registrations', 0,
                        'teams', 0,
                        'team_members', 0,
                        'attendance_records', 0,
                        'payments', 0,
                        'feedback_responses', 0,
                        'certificates', 0,
                        'documents', 0
                    )
                );
            ELSE
                RAISE EXCEPTION 'Category not found.';
            END IF;
        END IF;

        IF v_status != 'ARCHIVED' THEN
            RAISE EXCEPTION 'Category "%" is currently ACTIVE. You must ARCHIVE it before permanent deletion.', v_category_name;
        END IF;

        v_entity_name := v_category_name;
        v_category_ids := ARRAY[p_entity_id];

        SELECT ARRAY_AGG(id) INTO v_sub_event_ids FROM (
            SELECT id FROM public.sub_events WHERE category_id = p_entity_id FOR UPDATE
        ) se;

    ELSIF v_scope = 'SUB_EVENT' THEN
        SELECT se.name, se.status, c.name, e.name INTO v_sub_event_name, v_status, v_category_name, v_event_name 
        FROM public.sub_events se
        LEFT JOIN public.categories c ON se.category_id = c.id
        LEFT JOIN public.events e ON se.event_id = e.id OR c.event_id = e.id
        WHERE se.id = p_entity_id
        FOR UPDATE OF se;

        IF NOT FOUND THEN
            IF EXISTS (
                SELECT 1 FROM public.audit_logs 
                WHERE entity_id = p_entity_id 
                  AND action = 'ADMIN_HISTORICAL_DATA_DELETION'
            ) THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'already_deleted', true,
                    'message', 'Sub-event was already permanently deleted.',
                    'scope', v_scope,
                    'entity_id', p_entity_id,
                    'deleted_banner_paths', '{}'::text[],
                    'queued_cleanups', 0,
                    'deleted_counts', jsonb_build_object(
                        'categories', 0,
                        'sub_events', 0,
                        'registrations', 0,
                        'teams', 0,
                        'team_members', 0,
                        'attendance_records', 0,
                        'payments', 0,
                        'feedback_responses', 0,
                        'certificates', 0,
                        'documents', 0
                    )
                );
            ELSE
                RAISE EXCEPTION 'Sub-event not found.';
            END IF;
        END IF;

        IF v_status != 'ARCHIVED' THEN
            RAISE EXCEPTION 'Sub-event "%" is currently ACTIVE. You must ARCHIVE it before permanent deletion.', v_sub_event_name;
        END IF;

        v_entity_name := v_sub_event_name;
        v_sub_event_ids := ARRAY[p_entity_id];
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
    -- Deduplicates against any currently active queue jobs using ON CONFLICT DO NOTHING
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
        )
        ON CONFLICT (storage_bucket, storage_path) WHERE status IN ('PENDING', 'PROCESSING', 'FAILED_RETRYABLE')
        DO NOTHING;
        
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

-- 4. Admin Maintenance RPC: admin_purge_completed_storage_cleanup_jobs
-- Controlled, audited cleanup of aged COMPLETED jobs from the queue.
-- NEVER deletes PENDING, PROCESSING, FAILED_RETRYABLE, or FAILED_PERMANENT jobs.
-- NEVER deletes audit_logs.
CREATE OR REPLACE FUNCTION public.admin_purge_completed_storage_cleanup_jobs(
    p_retention_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_purged_count INT := 0;
    v_cutoff_time TIMESTAMPTZ;
BEGIN
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Unauthorized: Administrative or service privileges required.';
    END IF;

    IF p_retention_days < 7 THEN
        RAISE EXCEPTION 'Minimum retention period is 7 days.';
    END IF;

    v_cutoff_time := timezone('utc'::text, now()) - (p_retention_days || ' days')::INTERVAL;

    -- Only delete COMPLETED jobs older than cutoff
    DELETE FROM public.storage_cleanup_queue
    WHERE status = 'COMPLETED'
      AND completed_at < v_cutoff_time;
    
    GET DIAGNOSTICS v_purged_count = ROW_COUNT;

    -- Audit log the maintenance operation
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        auth.uid(),
        'BANNER_STORAGE_CLEANUP_QUEUE_MAINTENANCE',
        'SYSTEM',
        COALESCE(auth.uid(), gen_random_uuid()),
        jsonb_build_object(
            'purged_completed_jobs', v_purged_count,
            'retention_days', p_retention_days,
            'cutoff_time', v_cutoff_time
        ),
        timezone('utc'::text, now())
    );

    RETURN jsonb_build_object(
        'success', true,
        'purged_count', v_purged_count,
        'retention_days', p_retention_days,
        'cutoff_time', v_cutoff_time
    );
END;
$$;

-- 5. Admin Visibility RPC: admin_get_storage_cleanup_failures
-- Authorized RPC allowing administrators to inspect permanently failed storage jobs
CREATE OR REPLACE FUNCTION public.admin_get_storage_cleanup_failures(
    p_limit INT DEFAULT 50,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    storage_bucket VARCHAR(50),
    storage_path TEXT,
    asset_type VARCHAR(50),
    source_entity_type VARCHAR(50),
    source_entity_id UUID,
    operation VARCHAR(50),
    status public.storage_cleanup_status,
    attempt_count INT,
    max_attempts INT,
    last_error TEXT,
    created_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Unauthorized: Administrative or service privileges required.';
    END IF;

    RETURN QUERY
    SELECT 
        q.id,
        q.storage_bucket,
        q.storage_path,
        q.asset_type,
        q.source_entity_type,
        q.source_entity_id,
        q.operation,
        q.status,
        q.attempt_count,
        q.max_attempts,
        q.last_error,
        q.created_at,
        q.completed_at
    FROM public.storage_cleanup_queue q
    WHERE q.status = 'FAILED_PERMANENT'
    ORDER BY q.created_at DESC
    LIMIT LEAST(p_limit, 100)
    OFFSET GREATEST(p_offset, 0);
END;
$$;

-- Grants
REVOKE ALL ON FUNCTION public.admin_purge_completed_storage_cleanup_jobs(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_completed_storage_cleanup_jobs(INT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_get_storage_cleanup_failures(INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_storage_cleanup_failures(INT, INT) TO authenticated, service_role;

-- 6. Helper RPC: check_storage_cleanup_indexes
CREATE OR REPLACE FUNCTION public.check_storage_cleanup_indexes()
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT ARRAY_AGG(indexname::text) 
    FROM pg_indexes 
    WHERE tablename = 'storage_cleanup_queue';
$$;

REVOKE ALL ON FUNCTION public.check_storage_cleanup_indexes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_storage_cleanup_indexes() TO authenticated, service_role;

