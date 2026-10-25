import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useScrollLock } from '@kits-eos/shared';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard,
  Calendar,
  Users,
  ClipboardList,
  CreditCard,
  CheckSquare,
  Trophy,
  MessageSquare,
  AlertTriangle,
  UserCog,
  Bell,
  X,
  LogOut,
  User,
  BarChart3,
  ShieldCheck,
  UserX,
  Store,
  GraduationCap
} from 'lucide-react';
import { LogoutConfirmationModal } from '../ui/LogoutConfirmationModal';

// Categorized Navigation Sections according to architectural specifications
const navSections = [
  {
    title: 'OPERATIONS',
    items: [
      { name: 'Dashboard', path: '/admin', icon: LayoutDashboard },
      { name: 'Analytics', path: '/admin/analytics', icon: BarChart3 },
      { name: 'Assessments', path: '/admin/assessments', icon: GraduationCap },
      { name: 'Events', path: '/admin/events', icon: Calendar },
      { name: 'Manage Stalls', path: '/admin/stalls', icon: Store },
      { name: 'Coordinators', path: '/admin/coordinators', icon: UserCog },
      { name: 'Registrations', path: '/admin/registrations', icon: ClipboardList },
      { name: 'Payments', path: '/admin/payments', icon: CreditCard },
      { name: 'Attendance', path: '/admin/attendance', icon: CheckSquare },
    ],
  },
  {
    title: 'RESULTS',
    items: [
      { name: 'Results & Certificates', path: '/admin/results', icon: Trophy },
    ],
  },
  {
    title: 'MANAGEMENT',
    items: [
      { name: 'Feedback', path: '/admin/feedback', icon: MessageSquare },
      { name: 'Complaints', path: '/admin/complaints', icon: AlertTriangle },
      { name: 'Students', path: '/admin/students', icon: Users },
      { name: 'Suspension Requests', path: '/admin/suspension-requests', icon: UserX },
      { name: 'Notifications', path: '/admin/notifications', icon: Bell },
      { name: 'Privacy & DPDP', path: '/admin/privacy', icon: ShieldCheck },
    ],
  },
];

interface AdminSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function AdminSidebar({ isOpen = false, onClose }: AdminSidebarProps) {
  const { user, signOut } = useAuth();
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState<number>(0);

  // Live query of pending unsuspension requests
  useEffect(() => {
    async function loadPendingCount() {
      try {
        const { count, error } = await supabase
          .from('student_account_suspension_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'PENDING');
        if (!error && typeof count === 'number') {
          setPendingCount(count);
        }
      } catch {
        // ignore
      }
    }
    loadPendingCount();

    let channel: any = null;
    try {
      const topic = `sidebar-suspension-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'student_account_suspension_requests' },
          () => {
            loadPendingCount();
          }
        );
      channel.subscribe((status: string, err?: Error) => {
        if (err) console.warn('[AdminSidebar] Suspension realtime warning:', status, err);
      });
    } catch (err) {
      console.warn('[AdminSidebar] Failed to subscribe to suspension count:', err);
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Body scroll lock while drawer is open on mobile
  useScrollLock(isOpen);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const renderNavContent = (isMobile: boolean) => (
    <div className="h-full flex flex-col justify-between bg-white select-none">
      
      {/* 1. BRAND HEADER */}
      <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <img
            src="/college_logo.png"
            alt="KITS Logo"
            className="h-9 w-9 sm:h-10 sm:w-10 object-contain shrink-0"
          />
          <div>
            <h1 className="text-lg sm:text-xl font-black text-gray-900 tracking-tight leading-none">
              <span className="text-kits-red">KITS</span>
              <span className="text-kits-blue">-EOS</span>
            </h1>
            <p className="text-[10px] text-gray-500 font-extrabold uppercase mt-1 tracking-wider">
              ADMIN PORTAL
            </p>
          </div>
        </div>

        {/* Mobile Close Button (>= 44x44px Touch Target) */}
        {isMobile && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
            aria-label="Close navigation sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* 2. CATEGORIZED NAVIGATION SECTIONS (Internally Scrollable) */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4 custom-scrollbar">
        {navSections.map((section) => (
          <div key={section.title} className="space-y-1">
            <div className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
              {section.title}
            </div>

            {section.items.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.name}
                  to={item.path}
                  end={item.path === '/admin'}
                  onClick={isMobile ? onClose : undefined}
                  className={({ isActive }) =>
                    `flex items-center px-3 py-2 text-xs font-bold rounded-xl transition-all min-h-[42px] touch-target-min ${
                      isActive
                        ? 'bg-kits-red/10 text-kits-red font-black border border-kits-red/20 shadow-2xs'
                        : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        className={`mr-2.5 h-4 w-4 shrink-0 ${
                          isActive ? 'text-kits-red' : 'text-gray-400'
                        }`}
                      />
                      <span className="truncate">{item.name}</span>
                      {item.path === '/admin/suspension-requests' && pendingCount > 0 && (
                        <span className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-kits-red text-white shadow-2xs">
                          {pendingCount}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* 3. DEDICATED ACCOUNT SECTION & MOBILE SIGN OUT (Pinned to Drawer Bottom) */}
      <div className="p-3 sm:p-4 border-t border-gray-100 bg-gray-50/60 shrink-0 space-y-2.5">
        <div className="px-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
          ACCOUNT
        </div>

        {/* Administrator Profile Card */}
        <div className="p-2.5 bg-white border border-gray-200/80 rounded-2xl shadow-2xs space-y-1">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-blue-50 text-kits-blue flex items-center justify-center shrink-0">
              <User className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-black text-gray-900 block truncate">Administrator</span>
              <span className="text-[10px] font-bold text-gray-500 block truncate overflow-wrap-anywhere">
                {user?.email || 'admin@kitsakshar.edu.in'}
              </span>
            </div>
          </div>
        </div>

        {/* Mobile / Tablet Sign Out Action Button */}
        {isMobile && (
          <button
            type="button"
            onClick={() => setIsLogoutModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200/80 text-kits-red text-xs font-black uppercase tracking-wider transition min-h-[44px] cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        )}
      </div>

    </div>
  );

  return (
    <>
      {/* =========================================================================
          1. DESKTOP PERSISTENT CONTROL RAIL (>= 1024px)
          ========================================================================= */}
      <aside className="hidden lg:flex lg:w-64 border-r border-gray-200 h-full flex-col shrink-0">
        {renderNavContent(false)}
      </aside>

      {/* =========================================================================
          2. MOBILE/TABLET RESPONSIVE DRAWER (< 1024px)
          Slide-in animation, backdrop blur, safe-area inset support, internal scroll
          ========================================================================= */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Subtle Dim Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity modal-overlay-animate cursor-pointer"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Slide-out Drawer Panel (280-320px width) */}
          <div className="relative w-72 sm:w-80 max-w-[85vw] bg-white h-full shadow-2xl flex flex-col z-10 modal-dialog-animate safe-pb">
            {renderNavContent(true)}
          </div>
        </div>
      )}

      {/* Mobile Sign Out Confirmation Modal */}
      <LogoutConfirmationModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={() => {
          setIsLogoutModalOpen(false);
          if (onClose) onClose();
          signOut();
        }}
      />
    </>
  );
}
export default AdminSidebar;
