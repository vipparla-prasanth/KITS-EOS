-- ==============================================================================
-- Migration 071: Main Event Certificate Template Configuration & Version Snapshotting
-- ==============================================================================
-- Enables independent Participation and Achievement certificate configuration per Main Event.
-- Supports:
-- 1. KITS-EOS Default Template vs. Custom Event Template (PNG/JPG artwork background).
-- 2. Version snapshotting (certificate_template_versions) so issued certificates remain immutable.
-- 3. Dedicated configurable QR code coordinates (x, y, width, height, is_visible) in field_positions.
-- 4. Strictly PRIVATE Supabase Storage bucket ('certificate-templates') with scoped RLS.
-- 5. Ultra-lightweight attendance trigger with sub-millisecond lookup and zero external calls.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABLE: public.certificate_template_versions
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.certificate_template_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    main_event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    certificate_type TEXT NOT NULL CHECK (certificate_type IN ('PARTICIPATION', 'ACHIEVEMENT')),
    version_number INTEGER NOT NULL DEFAULT 1,
    storage_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    width INTEGER DEFAULT 2000,
    height INTEGER DEFAULT 1414,
    field_positions JSONB NOT NULL DEFAULT '{
        "participant_name": { "x": 1000, "y": 680, "font_size": 48, "font_family": "Segoe UI, Roboto, sans-serif", "font_weight": "900", "alignment": "center", "color": "#0F172A", "is_visible": true },
        "event_name": { "x": 1000, "y": 450, "font_size": 32, "font_family": "Segoe UI, Roboto, sans-serif", "font_weight": "900", "alignment": "center", "color": "#1E3A8A", "is_visible": true },
        "sub_event_name": { "x": 1000, "y": 800, "font_size": 24, "font_family": "Segoe UI, Roboto, sans-serif", "font_weight": "700", "alignment": "center", "color": "#1E293B", "is_visible": true },
        "category_name": { "x": 1000, "y": 490, "font_size": 20, "font_family": "Segoe UI, Roboto, sans-serif", "font_weight": "700", "alignment": "center", "color": "#B45309", "is_visible": false },
        "achievement": { "x": 1000, "y": 530, "font_size": 26, "font_family": "Segoe UI, Roboto, sans-serif", "font_weight": "900", "alignment": "center", "color": "#B45309", "is_visible": true },
        "certificate_code": { "x": 1000, "y": 1280, "font_size": 16, "font_family": "monospace", "font_weight": "700", "alignment": "center", "color": "#0F172A", "is_visible": true },
        "issue_date": { "x": 1000, "y": 1310, "font_size": 14, "font_family": "monospace", "font_weight": "500", "alignment": "center", "color": "#64748B", "is_visible": true },
        "qr_code": { "x": 935, "y": 1130, "width": 130, "height": 130, "is_visible": true }
    }'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT uq_cert_template_version UNIQUE (main_event_id, certificate_type, version_number)
);

CREATE INDEX IF NOT EXISTS idx_cert_template_versions_lookup 
ON public.certificate_template_versions(main_event_id, certificate_type, is_active);

-- ------------------------------------------------------------------------------
-- 2. PRIVATE STORAGE BUCKET: certificate-templates & POLICIES
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('certificate-templates', 'certificate-templates', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Storage RLS: Drop any existing conflicting policies for certificate-templates
DROP POLICY IF EXISTS "Admins have full access to certificate-templates" ON storage.objects;
DROP POLICY IF EXISTS "Authorized users can access certificate-templates" ON storage.objects;
DROP POLICY IF EXISTS "Authorized certificate holders can read their template objects" ON storage.objects;

-- Admin: full management (upload, update, delete, view)
CREATE POLICY "Admins have full access to certificate-templates"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'certificate-templates' AND public.is_admin())
WITH CHECK (bucket_id = 'certificate-templates' AND public.is_admin());

