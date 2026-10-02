-- 073_event_lifecycle_archiving_and_student_deactivation.sql
-- KITS-EOS Production Migration:
-- 1. Adds status_mode, manual_status, registration window timestamps to public.events and public.sub_events
-- 2. Adds deactivated_at, scheduled_permanent_deletion_at to public.users with indexed recovery window
-- 3. Defines dynamic authoritative PostgreSQL functions & computed column resolvers for effective event & sub-event lifecycle status
--    Strict 5-state lifecycle: UPCOMING, REGISTRATIONS OPEN, REGISTRATIONS CLOSED, ONGOING, COMPLETED
-- 4. Updates student_register_atomic to strictly enforce effective lifecycle status and archive hierarchy
-- 5. Hardens archive/restore RPCs to maintain independent entity states
-- 6. Adds student account self-deactivation and 15-day recovery RPCs
-- 7. Implements automated server-side cleanup worker with pg_cron

-- ============================================================================
-- 1. SCHEMA EXTENSIONS
-- ============================================================================

-- A. events table
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS status_mode VARCHAR(20) NOT NULL DEFAULT 'AUTOMATIC',
  ADD COLUMN IF NOT EXISTS manual_status VARCHAR(30) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS registration_start_date TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS registration_end_date TIMESTAMPTZ DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_status_mode_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_status_mode_check CHECK (status_mode IN ('AUTOMATIC', 'MANUAL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_manual_status_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_manual_status_check CHECK (
        manual_status IS NULL OR
        manual_status IN ('UPCOMING', 'REGISTRATIONS OPEN', 'REGISTRATIONS CLOSED', 'ONGOING', 'COMPLETED')
      );
  END IF;
END $$;

-- B. sub_events table
ALTER TABLE public.sub_events
  ADD COLUMN IF NOT EXISTS status_mode VARCHAR(20) NOT NULL DEFAULT 'AUTOMATIC',
  ADD COLUMN IF NOT EXISTS manual_status VARCHAR(30) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS registration_start_time TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS registration_end_time TIMESTAMPTZ DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sub_events_status_mode_check'
  ) THEN
    ALTER TABLE public.sub_events
      ADD CONSTRAINT sub_events_status_mode_check CHECK (status_mode IN ('AUTOMATIC', 'MANUAL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sub_events_manual_status_check'
  ) THEN
    ALTER TABLE public.sub_events
      ADD CONSTRAINT sub_events_manual_status_check CHECK (
        manual_status IS NULL OR
        manual_status IN ('UPCOMING', 'REGISTRATIONS OPEN', 'REGISTRATIONS CLOSED', 'ONGOING', 'COMPLETED')
      );
  END IF;
END $$;

-- C. users table
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS scheduled_permanent_deletion_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_scheduled_deletion
ON public.users(scheduled_permanent_deletion_at)
WHERE status = 'DEACTIVATED';


-- ============================================================================
-- 2. DYNAMIC AUTHORITATIVE LIFECYCLE RESOLVERS
-- ============================================================================

-- Function for Sub-Events
CREATE OR REPLACE FUNCTION public.effective_status(p_sub public.sub_events)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_reg_start TIMESTAMPTZ;
    v_reg_end TIMESTAMPTZ;
BEGIN
    -- Priority 1: Manual override
    IF p_sub.status_mode = 'MANUAL' AND p_sub.manual_status IS NOT NULL THEN
        RETURN p_sub.manual_status;
    END IF;

    -- Priority 2: Automatic Lifecycle (Strict order)
    -- A. COMPLETED: NOW() >= end_time
    IF p_sub.end_time IS NOT NULL AND v_now >= p_sub.end_time THEN
        RETURN 'COMPLETED';
    END IF;

    -- B. ONGOING: NOW() >= start_time AND NOW() < end_time
    IF p_sub.start_time IS NOT NULL AND v_now >= p_sub.start_time THEN
        RETURN 'ONGOING';
    END IF;

    -- Pre-event timings
    v_reg_start := p_sub.registration_start_time;
    v_reg_end := COALESCE(p_sub.registration_end_time, p_sub.start_time);

    -- C. REGISTRATIONS CLOSED: Not started yet, but deadline passed OR capacity reached
    IF (v_reg_end IS NOT NULL AND v_now >= v_reg_end) OR
       (p_sub.max_capacity IS NOT NULL AND p_sub.registered_count >= p_sub.max_capacity) THEN
        RETURN 'REGISTRATIONS CLOSED';
    END IF;

    -- D. REGISTRATIONS OPEN: Within registration window
    IF (v_reg_start IS NULL OR v_now >= v_reg_start) AND
       (v_reg_end IS NULL OR v_now < v_reg_end) THEN
        RETURN 'REGISTRATIONS OPEN';
    END IF;

    -- E. UPCOMING: NOW() < registration_start
    IF v_reg_start IS NOT NULL AND v_now < v_reg_start THEN
        RETURN 'UPCOMING';
    END IF;

    RETURN 'UPCOMING';
END;
$$;

-- Function for Main Events
CREATE OR REPLACE FUNCTION public.effective_status(p_ev public.events)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_reg_start TIMESTAMPTZ;
    v_reg_end TIMESTAMPTZ;
BEGIN
    -- Priority 1: Manual override
    IF p_ev.status_mode = 'MANUAL' AND p_ev.manual_status IS NOT NULL THEN
        RETURN p_ev.manual_status;
    END IF;

    -- Priority 2: Automatic Lifecycle
    -- A. COMPLETED: NOW() >= end_date
    IF p_ev.end_date IS NOT NULL AND v_now >= p_ev.end_date THEN
        RETURN 'COMPLETED';
    END IF;

    -- B. ONGOING: NOW() >= start_date AND NOW() < end_date
    IF p_ev.start_date IS NOT NULL AND v_now >= p_ev.start_date THEN
        RETURN 'ONGOING';
    END IF;

    -- Pre-event timings
    v_reg_start := p_ev.registration_start_date;
    v_reg_end := COALESCE(p_ev.registration_end_date, p_ev.start_date);

    -- C. REGISTRATIONS CLOSED: deadline passed
    IF v_reg_end IS NOT NULL AND v_now >= v_reg_end THEN
        RETURN 'REGISTRATIONS CLOSED';
    END IF;

    -- D. REGISTRATIONS OPEN: within registration window
    IF (v_reg_start IS NULL OR v_now >= v_reg_start) AND
       (v_reg_end IS NULL OR v_now < v_reg_end) THEN
        RETURN 'REGISTRATIONS OPEN';
    END IF;

    -- E. UPCOMING: before registration opens
    IF v_reg_start IS NOT NULL AND v_now < v_reg_start THEN
        RETURN 'UPCOMING';
    END IF;

    RETURN 'UPCOMING';
END;
$$;

-- Helper direct ID resolvers
CREATE OR REPLACE FUNCTION public.resolve_effective_event_status(p_event_id UUID)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_ev public.events;
BEGIN
    SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN public.effective_status(v_ev);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_effective_sub_event_status(p_sub_event_id UUID)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_sub public.sub_events;
BEGIN
    SELECT * INTO v_sub FROM public.sub_events WHERE id = p_sub_event_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN public.effective_status(v_sub);
END;
$$;


-- ============================================================================
-- 3. ADMIN MANUAL STATUS OVERRIDE RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_event_status(
    p_event_id UUID,
    p_status_mode TEXT,
    p_manual_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_mode TEXT;
    v_man TEXT;
    v_event_name TEXT;
    v_effective TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required.';
    END IF;

    v_actor_id := auth.uid();
    v_mode := UPPER(TRIM(p_status_mode));
    IF v_mode NOT IN ('AUTOMATIC', 'MANUAL') THEN
        RAISE EXCEPTION 'Invalid status mode: %. Must be AUTOMATIC or MANUAL.', p_status_mode;
    END IF;

    IF v_mode = 'MANUAL' THEN
        v_man := UPPER(TRIM(p_manual_status));
        IF v_man NOT IN ('UPCOMING', 'REGISTRATIONS OPEN', 'REGISTRATIONS CLOSED', 'ONGOING', 'COMPLETED') THEN
            RAISE EXCEPTION 'Invalid manual status: %. Must be UPCOMING, REGISTRATIONS OPEN, REGISTRATIONS CLOSED, ONGOING, or COMPLETED.', p_manual_status;
        END IF;
    ELSE
        v_man := NULL;
    END IF;

    SELECT name INTO v_event_name FROM public.events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found.';
    END IF;

    UPDATE public.events
    SET status_mode = v_mode,
        manual_status = v_man
    WHERE id = p_event_id;

    SELECT public.resolve_effective_event_status(p_event_id) INTO v_effective;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'EVENT_STATUS_CHANGED',
        'EVENT',
        p_event_id,
        jsonb_build_object(
            'event_name', v_event_name,
            'status_mode', v_mode,
            'manual_status', v_man,
            'effective_status', v_effective
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'status_mode', v_mode,
        'manual_status', v_man,
        'effective_status', v_effective
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_event_status(UUID, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_set_event_status(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_sub_event_status(
    p_sub_event_id UUID,
    p_status_mode TEXT,
    p_manual_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_mode TEXT;
    v_man TEXT;
    v_sub_name TEXT;
    v_effective TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required.';
    END IF;

    v_actor_id := auth.uid();
    v_mode := UPPER(TRIM(p_status_mode));
    IF v_mode NOT IN ('AUTOMATIC', 'MANUAL') THEN
        RAISE EXCEPTION 'Invalid status mode: %. Must be AUTOMATIC or MANUAL.', p_status_mode;
    END IF;

    IF v_mode = 'MANUAL' THEN
        v_man := UPPER(TRIM(p_manual_status));
        IF v_man NOT IN ('UPCOMING', 'REGISTRATIONS OPEN', 'REGISTRATIONS CLOSED', 'ONGOING', 'COMPLETED') THEN
            RAISE EXCEPTION 'Invalid manual status: %. Must be UPCOMING, REGISTRATIONS OPEN, REGISTRATIONS CLOSED, ONGOING, or COMPLETED.', p_manual_status;
        END IF;
    ELSE
        v_man := NULL;
    END IF;

    SELECT name INTO v_sub_name FROM public.sub_events WHERE id = p_sub_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found.';
    END IF;

    UPDATE public.sub_events
    SET status_mode = v_mode,
        manual_status = v_man
    WHERE id = p_sub_event_id;

    SELECT public.resolve_effective_sub_event_status(p_sub_event_id) INTO v_effective;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'SUB_EVENT_STATUS_CHANGED',
        'SUB_EVENT',
        p_sub_event_id,
        jsonb_build_object(
            'sub_event_name', v_sub_name,
            'status_mode', v_mode,
            'manual_status', v_man,
            'effective_status', v_effective
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'status_mode', v_mode,
        'manual_status', v_man,
        'effective_status', v_effective
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_sub_event_status(UUID, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_set_sub_event_status(UUID, TEXT, TEXT) TO authenticated;


-- ============================================================================
-- 4. HARDENED ARCHIVE & RESTORE RPCS (PRESERVING INDEPENDENT CHILD STATES)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_archive_event(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_event_name VARCHAR;
    v_actor_id UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can archive events.';
    END IF;

    SELECT name INTO v_event_name FROM public.events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found.';
    END IF;

    v_actor_id := auth.uid();

    -- Set ONLY this event to ARCHIVED. Child categories and sub-events maintain their own state.
    UPDATE public.events SET status = 'ARCHIVED'::public.event_status WHERE id = p_event_id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'EVENT_ARCHIVED',
        'EVENT',
        p_event_id,
        jsonb_build_object('event_name', v_event_name, 'previous_status', 'ACTIVE', 'new_status', 'ARCHIVED'),
        NOW()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Event successfully archived.');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_event(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_event_name VARCHAR;
    v_actor_id UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can restore events.';
    END IF;

    SELECT name INTO v_event_name FROM public.events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found.';
    END IF;

    v_actor_id := auth.uid();

    -- Restore ONLY this event. Do NOT overwrite independently archived children!
    UPDATE public.events SET status = 'ACTIVE'::public.event_status WHERE id = p_event_id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'EVENT_RESTORED',
        'EVENT',
        p_event_id,
        jsonb_build_object('event_name', v_event_name, 'previous_status', 'ARCHIVED', 'new_status', 'ACTIVE'),
        NOW()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Event successfully restored.');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_archive_category(p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_cat_name VARCHAR;
    v_actor_id UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can archive categories.';
    END IF;

    SELECT name INTO v_cat_name FROM public.categories WHERE id = p_category_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Category not found.';
    END IF;

    v_actor_id := auth.uid();

    UPDATE public.categories SET status = 'ARCHIVED'::public.event_status WHERE id = p_category_id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'CATEGORY_ARCHIVED',
        'CATEGORY',
        p_category_id,
        jsonb_build_object('category_name', v_cat_name),
        NOW()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Category archived.');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_category(p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_cat_name VARCHAR;
    v_actor_id UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can restore categories.';
    END IF;

    SELECT name INTO v_cat_name FROM public.categories WHERE id = p_category_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Category not found.';
    END IF;

    v_actor_id := auth.uid();

    UPDATE public.categories SET status = 'ACTIVE'::public.event_status WHERE id = p_category_id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'CATEGORY_RESTORED',
        'CATEGORY',
        p_category_id,
        jsonb_build_object('category_name', v_cat_name),
        NOW()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Category restored.');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_archive_sub_event(p_sub_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_sub_name VARCHAR;
    v_actor_id UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can archive sub-events.';
    END IF;

    SELECT name INTO v_sub_name FROM public.sub_events WHERE id = p_sub_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found.';
    END IF;

    v_actor_id := auth.uid();

    UPDATE public.sub_events SET status = 'ARCHIVED'::public.event_status WHERE id = p_sub_event_id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'SUB_EVENT_ARCHIVED',
        'SUB_EVENT',
        p_sub_event_id,
        jsonb_build_object('sub_event_name', v_sub_name),
        NOW()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Sub-event archived.');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_sub_event(p_sub_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_sub_name VARCHAR;
    v_actor_id UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can restore sub-events.';
    END IF;

    SELECT name INTO v_sub_name FROM public.sub_events WHERE id = p_sub_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found.';
    END IF;

    v_actor_id := auth.uid();

    UPDATE public.sub_events SET status = 'ACTIVE'::public.event_status WHERE id = p_sub_event_id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'SUB_EVENT_RESTORED',
        'SUB_EVENT',
        p_sub_event_id,
        jsonb_build_object('sub_event_name', v_sub_name),
        NOW()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Sub-event restored.');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_archive_event(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_archive_event(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_restore_event(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_restore_event(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_archive_category(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_archive_category(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_restore_category(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_restore_category(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_archive_sub_event(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_archive_sub_event(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_restore_sub_event(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_restore_sub_event(UUID) TO authenticated;


-- ============================================================================
-- 5. REGISTRATION SERVER-SIDE ENFORCEMENT (student_register_atomic)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.student_register_atomic(
    p_sub_event_id UUID,
    p_mode VARCHAR,
    p_team_name VARCHAR,
    p_team_members JSONB,
    p_uploaded_documents JSONB DEFAULT '[]'::jsonb,
    p_payment_reference TEXT DEFAULT NULL,
    p_payment_method VARCHAR DEFAULT 'UPI'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_leader_id UUID;
    v_user_status VARCHAR;
    v_sub_event RECORD;
    v_parent_event_status public.event_status;
    v_cat_status public.event_status;
    v_effective_status TEXT;
    v_fee NUMERIC;
    v_is_cod BOOLEAN;
    v_initial_status public.registration_status;
    v_reg_id UUID;
    v_team_id UUID;
    v_team_title VARCHAR;
    v_sorted_rolls TEXT[];
    v_roll TEXT;
    v_lock_key BIGINT;
    v_duplicate_roll TEXT;
    v_token_prefix TEXT;
    v_m JSONB;
    v_idx INTEGER := 0;
    v_is_leader BOOLEAN;
    v_manual_token TEXT;
    v_qr_identity UUID;
    v_member_name TEXT;
    v_member_roll TEXT;
    v_created_members JSONB := '[]'::jsonb;
    v_doc JSONB;
    v_pay_status public.payment_status := 'SUCCESS';
    v_pay_ref TEXT := trim(COALESCE(p_payment_reference, ''));
    v_pay_method VARCHAR := trim(COALESCE(p_payment_method, 'UPI'));
    v_payment RECORD;
BEGIN
    v_leader_id := auth.uid();
    IF v_leader_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: valid student JWT session expected';
    END IF;

    -- 1. Validate student account status (Reject DEACTIVATED / ANONYMIZED)
    SELECT status INTO v_user_status FROM public.users WHERE id = v_leader_id;
    IF v_user_status IS NULL OR v_user_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Account is inactive, suspended, or deactivated';
    END IF;

    IF p_sub_event_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'sub_event_id is required');
    END IF;

    IF p_mode NOT IN ('SOLO', 'TEAM') THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'mode must be SOLO or TEAM');
    END IF;

    IF p_team_members IS NULL OR jsonb_typeof(p_team_members) <> 'array' OR jsonb_array_length(p_team_members) = 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'At least one participant is required');
    END IF;

    -- 2. Fetch sub-event record
    SELECT * INTO v_sub_event
    FROM public.sub_events
    WHERE id = p_sub_event_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'message', 'Sub-event not found');
    END IF;

    -- 3. Archive hierarchy validation
    IF v_sub_event.status <> 'ACTIVE'::public.event_status THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_ARCHIVED', 'message', 'This sub-event is archived and closed for registration');
    END IF;

    IF v_sub_event.category_id IS NOT NULL THEN
        SELECT status INTO v_cat_status FROM public.categories WHERE id = v_sub_event.category_id;
        IF v_cat_status IS NOT NULL AND v_cat_status <> 'ACTIVE'::public.event_status THEN
            RETURN jsonb_build_object('success', false, 'code', 'CATEGORY_ARCHIVED', 'message', 'This category track is archived and closed for new registrations');
        END IF;
    END IF;

    SELECT e.status INTO v_parent_event_status
    FROM public.events e
    WHERE e.id = v_sub_event.event_id 
       OR e.id IN (SELECT c.event_id FROM public.categories c WHERE c.id = v_sub_event.category_id);

    IF v_parent_event_status IS NOT NULL AND v_parent_event_status <> 'ACTIVE'::public.event_status THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_ARCHIVED', 'message', 'This event is archived and closed for new registrations');
    END IF;

    -- 4. Authoritative Effective Lifecycle Status Validation (Strict 5-state rules)
    v_effective_status := public.effective_status(v_sub_event);

    IF v_effective_status = 'UPCOMING' THEN
        RETURN jsonb_build_object('success', false, 'code', 'REGISTRATION_NOT_OPEN', 'message', 'Registration has not opened yet for this competition');
    ELSIF v_effective_status = 'REGISTRATIONS CLOSED' THEN
        RETURN jsonb_build_object('success', false, 'code', 'REGISTRATIONS_CLOSED', 'message', 'Registrations are currently closed for this competition');
    ELSIF v_effective_status = 'ONGOING' THEN
        RETURN jsonb_build_object('success', false, 'code', 'REGISTRATION_CLOSED', 'message', 'This competition is currently ongoing; registrations are closed');
    ELSIF v_effective_status = 'COMPLETED' THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_COMPLETED', 'message', 'This competition has already concluded');
    ELSIF v_effective_status <> 'REGISTRATIONS OPEN' THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_CLOSED', 'message', 'This competition is not open for registration');
    END IF;

    -- 5. Participation type validation
    IF v_sub_event.participation_type = 'SOLO' AND p_mode <> 'SOLO' THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'This sub-event only permits SOLO registrations');
    END IF;
    IF v_sub_event.participation_type = 'TEAM' AND p_mode <> 'TEAM' THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'This sub-event requires TEAM registration');
    END IF;

    IF p_mode = 'TEAM' THEN
        IF jsonb_array_length(p_team_members) < 2 THEN
            RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'Team registration requires at least 2 members');
        END IF;
        IF jsonb_array_length(p_team_members) > COALESCE(v_sub_event.max_team_size, 4) THEN
            RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', format('Team size cannot exceed maximum limit of %s', COALESCE(v_sub_event.max_team_size, 4)));
        END IF;
        IF p_team_name IS NULL OR length(trim(p_team_name)) = 0 THEN
            RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'Team name is required for team participation');
        END IF;
    END IF;

    -- Advisory locks on roll numbers to prevent concurrent double-booking
    SELECT ARRAY(
        SELECT DISTINCT UPPER(trim(m->>'snapshot_roll_number'))
        FROM jsonb_array_elements(p_team_members) AS m
        WHERE m->>'snapshot_roll_number' IS NOT NULL AND length(trim(m->>'snapshot_roll_number')) > 0
        ORDER BY 1 ASC
    ) INTO v_sorted_rolls;

    IF v_sorted_rolls IS NOT NULL AND array_length(v_sorted_rolls, 1) > 0 THEN
        FOREACH v_roll IN ARRAY v_sorted_rolls LOOP
            v_lock_key := ('x' || substr(md5('kits_eos_sub_roll:' || p_sub_event_id::text || ':' || v_roll), 1, 16))::bit(64)::bigint;
            PERFORM pg_advisory_xact_lock(v_lock_key);
        END LOOP;
    END IF;

    -- Check if leader already registered
    IF EXISTS (
        SELECT 1 FROM public.registrations
        WHERE sub_event_id = p_sub_event_id
          AND leader_id = v_leader_id
          AND status <> 'CANCELLED'::public.registration_status
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'ALREADY_REGISTERED', 'message', 'You already have an active registration for this sub-event');
    END IF;

    -- Check duplicate participants
    IF v_sorted_rolls IS NOT NULL AND array_length(v_sorted_rolls, 1) > 0 THEN
        SELECT tm.snapshot_roll_number INTO v_duplicate_roll
        FROM public.team_members tm
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE r.sub_event_id = p_sub_event_id
          AND r.status IN ('CONFIRMED'::public.registration_status, 'PENDING_PAYMENT'::public.registration_status)
          AND UPPER(trim(tm.snapshot_roll_number)) = ANY(v_sorted_rolls)
        LIMIT 1;

        IF v_duplicate_roll IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'MEMBER_ALREADY_REGISTERED',
                'message', format('Participant with roll number %s is already registered for this sub-event.', v_duplicate_roll)
            );
        END IF;
    END IF;

    v_fee := CASE WHEN p_mode = 'TEAM' THEN COALESCE(v_sub_event.fee_amount_team, 0) ELSE COALESCE(v_sub_event.fee_amount_solo, 0) END;
    v_is_cod := (v_fee > 0 AND v_pay_method = 'COD');
    v_initial_status := CASE WHEN v_is_cod THEN 'PENDING_PAYMENT'::public.registration_status ELSE 'CONFIRMED'::public.registration_status END;

    -- Atomic capacity increment
    UPDATE public.sub_events
    SET registered_count = registered_count + 1
    WHERE id = p_sub_event_id
      AND status = 'ACTIVE'::public.event_status
      AND (max_capacity IS NULL OR registered_count < max_capacity)
    RETURNING id, name, attendance_token_prefix
    INTO v_sub_event;

    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.sub_events WHERE id = p_sub_event_id AND status <> 'ACTIVE'::public.event_status) THEN
            RETURN jsonb_build_object('success', false, 'code', 'EVENT_CLOSED', 'message', 'This sub-event is currently closed for registration');
        ELSE
            RETURN jsonb_build_object('success', false, 'code', 'CAPACITY_REACHED', 'message', 'Registration capacity for this sub-event is full.');
        END IF;
    END IF;

    -- Insert registration
    INSERT INTO public.registrations (
        sub_event_id,
        leader_id,
        status,
        created_at
    ) VALUES (
        p_sub_event_id,
        v_leader_id,
        v_initial_status,
        NOW()
    ) RETURNING id INTO v_reg_id;

    -- Insert team
    v_team_title := CASE WHEN p_mode = 'TEAM' THEN trim(p_team_name) ELSE 'Solo Participant' END;
    INSERT INTO public.teams (
        registration_id,
        team_name
    ) VALUES (
        v_reg_id,
        v_team_title
    ) RETURNING id INTO v_team_id;

    v_token_prefix := COALESCE(v_sub_event.attendance_token_prefix, v_sub_event.name, 'EVENT');

    -- Insert team members with immutable snapshot details
    FOR v_m IN SELECT * FROM jsonb_array_elements(p_team_members) LOOP
        v_idx := v_idx + 1;
        v_is_leader := (v_idx = 1);
        v_manual_token := public.generate_attendance_token(v_token_prefix);
        v_qr_identity := gen_random_uuid();
        v_member_name := trim(COALESCE(v_m->>'snapshot_name', v_m->>'name', 'Participant'));
        v_member_roll := UPPER(trim(COALESCE(v_m->>'snapshot_roll_number', v_m->>'roll_number', '')));

        INSERT INTO public.team_members (
            team_id,
            user_id,
            snapshot_name,
            snapshot_roll_number,
            snapshot_college,
            snapshot_department,
            snapshot_year,
            is_leader,
            manual_token,
            qr_identity
        ) VALUES (
            v_team_id,
            CASE WHEN v_is_leader THEN v_leader_id ELSE NULL END,
            v_member_name,
            v_member_roll,
            trim(COALESCE(v_m->>'snapshot_college', v_m->>'college', 'KITS Akshar Institute of Technology')),
            trim(COALESCE(v_m->>'snapshot_department', v_m->>'department', '')),
            COALESCE((v_m->>'snapshot_year')::integer, (v_m->>'year_of_study')::integer, 3),
            v_is_leader,
            v_manual_token,
            v_qr_identity
        );

        v_created_members := v_created_members || jsonb_build_object(
            'id', v_qr_identity,
            'name', v_member_name,
            'roll_number', v_member_roll,
            'is_leader', v_is_leader,
            'manual_token', v_manual_token,
            'qr_identity', v_qr_identity
        );
    END LOOP;

    -- Attach uploaded documents if any
    IF p_uploaded_documents IS NOT NULL AND jsonb_typeof(p_uploaded_documents) = 'array' AND jsonb_array_length(p_uploaded_documents) > 0 THEN
        FOR v_doc IN SELECT * FROM jsonb_array_elements(p_uploaded_documents) LOOP
            INSERT INTO public.documents (
                owner_id,
                entity_type,
                entity_id,
                storage_path,
                file_name,
                mime_type,
                size_bytes,
                uploaded_at
            ) VALUES (
                v_leader_id,
                'REGISTRATION'::public.document_entity_type,
                v_reg_id,
                v_doc->>'storage_path',
                COALESCE(v_doc->>'file_name', 'document'),
                COALESCE(v_doc->>'mime_type', 'application/octet-stream'),
                COALESCE((v_doc->>'size_bytes')::bigint, 0),
                NOW()
            );
        END LOOP;
    END IF;

    -- Attach payments
    IF v_fee = 0 THEN
        v_pay_method := 'FREE';
        v_pay_status := 'SUCCESS';
        IF v_pay_ref = '' THEN v_pay_ref := 'FREE-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'); END IF;
    ELSIF v_pay_method = 'COD' THEN
        v_pay_status := 'PENDING';
        IF v_pay_ref = '' THEN v_pay_ref := 'COD-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'); END IF;
    ELSIF v_pay_method = 'ONLINE' THEN
        v_pay_status := 'SUCCESS';
        IF v_pay_ref = '' THEN v_pay_ref := 'ONLINE-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'); END IF;
    ELSE
        v_pay_method := 'UPI';
        v_pay_status := 'SUCCESS';
        IF v_pay_ref = '' THEN v_pay_ref := 'UPI-DEMO-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0'); END IF;
    END IF;

    INSERT INTO public.payments (
        registration_id,
        amount,
        reference_id,
        payment_method,
        status,
        created_at
    ) VALUES (
        v_reg_id,
        v_fee,
        v_pay_ref,
        v_pay_method,
        v_pay_status,
        NOW()
    ) RETURNING id, amount, reference_id, payment_method, status INTO v_payment;

    -- Audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_leader_id,
        'REGISTRATION_CREATED',
        'registrations',
        v_reg_id,
        jsonb_build_object(
            'sub_event_id', p_sub_event_id,
            'sub_event_name', v_sub_event.name,
            'mode', p_mode,
            'team_id', v_team_id,
            'team_name', v_team_title,
            'members_count', v_idx,
            'payment_method', v_pay_method,
            'payment_status', v_pay_status,
            'fee_amount', v_fee
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'registration_id', v_reg_id,
        'team_id', v_team_id,
        'members_count', v_idx,
        'payment', jsonb_build_object(
            'id', v_payment.id,
            'status', v_payment.status,
            'amount', v_payment.amount,
            'payment_method', v_payment.payment_method,
            'reference_id', v_payment.reference_id
        ),
        'members', v_created_members
    );

EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
        'success', false,
        'code', 'ALREADY_REGISTERED',
        'message', 'You already have an active registration for this sub-event'
    );
END;
$$;
REVOKE ALL ON FUNCTION public.student_register_atomic(UUID, VARCHAR, VARCHAR, JSONB, JSONB, TEXT, VARCHAR) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_register_atomic(UUID, VARCHAR, VARCHAR, JSONB, JSONB, TEXT, VARCHAR) TO authenticated;


-- ============================================================================
-- 6. STUDENT SELF ACCOUNT DEACTIVATION & 15-DAY RECOVERY RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.student_deactivate_account(p_confirmation_phrase TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_role public.user_role;
    v_status public.user_status;
    v_email VARCHAR;
    v_scheduled TIMESTAMPTZ;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF TRIM(p_confirmation_phrase) <> 'DELETE MY ACCOUNT' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_CONFIRMATION',
            'message', 'You must type "DELETE MY ACCOUNT" exactly to confirm deactivation.'
        );
    END IF;

    SELECT role, status, email INTO v_role, v_status, v_email
    FROM public.users
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found.';
    END IF;

    IF v_role <> 'STUDENT'::public.user_role THEN
        RAISE EXCEPTION 'Only student accounts can be deactivated through this self-service operation.';
    END IF;

    IF v_status = 'DEACTIVATED'::public.user_status THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ALREADY_DEACTIVATED',
            'message', 'Account is already deactivated.'
        );
    END IF;

    v_scheduled := NOW() + INTERVAL '15 days';

    UPDATE public.users
    SET status = 'DEACTIVATED'::public.user_status,
        deactivated_at = NOW(),
        scheduled_permanent_deletion_at = v_scheduled,
        updated_at = NOW()
    WHERE id = v_user_id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_user_id,
        'STUDENT_ACCOUNT_DEACTIVATED',
        'USER',
        v_user_id,
        jsonb_build_object(
            'email', v_email,
            'deactivated_at', NOW(),
            'scheduled_permanent_deletion_at', v_scheduled
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Your account has been deactivated successfully. You may reactivate within 15 days.',
        'deactivated_at', NOW(),
        'scheduled_permanent_deletion_at', v_scheduled
    );
