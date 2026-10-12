-- Migration: 114_public_event_directory_rpc.sql
-- Description: Create public-safe Event Directory View and SECURITY DEFINER RPC
-- Root Cause: Public student/anon client attempting to join public.coordinators directly via PostgREST
--             failed with 42501 (permission denied for table coordinators) because coordinators table
--             contains sensitive password hashes, usernames, and auth IDs and is not granted to anon/authenticated.
-- Solution: Least-privilege architecture. Expose ONLY public event directory fields (event, category,
--           sub-event, venue, coordinator display names/types) via a SECURITY DEFINER RPC and View.
--           The underlying coordinators table remains strictly protected with no direct public access.

-- 1. Create safe public view
CREATE OR REPLACE VIEW public.public_event_directory_view AS
SELECT 
    se.id,
    COALESCE(ev.name, cat_ev.name, 'KITS Event')::text AS event,
    COALESCE(cat.name, 'General')::text AS category,
    se.name::text AS sub_event,
    COALESCE(NULLIF(TRIM(se.venue), ''), 'Not Assigned')::text AS venue,
    COALESCE(
        (
            SELECT string_agg(
                c.display_name || CASE 
                    WHEN c.coordinator_type IS NOT NULL AND TRIM(c.coordinator_type) != '' 
                    THEN ' (' || UPPER(TRIM(c.coordinator_type)) || ')' 
                    ELSE '' 
                END,
                ', ' 
                ORDER BY 
                    CASE WHEN UPPER(COALESCE(c.coordinator_type, '')) = 'FACULTY' THEN 1 ELSE 2 END,
                    c.display_name ASC
            )
            FROM public.coordinator_assignments ca
            JOIN public.coordinators c ON ca.coordinator_id = c.id
            WHERE ca.sub_event_id = se.id
              AND c.status = 'ACTIVE'
        ),
        'Not Assigned'
    )::text AS coordinator
FROM public.sub_events se
LEFT JOIN public.categories cat ON se.category_id = cat.id
LEFT JOIN public.events cat_ev ON cat.event_id = cat_ev.id
LEFT JOIN public.events ev ON se.event_id = ev.id
WHERE se.status = 'ACTIVE'
ORDER BY 
    COALESCE(ev.name, cat_ev.name, 'KITS Event') ASC,
    COALESCE(cat.name, 'General') ASC,
    se.name ASC;

-- 2. Grant SELECT on view to anon and authenticated
GRANT SELECT ON public.public_event_directory_view TO anon, authenticated;

-- 3. Create public-safe SECURITY DEFINER RPC
CREATE OR REPLACE FUNCTION public.get_public_event_directory()
RETURNS TABLE (
    id uuid,
    event text,
    category text,
    sub_event text,
    venue text,
    coordinator text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        v.id,
        v.event,
        v.category,
        v.sub_event,
        v.venue,
        v.coordinator
    FROM public.public_event_directory_view v;
END;
$$;

-- 4. Grant EXECUTE on RPC to anon and authenticated
GRANT EXECUTE ON FUNCTION public.get_public_event_directory() TO anon, authenticated;
