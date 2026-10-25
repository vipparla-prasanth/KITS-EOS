import { supabase } from '@kits-eos/shared/src/api/client';

export interface BannerSourceSet {
  fallbackSrc: string;
  webpSrcSet?: string;
  avifSrcSet?: string;
  sizes: string;
  aspectRatio: string;
  width: number;
  height: number;
}

const DEFAULT_BANNER_SIZES = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 600px';

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

/**
 * Resolves responsive, modern image format sources (AVIF, WebP) with width-based source sets,
 * reserved aspect ratios, and full graceful fallback to original uncompressed assets.
 */
export function resolveEventBannerSources(bannerPath?: string | null): BannerSourceSet | null {
  if (!bannerPath || typeof bannerPath !== 'string') {
    return null;
  }

  const trimmed = bannerPath.trim();
  if (!trimmed) {
    return null;
  }

  // 1. Flagship Event 1: INNOVATE WITH AI & IOT (ID: 1790926514075_109x9wc.png)
  if (trimmed.includes('1790926514075_109x9wc') || trimmed.toLowerCase().includes('innovatex')) {
    return {
      fallbackSrc: '/banners/innovatex_original.png',
      webpSrcSet: '/banners/innovatex_480w.webp 480w, /banners/innovatex_800w.webp 800w, /banners/innovatex_1200w.webp 1200w',
      avifSrcSet: '/banners/innovatex_800w.avif 800w',
      sizes: DEFAULT_BANNER_SIZES,
      aspectRatio: '2.92 / 1',
      width: 556,
      height: 190,
    };
  }

  // 2. Flagship Event 2: GALA 2K27 (ID: 1788535164725_r8dg3yj.png)
  if (trimmed.includes('1788535164725_r8dg3yj') || trimmed.toLowerCase().includes('gala')) {
    return {
      fallbackSrc: '/banners/gala_original.png',
      webpSrcSet: '/banners/gala_480w.webp 480w, /banners/gala_800w.webp 800w, /banners/gala_1200w.webp 1200w',
      avifSrcSet: '/banners/gala_800w.avif 800w',
      sizes: DEFAULT_BANNER_SIZES,
      aspectRatio: '2.92 / 1',
      width: 556,
      height: 190,
    };
  }

  // 3. Dynamic / Uploaded Supabase Storage Banners
  const publicUrl = resolveEventBannerUrl(trimmed);
  if (!publicUrl) {
    return null;
  }

  // Supabase Image Transformation API (CDN on the fly)
  if (publicUrl.includes('/storage/v1/object/public/events/')) {
    const renderBase = publicUrl.replace('/storage/v1/object/public/events/', '/storage/v1/render/image/public/events/');
    return {
      fallbackSrc: publicUrl,
      webpSrcSet: `${renderBase}?width=480&quality=80&format=webp 480w, ${renderBase}?width=800&quality=80&format=webp 800w, ${renderBase}?width=1200&quality=80&format=webp 1200w`,
      avifSrcSet: `${renderBase}?width=800&quality=80&format=avif 800w`,
      sizes: DEFAULT_BANNER_SIZES,
      aspectRatio: '2.92 / 1',
      width: 556,
      height: 190,
    };
  }

  return {
    fallbackSrc: publicUrl,
    sizes: DEFAULT_BANNER_SIZES,
    aspectRatio: '2.92 / 1',
    width: 556,
    height: 190,
  };
}

