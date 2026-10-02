-- ============================================================================
-- MIGRATION 094: SECURE ADMIN RESULT EDIT / CORRECTION WORKFLOW
-- 
-- 1. Architecture Overview:
--    - Distinguishes between EDITING A PENDING RESULT and EDITING AN ALREADY
--      APPROVED/PUBLISHED RESULT.
--    - Enforces Admin-Only server-side authorization via public.is_admin() and
--      service_role checks. Rejects coordinators, students, and anonymous users.
--    - Re-validates all candidate inputs server-side (attendance, registration,
--      belonging to sub-event, winner != runner != third, minimum competitors).
--    - Mandatory Edit Reason (minimum 10 characters) stored server-side.
--    - Concurrency Control: Optimistic lock checks against updated_at.
--    - Two-Step Security confirmation required for published-result correction.
--    - Atomic achievement certificate reconciliation:
--      * Revokes achievement certificates of removed podium members.
--      * Issues/reactivates achievement certificates for newly appointed podium members.
--      * Preserves immutable audit history in public.audit_logs and
--        public.certificate_revocation_logs.
--    - Participation Certificate Firewall:
--      * Participation certificates (type = 'PARTICIPANT') are strictly NEVER
--        modified, deleted, revoked, or unlocked by result edits.
--      * Attendance records and feedback gates remain 100% untouched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SCHEMA HARDENING & TIMESTAMPS
-- ----------------------------------------------------------------------------

-- Add updated_at to sub_events if missing for concurrency tracking
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sub_events' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE public.sub_events ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
    END IF;
END $$;

-- Add revoked tracking fields to certificates table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'certificates' AND column_name = 'revoked_at'
    ) THEN
        ALTER TABLE public.certificates ADD COLUMN revoked_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'certificates' AND column_name = 'revoked_reason'
    ) THEN
        ALTER TABLE public.certificates ADD COLUMN revoked_reason TEXT;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. DEDICATED CERTIFICATE REVOCATION AUDIT LOG
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.certificate_revocation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_id UUID NOT NULL REFERENCES public.certificates(id) ON DELETE CASCADE,
    team_member_id UUID NOT NULL REFERENCES public.team_members(id),
    sub_event_id UUID NOT NULL REFERENCES public.sub_events(id),
    certificate_type public.certificate_type NOT NULL,
    certificate_code TEXT NOT NULL,
    reason TEXT NOT NULL,
    result_submission_id UUID REFERENCES public.result_submissions(id),
    actor_id UUID REFERENCES auth.users(id),
    actor_role TEXT NOT NULL DEFAULT 'ADMIN',
    metadata JSONB DEFAULT '{}'::jsonb,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cert_revocation_logs_cert_id 
    ON public.certificate_revocation_logs(certificate_id);
CREATE INDEX IF NOT EXISTS idx_cert_revocation_logs_sub_event_id 
    ON public.certificate_revocation_logs(sub_event_id);
CREATE INDEX IF NOT EXISTS idx_cert_revocation_logs_member_id 
    ON public.certificate_revocation_logs(team_member_id);

ALTER TABLE public.certificate_revocation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin view certificate revocation logs" ON public.certificate_revocation_logs;
CREATE POLICY "Admin view certificate revocation logs"
    ON public.certificate_revocation_logs
    FOR SELECT
    TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Service role full access on revocation logs" ON public.certificate_revocation_logs;
CREATE POLICY "Service role full access on revocation logs"
    ON public.certificate_revocation_logs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- 3. SCOPED CANDIDATE QUERY RPC (ADMIN ONLY)
