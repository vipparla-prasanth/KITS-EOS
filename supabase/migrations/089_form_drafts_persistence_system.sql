-- ============================================================================
-- MIGRATION 089: DATABASE-BACKED PERSISTENT FORM DRAFTS SYSTEM
-- ============================================================================
-- 1. Table public.form_drafts with explicit ownership namespace:
--    - owner_type: 'STUDENT', 'ADMIN', 'COORDINATOR'
--    - auth_user_id: references auth.users(id) for Student & Admin
--    - coordinator_id: references public.coordinators(id) for Coordinator
--    - Database CHECK constraint enforces exactly one valid owner identity.
-- 2. Optimistic concurrency & stale-write protection via version incrementing.
-- 3. Dedicated RLS policies for authenticated users (Student/Admin). Zero anon access.
-- 4. Server-side authoritative RPCs for save, get, and delete.
-- 5. Coordinator session token verification RPCs.
-- 6. Documented 30-day retention purge function.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: CREATE TABLE public.form_drafts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.form_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_type TEXT NOT NULL CHECK (owner_type IN ('STUDENT', 'ADMIN', 'COORDINATOR')),
    auth_user_id UUID NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    coordinator_id UUID NULL REFERENCES public.coordinators(id) ON DELETE CASCADE,
    draft_type TEXT NOT NULL CHECK (draft_type IN (
        'STUDENT_REGISTRATION',
        'ADMIN_EVENT_CREATE',
        'ADMIN_EVENT_EDIT',
        'ADMIN_CATEGORY_CREATE',
        'ADMIN_CATEGORY_EDIT',
        'ADMIN_SUB_EVENT_CREATE',
        'ADMIN_SUB_EVENT_EDIT',
        'COORDINATOR_WORKFLOW'
    )),
    entity_id UUID NULL,
    title TEXT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    current_step INTEGER NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_form_drafts_owner CHECK (
        (owner_type IN ('STUDENT', 'ADMIN') AND auth_user_id IS NOT NULL AND coordinator_id IS NULL)
        OR
        (owner_type = 'COORDINATOR' AND coordinator_id IS NOT NULL AND auth_user_id IS NULL)
    )
);

-- Indexes for performance & rapid lookup
CREATE INDEX IF NOT EXISTS idx_form_drafts_auth_user 
    ON public.form_drafts (auth_user_id, draft_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_form_drafts_coordinator 
    ON public.form_drafts (coordinator_id, draft_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_form_drafts_retention 
    ON public.form_drafts (updated_at);

-- Single active draft per workflow/entity per owner
CREATE UNIQUE INDEX IF NOT EXISTS idx_form_drafts_unique_auth_user 
    ON public.form_drafts (auth_user_id, draft_type, COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)) 
    WHERE auth_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_form_drafts_unique_coordinator 
    ON public.form_drafts (coordinator_id, draft_type, COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)) 
    WHERE coordinator_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- STEP 2: ROW LEVEL SECURITY & LEAST PRIVILEGE GRANTS
-- ----------------------------------------------------------------------------
ALTER TABLE public.form_drafts ENABLE ROW LEVEL SECURITY;

-- Deny anon access completely
REVOKE ALL ON public.form_drafts FROM anon;
REVOKE ALL ON public.form_drafts FROM public;

-- Grant standard DML to authenticated and service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_drafts TO authenticated;
GRANT ALL ON public.form_drafts TO service_role;

-- Strict owner-only policies for authenticated Supabase users (Student & Admin)
DROP POLICY IF EXISTS "Authenticated users select own drafts" ON public.form_drafts;
CREATE POLICY "Authenticated users select own drafts"
    ON public.form_drafts
    FOR SELECT
    TO authenticated
    USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "Authenticated users insert own drafts" ON public.form_drafts;
CREATE POLICY "Authenticated users insert own drafts"
    ON public.form_drafts
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = auth_user_id 
        AND coordinator_id IS NULL 
        AND owner_type IN ('STUDENT', 'ADMIN')
    );

DROP POLICY IF EXISTS "Authenticated users update own drafts" ON public.form_drafts;
CREATE POLICY "Authenticated users update own drafts"
    ON public.form_drafts
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = auth_user_id)
    WITH CHECK (
        auth.uid() = auth_user_id 
        AND coordinator_id IS NULL 
        AND owner_type IN ('STUDENT', 'ADMIN')
    );

DROP POLICY IF EXISTS "Authenticated users delete own drafts" ON public.form_drafts;
CREATE POLICY "Authenticated users delete own drafts"
    ON public.form_drafts
    FOR DELETE
    TO authenticated
    USING (auth.uid() = auth_user_id);

-- Service role full access
DROP POLICY IF EXISTS "Service role full access on form_drafts" ON public.form_drafts;
CREATE POLICY "Service role full access on form_drafts"
    ON public.form_drafts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- STEP 3: SERVER-SIDE AUTHORITATIVE RPCS (STUDENT & ADMIN)
