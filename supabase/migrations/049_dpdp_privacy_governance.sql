-- Migration 049: Digital Personal Data Protection (DPDP) Privacy Governance & Architecture
-- Aligned with India's Digital Personal Data Protection Act, 2023 and notified DPDP Rules, 2025.
-- 
-- 1. Eliminate confirmed insecure legacy coordinator RPC overloads.
-- 2. Add privacy notice acknowledgement tracking to student_profiles (DEFAULT NULL for existing students).
-- 3. Controlled Student Privacy & Data Rights Request System (privacy_requests).
-- 4. Authoritative, non-destructive Privacy Notice acknowledgement RPC with audit logging.
-- 5. Secure, server-derived personal data export RPC (get_student_personal_data_export) strictly respecting team data privacy.
-- 6. Admin privacy request review & resolution RPC with audit logging.

-- ============================================================================
-- 1. SECURITY FIX: DROP CONFIRMED INSECURE LEGACY COORDINATOR RPC OVERLOADS
-- ============================================================================

-- The old 2-argument overload accepted arbitrary client-supplied coordinator IDs
-- and was executable by anon. Drop it safely now that coordinator auth uses JWTs.
DROP FUNCTION IF EXISTS public.get_coordinator_sub_event_roster(UUID, UUID);

-- The old 1-argument overload taking p_coordinator_id UUID
DROP FUNCTION IF EXISTS public.get_coordinator_assigned_sub_events(UUID);
DROP FUNCTION IF EXISTS public.get_coordinator_assignment_state(UUID);
DROP FUNCTION IF EXISTS public.get_coordinator_notifications(UUID);
DROP FUNCTION IF EXISTS public.get_coordinator_unread_count(UUID);

-- Ensure the secure 1-argument overload of get_coordinator_sub_event_roster(p_sub_event_id UUID)
-- is strictly revoked from anon and granted only to authenticated.
REVOKE ALL ON FUNCTION public.get_coordinator_sub_event_roster(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_roster(UUID) TO authenticated;

-- Ensure secure zero-argument versions are revoked from anon
REVOKE ALL ON FUNCTION public.get_coordinator_assigned_sub_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coordinator_assigned_sub_events() TO authenticated;

REVOKE ALL ON FUNCTION public.get_coordinator_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coordinator_notifications() TO authenticated;

REVOKE ALL ON FUNCTION public.get_coordinator_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coordinator_unread_count() TO authenticated;


-- ============================================================================
-- 2. STUDENT PROFILES: PRIVACY NOTICE TRACKING COLUMNS
-- ============================================================================

-- CRITICAL RULE: Must default to NULL so existing students are NOT falsely marked as acknowledged.
ALTER TABLE public.student_profiles
ADD COLUMN IF NOT EXISTS privacy_notice_version VARCHAR(20) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS privacy_acknowledged_at TIMESTAMPTZ DEFAULT NULL;

-- Grant column access
GRANT SELECT ON TABLE public.student_profiles TO authenticated;
GRANT UPDATE (privacy_notice_version, privacy_acknowledged_at) ON public.student_profiles TO authenticated;


-- ============================================================================
-- 3. CONTROLLED PRIVACY & DATA RIGHTS REQUEST SYSTEM
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.privacy_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('DATA_ACCESS', 'DATA_CORRECTION', 'DATA_DELETION', 'DATA_PORTABILITY', 'OTHER')),
    description TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'COMPLETED', 'REJECTED')),
    admin_notes TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ DEFAULT NULL,
    resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- Indexes for performant filtering
CREATE INDEX IF NOT EXISTS idx_privacy_requests_user_id ON public.privacy_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON public.privacy_requests(status);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_created_at ON public.privacy_requests(created_at DESC);

-- Enable RLS
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;

-- Students can view only their own requests
DROP POLICY IF EXISTS "Students can view own privacy requests" ON public.privacy_requests;
CREATE POLICY "Students can view own privacy requests" ON public.privacy_requests
    FOR SELECT USING (auth.uid() = user_id);

-- Students can insert their own requests (enforcing default PENDING state without self-review)
DROP POLICY IF EXISTS "Students can insert own privacy requests" ON public.privacy_requests;
CREATE POLICY "Students can insert own privacy requests" ON public.privacy_requests
    FOR INSERT WITH CHECK (
        auth.uid() = user_id 
        AND status = 'PENDING'
        AND admin_notes IS NULL
        AND resolved_at IS NULL
        AND resolved_by IS NULL
    );

-- Admins have full access
DROP POLICY IF EXISTS "Admins have full access to privacy requests" ON public.privacy_requests;
CREATE POLICY "Admins have full access to privacy requests" ON public.privacy_requests
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Revoke all from anon/public, grant strictly needed roles
REVOKE ALL ON TABLE public.privacy_requests FROM anon, public;
GRANT SELECT, INSERT ON TABLE public.privacy_requests TO authenticated;
GRANT ALL ON TABLE public.privacy_requests TO service_role;


