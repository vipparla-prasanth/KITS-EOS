-- Migration 123: Multi-Assessment Resolution and Assignment Selection Support
-- ============================================================================
-- Enhances validate_coordinator_session and coordinator_assessment_login
-- to return all assigned assessments in an 'assigned_assessments' array,
-- in addition to the primary 'assigned_assessment', enabling multi-exam
-- and dual-duty coordinators to select their desired dashboard on login.
-- ============================================================================

-- ============================================================================
-- 1. ENHANCED COORDINATOR ASSESSMENT LOGIN RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.coordinator_assessment_login(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_clean_username TEXT;
    v_coord RECORD;
    v_input_hash TEXT;
    v_raw_token TEXT;
    v_token_hash TEXT;
    v_expires_at TIMESTAMPTZ;
    v_assigned_assessments JSONB := '[]'::jsonb;
    v_assessment_count INT := 0;
    v_primary_asm JSONB := NULL;
    v_event_assignments JSONB := '[]'::jsonb;
    v_event_count INT := 0;
BEGIN
    v_clean_username := lower(trim(p_username));

    SELECT * INTO v_coord
    FROM public.coordinators
    WHERE lower(username) = v_clean_username;

    IF v_coord IS NULL THEN
        PERFORM pg_sleep(0.25);
        RAISE EXCEPTION 'Invalid credentials. Please check your username and password.' USING ERRCODE = '42501';
    END IF;

    IF v_coord.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Coordinator account is inactive or suspended' USING ERRCODE = '42501';
    END IF;

    v_input_hash := encode(extensions.digest(trim(p_password), 'sha256'), 'hex');

    IF v_coord.password_hash != v_input_hash THEN
        IF v_coord.password_hash LIKE '$2%' THEN
            IF extensions.crypt(trim(p_password), v_coord.password_hash) != v_coord.password_hash THEN
                PERFORM pg_sleep(0.25);
                RAISE EXCEPTION 'Invalid credentials. Please check your username and password.' USING ERRCODE = '42501';
            END IF;
        ELSE
            PERFORM pg_sleep(0.25);
            RAISE EXCEPTION 'Invalid credentials. Please check your username and password.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_raw_token := 'ctk_' || encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text || v_coord.id::text, 'sha256'), 'hex');
    v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');
    v_expires_at := now() + interval '1 hour';

    INSERT INTO public.coordinator_sessions (
        coordinator_id,
        token_hash,
        expires_at
    ) VALUES (
        v_coord.id,
        v_token_hash,
        v_expires_at
    );

    -- Query ALL assigned assessments (via explicit assignment table OR coordinator_id)
    WITH all_assigned AS (
        SELECT DISTINCT a.id, a.title, a.status, a.duration_minutes, a.start_time, a.end_time, a.created_at
        FROM public.assessments a
        LEFT JOIN public.assessment_coordinator_assignments aca ON aca.assessment_id = a.id
        WHERE (aca.coordinator_id = v_coord.id OR a.coordinator_id = v_coord.id)
          AND a.status != 'ARCHIVED'
        ORDER BY a.created_at DESC
    )
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', id,
                'title', title,
                'status', status,
                'duration_minutes', duration_minutes,
                'start_time', start_time,
                'end_time', end_time
            )
        ), '[]'::jsonb),
        COUNT(id)
    INTO v_assigned_assessments, v_assessment_count
    FROM all_assigned;

    IF v_assessment_count > 0 THEN
        v_primary_asm := v_assigned_assessments->0;
    END IF;

    -- Query active event assignments
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', ca.id,
                'sub_event_id', ca.sub_event_id,
                'sub_events', jsonb_build_object(
                    'id', se.id,
                    'name', se.name,
                    'status', se.status
                )
            )
        ), '[]'::jsonb),
        COUNT(ca.id)
    INTO v_event_assignments, v_event_count
    FROM public.coordinator_assignments ca
    JOIN public.sub_events se ON se.id = ca.sub_event_id
    WHERE ca.coordinator_id = v_coord.id
      AND se.status = 'ACTIVE';

    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_coord.id,
        'COORDINATOR_LOGIN',
        'coordinators',
        v_coord.id,
        jsonb_build_object(
            'username', v_coord.username,
            'coordinator_type', v_coord.coordinator_type,
            'assessment_count', v_assessment_count,
            'event_assignments_count', v_event_count
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_raw_token,
        'role', CASE 
            WHEN v_coord.coordinator_type = 'PAYMENT_MANAGER' THEN 'PAYMENT_MANAGER'
            WHEN v_coord.coordinator_type = 'ASSESSMENT_COORDINATOR' THEN 'ASSESSMENT_COORDINATOR'
            WHEN v_assessment_count > 0 AND v_event_count = 0 THEN 'ASSESSMENT_COORDINATOR'
            ELSE 'COORDINATOR'
        END,
        'coordinator', jsonb_build_object(
            'id', v_coord.id,
            'username', v_coord.username,
            'display_name', v_coord.display_name,
            'phone_number', v_coord.phone_number,
            'coordinator_type', v_coord.coordinator_type,
            'status', v_coord.status,
            'assigned_assessment', v_primary_asm,
            'assigned_assessments', v_assigned_assessments,
            'active_assessment_count', v_assessment_count
        ),
        'access_state', CASE 
            WHEN v_coord.coordinator_type = 'PAYMENT_MANAGER' 
              OR v_coord.coordinator_type = 'ASSESSMENT_COORDINATOR' 
              OR v_assessment_count > 0 
              OR v_event_count > 0 THEN 'AUTHORIZED'
            ELSE 'NO_ASSIGNMENTS'
        END,
        'assignment_state', CASE 
            WHEN v_coord.coordinator_type = 'PAYMENT_MANAGER' THEN 'PAYMENT_MANAGER'
            WHEN v_assessment_count > 0 AND v_event_count > 0 THEN 'DUAL_ASSIGNMENTS'
            WHEN v_coord.coordinator_type = 'ASSESSMENT_COORDINATOR' OR (v_assessment_count > 0 AND v_event_count = 0) THEN 'ASSESSMENT_COORDINATOR'
            WHEN v_event_count > 0 THEN 'ACTIVE_ASSIGNMENTS'
            ELSE 'NO_ACTIVE_ASSIGNMENTS'
        END,
        'active_assignments_count', v_event_count,
        'assignments', v_event_assignments,
        'assigned_assessment', v_primary_asm,
        'assigned_assessments', v_assigned_assessments,
        'active_assessment_count', v_assessment_count,
        'expires_at', v_expires_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.coordinator_assessment_login(TEXT, TEXT) TO anon, authenticated, service_role;


-- ============================================================================
-- 2. ENHANCED VALIDATE_COORDINATOR_SESSION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_coordinator_session(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_token_hash TEXT;
    v_session public.coordinator_sessions%ROWTYPE;
    v_coord public.coordinators%ROWTYPE;
    v_assignments JSONB;
    v_active_count INT;
    v_assigned_assessments JSONB := '[]'::jsonb;
    v_assessment_count INT := 0;
    v_primary_asm JSONB := NULL;
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Session token is required',
            'access_state', 'INVALID_SESSION'
        );
    END IF;

    v_token_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

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

    IF v_session.expires_at <= now() OR v_session.created_at <= (now() - interval '1 hour') THEN
        DELETE FROM public.coordinator_sessions WHERE token_hash = v_token_hash;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Session has expired. Please log in again.',
            'access_state', 'INVALID_SESSION'
        );
    END IF;

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

    UPDATE public.coordinator_sessions
    SET last_active_at = now()
    WHERE token_hash = v_token_hash;

    -- Query ALL assigned assessments
    WITH all_assigned AS (
        SELECT DISTINCT a.id, a.title, a.status, a.duration_minutes, a.start_time, a.end_time, a.created_at
        FROM public.assessments a
        LEFT JOIN public.assessment_coordinator_assignments aca ON aca.assessment_id = a.id
        WHERE (aca.coordinator_id = v_coord.id OR a.coordinator_id = v_coord.id)
          AND a.status != 'ARCHIVED'
        ORDER BY a.created_at DESC
    )
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', id,
                'title', title,
                'status', status,
                'duration_minutes', duration_minutes,
                'start_time', start_time,
                'end_time', end_time
            )
        ), '[]'::jsonb),
        COUNT(id)
    INTO v_assigned_assessments, v_assessment_count
    FROM all_assigned;

    IF v_assessment_count > 0 THEN
        v_primary_asm := v_assigned_assessments->0;
    END IF;

    -- Sub-events assignments
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
                'status', se.status,
                'manual_status', se.manual_status,
                'status_mode', se.status_mode,
                'results_locked', se.results_locked,
                'event_id', se.event_id,
                'category_id', se.category_id,
                'effective_status', CASE
                    WHEN COALESCE(ev.status::text, cat_ev.status::text) = 'COMPLETED' THEN 'COMPLETED'
                    WHEN COALESCE(ev.manual_status, cat_ev.manual_status) = 'COMPLETED' THEN 'COMPLETED'
                    WHEN se.status::text = 'COMPLETED' THEN 'COMPLETED'
                    WHEN se.manual_status = 'COMPLETED' THEN 'COMPLETED'
                    WHEN now() < se.start_time THEN 'UPCOMING'
                    WHEN now() >= se.start_time AND now() <= se.end_time THEN 'ONGOING'
                    ELSE 'COMPLETED'
                END
            )
        )
    ), '[]'::jsonb),
    COUNT(ca.id)
    INTO v_assignments, v_active_count
    FROM public.coordinator_assignments ca
    JOIN public.sub_events se ON se.id = ca.sub_event_id
    LEFT JOIN public.events ev ON ev.id = se.event_id
    LEFT JOIN public.categories cat ON cat.id = se.category_id
    LEFT JOIN events cat_ev ON cat_ev.id = cat.event_id
    WHERE ca.coordinator_id = v_coord.id
      AND se.status::text = 'ACTIVE'
      AND COALESCE(ev.status::text, cat_ev.status::text) = 'ACTIVE';

    IF v_coord.coordinator_type = 'PAYMENT_MANAGER' 
       OR v_coord.coordinator_type = 'ASSESSMENT_COORDINATOR' 
       OR v_assessment_count > 0 
       OR v_active_count > 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'access_state', 'AUTHORIZED',
            'coordinator', jsonb_build_object(
                'id', v_coord.id,
                'username', v_coord.username,
                'display_name', v_coord.display_name,
                'phone_number', v_coord.phone_number,
                'coordinator_type', v_coord.coordinator_type,
                'status', v_coord.status,
                'assigned_assessment', v_primary_asm,
                'assigned_assessments', v_assigned_assessments,
                'active_assessment_count', v_assessment_count
            ),
            'active_assignments_count', v_active_count,
            'assignments', v_assignments,
            'assigned_assessment', v_primary_asm,
            'assigned_assessments', v_assigned_assessments,
            'active_assessment_count', v_assessment_count,
            'state_detail', CASE 
                WHEN v_assessment_count > 0 AND v_active_count > 0 THEN 'DUAL_ASSIGNMENT'
                WHEN v_assessment_count > 0 THEN 'ACTIVE_ASSESSMENT_ASSIGNMENT'
                WHEN v_active_count > 0 THEN 'ACTIVE_ASSIGNMENTS'
                ELSE 'AUTHORIZED_COORDINATOR'
            END,
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
                'status', v_coord.status,
                'assigned_assessment', NULL,
                'assigned_assessments', '[]'::jsonb,
                'active_assessment_count', 0
            ),
            'active_assignments_count', 0,
            'assignments', '[]'::jsonb,
            'assigned_assessment', NULL,
            'assigned_assessments', '[]'::jsonb,
            'active_assessment_count', 0,
            'state_detail', 'NO_ACTIVE_ASSIGNMENTS',
            'expires_at', v_session.expires_at
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coordinator_session(TEXT) TO anon, authenticated, service_role;
