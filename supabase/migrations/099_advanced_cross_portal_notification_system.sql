-- ==============================================================================
-- Migration 099: Advanced Cross-Portal Notification System
-- ==============================================================================
-- 1. Schema Extensions on public.notifications:
--    - notification_type (e.g. WELCOME, PAYMENT_CONFIRMED, REGISTRATION_SUBMITTED, etc.)
--    - category (e.g. REGISTRATION, PAYMENTS, ATTENDANCE, RESULTS, CERTIFICATES, ANNOUNCEMENT)
--    - entity_type & entity_id (UUID references to target business objects)
--    - metadata (JSONB for contextual information)
--    - read_at (timestamptz when auto-marked read)
--    - expires_at (nullable retention gate)
--    - event_key (unique deterministic idempotency key)
-- 2. Idempotency Unique Index:
--    - idx_notifications_event_key (enforces exactly-once delivery at DB engine level)
-- 3. High Performance Indices:
--    - idx_notifications_unread_user & idx_notifications_unread_coord
-- 4. Enable Realtime on public.notifications
-- 5. Authoritative RPCs:
--    - ensure_welcome_notification(p_token text)
--    - mark_notifications_read_on_open(p_notification_ids uuid[], p_token text)
--    - get_portal_notifications(p_limit int, p_offset int, p_token text)
--    - get_portal_unread_count(p_token text)
-- 6. Business Event Notification Integration:
--    - confirm_bulk_payments (offline payment verification -> student notification)
--    - confirm_cod_payment (delegates to confirm_bulk_payments)
--    - commit_attendance_checkin (attendance check-in -> student notification)
--    - trigger_notify_on_results_published (results publication -> notifications)
--    - trigger_notify_on_certificate_lifecycle (feedback gate & unlock notifications)
--    - trigger_notify_on_registration_created (registration lifecycle notifications)
--    - trigger_notify_on_payment_created (payment lifecycle notifications)
-- ==============================================================================

-- 1. SCHEMA EXTENSIONS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'notification_type'
    ) THEN
        ALTER TABLE public.notifications 
        ADD COLUMN notification_type VARCHAR(60) DEFAULT 'SYSTEM';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'category'
    ) THEN
        ALTER TABLE public.notifications 
        ADD COLUMN category VARCHAR(60) DEFAULT 'ANNOUNCEMENT';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'entity_type'
    ) THEN
        ALTER TABLE public.notifications 
        ADD COLUMN entity_type VARCHAR(60) DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'entity_id'
    ) THEN
        ALTER TABLE public.notifications 
        ADD COLUMN entity_id UUID DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'metadata'
    ) THEN
        ALTER TABLE public.notifications 
        ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'read_at'
    ) THEN
        ALTER TABLE public.notifications 
        ADD COLUMN read_at TIMESTAMPTZ DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'expires_at'
    ) THEN
        ALTER TABLE public.notifications 
        ADD COLUMN expires_at TIMESTAMPTZ DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'event_key'
    ) THEN
        ALTER TABLE public.notifications 
        ADD COLUMN event_key VARCHAR(255) DEFAULT NULL;
    END IF;
END $$;

-- 2. INDICES
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS uq_notifications_event_key;
ALTER TABLE public.notifications ADD CONSTRAINT uq_notifications_event_key UNIQUE (event_key);

CREATE INDEX IF NOT EXISTS idx_notifications_unread_user 
ON public.notifications(user_id, is_read) 
WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_unread_coord 
ON public.notifications(coordinator_id, is_read) 
WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_category 
ON public.notifications(category);

-- 3. ENABLE REALTIME
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 4. BACKFILL HISTORICAL DATA CATEGORIES SAFELY
UPDATE public.notifications
SET category = 'RESULTS', notification_type = 'RESULT_PUBLISHED'
WHERE (category IS NULL OR category = 'ANNOUNCEMENT') AND title ILIKE '%result%';

UPDATE public.notifications
SET category = 'CERTIFICATES', notification_type = 'CERTIFICATE_AVAILABLE'
WHERE (category IS NULL OR category = 'ANNOUNCEMENT') AND title ILIKE '%certificate%';

