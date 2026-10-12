-- ==============================================================================
-- Migration: 110_repair_admin_registration_deletion_rpcs.sql
-- Description:
--   Repairs public.admin_bulk_delete_registrations and public.admin_delete_registration
--   Fixes the typo calling reset_sub_event_besults_if_invalid -> reset_sub_event_results_if_invalid
--   Fixes the return JSON payload 'subcess' -> 'success'
--   Ensures graceful idempotency when registrations are already deleted
--   Ensures atomic results invalidation/reset and PostgREST schema cache reload
-- ==============================================================================

-- 1. REPAIR public.admin_bulk_delete_registrations
CREATE OR REPLACE FUNCTION public.admin_bulk_delete_registrations(
    p_registration_ids UUID[], 
    p_confirmation_phrase TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
    v_actor_id UUID;
    v_actor_email TEXT;
    v_distinct_ids UUID[];
    v_bulk_op_id UUID := gen_random_uuid();
    v_reg_id UUID;
    v_reg RECORD;
    v_sub_event_name TEXT;
    v_event_name TEXT;
    v_team_ids UUID[];
    v_team_member_ids UUID[];
    v_cert_ids UUID[];
    v_team_name TEXT;
    v_deleted_teams_count INT := 0;
    v_deleted_team_members_count INT := 0;
    v_deleted_attendance_count INT := 0;
    v_deleted_feedback_count INT := 0;
    v_deleted_payments_count INT := 0;
    v_deleted_certificates_count INT := 0;
    v_deleted_documents_count INT := 0;
    v_total_deleted INT := 0;
    v_affected_sub_events UUID[] := '{}';
    v_sub_id UUID;
    v_reset_results_sub_events UUID[] := '{}';
    v_was_reset BOOLEAN;
BEGIN
    -- 1. Verify caller authentication & admin role
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Access denied: Administrator privileges required.';
    END IF;

    -- 2. Validate confirmation phrase strictly (case-sensitive exact 'DELETE')
    IF p_confirmation_phrase IS NULL OR p_confirmation_phrase <> 'DELETE' THEN
        RAISE EXCEPTION 'Confirmation phrase mismatch. Expected "DELETE", received "%".', COALESCE(p_confirmation_phrase, '');
    END IF;

    -- 3. Validate input array
    IF p_registration_ids IS NULL OR array_length(p_registration_ids, 1) IS NULL OR array_length(p_registration_ids, 1) = 0 THEN
        RAISE EXCEPTION 'No registration IDs provided for deletion.';
    END IF;

    -- Deduplicate registration IDs safely
    SELECT ARRAY_AGG(DISTINCT id) INTO v_distinct_ids
    FROM unnest(p_registration_ids) AS id;

    IF v_distinct_ids IS NULL OR array_length(v_distinct_ids, 1) = 0 THEN
        RAISE EXCEPTION 'No valid registration IDs provided for deletion.';
    END IF;

    -- Get actor email for audit logging
    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

    -- 4. Process each registration inside this single atomic transaction
    FOREACH v_reg_id IN ARRAY v_distinct_ids LOOP
        -- Lock registration record for update
        SELECT 
            r.id, 
            r.sub_event_id, 
            r.leader_id, 
            r.status
        INTO v_reg
        FROM public.registrations r
        WHERE r.id = v_reg_id
        FOR UPDATE;

        -- If not found (e.g. repeated idempotent deletion call), skip gracefully
        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        -- Record affected sub-event for post-batch results reset verification
        IF NOT (v_reg.sub_event_id = ANY(v_affected_sub_events)) THEN
            v_affected_sub_events := array_append(v_affected_sub_events, v_reg.sub_event_id);
        END IF;

        -- Fetch sub-event and event names for rich audit logging
        SELECT 
            se.name, 
            COALESCE(e.name, (SELECT cat_e.name FROM public.categories cat JOIN public.events cat_e ON cat_e.id = cat.event_id WHERE cat.id = se.category_id), 'Flagship Event')
        INTO v_sub_event_name, v_event_name
        FROM public.sub_events se
        LEFT JOIN public.events e ON e.id = se.event_id
        WHERE se.id = v_reg.sub_event_id;

        -- Reset counters for this registration
        v_team_ids := '{}';
        v_team_member_ids := '{}';
        v_cert_ids := '{}';
        v_team_name := 'Solo Participant';
        v_deleted_teams_count := 0;
        v_deleted_team_members_count := 0;
        v_deleted_attendance_count := 0;
        v_deleted_feedback_count := 0;
        v_deleted_payments_count := 0;
        v_deleted_certificates_count := 0;
        v_deleted_documents_count := 0;

        -- Collect affected child entity IDs
        SELECT ARRAY_AGG(id), COALESCE(MAX(team_name), 'Solo Participant')
        INTO v_team_ids, v_team_name
        FROM public.teams
        WHERE registration_id = v_reg_id;

        v_team_ids := COALESCE(v_team_ids, '{}');

        IF array_length(v_team_ids, 1) > 0 THEN
            SELECT ARRAY_AGG(id) INTO v_team_member_ids
            FROM public.team_members
            WHERE team_id = ANY(v_team_ids);
        END IF;
        v_team_member_ids := COALESCE(v_team_member_ids, '{}');

        -- Delete result submissions referencing this registration's teams BEFORE deleting teams
        IF array_length(v_team_ids, 1) > 0 THEN
            DELETE FROM public.result_submissions
            WHERE winner_team_id = ANY(v_team_ids)
               OR runner_team_id = ANY(v_team_ids)
               OR third_team_id = ANY(v_team_ids);
        END IF;

        -- Clear any sub_event podium references pointing to this registration's team
        IF array_length(v_team_ids, 1) > 0 THEN
            UPDATE public.sub_events
            SET winner_team_id = CASE WHEN winner_team_id = ANY(v_team_ids) THEN NULL ELSE winner_team_id END,
                runner_team_id = CASE WHEN runner_team_id = ANY(v_team_ids) THEN NULL ELSE runner_team_id END,
                third_team_id  = CASE WHEN third_team_id = ANY(v_team_ids) THEN NULL ELSE third_team_id END
            WHERE winner_team_id = ANY(v_team_ids)
               OR runner_team_id = ANY(v_team_ids)
               OR third_team_id = ANY(v_team_ids);
        END IF;

        -- Delete Certificate Corrections & Certificates
        IF array_length(v_team_member_ids, 1) > 0 THEN
            SELECT ARRAY_AGG(id) INTO v_cert_ids
            FROM public.certificates
            WHERE team_member_id = ANY(v_team_member_ids);
            
            v_cert_ids := COALESCE(v_cert_ids, '{}');

            IF array_length(v_cert_ids, 1) > 0 THEN
                DELETE FROM public.certificate_corrections
                WHERE certificate_id = ANY(v_cert_ids);
            END IF;

            DELETE FROM public.certificates
            WHERE team_member_id = ANY(v_team_member_ids);
            GET DIAGNOSTICS v_deleted_certificates_count = ROW_COUNT;
        END IF;

        -- Delete Attendance Records
        IF array_length(v_team_ids, 1) > 0 OR array_length(v_team_member_ids, 1) > 0 THEN
            DELETE FROM public.attendance_records
            WHERE team_id = ANY(v_team_ids)
               OR scanned_member_id = ANY(v_team_member_ids);
            GET DIAGNOSTICS v_deleted_attendance_count = ROW_COUNT;
        END IF;

        -- Delete Feedback Responses
        DELETE FROM public.feedback_responses
        WHERE registration_id = v_reg_id;
        GET DIAGNOSTICS v_deleted_feedback_count = ROW_COUNT;

        -- Delete Payments
        DELETE FROM public.payments
        WHERE registration_id = v_reg_id;
        GET DIAGNOSTICS v_deleted_payments_count = ROW_COUNT;

        -- Delete Team Members
        IF array_length(v_team_ids, 1) > 0 THEN
            DELETE FROM public.team_members
            WHERE team_id = ANY(v_team_ids);
            GET DIAGNOSTICS v_deleted_team_members_count = ROW_COUNT;
        END IF;

        -- Delete Teams
        IF array_length(v_team_ids, 1) > 0 THEN
            DELETE FROM public.teams
            WHERE registration_id = v_reg_id;
            GET DIAGNOSTICS v_deleted_teams_count = ROW_COUNT;
        END IF;

        -- Delete Uploaded Documents associated with this registration / team / members
        DELETE FROM public.documents
        WHERE (entity_type = 'REGISTRATION' AND entity_id = v_reg_id)
           OR (entity_id = ANY(v_team_member_ids))
           OR (entity_id = ANY(v_team_ids));
        GET DIAGNOSTICS v_deleted_documents_count = ROW_COUNT;

        -- Delete Registration (triggers tr_sync_registration_delete and tr_sync_registration_delete_results)
        DELETE FROM public.registrations
        WHERE id = v_reg_id;

        -- Immutable Audit Logging for each registration with shared bulk_op_id
        INSERT INTO public.audit_logs (
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata,
            created_at
        ) VALUES (
            v_actor_id,
            'ADMIN_REGISTRATION_DELETED',
            'registrations',
            v_reg_id,
            jsonb_build_object(
                'registration_id', v_reg_id,
                'sub_event_id', v_reg.sub_event_id,
                'sub_event_name', v_sub_event_name,
                'event_name', v_event_name,
                'leader_id', v_reg.leader_id,
                'team_name', v_team_name,
                'previous_status', v_reg.status,
                'bulk_operation_id', v_bulk_op_id,
                'bulk_total_count', array_length(v_distinct_ids, 1),
                'deleted_counts', jsonb_build_object(
                    'teams', v_deleted_teams_count,
                    'team_members', v_deleted_team_members_count,
                    'attendance_records', v_deleted_attendance_count,
                    'payments', v_deleted_payments_count,
                    'feedback_responses', v_deleted_feedback_count,
                    'certificates', v_deleted_certificates_count,
                    'documents', v_deleted_documents_count
                ),
                'deleted_by', COALESCE(v_actor_email, v_actor_id::text)
            ),
            NOW()
        );

        v_total_deleted := v_total_deleted + 1;
    END LOOP;

    -- 5. Post-batch Results Integrity Verification for all affected sub-events
    FOREACH v_sub_id IN ARRAY v_affected_sub_events LOOP
        v_was_reset := public.reset_sub_event_results_if_invalid(
            v_sub_id, 
            'Admin bulk deleted registrations (operation ' || v_bulk_op_id::text || ')'
        );
        IF v_was_reset THEN
            v_reset_results_sub_events := array_append(v_reset_results_sub_events, v_sub_id);
        END IF;
    END LOOP;

    -- 6. Return success payload
    RETURN jsonb_build_object(
        'success', true,
        'deleted_count', v_total_deleted,
        'deleted_registration_ids', v_distinct_ids,
        'bulk_operation_id', v_bulk_op_id,
        'affected_sub_events_count', array_length(v_affected_sub_events, 1),
        'affected_sub_events', v_affected_sub_events,
        'results_reset_sub_events', v_reset_results_sub_events
    );
END;
$function$;


-- 2. REPAIR public.admin_delete_registration
CREATE OR REPLACE FUNCTION public.admin_delete_registration(
    p_registration_id UUID, 
    p_confirmation_phrase TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
    v_actor_id UUID;
    v_actor_email TEXT;
    v_reg RECORD;
    v_sub_event_name TEXT := 'Sub-Event';
    v_event_name TEXT := 'Flagship Event';
    v_team_ids UUID[] := '{}';
    v_team_member_ids UUID[] := '{}';
    v_cert_ids UUID[] := '{}';
    v_team_name TEXT := 'Solo Participant';
    v_deleted_teams_count INT := 0;
    v_deleted_team_members_count INT := 0;
    v_deleted_attendance_count INT := 0;
    v_deleted_feedback_count INT := 0;
    v_deleted_payments_count INT := 0;
    v_deleted_certificates_count INT := 0;
    v_deleted_documents_count INT := 0;
    v_sub_event_reset BOOLEAN := FALSE;
BEGIN
    -- 1. Verify caller authentication & admin role
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Access denied: Administrator privileges required.';
    END IF;

    -- 2. Validate confirmation phrase strictly (case-sensitive exact 'DELETE')
    IF p_confirmation_phrase IS NULL OR p_confirmation_phrase <> 'DELETE' THEN
        RAISE EXCEPTION 'Confirmation phrase mismatch. Expected "DELETE", received "%".', COALESCE(p_confirmation_phrase, '');
    END IF;

    -- 3. Validate registration exists and lock for deletion
    SELECT 
        r.id, 
        r.sub_event_id, 
        r.leader_id, 
        r.status
    INTO v_reg
    FROM public.registrations r
    WHERE r.id = p_registration_id
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Graceful idempotency if already deleted
        RETURN jsonb_build_object(
            'success', true,
            'registration_id', p_registration_id,
            'deleted_count', 0,
            'message', 'Registration already deleted or not found.'
        );
    END IF;

    -- Fetch sub-event and event names for rich audit logging
    SELECT 
        se.name, 
        COALESCE(e.name, (SELECT cat_e.name FROM public.categories cat JOIN public.events cat_e ON cat_e.id = cat.event_id WHERE cat.id = se.category_id), 'Flagship Event')
    INTO v_sub_event_name, v_event_name
    FROM public.sub_events se
    LEFT JOIN public.events e ON e.id = se.event_id
    WHERE se.id = v_reg.sub_event_id;

    -- Get actor email for audit record
    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

    -- 4. Collect affected child entity IDs
    SELECT ARRAY_AGG(id), COALESCE(MAX(team_name), 'Solo Participant')
    INTO v_team_ids, v_team_name
    FROM public.teams
    WHERE registration_id = p_registration_id;

    v_team_ids := COALESCE(v_team_ids, '{}');

    IF array_length(v_team_ids, 1) > 0 THEN
        SELECT ARRAY_AGG(id) INTO v_team_member_ids
        FROM public.team_members
        WHERE team_id = ANY(v_team_ids);
    END IF;
    v_team_member_ids := COALESCE(v_team_member_ids, '{}');

    -- 5. Delete result submissions referencing this registration's teams BEFORE deleting teams
    IF array_length(v_team_ids, 1) > 0 THEN
        DELETE FROM public.result_submissions
        WHERE winner_team_id = ANY(v_team_ids)
           OR runner_team_id = ANY(v_team_ids)
           OR third_team_id = ANY(v_team_ids);
    END IF;

    -- 6. Unset any sub_event podium references pointing to this registration's team
    IF array_length(v_team_ids, 1) > 0 THEN
        UPDATE public.sub_events
        SET winner_team_id = CASE WHEN winner_team_id = ANY(v_team_ids) THEN NULL ELSE winner_team_id END,
            runner_team_id = CASE WHEN runner_team_id = ANY(v_team_ids) THEN NULL ELSE runner_team_id END,
            third_team_id  = CASE WHEN third_team_id = ANY(v_team_ids) THEN NULL ELSE third_team_id END
        WHERE winner_team_id = ANY(v_team_ids)
           OR runner_team_id = ANY(v_team_ids)
           OR third_team_id = ANY(v_team_ids);
    END IF;

    -- 7. Delete Certificate Corrections & Certificates
    IF array_length(v_team_member_ids, 1) > 0 THEN
        SELECT ARRAY_AGG(id) INTO v_cert_ids
        FROM public.certificates
        WHERE team_member_id = ANY(v_team_member_ids);
        
        v_cert_ids := COALESCE(v_cert_ids, '{}');

        IF array_length(v_cert_ids, 1) > 0 THEN
            DELETE FROM public.certificate_corrections
            WHERE certificate_id = ANY(v_cert_ids);
        END IF;

        DELETE FROM public.certificates
        WHERE team_member_id = ANY(v_team_member_ids);
        GET DIAGNOSTICS v_deleted_certificates_count = ROW_COUNT;
    END IF;

    -- 8. Delete Attendance Records
    IF array_length(v_team_ids, 1) > 0 OR array_length(v_team_member_ids, 1) > 0 THEN
        DELETE FROM public.attendance_records
        WHERE team_id = ANY(v_team_ids)
           OR scanned_member_id = ANY(v_team_member_ids);
        GET DIAGNOSTICS v_deleted_attendance_count = ROW_COUNT;
    END IF;

    -- 9. Delete Feedback Responses
    DELETE FROM public.feedback_responses
    WHERE registration_id = p_registration_id;
    GET DIAGNOSTICS v_deleted_feedback_count = ROW_COUNT;

    -- 10. Delete Payments
    DELETE FROM public.payments
    WHERE registration_id = p_registration_id;
    GET DIAGNOSTICS v_deleted_payments_count = ROW_COUNT;

    -- 11. Delete Team Members
    IF array_length(v_team_ids, 1) > 0 THEN
        DELETE FROM public.team_members
        WHERE team_id = ANY(v_team_ids);
        GET DIAGNOSTICS v_deleted_team_members_count = ROW_COUNT;
    END IF;

    -- 12. Delete Teams
    IF array_length(v_team_ids, 1) > 0 THEN
        DELETE FROM public.teams
        WHERE registration_id = p_registration_id;
        GET DIAGNOSTICS v_deleted_teams_count = ROW_COUNT;
    END IF;

    -- 13. Delete Uploaded Documents associated with this registration / team / members
    DELETE FROM public.documents
    WHERE (entity_type = 'REGISTRATION' AND entity_id = p_registration_id)
       OR (entity_id = ANY(v_team_member_ids))
       OR (entity_id = ANY(v_team_ids));
    GET DIAGNOSTICS v_deleted_documents_count = ROW_COUNT;

    -- 14. Delete Registration (triggers tr_sync_registration_delete and tr_sync_registration_delete_results)
    DELETE FROM public.registrations
    WHERE id = p_registration_id;

    -- 15. Perform Authoritative Results Integrity Check on parent sub-event
    v_sub_event_reset := public.reset_sub_event_results_if_invalid(
        v_reg.sub_event_id, 
        'Admin deleted registration ' || p_registration_id::text
    );

    -- 16. Immutable Audit Logging
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_actor_id,
        'ADMIN_REGISTRATION_DELETED',
        'registrations',
        p_registration_id,
        jsonb_build_object(
            'registration_id', p_registration_id,
            'sub_event_id', v_reg.sub_event_id,
            'sub_event_name', v_sub_event_name,
            'event_name', v_event_name,
            'leader_id', v_reg.leader_id,
            'team_name', v_team_name,
            'previous_status', v_reg.status,
            'results_reset_triggered', v_sub_event_reset,
            'deleted_counts', jsonb_build_object(
                'teams', v_deleted_teams_count,
                'team_members', v_deleted_team_members_count,
                'attendance_records', v_deleted_attendance_count,
                'payments', v_deleted_payments_count,
                'feedback_responses', v_deleted_feedback_count,
                'certificates', v_deleted_certificates_count,
                'documents', v_deleted_documents_count
            ),
            'deleted_by', COALESCE(v_actor_email, v_actor_id::text)
        ),
        NOW()
    );

    -- 17. Return success payload
    RETURN jsonb_build_object(
        'success', true,
        'registration_id', p_registration_id,
        'sub_event_id', v_reg.sub_event_id,
        'status', v_reg.status,
        'results_reset', v_sub_event_reset,
        'deleted_counts', jsonb_build_object(
            'teams', v_deleted_teams_count,
            'team_members', v_deleted_team_members_count,
            'attendance_records', v_deleted_attendance_count,
            'payments', v_deleted_payments_count,
            'feedback_responses', v_deleted_feedback_count,
            'certificates', v_deleted_certificates_count,
            'documents', v_deleted_documents_count
        )
    );
END;
$function$;

-- 3. PERMISSIONS & POSTGREST SCHEMA RELOAD
REVOKE ALL ON FUNCTION public.admin_bulk_delete_registrations(UUID[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_delete_registrations(UUID[], TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_registration(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_registration(UUID, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
