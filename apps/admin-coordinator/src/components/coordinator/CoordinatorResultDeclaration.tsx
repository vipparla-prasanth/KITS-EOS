import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { getCoordinatorSessionToken } from '../../utils/coordinatorSession';
import {
  Trophy,
  Medal,
  Award,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Send,
  Users,
  X,
  ShieldCheck,
  Building2,
  HelpCircle,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Eye,
  Lock,
  Unlock,
  GraduationCap,
  Sparkles,
  UserCheck,
  RotateCcw,
} from 'lucide-react';

export interface EligibleCandidate {
  teamId: string;
  teamName: string;
  isTeam: boolean;
  leaderName: string;
  leaderCollege: string;
  membersCount: number;
  attendedCount: number;
}

interface MemberInfo {
  id: string;
  user_id?: string | null;
  name: string;
  roll_number?: string | null;
  college?: string | null;
  department?: string | null;
  year?: number | null;
  is_leader: boolean;
  attendance_status: 'PRESENT' | 'ABSENT';
  check_in_time?: string | null;
  achievement_status: 'ISSUED' | 'REVOKED' | 'NOT_APPLICABLE';
  achievement_type?: string | null;
  achievement_code?: string | null;
  achievement_display: string;
  participation_status: 'UNLOCKED' | 'LOCKED' | 'NOT_GENERATED';
  participation_code?: string | null;
  participation_display: string;
}

interface CandidateInfo {
  team_id: string;
  registration_id: string;
  team_name?: string | null;
  display_name: string;
  is_team: boolean;
  result_rank: 'WINNER' | 'RUNNER_UP' | 'THIRD_PLACE' | 'PARTICIPANT';
  result_rank_display: string;
  rank_order: number;
  total_members: number;
  attended_members: number;
  achievement_certs_count: number;
  participation_unlocked_count: number;
  participation_locked_count: number;
  colleges: string[];
  departments: string[];
  leader: {
    name: string;
    roll_number?: string | null;
    college?: string | null;
    department?: string | null;
    year?: number | null;
  };
  members: MemberInfo[];
}

interface SummaryCounts {
  total_eligible_candidates: number;
  total_eligible_members: number;
  winners_count: number;
  runners_count: number;
  third_count: number;
  achievement_certs_count: number;
  participation_unlocked_count: number;
  participation_locked_count: number;
}

interface CoordinatorResultDeclarationProps {
  subEventId: string;
  subEventName: string;
  eventName: string;
  categoryName?: string;
  participationType: string;
  eligibleCandidates: EligibleCandidate[];
  onStatusChange?: (status: string) => void;
}

