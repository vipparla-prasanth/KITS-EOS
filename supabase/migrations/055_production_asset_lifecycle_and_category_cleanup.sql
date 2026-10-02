-- Migration 055: Production Asset Lifecycle & Category Banner Cleanup
-- 1. Drops obsolete category banner_path column from public.categories
-- 2. Hardens public.admin_delete_historical_data to extract, purge, and return deleted banner paths from Storage
-- 3. Hardens public.admin_delete_event and public.admin_delete_sub_event for banner lifecycle consistency
-- 4. Cleans up dangling document metadata records in public.documents on historical deletion
-- 5. Repairs broken DANCE sub-event banner reference

-- Helper function to extract storage object path from banner_path (URL or relative path)
CREATE OR REPLACE FUNCTION public.extract_event_storage_path(p_url_or_path TEXT)
RETURNS TEXT AS $$
DECLARE
    v_clean TEXT;
    v_pattern TEXT := '/storage/v1/object/public/events/';
    v_pos INT;
BEGIN
    IF p_url_or_path IS NULL OR trim(p_url_or_path) = '' THEN
        RETURN NULL;
    END IF;

    v_clean := trim(p_url_or_path);

    -- If fully qualified Supabase storage URL
    v_pos := position(v_pattern in v_clean);
    IF v_pos > 0 THEN
        v_clean := substring(v_clean from (v_pos + length(v_pattern)));
    END IF;

    -- Strip leading slashes
    v_clean := regexp_replace(v_clean, '^/+', '');

    -- Only permit allowed namespaces: events/banners/ or subevents/banners/
    IF v_clean ~ '^events/banners/[^/]+$' OR v_clean ~ '^subevents/banners/[^/]+$' THEN
        RETURN v_clean;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 1. Drop obsolete Category banner_path column
ALTER TABLE public.categories DROP COLUMN IF EXISTS banner_path;

-- 2. Repair broken DANCE sub-event reference if still pointing to missing file
UPDATE public.sub_events
SET banner_path = NULL
WHERE id = '2aef4c8a-7bae-4c35-874b-a084032eab78'
  AND banner_path LIKE '%1788535422917_pavb4o0.jpeg%';

-- 3. Update public.admin_delete_historical_data
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
BEGIN
    -- 1. Verify caller authentication & admin role
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Administrative privileges required to delete historical data.';
    END IF;

    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

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

    -- 4. Collect affected entities for atomic deletion & metrics
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

    -- 5. Record Audit Log
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
            'deleted_by', COALESCE(v_actor_email, v_actor_id::text),
            'deleted_at', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Historical data and associated banner assets permanently deleted successfully.',
        'scope', v_scope,
        'entity_id', p_entity_id,
        'entity_name', v_entity_name,
        'deleted_banner_paths', v_deleted_banner_paths,
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

