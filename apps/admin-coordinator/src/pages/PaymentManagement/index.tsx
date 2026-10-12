import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useScrollLock } from '@kits-eos/shared';
import { useAuth } from '../../context/AuthContext';
import { getCoordinatorSession, getCoordinatorSessionToken, clearCoordinatorSession } from '../../utils/coordinatorSession';
import { LogoutConfirmationModal } from '../../components/ui/LogoutConfirmationModal';
import {
  Search,
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertTriangle,
  X,
  CreditCard,
  LogOut,
  MapPin,
  Users,
  DollarSign,
  Calendar,
  Filter
} from 'lucide-react';

interface PendingPayment {
  payment_id: string;
  registration_id: string;
  amount: number;
  payment_method: string;
  payment_status: string;
  reference_id: string;
  payment_created_at: string;
  reg_id: string;
  reg_status: string;
  reg_created_at: string;
  sub_event_id: string;
  sub_event_name: string;
  venue: string;
  participation_type: string;
  event_name: string;
  category_name: string;
  student_name: string;
  student_roll_number: string;
  student_department: string;
  student_college: string;
  student_phone: string;
  team_name: string | null;
  is_team: boolean;
}

interface MainEventOption {
  id: string;
  name: string;
  status?: string;
  manual_status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

interface PaymentMetrics {
  total_pending: number;
  total_collected: number;
  total_pending_amount: number;
}

export function PaymentManagement() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const coordSession = getCoordinatorSession();

