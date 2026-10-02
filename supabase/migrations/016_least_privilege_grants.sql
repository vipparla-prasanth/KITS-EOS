-- 016_least_privilege_grants

-- 1. Revoke the excessive ALL privileges introduced by 015 on all tables
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Note: We DO NOT revoke EXECUTE on routines to preserve is_admin() and handle_new_user()

-- 2. Grant minimum required SELECT privileges for anon (public data only)
GRANT SELECT ON events TO anon;
GRANT SELECT ON categories TO anon;
GRANT SELECT ON sub_events TO anon;

-- 3. Grant minimum required SELECT privileges for authenticated users
-- (RLS policies will further restrict which rows are visible)
GRANT SELECT ON events TO authenticated;
GRANT SELECT ON categories TO authenticated;
GRANT SELECT ON sub_events TO authenticated;
GRANT SELECT ON users TO authenticated;
GRANT SELECT ON teams TO authenticated;
GRANT SELECT ON team_members TO authenticated;
GRANT SELECT ON registrations TO authenticated;
GRANT SELECT ON student_profiles TO authenticated;
GRANT SELECT ON complaints TO authenticated;
GRANT SELECT ON documents TO authenticated;
GRANT SELECT ON notifications TO authenticated;

-- 4. Explicit mutation privileges
-- NO FRONTEND MUTATION PRIVILEGES ARE GRANTED.
-- All mutations (events, student_profiles, etc) remain strictly behind Edge Functions or future backend implementations.

-- 5. Revoke the excessive default privileges introduced by 015
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated, anon;
