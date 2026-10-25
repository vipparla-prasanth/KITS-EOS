import { createContext, useContext, useEffect, useState, useRef } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, invokeAdminEdgeFunction } from '@kits-eos/shared';
import { 
  initSessionLifecycle, 
  startSession, 
  endSession, 
  onSessionExpired, 
  isSessionValid, 
  SessionExpiryNotice,
  isOAuthCallbackInProgress,
  triggerExpiry,
  cleanupSessionNotifications
} from '@kits-eos/shared';

export type UserRole = 'STUDENT' | 'ADMIN' | 'COORDINATOR' | 'PAYMENT_MANAGER' | null;
export type UserStatus = 'ACTIVE' | 'DEACTIVATED' | 'ANONYMIZED' | null;

export type AuthState = 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED';
export type ProfileState = 'IDLE' | 'LOADING' | 'RESOLVED' | 'ERROR';

export const ADMIN_ALLOWLIST: readonly string[] = Object.freeze([
  'prasanthv865@gmail.com',
  'hruthvikmanoj4608@gmail.com',
  'saideepak4408@gmail.com',
  'nerellabhavanilakshmi@gmail.com',
  'principal@kitsakshar.ac.in',
  'qa.admin@kitsakshar.ac.in',
  'jnvsravankumar@gmail.com'
]);

