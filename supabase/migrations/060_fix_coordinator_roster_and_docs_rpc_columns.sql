-- ============================================================================
-- Migration: 060_fix_coordinator_roster_and_docs_rpc_columns.sql
-- Description: Fixes column mismatches (Postgres Error 42703 / undefined_column)
-- in coordinator roster, documents, and admin roster RPCs.
--
-- Root Cause:
-- 1. get_coordinator_sub_event_roster queried attendance_records.checked_in_at
--    instead of attendance_records.check_in_time.
-- 2. get_sub_event_documents_for_coordinator queried documents.file_size
--    and documents.created_at instead of documents.size_bytes and documents.uploaded_at.
-- ============================================================================

-- 1. Coordinator Roster RPC (Token-based)
CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_roster(p_token text, p_sub_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN;
    v_registrations JSONB;
    v_attendance JSONB;
BEGIN
    SELECT public.get_coordinator_id_by_token(p_token) INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Coordinator authorization required: Invalid or expired session token.'
        );
    END IF;

    -- Strict server-side assignment verification
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.sub_events se ON se.id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord_id
          AND ca.sub_event_id = p_sub_event_id
          AND se.status = 'ACTIVE'::public.event_status
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: You do not have active assignment to operate on this sub-event.'
        );
    END IF;

    -- Set-Based CTE Aggregation (Zero Correlated Scalar Subqueries)
    WITH pre_payments AS (
        SELECT p.registration_id,
               COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'id', p.id,
                       'status', p.status,
                       'amount', p.amount,
                       'payment_method', p.payment_method,
                       'reference_id', p.reference_id,
                       'transaction_id', p.reference_id,
                       'created_at', p.created_at,
                       'updated_at', p.created_at
                   ) ORDER BY p.created_at DESC
               ), '[]'::jsonb) AS payments_json
        FROM public.payments p
        JOIN public.registrations r ON r.id = p.registration_id
        WHERE r.sub_event_id = p_sub_event_id
        GROUP BY p.registration_id
    ),
    pre_members AS (
        SELECT tm.team_id,
               COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'id', tm.id,
                       'user_id', tm.user_id,
                       'is_leader', tm.is_leader,
                       'manual_token', tm.manual_token,
                       'qr_identity', tm.qr_identity,
                       'snapshot_name', tm.snapshot_name,
                       'snapshot_roll_number', tm.snapshot_roll_number,
                       'snapshot_college', tm.snapshot_college,
                       'snapshot_department', tm.snapshot_department,
                       'snapshot_year', tm.snapshot_year,
                       'attendance_token', tm.manual_token,
                       'student_id', tm.user_id,
                       'student_profiles', jsonb_build_object(
                           'user_id', COALESCE(tm.user_id, sp.user_id),
                           'full_name', COALESCE(tm.snapshot_name, sp.full_name),
                           'roll_number', COALESCE(tm.snapshot_roll_number, sp.roll_number),
                           'college', COALESCE(tm.snapshot_college, sp.college),
                           'department', COALESCE(tm.snapshot_department, sp.department),
                           'year_of_study', COALESCE(tm.snapshot_year, sp.year_of_study),
                           'phone', sp.phone
                       )
                   ) ORDER BY tm.is_leader DESC, tm.snapshot_name ASC
               ), '[]'::jsonb) AS members_json
        FROM public.team_members tm
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        LEFT JOIN public.student_profiles sp ON sp.user_id = tm.user_id
        WHERE r.sub_event_id = p_sub_event_id
        GROUP BY tm.team_id
    ),
    pre_teams AS (
        SELECT t.registration_id,
               jsonb_build_object(
                   'id', t.id,
                   'name', t.team_name,
                   'team_name', t.team_name,
                   'leader_id', r.leader_id,
                   'team_members', COALESCE(pm.members_json, '[]'::jsonb),
                   'members', COALESCE(pm.members_json, '[]'::jsonb)
               ) AS team_json
        FROM public.teams t
        JOIN public.registrations r ON r.id = t.registration_id
        LEFT JOIN pre_members pm ON pm.team_id = t.id
        WHERE r.sub_event_id = p_sub_event_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'sub_event_id', r.sub_event_id,
            'leader_id', r.leader_id,
            'status', r.status,
            'created_at', r.created_at,
            'teams', pt.team_json,
            'team', pt.team_json,
            'student_profiles', jsonb_build_object(
                'user_id', r.leader_id,
                'full_name', COALESCE(sp_lead.full_name, 'Participant'),
                'roll_number', sp_lead.roll_number,
                'college', sp_lead.college,
                'department', sp_lead.department,
                'year_of_study', sp_lead.year_of_study,
                'phone', sp_lead.phone
            ),
            'payments', COALESCE(pp.payments_json, '[]'::jsonb)
        ) ORDER BY r.created_at ASC
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    LEFT JOIN pre_teams pt ON pt.registration_id = r.id
    LEFT JOIN pre_payments pp ON pp.registration_id = r.id
    LEFT JOIN public.student_profiles sp_lead ON sp_lead.user_id = r.leader_id
    WHERE r.sub_event_id = p_sub_event_id;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'sub_event_id', a.sub_event_id,
            'team_id', a.team_id,
            'scanned_member_id', a.scanned_member_id,
            'check_in_time', a.check_in_time,
            'checked_in_at', a.check_in_time,
            'checked_in_by', a.checked_in_by
        )
    ), '[]'::jsonb)
    INTO v_attendance
    FROM public.attendance_records a
    WHERE a.sub_event_id = p_sub_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'coordinator_id', v_coord_id,
        'registrations', v_registrations,
        'attendance', v_attendance,
        'metrics', jsonb_build_object(
            'total_registrations', jsonb_array_length(v_registrations),
            'total_attendance', jsonb_array_length(v_attendance)
        )
    );
