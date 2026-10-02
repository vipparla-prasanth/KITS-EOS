/**
 * KITS-EOS Unified 1-Hour Session Lifecycle & Browser-Close Management
 * 
 * Strict Security Guarantees:
 * 1. Absolute 1-Hour Lifetime: Session strictly expires 60 minutes from initial login.
 *    User activity (clicks, keys, navigation, API calls) does NOT reset or extend the timer.
 * 2. Browser-Close Protection: Distinguishes normal page refresh from closing the browser/tab.
 *    Closing all tabs / browser terminates the session; reopening requires authenticating again.
 * 3. Multi-Tab Synchronization: Robust 350ms BroadcastChannel handshake. New tabs inherit the
 *    original sessionStartedAt timestamp and expire at the exact same deadline.
 * 4. Targeted Cleanup: Explicitly removes only KITS-EOS authentication keys.
 *    NEVER calls localStorage.clear() or sessionStorage.clear().
 * 5. bfcache & Background Tab Defense: Synchronously revalidates on visibilitychange, focus, and pageshow.
 */

export const MAX_SESSION_LIFETIME_MS = 60 * 60 * 1000; // 60 minutes / 1 hour (3,600,000 ms)
export const WARNING_BEFORE_EXPIRY_MS = 30 * 1000;     // 30 seconds before expiry
export const HANDSHAKE_TIMEOUT_MS = 350;               // 350ms handshake window for cross-tab sync

// Explicit, targeted storage keys (NEVER clear unrelated preferences)
export const SESSION_MARKER_KEY = 'kits_eos_session_marker';
export const SUPABASE_AUTH_STORAGE_KEY = 'kits_eos_auth_token';
export const COORDINATOR_SESSION_KEY = 'kits_coordinator_session';
export const SESSION_EXPIRED_NOTICE_KEY = 'kits_session_expired_notice';
export const OAUTH_INTENT_KEY = 'kits_eos_oauth_intent';

export type PortalRole = 'STUDENT' | 'ADMIN' | 'COORDINATOR' | 'PAYMENT_MANAGER';

export interface SessionMarker {
  sessionId: string;
  sessionStartedAt: number; // Epoch ms of original successful authentication
  role: PortalRole;
  coordSession?: any;       // Serialized coordinator session if applicable
}

export interface SessionSyncMessage {
  type: 'PING_ACTIVE_SESSION' | 'PONG_ACTIVE_SESSION' | 'SESSION_LOGIN' | 'SESSION_LOGOUT' | 'SESSION_EXPIRED';
  marker?: SessionMarker;
  remainingMs?: number;
  isValid?: boolean;
  timestamp?: number;
}

// In-memory state for current tab
let activeMarker: SessionMarker | null = null;
let warningTimerId: any = null;
let expiryTimerId: any = null;
let syncChannel: BroadcastChannel | null = null;
let isInitialized = false;

// Synchronously capture window URL parameters at module evaluation time
// GoTrueClient clears window.location.hash asynchronously, so we must capture tokens early.
const initialHash = typeof window !== 'undefined' ? (window.location.hash || '') : '';
const initialSearch = typeof window !== 'undefined' ? (window.location.search || '') : '';
const initialHasOAuthTokens = Boolean(
  initialHash.includes('access_token=') ||
  initialHash.includes('refresh_token=') ||
  initialSearch.includes('code=') ||
  initialHash.includes('error=') ||
  initialSearch.includes('error=')
);

type ExpiryCallback = (reason: 'EXPIRED' | 'LOGOUT' | 'BROWSER_CLOSE') => void;
type WarningCallback = (isWarning: boolean, remainingMs: number) => void;

const expiryListeners = new Set<ExpiryCallback>();
const warningListeners = new Set<WarningCallback>();

/**
 * Deterministically checks whether the current URL or storage indicates
 * an in-flight Google OAuth callback for Administrator authentication.
 */
export function isOAuthCallbackInProgress(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const hasHashTokens = hash.includes('access_token=') || hash.includes('refresh_token=');
    const hasCodeParam = search.includes('code=');
    const hasError = hash.includes('error=') || search.includes('error=');
    const hasOAuthIntent = sessionStorage.getItem(OAUTH_INTENT_KEY) === 'admin_login';
    return initialHasOAuthTokens || hasHashTokens || hasCodeParam || hasError || hasOAuthIntent;
  } catch {
    return false;
  }
}

/**
 * Targeted cleanup of explicitly identified KITS-EOS authentication keys.
 * Preserves user preferences, themes, and cookie consent (kits_eos_cookie_consent_v1).
 */