export function isEmailAllowlisted(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_ALLOWLIST.includes(email.trim().toLowerCase());
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: UserRole;
  status: UserStatus;
  isAllowlisted: boolean;
  authState: AuthState;
  profileState: ProfileState;
  isLoading: boolean;
  error: Error | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [status, setStatus] = useState<UserStatus>(null);
  const [isAllowlisted, setIsAllowlisted] = useState<boolean>(false);
  const [authState, setAuthStateRaw] = useState<AuthState>('INITIALIZING');
  const authStateRef = useRef<AuthState>('INITIALIZING');
  const setAuthState = (state: AuthState) => {
    authStateRef.current = state;
    setAuthStateRaw(state);
  };
  const [profileState, setProfileState] = useState<ProfileState>('IDLE');
  const [error, setError] = useState<Error | null>(null);

  // Sequential counter to prevent stale asynchronous profile resolutions from clobbering state
  const fetchSeqRef = useRef(0);
  const isMountedRef = useRef(true);
  const inFlightRolePromiseRef = useRef<Promise<void> | null>(null);

  // Profile and Authorization resolver
  const fetchUserRole = async (userId: string, userEmail?: string): Promise<void> => {
    // If a fetch is already in flight, reuse the promise to avoid duplicate concurrent RPC calls
    if (inFlightRolePromiseRef.current) {
      return inFlightRolePromiseRef.current;
    }

    const rolePromise = (async () => {
      const thisSeq = ++fetchSeqRef.current;
      setProfileState('LOADING');
      setError(null);

      try {
        // Pre-check: Ensure token is not expired before calling RPC
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession?.expires_at) {
          const nowSec = Math.floor(Date.now() / 1000);
          if (currentSession.expires_at <= nowSec + 10) {
            // Access token is expired or expiring; refresh before calling RPC
            const { data: refreshed } = await supabase.auth.refreshSession().catch(() => ({ data: null }));
            if (refreshed?.session) {
              setSession(refreshed.session);
            }
          }
        }

        // 1. Try secure profile RPC first (handles coordinators, admins, payment managers, and students)
        let { data: profileData, error: rpcError } = await supabase.rpc('get_current_user_profile');

        // Resilient retry on transient 401, PGRST303, clock drift, or token refresh
        if (rpcError && ((rpcError as any).status === 401 || (rpcError as any).code === 'PGRST303' || rpcError.message?.includes('JWT') || rpcError.message?.includes('expired'))) {
          console.warn('Transient profile RPC 401/PGRST303 encountered, refreshing session and retrying once...');
          const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession().catch(() => ({ data: null, error: new Error('Refresh error') }));
          if (!refreshErr && refreshed?.session) {
            setSession(refreshed.session);
            const retryRes = await supabase.rpc('get_current_user_profile');
            if (!retryRes.error && retryRes.data) {
              profileData = retryRes.data;
              rpcError = null;
            }
          }
        }

        if (!isMountedRef.current || fetchSeqRef.current !== thisSeq) {
          return;
        }

        if (!rpcError && profileData) {
          const canonicalEmail = profileData.email || userEmail || '';
          const allowlisted = isEmailAllowlisted(canonicalEmail);
          setIsAllowlisted(allowlisted);

          if (profileData.role === 'ADMIN' && !allowlisted) {
            console.warn('Admin role detected but email is not allowlisted:', canonicalEmail);
            setRole('STUDENT');
            setStatus(profileData.status as UserStatus);
          } else if (profileData.role === 'PAYMENT_MANAGER') {
            setRole('PAYMENT_MANAGER');
            setStatus(profileData.status as UserStatus);
          } else {
            setRole(profileData.role as UserRole);
            setStatus(profileData.status as UserStatus);
          }
          setProfileState('RESOLVED');
          return;
        }

        // 2. Fallback to direct query on users table
        const { data: userData, error: dbError } = await supabase
          .from('users')
          .select('role, status, email')
          .eq('id', userId)
          .maybeSingle();

        if (!isMountedRef.current || fetchSeqRef.current !== thisSeq) return;

        if (dbError) {
          console.error('Failed to retrieve user authorization data:', dbError);
          setError(new Error(dbError.message || 'Failed to retrieve authorization data'));
          setProfileState('ERROR');
          return;
        }

        if (userData) {
          if (userData.role === 'COORDINATOR') {
            setIsAllowlisted(false);
            setRole('COORDINATOR');
            setStatus(userData.status as UserStatus);
            setProfileState('RESOLVED');
          } else if (userData.role === 'PAYMENT_MANAGER') {
            setIsAllowlisted(false);
            setRole('PAYMENT_MANAGER');
            setStatus(userData.status as UserStatus);
            setProfileState('RESOLVED');
          } else {
            const canonicalEmail = userData.email || userEmail || '';
            const allowlisted = isEmailAllowlisted(canonicalEmail);
            setIsAllowlisted(allowlisted);

            if (userData.role === 'ADMIN' && !allowlisted) {
              console.warn('Admin role in DB but email is not allowlisted:', canonicalEmail);
              setRole('STUDENT');
              setStatus(userData.status as UserStatus);
            } else {
              setRole(userData.role as UserRole);
              setStatus(userData.status as UserStatus);
            }
            setProfileState('RESOLVED');
          }
        } else {
          // User not found in users table: default to STUDENT
          setRole('STUDENT');
          setStatus('ACTIVE');
          setIsAllowlisted(false);
          setProfileState('RESOLVED');
        }
      } catch (err: any) {
        if (!isMountedRef.current || fetchSeqRef.current !== thisSeq) return;
        console.error('Unexpected authorization lookup error:', err);
        setError(err instanceof Error ? err : new Error('Unexpected authorization error'));
        setProfileState('ERROR');
      } finally {
        inFlightRolePromiseRef.current = null;
      }
    })();

    inFlightRolePromiseRef.current = rolePromise;
    return rolePromise;
  };

  useEffect(() => {
    isMountedRef.current = true;

    const unsubscribeExpiry = onSessionExpired(async (reason) => {
      if (reason === 'EXPIRED') {
        try {
          await cleanupSessionNotifications({ timeoutMs: 2000 });
        } catch {
          // Non-blocking
        }
        try {
          await supabase.auth.signOut();
        } catch {
          // silent
        }
      }
      if (isMountedRef.current) {
        setSession(null);
        setUser(null);
        setRole(null);
        setStatus(null);
        setIsAllowlisted(false);
        setError(null);
        setAuthState('UNAUTHENTICATED');
        setProfileState('IDLE');
      }
    });

    const incomingHash = typeof window !== 'undefined' ? window.location.hash : '';
    const incomingSearch = typeof window !== 'undefined' ? window.location.search : '';
    const isOAuthInUrl = Boolean(
      isOAuthCallbackInProgress() ||
      incomingHash.includes('access_token=') || 
      incomingHash.includes('refresh_token=') ||
      incomingSearch.includes('code=') ||
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('kits_eos_oauth_intent') === 'admin_login')
    );

    // Safety fallback timeout: if OAuth callback remains unresolved after 10s, transition to unauthenticated
    let oauthTimeoutId: any = null;
    if (isOAuthInUrl || isOAuthCallbackInProgress()) {
      oauthTimeoutId = setTimeout(() => {
        if (!isMountedRef.current) return;
        if (authStateRef.current === 'INITIALIZING') {
          console.warn('Google OAuth callback resolution timeout reached. Falling back to unauthenticated.');
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem('kits_eos_oauth_intent');
          }
          setSession(null);
          setUser(null);
          setRole(null);
          setStatus(null);
          setIsAllowlisted(false);
          setAuthState('UNAUTHENTICATED');
          setProfileState('IDLE');
        }
      }, 10000);
    }

    async function bootstrap() {
      try {
        const sessionStatus = await initSessionLifecycle();
        if (!isMountedRef.current) return;

        // If session is genuinely expired (> 15 minutes old):
        if (sessionStatus.reason === 'EXPIRED') {
          triggerExpiry('EXPIRED');
          return;
        }

        // If OAuth callback is in-flight, do NOT clear auth or mark unauthenticated.
        // Let onAuthStateChange or getSession resolve the incoming session.
        if (sessionStatus.reason === 'OAUTH_IN_FLIGHT' || isOAuthInUrl || isOAuthCallbackInProgress()) {
          return;
        }

        // If active session marker is present and valid (< 15 min old):
        if (sessionStatus.isAuthenticated && sessionStatus.marker) {
          const { data: { session: activeSession } } = await supabase.auth.getSession();
          if (!isMountedRef.current) return;

          if (activeSession?.user && isSessionValid()) {
            setSession(activeSession);
            setUser(activeSession.user);
            setAuthState('AUTHENTICATED');
            await fetchUserRole(activeSession.user.id, activeSession.user.email);
            return;
          }
        }

        // Fresh browser opening with no active session and not in OAuth flow
        if (!isOAuthInUrl && !isOAuthCallbackInProgress()) {
          setSession(null);
          setUser(null);
          setRole(null);
          setStatus(null);
          setIsAllowlisted(false);
          setAuthState('UNAUTHENTICATED');
          setProfileState('IDLE');
        }
      } catch (err) {
        console.warn('Session bootstrap non-fatal notice:', err);
        if (!isOAuthInUrl && !isOAuthCallbackInProgress() && isMountedRef.current) {
          setAuthState('UNAUTHENTICATED');
        }
      }
    }

    bootstrap();

    // Register onAuthStateChange as the authoritative listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!isMountedRef.current) return;

      if (event === 'INITIAL_SESSION') {
        if (newSession?.user) {
          if (oauthTimeoutId) clearTimeout(oauthTimeoutId);
          // Check if a valid session marker already exists
          if (isSessionValid()) {
            setSession(newSession);
            setUser(newSession.user);
            setAuthState('AUTHENTICATED');
            await fetchUserRole(newSession.user.id, newSession.user.email);
          } else if (isOAuthInUrl || isOAuthCallbackInProgress()) {
            // New login or fresh OAuth callback establishment: start 15-minute institutional session now!
            startSession({ role: 'ADMIN' });
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.removeItem('kits_eos_oauth_intent');
            }
            setSession(newSession);
            setUser(newSession.user);
            setAuthState('AUTHENTICATED');
            await fetchUserRole(newSession.user.id, newSession.user.email);
          }
          // Note: If neither, bootstrap() will evaluate cross-tab session handshake without races
        } else {
          // newSession is null in INITIAL_SESSION
          // If OAuth callback is in progress, Supabase may be completing token exchange
          if (isOAuthInUrl || isOAuthCallbackInProgress()) {
            const { data: { session: verifiedSession } } = await supabase.auth.getSession();
            if (!isMountedRef.current) return;

            if (verifiedSession?.user) {
              if (oauthTimeoutId) clearTimeout(oauthTimeoutId);
              if (!isSessionValid()) {
                startSession({ role: 'ADMIN' });
              }
              if (typeof sessionStorage !== 'undefined') {
                sessionStorage.removeItem('kits_eos_oauth_intent');
              }
              setSession(verifiedSession);
              setUser(verifiedSession.user);
              setAuthState('AUTHENTICATED');
              await fetchUserRole(verifiedSession.user.id, verifiedSession.user.email);
              return;
            }

            // Check if URL indicates an OAuth failure/cancellation
            const hasError = incomingHash.includes('error=') || incomingSearch.includes('error=');
            if (hasError) {
              if (oauthTimeoutId) clearTimeout(oauthTimeoutId);
              if (typeof sessionStorage !== 'undefined') {
                sessionStorage.removeItem('kits_eos_oauth_intent');
              }
              setSession(null);
              setUser(null);
              setRole(null);
              setStatus(null);
              setIsAllowlisted(false);
              setAuthState('UNAUTHENTICATED');
              setProfileState('IDLE');
              return;
            }

            // In-flight OAuth token exchange has not yet completed:
            // Remain in INITIALIZING state and await the SIGNED_IN event.
            return;
          }

          setSession(null);
          setUser(null);
          setRole(null);
          setStatus(null);
          setIsAllowlisted(false);
          setAuthState('UNAUTHENTICATED');
          setProfileState('IDLE');
        }
      } else if (event === 'SIGNED_IN') {
        if (newSession?.user) {
          if (oauthTimeoutId) clearTimeout(oauthTimeoutId);
          if (!isSessionValid()) {
            startSession({ role: 'ADMIN' });
          }
          sessionStorage.removeItem('kits_eos_oauth_intent');
          setSession(newSession);
          setUser(newSession.user);
          setAuthState('AUTHENTICATED');
          await fetchUserRole(newSession.user.id, newSession.user.email);

          // Non-blocking login notification (fire and forget)
          // Uses session-scoped deduplication so page refresh / tab switch / auth state cycles never re-trigger duplicate requests
          if (newSession.access_token && isEmailAllowlisted(newSession.user.email)) {
            const notifiedKey = `kits_eos_login_notified_${newSession.user.id}_${newSession.access_token.slice(-16)}`;
            if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(notifiedKey)) {
              sessionStorage.setItem(notifiedKey, 'in_flight');
              invokeAdminEdgeFunction('admin-login-notification').then((res) => {
                if (res.error) {
                  sessionStorage.removeItem(notifiedKey);
                  console.warn('Login notification notice:', res.error);
                } else {
                  sessionStorage.setItem(notifiedKey, 'notified');
                }
              }).catch(err => {
                sessionStorage.removeItem(notifiedKey);
                console.warn('Login notification notice (non-blocking):', err);
              });
            }
          }
        }
      } else if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (newSession?.user && isSessionValid()) {
          setSession(newSession);
          setUser(newSession.user);
          setAuthState('AUTHENTICATED');
          if (profileState === 'ERROR' || profileState === 'IDLE') {
            await fetchUserRole(newSession.user.id, newSession.user.email);
          }
        }
      } else if (event === 'SIGNED_OUT') {
        if (oauthTimeoutId) clearTimeout(oauthTimeoutId);
        setSession(null);
        setUser(null);
        setRole(null);
        setStatus(null);
        setIsAllowlisted(false);
        setError(null);
        setAuthState('UNAUTHENTICATED');
        setProfileState('IDLE');
      }
    });

    return () => {
      isMountedRef.current = false;
      if (oauthTimeoutId) clearTimeout(oauthTimeoutId);
      unsubscribeExpiry();
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    setAuthState('INITIALIZING');
    try {
      await cleanupSessionNotifications({ timeoutMs: 2000 });
    } catch {
      // Non-blocking: cleanup failure never hangs logout
    }
    endSession();
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Supabase signOut non-fatal notice:', err);
    } finally {
      setSession(null);
      setUser(null);
      setRole(null);
      setStatus(null);
      setIsAllowlisted(false);
      setError(null);
      setAuthState('UNAUTHENTICATED');
      setProfileState('IDLE');
    }
  };

  // isLoading is true while either authentication or profile authorization is in-flight
  const isLoading = authState === 'INITIALIZING' || profileState === 'LOADING' || (authState === 'AUTHENTICATED' && profileState === 'IDLE');

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        role,
        status,
        isAllowlisted,
        authState,
        profileState,
        isLoading,
        error,
        signOut,
      }}
    >
      <SessionExpiryNotice />
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
