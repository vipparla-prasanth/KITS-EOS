-- ============================================================================
-- Migration 106: Admin Edit Student Details with Strict 3-Edit Limit
-- ============================================================================
-- 1. Adds admin_edit_count (with CHECK <= 3) and branch columns to public.student_profiles.
-- 2. Updates enforce_student_profile_update_rules() trigger to prevent student modification
--    of branch or admin_edit_count, and guarantees admin_edit_count cannot exceed 3.
-- 3. Creates authoritative RPC function public.admin_edit_student_profile(...)
--    - Enforces authenticated admin authorization.
--    - Enforces per-student 3-edit maximum (edits 1, 2, 3 allowed; 4+ blocked).
--    - Validates name, roll number (uniqueness), department, branch, other_department,
--      year of study (1..4), college, 10-digit mobile phone, and email (uniqueness).
--    - Atomically updates student_profiles and users/auth.users without changing ID.
--    - Increments admin_edit_count and records immutable audit log.
-- ============================================================================

-- 1. Add tracking and branch columns to public.student_profiles
ALTER TABLE public.student_profiles 
    ADD COLUMN IF NOT EXISTS admin_edit_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS branch VARCHAR(255) DEFAULT NULL;

-- Enforce maximum 3 edits at database constraint level
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_admin_edit_count'
    ) THEN
        ALTER TABLE public.student_profiles
            ADD CONSTRAINT check_admin_edit_count CHECK (admin_edit_count >= 0 AND admin_edit_count <= 3);
    END IF;
END $$;

-- 2. Update trigger to protect branch and admin_edit_count from student tampering
CREATE OR REPLACE FUNCTION public.enforce_student_profile_update_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_digits text;
BEGIN
    -- Administrative exemption via authoritative public.is_admin()
    IF public.is_admin() THEN
        -- Even for admins, ensure admin_edit_count cannot exceed 3
        IF NEW.admin_edit_count > 3 THEN
            RAISE EXCEPTION 'Maximum 3 edits have already been used for this student account.';
        END IF;
        RETURN NEW;
    END IF;

    -- RULE 0: Students cannot modify account_status, suspension info, or administrative edit tracking
    IF NEW.account_status IS DISTINCT FROM OLD.account_status OR
       NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason OR
       NEW.suspended_at IS DISTINCT FROM OLD.suspended_at OR
       NEW.suspended_by IS DISTINCT FROM OLD.suspended_by THEN
        RAISE EXCEPTION 'Account status and suspension metadata can only be modified by administrators.';
    END IF;

    IF NEW.admin_edit_count IS DISTINCT FROM OLD.admin_edit_count THEN
        RAISE EXCEPTION 'Administrative edit count cannot be modified by students.';
    END IF;

    -- RULE 1: Roll Number is permanently locked for students
    IF NEW.roll_number IS DISTINCT FROM OLD.roll_number THEN
        RAISE EXCEPTION 'Roll number is permanently assigned and cannot be changed by students.';
    END IF;

    -- RULE 2: Department & Branch are permanently locked for students
    IF NEW.department IS DISTINCT FROM OLD.department OR 
       NEW.other_department IS DISTINCT FROM OLD.other_department OR
       NEW.branch IS DISTINCT FROM OLD.branch THEN
        RAISE EXCEPTION 'Department and branch information cannot be modified by students.';
    END IF;

    -- RULE 3: College / Institution is permanently locked for students
    IF NEW.college IS DISTINCT FROM OLD.college THEN
        RAISE EXCEPTION 'College / Institution information cannot be modified by students.';
    END IF;

    -- RULE 4: Full Legal Name is ONE-TIME EDIT ONLY for students
    IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
        IF OLD.name_change_used = TRUE THEN
            RAISE EXCEPTION 'Your one-time legal name change has already been used.';
        END IF;
        NEW.name_change_used := TRUE;
    ELSE
        NEW.name_change_used := OLD.name_change_used;
    END IF;

    IF OLD.name_change_used = TRUE AND NEW.name_change_used = FALSE THEN
        NEW.name_change_used := TRUE;
    END IF;

    -- RULE 5: Year of Study validation (1, 2, 3, or 4)
    IF NEW.year_of_study NOT IN (1, 2, 3, 4) THEN
        RAISE EXCEPTION 'Year of study must be between 1 and 4.';
    END IF;

    -- RULE 6: Contact Number validation (10-digit Indian mobile)
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