-- Storage helper for authorized certificate holders
CREATE OR REPLACE FUNCTION public.can_access_certificate_template(p_storage_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
    IF public.is_admin() THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.certificates c
        JOIN public.certificate_template_versions ctv ON ctv.id = c.template_version_id
        JOIN public.team_members tm ON tm.id = c.team_member_id
        WHERE ctv.storage_path = p_storage_path
          AND tm.user_id = auth.uid()
          AND c.status = 'UNLOCKED'
    );
END;
$$;

-- Scoped SELECT for authorized certificate holders (students/coordinators)
CREATE POLICY "Authorized certificate holders can read their template objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'certificate-templates'
    AND public.can_access_certificate_template(name)
);

-- ------------------------------------------------------------------------------
-- 3. TABLE: public.main_event_certificate_configs
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.main_event_certificate_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    main_event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    certificate_type TEXT NOT NULL CHECK (certificate_type IN ('PARTICIPATION', 'ACHIEVEMENT')),
    template_mode TEXT NOT NULL DEFAULT 'DEFAULT' CHECK (template_mode IN ('DEFAULT', 'CUSTOM')),
    active_template_version_id UUID REFERENCES public.certificate_template_versions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_main_event_cert_config UNIQUE (main_event_id, certificate_type)
);

CREATE INDEX IF NOT EXISTS idx_main_event_cert_configs_lookup
ON public.main_event_certificate_configs(main_event_id, certificate_type);

-- ------------------------------------------------------------------------------
-- 4. EXTEND public.certificates WITH TEMPLATE SNAPSHOTTING
-- ------------------------------------------------------------------------------
ALTER TABLE public.certificates
    ADD COLUMN IF NOT EXISTS template_mode TEXT DEFAULT 'DEFAULT' CHECK (template_mode IN ('DEFAULT', 'CUSTOM')),
    ADD COLUMN IF NOT EXISTS template_version_id UUID REFERENCES public.certificate_template_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_certificates_template_version_id
ON public.certificates(template_version_id);

-- ------------------------------------------------------------------------------
-- 5. RLS POLICIES FOR CONFIG & VERSION TABLES
-- ------------------------------------------------------------------------------
ALTER TABLE public.main_event_certificate_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificate_template_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to certificate configs" ON public.main_event_certificate_configs;
DROP POLICY IF EXISTS "Authenticated users can read certificate configs" ON public.main_event_certificate_configs;
DROP POLICY IF EXISTS "Admins have full access to template versions" ON public.certificate_template_versions;
DROP POLICY IF EXISTS "Authenticated users can read template versions" ON public.certificate_template_versions;

CREATE POLICY "Admins have full access to certificate configs"
ON public.main_event_certificate_configs
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Authenticated users can read certificate configs"
ON public.main_event_certificate_configs
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins have full access to template versions"
ON public.certificate_template_versions
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Authenticated users can read template versions"
ON public.certificate_template_versions
FOR SELECT
TO authenticated
USING (true);

-- Table-level grants for authenticated and service_role
GRANT ALL ON public.main_event_certificate_configs TO authenticated, service_role;
GRANT ALL ON public.certificate_template_versions TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. ULTRA-LIGHTWEIGHT ATTENDANCE TRIGGER (SUB-MILLISECOND EXECUTION)
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
    v_main_event_id UUID;
    v_template_mode TEXT := 'DEFAULT';
    v_template_version_id UUID := NULL;
