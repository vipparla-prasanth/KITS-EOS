import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useAuth } from '../../context/AuthContext';
import { 
  Calendar, 
  ClipboardList, 
  LogIn, 
  LogOut, 
  User, 
  LayoutDashboard, 
  CheckCircle2, 
  Award,
  MessageSquare, 
  AlertTriangle, 
  Bell, 
  Menu, 
  X,
  ChevronDown,
  Phone,
  ShieldCheck,
  ExternalLink,
  MapPin
} from 'lucide-react';
import { LogoutConfirmationModal } from '../ui/LogoutConfirmationModal';
import { CampusLocationModal } from '../ui/CampusLocationModal';

export function StudentNavbar() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [servicesDropdownOpen, setServicesDropdownOpen] = useState(false);
  const servicesDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (servicesDropdownRef.current && !servicesDropdownRef.current.contains(event.target as Node)) {
        setServicesDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch unread notifications count for authenticated student
  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    async function fetchUnreadCount() {
      try {
        const { count, error } = await supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user!.id)
          .eq('is_read', false);

        if (!error && count !== null) {
          setUnreadCount(count);
        }
      } catch (e) {
        console.error('Failed to fetch unread notification count:', e);
      }
    }

    fetchUnreadCount();

    // Re-check periodically (30s)
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [user?.id]);

  // Close mobile menu & dropdown on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    setServicesDropdownOpen(false);
  }, [location.pathname]);

  const handleConfirmSignOut = async () => {
    setIsLogoutModalOpen(false);
    await signOut();
    navigate('/');
  };

  const isServicesActive = ['/feedback', '/complaints', '/contact-coordinators', '/tech-support', '/verify-certificate'].some(p => location.pathname.startsWith(p));

  return (
    <>
      {/* =========================================================================
          FLOATING GLASSY HEADER (Visually Separated, Translucent, Soft Shadow)
          ========================================================================= */}
      <header className="sticky top-2 sm:top-4 z-40 px-1.5 sm:px-6 lg:px-8 font-sans pointer-events-none header-enter">
        <div className="max-w-7xl mx-auto glass-header-floating rounded-2xl sm:rounded-3xl pointer-events-auto transition-all duration-300">
          <div className="px-2 sm:px-6 lg:px-7 flex items-center justify-between h-14 sm:h-[70px]">
            {/* Brand Logo & Name */}
            <Link to={user ? "/dashboard" : "/"} className="flex items-center gap-2.5 group shrink-0">
              <img
                src="/college_logo.png"
                alt="KITS Logo"
                className="h-9 w-9 sm:h-10 sm:w-10 object-contain shrink-0 group-hover:scale-105 transition"
              />
              <div className="flex flex-col">
                <div className="text-xs sm:text-sm font-black tracking-tight leading-none text-gray-900 flex items-center gap-1">
                  <span className="text-kits-red font-black">KITS</span>
                  <span className="text-kits-blue font-black">Akshar</span>
                  <span className="text-gray-900 font-bold hidden md:inline text-[11px] lg:text-xs">Institute of Technology</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                    KITS-EOS
                  </span>
                  <span className="text-gray-300 text-[10px] hidden xs:inline">•</span>
                  <span className="text-[9px] sm:text-[10px] font-bold text-gray-400 tracking-tight whitespace-nowrap hidden xs:inline">
                    Developed by Team PMD
                  </span>
                </div>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <nav className="hidden xl:flex items-center gap-1.5 text-xs font-bold">
              {user ? (
                <>
                  <NavLink
                    to="/dashboard"
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition ${
                        isActive 
                          ? 'bg-red-50 text-kits-red font-black border border-red-100 shadow-2xs' 
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    <span>Dashboard</span>
                  </NavLink>

                  <NavLink
                    to="/events"
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition ${
                        isActive 
                          ? 'bg-red-50 text-kits-red font-black border border-red-100 shadow-2xs' 
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    <span>Events</span>
                  </NavLink>

                  <NavLink
                    to="/my-registrations"
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition ${
                        isActive 
                          ? 'bg-blue-50 text-kits-blue font-black border border-blue-100 shadow-2xs' 
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    <span>My Passes</span>
                  </NavLink>

                  <NavLink
                    to="/attendance"
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition ${
                        isActive 
                          ? 'bg-emerald-50 text-emerald-700 font-black border border-emerald-100 shadow-2xs' 
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Attendance</span>
                  </NavLink>

                  <NavLink
                    to="/certificates"
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition ${
                        isActive || location.pathname === '/certificates' || location.pathname === '/achievements' || location.pathname === '/results'
                          ? 'bg-amber-50 text-amber-800 font-black border border-amber-100 shadow-2xs' 
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    <Award className="h-3.5 w-3.5 text-amber-600" />
                    <span>Certificates</span>
                  </NavLink>

                  {/* Services & Support Dropdown */}
                  <div className="relative" ref={servicesDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setServicesDropdownOpen(!servicesDropdownOpen)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl transition ${
                        isServicesActive
                          ? 'bg-blue-50 text-kits-blue font-black border border-blue-100'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/70'
                      }`}
                    >
                      <span>Services</span>
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${servicesDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {servicesDropdownOpen && (
                      <div className="absolute top-full right-0 mt-2 w-56 glass-surface-dropdown rounded-2xl p-2 space-y-1 dropdown-animate z-50">
                        <NavLink
                          to="/feedback"
                          onClick={() => setServicesDropdownOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition ${
                              isActive ? 'bg-blue-50 text-kits-blue' : 'text-gray-700 hover:bg-gray-50'
                            }`
                          }
                        >
                          <MessageSquare className="h-4 w-4 text-kits-blue shrink-0" />
                          <div>
                            <span className="block">Event Feedback</span>
                            <span className="text-[10px] text-gray-400 font-normal">Rate completed rounds</span>
                          </div>
                        </NavLink>

                        <NavLink
                          to="/complaints"
                          onClick={() => setServicesDropdownOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition ${
                              isActive ? 'bg-red-50 text-kits-red' : 'text-gray-700 hover:bg-gray-50'
                            }`
                          }
                        >
                          <AlertTriangle className="h-4 w-4 text-kits-red shrink-0" />
                          <div>
                            <span className="block">Help & Grievances</span>
                            <span className="text-[10px] text-gray-400 font-normal">Contact support desk</span>
                          </div>
                        </NavLink>

                        <NavLink
                          to="/contact-coordinators"
                          onClick={() => setServicesDropdownOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition ${
                              isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-700 hover:bg-gray-50'
                            }`
                          }
                        >
                          <Phone className="h-4 w-4 text-gray-500 shrink-0" />
                          <div>
                            <span className="block">Coordinators Directory</span>
                            <span className="text-[10px] text-gray-400 font-normal">Faculty & student leads</span>
                          </div>
                        </NavLink>

                        <NavLink
                          to="/verify-certificate"
                          onClick={() => setServicesDropdownOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition border-t border-gray-100 mt-1 pt-2 ${
                              isActive ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'
                            }`
                          }
                        >
                          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                          <div>
                            <span className="block">Verify Certificate</span>
                            <span className="text-[10px] text-gray-400 font-normal">Institutional authenticity check</span>
                          </div>
                        </NavLink>

                        {/* Campus Map Action */}
                        <button
                          type="button"
                          onClick={() => {
                            setServicesDropdownOpen(false);
                            setIsMapModalOpen(true);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition text-left text-gray-700 hover:bg-gray-50 cursor-pointer"
                        >
                          <MapPin className="h-4 w-4 text-kits-red shrink-0" />
                          <div>
                            <span className="block">Campus Location</span>
                            <span className="text-[10px] text-gray-400 font-normal">Interactive Google Map</span>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Quick Campus Map Link on Navbar */}
                  <button
                    type="button"
                    onClick={() => setIsMapModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition text-gray-600 hover:text-kits-red hover:bg-red-50/70 font-bold cursor-pointer"
                    title="View KITS Akshar Institute of Technology Campus Location"
                  >
                    <MapPin className="h-3.5 w-3.5 text-kits-red" />
                    <span>Campus Map</span>
                  </button>
                </>
              ) : (
                <>
                  <NavLink
                    to="/"
                    end
                    className={({ isActive }) =>
                      `px-2.5 py-1.5 rounded-xl uppercase tracking-wide transition ${
                        isActive ? 'bg-red-50 text-kits-red font-black' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    Home
                  </NavLink>

                  <NavLink
                    to="/about-keos"
                    className={({ isActive }) =>
                      `px-2.5 py-1.5 rounded-xl uppercase tracking-wide transition ${
                        isActive ? 'bg-red-50 text-kits-red font-black' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    About K-EOS
                  </NavLink>

                  <NavLink
                    to="/events"
                    className={({ isActive }) =>
                      `px-2.5 py-1.5 rounded-xl uppercase tracking-wide transition ${
                        isActive ? 'bg-red-50 text-kits-red font-black' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    Events
                  </NavLink>

                  <NavLink
                    to="/vision"
                    className={({ isActive }) =>
                      `px-2.5 py-1.5 rounded-xl uppercase tracking-wide transition ${
                        isActive ? 'bg-blue-50 text-kits-blue font-black' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    Our Visionaries
                  </NavLink>

                  <NavLink
                    to="/contact-coordinators"
                    className={({ isActive }) =>
                      `px-2.5 py-1.5 rounded-xl uppercase tracking-wide transition ${
                        isActive ? 'bg-red-50 text-kits-red font-black' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    Contact Coordinators
                  </NavLink>

                  <NavLink
                    to="/tech-support"
                    className={({ isActive }) =>
                      `px-2.5 py-1.5 rounded-xl uppercase tracking-wide transition ${
                        isActive ? 'bg-gray-100 text-gray-900 font-black' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    Tech Support
                  </NavLink>

                  <NavLink
                    to="/verify-certificate"
                    className={({ isActive }) =>
                      `px-2.5 py-1.5 rounded-xl uppercase tracking-wide transition ${
                        isActive ? 'bg-blue-50 text-kits-blue font-black' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    Verify Certificate
                  </NavLink>

                  {/* Campus Location Map */}
                  <button
                    type="button"
                    onClick={() => setIsMapModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl uppercase tracking-wide text-gray-700 hover:text-kits-red hover:bg-red-50/70 font-bold transition cursor-pointer"
                    title="View KITS Akshar Institute of Technology Campus Location"
                  >
                    <MapPin className="h-3.5 w-3.5 text-kits-red" />
                    <span>Campus Map</span>
                  </button>

                  <a
                    href="https://www.kitsakshar.ac.in/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl uppercase tracking-wide text-kits-blue font-bold hover:bg-blue-50/70 transition"
                  >
                    <span>KITS Portal</span>
                    <ExternalLink className="h-3 w-3 opacity-70" />
                  </a>
                </>
              )}
            </nav>

            {/* User Auth Section & Mobile Hamburger */}
            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
              {user ? (
                <div className="flex items-center gap-1.5 sm:gap-2">
                  {/* Notification Bell with Unread Badge */}
                  <NavLink
                    to="/notifications"
                    className={({ isActive }) =>
                      `relative p-2 rounded-xl border transition ${
                        isActive
                          ? 'bg-red-50 text-kits-red border-red-200 shadow-2xs'
                          : 'border-gray-200/80 hover:border-gray-300 bg-gray-50/70 text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
                      }`
                    }
                    title="Alerts & Notifications"
                  >
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-kits-red text-white text-[9px] font-black flex items-center justify-center animate-pulse shadow-2xs">
                        {unreadCount}
                      </span>
                    )}
                  </NavLink>

                  <Link
                    to="/profile"
                    className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl border border-gray-200/80 hover:border-kits-blue/40 glass-element-subtle hover:bg-blue-50/50 transition text-left group"
                  >
                    <div className="h-7 w-7 rounded-full bg-blue-100 text-kits-blue flex items-center justify-center font-bold text-xs group-hover:scale-105 transition">
                      <User className="h-3.5 w-3.5" />
                    </div>
                    <div className="hidden sm:block">
                      <div className="text-xs font-bold text-gray-900 leading-none">
                        {profile?.full_name || user.email?.split('@')[0]}
                      </div>
                      <div className="text-[10px] font-mono text-gray-500 mt-0.5">
                        {profile?.roll_number || 'Student'}
                      </div>
                    </div>
                  </Link>

                  <button
                    type="button"
                    onClick={() => setIsLogoutModalOpen(true)}
                    className="p-1.5 sm:p-2 text-gray-400 hover:text-red-600 rounded-xl hover:bg-red-50 transition cursor-pointer"
                    title="Sign Out"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <Link
                    to="/login"
                    className="btn-liquid btn-primary-red inline-flex items-center gap-1 sm:gap-1.5 px-2 py-1.5 sm:px-4 sm:py-2 text-[10px] sm:text-xs font-black uppercase tracking-wider shadow-2xs shrink-0"
                  >
                    <span className="btn-content">
                      <LogIn className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                      <span>Sign In</span>
                    </span>
                  </Link>
                </div>
              )}

              {/* Mobile menu button */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="xl:hidden p-1.5 sm:p-2 rounded-xl text-gray-600 hover:bg-white/60 active:bg-white/80 transition cursor-pointer shrink-0"
                aria-label="Toggle navigation menu"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* Mobile Navigation Dropdown */}
          {mobileMenuOpen && (
            <div className="xl:hidden px-3 py-3 border-t border-gray-200/80 space-y-1 dropdown-animate">
              {user ? (
                <>
                  <NavLink
                    to="/dashboard"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    <LayoutDashboard className="h-4 w-4 text-kits-red" />
                    <span>Dashboard Overview</span>
                  </NavLink>

                  <NavLink
                    to="/events"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    <Calendar className="h-4 w-4 text-kits-blue" />
                    <span>Explore Events</span>
                  </NavLink>

                  <NavLink
                    to="/my-registrations"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    <ClipboardList className="h-4 w-4 text-purple-600" />
                    <span>My Registrations & Passes</span>
                  </NavLink>

                  <NavLink
                    to="/attendance"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Attendance Status</span>
                  </NavLink>

                  <NavLink
                    to="/certificates"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    <Award className="h-4 w-4 text-amber-600" />
                    <span>Certificates</span>
                  </NavLink>

                  <NavLink
                    to="/feedback"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    <MessageSquare className="h-4 w-4 text-kits-blue" />
                    <span>Submit Feedback</span>
                  </NavLink>

                  <NavLink
                    to="/complaints"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    <AlertTriangle className="h-4 w-4 text-kits-red" />
                    <span>Help & Grievance Tickets</span>
                  </NavLink>

                  <NavLink
                    to="/notifications"
                    className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2.5">
                      <Bell className="h-4 w-4 text-gray-600" />
                      <span>Notifications</span>
                    </div>
                    {unreadCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-kits-red text-white text-[10px] font-black">
                        {unreadCount}
                      </span>
                    )}
                  </NavLink>

                  <NavLink
                    to="/profile"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 border-t border-gray-100 mt-1 pt-2"
                  >
                    <User className="h-4 w-4 text-gray-600" />
                    <span>Student Profile</span>
                  </NavLink>

                  {/* Mobile Campus Map (Student) */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsMapModalOpen(true);
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 text-left cursor-pointer"
                  >
                    <MapPin className="h-4 w-4 text-kits-red" />
                    <span>Campus Location / Map</span>
                  </button>

                </>
              ) : (
                <>
                  <NavLink
                    to="/"
                    end
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase text-gray-800 hover:bg-gray-50"
                  >
                    <span>Home</span>
                  </NavLink>

                  <NavLink
                    to="/about-keos"
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase text-gray-800 hover:bg-gray-50"
                  >
                    <span>About K-EOS</span>
                  </NavLink>

                  <NavLink
                    to="/events"
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase text-gray-800 hover:bg-gray-50"
                  >
                    <span>Events</span>
                  </NavLink>

                  <NavLink
                    to="/vision"
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase text-gray-800 hover:bg-gray-50"
                  >
                    <span>Our Visionaries</span>
                  </NavLink>

                  <NavLink
                    to="/contact-coordinators"
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase text-gray-800 hover:bg-gray-50"
                  >
                    <span>Contact Coordinators</span>
                  </NavLink>

                  <NavLink
                    to="/tech-support"
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase text-gray-800 hover:bg-gray-50"
                  >
                    <span>Tech Support</span>
                  </NavLink>

                  <NavLink
                    to="/verify-certificate"
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase text-gray-800 hover:bg-gray-50"
                  >
                    <span>Verify Certificate</span>
                  </NavLink>

                  {/* Mobile Campus Map (Public) */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsMapModalOpen(true);
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase text-gray-800 hover:bg-gray-50 text-left cursor-pointer"
                  >
                    <MapPin className="h-4 w-4 text-kits-red" />
                    <span>Campus Location / Map</span>
                  </button>

                  <a
                    href="https://www.kitsakshar.ac.in/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-black uppercase text-kits-blue bg-blue-50/60 hover:bg-blue-100/60 transition"
                  >
                    <span>Official KITS Portal</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>

                  <div className="pt-2 border-t border-gray-100">
                    <Link
                      to="/login"
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider shadow-2xs"
                    >
                      <LogIn className="h-4 w-4" />
                      <span>Sign In to Student Portal</span>
                    </Link>
                  </div>

                  <div className="pt-2 pb-1 text-center">
                    <span className="text-[10px] font-bold text-gray-400 tracking-wider">
                      Developed by Team PMD
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Logout Confirmation Modal */}
      <LogoutConfirmationModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={handleConfirmSignOut}
      />

      {/* Campus Location Map Modal */}
      <CampusLocationModal
        isOpen={isMapModalOpen}
        onClose={() => setIsMapModalOpen(false)}
      />
    </>
  );
}
