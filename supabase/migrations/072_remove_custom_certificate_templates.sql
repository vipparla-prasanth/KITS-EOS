-- ==============================================================================
-- Migration 072: Controlled Removal of Custom Certificate Templates
-- ==============================================================================
-- 1. Safely preserves all 71 historical certificate records by normalizing
--    them to DEFAULT mode (unlinking template version references).
-- 2. Restores trigger_issue_participation_certificate() to known pre-071
--    lightweight attendance certificate issuance logic from Migration 070.
-- 3. Restores publish_sub_event_results_and_certificates() to known pre-071
--    result publishing and achievement certificate logic from Migration 070.
-- 4. Removes custom-template columns and constraints from public.certificates.
-- 5. Drops custom-template tables, indexes, and RPC functions.
-- 6. Drops Storage policies, objects, and private bucket 'certificate-templates'.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PRESERVE HISTORICAL CERTIFICATES (NORMALIZE TO DEFAULT BASELINE)
-- ------------------------------------------------------------------------------
-- Certificate records, codes, eligibility, and UNLOCKED status are preserved.
-- Custom template associations are unlinked so all certificates render with DEFAULT.
UPDATE public.certificates
SET template_mode = 'DEFAULT',
    template_version_id = NULL
WHERE template_version_id IS NOT NULL 
   OR template_mode <> 'DEFAULT';

-- ------------------------------------------------------------------------------
-- 2. RESTORE ATTENDANCE PARTICIPATION CERTIFICATE TRIGGER (PRE-071 BASELINE)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_issue_participation_certificate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_cert_code TEXT;
    v_is_confirmed BOOLEAN := FALSE;
