import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isSessionValid } from '@kits-eos/shared';
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
  MapPin,
  Sparkles
} from 'lucide-react';
const LogoutConfirmationModal = lazy(() => import('../ui/LogoutConfirmationModal').then(m => ({ default: m.LogoutConfirmationModal })));
const CampusLocationModal = lazy(() => import('../ui/CampusLocationModal').then(m => ({ default: m.CampusLocationModal })));
const NotificationCenter = lazy(() => import('@kits-eos/shared/src/components/NotificationCenter').then(m => ({ default: m.NotificationCenter })));

export function StudentNavbar() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isStudentAuthenticated = Boolean(
    user && 
    isSessionValid() && 
    location.pathname !== '/reset-password' && 
    location.pathname !== '/login' && 
    location.pathname !== '/signup'
  );

  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [servicesDropdownOpen, setServicesDropdownOpen] = useState(false);
  const servicesDropdownRef = useRef<HTMLDivElement>(null);
  const [moreDropdownOpen, setMoreDropdownOpen] = useState(false);
  const moreDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (servicesDropdownRef.current && !servicesDropdownRef.current.contains(event.target as Node)) {
        setServicesDropdownOpen(false);
      }
      if (moreDropdownRef.current && !moreDropdownRef.current.contains(event.target as Node)) {
        setMoreDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  // Close mobile menu & dropdowns on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    setServicesDropdownOpen(false);
    setMoreDropdownOpen(false);
  }, [location.pathname]);

  const handleConfirmSignOut = async () => {
    setIsLogoutModalOpen(false);
    await signOut();
    navigate('/');
  };

  const isServicesActive = ['/feedback', '/complaints', '/contact-coordinators', '/tech-support', '/verify-certificate'].some(p => location.pathname.startsWith(p));
  const isMoreActive = ['/vision', '/contact-coordinators', '/tech-support'].some(p => location.pathname.startsWith(p));

  return (
    <>
      {/* =========================================================================
          FLOATING GLASSY HEADER (Visually Separated, Translucent, Soft Shadow)
          ========================================================================= */}
      <header className="sticky top-2 sm:top-4 z-40 px-1.5 sm:px-6 lg:px-8 font-sans pointer-events-none header-enter">
        <div className="max-w-7xl mx-auto glass-header-floating rounded-2xl sm:rounded-3xl pointer-events-auto transition-all duration-300">
          <div className="px-2 sm:px-4 lg:px-6 flex items-center justify-between min-h-14 sm:min-h-[70px] py-1.5 sm:py-2">
            {/* Brand Logo & Name */}
            <Link to={isStudentAuthenticated ? "/dashboard" : "/"} className="flex items-center gap-2.5 group shrink-0">
              <img
                src="/college_logo.png"
                alt="KITS Logo"
                width={40}
                height={40}
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
            <nav className="hidden lg:flex items-center gap-1.5 2xl:gap-2 text-xs font-bold shrink min-w-0">
              {isStudentAuthenticated ? (
                <>
                  <NavLink
                    to="/dashboard"
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 px-2.5 2xl:px-3 py-1.5 rounded-xl transition ${
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
                      `inline-flex items-center gap-1.5 px-2.5 2xl:px-3 py-1.5 rounded-xl transition ${
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
                      `inline-flex items-center gap-1.5 px-2.5 2xl:px-3 py-1.5 rounded-xl transition ${
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
                      `inline-flex items-center gap-1.5 px-2.5 2xl:px-3 py-1.5 rounded-xl transition ${
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
                      `inline-flex items-center gap-1.5 px-2.5 2xl:px-3 py-1.5 rounded-xl transition ${
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
                      className={`inline-flex items-center gap-1 px-2.5 2xl:px-3 py-1.5 rounded-xl transition ${
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
                    className="inline-flex items-center gap-1.5 px-2.5 2xl:px-3 py-1.5 rounded-xl transition text-gray-600 hover:text-kits-red hover:bg-red-50/70 font-bold cursor-pointer"
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
                      `px-3 py-1.5 rounded-xl uppercase tracking-wide transition ${
                        isActive ? 'bg-red-50 text-kits-red font-black' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    Home
                  </NavLink>

                  <NavLink
                    to="/about-keos"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-xl uppercase tracking-wide transition ${
                        isActive ? 'bg-red-50 text-kits-red font-black' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    About K-EOS
                  </NavLink>

                  <NavLink
                    to="/events"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-xl uppercase tracking-wide transition ${
                        isActive ? 'bg-red-50 text-kits-red font-black' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    Events
                  </NavLink>

                  <NavLink
                    to="/verify-certificate"
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-xl uppercase tracking-wide transition ${
                        isActive ? 'bg-blue-50 text-kits-blue font-black' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`
                    }
                  >
                    Verify Certificate
                  </NavLink>

                  {/* MORE ▾ Dropdown */}
                  <div className="relative" ref={moreDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setMoreDropdownOpen(!moreDropdownOpen)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl uppercase tracking-wide text-xs font-bold transition cursor-pointer ${
                        isMoreActive
                          ? 'bg-red-50 text-kits-red font-black'
                          : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100/70'
                      }`}
                      aria-expanded={moreDropdownOpen}
                      aria-haspopup="true"
                    >
                      <span>More</span>
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${moreDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {moreDropdownOpen && (
                      <div className="absolute top-full right-0 mt-2 w-52 glass-surface-dropdown rounded-2xl p-1.5 space-y-0.5 dropdown-animate z-50 shadow-lg border border-gray-200/80">
                        <NavLink
                          to="/vision"
                          onClick={() => setMoreDropdownOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition ${
                              isActive ? 'bg-blue-50 text-kits-blue' : 'text-gray-700 hover:bg-gray-100/70'
                            }`
                          }
                        >
                          <Sparkles className="h-4 w-4 text-kits-blue shrink-0" />
                          <span>Our Visionaries</span>
                        </NavLink>

                        <NavLink
                          to="/contact-coordinators"
                          onClick={() => setMoreDropdownOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition ${
                              isActive ? 'bg-red-50 text-kits-red' : 'text-gray-700 hover:bg-gray-100/70'
                            }`
                          }
                        >
                          <Phone className="h-4 w-4 text-kits-red shrink-0" />
                          <span>Contact Coordinators</span>
                        </NavLink>

                        <NavLink
                          to="/tech-support"
                          onClick={() => setMoreDropdownOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition ${
                              isActive ? 'bg-gray-100 text-gray-900 font-black' : 'text-gray-700 hover:bg-gray-100/70'
                            }`
                          }
                        >
                          <MessageSquare className="h-4 w-4 text-gray-500 shrink-0" />
                          <span>Tech Support</span>
                        </NavLink>

                        <button
                          type="button"
                          onClick={() => {
                            setMoreDropdownOpen(false);
                            setIsMapModalOpen(true);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100/70 transition text-left cursor-pointer border-t border-gray-100 mt-1 pt-1.5"
                        >
                          <MapPin className="h-4 w-4 text-kits-red shrink-0" />
                          <span>Campus Map</span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </nav>

            {/* User Auth Section & Mobile Hamburger */}
            <div className="flex items-center gap-1.5 sm:gap-2 lg:gap-3 shrink min-w-0">
              {isStudentAuthenticated ? (
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  {/* Notification Center Dropdown with Auto Read-on-Open */}
                  <Suspense fallback={<div className="h-8 w-8 rounded-full bg-gray-100/50 shrink-0" />}>
                    <NotificationCenter portal="STUDENT" onNavigate={navigate} />
                  </Suspense>

                  <Link
                    to="/profile"
                    className="flex items-center gap-2 sm:gap-2.5 px-2 sm:px-2.5 2xl:px-3 py-1 sm:py-1.5 rounded-xl border border-gray-200/80 hover:border-kits-blue/40 glass-element-subtle hover:bg-blue-50/50 transition text-left group min-w-0 sm:min-w-[160px] md:min-w-[180px] max-w-[200px] md:max-w-[270px] xl:max-w-[220px] 2xl:max-w-[310px] shrink"
                    title={`${profile?.full_name || 'Student Profile'} (${profile?.roll_number || 'Student'})`}
                  >
                    <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-blue-100 text-kits-blue flex items-center justify-center font-bold text-xs group-hover:scale-105 transition shrink-0">
                      <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    </div>
                    <div className="hidden sm:flex flex-col justify-center min-w-0 flex-1">
                      <div 
                        className="text-[11px] lg:text-xs font-bold text-gray-900 leading-[1.25] break-words select-text"
                        style={{ overflowWrap: 'anywhere', wordBreak: 'normal' }}
                      >
                        {profile?.full_name || user?.email?.split('@')[0]}
                      </div>
                      <div className="text-[10px] font-mono text-gray-500 mt-0.5 leading-tight truncate">
                        {profile?.roll_number || 'Student'}
                      </div>
                    </div>
                  </Link>

                  <button
                    type="button"
                    onClick={() => setIsLogoutModalOpen(true)}
                    className="p-1.5 sm:p-2 text-gray-400 hover:text-red-600 rounded-xl hover:bg-red-50 transition cursor-pointer shrink-0"
                    title="Sign Out"
                    aria-label="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 sm:gap-2.5">
                  <a
                    href="https://www.kitsakshar.ac.in/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl uppercase tracking-wide text-xs font-bold text-kits-blue hover:bg-blue-50/70 border border-blue-200/70 transition shadow-2xs"
                    title="Official KITS Akshar Institute of Technology Portal"
                  >
                    <span>KITS Portal</span>
                    <ExternalLink className="h-3 w-3 opacity-70" />
                  </a>

                  <Link
                    to="/login"
                    className="btn-liquid btn-primary-red inline-flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 text-xs font-black uppercase tracking-wider shadow-2xs shrink-0"
                  >
                    <span className="btn-content">
                      <LogIn className="h-3.5 w-3.5" />
                      <span>Sign In</span>
                    </span>
                  </Link>
                </div>
              )}

              {/* Mobile menu button */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-1.5 sm:p-2 rounded-xl text-gray-600 hover:bg-white/60 active:bg-white/80 transition cursor-pointer shrink-0"
                aria-label="Toggle navigation menu"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* Mobile Navigation Dropdown */}
          {mobileMenuOpen && (
            <div className="lg:hidden px-3 py-3 border-t border-gray-200/80 space-y-1 dropdown-animate">
              {isStudentAuthenticated ? (
                <>
                  {/* Student Identity Card in Mobile Drawer */}
                  <Link
                    to="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-r from-blue-50/80 via-white to-indigo-50/50 border border-blue-100/80 text-left mb-2.5 transition hover:border-kits-blue/40 shadow-2xs"
                  >
                    <div className="h-10 w-10 rounded-full bg-blue-100 text-kits-blue flex items-center justify-center font-bold text-sm shrink-0 shadow-2xs">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div 
                        className="text-xs font-bold text-gray-900 leading-snug break-words select-text"
                        style={{ overflowWrap: 'anywhere', wordBreak: 'normal' }}
                      >
                        {profile?.full_name || user?.email?.split('@')[0]}
                      </div>
                      <div className="text-[10px] font-mono text-gray-500 mt-0.5 leading-tight">
                        {profile?.roll_number || 'Student'}
                      </div>
                    </div>
                  </Link>

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
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition ${
                        isActive ? 'bg-red-50 text-kits-red' : 'text-gray-800 hover:bg-gray-50'
                      }`
                    }
                  >
                    <span>Home</span>
                  </NavLink>

                  <NavLink
                    to="/about-keos"
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition ${
                        isActive ? 'bg-red-50 text-kits-red' : 'text-gray-800 hover:bg-gray-50'
                      }`
                    }
                  >
                    <span>About K-EOS</span>
                  </NavLink>

                  <NavLink
                    to="/events"
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition ${
                        isActive ? 'bg-red-50 text-kits-red' : 'text-gray-800 hover:bg-gray-50'
                      }`
                    }
                  >
                    <span>Events</span>
                  </NavLink>

                  <NavLink
                    to="/verify-certificate"
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition ${
                        isActive ? 'bg-blue-50 text-kits-blue' : 'text-gray-800 hover:bg-gray-50'
                      }`
                    }
                  >
                    <span>Verify Certificate</span>
                  </NavLink>

                  <NavLink
                    to="/vision"
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition ${
                        isActive ? 'bg-blue-50 text-kits-blue' : 'text-gray-800 hover:bg-gray-50'
                      }`
                    }
                  >
                    <span>Our Visionaries</span>
                  </NavLink>

                  <NavLink
                    to="/contact-coordinators"
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition ${
                        isActive ? 'bg-red-50 text-kits-red' : 'text-gray-800 hover:bg-gray-50'
                      }`
                    }
                  >
                    <span>Contact Coordinators</span>
                  </NavLink>

                  <NavLink
                    to="/tech-support"
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition ${
                        isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-800 hover:bg-gray-50'
                      }`
                    }
                  >
                    <span>Tech Support</span>
                  </NavLink>

                  {/* Mobile Campus Map */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsMapModalOpen(true);
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase text-gray-800 hover:bg-gray-50 text-left cursor-pointer"
                  >
                    <MapPin className="h-4 w-4 text-kits-red" />
                    <span>Campus Map</span>
                  </button>

                  <a
                    href="https://www.kitsakshar.ac.in/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-black uppercase text-kits-blue bg-blue-50/60 hover:bg-blue-100/60 transition"
                  >
                    <span>KITS Portal</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>

                  <div className="pt-2 border-t border-gray-100">
                    <Link
                      to="/login"
                      onClick={() => setMobileMenuOpen(false)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider shadow-2xs"
                    >
                      <LogIn className="h-4 w-4" />
                      <span>Sign In</span>
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
      {isLogoutModalOpen && (
        <Suspense fallback={null}>
          <LogoutConfirmationModal
            isOpen={isLogoutModalOpen}
            onClose={() => setIsLogoutModalOpen(false)}
            onConfirm={handleConfirmSignOut}
          />
        </Suspense>
      )}

      {/* Campus Location Map Modal */}
      {isMapModalOpen && (
        <Suspense fallback={null}>
          <CampusLocationModal
            isOpen={isMapModalOpen}
            onClose={() => setIsMapModalOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
