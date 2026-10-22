-- ============================================================================
-- PROPOSAL: Migration Ledger Reconciliation Script
-- Target: Supabase Migration Tracking Table (supabase_migrations.schema_migrations)
-- Status: PROPOSAL ONLY - DO NOT EXECUTE WITHOUT EXPLICIT APPROVAL
-- Purpose:
--   Brings remote ledger into 100% alignment with verified executed DDL.
--   Prevents `supabase db push` or future migrations from trying to re-execute
--   already-applied schema modifications.
-- ============================================================================

BEGIN;

-- Ensure schema_migrations table exists (standard Supabase CLI ledger)
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version CHARACTER VARYING(255) PRIMARY KEY,
    name TEXT,
    statements TEXT[]
);

-- Reconcile Migrations 123, 125, 126, 133, and 134
-- Note: 'ON CONFLICT (version) DO NOTHING' guarantees zero disruption to existing records
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES 
    (
        '20261016144500',
        '123_coordinator_assignment_selection_and_session',
        ARRAY['-- Executed via SQL Editor: Multi-assessment assignment selection support']
    ),
    (
        '20261016145000',
        '125_fix_assessment_live_events_reopen_constraint',
        ARRAY['-- Executed via SQL Editor: Extended event_type check constraint for ASSESSMENT_REOPENED']
    ),
    (
        '20261017120000',
        '126_secure_exposed_maintenance_rpcs',
        ARRAY['-- Executed via SQL Editor: Hardened purge_expired_form_drafts and search paths']
    ),
    (
        '20261021120000',
        '133_fix_assessment_live_host_recent_activity_key',
        ARRAY['-- Executed via SQL Editor: Harmonized live host telemetry contract with recent_activity and recent_events']
    ),
    (
        '20261021130000',
        '134_optimize_assessment_autosave_and_snapshot',
        ARRAY['-- Executed via SQL Editor: Covering index idx_assessment_attempt_answers_scoring_cov, milestone telemetry, student_view_question, 15m coordinator inactivity']
    )
ON CONFLICT (version) DO NOTHING;

COMMIT;