END;
$$;
REVOKE ALL ON FUNCTION public.student_deactivate_account(TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.student_deactivate_account(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.student_reactivate_account(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_user RECORD;
    v_clean_email VARCHAR;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_user
    FROM public.users
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User account not found.';
    END IF;

    IF v_user.status <> 'DEACTIVATED'::public.user_status THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'NOT_DEACTIVATED',
            'message', 'Account is not in deactivated state.'
        );
    END IF;

    -- Verify 15-day grace period has NOT expired
    IF v_user.scheduled_permanent_deletion_at IS NOT NULL AND NOW() >= v_user.scheduled_permanent_deletion_at THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'GRACE_PERIOD_EXPIRED',
            'message', 'The 15-day recovery window has expired. This account is scheduled for permanent deletion and cannot be recovered.'
        );
    END IF;

    -- Verify email confirmation
    v_clean_email := LOWER(TRIM(p_email));
    IF v_clean_email <> LOWER(TRIM(v_user.email)) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'EMAIL_MISMATCH',
            'message', 'Entered email does not match the account email address.'
        );
    END IF;

    -- Reactivate account
    UPDATE public.users
    SET status = 'ACTIVE'::public.user_status,
        deactivated_at = NULL,
        scheduled_permanent_deletion_at = NULL,
        updated_at = NOW()
    WHERE id = v_user_id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_user_id,
        'STUDENT_ACCOUNT_REACTIVATED',
        'USER',
        v_user_id,
        jsonb_build_object(
            'email', v_user.email,
            'reactivated_at', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Your KITS-EOS account has been restored successfully.'
    );
