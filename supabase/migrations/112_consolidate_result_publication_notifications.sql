-- ============================================================================
-- Migration 112: Consolidate Result Publication Notifications & Cleanup Redundant Triggers
-- ============================================================================
--
-- Forensic Findings:
-- 1. Redundant Result Triggers:
--    - trg_notify_students_on_results_published (added in migration 090/093)
--    - trg_notify_on_results_published (added in migration 099)
--    Both triggers fired concurrently when an admin locked and published results
--    for a sub-event. This caused duplicate notifications for every confirmed
--    student participant, wrote conflicting schemas (one missing category/event_key),
--    and generated unnecessary write amplification.
--
-- 2. Authoritative Business Rule:
--    - Result publication notifications must execute ONLY when the actual business
--      state transition occurs: results_published (FALSE -> TRUE) AND results_locked = TRUE.
--    - Unrelated metadata edits, pre-publication edits, and updates to already-published
--      events must NEVER fire notifications.
--    - Notifications must remain synchronous, transaction-safe, and idempotent
--      via the unique constraint on event_key.
--
-- Actions:
-- 1. Drop redundant trigger trg_notify_students_on_results_published and its function.
-- 2. Consolidate logic into trigger_notify_on_results_published() with full schema fidelity,
--    parent event name resolution, and ON CONFLICT (event_key) DO NOTHING deduplication.
-- 3. Replace trg_notify_on_results_published with strict UPDATE OF results_published, results_locked
--    and precise WHEN guard ensuring execution ONLY on false -> true transition.
-- ============================================================================

-- Step 1: Drop redundant student result publication trigger and function
DROP TRIGGER IF EXISTS trg_notify_students_on_results_published ON public.sub_events;
DROP FUNCTION IF EXISTS public.trigger_notify_students_on_results_published();

-- Step 2: Consolidate and harden the authoritative result notification function
CREATE OR REPLACE FUNCTION public.trigger_notify_on_results_published()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_parent_event_name TEXT;
    v_participant RECORD;
    v_coord RECORD;
    v_event_key TEXT;
    v_student_title TEXT := '🏆 Results Published';
    v_student_message TEXT;
    v_coord_title TEXT := 'Results Published';
    v_coord_message TEXT;
BEGIN
    -- Strict authoritative business guard:
    -- Execute ONLY when transitioning from unpublished to published,
    -- AND when results are officially locked.
    IF (
        (OLD.results_published IS DISTINCT FROM TRUE)
        AND NEW.results_published IS TRUE
        AND NEW.results_locked IS TRUE
    ) THEN
        -- Resolve parent event name for rich contextual notification
        SELECT COALESCE(e.name, ce.name, 'Event')
        INTO v_parent_event_name
        FROM public.sub_events se
        LEFT JOIN public.events e ON e.id = se.event_id
        LEFT JOIN public.categories cat ON cat.id = se.category_id
        LEFT JOIN public.events ce ON ce.id = cat.event_id
        WHERE se.id = NEW.id;

        v_student_message := 'Results for ' || NEW.name || ' — ' || COALESCE(v_parent_event_name, 'Event') || ' have been published. View your result and certificate.';
        v_coord_message := 'Results for ' || NEW.name || ' have been approved and published by Admin.';

        -- 1. Notify all confirmed participating students (both leaders and team members)
        FOR v_participant IN
            SELECT DISTINCT COALESCE(tm.user_id, r.leader_id) AS user_id
            FROM public.registrations r
            JOIN public.teams t ON t.registration_id = r.id
            JOIN public.team_members tm ON tm.team_id = t.id
            WHERE r.sub_event_id = NEW.id
              AND r.status = 'CONFIRMED'
              AND COALESCE(tm.user_id, r.leader_id) IS NOT NULL
        LOOP
            v_event_key := 'RESULT_PUBLISHED:' || NEW.id::text || ':' || v_participant.user_id::text;
            INSERT INTO public.notifications (
                user_id,
                coordinator_id,
                recipient_role,
                notification_type,
                category,
                entity_type,
                entity_id,
                title,
                message,
                event_key,
                metadata,
                is_read,
                created_at
            ) VALUES (
                v_participant.user_id,
                NULL,
                'STUDENT',
                'RESULT_PUBLISHED',
                'RESULTS',
                'SUB_EVENT',
                NEW.id,
                v_student_title,
                v_student_message,
                v_event_key,
                jsonb_build_object(
                    'sub_event_id', NEW.id,
                    'sub_event_name', NEW.name,
                    'parent_event_name', v_parent_event_name
                ),
                FALSE,
                NOW()
            )
            ON CONFLICT (event_key) DO NOTHING;
        END LOOP;

        -- 2. Notify assigned coordinators
        FOR v_coord IN
            SELECT coordinator_id
            FROM public.coordinator_assignments
            WHERE sub_event_id = NEW.id
        LOOP
            v_event_key := 'COORD_RESULT_PUBLISHED:' || NEW.id::text || ':' || v_coord.coordinator_id::text;
            INSERT INTO public.notifications (
                user_id,
                coordinator_id,
                recipient_role,
                notification_type,
                category,
                entity_type,
                entity_id,
                title,
                message,
                event_key,
                metadata,
                is_read,
                created_at
            ) VALUES (
                NULL,
                v_coord.coordinator_id,
                'COORDINATOR',
                'RESULT_PUBLISHED',
                'RESULTS',
                'SUB_EVENT',
                NEW.id,
                v_coord_title,
                v_coord_message,
                v_event_key,
                jsonb_build_object(
                    'sub_event_id', NEW.id,
                    'sub_event_name', NEW.name
                ),
                FALSE,
                NOW()
            )
            ON CONFLICT (event_key) DO NOTHING;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

-- Step 3: Replace trigger with strict column filter and WHEN guard
DROP TRIGGER IF EXISTS trg_notify_on_results_published ON public.sub_events;
CREATE TRIGGER trg_notify_on_results_published
AFTER UPDATE OF results_published, results_locked ON public.sub_events
FOR EACH ROW
WHEN (
    (OLD.results_published IS DISTINCT FROM TRUE)
    AND NEW.results_published IS TRUE
    AND NEW.results_locked IS TRUE
)
EXECUTE FUNCTION public.trigger_notify_on_results_published();
