-- Migration 051: Fix Admin Delete Notifications RPC
-- Corrective migration for public.admin_delete_notifications:
-- 1. Restores missing 'FROM deleted_rows' clause that caused ERROR 42703: column "id" does not exist
-- 2. Uses proper unnest alias 'FROM unnest(p_notification_ids) AS u WHERE u IS NOT NULL'
-- 3. Supports optional p_actor_id UUID DEFAULT NULL when called securely via service-role
-- 4. Strictly validates caller identity: active ADMIN role + ADMIN_ALLOWLIST
-- 5. Atomically deletes matching notifications by id OR broadcast_id
-- 6. Records audit log in public.audit_logs

DROP FUNCTION IF EXISTS public.admin_delete_notifications(UUID[]);
DROP FUNCTION IF EXISTS public.admin_delete_notifications(UUID[], UUID);

CREATE OR REPLACE FUNCTION public.admin_delete_notifications(
    p_notification_ids UUID[],
    p_actor_id UUID DEFAULT NULL
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
    v_admin_allowlist TEXT[] := ARRAY[
        'prasanthv865@gmail.com',
        'hruthvikmanoj4608@gmail.com',
        'saideepak4408@gmail.com',
        'nerellabhavanilakshmi@gmail.com',
        'principal@kitsakshar.ac.in',
        'qa.admin@kitsakshar.ac.in'
    ];
BEGIN
    -- 1. Derive and strictly verify caller identity
    IF auth.role() = 'service_role' AND p_actor_id IS NOT NULL THEN
        v_actor_id := p_actor_id;
    ELSE
        v_actor_id := auth.uid();
    END IF;

    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Authoritative Admin authorization check against database & allowlist
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = v_actor_id
          AND role = 'ADMIN'
          AND status = 'ACTIVE'
          AND lower(trim(email)) = ANY(v_admin_allowlist)
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
    SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::UUID[]) INTO v_clean_ids
    FROM unnest(p_notification_ids) AS u
    WHERE u IS NOT NULL;

    IF array_length(v_clean_ids, 1) IS NULL OR array_length(v_clean_ids, 1) = 0 THEN
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
    SELECT COUNT(*), COALESCE(array_agg(id), ARRAY[]::UUID[])
    INTO v_deleted_count, v_deleted_ids
    FROM deleted_rows;

    IF v_deleted_count = 0 THEN
        RAISE EXCEPTION 'Invalid operation: No matching broadcast records found for deletion.'
            USING ERRCODE = '22023';
    END IF;

    -- 7. Audit log in same transaction
    SELECT email INTO v_actor_email FROM public.users WHERE id = v_actor_id;

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
            'requested_ids', v_clean_ids,
            'deleted_ids', v_deleted_ids,
            'deleted_by', COALESCE(v_actor_email, v_actor_id::text),
            'deleted_at', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'deleted_count', v_deleted_count,
        'deleted_ids', v_deleted_ids,
        'message', format('%s broadcast notification(s) permanently deleted.', v_deleted_count)
    );
END;
$$;

-- Revoke from public & anon, grant to authenticated and service_role
REVOKE ALL ON FUNCTION public.admin_delete_notifications(UUID[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_notifications(UUID[], UUID) TO authenticated, service_role;
