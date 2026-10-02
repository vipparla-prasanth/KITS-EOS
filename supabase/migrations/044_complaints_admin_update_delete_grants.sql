-- Migration 044: Complaints Admin Permissions and Audit Log Grants
-- Enables authorized admins to update and delete complaints and log audit entries.
-- Row Level Security (RLS) policies ("Admins can do everything on complaints") strictly ensure
-- only users passing is_admin() can perform UPDATE and DELETE operations.

GRANT UPDATE, DELETE ON public.complaints TO authenticated;
GRANT INSERT ON public.audit_logs TO authenticated;
