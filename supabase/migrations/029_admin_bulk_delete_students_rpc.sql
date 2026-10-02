-- 029_admin_bulk_delete_students_rpc.sql

-- Create or replace admin_bulk_delete_students RPC
CREATE OR REPLACE FUNCTION public.admin_bulk_delete_students(
    p_student_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_email TEXT;
    v_target_id UUID;
    v_target_role user_role;
    v_target_email TEXT;
    v_target_name TEXT;
    v_deleted_count INT := 0;
    v_failed_count INT := 0;
    v_deleted_list JSONB := '[]'::jsonb;
    v_failed_list JSONB := '[]'::jsonb;
BEGIN
    -- 1. Verify caller authentication
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- 2. Verify admin privileges
    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Administrative privileges required to delete student accounts.';
    END IF;

    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;

    -- 3. Validate input
    IF p_student_ids IS NULL OR array_length(p_student_ids, 1) IS NULL OR array_length(p_student_ids, 1) = 0 THEN
        RAISE EXCEPTION 'No student IDs provided for deletion.';
    END IF;

    -- 4. Process each student account
    FOREACH v_target_id IN ARRAY p_student_ids LOOP
        BEGIN
            -- Check if user exists and is a STUDENT
            SELECT role, email INTO v_target_role, v_target_email
            FROM public.users
            WHERE id = v_target_id;

            IF NOT FOUND THEN
                v_failed_count := v_failed_count + 1;
                v_failed_list := v_failed_list || jsonb_build_object(
                    'id', v_target_id,
                    'reason', 'User not found in system.'
                );
            ELSIF v_target_role != 'STUDENT' THEN
                -- Prevent deletion of ADMIN or COORDINATOR accounts via this RPC
                v_failed_count := v_failed_count + 1;
                v_failed_list := v_failed_list || jsonb_build_object(
                    'id', v_target_id,
                    'reason', 'Cannot delete non-student accounts via student bulk delete.'
                );
            ELSE
                -- Get student profile name if available for audit trail
                SELECT full_name INTO v_target_name
                FROM public.student_profiles
                WHERE user_id = v_target_id;

                -- Delete from public.users (cascades student_profiles & notifications, sets nullable FKs to NULL on registrations, team_members, complaints)
                DELETE FROM public.users WHERE id = v_target_id;

                -- Delete from auth.users (removes login credential)
                DELETE FROM auth.users WHERE id = v_target_id;

                v_deleted_count := v_deleted_count + 1;
                v_deleted_list := v_deleted_list || jsonb_build_object(
                    'id', v_target_id,
                    'email', v_target_email,
                    'name', v_target_name
                );
            END IF;

        EXCEPTION WHEN OTHERS THEN
            v_failed_count := v_failed_count + 1;
            v_failed_list := v_failed_list || jsonb_build_object(
                'id', v_target_id,
                'reason', SQLERRM
            );
        END;
    END LOOP;

    -- 5. Record Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_actor_id,
        'ADMIN_BULK_DELETE_STUDENTS',
        'users',
        COALESCE(p_student_ids[1], v_actor_id),
        jsonb_build_object(
            'requested_count', array_length(p_student_ids, 1),
            'deleted_count', v_deleted_count,
            'failed_count', v_failed_count,
            'deleted_students', v_deleted_list,
            'failed_students', v_failed_list,
            'deleted_by', COALESCE(v_actor_email, v_actor_id::text)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'requested_count', array_length(p_student_ids, 1),
        'deleted_count', v_deleted_count,
        'failed_count', v_failed_count,
        'deleted_students', v_deleted_list,
        'failed_students', v_failed_list
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_bulk_delete_students(UUID[]) TO authenticated;
