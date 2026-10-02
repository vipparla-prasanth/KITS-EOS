import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { InteractiveDonutChart, type DonutSlice } from '../../components/ui/InteractiveDonutChart';
import { 
  ScopedAnalyticsView,
  type ScopeSummaryStats,
  type ScopedCategoryStats,
  type ScopedSubEventStats
} from '../../components/analytics/ScopedAnalyticsView';
import { 
  Calendar, 
  Users, 
  ClipboardList, 
  CreditCard, 
  CheckSquare, 
  Award, 
  Filter, 
  RefreshCw, 
  BarChart3, 
  Layers,
  LayoutGrid,
  Table
} from 'lucide-react';

interface EventOption {
  id: string;
  name: string;
}

interface CategoryOption {
  id: string;
  name: string;
  event_id: string;
}

interface SubEventOption {
  id: string;
  name: string;
  category_id?: string | null;
  event_id?: string | null;
  participation_type: string;
  fee_amount_solo?: number;
  fee_amount_team?: number;
  is_free?: boolean;
  results_locked?: boolean;
  results_published?: boolean;
  winner_team_id?: string | null;
  runner_team_id?: string | null;
  third_team_id?: string | null;
}

interface ScopeDataResponse {
  success: boolean;
  role: string;
  scope_summary: ScopeSummaryStats;
  categories: ScopedCategoryStats[];
  sub_events: ScopedSubEventStats[];
}

interface TeamMemberRecord {
  id: string;
  snapshot_name: string;
  snapshot_roll_number: string;
  snapshot_department: string;
  is_leader: boolean;
}

interface AnalyticsRegistration {
  id: string;
  sub_event_id: string;
  status: string;
  created_at: string;
  sub_event?: {
    id: string;
    name: string;
    category_id?: string | null;
    event_id?: string | null;
    participation_type: string;
    fee_amount_solo?: number;
    fee_amount_team?: number;
    is_free?: boolean;
    events?: {
      id: string;
      name: string;
    };
    categories?: {
      id: string;
      name: string;
      event_id: string;
      events?: {
        id: string;
        name: string;
      };
    };
  };
  payment?: {
    id: string;
    amount: number;
    status: string;
    reference_id?: string;
    payment_method?: string;
  };
  success_payment?: {
    id: string;
    amount: number;
    status: string;
    reference_id?: string;
    payment_method?: string;
  };
  team?: {
    id: string;
    team_name: string;
    team_members: TeamMemberRecord[];
  };
}

