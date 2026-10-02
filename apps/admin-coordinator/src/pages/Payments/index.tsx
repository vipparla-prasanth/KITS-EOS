import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import type { Payment, Event, SubEvent } from '@kits-eos/shared/src/types/models';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { 
  CreditCard, 
  Search, 
  IndianRupee, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Layers, 
  User,
  Users,
  Banknote,
  ShieldCheck,
  X
} from 'lucide-react';

export function PaymentsList() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [subEvents, setSubEvents] = useState<SubEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [eventFilter, setEventFilter] = useState<string>('ALL');
  const [subEventFilter, setSubEventFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SUCCESS' | 'PENDING' | 'FAILED'>('ALL');
  const [profilesMap, setProfilesMap] = useState<Record<string, any>>({});

  // Confirmation Modal State
  const [confirmingPayment, setConfirmingPayment] = useState<Payment | null>(null);
  const [isProcessingConfirmation, setIsProcessingConfirmation] = useState(false);
  const [confirmationSuccessMsg, setConfirmationSuccessMsg] = useState<string | null>(null);
  const [confirmationErrorMsg, setConfirmationErrorMsg] = useState<string | null>(null);

  const loadPaymentsData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [eventsRes, subEventsRes, payRes, profilesRes] = await Promise.all([
        supabase.from('events').select('id, name').order('name'),
        supabase
          .from('sub_events')
          .select('id, name, event_id, category_id, fee_amount_solo, fee_amount_team, status, categories(id, name, event_id)')
          .eq('status', 'ACTIVE')
          .order('name'),
        supabase.from('payments').select(`
          id,
          registration_id,
          amount,
          reference_id,
          status,
          payment_method,
          created_at,
          registrations (
            id,
            sub_event_id,
            leader_id,
            status,
            sub_events (
              id,
              name,
              category_id,
              event_id,
              participation_type,
              fee_amount_solo,
              fee_amount_team,
              payment_instructions,
              categories (
                id,
                name,
                event_id,
                events (
                  id,
                  name
                )
              ),
              events (
                id,
                name
              )
            ),
            teams (
              id,
              team_name,
              team_members (
                id,
                user_id,
                snapshot_name,
                snapshot_roll_number,
                snapshot_college,
                snapshot_department,
                snapshot_year,
                is_leader
              )
            ),
            users (
              id,
              email
            )
          )
        `).order('created_at', { ascending: false }),
        supabase.from('student_profiles').select('user_id, roll_number, full_name, college, department, year_of_study')
      ]);

      if (eventsRes.error) throw eventsRes.error;
      if (subEventsRes.error) throw subEventsRes.error;
      if (payRes.error) throw payRes.error;

      // Map profiles by user_id
      const pMap: Record<string, any> = {};
      if (profilesRes.data) {
        profilesRes.data.forEach((p: any) => {
          if (p.user_id) pMap[p.user_id] = p;
        });
      }
      setProfilesMap(pMap);

      setEvents((eventsRes.data as Event[]) || []);
      setSubEvents((subEventsRes.data as unknown as SubEvent[]) || []);
      setPayments((payRes.data as unknown as Payment[]) || []);
    } catch (err: any) {
      console.error('Failed to fetch payments:', err);
      setError(err.message || 'An unexpected error occurred while loading payments.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPaymentsData();
  }, []);

  // Safe team and member resolution helpers
  const resolveTeamData = (reg: any) => {
    if (!reg?.teams) return { team: null, members: [] as any[] };
    const team = Array.isArray(reg.teams) ? (reg.teams.length > 0 ? reg.teams[0] : null) : reg.teams;
    const rawMembers = team?.team_members;
    const members = Array.isArray(rawMembers)
      ? rawMembers
      : rawMembers ? [rawMembers] : [];
    return { team, members };
  };

  const resolveMemberDetails = (member: any, reg: any) => {
    const profile = (member?.user_id && profilesMap[member.user_id]) ||
                    (reg?.leader_id && profilesMap[reg.leader_id]) ||
                    null;

    const name = member?.snapshot_name || profile?.full_name || reg?.users?.email || 'Participant';
    const rollNumber = member?.snapshot_roll_number || profile?.roll_number || 'Not provided';
    const department = member?.snapshot_department || profile?.department || 'Not provided';
    const year = member?.snapshot_year || profile?.year_of_study || 1;
    const college = member?.snapshot_college || profile?.college || 'KITS Akshar Institute of Technology';

    return { name, rollNumber, department, year, college };
  };

  // Filtered payments
  const filteredPayments = useMemo(() => {
    return payments.filter((pay) => {
      const reg = pay.registrations;
      const sub = reg?.sub_events;
      const { team, members } = resolveTeamData(reg);
      const leader = members.find((m: any) => m.is_leader) || members[0];
      const leaderDetails = resolveMemberDetails(leader, reg);

      // Event filter
      if (eventFilter !== 'ALL') {
        const parentEventId = sub?.event_id || sub?.categories?.event_id || sub?.categories?.events?.id;
        if (parentEventId !== eventFilter) return false;
      }

      // Sub-event filter
      if (subEventFilter !== 'ALL') {
        if (reg?.sub_event_id !== subEventFilter) return false;
      }

      // Status filter
      if (statusFilter !== 'ALL') {
        if (pay.status !== statusFilter) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesRef = pay.reference_id?.toLowerCase().includes(q);
        const matchesSub = sub?.name?.toLowerCase().includes(q);
        const matchesLeader = leaderDetails.name.toLowerCase().includes(q);
        const matchesRoll = leaderDetails.rollNumber.toLowerCase().includes(q);
        const matchesEmail = reg?.users?.email?.toLowerCase().includes(q);
        const matchesTeam = team?.team_name?.toLowerCase().includes(q);

        return matchesRef || matchesSub || matchesLeader || matchesRoll || matchesEmail || matchesTeam;
      }

      return true;
    });
  }, [payments, searchQuery, eventFilter, subEventFilter, statusFilter, profilesMap]);

  // Dynamic Sub-events strictly available under selected event filter
  const availableSubEvents = useMemo(() => {
    return subEvents.filter((s: any) => {
      const parentEventId = s.event_id || (Array.isArray(s.categories) ? s.categories[0]?.event_id : (s.categories as any)?.event_id);
      return eventFilter === 'ALL' || parentEventId === eventFilter;
    });
  }, [subEvents, eventFilter]);

  // Ensure subEventFilter resets to ALL if the selected event changes and does not contain the current sub-event
  useEffect(() => {
    if (subEventFilter !== 'ALL') {
      const exists = availableSubEvents.some((s) => s.id === subEventFilter);
      if (!exists) {
        setSubEventFilter('ALL');
      }
    }
  }, [availableSubEvents, subEventFilter]);

  // Handle Mark as Paid Confirmation
  const handleExecutePaymentConfirmation = async () => {
    if (!confirmingPayment) return;

    try {
      setIsProcessingConfirmation(true);
      setConfirmationErrorMsg(null);
      setConfirmationSuccessMsg(null);

      // Call authoritative RPC
      const { error: rpcErr } = await supabase.rpc('confirm_cod_payment', {
        p_payment_id: confirmingPayment.id,
      });

      if (rpcErr) {
        // Fallback: direct update if RPC fails
        const { error: directErr } = await supabase
          .from('payments')
          .update({ status: 'SUCCESS' })
          .eq('id', confirmingPayment.id);

        if (directErr) throw directErr;

        await supabase
          .from('registrations')
          .update({ status: 'CONFIRMED' })
          .eq('id', confirmingPayment.registration_id);
      }

      // Update local state
      setPayments(prev => prev.map(p => {
        if (p.id === confirmingPayment.id) {
          return { ...p, status: 'SUCCESS' };
        }
        return p;
      }));

      setConfirmationSuccessMsg(`Payment of ₹${confirmingPayment.amount} confirmed successfully!`);
      setTimeout(() => {
        setConfirmingPayment(null);
        setConfirmationSuccessMsg(null);
      }, 1500);
    } catch (err: any) {
      console.error('Payment confirmation error:', err);
      setConfirmationErrorMsg(err.message || 'Failed to confirm payment.');
    } finally {
      setIsProcessingConfirmation(false);
    }
  };

  // Metrics
  const totalRevenue = useMemo(() => {
    return payments
      .filter((p) => p.status === 'SUCCESS')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }, [payments]);

  const pendingAmount = useMemo(() => {
    return payments
      .filter((p) => p.status === 'PENDING')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }, [payments]);

  const successfulCount = useMemo(() => {
    return payments.filter((p) => p.status === 'SUCCESS').length;
  }, [payments]);

  const pendingCount = useMemo(() => {
    return payments.filter((p) => p.status === 'PENDING').length;
  }, [payments]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment & Collections"
        description="Monitor collections, track revenue streams, and verify in-person COD registration payments."
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-bold uppercase tracking-wider">Total Revenue</span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <IndianRupee className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-gray-900">
            ₹{totalRevenue.toLocaleString('en-IN')}
          </div>
          <p className="text-[11px] text-emerald-600 font-bold">{successfulCount} Completed Payments</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-bold uppercase tracking-wider">Pending COD Dues</span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-black font-mono text-amber-600">
            ₹{pendingAmount.toLocaleString('en-IN')}
          </div>
          <p className="text-[11px] text-amber-600 font-bold">{pendingCount} Pending In-Person Payments</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-bold uppercase tracking-wider">Total Transactions</span>
            <div className="p-2 rounded-xl bg-blue-50 text-kits-blue">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-gray-900">
            {payments.length}
          </div>
          <p className="text-[11px] text-gray-500 font-medium">All recorded payment records</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-bold uppercase tracking-wider">Collection Efficiency</span>
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-gray-900">
            {payments.length > 0 ? Math.round((successfulCount / payments.length) * 100) : 100}%
          </div>
          <p className="text-[11px] text-purple-600 font-bold">Confirmed settlement rate</p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search reference, student, roll..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
            />
          </div>

          {/* Event Filter */}
          <div>
            <select
              value={eventFilter}
              onChange={(e) => {
                setEventFilter(e.target.value);
                setSubEventFilter('ALL');
              }}
              className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
            >
              <option value="ALL">All Events</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          </div>

          {/* Sub-Event Filter */}
          <div>
            <select
              value={subEventFilter}
              onChange={(e) => setSubEventFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
            >
              <option value="ALL">All Sub-Events</option>
              {availableSubEvents.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">SUCCESS (Paid)</option>
              <option value="PENDING">PENDING (COD Due)</option>
              <option value="FAILED">FAILED</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table Data */}
      {isLoading ? (
        <LoadingState message="Loading payment transactions..." />
      ) : error ? (
        <ErrorState message={error} />
      ) : filteredPayments.length === 0 ? (
        <EmptyState
          title="No Payment Records Found"
          description="No transaction records match the current filter criteria."
          icon={<CreditCard className="h-10 w-10 text-gray-300" />}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] font-extrabold tracking-wider">
                <tr>
                  <th scope="col" className="px-6 py-3.5">Reference ID</th>
                  <th scope="col" className="px-6 py-3.5">Event & Track</th>
                  <th scope="col" className="px-6 py-3.5">Payer / Student</th>
                  <th scope="col" className="px-6 py-3.5">Mode</th>
                  <th scope="col" className="px-6 py-3.5">Amount (₹)</th>
                  <th scope="col" className="px-6 py-3.5">Status</th>
                  <th scope="col" className="px-6 py-3.5">Date</th>
                  <th scope="col" className="px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredPayments.map((payment) => {
                  const reg = payment.registrations;
                  const sub = reg?.sub_events;
                  const { team, members } = resolveTeamData(reg);
                  const leader = members.find((m: any) => m.is_leader) || members[0];
                  const leaderDetails = resolveMemberDetails(leader, reg);
                  const isTeam = members.length > 1 || (team?.team_name && team.team_name.trim().length > 0 && team.team_name !== 'Solo Participant');
                  const eventName = sub?.events?.name || sub?.categories?.events?.name || 'Main Event';

                  return (
                    <tr key={payment.id} className="hover:bg-gray-50/80 transition">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-mono font-bold text-xs text-gray-900 bg-gray-100 px-2 py-1 rounded inline-block">
                          {payment.reference_id}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="space-y-0.5">
                          <div className="font-bold text-gray-900 text-xs">{sub?.name || 'Sub-Event'}</div>
                          <div className="text-[11px] text-gray-500 flex items-center gap-1">
                            <Layers className="h-3 w-3 text-gray-400" />
                            {eventName} {sub?.categories?.name ? `› ${sub.categories.name}` : ''}
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="space-y-0.5">
                          <div className="font-bold text-gray-900 text-xs">
                            {leaderDetails.name}
                          </div>
                          <div className="text-[11px] font-mono text-gray-500">
                            {leaderDetails.rollNumber !== 'Not provided' ? leaderDetails.rollNumber : 'Roll: Not provided'} • {leaderDetails.department !== 'Not provided' ? leaderDetails.department : 'Dept: Not provided'}
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          isTeam 
                            ? 'bg-blue-50 text-kits-blue border border-blue-200' 
                            : 'bg-gray-100 text-gray-700 border border-gray-200'
                        }`}>
                          {isTeam ? <Users className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          {isTeam ? 'Team' : 'Solo'}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-mono font-black text-sm text-gray-900">
                          ₹{Number(payment.amount).toLocaleString('en-IN')}
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider ${
                          payment.status === 'SUCCESS'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : payment.status === 'PENDING'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                          {payment.status === 'SUCCESS' && <CheckCircle2 className="h-3 w-3" />}
                          {payment.status === 'PENDING' && <Clock className="h-3 w-3" />}
                          {payment.status === 'FAILED' && <AlertCircle className="h-3 w-3" />}
                          {payment.status}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-gray-600">
                        {formatDateTime12h(payment.created_at)}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        {payment.status === 'PENDING' ? (
                          <button
                            type="button"
                            onClick={() => setConfirmingPayment(payment)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 transition shadow-2xs cursor-pointer"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Confirm Paid</span>
                          </button>
                        ) : (
                          <span className="text-[11px] font-bold text-emerald-600 flex items-center justify-end gap-1">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Settled
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: STAFF PAYMENT CONFIRMATION
          ========================================================================= */}
      {confirmingPayment && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto modal-overlay-animate">
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-md w-full p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-2xl border border-gray-200 relative modal-dialog-animate max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Banknote className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  Confirm Payment Verification?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmingPayment(null)}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {confirmationSuccessMsg && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{confirmationSuccessMsg}</span>
              </div>
            )}

            {confirmationErrorMsg && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
                <span>{confirmationErrorMsg}</span>
              </div>
            )}

            {(() => {
              const reg = confirmingPayment.registrations;
              const sub = reg?.sub_events;
              const { team, members } = resolveTeamData(reg);
              const leader = members.find((m: any) => m.is_leader) || members[0];
              const leaderDetails = resolveMemberDetails(leader, reg);

              return (
                <div className="space-y-4 text-xs">
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-1 text-center">
                    <span className="text-sm font-bold text-emerald-950 block">
                      This will mark this COD payment of ₹{confirmingPayment.amount} as PAID.
                    </span>
                    <span className="text-2xl font-black font-mono text-emerald-700 block pt-1">
                      ₹{confirmingPayment.amount}
                    </span>
                  </div>

                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 font-bold text-center uppercase tracking-wider text-[11px]">
                    ⚠️ This action cannot be reversed.
                  </div>

                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-bold">Track / Sub-Event:</span>
                      <span className="font-bold text-gray-900">{sub?.name}</span>
                    </div>
                    {team?.team_name && team.team_name !== 'Solo Participant' && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 font-bold">Team:</span>
                        <span className="font-bold text-kits-blue">{team.team_name}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-bold">Student Participant / Leader:</span>
                      <span className="font-bold text-gray-900">
                        {leaderDetails.name} {leaderDetails.rollNumber !== 'Not provided' ? `(${leaderDetails.rollNumber})` : ''}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-bold">Department:</span>
                      <span className="font-medium text-gray-700">{leaderDetails.department}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-bold">Payment Reference:</span>
                      <span className="font-mono font-bold text-gray-900">{confirmingPayment.reference_id}</span>
                    </div>
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-3 border-t border-gray-100 w-full">
                    <button
                      type="button"
                      onClick={() => setConfirmingPayment(null)}
                      disabled={isProcessingConfirmation}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:text-gray-900 cursor-pointer text-center"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isProcessingConfirmation}
                      onClick={handleExecutePaymentConfirmation}
                      className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 transition shadow-2xs cursor-pointer text-center"
                    >
                      {isProcessingConfirmation ? 'Verifying...' : 'Confirm Verification'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
