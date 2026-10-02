-- 013_audit_log_idempotency

-- Create a unique index to ensure that an admin login security email can only be logged once per session_id.
-- This provides a robust database-level lock against concurrent Edge Function executions trying to send duplicate emails.

CREATE UNIQUE INDEX audit_logs_admin_login_email_idx 
ON audit_logs (action, (metadata->>'session_id')) 
WHERE action = 'ADMIN_LOGIN_SECURITY_EMAIL';
