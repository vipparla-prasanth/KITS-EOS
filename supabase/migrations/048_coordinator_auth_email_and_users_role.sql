-- ============================================================================
-- Migration 048: Coordinator Immutable Internal Auth Email & Users Role Resolution
-- ============================================================================

-- 1. Explicit internal auth email column
ALTER TABLE public.coordinators
ADD COLUMN IF NOT EXISTS auth_email TEXT UNIQUE;

-- 2. Backfill all existing coordinators with deterministic immutable auth emails
UPDATE public.coordinators
SET auth_email = 'coord-' || id::text || '@coordinator.kits-eos.internal'
WHERE auth_email IS NULL;

-- 3. Automatically generate immutable internal auth email for new coordinators
CREATE OR REPLACE FUNCTION public.set_coordinator_auth_email()
RETURNS trigger AS $$
BEGIN
    IF NEW.auth_email IS NULL THEN
        NEW.auth_email := 'coord-' || NEW.id::text || '@coordinator.kits-eos.internal';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_coordinator_auth_email ON public.coordinators;
CREATE TRIGGER trg_set_coordinator_auth_email
BEFORE INSERT ON public.coordinators
FOR EACH ROW
EXECUTE FUNCTION public.set_coordinator_auth_email();

-- 4. Ensure authenticated users can read only their own record in public.users
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can read own record" ON public.users;

CREATE POLICY "Users can read own record"
ON public.users
FOR SELECT
TO authenticated
USING (auth.uid() = id);

GRANT SELECT ON public.users TO authenticated;
REVOKE ALL ON public.users FROM anon, PUBLIC;

-- 5. RPC for secure profile & role resolution without exposing table rows
CREATE OR REPLACE FUNCTION public.get_current_user_profile()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user RECORD;
    v_coord RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    -- Check coordinators first
    SELECT id, username, display_name, status, coordinator_type INTO v_coord
    FROM public.coordinators
    WHERE auth_user_id = auth.uid();

    IF FOUND THEN
        RETURN jsonb_build_object(
            'id', auth.uid(),
            'coordinator_id', v_coord.id,
            'role', 'COORDINATOR',
            'status', v_coord.status,
            'username', v_coord.username,
            'display_name', v_coord.display_name,
            'coordinator_type', v_coord.coordinator_type
        );
    END IF;

    -- Check public.users
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
REVOKE ALL ON FUNCTION public.get_current_user_profile() FROM PUBLIC, anon;

-- 6. Notification RPCs relying on direct public.notifications schema
DROP FUNCTION IF EXISTS public.get_coordinator_notifications();

CREATE OR REPLACE FUNCTION public.get_coordinator_notifications()
RETURNS SETOF public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
BEGIN
    SELECT public.get_current_coordinator_id() INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT *
    FROM public.notifications
    WHERE coordinator_id = v_coord_id
       OR audience = 'COORDINATORS'
       OR audience = 'ALL'
    ORDER BY created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_notifications() TO authenticated;
REVOKE ALL ON FUNCTION public.get_coordinator_notifications() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_coordinator_unread_count()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_count INT := 0;
BEGIN
    SELECT public.get_current_coordinator_id() INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RETURN 0;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM public.notifications
    WHERE (coordinator_id = v_coord_id OR audience = 'COORDINATORS' OR audience = 'ALL')
      AND is_read = false;

    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_unread_count() TO authenticated;
REVOKE ALL ON FUNCTION public.get_coordinator_unread_count() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.mark_coordinator_notification_read(p_notification_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
BEGIN
    SELECT public.get_current_coordinator_id() INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    UPDATE public.notifications
    SET is_read = TRUE
    WHERE id = p_notification_id
      AND (coordinator_id = v_coord_id OR audience = 'COORDINATORS' OR audience = 'ALL');

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_coordinator_notification_read(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_coordinator_notification_read(UUID) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.mark_all_coordinator_notifications_read()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
BEGIN
    SELECT public.get_current_coordinator_id() INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    UPDATE public.notifications
    SET is_read = TRUE
    WHERE (coordinator_id = v_coord_id OR audience = 'COORDINATORS' OR audience = 'ALL')
      AND is_read = false;

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_coordinator_notifications_read() TO authenticated;
REVOKE ALL ON FUNCTION public.mark_all_coordinator_notifications_read() FROM PUBLIC, anon;

