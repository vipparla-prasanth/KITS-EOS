-- ============================================================================
-- Migration: 128_fix_assessment_live_host_coordinator_permission.sql
-- Description: Restore Coordinator Live Host Snapshot Execution Grant
--
-- Problem:
--   Migration 127 revoked EXECUTE on public.get_assessment_live_host_snapshot from
--   anon ('REVOKE ALL ... FROM PUBLIC, anon').
--   In KITS-EOS, assessment coordinators authenticate using custom session tokens
--   (stored in public.coordinator_sessions) rather than Supabase Auth users.
--   Coordinator client browser requests therefore connect to PostgREST under the
--   anon database role.
--   Revoking anon caused PostgREST to reject valid coordinator requests with:
--   401 Unauthorized / PostgreSQL 42501 "permission denied for function get_assessment_live_host_snapshot".
--
-- Security Assurance:
--   Granting EXECUTE on get_assessment_live_host_snapshot to anon does NOT allow
--   unauthorized access:
--   1. get_assessment_live_host_snapshot is SECURITY DEFINER with safely pinned
--      search_path (public, auth, pg_temp).
--   2. The function immediately delegates to public.verify_assessment_coordinator_access:
--      - If caller is an allowlisted admin (auth.uid() IS NOT NULL AND is_admin()), access is permitted.
--      - If caller is a coordinator, p_coordinator_token is cryptographically validated (SHA-256)
--        against public.coordinator_sessions, checking expiration, active status, and explicit
--        assessment assignment.
--      - Anonymous callers without a valid token, students, or coordinators not assigned
--        to the specific assessment are immediately rejected with PostgreSQL error 42501.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) IS
'Authoritative live host telemetry snapshot. Restricted internally via verify_assessment_coordinator_access to assigned coordinators presenting valid session tokens or allowlisted administrators.';
