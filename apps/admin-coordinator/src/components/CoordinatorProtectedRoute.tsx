import { useState, useEffect } from 'react';
import { useNavigate, Navigate, Outlet } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { ShieldAlert, AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import { 
  getCoordinatorSessionToken, 
  clearCoordinatorSession 
} from '../utils/coordinatorSession';
import { 
  isSessionValid, 
  setSessionExpiredNotice, 
  SessionExpiryNotice 
} from '@kits-eos/shared';

export interface CoordinatorAccessValidation {
  access_state: 'AUTHORIZED' | 'NO_ASSIGNMENTS' | 'INACTIVE_OR_SUSPENDED' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'ERROR';
  coordinator?: {
    id: string;
    username: string;
    display_name: string;
    phone_number?: string;
    coordinator_type?: string;
    status?: string;
  };
  active_assignments_count?: number;
  assignments?: any[];
  error?: string;
}

export function CoordinatorProtectedRoute() {
  const navigate = useNavigate();
  const [isValidating, setIsValidating] = useState(true);
  const [validationData, setValidationData] = useState<CoordinatorAccessValidation | null>(null);

  const handleCoordinatorSignOut = async () => {
    const token = getCoordinatorSessionToken();
    if (token) {
      try {
        await supabase.rpc('invalidate_coordinator_session', { p_token: token });
      } catch {
        // silent
      }
    }
    clearCoordinatorSession();
    navigate('/', { replace: true });
  };

  const validateAccess = async () => {
    const token = getCoordinatorSessionToken();
    if (!token || !isSessionValid()) {
      clearCoordinatorSession();
      setValidationData({ access_state: 'UNAUTHORIZED' });
      setIsValidating(false);
      return;
    }

    try {
      setIsValidating(true);
      const { data, error } = await supabase.rpc('validate_coordinator_session', {
        p_token: token
      });

      if (error) {
        console.error('Coordinator session validation RPC error code:', error.code);
        setValidationData({
          access_state: 'ERROR',
          error: 'Unable to verify coordinator assignments.'
        });
        return;
      }

      if (data?.access_state === 'INVALID_SESSION') {
        setSessionExpiredNotice(data.error || 'Your session has expired. Please log in again.');
        clearCoordinatorSession();
        setValidationData({ access_state: 'UNAUTHORIZED' });
        return;
      }

      if (data) {
        setValidationData(data as CoordinatorAccessValidation);
      } else {
        setValidationData({ access_state: 'NOT_FOUND' });
      }
    } catch {
      setValidationData({
        access_state: 'ERROR',
        error: 'A network error occurred while verifying coordinator credentials.'
      });
    } finally {
      setIsValidating(false);
    }
  };

  useEffect(() => {
    validateAccess();
  }, []);

  if (isValidating) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-kits-red border-t-transparent"></div>
          <p className="text-xs font-semibold text-gray-500 tracking-wider uppercase">
            Verifying Institutional Coordinator Authorization...
          </p>
        </div>
      </div>
    );
  }

  // Payment Manager dedicated routing — must NEVER access the general Coordinator console
  if (validationData?.coordinator?.coordinator_type === 'PAYMENT_MANAGER') {
    return <Navigate to="/payment-management" replace />;
  }

  // Case 2: ACTIVE Coordinator but ZERO Active Assignments (e.g. Sub-event Deleted)
  if (validationData?.access_state === 'NO_ASSIGNMENTS') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center shadow-sm">
              <AlertTriangle className="h-7 w-7 text-amber-600" />
            </div>
          </div>
          <h2 className="text-center text-2xl font-black text-gray-900 tracking-tight">
            Coordinator Access Unavailable
          </h2>
          <p className="mt-2 text-center text-xs text-gray-600 max-w-sm mx-auto">
            Your coordinator account is active, but you currently do not have an active event or sub-event assignment.
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
          <div className="bg-white py-8 px-6 shadow-sm border border-gray-200 rounded-2xl space-y-6">
            {validationData.coordinator && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500 font-medium">Coordinator Name:</span>
                  <span className="font-bold text-gray-900">{validationData.coordinator.display_name}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500 font-medium">Username:</span>
                  <span className="font-mono font-bold text-gray-700">{validationData.coordinator.username}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500 font-medium">Role:</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                    {validationData.coordinator.coordinator_type || 'COORDINATOR'}
                  </span>
                </div>
              </div>
            )}

            <div className="text-xs text-gray-500 bg-amber-50/60 p-3.5 rounded-xl border border-amber-100 leading-relaxed">
              If your assigned sub-event was recently concluded, archived, or restructured, access to operational rosters and attendance verification is restricted. Please contact the Event Administrator for assignment renewal.
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => validateAccess()}
                className="flex-1 inline-flex justify-center items-center px-4 py-2.5 border border-gray-300 text-xs font-bold rounded-xl text-gray-700 bg-white hover:bg-gray-50 transition shadow-sm"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Check Assignments
              </button>
              <button
                onClick={() => handleCoordinatorSignOut()}
                className="flex-1 inline-flex justify-center items-center px-4 py-2.5 border border-transparent text-xs font-bold rounded-xl text-white bg-gray-900 hover:bg-black transition shadow-sm"
              >
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Case 3: Suspended or Inactive Coordinator
  if (validationData?.access_state === 'INACTIVE_OR_SUSPENDED') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center shadow-sm">
              <ShieldAlert className="h-7 w-7 text-red-600" />
            </div>
          </div>
          <h2 className="text-center text-2xl font-black text-gray-900 tracking-tight">
            Account Inactive or Suspended
          </h2>
          <p className="mt-2 text-center text-xs text-gray-600 max-w-sm mx-auto">
            Your institutional coordinator credentials have been deactivated.
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
          <div className="bg-white py-8 px-6 shadow-sm border border-gray-200 rounded-2xl space-y-6">
            <p className="text-xs text-gray-500 leading-relaxed text-center">
              Please contact the Administrator or Principal Office to review your account status.
            </p>
            <button
              onClick={() => handleCoordinatorSignOut()}
              className="w-full inline-flex justify-center items-center px-4 py-2.5 border border-transparent text-xs font-bold rounded-xl text-white bg-gray-900 hover:bg-black transition shadow-sm"
            >
              <LogOut className="mr-1.5 h-3.5 w-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Case: System or Network Error
  if (validationData?.access_state === 'ERROR') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
          <div className="bg-white py-8 px-6 shadow-sm border border-red-200 rounded-2xl space-y-4 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-50 flex items-center justify-center text-red-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h3 className="text-base font-bold text-gray-900">Authorization Verification Error</h3>
            <p className="text-xs text-gray-600">{validationData.error || 'Failed to verify coordinator authorization state.'}</p>
            <div className="pt-4 flex gap-3">
              <button
                onClick={() => validateAccess()}
                className="flex-1 py-2 px-4 border border-gray-300 rounded-xl text-xs font-semibold text-gray-700 hover:bg-gray-50 transition"
              >
                Retry
              </button>
              <button
                onClick={() => handleCoordinatorSignOut()}
                className="flex-1 py-2 px-4 bg-gray-900 text-white rounded-xl text-xs font-semibold hover:bg-black transition"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Case: Not an authorized coordinator session
  if (!validationData || validationData?.access_state === 'NOT_FOUND' || validationData?.access_state === 'UNAUTHORIZED') {
    clearCoordinatorSession();
    return <Navigate to="/" replace />;
  }

  // Case 1: AUTHORIZED - Render the coordinator portal
  return (
    <>
      <SessionExpiryNotice />
      <Outlet context={validationData} />
    </>
  );
}
