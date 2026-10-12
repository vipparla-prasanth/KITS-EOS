import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { 
  Calendar, 
  ArrowRight, 
  CheckCircle2, 
  Award, 
  Users, 
  QrCode, 
  ShieldCheck, 
  PhoneCall, 
  HelpCircle, 
  Layers, 
  FileText,
  Clock,
  Compass,
  KeyRound
} from 'lucide-react';
import { RevealOnScroll } from '../components/motion/RevealOnScroll';
import { EventBannerImage } from '../components/ui/EventBannerImage';
import { 
  resolveEffectiveEventStatus, 
  getLifecycleBadgeTheme 
} from '@kits-eos/shared/src/utils/eventLifecycle';
import type { EventLifecycleStatus } from '@kits-eos/shared/src/types/models';

interface EventSummary {
  id: string;
  name: string;
  description: string;
  banner_path: string | null;
  start_date: string;
  end_date: string;
  registration_start_date?: string | null;
  registration_end_date?: string | null;
  status: string;
  status_mode?: 'AUTOMATIC' | 'MANUAL';
  manual_status?: EventLifecycleStatus | null;
}

export function Home() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<number>(Date.now());

  // Periodic lightweight re-evaluation of automatic lifecycle (every 30s)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function fetchActiveEvents() {
      try {
        const { data, error } = await supabase
          .from('events')
          .select('id, name, description, banner_path, start_date, end_date, registration_start_date, registration_end_date, status, status_mode, manual_status')
          .eq('status', 'ACTIVE')
          .order('start_date', { ascending: true })
          .limit(4);

        if (!error && data) {
          setEvents(data as EventSummary[]);
        }
      } catch (err) {
        console.error('Error loading events for homepage:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchActiveEvents();
  }, []);

  return (
    <div className="space-y-12 pb-12">
      {/* =========================================================================
          1. HERO SECTION (Institutional, Crisp, Staggered Sequence Entrance)
          ========================================================================= */}
      <section className="bg-white rounded-3xl border border-gray-200 p-5 sm:p-10 lg:p-12 shadow-2xs relative overflow-hidden">
        {/* Subtle decorative background gradient */}
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-gradient-to-br from-blue-50 to-red-50 rounded-full blur-3xl opacity-70 pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-12 -ml-12 w-80 h-80 bg-gradient-to-tr from-red-50 to-blue-50 rounded-full blur-3xl opacity-60 pointer-events-none" />

        <div className="relative z-10 max-w-4xl space-y-6">
          {/* Institutional Badge */}
          <div>
            <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full text-xs font-black bg-gray-100/90 text-gray-800 border border-gray-200 shadow-2xs">
              <img src="/college_logo.png" alt="KITS Logo" width={16} height={16} className="h-4 w-4 object-contain" />
              <span>KITS Akshar Institute of Technology</span>
              <span className="text-gray-300">•</span>
              <span className="text-kits-red font-black tracking-wide">KITS-EOS</span>
            </div>
          </div>

          {/* Hero Title H1 */}
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-gray-900 tracking-tight leading-[1.1]">
              Centralized <span className="text-kits-red">Event Operations</span> &{' '}
              <span className="text-kits-blue">Student Ecosystem</span>
            </h1>
          </div>

          {/* Subtitle Description */}
          <div>
            <p className="text-sm sm:text-base text-gray-600 leading-relaxed max-w-3xl font-medium pt-1">
              Welcome to the authoritative Event Operations System (KITS-EOS) of KITS Akshar Institute of Technology. 
              Built for students, faculty coordinators, and institutional administration to discover campus symposiums, 
              register solo or in teams, obtain dynamic QR passes, track real-time venue attendance, 
              and download cryptographically verifiable digital certificates.
            </p>
          </div>

          {/* Primary Call-to-Actions */}
          <div className="flex flex-wrap items-center gap-3.5 pt-2">
            <Link
              to="/events"
              className="btn-liquid btn-primary-red px-6 py-3.5 text-xs font-black uppercase tracking-wider shadow-2xs group"
            >
              <span className="btn-content">
                <Compass className="h-4 w-4" />
                <span>Explore Active Events</span>
                <ArrowRight className="h-4 w-4 transform group-hover:translate-x-1 transition" />
              </span>
            </Link>

            <Link
              to="/login"
              className="btn-liquid btn-primary-blue px-6 py-3.5 text-xs font-black uppercase tracking-wider shadow-2xs"
            >
              <span className="btn-content">
                <Users className="h-4 w-4" />
                <span>Student Sign In / Register</span>
              </span>
            </Link>

            <Link
              to="/verify-certificate"
              className="btn-secondary px-5 py-3.5 text-xs font-extrabold uppercase tracking-wider"
            >
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-kits-blue" />
                <span>Verify Certificate</span>
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* =========================================================================
          2. THE 12-STAGE INSTITUTIONAL LIFECYCLE OVERVIEW (Scroll Reveal)
          ========================================================================= */}
      <RevealOnScroll>
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-gray-200 pb-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-kits-red block mb-0.5">
                End-to-End Operational Lifecycle
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                Unified Campus Event Workflow
              </h2>
            </div>
            <Link
              to="/about-keos"
              className="text-xs font-extrabold text-kits-blue hover:underline inline-flex items-center gap-1 group"
            >
              <span>Learn how KITS-EOS works</span>
              <ArrowRight className="h-3.5 w-3.5 transform group-hover:translate-x-0.5 transition" />
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { step: '01', title: 'Flagship Event', desc: 'Institutional publishing' },
              { step: '02', title: 'Categories', desc: 'Departmental tracks' },
              { step: '03', title: 'Sub-Events', desc: 'Competitions & rules' },
              { step: '04', title: 'Registration', desc: 'Solo or team onboarding' },
              { step: '05', title: 'Fee & Pass', desc: 'Automated receipt' },
              { step: '06', title: 'QR & Token', desc: 'Tamper-evident credential' },
              { step: '07', title: 'Coordinators', desc: 'Faculty & student check' },
              { step: '08', title: 'Attendance', desc: 'Live check-in gate' },
              { step: '09', title: 'Results', desc: 'Official score publishing' },
              { step: '10', title: 'Feedback', desc: 'Student reviews & help' },
              { step: '11', title: 'Certificates', desc: 'Signed digital award' },
              { step: '12', title: 'Audit Oversight', desc: 'Administrative log' },
            ].map((item) => (
              <div
                key={item.step}
                className="p-3.5 bg-white rounded-2xl border border-gray-200 shadow-2xs hover:border-gray-300 card-hover-interactive space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-black text-kits-red bg-red-50 px-1.5 py-0.5 rounded">
                    {item.step}
                  </span>
                  <CheckCircle2 className="h-3.5 w-3.5 text-gray-300" />
                </div>
                <h3 className="text-xs font-black text-gray-900 tracking-tight leading-snug">
                  {item.title}
                </h3>
                <p className="text-[10px] text-gray-500 font-medium leading-tight">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>
      </RevealOnScroll>

      {/* =========================================================================
          3. ACTIVE FLAGSHIP EVENTS (Scroll Reveal + Live DB)
          ========================================================================= */}
      <RevealOnScroll delay={60}>
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-gray-200 pb-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-kits-blue block mb-0.5">
                Live from Database
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                Featured Flagship Events
              </h2>
            </div>
            <Link
              to="/events"
              className="text-xs font-extrabold text-kits-red hover:underline inline-flex items-center gap-1 group"
            >
              <span>View all campus events</span>
              <ArrowRight className="h-3.5 w-3.5 transform group-hover:translate-x-0.5 transition" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading active events">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs flex flex-col justify-between min-h-[360px]"
                >
                  <div className="space-y-3">
                    <div className="w-full h-44 sm:h-48 rounded-xl bg-gray-100 animate-pulse overflow-hidden relative">
                      <div className="absolute top-2.5 right-2.5 h-6 w-28 rounded-full bg-gray-200" />
                    </div>
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-24 rounded bg-gray-200 animate-pulse" />
                        <div className="h-4 w-28 rounded bg-gray-100 animate-pulse" />
                      </div>
                      <div className="h-6 w-3/4 rounded bg-gray-200 animate-pulse" />
                      <div className="space-y-1.5 pt-1">
                        <div className="h-3.5 w-full rounded bg-gray-100 animate-pulse" />
                        <div className="h-3.5 w-4/5 rounded bg-gray-100 animate-pulse" />
                      </div>
                    </div>
                  </div>
                  <div className="pt-4 mt-4 border-t border-gray-100 flex items-center justify-between">
                    <div className="h-4 w-36 rounded bg-gray-200 animate-pulse" />
                    <div className="h-4 w-4 rounded-full bg-gray-200 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-gray-200">
              <Calendar className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-gray-700">No active events published at the moment</h3>
              <p className="text-xs text-gray-400 mt-1">Please check back soon for upcoming college symposiums.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {events.map((ev) => {
                const effectiveStatus = resolveEffectiveEventStatus(ev as any, now);
                const badgeTheme = getLifecycleBadgeTheme(effectiveStatus);
                const isCompleted = effectiveStatus === 'COMPLETED';
                const isOngoing = effectiveStatus === 'ONGOING';
                const isUpcoming = effectiveStatus === 'UPCOMING';

                return (
                  <Link
                    key={ev.id}
                    to={`/events/${ev.id}`}
                    className={`group bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs hover:border-kits-blue card-hover-interactive flex flex-col justify-between ${
                      isCompleted ? 'opacity-85' : ''
                    } ${isUpcoming ? 'ring-1 ring-blue-100' : ''}`}
                  >
                    <div className="space-y-3">
                      <div className="relative">
                        <EventBannerImage
                          bannerPath={ev.banner_path}
                          eventName={ev.name}
                          priority={false}
                          className={`w-full h-44 sm:h-48 rounded-xl shadow-2xs overflow-hidden ${
                            isCompleted ? 'grayscale contrast-90' : ''
                          }`}
                          imageClassName="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
                        />
                        <div className="absolute top-2.5 right-2.5 z-10">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-2xs ${badgeTheme.bg} ${badgeTheme.text} ${badgeTheme.border}`}
                          >
                            {badgeTheme.indicatorDot && (
                              <span className={`h-1.5 w-1.5 rounded-full ${badgeTheme.indicatorDot}`} />
                            )}
                            {badgeTheme.label}
                          </span>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-kits-blue border border-blue-100">
                            Flagship Event
                          </span>
                          <span className="text-[10px] text-gray-400 flex items-center gap-1 font-semibold">
                            <Clock className="h-3 w-3" />
                            {new Date(ev.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>

                        <h3 className={`text-base sm:text-lg font-black uppercase tracking-tight transition ${
                          isCompleted ? 'text-gray-700' : 'text-gray-900 group-hover:text-kits-blue'
                        }`}>
                          {ev.name.toUpperCase()}
                        </h3>

                        <p className="text-xs text-gray-500 line-clamp-2 mt-1 font-normal leading-relaxed">
                          {ev.description || 'Institutional symposium bringing together technical competitions, hackathons, and presentations.'}
                        </p>
                      </div>
                    </div>

                    <div className={`pt-4 mt-4 border-t border-gray-100 flex items-center justify-between text-xs font-black ${
                      isCompleted 
                        ? 'text-gray-400' 
                        : isOngoing 
                        ? 'text-kits-red group-hover:text-red-700' 
                        : 'text-kits-red group-hover:text-kits-blue'
                    }`}>
                      <span>
                        {effectiveStatus === 'REGISTRATIONS OPEN' && 'Explore Categories & Register'}
                        {effectiveStatus === 'UPCOMING' && 'Registration Opens Soon'}
                        {effectiveStatus === 'REGISTRATIONS CLOSED' && 'Registrations Closed'}
                        {effectiveStatus === 'ONGOING' && '● Happening Now • View Event'}
                        {effectiveStatus === 'COMPLETED' && 'Event Concluded • View Details'}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 transform group-hover:translate-x-1 transition" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </RevealOnScroll>

      {/* =========================================================================
          4. STUDENT PARTICIPATION JOURNEY (Scroll Reveal)
          ========================================================================= */}
      <RevealOnScroll delay={60}>
        <section className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-10 shadow-2xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-gray-100 pb-4">
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-kits-red block">
                How It Works for Students
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                Your 5-Step Participation Journey
              </h2>
            </div>
            <p className="text-xs text-gray-500 font-medium">
              A transparent, self-service pathway from registration to credential issuance.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              {
                step: '01',
                title: 'Discover & Explore',
                desc: 'Browse flagship symposiums, categories, sub-event rules, prize pools, and schedule details.'
              },
              {
                step: '02',
                title: 'Register & Form Teams',
                desc: 'Register solo or assemble teams with automatic teammate validation, auto-saved drafts, and document uploads.'
              },
              {
                step: '03',
                title: 'Get Digital Passes & ID',
                desc: 'Instantly access your dynamic QR pass, 10-digit manual token, student Digital ID Card, and transaction receipts.'
              },
              {
                step: '04',
                title: 'Venue Check-In',
                desc: 'Present your QR code or 10-digit token at the hall entrance to authorized event coordinators.'
              },
              {
                step: '05',
                title: 'Feedback & Certificates',
                desc: 'Submit quick post-event feedback to unlock official verified participation and merit certificates.'
              }
            ].map((journey) => (
              <div
                key={journey.step}
                className="p-4 rounded-2xl bg-gray-50/70 border border-gray-200/80 space-y-2 card-hover-interactive flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <span className="font-mono text-xs font-black text-kits-blue bg-blue-50 px-2 py-0.5 rounded border border-blue-100 inline-block">
                    Step {journey.step}
                  </span>
                  <h3 className="text-xs font-black text-gray-900 uppercase tracking-tight">
                    {journey.title}
                  </h3>
                  <p className="text-[11px] text-gray-500 font-normal leading-relaxed">
                    {journey.desc}
                  </p>
                </div>
                <div className="pt-2 flex items-center text-[10px] font-bold text-gray-400 gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  <span>Verified Step</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </RevealOnScroll>

      {/* =========================================================================
          5. CORE SYSTEM PILLARS (Scroll Reveal)
          ========================================================================= */}
      <RevealOnScroll delay={60}>
        <section className="bg-white rounded-3xl border border-gray-200 p-8 shadow-2xs space-y-6">
          <div className="text-center max-w-2xl mx-auto space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-kits-red block">
              Institutional Standards
            </span>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">
              Why KITS-EOS is Authoritative
            </h2>
            <p className="text-xs text-gray-500">
              Engineered for complete administrative oversight, verifiable credentials, and seamless student participation.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-gray-50/70 border border-gray-200 space-y-2 card-hover-interactive">
              <div className="h-9 w-9 rounded-xl bg-red-100 text-kits-red flex items-center justify-center font-bold">
                <Layers className="h-4 w-4" />
              </div>
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-tight">
                Centralized Control
              </h3>
              <p className="text-[11px] text-gray-500 font-normal leading-relaxed">
                Consolidates multiple department symposiums, track categories, and registrations into a single institutional portal.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-gray-50/70 border border-gray-200 space-y-2 card-hover-interactive">
              <div className="h-9 w-9 rounded-xl bg-blue-100 text-kits-blue flex items-center justify-center font-bold">
                <QrCode className="h-4 w-4" />
              </div>
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-tight">
                Dynamic QR & Secure Token
              </h3>
              <p className="text-[11px] text-gray-500 font-normal leading-relaxed">
                Unique encrypted QR passes and 10-digit manual tokens enable quick check-in and prevent duplicate entries.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-gray-50/70 border border-gray-200 space-y-2 card-hover-interactive">
              <div className="h-9 w-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                <Users className="h-4 w-4" />
              </div>
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-tight">
                Accountable Check-in
              </h3>
              <p className="text-[11px] text-gray-500 font-normal leading-relaxed">
                Faculty and student coordinators perform real-time venue check-ins with instant server validation and duplicate prevention.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-gray-50/70 border border-gray-200 space-y-2 card-hover-interactive">
              <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold">
                <Award className="h-4 w-4" />
              </div>
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-tight">
                Verifiable Certificates
              </h3>
              <p className="text-[11px] text-gray-500 font-normal leading-relaxed">
                Official participation and merit certificates equipped with unique IDs, verifiable publicly by employers and universities.
              </p>
            </div>
          </div>
        </section>
      </RevealOnScroll>

      {/* =========================================================================
          6. ACCOUNT RECOVERY & SUPPORT NOTICE (Scroll Reveal)
          ========================================================================= */}
      <RevealOnScroll delay={60}>
        <section className="bg-gradient-to-r from-blue-50/80 via-white to-red-50/60 rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-1.5 max-w-2xl text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100/70 text-kits-blue border border-blue-200">
              <KeyRound className="h-3 w-3" />
              <span>Student Account Security & Self-Service</span>
            </div>
            <h3 className="text-lg sm:text-xl font-black text-gray-900 tracking-tight">
              Forgot Your Password or Need Help?
            </h3>
            <p className="text-xs sm:text-sm text-gray-600 leading-relaxed font-normal">
              Students can reset forgotten passwords anytime via the secure password-recovery flow. For registration, pass retrieval, or campus queries, our technical support desk is available 24/7.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 shrink-0">
            <Link
              to="/forgot-password"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-gray-300 text-gray-800 text-xs font-bold hover:bg-gray-50 shadow-2xs transition"
            >
              <KeyRound className="h-3.5 w-3.5 text-kits-red" />
              <span>Reset Password</span>
            </Link>
            <Link
              to="/tech-support"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-kits-blue text-white text-xs font-bold hover:bg-blue-700 shadow-2xs transition"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              <span>Tech Support & FAQs</span>
            </Link>
          </div>
        </section>
      </RevealOnScroll>

      {/* =========================================================================
          7. QUICK ACCESS ACTION GRID (Scroll Reveal)
          ========================================================================= */}
      <RevealOnScroll delay={60}>
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link
            to="/contact-coordinators"
            className="group p-5 bg-white rounded-2xl border border-gray-200 shadow-2xs hover:border-kits-red card-hover-interactive space-y-2"
          >
            <PhoneCall className="h-5 w-5 text-kits-red group-hover:scale-110 transition" />
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">
              Contact Coordinators
            </h3>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Reach assigned faculty and student coordinators for sub-event queries.
            </p>
          </Link>

          <Link
            to="/verify-certificate"
            className="group p-5 bg-white rounded-2xl border border-gray-200 shadow-2xs hover:border-kits-blue card-hover-interactive space-y-2"
          >
            <ShieldCheck className="h-5 w-5 text-kits-blue group-hover:scale-110 transition" />
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">
              Verify Certificate
            </h3>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Validate official credentials with Certificate ID and cryptographic proof.
            </p>
          </Link>

          <Link
            to="/tech-support"
            className="group p-5 bg-white rounded-2xl border border-gray-200 shadow-2xs hover:border-gray-400 card-hover-interactive space-y-2"
          >
            <HelpCircle className="h-5 w-5 text-gray-700 group-hover:scale-110 transition" />
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">
              Tech Support & FAQs
            </h3>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Get help with registration, pass retrieval, or fee reconciliation.
            </p>
          </Link>

          <Link
            to="/about-keos"
            className="group p-5 bg-white rounded-2xl border border-gray-200 shadow-2xs hover:border-kits-blue card-hover-interactive space-y-2"
          >
            <FileText className="h-5 w-5 text-kits-blue group-hover:scale-110 transition" />
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">
              About K-EOS System
            </h3>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Read the institutional background, operational architecture, and mission.
            </p>
          </Link>
        </section>
      </RevealOnScroll>
    </div>
  );
}
