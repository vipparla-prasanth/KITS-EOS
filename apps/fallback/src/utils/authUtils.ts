import type { CoordinatorSession } from '../types';

const SESSION_KEY = 'kits_fallback_coordinator_session';

/**
 * Fallback node coordinator authentication has been deprecated for security compliance.
 * All operational coordinator authentication must derive from authoritative cryptographically
 * verified sessions on the Central Operations Portal (https://kitsakshar-eos-central.web.app).
 */

export const CENTRAL_COORDINATOR_PORTAL_URL = 'https://kitsakshar-eos-central.web.app/coordinator';

/**
 * Retrieves the stored fallback coordinator session (deprecated, returns null).
 * Clears any legacy mock session keys from browser sessionStorage.
 */
export function getStoredCoordinatorSession(): CoordinatorSession | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

/**
 * Deprecated: Storage of unverified client sessions is disabled.
 */
export function setStoredCoordinatorSession(_session: CoordinatorSession): void {
  // Deprecated: No unverified sessions stored client-side
}

/**
 * Clears coordinator session from browser storage.
 */
export function clearStoredCoordinatorSession(): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Ignore storage access errors
  }
}
