-- 101_create_manage_stalls_module.sql
-- MANAGE STALLS MODULE (STANDALONE FEATURE FOR EVENT STALLS)

-- 1. Create stalls table
CREATE TABLE IF NOT EXISTS public.stalls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    venue VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    banner_path VARCHAR(500),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('APPROVED', 'PENDING_APPROVAL', 'REJECTED', 'ARCHIVED')),
    created_by_type VARCHAR(20) NOT NULL DEFAULT 'STUDENT' CHECK (created_by_type IN ('ADMIN', 'STUDENT')),
    created_by_student_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_by_admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    rejection_reason TEXT,
    approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
);

-- 2. Create stall_owners table
CREATE TABLE IF NOT EXISTS public.stall_owners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stall_id UUID NOT NULL REFERENCES public.stalls(id) ON DELETE CASCADE,
    owner_name VARCHAR(255) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create stall_contacts table
CREATE TABLE IF NOT EXISTS public.stall_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stall_id UUID NOT NULL REFERENCES public.stalls(id) ON DELETE CASCADE,
    contact_value VARCHAR(50) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_stalls_event_id ON public.stalls(event_id);
CREATE INDEX IF NOT EXISTS idx_stalls_status ON public.stalls(status);
CREATE INDEX IF NOT EXISTS idx_stalls_created_by_student ON public.stalls(created_by_student_id);
CREATE INDEX IF NOT EXISTS idx_stalls_event_status ON public.stalls(event_id, status);
CREATE INDEX IF NOT EXISTS idx_stall_owners_stall_id ON public.stall_owners(stall_id);
CREATE INDEX IF NOT EXISTS idx_stall_contacts_stall_id ON public.stall_contacts(stall_id);

-- 5. Storage Bucket Configuration for stall-banners
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'stall-banners',
    'stall-banners',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Storage RLS Policies for stall-banners
DO $$
BEGIN
    DROP POLICY IF EXISTS "Public can view stall banners" ON storage.objects;
    CREATE POLICY "Public can view stall banners" ON storage.objects
        FOR SELECT
        USING (bucket_id = 'stall-banners');

    DROP POLICY IF EXISTS "Authenticated users can upload stall banners" ON storage.objects;
    CREATE POLICY "Authenticated users can upload stall banners" ON storage.objects
        FOR INSERT
        WITH CHECK (
            bucket_id = 'stall-banners'
            AND auth.role() = 'authenticated'
        );

    DROP POLICY IF EXISTS "Admin and owners can update stall banners" ON storage.objects;
    CREATE POLICY "Admin and owners can update stall banners" ON storage.objects
        FOR UPDATE
        USING (
            bucket_id = 'stall-banners'
            AND auth.role() = 'authenticated'
        );

    DROP POLICY IF EXISTS "Admin can delete stall banners" ON storage.objects;
    CREATE POLICY "Admin can delete stall banners" ON storage.objects
        FOR DELETE
        USING (
            bucket_id = 'stall-banners'
            AND (
                EXISTS (
                    SELECT 1 FROM public.users u 
                    WHERE u.id = auth.uid() 
                      AND u.role = 'ADMIN'::public.user_role 
                      AND u.status = 'ACTIVE'
                )
            )
        );
END $$;

