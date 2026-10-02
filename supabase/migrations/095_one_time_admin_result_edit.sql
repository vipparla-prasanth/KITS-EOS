-- =============================================================================
-- Migration 095: KITS-EOS One-Time Admin Result Editing Workflow
-- Strict Server-Side Business Rule: Maximum 1 Edit for Approved/Published Results
-- =============================================================================

-- 1. ADD RESULT EDIT TRACKING COLUMNS TO sub_events & result_submissions
ALTER TABLE public.sub_events
    ADD COLUMN IF NOT EXISTS result_edit_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS result_edited_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS result_edited_by UUID DEFAULT NULL REFERENCES public.users(id),
    ADD COLUMN IF NOT EXISTS result_edit_reason TEXT DEFAULT NULL;

-- Enforce strict database-level constraint: result_edit_count can never exceed 1
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_sub_events_result_edit_count'
    ) THEN
        ALTER TABLE public.sub_events
            ADD CONSTRAINT chk_sub_events_result_edit_count 
            CHECK (result_edit_count >= 0 AND result_edit_count <= 1);
    END IF;
END $$;

ALTER TABLE public.result_submissions
    ADD COLUMN IF NOT EXISTS result_edit_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS result_edited_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS result_edited_by UUID DEFAULT NULL REFERENCES public.users(id),
    ADD COLUMN IF NOT EXISTS result_edit_reason TEXT DEFAULT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_result_submissions_result_edit_count'
    ) THEN
        ALTER TABLE public.result_submissions
            ADD CONSTRAINT chk_result_submissions_result_edit_count 
            CHECK (result_edit_count >= 0 AND result_edit_count <= 1);
    END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 2. SECURE OLD / MANUAL OVERRIDE PATHS AGAINST MODIFYING PUBLISHED RESULTS
-- ----------------------------------------------------------------------------

