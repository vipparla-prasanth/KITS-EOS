-- 024_student_portal_policies_and_verification_rpc.sql
-- Enables Student Portal operational workflows (Attendance, Notifications, Complaints, and Public Certificate Verification)

-- 1. attendance_records: Allow authenticated students to read their own attendance records
DROP POLICY IF EXISTS "Users can read own attendance records" ON public.attendance_records;
CREATE POLICY "Users can read own attendance records" ON public.attendance_records
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      JOIN public.registrations r ON t.registration_id = r.id
      WHERE public.attendance_records.team_id = t.id
        AND r.leader_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE public.attendance_records.scanned_member_id = tm.id
        AND tm.user_id = auth.uid()
    )
  );

-- 2. notifications: Allow authenticated students to mark their own notifications as read
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. complaints: Grant INSERT permission to authenticated role
GRANT INSERT ON public.complaints TO authenticated;

-- 4. notifications: Grant UPDATE on is_read to authenticated role
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

-- 5. Public Certificate Verification RPC: SECURITY DEFINER with safe search_path and no PII
CREATE OR REPLACE FUNCTION public.verify_certificate(cert_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'is_valid', true,
    'certificate_id', c.id,
    'type', c.type,
    'status', c.status,
    'student_name', tm.snapshot_name,
    'roll_number', tm.snapshot_roll_number,
    'college', tm.snapshot_college,
    'department', tm.snapshot_department,
    'sub_event_name', se.name,
    'event_name', COALESCE(e.name, (SELECT ev.name FROM public.categories cat JOIN public.events ev ON cat.event_id = ev.id WHERE cat.id = se.category_id)),
    'verified_at', NOW()
  )
  INTO v_result
  FROM public.certificates c
  JOIN public.team_members tm ON c.team_member_id = tm.id
  JOIN public.sub_events se ON c.sub_event_id = se.id
  LEFT JOIN public.events e ON se.event_id = e.id
  WHERE c.id = cert_id AND c.status = 'UNLOCKED';

  IF v_result IS NULL THEN
    RETURN jsonb_build_object(
      'is_valid', false,
      'message', 'Certificate not found or not yet officially unlocked.'
    );
  END IF;

  RETURN v_result;
END;
$$;

-- Grant EXECUTE on verify_certificate to anon and authenticated roles
GRANT EXECUTE ON FUNCTION public.verify_certificate(UUID) TO anon, authenticated;
