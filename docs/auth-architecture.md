# KITS-EOS v3 Authentication, Authorization & Session Architecture

## 1. Authentication Architecture Overview

KITS-EOS v3 operates with three distinct authentication models to isolate security domains and prevent privilege escalation.

### Admin
- **Mechanism**: Google OAuth exclusively (via Supabase Auth).
- **Flow**: User authenticates via Google → Supabase creates `auth.users` identity → `public.users` role must explicitly be set to `ADMIN` by an existing admin or direct DB intervention.
- **Rules**: No email/password login. A Google account does not inherently grant Admin access; the `role = 'ADMIN'` flag is the sole source of truth.

### Student
- **Mechanism**: Supabase Auth (Email & Password).
- **Flow**: User signs up → Supabase Auth identity created → `public.users` role defaults to `STUDENT` → `student_profiles` initialized.
- **Rules**: NO forgot password workflow. 

### Coordinator
- **Mechanism**: Custom Authentication via Edge Functions.
- **Flow**: Admin provisions Username/Password → Coordinator submits credentials to Edge Function → EF verifies bcrypt hash → EF issues secure HttpOnly Cookie with JWT.
- **Rules**: Completely isolated from `auth.users`. Coordinators can only access their explicitly assigned sub-events via `coordinator_assignments`.

---

## 2. Coordinator Password Security (Argon2id vs bcrypt)

### Evaluation for Deno/Edge Runtime
Supabase Edge Functions operate in a constrained V8 isolate environment (typically 150-256MB memory limit, strict CPU execution limits).
- **Argon2id**: Memory-hard and highly secure against GPU attacks. However, it requires significant memory allocation. In a heavily concurrent Edge environment, high memory parameters (`m`) risk Out-Of-Memory (OOM) isolate crashes.
- **bcrypt**: CPU-hard with negligible memory footprint. Execution time scales logarithmically with the cost factor.
- **Decision**: **bcrypt** (Cost factor 11 or 12 via standard WASM implementation) is recommended. It guarantees stable execution within the tight memory bounds of Edge isolates while maintaining strong resistance against brute-force attacks.

### Security Implementation
- **Storage**: Passwords are NEVER stored in plaintext. Only the `bcrypt` hash string (which includes the salt) is stored in `coordinators.password_hash`.
- **Throttling**: The Edge Function will enforce rate limiting based on IP and username (e.g., max 5 failed attempts per 15 minutes) to prevent online brute force.
- **Reset**: Admins can overwrite the hash via the Admin panel.

---

## 3. Coordinator Session/JWT Design

Coordinators receive a custom JWT, strictly isolated from Supabase Auth tokens.

- **Issuer (`iss`)**: `kits-eos-coordinator-auth`
- **Audience (`aud`)**: `kits-eos-api`
- **Subject (`sub`)**: `coordinator.id` (UUID)
- **Claims**:
  - `role`: `"COORDINATOR"`
  - `jti`: Unique token identifier (for invalidation tracking).
  - *(Note: `sub_event_id` is NOT in the token. Assignments are checked dynamically in the DB to ensure instant revocation works).*
- **Expiration (`exp`)**: 4 hours.
- **Signing**: HMAC-SHA256 (HS256) using a secret stored securely in Supabase Vault / Edge Secrets.
- **Delivery & Storage**: Set as a `Secure`, `HttpOnly`, `SameSite=Strict` Cookie. NEVER exposed to frontend JavaScript.
- **Invalidation**: On logout, or if an Admin resets a coordinator's password/revokes assignments, a `jti` blocklist or a `token_version` integer on the coordinator record is incremented to invalidate existing tokens.

---

## 4. Service-Role Key Security

- **Rule**: The Supabase `service_role` key MUST NEVER leave the server environment. It cannot be exposed in frontend `.env` files or API payloads.
- **Pattern**:
  1. Frontend sends an authenticated request to the Edge Function.
  2. Edge Function validates the user's Auth JWT (or Coordinator Cookie).
  3. Edge Function resolves the principal identity and role.
  4. Edge Function executes business logic and checks `coordinator_assignments` or team ownership.
  5. If authorized, the Edge Function uses the `service_role` key to bypass RLS and perform complex atomic transactions (e.g., attendance check-ins, registration envelope creation).
  6. The `service_role` key acts as a system executor, NOT a bypass for authorization checks.

---

## 5. Team Member & Registration Ownership

- **Ownership Boundary**: The `registrations` envelope is strictly owned by the `leader_id`. The Team Leader remains the ONLY registration owner.
- **Team-Member Self-Access**: A team member who is not the Team Leader may independently create a KITS-EOS student account after or before participating in a team registration. Once linked to their `team_members.user_id`, that student must be able to access their *own permitted participation information*.
- **Dual Authorization Model**: Student authorization MUST support both:
  1. **Team Leader ownership**: `auth.uid() = registrations.leader_id`
  2. **Individual team-member ownership**: `auth.uid() = team_members.user_id`
