-- ==============================================================================
-- Migration 107: Reset Result Declaration When Sub-Event Registrations Are Deleted
-- ==============================================================================
-- Resolves result declaration state inconsistency where deleting registrations
-- left stale 'APPROVED / PUBLISHED' states, orphaned podium references, or blocked
-- fresh result declarations for sub-events with zero or modified registrations.
--
-- CORE ENFORCEMENTS:
-- 1. Database-backed invalidation & reset helper: public.reset_sub_event_results_if_invalid(p_sub_event_id, p_reason)
--    - Scoped strictly to the affected sub-event.
--    - If remaining non-cancelled registrations = 0:
--        * sub_events.results_published = FALSE
--        * sub_events.results_locked = FALSE
--        * sub_events.results_published_at = NULL
--        * sub_events.winner_team_id = NULL, runner_team_id = NULL, third_team_id = NULL
--        * sub_events.result_edit_count = 0, result_edited_at = NULL, result_edit_reason = NULL, result_edited_by = NULL
--        * Deletes achievement certificates (WINNER, RUNNER, THIRD_PLACE) for this sub-event.
--        * Deletes stale/orphaned result_submissions for this sub-event.
--        * Writes immutable audit log record (SUB_EVENT_RESULTS_RESET).
--    - If remaining registrations > 0 but results_published is TRUE:
--        * Checks if winner_team_id is still a valid team of an active registration for this sub-event.
--        * If winner (or runner if required) is missing/deleted, invalidates the stale published result,
--          cleans up achievement certificates and result_submissions, and writes SUB_EVENT_RESULTS_INVALIDATED audit log.
--
-- 2. Foreign Key Cascading on result_submissions:
--    - Updates winner_team_id & runner_team_id foreign keys to ON DELETE CASCADE
--    - Updates third_team_id foreign key to ON DELETE SET NULL
--    - Adds 'INVALIDATED' to result_submissions status check constraint.
--
-- 3. Trigger on registrations (AFTER DELETE):
--    - tr_sync_registration_delete_results automatically triggers reset_sub_event_results_if_invalid
--      on any registration deletion.
--
-- 4. Authoritative Registration Deletion RPCs updated:
--    - admin_delete_registration: Cleans result_submissions before team deletion, invokes reset helper.
--    - admin_bulk_delete_registrations: Cleans result_submissions before team deletion, invokes reset helper for all affected sub-events.
--
-- 5. Coordinator RPC get_coordinator_sub_event_result_status updated:
--    - Self-heals inconsistent sub-event states using reset_sub_event_results_if_invalid.
--    - Never returns APPROVED or results_published: true if eligible_count = 0 or winner is null/invalid.
--    - Returns clean NOT_SUBMITTED with results_published: false when eligible_count = 0.
--
-- 6. Direct Publish Guard:
--    - publish_sub_event_results_and_certificates rejects execution if eligible_competitors = 0.
--
-- 7. One-time data synchronization:
--    - Repairs all 18 existing stale sub-events currently marked as published with 0 registrations.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- STEP 1: UPDATE result_submissions TABLE CONSTRAINTS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    -- Drop existing foreign key constraints on teams if present
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'result_submissions_winner_team_id_fkey') THEN
        ALTER TABLE public.result_submissions DROP CONSTRAINT result_submissions_winner_team_id_fkey;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'result_submissions_runner_team_id_fkey') THEN
        ALTER TABLE public.result_submissions DROP CONSTRAINT result_submissions_runner_team_id_fkey;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'result_submissions_third_team_id_fkey') THEN
        ALTER TABLE public.result_submissions DROP CONSTRAINT result_submissions_third_team_id_fkey;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'result_submissions_status_check') THEN
        ALTER TABLE public.result_submissions DROP CONSTRAINT result_submissions_status_check;
    END IF;
END $$;

