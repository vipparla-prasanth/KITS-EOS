-- Migration 100: Fix Coordinator Scope Analytics, Sub-Event Scoping, and Participant Roster
-- 
-- 1. Updates get_scope_analytics to:
--    - Use LEFT JOIN on categories so direct sub-events without a category (e.g. in FLOW TEST) are not dropped
--    - Support optional p_event_id and p_sub_event_id filtering
--    - Prevent null category_id in JSON serialization by coalescing with event_id
-- 2. Updates get_coordinator_sub_event_roster to:
--    - Include sub_event metadata (name, event_name, category_name, participation_type)
--    - Include primary 'payment' object along with 'payments' array

-- Drop obsolete 1-param overload to prevent ERROR 42725 (function not unique)
DROP FUNCTION IF EXISTS public.get_scope_analytics(TEXT);

CREATE OR REPLACE FUNCTION public.get_scope_analytics(
    p_coordinator_token TEXT DEFAULT NULL,
    p_event_id UUID DEFAULT NULL,
    p_sub_event_id UUID DEFAULT NULL
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

    -- 3. Compute Scoped Analytics with isolated aggregation CTEs
    WITH scoped_sub_events AS (
        SELECT 
            se.id,
            se.name,
            se.category_id,
            COALESCE(se.event_id, c.event_id) AS event_id,
            se.participation_type,
            COALESCE(se.fee_amount_solo, 0) AS fee_amount_solo,
            COALESCE(se.fee_amount_team, 0) AS fee_amount_team,
            COALESCE(se.is_free, FALSE) AS is_free,
            COALESCE(se.results_locked, FALSE) AS results_locked,
            COALESCE(se.results_published, FALSE) AS results_published,
            se.winner_team_id,
            se.runner_team_id,
            se.third_team_id,
            COALESCE(c.name, 'General') AS category_name,
            e.name AS event_name
        FROM public.sub_events se
        LEFT JOIN public.categories c ON c.id = se.category_id
        JOIN public.events e ON e.id = COALESCE(se.event_id, c.event_id)
        WHERE se.status <> 'PERMANENTLY_DELETED'
          AND (c.id IS NULL OR c.status <> 'PERMANENTLY_DELETED')
          AND e.status <> 'PERMANENTLY_DELETED'
          AND (p_event_id IS NULL OR e.id = p_event_id)
          AND (p_sub_event_id IS NULL OR se.id = p_sub_event_id)
          AND (
              v_is_admin = TRUE 
              OR se.id IN (
                  SELECT ca.sub_event_id 
                  FROM public.coordinator_assignments ca 
                  WHERE ca.coordinator_id = v_coord_id
              )
          )
    ),
    -- Dedicated payment and revenue aggregation: guarantees zero Cartesian multiplication
    sub_event_payment_stats AS (
        SELECT 
            r.sub_event_id,
            COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' THEN p.amount ELSE 0 END), 0) AS revenue,
            COUNT(DISTINCT CASE 
                WHEN p.status = 'SUCCESS' THEN r.id
                WHEN (COALESCE(sse.is_free, FALSE) OR (sse.fee_amount_solo = 0 AND sse.fee_amount_team = 0)) AND r.status = 'CONFIRMED' THEN r.id
            END) AS paid_count,
            COUNT(DISTINCT CASE 
                WHEN p.status = 'PENDING' AND NOT COALESCE(sse.is_free, FALSE) AND (sse.fee_amount_solo > 0 OR sse.fee_amount_team > 0) THEN r.id 
            END) AS pending_count
        FROM public.registrations r
        JOIN scoped_sub_events sse ON sse.id = r.sub_event_id
        LEFT JOIN public.payments p ON p.registration_id = r.id
        WHERE r.status <> 'CANCELLED'
        GROUP BY r.sub_event_id
    ),
    -- Participation, attendance, and certification statistics
    sub_event_participation_stats AS (
        SELECT
            sse.id AS sub_event_id,
            sse.name AS sub_event_name,
            COALESCE(sse.category_id, sse.event_id) AS category_id,
            sse.category_name,
            sse.event_id,
            sse.event_name,
            sse.participation_type,
            sse.fee_amount_solo,
            sse.fee_amount_team,
            sse.is_free,
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
        LEFT JOIN public.attendance_records ar ON ar.sub_event_id = sse.id AND ar.scanned_member_id = tm.id
        LEFT JOIN public.certificates cert ON cert.sub_event_id = sse.id AND cert.team_member_id = tm.id
        GROUP BY 
            sse.id, sse.name, sse.category_id, sse.category_name, sse.event_id, sse.event_name,
            sse.participation_type, sse.fee_amount_solo, sse.fee_amount_team, sse.is_free,
            sse.results_locked, sse.results_published, sse.winner_team_id, sse.runner_team_id, sse.third_team_id
    ),
    -- Clean 1-to-1 composition of participation and isolated payment metrics
    sub_event_stats AS (
        SELECT
            seps_part.*,
            COALESCE(seps.paid_count, 0) AS paid_count,
            COALESCE(seps.pending_count, 0) AS pending_count,
            COALESCE(seps.revenue, 0) AS revenue
        FROM sub_event_participation_stats seps_part
        LEFT JOIN sub_event_payment_stats seps ON seps.sub_event_id = seps_part.sub_event_id
    ),
    category_stats AS (
        SELECT
            COALESCE(ses.category_id, ses.event_id) AS category_id,
            COALESCE(ses.category_name, 'General') AS category_name,
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
        GROUP BY COALESCE(ses.category_id, ses.event_id), COALESCE(ses.category_name, 'General'), ses.event_id, ses.event_name
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

CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_roster(
    p_token TEXT,
    p_sub_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN;
    v_registrations JSONB;
    v_attendance JSONB;
    v_sub_event RECORD;
BEGIN
    SELECT public.get_coordinator_id_by_token(p_token) INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Coordinator authorization required: Invalid or expired session token.'
        );
    END IF;

    -- Fetch sub-event & parent event details
    SELECT 
        se.id,
        se.name,
        se.participation_type,
        se.fee_amount_solo,
        se.fee_amount_team,
        se.is_free,
        COALESCE(c.name, 'General') AS category_name,
        e.name AS event_name
    INTO v_sub_event
    FROM public.sub_events se
    LEFT JOIN public.categories c ON c.id = se.category_id
    JOIN public.events e ON e.id = COALESCE(se.event_id, c.event_id)
    WHERE se.id = p_sub_event_id;

    -- Strict server-side assignment verification
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.sub_events se ON se.id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord_id
          AND ca.sub_event_id = p_sub_event_id
          AND se.status = 'ACTIVE'::public.event_status
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: You do not have active assignment to operate on this sub-event.'
        );
    END IF;

    -- Set-Based CTE Aggregation (Zero Correlated Scalar Subqueries)
    WITH pre_payments AS (
        SELECT p.registration_id,
               COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'id', p.id,
                       'status', p.status,
                       'amount', p.amount,
                       'payment_method', p.payment_method,
                       'reference_id', p.reference_id,
                       'transaction_id', p.reference_id,
                       'created_at', p.created_at,
                       'updated_at', p.created_at
                   ) ORDER BY p.created_at DESC
               ), '[]'::jsonb) AS payments_json,
               jsonb_build_object(
                   'id', (array_agg(p.id ORDER BY p.created_at DESC))[1],
                   'status', (array_agg(p.status ORDER BY p.created_at DESC))[1],
                   'amount', (array_agg(p.amount ORDER BY p.created_at DESC))[1],
                   'payment_method', (array_agg(p.payment_method ORDER BY p.created_at DESC))[1],
                   'reference_id', (array_agg(p.reference_id ORDER BY p.created_at DESC))[1],
                   'created_at', (array_agg(p.created_at ORDER BY p.created_at DESC))[1]
               ) AS primary_payment_json
        FROM public.payments p
        JOIN public.registrations r ON r.id = p.registration_id
        WHERE r.sub_event_id = p_sub_event_id
        GROUP BY p.registration_id
    ),
    pre_members AS (
        SELECT tm.team_id,
               COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'id', tm.id,
                       'user_id', tm.user_id,
                       'is_leader', tm.is_leader,
                       'manual_token', tm.manual_token,
                       'qr_identity', tm.qr_identity,
                       'snapshot_name', tm.snapshot_name,
                       'snapshot_roll_number', tm.snapshot_roll_number,
                       'snapshot_college', tm.snapshot_college,
                       'snapshot_department', tm.snapshot_department,
                       'snapshot_year', tm.snapshot_year,
                       'attendance_token', tm.manual_token,
                       'student_id', tm.user_id,
                       'student_profiles', jsonb_build_object(
                           'user_id', COALESCE(tm.user_id, sp.user_id),
                           'full_name', COALESCE(tm.snapshot_name, sp.full_name),
                           'roll_number', COALESCE(tm.snapshot_roll_number, sp.roll_number),
                           'college', COALESCE(tm.snapshot_college, sp.college),
                           'department', COALESCE(tm.snapshot_department, sp.department),
                           'year_of_study', COALESCE(tm.snapshot_year, sp.year_of_study),
                           'phone', sp.phone
                       )
                   ) ORDER BY tm.is_leader DESC, tm.snapshot_name ASC
               ), '[]'::jsonb) AS members_json
        FROM public.team_members tm
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        LEFT JOIN public.student_profiles sp ON sp.user_id = tm.user_id
        WHERE r.sub_event_id = p_sub_event_id
        GROUP BY tm.team_id
    ),
    pre_teams AS (
        SELECT t.registration_id,
               jsonb_build_object(
                   'id', t.id,
                   'name', t.team_name,
                   'team_name', t.team_name,
                   'leader_id', r.leader_id,
                   'team_members', COALESCE(pm.members_json, '[]'::jsonb),
                   'members', COALESCE(pm.members_json, '[]'::jsonb)
               ) AS team_json
        FROM public.teams t
        JOIN public.registrations r ON r.id = t.registration_id
        LEFT JOIN pre_members pm ON pm.team_id = t.id
        WHERE r.sub_event_id = p_sub_event_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'sub_event_id', r.sub_event_id,
            'leader_id', r.leader_id,
            'status', r.status,
            'created_at', r.created_at,
            'teams', pt.team_json,
            'team', pt.team_json,
            'student_profiles', jsonb_build_object(
                'user_id', r.leader_id,
                'full_name', COALESCE(sp_lead.full_name, 'Participant'),
                'roll_number', sp_lead.roll_number,
                'college', sp_lead.college,
                'department', sp_lead.department,
                'year_of_study', sp_lead.year_of_study,
                'phone', sp_lead.phone
            ),
            'payments', COALESCE(pp.payments_json, '[]'::jsonb),
            'payment', pp.primary_payment_json,
            'sub_event', jsonb_build_object(
                'id', v_sub_event.id,
                'name', v_sub_event.name,
                'participation_type', v_sub_event.participation_type,
                'category_name', v_sub_event.category_name,
                'event_name', v_sub_event.event_name
            )
        ) ORDER BY r.created_at ASC
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    LEFT JOIN pre_teams pt ON pt.registration_id = r.id
    LEFT JOIN pre_payments pp ON pp.registration_id = r.id
    LEFT JOIN public.student_profiles sp_lead ON sp_lead.user_id = r.leader_id
    WHERE r.sub_event_id = p_sub_event_id;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'sub_event_id', a.sub_event_id,
            'team_id', a.team_id,
            'scanned_member_id', a.scanned_member_id,
            'check_in_time', a.check_in_time,
            'checked_in_at', a.check_in_time,
            'checked_in_by', a.checked_in_by
        )
    ), '[]'::jsonb)
    INTO v_attendance
    FROM public.attendance_records a
    WHERE a.sub_event_id = p_sub_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'coordinator_id', v_coord_id,
        'registrations', v_registrations,
        'attendance', v_attendance,
        'metrics', jsonb_build_object(
            'total_registrations', jsonb_array_length(v_registrations),
            'total_attendance', jsonb_array_length(v_attendance)
        )
    );
END;
$$;