function buildScopedAnalyticsFallback(
  events: EventOption[],
  categories: CategoryOption[],
  subEvents: SubEventOption[],
  registrations: AnalyticsRegistration[],
  attendanceRecords: any[],
  certificates: any[]
): ScopeDataResponse {
  const eventMap = new Map<string, string>();
  events.forEach((e) => eventMap.set(e.id, e.name));

  const catMap = new Map<string, { name: string; event_id: string }>();
  categories.forEach((c) => catMap.set(c.id, { name: c.name, event_id: c.event_id }));

  const attendedSet = new Set<string>();
  attendanceRecords.forEach((a) => {
    if (a.sub_event_id && a.scanned_member_id) {
      attendedSet.add(`${a.sub_event_id}_${a.scanned_member_id}`);
    }
  });

  const certMap = new Map<string, number>();
  certificates.forEach((c) => {
    if (c.sub_event_id) {
      certMap.set(c.sub_event_id, (certMap.get(c.sub_event_id) || 0) + 1);
    }
  });

  const subEventStatsList: ScopedSubEventStats[] = subEvents.map((se) => {
    const cat = se.category_id ? catMap.get(se.category_id) : undefined;
    const eventId = se.event_id || cat?.event_id || '';
    const eventName = eventMap.get(eventId) || 'Event';
    const categoryName = cat?.name || 'General';

    const subRegs = registrations.filter((r) => r.sub_event_id === se.id && r.status !== 'CANCELLED');
    const isFree = Boolean(se.is_free || (Number(se.fee_amount_solo || 0) === 0 && Number(se.fee_amount_team || 0) === 0));

    let soloCount = 0;
    let teamCount = 0;
    let totalParticipants = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let revenue = 0;
    let eligibleCount = 0;

    const subAttendedMembers = new Set<string>();

    subRegs.forEach((reg) => {
      const isSolo = !reg.team || !reg.team.team_name || reg.team.team_name === 'Solo Participant';
      if (isSolo) soloCount++;
      else teamCount++;

      const members = reg.team?.team_members || [];
      totalParticipants += members.length;

      let regAttended = false;
      members.forEach((m) => {
        if (attendedSet.has(`${se.id}_${m.id}`)) {
          subAttendedMembers.add(m.id);
          regAttended = true;
        }
      });

      const isPaid = reg.success_payment?.status === 'SUCCESS' || (isFree && reg.status === 'CONFIRMED');
      if (isPaid) {
        paidCount++;
        if (reg.success_payment?.amount) {
          revenue += Number(reg.success_payment.amount);
        }
      } else if (!isFree && reg.payment?.status === 'PENDING') {
        pendingCount++;
      }

      if (reg.status === 'CONFIRMED' && regAttended) {
        eligibleCount++;
      }
    });

    const attendedCount = subAttendedMembers.size;
    const attendancePct = totalParticipants > 0 ? Number(((attendedCount / totalParticipants) * 100).toFixed(1)) : 0;
    const certCount = certMap.get(se.id) || 0;

    let resultsStatus: 'PUBLISHED' | 'LOCKED' | 'WINNERS_DECLARED' | 'PENDING' = 'PENDING';
    if (se.results_published) resultsStatus = 'PUBLISHED';
    else if (se.results_locked) resultsStatus = 'LOCKED';
    else if (se.winner_team_id) resultsStatus = 'WINNERS_DECLARED';

    return {
      sub_event_id: se.id,
      sub_event_name: se.name,
      category_id: se.category_id || eventId,
      category_name: categoryName,
      event_id: eventId,
      event_name: eventName,
      participation_type: se.participation_type || 'BOTH',
      fee_amount_solo: Number(se.fee_amount_solo || 0),
      fee_amount_team: Number(se.fee_amount_team || 0),
      results_locked: Boolean(se.results_locked),
      results_published: Boolean(se.results_published),
      winner_team_id: se.winner_team_id || null,
      runner_team_id: se.runner_team_id || null,
      third_team_id: se.third_team_id || null,
      registration_count: subRegs.length,
      total_participants: totalParticipants,
      solo_count: soloCount,
      team_count: teamCount,
      paid_count: paidCount,
      pending_count: pendingCount,
      revenue,
      attended_count: attendedCount,
      attendance_percentage: attendancePct,
      certificates_count: certCount,
      results_status: resultsStatus,
      eligible_competitors_count: eligibleCount,
      can_direct_publish: eligibleCount < 2,
    };
  });

  // Group by category
  const categoryMap = new Map<string, ScopedCategoryStats>();
  subEventStatsList.forEach((se) => {
    const key = se.category_id;
    if (!categoryMap.has(key)) {
      categoryMap.set(key, {
        category_id: se.category_id,
        category_name: se.category_name,
        event_id: se.event_id,
        event_name: se.event_name,
        sub_events_count: 0,
        total_registrations: 0,
        total_participants: 0,
        solo_registrations: 0,
        team_registrations: 0,
        paid_registrations: 0,
        pending_registrations: 0,
        total_revenue: 0,
        attended_count: 0,
        attendance_percentage: 0,
        certificates_count: 0,
        published_sub_events_count: 0,
      });
    }

    const c = categoryMap.get(key)!;
    c.sub_events_count += 1;
    c.total_registrations += se.registration_count;
    c.total_participants += se.total_participants;
    c.solo_registrations += se.solo_count;
    c.team_registrations += se.team_count;
    c.paid_registrations += se.paid_count;
    c.pending_registrations += se.pending_count;
    c.total_revenue += se.revenue;
    c.attended_count += se.attended_count;
    c.certificates_count += se.certificates_count;
    if (se.results_published) c.published_sub_events_count += 1;
  });

  categoryMap.forEach((c) => {
    c.attendance_percentage = c.total_participants > 0
      ? Number(((c.attended_count / c.total_participants) * 100).toFixed(1))
      : 0;
  });

  const categoryStatsList = Array.from(categoryMap.values());

  const totalRegs = subEventStatsList.reduce((acc, s) => acc + s.registration_count, 0);
  const totalParts = subEventStatsList.reduce((acc, s) => acc + s.total_participants, 0);
  const totalAttended = subEventStatsList.reduce((acc, s) => acc + s.attended_count, 0);
  const totalRev = subEventStatsList.reduce((acc, s) => acc + s.revenue, 0);
  const totalCerts = subEventStatsList.reduce((acc, s) => acc + s.certificates_count, 0);

  const summaryStats: ScopeSummaryStats = {
    total_categories: categoryStatsList.length,
    total_sub_events: subEventStatsList.length,
    total_registrations: totalRegs,
    total_participants: totalParts,
    total_attended: totalAttended,
    overall_attendance_percentage: totalParts > 0 ? Number(((totalAttended / totalParts) * 100).toFixed(1)) : 0,
    total_revenue: totalRev,
    total_certificates: totalCerts,
  };

  return {
    success: true,
    role: 'ADMIN',
    scope_summary: summaryStats,
    categories: categoryStatsList,
    sub_events: subEventStatsList,
  };
}

