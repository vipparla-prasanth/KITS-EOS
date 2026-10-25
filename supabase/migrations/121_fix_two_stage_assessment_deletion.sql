-- ============================================================================
-- Migration: 121_fix_two_stage_assessment_deletion.sql
-- Description: Two-Stage Assessment Deletion & Archival Lifecycle:
--              Stage A: Safe archival for active assessments with student records.
--              Stage B: Permanent cascading deletion for archived assessments.
-- ============================================================================

-- 1. DATA REPAIR / CONSISTENCY
-- Synchronize status and is_deleted across existing assessment rows
UPDATE public.assessments
SET is_deleted = TRUE,
    deleted_at = COALESCE(deleted_at, timezone('utc'::text, now()))
WHERE status = 'ARCHIVED' AND is_deleted IS NOT TRUE;

UPDATE public.assessments
SET status = 'ARCHIVED'
WHERE is_deleted IS TRUE AND status != 'ARCHIVED';

-- 2. DROP PREVIOUS DELETE FUNCTION OVERLOADS
DROP FUNCTION IF EXISTS public.admin_delete_assessment(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.admin_delete_assessment(UUID);

-- 3. TWO-STAGE DELETION & ARCHIVAL RPC
CREATE OR REPLACE FUNCTION public.admin_delete_assessment(
    p_assessment_id UUID,
    p_force_permanent BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_asm RECORD;
    v_attempts_count INT := 0;
    v_certs_count INT := 0;
    v_is_already_archived BOOLEAN := FALSE;
BEGIN
    -- 1. Authorization: Only administrators can delete or archive assessments
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrative privileges required' USING ERRCODE = '42501';
    END IF;

    -- 2. Validate assessment exists
    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    -- 3. Count historical / student records
    SELECT count(*) INTO v_attempts_count 
    FROM public.assessment_attempts 
    WHERE assessment_id = p_assessment_id;

    SELECT count(*) INTO v_certs_count 
    FROM public.assessment_certificates 
    WHERE assessment_id = p_assessment_id;

    v_is_already_archived := (v_asm.status = 'ARCHIVED' OR v_asm.is_deleted = TRUE);

    -- ========================================================================
    -- STAGE B: PERMANENT DELETION
    -- If the assessment is already archived OR permanent deletion is forced:
    -- Permanently purge the assessment and all dependent records transactionally.
    -- ========================================================================
    IF v_is_already_archived OR p_force_permanent THEN
        -- Explicitly clean up all dependent children (FKs also CASCADE)
        DELETE FROM public.assessment_coordinator_assignments WHERE assessment_id = p_assessment_id;
        DELETE FROM public.assessment_live_events WHERE assessment_id = p_assessment_id;
        DELETE FROM public.assessment_leaderboard_events WHERE assessment_id = p_assessment_id;
        DELETE FROM public.assessment_certificates WHERE assessment_id = p_assessment_id;
        DELETE FROM public.assessment_attempts WHERE assessment_id = p_assessment_id;
        DELETE FROM public.assessment_questions WHERE assessment_id = p_assessment_id;
        DELETE FROM public.assessments WHERE id = p_assessment_id;

        -- Audit log entry
        INSERT INTO public.audit_logs (
            actor_id, action, entity_type, entity_id, metadata
        ) VALUES (
            auth.uid(),
            'ASSESSMENT_PERMANENTLY_DELETED',
            'assessments',
            p_assessment_id,
            jsonb_build_object(
                'title', v_asm.title,
                'previous_status', v_asm.status,
                'attempts_deleted', v_attempts_count,
                'certificates_deleted', v_certs_count,
                'was_archived', v_is_already_archived
            )
        );

        RETURN jsonb_build_object(
            'success', true,
            'action', 'PERMANENTLY_DELETED',
            'is_permanent', true,
            'attempts_count', v_attempts_count,
            'certificates_count', v_certs_count,
            'message', 'Assessment and all associated records have been permanently deleted.'
        );

    -- ========================================================================
    -- STAGE A: DELETE FROM NON-ARCHIVED ASSESSMENT
    -- ========================================================================
    ELSE
        -- If historical student records exist, safely archive
        IF v_attempts_count > 0 OR v_certs_count > 0 THEN
            UPDATE public.assessments
            SET status = 'ARCHIVED',
                is_deleted = TRUE,
                deleted_at = timezone('utc'::text, now()),
                updated_at = timezone('utc'::text, now())
            WHERE id = p_assessment_id;

            INSERT INTO public.audit_logs (
                actor_id, action, entity_type, entity_id, metadata
            ) VALUES (
                auth.uid(),
                'ASSESSMENT_ARCHIVED_PROTECTED_DATA',
                'assessments',
                p_assessment_id,
                jsonb_build_object(
                    'title', v_asm.title,
                    'attempts_count', v_attempts_count,
                    'certificates_count', v_certs_count,
                    'reason', 'Assessment has student records. Safely archived to preserve records before potential permanent deletion.'
                )
            );

            RETURN jsonb_build_object(
                'success', true,
                'action', 'ARCHIVED',
                'is_permanent', false,
                'attempts_count', v_attempts_count,
                'certificates_count', v_certs_count,
                'message', 'Assessment contained student records and has been safely archived.'
            );
        ELSE
            -- No historical records exist: safe to permanently delete directly
            DELETE FROM public.assessment_coordinator_assignments WHERE assessment_id = p_assessment_id;
            DELETE FROM public.assessment_live_events WHERE assessment_id = p_assessment_id;
            DELETE FROM public.assessment_leaderboard_events WHERE assessment_id = p_assessment_id;
            DELETE FROM public.assessment_questions WHERE assessment_id = p_assessment_id;
            DELETE FROM public.assessments WHERE id = p_assessment_id;

            INSERT INTO public.audit_logs (
                actor_id, action, entity_type, entity_id, metadata
            ) VALUES (
                auth.uid(),
                'ASSESSMENT_PERMANENTLY_DELETED',
                'assessments',
                p_assessment_id,
                jsonb_build_object(
                    'title', v_asm.title,
                    'status', v_asm.status,
                    'reason', 'No student records existed.'
                )
            );

            RETURN jsonb_build_object(
                'success', true,
                'action', 'PERMANENTLY_DELETED',
                'is_permanent', true,
                'attempts_count', 0,
                'certificates_count', 0,
                'message', 'Assessment had no student records and was permanently deleted.'
            );
        END IF;
    END IF;
EXCEPTION
    WHEN foreign_key_violation THEN
        RETURN jsonb_build_object(
            'success', false,
            'action', 'BLOCKED',
            'is_permanent', false,
            'message', 'Permanent deletion blocked by relational integrity constraints. Reason: ' || SQLERRM
        );
    WHEN OTHERS THEN
        RAISE;
END;
$$;

-- 4. PERMISSIONS
REVOKE ALL ON FUNCTION public.admin_delete_assessment(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_assessment(UUID, BOOLEAN) TO authenticated, service_role;