export function CoordinatorResultDeclaration({
  subEventId,
  subEventName,
  eventName,
  categoryName,
  participationType,
  eligibleCandidates,
  onStatusChange,
}: CoordinatorResultDeclarationProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [resultData, setResultData] = useState<any | null>(null);

  // Form Selections (for unsubmitted / rejected workflow)
  const [selectedWinnerId, setSelectedWinnerId] = useState<string>('');
  const [selectedRunnerId, setSelectedRunnerId] = useState<string>('');
  const [selectedThirdId, setSelectedThirdId] = useState<string>('');

  // Confirmation Modal
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Search & Filter state for All Eligible Participants
  const [searchQuery, setSearchQuery] = useState('');
  const [rankFilter, setRankFilter] = useState<'ALL' | 'WINNER' | 'RUNNER_UP' | 'THIRD_PLACE' | 'PARTICIPANT'>('ALL');
  const [certFilter, setCertFilter] = useState<'ALL' | 'ACHIEVEMENT_ISSUED' | 'PARTICIPATION_UNLOCKED' | 'PARTICIPATION_LOCKED'>('ALL');

  // Inline team expansion state
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(new Set());
  const [expandedPodiumIds, setExpandedPodiumIds] = useState<Set<string>>(new Set());

  // Details Drawer / Modal state
  const [selectedCandidateForDetails, setSelectedCandidateForDetails] = useState<CandidateInfo | null>(null);

  const fetchStatus = async () => {
    const token = getCoordinatorSessionToken();
    if (!subEventId || !token) return;

    try {
      setIsLoading(true);
      setError(null);

      const { data, error: err } = await supabase.rpc('get_coordinator_sub_event_result_status', {
        p_token: token,
        p_sub_event_id: subEventId,
      });

      if (err) throw err;

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to load result status.');
      }

      setResultData(data);
      if (onStatusChange) {
        onStatusChange(data.status);
      }

      // If rejected or not submitted, pre-fill if existing values exist
      if (data.status === 'REJECTED' || data.status === 'NOT_SUBMITTED') {
        if (data.winner_team_id) setSelectedWinnerId(data.winner_team_id);
        if (data.runner_team_id) setSelectedRunnerId(data.runner_team_id);
        if (data.third_team_id) setSelectedThirdId(data.third_team_id);
      }
    } catch (err: any) {
      console.error('Fetch result declaration status error:', err);
      setError(err.message || 'Failed to load result declaration status.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [subEventId]);

  // Toggle inline expansion for table teams
  const toggleTeamExpansion = (teamId: string) => {
    setExpandedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  // Toggle inline expansion for podium cards
  const togglePodiumExpansion = (teamId: string) => {
    setExpandedPodiumIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  // Summary counts
  const summary: SummaryCounts = useMemo(() => {
    if (resultData?.summary_counts && Object.keys(resultData.summary_counts).length > 0) {
      return resultData.summary_counts;
    }
    const candidates: CandidateInfo[] = resultData?.eligible_participants || [];
    const win = candidates.filter((c) => c.result_rank === 'WINNER').length;
    const run = candidates.filter((c) => c.result_rank === 'RUNNER_UP').length;
    const third = candidates.filter((c) => c.result_rank === 'THIRD_PLACE').length;
    const totalMembers = candidates.reduce((acc, c) => acc + (c.attended_members || 1), 0);
    const achCount = candidates.reduce((acc, c) => acc + (c.achievement_certs_count || 0), 0);
    const partUnlocked = candidates.reduce((acc, c) => acc + (c.participation_unlocked_count || 0), 0);
    const partLocked = candidates.reduce((acc, c) => acc + (c.participation_locked_count || 0), 0);

    return {
      total_eligible_candidates: candidates.length || resultData?.eligible_count || eligibleCandidates.length,
      total_eligible_members: totalMembers || resultData?.eligible_count || eligibleCandidates.length,
      winners_count: win,
      runners_count: run,
      third_count: third,
      achievement_certs_count: achCount,
      participation_unlocked_count: partUnlocked,
      participation_locked_count: partLocked,
    };
  }, [resultData, eligibleCandidates.length]);

  // Filtered candidates for the table
  const filteredCandidates = useMemo(() => {
    const list: CandidateInfo[] = resultData?.eligible_participants || [];
    return list.filter((c) => {
      // 1. Rank filter
      if (rankFilter !== 'ALL' && c.result_rank !== rankFilter) {
        return false;
      }

      // 2. Certificate filter
      if (certFilter === 'ACHIEVEMENT_ISSUED' && c.achievement_certs_count === 0) {
        return false;
      }
      if (certFilter === 'PARTICIPATION_UNLOCKED' && c.participation_unlocked_count === 0) {
        return false;
      }
      if (certFilter === 'PARTICIPATION_LOCKED' && c.participation_locked_count === 0) {
        return false;
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTeam = c.team_name?.toLowerCase().includes(q) || c.display_name?.toLowerCase().includes(q);
        const matchLeader =
          c.leader?.name?.toLowerCase().includes(q) ||
          c.leader?.roll_number?.toLowerCase().includes(q) ||
          c.leader?.college?.toLowerCase().includes(q) ||
          c.leader?.department?.toLowerCase().includes(q);
        const matchColleges = Array.isArray(c.colleges) && c.colleges.some((col: string) => col.toLowerCase().includes(q));
        const matchMembers =
          Array.isArray(c.members) &&
          c.members.some(
            (m: MemberInfo) =>
              m.name?.toLowerCase().includes(q) ||
              m.roll_number?.toLowerCase().includes(q) ||
              m.college?.toLowerCase().includes(q) ||
              m.department?.toLowerCase().includes(q)
          );

        if (!matchTeam && !matchLeader && !matchColleges && !matchMembers) {
          return false;
        }
      }

      return true;
    });
  }, [resultData?.eligible_participants, rankFilter, certFilter, searchQuery]);

  // Derived candidate selections for form
  const winnerCandidate = eligibleCandidates.find((c) => c.teamId === selectedWinnerId);
  const runnerCandidate = eligibleCandidates.find((c) => c.teamId === selectedRunnerId);
  const thirdCandidate = eligibleCandidates.find((c) => c.teamId === selectedThirdId);

  const availableRunners = eligibleCandidates.filter((c) => c.teamId !== selectedWinnerId);
  const availableThirds = eligibleCandidates.filter(
    (c) => c.teamId !== selectedWinnerId && c.teamId !== selectedRunnerId
  );

  const isSingleCompetitor = eligibleCandidates.length === 1;
  const isTeamEvent = participationType === 'TEAM' || participationType === 'BOTH';

  const handleOpenConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!selectedWinnerId) {
      setSubmitError('Please select a Winner.');
      return;
    }

    if (!isSingleCompetitor && eligibleCandidates.length >= 2 && !selectedRunnerId) {
      setSubmitError('Please select a Runner-Up for competitive sub-events.');
      return;
    }

    if (selectedWinnerId === selectedRunnerId) {
      setSubmitError('Winner and Runner-Up cannot be the same participant or team.');
      return;
    }

    setIsConfirmModalOpen(true);
  };

  const handleExecuteSubmit = async () => {
    const token = getCoordinatorSessionToken();
    if (!subEventId || !token) return;

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      const { data, error: rpcErr } = await supabase.rpc('coordinator_submit_sub_event_result', {
        p_token: token,
        p_sub_event_id: subEventId,
        p_winner_team_id: selectedWinnerId,
        p_runner_team_id: selectedRunnerId || null,
        p_third_team_id: selectedThirdId || null,
      });

      if (rpcErr) throw rpcErr;

      if (!data?.success) {
        throw new Error(data?.error || data?.message || 'Failed to submit result.');
      }

      setSuccessMessage('Result declared and submitted for Administrator review and approval!');
      setIsConfirmModalOpen(false);
      await fetchStatus();
    } catch (err: any) {
      console.error('Coordinator submit result error:', err);
      setSubmitError(err.message || 'Failed to submit result declaration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white p-12 rounded-3xl border border-gray-200 text-center space-y-3 shadow-2xs">
        <RefreshCw className="h-8 w-8 animate-spin mx-auto text-kits-red" />
        <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
          Loading Result Declaration Status...
        </p>
      </div>
    );
  }

  const currentStatus = resultData?.status || 'NOT_SUBMITTED';
  const hasEligible = eligibleCandidates.length > 0 || (resultData?.eligible_count || 0) > 0;
  const isApproved = (currentStatus === 'APPROVED' || resultData?.results_published === true) && hasEligible;
  const isEdited = (resultData?.result_edit_count || 0) >= 1;

  // Podium objects
  const winnerCard: CandidateInfo | null = resultData?.podium?.winner || null;
  const runnerCard: CandidateInfo | null = resultData?.podium?.runner || null;
  const thirdCard: CandidateInfo | null = resultData?.podium?.third || null;

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* =====================================================================
          SECTION 2: RESULT SUMMARY — TOP SECTION (COMPACT SUMMARY HEADER)
          ===================================================================== */}
      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-kits-red" />
            <h3 className="text-sm font-black tracking-tight text-gray-900">
              RESULT DECLARATION WORKFLOW
            </h3>
          </div>

          {/* Status Badge */}
          {isApproved ? (
            isEdited ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-blue-100 text-blue-900 border border-blue-300">
                <CheckCircle2 className="h-3.5 w-3.5 text-blue-700" />
                RESULT CORRECTED / PUBLISHED
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                APPROVED / PUBLISHED
              </span>
            )
          ) : currentStatus === 'PENDING_ADMIN_APPROVAL' ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">
              <Clock className="h-3.5 w-3.5 text-amber-600" />
              PENDING ADMIN APPROVAL
            </span>
          ) : currentStatus === 'REJECTED' ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-red-100 text-red-900 border border-red-300">
              <AlertTriangle className="h-3.5 w-3.5 text-kits-red" />
              REJECTED BY ADMIN
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700 border border-gray-200">
              NOT SUBMITTED
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">
              EVENT
            </span>
            <span className="font-bold text-gray-900">{eventName}</span>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">
              CATEGORY
            </span>
            <span className="font-bold text-gray-900">{categoryName || 'GENERAL TRACK'}</span>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">
              SUB-EVENT
            </span>
            <span className="font-black text-kits-red">{subEventName}</span>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">
              TYPE
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-gray-100 text-gray-700 border border-gray-200 uppercase inline-block">
              {participationType}
            </span>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">
              ELIGIBLE ATTENDED
            </span>
            <span className="font-black text-gray-900">
              {summary.total_eligible_candidates} {isTeamEvent ? 'TEAMS' : 'CANDIDATES'}
              {isTeamEvent && summary.total_eligible_members > summary.total_eligible_candidates && (
                <span className="text-[10px] text-gray-500 font-normal block">
                  ({summary.total_eligible_members} attendees)
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* =====================================================================
          STATE 1: APPROVED / PUBLISHED VIEW
          ===================================================================== */}
      {isApproved && (
        <div className="space-y-6">
          {/* Section 11: Published Result Banner */}
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-3xl p-6 sm:p-7 space-y-4 shadow-2xs">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-emerald-100 text-emerald-700 rounded-2xl shrink-0">
                <Trophy className="h-6 w-6" />
              </div>
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-base font-black text-emerald-950 tracking-tight">
                    {isEdited
                      ? 'RESULTS OFFICIALLY CORRECTED & PUBLISHED'
                      : 'RESULTS OFFICIALLY APPROVED & PUBLISHED'}
                  </h4>
                  {isEdited && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-200 uppercase">
                      Admin Corrected (Audit Locked)
                    </span>
                  )}
                </div>
                <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                  The results for this sub-event have been verified and approved by system administrators.
                  Official achievement certificates have been automatically generated for eligible attended winners and runners.
                  Results and certificates are read-only for Coordinators.
                </p>
                <div className="flex items-center gap-4 text-[11px] text-emerald-800 font-medium flex-wrap pt-1">
                  {resultData.published_at && (
                    <span>
                      <strong>Published on:</strong> {formatDateTime12h(resultData.published_at)}
                    </span>
                  )}
                  {isEdited && resultData.result_edited_at && (
                    <span>
                      <strong>Corrected on:</strong> {formatDateTime12h(resultData.result_edited_at)}
                    </span>
                  )}
                  <span>
                    <strong>Approved by:</strong> Administrator
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* =================================================================
              SECTION 3: PODIUM RESULT SECTION (OFFICIAL PODIUM)
              ================================================================= */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-gray-900 tracking-tight flex items-center gap-2">
                  <Award className="h-4 w-4 text-kits-red" />
                  <span>OFFICIAL RESULT</span>
                </h3>
                <p className="text-xs text-gray-500 font-medium">
                  Official podium positions verified for {subEventName}.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* 🥇 WINNER CARD */}
              <div className="bg-white rounded-3xl border-2 border-emerald-500 p-6 shadow-sm space-y-4 relative flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-500 text-white flex items-center gap-1.5 shadow-2xs">
                      <span>🥇</span> WINNER (1ST)
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 uppercase">
                      Official Result
                    </span>
                  </div>

                  <div>
                    <h4 className="text-lg font-black text-gray-900 leading-snug">
                      {winnerCard?.display_name || resultData.winner_name || 'Winning Participant'}
                    </h4>
                    {winnerCard?.registration_id && (
                      <p className="text-[10px] font-mono text-gray-400 mt-0.5">
                        REG ID: {winnerCard.registration_id.slice(0, 8).toUpperCase()}
                      </p>
                    )}
                  </div>

                  {/* Team / Leader / Solo Info */}
                  {winnerCard ? (
                    winnerCard.is_team ? (
                      <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 text-xs space-y-2">
                        <div className="flex items-center justify-between text-gray-700">
                          <span className="font-bold flex items-center gap-1">
                            <Users className="h-3.5 w-3.5 text-gray-400" />
                            Team Leader:
                          </span>
                          <span className="font-black text-gray-900">{winnerCard.leader.name}</span>
                        </div>
                        {winnerCard.leader.roll_number && (
                          <div className="flex items-center justify-between text-[11px] text-gray-500">
                            <span>Roll No:</span>
                            <span className="font-mono font-bold text-gray-700">
                              {winnerCard.leader.roll_number}
                            </span>
                          </div>
                        )}
                        <div className="text-[11px] text-gray-600 flex items-center gap-1 truncate">
                          <Building2 className="h-3 w-3 shrink-0 text-gray-400" />
                          <span className="truncate">{winnerCard.leader.college}</span>
                        </div>
                        <div className="pt-1 border-t border-gray-200/60 flex items-center justify-between text-[11px] font-bold text-gray-500">
                          <span>Team Size:</span>
                          <span className="text-gray-900">
                            {winnerCard.total_members} Members ({winnerCard.attended_members} Attended)
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 text-xs space-y-1.5">
                        {winnerCard.leader.roll_number && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-gray-500">Roll Number:</span>
                            <span className="font-mono font-bold text-gray-800">
                              {winnerCard.leader.roll_number}
                            </span>
                          </div>
                        )}
                        <div className="text-[11px] text-gray-600 flex items-center gap-1 truncate">
                          <Building2 className="h-3 w-3 shrink-0 text-gray-400" />
                          <span className="truncate">{winnerCard.leader.college}</span>
                        </div>
                        {winnerCard.leader.department && (
                          <div className="text-[10px] text-gray-500 truncate">
                            {winnerCard.leader.department} {winnerCard.leader.year ? `• Year ${winnerCard.leader.year}` : ''}
                          </div>
                        )}
                      </div>
                    )
                  ) : (
                    <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 text-xs text-gray-500">
                      Podium winner verified.
                    </div>
                  )}

                  {/* Certificate Status Badges */}
                  <div className="space-y-1.5 pt-1 text-xs">
                    <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-50/80 border border-emerald-200">
                      <span className="text-[11px] font-bold text-emerald-900 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                        Achievement Cert:
                      </span>
                      <span className="text-[11px] font-black text-emerald-700">
                        {winnerCard ? `${winnerCard.achievement_certs_count} ISSUED` : 'ISSUED'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-xl bg-gray-50 border border-gray-200">
                      <span className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5">
                        <Award className="h-3.5 w-3.5 text-gray-500" />
                        Participation Cert:
                      </span>
                      <span className="text-[11px] font-bold text-emerald-700">
                        {winnerCard?.participation_unlocked_count ? `${winnerCard.participation_unlocked_count} UNLOCKED` : 'AVAILABLE'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Team Expansion or Details Trigger */}
                <div className="pt-2 border-t border-gray-100 flex items-center gap-2">
                  {winnerCard && winnerCard.is_team && (
                    <button
                      type="button"
                      onClick={() => togglePodiumExpansion('winner')}
                      className="flex-1 py-2 px-3 rounded-xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/70 text-emerald-900 text-xs font-black transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Users className="h-3.5 w-3.5 text-emerald-600" />
                      <span>{expandedPodiumIds.has('winner') ? 'Hide Members' : 'View Members'}</span>
                      {expandedPodiumIds.has('winner') ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  {winnerCard && (
                    <button
                      type="button"
                      onClick={() => setSelectedCandidateForDetails(winnerCard)}
                      className="py-2 px-3 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Details</span>
                    </button>
                  )}
                </div>

                {/* Expanded Podium Member List */}
                {expandedPodiumIds.has('winner') && winnerCard?.members && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-2xl border border-gray-200 space-y-2 animate-in fade-in">
                    <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                      Team Members ({winnerCard.members.length})
                    </span>
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {winnerCard.members.map((m, idx) => (
                        <div key={m.id} className="p-2.5 bg-white rounded-xl border border-gray-200 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-gray-900">
                              {idx + 1}. {m.name}
                            </span>
                            {m.is_leader && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-kits-red text-white uppercase">
                                Leader
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-500 font-medium truncate">
                            {m.college} • {m.roll_number || 'No Roll'}
                          </div>
                          <div className="flex items-center justify-between text-[10px] pt-1 border-t border-gray-100">
                            <span className="text-emerald-700 font-bold">
                              {m.achievement_display}
                            </span>
                            <span className={m.participation_status === 'UNLOCKED' ? 'text-emerald-600 font-bold' : 'text-amber-600 font-bold'}>
                              Part: {m.participation_display}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 🥈 RUNNER-UP CARD */}
              {runnerCard || resultData.runner_name ? (
                <div className="bg-white rounded-3xl border border-slate-300 p-6 shadow-sm space-y-4 relative flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-slate-700 text-white flex items-center gap-1.5 shadow-2xs">
                        <span>🥈</span> RUNNER-UP (2ND)
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                        Official Result
                      </span>
                    </div>

                    <div>
                      <h4 className="text-lg font-black text-gray-900 leading-snug">
                        {runnerCard?.display_name || resultData.runner_name}
                      </h4>
                      {runnerCard?.registration_id && (
                        <p className="text-[10px] font-mono text-gray-400 mt-0.5">
                          REG ID: {runnerCard.registration_id.slice(0, 8).toUpperCase()}
                        </p>
                      )}
                    </div>

                    {runnerCard ? (
                      runnerCard.is_team ? (
                        <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 text-xs space-y-2">
                          <div className="flex items-center justify-between text-gray-700">
                            <span className="font-bold flex items-center gap-1">
                              <Users className="h-3.5 w-3.5 text-gray-400" />
                              Team Leader:
                            </span>
                            <span className="font-black text-gray-900">{runnerCard.leader.name}</span>
                          </div>
                          {runnerCard.leader.roll_number && (
                            <div className="flex items-center justify-between text-[11px] text-gray-500">
                              <span>Roll No:</span>
                              <span className="font-mono font-bold text-gray-700">
                                {runnerCard.leader.roll_number}
                              </span>
                            </div>
                          )}
                          <div className="text-[11px] text-gray-600 flex items-center gap-1 truncate">
                            <Building2 className="h-3 w-3 shrink-0 text-gray-400" />
                            <span className="truncate">{runnerCard.leader.college}</span>
                          </div>
                          <div className="pt-1 border-t border-gray-200/60 flex items-center justify-between text-[11px] font-bold text-gray-500">
                            <span>Team Size:</span>
                            <span className="text-gray-900">
                              {runnerCard.total_members} Members ({runnerCard.attended_members} Attended)
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 text-xs space-y-1.5">
                          {runnerCard.leader.roll_number && (
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-gray-500">Roll Number:</span>
                              <span className="font-mono font-bold text-gray-800">
                                {runnerCard.leader.roll_number}
                              </span>
                            </div>
                          )}
                          <div className="text-[11px] text-gray-600 flex items-center gap-1 truncate">
                            <Building2 className="h-3 w-3 shrink-0 text-gray-400" />
                            <span className="truncate">{runnerCard.leader.college}</span>
                          </div>
                          {runnerCard.leader.department && (
                            <div className="text-[10px] text-gray-500 truncate">
                              {runnerCard.leader.department} {runnerCard.leader.year ? `• Year ${runnerCard.leader.year}` : ''}
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 text-xs text-gray-500">
                        Runner-up verified.
                      </div>
                    )}

                    {/* Certificate Status Badges */}
                    <div className="space-y-1.5 pt-1 text-xs">
                      <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-slate-600" />
                          Achievement Cert:
                        </span>
                        <span className="text-[11px] font-black text-slate-700">
                          {runnerCard ? `${runnerCard.achievement_certs_count} ISSUED` : 'ISSUED'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between p-2 rounded-xl bg-gray-50 border border-gray-200">
                        <span className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5">
                          <Award className="h-3.5 w-3.5 text-gray-500" />
                          Participation Cert:
                        </span>
                        <span className="text-[11px] font-bold text-emerald-700">
                          {runnerCard?.participation_unlocked_count ? `${runnerCard.participation_unlocked_count} UNLOCKED` : 'AVAILABLE'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100 flex items-center gap-2">
                    {runnerCard && runnerCard.is_team && (
                      <button
                        type="button"
                        onClick={() => togglePodiumExpansion('runner')}
                        className="flex-1 py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-black transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Users className="h-3.5 w-3.5 text-slate-600" />
                        <span>{expandedPodiumIds.has('runner') ? 'Hide Members' : 'View Members'}</span>
                        {expandedPodiumIds.has('runner') ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    {runnerCard && (
                      <button
                        type="button"
                        onClick={() => setSelectedCandidateForDetails(runnerCard)}
                        className="py-2 px-3 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Details</span>
                      </button>
                    )}
                  </div>

                  {expandedPodiumIds.has('runner') && runnerCard?.members && (
                    <div className="mt-3 p-3 bg-gray-50 rounded-2xl border border-gray-200 space-y-2 animate-in fade-in">
                      <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                        Team Members ({runnerCard.members.length})
                      </span>
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {runnerCard.members.map((m, idx) => (
                          <div key={m.id} className="p-2.5 bg-white rounded-xl border border-gray-200 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-gray-900">
                                {idx + 1}. {m.name}
                              </span>
                              {m.is_leader && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-slate-700 text-white uppercase">
                                  Leader
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-500 font-medium truncate">
                              {m.college} • {m.roll_number || 'No Roll'}
                            </div>
                            <div className="flex items-center justify-between text-[10px] pt-1 border-t border-gray-100">
                              <span className="text-slate-800 font-bold">
                                {m.achievement_display}
                              </span>
                              <span className={m.participation_status === 'UNLOCKED' ? 'text-emerald-600 font-bold' : 'text-amber-600 font-bold'}>
                                Part: {m.participation_display}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* 🥉 THIRD PLACE CARD (ONLY IF EXISTS) */}
              {(thirdCard || resultData.third_name) && (
                <div className="bg-white rounded-3xl border border-amber-300 p-6 shadow-sm space-y-4 relative flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-amber-600 text-white flex items-center gap-1.5 shadow-2xs">
                        <span>🥉</span> 3RD PLACE
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 uppercase">
                        Official Result
                      </span>
                    </div>

                    <div>
                      <h4 className="text-lg font-black text-gray-900 leading-snug">
                        {thirdCard?.display_name || resultData.third_name}
                      </h4>
                      {thirdCard?.registration_id && (
                        <p className="text-[10px] font-mono text-gray-400 mt-0.5">
                          REG ID: {thirdCard.registration_id.slice(0, 8).toUpperCase()}
                        </p>
                      )}
                    </div>

                    {thirdCard ? (
                      thirdCard.is_team ? (
                        <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 text-xs space-y-2">
                          <div className="flex items-center justify-between text-gray-700">
                            <span className="font-bold flex items-center gap-1">
                              <Users className="h-3.5 w-3.5 text-gray-400" />
                              Team Leader:
                            </span>
                            <span className="font-black text-gray-900">{thirdCard.leader.name}</span>
                          </div>
                          {thirdCard.leader.roll_number && (
                            <div className="flex items-center justify-between text-[11px] text-gray-500">
                              <span>Roll No:</span>
                              <span className="font-mono font-bold text-gray-700">
                                {thirdCard.leader.roll_number}
                              </span>
                            </div>
                          )}
                          <div className="text-[11px] text-gray-600 flex items-center gap-1 truncate">
                            <Building2 className="h-3 w-3 shrink-0 text-gray-400" />
                            <span className="truncate">{thirdCard.leader.college}</span>
                          </div>
                          <div className="pt-1 border-t border-gray-200/60 flex items-center justify-between text-[11px] font-bold text-gray-500">
                            <span>Team Size:</span>
                            <span className="text-gray-900">
                              {thirdCard.total_members} Members ({thirdCard.attended_members} Attended)
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 text-xs space-y-1.5">
                          {thirdCard.leader.roll_number && (
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-gray-500">Roll Number:</span>
                              <span className="font-mono font-bold text-gray-800">
                                {thirdCard.leader.roll_number}
                              </span>
                            </div>
                          )}
                          <div className="text-[11px] text-gray-600 flex items-center gap-1 truncate">
                            <Building2 className="h-3 w-3 shrink-0 text-gray-400" />
                            <span className="truncate">{thirdCard.leader.college}</span>
                          </div>
                          {thirdCard.leader.department && (
                            <div className="text-[10px] text-gray-500 truncate">
                              {thirdCard.leader.department} {thirdCard.leader.year ? `• Year ${thirdCard.leader.year}` : ''}
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 text-xs text-gray-500">
                        3rd place verified.
                      </div>
                    )}

                    {/* Certificate Status Badges */}
                    <div className="space-y-1.5 pt-1 text-xs">
                      <div className="flex items-center justify-between p-2 rounded-xl bg-amber-50 border border-amber-200">
                        <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                          Achievement Cert:
                        </span>
                        <span className="text-[11px] font-black text-amber-800">
                          {thirdCard ? `${thirdCard.achievement_certs_count} ISSUED` : 'ISSUED'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between p-2 rounded-xl bg-gray-50 border border-gray-200">
                        <span className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5">
                          <Award className="h-3.5 w-3.5 text-gray-500" />
                          Participation Cert:
                        </span>
                        <span className="text-[11px] font-bold text-emerald-700">
                          {thirdCard?.participation_unlocked_count ? `${thirdCard.participation_unlocked_count} UNLOCKED` : 'AVAILABLE'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100 flex items-center gap-2">
                    {thirdCard && thirdCard.is_team && (
                      <button
                        type="button"
                        onClick={() => togglePodiumExpansion('third')}
                        className="flex-1 py-2 px-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-black transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Users className="h-3.5 w-3.5 text-amber-600" />
                        <span>{expandedPodiumIds.has('third') ? 'Hide Members' : 'View Members'}</span>
                        {expandedPodiumIds.has('third') ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    {thirdCard && (
                      <button
                        type="button"
                        onClick={() => setSelectedCandidateForDetails(thirdCard)}
                        className="py-2 px-3 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Details</span>
                      </button>
                    )}
                  </div>

                  {expandedPodiumIds.has('third') && thirdCard?.members && (
                    <div className="mt-3 p-3 bg-gray-50 rounded-2xl border border-gray-200 space-y-2 animate-in fade-in">
                      <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                        Team Members ({thirdCard.members.length})
                      </span>
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {thirdCard.members.map((m, idx) => (
                          <div key={m.id} className="p-2.5 bg-white rounded-xl border border-gray-200 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-gray-900">
                                {idx + 1}. {m.name}
                              </span>
                              {m.is_leader && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-amber-600 text-white uppercase">
                                  Leader
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-500 font-medium truncate">
                              {m.college} • {m.roll_number || 'No Roll'}
                            </div>
                            <div className="flex items-center justify-between text-[10px] pt-1 border-t border-gray-100">
                              <span className="text-amber-800 font-bold">
                                {m.achievement_display}
                              </span>
                              <span className={m.participation_status === 'UNLOCKED' ? 'text-emerald-600 font-bold' : 'text-amber-600 font-bold'}>
                                Part: {m.participation_display}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* =================================================================
              SECTION 10: RESULT SUMMARY COUNTERS
              ================================================================= */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                {isTeamEvent ? 'ELIGIBLE TEAMS' : 'ELIGIBLE CANDIDATES'}
              </span>
              <div className="text-xl font-black text-gray-900">
                {summary.total_eligible_candidates}
              </div>
              <span className="text-[10px] font-medium text-gray-500 block truncate">
                {isTeamEvent ? `${summary.total_eligible_members} Individual Attendees` : 'Attended Participants'}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-2xs space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 block">
                WINNERS
              </span>
              <div className="text-xl font-black text-emerald-950">
                {summary.winners_count}
              </div>
              <span className="text-[10px] font-medium text-emerald-700 block truncate">
                {isTeamEvent ? '1 Winner Team' : '1st Place'}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-700 block">
                RUNNERS-UP
              </span>
              <div className="text-xl font-black text-slate-900">
                {summary.runners_count}
              </div>
              <span className="text-[10px] font-medium text-slate-600 block truncate">
                {isTeamEvent ? (summary.runners_count > 0 ? '1 Runner-Up Team' : 'None') : '2nd Place'}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-2xs space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 block">
                THIRD PLACE
              </span>
              <div className="text-xl font-black text-amber-900">
                {summary.third_count}
              </div>
              <span className="text-[10px] font-medium text-amber-700 block truncate">
                {isTeamEvent ? (summary.third_count > 0 ? '1 Third-Place Team' : 'Not Configured') : '3rd Place'}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                ACHIEVEMENT CERTS
              </span>
              <div className="text-xl font-black text-emerald-800">
                {summary.achievement_certs_count}
              </div>
              <span className="text-[10px] font-medium text-gray-500 block truncate">
                {isTeamEvent ? 'Individual Member Certs Issued' : 'Official Issued'}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                PARTICIPATION CERTS
              </span>
              <div className="text-xl font-black text-blue-900">
                {summary.participation_unlocked_count}
              </div>
              <span className="text-[10px] font-medium text-gray-500 block truncate">
                Unlocked ({summary.participation_locked_count} Locked)
              </span>
            </div>
          </div>

          {/* =================================================================
              SECTION 4, 5, 6, 7, 8, 9: ALL ELIGIBLE PARTICIPANTS TABLE
              ================================================================= */}
          <div className="bg-white rounded-3xl border border-gray-200 shadow-2xs p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-sm font-black text-gray-900 tracking-tight flex items-center gap-2">
                  <Users className="h-4 w-4 text-kits-red" />
                  <span>ALL ELIGIBLE PARTICIPANTS</span>
                </h3>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  All participants/teams who satisfied the existing attendance eligibility requirement for this sub-event.
                </p>
              </div>

              <div className="text-xs font-bold text-gray-500">
                Showing <strong className="text-gray-900">{filteredCandidates.length}</strong> of{' '}
                <strong className="text-gray-900">{resultData.eligible_participants?.length || 0}</strong>{' '}
                eligible {isTeamEvent ? 'teams' : 'candidates'}
              </div>
            </div>

            {/* Section 14: Search and Filter Controls */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search participant, team, roll number, college, dept..."
                    className="w-full pl-10 pr-9 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 placeholder-gray-400 focus:bg-white focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Reset Filters if Active */}
                {(rankFilter !== 'ALL' || certFilter !== 'ALL' || searchQuery) && (
                  <button
                    type="button"
                    onClick={() => {
                      setRankFilter('ALL');
                      setCertFilter('ALL');
                      setSearchQuery('');
                    }}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset Filters</span>
                  </button>
                )}
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-[11px] font-black uppercase text-gray-400 flex items-center gap-1 mr-1">
                  <Filter className="h-3 w-3" /> Result:
                </span>
                <button
                  type="button"
                  onClick={() => setRankFilter('ALL')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                    rankFilter === 'ALL'
                      ? 'bg-gray-900 text-white shadow-2xs'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  All ({summary.total_eligible_candidates})
                </button>
                <button
                  type="button"
                  onClick={() => setRankFilter('WINNER')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                    rankFilter === 'WINNER'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                  }`}
                >
                  🥇 Winner ({summary.winners_count})
                </button>
                <button
                  type="button"
                  onClick={() => setRankFilter('RUNNER_UP')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                    rankFilter === 'RUNNER_UP'
                      ? 'bg-slate-700 text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-200'
                  }`}
                >
                  🥈 Runner-Up ({summary.runners_count})
                </button>
                {summary.third_count > 0 && (
                  <button
                    type="button"
                    onClick={() => setRankFilter('THIRD_PLACE')}
                    className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                      rankFilter === 'THIRD_PLACE'
                        ? 'bg-amber-600 text-white shadow-2xs'
                        : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                    }`}
                  >
                    🥉 3rd Place ({summary.third_count})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRankFilter('PARTICIPANT')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                    rankFilter === 'PARTICIPANT'
                      ? 'bg-gray-700 text-white shadow-2xs'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
                  }`}
                >
                  Participants (
                  {Math.max(
                    0,
                    summary.total_eligible_candidates -
                      summary.winners_count -
                      summary.runners_count -
                      summary.third_count
                  )}
                  )
                </button>

                {/* Certificate Filters */}
                <div className="h-4 w-px bg-gray-200 mx-1 hidden sm:block" />

                <span className="text-[11px] font-black uppercase text-gray-400 flex items-center gap-1 mr-1">
                  <Award className="h-3 w-3" /> Cert:
                </span>
                <button
                  type="button"
                  onClick={() => setCertFilter('ALL')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                    certFilter === 'ALL'
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  All Certs
                </button>
                <button
                  type="button"
                  onClick={() => setCertFilter('ACHIEVEMENT_ISSUED')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                    certFilter === 'ACHIEVEMENT_ISSUED'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                  }`}
                >
                  Achievement Issued ({summary.achievement_certs_count})
                </button>
                <button
                  type="button"
                  onClick={() => setCertFilter('PARTICIPATION_UNLOCKED')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                    certFilter === 'PARTICIPATION_UNLOCKED'
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200'
                  }`}
                >
                  Part. Unlocked ({summary.participation_unlocked_count})
                </button>
                <button
                  type="button"
                  onClick={() => setCertFilter('PARTICIPATION_LOCKED')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                    certFilter === 'PARTICIPATION_LOCKED'
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                  }`}
                >
                  Part. Locked ({summary.participation_locked_count})
                </button>
              </div>
            </div>

            {/* Empty Filter State */}
            {filteredCandidates.length === 0 ? (
              <div className="p-12 text-center bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
                <Users className="h-8 w-8 text-gray-400 mx-auto" />
                <h4 className="text-sm font-black text-gray-900">No Participants Found</h4>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  No eligible candidates matched your search or filter criteria. Try adjusting your search term or reset filters.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setRankFilter('ALL');
                    setCertFilter('ALL');
                  }}
                  className="mt-2 px-4 py-2 bg-kits-red text-white text-xs font-bold rounded-xl shadow-2xs hover:bg-red-700 transition cursor-pointer"
                >
                  Reset All Filters
                </button>
              </div>
            ) : (
              <>
                {/* ===========================================================
                    DESKTOP / TABLET FULL TABLE (SECTIONS 5, 6, 7, 8, 9)
                    =========================================================== */}
                <div className="hidden md:block overflow-x-auto rounded-2xl border border-gray-200">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-50/90 border-b border-gray-200 text-[10px] font-black uppercase tracking-wider text-gray-500">
                        <th className="py-3.5 px-4 w-12 text-center">#</th>
                        {isTeamEvent ? (
                          <>
                            <th className="py-3.5 px-4">Team</th>
                            <th className="py-3.5 px-4">Members</th>
                            <th className="py-3.5 px-4">Leader</th>
                            <th className="py-3.5 px-4">Colleges</th>
                          </>
                        ) : (
                          <>
                            <th className="py-3.5 px-4">Participant</th>
                            <th className="py-3.5 px-4">Roll No</th>
                            <th className="py-3.5 px-4">College</th>
                            <th className="py-3.5 px-4">Department / Year</th>
                          </>
                        )}
                        <th className="py-3.5 px-4">Attendance</th>
                        <th className="py-3.5 px-4">Result</th>
                        <th className="py-3.5 px-4">Achievement Cert</th>
                        <th className="py-3.5 px-4">Participation Cert</th>
                        <th className="py-3.5 px-4 text-right">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {filteredCandidates.map((candidate, idx) => {
                        const isExpanded = expandedTeamIds.has(candidate.team_id);
                        return (
                          <React.Fragment key={candidate.team_id}>
                            <tr
                              className={`hover:bg-gray-50/80 transition ${
                                candidate.result_rank === 'WINNER'
                                  ? 'bg-emerald-50/30'
                                  : candidate.result_rank === 'RUNNER_UP'
                                  ? 'bg-slate-50/40'
                                  : candidate.result_rank === 'THIRD_PLACE'
                                  ? 'bg-amber-50/30'
                                  : ''
                              }`}
                            >
                              {/* # Column */}
                              <td className="py-3.5 px-4 text-center font-bold text-gray-400">
                                {idx + 1}
                              </td>

                              {/* Candidate / Team Column */}
                              <td className="py-3.5 px-4 font-bold text-gray-900">
                                <div className="space-y-0.5">
                                  <div className="font-black text-gray-900">
                                    {candidate.display_name}
                                  </div>
                                  <div className="text-[10px] font-mono text-gray-400">
                                    {candidate.registration_id.slice(0, 8).toUpperCase()}
                                  </div>
                                </div>
                              </td>

                              {/* Members & Leader for Team, or Roll/College for Solo */}
                              {isTeamEvent ? (
                                <>
                                  <td className="py-3.5 px-4">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-gray-700">
                                        {candidate.total_members} Members
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleTeamExpansion(candidate.team_id)}
                                        className="px-2 py-0.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-[10px] font-bold text-gray-700 flex items-center gap-1 transition cursor-pointer"
                                      >
                                        <span>{isExpanded ? 'Hide' : 'View'}</span>
                                        {isExpanded ? (
                                          <ChevronUp className="h-3 w-3" />
                                        ) : (
                                          <ChevronDown className="h-3 w-3" />
                                        )}
                                      </button>
                                    </div>
                                  </td>

                                  <td className="py-3.5 px-4">
                                    <div className="space-y-0.5">
                                      <span className="font-bold text-gray-900 block truncate max-w-44">
                                        {candidate.leader?.name}
                                      </span>
                                      {candidate.leader?.roll_number && (
                                        <span className="text-[10px] font-mono text-gray-400 block">
                                          {candidate.leader.roll_number}
                                        </span>
                                      )}
                                    </div>
                                  </td>

                                  <td className="py-3.5 px-4 max-w-56">
                                    <div className="flex flex-wrap gap-1">
                                      {candidate.colleges?.map((col, cIdx) => (
                                        <span
                                          key={cIdx}
                                          className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] font-medium border border-gray-200 truncate max-w-48 block"
                                          title={col}
                                        >
                                          {col}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="py-3.5 px-4 font-mono font-bold text-gray-700">
                                    {candidate.leader?.roll_number || '—'}
                                  </td>
                                  <td className="py-3.5 px-4 text-gray-700 max-w-48 truncate" title={candidate.leader?.college || ''}>
                                    {candidate.leader?.college || '—'}
                                  </td>
                                  <td className="py-3.5 px-4 text-gray-600">
                                    {candidate.leader?.department || '—'}
                                    {candidate.leader?.year ? ` • Year ${candidate.leader.year}` : ''}
                                  </td>
                                </>
                              )}

                              {/* Attendance Status */}
                              <td className="py-3.5 px-4">
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  <UserCheck className="h-3 w-3 text-emerald-600" />
                                  Present {isTeamEvent ? `(${candidate.attended_members}/${candidate.total_members})` : ''}
                                </span>
                              </td>

                              {/* Section 7: Result Status */}
                              <td className="py-3.5 px-4">
                                {candidate.result_rank === 'WINNER' ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500 text-white shadow-2xs">
                                    🥇 WINNER
                                  </span>
                                ) : candidate.result_rank === 'RUNNER_UP' ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-slate-700 text-white shadow-2xs">
                                    🥈 RUNNER-UP
                                  </span>
                                ) : candidate.result_rank === 'THIRD_PLACE' ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-600 text-white shadow-2xs">
                                    🥉 THIRD PLACE
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-200">
                                    PARTICIPATION
                                  </span>
                                )}
                              </td>

                              {/* Section 8 & 9: Achievement Certificate Status */}
                              <td className="py-3.5 px-4">
                                {candidate.achievement_certs_count > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                                    <Sparkles className="h-3 w-3 text-emerald-600" />
                                    {isTeamEvent
                                      ? `${candidate.achievement_certs_count} ISSUED`
                                      : `${candidate.result_rank_display} — ISSUED`}
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-medium text-gray-400">
                                    NOT APPLICABLE
                                  </span>
                                )}
                              </td>

                              {/* Section 8 & 9: Participation Certificate Status */}
                              <td className="py-3.5 px-4">
                                {candidate.participation_unlocked_count > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-50 text-blue-800 border border-blue-200">
                                    <Unlock className="h-3 w-3 text-blue-600" />
                                    {isTeamEvent
                                      ? `${candidate.participation_unlocked_count} UNLOCKED`
                                      : 'UNLOCKED'}
                                    {isTeamEvent && candidate.participation_locked_count > 0 && (
                                      <span className="text-amber-700 font-bold ml-1">
                                        ({candidate.participation_locked_count} LOCKED)
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                    <Lock className="h-3 w-3 text-amber-600" />
                                    {isTeamEvent ? `${candidate.total_members} LOCKED` : 'LOCKED'}
                                  </span>
                                )}
                              </td>

                              {/* Details Action */}
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => setSelectedCandidateForDetails(candidate)}
                                  className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition cursor-pointer"
                                  title="View Full Details"
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>

                            {/* ===============================================
                                SECTION 6: INLINE TEAM EXPANSION ROW
                                =============================================== */}
                            {isExpanded && candidate.members && (
                              <tr className="bg-gray-50/70 border-b border-gray-200 animate-in fade-in duration-150">
                                <td colSpan={10} className="p-4 sm:p-5">
                                  <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3 shadow-2xs">
                                    <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                                      <div className="flex items-center gap-2">
                                        <Users className="h-4 w-4 text-kits-red" />
                                        <h5 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                                          {candidate.display_name} — Individual Member Roster ({candidate.members.length})
                                        </h5>
                                      </div>
                                      <span className="text-[10px] font-medium text-gray-400">
                                        Inter-college snapshot preserved per member
                                      </span>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                      {candidate.members.map((member, mIdx) => (
                                        <div
                                          key={member.id}
                                          className="p-3 bg-gray-50/80 rounded-xl border border-gray-200 text-xs space-y-2 relative"
                                        >
                                          <div className="flex items-start justify-between gap-1">
                                            <div className="font-black text-gray-900 leading-tight">
                                              {mIdx + 1}. {member.name}
                                            </div>
                                            {member.is_leader && (
                                              <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-kits-red text-white uppercase shrink-0">
                                                Team Leader
                                              </span>
                                            )}
                                          </div>

                                          <div className="space-y-1 text-[11px]">
                                            <div className="text-gray-600 flex items-center gap-1 truncate" title={member.college || ''}>
                                              <Building2 className="h-3 w-3 shrink-0 text-gray-400" />
                                              <span className="font-bold text-gray-800 truncate">
                                                {member.college || 'KITS Akshar Institute of Technology'}
                                              </span>
                                            </div>
                                            <div className="text-gray-500 flex items-center gap-1 truncate">
                                              <GraduationCap className="h-3 w-3 shrink-0 text-gray-400" />
                                              <span className="truncate">
                                                {member.department || 'General Track'} {member.year ? `• Year ${member.year}` : ''}
                                              </span>
                                            </div>
                                            <div className="text-gray-500 flex items-center justify-between text-[10px] font-mono">
                                              <span>Roll:</span>
                                              <span className="font-bold text-gray-700">
                                                {member.roll_number || 'N/A'}
                                              </span>
                                            </div>
                                          </div>

                                          {/* Attendance & Certifications */}
                                          <div className="pt-2 border-t border-gray-200/80 space-y-1 text-[10px]">
                                            <div className="flex items-center justify-between">
                                              <span className="text-gray-500">Attendance:</span>
                                              <span
                                                className={`font-bold ${
                                                  member.attendance_status === 'PRESENT'
                                                    ? 'text-emerald-700'
                                                    : 'text-red-700'
                                                }`}
                                              >
                                                {member.attendance_status === 'PRESENT' ? '✓ Present' : '✗ Absent'}
                                              </span>
                                            </div>

                                            <div className="flex items-center justify-between">
                                              <span className="text-gray-500">Achievement Cert:</span>
                                              <span className="font-bold text-emerald-800">
                                                {member.achievement_display}
                                              </span>
                                            </div>

                                            <div className="flex items-center justify-between">
                                              <span className="text-gray-500">Participation Cert:</span>
                                              <span
                                                className={`font-bold ${
                                                  member.participation_status === 'UNLOCKED'
                                                    ? 'text-blue-700'
                                                    : 'text-amber-700'
                                                }`}
                                              >
                                                {member.participation_display}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ===========================================================
                    SECTION 18: RESPONSIVE MOBILE CARDS VIEW
                    =========================================================== */}
                <div className="block md:hidden space-y-4">
                  {filteredCandidates.map((candidate, idx) => {
                    const isExpanded = expandedTeamIds.has(candidate.team_id);
                    return (
                      <div
                        key={candidate.team_id}
                        className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3 shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5">
                            <span className="text-[10px] font-bold text-gray-400">
                              #{idx + 1} • {candidate.registration_id.slice(0, 8).toUpperCase()}
                            </span>
                            <h4 className="text-sm font-black text-gray-900 leading-tight">
                              {candidate.display_name}
                            </h4>
                          </div>

                          {/* Result Badge */}
                          {candidate.result_rank === 'WINNER' ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500 text-white">
                              🥇 WINNER
                            </span>
                          ) : candidate.result_rank === 'RUNNER_UP' ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-700 text-white">
                              🥈 RUNNER-UP
                            </span>
                          ) : candidate.result_rank === 'THIRD_PLACE' ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-600 text-white">
                              🥉 3RD PLACE
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-200">
                              PARTICIPANT
                            </span>
                          )}
                        </div>

                        {/* Leader & College info */}
                        <div className="text-xs space-y-1 text-gray-600 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                          {candidate.is_team && (
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-bold text-gray-500">Leader:</span>
                              <span className="font-black text-gray-900">{candidate.leader?.name}</span>
                            </div>
                          )}
                          <div className="text-[11px] truncate flex items-center gap-1 text-gray-700">
                            <Building2 className="h-3 w-3 shrink-0 text-gray-400" />
                            <span className="truncate">{candidate.leader?.college}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-gray-500 pt-1 border-t border-gray-200/60">
                            <span>Attendance:</span>
                            <span className="font-bold text-emerald-700">
                              ✓ Present ({candidate.attended_members}/{candidate.total_members})
                            </span>
                          </div>
                        </div>

                        {/* Dual Certificates */}
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div className="p-2 rounded-xl bg-gray-50 border border-gray-200 space-y-0.5">
                            <span className="font-bold text-gray-400 block uppercase">Achievement:</span>
                            <span className="font-black text-emerald-800 block truncate">
                              {candidate.achievement_certs_count > 0 ? `${candidate.achievement_certs_count} ISSUED` : 'NOT APPLICABLE'}
                            </span>
                          </div>
                          <div className="p-2 rounded-xl bg-gray-50 border border-gray-200 space-y-0.5">
                            <span className="font-bold text-gray-400 block uppercase">Participation:</span>
                            <span className="font-black text-blue-800 block truncate">
                              {candidate.participation_unlocked_count > 0 ? `${candidate.participation_unlocked_count} UNLOCKED` : 'LOCKED'}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="pt-1 flex items-center gap-2">
                          {candidate.is_team && (
                            <button
                              type="button"
                              onClick={() => toggleTeamExpansion(candidate.team_id)}
                              className="flex-1 py-1.5 px-3 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-xs font-bold text-gray-700 flex items-center justify-center gap-1"
                            >
                              <span>{isExpanded ? 'Hide Members' : `View ${candidate.total_members} Members`}</span>
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedCandidateForDetails(candidate)}
                            className="py-1.5 px-3 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-bold text-gray-700 flex items-center justify-center gap-1"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Details</span>
                          </button>
                        </div>

                        {/* Mobile Expanded Members */}
                        {isExpanded && candidate.members && (
                          <div className="mt-2 p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
                            <span className="text-[10px] font-black uppercase text-gray-400 block">
                              Team Members:
                            </span>
                            <div className="space-y-2">
                              {candidate.members.map((m, mIdx) => (
                                <div key={m.id} className="p-2 bg-white rounded-lg border border-gray-200 text-[11px] space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-gray-900">
                                      {mIdx + 1}. {m.name}
                                    </span>
                                    {m.is_leader && (
                                      <span className="px-1 py-0.2 rounded text-[8px] font-black bg-kits-red text-white uppercase">
                                        Leader
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-gray-500 truncate">
                                    {m.college} • {m.roll_number || 'N/A'}
                                  </div>
                                  <div className="flex items-center justify-between text-[9px] pt-1 border-t border-gray-100">
                                    <span className="font-bold text-emerald-800">{m.achievement_display}</span>
                                    <span className={m.participation_status === 'UNLOCKED' ? 'text-blue-700 font-bold' : 'text-amber-700 font-bold'}>
                                      Part: {m.participation_display}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          STATE 2: PENDING ADMIN APPROVAL
          ===================================================================== */}
      {currentStatus === 'PENDING_ADMIN_APPROVAL' && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xs">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-100 text-amber-700 rounded-2xl shrink-0">
              <Clock className="h-6 w-6 animate-spin text-amber-600" />
            </div>
            <div className="space-y-1 min-w-0">
              <h4 className="text-base font-black text-amber-950 tracking-tight flex items-center gap-2">
                <span>Result Declaration Awaiting Administrator Approval</span>
              </h4>
              <p className="text-xs text-amber-900 leading-relaxed font-medium">
                You have submitted the proposed podium result for this sub-event. It is currently locked in the Administrator review queue.
                Coordinators cannot publish results directly; an administrator must review and accept the submission before achievement certificates are issued.
              </p>
              {resultData.submitted_at && (
                <p className="text-[11px] text-amber-800 font-mono mt-1">
                  Submitted at: {formatDateTime12h(resultData.submitted_at)}
                </p>
              )}
            </div>
          </div>

          {/* Submitted Podium Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="bg-white p-5 rounded-2xl border border-amber-200 shadow-2xs space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 block">
                Proposed Winner
              </span>
              <div className="text-base font-black text-gray-900 truncate">
                {resultData.winner_name || 'Winner Selected'}
              </div>
              <span className="text-[10px] text-gray-400 font-bold uppercase block">
                Pending Approval
              </span>
            </div>

            {resultData.runner_name && (
              <div className="bg-white p-5 rounded-2xl border border-amber-200 shadow-2xs space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 block">
                  Proposed Runner-Up
                </span>
                <div className="text-base font-black text-gray-900 truncate">
                  {resultData.runner_name}
                </div>
                <span className="text-[10px] text-gray-400 font-bold uppercase block">
                  Pending Approval
                </span>
              </div>
            )}

            {resultData.third_name && (
              <div className="bg-white p-5 rounded-2xl border border-amber-200 shadow-2xs space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 block">
                  Proposed 3rd Place
                </span>
                <div className="text-base font-black text-gray-900 truncate">
                  {resultData.third_name}
                </div>
                <span className="text-[10px] text-gray-400 font-bold uppercase block">
                  Pending Approval
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          STATE 3 & 4: REJECTED (SHOW REASON + RE-SUBMIT) OR NOT_SUBMITTED (DECLARATION FORM)
          ===================================================================== */}
      {(currentStatus === 'NOT_SUBMITTED' || currentStatus === 'REJECTED') && (
        <div className="space-y-6">
          {/* Rejection Alert Banner */}
          {currentStatus === 'REJECTED' && (
            <div className="bg-red-50 border border-red-200 rounded-3xl p-6 sm:p-7 space-y-3 shadow-2xs">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-red-100 text-kits-red rounded-xl shrink-0">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-black text-red-950 uppercase tracking-wide">
                    Result Submission Rejected by Administrator
                  </h4>
                  <p className="text-xs text-red-900 font-medium">
                    The administrator reviewed the previous result submission and requested corrections.
                  </p>
                </div>
              </div>

              {/* Rejection Reason Box */}
              <div className="bg-white/80 p-4 rounded-2xl border border-red-200 text-xs space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                  Administrator Rejection Reason:
                </span>
                <p className="text-gray-900 font-bold italic leading-relaxed">
                  "{resultData.rejection_reason || 'No specific reason provided.'}"
                </p>
              </div>

              <p className="text-[11px] text-red-800 font-medium">
                Please make the required changes below and click <strong>Resubmit for Admin Approval</strong>.
              </p>
            </div>
          )}

          {/* If No Eligible Candidates Attended */}
          {!hasEligible ? (
            <div className="bg-white p-12 rounded-3xl border border-gray-200 text-center space-y-3 shadow-2xs">
              <div className="p-3 bg-gray-50 text-gray-400 rounded-2xl inline-block">
                <Users className="h-8 w-8 mx-auto" />
              </div>
              <h4 className="text-base font-black text-gray-900">
                No eligible participants available
              </h4>
              <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
                Attendance check-in is strictly required for result eligibility. Once participants or teams register and check in on-venue, they will automatically appear here as eligible podium candidates.
              </p>
            </div>
          ) : (
            /* Result Declaration Form */
            <form onSubmit={handleOpenConfirmation} className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-2xs space-y-6">
              <div className="space-y-1 border-b border-gray-100 pb-4">
                <h4 className="text-sm font-black text-gray-900 tracking-tight flex items-center gap-2">
                  <Award className="h-4 w-4 text-kits-red" />
                  <span>
                    {currentStatus === 'REJECTED' ? 'Revise Result Declaration' : 'Declare Sub-Event Results'}
                  </span>
                </h4>
                <p className="text-xs text-gray-500 font-medium">
                  Select the verified Winner and Runner-Up from attended candidates. Submitting will send the result to Administrators for final review and achievement certificate issuance.
                </p>
              </div>

              {submitError && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* 1. Winner Selection */}
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-wider text-gray-900 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-kits-red">
                      <Trophy className="h-3.5 w-3.5" />
                      1st Place — Winner <span className="text-kits-red">*</span>
                    </span>
                    <span className="text-[10px] text-gray-400 font-bold">Mandatory</span>
                  </label>

                  <select
                    value={selectedWinnerId}
                    onChange={(e) => setSelectedWinnerId(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:bg-white focus:border-kits-red focus:ring-1 focus:ring-kits-red cursor-pointer"
                    required
                  >
                    <option value="">— Select Winner —</option>
                    {eligibleCandidates.map((c) => (
                      <option key={c.teamId} value={c.teamId}>
                        {c.teamName} — {c.leaderCollege} {c.isTeam ? `(${c.attendedCount} attended)` : ''}
                      </option>
                    ))}
                  </select>

                  {winnerCandidate && (
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-[11px] space-y-1">
                      <div className="font-bold text-gray-900 truncate">
                        {winnerCandidate.teamName}
                      </div>
                      <div className="text-gray-500 flex items-center gap-1 truncate">
                        <Building2 className="h-3 w-3 shrink-0" />
                        <span>{winnerCandidate.leaderCollege}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Runner-Up Selection */}
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-wider text-gray-900 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-kits-blue">
                      <Medal className="h-3.5 w-3.5" />
                      2nd Place — Runner-Up {!isSingleCompetitor && <span className="text-kits-red">*</span>}
                    </span>
                    <span className="text-[10px] text-gray-400 font-bold">
                      {isSingleCompetitor ? 'Single Competitor Event' : 'Mandatory'}
                    </span>
                  </label>

                  {isSingleCompetitor ? (
                    <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500 font-medium">
                      Not applicable — only 1 attended competitor in this sub-event. Winner-only result supported.
                    </div>
                  ) : (
                    <>
                      <select
                        value={selectedRunnerId}
                        onChange={(e) => setSelectedRunnerId(e.target.value)}
                        disabled={!selectedWinnerId}
                        className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 cursor-pointer"
                        required
                      >
                        <option value="">— Select Runner-Up —</option>
                        {availableRunners.map((c) => (
                          <option key={c.teamId} value={c.teamId}>
                            {c.teamName} — {c.leaderCollege} {c.isTeam ? `(${c.attendedCount} attended)` : ''}
                          </option>
                        ))}
                      </select>

                      {runnerCandidate && (
                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-[11px] space-y-1">
                          <div className="font-bold text-gray-900 truncate">
                            {runnerCandidate.teamName}
                          </div>
                          <div className="text-gray-500 flex items-center gap-1 truncate">
                            <Building2 className="h-3 w-3 shrink-0" />
                            <span>{runnerCandidate.leaderCollege}</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* 3. Optional Third Place Selection */}
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-xs font-black uppercase tracking-wider text-gray-900 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-amber-700">
                      <Award className="h-3.5 w-3.5" />
                      3rd Place (Optional)
                    </span>
                    <span className="text-[10px] text-gray-400 font-bold">Optional</span>
                  </label>

                  <select
                    value={selectedThirdId}
                    onChange={(e) => setSelectedThirdId(e.target.value)}
                    disabled={!selectedWinnerId || (!isSingleCompetitor && !selectedRunnerId)}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 disabled:opacity-50 cursor-pointer"
                  >
                    <option value="">— None / Skip Third Place —</option>
                    {availableThirds.map((c) => (
                      <option key={c.teamId} value={c.teamId}>
                        {c.teamName} — {c.leaderCollege} {c.isTeam ? `(${c.attendedCount} attended)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-gray-100 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500 font-medium">
                  <HelpCircle className="h-4 w-4 text-gray-400 shrink-0" />
                  <span>
                    Results require Administrator review before publishing and certificate release.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={!selectedWinnerId || (!isSingleCompetitor && !selectedRunnerId)}
                  className="px-5 py-2.5 rounded-xl bg-kits-red hover:bg-red-700 text-white text-xs font-black transition shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  <span>
                    {currentStatus === 'REJECTED' ? 'Resubmit for Admin Approval' : 'Submit Result for Admin Approval'}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* =========================================================================
          CONFIRMATION MODAL (SECTION 10 OF WORKFLOW)
          ========================================================================= */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl border border-gray-200 shadow-2xl w-full max-w-lg overflow-hidden space-y-6 p-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-red-50 text-kits-red rounded-xl">
                  <Trophy className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900 tracking-tight">
                    Review Result Declaration
                  </h3>
                  <p className="text-[11px] text-gray-500 font-medium">
                    Sub-Event: {subEventName}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isSubmitting}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {submitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold">
                {submitError}
              </div>
            )}

            {/* Selected Candidates Summary */}
            <div className="space-y-3 text-xs">
              {/* Winner */}
              <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 block">
                  🏆 Winner (1st Place)
                </span>
                <div className="text-sm font-black text-emerald-950">
                  {winnerCandidate?.teamName}
                </div>
                <div className="text-[11px] text-emerald-800 font-medium">
                  {winnerCandidate?.leaderCollege} {winnerCandidate?.isTeam ? `• ${winnerCandidate.attendedCount} attended` : ''}
                </div>
              </div>

              {/* Runner */}
              {runnerCandidate && (
                <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-2xl space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-blue-800 block">
                    🥈 Runner-Up (2nd Place)
                  </span>
                  <div className="text-sm font-black text-blue-950">
                    {runnerCandidate.teamName}
                  </div>
                  <div className="text-[11px] text-blue-800 font-medium">
                    {runnerCandidate.leaderCollege} {runnerCandidate.isTeam ? `• ${runnerCandidate.attendedCount} attended` : ''}
                  </div>
                </div>
              )}

              {/* Third */}
              {thirdCandidate && (
                <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 block">
                    🥉 3rd Place
                  </span>
                  <div className="text-sm font-black text-amber-950">
                    {thirdCandidate.teamName}
                  </div>
                  <div className="text-[11px] text-amber-800 font-medium">
                    {thirdCandidate.leaderCollege}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-[11px] text-gray-600 font-medium leading-relaxed">
              <span className="font-bold text-gray-900 block mb-0.5">Workflow Notice:</span>
              Submitting this declaration sets the status to <strong>PENDING ADMIN APPROVAL</strong>. Results will NOT be publicly published or certificates issued until an administrator approves your submission.
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecuteSubmit}
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-kits-red hover:bg-red-700 text-white text-xs font-black transition shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    <span>Submit for Admin Approval</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 15: DETAILS DRAWER / MODAL
          ========================================================================= */}
      {selectedCandidateForDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl border-l border-gray-200 flex flex-col justify-between overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-red-50 text-kits-red rounded-xl">
                    <Trophy className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-gray-900 tracking-tight">
                      {selectedCandidateForDetails.is_team ? 'TEAM DETAILS' : 'PARTICIPANT DETAILS'}
                    </h3>
                    <p className="text-[11px] text-gray-500 font-medium">
                      Sub-Event: {subEventName}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedCandidateForDetails(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex items-center gap-2 pt-2 flex-wrap">
                <span className="font-black text-lg text-gray-900">
                  {selectedCandidateForDetails.display_name}
                </span>
                {selectedCandidateForDetails.result_rank === 'WINNER' ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500 text-white">
                    🥇 WINNER
                  </span>
                ) : selectedCandidateForDetails.result_rank === 'RUNNER_UP' ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-slate-700 text-white">
                    🥈 RUNNER-UP
                  </span>
                ) : selectedCandidateForDetails.result_rank === 'THIRD_PLACE' ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-600 text-white">
                    🥉 THIRD PLACE
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-200">
                    PARTICIPANT
                  </span>
                )}
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {/* Top Overview Metadata */}
              <div className="grid grid-cols-2 gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-200">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-0.5">
                    REGISTRATION ID
                  </span>
                  <span className="font-mono font-bold text-gray-900 block truncate">
                    {selectedCandidateForDetails.registration_id}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-0.5">
                    ATTENDANCE STATUS
                  </span>
                  <span className="font-bold text-emerald-700 flex items-center gap-1">
                    <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                    Present ({selectedCandidateForDetails.attended_members} / {selectedCandidateForDetails.total_members})
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-0.5">
                    ACHIEVEMENT CERTIFICATES
                  </span>
                  <span className="font-bold text-emerald-800">
                    {selectedCandidateForDetails.achievement_certs_count > 0
                      ? `${selectedCandidateForDetails.achievement_certs_count} ISSUED`
                      : 'NOT APPLICABLE'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-0.5">
                    PARTICIPATION CERTIFICATES
                  </span>
                  <span className="font-bold text-blue-800">
                    {selectedCandidateForDetails.participation_unlocked_count > 0
                      ? `${selectedCandidateForDetails.participation_unlocked_count} UNLOCKED`
                      : 'LOCKED'}
                  </span>
                </div>
              </div>

              {/* Members Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-kits-red" />
                    <span>
                      {selectedCandidateForDetails.is_team
                        ? `Team Members (${selectedCandidateForDetails.members.length})`
                        : 'Participant Profile'}
                    </span>
                  </h4>
                  <span className="text-[10px] text-gray-400 font-medium">
                    Individual Verification Snapshots
                  </span>
                </div>

                <div className="space-y-3">
                  {selectedCandidateForDetails.members.map((member, mIdx) => (
                    <div
                      key={member.id}
                      className="p-4 bg-white rounded-2xl border border-gray-200 space-y-3 shadow-2xs"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold text-gray-400">
                            Member #{mIdx + 1}
                          </span>
                          <h5 className="text-sm font-black text-gray-900">{member.name}</h5>
                        </div>
                        {member.is_leader && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-kits-red text-white uppercase">
                            Team Leader
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] bg-gray-50/70 p-3 rounded-xl border border-gray-100">
                        <div>
                          <span className="text-[9px] font-bold uppercase text-gray-400 block">
                            Roll Number
                          </span>
                          <span className="font-mono font-bold text-gray-800">
                            {member.roll_number || 'N/A'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] font-bold uppercase text-gray-400 block">
                            College (Snapshot)
                          </span>
                          <span className="font-bold text-gray-800 truncate block" title={member.college || ''}>
                            {member.college || 'KITS Akshar Institute of Technology'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] font-bold uppercase text-gray-400 block">
                            Department
                          </span>
                          <span className="font-medium text-gray-700 truncate block">
                            {member.department || 'General Track'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] font-bold uppercase text-gray-400 block">
                            Year of Study
                          </span>
                          <span className="font-medium text-gray-700">
                            {member.year ? `Year ${member.year}` : 'N/A'}
                          </span>
                        </div>
                      </div>

                      {/* Member Attendance & Cert Details */}
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-500 font-medium">Check-In Attendance:</span>
                          <span
                            className={`font-bold ${
                              member.attendance_status === 'PRESENT'
                                ? 'text-emerald-700'
                                : 'text-red-700'
                            }`}
                          >
                            {member.attendance_status === 'PRESENT' ? '✓ Verified Present' : '✗ Absent'}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-gray-700">Achievement Certificate:</span>
                            <span className="font-black text-emerald-800">
                              {member.achievement_display}
                            </span>
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-gray-700">Participation Certificate:</span>
                            <span
                              className={`font-black ${
                                member.participation_status === 'UNLOCKED'
                                  ? 'text-blue-700'
                                  : 'text-amber-700'
                              }`}
                            >
                              {member.participation_display}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <span className="text-[11px] text-gray-400 font-medium">
                Authoritative record • Read-Only
              </span>
              <button
                type="button"
                onClick={() => setSelectedCandidateForDetails(null)}
                className="px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
