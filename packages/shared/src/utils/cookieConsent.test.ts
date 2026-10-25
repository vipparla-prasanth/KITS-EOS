import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCookieConsent,
  saveCookieConsent,
  acceptAllCookies,
  rejectNonEssentialCookies,
  hasUserRespondedToCookies,
  isFunctionalStorageAllowed,
  isTelemetryAllowed,
  cleanupOptionalFunctionalStorage,
  openCookiePreferencesModal,
  STORAGE_KEY,
  COOKIE_CONSENT_VERSION,
  EVENT_COOKIE_CONSENT_CHANGED,
  EVENT_OPEN_COOKIE_PREFERENCES,
} from './cookieConsent';
import { AnalyticsService } from './analytics';

function createStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

describe('Cookie and Browser Storage Consent Suite', () => {
  let mockLocal: Storage;
  let mockSession: Storage;

  beforeEach(() => {
    mockLocal = createStorageMock();
    mockSession = createStorageMock();

    (globalThis as any).window = (globalThis as any).window || {};
    (globalThis as any).window.localStorage = mockLocal;
    (globalThis as any).localStorage = mockLocal;
    (globalThis as any).window.sessionStorage = mockSession;
    (globalThis as any).sessionStorage = mockSession;

    // Provide EventTarget mock on window for node environment
    const listeners: Record<string, Function[]> = {};
    window.addEventListener = (event: string, cb: any) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    };
    window.removeEventListener = (event: string, cb: any) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((l) => l !== cb);
      }
    };
    window.dispatchEvent = (e: any) => {
      const cbs = listeners[e.type] || [];
      cbs.forEach((cb) => cb(e));
      return true;
    };
  });

  describe('1. Default Consent State', () => {
    it('returns default consent when no record is stored in localStorage', () => {
      const consent = getCookieConsent();
      expect(consent.hasResponded).toBe(false);
      expect(consent.version).toBe(COOKIE_CONSENT_VERSION);
      expect(consent.preferences.essential).toBe(true);
      expect(consent.preferences.functional).toBe(true);
      expect(consent.preferences.analytics).toBe(false);
      expect(hasUserRespondedToCookies()).toBe(false);
      expect(isFunctionalStorageAllowed()).toBe(true);
      expect(isTelemetryAllowed()).toBe(false);
    });

    it('re-prompts user if stored consent is from an older version', () => {
      mockLocal.setItem(
        STORAGE_KEY,
        JSON.stringify({
          hasResponded: true,
          version: 'v1-legacy',
          preferences: { essential: true, functional: true, analytics: true },
        })
      );

      const consent = getCookieConsent();
      // Should mark hasResponded as false to force re-consent under updated policy
      expect(consent.hasResponded).toBe(false);
      expect(consent.version).toBe(COOKIE_CONSENT_VERSION);
    });
  });

  describe('2. Preference Persistence & State Transitions', () => {
    it('persists customized preferences and sets hasResponded to true', () => {
      const eventSpy = vi.fn();
      window.addEventListener(EVENT_COOKIE_CONSENT_CHANGED, eventSpy);

      const result = saveCookieConsent({
        functional: false,
        analytics: true,
      });

      expect(result.hasResponded).toBe(true);
      expect(result.preferences.essential).toBe(true); // Non-negotiable
      expect(result.preferences.functional).toBe(false);
      expect(result.preferences.analytics).toBe(true);

      // Verify localStorage persistence
      const raw = mockLocal.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const stored = JSON.parse(raw!);
      expect(stored.preferences.functional).toBe(false);
      expect(stored.preferences.analytics).toBe(true);
      expect(stored.preferences.essential).toBe(true);

      window.removeEventListener(EVENT_COOKIE_CONSENT_CHANGED, eventSpy);
    });

    it('acceptAllCookies enables both optional categories', () => {
      const result = acceptAllCookies();
      expect(result.hasResponded).toBe(true);
      expect(result.preferences.essential).toBe(true);
      expect(result.preferences.functional).toBe(true);
      expect(result.preferences.analytics).toBe(true);
      expect(isFunctionalStorageAllowed()).toBe(true);
      expect(isTelemetryAllowed()).toBe(true);
    });

    it('rejectNonEssentialCookies disables optional categories while keeping essential active', () => {
      const result = rejectNonEssentialCookies();
      expect(result.hasResponded).toBe(true);
      expect(result.preferences.essential).toBe(true);
      expect(result.preferences.functional).toBe(false);
      expect(result.preferences.analytics).toBe(false);
      expect(isFunctionalStorageAllowed()).toBe(false);
      expect(isTelemetryAllowed()).toBe(false);
    });
  });

  describe('3. Non-Destructive Storage Cleanup & Invariant Safety', () => {
    it('cleans up optional local drafts and notice banners when functional storage is disabled', () => {
      // Seed optional items
      mockLocal.setItem('kits_eos_local_draft_subevent_123', '{"field":"data"}');
      mockLocal.setItem('kits_eos_local_draft_event_fest', '{"title":"fest draft"}');
      mockSession.setItem('kits_eos_privacy_notice_postponed', '2.0');
      mockSession.setItem('app_update_dismissed_record_v1', '{"until":999}');

      // Seed critical ESSENTIAL items that must NEVER be removed
      mockLocal.setItem('sb-jngmmjbmimxpndpoloib-auth-token', '{"access_token":"secret-jwt"}');
      mockLocal.setItem('kits_student_remember', 'true');
      mockSession.setItem('kits_coordinator_session', '{"token":"coord-token-123"}');
      mockSession.setItem('kits_session_marker', '{"active":true}');
      mockSession.setItem('kits_recovery_mode', 'true');

      // Reject non-essential cookies
      rejectNonEssentialCookies();

      // Verify optional drafts and banners were removed
      expect(mockLocal.getItem('kits_eos_local_draft_subevent_123')).toBeNull();
      expect(mockLocal.getItem('kits_eos_local_draft_event_fest')).toBeNull();
      expect(mockSession.getItem('kits_eos_privacy_notice_postponed')).toBeNull();
      expect(mockSession.getItem('app_update_dismissed_record_v1')).toBeNull();

      // Verify ESSENTIAL items remain strictly intact
      expect(mockLocal.getItem('sb-jngmmjbmimxpndpoloib-auth-token')).toBe('{"access_token":"secret-jwt"}');
      expect(mockLocal.getItem('kits_student_remember')).toBe('true');
      expect(mockSession.getItem('kits_coordinator_session')).toBe('{"token":"coord-token-123"}');
      expect(mockSession.getItem('kits_session_marker')).toBe('{"active":true}');
      expect(mockSession.getItem('kits_recovery_mode')).toBe('true');

      // The consent record itself must be safely stored
      expect(mockLocal.getItem(STORAGE_KEY)).not.toBeNull();
    });

    it('cleanupOptionalFunctionalStorage is safe even if storage is empty', () => {
      expect(() => cleanupOptionalFunctionalStorage()).not.toThrow();
    });
  });

  describe('4. Telemetry and Analytics Consent Boundaries', () => {
    it('AnalyticsService drops events when analytics consent is false', () => {
      saveCookieConsent({ analytics: false });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      AnalyticsService.trackEvent('test_event', { key: 'value' });
      AnalyticsService.trackPageView('/assessments');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('AnalyticsService permits diagnostic logging when analytics consent is true in DEV', () => {
      saveCookieConsent({ analytics: true });
      (window as any).__DEV__ = true;
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      AnalyticsService.trackEvent('client_latency_check', { ms: 120 });
      AnalyticsService.trackPageView('/assessments');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[KITS-EOS Telemetry] Event: "client_latency_check"',
        { ms: 120 }
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        '[KITS-EOS Telemetry] Page View: "/assessments"'
      );

      consoleSpy.mockRestore();
      delete (window as any).__DEV__;
    });
  });

  describe('5. Modal Event Wiring & Lifecycle Integrity', () => {
    it('openCookiePreferencesModal dispatches EVENT_OPEN_COOKIE_PREFERENCES', () => {
      let eventFired = false;
      const handler = () => {
        eventFired = true;
      };
      window.addEventListener(EVENT_OPEN_COOKIE_PREFERENCES, handler);

      openCookiePreferencesModal();
      expect(eventFired).toBe(true);

      window.removeEventListener(EVENT_OPEN_COOKIE_PREFERENCES, handler);
    });

    it('simulates complete preference lifecycle: initial load -> save individual -> discard uncommitted -> reload', () => {
      // 1. Initial page load
      let consent = getCookieConsent();
      expect(consent.hasResponded).toBe(false);

      // 2. User customizes choices and clicks "Save Preferences"
      saveCookieConsent({ functional: false, analytics: true });
      consent = getCookieConsent();
      expect(consent.hasResponded).toBe(true);
      expect(consent.preferences.functional).toBe(false);
      expect(consent.preferences.analytics).toBe(true);

      // 3. User opens modal later and modifies local state without saving (simulates closing modal via X or Escape)
      let uncommittedState = { ...consent.preferences, functional: true, analytics: false };
      // User closes modal without calling saveCookieConsent -> state is discarded
      uncommittedState = getCookieConsent().preferences; // Reverted on modal close
      expect(uncommittedState.functional).toBe(false);
      expect(uncommittedState.analytics).toBe(true);

      // 4. Page reload / navigation simulation
      const reloadedConsent = getCookieConsent();
      expect(reloadedConsent.hasResponded).toBe(true);
      expect(reloadedConsent.preferences.functional).toBe(false);
      expect(reloadedConsent.preferences.analytics).toBe(true);
      expect(reloadedConsent.preferences.essential).toBe(true);
    });
  });
});
