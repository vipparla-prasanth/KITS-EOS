-- ============================================================================
-- Migration 056: Fix Production Schema Mismatches and Audit Log Indexing
-- 
-- 1. Drops incorrect partial unique index audit_logs_admin_login_email_idx 
--    that caused HTTP 409 / SQLSTATE 23505 duplicate key violations during 
--    repeated admin login sessions.
-- 2. Creates standard non-unique B-tree index idx_audit_logs_admin_login_session 
--    for fast lookup without restricting legitimate repeated logins.
-- 3. Corrects public.get_coordinator_sub_event_roster RPC to reference 
--    canonical public.student_profiles.college instead of non-existent college_name.
-- ============================================================================

-- 1. Audit Log Index Correction
DROP INDEX IF EXISTS public.audit_logs_admin_login_email_idx;

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_login_session 
ON public.audit_logs (action, (metadata->>'session_id')) 
WHERE action = 'ADMIN_LOGIN_SECURITY_EMAIL';

-- 2. Correct get_coordinator_sub_event_roster RPC
CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_roster(
    p_sub_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN;
    v_registrations JSONB;
    v_attendance JSONB;
BEGIN
    -- Derive caller identity from JWT auth.uid()
    v_coord_id := auth.uid();
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Strict server-side assignment check
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.sub_events se ON se.id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord_id
          AND ca.sub_event_id = p_sub_event_id
          AND se.status = 'ACTIVE'::public.event_status
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RAISE EXCEPTION 'You are not assigned to this sub-event';
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
                       'created_at', p.created_at
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
                           'user_id', sp.user_id,
                           'full_name', sp.full_name,
                           'roll_number', sp.roll_number,
                           'college', sp.college,
                           'department', sp.department,
                           'year_of_study', sp.year_of_study,
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
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'sub_event_id', r.sub_event_id,
            'leader_id', r.leader_id,
            'status', r.status,
            'created_at', r.created_at,
            'teams', CASE WHEN t.id IS NOT NULL THEN jsonb_build_object(
                'id', t.id,
                'name', t.team_name,
                'leader_id', r.leader_id,
                'team_members', COALESCE(pm.members_json, '[]'::jsonb)
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
            'payments', COALESCE(pp.payments_json, '[]'::jsonb)
        ) ORDER BY r.created_at ASC
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    LEFT JOIN public.teams t ON t.registration_id = r.id
    LEFT JOIN public.student_profiles sp_lead ON sp_lead.user_id = r.leader_id
    LEFT JOIN pre_members pm ON pm.team_id = t.id
    LEFT JOIN pre_payments pp ON pp.registration_id = r.id
    WHERE r.sub_event_id = p_sub_event_id;

    -- Fetch Authoritative Attendance Records
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'sub_event_id', a.sub_event_id,
            'team_id', a.team_id,
            'scanned_member_id', a.scanned_member_id,
            'checked_in_at', a.check_in_time,
            'checked_in_by', a.checked_in_by
        ) ORDER BY a.check_in_time DESC
    ), '[]'::jsonb)
    INTO v_attendance
    FROM public.attendance_records a
    WHERE a.sub_event_id = p_sub_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'registrations', COALESCE(v_registrations, '[]'::jsonb),
        'attendance', COALESCE(v_attendance, '[]'::jsonb)
    );
END;
$$;

-- Secure Permissions on Coordinator Roster RPC
REVOKE ALL ON FUNCTION public.get_coordinator_sub_event_roster(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(UUID) TO authenticated;
