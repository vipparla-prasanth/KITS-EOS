-- 019_workflow_and_coordinator_grants.sql

-- 1. Add missing fields to categories
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS banner_path VARCHAR(1024);

-- 2. Support direct sub-events under events
ALTER TABLE public.sub_events
  ALTER COLUMN category_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE RESTRICT;

-- Ensure sub-event is linked to either a category or an event
ALTER TABLE public.sub_events
  DROP CONSTRAINT IF EXISTS sub_events_parent_check,
  ADD CONSTRAINT sub_events_parent_check CHECK (category_id IS NOT NULL OR event_id IS NOT NULL);

-- 3. Add coordinator_type to coordinators table
ALTER TABLE public.coordinators
  ADD COLUMN IF NOT EXISTS coordinator_type VARCHAR(50) DEFAULT 'FACULTY';

-- 4. Grant service_role least-privilege CRUD on coordinators & coordinator_assignments
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coordinators TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coordinator_assignments TO service_role;
