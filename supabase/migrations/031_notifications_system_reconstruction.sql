-- Migration 031: Notifications System Reconstruction
-- Institutional Broadcast Notifications for Students & Coordinators

-- 1. Schema Additions to public.notifications
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'coordinator_id'
    ) THEN
        ALTER TABLE public.notifications 
        ADD COLUMN coordinator_id UUID REFERENCES public.coordinators(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'recipient_role'
    ) THEN
        ALTER TABLE public.notifications 
        ADD COLUMN recipient_role VARCHAR(50) DEFAULT 'STUDENT';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'audience'
    ) THEN
        ALTER TABLE public.notifications 
        ADD COLUMN audience VARCHAR(50) DEFAULT 'ALL';
    END IF;
END $$;

-- 2. Indices for Fast Lookups
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_coordinator_id ON public.notifications(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);

-- 3. Live Recipient Counts Calculation RPC
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

    SELECT COUNT(*) INTO v_students_count 
    FROM public.users 
    WHERE role = 'STUDENT' AND status = 'ACTIVE';

    SELECT COUNT(*) INTO v_coordinators_count 
    FROM public.coordinators 
    WHERE status = 'ACTIVE';

    RETURN jsonb_build_object(
        'students_count', v_students_count,
        'coordinators_count', v_coordinators_count,
        'total_count', (v_students_count + v_coordinators_count)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_notification_recipient_counts() TO authenticated;

-- 4. Atomic Broadcast Dispatch RPC
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

    -- 4. Insert coordinator notifications
    IF v_clean_audience IN ('ALL', 'COORDINATOR') THEN
        WITH inserted_coords AS (
            INSERT INTO public.notifications (user_id, coordinator_id, recipient_role, audience, title, message, is_read, created_at)
            SELECT 
                NULL AS user_id,
                c.id AS coordinator_id,
                'COORDINATOR' AS recipient_role,
                v_clean_audience AS audience,
                v_clean_title AS title,
                v_clean_message AS message,
                FALSE AS is_read,
                NOW() AS created_at
            FROM public.coordinators c
            WHERE c.status = 'ACTIVE'
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

-- 5. Coordinator Notification Management RPCs
CREATE OR REPLACE FUNCTION public.get_coordinator_notifications(p_coordinator_id UUID)
RETURNS SETOF public.notifications
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT *
    FROM public.notifications
    WHERE coordinator_id = p_coordinator_id
    ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_notifications(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_coordinator_notification_read(p_notification_id UUID, p_coordinator_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    UPDATE public.notifications
    SET is_read = TRUE
    WHERE id = p_notification_id AND coordinator_id = p_coordinator_id;
    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_coordinator_notification_read(UUID, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_all_coordinator_notifications_read(p_coordinator_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_updated_count INT := 0;
BEGIN
    UPDATE public.notifications
    SET is_read = TRUE
    WHERE coordinator_id = p_coordinator_id AND is_read = FALSE;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_coordinator_notifications_read(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_coordinator_unread_count(p_coordinator_id UUID)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT COUNT(*)::INT
    FROM public.notifications
    WHERE coordinator_id = p_coordinator_id AND is_read = FALSE;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_unread_count(UUID) TO anon, authenticated;
