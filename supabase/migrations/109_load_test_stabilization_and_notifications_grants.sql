-- ============================================================================
-- Migration 109: Load Test Stabilization, Notification Grants & Critical Indexes
-- ============================================================================

-- 1. Grant SELECT and UPDATE on notifications to eliminate 42501 permission denied
-- Anonymously queried notifications will evaluate RLS cleanly to 0 rows instead of throwing 42501.
GRANT SELECT ON public.notifications TO anon, authenticated;
GRANT UPDATE ON public.notifications TO authenticated;

-- 2. Add covering index for duplicate teammate roll checks in student_register_atomic
CREATE INDEX IF NOT EXISTS idx_team_members_upper_trim_roll 
ON public.team_members (UPPER(trim(snapshot_roll_number)));

-- 3. Add composite index on registrations for sub-event status filtering
CREATE INDEX IF NOT EXISTS idx_registrations_sub_event_status 
ON public.registrations (sub_event_id, status);

-- 4. Add index on attendance_records for scanned_member_id to speed up dashboard attendance lookups
CREATE INDEX IF NOT EXISTS idx_attendance_records_scanned_member 
ON public.attendance_records (scanned_member_id);

-- 5. Add index on certificates for team_member_id
CREATE INDEX IF NOT EXISTS idx_certificates_team_member 
ON public.certificates (team_member_id);