BEGIN
    -- 1. Fast indexed check: ensure registration is CONFIRMED
    SELECT (r.status = 'CONFIRMED') INTO v_is_confirmed
    FROM public.teams t
    JOIN public.registrations r ON r.id = t.registration_id
    WHERE t.id = NEW.team_id;

    IF v_is_confirmed IS TRUE THEN
        -- 2. Lightweight idempotency check: only generate if PARTICIPANT cert does not exist
        IF NOT EXISTS (
            SELECT 1 FROM public.certificates
            WHERE team_member_id = NEW.scanned_member_id
              AND sub_event_id = NEW.sub_event_id
              AND type = 'PARTICIPANT'
        ) THEN
            -- 3. Resolve Main Event ID via sub_events / categories
            SELECT COALESCE(se.event_id, c.event_id) INTO v_main_event_id
            FROM public.sub_events se
            LEFT JOIN public.categories c ON c.id = se.category_id
            WHERE se.id = NEW.sub_event_id;

            -- 4. Fast indexed lookup for Participation certificate config
            IF v_main_event_id IS NOT NULL THEN
                SELECT cfg.template_mode, cfg.active_template_version_id
                INTO v_template_mode, v_template_version_id
                FROM public.main_event_certificate_configs cfg
                WHERE cfg.main_event_id = v_main_event_id
                  AND cfg.certificate_type = 'PARTICIPATION';

                IF v_template_mode = 'CUSTOM' AND v_template_version_id IS NULL THEN
                    v_template_mode := 'DEFAULT';
                END IF;
            END IF;

            -- Generate unique certificate code
            LOOP
                v_cert_code := 'KITS-EOS-CERT-' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_code = v_cert_code);
            END LOOP;

            -- Atomically insert UNLOCKED participation certificate with template snapshot
            INSERT INTO public.certificates (
                team_member_id,
                sub_event_id,
                type,
                status,
                certificate_code,
                issued_at,
                template_mode,
                template_version_id
            ) VALUES (
                NEW.scanned_member_id,
                NEW.sub_event_id,
                'PARTICIPANT',
                'UNLOCKED',
                v_cert_code,
                NOW(),
                COALESCE(v_template_mode, 'DEFAULT'),
                v_template_version_id
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. UPDATE publish_sub_event_results_and_certificates WITH TEMPLATE SNAPSHOTTING
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
    v_main_event_id UUID;
    v_achieve_template_mode TEXT := 'DEFAULT';
    v_achieve_template_version_id UUID := NULL;
    v_part_template_mode TEXT := 'DEFAULT';
    v_part_template_version_id UUID := NULL;
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

    -- 3. Resolve Main Event ID and Certificate Configs
    SELECT COALESCE(se.event_id, c.event_id) INTO v_main_event_id
    FROM public.sub_events se
    LEFT JOIN public.categories c ON c.id = se.category_id
    WHERE se.id = p_sub_event_id;

    IF v_main_event_id IS NOT NULL THEN
        -- Achievement template configuration
        SELECT cfg.template_mode, cfg.active_template_version_id
        INTO v_achieve_template_mode, v_achieve_template_version_id
        FROM public.main_event_certificate_configs cfg
        WHERE cfg.main_event_id = v_main_event_id
          AND cfg.certificate_type = 'ACHIEVEMENT';

        IF v_achieve_template_mode = 'CUSTOM' AND v_achieve_template_version_id IS NULL THEN
            v_achieve_template_mode := 'DEFAULT';
        END IF;

        -- Participation template configuration
        SELECT cfg.template_mode, cfg.active_template_version_id
        INTO v_part_template_mode, v_part_template_version_id
        FROM public.main_event_certificate_configs cfg
        WHERE cfg.main_event_id = v_main_event_id
          AND cfg.certificate_type = 'PARTICIPATION';

        IF v_part_template_mode = 'CUSTOM' AND v_part_template_version_id IS NULL THEN
            v_part_template_mode := 'DEFAULT';
        END IF;
    END IF;

    -- 4. Calculate distinct attended competing units
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

    -- 5. Process Achievement Certificates (WINNER, RUNNER, THIRD_PLACE)
    IF NOT v_is_direct_publish THEN
        -- 5a. Process Winner Team
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
                issued_at,
                template_mode,
                template_version_id
            ) VALUES (
                v_member.id,
                p_sub_event_id,
                'WINNER',
                'UNLOCKED',
                v_cert_code,
                NOW(),
                COALESCE(v_achieve_template_mode, 'DEFAULT'),
                v_achieve_template_version_id
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                status = 'UNLOCKED',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
                template_mode = COALESCE(public.certificates.template_mode, EXCLUDED.template_mode),
                template_version_id = COALESCE(public.certificates.template_version_id, EXCLUDED.template_version_id);

            v_winner_count := v_winner_count + 1;
            v_cert_count := v_cert_count + 1;
        END LOOP;

        -- 5b. Process Runner-Up Team
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
                issued_at,
                template_mode,
                template_version_id
            ) VALUES (
                v_member.id,
                p_sub_event_id,
                'RUNNER',
                'UNLOCKED',
                v_cert_code,
                NOW(),
                COALESCE(v_achieve_template_mode, 'DEFAULT'),
                v_achieve_template_version_id
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                status = 'UNLOCKED',
                certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
                template_mode = COALESCE(public.certificates.template_mode, EXCLUDED.template_mode),
                template_version_id = COALESCE(public.certificates.template_version_id, EXCLUDED.template_version_id);

            v_runner_count := v_runner_count + 1;
            v_cert_count := v_cert_count + 1;
        END LOOP;

        -- 5c. Process Optional Third Place Team
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
                    issued_at,
                    template_mode,
                    template_version_id
                ) VALUES (
                    v_member.id,
                    p_sub_event_id,
                    'THIRD_PLACE',
                    'UNLOCKED',
                    v_cert_code,
                    NOW(),
                    COALESCE(v_achieve_template_mode, 'DEFAULT'),
                    v_achieve_template_version_id
                )
                ON CONFLICT (team_member_id, sub_event_id, type) DO UPDATE SET
                    status = 'UNLOCKED',
                    certificate_code = COALESCE(public.certificates.certificate_code, EXCLUDED.certificate_code),
                    template_mode = COALESCE(public.certificates.template_mode, EXCLUDED.template_mode),
                    template_version_id = COALESCE(public.certificates.template_version_id, EXCLUDED.template_version_id);

                v_third_count := v_third_count + 1;
                v_cert_count := v_cert_count + 1;
            END LOOP;
        END IF;
    END IF;

    -- 6. Safety catch: Ensure ALL attended participants have their PARTICIPANT certificate
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
                issued_at,
                template_mode,
                template_version_id
            ) VALUES (
                v_member.id,
                p_sub_event_id,
                'PARTICIPANT',
                'UNLOCKED',
                v_cert_code,
                NOW(),
                COALESCE(v_part_template_mode, 'DEFAULT'),
                v_part_template_version_id
            )
            ON CONFLICT (team_member_id, sub_event_id, type) DO NOTHING;

            v_participant_count := v_participant_count + 1;
            v_cert_count := v_cert_count + 1;
        END IF;
    END LOOP;

    -- 7. Unlock all certificates for this sub-event
    UPDATE public.certificates
    SET status = 'UNLOCKED'
    WHERE sub_event_id = p_sub_event_id;

    -- 8. Update sub_events table with locked & published status
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

