# KITS-EOS v3 Database Architecture & Schema Design

## 1. Architecture Overview
The database uses a normalized relational model in PostgreSQL (Supabase) designed to support 15,000–20,000 members while strictly ensuring data integrity, historical preservation, and transaction safety. Complex operations, validations, and custom authentications bypass direct client-database interactions and are strictly enforced via Supabase Edge Functions.

## 2. Entity List
- **User Management**: `users` (Students/Admins), `student_profiles`
- **Coordinators**: `coordinators` (Username/Password isolated from Supabase Auth)
- **Events**: `events`, `categories`, `sub_events`, `coordinator_assignments`
- **Registration Envelope**: `registrations`, `teams`, `team_members`
- **Operations**: `payments`, `attendance_records`
- **Documents & Certificates**: `documents`, `certificates`, `certificate_corrections`
- **Feedback & Complaints**: `feedback_responses`, `complaints`
- **System**: `audit_logs`, `notifications`

## 3. Explicit Relationship & Ownership Documentation
To ensure correct analytics and clear boundaries, the following models govern the application:

- **Registration → Team Relationship**: A **Registration** is the financial and administrative envelope for participation. It is owned by the `leader_id`. 
  - Solo participation: 1 Registration → 1 Team (size 1) → 1 Team Member.
  - Team participation: 1 Registration → 1 Team (size N) → N Team Members.
  - Analytics can accurately count `registrations` (number of participating units/payments) vs `team_members` (total individual students participating).