- **Strict Isolation**: Team-member self-access is strictly limited. A team member must NOT automatically gain access to:
  - The entire registration's private information
  - Payment information
  - Other team members' private account information
  - Team management controls
  - Certificate management controls owned by the Team Leader
  - Unrelated teams or events
- **Division of Power**:
  - **Team Leader**: Manages team name, handles payment, submits the unlock feedback, and manages/downloads certificates for the whole team.
  - **Team Member**: Gains self-access to view a read-only state of their own participation, and views their own individual certificate (if unlocked by leader).

---

## 6. Authorization Matrix

| Entity | Public | Student (Self / Team Member) | Team Leader | Coordinator (Assigned) | Admin |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **users / profiles** | None | Read/Update Self | Read Self | Read (Assigned participants) | All |
| **events / categories** | Read (Active) | Read (Active) | Read (Active) | Read (Active) | All |
| **sub_events** | Read (Active) | Read (Active) | Read (Active) | Read (Assigned) | All |
| **coordinators** | None | None | None | Read Self | All |
| **registrations** | None | None (Unless Leader) | Read/Manage Own | Read (Assigned) | All |
| **teams** | None | Read Own Team (Read-only) | Read/Manage Own | Read (Assigned) | All |
| **team_members** | None | Read Self (Only own record) | Read/Manage Own | Read (Assigned) | All |
| **payments** | None | None | Read/Manage Own | Read (Assigned) | All |
| **attendance** | None | Read Own | Read Own | Read/Insert (Assigned) | All |
| **documents** | None | Read Own | Read/Insert Own | Read (Assigned) | All |
| **certificates** | None | Read Own (If Unlocked) | Read/Download All (Own Team) | Read (Assigned) | All |
| **feedback** | None | Read/Insert Own | Read/Insert Own | Read (Assigned) | All |
| **complaints** | None | Read/Insert Own | Read/Insert Own | None | All |
| **audit / notifs** | None | Read Notifs (Self) | Read Notifs (Self) | None | All |

---

## 7. Admin Authorization & Provisioning

- **Initial Provisioning**: The very first Admin must be manually provisioned by a developer with database access (e.g., executing `UPDATE users SET role = 'ADMIN' WHERE email = '...';`).
- **Subsequent Provisioning**: Existing Admins use a secure Edge Function to grant the `ADMIN` role to an existing `auth.users` identity.
- **Protection**: Google authentication simply creates an `auth.user`. The backend strictly checks `if (user.role !== 'ADMIN') throw Unauthorized`.

---

## 8. Student Authorization

