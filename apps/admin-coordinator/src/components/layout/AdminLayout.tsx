import { useState, useEffect, useLayoutEffect, useRef, Suspense } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { ScrollProgressBar } from '../ui/ScrollProgressBar';
import { LoadingState } from '../ui/LoadingState';
import {
  forceResetScrollLock,
  applyNavigationScrollPolicy,
  saveScrollPosition,
  CookieConsentBanner,
} from '@kits-eos/shared';

export function AdminLayout() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevPathnameRef = useRef<string | null>(null);

  // Continuously record scroll offsets for the inner layout container
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleContainerScroll = () => {
      saveScrollPosition(location.key, {
        x: window.scrollX,
        y: window.scrollY,
        containerY: el.scrollTop,
      });
    };

    el.addEventListener('scroll', handleContainerScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleContainerScroll);
  }, [location.key]);

  // Synchronously enforce navigation scroll policy on layout container commit
  useLayoutEffect(() => {
    setIsMobileSidebarOpen(false);
    forceResetScrollLock();

    applyNavigationScrollPolicy({
      navigationType,
      locationKey: location.key,
      currentPathname: location.pathname,
      previousPathname: prevPathnameRef.current,
      currentHash: location.hash,
      containerElement: scrollContainerRef.current,
      behavior: 'instant',
    });

    prevPathnameRef.current = location.pathname;
  }, [location.pathname, location.search, location.hash, location.key, navigationType]);

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
