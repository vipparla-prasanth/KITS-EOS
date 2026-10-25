/**
 * KITS-EOS Frontend Version & App Update Management Service
 * Detects newly deployed versions via /version.json polling and Service Worker lifecycle events.
 * Provides safe update activation, anti-infinite reload protection, scoped deferral,
 * and observable runtime diagnostics for development and testing.
 */

export interface VersionManifest {
  version: string;
  buildId: string;
  builtAt: string;
}

export interface AppUpdateState {
  hasUpdate: boolean;
  currentBuildId: string;
  latestBuildId?: string;
  latestVersion?: string;
  isUpdating: boolean;
  isDeferred: boolean;
}

export interface UpdateDismissalRecord {
  dismissedBuildId?: string;
  dismissedUntil: number;
}

export interface AppUpdateDiagnostics {
  currentBuildId: string;
  latestBuildId: string | null;
  latestVersion: string | null;
  lastCheckTimestamp: number | null;
  lastCheckStatus: 'idle' | 'success' | 'network_error' | 'malformed_json' | 'non_json_content_type' | 'http_error';
  lastHttpStatus: number | null;
  lastContentType: string | null;
  visibilityCheckCount: number;
  pollCheckCount: number;
  serviceWorkerControlled: boolean;
  serviceWorkerWaiting: boolean;
  hasUpdate: boolean;
  isDeferred: boolean;
  dismissedBuildId: string | null;
  dismissedUntil: number | null;
  suppressionReason: 'none' | 'up_to_date' | 'dismissed_active' | 'reload_guard_active' | 'error_retrying';
}

export const APP_UPDATE_DISMISSED_RECORD_KEY = 'kits_app_update_dismissed_record';
export const APP_UPDATE_DISMISSED_KEY = 'kits_app_update_dismissed_until';
export const APP_UPDATE_RELOAD_GUARD_KEY = 'kits_app_update_reload_guard';
export const DEFAULT_DEFER_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const POLLING_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes

/**
 * Diagnostic logger active only in development environments.
 * Strictly never logs auth tokens or sensitive data.
 */
function logDevDiagnostic(message: string, ...details: unknown[]): void {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
      console.info(`[AppUpdate:Diagnostic] ${message}`, ...details);
    }
  } catch {
    // Silent in test or non-Vite environments
  }
}

// Get build ID injected at compile time by Vite, with fallback for test environments
export function getClientBuildId(): string {
  try {
    if (typeof __APP_BUILD_ID__ !== 'undefined' && __APP_BUILD_ID__) {
      return __APP_BUILD_ID__;
    }
  } catch {
    // Variable not defined in environment
  }
  return 'dev-build';
}

// Get semantic product version injected at compile time by Vite, with fallback for test environments
export function getClientVersion(): string {
  try {
    if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
      return __APP_VERSION__;
    }
  } catch {
    // Variable not defined in environment
  }
  return '3.0.0';
}

/**
 * Validates semantic version syntax (e.g. 3.0.0, 3.1.0-beta.1).
 */
export function isValidSemver(version: string): boolean {
  if (typeof version !== 'string') return false;
  const semverRegex = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  return semverRegex.test(version.trim().replace(/^v/, ''));
}

/**
 * Compares two semantic version strings.
 * Returns:
 *   1 if v1 > v2 (v1 is newer)
 *  -1 if v1 < v2 (v1 is older)
 *   0 if v1 === v2
 */
