-- 022_admin_operations_rls_policies.sql
-- Enables Admin and Student operations across attendance, certificates, feedback, and audit logs.

-- 1. attendance_records
DROP POLICY IF EXISTS "Admins can do everything on attendance_records" ON public.attendance_records;
CREATE POLICY "Admins can do everything on attendance_records" ON public.attendance_records
  FOR ALL USING (is_admin());

-- 2. certificates
DROP POLICY IF EXISTS "Admins can do everything on certificates" ON public.certificates;
CREATE POLICY "Admins can do everything on certificates" ON public.certificates
  FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "Users can read own certificates" ON public.certificates;
CREATE POLICY "Users can read own certificates" ON public.certificates
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.id = certificates.team_member_id
        AND tm.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.team_members tm
      JOIN public.teams t ON tm.team_id = t.id
      JOIN public.registrations r ON t.registration_id = r.id
      WHERE tm.id = certificates.team_member_id
        AND r.leader_id = auth.uid()
    )
  );

-- 3. certificate_corrections
DROP POLICY IF EXISTS "Admins can do everything on certificate_corrections" ON public.certificate_corrections;
CREATE POLICY "Admins can do everything on certificate_corrections" ON public.certificate_corrections
  FOR ALL USING (is_admin());

-- 4. feedback_responses
DROP POLICY IF EXISTS "Admins can do everything on feedback_responses" ON public.feedback_responses;
CREATE POLICY "Admins can do everything on feedback_responses" ON public.feedback_responses
  FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "Leaders can insert feedback" ON public.feedback_responses;
CREATE POLICY "Leaders can insert feedback" ON public.feedback_responses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.registrations r
      WHERE r.id = feedback_responses.registration_id
        AND r.leader_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Leaders can read own feedback" ON public.feedback_responses;
CREATE POLICY "Leaders can read own feedback" ON public.feedback_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.registrations r
      WHERE r.id = feedback_responses.registration_id
        AND r.leader_id = auth.uid()
    )
  );

-- 5. audit_logs
DROP POLICY IF EXISTS "Admins can read audit_logs" ON public.audit_logs;
CREATE POLICY "Admins can read audit_logs" ON public.audit_logs
  FOR SELECT USING (is_admin());

-- Grants for PostgREST
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificate_corrections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_responses TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificate_corrections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_responses TO service_role;
GRANT SELECT, INSERT ON public.audit_logs TO service_role;
