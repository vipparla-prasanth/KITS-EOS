-- Migration 105: Fix Production Forensic Audit Issues
-- Description:
-- 1. P0: Fix admin_get_sub_event_roster column references (teams.team_name, registrations.leader_id, team_members.user_id, team_members.manual_token, payments.reference_id, registration_type fallback)
-- 2. P0: Drop conflicting one-argument overload of confirm_cod_payment(uuid) to resolve PostgREST ambiguity
-- 3. P3: Drop obsolete UUID overload of verify_certificate(uuid) to standardize on canonical text query
-- 4. P1: Add missing tables (registrations, payments, student_account_suspension_requests) to supabase_realtime publication
-- 5. P2: Synchronize admin_get_dashboard_metrics coordinator count calculation with get_active_coordinators_count

-- =========================================================================
-- 1. P0: Fix admin_get_sub_event_roster
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_get_sub_event_roster(p_sub_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
            'registration_type', (CASE WHEN t.id IS NOT NULL THEN 'TEAM' ELSE 'INDIVIDUAL' END),
            'status', r.status,
            'created_at', r.created_at,
            'teams', CASE WHEN t.id IS NOT NULL THEN jsonb_build_object(
                'id', t.id,
                'name', t.team_name,
                'team_name', t.team_name,
                'leader_id', r.leader_id,
                'team_members', (
                    SELECT COALESCE(jsonb_agg(
                        jsonb_build_object(
                            'id', tm.id,
                            'student_id', tm.user_id,
                            'user_id', tm.user_id,
                            'is_leader', COALESCE(tm.is_leader, (tm.user_id = r.leader_id)),
                            'attendance_token', tm.manual_token,
                            'manual_token', tm.manual_token,
                            'student_profiles', jsonb_build_object(
                                'user_id', COALESCE(sp_m.user_id, tm.user_id),
                                'full_name', COALESCE(sp_m.full_name, tm.snapshot_name),
                                'roll_number', COALESCE(sp_m.roll_number, tm.snapshot_roll_number),
                                'college', COALESCE(sp_m.college, tm.snapshot_college),
                                'department', COALESCE(sp_m.department, tm.snapshot_department),
                                'year_of_study', COALESCE(sp_m.year_of_study, tm.snapshot_year),
                                'phone', sp_m.phone
                            )
                        ) ORDER BY COALESCE(tm.is_leader, (tm.user_id = r.leader_id)) DESC, COALESCE(sp_m.full_name, tm.snapshot_name) ASC
                    ), '[]'::jsonb)
                    FROM public.team_members tm
                    LEFT JOIN public.student_profiles sp_m ON sp_m.user_id = tm.user_id
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
                        'transaction_id', p.reference_id,
                        'reference_id', p.reference_id,
                        'created_at', p.created_at,
                        'updated_at', p.created_at
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
            'check_in_time', a.check_in_time,
            'checked_in_at', a.check_in_time,
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
$function$;

REVOKE ALL ON FUNCTION public.admin_get_sub_event_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_sub_event_roster(uuid) TO authenticated, service_role;

-- =========================================================================
-- 2. P0: Drop conflicting one-argument overload of confirm_cod_payment
-- =========================================================================
DROP FUNCTION IF EXISTS public.confirm_cod_payment(uuid);

CREATE OR REPLACE FUNCTION public.confirm_cod_payment(
    p_payment_id uuid,
    p_coordinator_id uuid DEFAULT NULL::uuid,
    p_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
    RETURN public.confirm_bulk_payments(ARRAY[p_payment_id], p_token);
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_cod_payment(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_cod_payment(uuid, uuid, text) TO anon, authenticated, service_role;

-- =========================================================================
-- 3. P3: Drop obsolete UUID overload of verify_certificate
-- =========================================================================
DROP FUNCTION IF EXISTS public.verify_certificate(uuid);

REVOKE ALL ON FUNCTION public.verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_certificate(text) TO anon, authenticated, service_role;

-- =========================================================================
-- 4. P1: Add missing tables to supabase_realtime publication
-- =========================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'registrations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.registrations;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'payments'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'student_account_suspension_requests'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.student_account_suspension_requests;
    END IF;
END $$;

-- =========================================================================
-- 5. P2: Synchronize admin_get_dashboard_metrics with get_active_coordinators_count
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_get_dashboard_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied: Administrator privileges required';
    END IF;

    RETURN jsonb_build_object(
        'totalEvents', (SELECT COUNT(*) FROM public.events WHERE status <> 'PERMANENTLY_DELETED'::public.event_status),
        'totalCategories', (SELECT COUNT(*) FROM public.categories WHERE status <> 'PERMANENTLY_DELETED'::public.event_status),
        'totalSubEvents', (SELECT COUNT(*) FROM public.sub_events WHERE status <> 'PERMANENTLY_DELETED'::public.event_status),
        'totalCoordinators', (
            SELECT COUNT(DISTINCT ca.coordinator_id)::integer
            FROM public.coordinator_assignments ca
            JOIN public.coordinators c ON c.id = ca.coordinator_id
            JOIN public.sub_events se ON se.id = ca.sub_event_id
            LEFT JOIN public.categories cat ON cat.id = se.category_id
            JOIN public.events e ON e.id = COALESCE(se.event_id, cat.event_id)
            WHERE c.status = 'ACTIVE'
              AND se.status = 'ACTIVE'
              AND e.status = 'ACTIVE'
              AND (cat.id IS NULL OR cat.status = 'ACTIVE')
        ),
        'totalRegistrations', (SELECT COUNT(*) FROM public.registrations),
        'confirmedRegistrations', (SELECT COUNT(*) FROM public.registrations WHERE status = 'CONFIRMED'::public.registration_status),
        'totalRevenue', (SELECT COALESCE(SUM(amount), 0) FROM public.payments WHERE status = 'SUCCESS'::public.payment_status),
        'totalAttendance', (SELECT COUNT(*) FROM public.attendance_records),
        'totalCertificates', (SELECT COUNT(*) FROM public.certificates),
        'totalFeedback', (SELECT COUNT(*) FROM public.feedback_responses),
        'openComplaints', (SELECT COUNT(*) FROM public.complaints WHERE status = 'OPEN'),
        'recentLogs', (
            SELECT COALESCE(jsonb_agg(log_row), '[]'::jsonb)
            FROM (
                SELECT id, actor_id, action, entity_type, entity_id, metadata, created_at
                FROM public.audit_logs
                ORDER BY created_at DESC
                LIMIT 6
            ) log_row
        )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_dashboard_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_dashboard_metrics() TO authenticated, service_role;
