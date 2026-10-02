-- ==============================================================================
-- Migration 081: Fix Student Suspension Requests Authorization & RPC Security
-- ==============================================================================
-- Root Cause:
-- Migration 079 defined public.student_account_suspension_requests and RLS
-- policies, but did not grant base SQL table privileges to the authenticated
-- role. PostgreSQL checks base table grants before evaluating RLS policies,
-- causing SELECT requests from authenticated admins to fail with SQLSTATE 42501
-- ("permission denied for table student_account_suspension_requests").
--
-- Solution:
-- 1. Grant minimum required SELECT privilege on student_account_suspension_requests
--    to authenticated, and ALL privileges to service_role. Revoke all from anon/public.
-- 2. Refactor RLS policies on student_account_suspension_requests:
--    - SELECT: Only active, allowlisted ADMIN users via public.is_admin().
--    - UPDATE: Only active, allowlisted ADMIN users via public.is_admin().
--    - DELETE: Only active, allowlisted ADMIN users via public.is_admin().
--    - Students and Coordinators have NO direct table SELECT access.
-- 3. Provide authoritative Admin security-definer RPC public.admin_get_suspension_requests():
--    - Enforces auth.uid() authentication.
--    - Verifies active ADMIN role in public.users with allowlisted email.
--    - Rejects unauthorized callers with SQLSTATE 42501.
--    - Returns strictly required UI fields with student profile snapshots.
--    - Revokes EXECUTE from PUBLIC/anon; grants EXECUTE to authenticated, service_role.
-- ==============================================================================

-- 1. TABLE PRIVILEGES
GRANT SELECT ON public.student_account_suspension_requests TO authenticated;
GRANT ALL ON public.student_account_suspension_requests TO service_role;
REVOKE ALL ON public.student_account_suspension_requests FROM anon, public;

-- 2. AUTHORITATIVE RLS POLICIES
ALTER TABLE public.student_account_suspension_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage suspension requests" ON public.student_account_suspension_requests;
DROP POLICY IF EXISTS "Students can view own suspension requests" ON public.student_account_suspension_requests;
DROP POLICY IF EXISTS "Students can insert own suspension request" ON public.student_account_suspension_requests;
DROP POLICY IF EXISTS "Admins can view suspension requests" ON public.student_account_suspension_requests;
DROP POLICY IF EXISTS "Admins can update suspension requests" ON public.student_account_suspension_requests;
DROP POLICY IF EXISTS "Admins can delete suspension requests" ON public.student_account_suspension_requests;

-- Admin-only SELECT
CREATE POLICY "Admins can view suspension requests"
ON public.student_account_suspension_requests
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Admin-only UPDATE (for adjudication reviews)
CREATE POLICY "Admins can update suspension requests"
ON public.student_account_suspension_requests
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Admin-only DELETE
CREATE POLICY "Admins can delete suspension requests"
ON public.student_account_suspension_requests
FOR DELETE
TO authenticated
USING (public.is_admin());

-- 3. DEDICATED ADMIN SECURITY-DEFINER READ RPC
CREATE OR REPLACE FUNCTION public.admin_get_suspension_requests()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id uuid;
    v_is_authorized boolean := false;
    v_result jsonb;
BEGIN
    v_actor_id := auth.uid();
    
    -- 1. Verify caller authentication
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required.'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Verify authoritative Admin identity in public.users
    SELECT EXISTS (
        SELECT 1 
        FROM public.users u
        WHERE u.id = v_actor_id
          AND u.role = 'ADMIN'
          AND u.status = 'ACTIVE'
          AND lower(trim(u.email)) = ANY(ARRAY[
              'prasanthv865@gmail.com',
              'hruthvikmanoj4608@gmail.com',
              'saideepak4408@gmail.com',
              'nerellabhavanilakshmi@gmail.com',
              'principal@kitsakshar.ac.in',
              'qa.admin@kitsakshar.ac.in',
              'jnvsravankumar@gmail.com'
          ])
    ) INTO v_is_authorized;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required.'
            USING ERRCODE = '42501';
    END IF;

    -- 3. Return strictly required UI fields with joined student profile
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', r.id,
                'student_id', r.student_id,
                'request_message', r.request_message,
                'status', r.status,
                'admin_response', r.admin_response,
                'reviewed_by', r.reviewed_by,
                'reviewed_at', r.reviewed_at,
                'created_at', r.created_at,
                'student_profiles', CASE 
                    WHEN sp.user_id IS NOT NULL THEN jsonb_build_object(
                        'user_id', sp.user_id,
                        'full_name', sp.full_name,
                        'roll_number', sp.roll_number,
                        'department', sp.department,
                        'year_of_study', sp.year_of_study,
                        'college', sp.college,
                        'account_status', sp.account_status,
                        'suspension_reason', sp.suspension_reason
                    )
                    ELSE NULL
                END
            )
            ORDER BY r.created_at DESC
        ),
        '[]'::jsonb
    )
    INTO v_result
    FROM public.student_account_suspension_requests r
    LEFT JOIN public.student_profiles sp ON sp.user_id = r.student_id;

    RETURN v_result;
END;
$$;

-- Enforce least privilege on RPC
REVOKE ALL ON FUNCTION public.admin_get_suspension_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_suspension_requests() TO authenticated, service_role;
