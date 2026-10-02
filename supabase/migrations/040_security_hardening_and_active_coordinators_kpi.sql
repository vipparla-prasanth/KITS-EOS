-- Migration 040: Live Active Coordinator KPI + Comprehensive Database/RLS Security Hardening
-- Fulfills Phase Objectives:
-- 1. Authoritative get_active_coordinators_count() live relationship query
-- 2. Elimination of mutable search_path across all functions (SET search_path = '')
-- 3. Elimination of unintended anon/PUBLIC execution of SECURITY DEFINER functions
-- 4. Protection of sensitive password_hash column on coordinators table from client Data API
-- 5. Hardening PostgreSQL default function privileges

-- ============================================================================
-- 1. AUTHORITATIVE LIVE ACTIVE COORDINATORS KPI FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_active_coordinators_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_is_admin boolean := false;
    v_count integer := 0;
BEGIN
    -- 1. Strictly require authenticated caller
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Authoritative Admin authorization check
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
          AND role = 'ADMIN'
          AND status = 'ACTIVE'
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Access denied: administrative privileges required'
            USING ERRCODE = '42501';
    END IF;

    -- 3. Authoritative Live Distinct Coordinator Count
    -- Relationships: coordinators -> coordinator_assignments -> sub_events -> (categories ->) events
    -- Only distinct active coordinator identities with >= 1 active assignment to active events/sub-events
    SELECT COUNT(DISTINCT ca.coordinator_id)::integer INTO v_count
    FROM public.coordinator_assignments ca
    JOIN public.coordinators c ON c.id = ca.coordinator_id
    JOIN public.sub_events se ON se.id = ca.sub_event_id
    LEFT JOIN public.categories cat ON cat.id = se.category_id
    JOIN public.events e ON e.id = COALESCE(se.event_id, cat.event_id)
    WHERE c.status = 'ACTIVE'
      AND se.status = 'ACTIVE'
      AND e.status = 'ACTIVE'
      AND (cat.id IS NULL OR cat.status = 'ACTIVE');

    RETURN COALESCE(v_count, 0);
END;
$$;

-- Restrict execution to authenticated administrators only (never anon or public)
REVOKE ALL ON FUNCTION public.get_active_coordinators_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_coordinators_count() TO authenticated;

-- ============================================================================
-- 2. HARDEN FUNCTIONS WITH MUTABLE SEARCH PATH & SCHEMA QUALIFICATION
-- ============================================================================

-- 2.1 is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() 
          AND role = 'ADMIN' 
          AND status = 'ACTIVE'
    );
END;
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- 2.2 handle_new_user() (Trigger function only - NOT callable via RPC)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.users (id, email, role, status)
    VALUES (NEW.id, NEW.email, 'STUDENT', 'ACTIVE')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 2.3 admin_archive_event(p_event_id uuid)
CREATE OR REPLACE FUNCTION public.admin_archive_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event_name character varying;
    v_actor_id uuid;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can archive events.';
    END IF;

    SELECT name INTO v_event_name FROM public.events WHERE id = p_event_id;
    IF v_event_name IS NULL THEN
        RAISE EXCEPTION 'Event not found.';
    END IF;

    v_actor_id := auth.uid();

    UPDATE public.events SET status = 'ARCHIVED'::public.event_status WHERE id = p_event_id;
    UPDATE public.categories SET status = 'ARCHIVED'::public.event_status WHERE event_id = p_event_id;
    UPDATE public.sub_events SET status = 'ARCHIVED'::public.event_status 
    WHERE event_id = p_event_id 
       OR category_id IN (SELECT id FROM public.categories WHERE event_id = p_event_id);

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'EVENT_ARCHIVED',
        'EVENT',
        p_event_id,
        jsonb_build_object(
            'event_name', v_event_name,
            'previous_status', 'ACTIVE',
            'new_status', 'ARCHIVED'
        ),
        pg_catalog.now()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Event successfully archived.');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_archive_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_event(uuid) TO authenticated;

