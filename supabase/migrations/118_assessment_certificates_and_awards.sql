-- ============================================================================
-- Migration: 118_assessment_certificates_and_awards.sql
-- Description: Dedicated Assessment Certificates, Server-Side Authoritative
--              Rank-Based Award Finalization, and Public Verification.
--
-- Security & Invariants:
--   1. Strict separation of Assessment Certificates from Event Certificates.
--   2. Awards can only be finalized AFTER assessment end_time has passed or status is CLOSED.
--   3. Top 3 ranks receive FIRST_PLACE (Gold), SECOND_PLACE (Silver), THIRD_PLACE (Bronze).
--   4. Students meeting or exceeding passing_percentage (rank > 3) receive ACHIEVEMENT.
--   5. Students scoring below passing_percentage receive NO certificate.
--   6. Disqualified attempts (strike_count >= 3 or TERMINATED) receive NO certificate.
--   7. Deterministic tie-breaking ensures unique, non-contradictory rankings.
--   8. Idempotent award issuance guarantees retries never generate duplicate certificates.
--   9. Authenticated students can only view and query their own certificates via RLS.
--  10. Public verification exposes only sanitized authenticity metadata.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DEDICATED ASSESSMENT CERTIFICATES TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL UNIQUE REFERENCES public.assessment_attempts(id) ON DELETE CASCADE,
    award_type TEXT NOT NULL CHECK (award_type IN ('FIRST_PLACE', 'SECOND_PLACE', 'THIRD_PLACE', 'ACHIEVEMENT')),
    rank INTEGER NOT NULL CHECK (rank >= 1),
    certificate_code TEXT NOT NULL UNIQUE,
    score NUMERIC(8,2) NOT NULL CHECK (score >= 0),
    total_points NUMERIC(8,2) NOT NULL CHECK (total_points > 0),
    percentage NUMERIC(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
    template_version TEXT NOT NULL DEFAULT 'v1',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked BOOLEAN NOT NULL DEFAULT false,
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_assessment_certificate_student UNIQUE (assessment_id, student_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_assessment_certificates_assessment_id ON public.assessment_certificates(assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_certificates_student_id ON public.assessment_certificates(student_id);
CREATE INDEX IF NOT EXISTS idx_assessment_certificates_code ON public.assessment_certificates(certificate_code);
CREATE INDEX IF NOT EXISTS idx_assessment_certificates_rank ON public.assessment_certificates(assessment_id, rank);

-- ----------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE public.assessment_certificates ENABLE ROW LEVEL SECURITY;

-- Students can read only their own certificates
DROP POLICY IF EXISTS "Students view own assessment certificates" ON public.assessment_certificates;
CREATE POLICY "Students view own assessment certificates"
ON public.assessment_certificates FOR SELECT TO authenticated
USING (student_id = auth.uid() OR public.is_admin());

-- Administrators have full management rights
DROP POLICY IF EXISTS "Admin manage assessment certificates" ON public.assessment_certificates;
CREATE POLICY "Admin manage assessment certificates"
ON public.assessment_certificates FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Service role full access
DROP POLICY IF EXISTS "Service role manage assessment certificates" ON public.assessment_certificates;
CREATE POLICY "Service role manage assessment certificates"
ON public.assessment_certificates FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- Revoke direct insert/update/delete from clients (all issuance happens through server RPCs)
REVOKE INSERT, UPDATE, DELETE ON public.assessment_certificates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.assessment_certificates TO authenticated, service_role;
GRANT ALL ON public.assessment_certificates TO service_role;

-- ----------------------------------------------------------------------------
-- 3. SERVER-AUTHORITATIVE AWARD FINALIZATION & ISSUANCE RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_process_assessment_awards(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asm RECORD;
    v_total_points NUMERIC(8,2) := 0.00;
    v_active_attempt RECORD;
    v_eligible RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_rank INT := 0;
    v_award_type TEXT;
    v_cert_code TEXT;
    v_issued_count INT := 0;
    v_updated_count INT := 0;
    v_passed_count INT := 0;
    v_failed_count INT := 0;
    v_total_attempts INT := 0;
    v_first_place JSONB := NULL;
    v_second_place JSONB := NULL;
    v_third_place JSONB := NULL;
BEGIN
    -- 1. Authorization check: Admin or service_role only
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: administrative privileges required' USING ERRCODE = '42501';
    END IF;

    -- 2. Lock assessment row exclusively
    SELECT * INTO v_asm 
    FROM public.assessments 
    WHERE id = p_assessment_id 
    FOR UPDATE;

    IF v_asm IS NULL THEN
        RAISE EXCEPTION 'Assessment % not found', p_assessment_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Temporal eligibility boundary check:
    -- Awards must not be finalized or issued while the assessment is still open.
    IF v_now < v_asm.end_time AND v_asm.status != 'CLOSED' THEN
        RAISE EXCEPTION 'Assessment is still active. Final ranks and awards can only be issued after the assessment closes on %', v_asm.end_time
            USING ERRCODE = '22023';
    END IF;

    -- If assessment window has passed but status is still PUBLISHED, transition to CLOSED
    IF v_asm.status = 'PUBLISHED' AND v_now >= v_asm.end_time THEN
        UPDATE public.assessments
        SET status = 'CLOSED',
            updated_at = v_now
        WHERE id = p_assessment_id;
        v_asm.status := 'CLOSED';
    END IF;

    -- 4. Expiry sweep: finalize any lingering active attempts before calculating rankings
    FOR v_active_attempt IN 
        SELECT id 
        FROM public.assessment_attempts 
        WHERE assessment_id = p_assessment_id 
          AND status = 'IN_PROGRESS'
    LOOP
        PERFORM public.internal_finalize_attempt(v_active_attempt.id, 'EXPIRED', 'Assessment window closed');
    END LOOP;

    -- 5. Calculate total possible assessment points
    SELECT COALESCE(SUM(points), 0.00) INTO v_total_points
    FROM public.assessment_questions
    WHERE assessment_id = p_assessment_id;

    IF v_total_points <= 0 THEN
        RAISE EXCEPTION 'Assessment has zero total points configured' USING ERRCODE = '22023';
    END IF;

    -- 6. Count total finalized attempts
    SELECT COUNT(*) INTO v_total_attempts
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id
      AND status IN ('SUBMITTED', 'EXPIRED', 'TERMINATED');

    -- Count failed/disqualified attempts
    SELECT COUNT(*) INTO v_failed_count
    FROM public.assessment_attempts
    WHERE assessment_id = p_assessment_id
      AND (
          status = 'TERMINATED'
          OR (status IN ('SUBMITTED', 'EXPIRED') AND ((score / v_total_points) * 100.0) < v_asm.passing_percentage)
      );

    -- 7. Query eligible candidates and rank deterministically
    -- Tie-breaking order matches official policy:
    -- 1. score DESC
    -- 2. attempt duration ASC (time efficiency)
    -- 3. submitted_at ASC (earlier submission)
    -- 4. student name ASC
    -- 5. attempt_id ASC (unique deterministic tie-breaker)
    FOR v_eligible IN
        SELECT
            a.id AS attempt_id,
            a.student_id,
            a.score,
            ((a.score / v_total_points) * 100.0) AS calc_percentage,
            COALESCE(NULLIF(trim(st.full_name), ''), 'Anonymous Candidate') AS student_name,
            COALESCE(st.roll_number, '') AS roll_number,
            ROW_NUMBER() OVER (
                ORDER BY
                    a.score DESC,
                    EXTRACT(EPOCH FROM (COALESCE(a.submitted_at, a.deadline) - a.started_at)) ASC,
                    a.submitted_at ASC,
                    COALESCE(NULLIF(trim(st.full_name), ''), 'Anonymous Candidate') ASC,
                    a.id ASC
            ) AS computed_rank
        FROM public.assessment_attempts a
        LEFT JOIN public.student_profiles st ON st.user_id = a.student_id
        WHERE a.assessment_id = p_assessment_id
          AND a.status IN ('SUBMITTED', 'EXPIRED') -- Exclude TERMINATED proctoring violations
          AND ((a.score / v_total_points) * 100.0) >= v_asm.passing_percentage
    LOOP
        v_passed_count := v_passed_count + 1;
        v_rank := v_eligible.computed_rank;

        -- Assign award designation
        IF v_rank = 1 THEN
            v_award_type := 'FIRST_PLACE';
            v_first_place := jsonb_build_object(
                'student_name', v_eligible.student_name,
                'roll_number', v_eligible.roll_number,
                'score', v_eligible.score,
                'percentage', ROUND(v_eligible.calc_percentage, 2)
            );
        ELSIF v_rank = 2 THEN
            v_award_type := 'SECOND_PLACE';
            v_second_place := jsonb_build_object(
                'student_name', v_eligible.student_name,
                'roll_number', v_eligible.roll_number,
                'score', v_eligible.score,
                'percentage', ROUND(v_eligible.calc_percentage, 2)
            );
        ELSIF v_rank = 3 THEN
            v_award_type := 'THIRD_PLACE';
            v_third_place := jsonb_build_object(
                'student_name', v_eligible.student_name,
                'roll_number', v_eligible.roll_number,
                'score', v_eligible.score,
                'percentage', ROUND(v_eligible.calc_percentage, 2)
            );
        ELSE
            v_award_type := 'ACHIEVEMENT';
        END IF;

        -- Generate unique institutional certificate code (e.g. KITS-AC-2026-A1B2C3D4)
        v_cert_code := 'KITS-AC-' || TO_CHAR(v_now, 'YYYY') || '-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 8));

        -- 8. Idempotent Upsert: Preserve original certificate_code and issued_at on retries
        INSERT INTO public.assessment_certificates (
            assessment_id,
            student_id,
            attempt_id,
            award_type,
            rank,
            certificate_code,
            score,
            total_points,
            percentage,
            issued_at,
            updated_at
        )
        VALUES (
            p_assessment_id,
            v_eligible.student_id,
            v_eligible.attempt_id,
            v_award_type,
            v_rank,
            v_cert_code,
            v_eligible.score,
            v_total_points,
            ROUND(v_eligible.calc_percentage, 2),
            v_now,
            v_now
        )
        ON CONFLICT (assessment_id, student_id) DO UPDATE
        SET attempt_id = EXCLUDED.attempt_id,
            award_type = EXCLUDED.award_type,
            rank = EXCLUDED.rank,
            score = EXCLUDED.score,
            total_points = EXCLUDED.total_points,
            percentage = EXCLUDED.percentage,
            updated_at = v_now;

        IF FOUND THEN
            v_issued_count := v_issued_count + 1;
        END IF;
    END LOOP;

    -- Audit log
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
        auth.uid(),
        'ASSESSMENT_AWARDS_FINALIZED',
        'assessments',
        p_assessment_id,
        jsonb_build_object(
            'assessment_id', p_assessment_id,
            'total_attempts', v_total_attempts,
            'passed_count', v_passed_count,
            'failed_count', v_failed_count,
            'certificates_issued', v_issued_count,
            'finalized_at', v_now
        ),
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'assessment_id', p_assessment_id,
        'total_attempts', v_total_attempts,
        'passed_count', v_passed_count,
        'failed_count', v_failed_count,
        'certificates_issued', v_issued_count,
        'top_awards', jsonb_build_object(
            'first_place', v_first_place,
            'second_place', v_second_place,
            'third_place', v_third_place
        ),
        'finalized_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_process_assessment_awards(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_process_assessment_awards(UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. STUDENT CERTIFICATE QUERY RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_assessment_certificate(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_cert RECORD;
    v_asm RECORD;
    v_prof RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_cert
    FROM public.assessment_certificates
    WHERE assessment_id = p_assessment_id
      AND student_id = v_user_id
      AND revoked IS FALSE;

    IF v_cert IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT title, start_time, end_time INTO v_asm
    FROM public.assessments
    WHERE id = p_assessment_id;

    SELECT full_name, roll_number, department, college, year_of_study INTO v_prof
    FROM public.student_profiles
    WHERE user_id = v_user_id;

    RETURN jsonb_build_object(
        'id', v_cert.id,
        'assessment_id', v_cert.assessment_id,
        'assessment_title', v_asm.title,
        'student_id', v_cert.student_id,
        'student_name', COALESCE(v_prof.full_name, 'Student Candidate'),
        'roll_number', COALESCE(v_prof.roll_number, ''),
        'department', COALESCE(v_prof.department, ''),
        'college', COALESCE(v_prof.college, 'KITS Akshar Institute of Technology'),
        'year', v_prof.year_of_study,
        'award_type', v_cert.award_type,
        'rank', v_cert.rank,
        'certificate_code', v_cert.certificate_code,
        'score', v_cert.score,
        'total_points', v_cert.total_points,
        'percentage', v_cert.percentage,
        'issued_at', v_cert.issued_at,
        'template_version', v_cert.template_version
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_assessment_certificate(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_assessment_certificate(UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. ADMIN GET ALL ASSESSMENT CERTIFICATES
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_assessment_certificates(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: administrative privileges required' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ac.id,
            'assessment_id', ac.assessment_id,
            'student_id', ac.student_id,
            'student_name', COALESCE(sp.full_name, 'Candidate'),
            'roll_number', COALESCE(sp.roll_number, ''),
            'department', COALESCE(sp.department, ''),
            'college', COALESCE(sp.college, 'KITS Akshar Institute of Technology'),
            'award_type', ac.award_type,
            'rank', ac.rank,
            'certificate_code', ac.certificate_code,
            'score', ac.score,
            'total_points', ac.total_points,
            'percentage', ac.percentage,
            'issued_at', ac.issued_at,
            'revoked', ac.revoked
        ) ORDER BY ac.rank ASC
    ), '[]'::jsonb) INTO v_result
    FROM public.assessment_certificates ac
    LEFT JOIN public.student_profiles sp ON sp.user_id = ac.student_id
    WHERE ac.assessment_id = p_assessment_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_assessment_certificates(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_assessment_certificates(UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. ENHANCED UNIFIED PUBLIC CERTIFICATE VERIFICATION RPC
-- ----------------------------------------------------------------------------
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

  -- 1. Check existing Event Certificates (Preserve 100% legacy behavior)
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

  -- 2. Check dedicated Assessment Certificates
  SELECT jsonb_build_object(
    'is_valid', true,
    'certificate_id', ac.id,
    'certificate_code', ac.certificate_code,
    'type', ac.award_type,
    'status', CASE WHEN ac.revoked THEN 'REVOKED' ELSE 'UNLOCKED' END,
    'student_name', sp.full_name,
    'roll_number', sp.roll_number,
    'college', sp.college,
    'department', sp.department,
    'year', sp.year_of_study,
    'assessment_title', asm.title,
    'sub_event_name', asm.title,
    'event_name', 'KITS-EOS Academic Examination',
    'award_type', ac.award_type,
    'rank', ac.rank,
    'score', ac.score,
    'total_points', ac.total_points,
    'percentage', ac.percentage,
    'issued_at', ac.issued_at,
    'verified_at', NOW(),
    'is_assessment', true
  )
  INTO v_result
  FROM public.assessment_certificates ac
  JOIN public.assessments asm ON asm.id = ac.assessment_id
  LEFT JOIN public.student_profiles sp ON sp.user_id = ac.student_id
  WHERE (
    ac.certificate_code = v_clean_query
    OR ac.id::text = v_uuid_query
  )
  AND ac.revoked IS FALSE;

  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  -- 3. Not found in either registry
  RETURN jsonb_build_object(
    'is_valid', false,
    'message', 'Certificate not found or not yet officially unlocked.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_certificate(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_certificate(TEXT) TO anon, authenticated, service_role;
