-- ============================================================================
-- Migration 093: Coordinator Result Submission & Admin Approval Workflow
-- ============================================================================
-- ADDITIVE WORKFLOW:
-- 1. Coordinator Result Submission:
--    - Scoped strictly to sub-events assigned to the calling coordinator.
--    - Validates attended, confirmed eligibility server-side.
--    - Coordinator submits proposed Winner, Runner, and optional Third Place.
--    - Status transitions to 'PENDING_ADMIN_APPROVAL'.
--    - No achievement certificates are generated at submission time.
--
-- 2. Admin Review & Approval / Rejection:
--    - Admins review pending submissions with comprehensive participant/team
--      roster information (names, colleges, departments, roll numbers, attendance).
--    - On Rejection: Admin provides mandatory reason, status becomes 'REJECTED'.
--      Coordinator is notified/sees reason and can revise and resubmit.
--    - On Approval: Atomically & idempotently publishes sub-event results and
--      generates individual achievement certificates for eligible attended members.
--    - Inter-college teams have individual certificates created with each member's
--      own snapshot college, roll number, and department.
--
-- 3. Strict Invariants Preserved:
--    - Attendance requirement remains mandatory. Absent participants NEVER get
--      achievement certificates.
--    - Participation certificate lifecycle is NOT disturbed (attendance-driven,
--      feedback-gated).
--    - Result approval does NOT unlock or bypass feedback for participation certs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RESULT SUBMISSIONS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.result_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_event_id UUID NOT NULL REFERENCES public.sub_events(id) ON DELETE CASCADE,
    coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE CASCADE,
    winner_team_id UUID NOT NULL REFERENCES public.teams(id),
    runner_team_id UUID REFERENCES public.teams(id),
    third_team_id UUID REFERENCES public.teams(id),
    status TEXT NOT NULL DEFAULT 'PENDING_ADMIN_APPROVAL' 
        CHECK (status IN ('PENDING_ADMIN_APPROVAL', 'APPROVED', 'REJECTED')),
    rejection_reason TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for high-performance filtering & joins
CREATE INDEX IF NOT EXISTS idx_result_submissions_sub_event_id 
    ON public.result_submissions(sub_event_id);
CREATE INDEX IF NOT EXISTS idx_result_submissions_coordinator_id 
    ON public.result_submissions(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_result_submissions_status 
    ON public.result_submissions(status);
CREATE INDEX IF NOT EXISTS idx_result_submissions_submitted_at 
    ON public.result_submissions(submitted_at DESC);

-- Enforce at most ONE active pending submission per sub-event
CREATE UNIQUE INDEX IF NOT EXISTS idx_result_submissions_pending_unique 
    ON public.result_submissions(sub_event_id) 
    WHERE status = 'PENDING_ADMIN_APPROVAL';

-- Row Level Security
ALTER TABLE public.result_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on result_submissions" ON public.result_submissions;
CREATE POLICY "Service role full access on result_submissions" ON public.result_submissions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins full access on result_submissions" ON public.result_submissions;
CREATE POLICY "Admins full access on result_submissions" ON public.result_submissions
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());