-- 2.4 admin_restore_event(p_event_id uuid)
CREATE OR REPLACE FUNCTION public.admin_restore_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event_name character varying;
    v_actor_id uuid;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can restore events.';
    END IF;

    SELECT name INTO v_event_name FROM public.events WHERE id = p_event_id;
    IF v_event_name IS NULL THEN
        RAISE EXCEPTION 'Event not found.';
    END IF;

    v_actor_id := auth.uid();

    UPDATE public.events SET status = 'ACTIVE'::public.event_status WHERE id = p_event_id;
    UPDATE public.categories SET status = 'ACTIVE'::public.event_status WHERE event_id = p_event_id;
    UPDATE public.sub_events SET status = 'ACTIVE'::public.event_status 
    WHERE event_id = p_event_id 
       OR category_id IN (SELECT id FROM public.categories WHERE event_id = p_event_id);

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'EVENT_RESTORED',
        'EVENT',
        p_event_id,
        jsonb_build_object(
            'event_name', v_event_name,
            'previous_status', 'ARCHIVED',
            'new_status', 'ACTIVE'
        ),
        pg_catalog.now()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Event successfully restored.');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_restore_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_event(uuid) TO authenticated;

-- 2.5 admin_delete_event(p_event_id uuid)
CREATE OR REPLACE FUNCTION public.admin_delete_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event_name character varying;
    v_event_status public.event_status;
    v_actor_id uuid;
    v_has_registrations boolean := false;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can delete events.';
    END IF;

    SELECT name, status INTO v_event_name, v_event_status FROM public.events WHERE id = p_event_id;
    IF v_event_name IS NULL THEN
        RAISE EXCEPTION 'Event not found.';
    END IF;

    IF v_event_status != 'ARCHIVED'::public.event_status THEN
        RAISE EXCEPTION 'Illegal Operation: Only ARCHIVED events can be permanently deleted. Archive the event first.';
    END IF;

    v_actor_id := auth.uid();

    SELECT EXISTS (
        SELECT 1 FROM public.registrations r
        JOIN public.sub_events se ON r.sub_event_id = se.id
        WHERE se.event_id = p_event_id 
           OR se.category_id IN (SELECT id FROM public.categories WHERE event_id = p_event_id)
    ) INTO v_has_registrations;

    IF v_has_registrations THEN
        UPDATE public.sub_events SET status = 'PERMANENTLY_DELETED'::public.event_status
        WHERE event_id = p_event_id 
           OR category_id IN (SELECT id FROM public.categories WHERE event_id = p_event_id);

        UPDATE public.categories SET status = 'PERMANENTLY_DELETED'::public.event_status
        WHERE event_id = p_event_id;

        UPDATE public.events SET status = 'PERMANENTLY_DELETED'::public.event_status
        WHERE id = p_event_id;
    ELSE
        DELETE FROM public.coordinator_assignments 
        WHERE sub_event_id IN (
            SELECT id FROM public.sub_events 
            WHERE event_id = p_event_id 
               OR category_id IN (SELECT id FROM public.categories WHERE event_id = p_event_id)
        );

        DELETE FROM public.sub_events 
        WHERE event_id = p_event_id 
           OR category_id IN (SELECT id FROM public.categories WHERE event_id = p_event_id);

        DELETE FROM public.categories WHERE event_id = p_event_id;
        DELETE FROM public.events WHERE id = p_event_id;
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'EVENT_DELETED',
        'EVENT',
        p_event_id,
        jsonb_build_object(
            'event_name', v_event_name,
            'action', 'PERMANENT_DELETE',
            'historical_records_preserved', v_has_registrations
        ),
        pg_catalog.now()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Event permanently deleted.');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_event(uuid) TO authenticated;

