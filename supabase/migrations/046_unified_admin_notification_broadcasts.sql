-- Migration 046: Unified Admin Notification Broadcasts
-- 1. Adds broadcast_id column and index to public.notifications
-- 2. Backfills historical broadcast_ids safely (never merging unrelated records)
-- 3. Updates admin_send_broadcast_notification to assign a unique broadcast_id per dispatch
-- 4. Introduces admin_get_broadcast_notifications RPC for unified broadcast retrieval
-- 5. Updates admin_delete_notifications RPC to support atomic broadcast deletion

-- 1. Schema Additions: broadcast_id
ALTER TABLE public.notifications 
ADD COLUMN IF NOT EXISTS broadcast_id UUID;

CREATE INDEX IF NOT EXISTS idx_notifications_broadcast_id ON public.notifications(broadcast_id);

-- 2. Backfill existing records:
-- For the existing test broadcast created at '2026-09-05 07:23:02.278672+00', link to its audit log ID:
UPDATE public.notifications
SET broadcast_id = '0bd5e734-da30-43b6-b113-0960fa145b73'
WHERE broadcast_id IS NULL AND created_at = '2026-09-05 07:23:02.278672+00';

-- For any other legacy rows where broadcast_id IS NULL, assign id so they remain independent broadcasts:
UPDATE public.notifications
SET broadcast_id = id
WHERE broadcast_id IS NULL;

