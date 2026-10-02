-- 018_grant_backend_least_privilege.sql

GRANT SELECT ON public.users TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sub_events TO service_role;

GRANT INSERT ON public.audit_logs TO service_role;
