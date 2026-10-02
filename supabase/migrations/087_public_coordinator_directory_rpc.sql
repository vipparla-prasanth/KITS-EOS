-- ============================================================================
-- Migration 087: Public Safe Coordinator Directory RPC
-- ============================================================================
-- Objective:
-- 1. Restore the public Contact Coordinators directory workflow without
--    weakening RLS or exposing confidential coordinator credentials.
-- 2. Support both category-based sub-events:
--      events -> categories -> sub_events -> coordinator_assignments -> coordinators
--    and direct sub-events:
--      events -> sub_events -> coordinator_assignments -> coordinators
--    using authoritative resolution: COALESCE(se.event_id, cat.event_id) = ev.id
-- 3. Return ONLY public-safe fields (zero passwords, hashes, usernames, tokens).
-- 4. Mask phone numbers when contact_visible is FALSE.
-- 5. Restrict results strictly to active events, sub-events, categories, and coordinators.
-- 6. Apply SECURITY DEFINER with fixed search_path, revoking PUBLIC access and granting
--    EXECUTE only to anon, authenticated, service_role.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_public_coordinator_directory(uuid);

CREATE OR REPLACE FUNCTION public.get_public_coordinator_directory(
    p_event_id uuid DEFAULT NULL
)
RETURNS TABLE (
    assignment_id uuid,
    coordinator_id uuid,
    display_name text,
    coordinator_type text,
    phone_number text,
    sub_event_id uuid,
    sub_event_name text,
    category_name text,
    event_name text,
    event_id uuid,
    venue text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ca.id AS assignment_id,
        c.id AS coordinator_id,
        c.display_name::text,
        COALESCE(c.coordinator_type, 'FACULTY')::text AS coordinator_type,
        CASE 
            WHEN c.contact_visible IS TRUE THEN c.phone_number::text 
            ELSE NULL::text 
        END AS phone_number,
        se.id AS sub_event_id,
        se.name::text AS sub_event_name,
        COALESCE(cat.name, 'GENERAL')::text AS category_name,
        ev.name::text AS event_name,
        ev.id AS event_id,
        COALESCE(se.venue, 'Not Assigned')::text AS venue
    FROM public.coordinator_assignments ca
    JOIN public.coordinators c ON ca.coordinator_id = c.id
    JOIN public.sub_events se ON ca.sub_event_id = se.id
    LEFT JOIN public.categories cat ON se.category_id = cat.id
    JOIN public.events ev ON ev.id = COALESCE(se.event_id, cat.event_id)
    WHERE c.status = 'ACTIVE'
      AND se.status = 'ACTIVE'
      AND ev.status = 'ACTIVE'
      AND (cat.id IS NULL OR cat.status = 'ACTIVE')
      AND (p_event_id IS NULL OR ev.id = p_event_id)
    ORDER BY 
        CASE WHEN c.coordinator_type = 'FACULTY' THEN 1 ELSE 2 END,
        c.display_name ASC;
END;
$$;

-- Security hardening: explicitly revoke default PUBLIC execution before granting least-privilege roles
REVOKE ALL ON FUNCTION public.get_public_coordinator_directory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_coordinator_directory(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_public_coordinator_directory(uuid) IS 
'Public-safe RPC for contact coordinator directory and venue listings. Exposes zero credentials or authentication metadata.';
