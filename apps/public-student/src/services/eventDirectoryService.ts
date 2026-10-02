import { supabase } from '@kits-eos/shared/src/api/client';
import { exportToExcel } from '@kits-eos/shared/src/utils/export';

export interface EventDirectoryItem {
  id: string;
  event: string;
  category: string;
  subEvent: string;
  venue: string;
  coordinator: string;
}

/**
 * Single authoritative frontend source for fetching dynamic, normalized Event Directory data.
 * Queries only active operational events, categories, sub-events, venues, and assigned coordinators.
 * Excludes all private/sensitive fields (e.g. user_id, password_hash, internal tokens).
 */
export async function fetchEventDirectoryData(): Promise<EventDirectoryItem[]> {
  const { data, error } = await supabase
    .from('sub_events')
    .select(`
      id,
      name,
      venue,
      categories (
        id,
        name,
        events (
          id,
          name
        )
      ),
      events (
        id,
        name
      ),
      coordinator_assignments (
        id,
        coordinators (
          id,
          display_name,
          coordinator_type,
          status
        )
      )
    `)
    .eq('status', 'ACTIVE');

  if (error) {
    console.error('Failed to query event directory from database:', error);
    throw new Error(error.message || 'Failed to load event directory records.');
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Normalize and resolve authoritative relationships
  const items: EventDirectoryItem[] = data.map((sub: any) => {
    const cat = Array.isArray(sub.categories) ? sub.categories[0] : sub.categories;
    const ev = Array.isArray(sub.events) ? sub.events[0] : sub.events;
    const catEv = cat?.events ? (Array.isArray(cat.events) ? cat.events[0] : cat.events) : null;

    const eventName = (ev?.name || catEv?.name || 'KITS Event').trim();
    const categoryName = (cat?.name || 'General').trim();
    const subEventName = (sub.name || 'Sub-Event').trim();
    const venueName = (sub.venue && sub.venue.trim().length > 0) ? sub.venue.trim() : 'Not Assigned';

    // Parse and sort active assigned coordinators
    const rawAssignments = sub.coordinator_assignments || [];
    const activeCoords = rawAssignments
      .map((a: any) => a.coordinators)
      .filter((c: any) => c && c.status === 'ACTIVE');

    // Faculty coordinators first, then student coordinators, then alphabetically
    activeCoords.sort((a: any, b: any) => {
      const typeA = (a.coordinator_type || '').toUpperCase();
      const typeB = (b.coordinator_type || '').toUpperCase();
      if (typeA === 'FACULTY' && typeB !== 'FACULTY') return -1;
      if (typeA !== 'FACULTY' && typeB === 'FACULTY') return 1;
      return (a.display_name || '').localeCompare(b.display_name || '');
    });

    const coordinatorStr = activeCoords.length > 0
      ? activeCoords
          .map((c: any) => {
            const role = c.coordinator_type ? ` (${c.coordinator_type.toUpperCase()})` : '';
            return `${c.display_name}${role}`;
          })
          .join(', ')
      : 'Not Assigned';

    return {
      id: sub.id,
      event: eventName,
      category: categoryName,
      subEvent: subEventName,
      venue: venueName,
      coordinator: coordinatorStr,
    };
  });

  // Canonical ordering: Event -> Category -> Sub-Event
  items.sort((a, b) => {
    const cmpEvent = a.event.localeCompare(b.event);
    if (cmpEvent !== 0) return cmpEvent;

    const cmpCat = a.category.localeCompare(b.category);
    if (cmpCat !== 0) return cmpCat;

    return a.subEvent.localeCompare(b.subEvent);
  });

  return items;
}

/**
 * Downloads the official Excel (.xlsx) Event, Venue & Coordinator Directory.
 * Operates seamlessly for both public visitors (unauthenticated) and authenticated students.
 */
export async function downloadEventDirectoryExcel(): Promise<{ count: number }> {
  const directoryItems = await fetchEventDirectoryData();

  if (directoryItems.length === 0) {
    throw new Error('No event directory data is currently available.');
  }

  const rows = directoryItems.map((item, index) => [
    index + 1,
    item.event,
    item.category,
    item.subEvent,
    item.venue,
    item.coordinator,
  ]);

  exportToExcel({
    filename: 'KITS-EOS-Event-Directory.xlsx',
    title: 'OFFICIAL EVENT, VENUE & COORDINATOR DIRECTORY',
    subtitle: 'KITS Akshar Institute of Technology • Campus Operations',
    sheetName: 'Event Directory',
    headers: ['S.No', 'Event', 'Category', 'Sub-Event', 'Venue', 'Coordinator'],
    rows,
    colWidths: [8, 20, 18, 26, 42, 38],
  });

  return { count: directoryItems.length };
}
