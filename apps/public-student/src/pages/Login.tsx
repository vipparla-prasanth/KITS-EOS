import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  ArrowRight, 
  ArrowLeft, 
  UserPlus, 
  LogIn, 
  AlertCircle,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Clock
} from 'lucide-react';

import { DEPARTMENTS, DEFAULT_COLLEGE, CollegeSelect, formatDateTime12h, consumeSessionExpiredNotice } from '@kits-eos/shared';

import { AccountSuspendedScreen } from '../components/AccountSuspendedScreen';

/**
 * KITS-EOS Student Authentication Portal
 * Split-panel sliding animation strictly contained within the authentication card.
 * Seamless sliding transitions between Student Sign In and Student Account Creation (Sign Up).
 */
export function Login() {
  const { signIn, signUp, signOut, deactivatedInfo, suspendedInfo, reactivateAccount, clearDeactivatedInfo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // false = Sign In view (overlay on right), true = Sign Up view (overlay on left)
  const [isSignUpMode, setIsSignUpMode] = useState(false);

  // Sign In Credentials
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [signInLoading, setSignInLoading] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null);

  React.useEffect(() => {
    const notice = consumeSessionExpiredNotice();
    if (notice) {
      setExpiredNotice(notice);
    }
  }, []);

  // Reactivation Form State
  const [reactivationEmail, setReactivationEmail] = useState('');
  const [reactivating, setReactivating] = useState(false);
  const [reactivationError, setReactivationError] = useState<string | null>(null);
  const [reactivationSuccess, setReactivationSuccess] = useState(false);

  // Sign Up Student Profile Fields
  const [signUpFullName, setSignUpFullName] = useState('');
  const [signUpRollNumber, setSignUpRollNumber] = useState('');
  const [signUpCollege, setSignUpCollege] = useState(DEFAULT_COLLEGE);
  const [signUpDepartment, setSignUpDepartment] = useState<string>(DEPARTMENTS[0]);
  const [signUpOtherDepartment, setSignUpOtherDepartment] = useState('');
  const [signUpYearOfStudy, setSignUpYearOfStudy] = useState<number>(3);
  const [signUpPhone, setSignUpPhone] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpPrivacyAcknowledged, setSignUpPrivacyAcknowledged] = useState(false);
  const [signUpLoading, setSignUpLoading] = useState(false);
  const [signUpError, setSignUpError] = useState<string | null>(null);

  const from = location.state?.from?.pathname || '/dashboard';
  const deactivatedNotice = location.state?.deactivatedNotice;

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignInError(null);
    setSignInLoading(true);

    try {
      const result = await signIn(signInEmail.trim(), signInPassword);
      if (result.error) throw result.error;
      if (result.deactivated) {
        // Intercepted by deactivated account info
        return;
      }
      if (result.suspended) {
        // Intercepted by suspended account info
        return;
      }
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error('Sign in error:', err);
      const isRateLimit = err?.status === 429 || 
        err?.message?.toLowerCase().includes('too many') || 
        err?.message?.toLowerCase().includes('rate limit');
      setSignInError(
        isRateLimit
          ? 'High traffic from your campus network: Please wait 15–30 seconds and try signing in again.'
          : (err.message || 'Authentication failed. Please check your email and password.')
      );
    } finally {
      setSignInLoading(false);
    }
  };

  const handleReactivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReactivationError(null);
    setReactivating(true);

    try {
      const { error: err } = await reactivateAccount(reactivationEmail.trim());
      if (err) throw err;
      setReactivationSuccess(true);
      setTimeout(() => {
        navigate(from, { replace: true });
      }, 1500);
    } catch (err: any) {
      console.error('Reactivation failed:', err);
      setReactivationError(err.message || 'Reactivation failed. Ensure email matches.');
    } finally {
      setReactivating(false);
    }
  };

  const handleCancelDeactivated = async () => {
    await signOut();
    clearDeactivatedInfo();
    setReactivationEmail('');
    setReactivationError(null);
    setReactivationSuccess(false);
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignUpError(null);
    setSignUpLoading(true);

    try {
      if (!signUpFullName.trim() || !signUpRollNumber.trim() || !signUpPhone.trim()) {
        throw new Error('Please fill in all required student profile details');
      }

      if (!signUpCollege.trim()) {
        throw new Error('Please select or enter your college / institution name');
      }

      if (signUpDepartment === 'OTHER' && !signUpOtherDepartment.trim()) {
        throw new Error('Please specify your other department name');
      }

      if (!signUpPrivacyAcknowledged) {
        throw new Error('Please read and acknowledge the Privacy Notice to continue.');
      }

      const { error: err } = await signUp(signUpEmail.trim(), signUpPassword, {
        full_name: signUpFullName.trim(),
        roll_number: signUpRollNumber.trim().toUpperCase(),
        college: signUpCollege.trim(),
        department: signUpDepartment,
        other_department: signUpDepartment === 'OTHER' ? signUpOtherDepartment.trim() : null,
        year_of_study: Number(signUpYearOfStudy),
        phone: signUpPhone.trim(),
        privacy_notice_version: '1.0',
        privacy_acknowledged_at: new Date().toISOString(),
      } as any);

      if (err) throw err;
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error('Sign up error:', err);
      const isRateLimit = err?.status === 429 || 
        err?.message?.toLowerCase().includes('too many') || 
        err?.message?.toLowerCase().includes('rate limit');
      setSignUpError(
        isRateLimit
          ? 'High traffic from your campus network: Account created! Please wait 15–30 seconds and then sign in.'
          : (err.message || 'Account creation failed. Please check your information.')
      );
    } finally {
      setSignUpLoading(false);
    }
  };

  const BrandHeader = () => (
    <div className="flex items-center space-x-3 mb-3">
      <img
        src="/college_logo.png"
        alt="KITS Logo"
        className="w-10 h-10 object-contain shrink-0"
      />
      <div>
        <h2 className="text-xl font-black tracking-tight leading-none text-gray-900">
          <span className="text-kits-red">KITS</span>-<span className="text-kits-blue">EOS</span>
        </h2>
        <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider mt-0.5">
          Student Event Operations System
        </p>
      </div>
    </div>
  );

  if (suspendedInfo) {
    return <AccountSuspendedScreen />;
  }

  return (
    <div className="w-full flex items-center justify-center py-2 sm:py-6 selection:bg-red-200 page-enter">
      {/* =========================================================================
          AUTHENTICATION CARD (Strict Containment Boundary)
          position: relative, overflow: hidden, isolation: isolate
          ========================================================================= */}
      <div 
        className="relative w-full max-w-[1020px] md:h-[660px] bg-white rounded-2xl md:rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.12)] border border-gray-200 overflow-hidden flex flex-col md:block"
        style={{ 
          isolation: 'isolate',
          transform: 'translateZ(0)',
          WebkitMaskImage: '-webkit-radial-gradient(white, black)',
          contain: 'paint'
        }}
      >
        
        {/* =========================================================================
            MOBILE/TABLET VIEW (Vertical Tab Switcher & Natural Flow)
            ========================================================================= */}
        <div className="md:hidden flex flex-col min-h-screen bg-white">
          <div className="p-5 pb-2 border-b border-gray-200 bg-white">
            <BrandHeader />
            {/* Mobile Tab Switcher */}
            <div className="flex bg-gray-100 p-1 rounded-xl mt-2 border border-gray-200">
              <button
                type="button"
                onClick={() => { setIsSignUpMode(false); setSignInError(null); }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  !isSignUpMode ? 'bg-white text-gray-900 shadow-2xs border border-gray-200' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setIsSignUpMode(true); setSignUpError(null); }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  isSignUpMode ? 'bg-white text-kits-red shadow-2xs border border-gray-200' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                New Student
              </button>
            </div>
          </div>

          <div className="flex-1 p-5 bg-white">
            {/* Mobile: Sign In Form */}
            <div className={`space-y-4 ${isSignUpMode ? 'hidden' : 'block'}`}>
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded bg-red-100 text-kits-red inline-block">
                  Student Portal
                </span>
                <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                  Student Sign In
                </h1>
                <p className="text-xs text-gray-500">
                  Sign in with your student credentials to register for sub-events.
                </p>
              </div>

              {deactivatedNotice && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>{deactivatedNotice}</span>
                </div>
              )}

              {expiredNotice && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>{expiredNotice}</span>
                </div>
              )}

              {signInError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{signInError}</span>
                </div>
              )}

              <form onSubmit={handleSignInSubmit} autoComplete="off" className="space-y-3.5 text-xs font-semibold text-gray-700">
                <div>
                  <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="off"
                    placeholder="your_email_here"
                    value={signInEmail}
                    onChange={(e) => setSignInEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-red focus:border-kits-red"
                  />
                </div>

                <div>
                  <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="off"
                    placeholder="Please enter your password here"
                    value={signInPassword}
                    onChange={(e) => setSignInPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-red focus:border-kits-red"
                  />
                </div>

                <button
                  type="submit"
                  disabled={signInLoading}
                  className="w-full py-3 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  {signInLoading ? (
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <LogIn className="h-4 w-4" />
                      <span>Sign In to Portal</span>
                    </>
                  )}
                </button>
              </form>

              <div className="pt-4 border-t border-gray-200 text-center space-y-2">
                <button
                  type="button"
                  onClick={() => setIsSignUpMode(true)}
                  className="text-xs font-bold text-kits-blue hover:underline block w-full cursor-pointer"
                >
                  New to KITS-EOS? Create Student Account →
                </button>
                <Link to="/events" className="text-xs text-gray-400 hover:text-gray-600 block">
                  Browse events without signing in →
                </Link>
              </div>
            </div>

            {/* Mobile: Sign Up Form */}
            <div className={`space-y-4 ${!isSignUpMode ? 'hidden' : 'block'}`}>
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded bg-blue-100 text-kits-blue inline-block">
                  Registration
                </span>
                <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                  Create Student Account
                </h1>
                <p className="text-xs text-gray-500">
                  Register with your academic profile to participate in flagship events.
                </p>
              </div>

              {signUpError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{signUpError}</span>
                </div>
              )}

              <form onSubmit={handleSignUpSubmit} autoComplete="off" className="space-y-3 text-xs font-semibold text-gray-700">
                <div>
                  <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                    Full Legal Name <span className="text-red-500">*</span>
                  </label>
                  <p className="text-[11px] text-gray-500 mb-1 font-normal">
                    Enter your full name exactly as you want it to appear on your certificate.
                  </p>
                  <input
                    type="text"
                    required
                    placeholder="e.g. John Doe"
                    value={signUpFullName}
                    onChange={(e) => setSignUpFullName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                      Roll Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="URK22CS1001"
                      value={signUpRollNumber}
                      onChange={(e) => setSignUpRollNumber(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono uppercase text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                    />
                  </div>
                  <div>
                    <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                      Year of Study <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={signUpYearOfStudy}
                      onChange={(e) => setSignUpYearOfStudy(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs text-gray-900 bg-white focus:ring-1 focus:ring-kits-blue focus:border-kits-blue cursor-pointer"
                    >
                      <option value={1}>1st Year</option>
                      <option value={2}>2nd Year</option>
                      <option value={3}>3rd Year</option>
                      <option value={4}>4th Year</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                    Department / Branch <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={signUpDepartment}
                    onChange={(e) => setSignUpDepartment(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs text-gray-900 bg-white focus:ring-1 focus:ring-kits-blue focus:border-kits-blue cursor-pointer"
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                {signUpDepartment === 'OTHER' && (
                  <div>
                    <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                      Specify Other Department <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Enter your department name"
                      value={signUpOtherDepartment}
                      onChange={(e) => setSignUpOtherDepartment(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                    />
                  </div>
                )}

                <CollegeSelect
                  label="College / Institution"
                  required
                  value={signUpCollege}
                  onChange={setSignUpCollege}
                  size="sm"
                />

                <div>
                  <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                    Mobile Phone <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 9876543210"
                    value={signUpPhone}
                    onChange={(e) => setSignUpPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                  />
                </div>

                <div>
                  <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="off"
                    placeholder="your_email_here"
                    value={signUpEmail}
                    onChange={(e) => setSignUpEmail(e.target.value)}
                    className="w-full px-3.5 py-2 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                  />
                </div>

                <div>
                  <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="Please enter your password here"
                    value={signUpPassword}
                    onChange={(e) => setSignUpPassword(e.target.value)}
                    className="w-full px-3.5 py-2 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                  />
                </div>

                {/* Pre-Collection Privacy Notice & Explicit Consent (DPDP Act, 2023) */}
                <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-100 text-[11px] text-gray-600 space-y-1.5 mt-2">
                  <div className="flex items-center gap-1.5 text-kits-blue font-bold">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    <span>Privacy & Data Protection Notice</span>
                  </div>
                  <p className="text-[10px] leading-relaxed text-gray-500">
                    KITS-EOS collects your profile information to manage your event registrations, verify institutional eligibility, record attendance, and issue certificates.
                  </p>
                  <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      required
                      checked={signUpPrivacyAcknowledged}
                      onChange={(e) => setSignUpPrivacyAcknowledged(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded text-kits-blue border-gray-300 focus:ring-kits-blue cursor-pointer"
                    />
                    <span className="text-[10px] text-gray-700 leading-tight">
                      I have read the{' '}
                      <a
                        href="/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-kits-blue hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Privacy Notice
                      </a>{' '}
                      and understand how my personal data will be processed for KITS-EOS event participation and institutional operations.
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={signUpLoading}
                  className="w-full py-3 px-4 rounded-xl bg-kits-blue text-white text-xs font-black uppercase tracking-wider hover:bg-blue-800 active:scale-95 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer mt-2"
                >
                  {signUpLoading ? (
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      <span>Create Account & Sign In</span>
                    </>
                  )}
                </button>
              </form>

              <div className="pt-4 border-t border-gray-200 text-center space-y-2">
                <button
                  type="button"
                  onClick={() => setIsSignUpMode(false)}
                  className="text-xs font-bold text-kits-red hover:underline block w-full cursor-pointer"
                >
                  ← Already have an account? Sign In
                </button>
                <Link to="/events" className="text-xs text-gray-400 hover:text-gray-600 block">
                  Browse events without signing in →
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            DESKTOP VIEW (Two Fixed Base Panels + Strictly Contained Sliding Overlay)
            ========================================================================= */}
        <div className="hidden md:block w-full h-full absolute inset-0 bg-white">
          
          {/* BASE LEFT PANEL: Student Sign In Form */}
          <div
            className={`absolute top-0 left-0 w-1/2 h-full flex flex-col justify-center px-10 lg:px-12 transition-all duration-500 bg-white ${
              isSignUpMode ? 'opacity-0 pointer-events-none' : 'opacity-100 z-10'
            }`}
          >
            <BrandHeader />

            <div className="space-y-3.5 max-w-sm w-full">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded bg-red-100 text-kits-red border border-red-200 inline-block mb-1">
                  Student Portal
                </span>
                <h1 className="text-2xl lg:text-3xl font-black text-gray-900 tracking-tight">
                  Student Sign In
                </h1>
                <p className="text-gray-500 text-xs mt-0.5 leading-relaxed font-medium">
                  Sign in with your student credentials to register for sub-events and access passes.
                </p>
              </div>

              {deactivatedNotice && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>{deactivatedNotice}</span>
                </div>
              )}

              {expiredNotice && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>{expiredNotice}</span>
                </div>
              )}

              {signInError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-kits-red" />
                  <span>{signInError}</span>
                </div>
              )}

              <form onSubmit={handleSignInSubmit} autoComplete="off" className="space-y-3 text-xs font-semibold text-gray-700">
                <div>
                  <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="off"
                    placeholder="your_email_here"
                    value={signInEmail}
                    onChange={(e) => setSignInEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-red focus:border-kits-red"
                  />
                </div>

                <div>
                  <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-1">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="off"
                    placeholder="Please enter your password here"
                    value={signInPassword}
                    onChange={(e) => setSignInPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-red focus:border-kits-red"
                  />
                </div>

                <button
                  type="submit"
                  disabled={signInLoading}
                  className="w-full py-2.5 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer mt-2"
                >
                  {signInLoading ? (
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <LogIn className="h-4 w-4" />
                      <span>Sign In to Portal</span>
                    </>
                  )}
                </button>
              </form>

              <div className="pt-2 border-t border-gray-100 text-center">
                <Link to="/events" className="text-xs text-gray-400 hover:text-kits-blue transition inline-flex items-center gap-1">
                  <span>Browse events without signing in →</span>
                </Link>
              </div>
            </div>
          </div>

          {/* BASE RIGHT PANEL: Student Sign Up (Create Account) Form */}
          <div
            className={`absolute top-0 right-0 w-1/2 h-full flex flex-col px-10 lg:px-12 transition-all duration-500 bg-white overflow-y-auto ${
              isSignUpMode ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="my-auto py-6 max-w-sm w-full space-y-2.5">
              <BrandHeader />

              <div>
                <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded bg-blue-100 text-kits-blue border border-blue-200 inline-block mb-0.5">
                  New Student Registration
                </span>
                <h1 className="text-2xl lg:text-3xl font-black text-gray-900 tracking-tight">
                  Create Account
                </h1>
                <p className="text-gray-500 text-xs leading-relaxed font-medium">
                  Register with your academic profile to participate in competitions.
                </p>
              </div>

              {signUpError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-kits-red" />
                  <span>{signUpError}</span>
                </div>
              )}

              <form onSubmit={handleSignUpSubmit} autoComplete="off" className="space-y-2 text-xs font-semibold text-gray-700">
                <div className="space-y-2">
                  <div>
                    <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                      Full Legal Name <span className="text-red-500">*</span>
                    </label>
                    <p className="text-[10px] text-gray-400 mb-0.5 font-normal leading-tight">
                      Enter your full name exactly as you want it to appear on your certificate.
                    </p>
                    <input
                      type="text"
                      required
                      placeholder="e.g. John Doe"
                      value={signUpFullName}
                      onChange={(e) => setSignUpFullName(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                        Roll Number <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="URK22CS1001"
                        value={signUpRollNumber}
                        onChange={(e) => setSignUpRollNumber(e.target.value)}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono uppercase text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                      />
                    </div>
                    <div>
                      <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                        Year of Study <span className="text-red-500">*</span>
                      </label>
                      <select
                        required
                        value={signUpYearOfStudy}
                        onChange={(e) => setSignUpYearOfStudy(Number(e.target.value))}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-900 bg-white focus:ring-1 focus:ring-kits-blue focus:border-kits-blue cursor-pointer"
                      >
                        <option value={1}>1st Year</option>
                        <option value={2}>2nd Year</option>
                        <option value={3}>3rd Year</option>
                        <option value={4}>4th Year</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                      Department / Branch <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={signUpDepartment}
                      onChange={(e) => setSignUpDepartment(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-900 bg-white focus:ring-1 focus:ring-kits-blue focus:border-kits-blue cursor-pointer"
                    >
                      {DEPARTMENTS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>

                  {signUpDepartment === 'OTHER' && (
                    <div>
                      <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                        Specify Other Department <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Enter your department name"
                        value={signUpOtherDepartment}
                        onChange={(e) => setSignUpOtherDepartment(e.target.value)}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                      />
                    </div>
                  )}

                  <CollegeSelect
                    label="College / Institution"
                    required
                    value={signUpCollege}
                    onChange={setSignUpCollege}
                    size="sm"
                  />

                  <div>
                    <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                      Mobile Phone <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="+91 9876543210"
                      value={signUpPhone}
                      onChange={(e) => setSignUpPhone(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                    />
                  </div>

                  <div>
                    <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      autoComplete="off"
                      placeholder="your_email_here"
                      value={signUpEmail}
                      onChange={(e) => setSignUpEmail(e.target.value)}
                      className="w-full px-3.5 py-1.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                    />
                  </div>

                  <div>
                    <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-500 mb-0.5">
                      Password <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      placeholder="Please enter your password here"
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      className="w-full px-3.5 py-1.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                    />
                  </div>
                </div>

                {/* Pre-Collection Privacy Notice & Explicit Consent (DPDP Act, 2023) */}
                <div className="p-2 rounded-xl bg-blue-50/70 border border-blue-100 text-[11px] text-gray-600 space-y-1 mt-1">
                  <div className="flex items-center gap-1.5 text-kits-blue font-bold">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-[10px]">Privacy & Data Protection Notice</span>
                  </div>
                  <p className="text-[9.5px] leading-relaxed text-gray-500">
                    KITS-EOS collects student data to coordinate event registrations, track attendance, and issue certificates.
                  </p>
                  <label className="flex items-start gap-1.5 pt-0.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      required
                      checked={signUpPrivacyAcknowledged}
                      onChange={(e) => setSignUpPrivacyAcknowledged(e.target.checked)}
                      className="mt-0.5 h-3 w-3 rounded text-kits-blue border-gray-300 focus:ring-kits-blue cursor-pointer"
                    />
                    <span className="text-[9.5px] text-gray-700 leading-tight">
                      I have read the{' '}
                      <a
                        href="/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-kits-blue hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Privacy Notice
                      </a>{' '}
                      and understand how my data will be processed.
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={signUpLoading}
                  className="w-full py-2.5 px-4 rounded-xl bg-kits-blue text-white text-xs font-black uppercase tracking-wider hover:bg-blue-800 active:scale-95 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer mt-1"
                >
                  {signUpLoading ? (
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      <span>Create Account & Sign In</span>
                    </>
                  )}
                </button>
              </form>

              <div className="pt-1 border-t border-gray-100 text-center">
                <Link to="/events" className="text-xs text-gray-400 hover:text-kits-blue transition inline-flex items-center gap-1">
                  <span>Browse events without signing in →</span>
                </Link>
              </div>
            </div>
          </div>

          {/* =========================================================================
              SLIDING SOLID DARK OVERLAY CONTAINER (Strictly Contained)
              Moves from right to left (and left to right) via CSS Transform inside Card
              ========================================================================= */}
          <div
            className={`absolute top-0 left-1/2 w-1/2 h-full overflow-hidden transition-transform duration-[650ms] cubic-bezier(0.65, 0, 0.35, 1) z-20 shadow-2xl bg-[#0B0F19] pointer-events-auto ${
              isSignUpMode ? '-translate-x-full' : 'translate-x-0'
            }`}
            style={{ contain: 'paint', isolation: 'isolate' }}
          >
            {/* The 200% wide internal moving canvas inside the half-width viewport */}
            <div
              className={`relative -left-full h-full w-[200%] bg-gradient-to-br from-gray-950 via-slate-900 to-black text-white transform transition-transform duration-[650ms] cubic-bezier(0.65, 0, 0.35, 1) ${
                isSignUpMode ? 'translate-x-1/2' : 'translate-x-0'
              }`}
              style={{ backgroundColor: '#0B0F19' }}
            >
              {/* Subtle Institutional Background Texture */}
              <div 
                className="absolute inset-0 opacity-10 pointer-events-none" 
                style={{ 
                  backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', 
                  backgroundSize: '24px 24px' 
                }} 
              />
              <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-red-600 rounded-full filter blur-[100px] opacity-30 pointer-events-none" />
              <div className="absolute -top-32 -right-32 w-80 h-80 bg-blue-600 rounded-full filter blur-[100px] opacity-30 pointer-events-none" />

              {/* OVERLAY PANEL LEFT (Shown when in Sign Up view -> Prompts to slide to Sign In) */}
              <div
                className={`absolute top-0 left-0 w-1/2 h-full flex flex-col items-center justify-center px-10 lg:px-12 text-center transition-all duration-[650ms] ${
                  isSignUpMode ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 -translate-x-8 pointer-events-none'
                }`}
              >
                <div className="w-14 h-14 mb-4 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20 backdrop-blur-md shadow-2xl">
                  <LogIn className="w-7 h-7 text-red-400" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-red-400 mb-2 block">
                  ALREADY REGISTERED?
                </span>
                <h2 className="text-2xl lg:text-3xl font-black mb-2 tracking-tight text-white drop-shadow-xs">
                  Welcome Back!
                </h2>
                <p className="text-xs lg:text-sm text-slate-200 mb-6 leading-relaxed font-normal max-w-xs">
                  Sign in with your student credentials to access your event passes, attendance status, and certificates.
                </p>

                {/* High-contrast Solid Button */}
                <button
                  type="button"
                  onClick={() => { setIsSignUpMode(false); setSignInError(null); }}
                  className="group relative inline-flex items-center justify-center px-8 py-3.5 rounded-full bg-white text-gray-950 font-black text-xs uppercase tracking-wider hover:bg-slate-100 transition-all duration-200 shadow-xl active:scale-95 cursor-pointer focus:outline-none focus:ring-4 focus:ring-white/30"
                >
                  <ArrowLeft className="mr-2 h-4 w-4 transform group-hover:-translate-x-1 transition-transform text-red-600" />
                  <span>Sign In to Account</span>
                </button>
              </div>

              {/* OVERLAY PANEL RIGHT (Shown when in Sign In view -> Prompts to slide to Sign Up) */}
              <div
                className={`absolute top-0 right-0 w-1/2 h-full flex flex-col items-center justify-center px-10 lg:px-12 text-center transition-all duration-[650ms] ${
                  isSignUpMode ? 'opacity-0 translate-x-8 pointer-events-none' : 'opacity-100 translate-x-0 pointer-events-auto'
                }`}
              >
                <div className="w-14 h-14 mb-4 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20 backdrop-blur-md shadow-2xl">
                  <UserPlus className="w-7 h-7 text-blue-400" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-400 mb-2 block">
                  NEW TO KITS-EOS?
                </span>
                <h2 className="text-2xl lg:text-3xl font-black mb-2 tracking-tight text-white drop-shadow-xs">
                  Join the Competition
                </h2>
                <p className="text-xs lg:text-sm text-slate-200 mb-6 leading-relaxed font-normal max-w-xs">
                  Create your student profile to register for hackathons, paper presentations, and claim verified credentials.
                </p>

                {/* High-contrast Solid Button */}
                <button
                  type="button"
                  onClick={() => { setIsSignUpMode(true); setSignUpError(null); }}
                  className="group relative inline-flex items-center justify-center px-8 py-3.5 rounded-full bg-white text-gray-950 font-black text-xs uppercase tracking-wider hover:bg-slate-100 transition-all duration-200 shadow-xl active:scale-95 cursor-pointer focus:outline-none focus:ring-4 focus:ring-white/30"
                >
                  <span>Create Student Account →</span>
                  <ArrowRight className="ml-2 h-4 w-4 transform group-hover:translate-x-1 transition-transform text-blue-600" />
                </button>
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* Dedicated ACCOUNT DEACTIVATED Interception Screen / Modal */}
      {deactivatedInfo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-amber-300 shadow-2xl max-w-lg w-full p-6 sm:p-8 space-y-6 overflow-hidden">
            <div className="flex items-center gap-3.5">
              <div className="h-12 w-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 border border-amber-200">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                  Recovery Window Active
                </span>
                <h2 className="text-xl font-black text-gray-900 tracking-tight mt-1">
                  ACCOUNT DEACTIVATED
                </h2>
              </div>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              Your student account was deactivated. You are currently within the <strong>15-day recovery window</strong>. You can reactivate your account right now to restore full access to your registrations, certificates, and event dashboard.
            </p>

            {/* Account Timing Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-200 text-xs">
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-400 block mb-0.5">Deactivated On</span>
                <span className="font-bold text-gray-800 font-mono text-[11px]">
                  {deactivatedInfo.deactivated_at ? formatDateTime12h(deactivatedInfo.deactivated_at) : 'Recently'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-400 block mb-0.5">Permanent Deletion</span>
                <span className="font-bold text-red-600 font-mono text-[11px]">
                  {deactivatedInfo.scheduled_permanent_deletion_at ? formatDateTime12h(deactivatedInfo.scheduled_permanent_deletion_at) : 'In 15 days'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-400 block mb-0.5">Days Remaining</span>
                <span className="font-black text-amber-700 font-mono text-sm flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {deactivatedInfo.days_remaining} {deactivatedInfo.days_remaining === 1 ? 'Day' : 'Days'}
                </span>
              </div>
            </div>

            {reactivationSuccess ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <span className="font-bold">Account successfully reactivated! Redirecting to dashboard...</span>
              </div>
            ) : (
              <form onSubmit={handleReactivateSubmit} className="space-y-4">
                {reactivationError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{reactivationError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">
                    Confirm your registered email address to reactivate:
                  </label>
                  <input
                    type="email"
                    required
                    value={reactivationEmail}
                    onChange={(e) => setReactivationEmail(e.target.value)}
                    placeholder={deactivatedInfo.email || 'Enter your registered email'}
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-2 focus:ring-kits-blue focus:border-kits-blue"
                    autoFocus
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    disabled={reactivating}
                    onClick={handleCancelDeactivated}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
                  >
                    Cancel & Sign Out
                  </button>
                  <button
                    type="submit"
                    disabled={reactivating || !reactivationEmail.trim()}
                    className="px-5 py-2.5 rounded-xl bg-kits-blue text-white text-xs font-black uppercase tracking-wider hover:bg-blue-800 transition flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm"
                  >
                    <RotateCcw className={`h-4 w-4 ${reactivating ? 'animate-spin' : ''}`} />
                    <span>{reactivating ? 'Reactivating...' : 'Reactivate My Account'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