export function compareSemanticVersions(v1: string, v2: string): number {
  const clean1 = v1.trim().replace(/^v/, '');
  const clean2 = v2.trim().replace(/^v/, '');

  const [core1, prerelease1] = clean1.split('-');
  const [core2, prerelease2] = clean2.split('-');

  const parts1 = core1.split('.').map((p) => parseInt(p, 10));
  const parts2 = core2.split('.').map((p) => parseInt(p, 10));

  for (let i = 0; i < 3; i++) {
    const num1 = parts1[i] ?? 0;
    const num2 = parts2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  // Same major.minor.patch: version without prerelease is higher than one with prerelease
  if (!prerelease1 && prerelease2) return 1;
  if (prerelease1 && !prerelease2) return -1;
  if (prerelease1 && prerelease2) {
    if (prerelease1 > prerelease2) return 1;
    if (prerelease1 < prerelease2) return -1;
  }

  return 0;
}

/**
 * Checks whether a remote semantic version is strictly newer than current version.
 * Prevents invalid/uninitialized versions (e.g. 0.0.0) from falsely triggering updates.
 */
export function isNewerVersionAvailable(
  currentVersion: string,
  remoteVersion?: string | null
): boolean {
  if (!remoteVersion || typeof remoteVersion !== 'string') {
    return false;
  }
  const cleanRemote = remoteVersion.trim().replace(/^v/, '');
  const cleanCurrent = currentVersion.trim().replace(/^v/, '');

  if (!cleanRemote || !cleanCurrent) {
    return false;
  }

  // If remote is accidental 0.0.0 and current is a production version, ignore
  if (cleanRemote === '0.0.0' && cleanCurrent !== '0.0.0') {
    return false;
  }

  // In development environment
  if (cleanCurrent === 'dev-build') {
    return cleanRemote !== 'dev-build';
  }

  if (isValidSemver(cleanRemote) && isValidSemver(cleanCurrent)) {
    return compareSemanticVersions(cleanRemote, cleanCurrent) > 0;
  }

  return cleanRemote !== cleanCurrent;
}

/**
 * pure check to determine if remote build is strictly different from current client build.
 * Compares non-empty trimmed build strings. Prevents accidental dev-build manifests
 * from falsely triggering updates on production clients.
 */
export function isNewerBuildAvailable(currentBuild: string, remoteBuild?: string | null): boolean {
  if (!remoteBuild || typeof remoteBuild !== 'string') {
    return false;
  }
  const cleanRemote = remoteBuild.trim();
  const cleanCurrent = currentBuild.trim();
  if (!cleanRemote || !cleanCurrent) {
    return false;
  }
  // In production builds, if remote is dev-build and client has a production build ID, ignore
  if (cleanRemote === 'dev-build' && cleanCurrent !== 'dev-build') {
    return false;
  }
  return cleanRemote !== cleanCurrent;
}

/**
 * Checks whether the user has dismissed/deferred the update notification for a grace period.
 * Crucially, if a NEW build is detected that differs from the dismissed build, deferral
 * DOES NOT APPLY, allowing fresh deployment notifications to prompt immediately.
 */
export function isUpdateDeferred(latestBuildId?: string, now: number = Date.now()): boolean {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return false;
  }
  try {
    // Check scoped dismissal record first
    const rawRecord = window.sessionStorage.getItem(APP_UPDATE_DISMISSED_RECORD_KEY);
    if (rawRecord) {
      const record: UpdateDismissalRecord = JSON.parse(rawRecord);
      if (now >= record.dismissedUntil) {
        return false; // Time expired
      }
      // If a genuinely newer/different build is detected, dismiss does not suppress it
      if (latestBuildId && record.dismissedBuildId && record.dismissedBuildId !== latestBuildId) {
        return false;
      }
      return true;
    }

    // Fallback to legacy timestamp key
    const rawLegacy = window.sessionStorage.getItem(APP_UPDATE_DISMISSED_KEY);
    if (rawLegacy) {
      const dismissedUntil = Number(rawLegacy);
      return !isNaN(dismissedUntil) && now < dismissedUntil;
    }
    return false;
  } catch (err) {
    console.warn('[AppUpdate] Failed to read deferral state:', err);
    return false;
  }
}

/**
 * Temporarily defers update notification scoped to the given buildId.
 */
export function deferUpdateForSession(
  buildId?: string,
  durationMs: number = DEFAULT_DEFER_DURATION_MS
): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }
  try {
    const record: UpdateDismissalRecord = {
      dismissedBuildId: buildId,
      dismissedUntil: Date.now() + durationMs,
    };
    window.sessionStorage.setItem(APP_UPDATE_DISMISSED_RECORD_KEY, JSON.stringify(record));
    window.sessionStorage.setItem(APP_UPDATE_DISMISSED_KEY, String(record.dismissedUntil));
    notifySubscribers();
  } catch (err) {
    console.warn('[AppUpdate] Failed to store deferral state:', err);
  }
}

/**
 * Clears deferral state.
 */
export function clearUpdateDeferral(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }
  try {
    window.sessionStorage.removeItem(APP_UPDATE_DISMISSED_RECORD_KEY);
    window.sessionStorage.removeItem(APP_UPDATE_DISMISSED_KEY);
  } catch (err) {
    console.warn('[AppUpdate] Failed to clear deferral state:', err);
  }
}

interface ReloadGuardRecord {
  buildId: string;
  timestamp: number;
  count: number;
}

/**
 * Guard against infinite reload loops if a new build is temporarily delayed on CDN/edge.
 */
