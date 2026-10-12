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
  // 1. Primary: High-performance, public-safe SECURITY DEFINER RPC
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_public_event_directory');

  if (!rpcError && Array.isArray(rpcData)) {
    return rpcData.map((item: any) => ({
      id: item.id,
      event: (item.event || 'KITS Event').trim(),
      category: (item.category || 'General').trim(),
      subEvent: (item.sub_event || 'Sub-Event').trim(),
      venue: (item.venue && item.venue.trim().length > 0) ? item.venue.trim() : 'Not Assigned',
      coordinator: (item.coordinator && item.coordinator.trim().length > 0) ? item.coordinator.trim() : 'Not Assigned',
    }));
  }

  if (rpcError) {
    console.warn('RPC get_public_event_directory notice, attempting view fallback:', rpcError);
  }

  // 2. Secondary fallback: Safe public view
  const { data: viewData, error: viewError } = await supabase
    .from('public_event_directory_view')
    .select('id, event, category, sub_event, venue, coordinator');

  if (!viewError && Array.isArray(viewData)) {
    return viewData.map((item: any) => ({
      id: item.id,
      event: (item.event || 'KITS Event').trim(),
      category: (item.category || 'General').trim(),
      subEvent: (item.sub_event || 'Sub-Event').trim(),
      venue: (item.venue && item.venue.trim().length > 0) ? item.venue.trim() : 'Not Assigned',
      coordinator: (item.coordinator && item.coordinator.trim().length > 0) ? item.coordinator.trim() : 'Not Assigned',
    }));
  }

  // 3. Tertiary fallback: Query sub_events directly without coordinators table join
  const { data: subData, error: subError } = await supabase
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
      )
    `)
    .eq('status', 'ACTIVE');

  if (subError) {
    console.error('Failed to query event directory from database:', subError);
    throw new Error(subError.message || 'Failed to load event directory records.');
  }

  if (!subData || subData.length === 0) {
    return [];
  }

  const items: EventDirectoryItem[] = subData.map((sub: any) => {
    const cat = Array.isArray(sub.categories) ? sub.categories[0] : sub.categories;
    const ev = Array.isArray(sub.events) ? sub.events[0] : sub.events;
    const catEv = cat?.events ? (Array.isArray(cat.events) ? cat.events[0] : cat.events) : null;

    return {
      id: sub.id,
      event: (ev?.name || catEv?.name || 'KITS Event').trim(),
      category: (cat?.name || 'General').trim(),
      subEvent: (sub.name || 'Sub-Event').trim(),
      venue: (sub.venue && sub.venue.trim().length > 0) ? sub.venue.trim() : 'Not Assigned',
      coordinator: 'Contact Event Office',
    };
  });

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
