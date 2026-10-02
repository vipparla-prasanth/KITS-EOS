-- Migration 052: Backend Scalability & Workload Indexes
-- KITS-EOS Production Backend Scalability Phase
--
-- Exact verified indexes supporting active production queries:
-- 1. documents: (entity_id, entity_type) - high-cardinality leading seek for document lookups and roster queries
-- 2. payments: (amount) WHERE status = 'SUCCESS' - partial index for aggregate revenue summation
-- 3. payments: (registration_id) - foreign key index for payments by registration across all statuses
-- 4. team_members: (team_id) - foreign key index for RLS evaluation and roster CTE joins
-- 5. team_members: (user_id) - student authorization checks in attendance and certificate RLS policies
-- 6. team_members: (UPPER(snapshot_roll_number)) - case-insensitive set-based B-tree seek for roll number duplicate check
-- 7. notifications: (user_id) WHERE is_read = false - partial index for unread notification count lookups
-- 8. notifications: (user_id, created_at DESC) - composite index for notification feed with zero in-memory sort
-- 9. sub_events: (event_id, status) - composite seek covering event hierarchy and active status
-- 10. categories: (event_id, status) - composite seek covering category hierarchy and active status
-- 11. audit_logs: (created_at DESC) - pre-sorted B-tree index for recent dashboard activity (LIMIT 6)
--
-- Exact dropped indexes (100% duplicate B-trees of existing UNIQUE constraints):
-- 1. idx_coordinator_sessions_token_hash (subsumed by coordinator_sessions_token_hash_key)
-- 2. idx_team_members_manual_token (subsumed by team_members_manual_token_key)
-- 3. idx_team_members_qr_identity (subsumed by team_members_qr_identity_key)
-- 4. idx_teams_registration (subsumed by teams_registration_id_key)
-- Note: idx_notifications_is_read is explicitly RETAINED.

-- ============================================================================
-- 1. CREATE VERIFIED ACCESS PATH INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_documents_entity_id_type
    ON public.documents (entity_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_payments_success_revenue
    ON public.payments (amount)
    WHERE status = 'SUCCESS';

CREATE INDEX IF NOT EXISTS idx_payments_registration_id
    ON public.payments (registration_id);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id
    ON public.team_members (team_id);

CREATE INDEX IF NOT EXISTS idx_team_members_user_id
    ON public.team_members (user_id);

CREATE INDEX IF NOT EXISTS idx_team_members_roll_upper
    ON public.team_members (UPPER(snapshot_roll_number));

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON public.notifications (user_id)
    WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_user_feed
    ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sub_events_event_id_status
    ON public.sub_events (event_id, status);

CREATE INDEX IF NOT EXISTS idx_categories_event_id_status
    ON public.categories (event_id, status);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON public.audit_logs (created_at DESC);

-- ============================================================================
-- 2. DROP PROVEN EXACT DUPLICATES OF UNIQUE CONSTRAINTS
-- ============================================================================

DROP INDEX IF EXISTS public.idx_coordinator_sessions_token_hash;
DROP INDEX IF EXISTS public.idx_team_members_manual_token;
DROP INDEX IF EXISTS public.idx_team_members_qr_identity;
DROP INDEX IF EXISTS public.idx_teams_registration;
