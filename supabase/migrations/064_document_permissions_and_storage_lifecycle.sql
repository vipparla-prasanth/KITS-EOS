-- ============================================================================
-- Migration 064: Document Least-Privilege Permissions & Storage Lifecycle
-- Description:
-- 1. Grants least-privilege CRUD (SELECT, INSERT, UPDATE, DELETE) on public.documents
--    to authenticated users, and ALL to service_role, with zero permissions for anon.
-- 2. Restores strict RLS policies on public.documents with auth.uid() = owner_id checks.
-- 3. Configures least-privilege storage policies on storage.objects for bucket 'documents'
--    restricting uploads/edits to the user's authorized path: registrations/{userId}/...
-- ============================================================================

-- 1. Table Grants for public.documents
ALTER TABLE public.documents OWNER TO postgres;
REVOKE ALL ON public.documents FROM PUBLIC;
REVOKE ALL ON public.documents FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;

-- 2. RLS Policies on public.documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can do everything on documents" ON public.documents;
DROP POLICY IF EXISTS "Users can read own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;

-- Students/Users can SELECT only their own documents
CREATE POLICY "Users can read own documents"
ON public.documents
FOR SELECT
TO authenticated
USING (auth.uid() = owner_id);

-- Students/Users can INSERT documents where owner_id = auth.uid()
CREATE POLICY "Users can insert own documents"
ON public.documents
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_id);

-- Students/Users can UPDATE only their own documents
CREATE POLICY "Users can update own documents"
ON public.documents
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

-- Students/Users can DELETE only their own documents
CREATE POLICY "Users can delete own documents"
ON public.documents
FOR DELETE
TO authenticated
USING (auth.uid() = owner_id);

-- Administrators (via authoritative public.is_admin()) can perform all operations
CREATE POLICY "Admins can do everything on documents"
ON public.documents
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 3. Storage Policies on storage.objects for bucket 'documents'
DROP POLICY IF EXISTS "Users can view own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can insert own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can do everything on documents" ON storage.objects;

-- Students/Users can view their own documents
CREATE POLICY "Users can view own documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'documents'
    AND auth.uid() = owner
);

-- Students/Users can insert only into their own authorized path registrations/{userId}/... or students/{userId}/...
CREATE POLICY "Users can insert own documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'documents'
    AND auth.uid() = owner
    AND (
        name LIKE 'registrations/' || (auth.uid())::text || '/%'
        OR name LIKE 'students/' || (auth.uid())::text || '/%'
    )
);

-- Students/Users can update only their own documents within their authorized path
CREATE POLICY "Users can update own documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'documents'
    AND auth.uid() = owner
    AND (
        name LIKE 'registrations/' || (auth.uid())::text || '/%'
        OR name LIKE 'students/' || (auth.uid())::text || '/%'
    )
)
WITH CHECK (
    bucket_id = 'documents'
    AND auth.uid() = owner
    AND (
        name LIKE 'registrations/' || (auth.uid())::text || '/%'
        OR name LIKE 'students/' || (auth.uid())::text || '/%'
    )
);

-- Students/Users can delete their own documents from storage
CREATE POLICY "Users can delete own documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'documents'
    AND auth.uid() = owner
);

-- Administrators full access on documents storage bucket
CREATE POLICY "Admins can do everything on documents"
ON storage.objects
FOR ALL
TO authenticated
USING (
    bucket_id = 'documents'
    AND public.is_admin()
)
WITH CHECK (
    bucket_id = 'documents'
    AND public.is_admin()
);