- **Payment Ownership**: Payments are strictly tied to the `registrations` table. The Team Leader pays for the single envelope. Individual members are never billed separately.
- **Member Identity**: Every `team_member` receives a unique `qr_identity` and `manual_token` strictly associated with that team/registration.
- **Whole-Team Attendance**: Scanning *any* valid member's QR code triggers an atomic transaction that verifies the sub-event, checks in the *entire* `team_id`, and blocks duplicate whole-team check-in via unique database constraints.
- **Certificate Ownership & Unlock**: 
  - Certificates conceptually belong to the `team_member` (they bear the member's historical details).
  - However, **Certificate Management & Unlocking** belongs exclusively to the Team Leader. The Team Leader submits the required feedback **once** on behalf of the registration to unlock the certificates for the entire team. They are the sole entity able to download the team's certificates.
- **Certificate Generation**: Certificates are generated lazily/on-demand when the unlock/download action is requested, rather than batch-generating PDFs unnecessarily.

## 4. Table-by-Table Schema Proposed

### `users` (Extends `auth.users` for Students and Admins)
- `id` (UUID, PK) -> references `auth.users(id)`
- `role` (ENUM: 'STUDENT', 'ADMIN')
- `email` (VARCHAR, Unique)
- `status` (ENUM: 'ACTIVE', 'DEACTIVATED', 'ANONYMIZED')
- `created_at` (TIMESTAMPTZ)

### `student_profiles`
- `user_id` (UUID, PK) -> references `users(id)` ON DELETE CASCADE
- `full_name` (VARCHAR)
- `roll_number` (VARCHAR, Unique)
- `college` (VARCHAR)
- `department` (VARCHAR)
- `year_of_study` (INTEGER)
- `phone` (VARCHAR)

### `coordinators` (Isolated Authentication)
*Coordinator credentials created dynamically by Admins. Not in auth.users.*
- `id` (UUID, PK)
- `username` (VARCHAR, Unique)
- `password_hash` (VARCHAR) - Passwords hashed (e.g. bcrypt). Edge Functions verify credentials and issue custom JWTs.
- `display_name` (VARCHAR)
- `contact_visible` (BOOLEAN)
- `phone_number` (VARCHAR, Nullable)
- `status` (ENUM: 'ACTIVE', 'DEACTIVATED')
- `created_at` (TIMESTAMPTZ)

### `events` (Main Events)
- `id` (UUID, PK)
- `name` (VARCHAR)
- `banner_path` (VARCHAR, Nullable) - Storage path for main banner
- `status` (ENUM: 'ACTIVE', 'ARCHIVED', 'PERMANENTLY_DELETED')

### `categories`
- `id` (UUID, PK)
- `event_id` (UUID) -> references `events(id)` ON DELETE RESTRICT
- `name` (VARCHAR)
- `status` (ENUM: 'ACTIVE', 'ARCHIVED', 'PERMANENTLY_DELETED')

### `sub_events`
*Contains complete operational configuration.*
- `id` (UUID, PK)
- `category_id` (UUID) -> references `categories(id)` ON DELETE RESTRICT
- `name` (VARCHAR)
- `description` (TEXT)
- `rules` (TEXT)
- `banner_path` (VARCHAR, Nullable)
- `start_time` (TIMESTAMPTZ)
- `end_time` (TIMESTAMPTZ)
- `venue` (VARCHAR)
- `participation_type` (ENUM: 'SOLO', 'TEAM', 'BOTH')
- `max_team_size` (INTEGER) - Check: >= 1
- `fee_amount_solo` (DECIMAL)
- `fee_amount_team` (DECIMAL)
- `payment_instructions` (TEXT)
- `required_documents` (JSONB) - Defines allowed extensions/MIMEs
- `attendance_token_prefix` (VARCHAR) - Admin defined prefix
- `results_locked` (BOOLEAN) - Default: false
- `status` (ENUM: 'ACTIVE', 'ARCHIVED', 'PERMANENTLY_DELETED')

### `coordinator_assignments`
- `id` (UUID, PK)
- `coordinator_id` (UUID) -> references `coordinators(id)` ON DELETE CASCADE
- `sub_event_id` (UUID) -> references `sub_events(id)` ON DELETE CASCADE
- *Unique Constraint: (coordinator_id, sub_event_id)*

### `registrations`
*The administrative envelope.*
- `id` (UUID, PK)
- `sub_event_id` (UUID) -> references `sub_events(id)` ON DELETE RESTRICT
- `leader_id` (UUID) -> references `users(id)` ON DELETE SET NULL - Keeps record if user is deleted
- `status` (ENUM: 'PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED')
- `created_at` (TIMESTAMPTZ)
- *Unique Constraint: (sub_event_id, leader_id) where status != CANCELLED*

### `teams`
- `id` (UUID, PK)
- `registration_id` (UUID, Unique) -> references `registrations(id)` ON DELETE RESTRICT
- `team_name` (VARCHAR, Nullable)

### `team_members`
*The historical snapshot of every participating individual.*
- `id` (UUID, PK)
- `team_id` (UUID) -> references `teams(id)` ON DELETE RESTRICT
- `user_id` (UUID, Nullable) -> references `users(id)` ON DELETE SET NULL
- `is_leader` (BOOLEAN)
- `qr_identity` (UUID, Unique)
- `manual_token` (VARCHAR(10), Unique)
- *Immutable Historical Snapshots (survives account deletion):*
  - `snapshot_name` (VARCHAR)
  - `snapshot_roll_number` (VARCHAR)
  - `snapshot_college` (VARCHAR)
  - `snapshot_department` (VARCHAR)
  - `snapshot_year` (INTEGER)

### `payments`
- `id` (UUID, PK)
- `registration_id` (UUID) -> references `registrations(id)` ON DELETE RESTRICT
- `amount` (DECIMAL)
- `reference_id` (VARCHAR, Unique)
- `status` (ENUM: 'PENDING', 'SUCCESS', 'FAILED')

### `attendance_records`
- `id` (UUID, PK)
- `sub_event_id` (UUID) -> references `sub_events(id)` ON DELETE RESTRICT
- `team_id` (UUID) -> references `teams(id)` ON DELETE RESTRICT
- `scanned_member_id` (UUID) -> references `team_members(id)` ON DELETE RESTRICT
- `check_in_time` (TIMESTAMPTZ)
- `checked_in_by` (UUID) -> references `coordinators(id)` ON DELETE SET NULL
- *Unique Constraint: (sub_event_id, team_id)*

### `certificates`
- `id` (UUID, PK)
- `team_member_id` (UUID) -> references `team_members(id)` ON DELETE RESTRICT
- `sub_event_id` (UUID) -> references `sub_events(id)` ON DELETE RESTRICT
- `type` (ENUM: 'WINNER', 'RUNNER', 'PARTICIPANT')
- `status` (ENUM: 'LOCKED', 'UNLOCKED')
- `student_corrections_used` (INTEGER)
- *Unique Constraint: (team_member_id, sub_event_id)*

### `certificate_corrections`
- `id` (UUID, PK)
- `certificate_id` (UUID) -> references `certificates(id)` ON DELETE RESTRICT
- `corrected_by` (UUID) -> references `users(id)` ON DELETE SET NULL
- `old_snapshot_name` (VARCHAR)
- `new_snapshot_name` (VARCHAR)

### `documents`
- `id` (UUID, PK)
- `owner_id` (UUID) -> references `users(id)` ON DELETE SET NULL
- `entity_type` (ENUM: 'REGISTRATION', 'STUDENT_ID', 'OTHER')
- `entity_id` (UUID) - Links to `registrations.id` for reg documents
- `storage_path` (VARCHAR, Unique)
- `file_name` (VARCHAR)
- `mime_type` (VARCHAR)
- `size_bytes` (BIGINT)
- `uploaded_at` (TIMESTAMPTZ)

### `feedback_responses`
- `id` (UUID, PK)
- `sub_event_id` (UUID) -> references `sub_events(id)` ON DELETE RESTRICT
- `registration_id` (UUID, Unique) -> references `registrations(id)` ON DELETE RESTRICT
- `rating_1` to `rating_5` (INTEGER)
- `comments` (TEXT)

### `complaints`
- `id` (UUID, PK)
- `user_id` (UUID) -> references `users(id)` ON DELETE SET NULL
- `category` (VARCHAR)
- `description` (TEXT)
- `status` (ENUM: 'OPEN', 'RESOLVED', 'CLOSED')

### `audit_logs`
*Tracks all critical administrative and security actions.*
- `id` (UUID, PK)
- `actor_id` (UUID)
- `action` (VARCHAR) - E.g., 'COORDINATOR_CREATED', 'EVENT_DELETED', 'RESULTS_LOCKED', 'CERTIFICATE_CORRECTED'
- `entity_type` (VARCHAR)
- `entity_id` (UUID)
- `metadata` (JSONB)
- `created_at` (TIMESTAMPTZ)

## 5. Historical Data Strategy & Deletions
- **Foreign Key Constraints (`ON DELETE SET NULL / RESTRICT`)**: By explicitly setting `ON DELETE SET NULL` on `team_members.user_id` and `registrations.leader_id`, if a student deletes their account, the registration envelope and individual team member records (with their immutable snapshots) remain perfectly intact for historical result and certificate preservation.
- **Event Archival**: Sub-events use `ACTIVE` -> `ARCHIVED` -> `PERMANENTLY_DELETED`. `ON DELETE RESTRICT` constraints block deletion if registrations exist, forcing the Edge Function to verify data export before bypassing restrictions for a hard delete.

## 6. Security & Transaction Integrity (Attendance Workflow)
The attendance system guarantees atomicity and blocks fabrication:
1. **Verification**: Frontend scans QR/token and queries the Edge Function.
2. **Access Control**: Edge function verifies `sub_event_id` matches the token's origin, and confirms `coordinator_assignments` grants this coordinator access.
3. **Commit Phase**: Coordinator clicks "Confirm". The Edge Function begins a transaction, verifies `attendance_records` lacks a `(sub_event_id, team_id)` row, and inserts it. If another coordinator scanned simultaneously, the unique constraint causes the transaction to abort safely.

## 7. Performance Considerations & Indexes
- `idx_team_members_qr_identity`: `team_members(qr_identity)`
- `idx_team_members_manual_token`: `team_members(manual_token)`
- `idx_registrations_leader`: `registrations(leader_id)`
- `idx_teams_registration`: `teams(registration_id)`
- `idx_attendance_team_sub_event`: `attendance_records(team_id, sub_event_id)`
- `idx_coordinator_assignments_coord`: `coordinator_assignments(coordinator_id)`
- `idx_certificates_team_member`: `certificates(team_member_id)`
- *All large queries (participant lists, feedback, complaints) will use standard keyset or offset pagination enforced at the Edge Function level.*

## 8. Open Questions / Edge Cases
None. The data models and ownership workflows are explicitly locked.