-- ------------------------------------------------------------------------------
-- 8. ADMIN MANAGEMENT RPCS
-- ------------------------------------------------------------------------------

-- Save newly uploaded template version and activate it
CREATE OR REPLACE FUNCTION public.admin_save_certificate_template(
    p_main_event_id UUID,
    p_certificate_type TEXT,
    p_storage_path TEXT,
    p_original_filename TEXT,
    p_mime_type TEXT,
    p_file_size BIGINT,
    p_width INT DEFAULT 2000,
    p_height INT DEFAULT 1414,
    p_field_positions JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_next_version INT := 1;
    v_new_version_id UUID;
    v_default_fields JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can configure certificate templates.';
    END IF;

    IF p_certificate_type NOT IN ('PARTICIPATION', 'ACHIEVEMENT') THEN
        RAISE EXCEPTION 'Invalid certificate type: must be PARTICIPATION or ACHIEVEMENT';
    END IF;

    -- Calculate next incremental version number
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
    FROM public.certificate_template_versions
    WHERE main_event_id = p_main_event_id
      AND certificate_type = p_certificate_type;

    v_default_fields := '{
        "participant_name": { "x": 1000, "y": 680, "font_size": 48, "font_family": "Segoe UI, Roboto, sans-serif", "font_weight": "900", "alignment": "center", "color": "#0F172A", "is_visible": true },
        "event_name": { "x": 1000, "y": 450, "font_size": 32, "font_family": "Segoe UI, Roboto, sans-serif", "font_weight": "900", "alignment": "center", "color": "#1E3A8A", "is_visible": true },
        "sub_event_name": { "x": 1000, "y": 800, "font_size": 24, "font_family": "Segoe UI, Roboto, sans-serif", "font_weight": "700", "alignment": "center", "color": "#1E293B", "is_visible": true },
        "category_name": { "x": 1000, "y": 490, "font_size": 20, "font_family": "Segoe UI, Roboto, sans-serif", "font_weight": "700", "alignment": "center", "color": "#B45309", "is_visible": false },
        "achievement": { "x": 1000, "y": 530, "font_size": 26, "font_family": "Segoe UI, Roboto, sans-serif", "font_weight": "900", "alignment": "center", "color": "#B45309", "is_visible": true },
        "certificate_code": { "x": 1000, "y": 1280, "font_size": 16, "font_family": "monospace", "font_weight": "700", "alignment": "center", "color": "#0F172A", "is_visible": true },
        "issue_date": { "x": 1000, "y": 1310, "font_size": 14, "font_family": "monospace", "font_weight": "500", "alignment": "center", "color": "#64748B", "is_visible": true },
        "qr_code": { "x": 935, "y": 1130, "width": 130, "height": 130, "is_visible": true }
    }'::jsonb;

    -- Deactivate previous versions
    UPDATE public.certificate_template_versions
    SET is_active = FALSE
    WHERE main_event_id = p_main_event_id
      AND certificate_type = p_certificate_type;

    -- Insert new immutable version
    INSERT INTO public.certificate_template_versions (
        main_event_id,
        certificate_type,
        version_number,
        storage_path,
        original_filename,
        mime_type,
        file_size,
        width,
        height,
        field_positions,
        is_active,
        created_by
    ) VALUES (
        p_main_event_id,
        p_certificate_type,
        v_next_version,
        p_storage_path,
        p_original_filename,
        p_mime_type,
        p_file_size,
        COALESCE(p_width, 2000),
        COALESCE(p_height, 1414),
        COALESCE(p_field_positions, v_default_fields),
        TRUE,
        auth.uid()
    )
    RETURNING id INTO v_new_version_id;

    -- Upsert main_event_certificate_configs to activate CUSTOM mode with this version
    INSERT INTO public.main_event_certificate_configs (
        main_event_id,
        certificate_type,
        template_mode,
        active_template_version_id,
        updated_at
    ) VALUES (
        p_main_event_id,
        p_certificate_type,
        'CUSTOM',
        v_new_version_id,
        NOW()
    )
    ON CONFLICT (main_event_id, certificate_type) DO UPDATE SET
        template_mode = 'CUSTOM',
        active_template_version_id = v_new_version_id,
        updated_at = NOW();

    RETURN jsonb_build_object(
        'success', true,
        'version_id', v_new_version_id,
        'version_number', v_next_version,
        'template_mode', 'CUSTOM'
    );
