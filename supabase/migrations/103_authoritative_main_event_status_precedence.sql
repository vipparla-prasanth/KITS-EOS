-- 103_authoritative_main_event_status_precedence.sql
-- Production Migration:
-- 1. Updates public.effective_status(public.sub_events) so that Main Event status is the authoritative source of truth.
--    If Main Event status is COMPLETED, all child categories and sub-events are strictly COMPLETED.
-- 2. Updates public.validate_coordinator_session(text) to expose Main Event effective_status, manual_status,
--    and sub-event effective_status to coordinator clients.
-- 3. Updates public.get_coordinator_sub_event_roster(text, uuid) to include sub-event & parent event effective status.

-- ============================================================================
-- 1. AUTHORITATIVE SUB-EVENT LIFECYCLE RESOLVER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.effective_status(p_sub public.sub_events)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_ev public.events;
    v_parent_status TEXT;
    v_cat public.categories;
BEGIN
    -- =========================================================================
    -- Priority 0: Authoritative Main Event Status Precedence
    -- Main Event is the single source of truth. If Main Event is COMPLETED,
    -- everything inside (categories, sub-events) is strictly COMPLETED.
    -- =========================================================================
    SELECT e.* INTO v_ev
    FROM public.events e
    WHERE e.id = p_sub.event_id
       OR e.id = (SELECT c.event_id FROM public.categories c WHERE c.id = p_sub.category_id);

    IF v_ev.id IS NOT NULL THEN
        -- Check if Main Event is archived or permanently deleted
        IF v_ev.status <> 'ACTIVE'::public.event_status THEN
            RETURN 'REGISTRATIONS CLOSED';
        END IF;

        -- Evaluate authoritative Main Event status
        v_parent_status := public.effective_status(v_ev);
        IF v_parent_status = 'COMPLETED' OR v_ev.manual_status = 'COMPLETED' OR v_ev.status::text = 'COMPLETED' THEN
            RETURN 'COMPLETED';
        END IF;
    END IF;

    -- Check Category status if linked
    IF p_sub.category_id IS NOT NULL THEN
        SELECT * INTO v_cat FROM public.categories WHERE id = p_sub.category_id;
        IF v_cat.id IS NOT NULL AND v_cat.status <> 'ACTIVE'::public.event_status THEN
            RETURN 'REGISTRATIONS CLOSED';
        END IF;
    END IF;

    -- Priority 1: Physical Schedule Precedence
    -- A. COMPLETED: NOW() >= end_time
    IF p_sub.end_time IS NOT NULL AND v_now >= p_sub.end_time THEN
        RETURN 'COMPLETED';
    END IF;

    -- B. ONGOING: NOW() >= start_time AND NOW() < end_time
    IF p_sub.start_time IS NOT NULL AND v_now >= p_sub.start_time THEN
        RETURN 'ONGOING';
    END IF;

    -- Priority 2: Sub-event Manual Override (Applicable before start_time)
    IF p_sub.status_mode = 'MANUAL' AND p_sub.manual_status IS NOT NULL THEN
        RETURN p_sub.manual_status;
    END IF;

    -- Priority 3: Sub-event capacity check
    IF p_sub.max_capacity IS NOT NULL AND p_sub.registered_count >= p_sub.max_capacity THEN
        RETURN 'REGISTRATIONS CLOSED';
    END IF;

    -- Priority 4: Parent Main Event Registration Gate & Progression
    IF v_ev.id IS NOT NULL THEN
        IF v_parent_status = 'REGISTRATIONS OPEN' THEN
            RETURN 'REGISTRATIONS OPEN';
        ELSIF v_parent_status = 'UPCOMING' THEN
            RETURN 'UPCOMING';
        ELSIF v_parent_status = 'ONGOING' THEN
            RETURN 'ONGOING';
        ELSE
            RETURN 'REGISTRATIONS CLOSED';
        END IF;
    END IF;

    RETURN 'UPCOMING';
END;
$$;