-- 5. RPC: ensure_welcome_notification
-- Idempotently dispatches exactly one WELCOME notification per user or coordinator
CREATE OR REPLACE FUNCTION public.ensure_welcome_notification(
    p_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_user_role public.user_role;
    v_coord_id UUID;
    v_coord RECORD;
    v_event_key TEXT;
    v_title TEXT;
    v_message TEXT;
    v_metadata JSONB;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NOT NULL THEN
        SELECT role INTO v_user_role FROM public.users WHERE id = v_user_id;

        IF v_user_role = 'ADMIN' THEN
            v_event_key := 'WELCOME:ADMIN:' || v_user_id::text;
            v_title := 'Welcome to KITS-EOS Admin Portal';
            v_message := 'Your administrator account is ready. You can manage events, coordinators, registrations, payments, results and platform operations.';
            v_metadata := jsonb_build_object('portal', 'ADMIN');
        ELSE
            v_event_key := 'WELCOME:STUDENT:' || v_user_id::text;
            v_title := 'Welcome to KITS-EOS';
            v_message := 'Your KITS-EOS student account is ready. You can now register for events, manage your registrations, access credentials, attendance, results and certificates.';
            v_metadata := jsonb_build_object('portal', 'STUDENT');
        END IF;

        INSERT INTO public.notifications (
            user_id,
            coordinator_id,
            recipient_role,
            notification_type,
            category,
            title,
            message,
            event_key,
            metadata,
            is_read,
            created_at
        ) VALUES (
            v_user_id,
            NULL,
            CASE WHEN v_user_role = 'ADMIN' THEN 'ADMIN' ELSE 'STUDENT' END,
            'WELCOME',
            'ANNOUNCEMENT',
            v_title,
            v_message,
            v_event_key,
            v_metadata,
            FALSE,
            NOW()
        )
        ON CONFLICT (event_key) DO NOTHING;

        RETURN jsonb_build_object('success', true, 'type', 'USER', 'key', v_event_key);
    END IF;

    IF p_token IS NOT NULL AND trim(p_token) <> '' THEN
        v_coord_id := public.get_coordinator_id_by_token(regexp_replace(trim(p_token), '^Bearer\s+', '', 'i'));
        IF v_coord_id IS NOT NULL THEN
            SELECT * INTO v_coord FROM public.coordinators WHERE id = v_coord_id;
            v_event_key := 'WELCOME:COORD:' || v_coord_id::text;
            v_title := 'Welcome to KITS-EOS Coordinator Portal';
            v_message := 'Your coordinator account is ready. Assigned event and sub-event operations are available from your portal.';
            v_metadata := jsonb_build_object('portal', 'COORDINATOR', 'coordinator_type', v_coord.coordinator_type);

            INSERT INTO public.notifications (
                user_id,
                coordinator_id,
                recipient_role,
                notification_type,
                category,
                title,
                message,
                event_key,
                metadata,
                is_read,
                created_at
            ) VALUES (
                NULL,
                v_coord_id,
                'COORDINATOR',
                'WELCOME',
                'ANNOUNCEMENT',
                v_title,
                v_message,
                v_event_key,
                v_metadata,
                FALSE,
                NOW()
            )
            ON CONFLICT (event_key) DO NOTHING;

            RETURN jsonb_build_object('success', true, 'type', 'COORDINATOR', 'key', v_event_key);
        END IF;
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated');
END;
$$;

-- 6. RPC: mark_notifications_read_on_open
-- Automatically marks presented notifications as read for current caller only
CREATE OR REPLACE FUNCTION public.mark_notifications_read_on_open(
    p_notification_ids UUID[],
    p_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_coord_id UUID;
    v_marked_count INT := 0;
BEGIN
    IF p_notification_ids IS NULL OR array_length(p_notification_ids, 1) = 0 THEN
        RETURN jsonb_build_object('success', true, 'marked_count', 0);
    END IF;

    -- 1. Check Supabase Auth identity (Student / Admin)
    v_user_id := auth.uid();

    IF v_user_id IS NOT NULL THEN
        UPDATE public.notifications
        SET is_read = TRUE,
            read_at = COALESCE(read_at, NOW())
        WHERE id = ANY(p_notification_ids)
          AND user_id = v_user_id
          AND is_read = FALSE;

        GET DIAGNOSTICS v_marked_count = ROW_COUNT;

        RETURN jsonb_build_object('success', true, 'marked_count', v_marked_count);
    END IF;

    -- 2. Check Coordinator custom session token
    IF p_token IS NOT NULL AND trim(p_token) <> '' THEN
        v_coord_id := public.get_coordinator_id_by_token(regexp_replace(trim(p_token), '^Bearer\s+', '', 'i'));
        IF v_coord_id IS NOT NULL THEN
            UPDATE public.notifications
            SET is_read = TRUE,
                read_at = COALESCE(read_at, NOW())
            WHERE id = ANY(p_notification_ids)
              AND coordinator_id = v_coord_id
              AND is_read = FALSE;

            GET DIAGNOSTICS v_marked_count = ROW_COUNT;

            RETURN jsonb_build_object('success', true, 'marked_count', v_marked_count);
        END IF;
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'Authentication required', 'marked_count', 0);
END;
$$;

-- 7. RPC: get_portal_notifications
-- Retrieves paginated notifications strictly scoped to authenticated principal
CREATE OR REPLACE FUNCTION public.get_portal_notifications(
    p_limit INT DEFAULT 20,
    p_offset INT DEFAULT 0,
    p_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_coord_id UUID;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', n.id,
                'title', n.title,
                'message', n.message,
                'notification_type', COALESCE(n.notification_type, 'SYSTEM'),
                'category', COALESCE(n.category, 'ANNOUNCEMENT'),
                'entity_type', n.entity_type,
                'entity_id', n.entity_id,
                'metadata', COALESCE(n.metadata, '{}'::jsonb),
                'is_read', n.is_read,
                'read_at', n.read_at,
                'created_at', n.created_at,
                'broadcast_id', n.broadcast_id
            ) ORDER BY n.created_at DESC
        ), '[]'::jsonb)
        INTO v_result
        FROM (
            SELECT * FROM public.notifications
            WHERE user_id = v_user_id
            ORDER BY created_at DESC
            LIMIT GREATEST(1, LEAST(100, p_limit))
            OFFSET GREATEST(0, p_offset)
        ) n;

        RETURN v_result;
    END IF;

    IF p_token IS NOT NULL AND trim(p_token) <> '' THEN
        v_coord_id := public.get_coordinator_id_by_token(regexp_replace(trim(p_token), '^Bearer\s+', '', 'i'));
        IF v_coord_id IS NOT NULL THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'id', n.id,
                    'title', n.title,
                    'message', n.message,
                    'notification_type', COALESCE(n.notification_type, 'SYSTEM'),
                    'category', COALESCE(n.category, 'ANNOUNCEMENT'),
                    'entity_type', n.entity_type,
                    'entity_id', n.entity_id,
                    'metadata', COALESCE(n.metadata, '{}'::jsonb),
                    'is_read', n.is_read,
                    'read_at', n.read_at,
                    'created_at', n.created_at,
                    'broadcast_id', n.broadcast_id
                ) ORDER BY n.created_at DESC
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT * FROM public.notifications
                WHERE coordinator_id = v_coord_id
                ORDER BY created_at DESC
                LIMIT GREATEST(1, LEAST(100, p_limit))
                OFFSET GREATEST(0, p_offset)
            ) n;

            RETURN v_result;
        END IF;
    END IF;

    RETURN '[]'::jsonb;
