-- ============================================================================
-- MIGRATION 050: COORDINATOR CUSTOM SESSION ARCHITECTURE & REMOVAL OF SYNTHETIC EMAIL
-- ============================================================================
-- 1. Drop trigger and function that generated synthetic coordinator email addresses
-- 2. Drop columns auth_email and auth_user_id from public.coordinators
-- 3. Delete obsolete synthetic coordinator accounts from auth.users & public.users
-- 4. Create public.coordinator_sessions with token hashing (SHA-256)
-- 5. Implement token-based coordinator identity derivation & lifecycle validation
-- 6. Refactor coordinator operational RPCs to use session tokens
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- STEP 1: DROP SYNTHETIC TRIGGER & FUNCTIONS
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_set_coordinator_auth_email ON public.coordinators;
DROP FUNCTION IF EXISTS public.set_coordinator_auth_email();

-- Drop old RLS policy that depended on auth_user_id
DROP POLICY IF EXISTS "Coordinators can read own record" ON public.coordinators;

-- Drop obsolete zero-arg / auth.uid() coordinator helper functions
DROP FUNCTION IF EXISTS public.get_current_coordinator_id();
DROP FUNCTION IF EXISTS public.validate_coordinator_session();
DROP FUNCTION IF EXISTS public.get_coordinator_assigned_sub_events();
DROP FUNCTION IF EXISTS public.get_coordinator_sub_event_roster(UUID);
DROP FUNCTION IF EXISTS public.get_sub_event_documents_for_coordinator(UUID);
DROP FUNCTION IF EXISTS public.get_coordinator_notifications();
DROP FUNCTION IF EXISTS public.mark_coordinator_notification_read(UUID);
DROP FUNCTION IF EXISTS public.mark_all_coordinator_notifications_read();

-- ----------------------------------------------------------------------------
-- STEP 2: REMOVE SYNTHETIC EMAIL AND AUTH_USER_ID COLUMNS
-- ----------------------------------------------------------------------------
ALTER TABLE public.coordinators DROP COLUMN IF EXISTS auth_email CASCADE;
ALTER TABLE public.coordinators DROP COLUMN IF EXISTS auth_user_id CASCADE;

-- ----------------------------------------------------------------------------
-- STEP 3: SAFELY PURGE SYNTHETIC COORDINATOR ACCOUNTS FROM auth.users & public.users
-- ----------------------------------------------------------------------------
-- These 3 accounts were created solely for the previous synthetic email architecture.
-- None of them have student profiles, registrations, or payments.
DELETE FROM public.users 
WHERE email LIKE '%@coordinator.kits-eos.internal';

DELETE FROM auth.users 
WHERE email LIKE '%@coordinator.kits-eos.internal';