END;
$$;

-- Switch template mode between DEFAULT and CUSTOM
CREATE OR REPLACE FUNCTION public.admin_switch_certificate_template_mode(
    p_main_event_id UUID,
    p_certificate_type TEXT,
    p_template_mode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_active_ver_id UUID := NULL;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can configure certificate templates.';
    END IF;

    IF p_certificate_type NOT IN ('PARTICIPATION', 'ACHIEVEMENT') THEN
        RAISE EXCEPTION 'Invalid certificate type: must be PARTICIPATION or ACHIEVEMENT';
    END IF;

    IF p_template_mode NOT IN ('DEFAULT', 'CUSTOM') THEN
        RAISE EXCEPTION 'Invalid template mode: must be DEFAULT or CUSTOM';
    END IF;

    IF p_template_mode = 'CUSTOM' THEN
        -- Verify that a template version actually exists
        SELECT id INTO v_active_ver_id
        FROM public.certificate_template_versions
        WHERE main_event_id = p_main_event_id
          AND certificate_type = p_certificate_type
          AND is_active = TRUE
        ORDER BY version_number DESC
        LIMIT 1;

        IF v_active_ver_id IS NULL THEN
            -- Try to pick the latest version if none marked active
            SELECT id INTO v_active_ver_id
            FROM public.certificate_template_versions
            WHERE main_event_id = p_main_event_id
              AND certificate_type = p_certificate_type
            ORDER BY version_number DESC
            LIMIT 1;

            IF v_active_ver_id IS NULL THEN
                RAISE EXCEPTION 'Cannot switch to CUSTOM mode: No custom template has been uploaded for this certificate type yet.';
            ELSE
                UPDATE public.certificate_template_versions SET is_active = TRUE WHERE id = v_active_ver_id;
            END IF;
        END IF;
    END IF;

    INSERT INTO public.main_event_certificate_configs (
        main_event_id,
        certificate_type,
        template_mode,
        active_template_version_id,
        updated_at
    ) VALUES (
        p_main_event_id,
        p_certificate_type,
        p_template_mode,
        v_active_ver_id,
        NOW()
    )
    ON CONFLICT (main_event_id, certificate_type) DO UPDATE SET
        template_mode = p_template_mode,
        active_template_version_id = CASE 
            WHEN p_template_mode = 'CUSTOM' THEN COALESCE(v_active_ver_id, public.main_event_certificate_configs.active_template_version_id)
            ELSE public.main_event_certificate_configs.active_template_version_id
        END,
        updated_at = NOW();

    RETURN jsonb_build_object(
        'success', true,
        'template_mode', p_template_mode,
        'active_template_version_id', v_active_ver_id
    );
END;
$$;

-- Update dynamic field positions on a template version
CREATE OR REPLACE FUNCTION public.admin_update_template_field_positions(
    p_version_id UUID,
    p_field_positions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can configure certificate templates.';
    END IF;

    UPDATE public.certificate_template_versions
    SET field_positions = p_field_positions
    WHERE id = p_version_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Template version not found.';
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Get full Admin Event Certificate Configuration
CREATE OR REPLACE FUNCTION public.get_admin_event_certificate_configs(p_main_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_part_config RECORD;
    v_achieve_config RECORD;
    v_part_versions JSONB;
    v_achieve_versions JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can view full certificate configurations.';
    END IF;

    -- Participation Config & Active Version
    SELECT 
        cfg.id,
        cfg.template_mode,
        cfg.active_template_version_id,
        ctv.version_number,
        ctv.storage_path,
        ctv.original_filename,
        ctv.file_size,
        ctv.width,
        ctv.height,
        ctv.field_positions,
        ctv.created_at as version_created_at
    INTO v_part_config
    FROM public.main_event_certificate_configs cfg
    LEFT JOIN public.certificate_template_versions ctv ON ctv.id = cfg.active_template_version_id
    WHERE cfg.main_event_id = p_main_event_id
      AND cfg.certificate_type = 'PARTICIPATION';

    -- Achievement Config & Active Version
    SELECT 
        cfg.id,
        cfg.template_mode,
        cfg.active_template_version_id,
        ctv.version_number,
        ctv.storage_path,
        ctv.original_filename,
        ctv.file_size,
        ctv.width,
        ctv.height,
        ctv.field_positions,
        ctv.created_at as version_created_at
    INTO v_achieve_config
    FROM public.main_event_certificate_configs cfg
    LEFT JOIN public.certificate_template_versions ctv ON ctv.id = cfg.active_template_version_id
    WHERE cfg.main_event_id = p_main_event_id
      AND cfg.certificate_type = 'ACHIEVEMENT';

    -- Historical versions for Participation
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id,
        'version_number', version_number,
        'storage_path', storage_path,
        'original_filename', original_filename,
        'file_size', file_size,
        'is_active', is_active,
        'created_at', created_at
    ) ORDER BY version_number DESC), '[]'::jsonb)
    INTO v_part_versions
    FROM public.certificate_template_versions
    WHERE main_event_id = p_main_event_id AND certificate_type = 'PARTICIPATION';

    -- Historical versions for Achievement
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id,
        'version_number', version_number,
        'storage_path', storage_path,
        'original_filename', original_filename,
        'file_size', file_size,
        'is_active', is_active,
        'created_at', created_at
    ) ORDER BY version_number DESC), '[]'::jsonb)
    INTO v_achieve_versions
    FROM public.certificate_template_versions
    WHERE main_event_id = p_main_event_id AND certificate_type = 'ACHIEVEMENT';

    RETURN jsonb_build_object(
        'participation', jsonb_build_object(
            'template_mode', COALESCE(v_part_config.template_mode, 'DEFAULT'),
            'active_template_version_id', v_part_config.active_template_version_id,
            'active_version', CASE WHEN v_part_config.active_template_version_id IS NOT NULL THEN jsonb_build_object(
                'id', v_part_config.active_template_version_id,
                'version_number', v_part_config.version_number,
                'storage_path', v_part_config.storage_path,
                'original_filename', v_part_config.original_filename,
                'file_size', v_part_config.file_size,
                'width', v_part_config.width,
                'height', v_part_config.height,
                'field_positions', v_part_config.field_positions,
                'created_at', v_part_config.version_created_at
            ) ELSE NULL END,
            'versions', v_part_versions
        ),
        'achievement', jsonb_build_object(
            'template_mode', COALESCE(v_achieve_config.template_mode, 'DEFAULT'),
            'active_template_version_id', v_achieve_config.active_template_version_id,
            'active_version', CASE WHEN v_achieve_config.active_template_version_id IS NOT NULL THEN jsonb_build_object(
                'id', v_achieve_config.active_template_version_id,
                'version_number', v_achieve_config.version_number,
                'storage_path', v_achieve_config.storage_path,
                'original_filename', v_achieve_config.original_filename,
                'file_size', v_achieve_config.file_size,
                'width', v_achieve_config.width,
                'height', v_achieve_config.height,
                'field_positions', v_achieve_config.field_positions,
                'created_at', v_achieve_config.version_created_at
            ) ELSE NULL END,
            'versions', v_achieve_versions
        )
    );