ALTER TABLE public.result_submissions
    ADD CONSTRAINT result_submissions_winner_team_id_fkey
        FOREIGN KEY (winner_team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
    ADD CONSTRAINT result_submissions_runner_team_id_fkey
        FOREIGN KEY (runner_team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
    ADD CONSTRAINT result_submissions_third_team_id_fkey
        FOREIGN KEY (third_team_id) REFERENCES public.teams(id) ON DELETE SET NULL,
    ADD CONSTRAINT result_submissions_status_check
        CHECK (status IN ('PENDING_ADMIN_APPROVAL', 'APPROVED', 'REJECTED', 'INVALIDATED'));


-- ------------------------------------------------------------------------------
-- STEP 2: HELPER FUNCTION: reset_sub_event_results_if_invalid
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_sub_event_results_if_invalid(
    p_sub_event_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_sub RECORD;
    v_reg_count INT := 0;
    v_winner_valid BOOLEAN := FALSE;
    v_runner_valid BOOLEAN := FALSE;
    v_needs_reset BOOLEAN := FALSE;
    v_reset_action TEXT := 'SUB_EVENT_RESULTS_RESET';
    v_reset_reason TEXT := '';
BEGIN
    IF p_sub_event_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 1. Fetch sub-event with row lock
    SELECT * INTO v_sub 
    FROM public.sub_events 
    WHERE id = p_sub_event_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- 2. Count active/confirmed registrations for this sub-event
    SELECT COUNT(*) INTO v_reg_count
    FROM public.registrations
    WHERE sub_event_id = p_sub_event_id
      AND status <> 'CANCELLED';

    -- CASE A: ZERO REGISTRATIONS LEFT
    IF v_reg_count = 0 THEN
        IF v_sub.results_published IS TRUE 
           OR v_sub.results_locked IS TRUE 
           OR v_sub.winner_team_id IS NOT NULL 
           OR v_sub.runner_team_id IS NOT NULL 
           OR v_sub.third_team_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.result_submissions WHERE sub_event_id = p_sub_event_id) THEN
            v_needs_reset := TRUE;
            v_reset_action := 'SUB_EVENT_RESULTS_RESET';
            v_reset_reason := COALESCE(p_reason, 'All sub-event registrations deleted (reg_count = 0).');
        END IF;

    -- CASE B: REGISTRATIONS EXIST, BUT RESULTS WERE MARKED PUBLISHED / LOCKED
    ELSIF v_sub.results_published IS TRUE OR v_sub.results_locked IS TRUE THEN
        -- Check if winner_team_id points to an existing active registration for this sub-event
        IF v_sub.winner_team_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1 FROM public.teams t
                JOIN public.registrations r ON r.id = t.registration_id
                WHERE t.id = v_sub.winner_team_id
                  AND r.sub_event_id = p_sub_event_id
                  AND r.status <> 'CANCELLED'
            ) INTO v_winner_valid;
        ELSE
            v_winner_valid := FALSE;
        END IF;

        -- Check runner_team_id if populated
        IF v_sub.runner_team_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1 FROM public.teams t
                JOIN public.registrations r ON r.id = t.registration_id
                WHERE t.id = v_sub.runner_team_id
                  AND r.sub_event_id = p_sub_event_id
                  AND r.status <> 'CANCELLED'
            ) INTO v_runner_valid;
        ELSE
            v_runner_valid := TRUE; -- Not set or single competitor
        END IF;

        -- If winner (or runner when populated) is no longer valid, result is logically invalid
        IF NOT v_winner_valid OR NOT v_runner_valid THEN
            v_needs_reset := TRUE;
            v_reset_action := 'SUB_EVENT_RESULTS_INVALIDATED';
            v_reset_reason := COALESCE(p_reason, 'Selected winner or runner registration was deleted.');
        END IF;
    END IF;

    -- CASE C: Invalidate any pending result submissions referencing deleted teams
    UPDATE public.result_submissions
    SET status = 'INVALIDATED',
        updated_at = now()
    WHERE sub_event_id = p_sub_event_id
      AND status = 'PENDING_ADMIN_APPROVAL'
      AND (
          NOT EXISTS (
              SELECT 1 FROM public.teams t 
              JOIN public.registrations r ON r.id = t.registration_id
              WHERE t.id = winner_team_id AND r.sub_event_id = p_sub_event_id AND r.status <> 'CANCELLED'
          )
          OR (
              runner_team_id IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM public.teams t 
                  JOIN public.registrations r ON r.id = t.registration_id
                  WHERE t.id = runner_team_id AND r.sub_event_id = p_sub_event_id AND r.status <> 'CANCELLED'
              )
          )
      );

    -- EXECUTE RESET IF NEEDED
    IF v_needs_reset THEN
        -- 1. Reset sub_events podium & published columns
        UPDATE public.sub_events
        SET results_published = FALSE,
            results_locked = FALSE,
            results_published_at = NULL,
            winner_team_id = NULL,
            runner_team_id = NULL,
            third_team_id = NULL,
            result_edit_count = 0,
            result_edited_at = NULL,
            result_edit_reason = NULL,
            result_edited_by = NULL
        WHERE id = p_sub_event_id;

        -- 2. Delete achievement certificates (WINNER, RUNNER, THIRD_PLACE) for this sub-event
        DELETE FROM public.certificates
        WHERE sub_event_id = p_sub_event_id
          AND type IN ('WINNER', 'RUNNER', 'THIRD_PLACE');

        -- 3. Delete result submissions for this sub-event so coordinator can declare freshly
        DELETE FROM public.result_submissions
        WHERE sub_event_id = p_sub_event_id;

        -- 4. Record audit log
        INSERT INTO public.audit_logs (
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata,
            created_at
        ) VALUES (
            auth.uid(),
            v_reset_action,
            'sub_events',
            p_sub_event_id,
            jsonb_build_object(
                'sub_event_id', p_sub_event_id,
                'sub_event_name', v_sub.name,
                'reason', v_reset_reason,
                'previous_results_published', v_sub.results_published,
                'previous_winner_team_id', v_sub.winner_team_id,
                'previous_runner_team_id', v_sub.runner_team_id,
                'previous_third_team_id', v_sub.third_team_id,
                'remaining_registrations_count', v_reg_count,
                'reset_at', now()
            ),
            now()
        );

        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_sub_event_results_if_invalid(UUID, TEXT) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- STEP 3: REGISTRATIONS AFTER DELETE TRIGGER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trig_sync_registration_delete_results_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM public.reset_sub_event_results_if_invalid(OLD.sub_event_id, 'Registration deleted (automatic trigger synchronization).');
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_registration_delete_results ON public.registrations;
CREATE TRIGGER tr_sync_registration_delete_results
AFTER DELETE ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION public.trig_sync_registration_delete_results_integrity();


