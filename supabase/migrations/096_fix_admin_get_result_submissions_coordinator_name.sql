-- ============================================================================
-- Migration 096: Fix admin_get_result_submissions Coordinator Name Column
-- 
-- Root Cause:
--   Migration 095 referenced `c.name` instead of `c.display_name` for
--   `public.coordinators` (which has `display_name`, not `name`). This caused
--   PostgreSQL error 42703 (column c.name does not exist) when loading the
--   Admin Results page.
--
-- Fix:
--   1. Replace `c.name AS coordinator_name` with `c.display_name AS coordinator_name`.
--   2. Ensure `is_team` flag is properly projected in winner, runner, and third team objects.
--   3. Preserve all one-time edit metadata (result_edit_count, result_edited_at,
--      result_edited_by, result_edit_reason).
--   4. Enforce strict Admin authorization and maintain least-privilege grants.
-- ============================================================================

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
                    'is_team', (SELECT COUNT(*) FROM public.team_members WHERE team_id = rt.id) > 1 
                               OR (rt.team_name IS NOT NULL AND rt.team_name <> 'Solo Participant'),
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
                    'is_team', (SELECT COUNT(*) FROM public.team_members WHERE team_id = tt.id) > 1 
                               OR (tt.team_name IS NOT NULL AND tt.team_name <> 'Solo Participant'),
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
    ), '[]'::jsonb) INTO v_submissions
    FROM submission_details sd;

    RETURN v_submissions;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_result_submissions(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_result_submissions(TEXT) TO authenticated, service_role;
