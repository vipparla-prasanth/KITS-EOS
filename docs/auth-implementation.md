# Phase 2B.1 Auth Implementation

## 1. Supabase Auth Integration
- The connection between `auth.users` and `public.users` has been firmly established via a strict PostgreSQL trigger.
- **Trigger Logic**: `on_auth_user_created` fires `AFTER INSERT ON auth.users`.
- This ensures that a corresponding record in `public.users` is automatically generated without the frontend explicitly requesting it, preventing malicious role escalation payloads.

## 2. auth.users → public.users Relationship
- The relationship inherently respects the `users` schema NOT NULL constraints (requiring `id` and `email`). 
- Default application role is hardcoded to `STUDENT` inside the trigger function.
- Default application status is set to `ACTIVE`.

## 3. student_profiles Relationship
- Due to strict NOT NULL business-logic constraints on the `student_profiles` table (e.g. `roll_number`, `college`, `phone`), `student_profiles` is intentionally NOT created inside the trigger.
- The `student_profiles` row will be securely instantiated by a later authenticated onboarding process, preserving data integrity.

## 4. Application-User Provisioning & Idempotency
- **Idempotency**: The trigger uses `ON CONFLICT (id) DO NOTHING` which guarantees safety if multiple signups overlap or are re-attempted. Only exactly one application user will exist per `auth.users` record.

## 5. Identity Resolution
- The server-side identity resolution utility was created in `supabase/functions/_shared/auth.ts`.
- `resolveIdentity()` safely strips the `Authorization` header, invokes `supabase.auth.getUser()`, and then explicitly queries the `public.users` table using the `service_role` key to acquire the *true* application role and status, overriding any potentially manipulated JWT claims from the frontend.

## 6. Account Lifecycle Handling
- `requireActiveUser()` explicitly inspects the `status` flag returned from `resolveIdentity()`. 
- If an account is `DEACTIVATED` or `ANONYMIZED`, a `403 Forbidden` standard `HttpError` is thrown, blocking API access even if the `auth.users` JWT hasn't expired.

## 7. Role Protection
- The frontend has no avenue to pass a "role" parameter during initial signup. `requireRole(req, 'ADMIN', client)` relies exclusively on the database `role` column, fully protecting against unauthorized privilege escalation.

## 8. Security Considerations
- The identity resolver enforces dependency on `serviceClient` explicitly injected by the caller, ensuring that `public.users` lookups do not rely on standard RLS rules which could be bypassed.

## 9. Tests Performed
1. **Trigger Validation**: Inserted a test user into `auth.users` simulating an auth signup. Confirmed automatic downstream creation of `public.users` with `'STUDENT'` and `'ACTIVE'`.
2. **Cleanup Integrity**: Safely removed the test user, ensuring no residual mock data remains. Proved that `auth.users` does not blindly cascade delete `public.users`, protecting historical participant data.
3. **Build Check**: Ran `npm run build` on the workspace to ensure TS configurations and dependencies remain intact.

## 10. Migrations Created
- `011_auth_provisioning.sql`: Created the idempotent `handle_new_user` Postgres trigger function and attached it to `auth.users`.
