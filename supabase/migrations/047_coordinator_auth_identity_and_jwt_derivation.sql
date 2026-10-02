-- Migration 047: Coordinator Cryptographic Authentication & JWT-Derived Authorization Architecture
--
-- 1. Explicit Identity Link: auth.users(id) -> public.coordinators(auth_user_id)
-- 2. Pure Server-Side Identity Derivation: auth.uid() -> coordinators.auth_user_id (Zero client-supplied coordinator IDs)
-- 3. Strict Server-Side Assignment Authorization
-- 4. Authoritative First-Request Lifecycle Gate: validate_coordinator_session()

-- ============================================================================
-- 1. SCHEMA EXPANSION & IDENTITY LINK
-- ============================================================================

-- Ensure COORDINATOR is present in user_role enum
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumtypid = 'user_role'::regtype AND enumlabel = 'COORDINATOR'
    ) THEN
        ALTER TYPE user_role ADD VALUE 'COORDINATOR';
    END IF;
END $$;

-- Add auth_user_id column to coordinators
ALTER TABLE public.coordinators
ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE
REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coordinators_auth_user_id ON public.coordinators(auth_user_id);

-- Update handle_new_user() trigger function to safely detect COORDINATOR role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_email text;
    v_role public.user_role;
    v_admin_allowlist text[] := ARRAY[
        'prasanthv865@gmail.com',
        'hruthvikmanoj4608@gmail.com',
        'saideepak4408@gmail.com',
        'nerellabhavanilakshmi@gmail.com',
        'principal@kitsakshar.ac.in'
    ];
BEGIN
    v_email := lower(trim(NEW.email));
    
    IF v_email = ANY(v_admin_allowlist) THEN
        v_role := 'ADMIN';
    ELSIF NEW.raw_user_meta_data->>'role' = 'COORDINATOR' THEN
        v_role := 'COORDINATOR';
    ELSE
        v_role := 'STUDENT';
    END IF;

    INSERT INTO public.users (id, email, role, status)
    VALUES (NEW.id, NEW.email, v_role, 'ACTIVE')
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role = CASE
            WHEN lower(trim(EXCLUDED.email)) = ANY(v_admin_allowlist) THEN 'ADMIN'::public.user_role
            WHEN EXCLUDED.role = 'COORDINATOR'::public.user_role THEN 'COORDINATOR'::public.user_role
            ELSE public.users.role
        END;
        
    RETURN NEW;
END;
$function$;

-- Allow coordinators to read their own profile from public.coordinators
DROP POLICY IF EXISTS "Coordinators can read own record" ON public.coordinators;
CREATE POLICY "Coordinators can read own record" ON public.coordinators
  FOR SELECT USING (auth_user_id = auth.uid() OR is_admin());

-- ============================================================================
-- 2. HELPER: SERVER-DERIVED COORDINATOR IDENTITY
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_current_coordinator_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_id
    FROM public.coordinators
    WHERE auth_user_id = auth.uid()
      AND status = 'ACTIVE';

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_current_coordinator_id() TO authenticated;
REVOKE ALL ON FUNCTION public.get_current_coordinator_id() FROM PUBLIC, anon;

-- ============================================================================
-- 3. AUTHORITATIVE LIFECYCLE & ASSIGNMENT GATE: validate_coordinator_session()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_coordinator_session()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord RECORD;
    v_active_count INT := 0;
    v_assignments JSONB := '[]'::jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'Authentication required', 
            'access_state', 'UNAUTHORIZED'
        );
    END IF;

    SELECT * INTO v_coord 
    FROM public.coordinators 
    WHERE auth_user_id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'Coordinator profile not found for this account', 
            'access_state', 'NOT_FOUND'
        );
    END IF;

    IF v_coord.status != 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'Coordinator account is inactive or suspended', 
            'access_state', 'INACTIVE_OR_SUSPENDED'
        );
    END IF;

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
            'state_detail', 'ACTIVE_ASSIGNMENTS'
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
            'state_detail', 'NO_ACTIVE_ASSIGNMENTS'
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coordinator_session() TO authenticated;
REVOKE ALL ON FUNCTION public.validate_coordinator_session() FROM PUBLIC, anon;

-- ============================================================================
-- 4. PURE COORDINATOR RPCs (SERVER-DERIVED IDENTITY VIA auth.uid())
-- ============================================================================

