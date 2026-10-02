import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isSessionValid } from '@kits-eos/shared';

export function ProtectedRoute() {
  const { user, role, status, isAllowlisted, authState, profileState, error } = useAuth();

  // 1. While auth session or profile resolution is in-flight: ALWAYS show loading
  // NEVER redirect during INITIALIZING or LOADING
  if (authState === 'INITIALIZING' || profileState === 'LOADING') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-kits-red mb-4"></div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Verifying Institutional Credentials...
        </p>
      </div>
    );
  }

  // 2. Unauthenticated or expired session: Redirect to login
  if (authState === 'UNAUTHENTICATED' || !user || !isSessionValid()) {
    return <Navigate to="/" replace />;
  }

  // 3. Authorization / profile error
  if (profileState === 'ERROR' || error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
        <div className="text-center p-8 bg-white shadow sm:rounded-lg max-w-md w-full border border-gray-200">
          <h2 className="text-2xl font-bold text-red-600 mb-4">System Error</h2>
          <p className="text-gray-600 mb-6">We encountered an error while verifying your authorization.</p>
          <p className="text-sm text-gray-500 bg-gray-100 p-3 rounded text-left overflow-hidden text-ellipsis whitespace-nowrap">
            {error?.message || 'Failed to verify administrative authorization profile.'}
          </p>
        </div>
      </div>
    );
  }

  // 4. Authenticated, but not authorized as active allowlisted ADMIN: Redirect to Access Denied
  if (role !== 'ADMIN' || status !== 'ACTIVE' || !isAllowlisted) {
    return <Navigate to="/access-denied" replace />;
  }

  return <Outlet />;
}
