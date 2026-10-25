import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { RECOVERY_STORAGE_KEY } from '@kits-eos/shared';
import { PasswordInput } from '../components/ui/PasswordInput';
import { AlertCircle, CheckCircle2, ShieldAlert, ArrowLeft, KeyRound, WifiOff } from 'lucide-react';
import type { EmailOtpType } from '@supabase/supabase-js';

type RecoveryStatus = 'VERIFYING' | 'READY' | 'SUCCESS' | 'EXPIRED' | 'NO_SESSION' | 'NETWORK_ERROR';

interface ErrorNotice {
  title: string;
  message: string;
}

export function ResetPassword() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<RecoveryStatus>('VERIFYING');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorNotice, setErrorNotice] = useState<ErrorNotice | null>(null);

  const checkRecovery = useCallback(async () => {
    setStatus('VERIFYING');

    // 1. Safe parameter inspection
    const hash = window.location.hash || '';
    const search = window.location.search || '';

    const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const searchParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

    const error = hashParams.get('error') || searchParams.get('error');
    const errorCode = hashParams.get('error_code') || searchParams.get('error_code');
    const errorDescription = hashParams.get('error_description') || searchParams.get('error_description');

    // If Supabase explicitly redirected with an error parameter
    if (error || errorCode) {
      if (
        errorCode === 'otp_expired' ||
        errorCode === 'access_denied' ||
        errorDescription?.toLowerCase().includes('expired') ||
        errorDescription?.toLowerCase().includes('invalid') ||
        errorDescription?.toLowerCase().includes('not found')
      ) {
        setStatus('EXPIRED');
        return;
      }
      if (
        errorDescription?.toLowerCase().includes('network') ||
        errorDescription?.toLowerCase().includes('connection')
      ) {
        setStatus('NETWORK_ERROR');
        return;
      }
      setStatus('EXPIRED');
      return;
    }

    // 2. Check for PKCE code if present in query params
    const code = searchParams.get('code');
    if (code) {
      try {
        const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeErr) {
          setStatus('EXPIRED');
          return;
        }
        sessionStorage.setItem(RECOVERY_STORAGE_KEY, 'true');
        setStatus('READY');
        return;
      } catch {
        setStatus('NETWORK_ERROR');
        return;
      }
    }

    // 3. Check for token_hash if present in query params
    const tokenHash = searchParams.get('token_hash');
    if (tokenHash) {
      try {
        const type = (searchParams.get('type') || 'recovery') as EmailOtpType;
        const { error: otpErr } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        if (otpErr) {
          setStatus('EXPIRED');
          return;
        }
        sessionStorage.setItem(RECOVERY_STORAGE_KEY, 'true');
        setStatus('READY');
        return;
      } catch {
        setStatus('NETWORK_ERROR');
        return;
      }
    }

    // 4. Check for implicit recovery token in URL hash
    const hasRecoveryHash = (
      (hashParams.get('type') === 'recovery' || hash.includes('type=recovery')) &&
      (Boolean(hashParams.get('access_token')) || hash.includes('access_token='))
    );
    if (hasRecoveryHash) {
      sessionStorage.setItem(RECOVERY_STORAGE_KEY, 'true');
    }

    // 5. Check if recovery flag is in sessionStorage
    const hadRecoveryActive = sessionStorage.getItem(RECOVERY_STORAGE_KEY) === 'true';

    try {
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) {
        setStatus('NETWORK_ERROR');
        return;
      }

      if (session?.user && hadRecoveryActive) {
        setStatus('READY');
        return;
      }
    } catch {
      setStatus('NETWORK_ERROR');
      return;
    }

    // 6. If recovery tokens are present or flagged, wait briefly for Supabase GoTrue parsing
    if (hasRecoveryHash || hadRecoveryActive) {
      const timeoutId = setTimeout(async () => {
        try {
          const { data: { session: pollSession } } = await supabase.auth.getSession();
          const stillActive = sessionStorage.getItem(RECOVERY_STORAGE_KEY) === 'true';
          if (pollSession?.user && stillActive) {
            setStatus('READY');
          } else {
            setStatus('EXPIRED');
          }
        } catch {
          setStatus('NETWORK_ERROR');
        }
      }, 2500);

      return () => clearTimeout(timeoutId);
    }

    // 7. No recovery tokens and no active recovery session
    setStatus('NO_SESSION');
  }, []);

  useEffect(() => {
    let isMounted = true;

    checkRecovery();

    // Listen for native Supabase auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        sessionStorage.setItem(RECOVERY_STORAGE_KEY, 'true');
        setStatus('READY');
      } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        if (sessionStorage.getItem(RECOVERY_STORAGE_KEY) === 'true') {
          setStatus('READY');
        }
      } else if (event === 'SIGNED_OUT') {
        sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
        setStatus((prev) => (prev === 'SUCCESS' ? 'SUCCESS' : 'NO_SESSION'));
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [checkRecovery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNotice(null);

    if (!password.trim() || !confirmPassword.trim()) {
      setErrorNotice({
        title: 'Well, that didn’t work.',
        message: 'The password rescue mission failed. Try again in a moment.',
      });
      return;
    }

    if (password.length < 6) {
      setErrorNotice({
        title: 'Well, that didn’t work.',
        message: "That's a password, not a password.",
      });
      return;
    }

    if (password !== confirmPassword) {
      setErrorNotice({
        title: 'Well, that didn’t work.',
        message: "They don't match. Try again.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Supabase Auth native updateUser
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) {
        setErrorNotice({
          title: 'Well, that didn’t work.',
          message: error.message || 'The password rescue mission failed. Try again in a moment.',
        });
        setIsSubmitting(false);
        return;
      }

      // Successfully updated password!
      sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
      
      // Cleanly sign out all sessions across devices so user logs in afresh with new credentials
      try {
        await supabase.auth.signOut({ scope: 'global' });
      } catch {
        // Fallback to local signout if global signout endpoint encounters network issue
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {
          // Silent signout catch
        }
      }

      setStatus('SUCCESS');
    } catch {
      setErrorNotice({
        title: 'Well, that didn’t work.',
        message: 'The password rescue mission failed. Try again in a moment.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full flex items-center justify-center py-6 sm:py-12 selection:bg-red-200 page-enter">
      <div className="relative w-full max-w-md bg-white rounded-2xl md:rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.12)] border border-gray-200 overflow-hidden p-6 sm:p-8">
        
        {/* Brand Header */}
        <div className="flex items-center space-x-3 mb-6">
          <img
            src="/college_logo.png"
            alt="KITS Logo"
            width={40}
            height={40}
            className="w-10 h-10 object-contain shrink-0"
          />
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-black text-base tracking-tight text-kits-red">KITS-EOS</span>
            </div>
            <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider mt-0.5">
              Student Event Operations System
            </p>
          </div>
        </div>

        {/* State 1: Verifying Session */}
        {status === 'VERIFYING' && (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
            <div className="animate-spin rounded-full h-8 w-8 border-3 border-kits-red border-t-transparent" />
            <p className="text-xs font-semibold text-gray-500">
              Verifying recovery link...
            </p>
          </div>
        )}

        {/* State 2: Success Message */}
        {status === 'SUCCESS' && (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="h-10 w-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                Password changed.
              </h1>
              <p className="text-xs text-gray-600 leading-relaxed font-medium">
                Your old password has left the chat.
              </p>
            </div>

            <div className="pt-3">
              <button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="w-full py-2.5 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer text-center"
              >
                BACK TO LOGIN
              </button>
            </div>
          </div>
        )}

        {/* State 3: Invalid or Expired Recovery Session */}
        {status === 'EXPIRED' && (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="h-10 w-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                This reset link is no longer valid.
              </h1>
              <p className="text-xs text-gray-600 leading-relaxed">
                Reset links can only be used once and expire after a limited time. Please request a fresh reset link.
              </p>
            </div>

            <div className="pt-2 space-y-2.5">
              <Link
                to="/forgot-password"
                className="w-full py-2.5 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer text-center"
              >
                GET A NEW LINK
              </Link>
              <Link
                to="/login"
                className="w-full py-2 text-xs font-semibold text-gray-500 hover:text-gray-800 transition inline-flex items-center justify-center gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to Login</span>
              </Link>
            </div>
          </div>
        )}

        {/* State 4: Direct Access Without Session */}
        {status === 'NO_SESSION' && (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="h-10 w-10 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center border border-gray-200">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                No active reset request.
              </h1>
              <p className="text-xs text-gray-600 leading-relaxed">
                You arrived here without an active password reset request. If you forgot your password, you can request a rescue link.
              </p>
            </div>

            <div className="pt-2 space-y-2.5">
              <Link
                to="/forgot-password"
                className="w-full py-2.5 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer text-center"
              >
                REQUEST PASSWORD RESET
              </Link>
              <Link
                to="/login"
                className="w-full py-2 text-xs font-semibold text-gray-500 hover:text-gray-800 transition inline-flex items-center justify-center gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to Login</span>
              </Link>
            </div>
          </div>
        )}

        {/* State 5: Network Error */}
        {status === 'NETWORK_ERROR' && (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="h-10 w-10 rounded-full bg-red-50 text-kits-red flex items-center justify-center border border-red-200">
                <WifiOff className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                Connection error.
              </h1>
              <p className="text-xs text-gray-600 leading-relaxed">
                We couldn&apos;t verify your reset link. Check your internet connection and try again.
              </p>
            </div>

            <div className="pt-2 space-y-2.5">
              <button
                type="button"
                onClick={() => checkRecovery()}
                className="w-full py-2.5 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer text-center"
              >
                TRY AGAIN
              </button>
              <Link
                to="/forgot-password"
                className="w-full py-2 text-xs font-semibold text-gray-500 hover:text-gray-800 transition inline-flex items-center justify-center gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Request a new link</span>
              </Link>
            </div>
          </div>
        )}

        {/* State 6: Valid Recovery Session -> Password Form */}
        {status === 'READY' && (
          <div className="space-y-4">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded bg-red-100 text-kits-red border border-red-200 inline-block mb-1">
                Student Security
              </span>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                New password. New problems.
              </h1>
              <p className="text-gray-500 text-xs mt-1 leading-relaxed font-medium">
                Your old password has been officially retired.
              </p>
            </div>

            {errorNotice && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-kits-red" />
                <div>
                  <span className="font-bold block">{errorNotice.title}</span>
                  <span>{errorNotice.message}</span>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} autoComplete="off" className="space-y-3.5 text-xs font-semibold text-gray-700">
              <div>
                <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                  New Password <span className="text-red-500">*</span>
                </label>
                <PasswordInput
                  required
                  autoComplete="new-password"
                  placeholder="Make it memorable. Not obvious."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-red focus:border-kits-red disabled:bg-gray-100"
                />
              </div>

              <div>
                <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                  Confirm New Password <span className="text-red-500">*</span>
                </label>
                <PasswordInput
                  required
                  autoComplete="new-password"
                  placeholder="They better match."
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-red focus:border-kits-red disabled:bg-gray-100"
                />
              </div>

              <div className="text-[11px] text-gray-400 font-normal space-y-1 pt-1">
                <p>• Minimum 6 characters</p>
                <p>• Make sure both fields match exactly</p>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" />
                    <span>CHANGE MY PASSWORD</span>
                  </>
                )}
              </button>
            </form>

            <div className="pt-3 border-t border-gray-100 text-center">
              <Link
                to="/login"
                className="text-xs font-bold text-gray-500 hover:text-gray-800 transition inline-flex items-center gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Cancel and return to Login</span>
              </Link>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