-- ============================================================================
-- 2. VALIDATE COORDINATOR SESSION (ENRICHED WITH AUTHORITATIVE STATUSES)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_coordinator_session(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
    v_session public.coordinator_sessions%ROWTYPE;
    v_coord public.coordinators%ROWTYPE;
    v_assignments JSONB;
    v_active_count INT;
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Session token is required',
            'access_state', 'INVALID_SESSION'
        );
    END IF;

    v_token_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

    -- Find session record
    SELECT * INTO v_session
    FROM public.coordinator_sessions
    WHERE token_hash = v_token_hash;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid session token',
            'access_state', 'INVALID_SESSION'
        );
    END IF;

    -- Strict 1-Hour Session Lifetime Verification
    IF v_session.expires_at <= now() OR v_session.created_at <= (now() - interval '1 hour') THEN
        -- Clean up expired session
        DELETE FROM public.coordinator_sessions WHERE token_hash = v_token_hash;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Session has expired. Please log in again.',
            'access_state', 'INVALID_SESSION'
        );
    END IF;

    -- Fetch coordinator profile
    SELECT * INTO v_coord
    FROM public.coordinators
    WHERE id = v_session.coordinator_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Coordinator account not found',
            'access_state', 'INVALID_SESSION'
        );
    END IF;

    IF v_coord.status != 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Coordinator account is inactive or suspended',
            'access_state', 'INACTIVE_OR_SUSPENDED'
        );
    END IF;

    -- Touch session last_active_at (does NOT extend expires_at or created_at)
    UPDATE public.coordinator_sessions
    SET last_active_at = now()
    WHERE token_hash = v_token_hash;

    -- Fetch active assigned sub-events strictly belonging to active events/categories
    -- Enriched with authoritative Main Event and Sub-Event effective statuses
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ca.id,
            'coordinator_id', ca.coordinator_id,
            'sub_event_id', ca.sub_event_id,
            'sub_events', jsonb_build_object(
                'id', se.id,
                'name', se.name,
                'description', se.description,
                'rules', se.rules,
                'banner_path', se.banner_path,
                'start_time', se.start_time,
                'end_time', se.end_time,
                'venue', se.venue,
                'participation_type', se.participation_type,
                'max_team_size', se.max_team_size,
                'fee_amount_solo', se.fee_amount_solo,
                'fee_amount_team', se.fee_amount_team,
                'results_locked', se.results_locked,
                'status', se.status,
                'status_mode', se.status_mode,
                'manual_status', se.manual_status,
                'effective_status', public.effective_status(se),
                'category_id', se.category_id,
                'event_id', se.event_id,
                'categories', CASE WHEN cat.id IS NOT NULL THEN jsonb_build_object(
                    'id', cat.id,
                    'name', cat.name,
                    'status', cat.status,
                    'event_id', cat.event_id,
                    'events', CASE WHEN ce.id IS NOT NULL THEN jsonb_build_object(
                        'id', ce.id,
                        'name', ce.name,
                        'status', ce.status,
                        'status_mode', ce.status_mode,
                        'manual_status', ce.manual_status,
                        'start_date', ce.start_date,
                        'end_date', ce.end_date,
                        'effective_status', public.effective_status(ce)
                    ) ELSE NULL END
                ) ELSE NULL END,
                'events', CASE WHEN e.id IS NOT NULL THEN jsonb_build_object(
                    'id', e.id,
                    'name', e.name,
                    'status', e.status,
                    'status_mode', e.status_mode,
                    'manual_status', e.manual_status,
                    'start_date', e.start_date,
                    'end_date', e.end_date,
                    'effective_status', public.effective_status(e)
                ) ELSE NULL END
            )
        ) ORDER BY se.name ASC
    ), '[]'::jsonb)
    INTO v_assignments
    FROM public.coordinator_assignments ca
    JOIN public.sub_events se ON se.id = ca.sub_event_id
    LEFT JOIN public.categories cat ON cat.id = se.category_id
    LEFT JOIN public.events ce ON ce.id = cat.event_id
    LEFT JOIN public.events e ON e.id = se.event_id
    WHERE ca.coordinator_id = v_coord.id
      AND se.status = 'ACTIVE'
      AND (
          (e.id IS NOT NULL AND e.status = 'ACTIVE')
          OR
          (ce.id IS NOT NULL AND ce.status = 'ACTIVE')
      );

    v_active_count := jsonb_array_length(v_assignments);

    IF v_active_count > 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'access_state', 'AUTHORIZED',
            'coordinator', jsonb_build_object(
                'id', v_coord.id,
                'username', v_coord.username,
                'display_name', v_coord.display_name,
                'phone_number', v_coord.phone_number,
                'coordinator_type', v_coord.coordinator_type,
                'status', v_coord.status
            ),
            'active_assignments_count', v_active_count,
            'assignments', v_assignments,
            'state_detail', 'ACTIVE_ASSIGNMENTS',
            'expires_at', v_session.expires_at
        );
    ELSE
        RETURN jsonb_build_object(
            'success', true,
            'access_state', 'NO_ASSIGNMENTS',
            'coordinator', jsonb_build_object(
                'id', v_coord.id,
                'username', v_coord.username,
                'display_name', v_coord.display_name,
                'phone_number', v_coord.phone_number,
                'coordinator_type', v_coord.coordinator_type,
                'status', v_coord.status
            ),
            'active_assignments_count', 0,
            'assignments', '[]'::jsonb,
            'state_detail', 'NO_ACTIVE_ASSIGNMENTS',
            'expires_at', v_session.expires_at
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coordinator_session(TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 3. GET COORDINATOR SUB-EVENT ROSTER (ENRICHED WITH EFFECTIVE STATUSES)
-- ============================================================================

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

    -- Fetch sub-event & parent event details including authoritative effective status
    SELECT 
        se.id,
        se.name,
        se.participation_type,
        se.fee_amount_solo,
        se.fee_amount_team,
        se.is_free,
        public.effective_status(se) AS effective_status,
        COALESCE(c.name, 'General') AS category_name,
        e.name AS event_name,
        public.effective_status(e) AS event_effective_status
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
                'event_name', v_sub_event.event_name,
                'effective_status', v_sub_event.effective_status,
                'event_effective_status', v_sub_event.event_effective_status
            )
        ) ORDER BY r.created_at ASC
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    LEFT JOIN pre_teams pt ON pt.registration_id = r.id
    LEFT JOIN public.student_profiles sp_lead ON sp_lead.user_id = r.leader_id
    WHERE r.sub_event_id = p_sub_event_id;

    -- CTE for attendance records
    WITH pre_att AS (
        SELECT ar.id,
               ar.registration_id,
               ar.scanned_member_id,
               ar.check_in_time,
               ar.verification_method,
               ar.notes
        FROM public.attendance_records ar
        WHERE ar.sub_event_id = p_sub_event_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', pa.id,
            'registration_id', pa.registration_id,
            'scanned_member_id', pa.scanned_member_id,
            'check_in_time', pa.check_in_time,
            'verification_method', pa.verification_method,
            'notes', pa.notes
        ) ORDER BY pa.check_in_time DESC
    ), '[]'::jsonb)
    INTO v_attendance
    FROM pre_att pa;

    RETURN jsonb_build_object(
        'success', true,
        'sub_event', jsonb_build_object(
            'id', v_sub_event.id,
            'name', v_sub_event.name,
            'participation_type', v_sub_event.participation_type,
            'fee_amount_solo', v_sub_event.fee_amount_solo,
            'fee_amount_team', v_sub_event.fee_amount_team,
            'is_free', v_sub_event.is_free,
            'category_name', v_sub_event.category_name,
            'event_name', v_sub_event.event_name,
            'effective_status', v_sub_event.effective_status,
            'event_effective_status', v_sub_event.event_effective_status
        ),
        'registrations', v_registrations,
        'attendance', v_attendance,
        'attendance_records', v_attendance
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(TEXT, UUID) TO anon, authenticated, service_role;
