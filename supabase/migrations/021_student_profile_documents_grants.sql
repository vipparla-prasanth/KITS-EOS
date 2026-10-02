-- 021_student_profile_documents_grants.sql

-- 1. Grant INSERT, UPDATE on student_profiles to authenticated (enforced by RLS auth.uid() = user_id)
GRANT INSERT, UPDATE ON public.student_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_profiles TO service_role;

-- 2. Grant INSERT, SELECT on documents to authenticated
GRANT INSERT, SELECT ON public.documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO service_role;

-- 3. RLS policy for inserting documents by owner
DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;
CREATE POLICY "Users can insert own documents" ON public.documents
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- 4. RLS policy for reading registrations: Students can read registrations they lead
DROP POLICY IF EXISTS "Users can read own registrations" ON public.registrations;
CREATE POLICY "Users can read own registrations" ON public.registrations
  FOR SELECT USING (auth.uid() = leader_id);

-- 5. RLS policy for reading teams: Students can read their own teams
DROP POLICY IF EXISTS "Users can read own teams" ON public.teams;
CREATE POLICY "Users can read own teams" ON public.teams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.registrations 
      WHERE public.registrations.id = public.teams.registration_id 
        AND public.registrations.leader_id = auth.uid()
    )
  );

-- 6. RLS policy for reading team members: Students can read their team members
DROP POLICY IF EXISTS "Users can read own team members" ON public.team_members;
CREATE POLICY "Users can read own team members" ON public.team_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.teams 
      JOIN public.registrations ON public.teams.registration_id = public.registrations.id 
      WHERE public.team_members.team_id = public.teams.id 
        AND public.registrations.leader_id = auth.uid()
    )
  );
