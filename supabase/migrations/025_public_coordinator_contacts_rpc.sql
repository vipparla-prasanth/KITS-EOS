-- 025_public_coordinator_contacts_rpc.sql
-- Enables public retrieval of coordinator contact info for a specific sub-event

-- 1. Grant SELECT on coordinators & coordinator_assignments to anon and authenticated
GRANT SELECT ON public.coordinators TO anon, authenticated;
GRANT SELECT ON public.coordinator_assignments TO anon, authenticated;

-- 2. Allow public/anon to read active coordinator contact info without exposing credentials
DROP POLICY IF EXISTS "Public can view active coordinator contacts" ON public.coordinators;
CREATE POLICY "Public can view active coordinator contacts" ON public.coordinators
  FOR SELECT USING (
    status = 'ACTIVE' AND contact_visible = true
  );

DROP POLICY IF EXISTS "Public can view coordinator assignments" ON public.coordinator_assignments;
CREATE POLICY "Public can view coordinator assignments" ON public.coordinator_assignments
  FOR SELECT USING (true);

-- 3. Dedicated safe RPC to retrieve public coordinator contacts for a specific sub-event
CREATE OR REPLACE FUNCTION public.get_sub_event_coordinators(p_sub_event_id UUID)
RETURNS TABLE (
  assignment_id UUID,
  coordinator_id UUID,
  display_name VARCHAR,
  phone_number VARCHAR,
  coordinator_type VARCHAR,
  contact_visible BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ca.id AS assignment_id,
    c.id AS coordinator_id,
    c.display_name,
    c.phone_number,
    COALESCE(c.coordinator_type, 'FACULTY') AS coordinator_type,
    c.contact_visible
  FROM public.coordinator_assignments ca
  JOIN public.coordinators c ON ca.coordinator_id = c.id
  WHERE ca.sub_event_id = p_sub_event_id
    AND c.status = 'ACTIVE'
  ORDER BY 
    CASE WHEN c.coordinator_type = 'FACULTY' THEN 1 ELSE 2 END,
    c.display_name ASC;
END;
$$;

-- Grant EXECUTE to anon and authenticated
GRANT EXECUTE ON FUNCTION public.get_sub_event_coordinators(UUID) TO anon, authenticated;
