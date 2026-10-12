-- ============================================================================
-- Migration 113: Orphan Student Account Recovery & Admin Directory Visibility
-- ============================================================================
-- 1. Creates public.student_complete_profile RPC
--    - Enables authenticated students with incomplete accounts (auth.users +
--      public.users present, but public.student_profiles missing) to safely
--      complete their academic onboarding.
--    - Enforces auth.uid() identity binding (cannot be spoofed from client).
--    - Validates all student academic fields, normalization, and roll uniqueness.
--    - Handles concurrent duplicate roll attempts with graceful error codes.
--    - Logs privacy acknowledgement in public.audit_logs.
-- 2. Creates public.admin_get_students_directory RPC
--    - Authoritatively queries public.users LEFT JOIN public.student_profiles.
--    - Requires public.is_admin() authorization.
--    - Distinguishes complete active students from incomplete/profile-pending accounts.
--    - Enables admin search and filtering for both completed and incomplete accounts.
-- ============================================================================

-- 1. Secure RPC for completing an incomplete student profile
CREATE OR REPLACE FUNCTION public.student_complete_profile(
    p_full_name TEXT,
    p_roll_number TEXT,
    p_college TEXT,
    p_department TEXT,
    p_other_department TEXT DEFAULT NULL,
    p_year_of_study INTEGER DEFAULT 1,
    p_phone TEXT DEFAULT '',
    p_privacy_acknowledged BOOLEAN DEFAULT true,
    p_privacy_notice_version TEXT DEFAULT '1.0'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_clean_name TEXT;
    v_clean_roll TEXT;
    v_clean_college TEXT;
    v_clean_dept TEXT;
    v_clean_other_dept TEXT;
    v_clean_phone TEXT;
    v_existing_profile_user UUID;
BEGIN
    -- 1. Identity Verification
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'UNAUTHORIZED',
            'message', 'Authentication required: please sign in first.'
        );
    END IF;

    -- 2. Verify account in public.users
    SELECT role, status INTO v_user_role, v_user_status
    FROM public.users
    WHERE id = v_uid;

    IF v_user_role IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ACCOUNT_NOT_FOUND',
            'message', 'User account not found.'
        );
    END IF;

    IF v_user_status <> 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ACCOUNT_INACTIVE',
            'message', 'Account is not in active status.'
        );
    END IF;

    -- 3. Check if profile already exists for this user
    IF EXISTS (SELECT 1 FROM public.student_profiles WHERE user_id = v_uid) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'PROFILE_ALREADY_EXISTS',
            'message', 'A student profile is already completed for this account.'
        );
    END IF;

    -- 4. Clean & Normalize Inputs
    v_clean_name := trim(COALESCE(p_full_name, ''));
    v_clean_roll := UPPER(trim(COALESCE(p_roll_number, '')));
    v_clean_college := trim(COALESCE(p_college, 'KITS Akshar Institute of Technology'));
    v_clean_dept := trim(COALESCE(p_department, ''));
    v_clean_phone := trim(COALESCE(p_phone, ''));
    v_clean_other_dept := CASE 
        WHEN v_clean_dept = 'OTHER' THEN trim(COALESCE(p_other_department, ''))
        ELSE NULL 
    END;

    -- 5. Field Validations
    IF length(v_clean_name) < 2 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_NAME',
            'message', 'Full legal name is required (at least 2 characters).'
        );
    END IF;

    IF length(v_clean_roll) < 2 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_ROLL_NUMBER',
            'message', 'Student roll number is required.'
        );
    END IF;

    IF length(v_clean_dept) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_DEPARTMENT',
            'message', 'Department selection is required.'
        );
    END IF;

    IF v_clean_dept = 'OTHER' AND (v_clean_other_dept IS NULL OR length(v_clean_other_dept) = 0) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_OTHER_DEPARTMENT',
            'message', 'Please specify your department name.'
        );
    END IF;

    IF p_year_of_study NOT IN (1, 2, 3, 4) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_YEAR',
            'message', 'Year of study must be 1, 2, 3, or 4.'
        );
    END IF;

    IF length(v_clean_phone) < 10 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_PHONE',
            'message', 'A valid 10-digit mobile number is required.'
        );
    END IF;

    IF length(v_clean_college) = 0 THEN
        v_clean_college := 'KITS Akshar Institute of Technology';
    END IF;

    -- 6. Check Duplicate Roll Number
    SELECT user_id INTO v_existing_profile_user
    FROM public.student_profiles
    WHERE roll_number = v_clean_roll;

    IF v_existing_profile_user IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'DUPLICATE_ROLL_NUMBER',
            'message', format('An account with Roll Number "%s" already exists.', v_clean_roll)
        );
    END IF;

    -- 7. Insert student_profiles with concurrency safety
    BEGIN
        INSERT INTO public.student_profiles (
            user_id,
            full_name,
            roll_number,
            college,
            department,
            other_department,
            year_of_study,
            phone,
            privacy_notice_version,
            privacy_acknowledged_at,
            account_status,
            admin_edit_count
        ) VALUES (
            v_uid,
            v_clean_name,
            v_clean_roll,
            v_clean_college,
            v_clean_dept,
            v_clean_other_dept,
            p_year_of_study,
            v_clean_phone,
            CASE WHEN p_privacy_acknowledged THEN COALESCE(p_privacy_notice_version, '1.0') ELSE NULL END,
            CASE WHEN p_privacy_acknowledged THEN clock_timestamp() ELSE NULL END,
            'ACTIVE',
            0
        );
    EXCEPTION 
        WHEN unique_violation THEN
            -- Handle potential race condition on roll_number or user_id
            RETURN jsonb_build_object(
                'success', false,
                'code', 'DUPLICATE_ROLL_NUMBER',
                'message', format('An account with Roll Number "%s" already exists.', v_clean_roll)
            );
    END;

    -- 8. Privacy Audit Log (if acknowledged)
    IF p_privacy_acknowledged THEN
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES (
            v_uid,
            'PRIVACY_NOTICE_ACKNOWLEDGED',
            'student_profiles',
            v_uid,
            jsonb_build_object(
                'version', COALESCE(p_privacy_notice_version, '1.0'),
                'acknowledged_at', clock_timestamp(),
                'context', 'STUDENT_RECOVERY'
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Student profile completed successfully.',
        'profile', jsonb_build_object(
            'user_id', v_uid,
            'full_name', v_clean_name,
            'roll_number', v_clean_roll,
            'college', v_clean_college,
            'department', v_clean_dept,
            'other_department', v_clean_other_dept,
            'year_of_study', p_year_of_study,
            'phone', v_clean_phone,
            'account_status', 'ACTIVE'
        )
    );
END;
$$;

-- 2. Authoritative Admin Student Directory RPC
CREATE OR REPLACE FUNCTION public.admin_get_students_directory()
RETURNS TABLE (
    user_id UUID,
    email VARCHAR(255),
    role public.user_role,
    user_status public.user_status,
    user_created_at TIMESTAMPTZ,
    full_name VARCHAR(255),
    roll_number VARCHAR(255),
    college VARCHAR(255),
    department VARCHAR(255),
    other_department VARCHAR(255),
    branch VARCHAR(255),
    year_of_study INTEGER,
    phone VARCHAR(255),
    admin_edit_count INTEGER,
    account_status VARCHAR(255),
    suspension_reason TEXT,
    suspended_at TIMESTAMPTZ,
    suspended_by UUID,
    is_profile_complete BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    -- Verify admin authorization
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrative privileges required';
    END IF;

    RETURN QUERY
    SELECT 
        u.id AS user_id,
        u.email,
        u.role,
        u.status AS user_status,
        u.created_at AS user_created_at,
        sp.full_name,
        sp.roll_number,
        sp.college,
        sp.department,
        sp.other_department,
        sp.branch,
        sp.year_of_study,
        sp.phone,
        COALESCE(sp.admin_edit_count, 0) AS admin_edit_count,
        COALESCE(sp.account_status, CASE WHEN sp.user_id IS NULL THEN 'INCOMPLETE' ELSE 'ACTIVE' END) AS account_status,
        sp.suspension_reason,
        sp.suspended_at,
        sp.suspended_by,
        (sp.user_id IS NOT NULL) AS is_profile_complete
    FROM public.users u
    LEFT JOIN public.student_profiles sp ON sp.user_id = u.id
    WHERE u.role = 'STUDENT' OR sp.user_id IS NOT NULL
    ORDER BY 
        COALESCE(NULLIF(trim(sp.full_name), ''), u.email) ASC;
END;
$$;

-- 3. Grants and permissions
REVOKE ALL ON FUNCTION public.student_complete_profile FROM public;
GRANT EXECUTE ON FUNCTION public.student_complete_profile TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_complete_profile TO service_role;

REVOKE ALL ON FUNCTION public.admin_get_students_directory FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_students_directory TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_students_directory TO service_role;