-- 6. Enable RLS on Tables
ALTER TABLE public.stalls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stall_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stall_contacts ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies on stalls
DO $$
BEGIN
    DROP POLICY IF EXISTS "stalls_select_policy" ON public.stalls;
    CREATE POLICY "stalls_select_policy" ON public.stalls
        FOR SELECT
        USING (
            -- 1. Admin can see all stalls
            EXISTS (
                SELECT 1 FROM public.users u 
                WHERE u.id = auth.uid() 
                  AND u.role = 'ADMIN'::public.user_role 
                  AND u.status = 'ACTIVE'
            )
            OR
            -- 2. Anyone can see APPROVED stalls under active/completed non-deleted events
            (
                status = 'APPROVED'
                AND EXISTS (
                    SELECT 1 FROM public.events e 
                    WHERE e.id = stalls.event_id 
                      AND e.status != 'PERMANENTLY_DELETED'
                )
            )
            OR
            -- 3. Authenticated student can see their own submissions
            (
                auth.uid() IS NOT NULL 
                AND created_by_student_id = auth.uid()
            )
        );

    DROP POLICY IF EXISTS "stalls_insert_policy" ON public.stalls;
    CREATE POLICY "stalls_insert_policy" ON public.stalls
        FOR INSERT
        WITH CHECK (
            -- 1. Admin can insert
            EXISTS (
                SELECT 1 FROM public.users u 
                WHERE u.id = auth.uid() 
                  AND u.role = 'ADMIN'::public.user_role 
                  AND u.status = 'ACTIVE'
            )
            OR
            -- 2. Student can insert their own pending submission
            (
                auth.uid() IS NOT NULL
                AND created_by_student_id = auth.uid()
                AND created_by_type = 'STUDENT'
                AND status = 'PENDING_APPROVAL'
                AND approved_by IS NULL
                AND approved_at IS NULL
                AND rejection_reason IS NULL
            )
        );

    DROP POLICY IF EXISTS "stalls_update_policy" ON public.stalls;
    CREATE POLICY "stalls_update_policy" ON public.stalls
        FOR UPDATE
        USING (
            -- 1. Admin can update any stall
            EXISTS (
                SELECT 1 FROM public.users u 
                WHERE u.id = auth.uid() 
                  AND u.role = 'ADMIN'::public.user_role 
                  AND u.status = 'ACTIVE'
            )
            OR
            -- 2. Student can update only their own pending submission
            (
                auth.uid() IS NOT NULL
                AND created_by_student_id = auth.uid()
                AND status = 'PENDING_APPROVAL'
            )
        )
        WITH CHECK (
            -- If student, status must remain PENDING_APPROVAL
            EXISTS (
                SELECT 1 FROM public.users u 
                WHERE u.id = auth.uid() 
                  AND u.role = 'ADMIN'::public.user_role 
                  AND u.status = 'ACTIVE'
            )
            OR
            (
                auth.uid() IS NOT NULL
                AND created_by_student_id = auth.uid()
                AND status = 'PENDING_APPROVAL'
                AND approved_by IS NULL
                AND approved_at IS NULL
            )
        );

    DROP POLICY IF EXISTS "stalls_delete_policy" ON public.stalls;
    CREATE POLICY "stalls_delete_policy" ON public.stalls
        FOR DELETE
        USING (
            EXISTS (
                SELECT 1 FROM public.users u 
                WHERE u.id = auth.uid() 
                  AND u.role = 'ADMIN'::public.user_role 
                  AND u.status = 'ACTIVE'
            )
            OR
            (
                auth.uid() IS NOT NULL
                AND created_by_student_id = auth.uid()
                AND status = 'PENDING_APPROVAL'
            )
        );
END $$;

-- 8. RLS Policies on stall_owners and stall_contacts
DO $$
BEGIN
    DROP POLICY IF EXISTS "stall_owners_select_policy" ON public.stall_owners;
    CREATE POLICY "stall_owners_select_policy" ON public.stall_owners
        FOR SELECT
        USING (
            EXISTS (
                SELECT 1 FROM public.stalls s
                WHERE s.id = stall_owners.stall_id
            )
        );

    DROP POLICY IF EXISTS "stall_owners_all_policy" ON public.stall_owners;
    CREATE POLICY "stall_owners_all_policy" ON public.stall_owners
        FOR ALL
        USING (
            EXISTS (
                SELECT 1 FROM public.users u 
                WHERE u.id = auth.uid() 
                  AND u.role = 'ADMIN'::public.user_role 
                  AND u.status = 'ACTIVE'
            )
            OR
            EXISTS (
                SELECT 1 FROM public.stalls s
                WHERE s.id = stall_owners.stall_id
                  AND s.created_by_student_id = auth.uid()
                  AND s.status = 'PENDING_APPROVAL'
            )
        );

    DROP POLICY IF EXISTS "stall_contacts_select_policy" ON public.stall_contacts;
    CREATE POLICY "stall_contacts_select_policy" ON public.stall_contacts
        FOR SELECT
        USING (
            EXISTS (
                SELECT 1 FROM public.stalls s
                WHERE s.id = stall_contacts.stall_id
            )
        );

    DROP POLICY IF EXISTS "stall_contacts_all_policy" ON public.stall_contacts;
    CREATE POLICY "stall_contacts_all_policy" ON public.stall_contacts
        FOR ALL
        USING (
            EXISTS (
                SELECT 1 FROM public.users u 
                WHERE u.id = auth.uid() 
                  AND u.role = 'ADMIN'::public.user_role 
                  AND u.status = 'ACTIVE'
            )
            OR
            EXISTS (
                SELECT 1 FROM public.stalls s
                WHERE s.id = stall_contacts.stall_id
                  AND s.created_by_student_id = auth.uid()
                  AND s.status = 'PENDING_APPROVAL'
            )
        );
