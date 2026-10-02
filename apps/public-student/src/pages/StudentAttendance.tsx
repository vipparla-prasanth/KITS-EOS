import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { 
  CheckCircle2, 
  Clock, 
  MapPin, 
  Calendar, 
  QrCode, 
  RefreshCw, 
  Users, 
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface AttendanceItem {
  registrationId: string;
  subEventId: string;
  subEventName: string;
  eventName: string;
  venue: string;
  startTime: string | null;
  teamName: string;
  manualToken: string;
  isAttended: boolean;
  checkInTime: string | null;
}

export function StudentAttendance() {
  const { user } = useAuth();
  const [attendanceList, setAttendanceList] = useState<AttendanceItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAttendance = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      // 1. Fetch student's confirmed registrations
      const { data: regData, error: regErr } = await supabase
        .from('registrations')
        .select(`
          id,
          sub_event_id,
          status,
          created_at,
          sub_events (
            id,
            name,
            venue,
            start_time,
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
              is_leader
            )
          )
        `)
        .eq('leader_id', user.id)
        .eq('status', 'CONFIRMED')
        .order('created_at', { ascending: false });

      if (regErr) throw regErr;
      const regs = regData || [];

      // 2. Fetch attendance records for this student
      const { data: attendData, error: attendErr } = await supabase
        .from('attendance_records')
        .select('sub_event_id, team_id, scanned_member_id, check_in_time');

      if (attendErr) throw attendErr;
      const attendanceMap = new Map<string, { check_in_time: string }>();
      attendData?.forEach((a) => {
        if (a.scanned_member_id) {
          attendanceMap.set(`${a.sub_event_id}_${a.scanned_member_id}`, { check_in_time: a.check_in_time });
        }
      });

      // 3. Map into items
      const items: AttendanceItem[] = regs.map((reg: any) => {
        const sub: any = Array.isArray(reg.sub_events) ? reg.sub_events[0] : reg.sub_events;
        const team: any = Array.isArray(reg.teams) ? reg.teams[0] : reg.teams;
        const members = team?.team_members || [];
        const studentMember = members.find((m: any) => m.user_id === user.id) || members.find((m: any) => m.is_leader) || members[0];
        const attendRecord = studentMember ? attendanceMap.get(`${sub?.id}_${studentMember.id}`) : null;
        const leaderMember = members.find((m: any) => m.is_leader) || members[0];

        return {
          registrationId: reg.id,
          subEventId: sub?.id,
          subEventName: sub?.name || 'Sub-Event',
          eventName: sub?.events?.name || sub?.categories?.events?.name || 'Flagship Event',
          venue: sub?.venue || 'Campus Arena',
          startTime: sub?.start_time,
          teamName: team?.team_name || 'Solo Participant',
          manualToken: leaderMember?.manual_token || 'N/A',
          isAttended: Boolean(attendRecord),
          checkInTime: attendRecord?.check_in_time || null,
        };
      });

      setAttendanceList(items);
    } catch (err: any) {
      console.error('Failed to load student attendance:', err);
      setError(err.message || 'Failed to load attendance records.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendance();
  }, [user]);

  if (isLoading) return <LoadingState message="Checking attendance status..." />;
  if (error) return <ErrorState message={error} onRetry={fetchAttendance} />;

  const attendedCount = attendanceList.filter((a) => a.isAttended).length;
  const pendingCount = attendanceList.length - attendedCount;

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-16 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Event Attendance Status</h1>
          <p className="text-xs text-gray-500 mt-1">
            Real-time on-venue check-in records verified by event coordinators.
          </p>
        </div>

        <button
          onClick={fetchAttendance}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-bold text-gray-600 transition self-start sm:self-auto"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Registered</span>
          <h3 className="text-2xl font-black text-gray-900 mt-1">{attendanceList.length}</h3>
          <p className="text-[11px] text-gray-500">Confirmed entries</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Attended (Checked In)</span>
          <h3 className="text-2xl font-black text-emerald-600 mt-1">{attendedCount}</h3>
          <p className="text-[11px] text-emerald-700">Verified at venue</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Not Checked In</span>
          <h3 className="text-2xl font-black text-amber-600 mt-1">{pendingCount}</h3>
          <p className="text-[11px] text-amber-700">Show QR at registration desk</p>
        </div>
      </div>

      {/* Attendance Records List */}
      {attendanceList.length === 0 ? (
        <EmptyState
          title="No Registered Events"
          description="You haven't registered for any events yet. Register for competitions to see your attendance status here."
          icon={<Clock className="h-8 w-8 text-gray-400" />}
          action={
            <Link
              to="/events"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-bold hover:bg-red-700 transition"
            >
              <Sparkles className="h-4 w-4" />
              <span>Explore Flagship Events</span>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {attendanceList.map((item) => (
            <div
              key={item.registrationId}
              className="bg-white rounded-2xl border border-gray-200 p-6 shadow-2xs hover:border-gray-300 transition space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-kits-blue">
                    {item.eventName}
                  </span>
                  <h3 className="text-lg font-black text-gray-900">{item.subEventName}</h3>
                  <div className="flex items-center gap-3 text-xs text-gray-500 font-mono">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-kits-red" />
                      {item.venue}
                    </span>
                    {item.startTime && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-gray-400" />
                        {formatDateTime12h(item.startTime)}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  {item.isAttended ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ATTENDED
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                      <Clock className="h-4 w-4 text-amber-600" />
                      NOT CHECKED IN
                    </span>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-gray-500 font-medium">Team:</span>
                  <span className="font-bold text-gray-900">{item.teamName}</span>
                </div>

                <div className="flex items-center gap-2 font-mono">
                  <QrCode className="h-3.5 w-3.5 text-kits-red" />
                  <span className="text-gray-500 font-medium font-sans">Token:</span>
                  <span className="font-bold text-kits-red">{item.manualToken}</span>
                </div>
              </div>

              {item.isAttended && item.checkInTime && (
                <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl text-xs text-emerald-800 font-mono">
                  Checked in at: {new Date(item.checkInTime).toLocaleString()}
                </div>
              )}

              {!item.isAttended && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-[11px] text-gray-500 italic">
                    Present your digital pass QR code or manual token to the coordinator at the event venue.
                  </span>
                  <Link
                    to="/my-registrations"
                    className="inline-flex items-center gap-1 text-xs font-bold text-kits-blue hover:underline shrink-0"
                  >
                    <span>View Pass & QR</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