END;
$$;

-- 8. RPC: get_portal_unread_count
-- Highly performant index-backed unread counter
CREATE OR REPLACE FUNCTION public.get_portal_unread_count(
    p_token TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_coord_id UUID;
    v_count INT := 0;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_count
        FROM public.notifications
        WHERE user_id = v_user_id AND is_read = FALSE;

        RETURN v_count;
    END IF;

    IF p_token IS NOT NULL AND trim(p_token) <> '' THEN
        v_coord_id := public.get_coordinator_id_by_token(regexp_replace(trim(p_token), '^Bearer\s+', '', 'i'));
        IF v_coord_id IS NOT NULL THEN
            SELECT COUNT(*) INTO v_count
            FROM public.notifications
            WHERE coordinator_id = v_coord_id AND is_read = FALSE;

            RETURN v_count;
        END IF;
    END IF;

    RETURN 0;
END;
$$;

-- 9. INTEGRATE NOTIFICATIONS INTO confirm_bulk_payments RPC
CREATE OR REPLACE FUNCTION public.confirm_bulk_payments(
    p_payment_ids uuid[],
    p_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
    v_actor_id uuid;
    v_actor_email text;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_coord_id uuid := NULL;
    v_coord_type text := NULL;
    v_actor_role text := 'UNKNOWN';
    v_clean_token text := NULL;
    v_unassigned_count integer := 0;
    v_invalid_count integer := 0;
    v_approved_count integer := 0;
    v_total_amount numeric := 0;
    v_pid uuid;
    v_payment record;
    v_pending_ids uuid[] := '{}';
    v_event_key text;
    v_notif_title text;
    v_notif_msg text;
BEGIN
    -- 0. Validate input
    IF p_payment_ids IS NULL OR array_length(p_payment_ids, 1) = 0 THEN
        RAISE EXCEPTION 'Validation error: At least one payment ID is required' USING ERRCODE = '22023';
    END IF;

    -- 1. Identify actor from Supabase Auth session (Admin or Payment Manager)
    v_actor_id := auth.uid();

    IF v_actor_id IS NOT NULL THEN
        SELECT role, status INTO v_user_role, v_user_status
        FROM public.users 
        WHERE id = v_actor_id;

        IF v_user_status = 'ACTIVE' THEN
            IF v_user_role = 'ADMIN' THEN
                v_actor_role := 'ADMIN';
            ELSIF v_user_role = 'PAYMENT_MANAGER' THEN
                v_actor_role := 'PAYMENT_MANAGER';
            END IF;
        END IF;

        IF v_actor_role = 'UNKNOWN' THEN
            SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

            SELECT id, coordinator_type INTO v_coord_id, v_coord_type
            FROM public.coordinators
            WHERE (user_id = v_actor_id OR id = v_actor_id OR lower(username) = lower(v_actor_email))
              AND status = 'ACTIVE'
            LIMIT 1;

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_actor_role := 'PAYMENT_MANAGER';
            ELSIF v_coord_id IS NOT NULL THEN
                v_actor_role := 'COORDINATOR';
            END IF;
        END IF;
    END IF;

    -- 2. Cryptographic Session Token Verification (for coordinator / payment-manager portal)
    IF v_actor_role = 'UNKNOWN' AND p_token IS NOT NULL AND trim(p_token) <> '' THEN
        v_clean_token := regexp_replace(trim(p_token), '^Bearer\s+', '', 'i');
        v_coord_id := public.get_coordinator_id_by_token(v_clean_token);

        IF v_coord_id IS NOT NULL THEN
            SELECT coordinator_type INTO v_coord_type
            FROM public.coordinators
            WHERE id = v_coord_id AND status = 'ACTIVE';

            IF v_coord_type = 'PAYMENT_MANAGER' THEN
                v_actor_role := 'PAYMENT_MANAGER';
            ELSE
                v_actor_role := 'COORDINATOR';
            END IF;
        END IF;
    END IF;

    -- 3. Strict authentication gate: Reject unauthenticated callers immediately
    IF v_actor_role = 'UNKNOWN' AND v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Valid administrative or coordinator session required.'
            USING ERRCODE = '42501';
    END IF;

    -- 4. Check if all target payment records exist
    SELECT count(*) INTO v_invalid_count
    FROM unnest(p_payment_ids) AS pid
    WHERE NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = pid);

    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION 'Validation error: One or more payment records do not exist' USING ERRCODE = 'P0002';
    END IF;

    -- 5. If regular coordinator (not Admin or Payment Manager), verify assignment for ALL target sub-events
    IF v_actor_role = 'COORDINATOR' AND v_coord_id IS NOT NULL THEN
        SELECT count(*) INTO v_unassigned_count
        FROM public.payments p
        JOIN public.registrations r ON r.id = p.registration_id
        WHERE p.id = ANY(p_payment_ids)
          AND NOT EXISTS (
              SELECT 1 FROM public.coordinator_assignments ca
              WHERE ca.coordinator_id = v_coord_id AND ca.sub_event_id = r.sub_event_id
          );

        IF v_unassigned_count > 0 THEN
            RAISE EXCEPTION 'Forbidden: You are not assigned to manage payments for one or more selected registrations.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 6. Enforce final authorization check
    IF v_actor_role NOT IN ('ADMIN', 'PAYMENT_MANAGER', 'COORDINATOR') THEN
        RAISE EXCEPTION 'Unauthorized: Only event administrators, payment managers, or assigned coordinators can verify payments.'
            USING ERRCODE = '42501';
    END IF;

    -- Filter to payments that actually need update (status <> 'SUCCESS')
    SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_pending_ids
    FROM public.payments
    WHERE id = ANY(p_payment_ids) AND status <> 'SUCCESS';

    IF v_pending_ids IS NULL OR array_length(v_pending_ids, 1) IS NULL OR array_length(v_pending_ids, 1) = 0 THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_total_amount
        FROM public.payments
        WHERE id = ANY(p_payment_ids);

        RETURN jsonb_build_object(
            'success', true,
            'message', 'Selected payments are already marked as verified',
            'approved_count', array_length(p_payment_ids, 1),
            'total_amount', v_total_amount,
            'payment_ids', p_payment_ids,
            'status', 'SUCCESS'
        );
    END IF;

    -- 7. Calculate total amount for all pending payments being approved and update transactionally
    SELECT COALESCE(SUM(amount), 0) INTO v_total_amount
    FROM public.payments
    WHERE id = ANY(v_pending_ids);

    -- 8. Lock target payments in deterministic order (pids ASC) to prevent deadlocks
    PERFORM id
    FROM public.payments
    WHERE id = ANY(v_pending_ids)
    ORDER BY id ASC
    FOR UPDATE;

    -- 9. Process each pending payment atomically
    FOREACH v_pid IN ARRAY v_pending_ids LOOP
        SELECT p.id, p.registration_id, p.amount, p.currency, p.status AS old_status,
               r.id AS reg_id, r.leader_id, r.status AS reg_status, r.sub_event_id, r.mode,
               se.name AS sub_event_name, se.event_id, e.name AS event_name,
               t.team_name
        INTO v_payment
        FROM public.payments p
        JOIN public.registrations r ON r.id = p.registration_id
        JOIN public.sub_events se ON se.id = r.sub_event_id
        LEFT JOIN public.events e ON e.id = se.event_id
        LEFT JOIN public.teams t ON t.registration_id = r.id
        WHERE p.id = v_pid;

        IF FOUND AND v_payment.old_status <> 'SUCCESS' THEN
            UPDATE public.payments
            SET status = 'SUCCESS',
                paid_at = now()
            WHERE id = v_pid;

            UPDATE public.registrations
            SET status = 'CONFIRMED'
            WHERE id = v_payment.reg_id;

            v_event_key := 'PAYMENT_CONFIRMED:' || v_pid::text;
            v_notif_title := 'Payment Confirmed';
            
            IF v_payment.mode = 'TEAM' AND v_payment.team_name IS NOT NULL AND trim(v_payment.team_name) <> '' THEN
                v_notif_msg := 'Payment for team "' || v_payment.team_name || '" has been verified successfully. Your team registration for ' || v_payment.sub_event_name || ' is now confirmed. Event credentials are available.';
            ELSE
                v_notif_msg := 'Your payment of ₹' || v_payment.amount || ' for ' || v_payment.sub_event_name || ' has been verified successfully. Your registration is now confirmed and your event credentials are available.';
            END IF;

            IF v_payment.leader_id IS NOT NULL THEN
                INSERT INTO public.notifications (
                    user_id,
                    coordinator_id,
                    recipient_role,
                    notification_type,
                    category,
                    entity_type,
                    entity_id,
                    title,
                    message,
                    event_key,
                    metadata,
                    is_read,
                    created_at
                ) VALUES (
                    v_payment.leader_id,
                    NULL,
                    'STUDENT',
                    'PAYMENT_CONFIRMED',
                    'REGISTRATION',
                    'PAYMENT',
                    v_pid,
                    v_notif_title,
                    v_notif_msg,
                    v_event_key,
                    jsonb_build_object(
                        'payment_id', v_pid,
                        'registration_id', v_payment.reg_id,
                        'sub_event_id', v_payment.sub_event_id,
                        'amount', v_payment.amount
                    ),
                    FALSE,
                    NOW()
                )
                ON CONFLICT (event_key) DO NOTHING;
            END IF;

            INSERT INTO public.audit_logs (
                actor_id,
                action,
                entity_type,
                entity_id,
                metadata,
                created_at
            ) VALUES (
                COALESCE(v_actor_id, v_coord_id),
                'PAYMENT_VERIFIED',
                'payments',
                v_pid,
                jsonb_build_object(
                    'payment_id', v_pid,
                    'registration_id', v_payment.reg_id,
                    'sub_event_id', v_payment.sub_event_id,
                    'amount', v_payment.amount,
                    'verified_by_role', v_actor_role,
                    'verified_by_id', COALESCE(v_actor_id, v_coord_id)
                ),
                now()
            );

            v_approved_count := v_approved_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'message', format('Successfully verified %s payment(s)', v_approved_count),
        'approved_count', v_approved_count,
        'total_amount', v_total_amount,
        'payment_ids', v_pending_ids,
        'status', 'SUCCESS'
    );