-- ----------------------------------------------------------------------------
-- STEP 4: CREATE public.coordinator_sessions TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coordinator_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_coordinator_sessions_token_hash 
    ON public.coordinator_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_coordinator_sessions_coordinator_id 
    ON public.coordinator_sessions(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_coordinator_sessions_expires_at 
    ON public.coordinator_sessions(expires_at);

-- RLS: Direct access restricted to service_role and security definer functions
ALTER TABLE public.coordinator_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on coordinator_sessions" ON public.coordinator_sessions;
CREATE POLICY "Service role full access on coordinator_sessions" ON public.coordinator_sessions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- STEP 5: TOKEN VERIFICATION AND SESSION MANAGEMENT HELPERS
-- ----------------------------------------------------------------------------

-- 5.1 Helper: get_coordinator_id_by_token(p_token TEXT)
CREATE OR REPLACE FUNCTION public.get_coordinator_id_by_token(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
    v_coord_id UUID;
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RETURN NULL;
    END IF;

    -- Compute SHA-256 hash of the presented token
    v_token_hash := encode(digest(trim(p_token), 'sha256'), 'hex');

    -- Lookup active unexpired session for an ACTIVE coordinator
    SELECT cs.coordinator_id INTO v_coord_id
    FROM public.coordinator_sessions cs
    JOIN public.coordinators c ON c.id = cs.coordinator_id
    WHERE cs.token_hash = v_token_hash
      AND cs.expires_at > now()
      AND c.status = 'ACTIVE';

    IF FOUND THEN
        -- Update last_active_at touch timestamp
        UPDATE public.coordinator_sessions
        SET last_active_at = now()
        WHERE token_hash = v_token_hash;
        RETURN v_coord_id;
    END IF;

    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_id_by_token(TEXT) TO anon, authenticated, service_role;

-- 5.2 Invalidate Coordinator Session (Logout)
CREATE OR REPLACE FUNCTION public.invalidate_coordinator_session(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_token_hash TEXT;
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RETURN FALSE;
    END IF;

    v_token_hash := encode(digest(trim(p_token), 'sha256'), 'hex');

    DELETE FROM public.coordinator_sessions
    WHERE token_hash = v_token_hash;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invalidate_coordinator_session(TEXT) TO anon, authenticated, service_role;

-- 5.3 Authoritative Coordinator Session Lifecycle Validator
CREATE OR REPLACE FUNCTION public.validate_coordinator_session(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

    v_token_hash := encode(digest(trim(p_token), 'sha256'), 'hex');

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

    IF v_session.expires_at <= now() THEN
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

    -- Touch session last_active_at
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

-- 5.4 Coordinator Operational RPC: get_coordinator_assigned_sub_events(p_token TEXT)
CREATE OR REPLACE FUNCTION public.get_coordinator_assigned_sub_events(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_validation JSONB;
BEGIN
    SELECT public.get_coordinator_id_by_token(p_token) INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    v_validation := public.validate_coordinator_session(p_token);
    RETURN jsonb_build_object(
        'success', true,
        'coordinator_id', v_coord_id,
        'assignments', v_validation->'assignments'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_assigned_sub_events(TEXT) TO anon, authenticated, service_role;

-- 5.5 Coordinator Operational RPC: get_coordinator_sub_event_roster(p_token TEXT, p_sub_event_id UUID)
CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_roster(p_token TEXT, p_sub_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN;
    v_registrations JSONB;
    v_attendance JSONB;
BEGIN
    SELECT public.get_coordinator_id_by_token(p_token) INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    -- Strict server-side assignment verification
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.sub_events se ON se.id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord_id
          AND ca.sub_event_id = p_sub_event_id
          AND se.status = 'ACTIVE'
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RAISE EXCEPTION 'You are not assigned to this sub-event';
    END IF;

    -- 1. Fetch Registrations with payments, teams, members, and student profiles
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'sub_event_id', r.sub_event_id,
            'leader_id', r.leader_id,
            'registration_type', r.registration_type,
            'status', r.status,
            'created_at', r.created_at,
            'teams', CASE WHEN t.id IS NOT NULL THEN jsonb_build_object(
                'id', t.id,
                'name', t.name,
                'leader_id', t.leader_id,
                'team_members', (
                    SELECT COALESCE(jsonb_agg(
                        jsonb_build_object(
                            'id', tm.id,
                            'student_id', tm.student_id,
                            'is_leader', (tm.student_id = r.leader_id),
                            'attendance_token', tm.attendance_token,
                            'student_profiles', jsonb_build_object(
                                'user_id', sp_m.user_id,
                                'full_name', sp_m.full_name,
                                'roll_number', sp_m.roll_number,
                                'college', sp_m.college,
                                'department', sp_m.department,
                                'year_of_study', sp_m.year_of_study,
                                'phone', sp_m.phone
                            )
                        ) ORDER BY (tm.student_id = r.leader_id) DESC, sp_m.full_name ASC
                    ), '[]'::jsonb)
                    FROM public.team_members tm
                    LEFT JOIN public.student_profiles sp_m ON sp_m.user_id = tm.student_id
                    WHERE tm.team_id = t.id
                )
            ) ELSE NULL END,
            'student_profiles', CASE WHEN sp_lead.user_id IS NOT NULL THEN jsonb_build_object(
                'user_id', sp_lead.user_id,
                'full_name', sp_lead.full_name,
                'roll_number', sp_lead.roll_number,
                'college', sp_lead.college,
                'department', sp_lead.department,
                'year_of_study', sp_lead.year_of_study,
                'phone', sp_lead.phone
            ) ELSE NULL END,
            'payments', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'id', p.id,
                        'status', p.status,
                        'amount', p.amount,
                        'payment_method', p.payment_method,
                        'transaction_id', p.transaction_id,
                        'updated_at', p.updated_at
                    ) ORDER BY p.created_at DESC
                ), '[]'::jsonb)
                FROM public.payments p
                WHERE p.registration_id = r.id
            )
        ) ORDER BY r.created_at ASC
    ), '[]'::jsonb)
    INTO v_registrations
    FROM public.registrations r
    LEFT JOIN public.teams t ON t.registration_id = r.id
    LEFT JOIN public.student_profiles sp_lead ON sp_lead.user_id = r.leader_id
    WHERE r.sub_event_id = p_sub_event_id;

    -- 2. Fetch Authoritative Attendance Records
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'sub_event_id', a.sub_event_id,
            'team_id', a.team_id,
            'scanned_member_id', a.scanned_member_id,
            'checked_in_at', a.checked_in_at,
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
        'attendance', v_attendance
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(TEXT, UUID) TO anon, authenticated, service_role;

