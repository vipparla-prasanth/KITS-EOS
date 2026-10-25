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

interface ToggleSwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

/**
 * Accessible Institutional Toggle Switch
 * Provides a visible track, circular thumb, distinct ON/OFF contrast,
 * standard ARIA switch semantics, keyboard Space/Enter support, and >=44px mobile touch target.
 */
export function ToggleSwitch({
  id,
  checked,
  onChange,
  label,
  disabled = false,
}: ToggleSwitchProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <div className="flex items-center gap-2.5 shrink-0">
      {/* High-Contrast Non-Color-Dependent State Badge */}
      <span
        aria-hidden="true"
        className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md select-none border transition-colors duration-200 ${
          checked
            ? 'bg-blue-100 text-[#003366] border-blue-200'
            : 'bg-gray-100 text-gray-600 border-gray-300'
        }`}
      >
        {checked ? 'ACTIVE' : 'OFF'}
      </span>

      {/* Accessible Interactive Switch */}
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        onKeyDown={handleKeyDown}
        className="group relative inline-flex items-center justify-center min-w-[48px] min-h-[44px] p-1.5 rounded-full cursor-pointer select-none transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#003366] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {/* Switch Track (48px wide x 24px tall) */}
        <span
          className={`relative inline-flex items-center w-12 h-6 rounded-full border transition-colors duration-200 ease-in-out shadow-inner ${
            checked
              ? 'bg-[#003366] border-[#002244]'
              : 'bg-slate-300 border-slate-400'
          }`}
        >
          {/* Internal Track Symbols for Accessibility (Checkmark when ON, Cross when OFF) */}
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-between px-2 text-[9px] font-black pointer-events-none select-none"
          >
            <span
              className={`text-white transition-opacity duration-150 ${
                checked ? 'opacity-90' : 'opacity-0'
              }`}
            >
              ✓
            </span>
            <span
              className={`text-slate-600 transition-opacity duration-150 ${
                !checked ? 'opacity-90' : 'opacity-0'
              }`}
            >
              ✕
            </span>
          </span>

          {/* Switch Thumb (Physical Circular Knob: 20px x 20px) */}
          <span
            aria-hidden="true"
            className={`absolute top-[1px] left-[1px] w-5 h-5 rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center transition-transform duration-200 ease-in-out transform will-change-transform ${
              checked ? 'translate-x-6' : 'translate-x-0'
            }`}
          >
            {/* Center micro-dot for immediate contrast inside thumb */}
            <span
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-200 ${
                checked ? 'bg-[#003366]' : 'bg-slate-400'
              }`}
            />
          </span>
        </span>
      </button>
    </div>
  );
}

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

  // Handle keyboard Escape to close modal without committing unsaved changes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showModal) {
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const handleOpenPreferences = () => {
    // Re-sync with latest saved storage preferences before opening
    const latest = getCookieConsent();
    setPreferences(latest.preferences);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    // Revert uncommitted edits back to saved preferences without granting consent
    const latest = getCookieConsent();
    setPreferences(latest.preferences);
    setShowModal(false);
  };

  const handleAcceptAll = () => {
    const updated = acceptAllCookies();
    setPreferences(updated.preferences);
    setShowBanner(false);
    setShowModal(false);
  };

  const handleRejectNonEssential = () => {
    const updated = rejectNonEssentialCookies();
    setPreferences(updated.preferences);
    setShowBanner(false);
    setShowModal(false);
  };

  const handleSavePreferences = () => {
    const updated = saveCookieConsent(preferences);
    setPreferences(updated.preferences);
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
              <div className="h-9 w-9 rounded-xl bg-blue-50 text-kits-blue flex items-center justify-center shrink-0 border border-blue-100/80">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
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
                onClick={handleOpenPreferences}
                className="text-xs font-bold text-gray-600 hover:text-gray-900 underline underline-offset-4 text-center sm:text-left py-1.5 transition cursor-pointer"
              >
                Manage Preferences
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRejectNonEssential}
                  className="flex-1 sm:flex-none px-3.5 py-2.5 rounded-xl border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 text-xs font-bold transition active:scale-95 cursor-pointer min-h-[44px]"
                >
                  Reject Non-Essential
                </button>
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition shadow-xs active:scale-95 cursor-pointer min-h-[44px]"
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
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200 font-sans"
        >
          <div className="bg-white rounded-3xl border border-gray-200 max-w-xl w-full p-5 sm:p-7 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
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
                onClick={handleCloseModal}
                aria-label="Close preferences modal"
                className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Category 1: Essential Storage */}
            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200/80 space-y-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-gray-900">
                    Essential Storage & Authentication
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-gray-200 text-gray-700 border border-gray-300">
                    ALWAYS ACTIVE
                  </span>
                </div>
                <p className="text-[11px] text-gray-600 leading-relaxed font-normal">
                  Maintains student and staff authentication sessions (Supabase access tokens stored in Local Storage), secure coordinator session identifiers in Session Storage, CSRF protection, and application shell caching via the KITS-EOS Service Worker. The Service Worker caches static assets only; private student profiles, credentials, and live API responses are never cached. These items are strictly necessary for platform operation and security and cannot be deactivated.
                </p>
              </div>
            </div>

            {/* Category 2: Functional Preferences */}
            <div className="p-4 rounded-2xl bg-white border border-gray-200 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 pr-2">
                  <span className="text-xs font-black text-gray-900 block">
                    Functional Preferences
                  </span>
                  <p className="text-[11px] text-gray-600 leading-relaxed font-normal">
                    Permits local storage of user interface preferences, form input auto-save drafts (such as competition and fest registration drafts), and client-side view configurations on your device.
                  </p>
                  <p className="text-[10px] text-gray-500 leading-normal pt-0.5">
                    <strong>When ACTIVE:</strong> Form inputs are preserved locally so you do not lose registration progress on refresh.<br />
                    <strong>When OFF:</strong> Optional local drafts are not stored locally and existing local drafts are cleared. Essential login sessions and active exam timers remain protected.
                  </p>
                </div>
                <ToggleSwitch
                  id="functional-preferences-switch"
                  checked={preferences.functional}
                  onChange={(checked) =>
                    setPreferences((prev) => ({
                      ...prev,
                      functional: checked,
                    }))
                  }
                  label="Toggle functional preferences"
                />
              </div>
            </div>

            {/* Category 3: Analytics & Diagnostics */}
            <div className="p-4 rounded-2xl bg-white border border-gray-200 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 pr-2">
                  <span className="text-xs font-black text-gray-900 block">
                    Operational Telemetry & Diagnostics
                  </span>
                  <p className="text-[11px] text-gray-600 leading-relaxed font-normal">
                    Governs client-side responsiveness logging and error diagnostics via our consent-aware telemetry interface.
                  </p>
                  <p className="text-[10px] text-gray-500 leading-normal pt-0.5">
                    <strong>Status:</strong> KITS-EOS does NOT bundle advertising trackers, marketing cookies, social pixels, or commercial profiling scripts (such as Google Analytics or Meta Pixel).<br />
                    <strong>When ACTIVE:</strong> Authorizes client error and performance diagnostics to improve application responsiveness.<br />
                    <strong>When OFF:</strong> Stops all non-essential telemetry and performance diagnostic event processing.
                  </p>
                </div>
                <ToggleSwitch
                  id="telemetry-diagnostics-switch"
                  checked={preferences.analytics}
                  onChange={(checked) =>
                    setPreferences((prev) => ({
                      ...prev,
                      analytics: checked,
                    }))
                  }
                  label="Toggle operational telemetry and diagnostics"
                />
              </div>
            </div>

            {/* Link to Policy */}
            <div className="text-[11px] text-gray-500 space-y-1">
              <div>
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
              <p className="text-[10px] text-gray-400">
                You can adjust or revoke your optional preferences at any time via the Cookie Preferences link in the website footer or on the Privacy Policy page.
              </p>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={handleRejectNonEssential}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 transition min-h-[44px] cursor-pointer"
              >
                Reject Non-Essential
              </button>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 transition min-h-[44px] cursor-pointer"
                >
                  Accept All
                </button>
                <button
                  type="button"
                  onClick={handleSavePreferences}
                  className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs min-h-[44px] cursor-pointer"
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