END $$;

-- 9. Authoritative Backend Functions (RPCs)

-- A) ADMIN: CREATE STALL
CREATE OR REPLACE FUNCTION public.admin_create_stall(
    p_event_id UUID,
    p_name TEXT,
    p_venue TEXT,
    p_description TEXT,
    p_banner_path TEXT DEFAULT NULL,
    p_owners TEXT[] DEFAULT '{}'::TEXT[],
    p_contacts TEXT[] DEFAULT '{}'::TEXT[],
    p_display_order INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_admin_id UUID;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_stall_id UUID;
    v_clean_name TEXT;
    v_clean_venue TEXT;
    v_clean_desc TEXT;
    v_owner TEXT;
    v_contact TEXT;
    v_idx INT := 0;
BEGIN
    v_admin_id := auth.uid();
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT role, status INTO v_user_role, v_user_status
    FROM public.users
    WHERE id = v_admin_id;

    IF v_user_status <> 'ACTIVE' OR v_user_role <> 'ADMIN'::public.user_role THEN
        RAISE EXCEPTION 'Unauthorized: Administrative role required' USING ERRCODE = '42501';
    END IF;

    -- Validate Event
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id AND status != 'PERMANENTLY_DELETED') THEN
        RAISE EXCEPTION 'Specified event does not exist or is deleted' USING ERRCODE = 'P0002';
    END IF;

    v_clean_name := UPPER(trim(COALESCE(p_name, '')));
    v_clean_venue := trim(COALESCE(p_venue, ''));
    v_clean_desc := trim(COALESCE(p_description, ''));

    IF length(v_clean_name) < 2 THEN
        RAISE EXCEPTION 'Stall name must be at least 2 characters' USING ERRCODE = '22023';
    END IF;
    IF length(v_clean_venue) < 2 THEN
        RAISE EXCEPTION 'Stall venue must be specified' USING ERRCODE = '22023';
    END IF;
    IF length(v_clean_desc) < 5 THEN
        RAISE EXCEPTION 'Stall description must be at least 5 characters' USING ERRCODE = '22023';
    END IF;
    IF array_length(p_owners, 1) IS NULL OR array_length(p_owners, 1) = 0 THEN
        RAISE EXCEPTION 'At least one stall owner is required' USING ERRCODE = '22023';
    END IF;
    IF array_length(p_contacts, 1) IS NULL OR array_length(p_contacts, 1) = 0 THEN
        RAISE EXCEPTION 'At least one stall contact is required' USING ERRCODE = '22023';
    END IF;

    -- Insert Stall (Admin created = APPROVED immediately)
    INSERT INTO public.stalls (
        event_id,
        name,
        venue,
        description,
        banner_path,
        status,
        created_by_type,
        created_by_admin_id,
        approved_by,
        approved_at,
        display_order
    ) VALUES (
        p_event_id,
        v_clean_name,
        v_clean_venue,
        v_clean_desc,
        NULLIF(trim(p_banner_path), ''),
        'APPROVED',
        'ADMIN',
        v_admin_id,
        v_admin_id,
        now(),
        COALESCE(p_display_order, 0)
    )
    RETURNING id INTO v_stall_id;

    -- Insert Owners
    v_idx := 0;
    FOREACH v_owner IN ARRAY p_owners LOOP
        IF trim(v_owner) <> '' THEN
            INSERT INTO public.stall_owners (stall_id, owner_name, display_order)
            VALUES (v_stall_id, trim(v_owner), v_idx);
            v_idx := v_idx + 1;
        END IF;
    END LOOP;

    -- Insert Contacts
    v_idx := 0;
    FOREACH v_contact IN ARRAY p_contacts LOOP
        IF trim(v_contact) <> '' THEN
            INSERT INTO public.stall_contacts (stall_id, contact_value, display_order)
            VALUES (v_stall_id, trim(v_contact), v_idx);
            v_idx := v_idx + 1;
        END IF;
    END LOOP;

    -- Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_admin_id,
        'STALL_CREATED_BY_ADMIN',
        'stalls',
        v_stall_id,
        jsonb_build_object(
            'stall_id', v_stall_id,
            'event_id', p_event_id,
            'name', v_clean_name,
            'venue', v_clean_venue
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'stall_id', v_stall_id,
        'message', 'Stall successfully created and published'
    );