-- ----------------------------------------------------------------------------
-- 2. COORDINATOR SUBMIT RESULT RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coordinator_submit_sub_event_result(
    p_token TEXT,
    p_sub_event_id UUID,
    p_winner_team_id UUID,
    p_runner_team_id UUID DEFAULT NULL,
    p_third_team_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN := FALSE;
    v_sub_event RECORD;
    v_eligible_count INT := 0;
    v_winner_valid BOOLEAN := FALSE;
    v_runner_valid BOOLEAN := FALSE;
    v_third_valid BOOLEAN := FALSE;
    v_submission_id UUID;
BEGIN
    -- 1. Authenticate coordinator via session token
    v_coord_id := public.get_coordinator_id_by_token(p_token);
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required: Invalid or expired session token.';
    END IF;

    -- 2. Strict server-side verification: Coordinator must be assigned to this sub-event
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.sub_events se ON se.id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord_id
          AND ca.sub_event_id = p_sub_event_id
          AND se.status <> 'PERMANENTLY_DELETED'
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RAISE EXCEPTION 'Unauthorized: You are not assigned as a coordinator for this sub-event.';
    END IF;

    -- 3. Verify sub-event state
    SELECT * INTO v_sub_event 
    FROM public.sub_events 
    WHERE id = p_sub_event_id AND status <> 'PERMANENTLY_DELETED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found or deleted.';
    END IF;

    IF v_sub_event.results_published IS TRUE OR v_sub_event.results_locked IS TRUE THEN
        RAISE EXCEPTION 'Results for this sub-event have already been published and locked.';
    END IF;

    -- 4. Check for existing pending submission
    IF EXISTS (
        SELECT 1 FROM public.result_submissions 
        WHERE sub_event_id = p_sub_event_id 
          AND status = 'PENDING_ADMIN_APPROVAL'
    ) THEN
        RAISE EXCEPTION 'A result submission for this sub-event is already pending admin approval.';
    END IF;

    -- 5. Count authoritative eligible competitors (CONFIRMED registration + attended check-in)
    SELECT COUNT(DISTINCT ar.team_id) INTO v_eligible_count
    FROM public.attendance_records ar
    JOIN public.teams t ON t.id = ar.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE ar.sub_event_id = p_sub_event_id
      AND r.sub_event_id = p_sub_event_id
      AND r.status = 'CONFIRMED';

    IF v_eligible_count = 0 THEN
        RAISE EXCEPTION 'Cannot submit result: No eligible competitors have attended check-in for this sub-event.';
    END IF;

    -- 6. Validate Podium Candidate Structure
    IF v_eligible_count < 2 THEN
        -- Single competitor scenario: winner required, runner optional/null
        IF p_winner_team_id IS NULL THEN
            RAISE EXCEPTION 'Winner selection is required.';
        END IF;
    ELSE
        -- 2 or more competitors: both Winner and Runner required
        IF p_winner_team_id IS NULL OR p_runner_team_id IS NULL THEN
            RAISE EXCEPTION 'Both Winner and Runner-Up are required for sub-events with 2 or more eligible competitors (found % eligible competitors).', v_eligible_count;
        END IF;

        IF p_winner_team_id = p_runner_team_id THEN
            RAISE EXCEPTION 'Winner and Runner-Up cannot be the same participant or team.';
        END IF;
    END IF;

    IF p_third_team_id IS NOT NULL THEN
        IF p_third_team_id = p_winner_team_id OR p_third_team_id = p_runner_team_id THEN
            RAISE EXCEPTION 'Third Place cannot be the same as Winner or Runner-Up.';
        END IF;
    END IF;

    -- 7. Validate Winner candidate eligibility & attendance server-side
    SELECT EXISTS (
        SELECT 1 FROM public.attendance_records ar
        JOIN public.teams t ON t.id = ar.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE t.id = p_winner_team_id
          AND ar.sub_event_id = p_sub_event_id
          AND r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED'
    ) INTO v_winner_valid;

    IF NOT v_winner_valid THEN
        RAISE EXCEPTION 'Selected Winner is not an eligible attended candidate for this sub-event.';
    END IF;

    -- 8. Validate Runner candidate eligibility & attendance server-side (if provided)
    IF p_runner_team_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_records ar
            JOIN public.teams t ON t.id = ar.team_id
            JOIN public.registrations r ON r.id = t.registration_id
            WHERE t.id = p_runner_team_id
              AND ar.sub_event_id = p_sub_event_id
              AND r.sub_event_id = p_sub_event_id
              AND r.status = 'CONFIRMED'
        ) INTO v_runner_valid;

        IF NOT v_runner_valid THEN
            RAISE EXCEPTION 'Selected Runner-Up is not an eligible attended candidate for this sub-event.';
        END IF;
    END IF;

    -- 9. Validate Third candidate eligibility & attendance server-side (if provided)
    IF p_third_team_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_records ar
            JOIN public.teams t ON t.id = ar.team_id
            JOIN public.registrations r ON r.id = t.registration_id
            WHERE t.id = p_third_team_id
              AND ar.sub_event_id = p_sub_event_id
              AND r.sub_event_id = p_sub_event_id
              AND r.status = 'CONFIRMED'
        ) INTO v_third_valid;

        IF NOT v_third_valid THEN
            RAISE EXCEPTION 'Selected Third Place is not an eligible attended candidate for this sub-event.';
        END IF;
    END IF;

    -- 10. Record Result Submission
    INSERT INTO public.result_submissions (
        sub_event_id,
        coordinator_id,
        winner_team_id,
        runner_team_id,
        third_team_id,
        status,
        submitted_at
    ) VALUES (
        p_sub_event_id,
        v_coord_id,
        p_winner_team_id,
        p_runner_team_id,
        p_third_team_id,
        'PENDING_ADMIN_APPROVAL',
        now()
    ) RETURNING id INTO v_submission_id;

    -- 11. Backend Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        NULL,
        'RESULT_SUBMITTED',
        'result_submissions',
        v_submission_id,
        jsonb_build_object(
            'actor_role', 'COORDINATOR',
            'coordinator_id', v_coord_id,
            'sub_event_id', p_sub_event_id,
            'sub_event_name', v_sub_event.name,
            'winner_team_id', p_winner_team_id,
            'runner_team_id', p_runner_team_id,
            'third_team_id', p_third_team_id,
            'status', 'PENDING_ADMIN_APPROVAL',
            'submitted_at', now()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'submission_id', v_submission_id,
        'status', 'PENDING_ADMIN_APPROVAL',
        'message', 'Result submitted successfully. Awaiting administrator review and approval.'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.coordinator_submit_sub_event_result(TEXT, UUID, UUID, UUID, UUID) TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3. COORDINATOR GET RESULT STATUS RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_coordinator_sub_event_result_status(
    p_token TEXT,
    p_sub_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_is_assigned BOOLEAN := FALSE;
    v_sub_event RECORD;
    v_submission RECORD;
    v_winner_name TEXT;
    v_runner_name TEXT;
    v_third_name TEXT;
    v_eligible_count INT := 0;
BEGIN
    -- 1. Authenticate coordinator via session token
    v_coord_id := public.get_coordinator_id_by_token(p_token);
    IF v_coord_id IS NULL THEN
        RAISE EXCEPTION 'Coordinator authorization required: Invalid or expired session token.';
    END IF;

    -- 2. Strict server-side verification: Coordinator must be assigned to this sub-event
    SELECT EXISTS (
        SELECT 1 FROM public.coordinator_assignments ca
        JOIN public.sub_events se ON se.id = ca.sub_event_id
        WHERE ca.coordinator_id = v_coord_id
          AND ca.sub_event_id = p_sub_event_id
          AND se.status <> 'PERMANENTLY_DELETED'
    ) INTO v_is_assigned;

    IF NOT v_is_assigned THEN
        RAISE EXCEPTION 'Unauthorized: You are not assigned as a coordinator for this sub-event.';
    END IF;

    -- 3. Verify sub-event
    SELECT * INTO v_sub_event 
    FROM public.sub_events 
    WHERE id = p_sub_event_id AND status <> 'PERMANENTLY_DELETED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found or deleted.';
    END IF;

    -- 4. Count eligible attended competitors
    SELECT COUNT(DISTINCT ar.team_id) INTO v_eligible_count
    FROM public.attendance_records ar
    JOIN public.teams t ON t.id = ar.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE ar.sub_event_id = p_sub_event_id
      AND r.sub_event_id = p_sub_event_id
      AND r.status = 'CONFIRMED';

    -- 5. If already published, return PUBLISHED/APPROVED status
    IF v_sub_event.results_published IS TRUE THEN
        -- Resolve winner display name
        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_winner_name
        FROM public.teams t WHERE t.id = v_sub_event.winner_team_id;

        -- Resolve runner display name
        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_runner_name
        FROM public.teams t WHERE t.id = v_sub_event.runner_team_id;

        -- Resolve third display name
        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_third_name
        FROM public.teams t WHERE t.id = v_sub_event.third_team_id;

        RETURN jsonb_build_object(
            'success', true,
            'sub_event_id', p_sub_event_id,
            'sub_event_name', v_sub_event.name,
            'status', 'APPROVED',
            'results_published', true,
            'results_locked', true,
            'published_at', v_sub_event.results_published_at,
            'winner_team_id', v_sub_event.winner_team_id,
            'winner_name', v_winner_name,
            'runner_team_id', v_sub_event.runner_team_id,
            'runner_name', v_runner_name,
            'third_team_id', v_sub_event.third_team_id,
            'third_name', v_third_name,
            'eligible_count', v_eligible_count
        );
    END IF;

    -- 6. Fetch latest submission for this sub-event
    SELECT * INTO v_submission
    FROM public.result_submissions
    WHERE sub_event_id = p_sub_event_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
        -- Resolve proposed names
        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_winner_name
        FROM public.teams t WHERE t.id = v_submission.winner_team_id;

        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_runner_name
        FROM public.teams t WHERE t.id = v_submission.runner_team_id;

        SELECT COALESCE(
            NULLIF(t.team_name, 'Solo Participant'),
            (SELECT tm.snapshot_name FROM public.team_members tm WHERE tm.team_id = t.id LIMIT 1),
            t.team_name
        ) INTO v_third_name
        FROM public.teams t WHERE t.id = v_submission.third_team_id;

        RETURN jsonb_build_object(
            'success', true,
            'sub_event_id', p_sub_event_id,
            'sub_event_name', v_sub_event.name,
            'status', v_submission.status,
            'submission_id', v_submission.id,
            'submitted_at', v_submission.submitted_at,
            'reviewed_at', v_submission.reviewed_at,
            'rejection_reason', v_submission.rejection_reason,
            'winner_team_id', v_submission.winner_team_id,
            'winner_name', v_winner_name,
            'runner_team_id', v_submission.runner_team_id,
            'runner_name', v_runner_name,
            'third_team_id', v_submission.third_team_id,
            'third_name', v_third_name,
            'eligible_count', v_eligible_count
        );
    END IF;

    -- Default: NOT_SUBMITTED
    RETURN jsonb_build_object(
        'success', true,
        'sub_event_id', p_sub_event_id,
        'sub_event_name', v_sub_event.name,
        'status', 'NOT_SUBMITTED',
        'eligible_count', v_eligible_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_coordinator_sub_event_result_status(TEXT, UUID) TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 4. ADMIN GET RESULT SUBMISSIONS RPC
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
    -- Check admin authorization
    IF NOT (public.is_admin()) THEN
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
            se.id AS sub_event_id,
            se.name AS sub_event_name,
            se.participation_type::text AS participation_type,
            COALESCE(cat.name, 'General Track') AS category_name,
            COALESCE(e.name, ce.name, 'Flagship Event') AS event_name,
            c.id AS coordinator_id,
            c.display_name AS coordinator_name,
            c.username AS coordinator_username,
            
            -- Winner Team Info
            jsonb_build_object(
                'team_id', wt.id,
                'team_name', wt.team_name,
                'is_team', (SELECT COUNT(*) FROM public.team_members WHERE team_id = wt.id) > 1 
                           OR (wt.team_name IS NOT NULL AND wt.team_name <> 'Solo Participant'),
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

            -- Runner Team Info
            CASE WHEN rt.id IS NOT NULL THEN
                jsonb_build_object(
                    'team_id', rt.id,
                    'team_name', rt.team_name,
                    'is_team', (SELECT COUNT(*) FROM public.team_members WHERE team_id = rt.id) > 1 
                               OR (rt.team_name IS NOT NULL AND rt.team_name <> 'Solo Participant'),
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

            -- Third Place Team Info
            CASE WHEN tt.id IS NOT NULL THEN
                jsonb_build_object(
                    'team_id', tt.id,
                    'team_name', tt.team_name,
                    'is_team', (SELECT COUNT(*) FROM public.team_members WHERE team_id = tt.id) > 1 
                               OR (tt.team_name IS NOT NULL AND tt.team_name <> 'Solo Participant'),
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

GRANT EXECUTE ON FUNCTION public.admin_get_result_submissions(TEXT) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 5. ADMIN APPROVE RESULT SUBMISSION RPC (ATOMIC & IDEMPOTENT)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_approve_result_submission(
    p_submission_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_sub RECORD;
    v_sub_event RECORD;
    v_member RECORD;
    v_cert_code TEXT;
    v_winner_count INT := 0;
    v_runner_count INT := 0;
    v_third_count INT := 0;
    v_cert_count INT := 0;
    v_winner_valid BOOLEAN := FALSE;
    v_runner_valid BOOLEAN := FALSE;
    v_third_valid BOOLEAN := FALSE;
BEGIN
    -- 1. Authorization Check: Admin Only
    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can approve results and issue certificates.';
    END IF;

    -- 2. Fetch and lock submission row
    SELECT * INTO v_sub 
    FROM public.result_submissions 
    WHERE id = p_submission_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Result submission not found.';
    END IF;

    -- Idempotency check: if already approved, return success without duplicating
    IF v_sub.status = 'APPROVED' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_approved', true,
            'message', 'Result submission has already been approved and published.'
        );
    END IF;

    IF v_sub.status <> 'PENDING_ADMIN_APPROVAL' THEN
        RAISE EXCEPTION 'Cannot approve submission in status %.', v_sub.status;
    END IF;

    -- 3. Lock and verify sub-event
    SELECT * INTO v_sub_event 
    FROM public.sub_events 
    WHERE id = v_sub.sub_event_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found.';
    END IF;

    IF v_sub_event.results_published IS TRUE THEN
        RAISE EXCEPTION 'Sub-event results are already published.';
    END IF;

    -- 4. Re-verify Winner Candidate Attendance & Sub-event Belonging
    SELECT EXISTS (
        SELECT 1 FROM public.attendance_records ar
        JOIN public.teams t ON t.id = ar.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE t.id = v_sub.winner_team_id
          AND ar.sub_event_id = v_sub.sub_event_id
          AND r.sub_event_id = v_sub.sub_event_id
          AND r.status = 'CONFIRMED'
    ) INTO v_winner_valid;

    IF NOT v_winner_valid THEN
        RAISE EXCEPTION 'Winner team does not satisfy attendance or registration requirements for this sub-event.';
    END IF;

    -- 5. Re-verify Runner Candidate Attendance & Sub-event Belonging (if provided)
    IF v_sub.runner_team_id IS NOT NULL THEN
        IF v_sub.runner_team_id = v_sub.winner_team_id THEN
            RAISE EXCEPTION 'Winner and Runner-Up cannot be the same team.';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM public.attendance_records ar
            JOIN public.teams t ON t.id = ar.team_id
            JOIN public.registrations r ON r.id = t.registration_id
            WHERE t.id = v_sub.runner_team_id
              AND ar.sub_event_id = v_sub.sub_event_id
              AND r.sub_event_id = v_sub.sub_event_id
              AND r.status = 'CONFIRMED'
        ) INTO v_runner_valid;

        IF NOT v_runner_valid THEN
            RAISE EXCEPTION 'Runner-Up team does not satisfy attendance or registration requirements for this sub-event.';
        END IF;
    END IF;

    -- 6. Re-verify Third Candidate Attendance & Sub-event Belonging (if provided)
    IF v_sub.third_team_id IS NOT NULL THEN
        IF v_sub.third_team_id = v_sub.winner_team_id OR v_sub.third_team_id = v_sub.runner_team_id THEN
            RAISE EXCEPTION 'Third Place cannot be the same as Winner or Runner-Up.';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM public.attendance_records ar
            JOIN public.teams t ON t.id = ar.team_id
            JOIN public.registrations r ON r.id = t.registration_id
            WHERE t.id = v_sub.third_team_id
              AND ar.sub_event_id = v_sub.sub_event_id
              AND r.sub_event_id = v_sub.sub_event_id
              AND r.status = 'CONFIRMED'
        ) INTO v_third_valid;

        IF NOT v_third_valid THEN
            RAISE EXCEPTION 'Third Place team does not satisfy attendance or registration requirements for this sub-event.';
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 7. GENERATE INDIVIDUAL ACHIEVEMENT CERTIFICATES IDEMPOTENTLY
    -- ------------------------------------------------------------------------
    -- Attendance Requirement: Only attended team members in attendance_records
    -- receive achievement certificates. Absent team members do NOT receive them.

    -- 7a. Process Winner Team Members
    FOR v_member IN
        SELECT tm.id, tm.snapshot_name
        FROM public.team_members tm
        JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
        WHERE tm.team_id = v_sub.winner_team_id
          AND ar.sub_event_id = v_sub.sub_event_id
    LOOP
        SELECT certificate_code INTO v_cert_code 
        FROM public.certificates 
        WHERE team_member_id = v_member.id 
          AND sub_event_id = v_sub.sub_event_id 
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
            issued_at
        ) VALUES (
            v_member.id,
            v_sub.sub_event_id,
            'WINNER',
            'UNLOCKED',
            v_cert_code,
            now()
        )
        ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
            status = 'UNLOCKED',
            certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

        v_winner_count := v_winner_count + 1;
        v_cert_count := v_cert_count + 1;
    END LOOP;

    -- 7b. Process Runner Team Members (if provided)
    IF v_sub.runner_team_id IS NOT NULL THEN
        FOR v_member IN
            SELECT tm.id, tm.snapshot_name
            FROM public.team_members tm
            JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
            WHERE tm.team_id = v_sub.runner_team_id
              AND ar.sub_event_id = v_sub.sub_event_id
        LOOP
            SELECT certificate_code INTO v_cert_code 
            FROM public.certificates 
            WHERE team_member_id = v_member.id 
              AND sub_event_id = v_sub.sub_event_id 
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
                issued_at
            ) VALUES (
                v_member.id,
                v_sub.sub_event_id,
                'RUNNER',
                'UNLOCKED',
                v_cert_code,
                now()
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                status = 'UNLOCKED',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

            v_runner_count := v_runner_count + 1;
            v_cert_count := v_cert_count + 1;
        END LOOP;
    END IF;

    -- 7c. Process Optional Third Place Team Members
    IF v_sub.third_team_id IS NOT NULL THEN
        FOR v_member IN
            SELECT tm.id, tm.snapshot_name
            FROM public.team_members tm
            JOIN public.attendance_records ar ON ar.scanned_member_id = tm.id
            WHERE tm.team_id = v_sub.third_team_id
              AND ar.sub_event_id = v_sub.sub_event_id
        LOOP
            SELECT certificate_code INTO v_cert_code 
            FROM public.certificates 
            WHERE team_member_id = v_member.id 
              AND sub_event_id = v_sub.sub_event_id 
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
                issued_at
            ) VALUES (
                v_member.id,
                v_sub.sub_event_id,
                'THIRD_PLACE',
                'UNLOCKED',
                v_cert_code,
                now()
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                status = 'UNLOCKED',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code);

            v_third_count := v_third_count + 1;
            v_cert_count := v_cert_count + 1;
        END LOOP;
    END IF;

    -- NOTE: PARTICIPATION CERTIFICATES ARE STRICTLY PRESERVED AS-IS.
    -- We do NOT create or unlock participation certificates here; their feedback gate
    -- and attendance-driven lifecycle remains completely intact.

    -- 8. Atomically update sub_events table with published results
    UPDATE public.sub_events
    SET results_locked = TRUE,
        results_published = TRUE,
        results_published_at = now(),
        winner_team_id = v_sub.winner_team_id,
        runner_team_id = v_sub.runner_team_id,
        third_team_id = v_sub.third_team_id
    WHERE id = v_sub.sub_event_id;

    -- 9. Atomically mark result submission APPROVED
    UPDATE public.result_submissions
    SET status = 'APPROVED',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        updated_at = now()
    WHERE id = p_submission_id;

    -- 10. Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        auth.uid(),
        'RESULT_APPROVED',
        'result_submissions',
        p_submission_id,
        jsonb_build_object(
            'actor_role', 'ADMIN',
            'sub_event_id', v_sub.sub_event_id,
            'sub_event_name', v_sub_event.name,
            'winner_team_id', v_sub.winner_team_id,
            'runner_team_id', v_sub.runner_team_id,
            'third_team_id', v_sub.third_team_id,
            'status', 'APPROVED',
            'winner_certs_count', v_winner_count,
            'runner_certs_count', v_runner_count,
            'third_certs_count', v_third_count,
            'total_achievement_certificates', v_cert_count,
            'approved_at', now()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'submission_id', p_submission_id,
        'sub_event_id', v_sub.sub_event_id,
        'winner_count', v_winner_count,
        'runner_count', v_runner_count,
        'third_count', v_third_count,
        'total_certificates', v_cert_count,
        'message', 'Result submission approved and published. Achievement certificates generated successfully.'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_result_submission(UUID) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 6. ADMIN REJECT RESULT SUBMISSION RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reject_result_submission(
    p_submission_id UUID,
    p_rejection_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_sub RECORD;
    v_sub_event RECORD;
    v_clean_reason TEXT;
BEGIN
    -- 1. Authorization Check: Admin Only
    IF NOT (public.is_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can reject results.';
    END IF;

    -- 2. Validate Rejection Reason
    v_clean_reason := trim(COALESCE(p_rejection_reason, ''));
    IF v_clean_reason = '' THEN
        RAISE EXCEPTION 'A rejection reason is required to reject a result submission.';
    END IF;

    -- 3. Fetch and lock submission row
    SELECT * INTO v_sub 
    FROM public.result_submissions 
    WHERE id = p_submission_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Result submission not found.';
    END IF;

    IF v_sub.status <> 'PENDING_ADMIN_APPROVAL' THEN
        RAISE EXCEPTION 'Cannot reject submission in status %.', v_sub.status;
    END IF;

    SELECT * INTO v_sub_event 
    FROM public.sub_events 
    WHERE id = v_sub.sub_event_id;

    -- 4. Atomically update submission to REJECTED
    UPDATE public.result_submissions
    SET status = 'REJECTED',
        rejection_reason = v_clean_reason,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        updated_at = now()
    WHERE id = p_submission_id;

    -- 5. Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        auth.uid(),
        'RESULT_REJECTED',
        'result_submissions',
        p_submission_id,
        jsonb_build_object(
            'actor_role', 'ADMIN',
            'sub_event_id', v_sub.sub_event_id,
            'sub_event_name', v_sub_event.name,
            'rejection_reason', v_clean_reason,
            'status', 'REJECTED',
            'rejected_at', now()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'submission_id', p_submission_id,
        'status', 'REJECTED',
        'rejection_reason', v_clean_reason,
        'message', 'Result submission rejected. The assigned coordinator will be able to review the reason and submit a revised result.'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reject_result_submission(UUID, TEXT) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 7. NOTIFICATION TRIGGER RESILIENCE
-- ----------------------------------------------------------------------------
-- Ensures COALESCE construct is standard SQL so transition to published results
-- dispatches notifications reliably without schema-resolution errors.
CREATE OR REPLACE FUNCTION public.trigger_notify_students_on_results_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_event_name text;
    v_student record;
    v_clean_title text := '🏆 Results Published';
    v_clean_message text;
    v_broadcast_id uuid;
BEGIN
    -- Fire ONLY on actual transition into officially published & locked state
    IF (
        (OLD.results_published IS DISTINCT FROM TRUE) 
        AND NEW.results_published = TRUE 
        AND NEW.results_locked = TRUE
    ) THEN
        -- Resolve event name
        SELECT COALESCE(e.name, ce.name, 'Event') INTO v_event_name
        FROM public.sub_events se
        LEFT JOIN public.events e ON e.id = se.event_id
        LEFT JOIN public.categories cat ON cat.id = se.category_id
        LEFT JOIN public.events ce ON ce.id = cat.event_id
        WHERE se.id = NEW.id;

        v_clean_message := 'Results for ' || NEW.name || ' — ' || COALESCE(v_event_name, 'Event') || ' have been published. View your result and certificate.';
        v_broadcast_id := md5(NEW.id::text || '-results-published')::uuid;

        -- Find all confirmed students (leaders and team members) who participated
        FOR v_student IN
            SELECT DISTINCT COALESCE(tm.user_id, r.leader_id) AS student_user_id
            FROM public.registrations r
            JOIN public.teams t ON t.registration_id = r.id
            JOIN public.team_members tm ON tm.team_id = t.id
            WHERE r.sub_event_id = NEW.id
              AND r.status = 'CONFIRMED'
              AND COALESCE(tm.user_id, r.leader_id) IS NOT NULL
        LOOP
            -- Strict idempotency check: never insert duplicate result notifications
            IF NOT EXISTS (
                SELECT 1 FROM public.notifications n
                WHERE n.user_id = v_student.student_user_id
                  AND (
                    n.broadcast_id = v_broadcast_id 
                    OR (n.title = v_clean_title AND n.message = v_clean_message)
                  )
            ) THEN
                INSERT INTO public.notifications (
                    broadcast_id,
                    user_id,
                    coordinator_id,
                    recipient_role,
                    audience,
                    title,
                    message,
                    is_read,
                    created_at
                ) VALUES (
                    v_broadcast_id,
                    v_student.student_user_id,
                    NULL,
                    'STUDENT',
                    'STUDENT',
                    v_clean_title,
                    v_clean_message,
                    FALSE,
                    now()
                );
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