export function clearExplicitAuthStorage(): void {
  if (typeof window === 'undefined') return;

  try {
    // 1. Clear session markers from sessionStorage
    sessionStorage.removeItem(SESSION_MARKER_KEY);
    sessionStorage.removeItem(COORDINATOR_SESSION_KEY);
    sessionStorage.removeItem(OAUTH_INTENT_KEY);

    // 2. Clear known Supabase auth token key from localStorage
    localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);

    // 3. Clean any legacy Supabase project auth keys (sb-*-auth-token)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
        localStorage.removeItem(key);
      }
    }
  } catch (err) {
    console.warn('Non-fatal notice during targeted storage cleanup:', err);
  }
}

/**
 * Synchronously checks if a session is currently valid (< 1 hour old).
 */
export function isSessionValid(): boolean {
  const marker = getSessionMarker();
  if (!marker) return false;

  const age = Date.now() - marker.sessionStartedAt;
  return age >= 0 && age < MAX_SESSION_LIFETIME_MS;
}

/**
 * Returns remaining lifetime of current session in milliseconds, or 0 if invalid.
 */
export function getSessionRemainingMs(): number {
  const marker = getSessionMarker();
  if (!marker) return 0;

  const remaining = MAX_SESSION_LIFETIME_MS - (Date.now() - marker.sessionStartedAt);
  return Math.max(0, remaining);
}

/**
 * Returns the current session marker from memory or sessionStorage.
 */
export function getSessionMarker(): SessionMarker | null {
  if (activeMarker) return activeMarker;

  if (typeof window === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(SESSION_MARKER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionMarker;
    if (parsed && typeof parsed.sessionStartedAt === 'number' && parsed.sessionId) {
      activeMarker = parsed;
      return parsed;
    }
  } catch {
    // Malformed marker handled gracefully
  }
  return null;
}

/**
 * Sets an expired session notification message in sessionStorage
 * so the destination login page can render it immediately.
 */
export function setSessionExpiredNotice(message: string = 'Your session has expired. Please sign in again.'): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_EXPIRED_NOTICE_KEY, message);
  } catch {
    // Storage quota handled silently
  }
}

/**
 * Consumes (reads and deletes) the expired notice message if present.
 */