Students operate inside their own isolated context. RLS and Edge Functions explicitly verify both `auth.uid() = registrations.leader_id` and `auth.uid() = team_members.user_id` to determine boundaries. 
- Students cannot read another student's profile, registration, or complaints. 
- A team member receives read-only access strictly confined to their own participation (they cannot view registration payments or other team members' private data).
- Edge Functions guarantee they cannot forge `sub_event_id` payloads to register for locked events or forge check-in records.

---

## 9. Team Leader Authorization

The Team Leader holds the `leader_id` on the `registrations` table. 
- Edge Functions check: `if (registration.leader_id !== auth.uid()) throw Forbidden`.
- They alone can invoke the `submit-feedback` Edge Function that cascades the `status = 'UNLOCKED'` to all `certificates` linked to their `registration.id`.

---

## 10. Coordinator Authorization

Every Coordinator Edge Function MUST execute this explicit flow:
1. Validate Coordinator JWT.
2. Extract `coordinator_id` from JWT `sub`.
3. Read requested `sub_event_id` from request body/params.
4. Query `coordinator_assignments` to verify an active link exists.
5. Query `sub_events` to ensure it is not `PERMANENTLY_DELETED`.
6. Query the resource (e.g., `attendance_records`) to verify it strictly belongs to the verified `sub_event_id`.
7. Execute action.

---

## 11. Deleted Sub-Event / Coordinator Access

- **Archived/Deleted Sub-events**: If an Admin archives or deletes a sub-event, the `coordinator_assignments` may persist (if soft deleted).
- **Behavior**: The Edge Function checks `sub_events.status`. If `ARCHIVED` or `DELETED`, mutations (e.g., attendance check-in, result locking) are strictly rejected with a `403 Forbidden` ("This sub-event is locked/archived").
- **UI UX**: The Coordinator dashboard filters out `PERMANENTLY_DELETED` events, but may show `ARCHIVED` events in a read-only historical view.

---

## 12. Student Account Lifecycle

- `ACTIVE` -> `DEACTIVATED` -> `ANONYMIZED`
- A deactivated student loses login capability (via Supabase Auth ban or DB-level check in Edge Functions).
- Because `registrations` and `team_members` use `ON DELETE SET NULL`, if a student requests GDPR deletion (Anonymized/Deleted auth record), their historical name/college/roll_number snapshots in `team_members` remain intact to preserve the event's historical integrity and certificate generation capability.

---

## 13. Student Password Reset

**Explicit Product Decision**: KITS-EOS v3 does NOT feature a "Forgot Password" or password reset workflow for Students. If a student forgets their password, the account is effectively unrecoverable by design. No tables, views, or endpoints will be built to support password resets.

---

## 14. Session Management

- **Admin/Student (Supabase Auth)**: Managed natively by Supabase GoTrue. Access tokens live for 1 hour, refresh tokens rotate. Revoking an account in Supabase immediately invalidates refresh capability.
- **Coordinator**: JWTs have a short 4-hour lifespan. No refresh token is implemented. A session invalidation check (`token_version` column in `coordinators` incremented on password change/admin action) ensures compromised sessions can be killed instantly.

---

## 15. Rate Limiting & Abuse Protection

*To be implemented in Edge Functions / WAF layer:*
- **Login Endpoints**: Max 5 attempts per 15 minutes per IP/Username pair for both Students and Coordinators.
- **QR Scanning**: Max 30 scans per minute per Coordinator to prevent rapid-fire brute forcing of QR tokens.
- **Public API**: Strict IP-based rate limits for event listing to prevent scraping.

---

## 16. CSRF, XSS & Token Security

- **XSS Mitigation**: React natively escapes variables. Coordinator JWTs are strictly `HttpOnly` and cannot be accessed via `document.cookie`.
- **CSRF Mitigation**: Because Coordinator tokens use Cookies, `SameSite=Strict` prevents cross-origin submission. Additionally, non-simple requests (POST/PUT) require an `X-Requested-With` or custom Anti-CSRF header that the Edge Function validates.
- **Local Storage**: Only non-sensitive state (UI preferences, cached static event data) is stored in `localStorage`. 

---

## 17. Role Escalation Protection

- **Rule**: The frontend UI is treated as completely untrusted. 
- A payload like `{ "role": "ADMIN" }` sent to an update-profile endpoint is silently dropped because the Edge Function uses explicit field whitelisting. 
- A payload like `{ "sub_event_id": "<another_event>" }` is caught because the Coordinator's `sub` is cross-referenced against `coordinator_assignments` on the server before ANY database modification.

---

## 18. API Authorization Flow (Edge Middleware Concept)

```text
Request Arrives (Deno Edge Function)
 ├─> Validate JWT (Supabase Auth or Coordinator HMAC)
 ├─> Extract Principal Identity (user_id or coordinator_id)
 ├─> Lookup Principal DB Record (Verify ACTIVE status)
 ├─> Apply Role-Specific Strategy:
 │    ├─> If STUDENT: Check ownership of requested resource.
 │    ├─> If ADMIN: Bypass resource ownership checks.
 │    └─> If COORDINATOR: Validate against coordinator_assignments.
 ├─> Validate Business Constraints (Is event active? Are results locked?)
 └─> Execute Database Transaction using Service-Role Key.
```

---

## 19. Audit Logging

Sensitive operations write a JSON record to `audit_logs`:
- **Auth**: Coordinator logins (success/failure), Admin provisioning, Account deactivation.
- **Mutations**: Results locked, Certificate manually corrected, Sub-event deleted, Coordinator assignment changed, Refund issued.
- **Never Logged**: Passwords, hashes, raw JWTs, PII payloads.

---

## 20. Edge Cases Analysis

1. **Student deleted while Team Leader**: `leader_id` becomes `NULL`. Registration persists. The team members retain their certificates and historical snapshots, but no one can modify the registration payload.
2. **Team Member creates account after registration**: If they sign up with an email matching the registration (or link manually), they gain read-access to their `team_member` historical record.
3. **Coordinator assigned to multiple sub-events**: Edge Function returns a list of assigned events; frontend forces coordinator to "select" an active context.
4. **Coordinator removed from one assignment while logged in**: Next API request to that `sub_event_id` immediately fails step 4 of the Authorization Flow (403 Forbidden).
5. **Coordinator password reset by Admin while logged in**: Admin action increments `token_version` on `coordinators`. Next API request reads `token_version`, notices a mismatch with JWT claim, and issues 401 Unauthorized.
6. **Sub-event deleted while coordinator logged in**: Next API request reads `sub_events.status == 'PERMANENTLY_DELETED'`, fails with 403 Forbidden.
7. **Student attempts coordinator route**: Edge Function expects a Coordinator HMAC JWT, receives a Supabase Auth RS256 JWT, validation fails -> 401 Unauthorized.
8. **User manipulates JWT**: HMAC signature becomes invalid. Edge Function verification fails -> 401 Unauthorized.
