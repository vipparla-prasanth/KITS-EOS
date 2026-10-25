-- Migration 122: Assessment Attempt Deletion, Certificate Revocation Safeguards, and Coordinator Telemetry Fixes
-- ============================================================================
-- 1. coordinator_assessment_login:
--    - Fix PL/pgSQL RECORD IS NOT NULL bug (v_assignment.id IS NOT NULL)
--    - Ensure assigned_assessment is correctly resolved for any coordinator type (FACULTY, etc.)
-- 2. get_assessment_attempts_scoped:
--    - Use verify_assessment_coordinator_access to authenticate coordinator or admin
--    - Include certificate protection status (has_active_certificate, certificate_id, certificate_code, revoked)
-- 3. admin_revoke_assessment_certificate:
--    - Require admin privileges
--    - Atomically revoke official certificate with audit log
-- 4. admin_revoke_assessment_attempt_certificate:
--    - Helper to revoke certificate given attempt_id
-- 5. admin_delete_assessment_attempts:
--    - Transactional individual and bulk deletion of student attempts
--    - Certificate safeguard: strictly blocks deletion if active (unrevoked) certificate exists
--    - Deletes dependent answers, violations, revoked certificates, and attempts
--    - Logs audit trail and returns structured response

-- ============================================================================
-- 1. FIXED COORDINATOR ASSESSMENT LOGIN RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.coordinator_assessment_login(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_clean_username TEXT;
    v_coord RECORD;
    v_input_hash TEXT;
    v_raw_token TEXT;
    v_token_hash TEXT;
    v_expires_at TIMESTAMPTZ;
    v_assignment RECORD;
    v_asm RECORD;
    v_event_assignments JSONB := '[]'::jsonb;
    v_event_count INT := 0;
BEGIN
    v_clean_username := lower(trim(p_username));

    SELECT * INTO v_coord
    FROM public.coordinators
    WHERE lower(username) = v_clean_username;

    IF v_coord IS NULL THEN
        PERFORM pg_sleep(0.25);
        RAISE EXCEPTION 'Invalid credentials. Please check your username and password.' USING ERRCODE = '42501';
    END IF;

    IF v_coord.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Coordinator account is inactive or suspended' USING ERRCODE = '42501';
    END IF;

    v_input_hash := encode(extensions.digest(trim(p_password), 'sha256'), 'hex');

    IF v_coord.password_hash != v_input_hash THEN
        IF v_coord.password_hash LIKE '$2%' THEN
            IF extensions.crypt(trim(p_password), v_coord.password_hash) != v_coord.password_hash THEN
                PERFORM pg_sleep(0.25);
                RAISE EXCEPTION 'Invalid credentials. Please check your username and password.' USING ERRCODE = '42501';
            END IF;
        ELSE
            PERFORM pg_sleep(0.25);
            RAISE EXCEPTION 'Invalid credentials. Please check your username and password.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_raw_token := 'ctk_' || encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text || v_coord.id::text, 'sha256'), 'hex');
    v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');
    v_expires_at := now() + interval '1 hour';

    INSERT INTO public.coordinator_sessions (
        coordinator_id,
        token_hash,
        expires_at
    ) VALUES (
        v_coord.id,
        v_token_hash,
        v_expires_at
    );

    -- Find assessment assignment
    SELECT * INTO v_assignment
    FROM public.assessment_coordinator_assignments
    WHERE coordinator_id = v_coord.id
    ORDER BY assigned_at DESC
    LIMIT 1;

    -- Note: Check v_assignment.id IS NOT NULL, NOT v_assignment IS NOT NULL (composite type issue)
    IF v_assignment.id IS NOT NULL THEN
        SELECT id, title, status, duration_minutes, start_time, end_time 
        INTO v_asm 
        FROM public.assessments 
        WHERE id = v_assignment.assessment_id;
    ELSE
        SELECT id, title, status, duration_minutes, start_time, end_time 
        INTO v_asm 
        FROM public.assessments 
        WHERE coordinator_id = v_coord.id
        ORDER BY created_at DESC
        LIMIT 1;
    END IF;

    -- Find active event assignments
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', ca.id,
                'sub_event_id', ca.sub_event_id,
                'sub_events', jsonb_build_object(
                    'id', se.id,
                    'name', se.name,
                    'status', se.status
                )
            )
        ), '[]'::jsonb),
        COUNT(ca.id)
    INTO v_event_assignments, v_event_count
    FROM public.coordinator_assignments ca
    JOIN public.sub_events se ON se.id = ca.sub_event_id
    WHERE ca.coordinator_id = v_coord.id
      AND se.status = 'ACTIVE';

    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_coord.id,
        'COORDINATOR_LOGIN',
        'coordinators',
        v_coord.id,
        jsonb_build_object(
            'username', v_coord.username,
            'coordinator_type', v_coord.coordinator_type,
            'assigned_assessment_id', v_asm.id,
            'event_assignments_count', v_event_count
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_raw_token,
        'role', CASE 
            WHEN v_coord.coordinator_type = 'PAYMENT_MANAGER' THEN 'PAYMENT_MANAGER'
            WHEN v_coord.coordinator_type = 'ASSESSMENT_COORDINATOR' THEN 'ASSESSMENT_COORDINATOR'
            WHEN v_asm.id IS NOT NULL AND v_event_count = 0 THEN 'ASSESSMENT_COORDINATOR'
            ELSE 'COORDINATOR'
        END,
        'coordinator', jsonb_build_object(
            'id', v_coord.id,
            'username', v_coord.username,
            'display_name', v_coord.display_name,
            'phone_number', v_coord.phone_number,
            'coordinator_type', v_coord.coordinator_type,
            'status', v_coord.status,
            'assigned_assessment', CASE WHEN v_asm.id IS NOT NULL THEN jsonb_build_object(
                'id', v_asm.id,
                'title', v_asm.title,
                'status', v_asm.status,
                'duration_minutes', v_asm.duration_minutes,
                'start_time', v_asm.start_time,
                'end_time', v_asm.end_time
            ) ELSE NULL END
        ),
        'access_state', CASE 
            WHEN v_coord.coordinator_type = 'PAYMENT_MANAGER' OR v_coord.coordinator_type = 'ASSESSMENT_COORDINATOR' OR v_asm.id IS NOT NULL OR v_event_count > 0 THEN 'AUTHORIZED'
            ELSE 'NO_ASSIGNMENTS'
        END,
        'assignment_state', CASE 
            WHEN v_coord.coordinator_type = 'PAYMENT_MANAGER' THEN 'PAYMENT_MANAGER'
            WHEN v_asm.id IS NOT NULL AND v_event_count > 0 THEN 'DUAL_ASSIGNMENTS'
            WHEN v_coord.coordinator_type = 'ASSESSMENT_COORDINATOR' OR (v_asm.id IS NOT NULL AND v_event_count = 0) THEN 'ASSESSMENT_COORDINATOR'
            WHEN v_event_count > 0 THEN 'ACTIVE_ASSIGNMENTS'
            ELSE 'NO_ACTIVE_ASSIGNMENTS'
        END,
        'active_assignments_count', v_event_count,
        'assignments', v_event_assignments,
        'assigned_assessment', CASE WHEN v_asm.id IS NOT NULL THEN jsonb_build_object(
            'id', v_asm.id,
            'title', v_asm.title,
            'status', v_asm.status,
            'duration_minutes', v_asm.duration_minutes,
            'start_time', v_asm.start_time,
            'end_time', v_asm.end_time
        ) ELSE NULL END,
        'expires_at', v_expires_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.coordinator_assessment_login(TEXT, TEXT) TO anon, authenticated, service_role;


-- ============================================================================
-- 2. ENHANCED SCOPED ATTEMPTS RPC WITH CERTIFICATE STATUS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_assessment_attempts_scoped(
    p_assessment_id UUID,
    p_coordinator_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_caller_id UUID;
    v_asm RECORD;
    v_result JSONB;
BEGIN
    -- Authoritative permission verification (Admin or assigned Coordinator)
    v_caller_id := public.verify_assessment_coordinator_access(p_assessment_id, p_coordinator_token);

    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'assessment_id', a.assessment_id,
            'student_id', a.student_id,
            'student_name', COALESCE(st.full_name, 'Candidate ' || substr(a.student_id::text, 1, 8)),
            'roll_number', COALESCE(st.roll_number, 'N/A'),
            'college_name', COALESCE(st.college, 'N/A'),
            'department', st.department,
            'year_of_study', st.year_of_study,
            'status', a.status,
            'started_at', a.started_at,
            'deadline', a.deadline,
            'submitted_at', a.submitted_at,
            'score', a.score,
            'correct_answers_count', a.correct_answers_count,
            'strike_count', a.strike_count,
            'created_at', a.created_at,
            -- Certificate Protection Status
            'has_active_certificate', (cert.id IS NOT NULL AND cert.revoked IS FALSE),
            'certificate_id', cert.id,
            'certificate_code', cert.certificate_code,
            'certificate_revoked', COALESCE(cert.revoked, false),
            'certificate_revoked_at', cert.revoked_at,
            'certificate_revocation_reason', cert.revocation_reason,
            'award_type', cert.award_type,
            'rank', cert.rank
        ) ORDER BY a.started_at DESC
    ), '[]'::jsonb) INTO v_result
    FROM public.assessment_attempts a
    LEFT JOIN public.student_profiles st ON st.user_id = a.student_id
    LEFT JOIN public.assessment_certificates cert ON cert.attempt_id = a.id
    WHERE a.assessment_id = p_assessment_id;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_assessment_attempts_scoped(UUID, TEXT) TO anon, authenticated, service_role;


