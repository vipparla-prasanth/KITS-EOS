import { useState, useEffect } from 'react';
import type { ActiveAppMode, CoordinatorSession } from './types';
import { Header } from './components/Header';
import { PublicPortal } from './components/PublicPortal';
import { CoordinatorPortal } from './components/CoordinatorPortal';
import { getStoredCoordinatorSession, clearStoredCoordinatorSession } from './utils/authUtils';
import { CookieConsentBanner, openCookiePreferencesModal, KitsNotFound } from '@kits-eos/shared';

function isRouteInvalid(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const valid = ['/', '/fallback', '/index.html', '/fallback/index.html'];
  return !valid.includes(clean);
}

export function App() {
  const [activeMode, setActiveMode] = useState<ActiveAppMode>('PUBLIC');
  const [coordinatorSession, setCoordinatorSession] = useState<CoordinatorSession | null>(null);
  const [isNotFound, setIsNotFound] = useState(() => isRouteInvalid(window.location.pathname));

  // Sync with browser navigation
  useEffect(() => {
    const handlePopState = () => {
      setIsNotFound(isRouteInvalid(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Restore existing session from storage if still valid
  useEffect(() => {
    const session = getStoredCoordinatorSession();
    if (session?.isAuthenticated) {
      setCoordinatorSession(session);
    }
  }, []);

  const handleLoginSuccess = (session: CoordinatorSession) => {
    setCoordinatorSession(session);
    setActiveMode('COORDINATOR');
  };

  const handleLogout = () => {
    clearStoredCoordinatorSession();
    setCoordinatorSession(null);
    setActiveMode('PUBLIC');
  };

  const handleNavigateHome = () => {
    window.history.pushState({}, '', '/');
    setIsNotFound(false);
    setActiveMode('PUBLIC');
  };

  return (
    <div className="min-h-screen flex flex-col justify-between text-slate-800 selection:bg-red-100 selection:text-kits-red font-sans">
      {/* 1. FLOATING HEADER */}
      <Header
        activeMode={activeMode}
        setActiveMode={(mode) => {
          if (isNotFound) {
            window.history.pushState({}, '', '/');
            setIsNotFound(false);
          }
          setActiveMode(mode);
        }}
        coordinatorSession={coordinatorSession}
        onLogout={handleLogout}
      />

      {/* 2. MAIN CONTENT */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        {isNotFound ? (
          <KitsNotFound
            homePath="/"
            onNavigateHome={handleNavigateHome}
            homeLabel="GO TO HOME"
          />
        ) : activeMode === 'PUBLIC' ? (
          <PublicPortal />
        ) : (
          <CoordinatorPortal
            session={coordinatorSession}
            onLoginSuccess={handleLoginSuccess}
            onLogout={handleLogout}
          />
        )}
      </main>

      {/* 3. FOOTER */}
      <footer className="bg-white border-t border-gray-200 mt-12 py-6 px-4 sm:px-6 lg:px-8 text-center text-xs text-gray-500 space-y-2">
        <p className="font-bold text-gray-700">
          KITS-EOS • Centralized Event Operations System (Standby Node)
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-gray-500">
          <span>© {new Date().getFullYear()} KITS Akshar Institute of Technology. All Rights Reserved.</span>
          <span>•</span>
          <button
            type="button"
            onClick={openCookiePreferencesModal}
            className="text-blue-600 hover:underline cursor-pointer"
          >
            Cookie Preferences
          </button>
        </div>
      </footer>

      {/* 4. COOKIE & STORAGE CONSENT */}
      <CookieConsentBanner />
    </div>
  );
}

export default App;