END;
$$;

-- Function for student certificate resolution: returns template details if authorized
CREATE OR REPLACE FUNCTION public.get_certificate_template_info(p_certificate_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_is_admin BOOLEAN;
    v_cert RECORD;
    v_version RECORD;
BEGIN
    v_user_id := auth.uid();
    v_is_admin := public.is_admin();

    -- Fetch certificate and owner
    SELECT c.*, tm.user_id as member_user_id
    INTO v_cert
    FROM public.certificates c
    LEFT JOIN public.team_members tm ON tm.id = c.team_member_id
    WHERE c.id = p_certificate_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Certificate not found');
    END IF;

    -- Authorization check: Admin OR Owner
    IF NOT v_is_admin AND (v_cert.member_user_id IS NULL OR v_cert.member_user_id <> v_user_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized to access template info for this certificate');
    END IF;

    -- If DEFAULT mode or no template version, return DEFAULT
    IF v_cert.template_mode <> 'CUSTOM' OR v_cert.template_version_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'mode', 'DEFAULT');
    END IF;

    -- Fetch template version
    SELECT * INTO v_version
    FROM public.certificate_template_versions
    WHERE id = v_cert.template_version_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', true, 'mode', 'DEFAULT', 'fallback', true);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'mode', 'CUSTOM',
        'template_version_id', v_version.id,
        'storage_path', v_version.storage_path,
        'field_positions', v_version.field_positions,
        'width', v_version.width,
        'height', v_version.height
    );
END;
$$;

-- Grant permissions to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.admin_save_certificate_template(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, INT, INT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_switch_certificate_template_mode(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_template_field_positions(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_event_certificate_configs(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_certificate_template_info(UUID) TO authenticated, service_role;
