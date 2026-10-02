-- 014_fix_users_permission

-- Grant SELECT permission on the users table to the authenticated role.
-- RLS policies on the users table already restrict access to auth.uid() = id,
-- preventing users from reading arbitrary records.
GRANT SELECT ON TABLE public.users TO authenticated;
