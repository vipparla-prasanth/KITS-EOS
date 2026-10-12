-- ============================================================================
-- Migration: 108_optimize_is_admin_and_auth_performance.sql
-- Description:
--   1. Optimize public.is_admin() to be STABLE (was defaulting to VOLATILE).
--   2. Add fast short-circuit for anonymous / unauthenticated calls (v_uid IS NULL).
--      Prevents hundreds of thousands of sequential scans on public.users during
--      public queries on categories, events, sub_events, stalls, and notifications.
--   3. Create targeted partial index on active ADMINs in public.users.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
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
    -- Fast exit for unauthenticated / anon callers without querying public.users
    IF v_uid IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = v_uid 
          AND role = 'ADMIN' 
          AND status = 'ACTIVE'
          AND lower(trim(email)) = ANY(v_admin_allowlist)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- Partial index for instantaneous admin identification
CREATE INDEX IF NOT EXISTS idx_users_active_admin 
ON public.users (id, role, status) 
WHERE (role = 'ADMIN' AND status = 'ACTIVE');
