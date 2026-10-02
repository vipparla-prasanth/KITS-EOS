-- ============================================================================
-- MIGRATION 103: Authoritative Production Attendance Authorization & Precision Error Codes
--
-- Objective:
-- 1. Fix coordinator authorization path so an assigned coordinator with an active session
--    can reliably verify and check in participants for their assigned sub-event.
-- 2. Precision error classification:
--    - AUTH_SESSION_INVALID: Session missing, expired, or invalid.
--    - NOT_ASSIGNED_TO_SUB_EVENT: Coordinator active but not assigned to this specific sub-event.
--    - SUB_EVENT_INACTIVE: Sub-event is not ACTIVE.
--    - SUB_EVENT_NOT_FOUND: Target sub-event does not exist.
--    - PARTICIPANT_NOT_FOUND: QR/Token/Roll number does not match any participant.
--    - EVENT_MISMATCH: Participant belongs to another event/sub-event.
--    - ALREADY_ATTENDED: Participant or team has already attended.
--    - PAYMENT_PENDING: Payment verification pending.
-- 3. Maintain strict security boundaries:
--    - Only Admins and assigned active coordinators can verify/check in.
--    - Reject unassigned coordinators, cross-sub-event coordinators, students, and anon callers.
--    - Server-side derivation of coordinator identity via get_coordinator_id_by_token.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DROP EXISTING FUNCTION OVERLOADS IF NECESSARY
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.verify_attendance_participant(uuid, text, text);