END;
$function$;

-- 2. Coordinator Documents RPC (Token-based)
CREATE OR REPLACE FUNCTION public.get_sub_event_documents_for_coordinator(p_token text, p_sub_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN;
    v_docs JSONB;
BEGIN
    SELECT public.get_coordinator_id_by_token(p_token) INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Coordinator authorization required: Invalid or expired session token.'
        );
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.sub_events se ON se.id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord_id
          AND ca.sub_event_id = p_sub_event_id
          AND se.status = 'ACTIVE'::public.event_status
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: You are not assigned to this sub-event.'
        );
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', d.id,
            'name', d.file_name,
            'file_name', d.file_name,
            'file_path', d.storage_path,
            'storage_path', d.storage_path,
            'file_size', d.size_bytes,
            'size_bytes', d.size_bytes,
            'file_type', d.mime_type,
            'mime_type', d.mime_type,
            'created_at', d.uploaded_at,
            'uploaded_at', d.uploaded_at,
            'owner_id', d.owner_id,
            'entity_type', d.entity_type,
            'entity_id', d.entity_id,
            'student_name', sp.full_name,
            'roll_number', sp.roll_number
        ) ORDER BY d.uploaded_at DESC
    ), '[]'::jsonb)
    INTO v_docs
    FROM public.documents d
    JOIN public.registrations r ON r.id = d.entity_id AND d.entity_type = 'REGISTRATION'
    LEFT JOIN public.student_profiles sp ON sp.user_id = d.owner_id
    WHERE r.sub_event_id = p_sub_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'documents', v_docs
    );
END;
$function$;

