import { Suspense, lazy, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isSessionValid } from '@kits-eos/shared';
import { StudentNavbar } from './StudentNavbar';
import { StudentFooter } from './StudentFooter';
import { ScrollProgressBar } from '../ui/ScrollProgressBar';
import { LoadingState } from '../ui/LoadingState';
import { StudentPageLoadingFallback } from '../ui/StudentPageLoadingFallback';
import { AppUpdateNotification } from '../ui/AppUpdateNotification';
import { initializeAppUpdateService } from '../../services/appUpdateService';

const KeosAssistant = lazy(() => import('../assistant/KeosAssistant').then(m => ({ default: m.KeosAssistant })));
const CookieConsentBanner = lazy(() => import('@kits-eos/shared/src/components/CookieConsentBanner').then(m => ({ default: m.CookieConsentBanner })));

export function StudentLayout() {
  const { isLoading, isAuthTransitioning } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const cleanup = initializeAppUpdateService();
    return () => cleanup();
  }, []);

  const isProtectedPath = [
    '/dashboard',
    '/my-registrations',
    '/registrations',
    '/attendance',
    '/certificates',
    '/achievements',
    '/results',
    '/feedback',
    '/complaints',
    '/notifications',
    '/profile',
    '/complete-profile'
  ].some(p => location.pathname.startsWith(p));

  const isAuthRoute = location.pathname === '/login' || location.pathname === '/signup';

  // Intermediate authenticated loading occurs during active session bootstrap for protected paths
  // or when an authenticated session transitions into protected routes.
  // Unauthenticated auth routes (/login, /signup) must NEVER be unmounted by transition state.
  const isIntermediateLoading = (!isAuthRoute && isAuthTransitioning) || (isLoading && (isProtectedPath || isSessionValid()));

  if (isIntermediateLoading) {
    return <StudentPageLoadingFallback message={isAuthTransitioning ? 'Authenticating student session...' : 'Loading KITS Student Portal...'} />;
  }

  // Dedicated full-screen examination viewport for active assessment attempts
  const isExamAttempt = Boolean(location.pathname.match(/\/assessments\/[^/]+\/attempt/));
  if (isExamAttempt) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col font-sans select-none overflow-x-clip">
        <Suspense fallback={<StudentPageLoadingFallback message="Initializing Examination Cockpit..." />}>
          <Outlet />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans selection:bg-red-100 selection:text-kits-red overflow-x-clip">
      <ScrollProgressBar />
      <StudentNavbar />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Suspense fallback={<LoadingState message="Loading page..." />}>
          <Outlet />
        </Suspense>
      </main>
      <StudentFooter />
      <Suspense fallback={null}>
        <KeosAssistant />
      </Suspense>
      <Suspense fallback={null}>
        <CookieConsentBanner />
      </Suspense>
      <AppUpdateNotification />
    </div>
  );
}