export function consumeSessionExpiredNotice(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const message = sessionStorage.getItem(SESSION_EXPIRED_NOTICE_KEY);
    if (message) {
      sessionStorage.removeItem(SESSION_EXPIRED_NOTICE_KEY);
      return message;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Arm internal setTimeout timers for 30s warning and 1h absolute expiry.
 */
function armTimers(sessionStartedAt: number) {
  clearTimers();

  const now = Date.now();
  const warningAt = sessionStartedAt + (MAX_SESSION_LIFETIME_MS - WARNING_BEFORE_EXPIRY_MS);
  const expiryAt = sessionStartedAt + MAX_SESSION_LIFETIME_MS;

  const msToWarning = warningAt - now;
  const msToExpiry = expiryAt - now;

  if (msToExpiry <= 0) {
    // Already expired
    triggerExpiry('EXPIRED');
    return;
  }

  // Warning timer (fires at 59m 30s)
  if (msToWarning <= 0) {
    notifyWarning(true, msToExpiry);
  } else {
    warningTimerId = setTimeout(() => {
      const remaining = getSessionRemainingMs();
      if (remaining > 0 && remaining <= WARNING_BEFORE_EXPIRY_MS) {
        notifyWarning(true, remaining);
      }
    }, msToWarning);
  }

  // Absolute expiry timer (fires at 60m 00s)
  expiryTimerId = setTimeout(() => {
    triggerExpiry('EXPIRED');
  }, msToExpiry);
}

function clearTimers() {
  if (warningTimerId) {
    clearTimeout(warningTimerId);
    warningTimerId = null;
  }
  if (expiryTimerId) {
    clearTimeout(expiryTimerId);
    expiryTimerId = null;
  }
}

function notifyWarning(isWarning: boolean, remainingMs: number) {
  warningListeners.forEach((fn) => {
    try {
      fn(isWarning, remainingMs);
    } catch (err) {
      console.warn('Warning listener error:', err);
    }
  });
}

function notifyExpiry(reason: 'EXPIRED' | 'LOGOUT' | 'BROWSER_CLOSE') {
  expiryListeners.forEach((fn) => {
    try {
      fn(reason);
    } catch (err) {
      console.warn('Expiry listener error:', err);
    }
  });
}

/**
 * Triggers session termination across the application.
 */
export function triggerExpiry(reason: 'EXPIRED' | 'LOGOUT' | 'BROWSER_CLOSE') {
  clearTimers();
  notifyWarning(false, 0);

  if (reason === 'EXPIRED') {
    setSessionExpiredNotice();
  }

  // Broadcast to other tabs
  if (syncChannel) {
    try {
      syncChannel.postMessage({
        type: reason === 'LOGOUT' ? 'SESSION_LOGOUT' : 'SESSION_EXPIRED',
        timestamp: Date.now(),
      } as SessionSyncMessage);
    } catch {
      // ignore
    }
  }

  activeMarker = null;
  clearExplicitAuthStorage();
  notifyExpiry(reason);
}

/**
 * Starts a new authenticated session at the moment of successful login.
 * Records sessionStartedAt = Date.now().
 */
export function startSession(params: {
  role: PortalRole;
  coordSession?: any;
}): SessionMarker {
  const marker: SessionMarker = {
    sessionId: 'ksess_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36),
    sessionStartedAt: Date.now(),
    role: params.role,
    coordSession: params.coordSession,
  };

  activeMarker = marker;

  try {
    sessionStorage.setItem(SESSION_MARKER_KEY, JSON.stringify(marker));
  } catch {
    // ignore
  }

  // Arm absolute timers
  armTimers(marker.sessionStartedAt);

  // Broadcast login to any sibling tabs
  if (syncChannel) {
    try {
      syncChannel.postMessage({
        type: 'SESSION_LOGIN',
        marker,
        timestamp: Date.now(),
      } as SessionSyncMessage);
    } catch {
      // ignore
    }
  }

  return marker;
}

/**
 * Manually logs out the current session and notifies all tabs.
 */
export function endSession(): void {
  triggerExpiry('LOGOUT');
}

/**
 * Cross-tab handshake listener setup.
 */
function setupBroadcastChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

  if (!syncChannel) {
    try {
      syncChannel = new BroadcastChannel('kits_eos_session_sync');

      syncChannel.onmessage = (event: MessageEvent<SessionSyncMessage>) => {
        const msg = event.data;
        if (!msg || !msg.type) return;

        if (msg.type === 'PING_ACTIVE_SESSION') {
          // If this tab has a valid active session, reply with PONG containing the ORIGINAL sessionStartedAt
          const currentMarker = getSessionMarker();
          if (currentMarker && isSessionValid()) {
            syncChannel?.postMessage({
              type: 'PONG_ACTIVE_SESSION',
              marker: currentMarker,
              remainingMs: getSessionRemainingMs(),
              isValid: true,
              timestamp: Date.now(),
            } as SessionSyncMessage);
          }
        } else if (msg.type === 'SESSION_LOGIN' && msg.marker) {
          // Sibling tab logged in: inherit that valid session
          if (Date.now() - msg.marker.sessionStartedAt < MAX_SESSION_LIFETIME_MS) {
            activeMarker = msg.marker;
            try {
              sessionStorage.setItem(SESSION_MARKER_KEY, JSON.stringify(msg.marker));
              if (msg.marker.coordSession) {
                sessionStorage.setItem(COORDINATOR_SESSION_KEY, JSON.stringify(msg.marker.coordSession));
              }
            } catch {
              // ignore
            }
            armTimers(msg.marker.sessionStartedAt);
          }
        } else if (msg.type === 'SESSION_LOGOUT') {
          clearTimers();
          activeMarker = null;
          clearExplicitAuthStorage();
          notifyWarning(false, 0);
          notifyExpiry('LOGOUT');
        } else if (msg.type === 'SESSION_EXPIRED') {
          clearTimers();
          activeMarker = null;
          setSessionExpiredNotice();
          clearExplicitAuthStorage();
          notifyWarning(false, 0);
          notifyExpiry('EXPIRED');
        }
      };
    } catch (err) {
      console.warn('BroadcastChannel initialization note:', err);
    }
  }
}

/**
 * Defense against Back/Forward cache (bfcache) and background tab throttling.
 * Synchronously checks session age whenever tab wakes up or regains focus.
 */
function setupLifecycleEventListeners() {
  if (typeof window === 'undefined') return;

  const checkLiveness = () => {
    const marker = getSessionMarker();
    if (marker) {
      const age = Date.now() - marker.sessionStartedAt;
      if (age >= MAX_SESSION_LIFETIME_MS) {
        triggerExpiry('EXPIRED');
      } else {
        const remaining = MAX_SESSION_LIFETIME_MS - age;
        if (remaining <= WARNING_BEFORE_EXPIRY_MS) {
          notifyWarning(true, remaining);
        } else {
          notifyWarning(false, remaining);
        }
      }
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkLiveness();
    }
  });

  window.addEventListener('focus', checkLiveness);

  window.addEventListener('pageshow', () => {
    // If restored from bfcache or back navigation, synchronously revalidate
    checkLiveness();
  });
}