-- 3. Admin Roster RPC
CREATE OR REPLACE FUNCTION public.admin_get_sub_event_roster(p_sub_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
    v_registrations JSONB;
    v_attendance JSONB;
BEGIN
    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Administrator authorization required';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'sub_event_id', r.sub_event_id,
            'leader_id', r.leader_id,
            'registration_type', r.registration_type,
            'status', r.status,
            'created_at', r.created_at,
            'teams', CASE WHEN t.id IS NOT NULL THEN jsonb_build_object(
                'id', t.id,
                'name', t.name,
                'leader_id', t.leader_id,
                'team_members', (
                    SELECT COALESCE(jsonb_agg(
                        jsonb_build_object(
                            'id', tm.id,
                            'student_id', tm.student_id,
                            'is_leader', (tm.student_id = r.leader_id),
                            'attendance_token', tm.attendance_token,
                            'student_profiles', jsonb_build_object(
                                'user_id', sp_m.user_id,
                                'full_name', sp_m.full_name,
                                'roll_number', sp_m.roll_number,
                                'college', sp_m.college,
                                'department', sp_m.department,
                                'year_of_study', sp_m.year_of_study,
                                'phone', sp_m.phone
                            )
                        ) ORDER BY (tm.student_id = r.leader_id) DESC, sp_m.full_name ASC
                    ), '[]'::jsonb)
                    FROM public.team_members tm
                    LEFT JOIN public.student_profiles sp_m ON sp_m.user_id = tm.student_id
                    WHERE tm.team_id = t.id
                )
            ) ELSE NULL END,
            'student_profiles', CASE WHEN sp_lead.user_id IS NOT NULL THEN jsonb_build_object(
                'user_id', sp_lead.user_id,
                'full_name', sp_lead.full_name,
                'roll_number', sp_lead.roll_number,
                'college', sp_lead.college,
                'department', sp_lead.department,
                'year_of_study', sp_lead.year_of_study,
                'phone', sp_lead.phone
            ) ELSE NULL END,
            'payments', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'id', p.id,
                        'status', p.status,
                        'amount', p.amount,
                        'payment_method', p.payment_method,
                        'transaction_id', p.transaction_id,
                        'updated_at', p.updated_at
                    ) ORDER BY p.created_at DESC
                ), '[]'::jsonb)
                FROM public.payments p
                WHERE p.registration_id = r.id
            )
        ) ORDER BY r.created_at ASC
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    LEFT JOIN public.teams t ON t.registration_id = r.id
    LEFT JOIN public.student_profiles sp_lead ON sp_lead.user_id = r.leader_id
    WHERE r.sub_event_id = p_sub_event_id;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'sub_event_id', a.sub_event_id,
            'team_id', a.team_id,
            'scanned_member_id', a.scanned_member_id,
            'check_in_time', a.check_in_time,
            'checked_in_at', a.check_in_time,
            'checked_in_by', a.checked_in_by
        )
    ), '[]'::jsonb)
    INTO v_attendance
    FROM public.attendance_records a
    WHERE a.sub_event_id = p_sub_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'registrations', v_registrations,
        'attendance', v_attendance
    );
END;
$function$;

-- 4. Legacy Coordinator Roster RPC (UUID-based)
CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_roster(p_sub_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
    v_registrations JSONB;
    v_attendance JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'sub_event_id', r.sub_event_id,
            'leader_id', r.leader_id,
            'status', r.status,
            'created_at', r.created_at
        ) ORDER BY r.created_at ASC
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    WHERE r.sub_event_id = p_sub_event_id;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'sub_event_id', a.sub_event_id,
            'team_id', a.team_id,
            'scanned_member_id', a.scanned_member_id,
            'check_in_time', a.check_in_time,
            'checked_in_at', a.check_in_time,
            'checked_in_by', a.checked_in_by
        )
    ), '[]'::jsonb)
    INTO v_attendance
    FROM public.attendance_records a
    WHERE a.sub_event_id = p_sub_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'registrations', v_registrations,
        'attendance', v_attendance
    );
END;
$function$;

-- Grants
GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sub_event_documents_for_coordinator(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_sub_event_roster(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(uuid) TO authenticated, service_role;