-- 2a. Secure lock_sub_event_podium_position:
-- Reject any attempt to modify podium positions if results are already published.
CREATE OR REPLACE FUNCTION public.lock_sub_event_podium_position(
    p_sub_event_id UUID, 
    p_position TEXT, 
    p_team_id UUID DEFAULT NULL::UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_sub_event RECORD;
    v_actor_id UUID;
    v_actor_email TEXT;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Administrative privileges required to lock podium positions.';
    END IF;

    SELECT * INTO v_sub_event FROM public.sub_events WHERE id = p_sub_event_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found.';
    END IF;

    -- Security Guard: Published results cannot be modified via lock_sub_event_podium_position
    IF v_sub_event.results_published IS TRUE THEN
        RAISE EXCEPTION 'Sub-event results are already published. Podium positions cannot be modified using this function. Use the one-time published result correction workflow.';
    END IF;

    SELECT email INTO v_actor_email FROM public.users WHERE id = v_actor_id;

    IF p_position = 'WINNER' THEN
        IF p_team_id IS NULL THEN
            RAISE EXCEPTION 'Winner team ID is required.';
        END IF;
        UPDATE public.sub_events
        SET winner_team_id = p_team_id,
            updated_at = now()
        WHERE id = p_sub_event_id;

    ELSIF p_position = 'RUNNER' THEN
        IF p_team_id IS NULL THEN
            RAISE EXCEPTION 'Runner-Up team ID is required.';
        END IF;
        IF p_team_id = v_sub_event.winner_team_id THEN
            RAISE EXCEPTION 'Runner-Up cannot be the same team as the Winner.';
        END IF;
        UPDATE public.sub_events
        SET runner_team_id = p_team_id,
            updated_at = now()
        WHERE id = p_sub_event_id;

    ELSIF p_position = 'THIRD_PLACE' THEN
        IF p_team_id IS NULL THEN
            RAISE EXCEPTION 'Third place team ID is required.';
        END IF;
        IF p_team_id = v_sub_event.winner_team_id OR p_team_id = v_sub_event.runner_team_id THEN
            RAISE EXCEPTION 'Third Place cannot be the same as Winner or Runner-Up.';
        END IF;
        UPDATE public.sub_events
        SET third_team_id = p_team_id,
            updated_at = now()
        WHERE id = p_sub_event_id;

    ELSIF p_position = 'SKIP_THIRD' THEN
        UPDATE public.sub_events
        SET third_team_id = NULL,
            updated_at = now()
        WHERE id = p_sub_event_id;

    ELSE
        RAISE EXCEPTION 'Invalid position: %', p_position;
    END IF;

    -- Record audit log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_actor_id,
        'LOCK_PODIUM_POSITION',
        'sub_events',
        p_sub_event_id,
        jsonb_build_object(
            'sub_event_id', p_sub_event_id,
            'position', p_position,
            'team_id', p_team_id,
            'locked_by', COALESCE(v_actor_email, v_actor_id::text)
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'position', p_position,
        'team_id', p_team_id
    );
END;
$$;


-- 2b. Secure publish_sub_event_results_and_certificates:
-- Reject re-publishing if results are already published!
CREATE OR REPLACE FUNCTION public.publish_sub_event_results_and_certificates(
    p_sub_event_id UUID,
    p_winner_team_id UUID DEFAULT NULL,
    p_runner_team_id UUID DEFAULT NULL,
    p_third_team_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_sub_event RECORD;
    v_member RECORD;
    v_cert_code TEXT;
    v_cert_count INT := 0;
    v_winner_count INT := 0;
    v_runner_count INT := 0;
    v_third_count INT := 0;
    v_participant_count INT := 0;
    v_eligible_competitors INT := 0;
    v_is_direct_publish BOOLEAN := FALSE;
BEGIN
    -- 1. Authorization Check: Admin Only
    IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can publish results and issue certificates.';
    END IF;

    -- 2. Verify sub-event exists and lock row
    SELECT * INTO v_sub_event FROM public.sub_events WHERE id = p_sub_event_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found: %', p_sub_event_id;
    END IF;

    -- Security Guard: Reject if results are already published!
    IF v_sub_event.results_published IS TRUE THEN
        RAISE EXCEPTION 'Sub-event results are already published. Published results can only be corrected through the secure one-time result correction workflow.';
    END IF;

    -- 3. Count authoritative eligible competitors
    IF v_sub_event.participation_type = 'SOLO' THEN
        SELECT COUNT(DISTINCT tm.id) INTO v_eligible_competitors
        FROM public.team_members tm
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id AND ar.sub_event_id = p_sub_event_id
        WHERE r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED';
    ELSE
        SELECT COUNT(DISTINCT t.id) INTO v_eligible_competitors
        FROM public.teams t
        JOIN public.registrations r ON r.id = t.registration_id
        JOIN public.attendance_records ar ON ar.team_id = t.id AND ar.sub_event_id = p_sub_event_id
        WHERE r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED';
    END IF;

    IF v_eligible_competitors < 2 THEN
        v_is_direct_publish := TRUE;
    ELSE
        v_is_direct_publish := FALSE;
    END IF;

    -- 4. Normal Workflow Validation (if >= 2 competitors)
    IF NOT v_is_direct_publish THEN
        IF p_winner_team_id IS NULL OR p_runner_team_id IS NULL THEN
            RAISE EXCEPTION 'Winner and Runner-Up teams are required for sub-events with 2 or more competitors (found % eligible competitors).', v_eligible_competitors;
        END IF;

        IF p_winner_team_id = p_runner_team_id THEN
            RAISE EXCEPTION 'Winner and Runner-Up cannot be the same team.';
        END IF;

        IF p_third_team_id IS NOT NULL THEN
            IF p_third_team_id = p_winner_team_id OR p_third_team_id = p_runner_team_id THEN
                RAISE EXCEPTION 'Third Place cannot be the same as Winner or Runner-Up.';
            END IF;
        END IF;

        -- 4a. Process Winner Team
        FOR v_member IN
            SELECT tm.id, tm.snapshot_name
            FROM public.team_members tm
            JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
            WHERE tm.team_id = p_winner_team_id
              AND ar.sub_event_id = p_sub_event_id
        LOOP
            SELECT certificate_code INTO v_cert_code 
            FROM public.certificates 
            WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id AND type = 'WINNER';

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
                issued_at
            ) VALUES (
                v_member.id,
                p_sub_event_id,
                'WINNER',
                'UNLOCKED',
                v_cert_code,
                NOW()
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                status = 'UNLOCKED',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

            v_winner_count := v_winner_count + 1;
            v_cert_count := v_cert_count + 1;
        END LOOP;

        -- 4b. Process Runner Team
        FOR v_member IN
            SELECT tm.id, tm.snapshot_name
            FROM public.team_members tm
            JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
            WHERE tm.team_id = p_runner_team_id
              AND ar.sub_event_id = p_sub_event_id
        LOOP
            SELECT certificate_code INTO v_cert_code 
            FROM public.certificates 
            WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id AND type = 'RUNNER';

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
                issued_at
            ) VALUES (
                v_member.id,
                p_sub_event_id,
                'RUNNER',
                'UNLOCKED',
                v_cert_code,
                NOW()
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                status = 'UNLOCKED',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

            v_runner_count := v_runner_count + 1;
            v_cert_count := v_cert_count + 1;
        END LOOP;

        -- 4c. Process Optional Third Place Team
        IF p_third_team_id IS NOT NULL THEN
            FOR v_member IN
                SELECT tm.id, tm.snapshot_name
                FROM public.team_members tm
                JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
                WHERE tm.team_id = p_third_team_id
                  AND ar.sub_event_id = p_sub_event_id
            LOOP
                SELECT certificate_code INTO v_cert_code 
                FROM public.certificates 
                WHERE team_member_id = v_member.id AND sub_event_id = p_sub_event_id AND type = 'THIRD_PLACE';

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
                    issued_at
                ) VALUES (
                    v_member.id,
                    p_sub_event_id,
                    'THIRD_PLACE',
                    'UNLOCKED',
                    v_cert_code,
                    NOW()
                )
                ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                    status = 'UNLOCKED',
                    certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

                v_third_count := v_third_count + 1;
                v_cert_count := v_cert_count + 1;
            END LOOP;
        END IF;
    END IF;

    -- Update sub_events table with locked & published status
    IF v_is_direct_publish THEN
        UPDATE public.sub_events
        SET results_locked = TRUE,
            results_published = TRUE,
            results_published_at = NOW(),
            winner_team_id = NULL,
            runner_team_id = NULL,
            third_team_id = NULL,
            updated_at = NOW()
        WHERE id = p_sub_event_id;
    ELSE
        UPDATE public.sub_events
        SET results_locked = TRUE,
            results_published = TRUE,
            results_published_at = NOW(),
            winner_team_id = p_winner_team_id,
            runner_team_id = p_runner_team_id,
            third_team_id = p_third_team_id,
            updated_at = NOW()
        WHERE id = p_sub_event_id;
    END IF;

    -- Record Audit Log
    INSERT INTO public.audit_logs (
        action,
        actor_id,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        CASE WHEN v_is_direct_publish THEN 'DIRECT_PUBLISH_RESULTS' ELSE 'PUBLISH_RESULTS' END,
        auth.uid(),
        'sub_events',
        p_sub_event_id,
        jsonb_build_object(
            'is_direct_publish', v_is_direct_publish,
            'eligible_competitors', v_eligible_competitors,
            'winner_team_id', p_winner_team_id,
            'runner_team_id', p_runner_team_id,
            'third_team_id', p_third_team_id,
            'winner_count', v_winner_count,
            'runner_count', v_runner_count,
            'third_count', v_third_count,
            'participant_count', v_participant_count,
            'total_certificates', v_cert_count
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'mode', CASE WHEN v_is_direct_publish THEN 'DIRECT_PUBLISHED' ELSE 'NORMAL_PUBLISHED' END,
        'is_direct_publish', v_is_direct_publish,
        'eligible_competitors', v_eligible_competitors,
        'winner_count', v_winner_count,
        'runner_count', v_runner_count,
        'third_count', v_third_count,
        'total_certificates', v_cert_count
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 3. ONE-TIME ATOMIC ADMIN PUBLISHED RESULT CORRECTION RPC
--    Enforces:
--    - Admin auth only
--    - Two-step confirmation security phrase: 'CONFIRM RESULT EDIT'
--    - Mandatory reason >= 10 characters
--    - Maximum 1 edit: result_edit_count MUST BE 0 before edit.
--    - Increments result_edit_count to 1 atomically.
--    - Concurrency check via expected_updated_at and FOR UPDATE row lock.
--    - Full candidate validation and attendance verification.
--    - Reconciles achievement certificates.
--    - Participation certificates strictly untouched.
--    - Immutable audit logs with edit_count_before and edit_count_after.
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
    IF trim(COALESCE(p_confirmation_token, '')) <> 'CONFIRM RESULT EDIT' THEN
        RAISE EXCEPTION 'Security confirmation failed: You must type CONFIRM RESULT EDIT exactly.';
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

    -- Verify results are published
    IF v_sub_event.results_published IS NOT TRUE THEN
        RAISE EXCEPTION 'Sub-event results are not yet published. You can edit pending submissions prior to approval.';
    END IF;

    -- 5. STRICT BUSINESS RULE: MAXIMUM ONE-TIME EDIT ENFORCEMENT
    IF v_sub_event.result_edit_count >= 1 THEN
        RAISE EXCEPTION 'Result correction has already been used for this result. Published results can only be edited once.';
    END IF;

    -- 6. Optimistic Concurrency Check
    IF p_expected_updated_at IS NOT NULL AND v_sub_event.updated_at <> p_expected_updated_at THEN
        RAISE EXCEPTION 'Result was modified by another administrator. Please refresh before editing.';
    END IF;

    -- 7. Verify that proposed podium is actually different from current podium
    IF p_new_winner_team_id = v_sub_event.winner_team_id 
       AND ((p_new_runner_team_id IS NULL AND v_sub_event.runner_team_id IS NULL) OR p_new_runner_team_id = v_sub_event.runner_team_id)
       AND ((p_new_third_team_id IS NULL AND v_sub_event.third_team_id IS NULL) OR p_new_third_team_id = v_sub_event.third_team_id) THEN
        RAISE EXCEPTION 'Proposed podium result is identical to the current result. No change to apply.';
    END IF;

    -- 8. Count eligible competitors
    SELECT COUNT(DISTINCT ar.team_id) INTO v_eligible_count
    FROM public.attendance_records ar
    JOIN public.teams t ON t.id = ar.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE ar.sub_event_id = p_sub_event_id
      AND r.sub_event_id = p_sub_event_id
      AND r.status = 'CONFIRMED';

    IF v_eligible_count = 0 THEN
        RAISE EXCEPTION 'Cannot declare result: No eligible competitors have attended check-in for this sub-event.';
    END IF;

    -- 9. Validate Podium Candidates Uniqueness & Count Requirements
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

    -- 10. Server-Side Candidate Attendance & Registration Validation
    -- Winner
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

    -- Runner
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

    -- Third Place
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
    -- 11. ATOMIC CERTIFICATE RECONCILIATION
    -- ------------------------------------------------------------------------
    -- 11a. Invalidate achievement certificates that no longer match the corrected result
    FOR v_cert_record IN
        SELECT c.id, c.team_member_id, c.type, c.certificate_code, tm.snapshot_name, tm.team_id
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
        -- Invalidate certificate
        UPDATE public.certificates
        SET status = 'REVOKED',
            revoked_at = now(),
            revoked_reason = trim(p_correction_reason)
        WHERE id = v_cert_record.id;

        -- Record in audit log of revoked certificates
        INSERT INTO public.certificate_revocation_logs (
            certificate_id,
            sub_event_id,
            team_member_id,
            certificate_type,
            certificate_code,
            reason,
            actor_id,
            actor_role,
            metadata,
            revoked_at
        ) VALUES (
            v_cert_record.id,
            p_sub_event_id,
            v_cert_record.team_member_id,
            v_cert_record.type,
            v_cert_record.certificate_code,
            trim(p_correction_reason),
            COALESCE(auth.uid(), (SELECT id FROM public.users WHERE role = 'ADMIN' LIMIT 1)),
            'ADMIN',
            jsonb_build_object(
                'sub_event_name', v_sub_event.name,
                'team_name', (SELECT team_name FROM public.teams WHERE id = v_cert_record.team_id)
            ),
            now()
        );

        v_revoked_cert_ids := array_append(v_revoked_cert_ids, v_cert_record.id);
        v_revoked_count := v_revoked_count + 1;
    END LOOP;

    -- 11b. Issue / Unlock achievement certificates for NEW Winner team members
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
            revoked_at = NULL,
            revoked_reason = NULL,
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

        v_issued_count := v_issued_count + 1;
    END LOOP;

    -- 11c. Issue / Unlock achievement certificates for NEW Runner team members
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
                revoked_at = NULL,
                revoked_reason = NULL,
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

            v_issued_count := v_issued_count + 1;
        END LOOP;
    END IF;

    -- 11d. Issue / Unlock achievement certificates for NEW Third Place team members
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
                revoked_at = NULL,
                revoked_reason = NULL,
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

            v_issued_count := v_issued_count + 1;
        END LOOP;
    END IF;

    -- ------------------------------------------------------------------------
    -- 12. ATOMICALLY UPDATE SUB_EVENTS WITH NEW PODIUM AND SET EDIT_COUNT = 1
    -- ------------------------------------------------------------------------
    UPDATE public.sub_events
    SET winner_team_id = p_new_winner_team_id,
        runner_team_id = p_new_runner_team_id,
        third_team_id = p_new_third_team_id,
        result_edit_count = 1,
        result_edited_at = now(),
        result_edited_by = auth.uid(),
        result_edit_reason = trim(p_correction_reason),
        updated_at = now()
    WHERE id = p_sub_event_id;

    -- 13. Synchronize corresponding result_submissions row
    UPDATE public.result_submissions
    SET winner_team_id = p_new_winner_team_id,
        runner_team_id = p_new_runner_team_id,
        third_team_id = p_new_third_team_id,
        status = 'ADMIN_CORRECTED',
        result_edit_count = 1,
        result_edited_at = now(),
        result_edited_by = auth.uid(),
        result_edit_reason = trim(p_correction_reason),
        updated_at = now()
    WHERE sub_event_id = p_sub_event_id;

    -- 14. Record Immutable Audit Event (action = 'RESULT_EDITED')
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        auth.uid(),
        'RESULT_EDITED',
        'sub_events',
        p_sub_event_id,
        jsonb_build_object(
            'actor_role', 'ADMIN',
            'sub_event_id', p_sub_event_id,
            'previous_winner_team_id', v_sub_event.winner_team_id,
            'new_winner_team_id', p_new_winner_team_id,
            'previous_runner_team_id', v_sub_event.runner_team_id,
            'new_runner_team_id', p_new_runner_team_id,
            'previous_third_team_id', v_sub_event.third_team_id,
            'new_third_team_id', p_new_third_team_id,
            'edit_count_before', 0,
            'edit_count_after', 1,
            'reason', trim(p_correction_reason),
            'revoked_certificate_ids', v_revoked_cert_ids,
            'revoked_count', v_revoked_count,
            'issued_count', v_issued_count,
            'timestamp', now()
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'result_edit_count', 1,
        'revoked_count', v_revoked_count,
        'issued_count', v_issued_count,
        'message', 'Published result corrected successfully. One-time edit consumed; result is now permanently locked from further editing.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_correct_published_sub_event_result(UUID, UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_published_sub_event_result(UUID, UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 4. UPDATE admin_get_result_submissions TO EXPOSE edit_count AND EDIT METADATA
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
        RAISE EXCEPTION 'Unauthorized: Only system administrators can view result submissions.';
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
            rs.sub_event_id,
            se.name AS sub_event_name,
            se.participation_type::text AS participation_type,
            se.result_edit_count,
            se.result_edited_at,
            se.result_edited_by,
            se.result_edit_reason,
            COALESCE(cat.name, 'General') AS category_name,
            COALESCE(e.name, ce.name, 'Event') AS event_name,
            rs.coordinator_id,
            c.name AS coordinator_name,
            c.username AS coordinator_username,
            
            -- Winner Team Info
            jsonb_build_object(
                'team_id', wt.id,
                'team_name', wt.team_name,
                'leader_name', (
                    SELECT tm.snapshot_name FROM public.team_members tm 
                    WHERE tm.team_id = wt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                ),
                'leader_roll', (
                    SELECT tm.snapshot_roll_number FROM public.team_members tm 
                    WHERE tm.team_id = wt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                ),
                'leader_college', (
                    SELECT tm.snapshot_college FROM public.team_members tm 
                    WHERE tm.team_id = wt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                ),
                'leader_dept', (
                    SELECT tm.snapshot_department FROM public.team_members tm 
                    WHERE tm.team_id = wt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                ),
                'leader_year', (
                    SELECT tm.snapshot_year FROM public.team_members tm 
                    WHERE tm.team_id = wt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
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
                        ) ORDER BY wtm.is_leader DESC, wtm.id ASC
                    ), '[]'::jsonb)
                    FROM public.team_members wtm
                    WHERE wtm.team_id = wt.id
                )
            ) AS winner_info,

            -- Runner Team Info
            CASE WHEN rt.id IS NOT NULL THEN
                jsonb_build_object(
                    'team_id', rt.id,
                    'team_name', rt.team_name,
                    'leader_name', (
                        SELECT tm.snapshot_name FROM public.team_members tm 
                        WHERE tm.team_id = rt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                    ),
                    'leader_roll', (
                        SELECT tm.snapshot_roll_number FROM public.team_members tm 
                        WHERE tm.team_id = rt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                    ),
                    'leader_college', (
                        SELECT tm.snapshot_college FROM public.team_members tm 
                        WHERE tm.team_id = rt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                    ),
                    'leader_dept', (
                        SELECT tm.snapshot_department FROM public.team_members tm 
                        WHERE tm.team_id = rt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                    ),
                    'leader_year', (
                        SELECT tm.snapshot_year FROM public.team_members tm 
                        WHERE tm.team_id = rt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
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
                            ) ORDER BY rtm.is_leader DESC, rtm.id ASC
                        ), '[]'::jsonb)
                        FROM public.team_members rtm
                        WHERE rtm.team_id = rt.id
                    )
                )
            ELSE NULL END AS runner_info,

            -- Third Place Team Info
            CASE WHEN tt.id IS NOT NULL THEN
                jsonb_build_object(
                    'team_id', tt.id,
                    'team_name', tt.team_name,
                    'leader_name', (
                        SELECT tm.snapshot_name FROM public.team_members tm 
                        WHERE tm.team_id = tt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                    ),
                    'leader_roll', (
                        SELECT tm.snapshot_roll_number FROM public.team_members tm 
                        WHERE tm.team_id = tt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                    ),
                    'leader_college', (
                        SELECT tm.snapshot_college FROM public.team_members tm 
                        WHERE tm.team_id = tt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                    ),
                    'leader_dept', (
                        SELECT tm.snapshot_department FROM public.team_members tm 
                        WHERE tm.team_id = tt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
                    ),
                    'leader_year', (
                        SELECT tm.snapshot_year FROM public.team_members tm 
                        WHERE tm.team_id = tt.id ORDER BY tm.is_leader DESC, tm.id ASC LIMIT 1
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
                            ) ORDER BY ttm.is_leader DESC, ttm.id ASC
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
            'result_edit_count', sd.result_edit_count,
            'result_edited_at', sd.result_edited_at,
            'result_edited_by', sd.result_edited_by,
            'result_edit_reason', sd.result_edit_reason,
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
