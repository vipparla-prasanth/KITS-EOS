import { useState } from 'react';
import type { ActiveAppMode, CoordinatorSession } from '../types';
import { Lock, LogOut, Eye, Menu, X, Activity } from 'lucide-react';

interface HeaderProps {
  activeMode: ActiveAppMode;
  setActiveMode: (mode: ActiveAppMode) => void;
  coordinatorSession: CoordinatorSession | null;
  onLogout: () => void;
}

export function Header({
  activeMode,
  setActiveMode,
  coordinatorSession,
  onLogout,
}: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-2.5 sm:top-4 z-40 px-3 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-7xl mx-auto glass-header-floating rounded-2xl sm:rounded-3xl transition-all">
        <div className="px-4 sm:px-6 flex items-center justify-between h-16 sm:h-[72px]">
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-red-50 text-kits-red border border-red-100 flex items-center justify-center font-black text-sm shadow-2xs shrink-0">
              KITS
            </div>
            <div className="flex flex-col">
              <div className="text-xs sm:text-sm font-black tracking-tight leading-none text-gray-900 flex items-center gap-1">
                <span className="text-kits-red font-black">KITS</span>
                <span className="text-kits-blue font-black">Akshar</span>
                <span className="text-gray-800 font-bold hidden sm:inline text-xs">Institute of Technology</span>
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 mt-0.5">
                KITS-EOS • Standby Contingency Node
              </span>
            </div>
          </div>

          {/* Desktop Right Navigation Controls */}
          <div className="hidden md:flex items-center gap-3">
            {/* Operational Status Pill */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Standby Node Active</span>
            </div>

            {/* Mode Switcher */}
            {activeMode === 'PUBLIC' ? (
              <button
                type="button"
                onClick={() => setActiveMode('COORDINATOR')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider transition active:scale-95 shadow-2xs"
              >
                <Lock className="w-3.5 h-3.5 text-red-400" />
                <span>Coordinator Access</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveMode('PUBLIC')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold transition"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Public Event Viewer</span>
                </button>

                {coordinatorSession?.isAuthenticated && (
                  <button
                    type="button"
                    onClick={onLogout}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-kits-red border border-red-200 text-xs font-black transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-xl text-gray-700 hover:bg-gray-100 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Navigation Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden px-4 py-3 border-t border-gray-100 space-y-2 text-xs font-bold">
            <div className="flex items-center gap-2 p-2 rounded-xl bg-emerald-50 text-emerald-800">
              <Activity className="w-4 h-4 text-emerald-600 animate-pulse" />
              <span>Standby Node Operational</span>
            </div>

            {activeMode === 'PUBLIC' ? (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setActiveMode('COORDINATOR');
                }}
                className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-900 text-white font-black"
              >
                <Lock className="w-3.5 h-3.5 text-red-400" />
                <span>Coordinator Access</span>
              </button>
            ) : (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setActiveMode('PUBLIC');
                  }}
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-gray-100 text-gray-800 font-bold"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Public Event Viewer</span>
                </button>
                {coordinatorSession?.isAuthenticated && (
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onLogout();
                    }}
                    className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-red-50 text-kits-red font-black"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