-- 3. Authoritative RPC: admin_edit_student_profile
CREATE OR REPLACE FUNCTION public.admin_edit_student_profile(
    p_student_id UUID,
    p_full_name TEXT,
    p_roll_number TEXT,
    p_department TEXT,
    p_year_of_study INTEGER,
    p_college TEXT,
    p_phone TEXT,
    p_branch TEXT DEFAULT NULL,
    p_other_department TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
    v_actor_id UUID;
    v_profile RECORD;
    v_user RECORD;
    v_clean_name TEXT;
    v_clean_roll TEXT;
    v_clean_dept TEXT;
    v_clean_branch TEXT;
    v_clean_other_dept TEXT;
    v_clean_college TEXT;
    v_clean_email TEXT;
    v_phone_digits TEXT;
    v_new_edit_count INTEGER;
BEGIN
    -- 1. Verify Authenticated User
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- 2. Verify Authorized Admin Access
    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Access denied: Administrator privileges required.';
    END IF;

    -- 3. Verify Target Student Exists and Lock Row
    SELECT *
    INTO v_profile
    FROM public.student_profiles
    WHERE user_id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student profile not found for user ID %.', p_student_id;
    END IF;

    SELECT *
    INTO v_user
    FROM public.users
    WHERE id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User account not found for user ID %.', p_student_id;
    END IF;

    -- 4. Enforce 3-Edit Limit (Edit 1, 2, 3 allowed; Edit 4+ blocked)
    IF v_profile.admin_edit_count >= 3 THEN
        RAISE EXCEPTION 'Maximum 3 edits have already been used for this student account.';
    END IF;

    -- 5. Validate Input Details
    -- Full Name
    v_clean_name := trim(COALESCE(p_full_name, ''));
    IF length(v_clean_name) < 2 OR length(v_clean_name) > 255 THEN
        RAISE EXCEPTION 'Student full name must be between 2 and 255 characters.';
    END IF;

    -- Roll Number
    v_clean_roll := upper(trim(COALESCE(p_roll_number, '')));
    IF length(v_clean_roll) < 2 OR length(v_clean_roll) > 50 THEN
        RAISE EXCEPTION 'Roll number must be between 2 and 50 characters.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.student_profiles 
        WHERE upper(trim(roll_number)) = v_clean_roll 
          AND user_id != p_student_id
    ) THEN
        RAISE EXCEPTION 'Roll number % is already assigned to another student.', v_clean_roll;
    END IF;

    -- Department
    v_clean_dept := trim(COALESCE(p_department, ''));
    IF length(v_clean_dept) < 2 OR length(v_clean_dept) > 255 THEN
        RAISE EXCEPTION 'Department must be specified.';
    END IF;

    -- Branch
    v_clean_branch := trim(COALESCE(p_branch, ''));
    IF length(v_clean_branch) = 0 THEN
        v_clean_branch := NULL;
    END IF;

    -- Other Department
    IF v_clean_dept = 'OTHER' THEN
        v_clean_other_dept := trim(COALESCE(p_other_department, ''));
        IF length(v_clean_other_dept) < 2 THEN
            RAISE EXCEPTION 'Other department name must be specified when Department is OTHER.';
        END IF;
    ELSE
        v_clean_other_dept := NULL;
    END IF;

    -- Year of Study (1 to 4)
    IF p_year_of_study NOT IN (1, 2, 3, 4) THEN
        RAISE EXCEPTION 'Year of study must be between 1 and 4.';
    END IF;

    -- College / Institution
    v_clean_college := trim(COALESCE(p_college, ''));
    IF length(v_clean_college) < 2 OR length(v_clean_college) > 255 THEN
        RAISE EXCEPTION 'College / Institution name must be specified.';
    END IF;

    -- Contact Number (10-digit Indian Mobile)
    v_phone_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
    IF length(v_phone_digits) = 12 AND v_phone_digits LIKE '91%' THEN
        v_phone_digits := substr(v_phone_digits, 3);
    ELSIF length(v_phone_digits) = 11 AND v_phone_digits LIKE '0%' THEN
        v_phone_digits := substr(v_phone_digits, 2);
    END IF;

    IF length(v_phone_digits) != 10 OR v_phone_digits !~ '^[6-9]' THEN
        RAISE EXCEPTION 'Invalid contact number. Must be a valid 10-digit Indian mobile number starting with 6-9.';
    END IF;

    -- Email Address
    v_clean_email := lower(trim(COALESCE(p_email, v_user.email)));
    IF length(v_clean_email) < 5 OR v_clean_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RAISE EXCEPTION 'Invalid email address format.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.users 
        WHERE lower(trim(email)) = v_clean_email 
          AND id != p_student_id
    ) THEN
        RAISE EXCEPTION 'Email % is already in use by another account.', v_clean_email;
    END IF;

    IF EXISTS (
        SELECT 1 FROM auth.users 
        WHERE lower(trim(email)) = v_clean_email 
          AND id != p_student_id
    ) THEN
        RAISE EXCEPTION 'Email % is already registered in authentication system.', v_clean_email;
    END IF;

    -- 6. Atomically Increment Edit Count & Update Profile
    v_new_edit_count := v_profile.admin_edit_count + 1;

    UPDATE public.student_profiles
    SET full_name = v_clean_name,
        roll_number = v_clean_roll,
        department = v_clean_dept,
        branch = v_clean_branch,
        other_department = v_clean_other_dept,
        year_of_study = p_year_of_study,
        college = v_clean_college,
        phone = v_phone_digits,
        admin_edit_count = v_new_edit_count
    WHERE user_id = p_student_id;

    -- Update email in public.users and auth.users if changed
    IF v_clean_email != lower(trim(v_user.email)) THEN
        UPDATE public.users 
        SET email = v_clean_email, 
            updated_at = NOW() 
        WHERE id = p_student_id;

        UPDATE auth.users 
        SET email = v_clean_email,
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            updated_at = NOW()
        WHERE id = p_student_id;
    END IF;

    -- 7. Immutable Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_actor_id,
        'ADMIN_EDIT_STUDENT_PROFILE',
        'student_profiles',
        p_student_id,
        jsonb_build_object(
            'student_id', p_student_id,
            'edit_number', v_new_edit_count,
            'remaining_edits', 3 - v_new_edit_count,
            'old_values', jsonb_build_object(
                'full_name', v_profile.full_name,
                'roll_number', v_profile.roll_number,
                'department', v_profile.department,
                'branch', v_profile.branch,
                'other_department', v_profile.other_department,
                'year_of_study', v_profile.year_of_study,
                'college', v_profile.college,
                'phone', v_profile.phone,
                'email', v_user.email
            ),
            'new_values', jsonb_build_object(
                'full_name', v_clean_name,
                'roll_number', v_clean_roll,
                'department', v_clean_dept,
                'branch', v_clean_branch,
                'other_department', v_clean_other_dept,
                'year_of_study', p_year_of_study,
                'college', v_clean_college,
                'phone', v_phone_digits,
                'email', v_clean_email
            ),
            'performed_by', v_actor_id
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', format('Student profile updated successfully. (%s of 3 edits used)', v_new_edit_count),
        'edit_count', v_new_edit_count,
        'remaining_edits', 3 - v_new_edit_count,
        'student', jsonb_build_object(
            'user_id', p_student_id,
            'full_name', v_clean_name,
            'roll_number', v_clean_roll,
            'department', v_clean_dept,
            'branch', v_clean_branch,
            'other_department', v_clean_other_dept,
            'year_of_study', p_year_of_study,
            'college', v_clean_college,
            'phone', v_phone_digits,
            'admin_edit_count', v_new_edit_count,
            'email', v_clean_email
        )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_edit_student_profile(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_edit_student_profile(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