END;
$$;

-- B) ADMIN: UPDATE STALL
CREATE OR REPLACE FUNCTION public.admin_update_stall(
    p_stall_id UUID,
    p_name TEXT,
    p_venue TEXT,
    p_description TEXT,
    p_banner_path TEXT DEFAULT NULL,
    p_owners TEXT[] DEFAULT '{}'::TEXT[],
    p_contacts TEXT[] DEFAULT '{}'::TEXT[],
    p_display_order INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_admin_id UUID;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_clean_name TEXT;
    v_clean_venue TEXT;
    v_clean_desc TEXT;
    v_owner TEXT;
    v_contact TEXT;
    v_idx INT := 0;
BEGIN
    v_admin_id := auth.uid();
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT role, status INTO v_user_role, v_user_status
    FROM public.users
    WHERE id = v_admin_id;

    IF v_user_status <> 'ACTIVE' OR v_user_role <> 'ADMIN'::public.user_role THEN
        RAISE EXCEPTION 'Unauthorized: Administrative role required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.stalls WHERE id = p_stall_id) THEN
        RAISE EXCEPTION 'Stall record does not exist' USING ERRCODE = 'P0002';
    END IF;

    v_clean_name := UPPER(trim(COALESCE(p_name, '')));
    v_clean_venue := trim(COALESCE(p_venue, ''));
    v_clean_desc := trim(COALESCE(p_description, ''));

    IF length(v_clean_name) < 2 THEN
        RAISE EXCEPTION 'Stall name must be at least 2 characters' USING ERRCODE = '22023';
    END IF;
    IF length(v_clean_venue) < 2 THEN
        RAISE EXCEPTION 'Stall venue must be specified' USING ERRCODE = '22023';
    END IF;
    IF length(v_clean_desc) < 5 THEN
        RAISE EXCEPTION 'Stall description must be at least 5 characters' USING ERRCODE = '22023';
    END IF;
    IF array_length(p_owners, 1) IS NULL OR array_length(p_owners, 1) = 0 THEN
        RAISE EXCEPTION 'At least one stall owner is required' USING ERRCODE = '22023';
    END IF;
    IF array_length(p_contacts, 1) IS NULL OR array_length(p_contacts, 1) = 0 THEN
        RAISE EXCEPTION 'At least one stall contact is required' USING ERRCODE = '22023';
    END IF;

    UPDATE public.stalls
    SET name = v_clean_name,
        venue = v_clean_venue,
        description = v_clean_desc,
        banner_path = COALESCE(NULLIF(trim(p_banner_path), ''), banner_path),
        display_order = COALESCE(p_display_order, display_order),
        updated_at = now()
    WHERE id = p_stall_id;

    -- Replace owners
    DELETE FROM public.stall_owners WHERE stall_id = p_stall_id;
    v_idx := 0;
    FOREACH v_owner IN ARRAY p_owners LOOP
        IF trim(v_owner) <> '' THEN
            INSERT INTO public.stall_owners (stall_id, owner_name, display_order)
            VALUES (p_stall_id, trim(v_owner), v_idx);
            v_idx := v_idx + 1;
        END IF;
    END LOOP;

    -- Replace contacts
    DELETE FROM public.stall_contacts WHERE stall_id = p_stall_id;
    v_idx := 0;
    FOREACH v_contact IN ARRAY p_contacts LOOP
        IF trim(v_contact) <> '' THEN
            INSERT INTO public.stall_contacts (stall_id, contact_value, display_order)
            VALUES (p_stall_id, trim(v_contact), v_idx);
            v_idx := v_idx + 1;
        END IF;
    END LOOP;

    -- Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_admin_id,
        'STALL_UPDATED_BY_ADMIN',
        'stalls',
        p_stall_id,
        jsonb_build_object(
            'stall_id', p_stall_id,
            'name', v_clean_name,
            'venue', v_clean_venue
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Stall successfully updated'
    );
END;
$$;

-- C) ADMIN: APPROVE STALL
CREATE OR REPLACE FUNCTION public.admin_approve_stall(
    p_stall_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_admin_id UUID;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_stall RECORD;
    v_event_name TEXT;
    v_event_key TEXT;
BEGIN
    v_admin_id := auth.uid();
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT role, status INTO v_user_role, v_user_status
    FROM public.users
    WHERE id = v_admin_id;

    IF v_user_status <> 'ACTIVE' OR v_user_role <> 'ADMIN'::public.user_role THEN
        RAISE EXCEPTION 'Unauthorized: Administrative role required' USING ERRCODE = '42501';
    END IF;

    SELECT s.*, e.name AS event_name
    INTO v_stall
    FROM public.stalls s
    JOIN public.events e ON e.id = s.event_id
    WHERE s.id = p_stall_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stall record not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_stall.status = 'APPROVED' THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Stall is already approved'
        );
    END IF;

    UPDATE public.stalls
    SET status = 'APPROVED',
        approved_by = v_admin_id,
        approved_at = now(),
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = p_stall_id;

    -- Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_admin_id,
        'STALL_APPROVED',
        'stalls',
        p_stall_id,
        jsonb_build_object(
            'stall_id', p_stall_id,
            'name', v_stall.name,
            'event_id', v_stall.event_id,
            'created_by_student_id', v_stall.created_by_student_id
        )
    );

    -- Notify Submitting Student if applicable
    IF v_stall.created_by_student_id IS NOT NULL THEN
        v_event_key := 'STALL_APPROVED:' || p_stall_id::text;
        INSERT INTO public.notifications (
            user_id,
            recipient_role,
            notification_type,
            category,
            entity_type,
            entity_id,
            title,
            message,
            event_key,
            metadata,
            is_read,
            created_at
        ) VALUES (
            v_stall.created_by_student_id,
            'STUDENT',
            'STALL_APPROVED',
            'STALL',
            'STALL',
            p_stall_id,
            'Stall Approved',
            'Your stall "' || v_stall.name || '" for ' || v_stall.event_name || ' has been approved and is now visible in the Stall Directory.',
            v_event_key,
            jsonb_build_object(
                'stall_id', p_stall_id,
                'stall_name', v_stall.name,
                'event_id', v_stall.event_id,
                'event_name', v_stall.event_name
            ),
            FALSE,
            now()
        )
        ON CONFLICT (event_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Stall successfully approved and published'
    );
