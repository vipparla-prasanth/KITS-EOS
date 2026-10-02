import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase, NotificationCenter } from '@kits-eos/shared';
import { LogOut, User, ShieldCheck, Menu, GraduationCap } from 'lucide-react';
import { LogoutConfirmationModal } from '../ui/LogoutConfirmationModal';
import { LinkStudentProfileModal } from '../ui/LinkStudentProfileModal';

interface AdminHeaderProps {
  onToggleSidebar?: () => void;
}

export function AdminHeader({ onToggleSidebar }: AdminHeaderProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isLinkStudentModalOpen, setIsLinkStudentModalOpen] = useState(false);
  const [hasStudentProfile, setHasStudentProfile] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setHasStudentProfile(null);
      return;
    }

    supabase
      .from('student_profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) {
          setHasStudentProfile(true);
        } else {
          setHasStudentProfile(false);
        }
      });
  }, [user?.id]);

  return (
    <>
      {/* =========================================================================
          FLOATING GLASS HEADER (Translucent, Rounded, Soft Shadow, Responsive)
          ========================================================================= */}
      <header className="sticky top-2 sm:top-3 lg:top-4 z-40 px-2.5 sm:px-4 lg:px-8 font-sans shrink-0 header-enter pointer-events-none">
        <div className="max-w-7xl mx-auto glass-header-floating rounded-2xl sm:rounded-3xl pointer-events-auto transition-all duration-300">
          
          {/* =====================================================================
              1. DESKTOP HEADER COMPOSITION (>= 1024px)
              ===================================================================== */}
          <div className="hidden lg:flex px-6 items-center justify-between h-16">
            {/* Left: Administrative Portal Badge */}
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-red-50 text-kits-red border border-red-100 flex items-center justify-center font-black shadow-2xs shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>

              <div>
                <div className="text-sm font-black tracking-tight leading-none text-gray-900">
                  <span className="text-kits-red font-black">KITS</span>{' '}
                  <span className="text-kits-blue font-black">Akshar</span>{' '}
                  <span className="text-gray-900 font-bold text-xs">Institute of Technology</span>
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 block mt-0.5">
                  Central Event Operations • Admin Portal
                </span>
              </div>
            </div>

            {/* Right: Notifications, User Profile & Desktop Logout */}
            <div className="flex items-center space-x-3">
              <NotificationCenter portal="ADMIN" onNavigate={navigate} />

              {hasStudentProfile === false && (
                <button
                  type="button"
                  onClick={() => setIsLinkStudentModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-kits-blue bg-blue-50/90 hover:bg-blue-100 border border-blue-200/80 transition min-h-[40px] justify-center cursor-pointer shadow-2xs"
                  title="Link Student Profile to this Administrator account"
                >
                  <GraduationCap className="w-4 h-4 text-kits-blue" />
                  <span>Link Student Profile</span>
                </button>
              )}

              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200/80 glass-element-subtle text-xs font-bold text-gray-800">
                <User className="w-3.5 h-3.5 text-kits-blue shrink-0" />
                <span className="max-w-[220px] truncate">{user?.email || 'admin@kitsakshar.edu.in'}</span>
              </div>

              <div className="h-4 w-px bg-gray-200"></div>

              <button
                type="button"
                onClick={() => setIsLogoutModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider text-gray-600 hover:text-kits-red hover:bg-red-50 transition min-h-[40px] justify-center cursor-pointer"
                title="Sign out of Admin Portal"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>

          {/* =====================================================================
              2. DEDICATED MOBILE & TABLET HEADER COMPOSITION (< 1024px)
              Target height: 58-72px, Intentional Hierarchy, Email Always Visible
              Sign Out REMOVED from header (moved into hamburger drawer)
              ===================================================================== */}
          <div className="flex lg:hidden px-2 sm:px-4 items-center justify-between min-h-[60px] py-1.5">
            
            {/* Left/Center: Hamburger + Shield + 3-Line Institutional & Admin Identity */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1 pr-1.5">
              {onToggleSidebar && (
                <button
                  type="button"
                  onClick={onToggleSidebar}
                  className="p-1.5 text-gray-700 hover:text-gray-900 hover:bg-white/60 active:bg-white/80 rounded-xl transition min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 cursor-pointer"
                  aria-label="Open navigation menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
              )}

              <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-xl bg-red-50/90 text-kits-red border border-red-100 flex items-center justify-center font-black shadow-2xs shrink-0">
                <ShieldCheck className="h-4 w-4" />
              </div>

              {/* 3-Line Identity Block: College -> Portal -> Admin Email */}
              <div className="min-w-0 flex-1 flex flex-col justify-center">
                {/* Line 1: Institution Name */}
                <div className="text-[11px] sm:text-xs font-black tracking-tight leading-tight text-gray-900 truncate">
                  <span className="text-kits-red font-black">KITS</span>{' '}
                  <span className="text-kits-blue font-black">Akshar</span>{' '}
                  <span className="text-gray-800 font-extrabold hidden xs:inline">Institute of Technology</span>
                </div>

                {/* Line 2: Portal Identifier */}
                <div className="text-[8.5px] sm:text-[9px] font-black uppercase tracking-wider text-kits-red leading-tight">
                  ADMIN PORTAL
                </div>

                {/* Line 3: Administrator Email (ALWAYS VISIBLE & FULLY READABLE - NEVER TRUNCATED) */}
                <div className="text-[9px] sm:text-[10px] font-bold text-gray-600 leading-tight break-all">
                  {user?.email || 'admin@kitsakshar.edu.in'}
                </div>
              </div>
            </div>

            {/* Right: Notifications Bell + Profile Trigger */}
            <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
              {hasStudentProfile === false && (
                <button
                  type="button"
                  onClick={() => setIsLinkStudentModalOpen(true)}
                  className="p-1.5 sm:p-2 rounded-xl text-kits-blue bg-blue-50/90 hover:bg-blue-100 border border-blue-200 transition min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center cursor-pointer shadow-2xs"
                  title="Link Student Profile"
                  aria-label="Link Student Profile"
                >
                  <GraduationCap className="w-4 h-4" />
                </button>
              )}

              <NotificationCenter portal="ADMIN" onNavigate={navigate} />

              {onToggleSidebar && (
                <button
                  type="button"
                  onClick={onToggleSidebar}
                  className="p-1.5 sm:p-2 rounded-xl text-kits-blue glass-element-subtle hover:bg-blue-50/80 transition min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center cursor-pointer"
                  title="View Account & Menu"
                  aria-label="Account details"
                >
                  <User className="w-4 h-4" />
                </button>
              )}
            </div>

          </div>

        </div>
      </header>

      {/* Desktop Sign Out Confirmation Modal */}
      <LogoutConfirmationModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={() => {
          setIsLogoutModalOpen(false);
          signOut();
        }}
      />

      {/* Student Profile Onboarding Modal */}
      <LinkStudentProfileModal
        isOpen={isLinkStudentModalOpen}
        onClose={() => setIsLinkStudentModalOpen(false)}
        onSuccess={() => {
          setIsLinkStudentModalOpen(false);
          setHasStudentProfile(true);
        }}
        defaultFullName={user?.user_metadata?.full_name || ''}
        defaultEmail={user?.email || ''}
      />
    </>
  );
}
export default AdminHeader;
