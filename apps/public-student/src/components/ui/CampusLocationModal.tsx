import { useEffect } from 'react';
import { MapPin, X, ExternalLink, Navigation } from 'lucide-react';
import { useScrollLock } from '@kits-eos/shared';

interface CampusLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CampusLocationModal({ isOpen, onClose }: CampusLocationModalProps) {
  useScrollLock(isOpen);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const googleMapsUrl =
    'https://www.google.com/maps/place/KITS+AKSHAR+INSTITUTE+OF+TECHNOLOGY(KITG)/@16.2204739,80.3169459,17z';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 modal-overlay-animate"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="campus-location-title"
    >
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-2xl sm:max-w-3xl w-full shadow-2xl border border-gray-200 modal-dialog-animate overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)]">
        {/* Modal Header */}
        <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-gray-100 flex items-center justify-between gap-3 bg-gradient-to-r from-gray-50/80 to-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-50 text-kits-red rounded-xl border border-red-100 shadow-2xs shrink-0">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="campus-location-title"
                className="text-base sm:text-lg font-black tracking-tight text-gray-900 leading-tight"
              >
                KITS Akshar Institute of Technology
              </h2>
              <p className="text-xs font-bold text-kits-red uppercase tracking-wider mt-0.5">
                Campus Location
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition cursor-pointer shrink-0"
            aria-label="Close campus map modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body: Embedded Google Map */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          <div className="relative w-full h-[280px] xs:h-[340px] sm:h-[420px] rounded-2xl overflow-hidden border border-gray-200 bg-gray-100 shadow-inner">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3830.9993354285557!2d80.3169458749075!3d16.2204738844811!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3a4a770009f81b85%3A0x7d14378c3b2f068d!2sKITS%20AKSHAR%20INSTITUTE%20OF%20TECHNOLOGY(KITG)!5e0!3m2!1sen!2sin!4v1788979424549!5m2!1sen!2sin"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              title="KITS Akshar Institute of Technology Campus Location"
              className="w-full h-full"
            />
          </div>

          {/* Institutional Address & Actions */}
          <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400 block">
                Official Campus Address
              </span>
              <p className="text-gray-800 font-semibold leading-relaxed">
                NH16, Opp. Katuri Medical College, Yanamadala, Guntur, Andhra Pradesh 522019
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 pt-1 sm:pt-0">
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-liquid btn-primary-blue px-3.5 py-2 text-xs font-bold shadow-2xs"
              >
                <span className="btn-content">
                  <Navigation className="h-3.5 w-3.5" />
                  <span>Get Directions</span>
                  <ExternalLink className="h-3 w-3 opacity-70 ml-0.5" />
                </span>
              </a>

              <button
                type="button"
                onClick={onClose}
                className="btn-secondary px-3.5 py-2 text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