END;
$$;
REVOKE ALL ON FUNCTION public.student_reactivate_account(TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.student_reactivate_account(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_student_account_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_user RECORD;
    v_days_remaining NUMERIC;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT id, email, role, status, deactivated_at, scheduled_permanent_deletion_at
    INTO v_user
    FROM public.users
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'User not found');
    END IF;

    IF v_user.scheduled_permanent_deletion_at IS NOT NULL THEN
        v_days_remaining := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_user.scheduled_permanent_deletion_at - NOW())) / 86400.0, 1));
    ELSE
        v_days_remaining := NULL;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_user.id,
        'email', v_user.email,
        'role', v_user.role,
        'status', v_user.status,
        'deactivated_at', v_user.deactivated_at,
        'scheduled_permanent_deletion_at', v_user.scheduled_permanent_deletion_at,
        'days_remaining', v_days_remaining,
        'is_expired', (v_user.scheduled_permanent_deletion_at IS NOT NULL AND NOW() >= v_user.scheduled_permanent_deletion_at)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.get_student_account_status() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_student_account_status() TO authenticated;


-- ============================================================================
-- 7. CLEANUP EXPIRED STUDENT ACCOUNT DATA & AUTOMATED WORKER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_student_account_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user RECORD;
BEGIN
    IF SESSION_USER != 'postgres' AND COALESCE(auth.role(), '') != 'service_role' THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'Access denied. Administrator privileges or service_role required.';
        END IF;
    END IF;

    SELECT * INTO v_user
    FROM public.users
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    IF v_user.status <> 'DEACTIVATED'::public.user_status OR v_user.scheduled_permanent_deletion_at > NOW() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Account is not an expired deactivated account');
    END IF;

    -- Unlink registrations leader_id and team_members user_id (preserving historical records)
    UPDATE public.registrations SET leader_id = NULL WHERE leader_id = p_user_id;
    UPDATE public.team_members SET user_id = NULL WHERE user_id = p_user_id;
    UPDATE public.documents SET owner_id = NULL WHERE owner_id = p_user_id;
    UPDATE public.complaints SET user_id = NULL WHERE user_id = p_user_id;
    UPDATE public.certificate_corrections SET corrected_by = NULL WHERE corrected_by = p_user_id;

    -- Delete personal profile, notifications, and privacy requests
    DELETE FROM public.student_profiles WHERE user_id = p_user_id;
    DELETE FROM public.notifications WHERE user_id = p_user_id;
    DELETE FROM public.privacy_requests WHERE user_id = p_user_id;
    DELETE FROM public.users WHERE id = p_user_id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        p_user_id,
        'STUDENT_ACCOUNT_PERMANENTLY_DELETED',
        'USER',
        p_user_id,
        jsonb_build_object(
            'email', v_user.email,
            'deactivated_at', v_user.deactivated_at,
            'deleted_at', NOW(),
            'reason', '15_day_grace_period_expired'
        ),
        NOW()
    );

    RETURN jsonb_build_object('success', true, 'email', v_user.email);
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_expired_student_account_data(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_student_account_data(UUID) TO authenticated;

-- pg_cron worker invocation function
CREATE OR REPLACE FUNCTION public.invoke_student_account_cleanup_worker()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_secret TEXT;
    v_pending_count INT;
    v_request_id BIGINT;
BEGIN
    IF SESSION_USER != 'postgres' AND COALESCE(auth.role(), '') != 'service_role' THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'Access denied. Administrator privileges or service_role required.';
        END IF;
    END IF;

    SELECT COUNT(*) INTO v_pending_count
    FROM public.users
    WHERE status = 'DEACTIVATED'::public.user_status
      AND scheduled_permanent_deletion_at IS NOT NULL
      AND scheduled_permanent_deletion_at <= NOW();

    IF v_pending_count = 0 THEN
        RETURN jsonb_build_object('triggered', false, 'pending_count', 0, 'message', 'No expired deactivated accounts found.');
    END IF;

    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

    IF v_secret IS NULL OR length(trim(v_secret)) = 0 THEN
        RETURN jsonb_build_object('triggered', false, 'pending_count', v_pending_count, 'error', 'service_role_key not in vault');
    END IF;

    SELECT net.http_post(
        url := 'https://jngmmjbmimxpndpoloib.supabase.co/functions/v1/student-account-cleanup',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_secret
        ),
        body := jsonb_build_object('trigger', 'pg_cron', 'timestamp', NOW())
    ) INTO v_request_id;

    RETURN jsonb_build_object(
        'triggered', true,
        'pending_count', v_pending_count,
        'net_request_id', v_request_id,
        'timestamp', NOW()
    );
END;
$$;

-- Schedule cron job to run hourly
DO $$
BEGIN
    PERFORM cron.unschedule('kits-eos-student-account-cleanup-worker');
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

SELECT cron.schedule(
    'kits-eos-student-account-cleanup-worker',
    '0 * * * *',
    'SELECT public.invoke_student_account_cleanup_worker();'
);
