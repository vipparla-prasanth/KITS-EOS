import { supabase } from '@kits-eos/shared/src/api/client';
import { exportToExcel } from '@kits-eos/shared/src/utils/export';

export interface VenueCoordinator {
  id: string;
  name: string;
  role: 'FACULTY' | 'STUDENT';
  phone: string;
}

export interface VenueDirectoryItem {
  id: string;
  subEventName: string;
  eventName: string;
  categoryName: string;
  venue: string;
  coordinators: VenueCoordinator[];
}

/**
 * Fetches authoritative active sub-events, their assigned venues, and active assigned coordinators
 * directly from Supabase tables: sub_events -> categories (events) -> coordinator_assignments -> coordinators.
 * Excludes all internal UUIDs, user_ids, passwords, payment info, and private metadata.
 */
export async function fetchVenueDirectoryData(mainEventId?: string): Promise<VenueDirectoryItem[]> {
  // 1. Fetch active sub-events with category and event relations (publicly allowed)
  const { data: subEventsData, error: subError } = await supabase
    .from('sub_events')
    .select(`
      id,
      name,
      venue,
      event_id,
      category_id,
      categories (
        id,
        name,
        event_id,
        events (
          id,
          name
        )
      ),
      events (
        id,
        name
      )
    `)
    .eq('status', 'ACTIVE');

  if (subError) {
    console.error('Failed to query venue directory data:', subError);
    throw new Error(subError.message || 'Failed to load event venues and coordinators.');
  }

  if (!subEventsData || subEventsData.length === 0) {
    return [];
  }

  // 2. Fetch coordinator directory via public-safe RPC
  const { data: rpcCoords, error: rpcError } = await supabase
    .rpc('get_public_coordinator_directory', { p_event_id: mainEventId || null });

  if (rpcError) {
    console.error('Failed to query coordinators for venue directory:', rpcError);
  }

  // Group coordinators by sub_event_id
  const coordsBySubEvent: Record<string, VenueCoordinator[]> = {};
  if (Array.isArray(rpcCoords)) {
    for (const c of rpcCoords) {
      if (!coordsBySubEvent[c.sub_event_id]) {
        coordsBySubEvent[c.sub_event_id] = [];
      }
      coordsBySubEvent[c.sub_event_id].push({
        id: c.coordinator_id,
        name: (c.display_name || 'Coordinator').trim(),
        role: ((c.coordinator_type || 'FACULTY').toUpperCase() === 'STUDENT' ? 'STUDENT' : 'FACULTY') as 'FACULTY' | 'STUDENT',
        phone: (c.phone_number && c.phone_number.trim().length > 0) ? c.phone_number.trim() : 'Not Assigned',
      });
    }
  }

  const items: VenueDirectoryItem[] = subEventsData
    .filter((sub: any) => {
      if (!mainEventId) return true;
      const cat = Array.isArray(sub.categories) ? sub.categories[0] : sub.categories;
      const ev = Array.isArray(sub.events) ? sub.events[0] : sub.events;
      const catEv = cat?.events ? (Array.isArray(cat.events) ? cat.events[0] : cat.events) : null;
      const subEventId = sub.event_id || ev?.id || cat?.event_id || catEv?.id;
      return subEventId === mainEventId;
    })
    .map((sub: any) => {
      const cat = Array.isArray(sub.categories) ? sub.categories[0] : sub.categories;
      const ev = Array.isArray(sub.events) ? sub.events[0] : sub.events;
      const catEv = cat?.events ? (Array.isArray(cat.events) ? cat.events[0] : cat.events) : null;

      const eventName = (ev?.name || catEv?.name || 'KITS Event').trim();
      const categoryName = (cat?.name || 'General').trim();
      const subEventName = (sub.name || 'Sub-Event').trim();
      const venueName = (sub.venue && sub.venue.trim().length > 0) ? sub.venue.trim() : 'Not Assigned';

      // Extract active assigned coordinators from grouped RPC map
      const activeCoords: VenueCoordinator[] = [...(coordsBySubEvent[sub.id] || [])];

      // Faculty coordinators first, then student coordinators, then alphabetical by name
      activeCoords.sort((a, b) => {
        if (a.role === 'FACULTY' && b.role !== 'FACULTY') return -1;
        if (a.role !== 'FACULTY' && b.role === 'FACULTY') return 1;
        return a.name.localeCompare(b.name);
      });

      return {
        id: sub.id,
        subEventName,
        eventName,
        categoryName,
        venue: venueName,
        coordinators: activeCoords,
      };
    });

  // Canonical alphabetical ordering by sub-event name
  items.sort((a, b) => a.subEventName.localeCompare(b.subEventName));

  return items;
}

/**
 * Generates and downloads the official Venue & Coordinator Excel spreadsheet.
 * Filename: KITS-EOS-Event-Venue-Coordinator-Directory.xlsx (or event-scoped)
 * Sheet Name: Venue Directory
 * Columns: S.No, Event / Sub-Event, Venue, Coordinator, Contact Number
 *
 * If a sub-event has multiple coordinators, separate rows are emitted so each
 * coordinator name and contact phone number remain properly paired.
 */
export async function downloadVenueDirectoryExcel(
  preloadedItems?: VenueDirectoryItem[],
  eventName?: string
): Promise<{ count: number }> {
  const items = preloadedItems && preloadedItems.length > 0 
    ? preloadedItems 
    : await fetchVenueDirectoryData();

  if (items.length === 0) {
    throw new Error('No venue directory records are available to download.');
  }

  const rows: (string | number)[][] = [];
  let serialNumber = 1;

  for (const item of items) {
    if (item.coordinators.length === 0) {
      rows.push([
        serialNumber++,
        item.subEventName,
        item.venue,
        'Not Assigned',
        'Not Assigned',
      ]);
    } else {
      for (const coord of item.coordinators) {
        const roleLabel = coord.role === 'FACULTY' ? ' (FACULTY)' : ' (STUDENT)';
        rows.push([
          serialNumber++,
          item.subEventName,
          item.venue,
          `${coord.name}${roleLabel}`,
          coord.phone,
        ]);
      }
    }
  }

  const safeEventName = eventName ? eventName.replace(/\s+/g, '_') : 'General';

  exportToExcel({
    filename: eventName 
      ? `KITS-EOS-Venue-Directory-${safeEventName}.xlsx`
      : 'KITS-EOS-Event-Venue-Coordinator-Directory.xlsx',
    title: eventName 
      ? `${eventName.toUpperCase()} • VENUE & COORDINATOR DIRECTORY`
      : 'EVENT VENUE & COORDINATOR DIRECTORY',
    subtitle: eventName
      ? `KITS Akshar Institute of Technology • ${eventName}`
      : 'KITS Akshar Institute of Technology • Campus Operations',
    sheetName: 'Venue Directory',
    headers: ['S.No', 'Event / Sub-Event', 'Venue', 'Coordinator', 'Contact Number'],
    rows,
    colWidths: [8, 30, 46, 32, 22],
  });

  return { count: rows.length };
}
