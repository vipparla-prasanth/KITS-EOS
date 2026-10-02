import { useState, useEffect } from 'react';
import {
  getCookieConsent,
  saveCookieConsent,
  acceptAllCookies,
  rejectNonEssentialCookies,
  EVENT_OPEN_COOKIE_PREFERENCES,
  EVENT_COOKIE_CONSENT_CHANGED,
  type CookiePreferences,
} from '../utils/cookieConsent';

export function CookieConsentBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>({
    essential: true,
    functional: true,
    analytics: false,
  });

  useEffect(() => {
    // Check if user has already made a consent choice
    const current = getCookieConsent();
    if (!current.hasResponded) {
      setShowBanner(true);
    }
    setPreferences(current.preferences);

    // Listen for custom trigger to open preferences modal (e.g. from footer link)
    const handleOpenModal = () => {
      const latest = getCookieConsent();
      setPreferences(latest.preferences);
      setShowModal(true);
    };

    const handleConsentChanged = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.preferences) {
        setPreferences(customEvent.detail.preferences);
      }
    };

    window.addEventListener(EVENT_OPEN_COOKIE_PREFERENCES, handleOpenModal);
    window.addEventListener(EVENT_COOKIE_CONSENT_CHANGED, handleConsentChanged);

    return () => {
      window.removeEventListener(EVENT_OPEN_COOKIE_PREFERENCES, handleOpenModal);
      window.removeEventListener(EVENT_COOKIE_CONSENT_CHANGED, handleConsentChanged);
    };
  }, []);

  // Handle keyboard Escape to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showModal) {
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const handleAcceptAll = () => {
    acceptAllCookies();
    setShowBanner(false);
    setShowModal(false);
  };

  const handleRejectNonEssential = () => {
    rejectNonEssentialCookies();
    setShowBanner(false);
    setShowModal(false);
  };

  const handleSavePreferences = () => {
    saveCookieConsent(preferences);
    setShowBanner(false);
    setShowModal(false);
  };

  return (
    <>
      {/* BOTTOM-PINNED COOKIE & STORAGE BANNER */}
      {showBanner && !showModal && (
        <aside
          aria-label="Cookie and storage consent banner"
          className="fixed bottom-0 left-0 right-0 sm:bottom-6 sm:right-6 sm:left-auto sm:max-w-xl z-50 bg-white/95 backdrop-blur-md sm:rounded-2xl border-t sm:border border-gray-200/90 shadow-2xl p-4 sm:p-6 transition-all duration-300 font-sans animate-in fade-in slide-in-from-bottom-5"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100/80">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <div className="space-y-1">
                <h3 className="text-xs sm:text-sm font-black text-gray-900 tracking-tight">
                  Browser Storage & Cookie Preferences
                </h3>
                <p className="text-[11px] sm:text-xs text-gray-600 leading-relaxed font-normal">
                  KITS-EOS uses essential local storage and session identifiers for authentication, secure portal access, and static application caching. No commercial advertising trackers or marketing cookies are used.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="text-xs font-bold text-gray-600 hover:text-gray-900 underline underline-offset-4 text-center sm:text-left py-1.5 transition cursor-pointer"
              >
                Manage Preferences
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRejectNonEssential}
                  className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 text-xs font-bold transition active:scale-95 cursor-pointer"
                >
                  Reject Non-Essential
                </button>
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition shadow-xs active:scale-95 cursor-pointer"
                >
                  Accept All
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* PREFERENCES MODAL */}
      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cookie-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200 font-sans"
        >
          <div className="bg-white rounded-3xl border border-gray-200 max-w-xl w-full p-6 sm:p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
              <div>
                <h2
                  id="cookie-modal-title"
                  className="text-lg sm:text-xl font-black text-gray-900 tracking-tight"
                >
                  Browser Storage & Cookie Preferences
                </h2>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  Configure how KITS-EOS manages local browser storage and session identifiers.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Close preferences modal"
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Category 1: Essential Storage */}
            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200/80 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-gray-900">
                      Essential Storage & Authentication
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-gray-200 text-gray-700">
                      Always Active
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 leading-relaxed font-normal">
                    Required for student and staff authentication sessions (Supabase tokens stored in Local Storage), secure coordinator session identifiers, CSRF protection, and application shell caching via the KITS-EOS Service Worker. The Service Worker caches static assets only; sensitive student data, credentials, and API responses are never cached.
                  </p>
                </div>
              </div>
            </div>

            {/* Category 2: Functional Preferences */}
            <div className="p-4 rounded-2xl bg-white border border-gray-200 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5 pr-2">
                  <span className="text-xs font-black text-gray-900">
                    Functional Preferences
                  </span>
                  <p className="text-[11px] text-gray-500 leading-relaxed font-normal">
                    Remembers user interface preferences, filter states, table view configurations, and dismissed informational banners locally on your device.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={preferences.functional}
                    onChange={(e) =>
                      setPreferences((prev) => ({
                        ...prev,
                        functional: e.target.checked,
                      }))
                    }
                    className="sr-only peer"
                    aria-label="Toggle functional preferences"
                  />
                  <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>

            {/* Category 3: Analytics & Diagnostics */}
            <div className="p-4 rounded-2xl bg-white border border-gray-200 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5 pr-2">
                  <span className="text-xs font-black text-gray-900">
                    Operational Telemetry & Diagnostics
                  </span>
                  <p className="text-[11px] text-gray-500 leading-relaxed font-normal">
                    Assists in diagnosing system responsiveness and network errors. KITS-EOS does NOT bundle advertising trackers, marketing cookies, or third-party profiling scripts.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={preferences.analytics}
                    onChange={(e) =>
                      setPreferences((prev) => ({
                        ...prev,
                        analytics: e.target.checked,
                      }))
                    }
                    className="sr-only peer"
                    aria-label="Toggle operational telemetry"
                  />
                  <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>

            {/* Link to Policy */}
            <div className="text-[11px] text-gray-500">
              For complete details on institutional data governance, read our{' '}
              <a
                href="/privacy#cookies"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-blue-600 hover:underline"
              >
                Privacy Notice & Cookie Policy
              </a>
              .
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={handleRejectNonEssential}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
              >
                Reject Non-Essential
              </button>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Accept All
                </button>
                <button
                  type="button"
                  onClick={handleSavePreferences}
                  className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs"
                >
                  Save Preferences
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
