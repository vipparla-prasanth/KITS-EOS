import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { StudentNavbar } from './StudentNavbar';
import { StudentFooter } from './StudentFooter';
import { ScrollProgressBar } from '../ui/ScrollProgressBar';
import { KeosAssistant } from '../assistant/KeosAssistant';
import { LoadingState } from '../ui/LoadingState';
import { CookieConsentBanner } from '@kits-eos/shared';

export function StudentLayout() {
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
      <KeosAssistant />
      <CookieConsentBanner />
    </div>
  );
}