--    Enforces: sub_event_id + registration confirmed + verified attendance
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_sub_event_eligible_candidates(
    p_sub_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_candidates JSONB;
BEGIN
    -- 1. Authorization: Admin only
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can access candidate records.';
    END IF;

    -- 2. Query candidates
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'team_id', t.id,
            'team_name', COALESCE(
                NULLIF(t.team_name, 'Solo Participant'),
                (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
                t.team_name
            ),
            'registration_id', r.id,
            'is_team', (
                SELECT COUNT(*) > 1 OR (t.team_name IS NOT NULL AND t.team_name <> 'Solo Participant')
                FROM public.team_members tm WHERE tm.team_id = t.id
            ),
            'leader_name', (
                SELECT tm.snapshot_name FROM public.team_members tm 
                WHERE tm.team_id = t.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
            ),
            'leader_roll', (
                SELECT tm.snapshot_roll_number FROM public.team_members tm 
                WHERE tm.team_id = t.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
            ),
            'leader_college', (
                SELECT tm.snapshot_college FROM public.team_members tm 
                WHERE tm.team_id = t.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
            ),
            'leader_dept', (
                SELECT tm.snapshot_department FROM public.team_members tm 
                WHERE tm.team_id = t.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
            ),
            'leader_year', (
                SELECT tm.snapshot_year FROM public.team_members tm 
                WHERE tm.team_id = t.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
            ),
            'attended_members_count', (
                SELECT COUNT(DISTINCT ar.scanned_member_id)
                FROM public.attendance_records ar
                WHERE ar.sub_event_id = p_sub_event_id AND ar.team_id = t.id
            ),
            'members', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'member_id', tm.id,
                        'name', tm.snapshot_name,
                        'roll_number', tm.snapshot_roll_number,
                        'college', tm.snapshot_college,
                        'department', tm.snapshot_department,
                        'year', tm.snapshot_year,
                        'is_leader', tm.is_leader,
                        'is_attended', EXISTS (
                            SELECT 1 FROM public.attendance_records ar 
                            WHERE ar.scanned_member_id = tm.id AND ar.sub_event_id = p_sub_event_id
                        )
                    ) ORDER BY tm.is_leader DESC, tm.id ASC
                ), '[]'::jsonb)
                FROM public.team_members tm
                WHERE tm.team_id = t.id
            )
        ) ORDER BY t.team_name ASC
    ), '[]'::jsonb)
    INTO v_candidates
    FROM public.teams t
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE r.sub_event_id = p_sub_event_id
      AND r.status = 'CONFIRMED'
      AND EXISTS (
          SELECT 1 FROM public.attendance_records ar 
          WHERE ar.sub_event_id = p_sub_event_id AND ar.team_id = t.id
      );

    RETURN v_candidates;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_sub_event_eligible_candidates(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_sub_event_eligible_candidates(UUID) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 4. OPERATION A: ADMIN EDIT PENDING RESULT SUBMISSION RPC
--    Enforces: Admin auth, status = PENDING_ADMIN_APPROVAL, reason >= 10 chars,
--    server-side candidate attendance and belonging validation, concurrency check.
--    Does NOT touch or create certificates.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_edit_pending_result_submission(
    p_submission_id UUID,
    p_new_winner_team_id UUID,
    p_new_runner_team_id UUID,
    p_new_third_team_id UUID DEFAULT NULL,
    p_edit_reason TEXT DEFAULT NULL,
    p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_sub RECORD;
    v_sub_event RECORD;
    v_eligible_count INT := 0;
    v_winner_valid BOOLEAN := FALSE;
    v_runner_valid BOOLEAN := FALSE;
    v_third_valid BOOLEAN := FALSE;
BEGIN
    -- 1. Authorization Check: Admin only
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can edit result submissions.';
    END IF;

    -- 2. Edit reason validation: Minimum 10 characters
    IF p_edit_reason IS NULL OR length(trim(p_edit_reason)) < 10 THEN
        RAISE EXCEPTION 'Edit reason is mandatory and must be at least 10 characters long.';
    END IF;

    -- 3. Lock & verify submission
    SELECT * INTO v_sub
    FROM public.result_submissions
    WHERE id = p_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Result submission not found.';
    END IF;

    IF v_sub.status <> 'PENDING_ADMIN_APPROVAL' THEN
        RAISE EXCEPTION 'Cannot edit submission in status %: only PENDING_ADMIN_APPROVAL submissions can be edited.', v_sub.status;
    END IF;

    -- 4. Optimistic concurrency control check
    IF p_expected_updated_at IS NOT NULL AND v_sub.updated_at <> p_expected_updated_at THEN
        RAISE EXCEPTION 'Result was modified by another administrator. Please refresh before editing.';
    END IF;

    -- 5. Lock & verify sub-event
    SELECT * INTO v_sub_event 
    FROM public.sub_events 
    WHERE id = v_sub.sub_event_id AND status <> 'PERMANENTLY_DELETED'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found or deleted.';
    END IF;

    IF v_sub_event.results_published IS TRUE THEN
        RAISE EXCEPTION 'Sub-event results are already published. Use the published result correction workflow.';
    END IF;

    -- 6. Count eligible competitors
    SELECT COUNT(DISTINCT ar.team_id) INTO v_eligible_count
    FROM public.attendance_records ar
    JOIN public.teams t ON t.id = ar.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE ar.sub_event_id = v_sub.sub_event_id
      AND r.sub_event_id = v_sub.sub_event_id
      AND r.status = 'CONFIRMED';

    IF v_eligible_count = 0 THEN
        RAISE EXCEPTION 'Cannot edit result: No eligible competitors have attended check-in for this sub-event.';
    END IF;

    -- 7. Validate Podium Candidate Structure
    IF v_eligible_count < 2 THEN
        IF p_new_winner_team_id IS NULL THEN
            RAISE EXCEPTION 'Winner selection is required.';
        END IF;
    ELSE
        IF p_new_winner_team_id IS NULL OR p_new_runner_team_id IS NULL THEN
            RAISE EXCEPTION 'Both Winner and Runner-Up are required for sub-events with 2 or more eligible competitors (found % eligible competitors).', v_eligible_count;
        END IF;

        IF p_new_winner_team_id = p_new_runner_team_id THEN
            RAISE EXCEPTION 'Winner and Runner-Up cannot be the same candidate.';
        END IF;
    END IF;

    -- Validate Third Place uniqueness if provided
    IF p_new_third_team_id IS NOT NULL THEN
        IF p_new_third_team_id = p_new_winner_team_id OR p_new_third_team_id = p_new_runner_team_id THEN
            RAISE EXCEPTION 'Third Place cannot be the same as Winner or Runner-Up.';
        END IF;
    END IF;

    -- 8. Server-side validation of Winner
    SELECT EXISTS (
        SELECT 1 FROM public.attendance_records ar
        JOIN public.teams t ON t.id = ar.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE t.id = p_new_winner_team_id
          AND ar.sub_event_id = v_sub.sub_event_id
          AND r.sub_event_id = v_sub.sub_event_id
          AND r.status = 'CONFIRMED'
    ) INTO v_winner_valid;

    IF NOT v_winner_valid THEN
        RAISE EXCEPTION 'Selected Winner is not an eligible attended candidate for this sub-event.';
    END IF;

    -- 9. Server-side validation of Runner (if provided)
    IF p_new_runner_team_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_records ar
            JOIN public.teams t ON t.id = ar.team_id
            JOIN public.registrations r ON r.id = t.registration_id
            WHERE t.id = p_new_runner_team_id
              AND ar.sub_event_id = v_sub.sub_event_id
              AND r.sub_event_id = v_sub.sub_event_id
              AND r.status = 'CONFIRMED'
        ) INTO v_runner_valid;

        IF NOT v_runner_valid THEN
            RAISE EXCEPTION 'Selected Runner-Up is not an eligible attended candidate for this sub-event.';
        END IF;
    END IF;

    -- 10. Server-side validation of Third Place (if provided)
    IF p_new_third_team_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_records ar
            JOIN public.teams t ON t.id = ar.team_id
            JOIN public.registrations r ON r.id = t.registration_id
            WHERE t.id = p_new_third_team_id
              AND ar.sub_event_id = v_sub.sub_event_id
              AND r.sub_event_id = v_sub.sub_event_id
              AND r.status = 'CONFIRMED'
        ) INTO v_third_valid;

        IF NOT v_third_valid THEN
            RAISE EXCEPTION 'Selected Third Place is not an eligible attended candidate for this sub-event.';
        END IF;
    END IF;

    -- 11. Apply Edit to result_submissions (Remains PENDING_ADMIN_APPROVAL)
    UPDATE public.result_submissions
    SET winner_team_id = p_new_winner_team_id,
        runner_team_id = p_new_runner_team_id,
        third_team_id = p_new_third_team_id,
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = v_sub.id;

    -- 12. Write immutable audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        auth.uid(),
        'RESULT_PENDING_EDITED',
        'result_submissions',
        v_sub.id,
        jsonb_build_object(
            'submission_id', v_sub.id,
            'sub_event_id', v_sub.sub_event_id,
            'previous_winner_team_id', v_sub.winner_team_id,
            'new_winner_team_id', p_new_winner_team_id,
            'previous_runner_team_id', v_sub.runner_team_id,
            'new_runner_team_id', p_new_runner_team_id,
            'previous_third_team_id', v_sub.third_team_id,
            'new_third_team_id', p_new_third_team_id,
            'reason', trim(p_edit_reason)
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'submission_id', v_sub.id,
        'status', 'PENDING_ADMIN_APPROVAL',
        'message', 'Pending result submission updated successfully.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_edit_pending_result_submission(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_edit_pending_result_submission(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 5. PREVIEW PUBLISHED RESULT CORRECTION RPC
--    Inspects existing achievement certificates vs proposed changes.
--    Does NOT mutate any data. Returns impact preview for Stage 1 confirmation.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_preview_published_result_correction(
    p_sub_event_id UUID,
    p_new_winner_team_id UUID,
    p_new_runner_team_id UUID DEFAULT NULL,
    p_new_third_team_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_sub_event RECORD;
    v_revoke_list JSONB;
    v_issue_list JSONB;
    v_unchanged_list JSONB;
    v_curr_winner_name TEXT;
    v_curr_runner_name TEXT;
    v_curr_third_name TEXT;
    v_new_winner_name TEXT;
    v_new_runner_name TEXT;
    v_new_third_name TEXT;
BEGIN
    -- 1. Authorization: Admin only
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can preview result corrections.';
    END IF;

    -- 2. Verify sub-event
    SELECT * INTO v_sub_event 
    FROM public.sub_events 
    WHERE id = p_sub_event_id AND status <> 'PERMANENTLY_DELETED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found or deleted.';
    END IF;

    IF v_sub_event.results_published IS NOT TRUE THEN
        RAISE EXCEPTION 'Sub-event results are not yet published.';
    END IF;

    -- Resolve current names
    SELECT COALESCE(NULLIF(t.team_name, 'Solo Participant'), (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1), t.team_name)
    INTO v_curr_winner_name FROM public.teams t WHERE t.id = v_sub_event.winner_team_id;

    SELECT COALESCE(NULLIF(t.team_name, 'Solo Participant'), (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1), t.team_name)
    INTO v_curr_runner_name FROM public.teams t WHERE t.id = v_sub_event.runner_team_id;

    SELECT COALESCE(NULLIF(t.team_name, 'Solo Participant'), (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1), t.team_name)
    INTO v_curr_third_name FROM public.teams t WHERE t.id = v_sub_event.third_team_id;

    -- Resolve proposed names
    SELECT COALESCE(NULLIF(t.team_name, 'Solo Participant'), (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1), t.team_name)
    INTO v_new_winner_name FROM public.teams t WHERE t.id = p_new_winner_team_id;

    SELECT COALESCE(NULLIF(t.team_name, 'Solo Participant'), (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1), t.team_name)
    INTO v_new_runner_name FROM public.teams t WHERE t.id = p_new_runner_team_id;

    SELECT COALESCE(NULLIF(t.team_name, 'Solo Participant'), (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1), t.team_name)
    INTO v_new_third_name FROM public.teams t WHERE t.id = p_new_third_team_id;

    -- 3. Certificates to REVOKE:
    -- Any active achievement cert on this sub-event that does NOT match the proposed assignment
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'certificate_id', c.id,
            'certificate_code', c.certificate_code,
            'member_name', tm.snapshot_name,
            'roll_number', tm.snapshot_roll_number,
            'college', tm.snapshot_college,
            'department', tm.snapshot_department,
            'type', c.type
        )
    ), '[]'::jsonb)
    INTO v_revoke_list
    FROM public.certificates c
    JOIN public.team_members tm ON tm.id = c.team_member_id
    WHERE c.sub_event_id = p_sub_event_id
      AND c.type IN ('WINNER', 'RUNNER', 'THIRD_PLACE')
      AND c.status = 'UNLOCKED'
      AND (
          (c.type = 'WINNER' AND tm.team_id <> p_new_winner_team_id) OR
          (c.type = 'RUNNER' AND (p_new_runner_team_id IS NULL OR tm.team_id <> p_new_runner_team_id)) OR
          (c.type = 'THIRD_PLACE' AND (p_new_third_team_id IS NULL OR tm.team_id <> p_new_third_team_id))
      );

    -- 4. Certificates to ISSUE / UNLOCK:
    -- Attended members of proposed teams who do not currently hold an UNLOCKED cert of that type
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'member_name', proposed.snapshot_name,
            'roll_number', proposed.snapshot_roll_number,
            'college', proposed.snapshot_college,
            'department', proposed.snapshot_department,
            'type', proposed.target_type
        )
    ), '[]'::jsonb)
    INTO v_issue_list
    FROM (
        -- Winner members
        SELECT tm.id, tm.snapshot_name, tm.snapshot_roll_number, tm.snapshot_college, tm.snapshot_department, 'WINNER' AS target_type
        FROM public.team_members tm
        JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
        WHERE tm.team_id = p_new_winner_team_id
          AND ar.sub_event_id = p_sub_event_id
          AND NOT EXISTS (
              SELECT 1 FROM public.certificates c 
              WHERE c.team_member_id = tm.id AND c.sub_event_id = p_sub_event_id AND c.type = 'WINNER' AND c.status = 'UNLOCKED'
          )
        UNION ALL
        -- Runner members
        SELECT tm.id, tm.snapshot_name, tm.snapshot_roll_number, tm.snapshot_college, tm.snapshot_department, 'RUNNER' AS target_type
        FROM public.team_members tm
        JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
        WHERE p_new_runner_team_id IS NOT NULL
          AND tm.team_id = p_new_runner_team_id
          AND ar.sub_event_id = p_sub_event_id
          AND NOT EXISTS (
              SELECT 1 FROM public.certificates c 
              WHERE c.team_member_id = tm.id AND c.sub_event_id = p_sub_event_id AND c.type = 'RUNNER' AND c.status = 'UNLOCKED'
          )
        UNION ALL
        -- Third members
        SELECT tm.id, tm.snapshot_name, tm.snapshot_roll_number, tm.snapshot_college, tm.snapshot_department, 'THIRD_PLACE' AS target_type
        FROM public.team_members tm
        JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
        WHERE p_new_third_team_id IS NOT NULL
          AND tm.team_id = p_new_third_team_id
          AND ar.sub_event_id = p_sub_event_id
          AND NOT EXISTS (
              SELECT 1 FROM public.certificates c 
              WHERE c.team_member_id = tm.id AND c.sub_event_id = p_sub_event_id AND c.type = 'THIRD_PLACE' AND c.status = 'UNLOCKED'
          )
    ) proposed;

    -- 5. Certificates UNCHANGED:
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'certificate_id', c.id,
            'member_name', tm.snapshot_name,
            'type', c.type
        )
    ), '[]'::jsonb)
    INTO v_unchanged_list
    FROM public.certificates c
    JOIN public.team_members tm ON tm.id = c.team_member_id
    WHERE c.sub_event_id = p_sub_event_id
      AND c.type IN ('WINNER', 'RUNNER', 'THIRD_PLACE')
      AND c.status = 'UNLOCKED'
      AND (
          (c.type = 'WINNER' AND tm.team_id = p_new_winner_team_id) OR
          (c.type = 'RUNNER' AND tm.team_id = p_new_runner_team_id) OR
          (c.type = 'THIRD_PLACE' AND tm.team_id = p_new_third_team_id)
      );

    RETURN jsonb_build_object(
        'sub_event_id', p_sub_event_id,
        'sub_event_name', v_sub_event.name,
        'current_podium', jsonb_build_object(
            'winner_team_id', v_sub_event.winner_team_id,
            'winner_name', v_curr_winner_name,
            'runner_team_id', v_sub_event.runner_team_id,
            'runner_name', v_curr_runner_name,
            'third_team_id', v_sub_event.third_team_id,
            'third_name', v_curr_third_name
        ),
        'proposed_podium', jsonb_build_object(
            'winner_team_id', p_new_winner_team_id,
            'winner_name', v_new_winner_name,
            'runner_team_id', p_new_runner_team_id,
            'runner_name', v_new_runner_name,
            'third_team_id', p_new_third_team_id,
            'third_name', v_new_third_name
        ),
        'certificates_to_revoke', v_revoke_list,
        'certificates_to_issue', v_issue_list,
        'certificates_unchanged', v_unchanged_list,
        'participation_certificates_affected', 0
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_preview_published_result_correction(UUID, UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_published_result_correction(UUID, UUID, UUID, UUID) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 6. OPERATION B: ATOMIC ADMIN PUBLISHED RESULT CORRECTION RPC
--    Enforces: Admin auth, security confirmation string, reason >= 10 chars,
--    concurrency lock, candidate attendance validation, atomic cert reconciliation.
--    Participation certificates are strictly UNTOUCHED.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_correct_published_sub_event_result(
    p_sub_event_id UUID,
    p_new_winner_team_id UUID,
    p_new_runner_team_id UUID DEFAULT NULL,
    p_new_third_team_id UUID DEFAULT NULL,
    p_correction_reason TEXT DEFAULT NULL,
    p_confirmation_token TEXT DEFAULT NULL,
    p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_sub_event RECORD;
    v_eligible_count INT := 0;
    v_winner_valid BOOLEAN := FALSE;
    v_runner_valid BOOLEAN := FALSE;
    v_third_valid BOOLEAN := FALSE;
    v_member RECORD;
    v_cert_record RECORD;
    v_cert_code TEXT;
    v_revoked_count INT := 0;
    v_issued_count INT := 0;
    v_revoked_cert_ids UUID[] := ARRAY[]::UUID[];
BEGIN
    -- 1. Authorization: Admin only
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can correct published results.';
    END IF;

    -- 2. Two-step confirmation security phrase verification
    IF trim(COALESCE(p_confirmation_token, '')) <> 'CONFIRM RESULT CORRECTION' THEN
        RAISE EXCEPTION 'Security confirmation failed: You must type CONFIRM RESULT CORRECTION exactly.';
    END IF;

    -- 3. Mandatory correction reason validation (minimum 10 characters)
    IF p_correction_reason IS NULL OR length(trim(p_correction_reason)) < 10 THEN
        RAISE EXCEPTION 'Correction reason is mandatory and must be at least 10 characters long.';
    END IF;

    -- 4. Lock sub_events row FOR UPDATE
    SELECT * INTO v_sub_event 
    FROM public.sub_events 
    WHERE id = p_sub_event_id AND status <> 'PERMANENTLY_DELETED'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found or deleted.';
    END IF;

    IF v_sub_event.results_published IS NOT TRUE THEN
        RAISE EXCEPTION 'Cannot perform correction: Sub-event results are not yet published.';
    END IF;

    -- 5. Optimistic concurrency control check
    IF p_expected_updated_at IS NOT NULL AND v_sub_event.updated_at IS NOT NULL 
       AND v_sub_event.updated_at <> p_expected_updated_at THEN
        RAISE EXCEPTION 'Sub-event was modified by another administrator. Please refresh before correcting.';
    END IF;

    -- 6. Verify change is not a no-op
    IF p_new_winner_team_id = v_sub_event.winner_team_id 
       AND p_new_runner_team_id IS NOT DISTINCT FROM v_sub_event.runner_team_id
       AND p_new_third_team_id IS NOT DISTINCT FROM v_sub_event.third_team_id THEN
        RAISE EXCEPTION 'Proposed result is identical to current published result. No changes to apply.';
    END IF;

    -- 7. Count eligible competitors
    SELECT COUNT(DISTINCT ar.team_id) INTO v_eligible_count
    FROM public.attendance_records ar
    JOIN public.teams t ON t.id = ar.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE ar.sub_event_id = p_sub_event_id
      AND r.sub_event_id = p_sub_event_id
      AND r.status = 'CONFIRMED';

    IF v_eligible_count = 0 THEN
        RAISE EXCEPTION 'Cannot correct result: No eligible competitors found for this sub-event.';
    END IF;

    -- 8. Validate Podium Rules
    IF v_eligible_count < 2 THEN
        IF p_new_winner_team_id IS NULL THEN
            RAISE EXCEPTION 'Winner selection is required.';
        END IF;
    ELSE
        IF p_new_winner_team_id IS NULL OR p_new_runner_team_id IS NULL THEN
            RAISE EXCEPTION 'Both Winner and Runner-Up are required for sub-events with 2 or more eligible competitors (found % eligible competitors).', v_eligible_count;
        END IF;

        IF p_new_winner_team_id = p_new_runner_team_id THEN
            RAISE EXCEPTION 'Winner and Runner-Up cannot be the same candidate.';
        END IF;
    END IF;

    IF p_new_third_team_id IS NOT NULL THEN
        IF p_new_third_team_id = p_new_winner_team_id OR p_new_third_team_id = p_new_runner_team_id THEN
            RAISE EXCEPTION 'Third Place cannot be the same as Winner or Runner-Up.';
        END IF;
    END IF;

    -- 9. Server-side validation of candidates
    SELECT EXISTS (
        SELECT 1 FROM public.attendance_records ar
        JOIN public.teams t ON t.id = ar.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE t.id = p_new_winner_team_id
          AND ar.sub_event_id = p_sub_event_id
          AND r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED'
    ) INTO v_winner_valid;

    IF NOT v_winner_valid THEN
        RAISE EXCEPTION 'Selected Winner is not an eligible attended candidate for this sub-event.';
    END IF;

    IF p_new_runner_team_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_records ar
            JOIN public.teams t ON t.id = ar.team_id
            JOIN public.registrations r ON r.id = t.registration_id
            WHERE t.id = p_new_runner_team_id
              AND ar.sub_event_id = p_sub_event_id
              AND r.sub_event_id = p_sub_event_id
              AND r.status = 'CONFIRMED'
        ) INTO v_runner_valid;

        IF NOT v_runner_valid THEN
            RAISE EXCEPTION 'Selected Runner-Up is not an eligible attended candidate for this sub-event.';
        END IF;
    END IF;

    IF p_new_third_team_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_records ar
            JOIN public.teams t ON t.id = ar.team_id
            JOIN public.registrations r ON r.id = t.registration_id
            WHERE t.id = p_new_third_team_id
              AND ar.sub_event_id = p_sub_event_id
              AND r.sub_event_id = p_sub_event_id
              AND r.status = 'CONFIRMED'
        ) INTO v_third_valid;

        IF NOT v_third_valid THEN
            RAISE EXCEPTION 'Selected Third Place is not an eligible attended candidate for this sub-event.';
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 10. ATOMIC ACHIEVEMENT CERTIFICATE RECONCILIATION
    --     PARTICIPATION CERTIFICATES (type = 'PARTICIPANT') ARE FIREWALLED
    -- ------------------------------------------------------------------------

    -- 10a. Revoke old achievement certificates that are no longer valid
    FOR v_cert_record IN
        SELECT c.id, c.team_member_id, c.type, c.certificate_code, tm.team_id
        FROM public.certificates c
        JOIN public.team_members tm ON tm.id = c.team_member_id
        WHERE c.sub_event_id = p_sub_event_id
          AND c.type IN ('WINNER', 'RUNNER', 'THIRD_PLACE')
          AND c.status = 'UNLOCKED'
          AND (
              (c.type = 'WINNER' AND tm.team_id <> p_new_winner_team_id) OR
              (c.type = 'RUNNER' AND (p_new_runner_team_id IS NULL OR tm.team_id <> p_new_runner_team_id)) OR
              (c.type = 'THIRD_PLACE' AND (p_new_third_team_id IS NULL OR tm.team_id <> p_new_third_team_id))
          )
        FOR UPDATE OF c
    LOOP
        UPDATE public.certificates
        SET status = 'REVOKED',
            revoked_at = now(),
            revoked_reason = trim(p_correction_reason)
        WHERE id = v_cert_record.id;

        INSERT INTO public.certificate_revocation_logs (
            certificate_id,
            team_member_id,
            sub_event_id,
            certificate_type,
            certificate_code,
            reason,
            actor_id,
            actor_role,
            metadata,
            revoked_at
        ) VALUES (
            v_cert_record.id,
            v_cert_record.team_member_id,
            p_sub_event_id,
            v_cert_record.type,
            v_cert_record.certificate_code,
            trim(p_correction_reason),
            auth.uid(),
            'ADMIN',
            jsonb_build_object(
                'previous_team_id', v_cert_record.team_id,
                'action', 'RESULT_PUBLISHED_CORRECTED'
            ),
            now()
        );

        v_revoked_count := v_revoked_count + 1;
        v_revoked_cert_ids := array_append(v_revoked_cert_ids, v_cert_record.id);
    END LOOP;

    -- 10b. Issue or Reactivate WINNER certificates for attended members
    FOR v_member IN
        SELECT tm.id, tm.snapshot_name
        FROM public.team_members tm
        JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
        WHERE tm.team_id = p_new_winner_team_id
          AND ar.sub_event_id = p_sub_event_id
    LOOP
        SELECT certificate_code INTO v_cert_code 
        FROM public.certificates 
        WHERE team_member_id = v_member.id 
          AND sub_event_id = p_sub_event_id 
          AND type = 'WINNER';

        IF v_cert_code IS NULL THEN
            LOOP
                v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
            END LOOP;
        END IF;

        INSERT INTO public.certificates (
            team_member_id,
            sub_event_id,
            type,
            status,
            certificate_code,
            issued_at,
            revoked_at,
            revoked_reason
        ) VALUES (
            v_member.id,
            p_sub_event_id,
            'WINNER',
            'UNLOCKED',
            v_cert_code,
            now(),
            NULL,
            NULL
        )
        ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
            status = 'UNLOCKED',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
            issued_at = now(),
            revoked_at = NULL,
            revoked_reason = NULL;

        v_issued_count := v_issued_count + 1;
    END LOOP;

    -- 10c. Issue or Reactivate RUNNER certificates for attended members
    IF p_new_runner_team_id IS NOT NULL THEN
        FOR v_member IN
            SELECT tm.id, tm.snapshot_name
            FROM public.team_members tm
            JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
            WHERE tm.team_id = p_new_runner_team_id
              AND ar.sub_event_id = p_sub_event_id
        LOOP
            SELECT certificate_code INTO v_cert_code 
            FROM public.certificates 
            WHERE team_member_id = v_member.id 
              AND sub_event_id = p_sub_event_id 
              AND type = 'RUNNER';

            IF v_cert_code IS NULL THEN
                LOOP
                    v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
                END LOOP;
            END IF;

            INSERT INTO public.certificates (
                team_member_id,
                sub_event_id,
                type,
                status,
                certificate_code,
                issued_at,
                revoked_at,
                revoked_reason
            ) VALUES (
                v_member.id,
                p_sub_event_id,
                'RUNNER',
                'UNLOCKED',
                v_cert_code,
                now(),
                NULL,
                NULL
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                status = 'UNLOCKED',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
                issued_at = now(),
                revoked_at = NULL,
                revoked_reason = NULL;

            v_issued_count := v_issued_count + 1;
        END LOOP;
    END IF;

    -- 10d. Issue or Reactivate THIRD_PLACE certificates for attended members
    IF p_new_third_team_id IS NOT NULL THEN
        FOR v_member IN
            SELECT tm.id, tm.snapshot_name
            FROM public.team_members tm
            JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
            WHERE tm.team_id = p_new_third_team_id
              AND ar.sub_event_id = p_sub_event_id
        LOOP
            SELECT certificate_code INTO v_cert_code 
            FROM public.certificates 
            WHERE team_member_id = v_member.id 
              AND sub_event_id = p_sub_event_id 
              AND type = 'THIRD_PLACE';

            IF v_cert_code IS NULL THEN
                LOOP
                    v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
                END LOOP;
            END IF;

            INSERT INTO public.certificates (
                team_member_id,
                sub_event_id,
                type,
                status,
                certificate_code,
                issued_at,
                revoked_at,
                revoked_reason
            ) VALUES (
                v_member.id,
                p_sub_event_id,
                'THIRD_PLACE',
                'UNLOCKED',
                v_cert_code,
                now(),
                NULL,
                NULL
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                status = 'UNLOCKED',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
                issued_at = now(),
                revoked_at = NULL,
                revoked_reason = NULL;

            v_issued_count := v_issued_count + 1;
        END LOOP;
    END IF;

    -- 11. Update sub_events row
    UPDATE public.sub_events
    SET winner_team_id = p_new_winner_team_id,
        runner_team_id = p_new_runner_team_id,
        third_team_id = p_new_third_team_id,
        updated_at = now()
    WHERE id = p_sub_event_id;

    -- 12. Update result_submissions row (if exists)
    UPDATE public.result_submissions
    SET winner_team_id = p_new_winner_team_id,
        runner_team_id = p_new_runner_team_id,
        third_team_id = p_new_third_team_id,
        status = 'APPROVED',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        updated_at = now()
    WHERE sub_event_id = p_sub_event_id;

    -- 13. Write immutable audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        auth.uid(),
        'RESULT_PUBLISHED_CORRECTED',
        'sub_events',
        p_sub_event_id,
        jsonb_build_object(
            'sub_event_id', p_sub_event_id,
            'previous_winner_team_id', v_sub_event.winner_team_id,
            'new_winner_team_id', p_new_winner_team_id,
            'previous_runner_team_id', v_sub_event.runner_team_id,
            'new_runner_team_id', p_new_runner_team_id,
            'previous_third_team_id', v_sub_event.third_team_id,
            'new_third_team_id', p_new_third_team_id,
            'reason', trim(p_correction_reason),
            'revoked_certificates_count', v_revoked_count,
            'issued_certificates_count', v_issued_count,
            'revoked_certificate_ids', v_revoked_cert_ids
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'revoked_count', v_revoked_count,
        'issued_count', v_issued_count,
        'message', 'Published results corrected and achievement certificates reconciled successfully.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_correct_published_sub_event_result(UUID, UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_published_sub_event_result(UUID, UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 7. RE-APPLY admin_get_result_submissions INCLUDING updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_result_submissions(
    p_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_submissions JSONB;
BEGIN
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can access result submissions.';
    END IF;

    WITH submission_details AS (
        SELECT 
            rs.id AS submission_id,
            rs.status,
            rs.rejection_reason,
            rs.submitted_at,
            rs.reviewed_at,
            rs.reviewed_by,
            rs.created_at,
            rs.updated_at,
            se.id AS sub_event_id,
            se.name AS sub_event_name,
            se.participation_type,
            COALESCE(cat.name, 'General') AS category_name,
            COALESCE(e.name, ce.name, 'Event') AS event_name,
            c.id AS coordinator_id,
            c.display_name AS coordinator_name,
            c.username AS coordinator_username,
            
            -- Winner info
            jsonb_build_object(
                'team_id', wt.id,
                'team_name', COALESCE(
                    NULLIF(wt.team_name, 'Solo Participant'),
                    (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = wt.id LIMIT 1),
                    wt.team_name
                ),
                'is_team', (
                    SELECT COUNT(*) > 1 OR (wt.team_name IS NOT NULL AND wt.team_name <> 'Solo Participant')
                    FROM public.team_members tm WHERE tm.team_id = wt.id
                ),
                'leader_name', (
                    SELECT tm.snapshot_name FROM public.team_members tm 
                    WHERE tm.team_id = wt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                ),
                'leader_roll', (
                    SELECT tm.snapshot_roll_number FROM public.team_members tm 
                    WHERE tm.team_id = wt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                ),
                'leader_college', (
                    SELECT tm.snapshot_college FROM public.team_members tm 
                    WHERE tm.team_id = wt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                ),
                'leader_dept', (
                    SELECT tm.snapshot_department FROM public.team_members tm 
                    WHERE tm.team_id = wt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                ),
                'leader_year', (
                    SELECT tm.snapshot_year FROM public.team_members tm 
                    WHERE tm.team_id = wt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                ),
                'members', (
                    SELECT COALESCE(jsonb_agg(
                        jsonb_build_object(
                            'member_id', wtm.id,
                            'name', wtm.snapshot_name,
                            'roll_number', wtm.snapshot_roll_number,
                            'college', wtm.snapshot_college,
                            'department', wtm.snapshot_department,
                            'year', wtm.snapshot_year,
                            'is_leader', wtm.is_leader,
                            'is_attended', EXISTS (
                                SELECT 1 FROM public.attendance_records ar 
                                WHERE ar.scanned_member_id = wtm.id AND ar.sub_event_id = rs.sub_event_id
                            )
                        ) ORDER BY wtm.is_leader DESC, wtm.created_at ASC
                    ), '[]'::jsonb)
                    FROM public.team_members wtm
                    WHERE wtm.team_id = wt.id
                )
            ) AS winner_info,

            -- Runner info
            CASE WHEN rt.id IS NOT NULL THEN
                jsonb_build_object(
                    'team_id', rt.id,
                    'team_name', COALESCE(
                        NULLIF(rt.team_name, 'Solo Participant'),
                        (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = rt.id LIMIT 1),
                        rt.team_name
                    ),
                    'is_team', (
                        SELECT COUNT(*) > 1 OR (rt.team_name IS NOT NULL AND rt.team_name <> 'Solo Participant')
                        FROM public.team_members tm WHERE tm.team_id = rt.id
                    ),
                    'leader_name', (
                        SELECT tm.snapshot_name FROM public.team_members tm 
                        WHERE tm.team_id = rt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                    ),
                    'leader_roll', (
                        SELECT tm.snapshot_roll_number FROM public.team_members tm 
                        WHERE tm.team_id = rt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                    ),
                    'leader_college', (
                        SELECT tm.snapshot_college FROM public.team_members tm 
                        WHERE tm.team_id = rt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                    ),
                    'leader_dept', (
                        SELECT tm.snapshot_department FROM public.team_members tm 
                        WHERE tm.team_id = rt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                    ),
                    'leader_year', (
                        SELECT tm.snapshot_year FROM public.team_members tm 
                        WHERE tm.team_id = rt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                    ),
                    'members', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'member_id', rtm.id,
                                'name', rtm.snapshot_name,
                                'roll_number', rtm.snapshot_roll_number,
                                'college', rtm.snapshot_college,
                                'department', rtm.snapshot_department,
                                'year', rtm.snapshot_year,
                                'is_leader', rtm.is_leader,
                                'is_attended', EXISTS (
                                    SELECT 1 FROM public.attendance_records ar 
                                    WHERE ar.scanned_member_id = rtm.id AND ar.sub_event_id = rs.sub_event_id
                                )
                            ) ORDER BY rtm.is_leader DESC, rtm.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.team_members rtm
                        WHERE rtm.team_id = rt.id
                    )
                )
            ELSE NULL END AS runner_info,

            -- Third info
            CASE WHEN tt.id IS NOT NULL THEN
                jsonb_build_object(
                    'team_id', tt.id,
                    'team_name', COALESCE(
                        NULLIF(tt.team_name, 'Solo Participant'),
                        (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = tt.id LIMIT 1),
                        tt.team_name
                    ),
                    'is_team', (
                        SELECT COUNT(*) > 1 OR (tt.team_name IS NOT NULL AND tt.team_name <> 'Solo Participant')
                        FROM public.team_members tm WHERE tm.team_id = tt.id
                    ),
                    'leader_name', (
                        SELECT tm.snapshot_name FROM public.team_members tm 
                        WHERE tm.team_id = tt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                    ),
                    'leader_roll', (
                        SELECT tm.snapshot_roll_number FROM public.team_members tm 
                        WHERE tm.team_id = tt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                    ),
                    'leader_college', (
                        SELECT tm.snapshot_college FROM public.team_members tm 
                        WHERE tm.team_id = tt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                    ),
                    'leader_dept', (
                        SELECT tm.snapshot_department FROM public.team_members tm 
                        WHERE tm.team_id = tt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                    ),
                    'leader_year', (
                        SELECT tm.snapshot_year FROM public.team_members tm 
                        WHERE tm.team_id = tt.id ORDER BY tm.is_leader DESC, tm.created_at ASC LIMIT 1
                    ),
                    'members', (
                        SELECT COALESCE(jsonb_agg(
                            jsonb_build_object(
                                'member_id', ttm.id,
                                'name', ttm.snapshot_name,
                                'roll_number', ttm.snapshot_roll_number,
                                'college', ttm.snapshot_college,
                                'department', ttm.snapshot_department,
                                'year', ttm.snapshot_year,
                                'is_leader', ttm.is_leader,
                                'is_attended', EXISTS (
                                    SELECT 1 FROM public.attendance_records ar 
                                    WHERE ar.scanned_member_id = ttm.id AND ar.sub_event_id = rs.sub_event_id
                                )
                            ) ORDER BY ttm.is_leader DESC, ttm.created_at ASC
                        ), '[]'::jsonb)
                        FROM public.team_members ttm
                        WHERE ttm.team_id = tt.id
                    )
                )
            ELSE NULL END AS third_info

        FROM public.result_submissions rs
        JOIN public.sub_events se ON se.id = rs.sub_event_id
        LEFT JOIN public.events e ON e.id = se.event_id
        LEFT JOIN public.categories cat ON cat.id = se.category_id
        LEFT JOIN public.events ce ON ce.id = cat.event_id
        JOIN public.coordinators c ON c.id = rs.coordinator_id
        JOIN public.teams wt ON wt.id = rs.winner_team_id
        LEFT JOIN public.teams rt ON rt.id = rs.runner_team_id
        LEFT JOIN public.teams tt ON tt.id = rs.third_team_id
        WHERE (p_status IS NULL OR rs.status = p_status)
        ORDER BY rs.submitted_at DESC
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'submission_id', sd.submission_id,
            'status', sd.status,
            'rejection_reason', sd.rejection_reason,
            'submitted_at', sd.submitted_at,
            'reviewed_at', sd.reviewed_at,
            'reviewed_by', sd.reviewed_by,
            'created_at', sd.created_at,
            'updated_at', sd.updated_at,
            'sub_event_id', sd.sub_event_id,
            'sub_event_name', sd.sub_event_name,
            'participation_type', sd.participation_type,
            'category_name', sd.category_name,
            'event_name', sd.event_name,
            'coordinator_id', sd.coordinator_id,
            'coordinator_name', sd.coordinator_name,
            'coordinator_username', sd.coordinator_username,
            'winner', sd.winner_info,
            'runner', sd.runner_info,
            'third', sd.third_info
        )
    ), '[]'::jsonb)
    INTO v_submissions
    FROM submission_details sd;

    RETURN v_submissions;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_result_submissions(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_result_submissions(TEXT) TO authenticated, service_role;
