import { useState, useEffect } from 'react';
import { useNavigate, Navigate, Outlet } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { ShieldAlert, AlertTriangle, LogOut } from 'lucide-react';
import { 
  getCoordinatorSessionToken, 
  clearCoordinatorSession,
  signOutCoordinator,
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
    assigned_assessment?: any;
    assigned_assessments?: any[];
  };
  active_assignments_count?: number;
  assignments?: any[];
  assigned_assessment?: any;
  assigned_assessments?: any[];
  active_assessment_count?: number;
  state_detail?: string;
  error?: string;
}

export function CoordinatorProtectedRoute() {
  const navigate = useNavigate();
  const [isValidating, setIsValidating] = useState(true);
  const [validationData, setValidationData] = useState<CoordinatorAccessValidation | null>(null);

  const handleCoordinatorSignOut = async () => {
    await signOutCoordinator(navigate);
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

  // 1. Not an authorized coordinator session
  if (!validationData || validationData.access_state === 'NOT_FOUND' || validationData.access_state === 'UNAUTHORIZED') {
    clearCoordinatorSession();
    return <Navigate to="/" replace />;
  }

  // 2. Suspended or Inactive Coordinator — strictly block ALL portal and selection routes
  if (validationData.access_state === 'INACTIVE_OR_SUSPENDED' || (validationData.coordinator && validationData.coordinator.status !== 'ACTIVE')) {
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

  // 3. System or Network Error
  if (validationData.access_state === 'ERROR') {
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

  // 4. Payment Manager dedicated routing — must NEVER access general Coordinator console
  if (validationData.coordinator?.coordinator_type === 'PAYMENT_MANAGER') {
    return <Navigate to="/payment-management" replace />;
  }

  const pathname = window.location.pathname;
  const isSelectRoute = pathname.includes('/coordinator/select');
  const isAssessmentRoute = pathname.includes('/assessment-host');
  const isDedicatedAssessmentCoord = validationData.coordinator?.coordinator_type === 'ASSESSMENT_COORDINATOR';
  const hasAssessmentAssignment = Boolean(
    validationData.assigned_assessment?.id || 
    validationData.coordinator?.assigned_assessment?.id ||
    (validationData.assigned_assessments && validationData.assigned_assessments.length > 0)
  );
  const hasEventAssignments = Boolean(
    (validationData.active_assignments_count && validationData.active_assignments_count > 0) ||
    (validationData.assignments && validationData.assignments.length > 0)
  );

  // 5. Assignment Selection Route (/coordinator/select)
  // Accessible to any active coordinator to review assignments or view empty state
  if (isSelectRoute) {
    return (
      <>
        <SessionExpiryNotice />
        <Outlet context={validationData} />
      </>
    );
  }

  // 6. Dedicated Assessment Coordinator account: Must route to Live Host console
  if (isDedicatedAssessmentCoord) {
    if (!isAssessmentRoute) {
      return <Navigate to="/coordinator/assessment-host" replace />;
    }
    return (
      <>
        <SessionExpiryNotice />
        <Outlet context={validationData} />
      </>
    );
  }

  // 7. Coordinator on /coordinator/assessment-host WITHOUT assessment duties:
  // Intercept and redirect to Event Operations or Selection screen
  if (isAssessmentRoute && !hasAssessmentAssignment) {
    return <Navigate to={hasEventAssignments ? "/coordinator" : "/coordinator/select"} replace />;
  }

  // 8. Coordinator on /coordinator (Event Operations) WITHOUT event duties:
  // Intercept and redirect to Assessment Live Host or Selection screen
  if (!isAssessmentRoute && !hasEventAssignments) {
    if (hasAssessmentAssignment) {
      return <Navigate to="/coordinator/assessment-host" replace />;
    }
    return <Navigate to="/coordinator/select" replace />;
  }

  // 9. Authorized on the active route
  return (
    <>
      <SessionExpiryNotice />
      <Outlet context={validationData} />
    </>
  );
}
