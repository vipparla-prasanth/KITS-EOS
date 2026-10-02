-- Migration 030: Permanent Historical Data Deletion System
-- Administrator-only, high-risk historical data deletion pipeline.

-- 1. Function to calculate exact live impact before deletion
CREATE OR REPLACE FUNCTION public.admin_calculate_historical_deletion_impact(
    p_scope TEXT,
    p_entity_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
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
    v_categories_count INT := 0;
    v_sub_events_count INT := 0;
    v_registrations_count INT := 0;
    v_teams_count INT := 0;
    v_team_members_count INT := 0;
    v_attendance_count INT := 0;
    v_payments_count INT := 0;
    v_feedback_count INT := 0;
    v_certificates_count INT := 0;
    v_confirmation_phrase TEXT;
BEGIN
    -- 1. Verify caller authentication & admin role
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Administrative privileges required to inspect historical deletion impact.';
    END IF;

    v_scope := UPPER(TRIM(p_scope));
    IF v_scope NOT IN ('EVENT', 'CATEGORY', 'SUB_EVENT') THEN
        RAISE EXCEPTION 'Invalid scope: %. Must be EVENT, CATEGORY, or SUB_EVENT.', p_scope;
    END IF;

    -- 2. Resolve scope and target IDs
    IF v_scope = 'EVENT' THEN
        SELECT name, status INTO v_event_name, v_status FROM public.events WHERE id = p_entity_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Event not found.';
        END IF;
        v_entity_name := v_event_name;
        v_confirmation_phrase := 'DELETE ' || UPPER(REGEXP_REPLACE(v_event_name, '[^a-zA-Z0-9]+', ' ', 'g'));

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
        v_entity_name := v_category_name;
        v_category_ids := ARRAY[p_entity_id];
        v_confirmation_phrase := 'DELETE ' || UPPER(REGEXP_REPLACE(COALESCE(v_event_name, '') || ' ' || v_category_name, '[^a-zA-Z0-9]+', ' ', 'g'));

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
        v_entity_name := v_sub_event_name;
        v_sub_event_ids := ARRAY[p_entity_id];
        v_confirmation_phrase := 'DELETE ' || UPPER(REGEXP_REPLACE(COALESCE(v_event_name, '') || ' ' || v_sub_event_name, '[^a-zA-Z0-9]+', ' ', 'g'));
    END IF;

    -- Normalize arrays
    v_category_ids := COALESCE(v_category_ids, '{}');
    v_sub_event_ids := COALESCE(v_sub_event_ids, '{}');

    v_categories_count := COALESCE(array_length(v_category_ids, 1), 0);
    v_sub_events_count := COALESCE(array_length(v_sub_event_ids, 1), 0);

    -- Collect operational entity IDs
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

            SELECT COUNT(*) INTO v_payments_count FROM public.payments WHERE registration_id = ANY(v_registration_ids);
        END IF;

        SELECT COUNT(*) INTO v_attendance_count FROM public.attendance_records WHERE sub_event_id = ANY(v_sub_event_ids);
        SELECT COUNT(*) INTO v_feedback_count FROM public.feedback_responses WHERE sub_event_id = ANY(v_sub_event_ids);
        SELECT COUNT(*) INTO v_certificates_count FROM public.certificates WHERE sub_event_id = ANY(v_sub_event_ids);
    END IF;

    RETURN jsonb_build_object(
        'scope', v_scope,
        'entity_id', p_entity_id,
        'entity_name', v_entity_name,
        'event_name', v_event_name,
        'category_name', v_category_name,
        'sub_event_name', v_sub_event_name,
        'status', v_status,
        'is_archived', (v_status = 'ARCHIVED'),
        'confirmation_phrase', TRIM(v_confirmation_phrase),
        'categories_count', v_categories_count,
        'sub_events_count', v_sub_events_count,
        'registrations_count', v_registrations_count,
        'teams_count', v_teams_count,
        'team_members_count', v_team_members_count,
        'attendance_count', v_attendance_count,
        'payments_count', v_payments_count,
        'feedback_count', v_feedback_count,
        'certificates_count', v_certificates_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_calculate_historical_deletion_impact(TEXT, UUID) TO authenticated;

-- 2. Function to execute atomic permanent historical deletion
CREATE OR REPLACE FUNCTION public.admin_delete_historical_data(
    p_scope TEXT,
    p_entity_id UUID,
    p_confirmation_phrase TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
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
    v_expected_phrase TEXT;
    v_sub_event_ids UUID[] := '{}';
    v_category_ids UUID[] := '{}';
    v_registration_ids UUID[] := '{}';
    v_team_ids UUID[] := '{}';
    v_team_member_ids UUID[] := '{}';
    v_categories_count INT := 0;
    v_sub_events_count INT := 0;
    v_registrations_count INT := 0;
    v_teams_count INT := 0;
    v_team_members_count INT := 0;
    v_attendance_count INT := 0;
    v_payments_count INT := 0;
    v_feedback_count INT := 0;
    v_certificates_count INT := 0;
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
        v_expected_phrase := 'DELETE ' || UPPER(REGEXP_REPLACE(v_event_name, '[^a-zA-Z0-9]+', ' ', 'g'));

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
        v_expected_phrase := 'DELETE ' || UPPER(REGEXP_REPLACE(COALESCE(v_event_name, '') || ' ' || v_category_name, '[^a-zA-Z0-9]+', ' ', 'g'));

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
        v_expected_phrase := 'DELETE ' || UPPER(REGEXP_REPLACE(COALESCE(v_event_name, '') || ' ' || v_sub_event_name, '[^a-zA-Z0-9]+', ' ', 'g'));
    END IF;

    -- 3. Validate confirmation phrase
    IF p_confirmation_phrase IS NULL 
       OR (UPPER(TRIM(p_confirmation_phrase)) != UPPER(TRIM(v_expected_phrase))
           AND UPPER(TRIM(p_confirmation_phrase)) != UPPER(TRIM('DELETE ' || v_entity_name))
           AND UPPER(TRIM(p_confirmation_phrase)) != UPPER(TRIM(v_entity_name))) THEN
        RAISE EXCEPTION 'Confirmation phrase mismatch. Expected "%", received "%".', TRIM(v_expected_phrase), p_confirmation_phrase;
    END IF;

    -- Normalize arrays
    v_category_ids := COALESCE(v_category_ids, '{}');
    v_sub_event_ids := COALESCE(v_sub_event_ids, '{}');
    v_categories_count := COALESCE(array_length(v_category_ids, 1), 0);
    v_sub_events_count := COALESCE(array_length(v_sub_event_ids, 1), 0);

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

    -- 5. Record Audit Log (Audit logs are permanently preserved and never cascade-deleted!)
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
                'certificates', v_certificates_count
            ),
            'deleted_by', COALESCE(v_actor_email, v_actor_id::text),
            'deleted_at', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Historical data permanently deleted successfully.',
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
            'certificates', v_certificates_count
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_historical_data(TEXT, UUID, TEXT) TO authenticated;
