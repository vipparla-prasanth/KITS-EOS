-- Migration 033: Coordinator Portal Direct Assignment & Sub-Event Roster Retrieval RPCs

-- 1. Dedicated secure RPC to retrieve all active assigned sub-events for a specific coordinator
CREATE OR REPLACE FUNCTION public.get_coordinator_assigned_sub_events(p_coordinator_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord RECORD;
    v_assignments JSONB;
BEGIN
    SELECT * INTO v_coord FROM public.coordinators WHERE id = p_coordinator_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Coordinator not found', 'assignments', '[]'::jsonb);
    END IF;

    IF v_coord.status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Coordinator account is inactive', 'assignments', '[]'::jsonb);
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ca.id,
            'coordinator_id', ca.coordinator_id,
            'sub_event_id', ca.sub_event_id,
            'sub_events', jsonb_build_object(
                'id', se.id,
                'name', se.name,
                'description', se.description,
                'rules', se.rules,
                'banner_path', se.banner_path,
                'start_time', se.start_time,
                'end_time', se.end_time,
                'venue', se.venue,
                'participation_type', se.participation_type,
                'max_team_size', se.max_team_size,
                'fee_amount_solo', se.fee_amount_solo,
                'fee_amount_team', se.fee_amount_team,
                'results_locked', se.results_locked,
                'status', se.status,
                'category_id', se.category_id,
                'event_id', se.event_id,
                'categories', CASE WHEN cat.id IS NOT NULL THEN jsonb_build_object(
                    'id', cat.id,
                    'name', cat.name,
                    'status', cat.status,
                    'event_id', cat.event_id,
                    'events', CASE WHEN ce.id IS NOT NULL THEN jsonb_build_object(
                        'id', ce.id,
                        'name', ce.name,
                        'status', ce.status
                    ) ELSE NULL END
                ) ELSE NULL END,
                'events', CASE WHEN e.id IS NOT NULL THEN jsonb_build_object(
                    'id', e.id,
                    'name', e.name,
                    'status', e.status
                ) ELSE NULL END
            )
        ) ORDER BY se.name ASC
    ), '[]'::jsonb)
    INTO v_assignments
    FROM public.coordinator_assignments ca
    JOIN public.sub_events se ON se.id = ca.sub_event_id
    LEFT JOIN public.categories cat ON cat.id = se.category_id
    LEFT JOIN public.events ce ON ce.id = cat.event_id
    LEFT JOIN public.events e ON e.id = se.event_id
    WHERE ca.coordinator_id = p_coordinator_id
      AND se.status = 'ACTIVE'
      AND (
          (e.id IS NOT NULL AND e.status = 'ACTIVE')
          OR
          (ce.id IS NOT NULL AND ce.status = 'ACTIVE')
      );

    RETURN jsonb_build_object(
        'success', true,
        'coordinator_id', p_coordinator_id,
        'display_name', v_coord.display_name,
        'assignments', v_assignments
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_assigned_sub_events(UUID) TO anon, authenticated;

-- 2. Dedicated secure RPC to retrieve sub-event participant roster and attendance strictly for assigned coordinators
CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_roster(p_coordinator_id UUID, p_sub_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_is_assigned BOOLEAN;
    v_registrations JSONB;
    v_attendance JSONB;
BEGIN
    -- Verify assignment
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.coordinators c ON c.id = ca.coordinator_id
        WHERE ca.coordinator_id = p_coordinator_id
          AND ca.sub_event_id = p_sub_event_id
          AND c.status = 'ACTIVE'
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: You are not assigned to this sub-event.',
            'registrations', '[]'::jsonb,
            'attendance_records', '[]'::jsonb
        );
    END IF;

    -- Fetch Confirmed Registrations with Teams and Members
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'sub_event_id', r.sub_event_id,
            'status', r.status,
            'created_at', r.created_at,
            'teams', jsonb_build_object(
                'id', t.id,
                'team_name', t.team_name,
                'team_members', (
                    SELECT COALESCE(jsonb_agg(
                        jsonb_build_object(
                            'id', tm.id,
                            'snapshot_name', tm.snapshot_name,
                            'snapshot_roll_number', tm.snapshot_roll_number,
                            'snapshot_college', tm.snapshot_college,
                            'snapshot_department', tm.snapshot_department,
                            'snapshot_year', tm.snapshot_year,
                            'is_leader', tm.is_leader,
                            'manual_token', tm.manual_token
                        ) ORDER BY tm.is_leader DESC, tm.snapshot_name ASC
                    ), '[]'::jsonb)
                    FROM public.team_members tm
                    WHERE tm.team_id = t.id
                )
            )
        )
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    JOIN public.teams t ON t.registration_id = r.id
    WHERE r.sub_event_id = p_sub_event_id
      AND r.status = 'CONFIRMED';

    -- Fetch Attendance Records
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ar.id,
            'sub_event_id', ar.sub_event_id,
            'team_id', ar.team_id,
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
        'registrations', v_registrations,
        'attendance_records', v_attendance
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(UUID, UUID) TO anon, authenticated;
