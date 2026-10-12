import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isSessionValid } from '@kits-eos/shared';
import { AccountSuspendedScreen } from './AccountSuspendedScreen';

export function ProtectedRoute() {
  const { user, profile, suspendedInfo, isLoading, isAuthTransitioning } = useAuth();
  const location = useLocation();

  if (isLoading || isAuthTransitioning) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kits-red"></div>
      </div>
    );
  }

  // Synchronously enforce active session marker and 15-minute boundary
  if (!user || !isSessionValid()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (suspendedInfo) {
    return <AccountSuspendedScreen />;
  }

  // If student profile has not been completed, enforce completion before entering protected student features
  if (!profile) {
    return <Navigate to="/complete-profile" replace />;
  }

  return <Outlet />;
}