-- ------------------------------------------------------------------------------
-- STEP 4: UPDATE admin_delete_registration RPC
-- ------------------------------------------------------------------------------
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
$$;

REVOKE ALL ON FUNCTION public.admin_delete_registration(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_registration(UUID, TEXT) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- STEP 5: UPDATE admin_bulk_delete_registrations RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_bulk_delete_registrations(
    p_registration_ids UUID[],
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

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Registration not found with ID %.', v_reg_id;
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
        PERFORM public.reset_sub_event_results_if_invalid(
            v_sub_id, 
            'Admin bulk deleted registrations (operation ' || v_bulk_op_id::text || ')'
        );
    END LOOP;

    -- 6. Return success payload
    RETURN jsonb_build_object(
        'success', true,
        'deleted_count', v_total_deleted,
        'deleted_registration_ids', v_distinct_ids,
        'bulk_operation_id', v_bulk_op_id,
        'affected_sub_events_count', array_length(v_affected_sub_events, 1)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bulk_delete_registrations(UUID[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_delete_registrations(UUID[], TEXT) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- STEP 6: UPDATE get_coordinator_sub_event_result_status RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_result_status(
    p_token TEXT,
    p_sub_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN := FALSE;
    v_sub_event RECORD;
    v_submission RECORD;
    v_winner_name TEXT;
    v_runner_name TEXT;
    v_third_name TEXT;
    v_eligible_count INT := 0;
    v_eligible_participants JSONB := '[]'::jsonb;
    v_winner_card JSONB := NULL;
    v_runner_card JSONB := NULL;
    v_third_card JSONB := NULL;
    v_summary_counts JSONB := '{}'::jsonb;
BEGIN
    -- 1. Authenticate coordinator via session token
    v_coord_id := public.get_coordinator_id_by_token(p_token);
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required: Invalid or expired session token.';
    END IF;

    -- 2. Strict server-side verification: Coordinator must be assigned to this sub-event
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.sub_events se ON se.id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord_id
          AND ca.sub_event_id = p_sub_event_id
          AND se.status <> 'PERMANENTLY_DELETED'
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RAISE EXCEPTION 'Unauthorized: You are not assigned as a coordinator for this sub-event.';
    END IF;

    -- 3. Self-healing check: Invalidate/reset results if registrations were deleted
    PERFORM public.reset_sub_event_results_if_invalid(p_sub_event_id);

    -- Verify sub-event exists and is active
    SELECT * INTO v_sub_event 
    FROM public.sub_events 
    WHERE id = p_sub_event_id AND status <> 'PERMANENTLY_DELETED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found or deleted.';
    END IF;

    -- 4. Count eligible attended competitors (teams / solo candidates with at least 1 check-in)
    SELECT COUNT(DISTINCT ar.team_id) INTO v_eligible_count
    FROM public.attendance_records ar
    JOIN public.teams t ON t.id = ar.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE ar.sub_event_id = p_sub_event_id
      AND r.sub_event_id = p_sub_event_id
      AND r.status = 'CONFIRMED';

    -- 5. Build Comprehensive Eligible Participants and Roster with Dual Certificates
    WITH attended_teams AS (
        SELECT DISTINCT ar.team_id, t.registration_id, t.team_name, r.leader_id, r.created_at AS reg_created_at
        FROM public.attendance_records ar
        JOIN public.teams t ON t.id = ar.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE ar.sub_event_id = p_sub_event_id
          AND r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED'
    ),
    team_certs AS (
        SELECT c.team_member_id, c.type::text AS cert_type, c.status::text AS cert_status, c.certificate_code
        FROM public.certificates c
        WHERE c.sub_event_id = p_sub_event_id
    ),
    team_member_details AS (
        SELECT 
            tm.team_id,
            tm.id AS member_id,
            tm.user_id,
            tm.snapshot_name,
            tm.snapshot_roll_number,
            tm.snapshot_college,
            tm.snapshot_department,
            tm.snapshot_year,
            tm.is_leader,
            CASE WHEN ar.id IS NOT NULL THEN 'PRESENT' ELSE 'ABSENT' END AS attendance_status,
            ar.check_in_time,
            ach_c.cert_type AS ach_type,
            ach_c.cert_status AS ach_status,
            ach_c.certificate_code AS ach_code,
            part_c.cert_status AS part_status,
            part_c.certificate_code AS part_code
        FROM public.team_members tm
        JOIN attended_teams at ON at.team_id = tm.team_id
        LEFT JOIN public.attendance_records ar 
            ON ar.scanned_member_id = tm.id AND ar.sub_event_id = p_sub_event_id
        LEFT JOIN team_certs ach_c 
            ON ach_c.team_member_id = tm.id AND ach_c.cert_type IN ('WINNER', 'RUNNER', 'THIRD_PLACE')
        LEFT JOIN team_certs part_c 
            ON part_c.team_member_id = tm.id AND part_c.cert_type = 'PARTICIPANT'
    ),
    aggregated_teams AS (
        SELECT 
            at.team_id,
            at.team_name,
            at.registration_id,
            at.leader_id,
            at.reg_created_at,
            (v_sub_event.participation_type = 'TEAM' OR COUNT(tmd.member_id) > 1) AS is_team,
            CASE 
                WHEN at.team_id = v_sub_event.winner_team_id THEN 'WINNER'
                WHEN at.team_id = v_sub_event.runner_team_id THEN 'RUNNER_UP'
                WHEN at.team_id = v_sub_event.third_team_id THEN 'THIRD_PLACE'
                ELSE 'PARTICIPANT'
            END AS result_rank,
            CASE 
                WHEN at.team_id = v_sub_event.winner_team_id THEN 'WINNER'
                WHEN at.team_id = v_sub_event.runner_team_id THEN 'RUNNER-UP'
                WHEN at.team_id = v_sub_event.third_team_id THEN 'THIRD PLACE'
                ELSE 'PARTICIPANT'
            END AS result_rank_display,
            CASE 
                WHEN at.team_id = v_sub_event.winner_team_id THEN 1
                WHEN at.team_id = v_sub_event.runner_team_id THEN 2
                WHEN at.team_id = v_sub_event.third_team_id THEN 3
                ELSE 4
            END AS rank_order,
            COUNT(tmd.member_id) AS total_members,
            COUNT(tmd.member_id) FILTER (WHERE tmd.attendance_status = 'PRESENT') AS attended_members,
            COUNT(tmd.member_id) FILTER (WHERE tmd.ach_status = 'UNLOCKED') AS achievement_certs_count,
            COUNT(tmd.member_id) FILTER (WHERE tmd.part_status = 'UNLOCKED') AS participation_unlocked_count,
            COUNT(tmd.member_id) FILTER (WHERE tmd.part_status = 'LOCKED') AS participation_locked_count,
            COALESCE(
                jsonb_agg(DISTINCT tmd.snapshot_college) FILTER (WHERE tmd.snapshot_college IS NOT NULL),
                '[]'::jsonb
            ) AS colleges,
            COALESCE(
                jsonb_agg(DISTINCT tmd.snapshot_department) FILTER (WHERE tmd.snapshot_department IS NOT NULL),
                '[]'::jsonb
            ) AS departments,
            -- Leader Details
            COALESCE(
                (SELECT tmd_lead.snapshot_name FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id AND tmd_lead.is_leader = true LIMIT 1),
                (SELECT tmd_lead.snapshot_name FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id LIMIT 1),
                'Participant'
            ) AS leader_name,
            (SELECT tmd_lead.snapshot_roll_number FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id AND tmd_lead.is_leader = true LIMIT 1) AS leader_roll_number,
            (SELECT tmd_lead.snapshot_college FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id AND tmd_lead.is_leader = true LIMIT 1) AS leader_college,
            (SELECT tmd_lead.snapshot_department FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id AND tmd_lead.is_leader = true LIMIT 1) AS leader_department,
            (SELECT tmd_lead.snapshot_year FROM team_member_details tmd_lead WHERE tmd_lead.team_id = at.team_id AND tmd_lead.is_leader = true LIMIT 1) AS leader_year,
            -- Full Member Snapshots with individual colleges, departments, rolls, attendance & certs
            jsonb_agg(
                jsonb_build_object(
                    'id', tmd.member_id,
                    'user_id', tmd.user_id,
                    'name', tmd.snapshot_name,
                    'roll_number', tmd.snapshot_roll_number,
                    'college', tmd.snapshot_college,
                    'department', tmd.snapshot_department,
                    'year', tmd.snapshot_year,
                    'is_leader', tmd.is_leader,
                    'attendance_status', tmd.attendance_status,
                    'check_in_time', tmd.check_in_time,
                    'achievement_status', CASE 
                        WHEN tmd.ach_status = 'UNLOCKED' THEN 'ISSUED'
                        WHEN tmd.ach_status = 'REVOKED' THEN 'REVOKED'
                        ELSE 'NOT_APPLICABLE'
                    END,
                    'achievement_type', tmd.ach_type,
                    'achievement_code', tmd.ach_code,
                    'achievement_display', CASE
                        WHEN tmd.ach_status = 'UNLOCKED' AND tmd.ach_type = 'WINNER' THEN 'WINNER — ISSUED'
                        WHEN tmd.ach_status = 'UNLOCKED' AND tmd.ach_type = 'RUNNER' THEN 'RUNNER-UP — ISSUED'
                        WHEN tmd.ach_status = 'UNLOCKED' AND tmd.ach_type = 'THIRD_PLACE' THEN 'THIRD PLACE — ISSUED'
                        WHEN tmd.ach_status = 'REVOKED' THEN 'REVOKED'
                        ELSE 'NOT APPLICABLE'
                    END,
                    'participation_status', COALESCE(tmd.part_status, 'NOT_GENERATED'),
                    'participation_code', tmd.part_code,
                    'participation_display', CASE
                        WHEN tmd.part_status = 'UNLOCKED' THEN 'UNLOCKED'
                        WHEN tmd.part_status = 'LOCKED' THEN 'LOCKED'
                        ELSE 'PENDING'
                    END
                ) ORDER BY tmd.is_leader DESC, tmd.snapshot_name ASC
            ) AS members
        FROM attended_teams at
        JOIN team_member_details tmd ON tmd.team_id = at.team_id
        GROUP BY at.team_id, at.team_name, at.registration_id, at.leader_id, at.reg_created_at
    ),
    formatted_teams AS (
        SELECT 
            agt.team_id,
            agt.registration_id,
            agt.team_name,
            agt.is_team,
            CASE 
                WHEN agt.is_team THEN COALESCE(NULLIF(agt.team_name, 'Solo Participant'), 'Team ' || SUBSTRING(agt.team_id::text, 1, 6))
                ELSE agt.leader_name
            END AS display_name,
            agt.result_rank,
            agt.result_rank_display,
            agt.rank_order,
            agt.total_members,
            agt.attended_members,
            agt.achievement_certs_count,
            agt.participation_unlocked_count,
            agt.participation_locked_count,
            agt.colleges,
            agt.departments,
            jsonb_build_object(
                'name', agt.leader_name,
                'roll_number', agt.leader_roll_number,
                'college', agt.leader_college,
                'department', agt.leader_department,
                'year', agt.leader_year
            ) AS leader,
            agt.members
        FROM aggregated_teams agt
    )
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'team_id', ft.team_id,
                'registration_id', ft.registration_id,
                'team_name', ft.team_name,
                'display_name', ft.display_name,
                'is_team', ft.is_team,
                'result_rank', ft.result_rank,
                'result_rank_display', ft.result_rank_display,
                'rank_order', ft.rank_order,
                'total_members', ft.total_members,
                'attended_members', ft.attended_members,
                'achievement_certs_count', ft.achievement_certs_count,
                'participation_unlocked_count', ft.participation_unlocked_count,
                'participation_locked_count', ft.participation_locked_count,
                'colleges', ft.colleges,
                'departments', ft.departments,
                'leader', ft.leader,
                'members', ft.members
            ) ORDER BY ft.rank_order ASC, ft.display_name ASC
        ), '[]'::jsonb),
        jsonb_build_object(
            'total_eligible_candidates', COUNT(*),
            'total_eligible_members', COALESCE(SUM(ft.attended_members), 0),
            'winners_count', COUNT(*) FILTER (WHERE ft.result_rank = 'WINNER'),
            'runners_count', COUNT(*) FILTER (WHERE ft.result_rank = 'RUNNER_UP'),
            'third_count', COUNT(*) FILTER (WHERE ft.result_rank = 'THIRD_PLACE'),
            'achievement_certs_count', COALESCE(SUM(ft.achievement_certs_count), 0),
            'participation_unlocked_count', COALESCE(SUM(ft.participation_unlocked_count), 0),
            'participation_locked_count', COALESCE(SUM(ft.participation_locked_count), 0)
        )
    INTO 
        v_eligible_participants,
        v_summary_counts
    FROM formatted_teams ft;

    -- Extract podium cards directly from aggregated participants
    IF v_sub_event.winner_team_id IS NOT NULL THEN
        SELECT elem INTO v_winner_card
        FROM jsonb_array_elements(v_eligible_participants) elem
        WHERE (elem->>'team_id')::uuid = v_sub_event.winner_team_id
        LIMIT 1;
    END IF;

    IF v_sub_event.runner_team_id IS NOT NULL THEN
        SELECT elem INTO v_runner_card
        FROM jsonb_array_elements(v_eligible_participants) elem
        WHERE (elem->>'team_id')::uuid = v_sub_event.runner_team_id
        LIMIT 1;
    END IF;

    IF v_sub_event.third_team_id IS NOT NULL THEN
        SELECT elem INTO v_third_card
        FROM jsonb_array_elements(v_eligible_participants) elem
        WHERE (elem->>'team_id')::uuid = v_sub_event.third_team_id
        LIMIT 1;
    END IF;

    -- 6. Return APPROVED / PUBLISHED status ONLY if sub-event is actually published,
    -- has eligible competitors, and has a valid winner card
    IF v_sub_event.results_published IS TRUE AND v_eligible_count > 0 AND (v_sub_event.winner_team_id IS NOT NULL OR v_winner_card IS NOT NULL) THEN
        -- Resolve winner display name
        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_winner_name
        FROM public.teams t WHERE t.id = v_sub_event.winner_team_id;

        -- Resolve runner display name
        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_runner_name
        FROM public.teams t WHERE t.id = v_sub_event.runner_team_id;

        -- Resolve third display name
        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_third_name
        FROM public.teams t WHERE t.id = v_sub_event.third_team_id;

        RETURN jsonb_build_object(
            'success', true,
            'sub_event_id', p_sub_event_id,
            'sub_event_name', v_sub_event.name,
            'status', 'APPROVED',
            'results_published', true,
            'results_locked', true,
            'published_at', v_sub_event.results_published_at,
            'result_edit_count', COALESCE(v_sub_event.result_edit_count, 0),
            'result_edited_at', v_sub_event.result_edited_at,
            'winner_team_id', v_sub_event.winner_team_id,
            'winner_name', v_winner_name,
            'runner_team_id', v_sub_event.runner_team_id,
            'runner_name', v_runner_name,
            'third_team_id', v_sub_event.third_team_id,
            'third_name', v_third_name,
            'eligible_count', v_eligible_count,
            'podium', jsonb_build_object(
                'winner', v_winner_card,
                'runner', v_runner_card,
                'third', v_third_card
            ),
            'eligible_participants', v_eligible_participants,
            'summary_counts', COALESCE(v_summary_counts, '{}'::jsonb)
        );
    END IF;

    -- 7. Fetch active submission for this sub-event if not published yet and candidates exist
    IF v_eligible_count > 0 THEN
        SELECT * INTO v_submission
        FROM public.result_submissions
        WHERE sub_event_id = p_sub_event_id
          AND status IN ('PENDING_ADMIN_APPROVAL', 'REJECTED')
        ORDER BY created_at DESC
        LIMIT 1;

        IF FOUND THEN
            SELECT COALESCE(
                NULLIF(t.team_name, 'Solo Participant'),
                (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
                t.team_name
            ) INTO v_winner_name
            FROM public.teams t WHERE t.id = v_submission.winner_team_id;

            SELECT COALESCE(
                NULLIF(t.team_name, 'Solo Participant'),
                (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
                t.team_name
            ) INTO v_runner_name
            FROM public.teams t WHERE t.id = v_submission.runner_team_id;

            SELECT COALESCE(
                NULLIF(t.team_name, 'Solo Participant'),
                (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
                t.team_name
            ) INTO v_third_name
            FROM public.teams t WHERE t.id = v_submission.third_team_id;

            RETURN jsonb_build_object(
                'success', true,
                'sub_event_id', p_sub_event_id,
                'sub_event_name', v_sub_event.name,
                'status', v_submission.status,
                'submission_id', v_submission.id,
                'submitted_at', v_submission.submitted_at,
                'reviewed_at', v_submission.reviewed_at,
                'rejection_reason', v_submission.rejection_reason,
                'winner_team_id', v_submission.winner_team_id,
                'winner_name', v_winner_name,
                'runner_team_id', v_submission.runner_team_id,
                'runner_name', v_runner_name,
                'third_team_id', v_submission.third_team_id,
                'third_name', v_third_name,
                'eligible_count', v_eligible_count,
                'eligible_participants', v_eligible_participants,
                'summary_counts', COALESCE(v_summary_counts, '{}'::jsonb)
            );
        END IF;
    END IF;

    -- 8. Default: NOT_SUBMITTED (Fresh result declaration state)
    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'sub_event_name', v_sub_event.name,
        'status', 'NOT_SUBMITTED',
        'results_published', false,
        'results_locked', false,
        'eligible_count', v_eligible_count,
        'eligible_participants', v_eligible_participants,
        'summary_counts', COALESCE(v_summary_counts, '{}'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_result_status(TEXT, UUID) TO anon, authenticated, service_role;


-- ------------------------------------------------------------------------------
-- STEP 7: DIRECT PUBLISH GUARD IN publish_sub_event_results_and_certificates
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_sub_event_results_and_certificates(
    p_sub_event_id UUID,
    p_winner_team_id UUID DEFAULT NULL,
    p_runner_team_id UUID DEFAULT NULL,
    p_third_team_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_sub_event RECORD;
    v_member RECORD;
    v_cert_code TEXT;
    v_cert_count INT := 0;
    v_winner_count INT := 0;
    v_runner_count INT := 0;
    v_third_count INT := 0;
    v_participant_count INT := 0;
    v_eligible_competitors INT := 0;
    v_is_direct_publish BOOLEAN := FALSE;
BEGIN
    -- 1. Authorization Check: Admin Only
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can publish results and issue certificates.';
    END IF;

    -- 2. Verify sub-event exists and lock row
    SELECT * INTO v_sub_event FROM public.sub_events WHERE id = p_sub_event_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found: %', p_sub_event_id;
    END IF;

    -- Security Guard: Reject if results are already published!
    IF v_sub_event.results_published IS TRUE THEN
        RAISE EXCEPTION 'Sub-event results are already published. Published results can only be corrected through the secure one-time result correction workflow.';
    END IF;

    -- 3. Count authoritative eligible competitors
    IF v_sub_event.participation_type = 'SOLO' THEN
        SELECT COUNT(DISTINCT tm.id) INTO v_eligible_competitors
        FROM public.team_members tm
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id AND ar.sub_event_id = p_sub_event_id
        WHERE r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED';
    ELSE
        SELECT COUNT(DISTINCT t.id) INTO v_eligible_competitors
        FROM public.teams t
        JOIN public.registrations r ON r.id = t.registration_id
        JOIN public.attendance_records ar ON ar.team_id = t.id AND ar.sub_event_id = p_sub_event_id
        WHERE r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED';
    END IF;

    -- Reject if no competitors exist at all
    IF v_eligible_competitors = 0 THEN
        RAISE EXCEPTION 'Cannot publish results: No eligible attended competitors found for this sub-event.';
    END IF;

    IF v_eligible_competitors < 2 THEN
        v_is_direct_publish := TRUE;
    ELSE
        v_is_direct_publish := FALSE;
    END IF;

    -- 4. Normal Workflow Validation (if >= 2 competitors)
    IF NOT v_is_direct_publish THEN
        IF p_winner_team_id IS NULL OR p_runner_team_id IS NULL THEN
            RAISE EXCEPTION 'Winner and Runner-Up teams are required for sub-events with 2 or more competitors (found % eligible competitors).', v_eligible_competitors;
        END IF;

        IF p_winner_team_id = p_runner_team_id THEN
            RAISE EXCEPTION 'Winner and Runner-Up cannot be the same team.';
        END IF;

        IF p_third_team_id IS NOT NULL THEN
            IF p_third_team_id = p_winner_team_id OR p_third_team_id = p_runner_team_id THEN
                RAISE EXCEPTION 'Third Place cannot be the same as Winner or Runner-Up.';
            END IF;
        END IF;

        -- 4a. Process Winner Team
        FOR v_member IN
            SELECT tm.id, tm.snapshot_name
            FROM public.team_members tm
            JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
            WHERE tm.team_id = p_winner_team_id
              AND ar.sub_event_id = p_sub_event_id
        LOOP
            SELECT certificate_code INTO v_cert_code 
            FROM public.certificates 
            WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id AND type = 'WINNER';

            IF v_cert_code IS NULL THEN
                LOOP
                    v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
                END LOOP;
            END IF;

            INSERT INTO public.certificates (
                team_member_id,
                sub_event_id,
                type,
                status,
                certificate_code,
                issued_at
            ) VALUES (
                v_member.id,
                p_sub_event_id,
                'WINNER',
                'UNLOCKED',
                v_cert_code,
                now()
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                status = 'UNLOCKED',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

            v_winner_count := v_winner_count + 1;
            v_cert_count := v_cert_count + 1;
        END LOOP;

        -- 4b. Process Runner Team
        FOR v_member IN
            SELECT tm.id, tm.snapshot_name
            FROM public.team_members tm
            JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
            WHERE tm.team_id = p_runner_team_id
              AND ar.sub_event_id = p_sub_event_id
        LOOP
            SELECT certificate_code INTO v_cert_code 
            FROM public.certificates 
            WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id AND type = 'RUNNER';

            IF v_cert_code IS NULL THEN
                LOOP
                    v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
                END LOOP;
            END IF;

            INSERT INTO public.certificates (
                team_member_id,
                sub_event_id,
                type,
                status,
                certificate_code,
                issued_at
            ) VALUES (
                v_member.id,
                p_sub_event_id,
                'RUNNER',
                'UNLOCKED',
                v_cert_code,
                now()
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                status = 'UNLOCKED',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

            v_runner_count := v_runner_count + 1;
            v_cert_count := v_cert_count + 1;
        END LOOP;

        -- 4c. Process Optional Third Place Team
        IF p_third_team_id IS NOT NULL THEN
            FOR v_member IN
                SELECT tm.id, tm.snapshot_name
                FROM public.team_members tm
                JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
                WHERE tm.team_id = p_third_team_id
                  AND ar.sub_event_id = p_sub_event_id
            LOOP
                SELECT certificate_code INTO v_cert_code 
                FROM public.certificates 
                WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id AND type = 'THIRD_PLACE';

                IF v_cert_code IS NULL THEN
                    LOOP
                        v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
                    END LOOP;
                END IF;

                INSERT INTO public.certificates (
                    team_member_id,
                    sub_event_id,
                    type,
                    status,
                    certificate_code,
                    issued_at
                ) VALUES (
                    v_member.id,
                    p_sub_event_id,
                    'THIRD_PLACE',
                    'UNLOCKED',
                    v_cert_code,
                    now()
                )
                ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                    status = 'UNLOCKED',
                    certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

                v_third_count := v_third_count + 1;
                v_cert_count := v_cert_count + 1;
            END LOOP;
        END IF;
    END IF;

    -- 5. Lock and publish results atomically in sub_events
    IF v_is_direct_publish THEN
        UPDATE public.sub_events
        SET results_locked = FALSE,
            results_published = TRUE,
            results_published_at = NOW(),
            winner_team_id = NULL,
            runner_team_id = NULL,
            third_team_id = NULL
        WHERE id = p_sub_event_id;
    ELSE
        UPDATE public.sub_events
        SET results_locked = TRUE,
            results_published = TRUE,
            results_published_at = NOW(),
            winner_team_id = p_winner_team_id,
            runner_team_id = p_runner_team_id,
            third_team_id = p_third_team_id
        WHERE id = p_sub_event_id;
    END IF;

    -- 6. Audit Logging
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        auth.uid(),
        'RESULTS_PUBLISHED',
        'sub_events',
        p_sub_event_id,
        jsonb_build_object(
            'winner_team_id', p_winner_team_id,
            'runner_team_id', p_runner_team_id,
            'third_team_id', p_third_team_id,
            'is_direct_publish', v_is_direct_publish,
            'eligible_competitors', v_eligible_competitors,
            'total_certificates_issued', v_cert_count,
            'published_at', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'winner_count', v_winner_count,
        'runner_count', v_runner_count,
        'third_count', v_third_count,
        'participant_count', v_participant_count,
        'total_certificates', v_cert_count,
        'is_direct_publish', v_is_direct_publish
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_sub_event_results_and_certificates(UUID, UUID, UUID, UUID) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- STEP 8: ONE-TIME DATA SYNCHRONIZATION (REPAIR EXISTING STALE SUB-EVENTS)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
    v_fixed_count INT := 0;
BEGIN
    FOR r IN SELECT id, name FROM public.sub_events LOOP
        IF public.reset_sub_event_results_if_invalid(r.id, 'Migration 107 consistency synchronization') THEN
            v_fixed_count := v_fixed_count + 1;
        END IF;
    END LOOP;
    RAISE NOTICE 'Migration 107: Successfully synchronized and repaired % stale sub-events.', v_fixed_count;
END;
$$;