-- ----------------------------------------------------------------------------

-- 3.1 Save / Update User Draft with Stale-Write Protection
CREATE OR REPLACE FUNCTION public.save_user_draft(
    p_draft_type TEXT,
    p_entity_id UUID DEFAULT NULL,
    p_title TEXT DEFAULT NULL,
    p_payload JSONB DEFAULT '{}'::jsonb,
    p_current_step INT DEFAULT 1,
    p_expected_version INT DEFAULT 1,
    p_draft_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_user_role TEXT;
    v_owner_type TEXT;
    v_draft RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Authentication required',
            'code', 'UNAUTHENTICATED'
        );
    END IF;

    -- Determine user role from public.users
    SELECT role INTO v_user_role FROM public.users WHERE id = v_user_id;
    IF v_user_role = 'ADMIN' THEN
        v_owner_type := 'ADMIN';
    ELSE
        v_owner_type := 'STUDENT';
    END IF;

    -- Locate existing draft by ID or unique composite key
    IF p_draft_id IS NOT NULL THEN
        SELECT * INTO v_draft
        FROM public.form_drafts
        WHERE id = p_draft_id AND auth_user_id = v_user_id
        FOR UPDATE;
    ELSE
        SELECT * INTO v_draft
        FROM public.form_drafts
        WHERE auth_user_id = v_user_id
          AND draft_type = p_draft_type
          AND entity_id IS NOT DISTINCT FROM p_entity_id
        FOR UPDATE;
    END IF;

    -- Handle existing draft update
    IF v_draft.id IS NOT NULL THEN
        -- Optimistic concurrency check
        IF v_draft.version > p_expected_version THEN
            RETURN jsonb_build_object(
                'success', false,
                'conflict', true,
                'code', 'STALE_VERSION',
                'current_version', v_draft.version,
                'current_updated_at', v_draft.updated_at,
                'current_payload', v_draft.payload,
                'current_step', v_draft.current_step,
                'message', 'Draft has been updated in another tab or session.'
            );
        END IF;

        UPDATE public.form_drafts
        SET payload = p_payload,
            title = COALESCE(p_title, v_draft.title),
            current_step = COALESCE(p_current_step, v_draft.current_step),
            version = v_draft.version + 1,
            updated_at = now()
        WHERE id = v_draft.id;

        RETURN jsonb_build_object(
            'success', true,
            'draft_id', v_draft.id,
            'version', v_draft.version + 1,
            'updated_at', now()
        );
    ELSE
        -- Insert new draft
        INSERT INTO public.form_drafts (
            owner_type,
            auth_user_id,
            coordinator_id,
            draft_type,
            entity_id,
            title,
            payload,
            current_step,
            version,
            created_at,
            updated_at
        ) VALUES (
            v_owner_type,
            v_user_id,
            NULL,
            p_draft_type,
            p_entity_id,
            p_title,
            p_payload,
            COALESCE(p_current_step, 1),
            1,
            now(),
            now()
        )
        RETURNING id, version, updated_at INTO v_draft;

        RETURN jsonb_build_object(
            'success', true,
            'draft_id', v_draft.id,
            'version', v_draft.version,
            'updated_at', v_draft.updated_at
        );
    END IF;
END;
$$;

-- 3.2 Query User Drafts
CREATE OR REPLACE FUNCTION public.get_user_drafts(
    p_draft_type TEXT DEFAULT NULL,
    p_entity_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_drafts JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', id,
            'owner_type', owner_type,
            'draft_type', draft_type,
            'entity_id', entity_id,
            'title', title,
            'payload', payload,
            'current_step', current_step,
            'version', version,
            'created_at', created_at,
            'updated_at', updated_at
        ) ORDER BY updated_at DESC
    ) INTO v_drafts
    FROM public.form_drafts
    WHERE auth_user_id = v_user_id
      AND (p_draft_type IS NULL OR draft_type = p_draft_type)
      AND (p_entity_id IS NULL OR entity_id IS NOT DISTINCT FROM p_entity_id);

    RETURN COALESCE(v_drafts, '[]'::jsonb);
END;
$$;

