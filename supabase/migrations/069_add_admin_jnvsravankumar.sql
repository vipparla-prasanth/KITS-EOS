-- ============================================================================
-- Migration 069: Add jnvsravankumar@gmail.com to Admin Allowlist & Provisioning
-- ============================================================================
-- Authoritative Admin Allowlist includes:
--   'prasanthv865@gmail.com',
--   'hruthvikmanoj4608@gmail.com',
--   'saideepak4408@gmail.com',
--   'nerellabhavanilakshmi@gmail.com',
--   'principal@kitsakshar.ac.in',
--   'qa.admin@kitsakshar.ac.in',
--   'jnvsravankumar@gmail.com'
--
-- 1. Update public.is_admin() to recognize jnvsravankumar@gmail.com
-- 2. Update public.handle_new_user() trigger function to provision
--    jnvsravankumar@gmail.com as ADMIN upon first Google OAuth login.
-- 3. Update public.admin_delete_notifications() with complete allowlist.
-- 4. Ensure any existing record for jnvsravankumar@gmail.com in public.users
--    has role = 'ADMIN' and status = 'ACTIVE'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin_allowlist text[] := ARRAY[
        'prasanthv865@gmail.com',
        'hruthvikmanoj4608@gmail.com',
        'saideepak4408@gmail.com',
        'nerellabhavanilakshmi@gmail.com',
        'principal@kitsakshar.ac.in',
        'qa.admin@kitsakshar.ac.in',
        'jnvsravankumar@gmail.com'
    ];
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() 
          AND role = 'ADMIN' 
          AND status = 'ACTIVE'
          AND lower(trim(email)) = ANY(v_admin_allowlist)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- Update public.handle_new_user() with updated authoritative allowlist
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_email text;
    v_role public.user_role;
    v_admin_allowlist text[] := ARRAY[
        'prasanthv865@gmail.com',
        'hruthvikmanoj4608@gmail.com',
        'saideepak4408@gmail.com',
        'nerellabhavanilakshmi@gmail.com',
        'principal@kitsakshar.ac.in',
        'qa.admin@kitsakshar.ac.in',
        'jnvsravankumar@gmail.com'
    ];
BEGIN
    v_email := lower(trim(NEW.email));
    
    IF v_email = ANY(v_admin_allowlist) THEN
        v_role := 'ADMIN';
    ELSE
        v_role := 'STUDENT';
    END IF;

    INSERT INTO public.users (id, email, role, status)
    VALUES (NEW.id, NEW.email, v_role, 'ACTIVE')
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role = CASE
            WHEN lower(trim(EXCLUDED.email)) = ANY(v_admin_allowlist) THEN 'ADMIN'::public.user_role
            ELSE public.users.role
        END;
        
    RETURN NEW;
END;
$$;

-- Update public.admin_delete_notifications() with updated authoritative allowlist
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
        'qa.admin@kitsakshar.ac.in',
        'jnvsravankumar@gmail.com'
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

-- Ensure all allowlisted users in public.users have role = 'ADMIN' and status = 'ACTIVE'
UPDATE public.users
SET role = 'ADMIN',
    status = 'ACTIVE'
WHERE lower(trim(email)) IN (
    'prasanthv865@gmail.com',
    'hruthvikmanoj4608@gmail.com',
    'saideepak4408@gmail.com',
    'nerellabhavanilakshmi@gmail.com',
    'principal@kitsakshar.ac.in',
    'qa.admin@kitsakshar.ac.in',
    'jnvsravankumar@gmail.com'
);
