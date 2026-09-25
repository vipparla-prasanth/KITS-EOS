import { useEffect, useLayoutEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { StudentLayout } from './components/layout/StudentLayout';
import { forceResetScrollLock, initScrollRestoration, scrollToPageTop, handleHashScroll } from '@kits-eos/shared';

// Eagerly loaded critical landing page
import { Home } from './pages/Home';

// Route-level code-split pages
const AboutKeos = lazy(() => import('./pages/AboutKeos').then(m => ({ default: m.AboutKeos })));
const Vision = lazy(() => import('./pages/Vision').then(m => ({ default: m.Vision })));
const ContactCoordinators = lazy(() => import('./pages/ContactCoordinators').then(m => ({ default: m.ContactCoordinators })));
const TechSupport = lazy(() => import('./pages/TechSupport').then(m => ({ default: m.TechSupport })));
const TermsAndConditions = lazy(() => import('./pages/TermsAndConditions').then(m => ({ default: m.TermsAndConditions })));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy').then(m => ({ default: m.PrivacyPolicy })));
const PublicCertificateVerification = lazy(() => import('./pages/PublicCertificateVerification').then(m => ({ default: m.PublicCertificateVerification })));
const NotFound = lazy(() => import('./pages/NotFound').then(m => ({ default: m.NotFound })));
const EventsList = lazy(() => import('./pages/EventsList').then(m => ({ default: m.EventsList })));
const EventDetails = lazy(() => import('./pages/EventDetails').then(m => ({ default: m.EventDetails })));
const CategoryDetails = lazy(() => import('./pages/CategoryDetails').then(m => ({ default: m.CategoryDetails })));
const SubEventDetails = lazy(() => import('./pages/SubEventDetails').then(m => ({ default: m.SubEventDetails })));
const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const SubEventRegister = lazy(() => import('./pages/SubEventRegister').then(m => ({ default: m.SubEventRegister })));
const MyRegistrations = lazy(() => import('./pages/MyRegistrations').then(m => ({ default: m.MyRegistrations })));
const StudentDashboard = lazy(() => import('./pages/StudentDashboard').then(m => ({ default: m.StudentDashboard })));
const StudentAttendance = lazy(() => import('./pages/StudentAttendance').then(m => ({ default: m.StudentAttendance })));
const StudentCertificates = lazy(() => import('./pages/StudentCertificates').then(m => ({ default: m.StudentCertificates })));
const StudentFeedback = lazy(() => import('./pages/StudentFeedback').then(m => ({ default: m.StudentFeedback })));
const StudentComplaints = lazy(() => import('./pages/StudentComplaints').then(m => ({ default: m.StudentComplaints })));
const StudentNotifications = lazy(() => import('./pages/StudentNotifications').then(m => ({ default: m.StudentNotifications })));
const Profile = lazy(() => import('./pages/Profile').then(m => ({ default: m.Profile })));

function StudentPageLoadingFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="flex flex-col items-center space-y-4">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-kits-red border-t-transparent"></div>
        <p className="text-xs font-semibold text-gray-500 tracking-wider uppercase">
          Loading KITS Student Portal...
        </p>
      </div>
    </div>
  );
}

function ScrollManager() {
  const location = useLocation();

  useEffect(() => {
    initScrollRestoration();
  }, []);

  useLayoutEffect(() => {
    forceResetScrollLock();

    const isOAuthHash = Boolean(
      location.hash && (
        location.hash.includes('access_token=') ||
        location.hash.includes('refresh_token=') ||
        location.hash.includes('error=') ||
        location.hash.includes('code=')
      )
    );

    if (location.hash && !isOAuthHash) {
      handleHashScroll(location.hash);
    } else {
      scrollToPageTop({ behavior: 'instant' });
    }
  }, [location.pathname, location.hash]);

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollManager />
        <Suspense fallback={<StudentPageLoadingFallback />}>
          <Routes>
            {/* Public & Student Shared Institutional Shell */}
            <Route element={<StudentLayout />}>
              {/* 1. Public Master Pages */}
              <Route path="/" element={<Home />} />
              <Route path="/about-keos" element={<AboutKeos />} />
              <Route path="/vision" element={<Vision />} />
              <Route path="/contact-coordinators" element={<ContactCoordinators />} />
              <Route path="/tech-support" element={<TechSupport />} />
              <Route path="/terms" element={<TermsAndConditions />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/cookies" element={<PrivacyPolicy />} />
              <Route path="/cookie-policy" element={<PrivacyPolicy />} />

              {/* 2. Public Event Hierarchy */}
              <Route path="/events" element={<EventsList />} />
              <Route path="/events/:eventId" element={<EventDetails />} />
              <Route path="/events/:eventId/categories/:categoryId" element={<CategoryDetails />} />
              <Route path="/events/:eventId/sub-events/:subEventId" element={<SubEventDetails />} />
              <Route path="/events/:eventId/categories/:categoryId/sub-events/:subEventId" element={<SubEventDetails />} />

              {/* 3. Public Certificate Verification (No Login Required) */}
              <Route path="/verify" element={<PublicCertificateVerification />} />
              <Route path="/verify/:certId" element={<PublicCertificateVerification />} />
              <Route path="/verify-certificate" element={<PublicCertificateVerification />} />
              <Route path="/verify-certificate/:certId" element={<PublicCertificateVerification />} />

              {/* 4. Student Authentication */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Login />} />
              <Route path="/student" element={<Navigate to="/dashboard" replace />} />

              {/* 5. Protected Student Operations */}
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<StudentDashboard />} />
                <Route path="/events/:eventId/sub-events/:subEventId/register" element={<SubEventRegister />} />
                <Route path="/events/:eventId/categories/:categoryId/sub-events/:subEventId/register" element={<SubEventRegister />} />
                <Route path="/my-registrations" element={<MyRegistrations />} />
                <Route path="/registrations" element={<MyRegistrations />} />
                <Route path="/attendance" element={<StudentAttendance />} />
                <Route path="/certificates" element={<StudentCertificates />} />
                <Route path="/achievements" element={<StudentCertificates />} />
                <Route path="/results" element={<StudentCertificates />} />
                <Route path="/feedback" element={<StudentFeedback />} />
                <Route path="/complaints" element={<StudentComplaints />} />
                <Route path="/notifications" element={<StudentNotifications />} />
                <Route path="/profile" element={<Profile />} />
              </Route>

              {/* 404 Not Found Handling */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
