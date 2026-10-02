-- 020_coordinators_registrations_payments_access.sql

-- 1. Grant SELECT on coordinators, coordinator_assignments, and payments to authenticated
GRANT SELECT ON public.coordinators TO authenticated;
GRANT SELECT ON public.coordinator_assignments TO authenticated;
GRANT SELECT ON public.payments TO authenticated;

-- 2. Grant backend service_role least-privilege CRUD on payments
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registrations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO service_role;

-- 3. RLS policies for coordinators
DROP POLICY IF EXISTS "Admins can do everything on coordinators" ON public.coordinators;
CREATE POLICY "Admins can do everything on coordinators" ON public.coordinators
  FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "Admins can do everything on coordinator_assignments" ON public.coordinator_assignments;
CREATE POLICY "Admins can do everything on coordinator_assignments" ON public.coordinator_assignments
  FOR ALL USING (is_admin());

-- 4. RLS policies for payments
DROP POLICY IF EXISTS "Admins can do everything on payments" ON public.payments;
CREATE POLICY "Admins can do everything on payments" ON public.payments
  FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "Users can read own payments" ON public.payments;
CREATE POLICY "Users can read own payments" ON public.payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.registrations
      WHERE public.registrations.id = public.payments.registration_id
        AND public.registrations.leader_id = auth.uid()
    )
  );