-- ============================================================================
-- 3. CERTIFICATE REVOCATION RPC (REQUIRED BEFORE ATTEMPT DELETION)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_revoke_assessment_certificate(
    p_certificate_id UUID,
    p_reason TEXT DEFAULT 'Revoked by authorized administrator prior to attempt record remediation'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
    v_cert RECORD;
    v_clean_reason TEXT;
BEGIN
    -- Strict Admin Authorization
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'UNAUTHORIZED',
            'message', 'Administrative privileges required to revoke certificates.'
        );
    END IF;

    v_clean_reason := COALESCE(trim(p_reason), 'Administrative revocation');

    SELECT * INTO v_cert 
    FROM public.assessment_certificates 
    WHERE id = p_certificate_id;

    IF v_cert IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'CERTIFICATE_NOT_FOUND',
            'message', 'Assessment certificate not found.'
        );
    END IF;

    -- Idempotent check
    IF v_cert.revoked IS TRUE THEN
        RETURN jsonb_build_object(
            'success', true,
            'code', 'ALREADY_REVOKED',
            'certificate_id', p_certificate_id,
            'message', 'Certificate was already revoked.'
        );
    END IF;

    -- Mark certificate revoked
    UPDATE public.assessment_certificates
    SET revoked = TRUE,
        revoked_at = timezone('utc'::text, now()),
        revocation_reason = v_clean_reason,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_certificate_id;

    -- Audit log
    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        auth.uid(),
        'ASSESSMENT_CERTIFICATE_REVOKED',
        'assessment_certificates',
        p_certificate_id,
        jsonb_build_object(
            'assessment_id', v_cert.assessment_id,
            'student_id', v_cert.student_id,
            'attempt_id', v_cert.attempt_id,
            'certificate_code', v_cert.certificate_code,
            'award_type', v_cert.award_type,
            'rank', v_cert.rank,
            'reason', v_clean_reason,
            'revoked_at', now()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'code', 'CERTIFICATE_REVOKED',
        'certificate_id', p_certificate_id,
        'certificate_code', v_cert.certificate_code,
        'attempt_id', v_cert.attempt_id,
        'message', format('Certificate %s successfully revoked. The associated attempt is now eligible for deletion.', v_cert.certificate_code)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_revoke_assessment_certificate(UUID, TEXT) TO authenticated, service_role;


-- ============================================================================
-- 4. REVOKE CERTIFICATE BY ATTEMPT ID HELPER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_revoke_assessment_attempt_certificate(
    p_attempt_id UUID,
    p_reason TEXT DEFAULT 'Revoked by authorized administrator prior to attempt deletion'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
    v_cert_id UUID;
BEGIN
    SELECT id INTO v_cert_id
    FROM public.assessment_certificates
    WHERE attempt_id = p_attempt_id
      AND revoked IS FALSE
    LIMIT 1;

    IF v_cert_id IS NULL THEN
        -- Check if already revoked
        IF EXISTS (SELECT 1 FROM public.assessment_certificates WHERE attempt_id = p_attempt_id) THEN
            RETURN jsonb_build_object(
                'success', true,
                'code', 'ALREADY_REVOKED',
                'message', 'Certificate for this attempt is already revoked.'
            );
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'code', 'NO_CERTIFICATE',
            'message', 'No active certificate found for this attempt.'
        );
    END IF;

    RETURN public.admin_revoke_assessment_certificate(v_cert_id, p_reason);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_revoke_assessment_attempt_certificate(UUID, TEXT) TO authenticated, service_role;


-- ============================================================================
-- 5. TRANSACTIONAL ASSESSMENT ATTEMPTS DELETION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_assessment_attempts(
    p_assessment_id UUID,
    p_attempt_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
    v_asm RECORD;
    v_protected_attempts JSONB;
    v_foreign_attempts_count INT := 0;
    v_deleted_count INT := 0;
    v_distinct_ids UUID[];
BEGIN
    -- 1. Administrative Authorization Guard
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'UNAUTHORIZED',
            'message', 'Administrative privileges required to delete student assessment records.'
        );
    END IF;

    -- 2. Validate Assessment Existence
    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id;
    IF v_asm IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ASSESSMENT_NOT_FOUND',
            'message', 'Target assessment not found.'
        );
    END IF;

    -- 3. Validate Inputs
    IF p_attempt_ids IS NULL OR array_length(p_attempt_ids, 1) IS NULL OR array_length(p_attempt_ids, 1) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'EMPTY_ATTEMPT_LIST',
            'message', 'No attempt IDs specified for deletion.'
        );
    END IF;

    -- Deduplicate array
    SELECT array_agg(DISTINCT id) INTO v_distinct_ids
    FROM unnest(p_attempt_ids) AS id;

    -- 4. Verify all attempts belong strictly to the specified assessment
    SELECT count(*) INTO v_foreign_attempts_count
    FROM public.assessment_attempts
    WHERE id = ANY(v_distinct_ids)
      AND assessment_id != p_assessment_id;

    IF v_foreign_attempts_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'FOREIGN_ASSESSMENT_ATTEMPTS',
            'message', format('Validation error: %s attempt(s) do not belong to assessment "%s". Cross-assessment deletion rejected.', v_foreign_attempts_count, v_asm.title)
        );
    END IF;

    -- 5. Revalidate Certificate and Award Protection
    -- Strictly protect attempts associated with active (unrevoked) certificates!
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'attempt_id', ac.attempt_id,
            'certificate_code', ac.certificate_code,
            'award_type', ac.award_type,
            'rank', ac.rank,
            'student_id', ac.student_id
        )
    ), '[]'::jsonb) INTO v_protected_attempts
    FROM public.assessment_certificates ac
    WHERE ac.attempt_id = ANY(v_distinct_ids)
      AND ac.revoked IS FALSE;

    IF jsonb_array_length(v_protected_attempts) > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'PROTECTED_BY_ACTIVE_CERTIFICATE',
            'message', format(
                'Deletion aborted: %s selected attempt(s) have active official certificates. To preserve academic integrity, an authorized administrator must first revoke the certificate(s) before deleting the attempt(s).',
                jsonb_array_length(v_protected_attempts)
            ),
            'protected_attempts', v_protected_attempts
        );
    END IF;

    -- 6. Safe Cascading Execution inside Transaction
    -- A. Remove answers
    EXECUTE 'DELETE FROM public.assessment_attempt_answers WHERE attempt_id = ANY($1)'
    USING v_distinct_ids;

    -- B. Remove violations
    EXECUTE 'DELETE FROM public.assessment_attempt_violations WHERE attempt_id = ANY($1)'
    USING v_distinct_ids;

    -- C. Remove any revoked certificate records for these attempts
    EXECUTE 'DELETE FROM public.assessment_certificates WHERE attempt_id = ANY($1)'
    USING v_distinct_ids;

    -- D. Delete attempts
    EXECUTE 'DELETE FROM public.assessment_attempts WHERE id = ANY($1) AND assessment_id = $2'
    USING v_distinct_ids, p_assessment_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    -- 7. Audit Log
    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        auth.uid(),
        'ASSESSMENT_ATTEMPTS_DELETED',
        'assessments',
        p_assessment_id,
        jsonb_build_object(
            'assessment_title', v_asm.title,
            'requested_count', array_length(v_distinct_ids, 1),
            'deleted_count', v_deleted_count,
            'attempt_ids', v_distinct_ids
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'code', 'ATTEMPTS_DELETED',
        'deleted_count', v_deleted_count,
        'message', format('Successfully deleted %s assessment attempt record(s).', v_deleted_count)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_assessment_attempts(UUID, UUID[]) TO authenticated, service_role;


-- ============================================================================
-- 5. RECONCILED VALIDATE_COORDINATOR_SESSION WITH DUAL-ASSIGNMENT RESOLUTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_coordinator_session(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_token_hash TEXT;
    v_session public.coordinator_sessions%ROWTYPE;
    v_coord public.coordinators%ROWTYPE;
    v_assignments JSONB;
    v_active_count INT;
    v_assigned_assessment JSONB := NULL;
    v_asm RECORD;
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Session token is required',
            'access_state', 'INVALID_SESSION'
        );
    END IF;

    v_token_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

    SELECT * INTO v_session
    FROM public.coordinator_sessions
    WHERE token_hash = v_token_hash;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid session token',
            'access_state', 'INVALID_SESSION'
        );
    END IF;

    IF v_session.expires_at <= now() OR v_session.created_at <= (now() - interval '1 hour') THEN
        DELETE FROM public.coordinator_sessions WHERE token_hash = v_token_hash;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Session has expired. Please log in again.',
            'access_state', 'INVALID_SESSION'
        );
    END IF;

    SELECT * INTO v_coord
    FROM public.coordinators
    WHERE id = v_session.coordinator_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Coordinator account not found',
            'access_state', 'INVALID_SESSION'
        );
    END IF;

    IF v_coord.status != 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Coordinator account is inactive or suspended',
            'access_state', 'INACTIVE_OR_SUSPENDED'
        );
    END IF;

    UPDATE public.coordinator_sessions
    SET last_active_at = now()
    WHERE token_hash = v_token_hash;

    -- Check for assessment assignment
    SELECT a.* INTO v_asm
    FROM public.assessment_coordinator_assignments aca
    JOIN public.assessments a ON a.id = aca.assessment_id
    WHERE aca.coordinator_id = v_coord.id
    ORDER BY aca.assigned_at DESC
    LIMIT 1;

    IF v_asm.id IS NULL THEN
        SELECT * INTO v_asm
        FROM public.assessments
        WHERE coordinator_id = v_coord.id
        ORDER BY created_at DESC
        LIMIT 1;
    END IF;

    IF v_asm.id IS NOT NULL THEN
        v_assigned_assessment := jsonb_build_object(
            'id', v_asm.id,
            'title', v_asm.title,
            'status', v_asm.status,
            'duration_minutes', v_asm.duration_minutes,
            'start_time', v_asm.start_time,
            'end_time', v_asm.end_time
        );
    END IF;

    -- Sub-events assignments
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
                'status', se.status,
                'manual_status', se.manual_status,
                'status_mode', se.status_mode,
                'results_locked', se.results_locked,
                'event_id', se.event_id,
                'category_id', se.category_id,
                'effective_status', CASE
                    WHEN COALESCE(ev.status::text, cat_ev.status::text) = 'COMPLETED' THEN 'COMPLETED'
                    WHEN COALESCE(ev.manual_status, cat_ev.manual_status) = 'COMPLETED' THEN 'COMPLETED'
                    WHEN se.status::text = 'COMPLETED' THEN 'COMPLETED'
                    WHEN se.manual_status = 'COMPLETED' THEN 'COMPLETED'
                    WHEN now() < se.start_time THEN 'UPCOMING'
                    WHEN now() >= se.start_time AND now() <= se.end_time THEN 'ONGOING'
                    ELSE 'COMPLETED'
                END
            )
        )
    ), '[]'::jsonb),
    COUNT(ca.id)
    INTO v_assignments, v_active_count
    FROM public.coordinator_assignments ca
    JOIN public.sub_events se ON se.id = ca.sub_event_id
    LEFT JOIN public.events ev ON ev.id = se.event_id
    LEFT JOIN public.categories cat ON cat.id = se.category_id
    LEFT JOIN events cat_ev ON cat_ev.id = cat.event_id
    WHERE ca.coordinator_id = v_coord.id
      AND se.status::text = 'ACTIVE'
      AND COALESCE(ev.status::text, cat_ev.status::text) = 'ACTIVE';

    IF v_coord.coordinator_type = 'PAYMENT_MANAGER' OR v_coord.coordinator_type = 'ASSESSMENT_COORDINATOR' OR v_assigned_assessment IS NOT NULL OR v_active_count > 0 THEN
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
            'assigned_assessment', v_assigned_assessment,
            'state_detail', CASE 
                WHEN v_assigned_assessment IS NOT NULL AND v_active_count > 0 THEN 'DUAL_ASSIGNMENT'
                WHEN v_assigned_assessment IS NOT NULL THEN 'ACTIVE_ASSESSMENT_ASSIGNMENT'
                WHEN v_active_count > 0 THEN 'ACTIVE_ASSIGNMENTS'
                ELSE 'AUTHORIZED_COORDINATOR'
            END,
            'expires_at', v_session.expires_at
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
            'assigned_assessment', NULL,
            'state_detail', 'NO_ACTIVE_ASSIGNMENTS',
            'expires_at', v_session.expires_at
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coordinator_session(TEXT) TO anon, authenticated, service_role;
