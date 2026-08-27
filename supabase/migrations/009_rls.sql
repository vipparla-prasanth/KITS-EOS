-- 009_rls

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE coordinators ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE coordinator_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificate_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is admin
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM users WHERE id = auth.uid() AND role = 'ADMIN'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Users / Profiles
CREATE POLICY "Users can read own record" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins can do everything on users" ON users FOR ALL USING (is_admin());

CREATE POLICY "Users can read own profile" ON student_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON student_profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON student_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can do everything on student_profiles" ON student_profiles FOR ALL USING (is_admin());

-- Public Events
CREATE POLICY "Public can view active events" ON events FOR SELECT USING (status = 'ACTIVE');
CREATE POLICY "Admins can do everything on events" ON events FOR ALL USING (is_admin());

CREATE POLICY "Public can view active categories" ON categories FOR SELECT USING (status = 'ACTIVE');
CREATE POLICY "Admins can do everything on categories" ON categories FOR ALL USING (is_admin());

CREATE POLICY "Public can view active sub_events" ON sub_events FOR SELECT USING (status = 'ACTIVE');
CREATE POLICY "Admins can do everything on sub_events" ON sub_events FOR ALL USING (is_admin());

-- Registrations
CREATE POLICY "Users can read own registrations" ON registrations FOR SELECT USING (auth.uid() = leader_id);
CREATE POLICY "Admins can do everything on registrations" ON registrations FOR ALL USING (is_admin());

-- Teams & Members
CREATE POLICY "Users can read own teams" ON teams FOR SELECT USING (
    EXISTS (SELECT 1 FROM registrations WHERE registrations.id = teams.registration_id AND registrations.leader_id = auth.uid())
);
CREATE POLICY "Admins can do everything on teams" ON teams FOR ALL USING (is_admin());

CREATE POLICY "Users can read own team members" ON team_members FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM teams 
        JOIN registrations ON teams.registration_id = registrations.id 
        WHERE team_members.team_id = teams.id AND registrations.leader_id = auth.uid()
    )
);
CREATE POLICY "Admins can do everything on team_members" ON team_members FOR ALL USING (is_admin());

-- Documents
CREATE POLICY "Users can read own documents" ON documents FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Admins can do everything on documents" ON documents FOR ALL USING (is_admin());

-- Complaints
CREATE POLICY "Users can read own complaints" ON complaints FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own complaints" ON complaints FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can do everything on complaints" ON complaints FOR ALL USING (is_admin());

-- Notifications
CREATE POLICY "Users can read own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can do everything on notifications" ON notifications FOR ALL USING (is_admin());
