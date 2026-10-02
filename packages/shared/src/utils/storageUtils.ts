import { supabase } from '../api/client';

const STORAGE_URL_PATTERN = '/storage/v1/object/public/events/';

/**
 * Safely extracts the relative storage path in the 'events' bucket from a banner URL or path.
 * Enforces strict namespace whitelist: 'events/banners/' or 'subevents/banners/'.
 */
export function extractEventBannerPath(urlOrPath?: string | null): string | null {
  if (!urlOrPath || typeof urlOrPath !== 'string') {
    return null;
  }

  let cleaned = urlOrPath.trim();
  if (!cleaned) return null;

  const patternIndex = cleaned.indexOf(STORAGE_URL_PATTERN);
  if (patternIndex !== -1) {
    cleaned = cleaned.substring(patternIndex + STORAGE_URL_PATTERN.length);
  }

  cleaned = cleaned.replace(/^\/+/, '');

  const queryIndex = cleaned.indexOf('?');
  if (queryIndex !== -1) {
    cleaned = cleaned.substring(0, queryIndex);
  }

  // Prevent traversal
  if (cleaned.includes('..') || cleaned.includes('//') || cleaned.includes('\\')) {
    return null;
  }

  const isEventBanner = /^events\/banners\/[a-zA-Z0-9_\-\.]+$/.test(cleaned);
  const isSubEventBanner = /^subevents\/banners\/[a-zA-Z0-9_\-\.]+$/.test(cleaned);

  return isEventBanner || isSubEventBanner ? cleaned : null;
}

/**
 * @deprecated All banner storage cleanup is now backend-authoritative via PostgreSQL transactional
 * outbox (storage_cleanup_queue) and Edge Functions. Direct client-side storage deletion is obsolete.
 * This helper is retained solely for backwards compatibility and triggers the authoritative queue worker.
 */
export async function purgeEventBannerStorageFiles(paths: string[]): Promise<void> {
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return;
  }

  // Authoritatively invoke the backend storage cleanup processor
  try {
    await supabase.functions.invoke('admin-process-storage-cleanup', {
      body: { batch_size: 20 }
    });
  } catch (err) {
    console.warn('[StorageLifecycle] Background queue processor trigger notification:', err);
  }
}