-- ============================================================================
-- 4. AUTHORITATIVE PRIVACY NOTICE ACKNOWLEDGEMENT RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.acknowledge_privacy_notice(
    p_version VARCHAR(20)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_clean_version VARCHAR(20);
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
    END IF;

    v_clean_version := TRIM(p_version);
    IF v_clean_version IS NULL OR v_clean_version = '' THEN
        v_clean_version := '1.0';
    END IF;

    -- Update student_profiles for current authenticated student
    UPDATE public.student_profiles
    SET privacy_notice_version = v_clean_version,
        privacy_acknowledged_at = now()
    WHERE user_id = v_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Student profile record not found.');
    END IF;

    -- Log non-repudiation audit event
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_user_id,
        'PRIVACY_NOTICE_ACKNOWLEDGED',
        'student_profiles',
        v_user_id,
        jsonb_build_object(
            'version', v_clean_version,
            'acknowledged_at', now()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'version', v_clean_version,
        'acknowledged_at', now()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_privacy_notice(VARCHAR) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.acknowledge_privacy_notice(VARCHAR) TO authenticated;


-- ============================================================================
-- 5. SECURE PERSONAL DATA EXPORT RPC (DOWNLOAD MY DATA)
-- Strictly derives identity from auth.uid(). Never trusts client-supplied user IDs.
-- Respects Team Data Privacy (does NOT expose other team members' private data).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_student_personal_data_export()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_profile RECORD;
    v_registrations JSONB;
    v_teams JSONB;
    v_payments JSONB;
    v_attendance JSONB;
    v_certificates JSONB;
    v_complaints JSONB;
    v_notifications JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
    END IF;

    -- 1. Fetch Profile Data
    SELECT 
        sp.full_name,
        sp.roll_number,
        sp.college,
        sp.department,
        sp.other_department,
        sp.year_of_study,
        sp.phone,
        u.email,
        sp.privacy_notice_version,
        sp.privacy_acknowledged_at,
        u.created_at AS account_created_at
    INTO v_profile
    FROM public.student_profiles sp
    JOIN public.users u ON u.id = sp.user_id
    WHERE sp.user_id = v_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Profile not found.');
    END IF;

    -- 2. Fetch Student's Own Registrations
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'registration_id', r.id,
            'status', r.status,
            'created_at', r.created_at,
            'sub_event_id', se.id,
            'sub_event_name', se.name,
            'category_name', COALESCE(cat.name, 'General'),
            'event_name', COALESCE(e.name, 'Flagship Event'),
            'participation_type', se.participation_type
        ) ORDER BY r.created_at DESC
    ), '[]'::jsonb) INTO v_registrations
    FROM public.registrations r
    JOIN public.sub_events se ON se.id = r.sub_event_id
    LEFT JOIN public.categories cat ON cat.id = se.category_id
    LEFT JOIN public.events e ON e.id = se.event_id OR e.id = cat.event_id
    WHERE r.leader_id = v_user_id
       OR EXISTS (
           SELECT 1 FROM public.teams t
           JOIN public.team_members tm ON tm.team_id = t.id
           WHERE t.registration_id = r.id AND tm.user_id = v_user_id
       );

    -- 3. Fetch Team Affiliations (Strict Team Privacy Rule: Exclude other members' private info)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'team_id', t.id,
            'team_name', t.team_name,
            'sub_event_name', se.name,
            'is_leader', tm.is_leader,
            'my_snapshot_name', tm.snapshot_name,
            'my_snapshot_roll_number', tm.snapshot_roll_number,
            'my_snapshot_department', tm.snapshot_department,
            'my_snapshot_year', tm.snapshot_year
        ) ORDER BY t.id
    ), '[]'::jsonb) INTO v_teams
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    JOIN public.sub_events se ON se.id = r.sub_event_id
    WHERE tm.user_id = v_user_id;

    -- 4. Fetch Payments (Own Payments)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'payment_id', p.id,
            'registration_id', p.registration_id,
            'amount', p.amount,
            'payment_method', p.payment_method,
            'reference_id', p.reference_id,
            'status', p.status,
            'created_at', p.created_at
        ) ORDER BY p.created_at DESC
    ), '[]'::jsonb) INTO v_payments
    FROM public.payments p
    JOIN public.registrations r ON r.id = p.registration_id
    WHERE r.leader_id = v_user_id;

    -- 5. Fetch Attendance (Own Attendance Records)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'attendance_id', ar.id,
            'sub_event_name', se.name,
            'check_in_time', ar.check_in_time
        ) ORDER BY ar.check_in_time DESC
    ), '[]'::jsonb) INTO v_attendance
    FROM public.attendance_records ar
    JOIN public.team_members tm ON tm.id = ar.scanned_member_id
    JOIN public.sub_events se ON se.id = ar.sub_event_id
    WHERE tm.user_id = v_user_id;

    -- 6. Fetch Certificates (Own Certificates)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'certificate_id', c.id,
            'sub_event_name', se.name,
            'certificate_code', c.certificate_code,
            'type', c.type,
            'status', c.status,
            'issued_at', c.issued_at
        ) ORDER BY c.issued_at DESC
    ), '[]'::jsonb) INTO v_certificates
    FROM public.certificates c
    JOIN public.team_members tm ON tm.id = c.team_member_id
    JOIN public.sub_events se ON se.id = c.sub_event_id
    WHERE tm.user_id = v_user_id;

    -- 7. Fetch Complaints (Own Complaints)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'complaint_id', cmp.id,
            'category', cmp.category,
            'description', cmp.description,
            'status', cmp.status,
            'resolution', cmp.resolution
        ) ORDER BY cmp.id
    ), '[]'::jsonb) INTO v_complaints
    FROM public.complaints cmp
    WHERE cmp.user_id = v_user_id;

    -- 8. Fetch Notifications (Own Notifications)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'notification_id', n.id,
            'title', n.title,
            'message', n.message,
            'is_read', n.is_read,
            'created_at', n.created_at
        ) ORDER BY n.created_at DESC
    ), '[]'::jsonb) INTO v_notifications
    FROM public.notifications n
    WHERE n.user_id = v_user_id;

    -- Log audit record
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_user_id,
        'PERSONAL_DATA_EXPORT_GENERATED',
        'student_profiles',
        v_user_id,
        jsonb_build_object(
            'requested_at', now()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'export_metadata', jsonb_build_object(
            'exported_at', now(),
            'platform', 'KITS-EOS',
            'legal_reference', 'Digital Personal Data Protection Act, 2023 (DPDP Act)'
        ),
        'personal_data', jsonb_build_object(
            'profile', jsonb_build_object(
                'full_name', v_profile.full_name,
                'roll_number', v_profile.roll_number,
                'college', v_profile.college,
                'department', v_profile.department,
                'other_department', v_profile.other_department,
                'year_of_study', v_profile.year_of_study,
                'phone', v_profile.phone,
                'email', v_profile.email,
                'account_created_at', v_profile.account_created_at,
                'privacy_notice_version', v_profile.privacy_notice_version,
                'privacy_acknowledged_at', v_profile.privacy_acknowledged_at
            ),
            'registrations', v_registrations,
            'team_memberships', v_teams,
            'payments', v_payments,
            'attendance_records', v_attendance,
            'certificates', v_certificates,
            'complaints', v_complaints,
            'notifications', v_notifications
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_personal_data_export() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_student_personal_data_export() TO authenticated;


-- ============================================================================
-- 6. ADMIN PRIVACY REQUEST MANAGEMENT RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_privacy_request(
    p_request_id UUID,
    p_status VARCHAR(50),
    p_admin_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_admin_id UUID;
    v_clean_status VARCHAR(50);
    v_target_user_id UUID;
    v_old_status VARCHAR(50);
    v_request_type VARCHAR(50);
BEGIN
    v_admin_id := auth.uid();
    IF v_admin_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
    END IF;

    IF NOT (public.is_admin()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Administrative privileges required.');
    END IF;

    v_clean_status := UPPER(TRIM(p_status));
    IF v_clean_status NOT IN ('PENDING', 'UNDER_REVIEW', 'COMPLETED', 'REJECTED') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid status. Must be PENDING, UNDER_REVIEW, COMPLETED, or REJECTED.');
    END IF;

    SELECT user_id, status, request_type INTO v_target_user_id, v_old_status, v_request_type
    FROM public.privacy_requests
    WHERE id = p_request_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Privacy request not found.');
    END IF;

    UPDATE public.privacy_requests
    SET status = v_clean_status,
        admin_notes = p_admin_notes,
        updated_at = now(),
        resolved_at = CASE WHEN v_clean_status IN ('COMPLETED', 'REJECTED') THEN now() ELSE NULL END,
        resolved_by = CASE WHEN v_clean_status IN ('COMPLETED', 'REJECTED') THEN v_admin_id ELSE resolved_by END
    WHERE id = p_request_id;

    -- Audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_admin_id,
        CASE 
            WHEN v_clean_status = 'COMPLETED' THEN 'PRIVACY_REQUEST_COMPLETED'
            WHEN v_clean_status = 'REJECTED' THEN 'PRIVACY_REQUEST_REJECTED'
            ELSE 'PRIVACY_REQUEST_REVIEWED'
        END,
        'privacy_requests',
        p_request_id,
        jsonb_build_object(
            'old_status', v_old_status,
            'new_status', v_clean_status,
            'request_type', v_request_type,
            'user_id', v_target_user_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'request_id', p_request_id,
        'status', v_clean_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_privacy_request(UUID, VARCHAR, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_update_privacy_request(UUID, VARCHAR, TEXT) TO authenticated;
