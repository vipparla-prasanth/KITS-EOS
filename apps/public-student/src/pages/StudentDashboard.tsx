import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { 
  ClipboardList, 
  CheckCircle2, 
  Trophy, 
  Award, 
  MessageSquare, 
  AlertTriangle, 
  Bell, 
  Calendar, 
  ArrowRight, 
  MapPin,
  FileSpreadsheet,
  Loader2
} from 'lucide-react';
import { downloadEventDirectoryExcel } from '../services/eventDirectoryService';


export function StudentDashboard() {
  const { user, profile } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloadingDirectory, setIsDownloadingDirectory] = useState(false);

  const handleDownloadDirectory = async () => {
    try {
      setIsDownloadingDirectory(true);
      await downloadEventDirectoryExcel();
    } catch (err: any) {
      console.error('Failed to download event directory:', err);
      alert(err.message || 'Unable to generate the Event Directory. Please try again.');
    } finally {
      setIsDownloadingDirectory(false);
    }
  };

  // Authoritative database states
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [attendanceCount, setAttendanceCount] = useState(0);
  const [resultsCount, setResultsCount] = useState(0);
  const [certificatesCount, setCertificatesCount] = useState(0);
  const [openComplaintsCount, setOpenComplaintsCount] = useState(0);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);

  const fetchDashboardData = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      // 1. Fetch Registrations where user is leader
      const [
        regRes,
        attendRes,
        certsRes,
        compRes,
        notifRes
      ] = await Promise.all([
        supabase
          .from('registrations')
          .select(`
            id,
            status,
            created_at,
            sub_events (
              id,
              name,
              start_time,
              end_time,
              venue,
              results_locked,
              results_published,
              events (
                id,
                name
              ),
              categories (
                id,
                name,
                events (
                  id,
                  name
                )
              )
            ),
            teams (
              id,
              team_name,
              team_members (
                id,
                user_id,
                manual_token,
                qr_identity,
                is_leader
              )
            )
          `)
          .eq('leader_id', user.id)
          .neq('status', 'CANCELLED')
          .order('created_at', { ascending: false }),
        supabase
          .from('attendance_records')
          .select('scanned_member_id'),
        supabase
          .from('certificates')
          .select('id, type, status')
          .eq('status', 'UNLOCKED'),
        supabase
          .from('complaints')
          .select('id')
          .eq('user_id', user.id)
          .eq('status', 'OPEN'),
        supabase
          .from('notifications')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_read', false)
      ]);

      if (regRes.error) throw regRes.error;
      const regs = regRes.data || [];
      setRegistrations(regs);

      // Attendance Records count strictly for this student
      const myMemberIds = new Set<string>();
      regs.forEach((r: any) => {
        const team = Array.isArray(r.teams) ? r.teams[0] : r.teams;
        const members = team?.team_members || [];
        const myMember = members.find((m: any) => m.user_id === user.id) || members.find((m: any) => m.is_leader) || members[0];
        if (myMember?.id) {
          myMemberIds.add(myMember.id);
        }
      });

      const myAttendedCount = (attendRes.data || []).filter((a: any) =>
        a.scanned_member_id && myMemberIds.has(a.scanned_member_id)
      ).length;
      setAttendanceCount(myAttendedCount);

      // Certificates count
      setCertificatesCount(certsRes.data?.length || 0);

      // Results count
      const lockedSubEventIds = regs
        .map((r: any) => (Array.isArray(r.sub_events) ? r.sub_events[0] : r.sub_events))
        .filter((sub: any) => sub?.results_published || sub?.results_locked)
        .map((sub: any) => sub?.id);
      setResultsCount(lockedSubEventIds.length);

      // Open Complaints count
      setOpenComplaintsCount(compRes.data?.length || 0);

      // Unread Notifications count
      setUnreadNotificationsCount(notifRes.data?.length || 0);

    } catch (err: any) {
      console.error('Failed to load student dashboard:', err);
      setError(err.message || 'Failed to load dashboard.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const confirmedRegistrations = useMemo(() => {
    return registrations.filter((r) => r.status === 'CONFIRMED');
  }, [registrations]);

  if (isLoading) return <LoadingState message="Loading your student control center..." />;
  if (error) return <ErrorState message={error} onRetry={fetchDashboardData} />;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16 font-sans page-enter">
      {/* =========================================================================
          INSTITUTIONAL STUDENT HERO BANNER
          ========================================================================= */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-[#002855] to-[#003366] text-white p-6 sm:p-8 shadow-xl border border-slate-700/50">
        {/* Subtle decorative background circles */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-red-600/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-blue-400/10 rounded-full blur-2xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/10 text-red-200 border border-white/15 backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>KITS-EOS Student Console • Active Session</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2">
              Welcome back, {profile?.full_name || user?.email?.split('@')[0]}
            </h1>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-200">
              <span className="px-2.5 py-0.5 rounded-lg bg-white/10 font-mono font-bold text-white border border-white/10">
                {profile?.roll_number || 'STU-AUTH'}
              </span>
              <span>•</span>
              <span className="font-medium text-slate-200">
                {profile?.department || 'Department of Engineering'}
              </span>
              <span>•</span>
              <span className="text-slate-300">
                Year {profile?.year_of_study || 3}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Link
              to="/events"
              className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-lg shadow-red-900/30 cursor-pointer"
            >
              <Calendar className="h-4 w-4" />
              <span>Explore Events</span>
            </Link>
            <Link
              to="/my-registrations"
              className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-bold uppercase tracking-wider active:scale-95 transition backdrop-blur-md cursor-pointer"
            >
              <ClipboardList className="h-4 w-4 text-blue-300" />
              <span>My Passes</span>
            </Link>
            <button
              type="button"
              onClick={handleDownloadDirectory}
              disabled={isDownloadingDirectory}
              className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-bold uppercase tracking-wider active:scale-95 transition backdrop-blur-md cursor-pointer disabled:opacity-50"
              title="Download official Event, Venue & Coordinator Directory (.xlsx)"
            >
              {isDownloadingDirectory ? (
                <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
              ) : (
                <FileSpreadsheet className="h-4 w-4 text-emerald-300" />
              )}
              <span>{isDownloadingDirectory ? 'Generating...' : 'Event Directory'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          COMPACT KPI METRIC TILES (Rich Micro-interactions)
          ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Registrations */}
        <Link
          to="/my-registrations"
          className="bg-white p-4 rounded-2xl border border-gray-200/90 shadow-2xs hover:border-kits-blue hover:shadow-md card-hover-interactive group space-y-2 transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <div className="p-2 bg-blue-50 text-kits-blue rounded-xl group-hover:scale-110 transition duration-200">
              <ClipboardList className="h-4 w-4" />
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-kits-blue group-hover:translate-x-0.5 transition" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">Registrations</span>
            <span className="text-xl font-black text-gray-900">{confirmedRegistrations.length}</span>
          </div>
        </Link>

        {/* Attendance */}
        <Link
          to="/attendance"
          className="bg-white p-4 rounded-2xl border border-gray-200/90 shadow-2xs hover:border-emerald-500 hover:shadow-md card-hover-interactive group space-y-2 transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl group-hover:scale-110 transition duration-200">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">Attendance</span>
            <span className="text-xl font-black text-emerald-600">{attendanceCount}</span>
          </div>
        </Link>

        {/* Results */}
        <Link
          to="/certificates"
          className="bg-white p-4 rounded-2xl border border-gray-200/90 shadow-2xs hover:border-amber-500 hover:shadow-md card-hover-interactive group space-y-2 transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl group-hover:scale-110 transition duration-200">
              <Trophy className="h-4 w-4" />
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-amber-600 group-hover:translate-x-0.5 transition" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">Published Results</span>
            <span className="text-xl font-black text-amber-600">{resultsCount}</span>
          </div>
        </Link>

        {/* Certificates & Achievements */}
        <Link
          to="/certificates"
          className="bg-white p-4 rounded-2xl border border-gray-200/90 shadow-2xs hover:border-purple-500 hover:shadow-md card-hover-interactive group space-y-2 transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <div className="p-2 bg-purple-50 text-purple-600 rounded-xl group-hover:scale-110 transition duration-200">
              <Award className="h-4 w-4" />
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-purple-600 group-hover:translate-x-0.5 transition" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">Certificates</span>
            <span className="text-xl font-black text-purple-600">{certificatesCount}</span>
          </div>
        </Link>

        {/* Help Tickets */}
        <Link
          to="/complaints"
          className="bg-white p-4 rounded-2xl border border-gray-200/90 shadow-2xs hover:border-red-500 hover:shadow-md card-hover-interactive group space-y-2 transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <div className="p-2 bg-red-50 text-kits-red rounded-xl group-hover:scale-110 transition duration-200">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-kits-red group-hover:translate-x-0.5 transition" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">Support Tickets</span>
            <span className="text-xl font-black text-gray-900">{openComplaintsCount}</span>
          </div>
        </Link>

        {/* Notifications */}
        <Link
          to="/notifications"
          className="bg-white p-4 rounded-2xl border border-gray-200/90 shadow-2xs hover:border-kits-red hover:shadow-md card-hover-interactive group space-y-2 transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <div className="p-2 bg-red-50 text-kits-red rounded-xl group-hover:scale-110 transition duration-200">
              <Bell className="h-4 w-4" />
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-kits-red group-hover:translate-x-0.5 transition" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">Notifications</span>
            <span className="text-xl font-black text-kits-red">{unreadNotificationsCount}</span>
          </div>
        </Link>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Registered Sub-events */}
        <div className="lg:col-span-2 space-y-5">
          <div className="flex items-center justify-between pt-1">
            <h2 className="text-xs font-black uppercase tracking-wider text-gray-900">
              Active Registered Events ({confirmedRegistrations.length})
            </h2>
            <Link to="/my-registrations" className="text-xs font-bold text-kits-blue hover:underline">
              View All Passes →
            </Link>
          </div>

          {confirmedRegistrations.length === 0 ? (
            <div className="bg-white p-8 rounded-3xl border border-gray-200 text-center space-y-3 shadow-2xs">
              <ClipboardList className="h-8 w-8 text-gray-300 mx-auto" />
              <h3 className="text-xs font-bold text-gray-900">No Active Registrations</h3>
              <p className="text-[11px] text-gray-500 max-w-sm mx-auto">
                You have not registered for any competitions yet. Browse upcoming events to participate and earn verified credentials.
              </p>
              <Link
                to="/events"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-bold hover:bg-kits-red transition cursor-pointer"
              >
                <span>Browse Events</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {confirmedRegistrations.slice(0, 3).map((reg) => {
                const sub = reg.sub_events;
                const team = reg.teams?.[0] || reg.teams;
                const leaderMember = team?.team_members?.find((m: any) => m.is_leader) || team?.team_members?.[0];
                const eventName = sub?.events?.name || sub?.categories?.events?.name || 'Flagship Event';

                return (
                  <div
                    key={reg.id}
                    className="bg-white p-5 rounded-2xl border border-gray-200/90 shadow-2xs hover:border-kits-blue/40 hover:shadow-md card-hover-interactive transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-blue-50 text-kits-blue text-[10px] font-black uppercase tracking-wider border border-blue-100">
                          {eventName}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                          CONFIRMED
                        </span>
                      </div>

                      <h3 className="text-sm font-black text-gray-900 tracking-tight">
                        {sub?.name?.toUpperCase()}
                      </h3>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 font-mono">
                        {sub?.start_time && (
                          <span className="flex items-center gap-1 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100">
                            <Calendar className="h-3 w-3 text-gray-400" />
                            {formatDateTime12h(sub.start_time)}
                          </span>
                        )}
                        {sub?.venue && (
                          <span className="flex items-center gap-1 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100">
                            <MapPin className="h-3 w-3 text-kits-red" />
                            {sub.venue}
                          </span>
                        )}
                      </div>

                      {leaderMember?.manual_token && (
                        <p className="text-[11px] font-mono text-kits-red font-black pt-0.5">
                          Verification Token: <span className="underline decoration-red-200">{leaderMember.manual_token}</span>
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        to="/my-registrations"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-kits-blue text-xs font-bold transition shadow-2xs active:scale-95 cursor-pointer"
                      >
                        <ClipboardList className="h-3.5 w-3.5" />
                        <span>Pass & QR</span>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 1 Col: Fast Operational Actions */}
        <div className="space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-gray-900">
            Quick Actions
          </h2>

          <div className="bg-white p-4 rounded-3xl border border-gray-200/90 shadow-2xs space-y-2">
            <Link
              to="/my-registrations"
              className="p-3 bg-gray-50/80 hover:bg-blue-50/70 rounded-2xl border border-gray-200/70 hover:border-blue-200 transition flex items-center justify-between text-xs font-bold text-gray-800 group"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-blue-100/70 text-kits-blue rounded-xl group-hover:scale-105 transition">
                  <ClipboardList className="h-4 w-4" />
                </div>
                <span>My Passes & ID Cards</span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-kits-blue group-hover:translate-x-0.5 transition" />
            </Link>

            <Link
              to="/attendance"
              className="p-3 bg-gray-50/80 hover:bg-emerald-50/70 rounded-2xl border border-gray-200/70 hover:border-emerald-200 transition flex items-center justify-between text-xs font-bold text-gray-800 group"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-emerald-100/70 text-emerald-600 rounded-xl group-hover:scale-105 transition">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <span>Attendance Verification</span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition" />
            </Link>

            <Link
              to="/certificates"
              className="p-3 bg-gray-50/80 hover:bg-amber-50/70 rounded-2xl border border-gray-200/70 hover:border-amber-200 transition flex items-center justify-between text-xs font-bold text-gray-800 group"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-amber-100/70 text-amber-600 rounded-xl group-hover:scale-105 transition">
                  <Award className="h-4 w-4" />
                </div>
                <span>Certificates & Achievements</span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-amber-600 group-hover:translate-x-0.5 transition" />
            </Link>

            <Link
              to="/feedback"
              className="p-3 bg-gray-50/80 hover:bg-purple-50/70 rounded-2xl border border-gray-200/70 hover:border-purple-200 transition flex items-center justify-between text-xs font-bold text-gray-800 group"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-purple-100/70 text-purple-600 rounded-xl group-hover:scale-105 transition">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <span>Submit Experience Feedback</span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-purple-600 group-hover:translate-x-0.5 transition" />
            </Link>

            <Link
              to="/complaints"
              className="p-3 bg-gray-50/80 hover:bg-red-50/70 rounded-2xl border border-gray-200/70 hover:border-red-200 transition flex items-center justify-between text-xs font-bold text-gray-800 group"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-red-100/70 text-kits-red rounded-xl group-hover:scale-105 transition">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <span>Support & Grievances</span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-kits-red group-hover:translate-x-0.5 transition" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
