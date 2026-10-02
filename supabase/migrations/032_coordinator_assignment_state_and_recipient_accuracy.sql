-- Migration 032: Coordinator Assignment State Detection & Dispatch Recipient Accuracy

-- 1. RPC to detect exact Coordinator Assignment State (ACTIVE_ASSIGNMENTS vs SUB_EVENT_DELETED vs NO_ASSIGNMENT)
CREATE OR REPLACE FUNCTION public.get_coordinator_assignment_state(p_coordinator_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord RECORD;
    v_active_count INT := 0;
    v_had_prior_assignment BOOLEAN := FALSE;
    v_state TEXT;
BEGIN
    SELECT * INTO v_coord FROM public.coordinators WHERE id = p_coordinator_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Coordinator not found', 'state', 'INVALID_COORDINATOR');
    END IF;

    IF v_coord.status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Coordinator account is inactive', 'state', 'INACTIVE_COORDINATOR');
    END IF;

    -- Check currently active assigned sub-events
    SELECT COUNT(DISTINCT ca.id) INTO v_active_count
    FROM public.coordinator_assignments ca
    JOIN public.sub_events se ON se.id = ca.sub_event_id
    LEFT JOIN public.events e ON e.id = se.event_id
    LEFT JOIN public.categories cat ON cat.id = se.category_id
    LEFT JOIN public.events ce ON ce.id = cat.event_id
    WHERE ca.coordinator_id = p_coordinator_id
      AND se.status = 'ACTIVE'
      AND (e.status = 'ACTIVE' OR ce.status = 'ACTIVE');

    IF v_active_count > 0 THEN
        v_state := 'ACTIVE_ASSIGNMENTS';
    ELSE
        -- Check if had prior assignment or activity in audit_logs
        SELECT EXISTS (
            SELECT 1 FROM public.audit_logs
            WHERE (actor_id = p_coordinator_id OR entity_id = p_coordinator_id)
              AND (
                  (action = 'COORDINATOR_LOGIN' AND (metadata->>'assignments_count')::int > 0)
                  OR action = 'ATTENDANCE_CHECKIN_CONFIRMED'
                  OR action = 'COORDINATOR_ASSIGNED'
              )
        ) INTO v_had_prior_assignment;

        IF v_had_prior_assignment THEN
            v_state := 'SUB_EVENT_DELETED';
        ELSE
            v_state := 'NO_ASSIGNMENT';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'coordinator_id', p_coordinator_id,
        'display_name', v_coord.display_name,
        'active_assignments_count', v_active_count,
        'state', v_state
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_assignment_state(UUID) TO anon, authenticated;

-- 2. Accurate Recipient Counts Calculation RPC
CREATE OR REPLACE FUNCTION public.admin_get_notification_recipient_counts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_students_count INT := 0;
    v_coordinators_count INT := 0;
BEGIN
    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Administrative privileges required.';
    END IF;

    -- Count active students
    SELECT COUNT(DISTINCT u.id) INTO v_students_count 
    FROM public.users u
    WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE';

    -- Count active coordinators who are assigned to currently active sub-events and events
    SELECT COUNT(DISTINCT c.id) INTO v_coordinators_count 
    FROM public.coordinators c
    JOIN public.coordinator_assignments ca ON ca.coordinator_id = c.id
    JOIN public.sub_events se ON se.id = ca.sub_event_id
    LEFT JOIN public.events e ON e.id = se.event_id
    LEFT JOIN public.categories cat ON cat.id = se.category_id
    LEFT JOIN public.events ce ON ce.id = cat.event_id
    WHERE c.status = 'ACTIVE'
      AND se.status = 'ACTIVE'
      AND (e.status = 'ACTIVE' OR ce.status = 'ACTIVE');

    RETURN jsonb_build_object(
        'students_count', v_students_count,
        'coordinators_count', v_coordinators_count,
        'total_count', (v_students_count + v_coordinators_count)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_notification_recipient_counts() TO authenticated;

-- 3. Accurate Atomic Broadcast Dispatch RPC
CREATE OR REPLACE FUNCTION public.admin_send_broadcast_notification(
    p_title TEXT,
    p_message TEXT,
    p_audience TEXT DEFAULT 'ALL'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_email TEXT;
    v_clean_title TEXT;
    v_clean_message TEXT;
    v_clean_audience TEXT;
    v_student_count INT := 0;
    v_coord_count INT := 0;
    v_total_count INT := 0;
BEGIN
    -- 1. Authorization check
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Administrative privileges required to dispatch notifications.';
    END IF;

    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

    -- 2. Validation
    v_clean_title := TRIM(p_title);
    v_clean_message := TRIM(p_message);
    v_clean_audience := UPPER(TRIM(p_audience));

    IF v_clean_title = '' THEN
        RAISE EXCEPTION 'Notification title is required.';
    END IF;

    IF v_clean_message = '' THEN
        RAISE EXCEPTION 'Notification message is required.';
    END IF;

    IF v_clean_audience NOT IN ('ALL', 'STUDENT', 'COORDINATOR') THEN
        RAISE EXCEPTION 'Invalid audience: %. Must be ALL, STUDENT, or COORDINATOR.', p_audience;
    END IF;

    -- 3. Insert student notifications
    IF v_clean_audience IN ('ALL', 'STUDENT') THEN
        WITH inserted_students AS (
            INSERT INTO public.notifications (user_id, coordinator_id, recipient_role, audience, title, message, is_read, created_at)
            SELECT 
                u.id AS user_id,
                NULL AS coordinator_id,
                'STUDENT' AS recipient_role,
                v_clean_audience AS audience,
                v_clean_title AS title,
                v_clean_message AS message,
                FALSE AS is_read,
                NOW() AS created_at
            FROM public.users u
            WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE'
            RETURNING id
        )
        SELECT COUNT(*) INTO v_student_count FROM inserted_students;
    END IF;

    -- 4. Insert coordinator notifications (only for coordinators actively assigned to active sub-events)
    IF v_clean_audience IN ('ALL', 'COORDINATOR') THEN
        WITH target_coords AS (
            SELECT DISTINCT c.id
            FROM public.coordinators c
            JOIN public.coordinator_assignments ca ON ca.coordinator_id = c.id
            JOIN public.sub_events se ON se.id = ca.sub_event_id
            LEFT JOIN public.events e ON e.id = se.event_id
            LEFT JOIN public.categories cat ON cat.id = se.category_id
            LEFT JOIN public.events ce ON ce.id = cat.event_id
            WHERE c.status = 'ACTIVE'
              AND se.status = 'ACTIVE'
              AND (e.status = 'ACTIVE' OR ce.status = 'ACTIVE')
        ),
        inserted_coords AS (
            INSERT INTO public.notifications (user_id, coordinator_id, recipient_role, audience, title, message, is_read, created_at)
            SELECT 
                NULL AS user_id,
                tc.id AS coordinator_id,
                'COORDINATOR' AS recipient_role,
                v_clean_audience AS audience,
                v_clean_title AS title,
                v_clean_message AS message,
                FALSE AS is_read,
                NOW() AS created_at
            FROM target_coords tc
            RETURNING id
        )
        SELECT COUNT(*) INTO v_coord_count FROM inserted_coords;
    END IF;

    v_total_count := v_student_count + v_coord_count;

    -- 5. Insert immutable audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_actor_id,
        'BROADCAST_NOTIFICATION_SENT',
        'NOTIFICATION',
        v_actor_id,
        jsonb_build_object(
            'title', v_clean_title,
            'audience', v_clean_audience,
            'students_reached', v_student_count,
            'coordinators_reached', v_coord_count,
            'total_reached', v_total_count,
            'dispatched_by', COALESCE(v_actor_email, v_actor_id::text),
            'dispatched_at', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Notification successfully broadcasted.',
        'title', v_clean_title,
        'audience', v_clean_audience,
        'students_count', v_student_count,
        'coordinators_count', v_coord_count,
        'total_count', v_total_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_send_broadcast_notification(TEXT, TEXT, TEXT) TO authenticated;