END;
$function$;

-- 10. UNIFY confirm_cod_payment TO DELEGATE TO confirm_bulk_payments
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

-- 11. INTEGRATE NOTIFICATIONS INTO commit_attendance_checkin RPC
CREATE OR REPLACE FUNCTION public.commit_attendance_checkin(
    p_sub_event_id uuid, 
    p_team_id uuid, 
    p_scanned_member_ids uuid[], 
    p_coordinator_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
    v_coord_token TEXT;
    v_coord_id UUID := NULL;
    v_is_admin BOOLEAN := FALSE;
    v_is_assigned BOOLEAN := FALSE;
    v_actor_id UUID := NULL;
    v_team_record RECORD;
    v_sub_event RECORD;
    v_member_id UUID;
    v_new_insert_count INT := 0;
    v_already_attended_count INT := 0;
    v_member_info RECORD;
    v_inserted_attendance JSONB := '[]'::jsonb;
    v_existing_att_id UUID;
    v_new_att_id UUID;
    v_event_key TEXT;
BEGIN
    IF p_sub_event_id IS NULL THEN
        RAISE EXCEPTION 'sub_event_id is required';
    END IF;

    IF p_team_id IS NULL THEN
        RAISE EXCEPTION 'team_id is required';
    END IF;

    IF p_scanned_member_ids IS NULL OR array_length(p_scanned_member_ids, 1) = 0 THEN
        RAISE EXCEPTION 'At least one team member must be selected to record attendance.';
    END IF;

    v_is_admin := public.is_admin();

    IF p_coordinator_token IS NOT NULL AND trim(p_coordinator_token) <> '' THEN
        v_coord_token := regexp_replace(trim(p_coordinator_token), '^Bearer\s+', '', 'i');
        v_coord_id := public.get_coordinator_id_by_token(v_coord_token);
        IF v_coord_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1 FROM public.coordinator_assignments ca
                JOIN public.sub_events se_chk ON se_chk.id = ca.sub_event_id
                WHERE ca.coordinator_id = v_coord_id
                  AND ca.sub_event_id = p_sub_event_id
                  AND se_chk.status <> 'PERMANENTLY_DELETED'
            ) INTO v_is_assigned;
        END IF;
    END IF;

    IF NOT v_is_admin AND NOT v_is_assigned THEN
        RAISE EXCEPTION 'Access denied: You are not authorized to check in participants for this sub-event.';
    END IF;

    v_actor_id := COALESCE(v_coord_id, auth.uid());

    SELECT id, name INTO v_sub_event
    FROM public.sub_events
    WHERE id = p_sub_event_id
      AND status <> 'PERMANENTLY_DELETED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target sub-event not found';
    END IF;

    SELECT t.id, t.team_name, r.id AS reg_id, r.status AS reg_status, r.leader_id,
           r.sub_event_id AS reg_sub_event_id, se_t.name AS reg_sub_name
    INTO v_team_record
    FROM public.teams t
    JOIN public.registrations r ON r.id = t.registration_id
    JOIN public.sub_events se_t ON se_t.id = r.sub_event_id
    WHERE t.id = p_team_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Team registration not found';
    END IF;

    IF v_team_record.reg_sub_event_id <> p_sub_event_id THEN
        RAISE EXCEPTION 'WRONG SUB-EVENT: Participant is registered for "%". Current verification station is "%". Attendance was NOT marked.',
            v_team_record.reg_sub_name, v_sub_event.name;
    END IF;

    IF v_team_record.reg_status <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Registration is %. Check-in requires CONFIRMED status.', v_team_record.reg_status;
    END IF;

    FOREACH v_member_id IN ARRAY p_scanned_member_ids
    LOOP
        SELECT tm.id, tm.user_id, tm.snapshot_name, tm.snapshot_roll_number, tm.is_leader
        INTO v_member_info
        FROM public.team_members tm
        WHERE tm.id = v_member_id AND tm.team_id = p_team_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected member (%) does not belong to team "%"', v_member_id, v_team_record.team_name;
        END IF;

        SELECT id INTO v_existing_att_id
        FROM public.attendance_records
        WHERE sub_event_id = p_sub_event_id
          AND scanned_member_id = v_member_id;

        IF FOUND THEN
            v_already_attended_count := v_already_attended_count + 1;
        ELSE
            INSERT INTO public.attendance_records (
                sub_event_id,
                team_id,
                scanned_member_id,
                check_in_time,
                checked_in_by
            ) VALUES (
                p_sub_event_id,
                p_team_id,
                v_member_id,
                now(),
                v_coord_id
            )
            ON CONFLICT (sub_event_id, scanned_member_id) DO NOTHING
            RETURNING id INTO v_new_att_id;

            IF v_new_att_id IS NOT NULL THEN
                v_new_insert_count := v_new_insert_count + 1;

                INSERT INTO public.audit_logs (
                    actor_id,
                    action,
                    entity_type,
                    entity_id,
                    metadata,
                    created_at
                ) VALUES (
                    v_actor_id,
                    'ATTENDANCE_CHECKIN_CONFIRMED',
                    'attendance_records',
                    v_new_att_id,
                    jsonb_build_object(
                        'sub_event_id', p_sub_event_id,
                        'sub_event_name', v_sub_event.name,
                        'team_id', p_team_id,
                        'team_name', v_team_record.team_name,
                        'scanned_member_id', v_member_id,
                        'scanned_member_name', v_member_info.snapshot_name,
                        'scanned_member_roll', v_member_info.snapshot_roll_number,
                        'check_in_time', now()
                    ),
                    now()
                );

                v_event_key := 'ATTENDANCE_CONFIRMED:' || v_new_att_id::text;
                
                DECLARE
                    v_target_user UUID := COALESCE(v_member_info.user_id, CASE WHEN v_member_info.is_leader THEN v_team_record.leader_id ELSE NULL END);
                BEGIN
                    IF v_target_user IS NOT NULL THEN
                        INSERT INTO public.notifications (
                            user_id,
                            coordinator_id,
                            recipient_role,
                            notification_type,
                            category,
                            entity_type,
                            entity_id,
                            title,
                            message,
                            event_key,
                            metadata,
                            is_read,
                            created_at
                        ) VALUES (
                            v_target_user,
                            NULL,
                            'STUDENT',
                            'ATTENDANCE_CONFIRMED',
                            'ATTENDANCE',
                            'ATTENDANCE',
                            v_new_att_id,
                            'Attendance Confirmed',
                            'Your attendance for ' || v_sub_event.name || ' has been successfully recorded.',
                            v_event_key,
                            jsonb_build_object(
                                'attendance_id', v_new_att_id,
                                'sub_event_id', p_sub_event_id,
                                'sub_event_name', v_sub_event.name
                            ),
                            FALSE,
                            NOW()
                        )
                        ON CONFLICT (event_key) DO NOTHING;
                    END IF;
                END;
            ELSE
                v_already_attended_count := v_already_attended_count + 1;
            END IF;
        END IF;
    END LOOP;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', tm.id,
            'snapshot_name', tm.snapshot_name,
            'snapshot_roll_number', tm.snapshot_roll_number,
            'is_leader', tm.is_leader,
            'is_attended', (ar.id IS NOT NULL),
            'check_in_time', ar.check_in_time,
            'checked_in_by', COALESCE(coord.display_name, CASE WHEN ar.id IS NOT NULL THEN 'Administrator' ELSE NULL END)
        ) ORDER BY tm.is_leader DESC, tm.snapshot_name ASC
    ), '[]'::jsonb)
    INTO v_inserted_attendance
    FROM public.team_members tm
    LEFT JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id AND ar.sub_event_id = p_sub_event_id
    LEFT JOIN public.coordinators coord ON coord.id = ar.checked_in_by
    WHERE tm.team_id = p_team_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', CASE 
            WHEN v_new_insert_count > 0 THEN 'Attendance marked successfully'
            ELSE 'Selected members have already been marked as attended.'
        END,
        'recorded_count', v_new_insert_count,
        'already_attended_count', v_already_attended_count,
        'team_name', v_team_record.team_name,
        'team_members', v_inserted_attendance
    );
