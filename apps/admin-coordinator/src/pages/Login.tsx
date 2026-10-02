import React, { useState, useEffect } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { getDynamicOAuthRedirectUrl, consumeSessionExpiredNotice } from '@kits-eos/shared';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { setCoordinatorSession, getCoordinatorSession } from '../utils/coordinatorSession';
import { 
  Lock, 
  User, 
  ArrowRight, 
  ArrowLeft, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle,
  Layers
} from 'lucide-react';

/**
 * KITS-EOS Institutional Authentication Portal
 * Split-panel sliding animation for Administrator (Google OAuth) and Coordinator (Credentials)
 * High-contrast, production-grade visual hierarchy.
 */
export function Login() {
  const { user, role, status, isAllowlisted, authState, profileState, isLoading } = useAuth();
  const navigate = useNavigate();

  // true = Coordinator mode (panel shifted left), false = Administrator mode (panel on right)
  const [isCoordinatorMode, setIsCoordinatorMode] = useState(false);

  // Administrator State (Google OAuth exclusively)
  const [adminLoading, setAdminLoading] = useState(false);

  // Coordinator Form State
  const [coordUsername, setCoordUsername] = useState('');
  const [coordPassword, setCoordPassword] = useState('');
  const [coordLoading, setCoordLoading] = useState(false);
  const [coordStatusMessage, setCoordStatusMessage] = useState<string | null>(null);
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null);

  useEffect(() => {
    const notice = consumeSessionExpiredNotice();
    if (notice) {
      setExpiredNotice(notice);
    }
  }, []);

  // Handle post-OAuth intent routing for Admins & existing session detection
  useEffect(() => {
    // Check existing coordinator / payment manager session
    const coordSession = getCoordinatorSession();
    if (coordSession?.session_token) {
      if (coordSession.coordinator?.coordinator_type === 'PAYMENT_MANAGER') {
        navigate('/payment-management', { replace: true });
        return;
      } else {
        navigate('/coordinator', { replace: true });
        return;
      }
    }

    // Wait until both session initialization and profile resolution have definitively completed
    if (authState === 'INITIALIZING' || profileState === 'LOADING') return;

    if (user) {
      if (role === 'ADMIN' && status === 'ACTIVE' && isAllowlisted) {
        sessionStorage.removeItem('kits_eos_oauth_intent');
        navigate('/admin', { replace: true });
      } else if (role === 'PAYMENT_MANAGER' && status === 'ACTIVE') {
        sessionStorage.removeItem('kits_eos_oauth_intent');
        navigate('/payment-management', { replace: true });
      } else if (profileState === 'RESOLVED' && (role !== 'ADMIN' || !isAllowlisted) && role !== 'PAYMENT_MANAGER') {
        const hasIntent = sessionStorage.getItem('kits_eos_oauth_intent') === 'admin_login';
        if (hasIntent) {
          sessionStorage.removeItem('kits_eos_oauth_intent');
          navigate('/access-denied', { replace: true });
        }
      }
    }
  }, [authState, profileState, user, role, status, isAllowlisted, navigate]);

  const handleGoogleLogin = async () => {
    try {
      setAdminLoading(true);
      sessionStorage.setItem('kits_eos_oauth_intent', 'admin_login');
      const redirectUrl = getDynamicOAuthRedirectUrl('/admin');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            prompt: 'select_account'
          }
        },
      });
      if (error) throw error;
    } catch (error: any) {
      console.error('Google OAuth sign-in error:', error);
      alert('Failed to initiate login. Please try again.');
      setAdminLoading(false);
      sessionStorage.removeItem('kits_eos_oauth_intent');
    }
  };

  const handleContinueToPortal = () => {
    if (role === 'PAYMENT_MANAGER') {
      navigate('/payment-management');
    } else {
      navigate('/admin');
    }
  };

  const handleCoordinatorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coordUsername.trim() || !coordPassword.trim()) {
      setCoordStatusMessage('Please enter both username and password.');
      return;
    }

    setCoordLoading(true);
    setCoordStatusMessage(null);

    try {
      const { data, error } = await supabase.functions.invoke('coordinator-login', {
        body: {
          username: coordUsername.trim(),
          password: coordPassword
        }
      });

      if (error || !data?.success) {
        let errMsg = 'Invalid credentials. Please check your username and password.';
        if (error && (error as any).context) {
          try {
            const body = await (error as any).context.json();
            if (body?.error?.message) {
              errMsg = body.error.message;
            }
          } catch {
            // fallback
          }
        } else if (data?.error?.message) {
          errMsg = data.error.message;
        }

        // Never expose raw technical non-2xx Edge Function messages to end users
        if (
          !errMsg ||
          errMsg.includes('non-2xx') ||
          errMsg.includes('Edge Function') ||
          errMsg.includes('Failed to send') ||
          errMsg.includes('FunctionsFetchError')
        ) {
          errMsg = 'Invalid credentials. Please check your username and password.';
        }

        setCoordStatusMessage(errMsg);
      } else {
        if (!data.session_token || typeof data.session_token !== 'string') {
          setCoordStatusMessage('Authentication failed: No valid session token returned.');
          return;
        }

        // Securely store the coordinator session token strictly as a credential in sessionStorage
        setCoordinatorSession({
          session_token: data.session_token,
          coordinator: data.coordinator,
          access_state: data.access_state || 'AUTHORIZED',
          expires_at: data.expires_at || ''
        });

        if (data.coordinator?.coordinator_type === 'PAYMENT_MANAGER' || data.role === 'PAYMENT_MANAGER') {
          navigate('/payment-management', { replace: true });
        } else {
          navigate('/coordinator', { replace: true });
        }
      }
    } catch {
      setCoordStatusMessage('Invalid credentials. Please check your username and password.');
    } finally {
      setCoordLoading(false);
    }
  };

  const BrandHeader = () => (
    <div className="flex items-center space-x-3 mb-6">
      <div className="w-12 h-12 flex-shrink-0 relative overflow-hidden flex items-center justify-center rounded-xl bg-white shadow-sm border border-gray-200 p-1">
        <img 
          src="/college_logo.png" 
          alt="KITS Logo" 
          className="object-contain w-full h-full" 
        />
      </div>
      <div>
        <h2 className="text-xl font-black tracking-tight">
          <span className="text-kits-red">KITS</span>-<span className="text-kits-blue">EOS</span>
        </h2>
        <p className="text-[10px] uppercase font-bold text-gray-600 tracking-wider">Akshar Institute of Technology</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#EEF2F6] flex flex-col items-center justify-center font-sans p-0 sm:p-4 selection:bg-blue-200">
      
      {/* Background pattern */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-[0.05]" 
        style={{ 
          backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', 
          backgroundSize: '32px 32px' 
        }}
      />

      <div className="relative w-full max-w-md lg:max-w-[1020px] lg:w-[1020px] min-h-screen sm:min-h-0 lg:min-h-[620px] bg-white sm:rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] border-0 sm:border border-gray-300 overflow-hidden flex flex-col lg:block page-enter my-auto">
        
        {/* =========================================================================
            MOBILE/TABLET VIEW (Vertical Toggle & Stack)
            ========================================================================= */}
        <div className="lg:hidden flex flex-col min-h-screen sm:min-h-0">
          <div className="p-6 pb-2 border-b border-gray-200 bg-white">
            <BrandHeader />
            {/* Mobile Tab Switcher */}
            <div className="flex bg-gray-100 p-1.5 rounded-xl mt-4 border border-gray-200">
              <button
                type="button"
                onClick={() => setIsCoordinatorMode(false)}
                className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all ${
                  !isCoordinatorMode ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Administrator
              </button>
              <button
                type="button"
                onClick={() => setIsCoordinatorMode(true)}
                className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all ${
                  isCoordinatorMode ? 'bg-white text-kits-blue shadow-sm border border-gray-200' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Coordinator
              </button>
            </div>
          </div>
          
          <div className="flex-1 relative overflow-hidden bg-white">
             {/* Admin View Mobile */}
             <div className={`p-6 transition-all duration-300 ${isCoordinatorMode ? 'hidden' : 'block'}`}>
                <h1 className="text-2xl font-black text-gray-900 mb-2">Administrator Login</h1>
                <p className="text-gray-600 text-xs mb-6 font-medium">Secure access for authorized KITS-EOS administrators.</p>
                
                {user && !isLoading && (((role === 'ADMIN' && isAllowlisted) || role === 'PAYMENT_MANAGER') && status === 'ACTIVE') && (
                  <div className="w-full space-y-4">
                    <p className="text-xs font-semibold text-green-800 bg-green-50 p-4 rounded-xl border border-green-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
                      <span>You are signed in as {role === 'PAYMENT_MANAGER' ? 'Payment Manager' : 'Administrator'}.</span>
                    </p>
                    <button 
                      onClick={handleContinueToPortal} 
                      className="w-full bg-kits-red text-white py-3.5 px-6 rounded-xl font-bold text-sm shadow-md hover:bg-red-700 active:scale-[0.98] transition cursor-pointer"
                    >
                      {role === 'PAYMENT_MANAGER' ? 'Continue to Payment Management' : 'Continue to Admin Portal'}
                    </button>
                  </div>
                )}

                {expiredNotice && (
                  <div className="mb-4 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2.5 font-medium">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>{expiredNotice}</span>
                  </div>
                )}

                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={adminLoading || isLoading}
                    className="w-full flex items-center justify-center py-3.5 px-4 border-2 border-gray-200 rounded-xl bg-white text-xs font-bold text-gray-800 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.98] transition disabled:opacity-50 shadow-2xs cursor-pointer"
                  >
                    <svg className="w-4 h-4 mr-2.5 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    <span>Continue with Google Workspace SSO</span>
                  </button>
                </div>

                <div className="mt-8 pt-6 border-t border-gray-200 text-center">
                  <p className="text-xs text-gray-600 mb-2 font-semibold">Are you an assigned Coordinator?</p>
                  <button
                    type="button"
                    onClick={() => setIsCoordinatorMode(true)}
                    className="inline-flex items-center text-xs font-bold text-kits-blue hover:text-blue-800 transition"
                  >
                    <span>Login to Coordinator Portal →</span>
                  </button>
                </div>
             </div>

             {/* Coordinator View Mobile */}
             <div className={`p-6 transition-all duration-300 ${!isCoordinatorMode ? 'hidden' : 'block'}`}>
                <h1 className="text-2xl font-black text-gray-900 mb-2">Coordinator Login</h1>
                <p className="text-gray-600 text-xs mb-6">Sign in using your assigned KITS-EOS coordinator credentials.</p>
                
                <form onSubmit={handleCoordinatorSubmit} className="space-y-4">
                  {coordStatusMessage && (
                    <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-950 leading-relaxed font-medium">
                      {coordStatusMessage}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-800 mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      required
                      value={coordUsername}
                      onChange={(e) => setCoordUsername(e.target.value)}
                      placeholder="e.g. coord_paper_pres"
                      className="block w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-800 mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      value={coordPassword}
                      onChange={(e) => setCoordPassword(e.target.value)}
                      placeholder="••••••••"
                      className="block w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-sm focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={coordLoading}
                    className="w-full bg-kits-blue text-white py-3.5 px-6 rounded-xl font-bold text-sm shadow-md hover:bg-blue-800 active:scale-[0.98] transition disabled:opacity-50"
                  >
                    {coordLoading ? 'Authenticating...' : 'Login to Coordinator Portal'}
                  </button>
                </form>

                <div className="mt-8 pt-6 border-t border-gray-200 text-center">
                  <p className="text-xs text-gray-600 mb-2 font-semibold">Are you a System Administrator?</p>
                  <button
                    type="button"
                    onClick={() => setIsCoordinatorMode(false)}
                    className="inline-flex items-center text-xs font-bold text-kits-red hover:text-red-800 transition"
                  >
                    <span>← Administrator Login</span>
                  </button>
                </div>
             </div>
          </div>
        </div>

        {/* =========================================================================
            DESKTOP VIEW (Two Fixed Base Forms + Sliding Animated Solid Dark Overlay)
            ========================================================================= */}
        <div className="hidden lg:block w-full h-full absolute top-0 left-0 bg-white">
          
          {/* BASE LEFT PANEL: Administrator Login */}
          <div
            className={`absolute top-0 left-0 w-1/2 h-full flex flex-col justify-center px-16 transition-all duration-500 bg-white ${
              isCoordinatorMode ? 'opacity-0 pointer-events-none' : 'opacity-100 z-10'
            }`}
          >
            <BrandHeader />
            <div className="mt-2">
              <span className="text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-md bg-red-100 text-kits-red border border-red-200 inline-block mb-3">
                Staff Authentication
              </span>
              <h1 className="text-3xl lg:text-4xl font-black text-gray-900 tracking-tight mb-2">
                Administrator Login
              </h1>
              <p className="text-gray-600 text-xs mb-6 leading-relaxed max-w-sm font-medium">
                Secure access for authorized KITS-EOS administrators.
              </p>
              
              {expiredNotice && (
                <div className="mb-4 max-w-sm p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2.5 font-medium">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{expiredNotice}</span>
                </div>
              )}

              {user && !isLoading && (((role === 'ADMIN' && isAllowlisted) || role === 'PAYMENT_MANAGER') && status === 'ACTIVE') ? (
                <div className="w-full max-w-sm space-y-4 mb-4">
                  <p className="text-xs font-semibold text-green-800 bg-green-50 p-4 rounded-xl border border-green-200 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
                    <span>You are signed in as {role === 'PAYMENT_MANAGER' ? 'Payment Manager' : 'Administrator'}.</span>
                  </p>
                  <button 
                    onClick={handleContinueToPortal} 
                    className="w-full bg-kits-red text-white py-3.5 px-6 rounded-xl font-bold text-sm shadow-lg shadow-red-600/20 hover:bg-red-700 active:scale-[0.98] transition-all duration-200 cursor-pointer"
                  >
                    {role === 'PAYMENT_MANAGER' ? 'Continue to Payment Management' : 'Continue to Admin Portal'}
                  </button>
                </div>
              ) : (
                <div className="max-w-sm space-y-4">
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={adminLoading || isLoading}
                    className="w-full flex items-center justify-center py-3.5 px-5 border-2 border-gray-200 rounded-xl bg-white text-xs font-bold text-gray-800 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.98] transition disabled:opacity-50 shadow-sm cursor-pointer"
                  >
                    <svg className="w-4 h-4 mr-2.5 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    <span>Continue with Google Workspace SSO</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* BASE RIGHT PANEL: Coordinator Login */}
          <div
            className={`absolute top-0 right-0 w-1/2 h-full flex flex-col justify-center px-16 transition-all duration-500 bg-white ${
              isCoordinatorMode ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'
            }`}
          >
            <BrandHeader />
            <div className="mt-2 w-full max-w-sm">
              <span className="text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-md bg-blue-100 text-kits-blue border border-blue-200 inline-block mb-3">
                Event Operations
              </span>
              <h1 className="text-3xl lg:text-4xl font-black text-gray-900 tracking-tight mb-2">
                Coordinator Login
              </h1>
              <p className="text-gray-600 text-sm mb-6 leading-relaxed font-medium">
                Sign in using your assigned KITS-EOS coordinator credentials.
              </p>

              <form onSubmit={handleCoordinatorSubmit} className="space-y-4">
                {coordStatusMessage && (
                  <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-950 leading-relaxed flex items-start gap-2 font-medium">
                    <AlertCircle className="w-4 h-4 text-kits-blue shrink-0 mt-0.5" />
                    <span>{coordStatusMessage}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-800 mb-1">
                    Username
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
                      <User className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      required
                      value={coordUsername}
                      onChange={(e) => setCoordUsername(e.target.value)}
                      placeholder="e.g. coord_paper_pres"
                      className="block w-full rounded-xl border border-gray-300 pl-9 pr-3.5 py-2.5 text-sm text-gray-900 shadow-sm focus:border-kits-blue focus:ring-1 focus:ring-kits-blue transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-800 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
                      <Lock className="h-4 w-4" />
                    </div>
                    <input
                      type="password"
                      required
                      value={coordPassword}
                      onChange={(e) => setCoordPassword(e.target.value)}
                      placeholder="••••••••"
                      className="block w-full rounded-xl border border-gray-300 pl-9 pr-3.5 py-2.5 text-sm text-gray-900 shadow-sm focus:border-kits-blue focus:ring-1 focus:ring-kits-blue transition"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={coordLoading}
                  className="w-full bg-kits-blue text-white py-3.5 px-6 rounded-xl font-bold text-sm shadow-md hover:bg-blue-800 active:scale-[0.98] transition-all duration-200 disabled:opacity-50"
                >
                  {coordLoading ? 'Authenticating...' : 'Login to Coordinator Portal'}
                </button>
              </form>
            </div>
          </div>

          {/* =========================================================================
              SLIDING SOLID DARK OVERLAY CONTAINER
              Moves from right to left (and left to right) via CSS Transform
              ========================================================================= */}
          <div
            className={`absolute top-0 left-1/2 w-1/2 h-full overflow-hidden transition-transform duration-[650ms] cubic-bezier(0.65, 0, 0.35, 1) z-40 shadow-2xl bg-gray-950 ${
              isCoordinatorMode ? '-translate-x-full' : 'translate-x-0'
            }`}
          >
            {/* The 200% wide internal moving canvas inside the half-width viewport */}
            <div
              className={`relative -left-full h-full w-[200%] bg-gradient-to-br from-gray-950 via-slate-900 to-black text-white transform transition-transform duration-[650ms] cubic-bezier(0.65, 0, 0.35, 1) ${
                isCoordinatorMode ? 'translate-x-1/2' : 'translate-x-0'
              }`}
              style={{ backgroundColor: '#0B0F19' }}
            >
              {/* Institutional Ambient Glows */}
              <div 
                className="absolute inset-0 opacity-10 pointer-events-none" 
                style={{ 
                  backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', 
                  backgroundSize: '24px 24px' 
                }} 
              />
              <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-red-600 rounded-full filter blur-[100px] opacity-30" />
              <div className="absolute -top-32 -right-32 w-80 h-80 bg-blue-600 rounded-full filter blur-[100px] opacity-30" />

              {/* OVERLAY PANEL LEFT (Shown when in Coordinator View -> Prompts to switch to Administrator) */}
              <div
                className={`absolute top-0 left-0 w-1/2 h-full flex flex-col items-center justify-center px-12 text-center transition-all duration-[650ms] ${
                  isCoordinatorMode ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8 pointer-events-none'
                }`}
              >
                <div className="w-16 h-16 mb-6 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20 backdrop-blur-md shadow-2xl">
                   <ShieldCheck className="w-8 h-8 text-red-400" />
                </div>
                <span className="text-[11px] font-black uppercase tracking-[0.25em] text-red-400 mb-2 block">
                  SYSTEM CONTROL
                </span>
                <h2 className="text-2xl lg:text-3xl font-black mb-3 tracking-tight text-white drop-shadow-sm">
                  Administrator Access
                </h2>
                <p className="text-xs lg:text-sm text-slate-200 mb-8 leading-relaxed font-normal max-w-xs">
                  Manage the KITS-EOS event ecosystem, faculty assignments, category frameworks, and system-wide audits.
                </p>
                
                {/* HIGH-CONTRAST SOLID BUTTON */}
                <button
                  type="button"
                  onClick={() => setIsCoordinatorMode(false)}
                  className="group relative inline-flex items-center justify-center px-8 py-3.5 rounded-full bg-white text-gray-950 font-black text-xs uppercase tracking-wider hover:bg-slate-100 transition-all duration-200 shadow-xl active:scale-95 cursor-pointer focus:outline-none focus:ring-4 focus:ring-white/30"
                >
                  <ArrowLeft className="mr-2 h-4 w-4 transform group-hover:-translate-x-1 transition-transform text-red-600" />
                  <span>Administrator Login</span>
                </button>
              </div>

              {/* OVERLAY PANEL RIGHT (Shown when in Administrator View -> Prompts to switch to Coordinator) */}
              <div
                className={`absolute top-0 right-0 w-1/2 h-full flex flex-col items-center justify-center px-12 text-center transition-all duration-[650ms] ${
                  isCoordinatorMode ? 'opacity-0 translate-x-8 pointer-events-none' : 'opacity-100 translate-x-0'
                }`}
              >
                <div className="w-16 h-16 mb-6 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20 backdrop-blur-md shadow-2xl">
                   <Layers className="w-8 h-8 text-blue-400" />
                </div>
                <span className="text-[11px] font-black uppercase tracking-[0.25em] text-blue-400 mb-2 block">
                  EVENT OPERATIONS
                </span>
                <h2 className="text-2xl lg:text-3xl font-black mb-3 tracking-tight text-white drop-shadow-sm">
                  Coordinator Access
                </h2>
                <p className="text-xs lg:text-sm text-slate-200 mb-8 leading-relaxed font-normal max-w-xs">
                  Operate and manage your assigned sub-event workflows, participant check-ins, tokens, and logistics.
                </p>

                {/* HIGH-CONTRAST SOLID BUTTON */}
                <button
                  type="button"
                  onClick={() => setIsCoordinatorMode(true)}
                  className="group relative inline-flex items-center justify-center px-8 py-3.5 rounded-full bg-white text-gray-950 font-black text-xs uppercase tracking-wider hover:bg-slate-100 transition-all duration-200 shadow-xl active:scale-95 cursor-pointer focus:outline-none focus:ring-4 focus:ring-white/30"
                >
                  <span>Are you a Coordinator? Login here</span>
                  <ArrowRight className="ml-2 h-4 w-4 transform group-hover:translate-x-1 transition-transform text-blue-600" />
                </button>
              </div>

            </div>
          </div>

        </div>
      </div>
      
      {/* Universal Footer Branding */}
      <div className="mt-8 text-center px-4 relative z-10 hidden sm:block">
        <p className="text-[11px] font-bold tracking-widest text-gray-500 uppercase">
          &copy; {new Date().getFullYear()} KITS Akshar Institute of Technology • Event Operations System
        </p>
      </div>
    </div>
  );
}
