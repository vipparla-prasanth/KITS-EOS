-- ============================================================================
-- Migration 090: Student Published Results & Notification Integration
-- ============================================================================
-- 1. Introduces public.get_student_published_results() RPC:
--    - Minimal, read-only, SECURITY DEFINER with SET search_path = ''.
--    - Verifies auth.uid() server-side; checks authoritative participation
--      (solo leader, team leader, or team member).
--    - Filters strictly to officially published results (results_published = TRUE
--      AND results_locked = TRUE).
--    - Evaluates student's standing server-side: WINNER, RUNNER, THIRD_PLACE, NONE.
--    - Returns minimal podium names (team name for TEAM, participant name for SOLO or solo competitors).
--    - Returns third place only if a valid third_team_id exists.
--    - References existing achievement certificate if available.
--    - Zero leakage of unpublished data, competitor PII, or internal tokens.
--
-- 2. Introduces trg_notify_students_on_results_published:
--    - Fires ONLY on authoritative transition: results_published transitions to TRUE
--      and results_locked is TRUE.
--    - Dispatches deterministic, idempotent notifications to affected confirmed students.
--    - Repeated runs, page visits, and reads never create duplicate notifications.
-- ============================================================================

-- 1. Student Published Results RPC
CREATE OR REPLACE FUNCTION public.get_student_published_results()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_student_id uuid;
    v_results jsonb;
BEGIN
    v_student_id := auth.uid();
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    WITH student_participations AS (
        -- Authoritative participation resolution: solo leader, team leader, or teammate
        SELECT DISTINCT ON (se.id)
            se.id AS sub_event_id,
            se.name AS sub_event_name,
            se.participation_type::text AS participation_type,
            se.winner_team_id,
            se.runner_team_id,
            se.third_team_id,
            se.results_published_at,
            t.id AS my_team_id,
            tm.id AS my_member_id,
            COALESCE(e.name, ce.name, 'Flagship Event') AS event_name,
            COALESCE(cat.name, 'General Track') AS category_name
        FROM public.registrations r
        JOIN public.sub_events se ON se.id = r.sub_event_id
        LEFT JOIN public.events e ON e.id = se.event_id
        LEFT JOIN public.categories cat ON cat.id = se.category_id
        LEFT JOIN public.events ce ON ce.id = cat.event_id
        JOIN public.teams t ON t.registration_id = r.id
        JOIN public.team_members tm ON tm.team_id = t.id
        WHERE r.status = 'CONFIRMED'
          AND (
            tm.user_id = v_student_id 
            OR (r.leader_id = v_student_id AND tm.is_leader = true)
            OR (r.leader_id = v_student_id AND tm.user_id IS NULL)
          )
          AND se.results_published = TRUE
          AND se.results_locked = TRUE
          AND (se.winner_team_id IS NOT NULL OR se.runner_team_id IS NOT NULL)
        ORDER BY se.id, tm.is_leader DESC
    ),
    podium_resolved AS (
        SELECT
            sp.sub_event_id,
            sp.sub_event_name,
            sp.event_name,
            sp.category_name,
            sp.participation_type,
            sp.results_published_at,

            -- Winner display name: Team name for TEAM, participant name for SOLO or Solo Participant
            CASE
                WHEN sp.participation_type = 'SOLO' OR (SELECT wt.team_name FROM public.teams wt WHERE wt.id = sp.winner_team_id LIMIT 1) = 'Solo Participant' THEN
                    COALESCE(
                        (SELECT wtm.snapshot_name FROM public.team_members wtm WHERE wtm.team_id = sp.winner_team_id LIMIT 1),
                        'Winner'
                    )
                ELSE
                    COALESCE(
                        (SELECT wt.team_name FROM public.teams wt WHERE wt.id = sp.winner_team_id LIMIT 1),
                        'Winning Team'
                    )
            END AS winner_name,

            -- Runner-up display name: Team name for TEAM, participant name for SOLO or Solo Participant
            CASE
                WHEN sp.participation_type = 'SOLO' OR (SELECT rt.team_name FROM public.teams rt WHERE rt.id = sp.runner_team_id LIMIT 1) = 'Solo Participant' THEN
                    COALESCE(
                        (SELECT rtm.snapshot_name FROM public.team_members rtm WHERE rtm.team_id = sp.runner_team_id LIMIT 1),
                        'Runner-Up'
                    )
                ELSE
                    COALESCE(
                        (SELECT rt.team_name FROM public.teams rt WHERE rt.id = sp.runner_team_id LIMIT 1),
                        'Runner-Up Team'
                    )
            END AS runner_name,

            -- Third place: ONLY if non-null and valid
            sp.third_team_id IS NOT NULL AS has_third_place,
            CASE
                WHEN sp.third_team_id IS NOT NULL THEN
                    CASE
                        WHEN sp.participation_type = 'SOLO' OR (SELECT tt.team_name FROM public.teams tt WHERE tt.id = sp.third_team_id LIMIT 1) = 'Solo Participant' THEN
                            (SELECT ttm.snapshot_name FROM public.team_members ttm WHERE ttm.team_id = sp.third_team_id LIMIT 1)
                        ELSE
                            (SELECT tt.team_name FROM public.teams tt WHERE tt.id = sp.third_team_id LIMIT 1)
                    END
                ELSE NULL
            END AS third_name,

            -- Authoritative Server-Side Standing
            CASE
                WHEN sp.my_team_id = sp.winner_team_id THEN 'WINNER'
                WHEN sp.my_team_id = sp.runner_team_id THEN 'RUNNER'
                WHEN sp.third_team_id IS NOT NULL AND sp.my_team_id = sp.third_team_id THEN 'THIRD_PLACE'
                ELSE 'NONE'
            END AS my_position,

            -- Existing achievement certificate reference (if issued)
            (
                SELECT c.certificate_code
                FROM public.certificates c
                WHERE c.sub_event_id = sp.sub_event_id
                  AND c.team_member_id = sp.my_member_id
                  AND c.type IN ('WINNER', 'RUNNER', 'THIRD_PLACE')
                LIMIT 1
            ) AS achievement_certificate_code,

            (
                SELECT c.id
                FROM public.certificates c
                WHERE c.sub_event_id = sp.sub_event_id
                  AND c.team_member_id = sp.my_member_id
                  AND c.type IN ('WINNER', 'RUNNER', 'THIRD_PLACE')
                LIMIT 1
            ) AS achievement_certificate_id,

            (
                SELECT c.status::text
                FROM public.certificates c
                WHERE c.sub_event_id = sp.sub_event_id
                  AND c.team_member_id = sp.my_member_id
                  AND c.type IN ('WINNER', 'RUNNER', 'THIRD_PLACE')
                LIMIT 1
            ) AS achievement_certificate_status

        FROM student_participations sp
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'sub_event_id', pr.sub_event_id,
                'sub_event_name', pr.sub_event_name,
                'event_name', pr.event_name,
                'category_name', pr.category_name,
                'participation_type', pr.participation_type,
                'winner_name', pr.winner_name,
                'runner_name', pr.runner_name,
                'has_third_place', pr.has_third_place,
                'third_name', pr.third_name,
                'my_position', pr.my_position,
                'achievement_certificate_code', pr.achievement_certificate_code,
                'achievement_certificate_id', pr.achievement_certificate_id,
                'achievement_certificate_status', pr.achievement_certificate_status,
                'results_published_at', pr.results_published_at
            ) ORDER BY pr.results_published_at DESC NULLS LAST
        ),
        '[]'::jsonb
    )
    INTO v_results
    FROM podium_resolved pr;

    RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_published_results() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_published_results() TO authenticated;