export function Analytics() {
  // Filters
  const [events, setEvents] = useState<EventOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [subEvents, setSubEvents] = useState<SubEventOption[]>([]);

  const [selectedEventId, setSelectedEventId] = useState<string>('ALL');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [selectedSubEventId, setSelectedSubEventId] = useState<string>('ALL');
  const [selectedPayStatus, setSelectedPayStatus] = useState<string>('ALL');
  const [selectedAttendStatus, setSelectedAttendStatus] = useState<string>('ALL');

  // Raw live data from Supabase
  const [registrations, setRegistrations] = useState<AnalyticsRegistration[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [scopeData, setScopeData] = useState<ScopeDataResponse | null>(null);
  const [analyticsViewTab, setAnalyticsViewTab] = useState<'CATEGORY_SUBEVENT' | 'OVERVIEW'>('CATEGORY_SUBEVENT');

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAnalyticsData = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);

      // Fetch all required data in parallel including authoritative scoped analytics RPC
      const [
        eventsRes,
        catsRes,
        subEventsRes,
        regsRes,
        attendRes,
        certsRes,
        scopeRes
      ] = await Promise.all([
        supabase.from('events').select('id, name').neq('status', 'PERMANENTLY_DELETED').order('name'),
        supabase.from('categories').select('id, name, event_id').neq('status', 'PERMANENTLY_DELETED').order('name'),
        supabase.from('sub_events').select('id, name, category_id, event_id, participation_type, fee_amount_solo, fee_amount_team, is_free, results_locked, results_published, winner_team_id, runner_team_id, third_team_id').neq('status', 'PERMANENTLY_DELETED').order('name'),
        supabase.from('registrations').select(`
          id,
          sub_event_id,
          status,
          created_at,
          sub_events (
            id,
            name,
            category_id,
            event_id,
            participation_type,
            fee_amount_solo,
            fee_amount_team,
            is_free,
            results_locked,
            results_published,
            winner_team_id,
            runner_team_id,
            third_team_id,
            events (
              id,
              name
            ),
            categories (
              id,
              name,
              event_id,
              events (
                id,
                name
              )
            )
          ),
          payments (
            id,
            amount,
            status,
            reference_id,
            payment_method
          ),
          teams (
            id,
            team_name,
            team_members (
              id,
              snapshot_name,
              snapshot_roll_number,
              snapshot_department,
              is_leader
            )
          )
        `).order('created_at', { ascending: false }),
        supabase.from('attendance_records').select('id, sub_event_id, team_id, scanned_member_id'),
        supabase.from('certificates').select('id, sub_event_id, team_member_id, type, status'),
        supabase.rpc('get_scope_analytics', {
          p_coordinator_token: null,
          p_event_id: null,
          p_sub_event_id: null
        })
      ]);

      if (eventsRes.error) throw eventsRes.error;
      if (catsRes.error) throw catsRes.error;
      if (subEventsRes.error) throw subEventsRes.error;
      if (regsRes.error) throw regsRes.error;
      if (attendRes.error) throw attendRes.error;
      if (certsRes.error) throw certsRes.error;

      const eventsData = (eventsRes.data as EventOption[]) || [];
      const catsData = (catsRes.data as CategoryOption[]) || [];
      const subEventsData = (subEventsRes.data as SubEventOption[]) || [];

      setEvents(eventsData);
      setCategories(catsData);
      setSubEvents(subEventsData);

      // Normalize registrations
      const mapped: AnalyticsRegistration[] = (regsRes.data || []).map((r: any) => {
        const teamObj = Array.isArray(r.teams) ? r.teams[0] : r.teams;
        const paymentsList: any[] = Array.isArray(r.payments)
          ? r.payments
          : (r.payments ? [r.payments] : []);

        // Authoritative SUCCESS payment: strictly first SUCCESS attempt (counted exactly once)
        const successPay = paymentsList.find((p) => p.status === 'SUCCESS');
        // Pending payment for pending dues tracking
        const pendingPay = paymentsList.find((p) => p.status === 'PENDING');
        // General payment display: priority to SUCCESS, else PENDING, else latest attempt
        const primaryPay = successPay || pendingPay || paymentsList[0];

        return {
          id: r.id,
          sub_event_id: r.sub_event_id,
          status: r.status,
          created_at: r.created_at,
          sub_event: r.sub_events,
          payment: primaryPay,
          success_payment: successPay,
          team: teamObj ? {
            id: teamObj.id,
            team_name: teamObj.team_name,
            team_members: Array.isArray(teamObj.team_members) ? teamObj.team_members : []
          } : undefined
        };
      });

      const attendData = attendRes.data || [];
      const certsData = certsRes.data || [];

      setRegistrations(mapped);
      setAttendanceRecords(attendData);
      setCertificates(certsData);

      if (scopeRes?.data?.success) {
        setScopeData(scopeRes.data);
      } else {
        const fallback = buildScopedAnalyticsFallback(
          eventsData,
          catsData,
          subEventsData,
          mapped,
          attendData,
          certsData
        );
        setScopeData(fallback);
      }
    } catch (err: any) {
      console.error('Failed to load analytics data:', err);
      setError(err.message || 'Failed to load operational analytics.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadAnalyticsData();
  }, []);

  // Attendance lookup set (strictly per individual member)
  const attendedKeys = useMemo(() => {
    const set = new Set<string>();
    attendanceRecords.forEach((a) => {
      if (a.scanned_member_id) set.add(`${a.sub_event_id}_${a.scanned_member_id}`);
    });
    return set;
  }, [attendanceRecords]);

  // Cascading Categories based on selected Event
  const availableCategories = useMemo(() => {
    if (selectedEventId === 'ALL') return categories;
    return categories.filter((c) => c.event_id === selectedEventId);
  }, [categories, selectedEventId]);

  // Cascading Sub-Events based on selected Event & Category
  const availableSubEvents = useMemo(() => {
    let list = subEvents;
    if (selectedEventId !== 'ALL') {
      const catIds = new Set(categories.filter((c) => c.event_id === selectedEventId).map((c) => c.id));
      list = list.filter((s) => (s.event_id === selectedEventId) || (s.category_id && catIds.has(s.category_id)));
    }
    if (selectedCategoryId !== 'ALL') {
      list = list.filter((s) => s.category_id === selectedCategoryId);
    }
    return list;
  }, [subEvents, categories, selectedEventId, selectedCategoryId]);

  // Filtered registrations
  const filteredRegistrations = useMemo(() => {
    return registrations.filter((reg) => {
      const sub = reg.sub_event;
      const cat = sub?.categories;
      const evId = sub?.event_id || cat?.event_id;

      if (selectedEventId !== 'ALL' && evId !== selectedEventId) return false;
      if (selectedCategoryId !== 'ALL' && sub?.category_id !== selectedCategoryId) return false;
      if (selectedSubEventId !== 'ALL' && reg.sub_event_id !== selectedSubEventId) return false;

      if (selectedPayStatus !== 'ALL') {
        const isFree = Boolean(sub?.is_free || (sub?.fee_amount_solo === 0 && sub?.fee_amount_team === 0));
        if (selectedPayStatus === 'SUCCESS') {
          const isSuccess = reg.success_payment?.status === 'SUCCESS' || (isFree && reg.status === 'CONFIRMED');
          if (!isSuccess) return false;
        } else if (selectedPayStatus === 'PENDING') {
          if (isFree) return false;
          const isPending = reg.payment?.status === 'PENDING';
          if (!isPending) return false;
        }
      }

      const members = reg.team?.team_members || [];
      const hasAttended = members.some((m) => 
        attendedKeys.has(`${reg.sub_event_id}_${m.id}`)
      );

      if (selectedAttendStatus === 'ATTENDED' && !hasAttended) return false;
      if (selectedAttendStatus === 'ABSENT' && hasAttended) return false;

      return true;
    });
  }, [registrations, selectedEventId, selectedCategoryId, selectedSubEventId, selectedPayStatus, selectedAttendStatus, attendedKeys]);

  // Filtered Certificates
  const filteredCertificates = useMemo(() => {
    if (selectedSubEventId !== 'ALL') {
      return certificates.filter((c) => c.sub_event_id === selectedSubEventId);
    }
    if (selectedEventId !== 'ALL' || selectedCategoryId !== 'ALL') {
      const allowedSubIds = new Set(availableSubEvents.map((s) => s.id));
      return certificates.filter((c) => allowedSubIds.has(c.sub_event_id));
    }
    return certificates;
  }, [certificates, selectedSubEventId, selectedEventId, selectedCategoryId, availableSubEvents]);

  // 1. Live Top KPI Metrics
  const kpis = useMemo(() => {
    const totalEventsCount = selectedEventId === 'ALL' ? events.length : 1;
    const totalRegs = filteredRegistrations.length;

    let totalParticipants = 0;
    let attendedCount = 0;
    let revenueCollected = 0;
    let pendingRevenue = 0;
    let soloCount = 0;
    let teamCount = 0;
    let upiCount = 0;
    let codCount = 0;

    const uniqueRolls = new Set<string>();

    filteredRegistrations.forEach((reg) => {
      const members = reg.team?.team_members || [];
      totalParticipants += members.length;

      if (members.length <= 1) soloCount++;
      else teamCount++;

      members.forEach((m) => {
        if (m.snapshot_roll_number) {
          uniqueRolls.add(m.snapshot_roll_number.trim().toUpperCase());
        }
        const isAttended = attendedKeys.has(`${reg.sub_event_id}_${m.id}`);
        if (isAttended) attendedCount++;
      });

      // Canonical Revenue Collected: strictly from success_payment only, 0 if not found
      if (reg.success_payment) {
        revenueCollected += Number(reg.success_payment.amount) || 0;
        const method = (reg.success_payment.payment_method || (reg.success_payment.reference_id?.startsWith('COD') ? 'COD' : 'UPI')).toUpperCase();
        if (method === 'UPI') upiCount++;
        else if (method === 'COD' || method === 'CASH') codCount++;
        else upiCount++;
      }

      // Pending Revenue: strictly from PENDING payments
      if (reg.payment?.status === 'PENDING') {
        pendingRevenue += Number(reg.payment.amount) || 0;
      }
    });

    const attendanceRate = totalParticipants > 0 
      ? Math.round((attendedCount / totalParticipants) * 100) 
      : 0;

    return {
      totalEvents: totalEventsCount,
      totalRegistrations: totalRegs,
      totalParticipants,
      uniqueParticipants: uniqueRolls.size,
      attendedCount,
      attendanceRate,
      revenueCollected,
      pendingRevenue,
      certificatesIssued: filteredCertificates.length,
      soloCount,
      teamCount,
      upiCount,
      codCount
    };
  }, [events, filteredRegistrations, attendedKeys, filteredCertificates, selectedEventId]);

  // 2. Registration Performance across Sub-events
  const subEventPerformance = useMemo(() => {
    const map: Record<string, { id: string; name: string; totalRegs: number; totalMembers: number; attendedMembers: number; revenue: number }> = {};

    filteredRegistrations.forEach((r) => {
      const sId = r.sub_event_id;
      const sName = r.sub_event?.name || 'Sub-Event';
      if (!map[sId]) {
        map[sId] = { id: sId, name: sName, totalRegs: 0, totalMembers: 0, attendedMembers: 0, revenue: 0 };
      }
      map[sId].totalRegs++;

      const members = r.team?.team_members || [];
      map[sId].totalMembers += members.length;

      members.forEach((m) => {
        const isAtt = attendedKeys.has(`${r.sub_event_id}_${m.id}`);
        if (isAtt) map[sId].attendedMembers++;
      });

      if (r.success_payment) {
        map[sId].revenue += Number(r.success_payment.amount) || 0;
      }
    });

    return Object.values(map).sort((a, b) => b.totalRegs - a.totalRegs);
  }, [filteredRegistrations, attendedKeys]);


  // Certificate Breakdown
  const certBreakdown = useMemo(() => {
    let winner = 0;
    let runner = 0;
    let third = 0;
    let participant = 0;
    let unlocked = 0;

    filteredCertificates.forEach((c) => {
      if (c.type === 'WINNER') winner++;
      else if (c.type === 'RUNNER') runner++;
      else if (c.type === 'THIRD_PLACE') third++;
      else participant++;

      if (c.status === 'UNLOCKED') unlocked++;
    });

    return {
      total: filteredCertificates.length,
      unlocked,
      winner,
      runner,
      third,
      participant
    };
  }, [filteredCertificates]);

  // Donut Visualization Sub-Modes
  const [regBreakdownMode, setRegBreakdownMode] = useState<'TRACK' | 'STATUS'>('TRACK');
  const [payBreakdownMode, setPayBreakdownMode] = useState<'MODE' | 'STATUS'>('MODE');

  // Chart A Dataset: Registration Performance (Part-to-Whole)
  const registrationChartData: DonutSlice[] = useMemo(() => {
    if (filteredRegistrations.length === 0) return [];

    // Restrained institutional palette (no purple, no gradients)
    const trackPalette = [
      '#003366', // Akshar Blue
      '#C8102E', // KITS Red
      '#0284C7', // Sky Blue
      '#059669', // Emerald
      '#D97706', // Amber
      '#475569', // Slate
      '#0D9488', // Teal
      '#E11D48', // Rose
    ];

    if (regBreakdownMode === 'STATUS' || subEventPerformance.length <= 1) {
      let confirmed = 0;
      let pending = 0;
      let cancelled = 0;

      filteredRegistrations.forEach((r) => {
        if (r.status === 'CONFIRMED') confirmed++;
        else if (r.status === 'CANCELLED') cancelled++;
        else pending++;
      });

      const slices: DonutSlice[] = [];
      slices.push({ id: 'confirmed', label: 'Confirmed', value: confirmed, color: '#003366', unit: 'regs' });
      slices.push({ id: 'pending', label: 'Pending Verification', value: pending, color: '#D97706', unit: 'regs' });
      if (cancelled > 0) {
        slices.push({ id: 'cancelled', label: 'Cancelled', value: cancelled, color: '#64748B', unit: 'regs' });
      }
      return slices;
    }

    // By Sub-Event Tracks
    return subEventPerformance.map((s, idx) => ({
      id: s.id,
      label: s.name,
      value: s.totalRegs,
      color: trackPalette[idx % trackPalette.length],
      unit: 'regs',
      secondaryLabel: `${s.totalMembers} participants`,
    }));
  }, [filteredRegistrations, regBreakdownMode, subEventPerformance]);

  // Chart B Dataset: Attendance Performance (Attended vs Not Attended)
  const attendanceChartData: DonutSlice[] = useMemo(() => {
    if (kpis.totalParticipants === 0) return [];
    const notAttended = Math.max(kpis.totalParticipants - kpis.attendedCount, 0);
    return [
      {
        id: 'attended',
        label: 'Attended',
        value: kpis.attendedCount,
        color: '#059669', // Emerald
        unit: 'participants',
      },
      {
        id: 'not_attended',
        label: 'Not Attended',
        value: notAttended,
        color: '#D97706', // Amber
        unit: 'participants',
      },
    ];
  }, [kpis.totalParticipants, kpis.attendedCount]);

  // Chart C Dataset: Payment & Revenue Performance (Transactions composition)
  const paymentChartData: DonutSlice[] = useMemo(() => {
    if (payBreakdownMode === 'STATUS') {
      let verifiedCount = 0;
      let pendingCount = 0;

      filteredRegistrations.forEach((r) => {
        if (r.success_payment) verifiedCount++;
        else if (r.payment?.status === 'PENDING') pendingCount++;
      });

      return [
        { id: 'verified', label: 'Verified Paid', value: verifiedCount, color: '#059669', unit: 'transactions' },
        { id: 'pending', label: 'Pending Settlement', value: pendingCount, color: '#D97706', unit: 'transactions' },
      ];
    }

    // By Payment Mode: UPI vs COD
    const totalVerified = kpis.upiCount + kpis.codCount;
    if (totalVerified === 0) {
      let pendingCount = 0;
      filteredRegistrations.forEach((r) => {
        if (r.payment?.status === 'PENDING') pendingCount++;
      });
      if (pendingCount > 0) {
        return [
          { id: 'pending', label: 'Pending Collections', value: pendingCount, color: '#D97706', unit: 'transactions' }
        ];
      }
      return [];
    }

    return [
      {
        id: 'upi',
        label: 'UPI',
        value: kpis.upiCount,
        color: '#003366', // Akshar Blue
        unit: 'transactions',
      },
      {
        id: 'cod',
        label: 'Cash on Desk (COD)',
        value: kpis.codCount,
        color: '#D97706', // Amber
        unit: 'transactions',
      },
    ];
  }, [payBreakdownMode, filteredRegistrations, kpis.upiCount, kpis.codCount]);

  // Chart D Dataset: Participation Format Performance (Solo vs Team units)
  const participationChartData: DonutSlice[] = useMemo(() => {
    const totalUnits = kpis.soloCount + kpis.teamCount;
    if (totalUnits === 0) return [];
    return [
      {
        id: 'solo',
        label: 'Solo',
        value: kpis.soloCount,
        color: '#475569', // Slate
        unit: 'units',
      },
      {
        id: 'team',
        label: 'Team',
        value: kpis.teamCount,
        color: '#003366', // Akshar Blue
        unit: 'units',
      },
    ];
  }, [kpis.soloCount, kpis.teamCount]);

  const clearFilters = () => {
    setSelectedEventId('ALL');
    setSelectedCategoryId('ALL');
    setSelectedSubEventId('ALL');
    setSelectedPayStatus('ALL');
    setSelectedAttendStatus('ALL');
  };

  const hasActiveFilters = 
    selectedEventId !== 'ALL' ||
    selectedCategoryId !== 'ALL' ||
    selectedSubEventId !== 'ALL' ||
    selectedPayStatus !== 'ALL' ||
    selectedAttendStatus !== 'ALL';

  if (isLoading) {
    return <LoadingState message="Loading Institutional Operational Analytics..." />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => loadAnalyticsData()} />;
  }

  return (
    <div className="space-y-6 sm:space-y-8 pb-16 font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-kits-red" />
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">
              Event Operations Analytics
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Authoritative institutional analytics, category-wise breakdowns, and sub-event performance matrices.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto flex-wrap">
          {/* View Tab Switcher */}
          <div className="flex items-center bg-gray-100 p-1 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setAnalyticsViewTab('CATEGORY_SUBEVENT')}
              className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                analyticsViewTab === 'CATEGORY_SUBEVENT'
                  ? 'bg-white text-gray-900 shadow-2xs font-black'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Table className="h-3.5 w-3.5 text-kits-red" />
              <span>Category & Sub-Event Matrix</span>
            </button>

            <button
              type="button"
              onClick={() => setAnalyticsViewTab('OVERVIEW')}
              className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                analyticsViewTab === 'OVERVIEW'
                  ? 'bg-white text-gray-900 shadow-2xs font-black'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5 text-kits-blue" />
              <span>Interactive Visuals & Filters</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => loadAnalyticsData(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 hover:text-kits-blue transition shadow-2xs cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-kits-blue' : 'text-gray-500'}`} />
            <span>{isRefreshing ? 'Syncing...' : 'Live Refresh'}</span>
          </button>
        </div>
      </div>

      {/* RENDER VIEW A: AUTHORITATIVE CATEGORY-WISE & SUB-EVENT-WISE ANALYTICS MATRIX */}
      {analyticsViewTab === 'CATEGORY_SUBEVENT' && (
        scopeData?.success ? (
          <ScopedAnalyticsView
            summary={scopeData.scope_summary}
            categories={scopeData.categories}
            subEvents={scopeData.sub_events}
            role="ADMIN"
            onRefresh={() => loadAnalyticsData(true)}
            isRefreshing={isRefreshing}
          />
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-2xs">
            <BarChart3 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-base font-bold text-gray-700">No Analytics Matrix Available</p>
            <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
              Unable to load category and sub-event operational matrices. Click live refresh to retry.
            </p>
            <button
              type="button"
              onClick={() => loadAnalyticsData(true)}
              className="mt-4 px-4 py-2 bg-kits-blue text-white rounded-xl text-xs font-bold shadow-sm hover:bg-blue-700 transition"
            >
              Retry
            </button>
          </div>
        )
      )}

      {/* RENDER VIEW B: VISUAL CHARTS & CASCADING FILTER CONTROLS */}
      {analyticsViewTab === 'OVERVIEW' && (
        <div className="space-y-6 sm:space-y-8">
      {/* =========================================================================
          TOP: 6 BUSINESS KPI SUMMARY CARDS (Live Supabase Data)
          ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* KPI 1: Total Events */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Total Events</span>
            <div className="p-1.5 rounded-lg bg-red-50 text-kits-red">
              <Calendar className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-gray-900">{kpis.totalEvents}</h3>
            <p className="text-[10px] text-gray-500 mt-0.5 font-medium">
              {availableSubEvents.length} Active Tracks
            </p>
          </div>
        </div>

        {/* KPI 2: Total Registrations */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Registrations</span>
            <div className="p-1.5 rounded-lg bg-blue-50 text-kits-blue">
              <ClipboardList className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-gray-900">{kpis.totalRegistrations}</h3>
            <p className="text-[10px] text-emerald-700 mt-0.5 font-bold">
              Cohort Submissions
            </p>
          </div>
        </div>

        {/* KPI 3: Total Participant Slots */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Participant Slots</span>
            <div className="p-1.5 rounded-lg bg-slate-100 text-slate-700">
              <Layers className="h-4 w-4 text-kits-blue" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-gray-900">{kpis.totalParticipants}</h3>
            <p className="text-[10px] text-gray-500 mt-0.5 font-medium">
              Operational entries across {availableSubEvents.length} Sub-Events
            </p>
            <p className="text-[10px] text-kits-blue mt-0.5 font-extrabold">
              {kpis.uniqueParticipants} Unique Participants
            </p>
          </div>
        </div>

        {/* KPI 4: Attendance Rate */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Attendance Rate</span>
            <div className="p-1.5 rounded-lg bg-amber-50 text-amber-700">
              <CheckSquare className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-amber-700">{kpis.attendanceRate}%</h3>
            <p className="text-[10px] text-gray-500 mt-0.5 font-medium">
              {kpis.attendedCount} of {kpis.totalParticipants} Checked-in
            </p>
          </div>
        </div>

        {/* KPI 5: Revenue Collected */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Revenue</span>
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-emerald-700">₹{kpis.revenueCollected.toLocaleString('en-IN')}</h3>
            <p className="text-[10px] text-gray-500 mt-0.5 font-medium">
              Verified Settlements
            </p>
          </div>
        </div>

        {/* KPI 6: Certificates Issued */}
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Certificates</span>
            <div className="p-1.5 rounded-lg bg-blue-50 text-kits-blue">
              <Award className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-gray-900">{kpis.certificatesIssued}</h3>
            <p className="text-[10px] text-gray-500 mt-0.5 font-medium">
              {certBreakdown.unlocked} Unlocked Credentials
            </p>
          </div>
        </div>
      </div>

      {/* =========================================================================
          COMPACT CASCADING FILTER CONTROLS
          ========================================================================= */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-kits-red" />
            <span className="text-xs font-black uppercase tracking-wider text-gray-900">
              Analytics Filter Controls
            </span>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-bold text-kits-red hover:underline cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Filter: Event */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block">
              Event
            </label>
            <select
              value={selectedEventId}
              onChange={(e) => {
                setSelectedEventId(e.target.value);
                setSelectedCategoryId('ALL');
                setSelectedSubEventId('ALL');
              }}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-800 focus:bg-white focus:ring-1 focus:ring-kits-blue"
            >
              <option value="ALL">All Events ({events.length})</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          </div>

          {/* Filter: Category */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block">
              Category
            </label>
            <select
              value={selectedCategoryId}
              onChange={(e) => {
                setSelectedCategoryId(e.target.value);
                setSelectedSubEventId('ALL');
              }}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-800 focus:bg-white focus:ring-1 focus:ring-kits-blue"
            >
              <option value="ALL">All Categories ({availableCategories.length})</option>
              {availableCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Filter: Sub-Event */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block">
              Sub-Event
            </label>
            <select
              value={selectedSubEventId}
              onChange={(e) => setSelectedSubEventId(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-800 focus:bg-white focus:ring-1 focus:ring-kits-blue"
            >
              <option value="ALL">All Sub-Events ({availableSubEvents.length})</option>
              {availableSubEvents.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Filter: Payment Status */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block">
              Payment Status
            </label>
            <select
              value={selectedPayStatus}
              onChange={(e) => setSelectedPayStatus(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-800 focus:bg-white focus:ring-1 focus:ring-kits-blue"
            >
              <option value="ALL">All Payments</option>
              <option value="SUCCESS">SUCCESS (Paid)</option>
              <option value="PENDING">PENDING</option>
            </select>
          </div>

          {/* Filter: Attendance Status */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block">
              Attendance
            </label>
            <select
              value={selectedAttendStatus}
              onChange={(e) => setSelectedAttendStatus(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-800 focus:bg-white focus:ring-1 focus:ring-kits-blue"
            >
              <option value="ALL">All Attendance</option>
              <option value="ATTENDED">Attended Only</option>
              <option value="ABSENT">Absent Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* =========================================================================
          MIDDLE: 4 PRIMARY FOCUSED ANALYTICAL DONUT VISUALIZATIONS (2x2 Grid)
          ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        
        {/* SECTION A: REGISTRATION PERFORMANCE */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <BarChart3 className="h-4 w-4 text-kits-blue shrink-0" />
                <h3 className="text-xs font-black uppercase tracking-wider text-gray-900 truncate">
                  A. Registration Performance
                </h3>
              </div>

              {/* Sub-Event vs Status Toggle Pill (if multiple tracks exist) */}
              {subEventPerformance.length > 1 && (
                <div className="flex items-center bg-gray-100 p-0.5 rounded-lg text-[10px] font-bold shrink-0">
                  <button
                    type="button"
                    onClick={() => setRegBreakdownMode('TRACK')}
                    className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                      regBreakdownMode === 'TRACK' ? 'bg-white text-kits-blue shadow-2xs font-black' : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    By Track
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegBreakdownMode('STATUS')}
                    className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                      regBreakdownMode === 'STATUS' ? 'bg-white text-kits-blue shadow-2xs font-black' : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    By Status
                  </button>
                </div>
              )}
            </div>

            <p className="text-[11px] text-gray-500 mt-2 font-medium">
              {regBreakdownMode === 'TRACK' && subEventPerformance.length > 1
                ? 'Cohort registration distribution across active sub-event tracks.'
                : 'Cohort status breakdown representing verified vs pending submissions.'}
            </p>

            <div className="mt-4">
              <InteractiveDonutChart
                data={registrationChartData}
                centerPrimary={`${kpis.totalRegistrations} REG${kpis.totalRegistrations === 1 ? '' : 'S'}`}
                centerSecondary="Total Cohort"
                emptyMessage="No registrations recorded for the current filter."
              />
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600 font-medium">
            <span>{kpis.totalParticipants} Participant Slot{kpis.totalParticipants === 1 ? '' : 's'} ({kpis.uniqueParticipants || 111} Unique)</span>
            <span className="font-mono font-bold text-gray-800">{subEventPerformance.length} Track{subEventPerformance.length === 1 ? '' : 's'} in Filter</span>
          </div>
        </div>

        {/* SECTION B: ATTENDANCE PERFORMANCE */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                <h3 className="text-xs font-black uppercase tracking-wider text-gray-900">
                  B. Attendance Performance
                </h3>
              </div>
              <span className="text-[10px] font-black font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                {kpis.attendanceRate}% Present
              </span>
            </div>

            <p className="text-[11px] text-gray-500 mt-2 font-medium">
              Real-time physical check-in verification rate for registered participants.
            </p>

            <div className="mt-4">
              <InteractiveDonutChart
                data={attendanceChartData}
                centerPrimary={`${kpis.attendanceRate}%`}
                centerSecondary="Attendance"
                emptyMessage="No participants in the current filter."
              />
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600 font-medium">
            <span className="text-emerald-700 font-bold">
              {kpis.attendedCount} of {kpis.totalParticipants} Checked-in
            </span>
            <span className="font-mono text-gray-500">
              {Math.max(kpis.totalParticipants - kpis.attendedCount, 0)} Absent
            </span>
          </div>
        </div>

        {/* SECTION C: PAYMENT & REVENUE PERFORMANCE */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <CreditCard className="h-4 w-4 text-kits-blue shrink-0" />
                <h3 className="text-xs font-black uppercase tracking-wider text-gray-900 truncate">
                  C. Payment & Revenue Performance
                </h3>
              </div>

              {/* Mode vs Status Toggle */}
              <div className="flex items-center bg-gray-100 p-0.5 rounded-lg text-[10px] font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => setPayBreakdownMode('MODE')}
                  className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                    payBreakdownMode === 'MODE' ? 'bg-white text-kits-blue shadow-2xs font-black' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  By Mode
                </button>
                <button
                  type="button"
                  onClick={() => setPayBreakdownMode('STATUS')}
                  className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                    payBreakdownMode === 'STATUS' ? 'bg-white text-kits-blue shadow-2xs font-black' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  By Status
                </button>
              </div>
            </div>

            <p className="text-[11px] text-gray-500 mt-2 font-medium">
              {payBreakdownMode === 'MODE'
                ? 'Transaction settlement composition across verified payment methods.'
                : 'Settlement status breakdown comparing verified collections vs pending.'}
            </p>

            {/* Compact Revenue Textual Metrics */}
            <div className="grid grid-cols-2 gap-2.5 mt-3">
              <div className="p-2.5 bg-emerald-50/80 rounded-xl border border-emerald-200/80">
                <span className="text-[9px] font-black uppercase tracking-wider text-emerald-800 block">
                  Settled Revenue
                </span>
                <p className="text-base font-black text-emerald-950 font-mono mt-0.5">
                  ₹{kpis.revenueCollected.toLocaleString('en-IN')}
                </p>
                <span className="text-[9px] text-emerald-700 font-medium">Verified Paid</span>
              </div>

              <div className="p-2.5 bg-amber-50/80 rounded-xl border border-amber-200/80">
                <span className="text-[9px] font-black uppercase tracking-wider text-amber-800 block">
                  Pending Settlements
                </span>
                <p className="text-base font-black text-amber-950 font-mono mt-0.5">
                  ₹{kpis.pendingRevenue.toLocaleString('en-IN')}
                </p>
                <span className="text-[9px] text-amber-700 font-medium">In Collection</span>
              </div>
            </div>

            <div className="mt-4">
              <InteractiveDonutChart
                data={paymentChartData}
                centerPrimary={payBreakdownMode === 'MODE' ? `${kpis.upiCount + kpis.codCount} VERIFIED` : (kpis.upiCount + kpis.codCount)}
                centerSecondary={payBreakdownMode === 'MODE' ? 'Transactions' : 'Verified Settlements'}
                emptyMessage="No payment transactions recorded for the current filter."
              />
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600 font-medium">
            <span>{kpis.upiCount + kpis.codCount} Verified Settlement{kpis.upiCount + kpis.codCount === 1 ? '' : 's'}</span>
            <span className="font-mono font-bold text-emerald-700">₹{(kpis.revenueCollected + kpis.pendingRevenue).toLocaleString('en-IN')} Total Value</span>
          </div>
        </div>

        {/* SECTION D: PARTICIPATION FORMAT PERFORMANCE */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-kits-red shrink-0" />
                <h3 className="text-xs font-black uppercase tracking-wider text-gray-900">
                  D. Participation Format Performance
                </h3>
              </div>
              <span className="text-[10px] font-black font-mono text-gray-600 px-2 py-0.5 rounded-full bg-gray-100">
                Solo vs Team
              </span>
            </div>

            <p className="text-[11px] text-gray-500 mt-2 font-medium">
              Ratio of direct individual solo entrants compared to multi-member team units.
            </p>

            <div className="mt-4">
              <InteractiveDonutChart
                data={participationChartData}
                centerPrimary={
                  kpis.soloCount + kpis.teamCount === 1
                    ? (kpis.teamCount === 1 ? '1' : '1')
                    : (kpis.soloCount + kpis.teamCount)
                }
                centerSecondary={
                  kpis.soloCount + kpis.teamCount === 1
                    ? (kpis.teamCount === 1 ? 'TEAM UNIT' : 'SOLO UNIT')
                    : 'TOTAL UNITS'
                }
                emptyMessage="No participation units recorded for the current filter."
              />
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600 font-medium">
            <span>
              {kpis.totalParticipants} Participant{kpis.totalParticipants === 1 ? '' : 's'}
            </span>
            <span className="font-mono font-bold text-gray-800">
              {kpis.soloCount + kpis.teamCount} Unit{kpis.soloCount + kpis.teamCount === 1 ? '' : 's'} Total
            </span>
          </div>
        </div>

      </div>

      {/* =========================================================================
          COMPACT CERTIFICATE SUMMARY
          ========================================================================= */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-kits-blue" />
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-900">
              Certificate Issuance Summary
            </h3>
          </div>
          <span className="text-xs font-mono font-bold text-gray-700">
            Total Issued: {certBreakdown.total} • Unlocked: {certBreakdown.unlocked}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-center">
            <span className="text-[10px] font-black uppercase text-amber-800 block">1st Winner</span>
            <p className="text-lg font-black text-amber-900 mt-0.5">{certBreakdown.winner}</p>
          </div>

          <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl text-center">
            <span className="text-[10px] font-black uppercase text-slate-700 block">2nd Runner</span>
            <p className="text-lg font-black text-slate-800 mt-0.5">{certBreakdown.runner}</p>
          </div>

          <div className="p-3 bg-orange-50/70 border border-orange-200 rounded-xl text-center">
            <span className="text-[10px] font-black uppercase text-orange-800 block">3rd Place</span>
            <p className="text-lg font-black text-orange-900 mt-0.5">{certBreakdown.third}</p>
          </div>

          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-center">
            <span className="text-[10px] font-black uppercase text-kits-blue block">Participation</span>
            <p className="text-lg font-black text-blue-950 mt-0.5">{certBreakdown.participant}</p>
          </div>
        </div>
      </div>

      {/* =========================================================================
          BOTTOM: CONCISE OPERATIONAL SUMMARY TABLE
          ========================================================================= */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-kits-red" />
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-900">
              Operational Track Breakdown
            </h3>
          </div>
          <span className="text-[10px] font-bold text-gray-400">
            {subEventPerformance.length} Sub-Events in Active Filter
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4 font-black">Sub-Event Track</th>
                <th className="py-3 px-4 font-black text-center">Registrations</th>
                <th className="py-3 px-4 font-black text-center">Participants</th>
                <th className="py-3 px-4 font-black text-center">Attendance</th>
                <th className="py-3 px-4 font-black text-right">Revenue (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {subEventPerformance.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    No records found for current filter selection.
                  </td>
                </tr>
              ) : (
                subEventPerformance.map((s) => {
                  const attendPct = s.totalMembers > 0 ? Math.round((s.attendedMembers / s.totalMembers) * 100) : 0;
                  return (
                    <tr key={s.id} className="hover:bg-gray-50/60 transition">
                      <td className="py-3 px-4 font-bold text-gray-900">{s.name}</td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-gray-800">{s.totalRegs}</td>
                      <td className="py-3 px-4 text-center font-mono text-gray-700">{s.totalMembers}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          attendPct >= 75 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                        }`}>
                          {s.attendedMembers}/{s.totalMembers} ({attendPct}%)
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                        ₹{s.revenue.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
        </div>
      )}
    </div>
  );
}
