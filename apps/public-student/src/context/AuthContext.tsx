import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { 
  initSessionLifecycle, 
  startSession, 
  endSession, 
  triggerExpiry,
  onSessionExpired, 
  isSessionValid, 
  SessionExpiryNotice 
} from '@kits-eos/shared';
import type { User as SupabaseUser, Session } from '@supabase/supabase-js';

export interface StudentProfile {
  user_id: string;
  full_name: string;
  roll_number: string;
  college: string;
  department: string;
  other_department?: string | null;
  year_of_study: number;
  phone: string;
  name_change_used?: boolean;
  privacy_notice_version?: string | null;
  privacy_acknowledged_at?: string | null;
}

export interface DeactivatedAccountInfo {
  user_id: string;
  email: string;
  status: string;
  deactivated_at: string | null;
  scheduled_permanent_deletion_at: string | null;
  is_expired: boolean;
  days_remaining: number;
}

export interface SuspendedAccountInfo {
  user_id: string;
  email: string;
  account_status: 'SUSPENDED';
  suspension_reason: string;
  suspended_at: string | null;
  full_name?: string;
  roll_number?: string;
  pending_request?: {
    id: string;
    request_message: string;
    status: 'PENDING';
    created_at: string;
  } | null;
  latest_request?: {
    id: string;
    request_message: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    admin_response?: string | null;
    created_at: string;
    reviewed_at?: string | null;
  } | null;
}

interface AuthContextType {
  user: SupabaseUser | null;
  session: Session | null;
  profile: StudentProfile | null;
  deactivatedInfo: DeactivatedAccountInfo | null;
  suspendedInfo: SuspendedAccountInfo | null;
  isLoading: boolean;
  signIn: (email: string, pass: string) => Promise<{ error: Error | null; deactivated?: boolean; suspended?: boolean }>;
  signUp: (email: string, pass: string, profileData: Omit<StudentProfile, 'user_id'>) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearDeactivatedInfo: () => void;
  clearSuspendedInfo: () => void;
  reactivateAccount: (email: string) => Promise<{ error: Error | null }>;
  submitUnsuspensionRequest: (message: string) => Promise<{ success: boolean; message?: string; error?: Error | null }>;
  refreshAccountStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [deactivatedInfo, setDeactivatedInfo] = useState<DeactivatedAccountInfo | null>(null);
  const [suspendedInfo, setSuspendedInfo] = useState<SuspendedAccountInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isMountedRef = useRef(true);

