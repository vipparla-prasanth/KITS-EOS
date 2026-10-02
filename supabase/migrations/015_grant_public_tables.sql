-- 015_grant_public_tables.sql

-- Grant necessary privileges to Supabase API roles (anon, authenticated)
-- By default, Postgres revokes all privileges on tables created by 'postgres' role.
-- We must explicitly grant them so PostgREST can execute queries,
-- allowing our RLS policies to evaluate them.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Grant permissions to authenticated users
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated;

-- Grant permissions to anon users (mostly for SELECT, but RLS protects all)
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon;

-- Ensure future tables also inherit these privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO authenticated, anon;
