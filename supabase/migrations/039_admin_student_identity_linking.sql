-- ============================================================================
-- Migration 039: Admin + Student Dual Capability Architecture
-- ============================================================================
-- Architecture Rules Enforced:
-- 1. Exactly ONE auth.users record per real individual.
-- 2. Multi-method authentication:
--    - Google OAuth method for Administrator authentication on Admin Portal.
--    - Email/Password method for Student authentication on Student Portal.
-- 3. public.users.role remains strictly 'ADMIN' (never downgraded, no composite roles).
-- 4. Student capability is additive and represented exclusively by public.student_profiles 
--    sharing the exact same user_id as auth.users.id.
-- 5. Student Portal access is granted based on the presence of a verified row in 
--    public.student_profiles for auth.uid(), without requiring public.users.role = 'STUDENT'.
-- ============================================================================

-- Ensure authenticated users can view and manage their own student profile regardless of role
DO $$
BEGIN
    -- Verify RLS policy existence for student_profiles self-access
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'student_profiles' AND policyname = 'Users can read own profile'
    ) THEN
        CREATE POLICY "Users can read own profile" 
        ON public.student_profiles FOR SELECT 
        USING (auth.uid() = user_id);
    END IF;
END $$;

COMMENT ON TABLE public.student_profiles IS 
'Stores verified student participant profiles. When an Administrator links a student profile, user_id maps to their existing auth.users record without downgrading public.users.role.';
