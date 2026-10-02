import { useEffect, useLayoutEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { CoordinatorProtectedRoute } from './components/CoordinatorProtectedRoute';
import { PaymentManagerProtectedRoute } from './components/PaymentManagerProtectedRoute';
import { AdminLayout } from './components/layout/AdminLayout';
import { forceResetScrollLock, initScrollRestoration, scrollToPageTop, handleHashScroll } from '@kits-eos/shared';

// Eagerly loaded critical landing page
import { Login } from './pages/Login';

// Route-level code-split pages
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const AccessDenied = lazy(() => import('./pages/AccessDenied').then(m => ({ default: m.AccessDenied })));
const NotFound = lazy(() => import('./pages/NotFound').then(m => ({ default: m.NotFound })));
const EventsList = lazy(() => import('./pages/Events').then(m => ({ default: m.EventsList })));
const CreateEvent = lazy(() => import('./pages/Events/Create').then(m => ({ default: m.CreateEvent })));
const EventDetails = lazy(() => import('./pages/Events/Details').then(m => ({ default: m.EventDetails })));
const EditEvent = lazy(() => import('./pages/Events/Edit').then(m => ({ default: m.EditEvent })));
const CreateCategory = lazy(() => import('./pages/Categories/Create').then(m => ({ default: m.CreateCategory })));
const CategoryDetails = lazy(() => import('./pages/Categories/Details').then(m => ({ default: m.CategoryDetails })));
const EditCategory = lazy(() => import('./pages/Categories/Edit').then(m => ({ default: m.EditCategory })));
const CreateSubEvent = lazy(() => import('./pages/SubEvents/Create').then(m => ({ default: m.CreateSubEvent })));
const SubEventDetails = lazy(() => import('./pages/SubEvents/Details').then(m => ({ default: m.SubEventDetails })));
const EditSubEvent = lazy(() => import('./pages/SubEvents/Edit').then(m => ({ default: m.EditSubEvent })));
const CoordinatorsList = lazy(() => import('./pages/Coordinators').then(m => ({ default: m.CoordinatorsList })));
const RegistrationsList = lazy(() => import('./pages/Registrations').then(m => ({ default: m.RegistrationsList })));
const PaymentsList = lazy(() => import('./pages/Payments').then(m => ({ default: m.PaymentsList })));
const AttendanceList = lazy(() => import('./pages/Attendance').then(m => ({ default: m.AttendanceList })));
const ResultsList = lazy(() => import('./pages/Results').then(m => ({ default: m.ResultsList })));
const FeedbackList = lazy(() => import('./pages/Feedback').then(m => ({ default: m.FeedbackList })));
const ComplaintsList = lazy(() => import('./pages/Complaints').then(m => ({ default: m.ComplaintsList })));
const StudentsList = lazy(() => import('./pages/Students').then(m => ({ default: m.StudentsList })));
const SuspensionRequestsList = lazy(() => import('./pages/SuspensionRequests').then(m => ({ default: m.SuspensionRequestsList })));
const NotificationsList = lazy(() => import('./pages/Notifications').then(m => ({ default: m.NotificationsList })));
const CoordinatorPortal = lazy(() => import('./pages/Coordinator').then(m => ({ default: m.CoordinatorPortal })));
const Analytics = lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })));
const PrivacyManagement = lazy(() => import('./pages/Privacy').then(m => ({ default: m.PrivacyManagement })));
const PaymentManagement = lazy(() => import('./pages/PaymentManagement').then(m => ({ default: m.PaymentManagement })));
const ManageStalls = lazy(() => import('./pages/Stalls').then(m => ({ default: m.ManageStalls })));

function PageLoadingFallback({ message = 'Loading institutional portal...' }: { message?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="flex flex-col items-center space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-kits-red border-t-transparent"></div>
        <p className="text-xs font-semibold text-gray-500 tracking-wider uppercase">
          {message}
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

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollManager />
        <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/adminlogin" element={<Login />} />
            <Route path="/access-denied" element={<AccessDenied />} />
            <Route path="/coordinator" element={<CoordinatorProtectedRoute />}>
              <Route index element={<CoordinatorPortal />} />
            </Route>
            <Route path="/payment-management" element={<PaymentManagerProtectedRoute />}>
              <Route index element={<PaymentManagement />} />
            </Route>
            <Route path="/analytics" element={<Navigate to="/admin/analytics" replace />} />
            <Route path="/manage-stalls" element={<Navigate to="/admin/stalls" replace />} />

            {/* Protected Routes (ADMIN only) wrapped in Admin Shell */}
            <Route path="/admin" element={<ProtectedRoute />}>
              <Route element={<AdminLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="events" element={<EventsList />} />
                <Route path="stalls" element={<ManageStalls />} />
                <Route path="events/new" element={<CreateEvent />} />
                <Route path="events/:eventId" element={<EventDetails />} />
                <Route path="events/:eventId/edit" element={<EditEvent />} />

                {/* Operational Modules */}
                <Route path="coordinators" element={<CoordinatorsList />} />
                <Route path="registrations" element={<RegistrationsList />} />
                <Route path="payments" element={<PaymentsList />} />
                <Route path="attendance" element={<AttendanceList />} />
                <Route path="results" element={<ResultsList />} />
                <Route path="certificates" element={<Navigate to="/admin/results" replace />} />
                <Route path="feedback" element={<FeedbackList />} />
                <Route path="complaints" element={<ComplaintsList />} />
                <Route path="students" element={<StudentsList />} />
                <Route path="suspension-requests" element={<SuspensionRequestsList />} />
                <Route path="notifications" element={<NotificationsList />} />
                <Route path="privacy" element={<PrivacyManagement />} />
                <Route path="audit-logs" element={<Navigate to="/admin" replace />} />
                
                {/* Category Routes */}
                <Route path="events/:eventId/categories/new" element={<CreateCategory />} />
                <Route path="events/:eventId/categories/:categoryId" element={<CategoryDetails />} />
                <Route path="events/:eventId/categories/:categoryId/edit" element={<EditCategory />} />
                
                {/* Sub-event Routes (under Category) */}
                <Route path="events/:eventId/categories/:categoryId/sub-events/new" element={<CreateSubEvent />} />
                <Route path="events/:eventId/categories/:categoryId/sub-events/:subEventId" element={<SubEventDetails />} />
                <Route path="events/:eventId/categories/:categoryId/sub-events/:subEventId/edit" element={<EditSubEvent />} />
                
                {/* Direct Sub-event Routes (under Event) */}
                <Route path="events/:eventId/sub-events/new" element={<CreateSubEvent />} />
                <Route path="events/:eventId/sub-events/:subEventId" element={<SubEventDetails />} />
                <Route path="events/:eventId/sub-events/:subEventId/edit" element={<EditSubEvent />} />
                
                {/* Invalid nested admin route -> 404 inside Admin shell */}
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>

            {/* Unmatched root route -> 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
