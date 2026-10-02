-- Migration 041: Admin Delete Broadcast Notifications RPC
-- Enforces:
-- 1. Server-side JWT actor derivation (auth.uid())
-- 2. ACTIVE ADMIN role check with ERRCODE = '42501' (HTTP 403 Forbidden)
-- 3. Broadcast discriminator validation: all IDs must belong to notifications where audience IN ('ALL', 'STUDENT', 'COORDINATOR')
-- 4. All-or-nothing semantics: if any ID is non-broadcast or non-existent, request is rejected with 0 deletions
-- 5. Atomic deletion and audit log recording in public.audit_logs

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
    v_match_count INT := 0;
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

    -- 5. Verify that EVERY requested ID is an actual broadcast notification
    -- Authoritative broadcast discriminator: audience IS NOT NULL AND audience IN ('ALL', 'STUDENT', 'COORDINATOR')
    SELECT COUNT(*) INTO v_match_count
    FROM public.notifications
    WHERE id = ANY(v_clean_ids)
      AND audience IS NOT NULL
      AND audience IN ('ALL', 'STUDENT', 'COORDINATOR');

    IF v_match_count <> array_length(v_clean_ids, 1) THEN
        SELECT COUNT(*) INTO v_non_broadcast_count
        FROM public.notifications
        WHERE id = ANY(v_clean_ids)
          AND (audience IS NULL OR audience NOT IN ('ALL', 'STUDENT', 'COORDINATOR'));

        IF v_non_broadcast_count > 0 THEN
            RAISE EXCEPTION 'Invalid operation: One or more selected records are not broadcast notifications. Deletion aborted.'
                USING ERRCODE = '22023';
        ELSE
            RAISE EXCEPTION 'Invalid operation: One or more notification records were not found. Deletion aborted.'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 6. Atomic deletion of broadcast records
    WITH deleted_rows AS (
        DELETE FROM public.notifications
        WHERE id = ANY(v_clean_ids)
          AND audience IS NOT NULL
          AND audience IN ('ALL', 'STUDENT', 'COORDINATOR')
        RETURNING id
    )
    SELECT COUNT(*), array_agg(id)
    INTO v_deleted_count, v_deleted_ids
    FROM deleted_rows;

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
            'deleted_count', v_deleted_count,
            'deleted_ids', v_deleted_ids,
            'deleted_by', COALESCE(v_actor_email, v_actor_id::text),
            'deleted_at', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', format('%s broadcast notification(s) permanently deleted.', v_deleted_count),
        'deleted_count', v_deleted_count,
        'deleted_ids', v_deleted_ids
    );
END;
$$;

-- Security & Least Privilege
REVOKE ALL ON FUNCTION public.admin_delete_notifications(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_notifications(UUID[]) TO authenticated;