/**
 * Bootstraps session lifecycle at application startup.
 * 
 * Rules:
 * 1. If in-flight Google OAuth callback -> preserve state so OAuth completes.
 * 2. If valid session marker in sessionStorage (e.g. page refresh) -> arm timers and keep session.
 * 3. If marker in sessionStorage is >= 1h old -> clear storage and trigger expired.
 * 4. If marker is absent in sessionStorage (e.g. new tab or browser reopen):
 *    Conduct a deterministic 350ms BroadcastChannel handshake.
 *    - If another active tab responds, inherit the ORIGINAL sessionStartedAt.
 *    - If no tab responds within 350ms, conclude browser was closed/reopened.
 *      Cleanly clear persisted auth state and return unauthenticated.
 */
export async function initSessionLifecycle(): Promise<{
  isAuthenticated: boolean;
  marker: SessionMarker | null;
  reason?: 'VALID' | 'EXPIRED' | 'NO_ACTIVE_BROWSER_SESSION' | 'OAUTH_IN_FLIGHT';
}> {
  if (typeof window === 'undefined') {
    return { isAuthenticated: false, marker: null };
  }

  setupBroadcastChannel();

  if (!isInitialized) {
    setupLifecycleEventListeners();
    isInitialized = true;
  }

  // 1. Google OAuth callback in flight: allow OAuth flow to finish and start session
  if (isOAuthCallbackInProgress()) {
    return { isAuthenticated: false, marker: null, reason: 'OAUTH_IN_FLIGHT' };
  }

  // 2. Check local sessionStorage marker (covers page refresh in same tab)
  const existingMarker = getSessionMarker();
  if (existingMarker) {
    const age = Date.now() - existingMarker.sessionStartedAt;
    if (age < MAX_SESSION_LIFETIME_MS) {
      // Valid session (< 1h): continue with remaining time
      armTimers(existingMarker.sessionStartedAt);
      return { isAuthenticated: true, marker: existingMarker, reason: 'VALID' };
    } else {
      // Expired in storage (>= 1h): clear and require login
      triggerExpiry('EXPIRED');
      return { isAuthenticated: false, marker: null, reason: 'EXPIRED' };
    }
  }

  // 3. Marker absent in sessionStorage: ping other tabs via BroadcastChannel (350ms window)
  if (typeof BroadcastChannel !== 'undefined') {
    const inheritedMarker = await new Promise<SessionMarker | null>((resolve) => {
      let resolved = false;
      let channel: BroadcastChannel | null = null;
      let timer: any = null;

      try {
        channel = new BroadcastChannel('kits_eos_session_sync');
        channel.onmessage = (e: MessageEvent<SessionSyncMessage>) => {
          if (e.data?.type === 'PONG_ACTIVE_SESSION' && e.data.marker) {
            const m = e.data.marker;
            const age = Date.now() - m.sessionStartedAt;
            if (age >= 0 && age < MAX_SESSION_LIFETIME_MS) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                channel?.close();
                resolve(m);
              }
            }
          }
        };

        // Query active tabs
        channel.postMessage({ type: 'PING_ACTIVE_SESSION', timestamp: Date.now() } as SessionSyncMessage);

        // Robust handshake window: exactly 350ms
        timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            channel?.close();
            resolve(null);
          }
        }, HANDSHAKE_TIMEOUT_MS);
      } catch {
        resolve(null);
      }
    });

    if (inheritedMarker) {
      // Inherit the ORIGINAL sessionStartedAt (do NOT create a new 1h session!)
      activeMarker = inheritedMarker;
      try {
        sessionStorage.setItem(SESSION_MARKER_KEY, JSON.stringify(inheritedMarker));
        if (inheritedMarker.coordSession) {
          sessionStorage.setItem(COORDINATOR_SESSION_KEY, JSON.stringify(inheritedMarker.coordSession));
        }
      } catch {
        // ignore
      }
      armTimers(inheritedMarker.sessionStartedAt);
      return { isAuthenticated: true, marker: inheritedMarker, reason: 'VALID' };
    }
  }

  // 4. No active tab responded within 350ms: browser was closed or fresh navigation
  // Targeted cleanup of persisted credentials to prevent silent session restoration
  // CRITICAL: Do NOT clear auth storage if an OAuth callback was detected or is in flight!
  if (!isOAuthCallbackInProgress()) {
    clearExplicitAuthStorage();
  }
  activeMarker = null;
  return { isAuthenticated: false, marker: null, reason: isOAuthCallbackInProgress() ? 'OAUTH_IN_FLIGHT' : 'NO_ACTIVE_BROWSER_SESSION' };
}

/**
 * Register listener for session expiry.
 */
export function onSessionExpired(callback: ExpiryCallback): () => void {
  expiryListeners.add(callback);
  return () => {
    expiryListeners.delete(callback);
  };
}

/**
 * Register listener for pre-expiry warning (at 59m 30s).
 */
export function onSessionWarning(callback: WarningCallback): () => void {
  warningListeners.add(callback);
  return () => {
    warningListeners.delete(callback);
  };
}
