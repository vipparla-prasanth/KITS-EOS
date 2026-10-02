import { useState, useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCoordinatorSessionToken, clearCoordinatorSession } from '../utils/coordinatorSession';
import { supabase } from '@kits-eos/shared/src/api/client';
import { isSessionValid, SessionExpiryNotice } from '@kits-eos/shared';

export function PaymentManagerProtectedRoute() {
  const { user, role, status, isAllowlisted, authState, profileState } = useAuth();
  const [isValidatingCoord, setIsValidatingCoord] = useState(true);
  const [coordAuthorized, setCoordAuthorized] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkCoordinatorAuth() {
      const token = getCoordinatorSessionToken();
      if (!token || !isSessionValid()) {
        if (isMounted) {
          setCoordAuthorized(false);
          setIsValidatingCoord(false);
        }
        return;
      }

      try {
        const { data, error: rpcErr } = await supabase.rpc('validate_coordinator_session', {
          p_token: token,
        });

        if (isMounted) {
          if (!rpcErr && data?.access_state === 'AUTHORIZED' && data?.coordinator?.coordinator_type === 'PAYMENT_MANAGER') {
            setCoordAuthorized(true);
          } else {
            setCoordAuthorized(false);
            if (data?.access_state === 'INVALID_SESSION' || data?.access_state === 'INACTIVE_OR_SUSPENDED') {
              clearCoordinatorSession();
            }
          }
          setIsValidatingCoord(false);
        }
      } catch {
        if (isMounted) {
          setCoordAuthorized(false);
          setIsValidatingCoord(false);
        }
      }
    }

    checkCoordinatorAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  // 1. Loading state during auth/profile resolution or coordinator token validation
  if (isValidatingCoord || authState === 'INITIALIZING' || profileState === 'LOADING') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-kits-red mb-4"></div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Verifying Payment Manager Authorization...
        </p>
      </div>
    );
  }

  // 2. If valid coordinator session as PAYMENT_MANAGER, grant access
  if (coordAuthorized && isSessionValid()) {
    return (
      <>
        <SessionExpiryNotice />
        <Outlet />
      </>
    );
  }

  // 3. If valid Supabase Auth user as ACTIVE PAYMENT_MANAGER or allowlisted ADMIN, grant access
  const isAuthUserAuthorized = !!user && isSessionValid() && status === 'ACTIVE' && (
    role === 'PAYMENT_MANAGER' || 
    (role === 'ADMIN' && isAllowlisted)
  );

  if (isAuthUserAuthorized) {
    return (
      <>
        <SessionExpiryNotice />
        <Outlet />
      </>
    );
  }

  // 4. If logged in via Supabase Auth with non-authorized role, redirect to access-denied
  if (user && !isAuthUserAuthorized && isSessionValid()) {
    return <Navigate to="/access-denied" replace />;
  }

  // 5. Unauthenticated: Redirect to login
  return <Navigate to="/" replace />;
}