  // Main Event Selection State
  const [events, setEvents] = useState<MainEventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);

  // Payments & Metrics State
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [metrics, setMetrics] = useState<PaymentMetrics>({
    total_pending: 0,
    total_collected: 0,
    total_pending_amount: 0,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Logout Confirmation Modal State
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  // Modal State for Confirm Payment
  const [paymentToConfirm, setPaymentToConfirm] = useState<PendingPayment | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  // Lock body scroll and handle Escape key for COD confirmation modal
  useScrollLock(Boolean(paymentToConfirm));

  useEffect(() => {
    if (!paymentToConfirm || isConfirming) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPaymentToConfirm(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [paymentToConfirm, isConfirming]);

  // Fetch available Main Events from Supabase
  useEffect(() => {
    const fetchEvents = async () => {
      setIsLoadingEvents(true);
      setError(null);
      try {
        const { data, error: eventsErr } = await supabase
          .from('events')
          .select('id, name, status, start_date, end_date, manual_status')
          .eq('status', 'ACTIVE')
          .order('start_date', { ascending: false });

        if (eventsErr) throw eventsErr;
        setEvents(data || []);
      } catch (err: any) {
        console.error('Error fetching events for Payment Manager:', err);
        setError(err.message || 'Failed to load event list from server.');
      } finally {
        setIsLoadingEvents(false);
      }
    };

    fetchEvents();
  }, []);

  // Fetch pending COD payments from authoritative database RPC scoped to selected Main Event
  const fetchPendingPayments = useCallback(async (searchQuery: string = '', eventId: string = selectedEventId) => {
    if (!eventId) {
      setPayments([]);
      setMetrics({ total_pending: 0, total_collected: 0, total_pending_amount: 0 });
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const coordToken = getCoordinatorSessionToken();
      const coordinatorId = coordSession?.coordinator?.id || null;
      const { data, error: rpcErr } = await supabase.rpc('get_pending_cod_payments', {
        p_search_query: searchQuery.trim() || null,
        p_sub_event_id: null,
        p_coordinator_id: coordinatorId,
        p_event_id: eventId,
        p_token: coordToken,
      });

      if (rpcErr) throw rpcErr;

      if (data && data.success) {
        setPayments(data.payments || []);
        setMetrics(data.metrics || { total_pending: 0, total_collected: 0, total_pending_amount: 0 });
      } else {
        setPayments([]);
        setMetrics({ total_pending: 0, total_collected: 0, total_pending_amount: 0 });
      }
    } catch (err: any) {
      console.error('Error fetching pending COD payments:', err);
      setError(err.message || 'Failed to load pending payments from server.');
    } finally {
      setIsLoading(false);
    }
  }, [coordSession?.coordinator?.id, selectedEventId]);

  // Fetch when selected Main Event changes
  const handleEventChange = (newEventId: string) => {
    setSelectedEventId(newEventId);
    setSearchTerm('');
    if (newEventId) {
      fetchPendingPayments('', newEventId);
    } else {
      setPayments([]);
      setMetrics({ total_pending: 0, total_collected: 0, total_pending_amount: 0 });
    }
  };

  // Debounced search on input change
  useEffect(() => {
    if (!selectedEventId) return;
    const handler = setTimeout(() => {
      fetchPendingPayments(searchTerm, selectedEventId);
    }, 300);

    return () => clearTimeout(handler);
  }, [searchTerm, selectedEventId, fetchPendingPayments]);

  // Server-side payment confirmation handler
  const handleConfirmPayment = async () => {
    if (!paymentToConfirm || isConfirming) return;

    setIsConfirming(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const coordToken = getCoordinatorSessionToken();
      const coordinatorId = coordSession?.coordinator?.id || null;
      const { data, error: rpcErr } = await supabase.rpc('confirm_cod_payment', {
        p_payment_id: paymentToConfirm.payment_id,
        p_coordinator_id: coordinatorId,
        p_token: coordToken,
      });

      if (rpcErr) throw rpcErr;

      if (data && data.success) {
        const confirmedAmount = paymentToConfirm.amount;
        const student = paymentToConfirm.student_name;
        setSuccessMessage(`Payment of ₹${confirmedAmount} for ${student} marked as PAID successfully. Pass unlocked.`);
        setPaymentToConfirm(null);
        // Authoritatively re-fetch fresh metrics and remaining pending records from PostgreSQL
        await fetchPendingPayments(searchTerm, selectedEventId);
      } else {
        throw new Error(data?.message || 'Payment confirmation failed.');
      }
    } catch (err: any) {
      console.error('Payment confirmation error:', err);
      alert('Failed to confirm payment: ' + (err.message || 'Unknown error occurred.'));
    } finally {
      setIsConfirming(false);
    }
  };

  const handleSignOut = async () => {
    const token = coordSession?.session_token;
    if (token) {
      try {
        await supabase.rpc('invalidate_coordinator_session', { p_token: token });
      } catch {
        // silent
      }
      clearCoordinatorSession();
    }
    if (user) {
      await signOut();
    }
    navigate('/', { replace: true });
  };

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-20">
      {/* Top Floating Institutional Header */}
      <header className="sticky top-2 sm:top-4 z-30 px-3 sm:px-6 max-w-7xl mx-auto">
        <div className="glass-header-floating rounded-2xl sm:rounded-3xl transition-all duration-300 pointer-events-auto px-4 sm:px-8 h-16 sm:h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-kits-red to-kits-blue flex items-center justify-center font-black text-white text-xs shadow-sm">
              EOS
            </div>
            <div>
              <div className="text-sm sm:text-base font-black tracking-tight text-gray-900 flex items-center gap-2">
                <span className="text-kits-red">KITS</span>-<span className="text-kits-blue">EOS</span>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  OPERATIONS
                </span>
              </div>
              <span className="text-[10px] sm:text-xs font-bold text-gray-500 block">
                Cash On Desk - (COD) Reconciliation Desk
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-gray-900">
                Welcome, {coordSession?.coordinator?.display_name || 'Payment Manager'}
              </div>
              <div className="text-[10px] font-mono text-emerald-700 font-bold">
                @{coordSession?.coordinator?.username === 'kitseosmanager@123' ? 'paymentmanager@eos' : (coordSession?.coordinator?.username || 'paymentmanager@eos')}
              </div>
            </div>

            <button
              onClick={() => {
                if (selectedEventId) {
                  fetchPendingPayments(searchTerm, selectedEventId);
                }
              }}
              disabled={!selectedEventId || isLoading}
              className="p-2 sm:p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 hover:text-gray-900 transition shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Refresh Records"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-emerald-600' : ''}`} />
            </button>

            <button
              onClick={() => setIsLogoutModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:border-red-200 bg-white hover:bg-red-50 text-gray-600 hover:text-kits-red text-xs font-bold transition shadow-2xs cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 pt-6 sm:pt-8 space-y-6">
        {/* Institutional Hero Banner */}
        <div className="bg-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-800 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
          <div className="relative z-10 space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/10 text-emerald-300 border border-white/15">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>KITS-EOS OPERATIONS • ACTIVE COD SESSION</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Welcome back, EOS Payment Manager
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 font-medium">
              COD Payment Verification & Registration Management
            </p>
          </div>
        </div>

        {/* Success / Error Alerts */}
        {successMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 text-xs font-bold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-900 text-xs font-bold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-600 hover:text-red-900 cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Main Event Selection Filter Card */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-2xs p-4 sm:p-6 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label htmlFor="main-event-select" className="text-xs font-black uppercase tracking-wider text-gray-700 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-kits-red" />
              <span>MAIN EVENT</span>
            </label>
            {selectedEvent && (
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 inline-flex items-center gap-1.5 w-fit">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Active Filter: <strong>{selectedEvent.name}</strong></span>
              </span>
            )}
          </div>
          <div className="relative">
            <select
              id="main-event-select"
              value={selectedEventId}
              onChange={(e) => handleEventChange(e.target.value)}
              disabled={isLoadingEvents}
              className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl sm:rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition cursor-pointer appearance-none"
            >
              {isLoadingEvents ? (
                <option value="" disabled>Loading Main Events...</option>
              ) : events.length === 0 ? (
                <option value="" disabled>No Main Events Available</option>
              ) : (
                <option value="">Select Main Event</option>
              )}
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} {ev.manual_status ? `(${ev.manual_status})` : ''}
                </option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-gray-400">
              <Filter className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Conditional Content: Prompts to select event vs. showing metrics & payments */}
        {!selectedEventId ? (
          <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-2xs p-12 text-center space-y-4">
            <div className="h-16 w-16 rounded-2xl bg-red-50 text-kits-red border border-red-100 flex items-center justify-center mx-auto">
              <Calendar className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-black text-gray-900 tracking-tight">Select a Main Event</h3>
              <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
                Please choose a Main Event from the dropdown above to view authoritative COD payment statistics, total revenue collected, and pending registrations.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* KPI Metrics Ribbon (Dynamic from PostgreSQL) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs p-5 flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center shrink-0">
                  <Clock className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
                    PENDING PAYMENTS
                  </div>
                  <div className="text-2xl font-black text-gray-900">
                    {metrics.total_pending}
                  </div>
                  <div className="text-[10px] text-gray-400 font-medium">
                    Registrations awaiting cash verification
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs p-5 flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
                    TOTAL COLLECTED
                  </div>
                  <div className="text-2xl font-black text-emerald-600">
                    ₹{metrics.total_collected.toLocaleString('en-IN')}
                  </div>
                  <div className="text-[10px] text-gray-400 font-medium">
                    Verified SUCCESS payments for this event
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs p-5 flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
                  <DollarSign className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
                    PENDING AMOUNT
                  </div>
                  <div className="text-2xl font-black text-blue-600">
                    ₹{metrics.total_pending_amount.toLocaleString('en-IN')}
                  </div>
                  <div className="text-[10px] text-gray-400 font-medium">
                    Cash to be collected at desk
                  </div>
                </div>
              </div>
            </div>



            {/* Search-First Query Bar */}
            <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-2xs p-4 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
                    <Search className="h-5 w-5 text-emerald-600" />
                    <span>Search Pending COD Registrations</span>
                  </h2>
                  <p className="text-xs text-gray-500">
                    Search by Student Name, Roll Number, Registration ID, Team Name, or Sub-Event
                  </p>
                </div>
                <div className="text-xs font-bold text-gray-500 font-mono">
                  {payments.length} Pending Result{payments.length === 1 ? '' : 's'}
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                  <Search className="h-5 w-5" />
                </div>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Type student name, roll number (e.g. 25JK1A42G3), ref ID, sub-event..."
                  className="w-full pl-12 pr-10 py-3.5 bg-gray-50 border border-gray-200 rounded-xl sm:rounded-2xl text-sm font-semibold text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Results List / Table */}
            <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-2xs overflow-hidden">
              {isLoading ? (
                <div className="py-20 text-center space-y-3">
                  <RefreshCw className="h-8 w-8 text-emerald-600 animate-spin mx-auto" />
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Searching Authoritative Payment Records...
                  </p>
                </div>
              ) : payments.length === 0 ? (
                <div className="py-20 text-center space-y-3 max-w-md mx-auto px-4">
                  <div className="h-12 w-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="h-6 w-6 text-gray-400" />
                  </div>
                  <h3 className="text-base font-black text-gray-900">No Pending COD Payments Found</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    {searchTerm
                      ? `No pending registrations matched "${searchTerm}". Try checking the roll number or registration ID.`
                      : `All Cash on Desk payments for ${selectedEvent?.name || 'this event'} are up to date and verified!`}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {payments.map((p) => (
                    <div
                      key={p.payment_id}
                      className="p-4 sm:p-6 hover:bg-gray-50/70 transition flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      {/* Left: Student & Academic Info */}
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-black text-gray-900 tracking-tight">
                            {p.student_name}
                          </span>
                          <span className="font-mono font-black text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-800 border border-gray-200">
                            {p.student_roll_number}
                          </span>
                          {p.is_team && p.team_name && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                              <Users className="h-3 w-3" />
                              <span>Team: {p.team_name}</span>
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-medium">{p.student_department}</span>
                          <span className="text-gray-300">•</span>
                          <span className="text-gray-500">{p.student_college}</span>
                          {p.student_phone && p.student_phone !== 'N/A' && (
                            <>
                              <span className="text-gray-300">•</span>
                              <span className="font-mono text-gray-500">{p.student_phone}</span>
                            </>
                          )}
                        </div>

                        {/* Event & Sub-Event badges */}
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                          <span className="font-extrabold text-kits-red uppercase tracking-wider text-[10px] px-2 py-0.5 rounded bg-red-50 border border-red-100">
                            {p.event_name}
                          </span>
                          <span className="font-black text-gray-800">
                            {p.sub_event_name}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                            <MapPin className="h-3 w-3 text-gray-400" />
                            <span>{p.venue || 'Venue TBD'}</span>
                          </span>
                        </div>

                        <div className="text-[11px] font-mono text-gray-400 pt-0.5">
                          Ref: <span className="font-bold text-gray-600">{p.reference_id}</span> • Reg ID: {p.reg_id.slice(0, 8)}...
                        </div>
                      </div>

                      {/* Right: Payment Amount & Action */}
                      <div className="flex items-center justify-between lg:justify-end gap-4 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-100">
                        <div className="text-left lg:text-right">
                          <div className="text-xl font-black text-gray-900 tracking-tight">
                            ₹{p.amount}
                          </div>
                          <div className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                            <Clock className="h-3 w-3" />
                            <span>PENDING COD PAYMENT</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setPaymentToConfirm(p)}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-emerald-600 bg-white hover:bg-emerald-50 text-emerald-700 hover:text-emerald-800 font-black text-xs uppercase tracking-wider shadow-2xs hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition cursor-pointer"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>MARK AS PAID</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Confirmation Modal — Strictly Irreversible Workflow */}
      {paymentToConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-gray-100 space-y-5 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <CreditCard className="h-5 w-5" />
                </div>
                <h3 className="text-base font-black text-gray-900">
                  Confirm COD Payment
                </h3>
              </div>
              <button
                onClick={() => setPaymentToConfirm(null)}
                disabled={isConfirming}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Confirmation Details Card */}
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-gray-200/60">
                <span className="text-gray-500 font-medium">Student:</span>
                <span className="font-black text-gray-900">
                  {paymentToConfirm.student_name}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-200/60">
                <span className="text-gray-500 font-medium">Roll Number:</span>
                <span className="font-mono font-black text-gray-900">
                  {paymentToConfirm.student_roll_number}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-200/60">
                <span className="text-gray-500 font-medium">Event:</span>
                <span className="font-bold text-gray-900">{paymentToConfirm.event_name}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-200/60">
                <span className="text-gray-500 font-medium">Sub-Event:</span>
                <span className="font-bold text-gray-900">{paymentToConfirm.sub_event_name}</span>
              </div>
              {paymentToConfirm.is_team && paymentToConfirm.team_name && (
                <div className="flex justify-between py-1.5 border-b border-gray-200/60">
                  <span className="text-gray-500 font-medium">Team Name:</span>
                  <span className="font-bold text-blue-700">{paymentToConfirm.team_name}</span>
                </div>
              )}
              <div className="flex justify-between py-1.5 border-b border-gray-200/60">
                <span className="text-gray-500 font-medium">Registration / Reference ID:</span>
                <span className="font-mono font-bold text-gray-700">{paymentToConfirm.reference_id}</span>
              </div>
              <div className="flex justify-between py-2 pt-2.5">
                <span className="text-gray-900 font-black text-sm">Amount:</span>
                <span className="font-black text-emerald-700 text-lg">₹{paymentToConfirm.amount}</span>
              </div>
            </div>

            {/* Warning Callout */}
            <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 leading-relaxed font-semibold">
                Once confirmed, this payment will be marked as paid and the student's registration will be completed. This action cannot be reversed.
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPaymentToConfirm(null)}
                disabled={isConfirming}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPayment}
                disabled={isConfirming}
                className="px-5 py-2.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition shadow-md cursor-pointer flex items-center gap-2"
              >
                {isConfirming ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Confirming...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Confirm Payment</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Logout Confirmation Modal */}
      <LogoutConfirmationModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={handleSignOut}
      />
    </div>
  );
}