END;
$$;

-- D) ADMIN: REJECT STALL
CREATE OR REPLACE FUNCTION public.admin_reject_stall(
    p_stall_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_admin_id UUID;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_stall RECORD;
    v_clean_reason TEXT;
    v_event_key TEXT;
BEGIN
    v_admin_id := auth.uid();
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT role, status INTO v_user_role, v_user_status
    FROM public.users
    WHERE id = v_admin_id;

    IF v_user_status <> 'ACTIVE' OR v_user_role <> 'ADMIN'::public.user_role THEN
        RAISE EXCEPTION 'Unauthorized: Administrative role required' USING ERRCODE = '42501';
    END IF;

    v_clean_reason := trim(COALESCE(p_reason, ''));
    IF length(v_clean_reason) < 3 THEN
        RAISE EXCEPTION 'A clear rejection reason must be provided (at least 3 characters)' USING ERRCODE = '22023';
    END IF;

    SELECT s.*, e.name AS event_name
    INTO v_stall
    FROM public.stalls s
    JOIN public.events e ON e.id = s.event_id
    WHERE s.id = p_stall_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stall record not found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.stalls
    SET status = 'REJECTED',
        rejection_reason = v_clean_reason,
        approved_by = NULL,
        approved_at = NULL,
        updated_at = now()
    WHERE id = p_stall_id;

    -- Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_admin_id,
        'STALL_REJECTED',
        'stalls',
        p_stall_id,
        jsonb_build_object(
            'stall_id', p_stall_id,
            'name', v_stall.name,
            'reason', v_clean_reason,
            'created_by_student_id', v_stall.created_by_student_id
        )
    );

    -- Notify Submitting Student if applicable
    IF v_stall.created_by_student_id IS NOT NULL THEN
        v_event_key := 'STALL_REJECTED:' || p_stall_id::text || ':' || extract(epoch from now())::text;
        INSERT INTO public.notifications (
            user_id,
            recipient_role,
            notification_type,
            category,
            entity_type,
            entity_id,
            title,
            message,
            event_key,
            metadata,
            is_read,
            created_at
        ) VALUES (
            v_stall.created_by_student_id,
            'STUDENT',
            'STALL_REJECTED',
            'STALL',
            'STALL',
            p_stall_id,
            'Stall Submission Rejected',
            'Your stall submission "' || v_stall.name || '" for ' || v_stall.event_name || ' was rejected by Admin. Reason: ' || v_clean_reason,
            v_event_key,
            jsonb_build_object(
                'stall_id', p_stall_id,
                'stall_name', v_stall.name,
                'event_id', v_stall.event_id,
                'event_name', v_stall.event_name,
                'reason', v_clean_reason
            ),
            FALSE,
            now()
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Stall submission rejected'
    );
