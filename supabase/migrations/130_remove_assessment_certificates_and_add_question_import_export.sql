-- ============================================================================
-- Migration: 130_remove_assessment_certificates_and_add_question_import_export.sql
-- Description:
--   1. Fully neutralizes assessment-specific certificates across the backend
--      while preserving 100% of event certificates, registrations, and results.
--   2. Updates public.verify_certificate to check only event certificates.
--   3. Updates public.admin_get_assessment_questions with time_limit_seconds and
--      active revision filtering.
--   4. Introduces public.admin_import_assessment_questions for non-destructive,
--      append-only question bank importing with published revision workflow safety.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. NEUTRALIZE ASSESSMENT CERTIFICATE RPCS
-- ----------------------------------------------------------------------------

-- 1.1 Neutralize award processing
CREATE OR REPLACE FUNCTION public.admin_process_assessment_awards(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Assessment certificates have been permanently discontinued as a feature. Academic marks, EOS points, and leaderboard standings remain authoritative.'
    );
END;
$$;

-- 1.2 Neutralize student assessment certificate retrieval
CREATE OR REPLACE FUNCTION public.get_my_assessment_certificate(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN NULL;
END;
$$;

-- 1.3 Neutralize admin assessment certificate registry listing
CREATE OR REPLACE FUNCTION public.admin_get_assessment_certificates(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN '[]'::jsonb;
END;
$$;

-- 1.4 Neutralize certificate revocation RPCs
CREATE OR REPLACE FUNCTION public.admin_revoke_assessment_certificate(
    p_certificate_id UUID,
    p_reason TEXT DEFAULT 'Discontinued'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Assessment certificates have been discontinued.'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_assessment_attempt_certificate(
    p_attempt_id UUID,
    p_reason TEXT DEFAULT 'Discontinued'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Assessment certificates have been discontinued.'
    );
END;
$$;

-- 1.5 Update unified public certificate verification to strictly verify Event Certificates
CREATE OR REPLACE FUNCTION public.verify_certificate(cert_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_clean_query TEXT := UPPER(TRIM(COALESCE(cert_query, '')));
  v_uuid_query TEXT := LOWER(TRIM(COALESCE(cert_query, '')));
BEGIN
  IF length(v_clean_query) = 0 THEN
    RETURN jsonb_build_object(
      'is_valid', false,
      'message', 'Please enter a valid certificate reference number or code.'
    );
  END IF;

  -- Verify Event Certificates (100% preserved legacy behavior)
  SELECT jsonb_build_object(
    'is_valid', true,
    'certificate_id', c.id,
    'certificate_code', c.certificate_code,
    'type', c.type,
    'status', c.status,
    'student_name', tm.snapshot_name,
    'roll_number', tm.snapshot_roll_number,
    'college', tm.snapshot_college,
    'department', tm.snapshot_department,
    'year', tm.snapshot_year,
    'sub_event_name', se.name,
    'event_name', COALESCE(e.name, (SELECT ev.name FROM public.categories cat JOIN public.events ev ON cat.event_id = ev.id WHERE cat.id = se.category_id)),
    'issued_at', c.issued_at,
    'verified_at', NOW(),
    'is_assessment', false
  )
  INTO v_result
  FROM public.certificates c
  JOIN public.team_members tm ON c.team_member_id = tm.id
  JOIN public.sub_events se ON c.sub_event_id = se.id
  LEFT JOIN public.events e ON se.event_id = e.id
  WHERE (
    c.certificate_code = v_clean_query 
    OR c.id::text = v_uuid_query
  )
  AND c.status = 'UNLOCKED';

  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  RETURN jsonb_build_object(
    'is_valid', false,
    'message', 'Certificate not found or not yet officially unlocked.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_certificate(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_certificate(TEXT) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. UPDATE ADMIN GET ASSESSMENT QUESTIONS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_assessment_questions(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: administrative privileges required'
            USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', q.id,
            'assessment_id', q.assessment_id,
            'question_text', q.question_text,
            'question_type', q.question_type,
            'points', q.points,
            'time_limit_seconds', COALESCE(q.time_limit_seconds, 30),
            'sort_order', q.sort_order,
            'options', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'id', opt.id,
                        'option_text', opt.option_text,
                        'sort_order', opt.sort_order,
                        'is_correct', (k.option_id = opt.id)
                    ) ORDER BY opt.sort_order ASC, opt.created_at ASC
                ), '[]'::jsonb)
                FROM public.assessment_question_options opt
                LEFT JOIN public.assessment_question_keys k ON k.question_id = q.id
                WHERE opt.question_id = q.id
            ),
            'correct_boolean', k_tf.correct_boolean
        ) ORDER BY q.sort_order ASC, q.created_at ASC
    ), '[]'::jsonb) INTO v_result
    FROM public.assessment_questions q
    LEFT JOIN public.assessment_question_keys k_tf ON k_tf.question_id = q.id AND q.question_type = 'TRUE_FALSE'
    WHERE q.assessment_id = p_assessment_id
      AND (q.is_active_for_assessment IS NULL OR q.is_active_for_assessment = true);

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_assessment_questions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_assessment_questions(UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. ADMIN IMPORT ASSESSMENT QUESTIONS RPC
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_import_assessment_questions(
    p_assessment_id UUID,
    p_questions JSONB,
    p_default_points NUMERIC DEFAULT 5,
    p_coordinator_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_asm RECORD;
    v_active_attempts INT := 0;
    v_existing_draft RECORD;
    v_next_rev_num INT;
    v_new_draft_id UUID;
    v_draft_questions JSONB := '[]'::jsonb;
    v_max_sort INT := 0;
    v_imported_count INT := 0;
    v_total_count INT := 0;
    v_q JSONB;
    v_qid UUID;
    v_qtext TEXT;
    v_qtype TEXT;
    v_points NUMERIC;
    v_time_limit INT;
    v_explanation TEXT;
    v_opts JSONB;
    v_opt JSONB;
    v_opt_id UUID;
    v_opt_text TEXT;
    v_opt_sort INT;
    v_opt_is_correct BOOLEAN;
    v_correct_bool BOOLEAN;
    v_rev_questions JSONB := '[]'::jsonb;
    v_new_q_obj JSONB;
    v_new_opts_arr JSONB;
BEGIN
    -- Strict Admin-only access enforcement
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: Question bank import is restricted to administrators only.'
            USING ERRCODE = '42501';
    END IF;

    -- Validate input questions payload
    IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) = 0 THEN
        RAISE EXCEPTION 'Invalid question import payload: Expected a non-empty JSON array of questions.'
            USING ERRCODE = '22023';
    END IF;

    -- Lock parent assessment row
    SELECT * INTO v_asm FROM public.assessments WHERE id = p_assessment_id FOR UPDATE;
    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_asm.is_deleted OR v_asm.status = 'ARCHIVED' THEN
        RAISE EXCEPTION 'Cannot import questions into an archived or deleted assessment.'
            USING ERRCODE = '22023';
    END IF;

    -- Safeguard: Disallow imports during active live examination sessions
    SELECT count(*) INTO v_active_attempts
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id AND status = 'IN_PROGRESS';

    IF v_active_attempts > 0 THEN
        RAISE EXCEPTION 'Cannot import questions while % participant session(s) are actively in progress. Please wait for sessions to conclude or close the assessment before revising.',
            v_active_attempts USING ERRCODE = '22023';
    END IF;

    -- ========================================================================
    -- BRANCH A: PUBLISHED ASSESSMENT -> SAFE REVISION WORKFLOW
    -- Appends to Draft Revision N+1 so current examination version is untouched.
    -- ========================================================================
    IF v_asm.status = 'PUBLISHED' THEN
        -- Check if a draft revision is already in progress
        SELECT * INTO v_existing_draft
        FROM public.assessment_revisions
        WHERE assessment_id = p_assessment_id AND status = 'DRAFT'
        FOR UPDATE;

        IF v_existing_draft.id IS NOT NULL THEN
            v_new_draft_id := v_existing_draft.id;
            v_next_rev_num := v_existing_draft.revision_number;
            v_draft_questions := COALESCE(v_existing_draft.questions_data, '[]'::jsonb);
        ELSE
            -- Initiate new Draft Revision N+1 populated from current active questions
            v_next_rev_num := v_asm.current_revision_number + 1;

            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'id', q.id,
                    'question_text', q.question_text,
                    'question_type', q.question_type,
                    'points', q.points,
                    'time_limit_seconds', COALESCE(q.time_limit_seconds, 30),
                    'sort_order', q.sort_order,
                    'options', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'id', opt.id,
                                'option_text', opt.option_text,
                                'sort_order', opt.sort_order,
                                'is_correct', (k.option_id = opt.id)
                            ) ORDER BY opt.sort_order ASC, opt.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.assessment_question_options opt
                        LEFT JOIN public.assessment_question_keys k ON k.question_id = q.id
                        WHERE opt.question_id = q.id
                    ),
                    'correct_boolean', k_tf.correct_boolean
                ) ORDER BY q.sort_order ASC, q.created_at ASC
            ), '[]'::jsonb)
            INTO v_draft_questions
            FROM public.assessment_questions q
            LEFT JOIN public.assessment_question_keys k_tf ON k_tf.question_id = q.id AND q.question_type = 'TRUE_FALSE'
            WHERE q.assessment_id = p_assessment_id AND (q.is_active_for_assessment IS NULL OR q.is_active_for_assessment = true);

            INSERT INTO public.assessment_revisions (
                assessment_id,
                revision_number,
                status,
                title,
                description,
                instructions,
                duration_minutes,
                start_time,
                end_time,
                passing_percentage,
                total_questions_count,
                include_in_global_leaderboard,
                randomize_questions,
                randomize_options,
                speed_bonus_config,
                questions_data,
                change_summary,
                created_by
            ) VALUES (
                p_assessment_id,
                v_next_rev_num,
                'DRAFT',
                v_asm.title,
                v_asm.description,
                v_asm.instructions,
                v_asm.duration_minutes,
                v_asm.start_time,
                v_asm.end_time,
                v_asm.passing_percentage,
                jsonb_array_length(v_draft_questions),
                v_asm.include_in_global_leaderboard,
                COALESCE(v_asm.randomize_questions, false),
                COALESCE(v_asm.randomize_options, false),
                COALESCE(v_asm.speed_bonus_config, '{"enabled": true, "max_eos_points": 1000, "default_time_limit_seconds": 30}'::jsonb),
                v_draft_questions,
                'Imported questions appended to draft revision',
                auth.uid()
            ) RETURNING id INTO v_new_draft_id;

            UPDATE public.assessments
            SET has_draft_revision = true,
                updated_at = clock_timestamp()
            WHERE id = p_assessment_id;
        END IF;

        -- Find maximum sort order in existing draft questions
        v_max_sort := 0;
        FOR v_q IN SELECT * FROM jsonb_array_elements(v_draft_questions) LOOP
            IF (v_q->>'sort_order')::INT > v_max_sort THEN
                v_max_sort := (v_q->>'sort_order')::INT;
            END IF;
        END LOOP;

        v_rev_questions := v_draft_questions;

        -- Append each imported question to draft revision
        FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
            v_max_sort := v_max_sort + 1;
            v_imported_count := v_imported_count + 1;
            v_qid := gen_random_uuid();
            v_qtext := TRIM(COALESCE(v_q->>'question_text', ''));
            v_qtype := UPPER(TRIM(COALESCE(v_q->>'question_type', 'MCQ')));
            v_points := COALESCE(NULLIF(v_q->>'points', '')::numeric, p_default_points);
            v_time_limit := COALESCE(NULLIF(v_q->>'time_limit_seconds', '')::int, 30);
            v_explanation := v_q->>'explanation';

            IF v_qtype = 'MCQ' THEN
                v_new_opts_arr := '[]'::jsonb;
                v_opts := COALESCE(v_q->'options', '[]'::jsonb);
                v_opt_sort := 0;
                FOR v_opt IN SELECT * FROM jsonb_array_elements(v_opts) LOOP
                    v_opt_sort := v_opt_sort + 1;
                    v_new_opts_arr := v_new_opts_arr || jsonb_build_object(
                        'id', gen_random_uuid(),
                        'option_text', TRIM(COALESCE(v_opt->>'option_text', '')),
                        'sort_order', v_opt_sort,
                        'is_correct', COALESCE((v_opt->>'is_correct')::boolean, false)
                    );
                END LOOP;

                v_new_q_obj := jsonb_build_object(
                    'id', v_qid,
                    'question_text', v_qtext,
                    'question_type', 'MCQ',
                    'points', v_points,
                    'time_limit_seconds', v_time_limit,
                    'sort_order', v_max_sort,
                    'explanation', v_explanation,
                    'options', v_new_opts_arr,
                    'correct_boolean', NULL
                );
            ELSE
                v_correct_bool := (v_q->>'correct_boolean')::boolean;
                v_new_opts_arr := jsonb_build_array(
                    jsonb_build_object('id', gen_random_uuid(), 'option_text', 'True', 'sort_order', 1, 'is_correct', (v_correct_bool IS TRUE)),
                    jsonb_build_object('id', gen_random_uuid(), 'option_text', 'False', 'sort_order', 2, 'is_correct', (v_correct_bool IS FALSE))
                );

                v_new_q_obj := jsonb_build_object(
                    'id', v_qid,
                    'question_text', v_qtext,
                    'question_type', 'TRUE_FALSE',
                    'points', v_points,
                    'time_limit_seconds', v_time_limit,
                    'sort_order', v_max_sort,
                    'explanation', v_explanation,
                    'options', v_new_opts_arr,
                    'correct_boolean', v_correct_bool
                );
            END IF;

            v_rev_questions := v_rev_questions || v_new_q_obj;
        END LOOP;

        v_total_count := jsonb_array_length(v_rev_questions);

        UPDATE public.assessment_revisions
        SET questions_data = v_rev_questions,
            total_questions_count = v_total_count,
            updated_at = clock_timestamp()
        WHERE id = v_new_draft_id;

        RETURN jsonb_build_object(
            'success', true,
            'mode', 'DRAFT_REVISION',
            'revision_id', v_new_draft_id,
            'revision_number', v_next_rev_num,
            'imported_count', v_imported_count,
            'total_questions_count', v_total_count,
            'message', format('Successfully appended %s questions to Draft Revision #%s. Published version remains intact until you review and publish this revision.', v_imported_count, v_next_rev_num)
        );

    -- ========================================================================
    -- BRANCH B: DRAFT ASSESSMENT -> DIRECT APPEND TO QUESTION BANK
    -- Appends transactionally with next sort_order; never replaces existing questions.
    -- ========================================================================
    ELSE
        SELECT COALESCE(MAX(sort_order), 0) INTO v_max_sort
        FROM public.assessment_questions
        WHERE assessment_id = p_assessment_id;

        FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
            v_max_sort := v_max_sort + 1;
            v_imported_count := v_imported_count + 1;
            v_qid := gen_random_uuid();
            v_qtext := TRIM(COALESCE(v_q->>'question_text', ''));
            v_qtype := UPPER(TRIM(COALESCE(v_q->>'question_type', 'MCQ')));
            v_points := COALESCE(NULLIF(v_q->>'points', '')::numeric, p_default_points);
            v_time_limit := COALESCE(NULLIF(v_q->>'time_limit_seconds', '')::int, 30);

            IF v_qtype = 'MCQ' THEN
                INSERT INTO public.assessment_questions (
                    id, assessment_id, question_text, question_type, points, time_limit_seconds, sort_order, is_active_for_assessment
                ) VALUES (
                    v_qid, p_assessment_id, v_qtext, 'MCQ', v_points, v_time_limit, v_max_sort, true
                );

                v_opts := COALESCE(v_q->'options', '[]'::jsonb);
                v_opt_sort := 0;
                FOR v_opt IN SELECT * FROM jsonb_array_elements(v_opts) LOOP
                    v_opt_sort := v_opt_sort + 1;
                    v_opt_id := gen_random_uuid();
                    v_opt_text := TRIM(COALESCE(v_opt->>'option_text', ''));
                    v_opt_is_correct := COALESCE((v_opt->>'is_correct')::boolean, false);

                    INSERT INTO public.assessment_question_options (
                        id, question_id, option_text, sort_order
                    ) VALUES (
                        v_opt_id, v_qid, v_opt_text, v_opt_sort
                    );

                    IF v_opt_is_correct IS TRUE THEN
                        INSERT INTO public.assessment_question_keys (
                            question_id, option_id, correct_boolean
                        ) VALUES (
                            v_qid, v_opt_id, NULL
                        );
                    END IF;
                END LOOP;
            ELSE
                INSERT INTO public.assessment_questions (
                    id, assessment_id, question_text, question_type, points, time_limit_seconds, sort_order, is_active_for_assessment
                ) VALUES (
                    v_qid, p_assessment_id, v_qtext, 'TRUE_FALSE', v_points, v_time_limit, v_max_sort, true
                );

                v_correct_bool := (v_q->>'correct_boolean')::boolean;
                INSERT INTO public.assessment_question_options (id, question_id, option_text, sort_order)
                VALUES (gen_random_uuid(), v_qid, 'True', 1), (gen_random_uuid(), v_qid, 'False', 2);

                INSERT INTO public.assessment_question_keys (
                    question_id, option_id, correct_boolean
                ) VALUES (
                    v_qid, NULL, v_correct_bool
                );
            END IF;
        END LOOP;

        SELECT count(*) INTO v_total_count
        FROM public.assessment_questions
        WHERE assessment_id = p_assessment_id AND (is_active_for_assessment IS NULL OR is_active_for_assessment = true);

        UPDATE public.assessments
        SET total_questions_count = v_total_count,
            updated_at = clock_timestamp()
        WHERE id = p_assessment_id;

        RETURN jsonb_build_object(
            'success', true,
            'mode', 'DRAFT_ASSESSMENT',
            'imported_count', v_imported_count,
            'total_questions_count', v_total_count,
            'message', format('Successfully appended %s questions to assessment question bank.', v_imported_count)
        );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_import_assessment_questions(UUID, JSONB, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_import_assessment_questions(UUID, JSONB, NUMERIC, TEXT) TO authenticated, service_role;