-- 2. Idempotent Result Publication Notification Trigger
CREATE OR REPLACE FUNCTION public.trigger_notify_students_on_results_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event_name text;
    v_student record;
    v_clean_title text := '🏆 Results Published';
    v_clean_message text;
    v_broadcast_id uuid;
BEGIN
    -- Fire ONLY on actual transition into officially published & locked state
    IF (
        (OLD.results_published IS DISTINCT FROM TRUE) 
        AND NEW.results_published = TRUE 
        AND NEW.results_locked = TRUE
    ) THEN
        -- Resolve event name
        SELECT pg_catalog.coalesce(e.name, ce.name, 'Event') INTO v_event_name
        FROM public.sub_events se
        LEFT JOIN public.events e ON e.id = se.event_id
        LEFT JOIN public.categories cat ON cat.id = se.category_id
        LEFT JOIN public.events ce ON ce.id = cat.event_id
        WHERE se.id = NEW.id;

        v_clean_message := 'Results for ' || NEW.name || ' — ' || pg_catalog.coalesce(v_event_name, 'Event') || ' have been published. View your result and certificate.';
        v_broadcast_id := pg_catalog.md5(NEW.id::text || '-results-published')::uuid;

        -- Find all confirmed students (leaders and team members) who participated
        FOR v_student IN
            SELECT DISTINCT pg_catalog.coalesce(tm.user_id, r.leader_id) AS student_user_id
            FROM public.registrations r
            JOIN public.teams t ON t.registration_id = r.id
            JOIN public.team_members tm ON tm.team_id = t.id
            WHERE r.sub_event_id = NEW.id
              AND r.status = 'CONFIRMED'
              AND pg_catalog.coalesce(tm.user_id, r.leader_id) IS NOT NULL
        LOOP
            -- Strict idempotency check: never insert duplicate result notifications
            IF NOT EXISTS (
                SELECT 1 FROM public.notifications n
                WHERE n.user_id = v_student.student_user_id
                  AND (
                    n.broadcast_id = v_broadcast_id 
                    OR (n.title = v_clean_title AND n.message = v_clean_message)
                  )
            ) THEN
                INSERT INTO public.notifications (
                    broadcast_id,
                    user_id,
                    coordinator_id,
                    recipient_role,
                    audience,
                    title,
                    message,
                    is_read,
                    created_at
                ) VALUES (
                    v_broadcast_id,
                    v_student.student_user_id,
                    NULL,
                    'STUDENT',
                    'STUDENT',
                    v_clean_title,
                    v_clean_message,
                    FALSE,
                    pg_catalog.now()
                );
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_students_on_results_published ON public.sub_events;
CREATE TRIGGER trg_notify_students_on_results_published
AFTER UPDATE OF results_published, results_locked ON public.sub_events
FOR EACH ROW
EXECUTE FUNCTION public.trigger_notify_students_on_results_published();