END;
$$;

-- E) ADMIN: DELETE / ARCHIVE STALL
CREATE OR REPLACE FUNCTION public.admin_delete_stall(
    p_stall_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_admin_id UUID;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_stall RECORD;
BEGIN
    v_admin_id := auth.uid();
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT role, status INTO v_user_role, v_user_status
    FROM public.users
    WHERE id = v_admin_id;

    IF v_user_status <> 'ACTIVE' OR v_user_role <> 'ADMIN'::public.user_role THEN
        RAISE EXCEPTION 'Unauthorized: Administrative role required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_stall FROM public.stalls WHERE id = p_stall_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stall record not found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.stalls
    SET status = 'ARCHIVED',
        archived_at = now(),
        updated_at = now()
    WHERE id = p_stall_id;

    -- Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_admin_id,
        'STALL_ARCHIVED',
        'stalls',
        p_stall_id,
        jsonb_build_object('name', v_stall.name, 'event_id', v_stall.event_id)
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Stall archived successfully'
    );
END;
$$;

-- F) STUDENT: SUBMIT STALL PROPOSAL
CREATE OR REPLACE FUNCTION public.student_submit_stall(
    p_event_id UUID,
    p_name TEXT,
    p_venue TEXT,
    p_description TEXT,
    p_banner_path TEXT DEFAULT NULL,
    p_owners TEXT[] DEFAULT '{}'::TEXT[],
    p_contacts TEXT[] DEFAULT '{}'::TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_student_id UUID;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_event RECORD;
    v_stall_id UUID;
    v_clean_name TEXT;
    v_clean_venue TEXT;
    v_clean_desc TEXT;
    v_owner TEXT;
    v_contact TEXT;
    v_idx INT := 0;
    v_admin_rec RECORD;
BEGIN
    v_student_id := auth.uid();
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to submit a stall proposal' USING ERRCODE = '42501';
    END IF;

    SELECT role, status INTO v_user_role, v_user_status
    FROM public.users
    WHERE id = v_student_id;

    IF v_user_status <> 'ACTIVE' OR v_user_role <> 'STUDENT'::public.user_role THEN
        RAISE EXCEPTION 'Unauthorized: Only registered student accounts can submit stall proposals' USING ERRCODE = '42501';
    END IF;

    -- Verify Event
    SELECT id, name, status INTO v_event
    FROM public.events
    WHERE id = p_event_id;

    IF NOT FOUND OR v_event.status = 'PERMANENTLY_DELETED' OR v_event.status = 'ARCHIVED' THEN
        RAISE EXCEPTION 'Stalls can only be submitted for active upcoming events' USING ERRCODE = '22023';
    END IF;

    v_clean_name := UPPER(trim(COALESCE(p_name, '')));
    v_clean_venue := trim(COALESCE(p_venue, ''));
    v_clean_desc := trim(COALESCE(p_description, ''));

    IF length(v_clean_name) < 2 THEN
        RAISE EXCEPTION 'Stall name must be at least 2 characters' USING ERRCODE = '22023';
    END IF;
    IF length(v_clean_venue) < 2 THEN
        RAISE EXCEPTION 'Stall venue must be specified' USING ERRCODE = '22023';
    END IF;
    IF length(v_clean_desc) < 5 THEN
        RAISE EXCEPTION 'Stall description must be at least 5 characters' USING ERRCODE = '22023';
    END IF;
    IF array_length(p_owners, 1) IS NULL OR array_length(p_owners, 1) = 0 THEN
        RAISE EXCEPTION 'At least one stall owner is required' USING ERRCODE = '22023';
    END IF;
    IF array_length(p_contacts, 1) IS NULL OR array_length(p_contacts, 1) = 0 THEN
        RAISE EXCEPTION 'At least one stall contact number is required' USING ERRCODE = '22023';
    END IF;

    -- Insert Stall with status PENDING_APPROVAL
    INSERT INTO public.stalls (
        event_id,
        name,
        venue,
        description,
        banner_path,
        status,
        created_by_type,
        created_by_student_id,
        approved_by,
        approved_at,
        display_order
    ) VALUES (
        p_event_id,
        v_clean_name,
        v_clean_venue,
        v_clean_desc,
        NULLIF(trim(p_banner_path), ''),
        'PENDING_APPROVAL',
        'STUDENT',
        v_student_id,
        NULL,
        NULL,
        0
    )
    RETURNING id INTO v_stall_id;

    -- Insert Owners
    v_idx := 0;
    FOREACH v_owner IN ARRAY p_owners LOOP
        IF trim(v_owner) <> '' THEN
            INSERT INTO public.stall_owners (stall_id, owner_name, display_order)
            VALUES (v_stall_id, trim(v_owner), v_idx);
            v_idx := v_idx + 1;
        END IF;
    END LOOP;

    -- Insert Contacts
    v_idx := 0;
    FOREACH v_contact IN ARRAY p_contacts LOOP
        IF trim(v_contact) <> '' THEN
            INSERT INTO public.stall_contacts (stall_id, contact_value, display_order)
            VALUES (v_stall_id, trim(v_contact), v_idx);
            v_idx := v_idx + 1;
        END IF;
    END LOOP;

    -- Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_student_id,
        'STALL_SUBMITTED_BY_STUDENT',
        'stalls',
        v_stall_id,
        jsonb_build_object(
            'stall_id', v_stall_id,
            'event_id', p_event_id,
            'name', v_clean_name
        )
    );

    -- Notify Admins about the pending proposal
    FOR v_admin_rec IN 
        SELECT id FROM public.users WHERE role = 'ADMIN'::public.user_role AND status = 'ACTIVE'
    LOOP
        INSERT INTO public.notifications (
            user_id,
            recipient_role,
            notification_type,
            category,
            entity_type,
            entity_id,
            title,
            message,
            event_key,
            metadata,
            is_read,
            created_at
        ) VALUES (
            v_admin_rec.id,
            'ADMIN',
            'STALL_SUBMISSION',
            'STALL',
            'STALL',
            v_stall_id,
            'New Stall Submitted',
            '"' || v_clean_name || '" was submitted for ' || v_event.name || ' and is awaiting approval.',
            'STALL_SUBMISSION:' || v_stall_id::text || ':' || v_admin_rec.id::text,
            jsonb_build_object(
                'stall_id', v_stall_id,
                'stall_name', v_clean_name,
                'event_id', p_event_id,
                'event_name', v_event.name,
                'student_id', v_student_id
            ),
            FALSE,
            now()
        )
        ON CONFLICT (event_key) DO NOTHING;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'stall_id', v_stall_id,
        'message', 'Your stall proposal has been submitted and is awaiting administrator approval.'
    );
