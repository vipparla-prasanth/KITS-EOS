-- 017_event_schema_update.sql

-- Add the required fields for full event functionality.
-- These are added as NOT NULL because we have verified there are 0 existing events.
ALTER TABLE public.events
  ADD COLUMN description TEXT,
  ADD COLUMN start_date TIMESTAMPTZ NOT NULL,
  ADD COLUMN end_date TIMESTAMPTZ NOT NULL;

-- Enforce strictly positive event durations.
ALTER TABLE public.events
  ADD CONSTRAINT events_date_check CHECK (end_date > start_date);