-- 3.3 Delete User Draft
CREATE OR REPLACE FUNCTION public.delete_user_draft(p_draft_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_deleted_count INT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
    END IF;

    DELETE FROM public.form_drafts
    WHERE id = p_draft_id AND auth_user_id = v_user_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', v_deleted_count > 0,
        'deleted_count', v_deleted_count
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 4: COORDINATOR SESSION TOKEN DRAFT RPCS
-- ----------------------------------------------------------------------------

-- 4.1 Save / Update Coordinator Draft
CREATE OR REPLACE FUNCTION public.save_coordinator_draft(
    p_token TEXT,
    p_draft_type TEXT,
    p_entity_id UUID DEFAULT NULL,
    p_title TEXT DEFAULT NULL,
    p_payload JSONB DEFAULT '{}'::jsonb,
    p_current_step INT DEFAULT 1,
    p_expected_version INT DEFAULT 1,
    p_draft_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_draft RECORD;
BEGIN
    v_coord_id := public.get_coordinator_id_by_token(p_token);
    IF v_coord_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid or expired coordinator session',
            'code', 'UNAUTHORIZED'
        );
    END IF;

    -- Locate existing draft by ID or unique composite key
    IF p_draft_id IS NOT NULL THEN
        SELECT * INTO v_draft
        FROM public.form_drafts
        WHERE id = p_draft_id AND coordinator_id = v_coord_id
        FOR UPDATE;
    ELSE
        SELECT * INTO v_draft
        FROM public.form_drafts
        WHERE coordinator_id = v_coord_id
          AND draft_type = p_draft_type
          AND entity_id IS NOT DISTINCT FROM p_entity_id
        FOR UPDATE;
    END IF;

    IF v_draft.id IS NOT NULL THEN
        IF v_draft.version > p_expected_version THEN
            RETURN jsonb_build_object(
                'success', false,
                'conflict', true,
                'code', 'STALE_VERSION',
                'current_version', v_draft.version,
                'current_updated_at', v_draft.updated_at,
                'current_payload', v_draft.payload,
                'current_step', v_draft.current_step,
                'message', 'Draft has been updated in another tab or session.'
            );
        END IF;

        UPDATE public.form_drafts
        SET payload = p_payload,
            title = COALESCE(p_title, v_draft.title),
            current_step = COALESCE(p_current_step, v_draft.current_step),
            version = v_draft.version + 1,
            updated_at = now()
        WHERE id = v_draft.id;

        RETURN jsonb_build_object(
            'success', true,
            'draft_id', v_draft.id,
            'version', v_draft.version + 1,
            'updated_at', now()
        );
    ELSE
        INSERT INTO public.form_drafts (
            owner_type,
            auth_user_id,
            coordinator_id,
            draft_type,
            entity_id,
            title,
            payload,
            current_step,
            version,
            created_at,
            updated_at
        ) VALUES (
            'COORDINATOR',
            NULL,
            v_coord_id,
            p_draft_type,
            p_entity_id,
            p_title,
            p_payload,
            COALESCE(p_current_step, 1),
            1,
            now(),
            now()
        )
        RETURNING id, version, updated_at INTO v_draft;

        RETURN jsonb_build_object(
            'success', true,
            'draft_id', v_draft.id,
            'version', v_draft.version,
            'updated_at', v_draft.updated_at
        );
    END IF;
END;
$$;

-- 4.2 Query Coordinator Drafts
CREATE OR REPLACE FUNCTION public.get_coordinator_drafts(
    p_token TEXT,
    p_draft_type TEXT DEFAULT NULL,
    p_entity_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_drafts JSONB;
BEGIN
    v_coord_id := public.get_coordinator_id_by_token(p_token);
    IF v_coord_id IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', id,
            'owner_type', owner_type,
            'draft_type', draft_type,
            'entity_id', entity_id,
            'title', title,
            'payload', payload,
            'current_step', current_step,
            'version', version,
            'created_at', created_at,
            'updated_at', updated_at
        ) ORDER BY updated_at DESC
    ) INTO v_drafts
    FROM public.form_drafts
    WHERE coordinator_id = v_coord_id
      AND (p_draft_type IS NULL OR draft_type = p_draft_type)
      AND (p_entity_id IS NULL OR entity_id IS NOT DISTINCT FROM p_entity_id);

    RETURN COALESCE(v_drafts, '[]'::jsonb);
END;
$$;

-- 4.3 Delete Coordinator Draft
CREATE OR REPLACE FUNCTION public.delete_coordinator_draft(
    p_token TEXT,
    p_draft_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coord_id UUID;
    v_deleted_count INT;
BEGIN
    v_coord_id := public.get_coordinator_id_by_token(p_token);
    IF v_coord_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid coordinator session');
    END IF;

    DELETE FROM public.form_drafts
    WHERE id = p_draft_id AND coordinator_id = v_coord_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', v_deleted_count > 0,
        'deleted_count', v_deleted_count
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 5: 30-DAY RETENTION POLICY MAINTENANCE FUNCTION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_form_drafts(p_retention_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted_count INT;
BEGIN
    DELETE FROM public.form_drafts
    WHERE updated_at < (now() - (p_retention_days || ' days')::interval);

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 6: GRANT EXECUTE ON ALL NEW RPCS
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.save_user_draft(TEXT, UUID, TEXT, JSONB, INT, INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_drafts(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_draft(UUID) TO authenticated;

-- Public/anon can execute coordinator RPCs because they authenticate via token
GRANT EXECUTE ON FUNCTION public.save_coordinator_draft(TEXT, TEXT, UUID, TEXT, JSONB, INT, INT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_coordinator_drafts(TEXT, TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_coordinator_draft(TEXT, UUID) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.purge_expired_form_drafts(INT) TO service_role;
