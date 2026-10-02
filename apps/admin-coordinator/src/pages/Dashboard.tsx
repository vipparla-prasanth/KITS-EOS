import { useState, useEffect } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { Link } from 'react-router-dom';
import { 
  Calendar, 
  Users, 
  ClipboardList, 
  CreditCard, 
  CheckSquare, 
  Trophy, 
  Award, 
  MessageSquare, 
  AlertTriangle, 
  ArrowRight,
  TrendingUp,
  Plus,
  BarChart3
} from 'lucide-react';
import type { DashboardMetrics, AuditLog } from '@kits-eos/shared/src/types/models';
import { RevealOnScroll } from '../components/motion/RevealOnScroll';
import { AdminOperationsHero } from '../components/dashboard/AdminOperationsHero';

export function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalEvents: 0,
    totalCategories: 0,
    totalSubEvents: 0,
    totalCoordinators: 0,
    totalRegistrations: 0,
    confirmedRegistrations: 0,
    totalRevenue: 0,
    totalAttendance: 0,
    totalCertificates: 0,
    totalFeedback: 0,
    openComplaints: 0,
  });

  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch counts in parallel from Postgres
        const [
          eventsRes,
          catsRes,
          subEventsRes,
          activeCoordsRes,
          regsRes,
          confirmedRegsRes,
          paymentsRes,
          attendRes,
          certsRes,
          feedbackRes,
          complaintsRes,
          logsRes
        ] = await Promise.all([
          supabase.from('events').select('*', { count: 'exact', head: true }).neq('status', 'PERMANENTLY_DELETED'),
          supabase.from('categories').select('*', { count: 'exact', head: true }).neq('status', 'PERMANENTLY_DELETED'),
          supabase.from('sub_events').select('*', { count: 'exact', head: true }).neq('status', 'PERMANENTLY_DELETED'),
          supabase.rpc('get_active_coordinators_count'),
          supabase.from('registrations').select('*', { count: 'exact', head: true }),
          supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('status', 'CONFIRMED'),
          supabase.from('payments').select('amount').eq('status', 'SUCCESS'),
          supabase.from('attendance_records').select('*', { count: 'exact', head: true }),
          supabase.from('certificates').select('*', { count: 'exact', head: true }),
          supabase.from('feedback_responses').select('*', { count: 'exact', head: true }),
          supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('status', 'OPEN'),
          supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(6)
        ]);

        if (activeCoordsRes.error) {
          console.error('Failed to load active coordinators count:', activeCoordsRes.error);
        }

        const totalRev = paymentsRes.data?.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0;

        setMetrics({
          totalEvents: eventsRes.count || 0,
          totalCategories: catsRes.count || 0,
          totalSubEvents: subEventsRes.count || 0,
          totalCoordinators: activeCoordsRes.error ? null : (activeCoordsRes.data ?? 0),
          totalRegistrations: regsRes.count || 0,
          confirmedRegistrations: confirmedRegsRes.count || 0,
          totalRevenue: totalRev,
          totalAttendance: attendRes.count || 0,
          totalCertificates: certsRes.count || 0,
          totalFeedback: feedbackRes.count || 0,
          openComplaints: complaintsRes.count || 0,
        });

        if (logsRes.data) {
          setRecentLogs(logsRes.data as AuditLog[]);
        }
      } catch (err: any) {
        console.error('Failed to load admin dashboard:', err);
        setError(err.message || 'Failed to load metrics.');
      } finally {
        setIsLoading(false);
      }
    }

    loadDashboardData();
  }, []);

  if (isLoading) {
    return <LoadingState message="Loading administrative dashboard metrics..." />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6 sm:space-y-8 pb-12 font-sans">
      <div className="stagger-1">
        <PageHeader 
          title="Administrative Command Center" 
          description="Real-time institutional metrics, event lifecycles, and operational overview."
          action={
            <div className="flex items-center gap-2">
              <Link
                to="/admin/analytics"
                className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-white border border-gray-300 text-gray-700 text-xs font-bold hover:bg-gray-50 hover:text-kits-blue transition shadow-2xs cursor-pointer min-h-[44px]"
              >
                <BarChart3 className="mr-1.5 h-4 w-4 text-kits-blue" />
                <span>View Analytics</span>
              </Link>
              <Link
                to="/admin/events/new"
                className="inline-flex items-center justify-center px-4.5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider shadow-2xs hover:bg-red-700 active:scale-95 transition min-h-[44px] cursor-pointer"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                <span>Create New Event</span>
              </Link>
            </div>
          }
        />
      </div>

      {/* Operations Overview Hero with Lottie Animation */}
      <div className="stagger-2">
        <AdminOperationsHero />
      </div>

      {/* Primary KPI Cards */}
      <div className="stagger-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Events KPI */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs card-hover-interactive flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Flagship Events</span>
            <div className="p-2 rounded-xl bg-red-50 text-kits-red">
              <Calendar className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-3xl font-black text-gray-900">{metrics.totalEvents}</h3>
            <p className="text-[11px] text-gray-500 mt-1 font-medium">
              {metrics.totalCategories} Categories • {metrics.totalSubEvents} Sub-events
            </p>
          </div>
          <Link to="/admin/events" className="mt-4 inline-flex items-center text-xs font-bold text-kits-red hover:underline group">
            <span>Manage Events</span>
            <ArrowRight className="ml-1 h-3.5 w-3.5 transform group-hover:translate-x-0.5 transition" />
          </Link>
        </div>

        {/* Registrations KPI */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs card-hover-interactive flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Total Registrations</span>
            <div className="p-2 rounded-xl bg-blue-50 text-kits-blue">
              <ClipboardList className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-3xl font-black text-gray-900">{metrics.totalRegistrations}</h3>
            <p className="text-[11px] text-emerald-600 font-bold mt-1">
              {metrics.confirmedRegistrations} Confirmed Participations
            </p>
          </div>
          <Link to="/admin/registrations" className="mt-4 inline-flex items-center text-xs font-bold text-kits-blue hover:underline group">
            <span>View Registrations</span>
            <ArrowRight className="ml-1 h-3.5 w-3.5 transform group-hover:translate-x-0.5 transition" />
          </Link>
        </div>

        {/* Revenue KPI */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs card-hover-interactive flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Revenue Collected</span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <CreditCard className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-3xl font-black text-gray-900">₹{metrics.totalRevenue.toLocaleString('en-IN')}</h3>
            <p className="text-[11px] text-gray-500 mt-1 font-medium flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-emerald-600" /> Verified payment collections
            </p>
          </div>
          <Link to="/admin/payments" className="mt-4 inline-flex items-center text-xs font-bold text-emerald-700 hover:underline group">
            <span>View Payments</span>
            <ArrowRight className="ml-1 h-3.5 w-3.5 transform group-hover:translate-x-0.5 transition" />
          </Link>
        </div>

        {/* Coordinators KPI */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs card-hover-interactive flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Active Coordinators</span>
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
              <Users className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-3xl font-black text-gray-900">
              {metrics.totalCoordinators !== null ? metrics.totalCoordinators : (
                <span className="text-red-500 text-lg font-bold" title="Count temporarily unavailable">Unavailable</span>
              )}
            </h3>
            <p className="text-[11px] text-gray-500 mt-1 font-medium">
              Faculty & Student Operations Staff
            </p>
          </div>
          <Link to="/admin/coordinators" className="mt-4 inline-flex items-center text-xs font-bold text-purple-700 hover:underline group">
            <span>Manage Coordinators</span>
            <ArrowRight className="ml-1 h-3.5 w-3.5 transform group-hover:translate-x-0.5 transition" />
          </Link>
        </div>
      </div>

      {/* Secondary Operational Metrics Grid */}
      <RevealOnScroll delay={60}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Link to="/admin/attendance" className="bg-white p-4 rounded-2xl border border-gray-200 hover:border-kits-red card-hover-interactive group">
            <div className="flex items-center justify-between mb-2">
              <CheckSquare className="h-4 w-4 text-kits-red" />
              <span className="text-[10px] font-extrabold uppercase text-gray-400">Attendance</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{metrics.totalAttendance}</p>
            <span className="text-[10px] text-gray-500 font-medium">Check-ins</span>
          </Link>

          <Link to="/admin/results" className="bg-white p-4 rounded-2xl border border-gray-200 hover:border-kits-red card-hover-interactive group">
            <div className="flex items-center justify-between mb-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              <span className="text-[10px] font-extrabold uppercase text-gray-400">Results</span>
            </div>
            <p className="text-xl font-bold text-gray-900">Manage</p>
            <span className="text-[10px] text-gray-500 font-medium">Winners & Standings</span>
          </Link>

          <Link to="/admin/certificates" className="bg-white p-4 rounded-2xl border border-gray-200 hover:border-kits-red card-hover-interactive group">
            <div className="flex items-center justify-between mb-2">
              <Award className="h-4 w-4 text-kits-blue" />
              <span className="text-[10px] font-extrabold uppercase text-gray-400">Certificates</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{metrics.totalCertificates}</p>
            <span className="text-[10px] text-gray-500 font-medium">Issued Credentials</span>
          </Link>

          <Link to="/admin/feedback" className="bg-white p-4 rounded-2xl border border-gray-200 hover:border-kits-red card-hover-interactive group">
            <div className="flex items-center justify-between mb-2">
              <MessageSquare className="h-4 w-4 text-teal-600" />
              <span className="text-[10px] font-extrabold uppercase text-gray-400">Feedback</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{metrics.totalFeedback}</p>
            <span className="text-[10px] text-gray-500 font-medium">Submissions</span>
          </Link>

          <Link to="/admin/complaints" className="bg-white p-4 rounded-2xl border border-gray-200 hover:border-kits-red card-hover-interactive group">
            <div className="flex items-center justify-between mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-[10px] font-extrabold uppercase text-gray-400">Grievances</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{metrics.openComplaints}</p>
            <span className="text-[10px] text-amber-600 font-bold">Open Tickets</span>
          </Link>

          <Link to="/admin/notifications" className="bg-white p-4 rounded-2xl border border-gray-200 hover:border-kits-blue card-hover-interactive group">
            <div className="flex items-center justify-between mb-2">
              <MessageSquare className="h-4 w-4 text-kits-blue" />
              <span className="text-[10px] font-extrabold uppercase text-gray-400">Broadcasts</span>
            </div>
            <p className="text-xl font-bold text-gray-900">Active</p>
            <span className="text-[10px] text-gray-500 font-medium">Notifications</span>
          </Link>
        </div>
      </RevealOnScroll>

      {/* Operational Fast Hubs & Recent Activity Feed */}
      <RevealOnScroll delay={80}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Fast Action Shortcuts */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-kits-blue border-b border-gray-100 pb-2">
              Fast Action Shortcuts
            </h3>
            <div className="space-y-2.5">
              <Link 
                to="/admin/analytics" 
                className="flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-blue-50 hover:text-kits-blue transition text-xs font-bold text-gray-800 border border-gray-200/80 group"
              >
                <span>View Operational Analytics & Insights</span>
                <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:translate-x-0.5 transition" />
              </Link>
              <Link 
                to="/admin/events/new" 
                className="flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-red-50 hover:text-kits-red transition text-xs font-bold text-gray-800 border border-gray-200/80 group"
              >
                <span>+ Configure New Main Event</span>
                <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:translate-x-0.5 transition" />
              </Link>
              <Link 
                to="/admin/attendance" 
                className="flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-blue-50 hover:text-kits-blue transition text-xs font-bold text-gray-800 border border-gray-200/80 group"
              >
                <span>Scan / Record Attendance Check-in</span>
                <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:translate-x-0.5 transition" />
              </Link>
              <Link 
                to="/admin/results" 
                className="flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-amber-50 hover:text-amber-800 transition text-xs font-bold text-gray-800 border border-gray-200/80 group"
              >
                <span>Declare & Lock Sub-event Winners</span>
                <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:translate-x-0.5 transition" />
              </Link>
              <Link 
                to="/admin/students" 
                className="flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-emerald-50 hover:text-emerald-800 transition text-xs font-bold text-gray-800 border border-gray-200/80 group"
              >
                <span>Search Student Directory & Profiles</span>
                <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:translate-x-0.5 transition" />
              </Link>
            </div>
          </div>

          {/* Live Recent Activity Log */}
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-kits-blue">
                Recent System Activity
              </h3>
              <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Live Sync
              </span>
            </div>

            {recentLogs.length === 0 ? (
              <div className="text-center py-8 text-xs text-gray-400">
                No recent administrative actions recorded.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {recentLogs.map((log) => (
                  <div key={log.id} className="py-3 flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-900">{log.action}</span>
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                          {log.entity_type}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 font-mono">
                        Ref: {log.entity_id.substring(0, 18)}...
                      </p>
                    </div>
                    <span className="text-[11px] text-gray-400 shrink-0">
                      {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(log.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </RevealOnScroll>
    </div>
  );
}
