-- =============================================================================
-- Migration 067: Scoped Category-wise and Sub-event-wise Analytics RPC
-- =============================================================================
-- Authoritative, database-enforced analytical function for Admin and Coordinator panels.
--
-- Security:
-- 1. If caller is Admin (via auth.uid() & public.is_admin()): grants full system scope.
-- 2. If caller is Coordinator: requires valid p_coordinator_token. Resolves coordinator_id
--    strictly via public.get_coordinator_id_by_token(token) against coordinator_sessions.
--    Client-provided coordinator IDs are NEVER accepted or trusted.
-- 3. Coordinator data scope is strictly bounded by public.coordinator_assignments.
--    No category or sub-event data outside assignments is ever calculated or returned.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_scope_analytics(
    p_coordinator_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_is_admin BOOLEAN := FALSE;
    v_coord_id UUID := NULL;
    v_clean_token TEXT := NULL;
    v_role TEXT := 'UNAUTHORIZED';
    v_result JSONB;
BEGIN
    -- 1. Check Admin status via Supabase Auth session
    v_is_admin := public.is_admin();

    -- 2. If not Admin, resolve Coordinator identity server-side
    IF NOT v_is_admin THEN
        IF p_coordinator_token IS NOT NULL AND trim(p_coordinator_token) <> '' THEN
            v_clean_token := regexp_replace(trim(p_coordinator_token), '^Bearer\s+', '', 'i');
            v_coord_id := public.get_coordinator_id_by_token(v_clean_token);
        END IF;

        IF v_coord_id IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'UNAUTHORIZED',
                'message', 'Valid administrative or coordinator session is required to view analytics.'
            );
        END IF;

        v_role := 'COORDINATOR';
    ELSE
        v_role := 'ADMIN';
    END IF;

    -- 3. Compute Scoped Analytics
    WITH scoped_sub_events AS (
        SELECT 
            se.id,
            se.name,
            se.category_id,
            COALESCE(se.event_id, c.event_id) AS event_id,
            se.participation_type,
            COALESCE(se.fee_amount_solo, 0) AS fee_amount_solo,
            COALESCE(se.fee_amount_team, 0) AS fee_amount_team,
            COALESCE(se.results_locked, FALSE) AS results_locked,
            COALESCE(se.results_published, FALSE) AS results_published,
            se.winner_team_id,
            se.runner_team_id,
            se.third_team_id,
            c.name AS category_name,
            e.name AS event_name
        FROM public.sub_events se
        JOIN public.categories c ON c.id = se.category_id
        JOIN public.events e ON e.id = COALESCE(se.event_id, c.event_id)
        WHERE se.status <> 'PERMANENTLY_DELETED'
          AND c.status <> 'PERMANENTLY_DELETED'
          AND e.status <> 'PERMANENTLY_DELETED'
          AND (
              v_is_admin = TRUE 
              OR se.id IN (
                  SELECT ca.sub_event_id 
                  FROM public.coordinator_assignments ca 
                  WHERE ca.coordinator_id = v_coord_id
              )
          )
    ),
    sub_event_stats AS (
        SELECT
            sse.id AS sub_event_id,
            sse.name AS sub_event_name,
            sse.category_id,
            sse.category_name,
            sse.event_id,
            sse.event_name,
            sse.participation_type,
            sse.fee_amount_solo,
            sse.fee_amount_team,
            sse.results_locked,
            sse.results_published,
            sse.winner_team_id,
            sse.runner_team_id,
            sse.third_team_id,
            
            -- Registration & Member Counts
            COUNT(DISTINCT r.id) AS registration_count,
            COUNT(DISTINCT tm.id) AS total_participants,
            COUNT(DISTINCT CASE WHEN COALESCE(t.team_name, 'Solo Participant') = 'Solo Participant' THEN r.id END) AS solo_count,
            COUNT(DISTINCT CASE WHEN t.team_name IS NOT NULL AND t.team_name <> 'Solo Participant' THEN r.id END) AS team_count,
            
            -- Payments & Revenue
            COUNT(DISTINCT CASE WHEN p.status = 'SUCCESS' OR (sse.fee_amount_solo = 0 AND sse.fee_amount_team = 0) THEN r.id END) AS paid_count,
            COUNT(DISTINCT CASE WHEN p.status = 'PENDING' AND (sse.fee_amount_solo > 0 OR sse.fee_amount_team > 0) THEN r.id END) AS pending_count,
            COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' THEN p.amount ELSE 0 END), 0) AS revenue,
            
            -- Attendance
            COUNT(DISTINCT ar.scanned_member_id) AS attended_count,
            CASE 
                WHEN COUNT(DISTINCT tm.id) > 0 THEN 
                    ROUND((COUNT(DISTINCT ar.scanned_member_id)::NUMERIC / COUNT(DISTINCT tm.id)::NUMERIC) * 100, 1)
                ELSE 0 
            END AS attendance_percentage,
            
            -- Certificates
            COUNT(DISTINCT cert.id) AS certificates_count,
            
            -- Status
            CASE 
                WHEN sse.results_published THEN 'PUBLISHED'
                WHEN sse.results_locked THEN 'LOCKED'
                WHEN sse.winner_team_id IS NOT NULL THEN 'WINNERS_DECLARED'
                ELSE 'PENDING'
            END AS results_status,
            
            -- Eligible Competitors (CONFIRMED registration + attended)
            -- SOLO counts individual attended participants; TEAM counts distinct attended teams
            CASE
                WHEN sse.participation_type = 'SOLO' THEN
                    COUNT(DISTINCT CASE WHEN r.status = 'CONFIRMED' AND ar.scanned_member_id IS NOT NULL THEN tm.id END)
                ELSE
                    COUNT(DISTINCT CASE WHEN r.status = 'CONFIRMED' AND ar.scanned_member_id IS NOT NULL THEN t.id END)
            END AS eligible_competitors_count,
            
            -- Direct Publish Eligibility (< 2 eligible competitors)
            CASE
                WHEN (
                    CASE
                        WHEN sse.participation_type = 'SOLO' THEN
                            COUNT(DISTINCT CASE WHEN r.status = 'CONFIRMED' AND ar.scanned_member_id IS NOT NULL THEN tm.id END)
                        ELSE
                            COUNT(DISTINCT CASE WHEN r.status = 'CONFIRMED' AND ar.scanned_member_id IS NOT NULL THEN t.id END)
                    END
                ) < 2 THEN TRUE
                ELSE FALSE
            END AS can_direct_publish

        FROM scoped_sub_events sse
        LEFT JOIN public.registrations r ON r.sub_event_id = sse.id AND r.status <> 'CANCELLED'
        LEFT JOIN public.teams t ON t.registration_id = r.id
        LEFT JOIN public.team_members tm ON tm.team_id = t.id
        LEFT JOIN public.payments p ON p.registration_id = r.id
        LEFT JOIN public.attendance_records ar ON ar.sub_event_id = sse.id AND ar.scanned_member_id = tm.id
        LEFT JOIN public.certificates cert ON cert.sub_event_id = sse.id AND cert.team_member_id = tm.id
        GROUP BY 
            sse.id, sse.name, sse.category_id, sse.category_name, sse.event_id, sse.event_name,
            sse.participation_type, sse.fee_amount_solo, sse.fee_amount_team,
            sse.results_locked, sse.results_published, sse.winner_team_id, sse.runner_team_id, sse.third_team_id
    ),
    category_stats AS (
        SELECT
            ses.category_id,
            ses.category_name,
            ses.event_id,
            ses.event_name,
            COUNT(DISTINCT ses.sub_event_id) AS sub_events_count,
            SUM(ses.registration_count) AS total_registrations,
            SUM(ses.total_participants) AS total_participants,
            SUM(ses.solo_count) AS solo_registrations,
            SUM(ses.team_count) AS team_registrations,
            SUM(ses.paid_count) AS paid_registrations,
            SUM(ses.pending_count) AS pending_registrations,
            SUM(ses.revenue) AS total_revenue,
            SUM(ses.attended_count) AS attended_count,
            CASE 
                WHEN SUM(ses.total_participants) > 0 THEN
                    ROUND((SUM(ses.attended_count)::NUMERIC / SUM(ses.total_participants)::NUMERIC) * 100, 1)
                ELSE 0 
            END AS attendance_percentage,
            SUM(ses.certificates_count) AS certificates_count,
            COUNT(DISTINCT CASE WHEN ses.results_published THEN ses.sub_event_id END) AS published_sub_events_count
        FROM sub_event_stats ses
        GROUP BY ses.category_id, ses.category_name, ses.event_id, ses.event_name
    ),
    summary_stats AS (
        SELECT
            COUNT(DISTINCT category_id) AS total_categories,
            COUNT(DISTINCT sub_event_id) AS total_sub_events,
            COALESCE(SUM(registration_count), 0) AS total_registrations,
            COALESCE(SUM(total_participants), 0) AS total_participants,
            COALESCE(SUM(attended_count), 0) AS total_attended,
            CASE 
                WHEN SUM(total_participants) > 0 THEN
                    ROUND((SUM(attended_count)::NUMERIC / SUM(total_participants)::NUMERIC) * 100, 1)
                ELSE 0
            END AS overall_attendance_percentage,
            COALESCE(SUM(revenue), 0) AS total_revenue,
            COALESCE(SUM(certificates_count), 0) AS total_certificates
        FROM sub_event_stats
    )
    SELECT jsonb_build_object(
        'success', TRUE,
        'role', v_role,
        'scope_summary', (SELECT row_to_json(summary_stats.*) FROM summary_stats),
        'categories', COALESCE((SELECT jsonb_agg(row_to_json(cs.*)) FROM category_stats cs), '[]'::jsonb),
        'sub_events', COALESCE((SELECT jsonb_agg(row_to_json(ses.*)) FROM sub_event_stats ses), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Grant execution to authenticated and anon users (RPC enforces internal role/token authorization)
GRANT EXECUTE ON FUNCTION public.get_scope_analytics(TEXT) TO authenticated, anon, service_role;