END;
$function$;

-- 12. TRIGGER: RESULTS PUBLISHED NOTIFICATIONS FOR STUDENTS & COORDINATORS
CREATE OR REPLACE FUNCTION public.trigger_notify_on_results_published()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_participant RECORD;
    v_coord RECORD;
    v_event_key TEXT;
BEGIN
    IF NEW.results_published IS TRUE AND (OLD.results_published IS NOT TRUE) THEN
        FOR v_participant IN
            SELECT DISTINCT COALESCE(tm.user_id, r.leader_id) AS user_id
            FROM public.registrations r
            JOIN public.teams t ON t.registration_id = r.id
            JOIN public.team_members tm ON tm.team_id = t.id
            WHERE r.sub_event_id = NEW.id
              AND r.status = 'CONFIRMED'
              AND COALESCE(tm.user_id, r.leader_id) IS NOT NULL
        LOOP
            v_event_key := 'RESULT_PUBLISHED:' || NEW.id::text || ':' || v_participant.user_id::text;
            INSERT INTO public.notifications (
                user_id,
                coordinator_id,
                recipient_role,
                notification_type,
                category,
                entity_type,
                entity_id,
                title,
                message,
                event_key,
                metadata,
                is_read,
                created_at
            ) VALUES (
                v_participant.user_id,
                NULL,
                'STUDENT',
                'RESULT_PUBLISHED',
                'RESULTS',
                'SUB_EVENT',
                NEW.id,
                'Result Published',
                'Results for ' || NEW.name || ' have been published.',
                v_event_key,
                jsonb_build_object('sub_event_id', NEW.id, 'sub_event_name', NEW.name),
                FALSE,
                NOW()
            )
            ON CONFLICT (event_key) DO NOTHING;
        END LOOP;

        FOR v_coord IN
            SELECT coordinator_id
            FROM public.coordinator_assignments
            WHERE sub_event_id = NEW.id
        LOOP
            v_event_key := 'COORD_RESULT_PUBLISHED:' || NEW.id::text || ':' || v_coord.coordinator_id::text;
            INSERT INTO public.notifications (
                user_id,
                coordinator_id,
                recipient_role,
                notification_type,
                category,
                entity_type,
                entity_id,
                title,
                message,
                event_key,
                metadata,
                is_read,
                created_at
            ) VALUES (
                NULL,
                v_coord.coordinator_id,
                'COORDINATOR',
                'RESULT_PUBLISHED',
                'RESULTS',
                'SUB_EVENT',
                NEW.id,
                'Results Published',
                'Results for ' || NEW.name || ' have been approved and published by Admin.',
                v_event_key,
                jsonb_build_object('sub_event_id', NEW.id, 'sub_event_name', NEW.name),
                FALSE,
                NOW()
            )
            ON CONFLICT (event_key) DO NOTHING;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_results_published ON public.sub_events;
