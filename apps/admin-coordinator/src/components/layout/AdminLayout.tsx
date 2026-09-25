import { useState, useLayoutEffect, useRef, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { ScrollProgressBar } from '../ui/ScrollProgressBar';
import { LoadingState } from '../ui/LoadingState';
import { forceResetScrollLock, scrollToPageTop, CookieConsentBanner } from '@kits-eos/shared';

export function AdminLayout() {
  const location = useLocation();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Automatically close mobile sidebar drawer, release scroll locks, and reset scroll position on route navigation
  useLayoutEffect(() => {
    setIsMobileSidebarOpen(false);
    forceResetScrollLock();
    scrollToPageTop({ behavior: 'instant' });
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-gray-50 font-sans overflow-hidden selection:bg-red-100 selection:text-kits-red">
      <ScrollProgressBar />
      
      {/* Responsive Admin Sidebar (Permanent on Desktop, Slide Drawer on Mobile/Tablet) */}
      <AdminSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />

      <div ref={scrollContainerRef} className="flex-1 flex flex-col overflow-y-auto min-w-0">
        <AdminHeader onToggleSidebar={() => setIsMobileSidebarOpen(true)} />
        
        {/* Responsive Content Container */}
        <main 
          key={location.pathname}
          className="flex-1 px-3 sm:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8 pb-16 max-w-7xl w-full mx-auto space-y-6 page-enter"
        >
          <Suspense fallback={<LoadingState message="Loading operational module..." />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <CookieConsentBanner />
    </div>
  );
}