  const checkAccountStatus = async (currentUser: SupabaseUser | null) => {
    if (!currentUser) {
      setDeactivatedInfo(null);
      setSuspendedInfo(null);
      return { deactivated: false, suspended: false };
    }

    try {
      let { data, error } = await supabase.rpc('get_student_account_status');

      if (error && ((error as any).status === 401 || (error as any).code === 'PGRST303' || error.message?.includes('JWT') || error.message?.includes('expired'))) {
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession().catch(() => ({ data: null, error: new Error('Refresh error') }));
        if (!refreshErr && refreshed?.session) {
          const retryRes = await supabase.rpc('get_student_account_status');
          if (!retryRes.error && retryRes.data) {
            data = retryRes.data;
            error = null;
          }
        }
      }

      if (!error && data) {
        if (data.status === 'DEACTIVATED') {
          const info = data as DeactivatedAccountInfo;
          if (info.is_expired) {
            await supabase.auth.signOut();
            setUser(null);
            setSession(null);
            setProfile(null);
            setDeactivatedInfo(null);
            setSuspendedInfo(null);
            return {
              deactivated: true,
              expired: true,
              suspended: false,
              error: new Error('Your account deactivation recovery period (15 days) has expired. This account is permanently scheduled for deletion.')
            };
          }

          setDeactivatedInfo(info);
          setSuspendedInfo(null);
          return { deactivated: true, expired: false, suspended: false, info };
        }

        if (data.account_status === 'SUSPENDED') {
          const sInfo: SuspendedAccountInfo = {
            user_id: currentUser.id,
            email: currentUser.email || '',
            account_status: 'SUSPENDED',
            suspension_reason: data.suspension_reason || 'Your account has been suspended due to violations of platform rules.',
            suspended_at: data.suspended_at || null,
            full_name: data.full_name || '',
            roll_number: data.roll_number || '',
            pending_request: data.pending_request || null,
            latest_request: data.latest_request || null,
          };
          setSuspendedInfo(sInfo);
          setDeactivatedInfo(null);
          return { deactivated: false, suspended: true, info: sInfo };
        }
      }
      setDeactivatedInfo(null);
      setSuspendedInfo(null);
      return { deactivated: false, suspended: false };
    } catch (e) {
      console.error('Failed to check student account status:', e);
      return { deactivated: false, suspended: false };
    }
  };

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('student_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data) {
        setProfile(data as StudentProfile);
      } else {
        setProfile(null);
      }
    } catch (e) {
      console.error('Failed to fetch student profile:', e);
      setProfile(null);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    const unsubscribeExpiry = onSessionExpired(async (reason) => {
      if (reason === 'EXPIRED') {
        try {
          await supabase.auth.signOut();
        } catch {
          // silent
        }
        if (isMountedRef.current) {
          setUser(null);
          setSession(null);
          setProfile(null);
          setDeactivatedInfo(null);
          setSuspendedInfo(null);
        }
      } else if (reason === 'LOGOUT') {
        if (isMountedRef.current) {
          setUser(null);
          setSession(null);
          setProfile(null);
          setDeactivatedInfo(null);
          setSuspendedInfo(null);
        }
      }
    });

    // 1. Authoritative onAuthStateChange listener registered for the lifetime of AuthProvider
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!isMountedRef.current) return;

      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setProfile(null);
        setDeactivatedInfo(null);
        setSuspendedInfo(null);
        setIsLoading(false);
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        if (newSession?.user && isSessionValid()) {
          setSession(newSession);
          setUser(newSession.user);
        }
        setIsLoading(false);
        return;
      }

      if (event === 'SIGNED_IN') {
        if (newSession?.user) {
          if (!isSessionValid()) {
            startSession({ role: 'STUDENT' });
          }
          setSession(newSession);
          setUser(newSession.user);
          await Promise.all([
            checkAccountStatus(newSession.user),
            fetchProfile(newSession.user.id)
          ]);
        }
        setIsLoading(false);
        return;
      }

      if (event === 'INITIAL_SESSION') {
        if (newSession?.user && isSessionValid()) {
          setSession(newSession);
          setUser(newSession.user);
          await Promise.all([
            checkAccountStatus(newSession.user),
            fetchProfile(newSession.user.id)
          ]);
        }
        setIsLoading(false);
        return;
      }
    });

    // 2. Initial session bootstrap
    async function bootstrap() {
      try {
        const sessionStatus = await initSessionLifecycle();
        if (!isMountedRef.current) return;

        if (sessionStatus.reason === 'EXPIRED') {
          triggerExpiry('EXPIRED');
          return;
        }

        if (sessionStatus.isAuthenticated && sessionStatus.marker) {
          const { data: { session: currentSession } } = await supabase.auth.getSession();
          if (!isMountedRef.current) return;

          if (currentSession?.user && isSessionValid()) {
            setSession(currentSession);
            setUser(currentSession.user);
            const statusCheck = await checkAccountStatus(currentSession.user);
            if (!statusCheck.deactivated) {
              await fetchProfile(currentSession.user.id);
            }
            setIsLoading(false);
            return;
          }
        }

        // Clean unauthenticated startup
        setUser(null);
        setSession(null);
        setProfile(null);
        setDeactivatedInfo(null);
        setSuspendedInfo(null);
        setIsLoading(false);
      } catch (err) {
        console.warn('Student auth bootstrap notice:', err);
        if (isMountedRef.current) {
          setUser(null);
          setSession(null);
          setIsLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      isMountedRef.current = false;
      unsubscribeExpiry();
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, pass: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: pass,
      });
      if (error) return { error };
      if (data.user && data.session) {
        const statusCheck = await checkAccountStatus(data.user);
        if (statusCheck.error) {
          return { error: statusCheck.error };
        }
        if (statusCheck.deactivated) {
          return { error: null, deactivated: true };
        }
        if (statusCheck.suspended) {
          return { error: null, suspended: true };
        }
        startSession({ role: 'STUDENT' });
        setSession(data.session);
        setUser(data.user);
        await fetchProfile(data.user.id);
      }
      return { error: null };
    } catch (err: any) {
      return { error: err };
    }
  };

  const reactivateAccount = async (email: string) => {
    try {
      const { data, error } = await supabase.rpc('student_reactivate_account', {
        p_email: email.trim()
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.message || 'Failed to reactivate account.');
      }

      setDeactivatedInfo(null);
      if (user) {
        await fetchProfile(user.id);
      }
      return { error: null };
    } catch (err: any) {
      return { error: err };
    }
  };

  const clearDeactivatedInfo = () => {
    setDeactivatedInfo(null);
  };

  const clearSuspendedInfo = () => {
    setSuspendedInfo(null);
  };

  const submitUnsuspensionRequest = async (message: string) => {
    try {
      const { data, error } = await supabase.rpc('student_submit_unsuspension_request', {
        p_message: message.trim()
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.message || 'Failed to submit unsuspension request.');
      }

      if (user) {
        await checkAccountStatus(user);
      }
      return { success: true, message: data?.message };
    } catch (err: any) {
      return { success: false, error: err };
    }
  };

  const refreshAccountStatus = async () => {
    if (user) {
      await checkAccountStatus(user);
    }
  };

  const signUp = async (email: string, pass: string, profileData: Omit<StudentProfile, 'user_id'>) => {
    try {
      const cleanEmail = email.trim().toLowerCase();
      
      // 1. Atomically create student account and profile via student-signup Edge Function
      const { data, error } = await supabase.functions.invoke('student-signup', {
        body: {
          email: cleanEmail,
          password: pass,
          full_name: profileData.full_name.trim(),
          roll_number: profileData.roll_number.trim().toUpperCase(),
          college: profileData.college.trim(),
          department: profileData.department.trim(),
          other_department: profileData.department === 'OTHER' ? profileData.other_department?.trim() || null : null,
          year_of_study: profileData.year_of_study,
          phone: profileData.phone.trim(),
          privacy_acknowledged: Boolean(profileData.privacy_acknowledged_at || (profileData as any).privacy_acknowledged),
          privacy_notice_version: profileData.privacy_notice_version || '1.0',
        }
      });

      if (error) {
        let message = 'Failed to create student account';
        if (error.context && typeof error.context.json === 'function') {
          try {
            const body = await error.context.json();
            if (body?.error?.message) message = body.error.message;
          } catch {
            // fallback
          }
        } else if (error instanceof Error) {
          message = error.message;
        }
        return { error: new Error(message) };
      }

      if (!data?.success) {
        return { error: new Error(data?.error?.message || 'Failed to create student account') };
      }

      // 2. Sign in to establish active authenticated session
      const signInResult = await signIn(cleanEmail, pass);
      if (signInResult.error) {
        return { error: signInResult.error };
      }

      return { error: null };
    } catch (err: any) {
      return { error: err };
    }
  };

  const signOut = async () => {
    endSession();
    try {
      await supabase.auth.signOut();
    } catch {
      // silent
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setDeactivatedInfo(null);
    setSuspendedInfo(null);
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        deactivatedInfo,
        suspendedInfo,
        isLoading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
        clearDeactivatedInfo,
        clearSuspendedInfo,
        reactivateAccount,
        submitUnsuspensionRequest,
        refreshAccountStatus,
      }}
    >
      <SessionExpiryNotice />
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
