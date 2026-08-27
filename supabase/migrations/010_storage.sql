-- 010_storage

INSERT INTO storage.buckets (id, name, public) VALUES ('events', 'events', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('certificates', 'certificates', false) ON CONFLICT (id) DO NOTHING;

-- Events Bucket Policies (Public read, Admin write)
CREATE POLICY "Public can view events bucket" ON storage.objects FOR SELECT USING (bucket_id = 'events');
CREATE POLICY "Admins can insert events bucket" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'events' AND public.is_admin());
CREATE POLICY "Admins can update events bucket" ON storage.objects FOR UPDATE USING (bucket_id = 'events' AND public.is_admin());
CREATE POLICY "Admins can delete events bucket" ON storage.objects FOR DELETE USING (bucket_id = 'events' AND public.is_admin());

-- Documents Bucket Policies (User read/write own, Admin all)
CREATE POLICY "Users can view own documents" ON storage.objects FOR SELECT USING (bucket_id = 'documents' AND auth.uid() = owner);
CREATE POLICY "Users can insert own documents" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'documents' AND auth.uid() = owner);
CREATE POLICY "Admins can do everything on documents" ON storage.objects FOR ALL USING (bucket_id = 'documents' AND public.is_admin());

-- Certificates Bucket Policies
-- Edge functions (service_role) will generate certificates and signed URLs. 
-- For safety, direct read access is restricted to Admins.
CREATE POLICY "Admins can do everything on certificates" ON storage.objects FOR ALL USING (bucket_id = 'certificates' AND public.is_admin());
