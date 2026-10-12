-- 104_fix_coordinator_roster_payments_join.sql
-- Production Hotfix:
-- Restores missing "LEFT JOIN pre_payments pp ON pp.registration_id = r.id" in public.get_coordinator_sub_event_roster.
-- Preserves authoritative status precedence (from migration 103), coordinator authorization,
-- sub-event scoping, and all JSON payload structures for registrations and pending offline payments.

CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_roster(
    p_token TEXT,
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
    v_sub_event RECORD;
BEGIN
    SELECT public.get_coordinator_id_by_token(p_token) INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Coordinator authorization required: Invalid or expired session token.'
        );
    END IF;

    -- Fetch sub-event & parent event details including authoritative effective status
    SELECT 
        se.id,
        se.name,
        se.participation_type,
        se.fee_amount_solo,
        se.fee_amount_team,
        se.is_free,
        public.effective_status(se) AS effective_status,
        COALESCE(c.name, 'General') AS category_name,
        e.name AS event_name,
        public.effective_status(e) AS event_effective_status
    INTO v_sub_event
    FROM public.sub_events se
    LEFT JOIN public.categories c ON c.id = se.category_id
    JOIN public.events e ON e.id = COALESCE(se.event_id, c.event_id)
    WHERE se.id = p_sub_event_id;

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
               ), '[]'::jsonb) AS payments_json,
               jsonb_build_object(
                   'id', (array_agg(p.id ORDER BY p.created_at DESC))[1],
                   'status', (array_agg(p.status ORDER BY p.created_at DESC))[1],
                   'amount', (array_agg(p.amount ORDER BY p.created_at DESC))[1],
                   'payment_method', (array_agg(p.payment_method ORDER BY p.created_at DESC))[1],
                   'reference_id', (array_agg(p.reference_id ORDER BY p.created_at DESC))[1],
                   'created_at', (array_agg(p.created_at ORDER BY p.created_at DESC))[1]
               ) AS primary_payment_json
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
            'payments', COALESCE(pp.payments_json, '[]'::jsonb),
            'payment', pp.primary_payment_json,
            'sub_event', jsonb_build_object(
                'id', v_sub_event.id,
                'name', v_sub_event.name,
                'participation_type', v_sub_event.participation_type,
                'category_name', v_sub_event.category_name,
                'event_name', v_sub_event.event_name,
                'effective_status', v_sub_event.effective_status,
                'event_effective_status', v_sub_event.event_effective_status
            )
        ) ORDER BY r.created_at ASC
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    LEFT JOIN pre_payments pp ON pp.registration_id = r.id
    LEFT JOIN pre_teams pt ON pt.registration_id = r.id
    LEFT JOIN public.student_profiles sp_lead ON sp_lead.user_id = r.leader_id
    WHERE r.sub_event_id = p_sub_event_id;

    -- CTE for attendance records (matching physical schema of public.attendance_records)
    WITH pre_att AS (
        SELECT ar.id,
               ar.sub_event_id,
               ar.team_id,
               t.registration_id,
               ar.scanned_member_id,
               ar.check_in_time,
               'VERIFIED'::text AS verification_method,
               NULL::text AS notes
        FROM public.attendance_records ar
        LEFT JOIN public.teams t ON t.id = ar.team_id
        WHERE ar.sub_event_id = p_sub_event_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', pa.id,
            'sub_event_id', pa.sub_event_id,
            'team_id', pa.team_id,
            'registration_id', pa.registration_id,
            'scanned_member_id', pa.scanned_member_id,
            'check_in_time', pa.check_in_time,
            'checked_in_at', pa.check_in_time,
            'verification_method', pa.verification_method,
            'notes', pa.notes
        ) ORDER BY pa.check_in_time DESC
    ), '[]'::jsonb)
    INTO v_attendance
    FROM pre_att pa;

    RETURN jsonb_build_object(
        'success', true,
        'sub_event', jsonb_build_object(
            'id', v_sub_event.id,
            'name', v_sub_event.name,
            'participation_type', v_sub_event.participation_type,
            'fee_amount_solo', v_sub_event.fee_amount_solo,
            'fee_amount_team', v_sub_event.fee_amount_team,
            'is_free', v_sub_event.is_free,
            'category_name', v_sub_event.category_name,
            'event_name', v_sub_event.event_name,
            'effective_status', v_sub_event.effective_status,
            'event_effective_status', v_sub_event.event_effective_status
        ),
        'registrations', v_registrations,
        'attendance', v_attendance,
        'attendance_records', v_attendance
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(TEXT, UUID) TO anon, authenticated, service_role;
