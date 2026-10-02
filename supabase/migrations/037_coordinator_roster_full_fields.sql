-- 037_coordinator_roster_full_fields.sql
-- Enhanced get_coordinator_sub_event_roster to supply full participant, contact, payment, and document fields strictly for assigned coordinators

CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_roster(
    p_coordinator_id UUID,
    p_sub_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_authorized BOOLEAN := false;
    v_registrations JSONB;
    v_attendance JSONB;
    v_sub_event RECORD;
BEGIN
    -- Check if coordinator is assigned or if the caller is an admin
    IF is_admin() THEN
        v_is_authorized := true;
    ELSIF p_coordinator_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.coordinator_assignments ca
            JOIN public.coordinators c ON c.id = ca.coordinator_id
            WHERE ca.coordinator_id = p_coordinator_id 
              AND ca.sub_event_id = p_sub_event_id 
              AND c.status = 'ACTIVE'
        ) INTO v_is_authorized;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: You do not have active assignment to operate on this sub-event.'
        );
    END IF;

    -- Fetch sub-event metadata including category and event names
    SELECT 
        se.id, 
        se.name, 
        se.participation_type, 
        se.results_locked, 
        se.results_published,
        COALESCE(cat.name, 'General') AS category_name,
        COALESCE(e.name, ce.name, 'Flagship Event') AS event_name
    INTO v_sub_event
    FROM public.sub_events se
    LEFT JOIN public.categories cat ON cat.id = se.category_id
    LEFT JOIN public.events ce ON ce.id = cat.event_id
    LEFT JOIN public.events e ON e.id = se.event_id
    WHERE se.id = p_sub_event_id;

    -- Fetch registrations (CONFIRMED and PENDING_PAYMENT, excluding CANCELLED) with complete fields
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'sub_event_id', r.sub_event_id,
            'status', r.status,
            'created_at', r.created_at,
            'event_name', v_sub_event.event_name,
            'category_name', v_sub_event.category_name,
            'sub_event_name', v_sub_event.name,
            'participation_type', v_sub_event.participation_type,
            'document_count', (
                SELECT COUNT(*) FROM public.documents d WHERE d.entity_id = r.id
            ),
            'payment', (
                SELECT jsonb_build_object(
                    'id', p.id,
                    'amount', p.amount,
                    'payment_method', p.payment_method,
                    'status', p.status,
                    'reference_id', p.reference_id,
                    'created_at', p.created_at
                )
                FROM public.payments p
                WHERE p.registration_id = r.id
                ORDER BY p.created_at DESC
                LIMIT 1
            ),
            'teams', (
                SELECT jsonb_build_object(
                    'id', t.id,
                    'team_name', t.team_name,
                    'team_members', (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'id', tm.id,
                                'team_id', tm.team_id,
                                'user_id', tm.user_id,
                                'snapshot_name', tm.snapshot_name,
                                'snapshot_roll_number', tm.snapshot_roll_number,
                                'snapshot_college', tm.snapshot_college,
                                'snapshot_department', tm.snapshot_department,
                                'snapshot_year', tm.snapshot_year,
                                'is_leader', tm.is_leader,
                                'manual_token', tm.manual_token,
                                'qr_identity', tm.qr_identity,
                                'email', u.email,
                                'phone', sp.phone,
                                'is_attended', EXISTS (
                                    SELECT 1 FROM public.attendance_records ar
                                    WHERE ar.sub_event_id = p_sub_event_id AND ar.scanned_member_id = tm.id
                                ),
                                'attendance_record', (
                                    SELECT jsonb_build_object(
                                        'id', ar.id,
                                        'check_in_time', ar.check_in_time,
                                        'checked_in_by', ar.checked_in_by
                                    )
                                    FROM public.attendance_records ar
                                    WHERE ar.sub_event_id = p_sub_event_id AND ar.scanned_member_id = tm.id
                                    LIMIT 1
                                )
                            ) ORDER BY tm.is_leader DESC, tm.snapshot_name ASC
                        )
                        FROM public.team_members tm
                        LEFT JOIN public.users u ON u.id = tm.user_id
                        LEFT JOIN public.student_profiles sp ON sp.user_id = tm.user_id
                        WHERE tm.team_id = t.id
                    )
                )
                FROM public.teams t
                WHERE t.registration_id = r.id
                LIMIT 1
            )
        ) ORDER BY r.created_at ASC
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    WHERE r.sub_event_id = p_sub_event_id
      AND r.status != 'CANCELLED';

    -- Fetch attendance records
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ar.id,
            'team_id', ar.team_id,
            'sub_event_id', ar.sub_event_id,
            'scanned_member_id', ar.scanned_member_id,
            'check_in_time', ar.check_in_time,
            'checked_in_by', ar.checked_in_by
        )
    ), '[]'::jsonb)
    INTO v_attendance
    FROM public.attendance_records ar
    WHERE ar.sub_event_id = p_sub_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'sub_event', jsonb_build_object(
            'id', v_sub_event.id,
            'name', v_sub_event.name,
            'participation_type', v_sub_event.participation_type,
            'category_name', v_sub_event.category_name,
            'event_name', v_sub_event.event_name,
            'results_locked', v_sub_event.results_locked,
            'results_published', v_sub_event.results_published
        ),
        'registrations', v_registrations,
        'attendance_records', v_attendance
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(UUID, UUID) TO anon, authenticated;
