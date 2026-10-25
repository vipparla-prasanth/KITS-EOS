import { useState, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { 
  Layers, 
  Radio, 
  LogOut, 
  RefreshCw, 
  Calendar, 
  MapPin, 
  Users, 
  Clock, 
  AlertTriangle, 
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  BarChart3,
} from 'lucide-react';
import type { CoordinatorAccessValidation } from '../../components/CoordinatorProtectedRoute';
import { signOutCoordinator } from '../../utils/coordinatorSession';
import { LogoutConfirmationModal } from '../../components/ui/LogoutConfirmationModal';

export function CoordinatorAssignmentSelect() {
  const navigate = useNavigate();
  const validation = useOutletContext<CoordinatorAccessValidation | null>();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  // Extract coordinator profile
  const coordinator = validation?.coordinator;
  const coordinatorName = coordinator?.display_name || coordinator?.username || 'Coordinator';
  const username = coordinator?.username || '';
  const coordinatorType = coordinator?.coordinator_type || 'COORDINATOR';

  // Extract Event Assignments
  const eventAssignments = useMemo(() => {
    return validation?.assignments || [];
  }, [validation?.assignments]);

  // Extract Assessment Assignments (supporting both assigned_assessments array and legacy assigned_assessment single object)
  const assessmentAssignments = useMemo(() => {
    if (validation?.assigned_assessments && Array.isArray(validation.assigned_assessments) && validation.assigned_assessments.length > 0) {
      return validation.assigned_assessments;
    }
    if (validation?.assigned_assessment?.id) {
      return [validation.assigned_assessment];
    }
    if ((coordinator as any)?.assigned_assessment?.id) {
      return [(coordinator as any).assigned_assessment];
    }
    return [];
  }, [validation?.assigned_assessments, validation?.assigned_assessment, coordinator]);

  const hasEventDuties = eventAssignments.length > 0;
  const hasAssessmentDuties = assessmentAssignments.length > 0 || coordinatorType === 'ASSESSMENT_COORDINATOR';
  const hasAnyAssignments = hasEventDuties || hasAssessmentDuties;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshMessage(null);
    try {
      // Reload current route so CoordinatorProtectedRoute re-verifies session and assignments
      window.location.reload();
    } catch {
      setIsRefreshing(false);
      setRefreshMessage('Failed to refresh assignments. Please try again.');
    }
  };

  const handleSignOutConfirm = async () => {
    setIsLogoutModalOpen(false);
    await signOutCoordinator(navigate);
  };

  const handleOpenEvent = (_subEventId?: string) => {
    navigate('/coordinator');
  };

  const handleOpenAssessment = (assessmentId?: string) => {
    if (assessmentId) {
      navigate(`/coordinator/assessment-host/${assessmentId}`);
    } else {
      navigate('/coordinator/assessment-host');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col">
      {/* Top Brand Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-200/90 px-4 sm:px-6 lg:px-8 py-3.5 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          {/* Logo & Brand Identity */}
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-white shadow-2xs border border-gray-200 p-1 flex items-center justify-center overflow-hidden">
              <img
                src="/college_logo.png"
                alt="KITS Logo"
                className="object-contain w-full h-full"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <h1 className="text-sm sm:text-base font-black tracking-tight text-[#003366]">
                  <span className="text-[#C8102E]">KITS</span>-EOS
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-[#003366] border border-blue-200">
                  Coordinator Central
                </span>
              </div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider truncate">
                Assignment & Dashboard Selection
              </p>
            </div>
          </div>

          {/* Coordinator Profile & Actions */}
          <div className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
            {/* Refresh Action */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 text-gray-600 hover:text-[#003366] hover:bg-gray-100 rounded-xl transition border border-gray-200 shadow-2xs cursor-pointer"
              title="Refresh Assignments"
              aria-label="Refresh Assignments"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#C8102E]' : ''}`} />
            </button>

            {/* User Meta Card (Desktop) */}
            <div className="hidden md:flex flex-col text-right">
              <span className="text-xs font-bold text-gray-900 truncate max-w-[200px]" title={coordinatorName}>
                {coordinatorName}
              </span>
              <span className="text-[10px] font-mono text-gray-500">
                @{username} • <span className="font-semibold text-gray-700">{coordinatorType}</span>
              </span>
            </div>

            {/* Prominent Sign Out Button */}
            <button
              onClick={() => setIsLogoutModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 text-gray-700 hover:text-[#C8102E] text-xs font-bold transition shadow-2xs cursor-pointer"
              title="Sign Out of Institutional Portal"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Selection Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex-1 w-full space-y-8">
        {/* Welcome & Context Banner */}
        <div className="bg-gradient-to-r from-[#003366] to-[#0d477f] text-white rounded-3xl p-6 sm:p-8 shadow-sm relative overflow-hidden border border-[#002244]">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-xs text-white/90 text-[10px] sm:text-xs font-black uppercase tracking-wider border border-white/10">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Verified Coordinator Authentication</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">
                Welcome, {coordinatorName}
              </h2>
              <p className="text-xs sm:text-sm text-blue-100/90 leading-relaxed font-normal">
                Select an authorized operational dashboard below. Your institutional credentials provide role-scoped access to assigned Event Operations and Examination Telemetry.
              </p>
            </div>

            {/* Quick Stats Pill */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/15 flex items-center gap-4 shrink-0">
              <div className="text-center px-2">
                <div className="text-xl sm:text-2xl font-black text-white">{eventAssignments.length}</div>
                <div className="text-[10px] font-bold text-blue-200 uppercase tracking-wider">Sub-Events</div>
              </div>
              <div className="h-8 w-px bg-white/20" />
              <div className="text-center px-2">
                <div className="text-xl sm:text-2xl font-black text-white">{assessmentAssignments.length}</div>
                <div className="text-[10px] font-bold text-blue-200 uppercase tracking-wider">Exams</div>
              </div>
            </div>
          </div>

          {/* Decorative Background Shapes */}
          <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-white/5 rounded-full pointer-events-none blur-xl" />
        </div>

        {refreshMessage && (
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
            <span>{refreshMessage}</span>
            <button onClick={() => setRefreshMessage(null)} className="font-bold underline text-amber-800">
              Dismiss
            </button>
          </div>
        )}

        {/* 1. Event Operations Dashboards */}
        {hasEventDuties && (
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-200/80 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-red-50 text-[#C8102E] border border-red-100">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
                    Event Operations
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-50 text-[#C8102E] border border-red-200">
                      {eventAssignments.length} Assigned
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500">
                    Participant check-in, attendance verification, roster management, and on-spot payment confirmations.
                  </p>
                </div>
              </div>

              {eventAssignments.length > 1 && (
                <button
                  onClick={() => handleOpenEvent()}
                  className="hidden sm:inline-flex items-center text-xs font-bold text-[#003366] hover:text-[#C8102E] transition"
                >
                  Open Operations Hub <ChevronRight className="w-4 h-4 ml-0.5" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {eventAssignments.map((assignment: any) => {
                const subEvent = assignment.sub_events;
                if (!subEvent) return null;

                const parentEventName = subEvent.event_name || 'Institutional Event';
                const status = subEvent.effective_status || subEvent.status || 'ACTIVE';
                const isOngoing = status === 'ONGOING' || status === 'ACTIVE';

                return (
                  <div
                    key={assignment.id}
                    className="bg-white rounded-2xl border border-gray-200/90 p-5 shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between space-y-4 hover:border-red-200 group"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 group-hover:text-[#C8102E] transition">
                          {parentEventName}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            isOngoing
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : status === 'UPCOMING'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}
                        >
                          {isOngoing && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />}
                          {status}
                        </span>
                      </div>

                      <h4 className="text-base font-black text-gray-900 group-hover:text-[#003366] transition leading-snug">
                        {subEvent.name}
                      </h4>

                      <div className="space-y-1.5 text-xs text-gray-500 pt-1">
                        {subEvent.venue && (
                          <div className="flex items-center space-x-2">
                            <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span className="truncate">{subEvent.venue}</span>
                          </div>
                        )}
                        {subEvent.start_time && (
                          <div className="flex items-center space-x-2">
                            <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span>{new Date(subEvent.start_time).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          </div>
                        )}
                        <div className="flex items-center space-x-2">
                          <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span>Participation: <strong className="text-gray-700">{subEvent.participation_type || 'SOLO'}</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-gray-100">
                      <button
                        onClick={() => handleOpenEvent(assignment.sub_event_id)}
                        className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-gray-900 hover:bg-[#C8102E] text-white text-xs font-bold transition-colors shadow-2xs group-hover:shadow cursor-pointer"
                      >
                        <span>Open Event Dashboard</span>
                        <ChevronRight className="w-4 h-4 ml-1.5 group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 2. Assessment Live Host Consoles */}
        {hasAssessmentDuties && (
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-200/80 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-blue-50 text-[#003366] border border-blue-100">
                  <Radio className="w-5 h-5 animate-pulse text-[#003366]" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
                    Assessment Live Host
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-[#003366] border border-blue-200">
                      {assessmentAssignments.length > 0 ? `${assessmentAssignments.length} Assigned` : 'Host Mode'}
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500">
                    Real-time candidate telemetry, live leaderboard, proctoring violations, and early exam closure.
                  </p>
                </div>
              </div>
            </div>

            {assessmentAssignments.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {assessmentAssignments.map((asm: any) => {
                  const isPublished = asm.status === 'PUBLISHED';
                  const isClosed = asm.status === 'CLOSED';

                  return (
                    <div
                      key={asm.id}
                      className="bg-white rounded-2xl border border-gray-200/90 p-5 shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between space-y-4 hover:border-blue-300 group"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 group-hover:text-[#003366] transition">
                            Academic Assessment
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              isPublished
                                ? 'bg-red-50 text-[#C8102E] border border-red-200'
                                : isClosed
                                ? 'bg-gray-100 text-gray-600 border border-gray-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {isPublished ? (
                              <>
                                <span className="w-1.5 h-1.5 rounded-full bg-[#C8102E] mr-1 animate-pulse" />
                                LIVE HOST
                              </>
                            ) : (
                              asm.status || 'SCHEDULED'
                            )}
                          </span>
                        </div>

                        <h4 className="text-base font-black text-gray-900 group-hover:text-[#003366] transition leading-snug">
                          {asm.title}
                        </h4>

                        <div className="space-y-1.5 text-xs text-gray-500 pt-1">
                          {asm.duration_minutes && (
                            <div className="flex items-center space-x-2">
                              <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span>Duration: <strong className="text-gray-700">{asm.duration_minutes} minutes</strong></span>
                            </div>
                          )}
                          {asm.start_time && (
                            <div className="flex items-center space-x-2">
                              <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span>{new Date(asm.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          )}
                          <div className="flex items-center space-x-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span>Proctoring: <strong className="text-emerald-700">Strict Multi-tab & Violation Shield</strong></span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-gray-100 flex items-center gap-2">
                        <button
                          onClick={() => handleOpenAssessment(asm.id)}
                          className="flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-[#003366] hover:bg-[#002244] text-white text-xs font-bold transition-colors shadow-2xs group-hover:shadow cursor-pointer"
                        >
                          <span>{asm.status === 'CLOSED' ? 'Live Console' : 'Open Live Host'}</span>
                          <ChevronRight className="w-4 h-4 ml-1.5 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                        <button
                          onClick={() => navigate(`/coordinator/assessment-report/${asm.id}`)}
                          className="inline-flex items-center justify-center px-3 py-2.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[#003366] text-xs font-bold transition-colors shadow-2xs cursor-pointer"
                          title="View Assessment Analytics & Performance Report"
                        >
                          <BarChart3 className="w-4 h-4" />
                          <span className="ml-1.5">Report</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Dedicated Assessment Coordinator with no active examination yet */
              <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center space-y-4 shadow-2xs">
                <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 mx-auto border border-amber-200">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div className="max-w-md mx-auto">
                  <h4 className="text-sm font-bold text-gray-900">No Specific Examination Assigned</h4>
                  <p className="text-xs text-gray-500 mt-1">
                    Your account is registered as an Assessment Coordinator. An administrator must allocate a published examination before live telemetry becomes available.
                  </p>
                </div>
                <div className="pt-2 flex justify-center gap-3">
                  <button
                    onClick={() => handleOpenAssessment()}
                    className="inline-flex items-center px-4 py-2 bg-[#003366] hover:bg-[#002244] text-white text-xs font-bold rounded-xl transition shadow-2xs cursor-pointer"
                  >
                    <Radio className="w-3.5 h-3.5 mr-1.5" />
                    Open Host Telemetry Console
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 3. Empty State: No active assignments across both event and assessment */}
        {!hasAnyAssignments && (
          <div className="bg-white rounded-3xl border border-gray-200 p-8 sm:p-12 text-center max-w-lg mx-auto shadow-sm space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto shadow-2xs">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-xl font-black text-gray-900 tracking-tight">
                No Active Assignments Found
              </h3>
              <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                Your coordinator account (<span className="font-mono font-bold text-gray-800">@{username}</span>) is active and authenticated, but you are not currently assigned to any active events or examinations.
              </p>
            </div>

            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-xs text-left space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-500">Coordinator Name:</span>
                <span className="font-bold text-gray-900">{coordinatorName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Account Role:</span>
                <span className="font-bold text-[#003366]">{coordinatorType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Institutional Status:</span>
                <span className="font-bold text-emerald-700">ACTIVE</span>
              </div>
            </div>

            <div className="text-[11px] text-gray-500 bg-amber-50/70 p-3.5 rounded-xl border border-amber-100 text-left leading-relaxed">
              Assignments update dynamically. If an administrator recently allocated an event or exam to your account, click <strong>Refresh Assignments</strong> to load it immediately.
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex-1 inline-flex items-center justify-center px-4 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-bold rounded-xl transition shadow-2xs cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh Assignments
              </button>
              <button
                onClick={() => setIsLogoutModalOpen(true)}
                className="flex-1 inline-flex items-center justify-center px-4 py-2.5 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl transition shadow-2xs cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                Sign Out
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Confirmation Modal */}
      <LogoutConfirmationModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={handleSignOutConfirm}
      />
    </div>
  );
}
