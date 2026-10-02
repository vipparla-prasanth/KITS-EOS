-- ============================================================================
-- Migration 054: Admin-Only Registration Deletion RPC
-- Provides authoritative, secure, atomic registration deletion for administrators
-- with strict case-sensitive confirmation phrase 'DELETE', foreign key cascading,
-- capacity synchronization preservation, and immutable audit logging.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_registration(
    p_registration_id UUID,
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
        RAISE EXCEPTION 'Registration not found with ID %.', p_registration_id;
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

    -- 5. Unset any sub_event podium references pointing to this registration's team
    IF array_length(v_team_ids, 1) > 0 THEN
        UPDATE public.sub_events
        SET winner_team_id = CASE WHEN winner_team_id = ANY(v_team_ids) THEN NULL ELSE winner_team_id END,
            runner_team_id = CASE WHEN runner_team_id = ANY(v_team_ids) THEN NULL ELSE runner_team_id END,
            third_team_id  = CASE WHEN third_team_id = ANY(v_team_ids) THEN NULL ELSE third_team_id END
        WHERE winner_team_id = ANY(v_team_ids)
           OR runner_team_id = ANY(v_team_ids)
           OR third_team_id = ANY(v_team_ids);
    END IF;

    -- 6. Delete Certificate Corrections & Certificates
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

    -- 7. Delete Attendance Records
    IF array_length(v_team_ids, 1) > 0 OR array_length(v_team_member_ids, 1) > 0 THEN
        DELETE FROM public.attendance_records
        WHERE team_id = ANY(v_team_ids)
           OR scanned_member_id = ANY(v_team_member_ids);
        GET DIAGNOSTICS v_deleted_attendance_count = ROW_COUNT;
    END IF;

    -- 8. Delete Feedback Responses
    DELETE FROM public.feedback_responses
    WHERE registration_id = p_registration_id;
    GET DIAGNOSTICS v_deleted_feedback_count = ROW_COUNT;

    -- 9. Delete Payments
    DELETE FROM public.payments
    WHERE registration_id = p_registration_id;
    GET DIAGNOSTICS v_deleted_payments_count = ROW_COUNT;

    -- 10. Delete Team Members
    IF array_length(v_team_ids, 1) > 0 THEN
        DELETE FROM public.team_members
        WHERE team_id = ANY(v_team_ids);
        GET DIAGNOSTICS v_deleted_team_members_count = ROW_COUNT;
    END IF;

    -- 11. Delete Teams
    IF array_length(v_team_ids, 1) > 0 THEN
        DELETE FROM public.teams
        WHERE registration_id = p_registration_id;
        GET DIAGNOSTICS v_deleted_teams_count = ROW_COUNT;
    END IF;

    -- 12. Delete Uploaded Documents associated with this registration / team / members
    DELETE FROM public.documents
    WHERE (entity_type = 'REGISTRATION' AND entity_id = p_registration_id)
       OR (entity_id = ANY(v_team_member_ids))
       OR (entity_id = ANY(v_team_ids));
    GET DIAGNOSTICS v_deleted_documents_count = ROW_COUNT;

    -- 13. Delete Registration (triggers tr_sync_registration_delete which safely adjusts sub_events.registered_count)
    DELETE FROM public.registrations
    WHERE id = p_registration_id;

    -- 14. Immutable Audit Logging (Audit logs survive registration deletion)
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

    -- 15. Return success payload
    RETURN jsonb_build_object(
        'success', true,
        'registration_id', p_registration_id,
        'sub_event_id', v_reg.sub_event_id,
        'status', v_reg.status,
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
$$;

-- Revoke default public execution privileges and grant least privilege
REVOKE ALL ON FUNCTION public.admin_delete_registration(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_registration(UUID, TEXT) TO authenticated, service_role;
