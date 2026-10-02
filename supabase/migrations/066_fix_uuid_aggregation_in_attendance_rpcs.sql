-- ==============================================================================
-- Migration 066: Fix UUID Aggregation in verify_attendance_participant RPC
-- ==============================================================================
-- Problem Statement:
-- In Migration 065, candidate lookups within parent event sibling sub-events used:
--     SELECT COUNT(*), min(tm.id) INTO v_candidate_count, v_candidate_id
-- Because tm.id is of type UUID and PostgreSQL does not have a built-in min(uuid)
-- aggregate function, searches that reach the sibling lookup path fail with:
--     "function min(uuid) does not exist"
--
-- Solution:
-- Replace min(tm.id) with an array aggregation:
--     SELECT COALESCE(array_agg(cand.id), '{}'::uuid[]) INTO v_candidate_ids ... LIMIT 2
-- and determine count via array_length(v_candidate_ids, 1).
-- This is natively supported by PostgreSQL for UUID types and avoids unsupported aggregates.
-- ==============================================================================

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

    v_query := trim(p_query);

    -- Extract UUID if query is a URL containing a UUID
    IF v_query ~* '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})' THEN
        v_url_uuid_match := regexp_matches(v_query, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'i');
        IF v_url_uuid_match IS NOT NULL AND array_length(v_url_uuid_match, 1) > 0 THEN
            v_query := v_url_uuid_match[1];
        END IF;
    END IF;

    -- 2. Authoritative Server-Side Authorization Check
    -- Check if active Admin
    v_is_admin := public.is_admin();

    -- Check if active Coordinator
    IF p_coordinator_token IS NOT NULL AND trim(p_coordinator_token) <> '' THEN
        v_coord_token := regexp_replace(trim(p_coordinator_token), '^Bearer\s+', '', 'i');
        v_coord_id := public.get_coordinator_id_by_token(v_coord_token);
        IF v_coord_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1 FROM public.coordinator_assignments ca
                JOIN public.sub_events se_chk ON se_chk.id = ca.sub_event_id
                WHERE ca.coordinator_id = v_coord_id
                  AND ca.sub_event_id = p_sub_event_id
                  AND se_chk.status <> 'PERMANENTLY_DELETED'
            ) INTO v_is_assigned;
        END IF;
    END IF;

    IF NOT v_is_admin AND NOT v_is_assigned THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'UNAUTHORIZED_COORDINATOR',
            'message', 'You are not authorized to verify attendance for this sub-event.'
        );
    END IF;

    -- 3. Fetch authoritative target sub-event and parent event details
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

    -- 4. Pre-check basic input pattern
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
    -- 5. RESOLVE PARTICIPANT
    -- -------------------------------------------------------------------------
    -- CASE A: UUID (qr_identity)
    IF v_is_uuid THEN
        SELECT tm.id INTO v_matched_member_id
        FROM public.team_members tm
        WHERE tm.qr_identity = v_query::uuid;

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_QR',
                'message', 'Invalid KITS-EOS QR code. No attendance marked.'
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
                        'code', 'INVALID_TOKEN',
                        'message', 'Invalid attendance token. No attendance marked.'
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
                        'code', 'NOT_REGISTERED',
                        'message', 'Participant is not registered for this event. No attendance marked.'
                    );
                END IF;
            END IF;
        END IF;
    END IF;

    IF v_matched_member_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'NOT_REGISTERED',
            'message', 'Participant is not registered for this sub-event. No attendance marked.'
        );
    END IF;

    -- -------------------------------------------------------------------------
    -- 6. FETCH COMPLETE AUTHORITATIVE REGISTRATION & PARTICIPANT SNAPSHOT
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
    -- 7. POST-LOOKUP BUSINESS VALIDATIONS
    -- -------------------------------------------------------------------------
    -- 7.1 Registration Cancellation
    IF v_member_record.reg_status = 'CANCELLED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'REGISTRATION_INVALID',
            'message', 'Registration could not be verified. No attendance marked.'
        );
    END IF;

    -- 7.2 Strict Parent Event Isolation
    IF v_member_record.reg_event_id <> v_sub_event.event_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'EVENT_MISMATCH',
            'message', 'This QR belongs to another event/sub-event. No attendance marked.'
        );
    END IF;

    -- 7.3 Strict Sub-Event Isolation
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

    -- 7.4 Payment Verification
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
    -- 8. AUTHORITATIVE ATTENDANCE CHECK & TEAM ENRICHMENT
    -- -------------------------------------------------------------------------
    -- Fetch all members for this team with live attendance status
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

    -- 8.1 If already attended:
    IF (v_is_team AND v_all_attended) OR (NOT v_is_team AND v_this_attended) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ALREADY_ATTENDED',
            'message', CASE 
                WHEN v_is_team THEN 'All members of this team have already been marked as attended.'
                ELSE 'Attendance has already been marked for this student.'
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

    -- 8.2 SUCCESS: Participant/Team is eligible and ready for confirmation
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

GRANT EXECUTE ON FUNCTION public.verify_attendance_participant(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
