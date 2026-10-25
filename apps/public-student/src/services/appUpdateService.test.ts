import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isNewerBuildAvailable,
  isNewerVersionAvailable,
  isValidSemver,
  compareSemanticVersions,
  getClientVersion,
  isUpdateDeferred,
  deferUpdateForSession,
  clearUpdateDeferral,
  canSafelyReload,
  recordReloadAttempt,
  performAppUpdate,
  fetchRemoteVersionManifest,
  checkForAppUpdate,
  initializeAppUpdateService,
  subscribeToAppUpdates,
  getAppUpdateDiagnostics,
  resetAppUpdateServiceForTesting,
  APP_UPDATE_DISMISSED_KEY,
  APP_UPDATE_DISMISSED_RECORD_KEY,
  APP_UPDATE_RELOAD_GUARD_KEY,
} from './appUpdateService';

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

describe('App Update Service', () => {
  let mockSession: Storage;
  let mockLocal: Storage;

  beforeEach(() => {
    mockSession = createStorageMock();
    mockLocal = createStorageMock();
    (globalThis as any).window = globalThis.window || {};
    (globalThis as any).window.sessionStorage = mockSession;
    (globalThis as any).window.localStorage = mockLocal;
    (globalThis as any).sessionStorage = mockSession;
    (globalThis as any).localStorage = mockLocal;

    (globalThis as any).window.setInterval = globalThis.setInterval.bind(globalThis);
    (globalThis as any).window.clearInterval = globalThis.clearInterval.bind(globalThis);

    if (typeof (globalThis as any).document === 'undefined') {
      class MockDocument extends EventTarget {
        visibilityState: DocumentVisibilityState = 'visible';
      }
      const mockDoc = new MockDocument();
      (globalThis as any).document = mockDoc;
      (globalThis as any).window.document = mockDoc;
    }

    resetAppUpdateServiceForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetAppUpdateServiceForTesting();
    vi.restoreAllMocks();
  });

  describe('isNewerBuildAvailable', () => {
    it('returns false when remote build matches current build', () => {
      expect(isNewerBuildAvailable('build-12345', 'build-12345')).toBe(false);
    });

    it('returns false when remote build is missing, null, or empty', () => {
      expect(isNewerBuildAvailable('build-12345', null)).toBe(false);
      expect(isNewerBuildAvailable('build-12345', undefined)).toBe(false);
      expect(isNewerBuildAvailable('build-12345', '')).toBe(false);
      expect(isNewerBuildAvailable('build-12345', '   ')).toBe(false);
    });

    it('returns false when remote build is dev-build and client is on a production build', () => {
      expect(isNewerBuildAvailable('1792640445856', 'dev-build')).toBe(false);
    });

    it('returns true when a newer/different remote build is detected', () => {
      expect(isNewerBuildAvailable('build-100', 'build-101')).toBe(true);
      expect(isNewerBuildAvailable('1730000000000', '1730000100000')).toBe(true);
    });

    it('allows simulated updates in local development environment', () => {
      expect(isNewerBuildAvailable('dev-build', 'simulated-dev-v2')).toBe(true);
    });
  });

  describe('Semantic Versioning & Semver Comparison', () => {
    it('validates semantic version syntax correctly', () => {
      expect(isValidSemver('3.0.0')).toBe(true);
      expect(isValidSemver('v3.0.0')).toBe(true);
      expect(isValidSemver('3.1.2-alpha.1')).toBe(true);
      expect(isValidSemver('3.0.0+build123')).toBe(true);
      expect(isValidSemver('3.0')).toBe(false);
      expect(isValidSemver('invalid')).toBe(false);
      expect(isValidSemver('')).toBe(false);
    });

    it('compares semantic versions accurately', () => {
      expect(compareSemanticVersions('3.0.1', '3.0.0')).toBe(1);
      expect(compareSemanticVersions('3.1.0', '3.0.0')).toBe(1);
      expect(compareSemanticVersions('4.0.0', '3.0.0')).toBe(1);
      expect(compareSemanticVersions('3.0.0', '3.0.0')).toBe(0);
      expect(compareSemanticVersions('3.0.0', '3.0.1')).toBe(-1);
      expect(compareSemanticVersions('3.0.0', '0.0.0')).toBe(1);
      expect(compareSemanticVersions('3.0.0', '3.0.0-rc.1')).toBe(1);
      expect(compareSemanticVersions('v3.0.0', '3.0.0')).toBe(0);
    });

    it('isNewerVersionAvailable triggers for newer semver, ignores same semver', () => {
      expect(isNewerVersionAvailable('3.0.0', '3.0.1')).toBe(true);
      expect(isNewerVersionAvailable('3.0.0', '3.1.0')).toBe(true);
      expect(isNewerVersionAvailable('3.0.0', '4.0.0')).toBe(true);

      // Same semantic version: MUST NOT trigger update notification
      expect(isNewerVersionAvailable('3.0.0', '3.0.0')).toBe(false);

      // Older version: MUST NOT trigger update notification
      expect(isNewerVersionAvailable('3.0.0', '2.9.9')).toBe(false);

      // Accidental 0.0.0 remote: MUST NOT downgrade production 3.0.0 client
      expect(isNewerVersionAvailable('3.0.0', '0.0.0')).toBe(false);

      // Upgrading from legacy 0.0.0 deployed client: MUST trigger update to 3.0.0
      expect(isNewerVersionAvailable('0.0.0', '3.0.0')).toBe(true);
    });

    it('getClientVersion returns default 3.0.0 in test environment', () => {
      expect(getClientVersion()).toBe('3.0.0');
    });
  });

  describe('Scoped Deferral Policy ("Later")', () => {
    it('returns false when not deferred', () => {
      expect(isUpdateDeferred(undefined, 10000)).toBe(false);
      expect(isUpdateDeferred('build-101', 10000)).toBe(false);
    });

    it('returns true when current time is before dismissedUntil timestamp for the same build', () => {
      sessionStorage.setItem(
        APP_UPDATE_DISMISSED_RECORD_KEY,
        JSON.stringify({ dismissedBuildId: 'build-101', dismissedUntil: 20000 })
      );
      expect(isUpdateDeferred('build-101', 15000)).toBe(true);
    });

    it('returns false after deferral period expires (prevents permanent suppression)', () => {
      sessionStorage.setItem(
        APP_UPDATE_DISMISSED_RECORD_KEY,
        JSON.stringify({ dismissedBuildId: 'build-101', dismissedUntil: 20000 })
      );
      expect(isUpdateDeferred('build-101', 25000)).toBe(false);
    });

    it('CRITICAL: prompts again when a NEW build is detected even if previous build was dismissed', () => {
      // User dismissed build-101 until 50000
      sessionStorage.setItem(
        APP_UPDATE_DISMISSED_RECORD_KEY,
        JSON.stringify({ dismissedBuildId: 'build-101', dismissedUntil: 50000 })
      );

      // Same build remains deferred at time 30000
      expect(isUpdateDeferred('build-101', 30000)).toBe(true);

      // Fresh build-102 deployed at time 30000: MUST NOT be suppressed by build-101 dismissal
      expect(isUpdateDeferred('build-102', 30000)).toBe(false);
    });

    it('deferUpdateForSession records scoped buildId and timestamp in sessionStorage', () => {
      const now = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      deferUpdateForSession('build-200', 15 * 60 * 1000);

      const recordRaw = sessionStorage.getItem(APP_UPDATE_DISMISSED_RECORD_KEY);
      expect(recordRaw).toBeTruthy();
      const record = JSON.parse(recordRaw!);
      expect(record.dismissedBuildId).toBe('build-200');
      expect(record.dismissedUntil).toBe(now + 15 * 60 * 1000);
      expect(sessionStorage.getItem(APP_UPDATE_DISMISSED_KEY)).toBe(String(now + 15 * 60 * 1000));
    });

    it('clearUpdateDeferral removes both scoped record and legacy keys', () => {
      sessionStorage.setItem(APP_UPDATE_DISMISSED_RECORD_KEY, JSON.stringify({ dismissedUntil: 9999 }));
      sessionStorage.setItem(APP_UPDATE_DISMISSED_KEY, '9999');

      clearUpdateDeferral();

      expect(sessionStorage.getItem(APP_UPDATE_DISMISSED_RECORD_KEY)).toBeNull();
      expect(sessionStorage.getItem(APP_UPDATE_DISMISSED_KEY)).toBeNull();
    });
  });

  describe('Anti-Infinite-Reload Guard', () => {
    it('records reload attempt into sessionStorage reload guard key', () => {
      recordReloadAttempt('target-123', 5000);
      const raw = sessionStorage.getItem(APP_UPDATE_RELOAD_GUARD_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!)).toMatchObject({ buildId: 'target-123', count: 1 });
    });

    it('allows reloading on first attempt for a target build', () => {
      expect(canSafelyReload('build-v3-new', 1000)).toBe(true);
    });

    it('tracks attempts and prevents looping when 2 attempts occur within 30s', () => {
      const now = 50000;
      recordReloadAttempt('build-v3-new', now);
      expect(canSafelyReload('build-v3-new', now + 1000)).toBe(true);

      recordReloadAttempt('build-v3-new', now + 1000);
      // Second attempt recorded within 30s: should prevent infinite reload loop
      expect(canSafelyReload('build-v3-new', now + 2000)).toBe(false);
    });

    it('resets guard when time window elapses', () => {
      const now = 50000;
      recordReloadAttempt('build-v3-new', now);
      recordReloadAttempt('build-v3-new', now + 1000);

      // After 35 seconds, reload is allowed again
      expect(canSafelyReload('build-v3-new', now + 35000)).toBe(true);
    });
  });

  describe('fetchRemoteVersionManifest Endpoint Verification', () => {
    it('successfully parses valid JSON response with application/json content-type', async () => {
      const mockManifest = {
        version: '3.0.1',
        buildId: '1792650000000',
        builtAt: '2026-10-22T04:00:00.000Z',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
        json: async () => mockManifest,
      } as Response);

      const result = await fetchRemoteVersionManifest();
      expect(result).toEqual(mockManifest);

      const diag = getAppUpdateDiagnostics();
      expect(diag.lastCheckStatus).toBe('success');
      expect(diag.lastHttpStatus).toBe(200);
      expect(diag.lastContentType).toContain('application/json');
    });

    it('rejects HTML fallback response (e.g. Firebase rewrite returning index.html) without throwing', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      } as unknown as Response);

      const result = await fetchRemoteVersionManifest();
      expect(result).toBeNull();

      const diag = getAppUpdateDiagnostics();
      expect(diag.lastCheckStatus).toBe('non_json_content_type');
    });

    it('handles HTTP error status safely (e.g. 404, 500, 503)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Service Unavailable' }),
      } as unknown as Response);

      const result = await fetchRemoteVersionManifest();
      expect(result).toBeNull();

      const diag = getAppUpdateDiagnostics();
      expect(diag.lastCheckStatus).toBe('http_error');
      expect(diag.lastHttpStatus).toBe(503);
    });

    it('handles malformed JSON syntax gracefully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
      } as unknown as Response);

      const result = await fetchRemoteVersionManifest();
      expect(result).toBeNull();

      const diag = getAppUpdateDiagnostics();
      expect(diag.lastCheckStatus).toBe('malformed_json');
    });

    it('handles missing or empty buildId in manifest safely', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ version: '3.0.0', buildId: '   ' }),
      } as Response);

      const result = await fetchRemoteVersionManifest();
      expect(result).toBeNull();

      const diag = getAppUpdateDiagnostics();
      expect(diag.lastCheckStatus).toBe('malformed_json');
    });

    it('handles network disconnection/offline safely', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const result = await fetchRemoteVersionManifest();
      expect(result).toBeNull();

      const diag = getAppUpdateDiagnostics();
      expect(diag.lastCheckStatus).toBe('network_error');
    });
  });

  describe('checkForAppUpdate Lifecycle and UI Notification', () => {
    it('scenario 1: identical local and remote build IDs produces NO update notification', async () => {
      const subscriber = vi.fn();
      const unsubscribe = subscribeToAppUpdates(subscriber);

      // Local build is dev-build
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ version: '3.0.0', buildId: 'dev-build' }),
      } as Response);

      const state = await checkForAppUpdate();
      expect(state.hasUpdate).toBe(false);

      const diag = getAppUpdateDiagnostics();
      expect(diag.hasUpdate).toBe(false);
      expect(diag.suppressionReason).toBe('up_to_date');

      unsubscribe();
    });

    it('scenario 2: different remote build ID triggers prompt and notifies subscribers', async () => {
      const states: boolean[] = [];
      const unsubscribe = subscribeToAppUpdates((s) => states.push(s.hasUpdate));

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ version: '3.1.0', buildId: 'new-prod-build-999' }),
      } as Response);

      const state = await checkForAppUpdate();
      expect(state.hasUpdate).toBe(true);
      expect(state.latestBuildId).toBe('new-prod-build-999');
      expect(state.isDeferred).toBe(false);
      expect(states).toContain(true);

      const diag = getAppUpdateDiagnostics();
      expect(diag.hasUpdate).toBe(true);
      expect(diag.suppressionReason).toBe('none');

      unsubscribe();
    });

    it('scenario 4: error recovery — checker detects new build after earlier failed request', async () => {
      // Step 1: Failed fetch (e.g. network hiccup during deployment)
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network drop'));
      const failState = await checkForAppUpdate();
      expect(failState.hasUpdate).toBe(false);

      // Step 2: Next retry succeeds with the newly deployed build
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ version: '3.1.0', buildId: 'recovered-build-105' }),
      } as Response);

      const successState = await checkForAppUpdate();
      expect(successState.hasUpdate).toBe(true);
      expect(successState.latestBuildId).toBe('recovered-build-105');
    });

    it('scenario 6: new build can prompt again even if older build was previously dismissed', async () => {
      // Dismiss build-100 for 15 minutes
      deferUpdateForSession('build-100');

      // Now a new deployment build-101 arrives
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ version: '3.1.0', buildId: 'build-101' }),
      } as Response);

      const state = await checkForAppUpdate();
      expect(state.hasUpdate).toBe(true);
      expect(state.isDeferred).toBe(false); // MUST NOT be deferred for the new build!
    });
  });

  describe('Tab Visibility Detection and Polling', () => {
    it('scenario 3: tab becoming visible triggers a fresh version check and SW update check', async () => {
      const regUpdateMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis.navigator, 'serviceWorker', {
        configurable: true,
        writable: true,
        value: {
          getRegistration: vi.fn().mockResolvedValue({
            update: regUpdateMock,
            waiting: null,
            addEventListener: vi.fn(),
          }),
          controller: {},
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ version: '3.2.0', buildId: 'visibility-build-888' }),
      } as Response);

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });

      const cleanup = initializeAppUpdateService();

      // Trigger visibility change event
      document.dispatchEvent(new Event('visibilitychange'));

      // Allow async promises to resolve
      await new Promise((r) => setTimeout(r, 10));

      const diag = getAppUpdateDiagnostics();
      expect(diag.visibilityCheckCount).toBeGreaterThan(0);
      expect(regUpdateMock).toHaveBeenCalled();
      expect(diag.hasUpdate).toBe(true);
      expect(diag.latestBuildId).toBe('visibility-build-888');

      cleanup();
    });
  });

  describe('performAppUpdate Execution and Security Boundaries', () => {
    it('scenario 7 & 8: activates update, preserves Supabase auth, and prevents infinite loops', async () => {
      // Setup active Supabase auth tokens in localStorage
      localStorage.setItem(
        'sb-jngmmjbmimxpndpoloib-auth-token',
        JSON.stringify({ access_token: 'secret-jwt-token', user: { id: 'u123' } })
      );
      localStorage.setItem('kits_student_remember', 'true');

      const reloadMock = vi.fn();
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { reload: reloadMock },
      });

      // Update 1 succeeds
      const firstUpdate = await performAppUpdate();
      expect(firstUpdate).toBe(true);
      expect(reloadMock).toHaveBeenCalledTimes(1);

      // Auth tokens must NOT be cleared by the update
      expect(localStorage.getItem('sb-jngmmjbmimxpndpoloib-auth-token')).toContain('secret-jwt-token');
      expect(localStorage.getItem('kits_student_remember')).toBe('true');

      // Reset state for loop check
      resetAppUpdateServiceForTesting();

      // Simulate a rapid repeated reload attempt within 30 seconds (edge CDN delay)
      recordReloadAttempt('target-loop-build');
      recordReloadAttempt('target-loop-build');

      // Reload guard trips: prevents infinite reload loop
      expect(canSafelyReload('target-loop-build')).toBe(false);
    });
  });
});