-- 4.1 get_coordinator_assigned_sub_events()
CREATE OR REPLACE FUNCTION public.get_coordinator_assigned_sub_events()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_validation JSONB;
BEGIN
    SELECT public.get_current_coordinator_id() INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    v_validation := public.validate_coordinator_session();
    RETURN jsonb_build_object(
        'success', true,
        'coordinator_id', v_coord_id,
        'assignments', v_validation->'assignments'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_assigned_sub_events() TO authenticated;
REVOKE ALL ON FUNCTION public.get_coordinator_assigned_sub_events() FROM PUBLIC, anon;

-- 4.2 get_coordinator_sub_event_roster(p_sub_event_id UUID)
CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_roster(p_sub_event_id UUID)
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
BEGIN
    SELECT public.get_current_coordinator_id() INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    -- Strict server-side assignment check
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

GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_coordinator_sub_event_roster(UUID) FROM PUBLIC, anon;

-- 4.3 get_coordinator_notifications()
CREATE OR REPLACE FUNCTION public.get_coordinator_notifications()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_notifs JSONB;
BEGIN
    SELECT public.get_current_coordinator_id() INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', n.id,
            'title', n.title,
            'message', n.message,
            'priority', n.priority,
            'created_at', n.created_at,
            'is_read', (nr.read_at IS NOT NULL)
        ) ORDER BY n.created_at DESC
    ), '[]'::jsonb)
    INTO v_notifs
    FROM public.notifications n
    LEFT JOIN public.notification_reads nr ON nr.notification_id = n.id AND nr.user_id = auth.uid()
    WHERE (n.audience = 'ALL' OR n.audience = 'COORDINATORS');

    RETURN v_notifs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_notifications() TO authenticated;
REVOKE ALL ON FUNCTION public.get_coordinator_notifications() FROM PUBLIC, anon;

-- 4.4 get_coordinator_unread_count()
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
    FROM public.notifications n
    WHERE (n.audience = 'ALL' OR n.audience = 'COORDINATORS')
      AND NOT EXISTS (
          SELECT 1 FROM public.notification_reads nr 
          WHERE nr.notification_id = n.id AND nr.user_id = auth.uid()
      );

    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_unread_count() TO authenticated;
REVOKE ALL ON FUNCTION public.get_coordinator_unread_count() FROM PUBLIC, anon;

-- 4.5 mark_coordinator_notification_read(p_notification_id UUID)
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

    INSERT INTO public.notification_reads (notification_id, user_id, read_at)
    VALUES (p_notification_id, auth.uid(), NOW())
    ON CONFLICT (notification_id, user_id) DO NOTHING;

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_coordinator_notification_read(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_coordinator_notification_read(UUID) FROM PUBLIC, anon;

-- 4.6 mark_all_coordinator_notifications_read()
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

    INSERT INTO public.notification_reads (notification_id, user_id, read_at)
    SELECT n.id, auth.uid(), NOW()
    FROM public.notifications n
    WHERE (n.audience = 'ALL' OR n.audience = 'COORDINATORS')
    ON CONFLICT (notification_id, user_id) DO NOTHING;

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_coordinator_notifications_read() TO authenticated;
REVOKE ALL ON FUNCTION public.mark_all_coordinator_notifications_read() FROM PUBLIC, anon;

-- 4.7 get_sub_event_documents_for_coordinator(p_sub_event_id UUID)
CREATE OR REPLACE FUNCTION public.get_sub_event_documents_for_coordinator(p_sub_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN;
    v_docs JSONB;
BEGIN
    SELECT public.get_current_coordinator_id() INTO v_coord_id;
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required';
    END IF;

    -- Strict server-side assignment check
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
            'registration_id', r.id,
            'owner_id', d.owner_id,
            'document_definition_id', d.document_definition_id,
            'file_name', d.file_name,
            'file_size', d.file_size,
            'mime_type', d.mime_type,
            'storage_path', d.storage_path,
            'uploaded_at', d.uploaded_at,
            'verified_at', d.verified_at,
            'status', d.status,
            'participant_name', sp.full_name,
            'roll_number', sp.roll_number,
            'college', sp.college
        ) ORDER BY d.uploaded_at DESC
    ), '[]'::jsonb)
    INTO v_docs
    FROM public.documents d
    JOIN public.registrations r ON r.id = d.registration_id
    LEFT JOIN public.student_profiles sp ON sp.user_id = d.owner_id
    WHERE r.sub_event_id = p_sub_event_id;

    RETURN v_docs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sub_event_documents_for_coordinator(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_sub_event_documents_for_coordinator(UUID) FROM PUBLIC, anon;

-- ============================================================================
-- 5. SEPARATE ADMIN-FACING INSPECTION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_sub_event_roster(p_sub_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_registrations JSONB;
    v_attendance JSONB;
BEGIN
    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Administrator authorization required';
    END IF;

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
        'registrations', v_registrations,
        'attendance', v_attendance
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_sub_event_roster(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_get_sub_event_roster(UUID) FROM PUBLIC, anon;
