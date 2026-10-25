/**
 * Coordinator Session Management Utility
 *
 * Security Requirements:
 * - Treats coordinator session token as a credential, never ordinary application data.
 * - Never logs, audit-logs, displays, or persists raw token beyond sessionStorage.
 * - Sends token through Authorization (Bearer) and x-coordinator-token headers.
 * - Completely independent of Supabase Auth / Google OAuth session.
 */

export interface StoredCoordinatorProfile {
  id: string;
  username: string;
  display_name: string;
  coordinator_type?: string;
  status: string;
  phone_number?: string;
  assigned_assessment?: any;
  assigned_assessments?: any[];
}

export interface StoredCoordinatorSession {
  session_token: string;
  coordinator: StoredCoordinatorProfile;
  access_state: 'AUTHORIZED' | 'NO_ASSIGNMENTS' | 'INACTIVE_OR_SUSPENDED' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'ERROR';
  expires_at: string;
  assignments?: any[];
  assigned_assessment?: any;
  assigned_assessments?: any[];
  active_assignments_count?: number;
  active_assessment_count?: number;
  state_detail?: string;
}

import { 
  COORDINATOR_SESSION_KEY, 
  isSessionValid, 
  startSession, 
  endSession,
  cleanupSessionNotifications
} from '@kits-eos/shared';
import { supabase } from '@kits-eos/shared/src/api/client';

const STORAGE_KEY = COORDINATOR_SESSION_KEY;

/**
 * Retrieves the stored coordinator session from sessionStorage.
 * Returns null if absent, malformed, or if session age >= 15 minutes.
 */
export function getCoordinatorSession(): StoredCoordinatorSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    if (!isSessionValid()) {
      clearCoordinatorSession();
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed?.session_token || typeof parsed.session_token !== 'string') {
      return null;
    }
    return parsed as StoredCoordinatorSession;
  } catch {
    return null;
  }
}

/**
 * Retrieves the raw coordinator session token strictly for API communication.
 * NEVER log or serialize the returned string.
 */
export function getCoordinatorSessionToken(): string | null {
  return getCoordinatorSession()?.session_token || null;
}

/**
 * Persists the validated coordinator session to sessionStorage
 * and registers the absolute 15-minute session lifetime.
 */
export function setCoordinatorSession(session: StoredCoordinatorSession): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    const role = session.coordinator?.coordinator_type === 'PAYMENT_MANAGER' ? 'PAYMENT_MANAGER' : 'COORDINATOR';
    startSession({ role, coordSession: session });
  } catch {
    // Storage quota or restriction failure handled silently
  }
}

/**
 * Clears coordinator session from browser storage and ends the active session.
 */
export function clearCoordinatorSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    endSession();
  } catch {
    // ignore
  }
}

/**
 * Fully signs out coordinator:
 * 1. Invalidates session in database via invalidate_coordinator_session RPC
 * 2. Clears client session storage & ends session
 * 3. Navigates cleanly to root login
 */
export async function signOutCoordinator(navigate?: (to: string, options?: any) => void): Promise<void> {
  const token = getCoordinatorSessionToken();
  if (token) {
    try {
      await cleanupSessionNotifications({ token, timeoutMs: 2000 });
    } catch {
      // Non-blocking: cleanup failure never hangs logout
    }
    try {
      await supabase.rpc('invalidate_coordinator_session', { p_token: token });
    } catch {
      // ignore
    }
  }
  clearCoordinatorSession();
  if (navigate) {
    navigate('/', { replace: true });
  } else {
    window.location.replace('/');
  }
}

/**
 * Constructs authoritative headers for Edge Function calls.
 * Sends token via both 'x-coordinator-token' and 'Authorization: Bearer <token>'.
 */
export function getCoordinatorAuthHeaders(): Record<string, string> {
  const token = getCoordinatorSessionToken();
  if (!token) return {};
  return {
    'x-coordinator-token': token,
    'Authorization': `Bearer ${token}`
  };
}