export function canSafelyReload(targetBuildId: string, now: number = Date.now()): boolean {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return true;
  }
  try {
    const raw = window.sessionStorage.getItem(APP_UPDATE_RELOAD_GUARD_KEY);
    if (!raw) return true;
    const record: ReloadGuardRecord = JSON.parse(raw);
    if (record.buildId === targetBuildId) {
      // If already reloaded 2 times for this exact target build within 30 seconds, halt loop
      if (record.count >= 2 && now - record.timestamp < 30000) {
        console.warn('[AppUpdate] Anti-infinite-reload guard tripped for build:', targetBuildId);
        return false;
      }
    }
  } catch (err) {
    console.warn('[AppUpdate] Failed to check reload guard:', err);
  }
  return true;
}

/**
 * Records a reload attempt to prevent infinite reload cycles.
 */
export function recordReloadAttempt(targetBuildId: string, now: number = Date.now()): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }
  try {
    let count = 1;
    const raw = window.sessionStorage.getItem(APP_UPDATE_RELOAD_GUARD_KEY);
    if (raw) {
      const prev: ReloadGuardRecord = JSON.parse(raw);
      if (prev.buildId === targetBuildId && now - prev.timestamp < 30000) {
        count = prev.count + 1;
      }
    }
    const record: ReloadGuardRecord = { buildId: targetBuildId, timestamp: now, count };
    window.sessionStorage.setItem(APP_UPDATE_RELOAD_GUARD_KEY, JSON.stringify(record));
  } catch (err) {
    console.warn('[AppUpdate] Failed to record reload attempt:', err);
  }
}

// Internal singleton state
let currentState: AppUpdateState = {
  hasUpdate: false,
  currentBuildId: getClientBuildId(),
  isUpdating: false,
  isDeferred: isUpdateDeferred(),
};

// Internal diagnostic state
const diagnosticsState: AppUpdateDiagnostics = {
  currentBuildId: getClientBuildId(),
  latestBuildId: null,
  latestVersion: null,
  lastCheckTimestamp: null,
  lastCheckStatus: 'idle',
  lastHttpStatus: null,
  lastContentType: null,
  visibilityCheckCount: 0,
  pollCheckCount: 0,
  serviceWorkerControlled: false,
  serviceWorkerWaiting: false,
  hasUpdate: false,
  isDeferred: false,
  dismissedBuildId: null,
  dismissedUntil: null,
  suppressionReason: 'up_to_date',
};

const subscribers = new Set<(state: AppUpdateState) => void>();

function updateDiagnosticsFromState(): void {
  diagnosticsState.currentBuildId = currentState.currentBuildId;
  diagnosticsState.latestBuildId = currentState.latestBuildId || null;
  diagnosticsState.latestVersion = currentState.latestVersion || null;
  diagnosticsState.hasUpdate = currentState.hasUpdate;
  diagnosticsState.isDeferred = currentState.isDeferred;

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const raw = window.sessionStorage.getItem(APP_UPDATE_DISMISSED_RECORD_KEY);
      if (raw) {
        const rec: UpdateDismissalRecord = JSON.parse(raw);
        diagnosticsState.dismissedBuildId = rec.dismissedBuildId || null;
        diagnosticsState.dismissedUntil = rec.dismissedUntil || null;
      } else {
        diagnosticsState.dismissedBuildId = null;
        diagnosticsState.dismissedUntil = null;
      }
    } catch {
      // Ignore sessionStorage parsing errors in diagnostics
    }
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    diagnosticsState.serviceWorkerControlled = Boolean(navigator.serviceWorker.controller);
  }

  // Determine suppression reason
  if (!currentState.hasUpdate) {
    diagnosticsState.suppressionReason = 'up_to_date';
  } else if (currentState.isDeferred) {
    diagnosticsState.suppressionReason = 'dismissed_active';
  } else if (currentState.latestBuildId && !canSafelyReload(currentState.latestBuildId)) {
    diagnosticsState.suppressionReason = 'reload_guard_active';
  } else {
    diagnosticsState.suppressionReason = 'none';
  }

  // Expose to window in browser for dev inspection
  if (typeof window !== 'undefined') {
    (window as any).__KITS_UPDATE_DIAGNOSTICS__ = { ...diagnosticsState };
  }
}

function notifySubscribers() {
  currentState.isDeferred = isUpdateDeferred(currentState.latestBuildId);
  updateDiagnosticsFromState();

  subscribers.forEach((cb) => {
    try {
      cb({ ...currentState });
    } catch (e) {
      console.error('[AppUpdate] Subscriber error:', e);
    }
  });
}

/**
 * Fetches the latest /version.json with cache-busting timestamp and no-cache headers.
 * Validates HTTP status and Content-Type (must be application/json).
 */
