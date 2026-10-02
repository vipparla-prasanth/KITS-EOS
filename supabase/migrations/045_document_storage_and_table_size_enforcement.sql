-- Migration 045: Authoritative 20 MB Document Upload Limit Enforcement
-- 1. Sets native Supabase Storage bucket limit on 'documents' to exactly 20 MB (20,971,520 bytes)
-- 2. Adds check constraint on public.documents metadata table to reject records exceeding 20 MB

-- 1. Storage bucket level enforcement (native Supabase Storage API boundary)
UPDATE storage.buckets
SET file_size_limit = 20971520
WHERE id = 'documents';

-- 2. Database level enforcement on documents metadata table
ALTER TABLE public.documents
DROP CONSTRAINT IF EXISTS check_document_max_size;

ALTER TABLE public.documents
ADD CONSTRAINT check_document_max_size
CHECK (size_bytes <= 20971520);