-- ----------------------------------------------------------------------------
-- 2. RECREATE public.verify_attendance_participant WITH PRECISE AUTHORIZATION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_attendance_participant(
    p_sub_event_id UUID,
    p_query TEXT,
    p_coordinator_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_query TEXT;
    v_coord_token TEXT;
    v_coord_id UUID := NULL;
    v_is_admin BOOLEAN := FALSE;
    v_is_assigned BOOLEAN := FALSE;
    v_sub_event RECORD;
    v_clean_sub_name TEXT;
    v_canonical_prefix TEXT;
    v_is_uuid BOOLEAN := FALSE;
    v_is_10_digits BOOLEAN := FALSE;
    v_is_full_token BOOLEAN := FALSE;
    v_is_prefix_token BOOLEAN := FALSE;
    v_is_roll_number BOOLEAN := FALSE;
    v_search_token TEXT;
    v_search_pattern TEXT;
    v_matched_member_id UUID := NULL;
    v_candidate_count INT := 0;
    v_candidate_ids UUID[] := '{}'::uuid[];
    v_exists_globally BOOLEAN := FALSE;
    v_member_record RECORD;
    v_enriched_members JSONB := '[]'::jsonb;
    v_att_id UUID := NULL;
    v_att_time TIMESTAMPTZ := NULL;
    v_att_by TEXT := NULL;
    v_this_attended BOOLEAN := FALSE;
    v_is_team BOOLEAN := FALSE;
    v_all_attended BOOLEAN := FALSE;
    v_url_uuid_match TEXT[];
BEGIN
    -- 1. Input Sanity Checks
    IF p_sub_event_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'VALIDATION_ERROR',
            'message', 'sub_event_id is required'
        );
    END IF;

    IF p_query IS NULL OR trim(p_query) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'VALIDATION_ERROR',
            'message', 'Token, QR identity, or Roll Number is required'
        );
    END IF;

    -- 2. Authoritative Target Sub-event Validation FIRST
    SELECT se.id, se.name, se.status, se.participation_type, se.category_id,
           COALESCE(se.event_id, c.event_id) AS event_id,
           COALESCE(e.name, 'Current Event') AS event_name
    INTO v_sub_event
    FROM public.sub_events se
    LEFT JOIN public.categories c ON c.id = se.category_id
    LEFT JOIN public.events e ON e.id = COALESCE(se.event_id, c.event_id)
    WHERE se.id = p_sub_event_id
      AND se.status <> 'PERMANENTLY_DELETED';

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'SUB_EVENT_NOT_FOUND',
            'message', 'Target sub-event not found.'
        );
    END IF;

    IF v_sub_event.status <> 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'SUB_EVENT_INACTIVE',
            'message', 'Attendance is currently unavailable for this sub-event.'
        );
    END IF;

    -- 3. Authoritative Server-Side Authorization Check
    -- Check if active Admin via Supabase Auth
    v_is_admin := public.is_admin();

    IF NOT v_is_admin THEN
        IF p_coordinator_token IS NOT NULL AND trim(p_coordinator_token) <> '' THEN
            v_coord_token := regexp_replace(trim(p_coordinator_token), '^Bearer\s+', '', 'i');
            v_coord_id := public.get_coordinator_id_by_token(v_coord_token);

            IF v_coord_id IS NULL THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'AUTH_SESSION_INVALID',
                    'message', 'Your coordinator session is no longer valid. Please sign in again.'
                );
            END IF;

            -- Check if coordinator is assigned to THIS EXACT sub-event
            SELECT EXISTS (
                SELECT 1 FROM public.coordinator_assignments ca
                WHERE ca.coordinator_id = v_coord_id
                  AND ca.sub_event_id = p_sub_event_id
            ) INTO v_is_assigned;

            IF NOT v_is_assigned THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'NOT_ASSIGNED_TO_SUB_EVENT',
                    'message', 'You are not assigned to this sub-event.'
                );
            END IF;
        ELSE
            -- No coordinator token provided and caller is not Admin
            RETURN jsonb_build_object(
                'success', false,
                'code', 'AUTH_SESSION_INVALID',
                'message', 'Your coordinator session is no longer valid. Please sign in again.'
            );
        END IF;
    END IF;

    -- 4. Clean Query and Extract UUID from URLs if applicable
    v_query := trim(p_query);
    IF v_query ~* '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})' THEN
        v_url_uuid_match := regexp_matches(v_query, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'i');
        IF v_url_uuid_match IS NOT NULL AND array_length(v_url_uuid_match, 1) > 0 THEN
            v_query := v_url_uuid_match[1];
        END IF;
    END IF;

    -- 5. Pre-check basic input pattern
    v_is_uuid := v_query ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    v_is_10_digits := v_query ~ '^\d{10}$';
    v_is_full_token := v_query ~* '^KITS-EOS-[A-Z0-9-]+-\d{10}$';
    v_is_prefix_token := v_query ILIKE 'KITS-EOS-%';
    v_is_roll_number := v_query ~* '^[0-9]{2}[A-Z0-9]{8,10}$';

    IF NOT v_is_uuid AND NOT v_is_10_digits AND NOT v_is_full_token AND NOT v_is_prefix_token AND NOT v_is_roll_number THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_QR',
            'message', 'Invalid KITS-EOS QR code. No attendance marked.'
        );
    END IF;

    -- Canonical prefix for current sub-event
    v_clean_sub_name := regexp_replace(upper(COALESCE(v_sub_event.name, 'EVENT')), '[^A-Z0-9]+', '-', 'g');
    v_clean_sub_name := trim(both '-' from v_clean_sub_name);
    v_canonical_prefix := 'KITS-EOS-' || v_clean_sub_name || '-';

    -- -------------------------------------------------------------------------
    -- 6. RESOLVE PARTICIPANT
    -- -------------------------------------------------------------------------
    -- CASE A: UUID (qr_identity)
    IF v_is_uuid THEN
        SELECT tm.id INTO v_matched_member_id
        FROM public.team_members tm
        WHERE tm.qr_identity = v_query::uuid;

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'PARTICIPANT_NOT_FOUND',
                'message', 'The QR code could not be matched to a participant.'
            );
        END IF;
    END IF;

    -- CASE B: MANUAL TOKEN (10 Digits or Canonical Token)
    IF v_matched_member_id IS NULL AND (v_is_10_digits OR v_is_full_token OR v_is_prefix_token) THEN
        IF v_is_10_digits THEN
            v_search_token := v_canonical_prefix || v_query;
        ELSE
            v_search_token := upper(v_query);
        END IF;

        -- 1. Search in current sub-event first
        SELECT tm.id INTO v_matched_member_id
        FROM public.team_members tm
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE r.sub_event_id = p_sub_event_id
          AND tm.manual_token ILIKE v_search_token;

        -- 2. If not found in current sub-event, search within parent event sibling sub-events
        IF v_matched_member_id IS NULL THEN
            v_search_pattern := CASE WHEN v_is_10_digits THEN '%-' || v_query ELSE upper(v_query) END;

            SELECT COALESCE(array_agg(cand.id), '{}'::uuid[])
            INTO v_candidate_ids
            FROM (
                SELECT tm.id
                FROM public.team_members tm
                JOIN public.teams t ON t.id = tm.team_id
                JOIN public.registrations r ON r.id = t.registration_id
                JOIN public.sub_events se_cand ON se_cand.id = r.sub_event_id
                LEFT JOIN public.categories cat_cand ON cat_cand.id = se_cand.category_id
                WHERE COALESCE(se_cand.event_id, cat_cand.event_id) = v_sub_event.event_id
                  AND tm.manual_token ILIKE v_search_pattern
                LIMIT 2
            ) cand;

            v_candidate_count := COALESCE(array_length(v_candidate_ids, 1), 0);

            IF v_candidate_count > 1 THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'AMBIGUOUS_TOKEN',
                    'message', 'This attendance token could not be uniquely verified. No attendance marked.'
                );
            ELSIF v_candidate_count = 1 THEN
                v_matched_member_id := v_candidate_ids[1];
            ELSE
                -- Check globally across other events
                SELECT EXISTS (
                    SELECT 1 FROM public.team_members tm
                    WHERE tm.manual_token ILIKE v_search_pattern
                ) INTO v_exists_globally;

                IF v_exists_globally THEN
                    RETURN jsonb_build_object(
                        'success', false,
                        'code', 'EVENT_MISMATCH',
                        'message', 'This QR belongs to another event/sub-event. No attendance marked.'
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'success', false,
                        'code', 'PARTICIPANT_NOT_FOUND',
                        'message', 'The QR code could not be matched to a participant.'
                    );
                END IF;
            END IF;
        END IF;
    END IF;

    -- CASE C: ROLL NUMBER
    IF v_matched_member_id IS NULL AND v_is_roll_number THEN
        -- Search in current sub-event first
        SELECT tm.id INTO v_matched_member_id
        FROM public.team_members tm
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE r.sub_event_id = p_sub_event_id
          AND tm.snapshot_roll_number ILIKE v_query;

        -- If not found, search in parent event
        IF v_matched_member_id IS NULL THEN
            SELECT COALESCE(array_agg(cand.id), '{}'::uuid[])
            INTO v_candidate_ids
            FROM (
                SELECT tm.id
                FROM public.team_members tm
                JOIN public.teams t ON t.id = tm.team_id
                JOIN public.registrations r ON r.id = t.registration_id
                JOIN public.sub_events se_cand ON se_cand.id = r.sub_event_id
                LEFT JOIN public.categories cat_cand ON cat_cand.id = se_cand.category_id
                WHERE COALESCE(se_cand.event_id, cat_cand.event_id) = v_sub_event.event_id
                  AND tm.snapshot_roll_number ILIKE v_query
                LIMIT 2
            ) cand;

            v_candidate_count := COALESCE(array_length(v_candidate_ids, 1), 0);

            IF v_candidate_count > 1 THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'AMBIGUOUS_TOKEN',
                    'message', 'This participant roll number matches multiple records in the event. No attendance marked.'
                );
            ELSIF v_candidate_count = 1 THEN
                v_matched_member_id := v_candidate_ids[1];
            ELSE
                -- Check globally across other events
                SELECT EXISTS (
                    SELECT 1 FROM public.team_members tm
                    WHERE tm.snapshot_roll_number ILIKE v_query
                ) INTO v_exists_globally;

                IF v_exists_globally THEN
                    RETURN jsonb_build_object(
                        'success', false,
                        'code', 'EVENT_MISMATCH',
                        'message', 'This QR belongs to another event/sub-event. No attendance marked.'
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'success', false,
                        'code', 'PARTICIPANT_NOT_FOUND',
                        'message', 'The QR code could not be matched to a participant.'
                    );
                END IF;
            END IF;
        END IF;
    END IF;

    IF v_matched_member_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'PARTICIPANT_NOT_FOUND',
            'message', 'The QR code could not be matched to a participant.'
        );
    END IF;

    -- -------------------------------------------------------------------------
    -- 7. FETCH COMPLETE AUTHORITATIVE REGISTRATION & PARTICIPANT SNAPSHOT
    -- -------------------------------------------------------------------------
    SELECT tm.id, tm.team_id, tm.snapshot_name, tm.snapshot_roll_number,
           tm.snapshot_college, tm.snapshot_department, tm.snapshot_year,
           tm.is_leader, tm.manual_token, tm.qr_identity,
           t.id AS team_pk, t.team_name,
           r.id AS reg_id, r.status AS reg_status, r.sub_event_id AS reg_sub_event_id,
           se_reg.name AS reg_sub_event_name, se_reg.participation_type AS reg_part_type,
           COALESCE(se_reg.event_id, cat_reg.event_id) AS reg_event_id,
           COALESCE(e_reg.name, 'Another Event') AS reg_event_name
    INTO v_member_record
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    JOIN public.sub_events se_reg ON se_reg.id = r.sub_event_id
    LEFT JOIN public.categories cat_reg ON cat_reg.id = se_reg.category_id
    LEFT JOIN public.events e_reg ON e_reg.id = COALESCE(se_reg.event_id, cat_reg.event_id)
    WHERE tm.id = v_matched_member_id;

    -- -------------------------------------------------------------------------
    -- 8. POST-LOOKUP BUSINESS VALIDATIONS
    -- -------------------------------------------------------------------------
    -- 8.1 Registration Cancellation
    IF v_member_record.reg_status = 'CANCELLED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'REGISTRATION_INVALID',
            'message', 'Registration could not be verified. No attendance marked.'
        );
    END IF;

    -- 8.2 Strict Parent Event Isolation
    IF v_member_record.reg_event_id <> v_sub_event.event_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'EVENT_MISMATCH',
            'message', 'This QR belongs to another event/sub-event. No attendance marked.'
        );
    END IF;

    -- 8.3 Strict Sub-Event Isolation
    IF v_member_record.reg_sub_event_id <> p_sub_event_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'EVENT_MISMATCH',
            'message', COALESCE(v_member_record.snapshot_name, 'Participant') || ' belongs to ' || COALESCE(v_member_record.reg_sub_event_name, 'another sub-event') || '. No attendance marked.',
            'participant', jsonb_build_object(
                'id', v_member_record.id,
                'name', v_member_record.snapshot_name,
                'roll_number', v_member_record.snapshot_roll_number,
                'actual_sub_event_name', v_member_record.reg_sub_event_name,
                'current_sub_event_name', v_sub_event.name,
                'actual_event_name', v_member_record.reg_event_name,
                'current_event_name', v_sub_event.event_name
            )
        );
    END IF;

    -- 8.4 Payment Verification
    IF v_member_record.reg_status = 'PENDING_PAYMENT' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'PAYMENT_PENDING',
            'message', COALESCE(v_member_record.snapshot_name, 'Participant') || '''s payment has not been verified. Attendance cannot be marked.',
            'participant', jsonb_build_object(
                'id', v_member_record.id,
                'name', v_member_record.snapshot_name,
                'roll_number', v_member_record.snapshot_roll_number
            )
        );
    END IF;

    -- -------------------------------------------------------------------------
    -- 9. AUTHORITATIVE ATTENDANCE CHECK & TEAM ENRICHMENT
    -- -------------------------------------------------------------------------
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', tm.id,
            'snapshot_name', tm.snapshot_name,
            'snapshot_roll_number', tm.snapshot_roll_number,
            'snapshot_college', tm.snapshot_college,
            'snapshot_department', tm.snapshot_department,
            'snapshot_year', tm.snapshot_year,
            'is_leader', tm.is_leader,
            'manual_token', tm.manual_token,
            'qr_identity', tm.qr_identity,
            'is_attended', (ar.id IS NOT NULL),
            'check_in_time', ar.check_in_time,
            'checked_in_by', COALESCE(coord.display_name, CASE WHEN ar.id IS NOT NULL THEN 'Administrator' ELSE NULL END)
        ) ORDER BY tm.is_leader DESC, tm.snapshot_name ASC
    ), '[]'::jsonb)
    INTO v_enriched_members
    FROM public.team_members tm
    LEFT JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id AND ar.sub_event_id = p_sub_event_id
    LEFT JOIN public.coordinators coord ON coord.id = ar.checked_in_by
    WHERE tm.team_id = v_member_record.team_pk;

    -- Fetch this specific scanned member's attendance
    SELECT ar.id, ar.check_in_time, COALESCE(coord.display_name, 'Administrator')
    INTO v_att_id, v_att_time, v_att_by
    FROM public.attendance_records ar
    LEFT JOIN public.coordinators coord ON coord.id = ar.checked_in_by
    WHERE ar.sub_event_id = p_sub_event_id
      AND ar.scanned_member_id = v_matched_member_id;

    v_this_attended := (v_att_id IS NOT NULL);
    v_is_team := (jsonb_array_length(v_enriched_members) > 1 OR v_sub_event.participation_type = 'TEAM');

    IF v_is_team AND jsonb_array_length(v_enriched_members) > 0 THEN
        SELECT bool_and((m->>'is_attended')::boolean) INTO v_all_attended 
        FROM jsonb_array_elements(v_enriched_members) m;
    ELSE
        v_all_attended := v_this_attended;
    END IF;

    -- 9.1 If already attended:
    IF (v_is_team AND v_all_attended) OR (NOT v_is_team AND v_this_attended) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ALREADY_ATTENDED',
            'message', CASE 
                WHEN v_is_team THEN 'All members of this team have already been marked as attended.'
                ELSE 'Attendance has already been recorded for this participant.'
            END,
            'participant', jsonb_build_object(
                'id', v_member_record.id,
                'name', v_member_record.snapshot_name,
                'roll_number', v_member_record.snapshot_roll_number,
                'college', v_member_record.snapshot_college,
                'department', v_member_record.snapshot_department,
                'year', v_member_record.snapshot_year,
                'manual_token', v_member_record.manual_token,
                'qr_identity', v_member_record.qr_identity,
                'is_leader', v_member_record.is_leader,
                'is_attended', v_this_attended,
                'check_in_time', v_att_time,
                'checked_in_by', v_att_by
            ),
            'team', jsonb_build_object(
                'id', v_member_record.team_pk,
                'team_name', v_member_record.team_name,
                'is_team', v_is_team,
                'members', v_enriched_members
            ),
            'registration', jsonb_build_object(
                'id', v_member_record.reg_id,
                'status', v_member_record.reg_status,
                'sub_event_id', v_member_record.reg_sub_event_id,
                'sub_event_name', v_member_record.reg_sub_event_name,
                'participation_type', v_member_record.reg_part_type
            ),
            'attendance', jsonb_build_object(
                'is_attended', v_this_attended,
                'check_in_time', v_att_time,
                'checked_in_by', v_att_by
            )
        );
    END IF;

    -- 9.2 SUCCESS: Participant/Team is eligible and ready for confirmation
    RETURN jsonb_build_object(
        'success', true,
        'code', 'SUCCESS',
        'participant', jsonb_build_object(
            'id', v_member_record.id,
            'name', v_member_record.snapshot_name,
            'roll_number', v_member_record.snapshot_roll_number,
            'college', v_member_record.snapshot_college,
            'department', v_member_record.snapshot_department,
            'year', v_member_record.snapshot_year,
            'manual_token', v_member_record.manual_token,
            'qr_identity', v_member_record.qr_identity,
            'is_leader', v_member_record.is_leader,
            'is_attended', v_this_attended,
            'check_in_time', v_att_time,
            'checked_in_by', v_att_by
        ),
        'team', jsonb_build_object(
            'id', v_member_record.team_pk,
            'team_name', v_member_record.team_name,
            'is_team', v_is_team,
            'members', v_enriched_members
        ),
        'registration', jsonb_build_object(
            'id', v_member_record.reg_id,
            'status', v_member_record.reg_status,
            'sub_event_id', v_member_record.reg_sub_event_id,
            'sub_event_name', v_member_record.reg_sub_event_name,
            'participation_type', v_member_record.reg_part_type
        ),
        'attendance', jsonb_build_object(
            'is_attended', v_this_attended,
            'check_in_time', v_att_time,
            'checked_in_by', v_att_by
        )
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. RECREATE public.commit_attendance_checkin WITH PRECISE AUTHORIZATION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_attendance_checkin(
    p_sub_event_id UUID,
    p_team_id UUID,
    p_scanned_member_ids UUID[],
    p_coordinator_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_coord_token TEXT;
    v_coord_id UUID := NULL;
    v_is_admin BOOLEAN := FALSE;
    v_is_assigned BOOLEAN := FALSE;
    v_actor_id UUID := NULL;
    v_team_record RECORD;
    v_sub_event RECORD;
    v_member_id UUID;
    v_new_insert_count INT := 0;
    v_already_attended_count INT := 0;
    v_member_info RECORD;
    v_inserted_attendance JSONB := '[]'::jsonb;
    v_existing_att_id UUID;
    v_new_att_id UUID;
    v_event_key TEXT;
BEGIN
    IF p_sub_event_id IS NULL THEN
        RAISE EXCEPTION 'sub_event_id is required';
    END IF;

    IF p_team_id IS NULL THEN
        RAISE EXCEPTION 'team_id is required';
    END IF;

    IF p_scanned_member_ids IS NULL OR array_length(p_scanned_member_ids, 1) = 0 THEN
        RAISE EXCEPTION 'At least one team member must be selected to record attendance.';
    END IF;

    -- Sub-event existence and activity validation
    SELECT id, name, status INTO v_sub_event
    FROM public.sub_events
    WHERE id = p_sub_event_id
      AND status <> 'PERMANENTLY_DELETED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target sub-event not found';
    END IF;

    IF v_sub_event.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Attendance is currently unavailable for this sub-event.';
    END IF;

    -- Authorization check
    v_is_admin := public.is_admin();

    IF NOT v_is_admin THEN
        IF p_coordinator_token IS NOT NULL AND trim(p_coordinator_token) <> '' THEN
            v_coord_token := regexp_replace(trim(p_coordinator_token), '^Bearer\s+', '', 'i');
            v_coord_id := public.get_coordinator_id_by_token(v_coord_token);

            IF v_coord_id IS NULL THEN
                RAISE EXCEPTION 'Your coordinator session is no longer valid. Please sign in again.';
            END IF;

            SELECT EXISTS (
                SELECT 1 FROM public.coordinator_assignments ca
                WHERE ca.coordinator_id = v_coord_id
                  AND ca.sub_event_id = p_sub_event_id
            ) INTO v_is_assigned;

            IF NOT v_is_assigned THEN
                RAISE EXCEPTION 'You are not assigned to this sub-event.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Your coordinator session is no longer valid. Please sign in again.';
        END IF;
    END IF;

    v_actor_id := COALESCE(v_coord_id, auth.uid());

    -- Team & registration check
    SELECT t.id, t.team_name, r.id AS reg_id, r.status AS reg_status, r.leader_id,
           r.sub_event_id AS reg_sub_event_id, se_t.name AS reg_sub_name
    INTO v_team_record
    FROM public.teams t
    JOIN public.registrations r ON r.id = t.registration_id
    JOIN public.sub_events se_t ON se_t.id = r.sub_event_id
    WHERE t.id = p_team_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Team registration not found';
    END IF;

    IF v_team_record.reg_sub_event_id <> p_sub_event_id THEN
        RAISE EXCEPTION 'WRONG SUB-EVENT: Participant is registered for "%". Current verification station is "%". Attendance was NOT marked.',
            v_team_record.reg_sub_name, v_sub_event.name;
    END IF;

    IF v_team_record.reg_status <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Registration is %. Check-in requires CONFIRMED status.', v_team_record.reg_status;
    END IF;

    -- Process each member check-in atomically
    FOREACH v_member_id IN ARRAY p_scanned_member_ids
    LOOP
        SELECT tm.id, tm.user_id, tm.snapshot_name, tm.snapshot_roll_number, tm.is_leader
        INTO v_member_info
        FROM public.team_members tm
        WHERE tm.id = v_member_id AND tm.team_id = p_team_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected member (%) does not belong to team "%"', v_member_id, v_team_record.team_name;
        END IF;

        SELECT id INTO v_existing_att_id
        FROM public.attendance_records
        WHERE sub_event_id = p_sub_event_id
          AND scanned_member_id = v_member_id;

        IF FOUND THEN
            v_already_attended_count := v_already_attended_count + 1;
        ELSE
            INSERT INTO public.attendance_records (
                sub_event_id,
                team_id,
                scanned_member_id,
                check_in_time,
                checked_in_by
            ) VALUES (
                p_sub_event_id,
                p_team_id,
                v_member_id,
                now(),
                v_coord_id
            )
            ON CONFLICT (sub_event_id, scanned_member_id) DO NOTHING
            RETURNING id INTO v_new_att_id;

            IF v_new_att_id IS NOT NULL THEN
                v_new_insert_count := v_new_insert_count + 1;

                INSERT INTO public.audit_logs (
                    actor_id,
                    action,
                    entity_type,
                    entity_id,
                    metadata,
                    created_at
                ) VALUES (
                    v_actor_id,
                    'ATTENDANCE_CHECKIN_CONFIRMED',
                    'attendance_records',
                    v_new_att_id,
                    jsonb_build_object(
                        'sub_event_id', p_sub_event_id,
                        'sub_event_name', v_sub_event.name,
                        'team_id', p_team_id,
                        'team_name', v_team_record.team_name,
                        'scanned_member_id', v_member_id,
                        'scanned_member_name', v_member_info.snapshot_name,
                        'scanned_member_roll', v_member_info.snapshot_roll_number,
                        'check_in_time', now()
                    ),
                    now()
                );

                v_event_key := 'ATTENDANCE_CONFIRMED:' || v_new_att_id::text;
                
                DECLARE
                    v_target_user UUID := COALESCE(v_member_info.user_id, CASE WHEN v_member_info.is_leader THEN v_team_record.leader_id ELSE NULL END);
                BEGIN
                    IF v_target_user IS NOT NULL THEN
                        INSERT INTO public.notifications (
                            user_id,
                            coordinator_id,
                            recipient_role,
                            notification_type,
                            category,
                            entity_type,
                            entity_id,
                            title,
                            message,
                            event_key,
                            metadata,
                            is_read,
                            created_at
                        ) VALUES (
                            v_target_user,
                            NULL,
                            'STUDENT',
                            'ATTENDANCE_CONFIRMED',
                            'ATTENDANCE',
                            'ATTENDANCE',
                            v_new_att_id,
                            'Attendance Confirmed',
                            'Your attendance for ' || v_sub_event.name || ' has been successfully recorded.',
                            v_event_key,
                            jsonb_build_object(
                                'attendance_id', v_new_att_id,
                                'sub_event_id', p_sub_event_id,
                                'sub_event_name', v_sub_event.name
                            ),
                            FALSE,
                            NOW()
                        )
                        ON CONFLICT (event_key) DO NOTHING;
                    END IF;
                END;
            ELSE
                v_already_attended_count := v_already_attended_count + 1;
            END IF;
        END IF;
    END LOOP;

    -- Return updated live roster state
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', tm.id,
            'snapshot_name', tm.snapshot_name,
            'snapshot_roll_number', tm.snapshot_roll_number,
            'is_leader', tm.is_leader,
            'is_attended', (ar.id IS NOT NULL),
            'check_in_time', ar.check_in_time,
            'checked_in_by', COALESCE(coord.display_name, CASE WHEN ar.id IS NOT NULL THEN 'Administrator' ELSE NULL END)
        ) ORDER BY tm.is_leader DESC, tm.snapshot_name ASC
    ), '[]'::jsonb)
    INTO v_inserted_attendance
    FROM public.team_members tm
    LEFT JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id AND ar.sub_event_id = p_sub_event_id
    LEFT JOIN public.coordinators coord ON coord.id = ar.checked_in_by
    WHERE tm.team_id = p_team_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', CASE 
            WHEN v_new_insert_count > 0 THEN 'Attendance marked successfully'
            ELSE 'Selected members have already been marked as attended.'
        END,
        'recorded_count', v_new_insert_count,
        'already_attended_count', v_already_attended_count,
        'team_name', v_team_record.team_name,
        'team_members', v_inserted_attendance
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. GRANT PERMISSIONS
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.verify_attendance_participant(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_attendance_checkin(UUID, UUID, UUID[], TEXT) TO anon, authenticated, service_role;
