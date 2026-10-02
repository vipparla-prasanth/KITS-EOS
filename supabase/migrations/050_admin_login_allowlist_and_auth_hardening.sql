-- ============================================================================
-- Migration 050: Admin Login Allowlist & Auth Hardening
-- ============================================================================
-- 1. Update public.is_admin() to include institutional QA Admin account.
-- 2. Update public.handle_new_user() trigger function to preserve allowlisted admins.
-- 3. Ensure role and status are synchronized for all allowlisted admin users.
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
        'qa.admin@kitsakshar.ac.in'
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

-- Update public.handle_new_user() with complete authoritative allowlist
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
        'qa.admin@kitsakshar.ac.in'
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

-- Ensure existing allowlisted users in public.users have role = 'ADMIN' and status = 'ACTIVE'
UPDATE public.users
SET role = 'ADMIN',
    status = 'ACTIVE'
WHERE lower(trim(email)) IN (
    'prasanthv865@gmail.com',
    'hruthvikmanoj4608@gmail.com',
    'saideepak4408@gmail.com',
    'nerellabhavanilakshmi@gmail.com',
    'principal@kitsakshar.ac.in',
    'qa.admin@kitsakshar.ac.in'
);