CREATE TRIGGER trg_notify_on_results_published
AFTER UPDATE OF results_published ON public.sub_events
FOR EACH ROW
WHEN (NEW.results_published IS TRUE AND (OLD.results_published IS NOT TRUE))
EXECUTE FUNCTION public.trigger_notify_on_results_published();

-- 13. TRIGGER: CERTIFICATE LIFECYCLE NOTIFICATIONS (FEEDBACK GATE & UNLOCK)
CREATE OR REPLACE FUNCTION public.trigger_notify_on_certificate_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_sub_event_name TEXT;
    v_event_key TEXT;
    v_title TEXT;
    v_message TEXT;
    v_notif_type TEXT;
BEGIN
    SELECT COALESCE(tm.user_id, r.leader_id), se.name
    INTO v_user_id, v_sub_event_name
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    JOIN public.sub_events se ON se.id = NEW.sub_event_id
    WHERE tm.id = NEW.team_member_id;

    IF v_user_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF (TG_OP = 'INSERT' AND NEW.status = 'LOCKED' AND NEW.type = 'PARTICIPANT') THEN
        v_event_key := 'CERT_FEEDBACK_REQUIRED:' || NEW.id::text;
        v_title := 'Certificate Feedback Required';
        v_message := 'Your participation certificate for ' || COALESCE(v_sub_event_name, 'the event') || ' is ready but locked until the required feedback is submitted.';
        v_notif_type := 'FEEDBACK_REQUIRED';

        INSERT INTO public.notifications (
            user_id, coordinator_id, recipient_role, notification_type,
            category, entity_type, entity_id, title, message, event_key,
            metadata, is_read, created_at
        ) VALUES (
            v_user_id, NULL, 'STUDENT', v_notif_type,
            'CERTIFICATES', 'CERTIFICATE', NEW.id, v_title, v_message, v_event_key,
            jsonb_build_object('certificate_id', NEW.id, 'sub_event_id', NEW.sub_event_id, 'type', NEW.type),
            FALSE, NOW()
        )
        ON CONFLICT (event_key) DO NOTHING;

    ELSIF (NEW.status = 'UNLOCKED' AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status = 'LOCKED')) AND NEW.type = 'PARTICIPANT') THEN
        v_event_key := 'CERT_UNLOCKED:' || NEW.id::text;
        v_title := 'Certificate Available';
        v_message := 'Your participation certificate for ' || COALESCE(v_sub_event_name, 'the event') || ' is now available to view and download.';
        v_notif_type := 'CERTIFICATE_AVAILABLE';

        INSERT INTO public.notifications (
            user_id, coordinator_id, recipient_role, notification_type,
            category, entity_type, entity_id, title, message, event_key,
            metadata, is_read, created_at
        ) VALUES (
            v_user_id, NULL, 'STUDENT', v_notif_type,
            'CERTIFICATES', 'CERTIFICATE', NEW.id, v_title, v_message, v_event_key,
            jsonb_build_object('certificate_id', NEW.id, 'sub_event_id', NEW.sub_event_id, 'type', NEW.type),
            FALSE, NOW()
        )
        ON CONFLICT (event_key) DO NOTHING;

    ELSIF (TG_OP = 'INSERT' AND NEW.status = 'UNLOCKED' AND NEW.type IN ('WINNER', 'RUNNER', 'THIRD_PLACE')) THEN
        v_event_key := 'ACHIEVEMENT_CERT:' || NEW.id::text;
        v_title := 'Achievement Certificate Available';
        v_message := 'Congratulations! Your achievement certificate for ' || COALESCE(v_sub_event_name, 'the event') || ' is now available.';
        v_notif_type := 'CERTIFICATE_AVAILABLE';

        INSERT INTO public.notifications (
            user_id, coordinator_id, recipient_role, notification_type,
            category, entity_type, entity_id, title, message, event_key,
            metadata, is_read, created_at
        ) VALUES (
            v_user_id, NULL, 'STUDENT', v_notif_type,
            'CERTIFICATES', 'CERTIFICATE', NEW.id, v_title, v_message, v_event_key,
            jsonb_build_object('certificate_id', NEW.id, 'sub_event_id', NEW.sub_event_id, 'type', NEW.type),
            FALSE, NOW()
        )
        ON CONFLICT (event_key) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_certificate_lifecycle ON public.certificates;
