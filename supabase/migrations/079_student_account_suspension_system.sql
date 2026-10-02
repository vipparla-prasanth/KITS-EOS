-- ============================================================================
-- Migration 079: Student Account Suspension & Unsuspension Request System
-- ============================================================================
-- Description:
-- 1. Adds authoritative account_status ('ACTIVE', 'SUSPENDED') and suspension
--    metadata (suspension_reason, suspended_at, suspended_by) to public.student_profiles.
-- 2. Preserves all existing students with default account_status = 'ACTIVE'.
-- 3. Creates public.student_account_suspension_requests table with a PostgreSQL
--    unique partial index preventing duplicate PENDING requests per student.
-- 4. Updates enforce_student_profile_update_rules() trigger to prevent non-admins
--    from modifying suspension columns.
-- 5. Implements atomic security-definer RPCs:
--    - admin_suspend_student(p_student_id, p_reason)
--    - admin_unsuspend_student(p_student_id, p_admin_note)
--    - admin_review_unsuspension_request(p_request_id, p_decision, p_admin_note)
--    - student_submit_unsuspension_request(p_message)
-- 6. Updates get_student_account_status() to return suspension details and active/latest requests.
-- 7. Updates student_register_atomic() to reject registrations if leader profile is SUSPENDED.
-- 8. Configures least-privilege RLS policies and immutable audit logging.
-- ============================================================================

-- 1. ADD SUSPENSION COLUMNS TO public.student_profiles
ALTER TABLE public.student_profiles 
    ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'SUSPENDED')),
    ADD COLUMN IF NOT EXISTS suspension_reason TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS suspended_by UUID DEFAULT NULL REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_student_profiles_account_status ON public.student_profiles(account_status);


-- 2. CREATE TABLE public.student_account_suspension_requests
CREATE TABLE IF NOT EXISTS public.student_account_suspension_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.student_profiles(user_id) ON DELETE CASCADE,
    request_message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    admin_response TEXT DEFAULT NULL,
    reviewed_by UUID DEFAULT NULL REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial Unique Index: Exactly one active PENDING unsuspension request per suspended student
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_pending_suspension_request 
ON public.student_account_suspension_requests(student_id) 
WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_suspension_requests_status 
ON public.student_account_suspension_requests(status);

CREATE INDEX IF NOT EXISTS idx_suspension_requests_created_at 
ON public.student_account_suspension_requests(created_at DESC);


-- 3. RLS POLICIES FOR public.student_account_suspension_requests
ALTER TABLE public.student_account_suspension_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage suspension requests" ON public.student_account_suspension_requests;
CREATE POLICY "Admins can manage suspension requests" 
ON public.student_account_suspension_requests 
FOR ALL 
USING (public.is_admin());

DROP POLICY IF EXISTS "Students can view own suspension requests" ON public.student_account_suspension_requests;
CREATE POLICY "Students can view own suspension requests" 
ON public.student_account_suspension_requests 
FOR SELECT 
USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Students can insert own suspension request" ON public.student_account_suspension_requests;
CREATE POLICY "Students can insert own suspension request" 
ON public.student_account_suspension_requests 
FOR INSERT 
WITH CHECK (student_id = auth.uid());