END;
$$;

-- G) STUDENT: UPDATE PENDING STALL
CREATE OR REPLACE FUNCTION public.student_update_pending_stall(
    p_stall_id UUID,
    p_name TEXT,
    p_venue TEXT,
    p_description TEXT,
    p_banner_path TEXT DEFAULT NULL,
    p_owners TEXT[] DEFAULT '{}'::TEXT[],
    p_contacts TEXT[] DEFAULT '{}'::TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_student_id UUID;
    v_stall RECORD;
    v_clean_name TEXT;
    v_clean_venue TEXT;
    v_clean_desc TEXT;
    v_owner TEXT;
    v_contact TEXT;
    v_idx INT := 0;
BEGIN
    v_student_id := auth.uid();
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_stall
    FROM public.stalls
    WHERE id = p_stall_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stall record not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_stall.created_by_student_id <> v_student_id THEN
        RAISE EXCEPTION 'Forbidden: You can only edit your own stall proposal' USING ERRCODE = '42501';
    END IF;

    IF v_stall.status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'Only pending stall submissions can be edited. Approved or rejected stalls cannot be altered directly.' USING ERRCODE = '22023';
    END IF;

    v_clean_name := UPPER(trim(COALESCE(p_name, '')));
    v_clean_venue := trim(COALESCE(p_venue, ''));
    v_clean_desc := trim(COALESCE(p_description, ''));

    IF length(v_clean_name) < 2 THEN
        RAISE EXCEPTION 'Stall name must be at least 2 characters' USING ERRCODE = '22023';
    END IF;
    IF length(v_clean_venue) < 2 THEN
        RAISE EXCEPTION 'Stall venue must be specified' USING ERRCODE = '22023';
    END IF;
    IF length(v_clean_desc) < 5 THEN
        RAISE EXCEPTION 'Stall description must be at least 5 characters' USING ERRCODE = '22023';
    END IF;

    UPDATE public.stalls
    SET name = v_clean_name,
        venue = v_clean_venue,
        description = v_clean_desc,
        banner_path = COALESCE(NULLIF(trim(p_banner_path), ''), banner_path),
        updated_at = now()
    WHERE id = p_stall_id;

    -- Replace owners
    IF array_length(p_owners, 1) > 0 THEN
        DELETE FROM public.stall_owners WHERE stall_id = p_stall_id;
        v_idx := 0;
        FOREACH v_owner IN ARRAY p_owners LOOP
            IF trim(v_owner) <> '' THEN
                INSERT INTO public.stall_owners (stall_id, owner_name, display_order)
                VALUES (p_stall_id, trim(v_owner), v_idx);
                v_idx := v_idx + 1;
            END IF;
        END LOOP;
    END IF;

    -- Replace contacts
    IF array_length(p_contacts, 1) > 0 THEN
        DELETE FROM public.stall_contacts WHERE stall_id = p_stall_id;
        v_idx := 0;
        FOREACH v_contact IN ARRAY p_contacts LOOP
            IF trim(v_contact) <> '' THEN
                INSERT INTO public.stall_contacts (stall_id, contact_value, display_order)
                VALUES (p_stall_id, trim(v_contact), v_idx);
                v_idx := v_idx + 1;
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Your pending stall proposal has been updated'
    );
