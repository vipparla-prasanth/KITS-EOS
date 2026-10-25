import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Radio,
  Wifi,
  WifiOff,
  Users,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Search,
  ArrowLeft,
  RefreshCw,
  Lock,
  Unlock,
  Zap,
  BarChart2,
  Trophy,
  Filter,
  Check,
  Hourglass,
  LogOut,
  LayoutGrid,
} from 'lucide-react';
import {
  assessmentService,
  supabase,
  type AssessmentLiveHostSnapshot,
  type AssessmentLiveEvent,
} from '@kits-eos/shared';
import {
  getCoordinatorSessionToken,
  getCoordinatorSession,
  signOutCoordinator,
} from '../../utils/coordinatorSession';
import { LogoutConfirmationModal } from '../../components/ui/LogoutConfirmationModal';
import { KahootPodium } from '../../components/assessments/KahootPodium';
import { StatusDistributionDonut } from '../../components/assessments/AssessmentCharts';

export function AssessmentLiveHost() {
  const { assessmentId: routeAssessmentId } = useParams<{ assessmentId?: string }>();
  const navigate = useNavigate();

  // Coordinator Session resolution
  const coordSession = getCoordinatorSession();
  const coordinatorToken = getCoordinatorSessionToken();
  const isCoordinator = coordSession?.coordinator?.coordinator_type === 'ASSESSMENT_COORDINATOR' ||
    (coordSession?.coordinator as any)?.coordinator_type === 'FACULTY' ||
    (coordSession?.coordinator as any)?.coordinator_type === 'ORGANIZER';

  // Resolved active assessmentId
  const initialId = routeAssessmentId || (coordSession?.coordinator as any)?.assigned_assessment?.id || '';
  const [assessmentId, setAssessmentId] = useState<string>(initialId);

  // Unassigned State
  const [isUnassigned, setIsUnassigned] = useState(false);
  const [unassignedMessage, setUnassignedMessage] = useState<string>('');

  // Telemetry Snapshot & Loading State
  const [snapshot, setSnapshot] = useState<AssessmentLiveHostSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Realtime Connection State
  const [connectionState, setConnectionState] = useState<'CONNECTED' | 'RECONNECTING' | 'OFFLINE'>('CONNECTING' as any);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date>(new Date());

  // Interactive UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'IN_PROGRESS' | 'SUBMITTED' | 'TERMINATED' | 'EXPIRED'>('ALL');
  const [activeHostTab, setActiveHostTab] = useState<'PARTICIPANTS' | 'ACTIVITY' | 'QUESTIONS' | 'SCOREBOARD'>('PARTICIPANTS');

  // Early Closure Modal State
  const [isEarlyCloseModalOpen, setIsEarlyCloseModalOpen] = useState(false);
  const [earlyCloseReason, setEarlyCloseReason] = useState('Scheduled examination session concluded by host coordinator');
  const [closingLoading, setClosingLoading] = useState(false);
  const [closeSuccessNotice, setCloseSuccessNotice] = useState<string | null>(null);

  // Sign out confirmation modal state
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  const channelRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const debounceFetchRef = useRef<any>(null);

  // 1. Authoritative Assessment Discovery (Resolves assignment if routeParam is empty)
  useEffect(() => {
    let isCancelled = false;

    const resolveAssessmentId = async () => {
      if (routeAssessmentId) {
        setAssessmentId(routeAssessmentId);
        return;
      }

      // Check if session has multiple assessment assignments; if so, send to selection screen
      const sessionAssessments = coordSession?.assigned_assessments || [];
      if (sessionAssessments.length > 1) {
        navigate('/coordinator/select', { replace: true });
        return;
      }

      if (sessionAssessments.length === 1 && sessionAssessments[0]?.id) {
        setAssessmentId(sessionAssessments[0].id);
        return;
      }

      if ((coordSession?.coordinator as any)?.assigned_assessment?.id) {
        setAssessmentId((coordSession?.coordinator as any).assigned_assessment.id);
        return;
      }

      // Query coordinator assigned assessment via secure RPC
      if (coordinatorToken) {
        setLoading(true);
        setError(null);
        try {
          const { data, error: err } = await assessmentService.getAssignedAssessment(coordinatorToken);
          if (isCancelled) return;

          if (err) {
            setError(err.message || 'Unable to verify coordinator assessment assignment.');
            setLoading(false);
            return;
          }

          if (data?.success) {
            if (data.assigned && data.assessment?.id) {
              setAssessmentId(data.assessment.id);
            } else {
              // If coordinator is primarily an Event Coordinator or has dual duties, redirect to selection or event operations
              if (
                coordSession?.coordinator?.coordinator_type !== 'ASSESSMENT_COORDINATOR' ||
                (coordSession?.assignments && coordSession.assignments.length > 0)
              ) {
                navigate('/coordinator/select', { replace: true });
                return;
              }
              setIsUnassigned(true);
              setUnassignedMessage(
                data.message || 'Your coordinator account is active, but is not currently assigned to an examination.'
              );
              setLoading(false);
            }
          } else {
            setError(data?.message || 'Authentication error verifying coordinator assignment.');
            setLoading(false);
          }
        } catch (fetchErr: any) {
          if (isCancelled) return;
          setError(fetchErr.message || 'Network error verifying coordinator assignment.');
          setLoading(false);
        }
      } else {
        // Neither route param nor coordinator token
        setError('No assessment specified. Please select an assessment from the administration portal.');
        setLoading(false);
      }
    };

    resolveAssessmentId();

    return () => {
      isCancelled = true;
    };
  }, [routeAssessmentId, coordinatorToken]);

  // Master safety timeout (10 seconds) to ensure the loading state NEVER hangs indefinitely
  useEffect(() => {
    if (!loading || snapshot) return;
    const fallbackTimer = setTimeout(() => {
      setLoading(false);
      setError((prev) => prev || 'Connection to examination telemetry timed out. Please verify coordinator authorization and network connectivity.');
    }, 10000);
    return () => clearTimeout(fallbackTimer);
  }, [loading, snapshot]);

  // 2. Fetch Authoritative Live Host Snapshot with Timeout Safety
  const fetchSnapshot = async (targetId: string, showSpinner = false) => {
    if (!targetId) {
      setLoading(false);
      return;
    }
    if (showSpinner) setLoading(true);
    setError(null);

    // 12-second timeout guard to ensure the loading spinner NEVER hangs indefinitely
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Live host telemetry request timed out. Please check your network and retry.')), 12000);
    });

    try {
      const fetchPromise = assessmentService.getLiveHostSnapshot(
        targetId,
        coordinatorToken || undefined
      );

      const res: any = await Promise.race([fetchPromise, timeoutPromise]);
      const { data, error: err } = res;

      if (err) throw err;
      if (data) {
        setSnapshot(data as AssessmentLiveHostSnapshot);
        setLastHeartbeat(new Date());
        setConnectionState('CONNECTED');
      } else {
        throw new Error('Received empty response from examination telemetry service.');
      }
    } catch (err: any) {
      console.error('Failed to load assessment live host snapshot:', err);
      setError(err.message || 'Unable to load live host data. Check authorization.');
      setConnectionState('OFFLINE');
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  // 3. Setup Realtime Subscription and Reconciliation
  useEffect(() => {
    if (!assessmentId) return;

    fetchSnapshot(assessmentId, true);

    // Clean up previous subscription if any
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Subscribe to PostgreSQL Realtime events
    const channelName = `assessment-host-${assessmentId}-${Date.now()}`;
    const channel = supabase.channel(channelName);
    channelRef.current = channel;

    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'assessment_live_events',
          filter: `assessment_id=eq.${assessmentId}`,
        },
        (payload) => {
          const newEvent = payload.new as AssessmentLiveEvent;
          setSnapshot((prev) => {
            if (!prev) return prev;
            const currentList = prev.recent_activity || (prev as any).recent_events || [];
            return {
              ...prev,
              recent_activity: [newEvent, ...currentList.slice(0, 49)],
            };
          });

          // Opportunistic reconciliation on stateful events
          if (
            newEvent.event_type === 'ATTEMPT_STARTED' ||
            newEvent.event_type === 'ATTEMPT_SUBMITTED' ||
            newEvent.event_type === 'ATTEMPT_TERMINATED' ||
            newEvent.event_type === 'STRIKE_RECORDED' ||
            newEvent.event_type === 'ASSESSMENT_CLOSED' ||
            newEvent.event_type === 'ASSESSMENT_REOPENED'
          ) {
            fetchSnapshot(assessmentId, false);
          } else if (newEvent.event_type === 'ANSWER_SAVED') {
            if (debounceFetchRef.current) clearTimeout(debounceFetchRef.current);
            debounceFetchRef.current = setTimeout(() => {
              fetchSnapshot(assessmentId, false);
            }, 600);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionState('CONNECTED');
          setLastHeartbeat(new Date());
        } else if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setConnectionState('RECONNECTING');
          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            fetchSnapshot(assessmentId, false);
          }, 4000);
        }
      });

    // 15-second heartbeat telemetry poll
    const pollInterval = setInterval(() => {
      fetchSnapshot(assessmentId, false);
    }, 15000);

    const handleOnline = () => {
      setConnectionState('RECONNECTING');
      fetchSnapshot(assessmentId, false);
    };

    const handleOffline = () => {
      setConnectionState('OFFLINE');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [assessmentId]);

  // Handle Early Close Assessment
  const handleEarlyCloseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assessmentId) return;

    setClosingLoading(true);
    try {
      const { error: err } = await assessmentService.closeAssessmentEarly(
        assessmentId,
        coordinatorToken || undefined,
        earlyCloseReason.trim()
      );

      if (err) throw err;
      setIsEarlyCloseModalOpen(false);
      setCloseSuccessNotice('Assessment successfully closed early. Active attempts have been finalized.');
      await fetchSnapshot(assessmentId, true);
    } catch (err: any) {
      console.error('Failed to close assessment early:', err);
      alert(err.message || 'Failed to close assessment early.');
    } finally {
      setClosingLoading(false);
    }
  };

  // Sign out coordinator safely with session invalidation and Realtime channel teardown
  const handleConfirmSignOut = async () => {
    setIsLogoutModalOpen(false);
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    await signOutCoordinator(navigate);
  };

  // Filtered Participants
  const filteredParticipants = useMemo(() => {
    if (!snapshot?.participants || !Array.isArray(snapshot.participants)) return [];
    return snapshot.participants.filter((p) => {
      const sQuery = searchQuery.trim().toLowerCase();
      const matchesSearch =
        sQuery === '' ||
        (p.student_name || '').toLowerCase().includes(sQuery) ||
        (p.roll_number || '').toLowerCase().includes(sQuery) ||
        ((p as any).college_name || p.college || '').toLowerCase().includes(sQuery);

      const matchesStatus = statusFilter === 'ALL' || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [snapshot?.participants, searchQuery, statusFilter]);

  // 1. Error State with Actionable Retry (Prioritized over loading to prevent masking)
  if (error && !snapshot) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-red-200 p-8 rounded-3xl text-center shadow-lg space-y-5">
          <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center text-[#C8102E] mx-auto border border-red-200">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-black text-[#003366] tracking-tight">Authorization or Connection Error</h2>
            <p className="mt-1 text-xs text-gray-600">{error}</p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => (assessmentId ? fetchSnapshot(assessmentId, true) : window.location.reload())}
              className="flex-1 inline-flex items-center justify-center px-4 py-2.5 bg-[#C8102E] hover:bg-[#a50d26] text-white text-xs font-bold rounded-xl transition shadow-sm cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry Connection
            </button>
            <button
              onClick={() => navigate(isCoordinator ? '/coordinator/select' : '/admin/assessments')}
              className="flex-1 inline-flex items-center justify-center px-4 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-semibold rounded-xl transition shadow-sm cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Return
            </button>
            {isCoordinator && (
              <button
                onClick={handleConfirmSignOut}
                className="flex-1 inline-flex items-center justify-center px-4 py-2.5 border border-red-200 text-[#C8102E] hover:bg-red-50 text-xs font-bold rounded-xl transition shadow-sm cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" /> Sign Out
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. Unassigned State: Coordinator has valid session but no active assessment assigned
  if (isUnassigned && !snapshot) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-gray-200 p-8 rounded-3xl text-center shadow-lg space-y-5">
          <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 mx-auto border border-amber-200">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-black text-[#003366] tracking-tight">No Assessment Assigned</h2>
            <p className="mt-1 text-xs text-gray-600">{unassignedMessage}</p>
          </div>

          {coordSession?.coordinator && (
            <div className="bg-gray-50 p-4 rounded-2xl text-xs text-left space-y-2 border border-gray-100">
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-medium">Coordinator:</span>
                <span className="font-bold text-gray-900">{coordSession.coordinator.display_name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-medium">Username:</span>
                <span className="font-mono font-bold text-gray-700">{coordSession.coordinator.username}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-medium">Account Status:</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  {coordSession.coordinator.status || 'ACTIVE'}
                </span>
              </div>
            </div>
          )}

          <div className="text-[11px] text-gray-500 bg-blue-50/60 p-3 rounded-xl border border-blue-100 text-left">
            Institutional examinations require an administrator to assign your account as the host coordinator. Once assigned, your live monitoring dashboard will activate automatically.
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => navigate('/coordinator/select')}
              className="flex-1 inline-flex items-center justify-center px-4 py-2.5 bg-[#003366] hover:bg-[#002852] text-white text-xs font-bold rounded-xl transition shadow-sm cursor-pointer"
            >
              <LayoutGrid className="w-3.5 h-3.5 mr-1.5" /> All Dashboards
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex-1 inline-flex items-center justify-center px-4 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-semibold rounded-xl transition shadow-sm cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Check Assignment
            </button>
            <button
              onClick={handleConfirmSignOut}
              className="flex-1 inline-flex items-center justify-center px-4 py-2.5 border border-red-200 text-[#C8102E] hover:bg-red-50 text-xs font-bold rounded-xl transition shadow-sm cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" /> Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Loading Screen (KITS-EOS Brand Theme: Clean light surface, KITS Red spinner, NO PURPLE)
  if (loading && !snapshot) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="relative">
          <div className="w-14 h-14 rounded-full border-4 border-gray-200 border-t-[#C8102E] animate-spin" />
          <Radio className="w-6 h-6 text-[#003366] absolute inset-0 m-auto animate-pulse" />
        </div>
        <h2 className="mt-5 text-base font-extrabold text-[#003366] tracking-tight">Initializing Live Host Console...</h2>
        <p className="mt-1 text-xs text-gray-500 font-mono">Connecting to real-time examination telemetry</p>
      </div>
    );
  }

  const assessment = snapshot?.assessment;
  const overview = snapshot?.overview;
  const isClosed = assessment?.status === 'CLOSED';
  const allAttemptsFinalized = overview && overview.started_count > 0 && overview.in_progress_count === 0 && ((overview.submitted_count + overview.terminated_count + overview.expired_count) === overview.started_count);
  const isFinalized = isClosed || Boolean(allAttemptsFinalized);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 selection:bg-[#C8102E] selection:text-white">
      {/* Top Live Broadcast Header (KITS-EOS Brand Theme: White surface, Navy typography, Red accents) */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-gray-200/90 px-4 sm:px-6 py-3.5 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center space-x-3.5">
            <button
              onClick={() => navigate(isCoordinator ? '/coordinator' : `/admin/assessments/${assessmentId}`)}
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition border border-gray-200"
              title="Return"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-red-50 rounded-xl text-[#C8102E] border border-red-200 shadow-sm">
                <Radio className="w-4 h-4 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                  <h1 className="text-base sm:text-lg font-black tracking-tight text-[#003366]">
                    {assessment?.title || 'Live Examination Console'}
                  </h1>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider inline-flex items-center ${
                      assessment?.status === 'PUBLISHED'
                        ? 'bg-red-50 text-[#C8102E] border border-red-200'
                        : assessment?.status === 'CLOSED'
                        ? 'bg-gray-100 text-gray-700 border border-gray-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {assessment?.status === 'PUBLISHED' ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-[#C8102E] mr-1.5 animate-pulse" />
                        LIVE HOST
                      </>
                    ) : (
                      assessment?.status
                    )}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 font-medium">
                  Host: <span className="text-[#003366] font-bold">{assessment?.coordinator_name || 'Administrator'}</span>
                  {assessment?.coordinator_username && (
                    <span className="text-gray-400 font-normal"> (@{assessment.coordinator_username})</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Connection Indicator & Actions */}
          <div className="flex items-center space-x-2.5 justify-end flex-wrap gap-y-2">
            {/* Realtime Connection Badge */}
            <div
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold border transition ${
                connectionState === 'CONNECTED'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : connectionState === 'RECONNECTING'
                  ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}
            >
              {connectionState === 'CONNECTED' ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Realtime Connected ({lastHeartbeat.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})</span>
                </>
              ) : connectionState === 'RECONNECTING' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
                  <span>Reconnecting...</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-red-600" />
                  <span>Offline (Snapshot Mode)</span>
                </>
              )}
            </div>

            <button
              onClick={() => fetchSnapshot(assessmentId, true)}
              className="p-2 text-gray-600 hover:text-[#003366] hover:bg-gray-100 rounded-xl transition border border-gray-200 shadow-sm"
              title="Manual Telemetry Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {isCoordinator && (
              <button
                onClick={() => navigate('/coordinator/select')}
                className="inline-flex items-center px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 shadow-2xs transition cursor-pointer"
                title="All Dashboards & Assignments"
              >
                <LayoutGrid className="w-3.5 h-3.5 mr-1.5 text-[#003366]" />
                <span className="hidden sm:inline">All Dashboards</span>
              </button>
            )}

            {isCoordinator && (
              <button
                onClick={() => setIsLogoutModalOpen(true)}
                className="inline-flex items-center px-3 py-1.5 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-xs font-bold text-[#C8102E] shadow-2xs transition cursor-pointer"
                title="Sign Out of Live Host"
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            )}

            <button
              onClick={() => {
                if (isCoordinator) {
                  navigate(`/coordinator/assessment-report/${assessmentId}`);
                } else {
                  navigate(`/admin/assessments/${assessmentId}/report`);
                }
              }}
              className="inline-flex items-center px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-[#003366] text-xs font-bold rounded-xl transition shadow-2xs space-x-1.5 border border-blue-200 cursor-pointer"
              title="Post-Assessment Analytics & Report"
            >
              <BarChart2 className="w-3.5 h-3.5 text-blue-600" />
              <span>Report & Analytics</span>
            </button>

            {assessment?.status === 'PUBLISHED' && (
              <button
                onClick={() => setIsEarlyCloseModalOpen(true)}
                className="inline-flex items-center px-3.5 py-1.5 bg-[#C8102E] hover:bg-[#a50d26] text-white text-xs font-bold rounded-xl transition shadow-sm space-x-1.5 border border-[#C8102E]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8102E]"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Close Exam Early</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {closeSuccessNotice && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs flex items-center justify-between shadow-sm">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{closeSuccessNotice}</span>
            </div>
            <button onClick={() => setCloseSuccessNotice(null)} className="font-bold underline text-emerald-700 hover:text-emerald-900">
              Dismiss
            </button>
          </div>
        )}

        {/* 6 Statistic Cards (KITS-EOS Brand Theme: White surfaces, subtle gray borders, navy typography, red accents) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {/* Card 1: Eligible */}
          <div className="bg-white border border-gray-200/90 p-4 rounded-2xl shadow-sm">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center">
              <Users className="w-3.5 h-3.5 mr-1 text-gray-400" /> Eligible
            </span>
            <p className="mt-1 text-2xl font-black text-gray-900">{overview?.total_eligible ?? 0}</p>
            <span className="text-[10px] text-gray-500">Active campus accounts</span>
          </div>

          {/* Card 2: Started (Principal KITS Red brand accent) */}
          <div className="bg-white border border-red-200/80 p-4 rounded-2xl shadow-sm">
            <span className="text-[11px] font-bold text-[#C8102E] uppercase tracking-wider flex items-center">
              <PlayCircle className="w-3.5 h-3.5 mr-1 text-[#C8102E]" /> Started
            </span>
            <p className="mt-1 text-2xl font-black text-gray-900">{overview?.started_count ?? 0}</p>
            <span className="text-[10px] text-gray-500">Attempts initiated</span>
          </div>

          {/* Card 3: In Progress (Restrained semantic warning) */}
          <div className="bg-white border border-gray-200/90 p-4 rounded-2xl shadow-sm">
            <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider flex items-center">
              <Hourglass className="w-3.5 h-3.5 mr-1 text-amber-500" /> In Progress
            </span>
            <p className="mt-1 text-2xl font-black text-gray-900">{overview?.in_progress_count ?? 0}</p>
            <span className="text-[10px] text-gray-500">Actively testing</span>
          </div>

          {/* Card 4: Submitted (Restrained semantic success) */}
          <div className="bg-white border border-gray-200/90 p-4 rounded-2xl shadow-sm">
            <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider flex items-center">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-500" /> Submitted
            </span>
            <p className="mt-1 text-2xl font-black text-gray-900">{overview?.submitted_count ?? 0}</p>
            <span className="text-[10px] text-gray-500">Finalized exams</span>
          </div>

          {/* Card 5: Terminated (Restrained semantic danger) */}
          <div className="bg-white border border-gray-200/90 p-4 rounded-2xl shadow-sm">
            <span className="text-[11px] font-bold text-red-600 uppercase tracking-wider flex items-center">
              <ShieldAlert className="w-3.5 h-3.5 mr-1 text-red-500" /> Terminated
            </span>
            <p className="mt-1 text-2xl font-black text-gray-900">
              {(overview?.terminated_count ?? 0) + (overview?.expired_count ?? 0)}
            </p>
            <span className="text-[10px] text-gray-500">
              {overview?.terminated_count ?? 0} strikes, {overview?.expired_count ?? 0} expired
            </span>
          </div>

          {/* Card 6: Completion (Brand Navy/Slate) */}
          <div className="bg-white border border-gray-200/90 p-4 rounded-2xl shadow-sm">
            <span className="text-[11px] font-bold text-[#003366] uppercase tracking-wider flex items-center">
              <Zap className="w-3.5 h-3.5 mr-1 text-[#003366]" /> Completion
            </span>
            <p className="mt-1 text-2xl font-black text-gray-900">{overview?.completion_rate ?? 0}%</p>
            <span className="text-[10px] text-gray-500">{overview?.not_started_count ?? 0} yet to attempt</span>
          </div>
        </div>

        {/* Live Session Telemetry & Status Distribution Visualizer */}
        {overview && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-7">
              <StatusDistributionDonut
                completed={overview.submitted_count ?? 0}
                inProgress={overview.in_progress_count ?? 0}
                notStarted={overview.not_started_count ?? 0}
                terminated={overview.terminated_count ?? 0}
                expired={overview.expired_count ?? 0}
                totalEligible={overview.total_eligible ?? 0}
                title="Candidate Participation & Live Status"
                subtitle="Real-time proportion of submitted, active, and pending examination sessions"
              />
            </div>
            <div className="lg:col-span-5 bg-white border border-gray-200/90 rounded-2xl p-5 shadow-sm flex flex-col justify-between space-y-4">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-sm font-bold text-[#003366] uppercase tracking-wider">Turnout & Completion Metrics</h3>
                  <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                    {overview.completion_rate ?? 0}% Completed
                  </span>
                </div>
                <p className="text-[11px] text-gray-500">Live examination progress against total eligible campus enrollment</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Turnout Rate</span>
                  <span className="text-xl font-black text-gray-900 font-mono">
                    {overview.total_eligible > 0
                      ? `${Math.round(((overview.started_count ?? 0) * 100) / overview.total_eligible)}%`
                      : '0%'}
                  </span>
                  <span className="text-[10px] text-gray-500 block mt-0.5">
                    {overview.started_count ?? 0} of {overview.total_eligible ?? 0} active
                  </span>
                </div>
                <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Submitted</span>
                  <span className="text-xl font-black text-emerald-700 font-mono">
                    {overview.submitted_count ?? 0}
                  </span>
                  <span className="text-[10px] text-gray-500 block mt-0.5">
                    {overview.in_progress_count ?? 0} currently testing
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <div className="flex justify-between text-xs font-semibold mb-1.5">
                  <span className="text-[#003366] font-bold">Overall Session Completion</span>
                  <span className="font-mono text-gray-700 font-bold">{overview.completion_rate ?? 0}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-[#003366] h-2.5 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, overview.completion_rate ?? 0))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Examination Concluded Finalized Banner */}
        {isClosed && (
          <div className="bg-gradient-to-r from-amber-500 via-yellow-600 to-amber-600 text-white p-4 rounded-2xl shadow-sm border border-amber-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-xs">
                <Trophy className="w-5 h-5 text-yellow-100" />
              </div>
              <div>
                <h3 className="text-sm font-black tracking-tight">Examination Concluded — Official Final Results Finalized</h3>
                <p className="text-xs text-amber-100">Ranks and EOS speed bonuses are locked. View the official presentation podium below.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (isCoordinator) {
                    navigate(`/coordinator/assessment-report/${assessmentId}`);
                  } else {
                    navigate(`/admin/assessments/${assessmentId}/report`);
                  }
                }}
                className="px-3.5 py-1.5 bg-white text-amber-900 rounded-xl text-xs font-bold hover:bg-amber-50 transition shadow-sm whitespace-nowrap cursor-pointer"
              >
                View Full Report & Exports
              </button>
              {activeHostTab !== 'SCOREBOARD' && (
                <button
                  onClick={() => setActiveHostTab('SCOREBOARD')}
                  className="px-3.5 py-1.5 bg-amber-800 text-white rounded-xl text-xs font-bold hover:bg-amber-900 transition shadow-sm whitespace-nowrap cursor-pointer"
                >
                  View Final Podium
                </button>
              )}
            </div>
          </div>
        )}

        {/* Navigation Tabs Header (Clean, Flat, Professional with Pill Count Badges) */}
        <div className="flex border-b border-gray-200 space-x-1 sm:space-x-3 overflow-x-auto no-scrollbar bg-white px-2 sm:px-4 rounded-2xl shadow-xs">
          {[
            { id: 'PARTICIPANTS', label: 'Live Participants', count: snapshot?.participants?.length ?? 0, icon: Users },
            { id: 'ACTIVITY', label: 'Activity Feed', count: ((snapshot?.recent_activity ?? (snapshot as any)?.recent_events) || []).length, icon: Radio },
            { id: 'QUESTIONS', label: 'Question Progress', count: snapshot?.question_progress?.length ?? 0, icon: BarChart2 },
            { id: 'SCOREBOARD', label: 'Scoreboard & Podium', count: snapshot?.scoreboard?.length ?? 0, icon: Trophy },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeHostTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveHostTab(tab.id as any)}
                className={`py-3.5 px-3 sm:px-4 text-xs font-bold uppercase tracking-wider transition border-b-2 flex items-center space-x-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8102E] cursor-pointer ${
                  isActive
                    ? 'border-[#C8102E] text-[#C8102E] bg-red-50/40 rounded-t-lg'
                    : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#C8102E]' : 'text-gray-400'}`} />
                <span>{tab.label}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    isActive ? 'bg-[#C8102E]/10 text-[#C8102E]' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: Live Participant Table */}
        {activeHostTab === 'PARTICIPANTS' && (
          <div className="space-y-4">
            {/* Search and Filters */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-gray-200 shadow-sm">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Search student name, roll number, or college..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#C8102E] focus:ring-1 focus:ring-[#C8102E] focus:bg-white transition"
                />
              </div>

              <div className="flex items-center space-x-2">
                <Filter className="w-3.5 h-3.5 text-gray-400 ml-1" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:border-[#C8102E] focus:ring-1 focus:ring-[#C8102E] focus:bg-white transition"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="SUBMITTED">Submitted</option>
                  <option value="TERMINATED">Terminated</option>
                  <option value="EXPIRED">Expired</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider border-b border-gray-200">
                    <tr>
                      <th className="py-3 px-4 font-bold">Candidate</th>
                      <th className="py-3 px-4 font-bold">Status</th>
                      <th className="py-3 px-4 font-bold">Progress</th>
                      <th className="py-3 px-4 font-bold">Elapsed Time</th>
                      <th className="py-3 px-4 font-bold">Proctoring Strikes</th>
                      <th className="py-3 px-4 font-bold text-right">Score / Rank</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(filteredParticipants?.length ?? 0) === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-gray-500 text-xs">
                          No active participants match the filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredParticipants.map((p) => {
                        const mins = Math.floor(p.elapsed_seconds / 60);
                        const secs = p.elapsed_seconds % 60;
                        return (
                          <tr key={p.attempt_id} className="hover:bg-gray-50 transition">
                            <td className="py-3.5 px-4">
                              <p className="font-bold text-gray-900">{p.student_name}</p>
                              <p className="text-[10px] text-gray-500 font-mono">
                                {p.roll_number} • {p.college}
                              </p>
                            </td>

                            <td className="py-3.5 px-4">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  p.status === 'IN_PROGRESS'
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse'
                                    : p.status === 'SUBMITTED'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : p.status === 'TERMINATED'
                                    ? 'bg-red-50 text-[#C8102E] border border-red-200 font-black'
                                    : 'bg-gray-100 text-gray-700 border border-gray-200'
                                }`}
                              >
                                {p.status}
                              </span>
                            </td>

                            <td className="py-3.5 px-4">
                              <div className="flex items-center space-x-2">
                                <span className="font-mono font-bold text-gray-800">
                                  {p.answered_count} / {p.total_questions}
                                </span>
                                <div className="w-16 bg-gray-100 border border-gray-200 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className="bg-[#C8102E] h-1.5 rounded-full transition-all duration-300"
                                    style={{
                                      width: `${p.total_questions > 0 ? (p.answered_count * 100) / p.total_questions : 0}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 font-mono text-gray-600">
                              {mins}m {secs}s
                            </td>

                            <td className="py-3.5 px-4">
                              {p.strike_count > 0 ? (
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    p.strike_count >= 3
                                      ? 'bg-red-50 text-[#C8102E] border border-red-200'
                                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                                  }`}
                                >
                                  <ShieldAlert className="w-3 h-3 mr-1" />
                                  {p.strike_count} / 3 Strikes
                                </span>
                              ) : (
                                <span className="text-gray-400 text-[11px]">0 strikes</span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-right">
                              {p.score !== null && p.score !== undefined ? (
                                <div>
                                  <span className="font-bold text-gray-900 text-sm font-mono">{p.question_score ?? p.score} pts</span>
                                  {(p.eos_points != null ? p.eos_points : p.speed_bonus_score) != null &&
                                    (p.eos_points ?? p.speed_bonus_score ?? 0) > 0 && (
                                      <span className="text-[10px] text-amber-700 font-mono font-semibold block">
                                        +{p.eos_points ?? p.speed_bonus_score} EOS points
                                      </span>
                                    )}
                                  {p.percentage !== null && (
                                    <p className="text-[10px] text-gray-500">
                                      {p.percentage}% {p.is_passed ? '• Passed' : '• Below threshold'}
                                    </p>
                                  )}
                                  {p.rank && (
                                    <span className="text-[10px] font-bold text-[#C8102E] uppercase block">
                                      Official Rank #{p.rank}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[11px] text-gray-400 italic">In progress</span>
                              )}
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

        {/* TAB 2: Activity Feed */}
        {activeHostTab === 'ACTIVITY' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#003366]">
                Real-Time Event Stream (Chronological)
              </h3>
              <span className="text-[11px] text-gray-500">Auto-updates on participant actions</span>
            </div>

            <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {(() => {
                const activityList: AssessmentLiveEvent[] =
                  (snapshot?.recent_activity ?? (snapshot as any)?.recent_events) || [];
                return activityList.length === 0 ? (
                  <p className="py-12 text-center text-gray-400 text-xs">No activity events recorded yet.</p>
                ) : (
                  activityList.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-start space-x-3 text-xs"
                  >
                    <div className="mt-0.5">
                      {ev.event_type === 'ATTEMPT_STARTED' && <PlayCircle className="w-4 h-4 text-[#C8102E]" />}
                      {ev.event_type === 'ANSWER_SAVED' && <Check className="w-4 h-4 text-emerald-600" />}
                      {ev.event_type === 'ATTEMPT_SUBMITTED' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                      {ev.event_type === 'STRIKE_RECORDED' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                      {ev.event_type === 'ATTEMPT_TERMINATED' && <ShieldAlert className="w-4 h-4 text-[#C8102E]" />}
                      {ev.event_type === 'ATTEMPT_RESUMED' && <RefreshCw className="w-4 h-4 text-blue-600" />}
                      {ev.event_type === 'ASSESSMENT_CLOSED' && <Lock className="w-4 h-4 text-[#C8102E]" />}
                      {ev.event_type === 'ASSESSMENT_REOPENED' && <Unlock className="w-4 h-4 text-emerald-600" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-900">{ev.student_name}</span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {new Date(ev.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-600 mt-0.5">{ev.question_context || ev.event_type}</p>
                    </div>
                  </div>
                ))
              );
            })()}
            </div>
          </div>
        )}

        {/* TAB 3: Question Progress */}
        {activeHostTab === 'QUESTIONS' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(snapshot?.question_progress || []).map((qp, idx) => (
              <div
                key={qp.question_id}
                className="bg-white border border-gray-200 p-5 rounded-2xl shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-[#C8102E] uppercase tracking-wider">
                      Question {idx + 1} • {qp.question_type} ({qp.points} pts)
                    </span>
                    <p className="text-xs font-semibold text-gray-900 mt-1 line-clamp-2">{qp.question_text}</p>
                  </div>
                </div>

                <div className="space-y-1.5 pt-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500 font-medium">Responses Logged</span>
                    <span className="font-bold text-gray-800">
                      {qp.answered_count} of {qp.total_attempts} candidates ({qp.participation_pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 border border-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-[#C8102E] h-2 rounded-full transition-all duration-500"
                      style={{ width: `${qp.participation_pct}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 4: Live Scoreboard & Podium */}
        {activeHostTab === 'SCOREBOARD' && (
          <div className="space-y-6">
            <KahootPodium
              entries={snapshot?.scoreboard ?? []}
              isFinalized={isFinalized}
            />
          </div>
        )}
      </main>

      {/* Early Close Modal (KITS-EOS Brand Theme: White card, KITS Red destructive action) */}
      {isEarlyCloseModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-red-200 space-y-4">
            <div className="flex items-center space-x-3 text-[#C8102E]">
              <div className="p-2.5 bg-red-50 rounded-xl border border-red-200">
                <Lock className="w-5 h-5 text-[#C8102E]" />
              </div>
              <h3 className="text-base font-bold text-gray-900">Close Examination Early</h3>
            </div>

            <p className="text-xs text-gray-600">
              Closing early will immediately clamp the assessment window. Active candidates will have their deadlines elapsed,
              and lingering attempts will be finalized automatically.
            </p>

            <form onSubmit={handleEarlyCloseSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-1">
                  Reason for Early Closure (Audited)
                </label>
                <textarea
                  required
                  rows={3}
                  value={earlyCloseReason}
                  onChange={(e) => setEarlyCloseReason(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#C8102E] focus:ring-1 focus:ring-[#C8102E] focus:bg-white transition"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEarlyCloseModalOpen(false)}
                  disabled={closingLoading}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-900 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={closingLoading}
                  className="px-4 py-2 bg-[#C8102E] hover:bg-[#a50d26] text-white text-xs font-bold rounded-xl transition shadow-sm flex items-center space-x-1.5 border border-[#C8102E]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8102E]"
                >
                  {closingLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Confirm Early Closure</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Logout Confirmation Modal */}
      <LogoutConfirmationModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={handleConfirmSignOut}
      />
    </div>
  );
}

export default AssessmentLiveHost;