-- 4. UPDATE PROFILE TRIGGER: DISALLOW NON-ADMIN MODIFICATIONS TO SUSPENSION FIELDS
CREATE OR REPLACE FUNCTION public.enforce_student_profile_update_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_digits text;
BEGIN
    -- Check administrative exemption via existing authoritative public.is_admin()
    IF public.is_admin() THEN
        RETURN NEW;
    END IF;

    -- RULE 0: Suspension fields and account_status can ONLY be modified by administrators
    IF NEW.account_status IS DISTINCT FROM OLD.account_status OR
       NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason OR
       NEW.suspended_at IS DISTINCT FROM OLD.suspended_at OR
       NEW.suspended_by IS DISTINCT FROM OLD.suspended_by THEN
        RAISE EXCEPTION 'Account status and suspension metadata can only be modified by administrators.';
    END IF;

    -- RULE 1: Roll Number is permanently locked
    IF NEW.roll_number IS DISTINCT FROM OLD.roll_number THEN
        RAISE EXCEPTION 'Roll number is permanently assigned and cannot be changed by students.';
    END IF;

    -- RULE 2: Department / Branch is permanently locked
    IF NEW.department IS DISTINCT FROM OLD.department OR 
       NEW.other_department IS DISTINCT FROM OLD.other_department THEN
        RAISE EXCEPTION 'Department information cannot be modified by students.';
    END IF;

    -- RULE 3: College / Institution is permanently locked
    IF NEW.college IS DISTINCT FROM OLD.college THEN
        RAISE EXCEPTION 'College / Institution information cannot be modified by students.';
    END IF;

    -- RULE 4: Full Legal Name is ONE-TIME EDIT ONLY
    IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
        IF OLD.name_change_used = TRUE THEN
            RAISE EXCEPTION 'Your one-time legal name change has already been used.';
        END IF;
        -- Consume the one-time name change atomically
        NEW.name_change_used := TRUE;
    ELSE
        -- When name did NOT change, preserve existing flag state
        NEW.name_change_used := OLD.name_change_used;
    END IF;

    -- Prevent client from attempting to reset name_change_used to FALSE
    IF OLD.name_change_used = TRUE AND NEW.name_change_used = FALSE THEN
        NEW.name_change_used := TRUE;
    END IF;

    -- RULE 5: Year of Study validation (must be 1, 2, 3, or 4)
    IF NEW.year_of_study NOT IN (1, 2, 3, 4) THEN
        RAISE EXCEPTION 'Year of study must be between 1 and 4.';
    END IF;

    -- RULE 6: Contact Number validation (Indian mobile number format)
    IF NEW.phone IS DISTINCT FROM OLD.phone THEN
        v_digits := regexp_replace(NEW.phone, '\D', '', 'g');
        IF length(v_digits) = 12 AND v_digits LIKE '91%' THEN
            v_digits := substr(v_digits, 3);
        ELSIF length(v_digits) = 11 AND v_digits LIKE '0%' THEN
            v_digits := substr(v_digits, 2);
        END IF;

        IF length(v_digits) != 10 OR v_digits !~ '^[6-9]' THEN
            RAISE EXCEPTION 'Invalid contact number. Must be a valid 10-digit Indian mobile number starting with 6-9.';
        END IF;

        NEW.phone := v_digits;
    END IF;

    RETURN NEW;
END;
$function$;