-- 5.6 Coordinator Operational RPC: get_sub_event_documents_for_coordinator(p_token TEXT, p_sub_event_id UUID)
CREATE OR REPLACE FUNCTION public.get_sub_event_documents_for_coordinator(p_token TEXT, p_sub_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN;
    v_docs JSONB;
BEGIN
    SELECT public.get_coordinator_id_by_token(p_token) INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    -- Strict server-side assignment verification
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.sub_events se ON se.id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord_id
          AND ca.sub_event_id = p_sub_event_id
          AND se.status = 'ACTIVE'
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RAISE EXCEPTION 'You are not assigned to this sub-event';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', d.id,
            'name', d.file_name,
            'file_name', d.file_name,
            'file_path', d.storage_path,
            'storage_path', d.storage_path,
            'file_size', d.file_size,
            'file_type', d.mime_type,
            'mime_type', d.mime_type,
            'created_at', d.created_at,
            'uploaded_at', d.created_at,
            'owner_id', d.owner_id,
            'entity_type', d.entity_type,
            'entity_id', d.entity_id,
            'student_name', sp.full_name,
            'roll_number', sp.roll_number
        ) ORDER BY d.created_at DESC
    ), '[]'::jsonb)
    INTO v_docs
    FROM public.documents d
    JOIN public.registrations r ON r.id = d.entity_id AND d.entity_type = 'REGISTRATION'
    LEFT JOIN public.student_profiles sp ON sp.user_id = d.owner_id
    WHERE r.sub_event_id = p_sub_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'documents', v_docs
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sub_event_documents_for_coordinator(TEXT, UUID) TO anon, authenticated, service_role;

-- 5.7 Coordinator Operational RPC: get_coordinator_notifications(p_token TEXT)
CREATE OR REPLACE FUNCTION public.get_coordinator_notifications(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_notifs JSONB;
BEGIN
    SELECT public.get_coordinator_id_by_token(p_token) INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', n.id,
            'title', n.title,
            'message', n.message,
            'is_read', n.is_read,
            'created_at', n.created_at,
            'recipient_role', n.recipient_role,
            'audience', n.audience,
            'broadcast_id', n.broadcast_id
        ) ORDER BY n.created_at DESC
    ), '[]'::jsonb)
    INTO v_notifs
    FROM public.notifications n
    WHERE n.coordinator_id = v_coord_id
       OR n.recipient_role = 'COORDINATOR'
       OR n.audience = 'COORDINATOR'
       OR n.audience = 'ALL';

    RETURN v_notifs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_notifications(TEXT) TO anon, authenticated, service_role;

-- 5.8 Coordinator Operational RPC: mark_coordinator_notification_read(p_token TEXT, p_notification_id UUID)
CREATE OR REPLACE FUNCTION public.mark_coordinator_notification_read(p_token TEXT, p_notification_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
BEGIN
    SELECT public.get_coordinator_id_by_token(p_token) INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    UPDATE public.notifications
    SET is_read = true
    WHERE id = p_notification_id
      AND coordinator_id = v_coord_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_coordinator_notification_read(TEXT, UUID) TO anon, authenticated, service_role;

-- 5.9 Coordinator Operational RPC: mark_all_coordinator_notifications_read(p_token TEXT)
CREATE OR REPLACE FUNCTION public.mark_all_coordinator_notifications_read(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
BEGIN
    SELECT public.get_coordinator_id_by_token(p_token) INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    UPDATE public.notifications
    SET is_read = true
    WHERE coordinator_id = v_coord_id
      AND is_read = false;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_coordinator_notifications_read(TEXT) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- STEP 6: UPDATE get_current_user_profile() (ADMIN & STUDENT ONLY)
-- ----------------------------------------------------------------------------
-- Coordinators no longer have auth.users accounts, so get_current_user_profile
-- only resolves Admins and Students from public.users.
CREATE OR REPLACE FUNCTION public.get_current_user_profile()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT id, email, role, status INTO v_user
    FROM public.users
    WHERE id = auth.uid();

    IF FOUND THEN
        RETURN jsonb_build_object(
            'id', v_user.id,
            'email', v_user.email,
            'role', v_user.role,
            'status', v_user.status
        );
    END IF;

    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_current_user_profile() TO authenticated;