END;
$$;

-- Grant permissions to authenticated and anon
GRANT SELECT ON public.stalls TO authenticated, anon;
GRANT SELECT ON public.stall_owners TO authenticated, anon;
GRANT SELECT ON public.stall_contacts TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.stalls TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.stall_owners TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.stall_contacts TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_create_stall TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_stall TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_stall TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_stall TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_stall TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_submit_stall TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_update_pending_stall TO authenticated;

-- H) ADMIN: PERMANENTLY DELETE STALL
CREATE OR REPLACE FUNCTION public.admin_permanent_delete_stall(
    p_stall_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_admin_id UUID;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_stall RECORD;
BEGIN
    v_admin_id := auth.uid();
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT role, status INTO v_user_role, v_user_status
    FROM public.users
    WHERE id = v_admin_id;

    IF v_user_status <> 'ACTIVE' OR v_user_role <> 'ADMIN'::public.user_role THEN
        RAISE EXCEPTION 'Unauthorized: Administrative role required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_stall FROM public.stalls WHERE id = p_stall_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stall record not found' USING ERRCODE = 'P0002';
    END IF;

    -- Delete child dependencies atomically (also cascade delete)
    DELETE FROM public.stall_contacts WHERE stall_id = p_stall_id;
    DELETE FROM public.stall_owners WHERE stall_id = p_stall_id;

    -- Delete parent stall
    DELETE FROM public.stalls WHERE id = p_stall_id;

    -- Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_admin_id,
        'STALL_PERMANENTLY_DELETED',
        'stalls',
        p_stall_id,
        jsonb_build_object(
            'stall_id', p_stall_id,
            'name', v_stall.name,
            'event_id', v_stall.event_id,
            'venue', v_stall.venue
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Stall permanently deleted'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_permanent_delete_stall TO authenticated;

-- I) ADMIN: RESTORE ARCHIVED STALL
CREATE OR REPLACE FUNCTION public.admin_restore_stall(
    p_stall_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_admin_id UUID;
    v_user_role public.user_role;
    v_user_status public.user_status;
    v_stall RECORD;
BEGIN
    v_admin_id := auth.uid();
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT role, status INTO v_user_role, v_user_status
    FROM public.users
    WHERE id = v_admin_id;

    IF v_user_status <> 'ACTIVE' OR v_user_role <> 'ADMIN'::public.user_role THEN
        RAISE EXCEPTION 'Unauthorized: Administrative role required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_stall FROM public.stalls WHERE id = p_stall_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stall record not found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.stalls
    SET status = 'APPROVED',
        archived_at = NULL,
        updated_at = now()
    WHERE id = p_stall_id;

    -- Audit Log
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_admin_id,
        'STALL_RESTORED',
        'stalls',
        p_stall_id,
        jsonb_build_object('name', v_stall.name, 'event_id', v_stall.event_id)
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Stall restored to approved status'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_restore_stall TO authenticated;

-- Enable Realtime publications on stalls
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stalls;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stall_owners;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stall_contacts;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


