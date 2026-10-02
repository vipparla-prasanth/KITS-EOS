import { useState, useMemo } from 'react';
import { Calendar, Sparkles } from 'lucide-react';
import { resolveEventBannerUrl } from '../../utils/imageUtils';

interface EventBannerImageProps {
  bannerPath?: string | null;
  eventName: string;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}

export function EventBannerImage({
  bannerPath,
  eventName,
  className = 'w-full h-40 rounded-xl',
  imageClassName = 'w-full h-full object-cover',
  priority = false,
}: EventBannerImageProps) {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  const resolvedUrl = useMemo(() => {
    return resolveEventBannerUrl(bannerPath);
  }, [bannerPath]);

  // If there's genuinely no banner or an unrecoverable loading error
  if (!resolvedUrl || hasError) {
    return (
      <div 
        className={`relative overflow-hidden flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-gray-900 to-kits-blue text-white p-6 text-center select-none border border-gray-800/60 ${className}`}
      >
        {/* Subtle geometric background decoration */}
        <div className="absolute top-0 right-0 -mt-6 -mr-6 w-28 h-28 bg-kits-red/20 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-6 -ml-6 w-28 h-28 bg-kits-blue/40 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center space-y-1.5">
          <div className="p-2 rounded-xl bg-white/10 text-white/90 backdrop-blur-xs border border-white/10 shadow-2xs mb-0.5">
            <Calendar className="h-5 w-5 text-kits-red" />
          </div>
          <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-white line-clamp-1 max-w-[90%]">
            {eventName}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-300 uppercase tracking-widest bg-white/10 px-2 py-0.5 rounded-full backdrop-blur-xs">
            <Sparkles className="h-2.5 w-2.5 text-amber-400" />
            <span>KITS-EOS Flagship Event</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-gray-100 border border-gray-200/80 ${className}`}>
      {/* Loading Skeleton Placeholder */}
      {isLoading && (
        <div 
          className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse z-10"
          aria-hidden="true"
        />
      )}

      <img
        src={resolvedUrl}
        alt={`${eventName} Banner`}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setIsLoading(false)}
        onError={() => {
          console.warn(`[EventBannerImage] Failed to load banner for "${eventName}" from URL:`, resolvedUrl);
          setHasError(true);
          setIsLoading(false);
        }}
        className={`${imageClassName} transition-all duration-300 ${
          isLoading ? 'opacity-0 scale-[1.01]' : 'opacity-100 scale-100'
        }`}
      />
    </div>
  );
}