CREATE TRIGGER trg_notify_on_certificate_lifecycle
AFTER INSERT OR UPDATE OF status ON public.certificates
FOR EACH ROW
EXECUTE FUNCTION public.trigger_notify_on_certificate_lifecycle();

-- 14. TRIGGERS FOR REGISTRATION AND PAYMENT CREATION NOTIFICATIONS
CREATE OR REPLACE FUNCTION public.trigger_notify_on_registration_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_sub_event RECORD;
BEGIN
    SELECT se.name, e.name AS parent_event_name
    INTO v_sub_event
    FROM public.sub_events se
    LEFT JOIN public.events e ON e.id = se.event_id
    WHERE se.id = NEW.sub_event_id;

    IF NEW.status = 'CONFIRMED' THEN
        INSERT INTO public.notifications (
            user_id, coordinator_id, recipient_role, notification_type,
            category, entity_type, entity_id, title, message, event_key,
            metadata, is_read, created_at
        ) VALUES (
            NEW.leader_id, NULL, 'STUDENT', 'REGISTRATION_CONFIRMED',
            'REGISTRATION', 'REGISTRATION', NEW.id,
            'Registration Confirmed',
            'Your registration for ' || COALESCE(v_sub_event.name, 'the event') || ' under ' || COALESCE(v_sub_event.parent_event_name, 'KITS-EOS') || ' has been confirmed.',
            'REG_CONFIRMED:' || NEW.id::text,
            jsonb_build_object('registration_id', NEW.id, 'sub_event_id', NEW.sub_event_id),
            FALSE, NOW()
        ) ON CONFLICT (event_key) DO NOTHING;

    ELSIF NEW.status = 'PENDING' THEN
        INSERT INTO public.notifications (
            user_id, coordinator_id, recipient_role, notification_type,
            category, entity_type, entity_id, title, message, event_key,
            metadata, is_read, created_at
        ) VALUES (
            NEW.leader_id, NULL, 'STUDENT', 'REGISTRATION_SUBMITTED',
            'REGISTRATION', 'REGISTRATION', NEW.id,
            'Registration Submitted',
            'Your registration for ' || COALESCE(v_sub_event.name, 'the event') || ' has been submitted. Payment is pending verification by the assigned coordinator.',
            'REG_SUBMITTED:' || NEW.id::text,
            jsonb_build_object('registration_id', NEW.id, 'sub_event_id', NEW.sub_event_id),
            FALSE, NOW()
        ) ON CONFLICT (event_key) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_registration_created ON public.registrations;