-- 3. Atomic Broadcast Dispatch RPC with shared broadcast_id
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
    v_broadcast_id UUID;
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

    -- 3. Generate unique broadcast campaign ID
    v_broadcast_id := gen_random_uuid();

    -- 4. Insert student notifications
    IF v_clean_audience IN ('ALL', 'STUDENT') THEN
        WITH inserted_students AS (
            INSERT INTO public.notifications (
                broadcast_id,
                user_id,
                coordinator_id,
                recipient_role,
                audience,
                title,
                message,
                is_read,
                created_at
            )
            SELECT 
                v_broadcast_id AS broadcast_id,
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

    -- 5. Insert coordinator notifications (only for coordinators actively assigned to active sub-events)
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
            INSERT INTO public.notifications (
                broadcast_id,
                user_id,
                coordinator_id,
                recipient_role,
                audience,
                title,
                message,
                is_read,
                created_at
            )
            SELECT 
                v_broadcast_id AS broadcast_id,
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

    -- 6. Insert immutable audit log
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
        v_broadcast_id,
        jsonb_build_object(
            'broadcast_id', v_broadcast_id,
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
        'broadcast_id', v_broadcast_id,
        'title', v_clean_title,
        'audience', v_clean_audience,
        'students_count', v_student_count,
        'coordinators_count', v_coord_count,
        'total_count', v_total_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_send_broadcast_notification(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_broadcast_notification(TEXT, TEXT, TEXT) TO authenticated;

-- 4. Authoritative Unified Admin Broadcast Query RPC
CREATE OR REPLACE FUNCTION public.admin_get_broadcast_notifications()
RETURNS TABLE (
    broadcast_id UUID,
    title VARCHAR,
    message TEXT,
    audience VARCHAR,
    created_at TIMESTAMPTZ,
    student_deliveries BIGINT,
    coordinator_deliveries BIGINT,
    total_deliveries BIGINT,
    read_count BIGINT,
    unread_count BIGINT,
    delivery_ids UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Administrative privileges required.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT 
        COALESCE(n.broadcast_id, n.id) AS broadcast_id,
        n.title,
        n.message,
        COALESCE(n.audience, 'ALL') AS audience,
        MAX(n.created_at) AS created_at,
        COUNT(*) FILTER (WHERE n.recipient_role = 'STUDENT') AS student_deliveries,
        COUNT(*) FILTER (WHERE n.recipient_role = 'COORDINATOR') AS coordinator_deliveries,
        COUNT(*) AS total_deliveries,
        COUNT(*) FILTER (WHERE n.is_read = TRUE) AS read_count,
        COUNT(*) FILTER (WHERE n.is_read = FALSE) AS unread_count,
        array_agg(n.id) AS delivery_ids
    FROM public.notifications n
    GROUP BY 
        COALESCE(n.broadcast_id, n.id),
        n.title,
        n.message,
        COALESCE(n.audience, 'ALL')
    ORDER BY MAX(n.created_at) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_broadcast_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_broadcast_notifications() TO authenticated;

-- 5. Updated Admin Delete Broadcast Notifications RPC (handles broadcast_id OR delivery ids)
CREATE OR REPLACE FUNCTION public.admin_delete_notifications(
    p_notification_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_email TEXT;
    v_is_admin BOOLEAN := false;
    v_clean_ids UUID[];
    v_non_broadcast_count INT := 0;
    v_deleted_count INT := 0;
    v_deleted_ids UUID[];
BEGIN
    -- 1. Strictly require authenticated caller
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Authoritative Admin authorization check
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = v_actor_id
          AND role = 'ADMIN'
          AND status = 'ACTIVE'
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Access denied: administrative privileges required'
            USING ERRCODE = '42501';
    END IF;

    -- 3. Validate input array
    IF p_notification_ids IS NULL OR array_length(p_notification_ids, 1) IS NULL OR array_length(p_notification_ids, 1) = 0 THEN
        RAISE EXCEPTION 'Invalid input: No notification IDs provided for deletion.'
            USING ERRCODE = '22023';
    END IF;

    -- 4. Normalize distinct non-null UUIDs
    SELECT array_agg(DISTINCT id) INTO v_clean_ids
    FROM unnest(p_notification_ids) AS id
    WHERE id IS NOT NULL;

    IF v_clean_ids IS NULL OR array_length(v_clean_ids, 1) IS NULL OR array_length(v_clean_ids, 1) = 0 THEN
        RAISE EXCEPTION 'Invalid input: No valid notification UUIDs provided.'
            USING ERRCODE = '22023';
    END IF;

    -- 5. Safety check: ensure no non-broadcast records are targeted
    SELECT COUNT(*) INTO v_non_broadcast_count
    FROM public.notifications
    WHERE (id = ANY(v_clean_ids) OR broadcast_id = ANY(v_clean_ids))
      AND (audience IS NULL OR audience NOT IN ('ALL', 'STUDENT', 'COORDINATOR'));

    IF v_non_broadcast_count > 0 THEN
        RAISE EXCEPTION 'Invalid operation: One or more selected records are not broadcast notifications. Deletion aborted.'
            USING ERRCODE = '22023';
    END IF;

    -- 6. Atomic deletion of broadcast records by id OR broadcast_id
    WITH deleted_rows AS (
        DELETE FROM public.notifications
        WHERE (id = ANY(v_clean_ids) OR broadcast_id = ANY(v_clean_ids))
          AND audience IS NOT NULL
          AND audience IN ('ALL', 'STUDENT', 'COORDINATOR')
        RETURNING id
    )
    SELECT COUNT(*), array_agg(id)
    INTO v_deleted_count, v_deleted_ids;

    IF v_deleted_count = 0 THEN
        RAISE EXCEPTION 'Invalid operation: No matching broadcast records found for deletion.'
            USING ERRCODE = '22023';
    END IF;

    -- 7. Audit log in same transaction
    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_actor_id,
        'ADMIN_DELETED_BROADCASTS',
        'NOTIFICATION',
        v_actor_id,
        jsonb_build_object(
            'deleted_deliveries_count', v_deleted_count,
            'requested_ids', v_clean_ids,
            'deleted_ids', v_deleted_ids,
            'deleted_by', COALESCE(v_actor_email, v_actor_id::text),
            'deleted_at', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', format('%s broadcast delivery record(s) permanently deleted.', v_deleted_count),
        'deleted_count', v_deleted_count,
        'deleted_ids', v_deleted_ids
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_notifications(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_notifications(UUID[]) TO authenticated;
