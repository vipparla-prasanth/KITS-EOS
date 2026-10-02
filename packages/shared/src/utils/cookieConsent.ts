export interface CookiePreferences {
  essential: boolean; // Always true for authentication and core operation
  functional: boolean; // UI preferences, dismiss states, theme
  analytics: boolean; // Telemetry and performance diagnostics (opt-in / future)
}

export interface CookieConsentRecord {
  hasResponded: boolean;
  version: string;
  timestamp: string;
  preferences: CookiePreferences;
}

export const COOKIE_CONSENT_VERSION = 'v2';
export const STORAGE_KEY = 'kits_eos_cookie_consent_v1';

const DEFAULT_PREFERENCES: CookiePreferences = {
  essential: true,
  functional: true,
  analytics: false,
};

export const EVENT_OPEN_COOKIE_PREFERENCES = 'kits-eos:open-cookie-preferences';
export const EVENT_COOKIE_CONSENT_CHANGED = 'kits-eos:cookie-consent-changed';

/**
 * Retrieve the current cookie & storage consent record from localStorage.
 * Treats any stored consent from an older version as OUTDATED, prompting the banner again.
 */
export function getCookieConsent(): CookieConsentRecord {
  if (typeof window === 'undefined') {
    return {
      hasResponded: false,
      version: COOKIE_CONSENT_VERSION,
      timestamp: new Date().toISOString(),
      preferences: { ...DEFAULT_PREFERENCES },
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        hasResponded: false,
        version: COOKIE_CONSENT_VERSION,
        timestamp: new Date().toISOString(),
        preferences: { ...DEFAULT_PREFERENCES },
      };
    }

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.preferences) {
      const isCurrentVersion = parsed.version === COOKIE_CONSENT_VERSION;
      return {
        // Version check: if stored consent belongs to an older policy version (e.g. '1.0'), prompt user again
        hasResponded: isCurrentVersion ? Boolean(parsed.hasResponded) : false,
        version: COOKIE_CONSENT_VERSION,
        timestamp: parsed.timestamp || new Date().toISOString(),
        preferences: {
          essential: true, // Non-negotiable for system security and sessions
          functional: typeof parsed.preferences.functional === 'boolean' ? parsed.preferences.functional : true,
          analytics: typeof parsed.preferences.analytics === 'boolean' ? parsed.preferences.analytics : false,
        },
      };
    }
  } catch (err) {
    console.warn('Failed to parse cookie consent state from storage:', err);
  }

  return {
    hasResponded: false,
    version: COOKIE_CONSENT_VERSION,
    timestamp: new Date().toISOString(),
    preferences: { ...DEFAULT_PREFERENCES },
  };
}

/**
 * Save user cookie & storage preferences and dispatch an update event.
 */
export function saveCookieConsent(preferences: Partial<CookiePreferences>): CookieConsentRecord {
  const updated: CookieConsentRecord = {
    hasResponded: true,
    version: COOKIE_CONSENT_VERSION,
    timestamp: new Date().toISOString(),
    preferences: {
      essential: true, // Non-negotiable for system security and sessions
      functional: preferences.functional ?? true,
      analytics: preferences.analytics ?? false,
    },
  };

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent(EVENT_COOKIE_CONSENT_CHANGED, { detail: updated }));
    } catch (err) {
      console.warn('Failed to save cookie consent state:', err);
    }
  }

  return updated;
}

/**
 * Accept all cookie and storage categories.
 */
export function acceptAllCookies(): CookieConsentRecord {
  return saveCookieConsent({
    essential: true,
    functional: true,
    analytics: true,
  });
}

/**
 * Reject optional categories, leaving only essential session storage enabled.
 */
export function rejectNonEssentialCookies(): CookieConsentRecord {
  return saveCookieConsent({
    essential: true,
    functional: false,
    analytics: false,
  });
}

/**
 * Check if the user has already provided their cookie consent choice.
 */
export function hasUserRespondedToCookies(): boolean {
  return getCookieConsent().hasResponded;
}

/**
 * Trigger the Cookie Preferences modal from anywhere (e.g. footer links).
 */
export function openCookiePreferencesModal(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_OPEN_COOKIE_PREFERENCES));
  }
}