-- 2.6 admin_archive_category(p_category_id uuid)
CREATE OR REPLACE FUNCTION public.admin_archive_category(p_category_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cat_name character varying;
    v_actor_id uuid;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized.';
    END IF;

    SELECT name INTO v_cat_name FROM public.categories WHERE id = p_category_id;
    IF v_cat_name IS NULL THEN
        RAISE EXCEPTION 'Category not found.';
    END IF;

    v_actor_id := auth.uid();

    UPDATE public.categories SET status = 'ARCHIVED'::public.event_status WHERE id = p_category_id;
    UPDATE public.sub_events SET status = 'ARCHIVED'::public.event_status WHERE category_id = p_category_id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'CATEGORY_ARCHIVED',
        'CATEGORY',
        p_category_id,
        jsonb_build_object('category_name', v_cat_name),
        pg_catalog.now()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Category archived.');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_archive_category(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_category(uuid) TO authenticated;

-- 2.7 admin_restore_category(p_category_id uuid)
CREATE OR REPLACE FUNCTION public.admin_restore_category(p_category_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cat_name character varying;
    v_actor_id uuid;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized.';
    END IF;

    SELECT name INTO v_cat_name FROM public.categories WHERE id = p_category_id;
    IF v_cat_name IS NULL THEN
        RAISE EXCEPTION 'Category not found.';
    END IF;

    v_actor_id := auth.uid();

    UPDATE public.categories SET status = 'ACTIVE'::public.event_status WHERE id = p_category_id;
    UPDATE public.sub_events SET status = 'ACTIVE'::public.event_status WHERE category_id = p_category_id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'CATEGORY_RESTORED',
        'CATEGORY',
        p_category_id,
        jsonb_build_object('category_name', v_cat_name),
        pg_catalog.now()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Category restored.');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_restore_category(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_category(uuid) TO authenticated;

-- 2.8 admin_delete_category(p_category_id uuid)
CREATE OR REPLACE FUNCTION public.admin_delete_category(p_category_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cat_name character varying;
    v_actor_id uuid;
    v_has_registrations boolean := false;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized.';
    END IF;

    SELECT name INTO v_cat_name FROM public.categories WHERE id = p_category_id;
    IF v_cat_name IS NULL THEN
        RAISE EXCEPTION 'Category not found.';
    END IF;

    v_actor_id := auth.uid();

    SELECT EXISTS (
        SELECT 1 FROM public.registrations r
        JOIN public.sub_events se ON r.sub_event_id = se.id
        WHERE se.category_id = p_category_id
    ) INTO v_has_registrations;

    IF v_has_registrations THEN
        UPDATE public.sub_events SET status = 'PERMANENTLY_DELETED'::public.event_status WHERE category_id = p_category_id;
        UPDATE public.categories SET status = 'PERMANENTLY_DELETED'::public.event_status WHERE id = p_category_id;
    ELSE
        DELETE FROM public.coordinator_assignments WHERE sub_event_id IN (SELECT id FROM public.sub_events WHERE category_id = p_category_id);
        DELETE FROM public.sub_events WHERE category_id = p_category_id;
        DELETE FROM public.categories WHERE id = p_category_id;
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'CATEGORY_DELETED',
        'CATEGORY',
        p_category_id,
        jsonb_build_object('category_name', v_cat_name, 'historical_records_preserved', v_has_registrations),
        pg_catalog.now()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Category deleted.');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_category(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_category(uuid) TO authenticated;

-- 2.9 admin_archive_sub_event(p_sub_event_id uuid)
CREATE OR REPLACE FUNCTION public.admin_archive_sub_event(p_sub_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sub_name character varying;
    v_actor_id uuid;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized.';
    END IF;

    SELECT name INTO v_sub_name FROM public.sub_events WHERE id = p_sub_event_id;
    IF v_sub_name IS NULL THEN
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
        pg_catalog.now()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Sub-event archived.');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_archive_sub_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_sub_event(uuid) TO authenticated;

-- 2.10 admin_restore_sub_event(p_sub_event_id uuid)
CREATE OR REPLACE FUNCTION public.admin_restore_sub_event(p_sub_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sub_name character varying;
    v_actor_id uuid;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized.';
    END IF;

    SELECT name INTO v_sub_name FROM public.sub_events WHERE id = p_sub_event_id;
    IF v_sub_name IS NULL THEN
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
        pg_catalog.now()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Sub-event restored.');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_restore_sub_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_sub_event(uuid) TO authenticated;

-- 2.11 admin_delete_sub_event(p_sub_event_id uuid)
CREATE OR REPLACE FUNCTION public.admin_delete_sub_event(p_sub_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sub_name character varying;
    v_actor_id uuid;
    v_has_registrations boolean := false;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized.';
    END IF;

    SELECT name INTO v_sub_name FROM public.sub_events WHERE id = p_sub_event_id;
    IF v_sub_name IS NULL THEN
        RAISE EXCEPTION 'Sub-event not found.';
    END IF;

    v_actor_id := auth.uid();

    SELECT EXISTS (
        SELECT 1 FROM public.registrations WHERE sub_event_id = p_sub_event_id
    ) INTO v_has_registrations;

    IF v_has_registrations THEN
        UPDATE public.sub_events SET status = 'PERMANENTLY_DELETED'::public.event_status WHERE id = p_sub_event_id;
    ELSE
        DELETE FROM public.coordinator_assignments WHERE sub_event_id = p_sub_event_id;
        DELETE FROM public.sub_events WHERE id = p_sub_event_id;
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        v_actor_id,
        'SUB_EVENT_DELETED',
        'SUB_EVENT',
        p_sub_event_id,
        jsonb_build_object('sub_event_name', v_sub_name, 'historical_records_preserved', v_has_registrations),
        pg_catalog.now()
    );

    RETURN jsonb_build_object('success', true, 'message', 'Sub-event deleted.');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_sub_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_sub_event(uuid) TO authenticated;

-- 2.12 confirm_cod_payment(p_payment_id uuid) [Preserve Exact Overload 1]
CREATE OR REPLACE FUNCTION public.confirm_cod_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payment record;
    v_reg record;
    v_actor_id uuid;
    v_actor_email text;
BEGIN
    v_actor_id := auth.uid();
    
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record not found';
    END IF;

    SELECT * INTO v_reg FROM public.registrations WHERE id = v_payment.registration_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated registration record not found';
    END IF;

    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Administrative privileges required to confirm payment';
    END IF;

    UPDATE public.payments
    SET status = 'SUCCESS'
    WHERE id = p_payment_id;

    UPDATE public.registrations
    SET status = 'CONFIRMED'
    WHERE id = v_payment.registration_id;

    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_actor_id,
        'CONFIRM_COD_PAYMENT',
        'PAYMENT',
        p_payment_id,
        jsonb_build_object(
            'payment_id', p_payment_id,
            'registration_id', v_payment.registration_id,
            'reference_id', v_payment.reference_id,
            'amount', v_payment.amount,
            'confirmed_by', COALESCE(v_actor_email, v_actor_id::text)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Payment confirmed successfully',
        'payment_id', p_payment_id,
        'amount', v_payment.amount
    );
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_cod_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_cod_payment(uuid) TO authenticated;

-- 2.13 confirm_cod_payment(p_payment_id uuid, p_coordinator_id uuid) [Preserve Exact Overload 2]
CREATE OR REPLACE FUNCTION public.confirm_cod_payment(p_payment_id uuid, p_coordinator_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payment record;
    v_reg record;
    v_actor_id uuid;
    v_actor_email text;
    v_is_admin boolean := false;
    v_coord_id uuid := NULL;
    v_is_assigned boolean := false;
    v_actor_role text := 'UNKNOWN';
BEGIN
    v_actor_id := auth.uid();

    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record not found';
    END IF;

    SELECT * INTO v_reg FROM public.registrations WHERE id = v_payment.registration_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated registration record not found';
    END IF;

    IF v_payment.status = 'SUCCESS' THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Payment is already marked as verified',
            'payment_id', p_payment_id,
            'amount', v_payment.amount,
            'status', 'SUCCESS'
        );
    END IF;

    IF v_actor_id IS NOT NULL THEN
        SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;
        
        SELECT EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = v_actor_id AND role = 'ADMIN' AND status = 'ACTIVE'
        ) INTO v_is_admin;
        
        IF v_is_admin THEN
            v_actor_role := 'ADMIN';
        ELSE
            SELECT id INTO v_coord_id
            FROM public.coordinators
            WHERE (user_id = v_actor_id OR id = v_actor_id OR lower(username) = lower(v_actor_email))
              AND status = 'ACTIVE'
            LIMIT 1;

            IF v_coord_id IS NOT NULL THEN
                SELECT EXISTS (
                    SELECT 1 FROM public.coordinator_assignments
                    WHERE coordinator_id = v_coord_id AND sub_event_id = v_reg.sub_event_id
                ) INTO v_is_assigned;

                IF v_is_assigned THEN
                    v_actor_role := 'COORDINATOR';
                END IF;
            END IF;
        END IF;
    END IF;

    IF v_actor_role = 'UNKNOWN' AND p_coordinator_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.coordinators
            WHERE id = p_coordinator_id AND status = 'ACTIVE'
        ) INTO v_is_assigned;

        IF v_is_assigned THEN
            SELECT EXISTS (
                SELECT 1 FROM public.coordinator_assignments
                WHERE coordinator_id = p_coordinator_id AND sub_event_id = v_reg.sub_event_id
            ) INTO v_is_assigned;

            IF v_is_assigned THEN
                v_coord_id := p_coordinator_id;
                v_actor_role := 'COORDINATOR';
            END IF;
        END IF;
    END IF;

    IF v_actor_role = 'UNKNOWN' THEN
        RAISE EXCEPTION 'Unauthorized: Only event administrators or assigned coordinators can verify COD payments.';
    END IF;

    UPDATE public.payments
    SET status = 'SUCCESS'
    WHERE id = p_payment_id;

    UPDATE public.registrations
    SET status = 'CONFIRMED'
    WHERE id = v_payment.registration_id;

    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        COALESCE(v_actor_id, v_coord_id),
        'CONFIRM_COD_PAYMENT',
        'PAYMENT',
        p_payment_id,
        jsonb_build_object(
            'payment_id', p_payment_id,
            'registration_id', v_payment.registration_id,
            'reference_id', v_payment.reference_id,
            'amount', v_payment.amount,
            'actor_role', v_actor_role,
            'coordinator_id', v_coord_id,
            'confirmed_at', pg_catalog.now()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Payment confirmed and verified successfully',
        'payment_id', p_payment_id,
        'amount', v_payment.amount,
        'status', 'SUCCESS'
    );
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_cod_payment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_cod_payment(uuid, uuid) TO authenticated;

-- 2.14 get_sub_event_coordinators(uuid)
CREATE OR REPLACE FUNCTION public.get_sub_event_coordinators(p_sub_event_id uuid)
RETURNS TABLE(
    assignment_id uuid,
    coordinator_id uuid,
    display_name character varying,
    phone_number character varying,
    coordinator_type character varying,
    contact_visible boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ca.id AS assignment_id,
        c.id AS coordinator_id,
        c.display_name,
        CASE WHEN c.contact_visible IS TRUE THEN c.phone_number ELSE NULL END AS phone_number,
        COALESCE(c.coordinator_type, 'FACULTY') AS coordinator_type,
        c.contact_visible
    FROM public.coordinator_assignments ca
    JOIN public.coordinators c ON ca.coordinator_id = c.id
    WHERE ca.sub_event_id = p_sub_event_id
      AND c.status = 'ACTIVE'
    ORDER BY 
        CASE WHEN c.coordinator_type = 'FACULTY' THEN 1 ELSE 2 END,
        c.display_name ASC;
END;
$$;

-- ============================================================================
-- 3. EXPLICIT EXECUTE PRIVILEGE REVOCATIONS ON REMAINING PRIVILEGED RPCS
-- ============================================================================
-- Explicitly revoke anonymous & public execution from individual privileged RPCs,
-- while granting to authenticated where legitimately needed by the application.

REVOKE ALL ON FUNCTION public.admin_bulk_delete_students(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_delete_students(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_calculate_historical_deletion_impact(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_calculate_historical_deletion_impact(text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_delete_historical_data(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_historical_data(text, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_notification_recipient_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_recipient_counts() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_send_broadcast_notification(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_broadcast_notification(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_coordinator_assigned_sub_events(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coordinator_assigned_sub_events(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_coordinator_assignment_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coordinator_assignment_state(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_coordinator_notifications(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coordinator_notifications(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_coordinator_sub_event_roster(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_coordinator_unread_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coordinator_unread_count(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_sub_event_documents_for_coordinator(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sub_event_documents_for_coordinator(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.lock_sub_event_podium_position(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_sub_event_podium_position(uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_all_coordinator_notifications_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_coordinator_notifications_read(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_coordinator_notification_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_coordinator_notification_read(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.publish_sub_event_results_and_certificates(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_sub_event_results_and_certificates(uuid, uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_event_feedback_and_unlock_certificate(uuid, integer, integer, integer, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_event_feedback_and_unlock_certificate(uuid, integer, integer, integer, integer, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.unlock_student_certificate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_student_certificate(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.unlock_student_certificate(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_student_certificate(uuid, uuid) TO authenticated;

-- Note: verify_certificate(text), verify_certificate(uuid), and get_sub_event_coordinators(uuid)
-- are INTENTIONALLY accessible to anon and authenticated for public QR/code certificate verification
-- and public coordinator contact inquiries.
GRANT EXECUTE ON FUNCTION public.verify_certificate(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_certificate(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sub_event_coordinators(uuid) TO anon, authenticated;

-- ============================================================================
-- 4. SENSITIVE COLUMN PROTECTION ON public.coordinators
-- ============================================================================
-- Prevents unauthorized exfiltration of password_hash via the Data API.
-- Server-side authentication (e.g. Edge Functions via service_role) retains access.

REVOKE SELECT ON public.coordinators FROM anon, authenticated;

GRANT SELECT (
    id,
    display_name,
    phone_number,
    coordinator_type,
    contact_visible,
    status,
    created_at,
    user_id
) ON public.coordinators TO anon;

GRANT SELECT (
    id,
    username,
    display_name,
    phone_number,
    coordinator_type,
    contact_visible,
    status,
    created_at,
    user_id
) ON public.coordinators TO authenticated;

-- ============================================================================
-- 5. HARDEN DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
-- ============================================================================
-- Ensures newly created functions do not automatically grant EXECUTE to PUBLIC or anon.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