-- 4. Update public.admin_delete_event
CREATE OR REPLACE FUNCTION public.admin_delete_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage, pg_catalog
AS $$
DECLARE
    v_event_name character varying;
    v_event_status public.event_status;
    v_actor_id uuid;
    v_has_registrations boolean := false;
    v_raw_banner_paths TEXT[] := '{}';
    v_deleted_banner_paths TEXT[] := '{}';
    v_sub_banners TEXT[];
    v_path TEXT;
    v_clean_path TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can delete events.';
    END IF;

    SELECT name, status INTO v_event_name, v_event_status FROM public.events WHERE id = p_event_id;
    IF v_event_name IS NULL THEN
        RAISE EXCEPTION 'Event not found.';
    END IF;

    IF v_event_status != 'ARCHIVED'::public.event_status THEN
        RAISE EXCEPTION 'Illegal Operation: Only ARCHIVED events can be permanently deleted. Archive the event first.';
    END IF;

    v_actor_id := auth.uid();

    SELECT EXISTS (
        SELECT 1 FROM public.registrations r
        JOIN public.sub_events se ON r.sub_event_id = se.id
        WHERE se.event_id = p_event_id 
           OR se.category_id IN (SELECT id FROM public.categories WHERE event_id = p_event_id)
    ) INTO v_has_registrations;

    -- Collect banner paths
    SELECT ARRAY_AGG(banner_path) INTO v_raw_banner_paths FROM public.events WHERE id = p_event_id AND banner_path IS NOT NULL;
    v_raw_banner_paths := COALESCE(v_raw_banner_paths, '{}');

    SELECT ARRAY_AGG(banner_path) INTO v_sub_banners FROM public.sub_events 
    WHERE (event_id = p_event_id OR category_id IN (SELECT id FROM public.categories WHERE event_id = p_event_id))
      AND banner_path IS NOT NULL;
    IF v_sub_banners IS NOT NULL THEN
        v_raw_banner_paths := v_raw_banner_paths || v_sub_banners;
    END IF;

    FOREACH v_path IN ARRAY v_raw_banner_paths LOOP
        v_clean_path := public.extract_event_storage_path(v_path);
        IF v_clean_path IS NOT NULL AND NOT (v_clean_path = ANY(v_deleted_banner_paths)) THEN
            v_deleted_banner_paths := array_append(v_deleted_banner_paths, v_clean_path);
        END IF;
    END LOOP;

    IF v_has_registrations THEN
        UPDATE public.sub_events SET status = 'PERMANENTLY_DELETED'::public.event_status
        WHERE event_id = p_event_id 
           OR category_id IN (SELECT id FROM public.categories WHERE event_id = p_event_id);

        UPDATE public.categories SET status = 'PERMANENTLY_DELETED'::public.event_status
        WHERE event_id = p_event_id;

        UPDATE public.events SET status = 'PERMANENTLY_DELETED'::public.event_status
        WHERE id = p_event_id;
    ELSE
        DELETE FROM public.coordinator_assignments 
        WHERE sub_event_id IN (
            SELECT id FROM public.sub_events 
            WHERE event_id = p_event_id 
               OR category_id IN (SELECT id FROM public.categories WHERE event_id = p_event_id)
        );

        DELETE FROM public.sub_events 
        WHERE event_id = p_event_id 
           OR category_id IN (SELECT id FROM public.categories WHERE event_id = p_event_id);

        DELETE FROM public.categories WHERE event_id = p_event_id;
        DELETE FROM public.events WHERE id = p_event_id;
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'EVENT_DELETED',
        'EVENT',
        p_event_id,
        jsonb_build_object(
            'event_name', v_event_name,
            'action', 'PERMANENT_DELETE',
            'historical_records_preserved', v_has_registrations,
            'deleted_banner_paths', v_deleted_banner_paths
        ),
        pg_catalog.now()
    );

    RETURN jsonb_build_object(
        'success', true, 
        'message', 'Event permanently deleted.',
        'deleted_banner_paths', v_deleted_banner_paths
    );
END;
$$;

-- 5. Update public.admin_delete_sub_event
CREATE OR REPLACE FUNCTION public.admin_delete_sub_event(p_sub_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage, pg_catalog
AS $$
DECLARE
    v_sub_name character varying;
    v_actor_id uuid;
    v_has_registrations boolean := false;
    v_raw_banner_paths TEXT[] := '{}';
    v_deleted_banner_paths TEXT[] := '{}';
    v_path TEXT;
    v_clean_path TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized.';
    END IF;

    SELECT name INTO v_sub_name FROM public.sub_events WHERE id = p_sub_event_id;
    IF v_sub_name IS NULL THEN
        RAISE EXCEPTION 'Sub-event not found.';
    END IF;

    v_actor_id := auth.uid();

    SELECT EXISTS (
        SELECT 1 FROM public.registrations WHERE sub_event_id = p_sub_event_id
    ) INTO v_has_registrations;

    -- Collect sub-event banner path
    SELECT ARRAY_AGG(banner_path) INTO v_raw_banner_paths FROM public.sub_events WHERE id = p_sub_event_id AND banner_path IS NOT NULL;
    v_raw_banner_paths := COALESCE(v_raw_banner_paths, '{}');

    FOREACH v_path IN ARRAY v_raw_banner_paths LOOP
        v_clean_path := public.extract_event_storage_path(v_path);
        IF v_clean_path IS NOT NULL AND NOT (v_clean_path = ANY(v_deleted_banner_paths)) THEN
            v_deleted_banner_paths := array_append(v_deleted_banner_paths, v_clean_path);
        END IF;
    END LOOP;

    IF v_has_registrations THEN
        UPDATE public.sub_events SET status = 'PERMANENTLY_DELETED'::public.event_status WHERE id = p_sub_event_id;
    ELSE
        DELETE FROM public.coordinator_assignments WHERE sub_event_id = p_sub_event_id;
        DELETE FROM public.sub_events WHERE id = p_sub_event_id;
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'SUB_EVENT_DELETED',
        'SUB_EVENT',
        p_sub_event_id,
        jsonb_build_object(
            'sub_event_name', v_sub_name, 
            'historical_records_preserved', v_has_registrations,
            'deleted_banner_paths', v_deleted_banner_paths
        ),
        pg_catalog.now()
    );

    RETURN jsonb_build_object(
        'success', true, 
        'message', 'Sub-event deleted.',
        'deleted_banner_paths', v_deleted_banner_paths
    );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.extract_event_storage_path(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extract_event_storage_path(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_historical_data(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_historical_data(text, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_event(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_sub_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_sub_event(uuid) TO authenticated, service_role;