export async function fetchRemoteVersionManifest(): Promise<VersionManifest | null> {
  if (typeof window === 'undefined') return null;

  try {
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`/version.json?${cacheBuster}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
    });

    const contentType = response.headers.get('content-type') || '';
    diagnosticsState.lastCheckTimestamp = Date.now();
    diagnosticsState.lastHttpStatus = response.status;
    diagnosticsState.lastContentType = contentType;

    if (!response.ok) {
      logDevDiagnostic(`Fetch /version.json returned HTTP status ${response.status}`);
      diagnosticsState.lastCheckStatus = 'http_error';
      updateDiagnosticsFromState();
      return null;
    }

    if (!contentType.toLowerCase().includes('application/json')) {
      logDevDiagnostic(`Fetch /version.json returned non-JSON Content-Type: "${contentType}"`);
      diagnosticsState.lastCheckStatus = 'non_json_content_type';
      updateDiagnosticsFromState();
      return null;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (parseErr) {
      logDevDiagnostic('Fetch /version.json response could not be parsed as JSON:', parseErr);
      diagnosticsState.lastCheckStatus = 'malformed_json';
      updateDiagnosticsFromState();
      return null;
    }

    if (
      data &&
      typeof data === 'object' &&
      typeof (data as any).buildId === 'string' &&
      (data as any).buildId.trim().length > 0
    ) {
      diagnosticsState.lastCheckStatus = 'success';
      updateDiagnosticsFromState();
      return data as VersionManifest;
    }

    logDevDiagnostic('Fetch /version.json response missing valid buildId string:', data);
    diagnosticsState.lastCheckStatus = 'malformed_json';
    updateDiagnosticsFromState();
    return null;
  } catch (err) {
    logDevDiagnostic('Network error while fetching /version.json:', err);
    diagnosticsState.lastCheckTimestamp = Date.now();
    diagnosticsState.lastCheckStatus = 'network_error';
    updateDiagnosticsFromState();
    return null;
  }
}

/**
 * Checks whether a newer version exists on the server or in a waiting service worker.
 * Prioritizes semantic version comparisons, using build IDs to distinguish builds.
 */
export async function checkForAppUpdate(): Promise<AppUpdateState> {
  const manifest = await fetchRemoteVersionManifest();
  const currentBuild = getClientBuildId();
  const currentVersion = getClientVersion();

  // Primary check: Semantic Version comparison
  const isVersionUpdate = manifest?.version
    ? isNewerVersionAvailable(currentVersion, manifest.version)
    : false;

  // Secondary check: Build ID comparison for dev-mode or build testing
  const isBuildUpdate = manifest
    ? isNewerBuildAvailable(currentBuild, manifest.buildId)
    : false;

  // An update is triggered when a newer semantic version is detected,
  // or in development simulation when build ID changes
  const hasUpdate = isVersionUpdate || (currentVersion === 'dev-build' && isBuildUpdate);

  if (manifest && hasUpdate) {
    logDevDiagnostic('Newer version detected:', {
      currentVersion,
      remoteVersion: manifest.version,
      currentBuild,
      remoteBuild: manifest.buildId,
    });
    currentState = {
      ...currentState,
      hasUpdate: true,
      currentBuildId: currentBuild,
      latestBuildId: manifest.buildId,
      latestVersion: manifest.version,
      isDeferred: isUpdateDeferred(manifest.buildId),
    };
    notifySubscribers();
    return { ...currentState };
  }

  // Also check if a service worker is waiting
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        diagnosticsState.serviceWorkerControlled = Boolean(navigator.serviceWorker.controller);
        diagnosticsState.serviceWorkerWaiting = Boolean(reg.waiting);

        if (reg.waiting) {
          logDevDiagnostic('Service worker is in waiting state ready for activation.');
          currentState = {
            ...currentState,
            hasUpdate: true,
            latestVersion: manifest?.version,
            latestBuildId: manifest?.buildId || 'sw-waiting',
            isDeferred: isUpdateDeferred(manifest?.buildId || 'sw-waiting'),
          };
          notifySubscribers();
          return { ...currentState };
        }
      }
    } catch {
      // SW check error is non-fatal
    }
  }

  updateDiagnosticsFromState();
  return { ...currentState };
}

/**
 * Triggers the update process:
 * 1. Prevents duplicate calls.
 * 2. Signals any waiting service worker to skipWaiting.
 * 3. Enforces anti-infinite-reload safeguards.
 * 4. Preserves Supabase authentication tokens in localStorage.
 * 5. Performs a clean reload of the application.
 */
export async function performAppUpdate(): Promise<boolean> {
  if (currentState.isUpdating) {
    return false;
  }

  const targetBuildId = currentState.latestBuildId || 'latest';
  if (!canSafelyReload(targetBuildId)) {
    console.warn('[AppUpdate] Reload skipped due to reload guard.');
    return false;
  }

  currentState.isUpdating = true;
  notifySubscribers();

  recordReloadAttempt(targetBuildId);
  clearUpdateDeferral();

  // If service worker is present with waiting worker, signal skipWaiting
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    } catch (err) {
      console.warn('[AppUpdate] Failed to message waiting service worker:', err);
    }
  }

  // Brief pause to allow service worker state transition
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Perform hard reload, preserving localStorage (where Supabase auth is stored)
  if (typeof window !== 'undefined') {
    window.location.reload();
  }

  return true;
}

/**
 * Returns current observable diagnostics for testing and developer inspection.
 */
export function getAppUpdateDiagnostics(): AppUpdateDiagnostics {
  updateDiagnosticsFromState();
  return { ...diagnosticsState };
}

/**
 * Resets service state for automated unit tests.
 */
export function resetAppUpdateServiceForTesting(): void {
  currentState = {
    hasUpdate: false,
    currentBuildId: getClientBuildId(),
    isUpdating: false,
    isDeferred: false,
  };
  diagnosticsState.currentBuildId = getClientBuildId();
  diagnosticsState.latestBuildId = null;
  diagnosticsState.latestVersion = null;
  diagnosticsState.lastCheckTimestamp = null;
  diagnosticsState.lastCheckStatus = 'idle';
  diagnosticsState.lastHttpStatus = null;
  diagnosticsState.lastContentType = null;
  diagnosticsState.visibilityCheckCount = 0;
  diagnosticsState.pollCheckCount = 0;
  diagnosticsState.serviceWorkerControlled = false;
  diagnosticsState.serviceWorkerWaiting = false;
  diagnosticsState.hasUpdate = false;
  diagnosticsState.isDeferred = false;
  diagnosticsState.dismissedBuildId = null;
  diagnosticsState.dismissedUntil = null;
  diagnosticsState.suppressionReason = 'up_to_date';
  subscribers.clear();
}

/**
 * Subscribe to update state changes.
 */
export function subscribeToAppUpdates(callback: (state: AppUpdateState) => void): () => void {
  subscribers.add(callback);
  callback({ ...currentState, isDeferred: isUpdateDeferred(currentState.latestBuildId) });

  return () => {
    subscribers.delete(callback);
  };
}

let activeInitializations = 0;
let pollingIntervalId: number | null = null;
let visibilityHandler: (() => void) | null = null;

/**
 * Initializes automatic background update checks on mount, tab visibility change, and intervals.
 * Uses reference counting so multiple component mounts (e.g. React StrictMode) do not create
 * duplicate intervals or listeners.
 */
export function initializeAppUpdateService(): () => void {
  if (typeof window === 'undefined') return () => { };

  activeInitializations++;
  if (activeInitializations === 1) {
    // Initial check
    checkForAppUpdate();

    // Periodic polling
    const setIntervalFn =
      typeof window !== 'undefined' && typeof window.setInterval === 'function'
        ? window.setInterval.bind(window)
        : setInterval;

    pollingIntervalId = setIntervalFn(() => {
      diagnosticsState.pollCheckCount++;
      checkForAppUpdate();
    }, POLLING_INTERVAL_MS) as unknown as number;

    // Check on tab focus / visibility
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        diagnosticsState.visibilityCheckCount++;
        logDevDiagnostic('Tab visibility changed to visible, checking for updates...');

        // Trigger Service Worker registration update check if supported
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
          navigator.serviceWorker
            .getRegistration()
            .then((reg) => {
              reg?.update().catch((err) => {
                logDevDiagnostic('SW reg.update() non-fatal notice:', err);
              });
            })
            .catch(() => { });
        }

        checkForAppUpdate();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    // Check on service worker updatefound
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (!reg) return;

          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;

            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version installed in background and ready
                diagnosticsState.serviceWorkerWaiting = true;
                checkForAppUpdate();
              }
            });
          });
        })
        .catch(() => { });
    }
  }

  return () => {
    activeInitializations = Math.max(0, activeInitializations - 1);
    if (activeInitializations === 0) {
      if (pollingIntervalId !== null) {
        const clearIntervalFn =
          typeof window !== 'undefined' && typeof window.clearInterval === 'function'
            ? window.clearInterval.bind(window)
            : clearInterval;
        clearIntervalFn(pollingIntervalId);
        pollingIntervalId = null;
      }
      if (visibilityHandler !== null) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
      }
    }
  };
}
