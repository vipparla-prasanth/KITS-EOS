-- ============================================================================
-- Migration 043: Student Profile Field Permissions & One-Time Name Change Lock
-- ============================================================================
-- 1. Adds name_change_used tracking column to public.student_profiles.
-- 2. Authoritative BEFORE UPDATE trigger enforcing:
--    - Roll Number is permanently locked for students.
--    - Department & Other Department are permanently locked for students.
--    - College / Institution is permanently locked for students.
--    - Full Legal Name can be edited exactly once after creation.
--    - Year of Study remains editable (1 to 4).
--    - Contact Number (phone) remains editable with valid Indian mobile validation.
--    - Authoritative Admins (via public.is_admin()) are exempt from self-service restrictions.
-- ============================================================================

-- 1. Add name_change_used column
ALTER TABLE public.student_profiles
ADD COLUMN IF NOT EXISTS name_change_used BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Create trigger function in standard invoker context (no SECURITY DEFINER needed)
CREATE OR REPLACE FUNCTION public.enforce_student_profile_update_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_digits text;
BEGIN
    -- Check administrative exemption via existing authoritative public.is_admin()
    IF public.is_admin() THEN
        RETURN NEW;
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
$$;

-- 3. Attach BEFORE UPDATE trigger to student_profiles
DROP TRIGGER IF EXISTS trg_enforce_student_profile_update_rules ON public.student_profiles;
CREATE TRIGGER trg_enforce_student_profile_update_rules
    BEFORE UPDATE ON public.student_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_student_profile_update_rules();
