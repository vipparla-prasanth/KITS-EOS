-- Migration 120: Fix Assessment Coordinator Assignment, Uniqueness Conflict, and Live Host Session Telemetry
-- ============================================================================
-- 1. Fix admin_assign_assessment_coordinator:
--    - Fix PL/pgSQL RECORD IS NOT NULL bug (which failed for rows with NULL user_id)
--    - Reuse compatible existing coordinators (FACULTY, etc.) without altering their password or role
--    - Gracefully return structured error JSON on assignment conflicts instead of throwing raw 409
-- 2. Add coordinator_get_assigned_assessment(p_token text):
--    - Authoritative resolution of coordinator's assigned assessment
--    - Prevents live-host dashboard from hanging indefinitely on empty assessmentId
-- 3. Enhance validate_coordinator_session(p_token text):
--    - Include assessment assignments so assessment coordinators are not marked NO_ASSIGNMENTS
-- 4. Permissions:
--    - Ensure get_assessment_live_host_snapshot, coordinator_close_assessment_early,
--      verify_assessment_coordinator_access, and coordinator_get_assigned_assessment
--      are executable by anon, authenticated, and service_role.

-- ============================================================================
-- 1. FIXED ADMIN COORDINATOR ASSIGNMENT RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_assign_assessment_coordinator(
    p_assessment_id UUID,
    p_coordinator_name TEXT,
    p_username TEXT,
    p_password TEXT,
    p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
    v_asm RECORD;
    v_clean_username TEXT;
    v_clean_name TEXT;
    v_password_hash TEXT;
    v_coord_id UUID;
    v_existing_coord RECORD;
    v_prev_coord_id UUID;
    v_is_existing BOOLEAN := false;
BEGIN
    -- Strict Admin Authorization
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'UNAUTHORIZED',
            'message', 'Administrative privileges required to assign assessment coordinators.'
        );
    END IF;

    -- Validate Assessment Exists
    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ASSESSMENT_NOT_FOUND',
            'message', 'Assessment not found.'
        );
    END IF;

    v_clean_username := lower(trim(p_username));
    v_clean_name := trim(p_coordinator_name);

    IF v_clean_username = '' OR length(v_clean_username) < 3 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_USERNAME',
            'message', 'Username must be at least 3 characters long.'
        );
    END IF;

    -- Look up existing coordinator by case-insensitive username
    SELECT * INTO v_existing_coord FROM public.coordinators WHERE lower(username) = v_clean_username;

    -- Note: Check v_existing_coord.id IS NOT NULL, NOT v_existing_coord IS NOT NULL
    -- because in SQL composite types, (rec IS NOT NULL) is FALSE if any attribute (like user_id) is NULL!
    IF v_existing_coord.id IS NOT NULL THEN
        v_is_existing := true;
        v_coord_id := v_existing_coord.id;

        -- Check if already assigned to a DIFFERENT assessment
        IF EXISTS (
            SELECT 1 FROM public.assessment_coordinator_assignments 
            WHERE coordinator_id = v_existing_coord.id AND assessment_id != p_assessment_id
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'COORDINATOR_ALREADY_ASSIGNED',
                'message', format('Coordinator "%s" is already assigned to another active assessment.', v_clean_username)
            );
        END IF;

        -- Reuse existing coordinator safely:
        -- Do NOT overwrite password_hash for existing faculty or institutional accounts!
        -- Do NOT alter coordinator_type if they are already FACULTY or ORGANIZER!
        UPDATE public.coordinators
        SET phone_number = COALESCE(p_phone, phone_number),
            status = 'ACTIVE'
        WHERE id = v_existing_coord.id;

    ELSE
        -- Creating a brand new coordinator account
        IF v_clean_name = '' THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_NAME',
                'message', 'Coordinator display name is required for new accounts.'
            );
        END IF;

        IF p_password IS NULL OR length(trim(p_password)) < 6 THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_PASSWORD',
                'message', 'Password must be at least 6 characters long for new accounts.'
            );
        END IF;

        -- Compute SHA-256 password hash (automatically upgradeable by coordinator-login)
        v_password_hash := encode(extensions.digest(trim(p_password), 'sha256'), 'hex');

        BEGIN
            INSERT INTO public.coordinators (
                username,
                password_hash,
                display_name,
                phone_number,
                coordinator_type,
                status
            ) VALUES (
                v_clean_username,
                v_password_hash,
                v_clean_name,
                p_phone,
                'ASSESSMENT_COORDINATOR',
                'ACTIVE'
            )
            RETURNING id INTO v_coord_id;
        EXCEPTION
            WHEN unique_violation THEN
                -- Concurrency safety fallback: Fetch the coordinator that was just created concurrently
                SELECT id INTO v_coord_id FROM public.coordinators WHERE lower(username) = v_clean_username;
                IF v_coord_id IS NULL THEN
                    RETURN jsonb_build_object(
                        'success', false,
                        'code', 'DUPLICATE_USERNAME',
                        'message', format('A coordinator with username "%s" already exists.', v_clean_username)
                    );
                END IF;
                v_is_existing := true;
        END;
    END IF;

    -- Check previous assignment for auditing
    SELECT coordinator_id INTO v_prev_coord_id 
    FROM public.assessment_coordinator_assignments 
    WHERE assessment_id = p_assessment_id;

    -- Upsert assessment assignment atomically
    INSERT INTO public.assessment_coordinator_assignments (
        assessment_id,
        coordinator_id,
        assigned_by
    ) VALUES (
        p_assessment_id,
        v_coord_id,
        auth.uid()
    )
    ON CONFLICT (assessment_id) DO UPDATE
    SET coordinator_id = EXCLUDED.coordinator_id,
        assigned_by = EXCLUDED.assigned_by,
        assigned_at = timezone('utc'::text, now());

    -- Update fast lookup pointer on assessments table
    UPDATE public.assessments
    SET coordinator_id = v_coord_id,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_assessment_id;

    -- Institutional Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        auth.uid(),
        CASE WHEN v_prev_coord_id IS NOT NULL AND v_prev_coord_id != v_coord_id 
             THEN 'ASSESSMENT_COORDINATOR_REASSIGNED' 
             ELSE 'ASSESSMENT_COORDINATOR_ASSIGNED' END,
        'assessments',
        p_assessment_id,
        jsonb_build_object(
            'assessment_title', v_asm.title,
            'coordinator_id', v_coord_id,
            'coordinator_username', v_clean_username,
            'reused_existing', v_is_existing,
            'previous_coordinator_id', v_prev_coord_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'reused_existing', v_is_existing,
        'message', CASE 
            WHEN v_is_existing THEN format('Coordinator "%s" successfully assigned (existing institutional account preserved).', v_clean_username)
            ELSE format('New assessment coordinator "%s" created and assigned.', v_clean_username)
        END,
        'coordinator', jsonb_build_object(
            'id', v_coord_id,
            'username', v_clean_username,
            'display_name', COALESCE(v_existing_coord.display_name, v_clean_name),
            'coordinator_type', COALESCE(v_existing_coord.coordinator_type, 'ASSESSMENT_COORDINATOR')
        )
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', SQLSTATE,
            'message', SQLERRM
        );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_assessment_coordinator(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_assessment_coordinator(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;


-- ============================================================================
-- 2. COORDINATOR GET ASSIGNED ASSESSMENT RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.coordinator_get_assigned_assessment(
    p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
    v_session RECORD;
    v_coord RECORD;
    v_assignment RECORD;
    v_asm RECORD;
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'TOKEN_REQUIRED',
            'message', 'Coordinator session token is required.'
        );
    END IF;

    v_token_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

    SELECT * INTO v_session
    FROM public.coordinator_sessions
    WHERE token_hash = v_token_hash;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_SESSION',
            'message', 'Invalid coordinator session token.'
        );
    END IF;

    IF v_session.expires_at <= now() THEN
        DELETE FROM public.coordinator_sessions WHERE token_hash = v_token_hash;
        RETURN jsonb_build_object(
            'success', false,
            'code', 'SESSION_EXPIRED',
            'message', 'Coordinator session has expired. Please log in again.'
        );
    END IF;

    SELECT * INTO v_coord
    FROM public.coordinators
    WHERE id = v_session.coordinator_id;

    IF v_coord.id IS NULL OR v_coord.status != 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ACCOUNT_INACTIVE',
            'message', 'Coordinator account is inactive or not found.'
        );
    END IF;

    -- 1. Check direct assignment table
    SELECT a.* INTO v_asm
    FROM public.assessment_coordinator_assignments aca
    JOIN public.assessments a ON a.id = aca.assessment_id
    WHERE aca.coordinator_id = v_coord.id
    ORDER BY aca.assigned_at DESC
    LIMIT 1;

    -- 2. Check assessments.coordinator_id pointer
    IF v_asm.id IS NULL THEN
        SELECT * INTO v_asm
        FROM public.assessments
        WHERE coordinator_id = v_coord.id
        ORDER BY created_at DESC
        LIMIT 1;
    END IF;

    -- 3. Check linked sub-event coordinator assignments
    IF v_asm.id IS NULL THEN
        SELECT a.* INTO v_asm
        FROM public.coordinator_assignments ca
        JOIN public.assessments a ON a.sub_event_id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord.id
        ORDER BY a.created_at DESC
        LIMIT 1;
    END IF;

    IF v_asm.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'assigned', false,
            'coordinator', jsonb_build_object(
                'id', v_coord.id,
                'username', v_coord.username,
                'display_name', v_coord.display_name,
                'coordinator_type', v_coord.coordinator_type
            ),
            'assessment', NULL,
            'message', 'No assessment currently assigned to this coordinator account.'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'assigned', true,
        'coordinator', jsonb_build_object(
            'id', v_coord.id,
            'username', v_coord.username,
            'display_name', v_coord.display_name,
            'coordinator_type', v_coord.coordinator_type
        ),
        'assessment', jsonb_build_object(
            'id', v_asm.id,
            'title', v_asm.title,
            'description', v_asm.description,
            'status', v_asm.status,
            'duration_minutes', v_asm.duration_minutes,
            'start_time', v_asm.start_time,
            'end_time', v_asm.end_time,
            'passing_percentage', v_asm.passing_percentage,
            'total_questions_count', v_asm.total_questions_count
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.coordinator_get_assigned_assessment(TEXT) TO anon, authenticated, service_role;


-- ============================================================================
-- 3. ENHANCE VALIDATE_COORDINATOR_SESSION WITH ASSESSMENT AWARENESS
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
    v_assigned_assessment JSONB := NULL;
    v_asm RECORD;
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

    -- Check for assessment assignment
    SELECT a.* INTO v_asm
    FROM public.assessment_coordinator_assignments aca
    JOIN public.assessments a ON a.id = aca.assessment_id
    WHERE aca.coordinator_id = v_coord.id
    ORDER BY aca.assigned_at DESC
    LIMIT 1;

    IF v_asm.id IS NULL THEN
        SELECT * INTO v_asm
        FROM public.assessments
        WHERE coordinator_id = v_coord.id
        ORDER BY created_at DESC
        LIMIT 1;
    END IF;

    IF v_asm.id IS NOT NULL THEN
        v_assigned_assessment := jsonb_build_object(
            'id', v_asm.id,
            'title', v_asm.title,
            'status', v_asm.status,
            'duration_minutes', v_asm.duration_minutes,
            'start_time', v_asm.start_time,
            'end_time', v_asm.end_time
        );
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
                'results_locked', se.results_locked,
                'status', se.status,
                'status_mode', se.status_mode,
                'manual_status', se.manual_status,
                'effective_status', public.effective_status(se),
                'category_id', se.category_id,
                'event_id', se.event_id
            )
        ) ORDER BY se.name ASC
    ), '[]'::jsonb)
    INTO v_assignments
    FROM public.coordinator_assignments ca
    JOIN public.sub_events se ON se.id = ca.sub_event_id
    WHERE ca.coordinator_id = v_coord.id
      AND se.status = 'ACTIVE';

    v_active_count := jsonb_array_length(v_assignments);

    -- An assessment coordinator or payment manager or coordinator with an assigned assessment is AUTHORIZED
    IF v_active_count > 0 OR v_assigned_assessment IS NOT NULL OR v_coord.coordinator_type IN ('ASSESSMENT_COORDINATOR', 'PAYMENT_MANAGER') THEN
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
            'assigned_assessment', v_assigned_assessment,
            'state_detail', CASE 
                WHEN v_assigned_assessment IS NOT NULL THEN 'ACTIVE_ASSESSMENT_ASSIGNMENT'
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
                'status', v_coord.status
            ),
            'active_assignments_count', 0,
            'assignments', '[]'::jsonb,
            'assigned_assessment', NULL,
            'state_detail', 'NO_ACTIVE_ASSIGNMENTS',
            'expires_at', v_session.expires_at
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coordinator_session(TEXT) TO anon, authenticated, service_role;


-- ============================================================================
-- 4. ENSURE LIVE HOST RPCS HAVE EXPLICIT ANON EXECUTE PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.get_assessment_live_host_snapshot(UUID, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_assessment_coordinator_access(UUID, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coordinator_close_assessment_early(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coordinator_assessment_login(TEXT, TEXT) TO anon, authenticated, service_role;
