import { supabase } from '@kits-eos/shared/src/api/client';

/**
 * Resolves an event or sub-event banner reference to an authoritative public URL.
 * 
 * Supports:
 * 1. Fully-qualified URLs (e.g., https://... from Supabase Storage or external CDNs)
 * 2. Supabase Storage object paths in the 'events' bucket (e.g., events/banners/... or banners/...)
 * 3. Local preview URLs (blob: / data:)
 * 4. Graceful null return for missing/empty values
 */
export function resolveEventBannerUrl(bannerPath?: string | null): string | null {
  if (!bannerPath || typeof bannerPath !== 'string') {
    return null;
  }

  const trimmed = bannerPath.trim();
  if (!trimmed) {
    return null;
  }

  // Already a fully qualified URL or blob
  if (
    trimmed.startsWith('http://') || 
    trimmed.startsWith('https://') || 
    trimmed.startsWith('blob:') || 
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }

  // Normalize storage path: clean any leading slashes
  const cleanPath = trimmed.replace(/^\/+/, '');
  
  try {
    const { data } = supabase.storage.from('events').getPublicUrl(cleanPath);
    return data?.publicUrl || null;
  } catch (err) {
    console.warn('[imageUtils] Failed to resolve storage public URL for path:', cleanPath, err);
    return null;
  }
}
