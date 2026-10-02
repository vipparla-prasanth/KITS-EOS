import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useAuth } from '../../context/AuthContext';
import { formatDateOnly } from '@kits-eos/shared/src/utils/date';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { AttendanceVerificationHub } from '../../components/ui/AttendanceVerificationHub';
import type { Event, Category, SubEvent } from '@kits-eos/shared/src/types/models';
import { 
  Search, 
  Clock, 
  CheckCircle2, 
  RefreshCw, 
  Users,
  ChevronRight,
  ArrowLeft,
  Calendar,
  Layers,
  Tag,
  MapPin,
  CheckCheck,
  Award
} from 'lucide-react';

interface ParticipantRow {
  memberId: string;
  teamId?: string;
  teamName: string;
  isLeader?: boolean;
  name: string;
  rollNumber: string;
  college: string;
  dept: string;
  year: number | string;
  manualToken: string;
  qrIdentity?: string;
  isAttended: boolean;
  checkInTime?: string | null;
  checkedInBy?: string | null;
  regStatus?: string;
}

export function AttendanceList() {
  const { role, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-driven hierarchical state for refresh & history resilience
  const urlEventId = searchParams.get('eventId') || '';
  const urlCategoryId = searchParams.get('categoryId') || '';
  const urlSubEventId = searchParams.get('subEventId') || '';

  // Hierarchy entities
  const [events, setEvents] = useState<Event[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subEvents, setSubEvents] = useState<SubEvent[]>([]);
  const [isHierarchyLoading, setIsHierarchyLoading] = useState(true);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);

  // Level 1: Main Event Search & Filter
  const [eventSearchTerm, setEventSearchTerm] = useState('');
  const [eventStatusFilter, setEventStatusFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL');

  // Level 2 / 3: Sub-Event Search
  const [subEventSearchTerm, setSubEventSearchTerm] = useState('');

  // Level 4: Active Sub-event Verification & Roster
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [isRosterLoading, setIsRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [participantSearchTerm, setParticipantSearchTerm] = useState('');

  // =========================================================================
  // 1. FETCH FULL EVENT HIERARCHY
  // =========================================================================
  const fetchHierarchy = useCallback(async () => {
    try {
      setIsHierarchyLoading(true);
      setHierarchyError(null);

      // If accessed by a coordinator, query assigned sub-event IDs to scope access
      let allowedSubEventIds: Set<string> | null = null;
      if (role === 'COORDINATOR' && user) {
        const { data: assignData } = await supabase
          .from('coordinator_assignments')
          .select('sub_event_id')
          .eq('coordinator_id', user.id);
        if (assignData) {
          allowedSubEventIds = new Set(assignData.map((a: any) => a.sub_event_id));
        }
      }

      const [eventsRes, catsRes, subsRes] = await Promise.all([
        supabase
          .from('events')
          .select('*')
          .neq('status', 'PERMANENTLY_DELETED')
          .order('start_date', { ascending: false }),
        supabase
          .from('categories')
          .select('*')
          .neq('status', 'PERMANENTLY_DELETED')
          .order('name', { ascending: true }),
        supabase
          .from('sub_events')
          .select('*')
          .neq('status', 'PERMANENTLY_DELETED')
          .order('name', { ascending: true })
      ]);

      if (eventsRes.error) throw eventsRes.error;
      if (catsRes.error) throw catsRes.error;
      if (subsRes.error) throw subsRes.error;

      let rawEvents = (eventsRes.data as Event[]) || [];
      let rawCats = (catsRes.data as Category[]) || [];
      let rawSubs = (subsRes.data as SubEvent[]) || [];

      // Enforce coordinator scope if applicable
      if (allowedSubEventIds !== null) {
        rawSubs = rawSubs.filter((s) => allowedSubEventIds!.has(s.id));
        const activeCatIds = new Set(rawSubs.map((s) => s.category_id).filter(Boolean));
        rawCats = rawCats.filter((c) => activeCatIds.has(c.id));
        const activeEventIds = new Set([
          ...rawSubs.map((s) => s.event_id).filter(Boolean),
          ...rawCats.map((c) => c.event_id).filter(Boolean)
        ]);
        rawEvents = rawEvents.filter((e) => activeEventIds.has(e.id));
      }

      setEvents(rawEvents);
      setCategories(rawCats);
      setSubEvents(rawSubs);
    } catch (err: any) {
      console.error('Failed to load event hierarchy for attendance:', err);
      setHierarchyError('Failed to load event hierarchy. Please verify network connection.');
    } finally {
      setIsHierarchyLoading(false);
    }
  }, [role, user]);

  useEffect(() => {
    fetchHierarchy();
  }, [fetchHierarchy]);

  // =========================================================================
  // 2. RESOLVE CURRENT SELECTION & DERIVED COLLECTIONS
  // =========================================================================
  const selectedEvent = useMemo(() => {
    if (!urlEventId) return null;
    return events.find((e) => e.id === urlEventId) || null;
  }, [events, urlEventId]);

  const selectedCategory = useMemo(() => {
    if (!urlCategoryId) return null;
    return categories.find((c) => c.id === urlCategoryId) || null;
  }, [categories, urlCategoryId]);

  const selectedSubEvent = useMemo(() => {
    if (!urlSubEventId) return null;
    return subEvents.find((s) => s.id === urlSubEventId) || null;
  }, [subEvents, urlSubEventId]);

  // Categories under selected Main Event
  const currentEventCategories = useMemo(() => {
    if (!selectedEvent) return [];
    return categories.filter((c) => c.event_id === selectedEvent.id);
  }, [categories, selectedEvent]);

  // Direct sub-events under selected Main Event (FLOW B: no category)
  const currentEventDirectSubEvents = useMemo(() => {
    if (!selectedEvent) return [];
    return subEvents.filter((s) => s.event_id === selectedEvent.id && !s.category_id);
  }, [subEvents, selectedEvent]);

  // Sub-events under selected Category (FLOW A)
  const currentCategorySubEvents = useMemo(() => {
    if (!selectedCategory) return [];
    return subEvents.filter((s) => s.category_id === selectedCategory.id);
  }, [subEvents, selectedCategory]);

  // Sibling sub-events for the active sub-event switcher
  const siblingSubEvents = useMemo(() => {
    if (!selectedSubEvent) return [];
    if (selectedSubEvent.category_id) {
      return subEvents.filter((s) => s.category_id === selectedSubEvent.category_id);
    }
    if (selectedSubEvent.event_id) {
      return subEvents.filter((s) => s.event_id === selectedSubEvent.event_id && !s.category_id);
    }
    return [selectedSubEvent];
  }, [subEvents, selectedSubEvent]);

  // =========================================================================
  // 3. LOAD SUB-EVENT ROSTER & ATTENDANCE DATA (LEVEL 4)
  // =========================================================================
  const loadSubEventAttendance = useCallback(async () => {
    if (!selectedSubEvent) return;

    try {
      setIsRosterLoading(true);
      setRosterError(null);
      const [regsRes, attendRes] = await Promise.all([
        supabase
          .from('registrations')
          .select(`
            id,
            sub_event_id,
            status,
            created_at,
            teams (
              id,
              team_name,
              team_members (
                id,
                snapshot_name,
                snapshot_roll_number,
                snapshot_college,
                snapshot_department,
                snapshot_year,
                is_leader,
                qr_identity,
                manual_token
              )
            )
          `)
          .eq('sub_event_id', selectedSubEvent.id)
          .eq('status', 'CONFIRMED'),

        supabase
          .from('attendance_records')
          .select(`
            id,
            team_id,
            scanned_member_id,
            check_in_time,
            checked_in_by,
            coordinators (
              display_name,
              username
            )
          `)
          .eq('sub_event_id', selectedSubEvent.id)
      ]);

      if (regsRes.error) throw regsRes.error;
      if (attendRes.error) throw attendRes.error;

      setRegistrations(regsRes.data || []);
      setAttendanceRecords(attendRes.data || []);
    } catch (err: any) {
      console.error('Failed to load attendance roster:', err);
      setRosterError('Failed to load attendance records for this sub-event.');
    } finally {
      setIsRosterLoading(false);
    }
  }, [selectedSubEvent]);

  useEffect(() => {
    if (selectedSubEvent) {
      loadSubEventAttendance();
    } else {
      setRegistrations([]);
      setAttendanceRecords([]);
    }
  }, [selectedSubEvent, loadSubEventAttendance]);

  // =========================================================================
  // 4. NAVIGATION HANDLERS (URL-SYNCHRONIZED)
  // =========================================================================
  const handleSelectEvent = (eventId: string) => {
    setSearchParams({ eventId });
  };

  const handleSelectCategory = (categoryId: string) => {
    if (selectedEvent) {
      setSearchParams({ eventId: selectedEvent.id, categoryId });
    }
  };

  const handleSelectSubEvent = (sub: SubEvent) => {
    if (sub.category_id) {
      const parentCat = categories.find((c) => c.id === sub.category_id);
      const evId = parentCat?.event_id || sub.event_id || selectedEvent?.id;
      if (evId) {
        setSearchParams({ eventId: evId, categoryId: sub.category_id, subEventId: sub.id });
        return;
      }
    }
    const evId = sub.event_id || selectedEvent?.id;
    if (evId) {
      setSearchParams({ eventId: evId, subEventId: sub.id });
      return;
    }
    setSearchParams({ subEventId: sub.id });
  };

  const handleBackToEvents = () => {
    setSearchParams({});
  };

  const handleBackToCategories = () => {
    if (selectedEvent) {
      setSearchParams({ eventId: selectedEvent.id });
    } else {
      setSearchParams({});
    }
  };

  const handleBackToSubEvents = () => {
    if (selectedEvent && selectedCategory) {
      setSearchParams({ eventId: selectedEvent.id, categoryId: selectedCategory.id });
    } else if (selectedEvent) {
      setSearchParams({ eventId: selectedEvent.id });
    } else {
      setSearchParams({});
    }
  };

  // =========================================================================
  // 5. TRANSFORM DATA FOR PARTICIPANT ROSTER (LEVEL 4)
  // =========================================================================
  const memberAttendanceMap = useMemo(() => {
    const map = new Map<string, any>();
    attendanceRecords.forEach((a) => {
      if (a.scanned_member_id) {
        map.set(a.scanned_member_id, a);
      }
    });
    return map;
  }, [attendanceRecords]);

  const participantRows: ParticipantRow[] = useMemo(() => {
    const rows: ParticipantRow[] = [];
    registrations.forEach((reg) => {
      const team = reg.teams?.[0] || reg.teams;
      const members = team?.team_members || [];

      members.forEach((m: any) => {
        const attendRecord = memberAttendanceMap.get(m.id);
        const isAttended = Boolean(attendRecord);

        rows.push({
          memberId: m.id,
          teamId: team?.id,
          teamName: team?.team_name || 'Solo Participant',
          isLeader: m.is_leader,
          name: m.snapshot_name,
          rollNumber: m.snapshot_roll_number,
          college: m.snapshot_college,
          dept: m.snapshot_department,
          year: m.snapshot_year,
          manualToken: m.manual_token,
          qrIdentity: m.qr_identity,
          isAttended,
          checkInTime: attendRecord?.check_in_time,
          checkedInBy: attendRecord?.coordinators?.display_name || (attendRecord ? 'Administrator' : null),
          regStatus: reg.status,
        });
      });
    });
    return rows;
  }, [registrations, memberAttendanceMap]);

  const filteredParticipants = useMemo(() => {
    const q = participantSearchTerm.toLowerCase();
    if (!q) return participantRows;
    return participantRows.filter((p) => (
      p.name?.toLowerCase().includes(q) ||
      p.rollNumber?.toLowerCase().includes(q) ||
      p.teamName?.toLowerCase().includes(q) ||
      p.manualToken?.toLowerCase().includes(q) ||
      p.college?.toLowerCase().includes(q)
    ));
  }, [participantRows, participantSearchTerm]);

  const totalRegistered = participantRows.length;
  const totalAttended = participantRows.filter((p) => p.isAttended).length;
  const totalPending = totalRegistered - totalAttended;
  const attendanceRate = totalRegistered > 0 ? Math.round((totalAttended / totalRegistered) * 100) : 0;

  // Level 1 Filtered Events
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const matchesSearch = ev.name.toLowerCase().includes(eventSearchTerm.toLowerCase()) ||
        (ev.description && ev.description.toLowerCase().includes(eventSearchTerm.toLowerCase()));
      const matchesStatus = eventStatusFilter === 'ALL' || ev.status === eventStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [events, eventSearchTerm, eventStatusFilter]);

  // Loading and Error Guards for initial hierarchy fetch
  if (isHierarchyLoading) {
    return <LoadingState message="Loading Institutional Event Hierarchy..." />;
  }

  if (hierarchyError) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto py-8">
        <ErrorState message={hierarchyError} onRetry={fetchHierarchy} />
      </div>
    );
  }

  // =========================================================================
  // LEVEL 4: ATTENDANCE VERIFICATION HUB VIEW
  // =========================================================================
  if (selectedSubEvent) {
    return (
      <div className="space-y-6 pb-16 font-sans page-enter">
        {/* Clickable Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-xs text-gray-500 flex-wrap" aria-label="Breadcrumb">
          <button
            onClick={handleBackToEvents}
            className="font-bold text-gray-700 hover:text-kits-blue transition cursor-pointer"
          >
            Attendance
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <button
            onClick={handleBackToCategories}
            className="font-bold text-gray-700 hover:text-kits-blue transition cursor-pointer"
          >
            {selectedEvent?.name || 'Main Event'}
          </button>
          {selectedCategory && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <button
                onClick={handleBackToSubEvents}
                className="font-bold text-gray-700 hover:text-kits-blue transition cursor-pointer"
              >
                {selectedCategory.name}
              </button>
            </>
          )}
          <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <span className="font-extrabold text-kits-red">{selectedSubEvent.name}</span>
        </nav>

        {/* Context Banner */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 bg-red-50 text-kits-red rounded-xl border border-red-100 shrink-0">
              <CheckCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-kits-blue bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                  {selectedEvent?.name || 'Event'}
                </span>
                {selectedCategory && (
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                    {selectedCategory.name}
                  </span>
                )}
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {selectedSubEvent.participation_type}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight mt-1">
                {selectedSubEvent.name}
              </h2>
              {selectedSubEvent.venue && (
                <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                  <MapPin className="h-3.5 w-3.5 text-gray-400" />
                  {selectedSubEvent.venue}
                </p>
              )}
            </div>
          </div>

          {/* Quick Sub-event Switcher */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {siblingSubEvents.length > 1 && (
              <select
                value={selectedSubEvent.id}
                onChange={(e) => {
                  const targetSub = siblingSubEvents.find((s) => s.id === e.target.value);
                  if (targetSub) handleSelectSubEvent(targetSub);
                }}
                className="bg-gray-50 border border-gray-200 text-gray-800 text-xs font-bold rounded-xl px-3 py-2 focus:border-kits-blue focus:ring-1 focus:ring-kits-blue cursor-pointer"
              >
                {siblingSubEvents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.participation_type})
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={handleBackToSubEvents}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-xs font-bold text-gray-700 transition flex items-center gap-1.5 shrink-0 shadow-2xs hover:border-kits-blue/40"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Switch Sub-Event
            </button>
          </div>
        </div>

        {/* Interactive 3-Method Verification Hub (REUSED UNTOUCHED) */}
        <AttendanceVerificationHub
          subEventId={selectedSubEvent.id}
          subEventName={selectedSubEvent.name}
          onAttendanceRecorded={loadSubEventAttendance}
        />

        {/* Turnout Metrics Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Registered</span>
              <h4 className="text-2xl font-black text-gray-900 mt-1">{totalRegistered}</h4>
              <p className="text-[11px] text-gray-500 font-medium">Confirmed entries</p>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 text-kits-blue">
              <Users className="h-5 w-5" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Attended</span>
              <h4 className="text-2xl font-black text-emerald-600 mt-1">{totalAttended}</h4>
              <p className="text-[11px] text-emerald-700 font-medium">Checked-in participants</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Pending</span>
              <h4 className="text-2xl font-black text-amber-600 mt-1">{totalPending}</h4>
              <p className="text-[11px] text-amber-700 font-medium">Awaiting check-in</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Attendance Turnout</span>
              <h4 className="text-2xl font-black text-kits-red mt-1">{attendanceRate}%</h4>
            </div>
            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden mt-2">
              <div className="bg-kits-red h-full transition-all duration-500" style={{ width: `${attendanceRate}%` }} />
            </div>
          </div>
        </div>

        {/* Participant Roster Table */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-80">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                value={participantSearchTerm}
                onChange={(e) => setParticipantSearchTerm(e.target.value)}
                placeholder="Search by student, roll no, token, team..."
                className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
              />
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 font-mono">
                Showing {filteredParticipants.length} of {totalRegistered} participants
              </span>
              <button
                onClick={loadSubEventAttendance}
                disabled={isRosterLoading}
                className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200 transition cursor-pointer disabled:opacity-50"
                title="Refresh Roster"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRosterLoading ? 'animate-spin text-kits-blue' : ''}`} />
              </button>
            </div>
          </div>

          {rosterError && (
            <div className="p-4 bg-red-50 border-b border-red-200">
              <ErrorState message={rosterError} />
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-700">
              <thead className="bg-gray-50/80 text-[10px] font-extrabold uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3">Participant</th>
                  <th className="px-5 py-3">Roll Number</th>
                  <th className="px-5 py-3">Team / Mode</th>
                  <th className="px-5 py-3">Manual Token</th>
                  <th className="px-5 py-3 text-right">Attendance Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredParticipants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-gray-400">
                      No participants found matching the criteria.
                    </td>
                  </tr>
                ) : (
                  filteredParticipants.map((p) => (
                    <tr key={p.memberId} className="hover:bg-gray-50/60 transition">
                      <td className="px-5 py-3.5 font-bold text-gray-900">
                        <div className="flex items-center gap-1.5">
                          <span>{p.name}</span>
                          {p.isLeader && (
                            <span className="text-[9px] font-extrabold uppercase bg-blue-50 text-kits-blue px-1.5 py-0.2 rounded border border-blue-200">
                              Leader
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-400 font-normal">
                          {p.college} • {p.dept} (Yr {p.year})
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-gray-600 font-bold">{p.rollNumber}</td>
                      <td className="px-5 py-3.5">
                        <span className="font-bold text-gray-800">{p.teamName}</span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[11px] text-kits-red font-bold">
                        {p.manualToken}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {p.isAttended ? (
                          <div className="inline-flex flex-col items-end">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="h-3 w-3" /> Attended
                            </span>
                            {p.checkedInBy && (
                              <span className="text-[9px] text-gray-400 font-mono mt-0.5">by {p.checkedInBy}</span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="h-3 w-3" /> Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // LEVEL 3: SUB-EVENT SELECTION (UNDER SELECTED CATEGORY - FLOW A)
  // =========================================================================
  if (selectedEvent && selectedCategory) {
    const categorySubEventsFiltered = currentCategorySubEvents.filter((sub) =>
      sub.name.toLowerCase().includes(subEventSearchTerm.toLowerCase()) ||
      (sub.venue && sub.venue.toLowerCase().includes(subEventSearchTerm.toLowerCase()))
    );

    return (
      <div className="space-y-6 pb-16 font-sans page-enter">
        {/* Clickable Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-xs text-gray-500 flex-wrap" aria-label="Breadcrumb">
          <button
            onClick={handleBackToEvents}
            className="font-bold text-gray-700 hover:text-kits-blue transition cursor-pointer"
          >
            Attendance
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <button
            onClick={handleBackToCategories}
            className="font-bold text-gray-700 hover:text-kits-blue transition cursor-pointer"
          >
            {selectedEvent.name}
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <span className="font-extrabold text-kits-red">{selectedCategory.name}</span>
        </nav>

        {/* Level 3 Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <button
                onClick={handleBackToCategories}
                className="p-2 rounded-xl bg-white border border-gray-200 text-gray-600 hover:text-kits-blue hover:border-blue-200 transition shadow-2xs"
                title="Back to Categories"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div>
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
                  {selectedCategory.name} Sub-Events
                </h1>
                <p className="mt-0.5 text-xs sm:text-sm text-gray-500">
                  {selectedEvent.name} • Select a sub-event to open the attendance verification hub.
                </p>
              </div>
            </div>
          </div>

          {/* Sub-event Search */}
          <div className="relative w-full md:w-72">
            <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              value={subEventSearchTerm}
              onChange={(e) => setSubEventSearchTerm(e.target.value)}
              placeholder="Search sub-events..."
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium focus:border-kits-blue focus:ring-1 focus:ring-kits-blue shadow-2xs"
            />
          </div>
        </div>

        {/* Sub-Events Grid */}
        {categorySubEventsFiltered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-xs">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-3">
              <Tag className="h-6 w-6" />
            </div>
            <h3 className="text-base font-bold text-gray-900">No sub-events available</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              No sub-events are currently available for attendance in this category.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {categorySubEventsFiltered.map((sub) => (
              <div
                key={sub.id}
                onClick={() => handleSelectSubEvent(sub)}
                className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs hover:border-kits-blue/40 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-blue-50 text-kits-blue border border-blue-100">
                      {sub.participation_type}
                    </span>
                    <StatusBadge status={sub.status} />
                  </div>

                  <h3 className="text-base sm:text-lg font-black text-gray-900 group-hover:text-kits-blue transition">
                    {sub.name}
                  </h3>

                  {sub.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {sub.description}
                    </p>
                  )}

                  {sub.venue && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-600 mt-3 font-medium">
                      <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      <span className="truncate">{sub.venue}</span>
                    </div>
                  )}
                </div>

                <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between text-xs font-bold text-kits-red group-hover:text-kits-blue transition">
                  <span>Verify Attendance</span>
                  <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // LEVEL 2: CATEGORY & DIRECT SUB-EVENT SELECTION (FLOW A & FLOW B)
  // =========================================================================
  if (selectedEvent) {
    const hasCategories = currentEventCategories.length > 0;
    const hasDirectSubEvents = currentEventDirectSubEvents.length > 0;

    return (
      <div className="space-y-6 pb-16 font-sans page-enter">
        {/* Clickable Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-xs text-gray-500 flex-wrap" aria-label="Breadcrumb">
          <button
            onClick={handleBackToEvents}
            className="font-bold text-gray-700 hover:text-kits-blue transition cursor-pointer"
          >
            Attendance
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <span className="font-extrabold text-kits-red">{selectedEvent.name}</span>
        </nav>

        {/* Level 2 Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleBackToEvents}
              className="p-2 rounded-xl bg-white border border-gray-200 text-gray-600 hover:text-kits-blue hover:border-blue-200 transition shadow-2xs"
              title="Back to Events"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
                  {selectedEvent.name}
                </h1>
                <StatusBadge status={selectedEvent.status} />
              </div>
              <p className="mt-0.5 text-xs sm:text-sm text-gray-500 flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-gray-400" />
                <span>
                  {formatDateOnly(selectedEvent.start_date)} – {formatDateOnly(selectedEvent.end_date)}
                </span>
                <span>•</span>
                <span>
                  {hasCategories
                    ? 'Select a category to view sub-events.'
                    : 'Select a sub-event to manage attendance check-in.'}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* FLOW A: CATEGORIES GRID (When event has categories) */}
        {hasCategories && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold uppercase tracking-wider text-gray-700 flex items-center gap-2">
                <Layers className="h-4 w-4 text-kits-red" />
                Event Categories ({currentEventCategories.length})
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {currentEventCategories.map((cat) => {
                const catSubCount = subEvents.filter((s) => s.category_id === cat.id).length;
                return (
                  <div
                    key={cat.id}
                    onClick={() => handleSelectCategory(cat.id)}
                    className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 shadow-xs hover:border-kits-blue/40 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      <div className="p-3 bg-red-50 text-kits-red rounded-xl border border-red-100 w-fit mb-3.5">
                        <Layers className="h-5 w-5" />
                      </div>

                      <h3 className="text-lg font-black text-gray-900 group-hover:text-kits-blue transition">
                        {cat.name}
                      </h3>

                      {cat.description && (
                        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">
                          {cat.description}
                        </p>
                      )}
                    </div>

                    <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between">
                      <span className="text-xs font-extrabold text-gray-500 font-mono">
                        {catSubCount} {catSubCount === 1 ? 'Sub-Event' : 'Sub-Events'}
                      </span>
                      <span className="text-xs font-bold text-kits-red group-hover:text-kits-blue transition inline-flex items-center gap-1">
                        View Sub-Events
                        <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* FLOW B: DIRECT SUB-EVENTS (Or direct sub-events under an event with categories) */}
        {hasDirectSubEvents && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold uppercase tracking-wider text-gray-700 flex items-center gap-2">
                <Tag className="h-4 w-4 text-kits-blue" />
                {hasCategories ? 'Direct Sub-Events' : 'Sub-Events'} ({currentEventDirectSubEvents.length})
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {currentEventDirectSubEvents.map((sub) => (
                <div
                  key={sub.id}
                  onClick={() => handleSelectSubEvent(sub)}
                  className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs hover:border-kits-blue/40 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-blue-50 text-kits-blue border border-blue-100">
                        {sub.participation_type}
                      </span>
                      <StatusBadge status={sub.status} />
                    </div>

                    <h3 className="text-base sm:text-lg font-black text-gray-900 group-hover:text-kits-blue transition">
                      {sub.name}
                    </h3>

                    {sub.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {sub.description}
                      </p>
                    )}

                    {sub.venue && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-600 mt-3 font-medium">
                        <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <span className="truncate">{sub.venue}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between text-xs font-bold text-kits-red group-hover:text-kits-blue transition">
                    <span>Verify Attendance</span>
                    <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state when event has neither categories nor sub-events */}
        {!hasCategories && !hasDirectSubEvents && (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-xs">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-3">
              <Award className="h-6 w-6" />
            </div>
            <h3 className="text-base font-bold text-gray-900">No sub-events are available for attendance</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              This event currently has no active sub-events configured for check-in.
            </p>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // LEVEL 1: MAIN EVENT SELECTION (ATTENDANCE LANDING SCREEN)
  // =========================================================================
  return (
    <div className="space-y-6 pb-16 font-sans page-enter">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-2xl bg-red-50 text-kits-red border border-red-100 shadow-2xs">
            <Award className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
              Attendance Management
            </h1>
            <p className="mt-0.5 text-xs sm:text-sm text-gray-500">
              Select an institutional event to manage attendee check-ins and verify credentials.
            </p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs">
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
          <input
            type="text"
            value={eventSearchTerm}
            onChange={(e) => setEventSearchTerm(e.target.value)}
            placeholder="Search events by name..."
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
          {(['ALL', 'ACTIVE', 'ARCHIVED'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setEventStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shrink-0 ${
                eventStatusFilter === st
                  ? 'bg-kits-red text-white shadow-2xs'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {st === 'ALL' ? 'All Events' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Main Events Grid */}
      {filteredEvents.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-xs">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-gray-50 text-gray-400 flex items-center justify-center mb-3">
            <Calendar className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-gray-900">No events available for attendance</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            {eventSearchTerm || eventStatusFilter !== 'ALL'
              ? 'No events match your current filter criteria.'
              : 'There are currently no events registered in the system.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredEvents.map((ev) => {
            const evCats = categories.filter((c) => c.event_id === ev.id);
            const totalSubs = subEvents.filter((s) => s.event_id === ev.id || evCats.some((c) => c.id === s.category_id)).length;

            return (
              <div
                key={ev.id}
                onClick={() => handleSelectEvent(ev.id)}
                className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 shadow-xs hover:border-kits-blue/40 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <StatusBadge status={ev.status} />
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 font-mono">
                      <Calendar className="h-3.5 w-3.5 text-gray-400" />
                      <span>{formatDateOnly(ev.start_date)}</span>
                    </div>
                  </div>

                  <h3 className="text-lg sm:text-xl font-black text-gray-900 group-hover:text-kits-blue transition">
                    {ev.name}
                  </h3>

                  {ev.description && (
                    <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                      {ev.description}
                    </p>
                  )}

                  {/* Hierarchy counts */}
                  <div className="flex items-center gap-2 mt-4 flex-wrap">
                    {evCats.length > 0 && (
                      <span className="bg-blue-50 text-kits-blue border border-blue-100 rounded-lg px-2.5 py-1 text-xs font-bold inline-flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5" />
                        {evCats.length} {evCats.length === 1 ? 'Category' : 'Categories'}
                      </span>
                    )}

                    <span className="bg-slate-50 text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold inline-flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5" />
                      {totalSubs} {totalSubs === 1 ? 'Sub-Event' : 'Sub-Events'}
                    </span>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between text-xs font-bold text-kits-red group-hover:text-kits-blue transition">
                  <span>Manage Attendance</span>
                  <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
