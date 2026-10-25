-- ==============================================================================
-- Migration 135: Automatic Notification Session Cleanup & Read-On-Open Security
-- ==============================================================================
-- 1. Authoritative Session Cleanup RPC:
--    public.clear_user_session_notifications(p_token TEXT DEFAULT NULL)
--    - Deletes all notifications for the authenticated user (auth.uid())
--    - For coordinators, validates p_token via get_coordinator_id_by_token()
--    - Strictly isolated to caller's identity; prevents cross-user deletion
--    - Safe, idempotent, and non-blocking
--
-- 2. Explicit User Delete RLS Policy & Grant:
--    - Grants DELETE on public.notifications to authenticated role
--    - Scoped strictly to USING (auth.uid() = user_id)
--
-- 3. Scheduled / Orphaned Expired Session Notifications Cleanup Function:
--    public.cleanup_expired_session_notifications(p_older_than_interval INTERVAL)
--    - Safe backend maintenance function for purging expired or stale notifications
--    - Does not delete registrations, payments, complaints, or results
-- ==============================================================================

-- 1. RPC: clear_user_session_notifications
CREATE OR REPLACE FUNCTION public.clear_user_session_notifications(
    p_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_coord_id UUID;
    v_deleted_count INT := 0;
BEGIN
    -- 1. Supabase Auth identity (Student / Admin)
    v_user_id := auth.uid();

    IF v_user_id IS NOT NULL THEN
        DELETE FROM public.notifications
        WHERE user_id = v_user_id;

        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

        RETURN jsonb_build_object(
            'success', true,
            'deleted_count', v_deleted_count,
            'identity', 'USER',
            'user_id', v_user_id
        );
    END IF;

    -- 2. Coordinator custom session token identity
    IF p_token IS NOT NULL AND trim(p_token) <> '' THEN
        v_coord_id := public.get_coordinator_id_by_token(regexp_replace(trim(p_token), '^Bearer\s+', '', 'i'));
        IF v_coord_id IS NOT NULL THEN
            DELETE FROM public.notifications
            WHERE coordinator_id = v_coord_id;

            GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

            RETURN jsonb_build_object(
                'success', true,
                'deleted_count', v_deleted_count,
                'identity', 'COORDINATOR',
                'coordinator_id', v_coord_id
            );
        END IF;
    END IF;

    -- Caller is unauthenticated or has invalid token
    RETURN jsonb_build_object(
        'success', false,
        'error', 'Unauthenticated or invalid session'
    );
END;
$$;

-- Function Execution Permissions
REVOKE ALL ON FUNCTION public.clear_user_session_notifications(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_user_session_notifications(TEXT) TO anon, authenticated, service_role;

-- 2. Grant DELETE on public.notifications to authenticated and enforce RLS
GRANT DELETE ON public.notifications TO authenticated;

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications"
ON public.notifications
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- 3. Maintenance function for purging expired notifications
CREATE OR REPLACE FUNCTION public.cleanup_expired_session_notifications(
    p_older_than_interval INTERVAL DEFAULT INTERVAL '24 hours'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_deleted_count INT := 0;
BEGIN
    DELETE FROM public.notifications
    WHERE (expires_at IS NOT NULL AND expires_at < NOW())
       OR (is_read = TRUE AND created_at < (NOW() - p_older_than_interval));

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_count', v_deleted_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_session_notifications(INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_session_notifications(INTERVAL) TO service_role;
