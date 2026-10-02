import type { CoordinatorSession } from '../types';

const SESSION_KEY = 'kits_fallback_coordinator_session';

// Cryptographic hash constants (SHA-256) for fallback coordinator access
const EXPECTED_USER_HASH = 'ca0307e0da59a574b8d3f40af73a9661705522e9315b76686353243daf8627cc';
const EXPECTED_PASS_HASH = 'bc8f1d3283618cd4bda91146bf37279c91159c531b15baf36789179fd3a800ab';

/**
 * Computes SHA-256 hexadecimal hash using standard Web Crypto API.
 */
async function computeSha256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validates coordinator credentials securely without plain text exposure.
 */
export async function validateCoordinatorCredentials(username: string, password: string): Promise<boolean> {
  if (!username || !password) return false;

  try {
    const userHash = await computeSha256(username);
    const passHash = await computeSha256(password);

    return userHash === EXPECTED_USER_HASH && passHash === EXPECTED_PASS_HASH;
  } catch (err) {
    console.error('Error in authentication validation:', err);
    return false;
  }
}

/**
 * Retrieves the stored fallback coordinator session from sessionStorage.
 */
export function getStoredCoordinatorSession(): CoordinatorSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CoordinatorSession;
    if (!parsed || !parsed.isAuthenticated) return null;

    // Check expiry (60 minutes / 1 hour duration)
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now()) {
      clearStoredCoordinatorSession();
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Saves authenticated coordinator session to sessionStorage.
 */
export function setStoredCoordinatorSession(session: CoordinatorSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

/**
 * Clears coordinator session from browser storage.
 */
export function clearStoredCoordinatorSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