CREATE TRIGGER trg_notify_on_registration_created
AFTER INSERT ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION public.trigger_notify_on_registration_created();

CREATE OR REPLACE FUNCTION public.trigger_notify_on_payment_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_reg RECORD;
    v_coord_assign RECORD;
BEGIN
    SELECT r.id, r.leader_id, r.sub_event_id, se.name AS sub_event_name
    INTO v_reg
    FROM public.registrations r
    JOIN public.sub_events se ON se.id = r.sub_event_id
    WHERE r.id = NEW.registration_id;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'SUCCESS' THEN
        INSERT INTO public.notifications (
            user_id, coordinator_id, recipient_role, notification_type,
            category, entity_type, entity_id, title, message, event_key,
            metadata, is_read, created_at
        ) VALUES (
            v_reg.leader_id, NULL, 'STUDENT', 'PAYMENT_CONFIRMED',
            'REGISTRATION', 'PAYMENT', NEW.id,
            'Payment Successful',
            'Your payment of ₹' || NEW.amount || ' for ' || v_reg.sub_event_name || ' was successful. Your registration is confirmed.',
            'PAYMENT_CONFIRMED:' || NEW.id::text,
            jsonb_build_object('payment_id', NEW.id, 'registration_id', v_reg.id, 'sub_event_id', v_reg.sub_event_id, 'amount', NEW.amount),
            FALSE, NOW()
        ) ON CONFLICT (event_key) DO NOTHING;

    ELSIF NEW.status = 'PENDING' THEN
        FOR v_coord_assign IN
            SELECT coordinator_id FROM public.coordinator_assignments WHERE sub_event_id = v_reg.sub_event_id
        LOOP
            INSERT INTO public.notifications (
                user_id, coordinator_id, recipient_role, notification_type,
                category, entity_type, entity_id, title, message, event_key,
                metadata, is_read, created_at
            ) VALUES (
                NULL, v_coord_assign.coordinator_id, 'COORDINATOR', 'PAYMENT_PENDING',
                'REGISTRATION', 'PAYMENT', NEW.id,
                'Payment Awaiting Verification',
                'A payment of ₹' || NEW.amount || ' for ' || v_reg.sub_event_name || ' is awaiting verification.',
                'COORD_PAY_PENDING:' || v_coord_assign.coordinator_id::text || ':' || NEW.id::text,
                jsonb_build_object('payment_id', NEW.id, 'registration_id', v_reg.id, 'sub_event_id', v_reg.sub_event_id),
                FALSE, NOW()
            ) ON CONFLICT (event_key) DO NOTHING;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_payment_created ON public.payments;
CREATE TRIGGER trg_notify_on_payment_created
AFTER INSERT ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.trigger_notify_on_payment_created();

-- 15. GRANTS
GRANT EXECUTE ON FUNCTION public.ensure_welcome_notification(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read_on_open(UUID[], TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portal_notifications(INT, INT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portal_unread_count(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_bulk_payments(UUID[], TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_cod_payment(UUID, UUID, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_attendance_checkin(UUID, UUID, UUID[], TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
