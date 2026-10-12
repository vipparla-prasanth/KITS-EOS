import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { ArrowLeft, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

const COOLDOWN_KEY = 'kits_reset_cooldown_expiry';

interface ErrorNotice {
  title: string;
  message: string;
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorNotice, setErrorNotice] = useState<ErrorNotice | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);

  // Initialize and tick cooldown timer from sessionStorage
  useEffect(() => {
    const updateCooldown = () => {
      try {
        const storedExpiry = sessionStorage.getItem(COOLDOWN_KEY);
        if (storedExpiry) {
          const expiryTime = parseInt(storedExpiry, 10);
          const now = Date.now();
          const diffSeconds = Math.max(0, Math.ceil((expiryTime - now) / 1000));
          setCooldownRemaining(diffSeconds);
          if (diffSeconds === 0) {
            sessionStorage.removeItem(COOLDOWN_KEY);
          }
        } else {
          setCooldownRemaining(0);
        }
      } catch {
        setCooldownRemaining(0);
      }
    };

    updateCooldown();
    const interval = setInterval(updateCooldown, 1000);
    return () => clearInterval(interval);
  }, []);

  const startCooldown = (seconds: number = 60) => {
    const expiry = Date.now() + seconds * 1000;
    try {
      sessionStorage.setItem(COOLDOWN_KEY, expiry.toString());
    } catch {
      // Non-critical fallback
    }
    setCooldownRemaining(seconds);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldownRemaining > 0 || isSubmitting) return;

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setErrorNotice({
        title: 'Well, that didn’t work.',
        message: 'The password rescue mission failed. Try again in a moment.',
      });
      return;
    }

    setErrorNotice(null);
    setIsSubmitting(true);

    try {
      const redirectTo = `${window.location.origin}/reset-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo,
      });

      if (error) {
        // Detect authoritative Supabase rate limits (HTTP 429 or security limit)
        const isRateLimit =
          (error as any)?.status === 429 ||
          error.message?.toLowerCase().includes('rate limit') ||
          error.message?.toLowerCase().includes('security purposes');

        if (isRateLimit) {
          setErrorNotice({
            title: 'Slow down.',
            message: 'You just asked. Give the inbox a second.',
          });
          startCooldown(60);
          setIsSubmitting(false);
          return;
        }

        // To prevent email enumeration, do NOT show error if email is not found
        // Generic success is displayed for all other outcomes
      }

      // Consistent response to protect against email enumeration
      setIsSubmitted(true);
      startCooldown(60);
    } catch {
      // Generic success to prevent enumeration even on unexpected client failures
      setIsSubmitted(true);
      startCooldown(60);
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

        {/* State A: Success Confirmation */}
        {isSubmitted ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="h-10 w-10 rounded-full bg-red-50 text-kits-red flex items-center justify-center border border-red-100">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                Check your inbox.
              </h1>
              <p className="text-xs text-gray-600 leading-relaxed font-medium">
                If an account exists with this email, we&apos;ve sent a reset link. Your password has been reported missing.
              </p>
            </div>

            {cooldownRemaining > 0 && (
              <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-gray-800">
                  <Clock className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                  <span>Slow down.</span>
                </div>
                <p className="text-gray-500">You just asked. Give the inbox a second.</p>
                <p className="text-[11px] font-semibold text-gray-400">Try again in {cooldownRemaining}s.</p>
              </div>
            )}

            <div className="pt-2 space-y-2.5">
              <Link
                to="/login"
                className="w-full py-2.5 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer text-center"
              >
                BACK TO LOGIN
              </Link>

              {cooldownRemaining === 0 && (
                <button
                  type="button"
                  onClick={() => setIsSubmitted(false)}
                  className="w-full py-2 text-xs font-semibold text-gray-500 hover:text-gray-800 transition cursor-pointer text-center"
                >
                  Didn&apos;t receive it? Try another email
                </button>
              )}
            </div>
          </div>
        ) : (
          /* State B: Reset Email Request Form */
          <div className="space-y-4">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded bg-red-100 text-kits-red border border-red-200 inline-block mb-1">
                Student Portal
              </span>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                Forgot your password?
              </h1>
              <p className="text-gray-500 text-xs mt-1 leading-relaxed font-medium">
                Forgot it already? Classic.
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
                  Registered Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="Enter your registered email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-red focus:border-kits-red disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || cooldownRemaining > 0}
                className="w-full py-2.5 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {isSubmitting ? (
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : cooldownRemaining > 0 ? (
                  <span>Try again in {cooldownRemaining}s.</span>
                ) : (
                  <span>RESCUE MY ACCOUNT</span>
                )}
              </button>
            </form>

            <div className="pt-3 border-t border-gray-100 text-center">
              <Link
                to="/login"
                className="text-xs font-bold text-kits-red hover:text-red-700 hover:underline transition inline-flex items-center gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Remembered it? Back to Login</span>
              </Link>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