BEGIN
    -- Fast indexed check: ensure registration is CONFIRMED
    SELECT (r.status = 'CONFIRMED') INTO v_is_confirmed
    FROM public.teams t
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE t.id = NEW.team_id;

    IF v_is_confirmed IS TRUE THEN
        -- Lightweight idempotency check: only generate if PARTICIPANT cert does not exist
        IF NOT EXISTS (
            SELECT 1 FROM public.certificates
            WHERE team_member_id = NEW.scanned_member_id
              AND sub_event_id = NEW.sub_event_id
              AND type = 'PARTICIPANT'
        ) THEN
            LOOP
                v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
            END LOOP;

            -- Atomically insert UNLOCKED participation certificate
            INSERT INTO public.certificates (
                team_member_id,
                sub_event_id,
                type,
                status,
                certificate_code,
                issued_at
            ) VALUES (
                NEW.scanned_member_id,
                NEW.sub_event_id,
                'PARTICIPANT',
                'UNLOCKED',
                v_cert_code,
                NOW()
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_issue_participation_certificate ON public.attendance_records;
CREATE TRIGGER trg_issue_participation_certificate
AFTER INSERT ON public.attendance_records
FOR EACH ROW
EXECUTE FUNCTION public.trigger_issue_participation_certificate();

-- ------------------------------------------------------------------------------
-- 3. RESTORE RESULTS & ACHIEVEMENT CERTIFICATES RPC (PRE-071 BASELINE)
-- ------------------------------------------------------------------------------
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
    v_is_admin BOOLEAN;
    v_sub_event RECORD;
    v_distinct_attended_teams INT := 0;
    v_is_direct_publish BOOLEAN := FALSE;
    v_member RECORD;
    v_cert_code TEXT;
    v_winner_count INT := 0;
    v_runner_count INT := 0;
    v_third_count INT := 0;
    v_participant_count INT := 0;
    v_cert_count INT := 0;
BEGIN
    -- 1. Authorization: Only Admins can publish results
    v_is_admin := public.is_admin();
    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: Only system administrators can publish results and issue certificates.';
    END IF;

    -- 2. Verify sub-event exists and is not deleted
    SELECT * INTO v_sub_event
    FROM public.sub_events
    WHERE id = p_sub_event_id
      AND status <> 'PERMANENTLY_DELETED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sub-event not found or has been deleted.';
    END IF;

    -- 3. Calculate distinct attended competing units
    SELECT COUNT(DISTINCT ar.team_id) INTO v_distinct_attended_teams
    FROM public.attendance_records ar
    JOIN public.teams t ON t.id = ar.team_id
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE ar.sub_event_id = p_sub_event_id
      AND r.status = 'CONFIRMED';

    IF v_distinct_attended_teams = 0 THEN
        RAISE EXCEPTION 'Cannot publish results: No participants have attended this sub-event.';
    END IF;

    IF v_distinct_attended_teams < 2 THEN
        v_is_direct_publish := TRUE;
    ELSE
        IF p_winner_team_id IS NULL OR p_runner_team_id IS NULL THEN
            RAISE EXCEPTION 'Validation error: Both Winner and Runner teams are required for competitive sub-events with 2 or more attendees.';
        END IF;
    END IF;

    -- 4. Process Achievement Certificates (WINNER, RUNNER, THIRD_PLACE)
    -- Participation certificates are ALREADY issued immediately upon attendance,
    -- so achievement certificates are issued as ADDITIONAL credentials.
    IF NOT v_is_direct_publish THEN
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

        -- 4b. Process Runner-Up Team
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

    -- 5. Safety catch: Ensure ALL attended participants have their PARTICIPANT certificate
    FOR v_member IN
        SELECT DISTINCT tm.id, tm.snapshot_name
        FROM public.attendance_records ar
        JOIN public.team_members tm ON tm.id = ar.scanned_member_id
        JOIN public.teams t ON t.id = tm.team_id
        JOIN public.registrations r ON r.id = t.registration_id
        WHERE ar.sub_event_id = p_sub_event_id
          AND r.sub_event_id = p_sub_event_id
          AND r.status = 'CONFIRMED'
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.certificates 
            WHERE team_member_id = v_member.id 
              AND sub_event_id = p_sub_event_id 
              AND type = 'PARTICIPANT'
        ) THEN
            LOOP
                v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
            END LOOP;

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
                'PARTICIPANT',
                'UNLOCKED',
                v_cert_code,
                NOW()
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO NOTHING;

            v_participant_count := v_participant_count + 1;
            v_cert_count := v_cert_count + 1;
        END IF;
    END LOOP;

    -- 6. Unlock all certificates for this sub-event
    UPDATE public.certificates
    SET status = 'UNLOCKED'
    WHERE sub_event_id = p_sub_event_id;

    -- 7. Update sub_events table with locked & published status
    IF v_is_direct_publish THEN
        UPDATE public.sub_events
        SET results_locked = TRUE,
            results_published = TRUE,
            results_published_at = NOW(),
            winner_team_id = NULL,
            runner_team_id = NULL,
            third_team_id = NULL
        WHERE id = p_sub_event_id;

        RETURN jsonb_build_object(
            'success', true,
            'is_direct_publish', true,
            'message', 'Sub-event has fewer than 2 competitors. Participation certificates are active and results are officially completed.',
            'total_certificates', v_cert_count
        );
    ELSE
        UPDATE public.sub_events
        SET results_locked = TRUE,
            results_published = TRUE,
            results_published_at = NOW(),
            winner_team_id = p_winner_team_id,
            runner_team_id = p_runner_team_id,
            third_team_id = p_third_team_id
        WHERE id = p_sub_event_id;

        RETURN jsonb_build_object(
            'success', true,
            'is_direct_publish', false,
            'message', 'Competition results and achievement certificates published successfully.',
            'winner_count', v_winner_count,
            'runner_count', v_runner_count,
            'third_count', v_third_count,
            'total_certificates', v_cert_count
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_sub_event_results_and_certificates(UUID, UUID, UUID, UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. DROP CUSTOM-TEMPLATE COLUMNS & CONSTRAINTS FROM public.certificates
-- ------------------------------------------------------------------------------
ALTER TABLE public.certificates 
  DROP CONSTRAINT IF EXISTS certificates_template_version_id_fkey,
  DROP COLUMN IF EXISTS template_version_id,
  DROP COLUMN IF EXISTS template_mode;

-- ------------------------------------------------------------------------------
-- 5. DROP CUSTOM-TEMPLATE TABLES & ASSOCIATED INDEXES
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS public.main_event_certificate_configs CASCADE;
DROP TABLE IF EXISTS public.certificate_template_versions CASCADE;

-- ------------------------------------------------------------------------------
-- 6. CLEAN UP STORAGE (POLICIES, OBJECTS, AND BUCKET)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins have full access to certificate-templates" ON storage.objects;
DROP POLICY IF EXISTS "Authorized users can access certificate-templates" ON storage.objects;
DROP POLICY IF EXISTS "Authorized certificate holders can read their template objects" ON storage.objects;

SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.objects WHERE bucket_id = 'certificate-templates';
DELETE FROM storage.buckets WHERE id = 'certificate-templates';

-- ------------------------------------------------------------------------------
-- 7. DROP CUSTOM-TEMPLATE SPECIFIC FUNCTIONS & RPCS
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_save_certificate_template(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, INT, INT, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.admin_switch_certificate_template_mode(UUID, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.admin_update_template_field_positions(UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.get_admin_event_certificate_configs(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_certificate_template_info(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.can_access_certificate_template(TEXT) CASCADE;