-- 5. RPC: admin_suspend_student
CREATE OR REPLACE FUNCTION public.admin_suspend_student(
    p_student_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_clean_reason TEXT;
    v_profile RECORD;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Access denied: Administrator privileges required.';
    END IF;

    v_clean_reason := trim(COALESCE(p_reason, ''));
    IF length(v_clean_reason) < 3 THEN
        RAISE EXCEPTION 'A valid suspension reason (at least 3 characters) is required.';
    END IF;

    SELECT user_id, full_name, roll_number, account_status
    INTO v_profile
    FROM public.student_profiles
    WHERE user_id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student profile not found for user ID %.', p_student_id;
    END IF;

    -- Update student profile status
    UPDATE public.student_profiles
    SET account_status = 'SUSPENDED',
        suspension_reason = v_clean_reason,
        suspended_at = NOW(),
        suspended_by = v_actor_id
    WHERE user_id = p_student_id;

    -- Immutable audit logging
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_actor_id,
        'STUDENT_SUSPENDED',
        'student_profiles',
        p_student_id,
        jsonb_build_object(
            'student_id', p_student_id,
            'full_name', v_profile.full_name,
            'roll_number', v_profile.roll_number,
            'reason', v_clean_reason,
            'suspended_by', v_actor_id
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Student account suspended successfully.',
        'student_id', p_student_id,
        'account_status', 'SUSPENDED'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_suspend_student(UUID, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_suspend_student(UUID, TEXT) TO authenticated;


-- 6. RPC: admin_unsuspend_student
CREATE OR REPLACE FUNCTION public.admin_unsuspend_student(
    p_student_id UUID,
    p_admin_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_clean_note TEXT;
    v_profile RECORD;
    v_resolved_requests_count INT := 0;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Access denied: Administrator privileges required.';
    END IF;

    v_clean_note := NULLIF(trim(COALESCE(p_admin_note, '')), '');

    SELECT user_id, full_name, roll_number, account_status, suspension_reason
    INTO v_profile
    FROM public.student_profiles
    WHERE user_id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student profile not found for user ID %.', p_student_id;
    END IF;

    -- Update student profile status back to ACTIVE
    UPDATE public.student_profiles
    SET account_status = 'ACTIVE'
    WHERE user_id = p_student_id;

    -- Resolve any pending suspension requests for this student
    UPDATE public.student_account_suspension_requests
    SET status = 'APPROVED',
        admin_response = COALESCE(v_clean_note, 'Directly unsuspended by administrator.'),
        reviewed_by = v_actor_id,
        reviewed_at = NOW(),
        updated_at = NOW()
    WHERE student_id = p_student_id
      AND status = 'PENDING';
    GET DIAGNOSTICS v_resolved_requests_count = ROW_COUNT;

    -- Safe notification (does not break transaction if notification table fails)
    BEGIN
        INSERT INTO public.notifications (
            user_id,
            title,
            message,
            is_read,
            recipient_role,
            created_at
        ) VALUES (
            p_student_id,
            'Account Unsuspended',
            'Your KITS-EOS student account has been restored to active status. You can now access all portal features.',
            false,
            'STUDENT',
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- Immutable audit logging
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_actor_id,
        'STUDENT_UNSUSPENDED',
        'student_profiles',
        p_student_id,
        jsonb_build_object(
            'student_id', p_student_id,
            'full_name', v_profile.full_name,
            'roll_number', v_profile.roll_number,
            'previous_reason', v_profile.suspension_reason,
            'admin_note', v_clean_note,
            'resolved_pending_requests', v_resolved_requests_count,
            'unsuspended_by', v_actor_id
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Student account unsuspended successfully.',
        'student_id', p_student_id,
        'account_status', 'ACTIVE'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unsuspend_student(UUID, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_unsuspend_student(UUID, TEXT) TO authenticated;


-- 7. RPC: admin_review_unsuspension_request
CREATE OR REPLACE FUNCTION public.admin_review_unsuspension_request(
    p_request_id UUID,
    p_decision VARCHAR(20),
    p_admin_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_clean_decision VARCHAR(20);
    v_clean_note TEXT;
    v_req RECORD;
    v_student RECORD;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Access denied: Administrator privileges required.';
    END IF;

    v_clean_decision := UPPER(trim(COALESCE(p_decision, '')));
    IF v_clean_decision NOT IN ('APPROVED', 'REJECTED') THEN
        RAISE EXCEPTION 'Decision must be either APPROVED or REJECTED.';
    END IF;

    v_clean_note := NULLIF(trim(COALESCE(p_admin_note, '')), '');

    -- Lock request
    SELECT id, student_id, request_message, status, created_at
    INTO v_req
    FROM public.student_account_suspension_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Suspension request not found with ID %.', p_request_id;
    END IF;

    IF v_req.status <> 'PENDING' THEN
        RAISE EXCEPTION 'This request has already been reviewed (status: %).', v_req.status;
    END IF;

    -- Fetch student profile
    SELECT user_id, full_name, roll_number, account_status, suspension_reason
    INTO v_student
    FROM public.student_profiles
    WHERE user_id = v_req.student_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student profile not found for ID %.', v_req.student_id;
    END IF;

    IF v_clean_decision = 'APPROVED' THEN
        -- Atomic restoration of student account
        UPDATE public.student_profiles
        SET account_status = 'ACTIVE'
        WHERE user_id = v_req.student_id;

        UPDATE public.student_account_suspension_requests
        SET status = 'APPROVED',
            admin_response = COALESCE(v_clean_note, 'Approved and unsuspended by administrator.'),
            reviewed_by = v_actor_id,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = p_request_id;

        -- Safe notification
        BEGIN
            INSERT INTO public.notifications (
                user_id,
                title,
                message,
                is_read,
                recipient_role,
                created_at
            ) VALUES (
                v_req.student_id,
                'Unsuspension Request Approved',
                'Your unsuspension request has been approved and your account is restored to active status.',
                false,
                'STUDENT',
                NOW()
            );
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        -- Audit log 1: STUDENT_UNSUSPENDED
        INSERT INTO public.audit_logs (
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata,
            created_at
        ) VALUES (
            v_actor_id,
            'STUDENT_UNSUSPENDED',
            'student_profiles',
            v_req.student_id,
            jsonb_build_object(
                'student_id', v_req.student_id,
                'full_name', v_student.full_name,
                'roll_number', v_student.roll_number,
                'request_id', p_request_id,
                'note', v_clean_note,
                'unsuspended_by', v_actor_id
            ),
            NOW()
        );

        -- Audit log 2: UNSUSPENSION_REQUEST_APPROVED
        INSERT INTO public.audit_logs (
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata,
            created_at
        ) VALUES (
            v_actor_id,
            'UNSUSPENSION_REQUEST_APPROVED',
            'student_account_suspension_requests',
            p_request_id,
            jsonb_build_object(
                'request_id', p_request_id,
                'student_id', v_req.student_id,
                'admin_response', v_clean_note,
                'reviewed_by', v_actor_id
            ),
            NOW()
        );

    ELSE -- REJECTED
        UPDATE public.student_account_suspension_requests
        SET status = 'REJECTED',
            admin_response = COALESCE(v_clean_note, 'Your unsuspension request was reviewed and rejected. Please contact the administration if you require further clarification.'),
            reviewed_by = v_actor_id,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = p_request_id;

        -- Safe notification
        BEGIN
            INSERT INTO public.notifications (
                user_id,
                title,
                message,
                is_read,
                recipient_role,
                created_at
            ) VALUES (
                v_req.student_id,
                'Unsuspension Request Rejected',
                COALESCE(v_clean_note, 'Your unsuspension request was reviewed and rejected.'),
                false,
                'STUDENT',
                NOW()
            );
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        -- Audit log: UNSUSPENSION_REQUEST_REJECTED
        INSERT INTO public.audit_logs (
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata,
            created_at
        ) VALUES (
            v_actor_id,
            'UNSUSPENSION_REQUEST_REJECTED',
            'student_account_suspension_requests',
            p_request_id,
            jsonb_build_object(
                'request_id', p_request_id,
                'student_id', v_req.student_id,
                'admin_response', v_clean_note,
                'reviewed_by', v_actor_id
            ),
            NOW()
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'request_id', p_request_id,
        'decision', v_clean_decision,
        'message', 'Unsuspension request ' || lower(v_clean_decision) || ' successfully.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_unsuspension_request(UUID, VARCHAR, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_review_unsuspension_request(UUID, VARCHAR, TEXT) TO authenticated;


-- 8. RPC: student_submit_unsuspension_request
CREATE OR REPLACE FUNCTION public.student_submit_unsuspension_request(
    p_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_clean_message TEXT;
    v_profile RECORD;
    v_new_request_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_clean_message := trim(COALESCE(p_message, ''));
    IF length(v_clean_message) < 5 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'MESSAGE_TOO_SHORT',
            'message', 'Please provide a descriptive explanation (at least 5 characters).'
        );
    END IF;

    -- Verify student profile and current suspension status
    SELECT user_id, full_name, roll_number, account_status
    INTO v_profile
    FROM public.student_profiles
    WHERE user_id = v_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'PROFILE_NOT_FOUND',
            'message', 'Student profile not found.'
        );
    END IF;

    IF v_profile.account_status <> 'SUSPENDED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'NOT_SUSPENDED',
            'message', 'Your account is currently active and does not require an unsuspension request.'
        );
    END IF;

    -- Check for existing PENDING request
    IF EXISTS (
        SELECT 1 FROM public.student_account_suspension_requests
        WHERE student_id = v_user_id AND status = 'PENDING'
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'DUPLICATE_PENDING_REQUEST',
            'message', 'Your unsuspension request is already under review.'
        );
    END IF;

    -- Insert new request
    INSERT INTO public.student_account_suspension_requests (
        student_id,
        request_message,
        status
    ) VALUES (
        v_user_id,
        v_clean_message,
        'PENDING'
    )
    RETURNING id INTO v_new_request_id;

    -- Audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_user_id,
        'UNSUSPENSION_REQUEST_SUBMITTED',
        'student_account_suspension_requests',
        v_new_request_id,
        jsonb_build_object(
            'request_id', v_new_request_id,
            'student_id', v_user_id,
            'roll_number', v_profile.roll_number,
            'message_length', length(v_clean_message)
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'request_id', v_new_request_id,
        'message', 'Unsuspension request submitted successfully.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.student_submit_unsuspension_request(TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.student_submit_unsuspension_request(TEXT) TO authenticated;


-- 9. UPDATE get_student_account_status()
CREATE OR REPLACE FUNCTION public.get_student_account_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_user RECORD;
    v_profile RECORD;
    v_pending_req RECORD;
    v_latest_req RECORD;
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

    -- Fetch student profile suspension details
    SELECT account_status, suspension_reason, suspended_at, full_name, roll_number
    INTO v_profile
    FROM public.student_profiles
    WHERE user_id = v_user_id;

    -- Fetch active PENDING request if exists
    SELECT id, request_message, status, created_at
    INTO v_pending_req
    FROM public.student_account_suspension_requests
    WHERE student_id = v_user_id AND status = 'PENDING'
    LIMIT 1;

    -- Fetch latest request overall (for rejection notes or history)
    SELECT id, request_message, status, admin_response, created_at, reviewed_at
    INTO v_latest_req
    FROM public.student_account_suspension_requests
    WHERE student_id = v_user_id
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_user.id,
        'email', v_user.email,
        'role', v_user.role,
        'status', v_user.status,
        'deactivated_at', v_user.deactivated_at,
        'scheduled_permanent_deletion_at', v_user.scheduled_permanent_deletion_at,
        'days_remaining', v_days_remaining,
        'is_expired', (v_user.scheduled_permanent_deletion_at IS NOT NULL AND NOW() >= v_user.scheduled_permanent_deletion_at),
        'account_status', COALESCE(v_profile.account_status, 'ACTIVE'),
        'suspension_reason', v_profile.suspension_reason,
        'suspended_at', v_profile.suspended_at,
        'full_name', v_profile.full_name,
        'roll_number', v_profile.roll_number,
        'pending_request', CASE 
            WHEN v_pending_req.id IS NOT NULL THEN jsonb_build_object(
                'id', v_pending_req.id,
                'request_message', v_pending_req.request_message,
                'status', v_pending_req.status,
                'created_at', v_pending_req.created_at
            )
            ELSE NULL 
        END,
        'latest_request', CASE 
            WHEN v_latest_req.id IS NOT NULL THEN jsonb_build_object(
                'id', v_latest_req.id,
                'request_message', v_latest_req.request_message,
                'status', v_latest_req.status,
                'admin_response', v_latest_req.admin_response,
                'created_at', v_latest_req.created_at,
                'reviewed_at', v_latest_req.reviewed_at
            )
            ELSE NULL 
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_account_status() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_student_account_status() TO authenticated;


-- 10. UPDATE student_register_atomic() TO ENFORCE SUSPENSION STATUS
CREATE OR REPLACE FUNCTION public.student_register_atomic(
    p_sub_event_id UUID,
    p_mode VARCHAR,
    p_team_name VARCHAR DEFAULT NULL,
    p_team_members JSONB DEFAULT '[]'::jsonb,
    p_uploaded_documents JSONB DEFAULT '[]'::jsonb,
    p_payment_method VARCHAR DEFAULT 'UPI',
    p_payment_reference VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_leader_id UUID;
    v_user_status VARCHAR;
    v_leader_profile public.student_profiles;
    v_auth_leader_roll TEXT;
    v_sub_event RECORD;
    v_parent_event public.events;
    v_cat_status public.event_status;
    v_parent_effective_status TEXT;
    v_is_free BOOLEAN := false;
    v_fee NUMERIC := 0;
    v_is_cod BOOLEAN := false;
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
    v_pay_method VARCHAR := UPPER(trim(COALESCE(p_payment_method, '')));
    v_payment RECORD;
    v_payment_json JSONB := NULL;
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

    -- 2. Query authoritative student profile for the authenticated leader
    SELECT * INTO v_leader_profile 
    FROM public.student_profiles 
    WHERE user_id = v_leader_id;

    IF v_leader_profile.user_id IS NULL OR v_leader_profile.roll_number IS NULL OR length(trim(v_leader_profile.roll_number)) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'LEADER_PROFILE_INCOMPLETE',
            'message', 'Your student profile must have a valid roll number to register.'
        );
    END IF;

    -- SUSPENSION CHECK: Reject if student account is SUSPENDED
    IF v_leader_profile.account_status = 'SUSPENDED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ACCOUNT_SUSPENDED',
            'message', 'Your student account has been suspended. Event registrations are not permitted.'
        );
    END IF;

    v_auth_leader_roll := UPPER(trim(v_leader_profile.roll_number));

    IF p_sub_event_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'sub_event_id is required');
    END IF;

    IF p_mode NOT IN ('SOLO', 'TEAM') THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'mode must be SOLO or TEAM');
    END IF;

    IF p_team_members IS NULL OR jsonb_typeof(p_team_members) <> 'array' OR jsonb_array_length(p_team_members) = 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'At least one participant is required');
    END IF;

    -- 3. Fetch sub-event record
    SELECT * INTO v_sub_event
    FROM public.sub_events
    WHERE id = p_sub_event_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SUB_EVENT_NOT_FOUND', 'message', 'Sub-event not found');
    END IF;

    -- 4. Check Archival Status of Sub-Event
    IF v_sub_event.status <> 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'code', 'SUB_EVENT_ARCHIVED', 'message', 'Registrations are disabled because this sub-event is archived or permanently deleted.');
    END IF;

    -- 5. Check Category Status
    IF v_sub_event.category_id IS NOT NULL THEN
        SELECT status INTO v_cat_status FROM public.categories WHERE id = v_sub_event.category_id;
        IF v_cat_status IS NOT NULL AND v_cat_status <> 'ACTIVE' THEN
            RETURN jsonb_build_object('success', false, 'code', 'CATEGORY_ARCHIVED', 'message', 'Registrations are disabled because this category is archived or permanently deleted.');
        END IF;
    END IF;

    -- 6. Check Parent Event Status & Lifecycle
    IF v_sub_event.event_id IS NOT NULL THEN
        SELECT * INTO v_parent_event FROM public.events WHERE id = v_sub_event.event_id;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'code', 'PARENT_EVENT_NOT_FOUND', 'message', 'Parent event not found');
        END IF;

        IF v_parent_event.status <> 'ACTIVE' THEN
            RETURN jsonb_build_object('success', false, 'code', 'PARENT_EVENT_ARCHIVED', 'message', 'Registrations are disabled because the parent event is archived or permanently deleted.');
        END IF;

        IF v_parent_event.status_mode = 'MANUAL' AND v_parent_event.manual_status IS NOT NULL THEN
            v_parent_effective_status := v_parent_event.manual_status;
        ELSE
            IF NOW() < v_parent_event.registration_start_date THEN
                v_parent_effective_status := 'UPCOMING';
            ELSIF NOW() <= v_parent_event.registration_end_date THEN
                v_parent_effective_status := 'REGISTRATIONS OPEN';
            ELSIF NOW() < v_parent_event.start_date THEN
                v_parent_effective_status := 'REGISTRATIONS CLOSED';
            ELSIF NOW() <= v_parent_event.end_date THEN
                v_parent_effective_status := 'ONGOING';
            ELSE
                v_parent_effective_status := 'COMPLETED';
            END IF;
        END IF;

        IF v_parent_effective_status <> 'REGISTRATIONS OPEN' THEN
            RETURN jsonb_build_object('success', false, 'code', 'REGISTRATIONS_CLOSED', 'message', 'Registrations are closed for this event.');
        END IF;
    END IF;

    -- 7. Validate Sub-Event Registration Windows
    IF v_sub_event.registration_start_time IS NOT NULL AND NOW() < v_sub_event.registration_start_time THEN
        RETURN jsonb_build_object('success', false, 'code', 'REGISTRATIONS_NOT_OPEN', 'message', 'Registrations for this sub-event have not opened yet');
    END IF;
    IF v_sub_event.registration_end_time IS NOT NULL AND NOW() > v_sub_event.registration_end_time THEN
        RETURN jsonb_build_object('success', false, 'code', 'REGISTRATIONS_EXPIRED', 'message', 'Registrations for this sub-event have closed');
    END IF;

    -- 8. Validate Participation Mode Compatibility
    IF v_sub_event.participation_type <> 'BOTH' AND v_sub_event.participation_type <> p_mode THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_MODE', 'message', 'Participation mode ' || p_mode || ' is not permitted for this sub-event');
    END IF;

    -- 9. Determine Free/Paid Status & Fee
    v_is_free := (v_sub_event.is_free = true) OR (
        CASE 
            WHEN p_mode = 'SOLO' THEN COALESCE(v_sub_event.fee_amount_solo, 0) = 0
            ELSE COALESCE(v_sub_event.fee_amount_team, 0) = 0
        END
    );

    IF v_is_free THEN
        v_fee := 0;
        v_is_cod := false;
        v_initial_status := 'CONFIRMED';
    ELSE
        v_fee := CASE WHEN p_mode = 'SOLO' THEN COALESCE(v_sub_event.fee_amount_solo, 0) ELSE COALESCE(v_sub_event.fee_amount_team, 0) END;
        v_is_cod := (v_pay_method = 'COD');
        IF v_is_cod THEN
            v_initial_status := 'PENDING_PAYMENT';
            v_pay_status := 'PENDING';
        ELSE
            v_initial_status := 'CONFIRMED';
            v_pay_status := 'SUCCESS';
            IF length(v_pay_ref) = 0 THEN
                RETURN jsonb_build_object('success', false, 'code', 'PAYMENT_REFERENCE_REQUIRED', 'message', 'Payment reference / transaction ID is required for paid online registration');
            END IF;
        END IF;
    END IF;

    -- 10. Team Name & Size Validations
    IF p_mode = 'TEAM' THEN
        v_team_title := trim(COALESCE(p_team_name, ''));
        IF length(v_team_title) = 0 THEN
            RETURN jsonb_build_object('success', false, 'code', 'TEAM_NAME_REQUIRED', 'message', 'Team name is required for team participation');
        END IF;

        IF jsonb_array_length(p_team_members) < 2 THEN
            RETURN jsonb_build_object('success', false, 'code', 'TEAM_TOO_SMALL', 'message', 'A team registration requires at least 2 members');
        END IF;

        IF jsonb_array_length(p_team_members) > v_sub_event.max_team_size THEN
            RETURN jsonb_build_object('success', false, 'code', 'TEAM_TOO_LARGE', 'message', 'Team exceeds maximum allowed members (' || v_sub_event.max_team_size || ')');
        END IF;

        -- Teammate Roll Number Validation
        v_sorted_rolls := ARRAY[v_auth_leader_roll];

        FOR v_idx IN 1 .. (jsonb_array_length(p_team_members) - 1) LOOP
            v_m := p_team_members->v_idx;
            v_roll := UPPER(trim(COALESCE(v_m->>'roll_number', '')));

            IF length(v_roll) = 0 THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'INVALID_TEAM_MEMBER_ROLL',
                    'message', 'Roll number is required for all team members.'
                );
            END IF;

            IF v_roll = v_auth_leader_roll THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'LEADER_CANNOT_BE_TEAMMATE',
                    'message', 'The team leader (' || v_auth_leader_roll || ') cannot also be listed as a teammate.'
                );
            END IF;

            IF v_roll = ANY(v_sorted_rolls) THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'DUPLICATE_TEAMMATE_ROLL',
                    'message', 'Roll number "' || v_roll || '" is duplicated within this team. Each team member must have a unique roll number.'
                );
            END IF;

            v_sorted_rolls := array_append(v_sorted_rolls, v_roll);
        END LOOP;

    ELSE
        v_team_title := 'Solo Participant';
        v_sorted_rolls := ARRAY[v_auth_leader_roll];
    END IF;

    -- 11. Concurrency Locks: Acquire advisory locks on all roll numbers
    SELECT array_agg(r ORDER BY r) INTO v_sorted_rolls FROM unnest(v_sorted_rolls) AS r;

    FOREACH v_roll IN ARRAY v_sorted_rolls LOOP
        v_lock_key := ('x' || substr(md5(p_sub_event_id::text || ':' || v_roll), 1, 16))::bit(64)::bigint;
        PERFORM pg_advisory_xact_lock(v_lock_key);
    END LOOP;

    -- 12. Check for Duplicate Registrations across existing records
    FOREACH v_roll IN ARRAY v_sorted_rolls LOOP
        IF EXISTS (
            SELECT 1 
            FROM public.team_members tm
            JOIN public.registrations r ON r.id = tm.registration_id
            WHERE r.sub_event_id = p_sub_event_id
              AND UPPER(trim(tm.roll_number)) = v_roll
              AND r.status IN ('CONFIRMED', 'PENDING_PAYMENT')
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'DUPLICATE_REGISTRATION',
                'message', 'Student with roll number ' || v_roll || ' is already registered for this sub-event',
                'conflicting_roll', v_roll
            );
        END IF;
    END LOOP;

    -- 13. Lock Sub-Event for Capacity Check & Sync
    PERFORM id FROM public.sub_events WHERE id = p_sub_event_id FOR UPDATE;

    IF v_sub_event.max_capacity IS NOT NULL THEN
        IF COALESCE(v_sub_event.registered_count, 0) >= v_sub_event.max_capacity THEN
            RETURN jsonb_build_object('success', false, 'code', 'CAPACITY_EXCEEDED', 'message', 'This sub-event has reached full registration capacity');
        END IF;
    END IF;

    -- 14. Insert Registration
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
    )
    RETURNING id INTO v_reg_id;

    -- 15. Insert Team
    INSERT INTO public.teams (
        registration_id,
        name,
        created_at
    ) VALUES (
        v_reg_id,
        v_team_title,
        NOW()
    )
    RETURNING id INTO v_team_id;

    -- 16. Insert Team Members & Attendance Tokens
    v_token_prefix := COALESCE(v_sub_event.attendance_token_prefix, 'EVT');

    FOR v_idx IN 0 .. (jsonb_array_length(p_team_members) - 1) LOOP
        v_m := p_team_members->v_idx;
        v_is_leader := (v_idx = 0);
        v_qr_identity := gen_random_uuid();
        v_manual_token := v_token_prefix || '-' || upper(substr(md5(v_qr_identity::text || clock_timestamp()::text || v_idx::text), 1, 8));

        IF v_is_leader THEN
            v_member_name := COALESCE(NULLIF(trim(v_leader_profile.full_name), ''), trim(COALESCE(v_m->>'name', 'Team Leader')));
            v_member_roll := v_auth_leader_roll;
        ELSE
            v_member_name := trim(COALESCE(v_m->>'name', 'Participant ' || (v_idx + 1)));
            v_member_roll := UPPER(trim(COALESCE(v_m->>'roll_number', '')));
        END IF;

        INSERT INTO public.team_members (
            team_id,
            registration_id,
            name,
            roll_number,
            college,
            department,
            year_of_study,
            email,
            phone,
            is_leader,
            manual_token,
            qr_code_hash,
            created_at
        ) VALUES (
            v_team_id,
            v_reg_id,
            v_member_name,
            v_member_roll,
            COALESCE(v_m->>'college', v_leader_profile.college),
            COALESCE(v_m->>'department', v_leader_profile.department),
            COALESCE((v_m->>'year_of_study')::integer, v_leader_profile.year_of_study),
            COALESCE(v_m->>'email', ''),
            COALESCE(v_m->>'phone', ''),
            v_is_leader,
            v_manual_token,
            v_qr_identity::text,
            NOW()
        );

        v_created_members := v_created_members || jsonb_build_object(
            'name', v_member_name,
            'roll_number', v_member_roll,
            'is_leader', v_is_leader,
            'manual_token', v_manual_token,
            'qr_identity', v_qr_identity
        );
    END LOOP;

    -- 17. Insert Uploaded Documents
    IF p_uploaded_documents IS NOT NULL AND jsonb_typeof(p_uploaded_documents) = 'array' THEN
        FOR v_doc IN SELECT * FROM jsonb_array_elements(p_uploaded_documents) LOOP
            IF length(trim(COALESCE(v_doc->>'storage_path', ''))) > 0 THEN
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
                    'REGISTRATION',
                    v_reg_id,
                    trim(v_doc->>'storage_path'),
                    COALESCE(v_doc->>'file_name', 'document.pdf'),
                    COALESCE(v_doc->>'mime_type', 'application/pdf'),
                    COALESCE((v_doc->>'size_bytes')::bigint, 0),
                    NOW()
                );
            END IF;
        END LOOP;
    END IF;

    -- 18. Insert Payment Record
    IF NOT v_is_free THEN
        INSERT INTO public.payments (
            registration_id,
            amount,
            currency,
            status,
            payment_method,
            transaction_id,
            created_at,
            updated_at
        ) VALUES (
            v_reg_id,
            v_fee,
            'INR',
            v_pay_status,
            v_pay_method,
            CASE WHEN v_is_cod THEN 'COD-' || upper(substr(md5(v_reg_id::text || clock_timestamp()::text), 1, 10)) ELSE v_pay_ref END,
            NOW(),
            NOW()
        )
        RETURNING * INTO v_payment;

        v_payment_json := jsonb_build_object(
            'id', v_payment.id,
            'amount', v_payment.amount,
            'status', v_payment.status,
            'payment_method', v_payment.payment_method,
            'transaction_id', v_payment.transaction_id
        );
    END IF;

    -- 19. Audit Logging
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
            'members_count', jsonb_array_length(p_team_members),
            'is_free', v_is_free,
            'fee_amount', v_fee,
            'payment_method', CASE WHEN v_is_free THEN 'FREE' ELSE v_pay_method END,
            'payment_status', CASE WHEN v_is_free THEN 'FREE' ELSE v_pay_status END
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'registration_id', v_reg_id,
        'team_id', v_team_id,
        'status', v_initial_status,
        'is_free', v_is_free,
        'fee', v_fee,
        'payment', v_payment_json,
        'members', v_created_members
    );
END;
$$;

REVOKE ALL ON FUNCTION public.student_register_atomic(UUID, VARCHAR, VARCHAR, JSONB, JSONB, VARCHAR, VARCHAR) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.student_register_atomic(UUID, VARCHAR, VARCHAR, JSONB, JSONB, VARCHAR, VARCHAR) TO authenticated;
