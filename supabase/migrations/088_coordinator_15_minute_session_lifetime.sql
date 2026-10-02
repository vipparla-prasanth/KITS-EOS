-- ============================================================================
-- MIGRATION 088: Server-Side Enforcement of Coordinator 15-Minute Session Lifetime
--
-- Security Mandate:
-- 1. All coordinator session records are strictly capped to a maximum 15-minute lifetime.
-- 2. validate_coordinator_session(p_token) rejects sessions whose age exceeds 15 minutes,
--    cleans up the expired session, and returns access_state = 'INVALID_SESSION'.
-- 3. get_coordinator_id_by_token(p_token) enforces created_at > (now() - interval '15 minutes')
--    and expires_at > now().
-- 4. A database trigger guarantees no coordinator session can ever be inserted or updated
--    with expires_at greater than created_at + 15 minutes.
-- ============================================================================

-- 1. Database trigger to clamp expires_at to at most 15 minutes from created_at
CREATE OR REPLACE FUNCTION public.enforce_coordinator_session_15m_max()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.expires_at > NEW.created_at + interval '15 minutes' THEN
        NEW.expires_at := NEW.created_at + interval '15 minutes';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_coordinator_session_15m ON public.coordinator_sessions;
CREATE TRIGGER trg_enforce_coordinator_session_15m
BEFORE INSERT OR UPDATE ON public.coordinator_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_coordinator_session_15m_max();

-- 2. Authoritative Coordinator Session Lifecycle Validator (15-Minute Expiry)
CREATE OR REPLACE FUNCTION public.validate_coordinator_session(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
    v_session RECORD;
    v_coord RECORD;
    v_active_count INT := 0;
    v_assignments JSONB := '[]'::jsonb;
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

    -- Strict 15-Minute Session Lifetime Verification
    IF v_session.expires_at <= now() OR v_session.created_at <= (now() - interval '15 minutes') THEN
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
                        'status', ce.status
                    ) ELSE NULL END
                ) ELSE NULL END,
                'events', CASE WHEN e.id IS NOT NULL THEN jsonb_build_object(
                    'id', e.id,
                    'name', e.name,
                    'status', e.status
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

-- 3. Authoritative Coordinator Token Lookup (15-Minute Expiry Gate)
CREATE OR REPLACE FUNCTION public.get_coordinator_id_by_token(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
    v_coord_id UUID;
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RETURN NULL;
    END IF;

    v_token_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

    -- Lookup unexpired session strictly within the 15-minute absolute lifetime
    SELECT cs.coordinator_id INTO v_coord_id
    FROM public.coordinator_sessions cs
    JOIN public.coordinators c ON c.id = cs.coordinator_id
    WHERE cs.token_hash = v_token_hash
      AND cs.expires_at > now()
      AND cs.created_at > (now() - interval '15 minutes')
      AND c.status = 'ACTIVE';

    IF FOUND THEN
        -- Touch last_active_at (does not extend session lifetime)
        UPDATE public.coordinator_sessions
        SET last_active_at = now()
        WHERE token_hash = v_token_hash;
        RETURN v_coord_id;
    END IF;

    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_id_by_token(TEXT) TO anon, authenticated, service_role;

-- 4. Clean up any stale sessions created more than 15 minutes ago
DELETE FROM public.coordinator_sessions
WHERE created_at <= (now() - interval '15 minutes')
   OR expires_at <= now();
