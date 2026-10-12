import { fetchStudentDashboardData } from './dashboardDataService';

/**
 * Preload route component bundles dynamically in the background.
 * Ensures the target page's chunk is in browser cache before React Router navigates,
 * preventing Suspense fallback flicker.
 */
export async function preloadTargetPageComponent(pathname: string): Promise<void> {
  try {
    const cleanPath = pathname.split('?')[0].split('#')[0];
    if (cleanPath === '/dashboard' || cleanPath === '/' || cleanPath === '/student') {
      await import('../pages/StudentDashboard');
    } else if (cleanPath === '/my-registrations' || cleanPath === '/registrations') {
      await import('../pages/MyRegistrations');
    } else if (cleanPath === '/profile') {
      await import('../pages/Profile');
    } else if (cleanPath === '/complete-profile') {
      await import('../pages/CompleteProfile');
    } else if (cleanPath === '/events') {
      await import('../pages/EventsList');
    } else if (cleanPath === '/certificates' || cleanPath === '/results' || cleanPath === '/achievements') {
      await import('../pages/StudentCertificates');
    } else if (cleanPath === '/attendance') {
      await import('../pages/StudentAttendance');
    } else if (cleanPath === '/notifications') {
      await import('../pages/StudentNotifications');
    } else if (cleanPath === '/feedback') {
      await import('../pages/StudentFeedback');
    } else if (cleanPath === '/complaints') {
      await import('../pages/StudentComplaints');
    }
  } catch (err) {
    // Non-fatal: if preloading chunk encounters an error, normal route navigation Suspense handles it
    console.warn('Target page component preload notice:', err);
  }
}

/**
 * Preload required target page data in the background.
 * Ensures initial authoritative data is ready before the component mounts.
 */
export async function preloadTargetPageData(pathname: string, userId: string): Promise<void> {
  try {
    const cleanPath = pathname.split('?')[0].split('#')[0];
    if (cleanPath === '/dashboard' || cleanPath === '/' || cleanPath === '/student') {
      await fetchStudentDashboardData(userId);
    }
  } catch (err) {
    // Non-fatal: if preloading data fails, page's own fetch handles it
    console.warn('Target page data preload notice:', err);
  }
}
