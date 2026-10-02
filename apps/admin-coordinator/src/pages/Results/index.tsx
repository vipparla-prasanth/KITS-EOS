import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { EmptyState } from '../../components/ui/EmptyState';
import { 
  Trophy, 
  Medal, 
  Award, 
  Lock, 
  CheckCircle2, 
  Search, 
  Layers, 
  X, 
  AlertCircle, 
  Users, 
  User, 
  Send, 
  ShieldCheck, 
  Check, 
  Copy,
  Clock,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Edit3,
} from 'lucide-react';
import type { Event, Category, SubEvent } from '@kits-eos/shared/src/types/models';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { PendingResultSubmissions } from '../../components/results/PendingResultSubmissions';
import { CorrectPublishedResultModal } from '../../components/results/CorrectPublishedResultModal';

export interface MemberInfo {
  memberId: string;
  name: string;
  rollNumber: string;
  college: string;
  department: string;
  year: number | string;
  isLeader: boolean;
  manualToken?: string;
  isAttended: boolean;
  certificateCode?: string;
  certificateType?: string;
}

export interface PodiumCandidate {
  teamId: string;
  registrationId: string;
  teamName: string;
  isTeam: boolean;
  leaderName: string;
  leaderRoll: string;
  leaderDept: string;
  leaderCollege: string;
  leaderYear: number | string;
  members: MemberInfo[];
  totalMembers: number;
  attendedMembers: number;
  isFullyAttended: boolean;
  isEligible: boolean;
  registrationStatus: string;
  paymentStatus: string;
  podiumStatus?: 'WINNER' | 'RUNNER' | 'THIRD_PLACE' | 'PARTICIPANT' | null;
  certificateCode?: string;
}

export function ResultsList() {
  // 1. Hierarchy Selection State
  const [events, setEvents] = useState<Event[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subEvents, setSubEvents] = useState<SubEvent[]>([]);

  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedSubEventId, setSelectedSubEventId] = useState<string>('');
  const [currentSubEvent, setCurrentSubEvent] = useState<any | null>(null);

  // 2. Candidate Data State (Grouped at Registration / Team Level)
  const [candidates, setCandidates] = useState<PodiumCandidate[]>([]);

  // 3. Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [collegeFilter, setCollegeFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');

  // 4. Candidate Selection State (active stage before confirmation)
  const [candidateTeamId, setCandidateTeamId] = useState<string | null>(null);
  const [isThirdSkipped, setIsThirdSkipped] = useState(false);
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({});

  // 5. Modal Dialog State
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    stage: 'WINNER' | 'RUNNER' | 'THIRD_PLACE' | 'SKIP_THIRD' | 'PUBLISH' | 'DIRECT_PUBLISH';
    teamId?: string;
    teamName?: string;
    candidateDetails?: PodiumCandidate;
  }>({ open: false, stage: 'WINNER' });

  // 6. Loading, Error, and Feedback States
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isActionInProgress, setIsActionInProgress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [isCorrectPublishedModalOpen, setIsCorrectPublishedModalOpen] = useState(false);

  // =========================================================================
  // STEP 1: INITIAL LOAD - FETCH EVENTS
  // =========================================================================
  useEffect(() => {
    async function loadEvents() {
      try {
        setError(null);

        const { data, error: err } = await supabase
          .from('events')
          .select('id, name, status')
          .order('name');

        if (err) throw err;
        setEvents((data as Event[]) || []);
      } catch (err: any) {
        console.error('Failed to load events:', err);
        setError(err.message || 'Failed to load events from database.');
      }
    }

    loadEvents();
  }, []);

  // =========================================================================
  // STEP 2: WHEN EVENT CHANGES - FETCH CATEGORIES
  // =========================================================================
  useEffect(() => {
    if (!selectedEventId) {
      setCategories([]);
      setSelectedCategoryId('');
      setSubEvents([]);
      setSelectedSubEventId('');
      setCurrentSubEvent(null);
      setCandidates([]);
      return;
    }

    async function loadCategories() {
      try {
        const { data, error: err } = await supabase
          .from('categories')
          .select('id, name, event_id, status')
          .eq('event_id', selectedEventId)
          .order('name');

        if (err) throw err;
        setCategories((data as Category[]) || []);
        setSelectedCategoryId('');
        setSubEvents([]);
        setSelectedSubEventId('');
        setCurrentSubEvent(null);
        setCandidates([]);
      } catch (err: any) {
        console.error('Failed to load categories:', err);
        setError(err.message || 'Failed to load categories.');
      }
    }

    loadCategories();
  }, [selectedEventId]);

  // =========================================================================
  // STEP 3: WHEN CATEGORY CHANGES - FETCH SUB-EVENTS
  // =========================================================================
  useEffect(() => {
    if (!selectedCategoryId) {
      setSubEvents([]);
      setSelectedSubEventId('');
      setCurrentSubEvent(null);
      setCandidates([]);
      return;
    }

    async function loadSubEvents() {
      try {
        const { data, error: err } = await supabase
          .from('sub_events')
          .select('id, name, category_id, event_id, status, participation_type, max_team_size, results_locked, results_published, winner_team_id, runner_team_id, third_team_id')
          .eq('category_id', selectedCategoryId)
          .order('name');

        if (err) throw err;
        setSubEvents((data as unknown as SubEvent[]) || []);
        setSelectedSubEventId('');
        setCurrentSubEvent(null);
        setCandidates([]);
      } catch (err: any) {
        console.error('Failed to load sub-events:', err);
        setError(err.message || 'Failed to load sub-events.');
      }
    }

    loadSubEvents();
  }, [selectedCategoryId]);

  // =========================================================================
  // STEP 4: LOAD SUB-EVENT WORKFLOW & CANDIDATES GROUPED BY REGISTRATION/TEAM
  // =========================================================================
  const loadSubEventWorkflowData = async (subEventId: string) => {
    if (!subEventId) {
      setCurrentSubEvent(null);
      setCandidates([]);
      setCandidateTeamId(null);
      return;
    }

    try {
      setIsLoadingCandidates(true);
      setError(null);
      setCandidateTeamId(null);

      // Fetch Sub-event, Confirmed Registrations, Attendance Records, and Certificates
      const [subRes, regRes, attendRes, certsRes] = await Promise.all([
        supabase.from('sub_events').select('*').eq('id', subEventId).single(),
        supabase
          .from('registrations')
          .select(`
            id,
            sub_event_id,
            status,
            payments (
              id,
              status
            ),
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
                manual_token
              )
            )
          `)
          .eq('sub_event_id', subEventId)
          .neq('status', 'CANCELLED'),
        supabase
          .from('attendance_records')
          .select('team_id, scanned_member_id')
          .eq('sub_event_id', subEventId),
        supabase
          .from('certificates')
          .select('id, team_member_id, type, status, certificate_code')
          .eq('sub_event_id', subEventId)
      ]);

      if (subRes.error) throw subRes.error;
      if (regRes.error) throw regRes.error;
      if (attendRes.error) throw attendRes.error;

      const subData = subRes.data;
      setCurrentSubEvent(subData);

      // Build Set of attended member IDs
      const attendedMemberIdSet = new Set<string>();

      (attendRes.data || []).forEach((a: any) => {
        if (a.scanned_member_id) attendedMemberIdSet.add(a.scanned_member_id);
      });

      // Certificates lookup map
      const certMap = new Map<string, any>();
      (certsRes.data || []).forEach((c: any) => {
        certMap.set(c.team_member_id, c);
      });

      // Group into canonical Podium Candidates (1 Candidate = 1 Team/Registration)
      const candidateList: PodiumCandidate[] = [];

      (regRes.data || []).forEach((reg: any) => {
        const payList = Array.isArray(reg.payments) ? reg.payments : reg.payments ? [reg.payments] : [];
        const payStatus = payList[0]?.status || 'PAID';

        const teamsList = Array.isArray(reg.teams) ? reg.teams : reg.teams ? [reg.teams] : [];

        teamsList.forEach((team: any) => {
          if (!team || !team.id) return;

          const rawMembers = Array.isArray(team.team_members) ? team.team_members : team.team_members ? [team.team_members] : [];
          
          // Map individual member attendance and certificates
          const memberList: MemberInfo[] = rawMembers.map((m: any) => {
            const isAttended = attendedMemberIdSet.has(m.id);
            const cert = certMap.get(m.id);
            return {
              memberId: m.id,
              name: m.snapshot_name || 'Participant',
              rollNumber: m.snapshot_roll_number || 'N/A',
              college: m.snapshot_college || 'KITS Akshar Institute of Technology',
              department: m.snapshot_department || 'Engineering',
              year: m.snapshot_year || 3,
              isLeader: Boolean(m.is_leader),
              manualToken: m.manual_token,
              isAttended,
              certificateCode: cert?.certificate_code,
              certificateType: cert?.type,
            };
          });

          // Identify Team Leader or fallback to first member
          const leader = memberList.find(m => m.isLeader) || memberList[0];
          const isTeam = memberList.length > 1 || (team.team_name && team.team_name !== 'Solo Participant');
          const totalMembers = memberList.length;
          const attendedMembers = memberList.filter(m => m.isAttended).length;
          const isFullyAttended = attendedMembers === totalMembers && totalMembers > 0;
          
          // An entry is eligible for podium if it has attended check-in and registration is confirmed
          const isEligible = attendedMembers > 0 && reg.status === 'CONFIRMED';

          let podiumStatus: 'WINNER' | 'RUNNER' | 'THIRD_PLACE' | 'PARTICIPANT' | null = null;
          if (subData.winner_team_id === team.id) podiumStatus = 'WINNER';
          else if (subData.runner_team_id === team.id) podiumStatus = 'RUNNER';
          else if (subData.third_team_id === team.id) podiumStatus = 'THIRD_PLACE';
          else if (subData.results_published) podiumStatus = 'PARTICIPANT';

          // Winner certificate code from leader
          const leaderCert = leader ? certMap.get(leader.memberId) : null;

          candidateList.push({
            teamId: team.id,
            registrationId: reg.id,
            teamName: team.team_name || (leader ? `${leader.name} (Solo)` : 'Solo Participant'),
            isTeam,
            leaderName: leader?.name || 'Participant',
            leaderRoll: leader?.rollNumber || 'N/A',
            leaderDept: leader?.department || 'Engineering',
            leaderCollege: leader?.college || 'KITS Akshar Institute of Technology',
            leaderYear: leader?.year || 3,
            members: memberList,
            totalMembers,
            attendedMembers,
            isFullyAttended,
            isEligible,
            registrationStatus: reg.status,
            paymentStatus: payStatus,
            podiumStatus,
            certificateCode: leaderCert?.certificate_code,
          });
        });
      });

      // Sort Candidates: Eligible first, then alphabetically by candidate/team name
      candidateList.sort((a, b) => {
        if (a.isEligible !== b.isEligible) return a.isEligible ? -1 : 1;
        return a.teamName.localeCompare(b.teamName);
      });

      setCandidates(candidateList);
    } catch (err: any) {
      console.error('Failed to load sub-event workflow data:', err);
      setError(err.message || 'Failed to load eligible candidates.');
    } finally {
      setIsLoadingCandidates(false);
    }
  };

  useEffect(() => {
    if (selectedSubEventId) {
      loadSubEventWorkflowData(selectedSubEventId);
    } else {
      setCurrentSubEvent(null);
      setCandidates([]);
    }
  }, [selectedSubEventId]);

  // =========================================================================
  // WORKFLOW STAGE DERIVATION (Progressive Sequence)
  // =========================================================================
  const eligibleCandidates = useMemo(() => {
    return candidates.filter((c) => c.isEligible);
  }, [candidates]);

  const eligibleCompetitorsCount = eligibleCandidates.length;

  const currentStage: 'SELECT_WINNER' | 'SELECT_RUNNER' | 'SELECT_THIRD' | 'READY_TO_PUBLISH' | 'DIRECT_PUBLISH' | 'PUBLISHED' = useMemo(() => {
    if (!currentSubEvent) return 'SELECT_WINNER';
    if (currentSubEvent.results_published) return 'PUBLISHED';

    // If sub-event has fewer than 2 eligible competitors (solo entries or teams),
    // winner selection and result locking are not required; direct certificate publishing is enabled.
    if (eligibleCompetitorsCount < 2) {
      return 'DIRECT_PUBLISH';
    }

    const hasWinner = Boolean(currentSubEvent.winner_team_id);
    const hasRunner = Boolean(currentSubEvent.runner_team_id);
    const hasThird = Boolean(currentSubEvent.third_team_id);

    if (hasWinner && hasRunner && (hasThird || isThirdSkipped)) {
      return 'READY_TO_PUBLISH';
    }
    if (hasWinner && hasRunner) {
      return 'SELECT_THIRD';
    }
    if (hasWinner) {
      return 'SELECT_RUNNER';
    }
    return 'SELECT_WINNER';
  }, [currentSubEvent, isThirdSkipped, eligibleCompetitorsCount]);

  // Filtered Candidates based on search and filters
  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      if (!c.isEligible) return false;

      if (collegeFilter !== 'ALL' && c.leaderCollege !== collegeFilter) return false;
      if (deptFilter !== 'ALL' && c.leaderDept !== deptFilter) return false;
      if (typeFilter !== 'ALL') {
        if (typeFilter === 'TEAM' && !c.isTeam) return false;
        if (typeFilter === 'SOLO' && c.isTeam) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTeam = c.teamName.toLowerCase().includes(q);
        const matchLeader = c.leaderName.toLowerCase().includes(q);
        const matchRoll = c.leaderRoll.toLowerCase().includes(q);
        const matchReg = c.registrationId.toLowerCase().includes(q);
        const matchMember = c.members.some(
          m => m.name.toLowerCase().includes(q) || m.rollNumber.toLowerCase().includes(q)
        );
        return matchTeam || matchLeader || matchRoll || matchReg || matchMember;
      }

      return true;
    });
  }, [candidates, collegeFilter, deptFilter, typeFilter, searchQuery]);

  // Unique Filter Options
  const uniqueColleges = useMemo(() => {
    return Array.from(new Set(candidates.filter(c => c.isEligible).map(c => c.leaderCollege))).filter(Boolean);
  }, [candidates]);

  const uniqueDepartments = useMemo(() => {
    return Array.from(new Set(candidates.filter(c => c.isEligible).map(c => c.leaderDept))).filter(Boolean);
  }, [candidates]);

  // Helper: Find locked candidate details
  const lockedWinner = useMemo(() => {
    if (!currentSubEvent?.winner_team_id) return null;
    return candidates.find(c => c.teamId === currentSubEvent.winner_team_id);
  }, [currentSubEvent, candidates]);

  const lockedRunner = useMemo(() => {
    if (!currentSubEvent?.runner_team_id) return null;
    return candidates.find(c => c.teamId === currentSubEvent.runner_team_id);
  }, [currentSubEvent, candidates]);

  const lockedThird = useMemo(() => {
    if (!currentSubEvent?.third_team_id) return null;
    return candidates.find(c => c.teamId === currentSubEvent.third_team_id);
  }, [currentSubEvent, candidates]);

  // Count of total eligible attended individuals
  const totalAttendedIndividuals = useMemo(() => {
    return candidates.reduce((acc, c) => acc + c.attendedMembers, 0);
  }, [candidates]);

  // Count of remaining participation certificates
  const participationCount = useMemo(() => {
    let count = totalAttendedIndividuals;
    if (lockedWinner) count -= lockedWinner.attendedMembers;
    if (lockedRunner) count -= lockedRunner.attendedMembers;
    if (lockedThird) count -= lockedThird.attendedMembers;
    return Math.max(0, count);
  }, [totalAttendedIndividuals, lockedWinner, lockedRunner, lockedThird]);

  // Toggle member view for a team card
  const toggleTeamExpand = (teamId: string) => {
    setExpandedTeams(prev => ({ ...prev, [teamId]: !prev[teamId] }));
  };

  // =========================================================================
  // PODIUM SELECTION & LOCKING ACTIONS
  // =========================================================================
  const handleInitiateLockWinner = () => {
    if (!candidateTeamId) return;
    const candidate = candidates.find(c => c.teamId === candidateTeamId);
    setConfirmModal({
      open: true,
      stage: 'WINNER',
      teamId: candidateTeamId,
      teamName: candidate?.teamName,
      candidateDetails: candidate,
    });
  };

  const handleInitiateLockRunner = () => {
    if (!candidateTeamId) return;
    const candidate = candidates.find(c => c.teamId === candidateTeamId);
    setConfirmModal({
      open: true,
      stage: 'RUNNER',
      teamId: candidateTeamId,
      teamName: candidate?.teamName,
      candidateDetails: candidate,
    });
  };

  const handleInitiateLockThird = () => {
    if (!candidateTeamId) return;
    const candidate = candidates.find(c => c.teamId === candidateTeamId);
    setConfirmModal({
      open: true,
      stage: 'THIRD_PLACE',
      teamId: candidateTeamId,
      teamName: candidate?.teamName,
      candidateDetails: candidate,
    });
  };

  const handleInitiateSkipThird = () => {
    setConfirmModal({
      open: true,
      stage: 'SKIP_THIRD',
    });
  };

  const handleInitiatePublish = () => {
    setConfirmModal({
      open: true,
      stage: 'PUBLISH',
    });
  };

  const handleInitiateDirectPublish = () => {
    setConfirmModal({
      open: true,
      stage: 'DIRECT_PUBLISH',
    });
  };

  // Execute Locking via Server-Side RPC
  const handleExecuteLock = async () => {
    if (!selectedSubEventId) return;

    try {
      setIsActionInProgress(true);
      setError(null);

      if (confirmModal.stage === 'WINNER') {
        const { error: rpcErr } = await supabase.rpc('lock_sub_event_podium_position', {
          p_sub_event_id: selectedSubEventId,
          p_position: 'WINNER',
          p_team_id: confirmModal.teamId,
        });
        if (rpcErr) throw rpcErr;
        setSuccessMessage(`1st Place — Winner (${confirmModal.teamName}) successfully locked in database.`);
      } else if (confirmModal.stage === 'RUNNER') {
        const { error: rpcErr } = await supabase.rpc('lock_sub_event_podium_position', {
          p_sub_event_id: selectedSubEventId,
          p_position: 'RUNNER',
          p_team_id: confirmModal.teamId,
        });
        if (rpcErr) throw rpcErr;
        setSuccessMessage(`2nd Place — Runner-Up (${confirmModal.teamName}) successfully locked in database.`);
      } else if (confirmModal.stage === 'THIRD_PLACE') {
        const { error: rpcErr } = await supabase.rpc('lock_sub_event_podium_position', {
          p_sub_event_id: selectedSubEventId,
          p_position: 'THIRD_PLACE',
          p_team_id: confirmModal.teamId,
        });
        if (rpcErr) throw rpcErr;
        setSuccessMessage(`3rd Place (${confirmModal.teamName}) successfully locked in database.`);
      } else if (confirmModal.stage === 'SKIP_THIRD') {
        const { error: rpcErr } = await supabase.rpc('lock_sub_event_podium_position', {
          p_sub_event_id: selectedSubEventId,
          p_position: 'SKIP_THIRD',
          p_team_id: null,
        });
        if (rpcErr) throw rpcErr;
        setIsThirdSkipped(true);
        setSuccessMessage('3rd Place skipped. Proceeding to Participation Certificates.');
      }

      setConfirmModal({ open: false, stage: 'WINNER' });
      setCandidateTeamId(null);
      await loadSubEventWorkflowData(selectedSubEventId);
    } catch (err: any) {
      console.error('Failed to lock podium position:', err);
      setError(err.message || 'Failed to lock position in database.');
    } finally {
      setIsActionInProgress(false);
    }
  };

  // Execute Publication via Server-Side RPC
  const handleExecutePublish = async () => {
    if (!selectedSubEventId || !currentSubEvent) return;

    try {
      setIsActionInProgress(true);
      setError(null);

      const isDirect = eligibleCompetitorsCount < 2;
      const winnerId = isDirect ? null : currentSubEvent.winner_team_id;
      const runnerId = isDirect ? null : currentSubEvent.runner_team_id;
      const thirdId = isDirect ? null : (currentSubEvent.third_team_id || null);

      if (!isDirect && (!winnerId || !runnerId)) {
        throw new Error('Winner and Runner-Up must be locked before publishing.');
      }

      const { data: pubData, error: pubErr } = await supabase.rpc('publish_sub_event_results_and_certificates', {
        p_sub_event_id: selectedSubEventId,
        p_winner_team_id: winnerId,
        p_runner_team_id: runnerId,
        p_third_team_id: thirdId,
      });

      if (pubErr) throw pubErr;

      setSuccessMessage(
        `Results published and ${pubData?.total_certificates || 'all'} certificates generated successfully!`
      );
      setConfirmModal({ open: false, stage: 'WINNER' });
      await loadSubEventWorkflowData(selectedSubEventId);
    } catch (err: any) {
      console.error('Failed to publish results:', err);
      setError(err.message || 'Failed to publish results.');
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-24 font-sans page-enter">
      <PageHeader
        title="Results & Certificates Declaration"
        description="Select competition hierarchy, pick Winner & Runner-Up from attended candidates, lock podium positions, and publish official certificates."
      />

      {/* Notifications */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button type="button" onClick={() => setSuccessMessage(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
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
          <button type="button" onClick={() => setError(null)} className="text-red-700 hover:text-red-900 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* =========================================================================
          COORDINATOR RESULT SUBMISSIONS REVIEW (SECTIONS 11-13, 20)
          ========================================================================= */}
      <PendingResultSubmissions
        onSubmissionsUpdated={() => {
          if (selectedSubEventId) {
            loadSubEventWorkflowData(selectedSubEventId);
          }
        }}
      />

      {/* =========================================================================
          1. TOP HIERARCHY SELECTOR (1. Event → 2. Category → 3. Sub-Event)
          ========================================================================= */}
      <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-200 shadow-2xs space-y-4">
        <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
          <Layers className="h-4 w-4 text-kits-blue" />
          <h2 className="text-xs font-black uppercase tracking-wider text-gray-900">
            1. Select Competition Track Hierarchy
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {/* Step 1: Event Selector */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
              1. Event <span className="text-kits-red">*</span>
            </label>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-medium focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue cursor-pointer"
            >
              <option value="">— Select Event —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          </div>

          {/* Step 2: Category Selector */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
              2. Category <span className="text-kits-red">*</span>
            </label>
            <select
              disabled={!selectedEventId}
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-medium focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 cursor-pointer"
            >
              <option value="">— Select Category —</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          {/* Step 3: Sub-Event Selector */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
              3. Sub-Event <span className="text-kits-red">*</span>
            </label>
            <select
              disabled={!selectedCategoryId}
              value={selectedSubEventId}
              onChange={(e) => setSelectedSubEventId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-medium focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 cursor-pointer"
            >
              <option value="">— Select Sub-Event —</option>
              {subEvents.map((sub) => (
                <option key={sub.id} value={sub.id}>{sub.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* =========================================================================
          OPERATIONAL CANDIDATE SELECTION & DECLARATION WORKFLOW
          ========================================================================= */}
      {!selectedSubEventId ? (
        <EmptyState
          title="Select a Sub-Event"
          description="Choose an Event, Category, and Sub-Event above to load attended candidates and manage results declaration."
          icon={<Layers className="h-10 w-10 text-gray-300" />}
        />
      ) : isLoadingCandidates ? (
        <LoadingState message="Loading attended candidate directory and live podium status..." />
      ) : (
        <div className="space-y-6">
          {/* =========================================================================
              PODIUM PROGRESS SUMMARY BAR
              ========================================================================= */}
          {eligibleCompetitorsCount < 2 && currentStage !== 'PUBLISHED' ? (
            <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl text-xs text-indigo-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <Award className="h-5 w-5 text-indigo-600 shrink-0" />
                <div>
                  <span className="font-black uppercase tracking-wider block text-indigo-950">
                    Direct Participation Workflow Active (&lt; 2 Competitors)
                  </span>
                  <span className="text-[11px] text-indigo-700">
                    {eligibleCompetitorsCount === 0
                      ? 'No attended competitors found for this sub-event.'
                      : `Only 1 competitor attended (${eligibleCandidates[0]?.teamName}). Winner and runner-up locking are bypassed.`}
                  </span>
                </div>
              </div>
              <span className="px-3 py-1 bg-indigo-100 text-indigo-900 text-[10px] font-black uppercase rounded-full tracking-wider shrink-0 self-start sm:self-auto">
                {eligibleCompetitorsCount} Eligible {currentSubEvent?.participation_type === 'TEAM' ? 'Team' : 'Participant'}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Winner Card */}
              <div className={`p-4 rounded-2xl border transition ${
                lockedWinner 
                  ? 'bg-amber-50/70 border-amber-300 shadow-2xs' 
                  : currentStage === 'SELECT_WINNER' 
                  ? 'bg-white border-amber-400 ring-1 ring-amber-400' 
                  : 'bg-gray-50 border-gray-200 opacity-60'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 flex items-center gap-1">
                    <Trophy className="h-3.5 w-3.5" />
                    1st Place — Winner
                  </span>
                  {lockedWinner ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-black text-[9px] uppercase tracking-wider flex items-center gap-1">
                      <Lock className="h-2.5 w-2.5" /> Locked
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold text-gray-400 uppercase">
                      {currentStage === 'SELECT_WINNER' ? 'Active Selection' : 'Pending'}
                    </span>
                  )}
                </div>
                <div className="mt-2 font-bold text-gray-900 text-xs">
                  {lockedWinner ? (
                    <div>
                      <span className="block font-black text-amber-900">{lockedWinner.teamName}</span>
                      <span className="text-[10px] text-gray-500 font-mono font-normal">
                        Leader: {lockedWinner.leaderName} ({lockedWinner.leaderRoll})
                      </span>
                    </div>
                  ) : (
                    <span className="text-gray-400 font-normal italic">
                      {currentStage === 'SELECT_WINNER' ? 'Select candidate below' : 'Select Winner First'}
                    </span>
                  )}
                </div>
              </div>

              {/* Runner-Up Card */}
              <div className={`p-4 rounded-2xl border transition ${
                lockedRunner 
                  ? 'bg-blue-50/70 border-blue-300 shadow-2xs' 
                  : currentStage === 'SELECT_RUNNER' 
                  ? 'bg-white border-blue-400 ring-1 ring-blue-400' 
                  : 'bg-gray-50 border-gray-200 opacity-60'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-kits-blue flex items-center gap-1">
                    <Medal className="h-3.5 w-3.5" />
                    2nd Place — Runner-Up
                  </span>
                  {lockedRunner ? (
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-kits-blue font-black text-[9px] uppercase tracking-wider flex items-center gap-1">
                      <Lock className="h-2.5 w-2.5" /> Locked
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold text-gray-400 uppercase">
                      {currentStage === 'SELECT_RUNNER' ? 'Active Selection' : lockedWinner ? 'Pending' : 'Locked — Select Winner First'}
                    </span>
                  )}
                </div>
                <div className="mt-2 font-bold text-gray-900 text-xs">
                  {lockedRunner ? (
                    <div>
                      <span className="block font-black text-kits-blue">{lockedRunner.teamName}</span>
                      <span className="text-[10px] text-gray-500 font-mono font-normal">
                        Leader: {lockedRunner.leaderName} ({lockedRunner.leaderRoll})
                      </span>
                    </div>
                  ) : (
                    <span className="text-gray-400 font-normal italic">
                      {currentStage === 'SELECT_RUNNER' ? 'Select candidate below' : 'Locked — Select Winner First'}
                    </span>
                  )}
                </div>
              </div>

              {/* 3rd Place Card */}
              <div className={`p-4 rounded-2xl border transition ${
                lockedThird 
                  ? 'bg-purple-50/70 border-purple-300 shadow-2xs' 
                  : isThirdSkipped 
                  ? 'bg-gray-100 border-gray-300' 
                  : currentStage === 'SELECT_THIRD' 
                  ? 'bg-white border-purple-400 ring-1 ring-purple-400' 
                  : 'bg-gray-50 border-gray-200 opacity-60'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-purple-700 flex items-center gap-1">
                    <Award className="h-3.5 w-3.5" />
                    3rd Place (Optional)
                  </span>
                  {lockedThird ? (
                    <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-black text-[9px] uppercase tracking-wider flex items-center gap-1">
                      <Lock className="h-2.5 w-2.5" /> Locked
                    </span>
                  ) : isThirdSkipped ? (
                    <span className="px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 font-bold text-[9px] uppercase tracking-wider">
                      Skipped
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold text-gray-400 uppercase">
                      {currentStage === 'SELECT_THIRD' ? 'Active Selection' : 'Locked — Select Runner-Up First'}
                    </span>
                  )}
                </div>
                <div className="mt-2 font-bold text-gray-900 text-xs">
                  {lockedThird ? (
                    <div>
                      <span className="block font-black text-purple-900">{lockedThird.teamName}</span>
                      <span className="text-[10px] text-gray-500 font-mono font-normal">
                        Leader: {lockedThird.leaderName} ({lockedThird.leaderRoll})
                      </span>
                    </div>
                  ) : isThirdSkipped ? (
                    <span className="text-gray-500 font-normal italic">3rd Place Declaration Skipped</span>
                  ) : (
                    <span className="text-gray-400 font-normal italic">
                      {currentStage === 'SELECT_THIRD' ? 'Select candidate or Skip' : 'Locked — Select Runner-Up First'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* =========================================================================
              ACTIVE STAGE ACTION BARS
              ========================================================================= */}
          {currentStage === 'DIRECT_PUBLISH' && (
            <div className="p-5 bg-gradient-to-r from-indigo-700 to-indigo-900 text-white rounded-3xl shadow-lg border border-indigo-600 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-indigo-200 shrink-0" />
                  <span className="font-black uppercase tracking-wide text-sm">
                    Direct Certificate Publishing Enabled
                  </span>
                </div>
                <p className="text-indigo-100 text-xs leading-relaxed max-w-2xl">
                  This sub-event has fewer than 2 participants/teams. Winner selection and result locking are not required. You can proceed directly with certificate publishing.
                </p>
              </div>
              <button
                type="button"
                disabled={isActionInProgress}
                onClick={handleInitiateDirectPublish}
                className="px-6 py-3 bg-white text-indigo-950 text-xs font-black uppercase tracking-wider rounded-xl hover:bg-indigo-50 disabled:opacity-50 transition shadow-md cursor-pointer flex items-center justify-center gap-2 shrink-0"
              >
                <Send className="h-4 w-4 text-indigo-600" />
                <span>Proceed with Direct Certificate Publishing</span>
              </button>
            </div>
          )}

          {currentStage === 'SELECT_WINNER' && (
            <div className="p-4 bg-amber-500 text-white rounded-2xl shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in">
              <div className="flex items-center gap-2.5">
                <Trophy className="h-5 w-5 shrink-0 text-amber-200" />
                <div>
                  <span className="font-black uppercase tracking-wide block text-xs sm:text-sm">Stage 1: Select 1st Place (Winner)</span>
                  <span className="text-amber-100 text-[11px]">
                    {candidateTeamId 
                      ? `Candidate Selected: ${candidates.find(c => c.teamId === candidateTeamId)?.teamName}` 
                      : 'Check the candidate (solo participant or team) below who won 1st Place'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled={!candidateTeamId || isActionInProgress}
                onClick={handleInitiateLockWinner}
                className="px-5 py-2.5 bg-gray-950 text-white text-xs font-black uppercase tracking-wider rounded-xl hover:bg-black disabled:opacity-40 transition shadow-2xs cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Lock Winner</span>
              </button>
            </div>
          )}

          {currentStage === 'SELECT_RUNNER' && (
            <div className="p-4 bg-kits-blue text-white rounded-2xl shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in">
              <div className="flex items-center gap-2.5">
                <Medal className="h-5 w-5 shrink-0 text-blue-200" />
                <div>
                  <span className="font-black uppercase tracking-wide block text-xs sm:text-sm">Stage 2: Select 2nd Place (Runner-Up)</span>
                  <span className="text-blue-100 text-[11px]">
                    {candidateTeamId 
                      ? `Candidate Selected: ${candidates.find(c => c.teamId === candidateTeamId)?.teamName}` 
                      : 'Winner is locked. Check the candidate who secured 2nd Place'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled={!candidateTeamId || isActionInProgress}
                onClick={handleInitiateLockRunner}
                className="px-5 py-2.5 bg-gray-950 text-white text-xs font-black uppercase tracking-wider rounded-xl hover:bg-black disabled:opacity-40 transition shadow-2xs cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Lock Runner-Up</span>
              </button>
            </div>
          )}

          {currentStage === 'SELECT_THIRD' && (
            <div className="p-4 bg-purple-700 text-white rounded-2xl shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in">
              <div className="flex items-center gap-2.5">
                <Award className="h-5 w-5 shrink-0 text-purple-200" />
                <div>
                  <span className="font-black uppercase tracking-wide block text-xs sm:text-sm">Stage 3: Select 3rd Place (Optional)</span>
                  <span className="text-purple-100 text-[11px]">
                    {candidateTeamId 
                      ? `Candidate Selected: ${candidates.find(c => c.teamId === candidateTeamId)?.teamName}` 
                      : 'Select 3rd place from remaining candidates or click Skip'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isActionInProgress}
                  onClick={handleInitiateSkipThird}
                  className="px-4 py-2 bg-purple-900/80 hover:bg-purple-900 text-purple-100 text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  Skip 3rd Place
                </button>
                <button
                  type="button"
                  disabled={!candidateTeamId || isActionInProgress}
                  onClick={handleInitiateLockThird}
                  className="px-5 py-2.5 bg-gray-950 text-white text-xs font-black uppercase tracking-wider rounded-xl hover:bg-black disabled:opacity-40 transition shadow-2xs cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>Lock 3rd Place</span>
                </button>
              </div>
            </div>
          )}

          {currentStage === 'READY_TO_PUBLISH' && (
            <div className="p-5 bg-emerald-600 text-white rounded-3xl shadow-lg border border-emerald-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-200 shrink-0" />
                  <span className="font-black uppercase tracking-wide text-sm">
                    Podium Selection Complete — Ready for Final Review
                  </span>
                </div>
                <p className="text-emerald-100 text-xs leading-relaxed">
                  Podium is fully locked. All <strong>{participationCount}</strong> remaining eligible attended participants will automatically receive <strong>PARTICIPATION</strong> certificates with unique 10-digit credentials upon feedback.
                </p>
              </div>
              <button
                type="button"
                disabled={isActionInProgress}
                onClick={handleInitiatePublish}
                className="px-6 py-3 bg-gray-950 text-white text-xs font-black uppercase tracking-wider rounded-xl hover:bg-black disabled:opacity-50 transition shadow-md cursor-pointer flex items-center justify-center gap-2 shrink-0"
              >
                <Send className="h-4 w-4 text-emerald-400" />
                <span>Generate & Publish Results</span>
              </button>
            </div>
          )}

          {currentStage === 'PUBLISHED' && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div>
                  <span className="font-black uppercase tracking-wider block">Official Results & Certificates Published</span>
                  <span className="text-[11px] text-emerald-700">
                    All digital certificates with unique codes (KITS-EOS-CERT-XXXXXXXXXX) have been issued and unlocked for students.
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase rounded-full tracking-wider shrink-0">
                  LIVE & VERIFIABLE
                </span>
                {currentSubEvent.result_edit_count >= 1 ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl text-xs font-black uppercase tracking-wider border border-gray-200 shadow-2xs">
                    <Lock className="h-3.5 w-3.5 text-gray-500" />
                    <span>EDIT USED — RESULT LOCKED</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsCorrectPublishedModalOpen(true)}
                    className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                    title="Edit Result (One-Time Administrative Correction)"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>Edit Result</span>
                  </button>
                )}
              </div>
              {currentSubEvent.result_edit_count >= 1 && (
                <div className="pt-2 border-t border-emerald-200/60 flex flex-wrap items-center justify-between text-[11px] text-emerald-900 gap-2 w-full">
                  <div className="flex items-center gap-2">
                    <span className="font-bold">Result correction used:</span>
                    <span className="font-black px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px]">YES</span>
                    {currentSubEvent.result_edited_at && (
                      <span className="text-emerald-700 font-medium">
                        • Edited on: {formatDateTime12h(currentSubEvent.result_edited_at)}
                      </span>
                    )}
                  </div>
                  {currentSubEvent.result_edit_reason && (
                    <div className="italic text-emerald-800 font-mono text-[10px] truncate max-w-md">
                      Reason: "{currentSubEvent.result_edit_reason}"
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* =========================================================================
              CANDIDATE DIRECTORY & SELECTION INTERFACE (Grouped by Team / Registration)
              ========================================================================= */}
          <div className="bg-white rounded-3xl border border-gray-200 shadow-2xs overflow-hidden space-y-4 p-5 sm:p-6">
            {/* Header & Subtitle */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-base font-black uppercase tracking-tight text-gray-900">
                  Attended Candidates for Podium Selection
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {currentStage === 'DIRECT_PUBLISH'
                    ? 'This sub-event has fewer than 2 participants/teams. Winner selection and result locking are not required. You can proceed directly with certificate publishing.'
                    : currentStage === 'SELECT_WINNER'
                    ? 'Select the team or solo participant who won 1st Place (Winner).'
                    : currentStage === 'SELECT_RUNNER'
                    ? 'Winner locked. Select the team or solo participant who secured 2nd Place (Runner-Up).'
                    : currentStage === 'SELECT_THIRD'
                    ? 'Runner-Up locked. Select the candidate for 3rd Place (Optional).'
                    : 'Podium locked. All remaining attended participants receive Participation Certificates.'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3 py-1 bg-blue-50 text-kits-blue font-bold text-xs rounded-xl border border-blue-100">
                  {filteredCandidates.length} Eligible Candidates
                </span>
                <span className="px-3 py-1 bg-gray-50 text-gray-600 font-bold text-xs rounded-xl border border-gray-200">
                  {totalAttendedIndividuals} Attended Members
                </span>
              </div>
            </div>

            {/* Search and Filters */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="relative flex-1 max-w-md">
                <Search className="h-3.5 w-3.5 text-gray-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Search team name, student, roll number, registration ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {uniqueDepartments.length > 0 && (
                  <select
                    value={deptFilter}
                    onChange={(e) => setDeptFilter(e.target.value)}
                    className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium cursor-pointer"
                  >
                    <option value="ALL">All Departments</option>
                    {uniqueDepartments.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                )}

                {uniqueColleges.length > 0 && (
                  <select
                    value={collegeFilter}
                    onChange={(e) => setCollegeFilter(e.target.value)}
                    className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium cursor-pointer max-w-[160px] truncate"
                  >
                    <option value="ALL">All Colleges</option>
                    {uniqueColleges.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}

                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium cursor-pointer"
                >
                  <option value="ALL">All Formats</option>
                  <option value="SOLO">Solo Entries</option>
                  <option value="TEAM">Team Entries</option>
                </select>
              </div>
            </div>

            {/* Candidate List (Cards / Rows) */}
            {filteredCandidates.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400 border border-gray-100 rounded-2xl bg-gray-50">
                No eligible attended candidates match the filter criteria.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCandidates.map((candidate, index) => {
                  const isWinner = currentSubEvent?.winner_team_id === candidate.teamId;
                  const isRunner = currentSubEvent?.runner_team_id === candidate.teamId;
                  const isThird = currentSubEvent?.third_team_id === candidate.teamId;
                  const isLocked = isWinner || isRunner || isThird;
                  const isCandidate = candidateTeamId === candidate.teamId;

                  // Podium Checkbox enable rule:
                  // Can only check if not locked and in active selection stage
                  const canSelect = !isLocked && (currentStage === 'SELECT_WINNER' || currentStage === 'SELECT_RUNNER' || currentStage === 'SELECT_THIRD');
                  const isExpanded = Boolean(expandedTeams[candidate.teamId]);

                  return (
                    <div
                      key={candidate.teamId}
                      className={`p-4 sm:p-5 rounded-2xl border transition ${
                        isWinner
                          ? 'bg-amber-50/70 border-amber-300 shadow-2xs'
                          : isRunner
                          ? 'bg-blue-50/70 border-blue-300 shadow-2xs'
                          : isThird
                          ? 'bg-purple-50/70 border-purple-300 shadow-2xs'
                          : isCandidate
                          ? 'bg-red-50/60 border-kits-red/50 ring-1 ring-kits-red/50'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        {/* Checkbox and Candidate Main Info */}
                        <div className="flex items-start sm:items-center gap-3.5">
                          {/* Checkbox ONLY exists at the team/candidate level */}
                          <div className="pt-0.5 sm:pt-0">
                            {canSelect ? (
                              <label className="flex items-center justify-center p-2 rounded-xl hover:bg-gray-100 transition cursor-pointer min-w-[44px] min-h-[44px]">
                                <input
                                  type="checkbox"
                                  checked={isCandidate}
                                  onChange={() => {
                                    if (isCandidate) {
                                      setCandidateTeamId(null);
                                    } else {
                                      setCandidateTeamId(candidate.teamId);
                                    }
                                  }}
                                  className="h-5 w-5 text-kits-red border-gray-300 rounded focus:ring-kits-red cursor-pointer"
                                />
                              </label>
                            ) : isLocked ? (
                              <div className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center">
                                <Lock className="h-4 w-4 text-gray-400" />
                              </div>
                            ) : (
                              <div className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-300 text-xs">
                                —
                              </div>
                            )}
                          </div>

                          <div className="space-y-1">
                            {/* Candidate Title & Badges */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] font-mono text-gray-400 font-bold">
                                #{String(index + 1).padStart(2, '0')}
                              </span>

                              <h4 className="text-sm sm:text-base font-black text-gray-900 tracking-tight">
                                {candidate.teamName}
                              </h4>

                              {/* Participation Format Badge */}
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider flex items-center gap-1 ${
                                candidate.isTeam 
                                  ? 'bg-blue-100 text-kits-blue border border-blue-200' 
                                  : 'bg-gray-100 text-gray-700 border border-gray-200'
                              }`}>
                                {candidate.isTeam ? <Users className="h-3 w-3" /> : <User className="h-3 w-3" />}
                                {candidate.isTeam ? 'TEAM' : 'SOLO'}
                              </span>

                              {/* Attendance Rate Pill */}
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border flex items-center gap-1 ${
                                candidate.isFullyAttended 
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}>
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                <span>{candidate.attendedMembers} / {candidate.totalMembers} ATTENDED</span>
                              </span>
                            </div>

                            {/* Subtitle Details */}
                            <div className="text-xs text-gray-600 flex items-center gap-2 flex-wrap font-medium">
                              <span>
                                {candidate.isTeam ? (
                                  <>Team Leader: <strong className="text-gray-900">{candidate.leaderName}</strong> ({candidate.leaderRoll})</>
                                ) : (
                                  <>Roll No: <strong className="text-gray-900">{candidate.leaderRoll}</strong></>
                                )}
                              </span>
                              <span className="text-gray-300">•</span>
                              <span>{candidate.leaderDept} (Yr {candidate.leaderYear})</span>
                              <span className="text-gray-300">•</span>
                              <span className="truncate max-w-[200px]" title={candidate.leaderCollege}>{candidate.leaderCollege}</span>
                              <span className="text-gray-300">•</span>
                              <span className="font-mono text-[11px] text-gray-400">Reg: {candidate.registrationId.slice(0, 8)}</span>
                            </div>

                            {/* Certificate Code (If published) */}
                            {candidate.certificateCode && (
                              <div className="flex items-center gap-1 font-mono text-[10px] text-kits-blue font-bold pt-0.5">
                                <Sparkles className="h-3 w-3 text-kits-red" />
                                <span>Podium Cert: {candidate.certificateCode}</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyCode(candidate.certificateCode!)}
                                  className="text-gray-400 hover:text-gray-700 cursor-pointer"
                                  title="Copy Certificate Code"
                                >
                                  {copiedCode === candidate.certificateCode ? (
                                    <Check className="h-3 w-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Status Badge & Member View Expand Button */}
                        <div className="flex items-center gap-3 self-end sm:self-center">
                          {/* Podium Status Pill */}
                          {isWinner ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                              <Trophy className="h-3.5 w-3.5 text-amber-600" />
                              1st Place — Winner
                            </span>
                          ) : isRunner ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100 text-kits-blue border border-blue-300 shadow-2xs">
                              <Medal className="h-3.5 w-3.5 text-kits-blue" />
                              2nd Place — Runner-Up
                            </span>
                          ) : isThird ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-100 text-purple-900 border border-purple-300 shadow-2xs">
                              <Award className="h-3.5 w-3.5 text-purple-600" />
                              3rd Place
                            </span>
                          ) : currentSubEvent?.results_published ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-gray-100 text-gray-700">
                              Participant
                            </span>
                          ) : (
                            <span className="text-gray-400 text-[11px] italic font-medium">
                              Eligible Candidate
                            </span>
                          )}

                          {/* Expand Members Roster (For Teams) */}
                          {candidate.isTeam && (
                            <button
                              type="button"
                              onClick={() => toggleTeamExpand(candidate.teamId)}
                              className="px-2.5 py-1 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-xs font-bold text-gray-700 transition cursor-pointer flex items-center gap-1 min-h-[36px]"
                            >
                              <span>{candidate.members.length} Members</span>
                              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Individual Member Roster (NO checkboxes on members!) */}
                      {candidate.isTeam && (isExpanded || isCandidate || isLocked) && (
                        <div className="mt-4 pt-3.5 border-t border-gray-100/80 space-y-2">
                          <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                            Team Members & Individual Attendance:
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {candidate.members.map((m) => (
                              <div
                                key={m.memberId}
                                className="p-2.5 bg-gray-50/80 rounded-xl border border-gray-200 flex items-center justify-between text-xs"
                              >
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-gray-900">{m.name}</span>
                                    {m.isLeader && (
                                      <span className="text-[9px] font-black uppercase px-1.5 py-0.2 bg-amber-100 text-amber-900 border border-amber-200 rounded">
                                        Leader
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-gray-500 font-mono">
                                    {m.rollNumber} • {m.department} (Yr {m.year}) • <span className="font-sans font-semibold text-gray-700">{m.college}</span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  {m.isAttended ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                                        <CheckCircle2 className="h-2.5 w-2.5" /> ATTENDED
                                      </span>
                                      <span className="text-[9px] font-bold text-emerald-700 hidden sm:inline">
                                        • Eligible
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-gray-100 text-gray-600 border border-gray-200">
                                        <Clock className="h-2.5 w-2.5" /> NOT ATTENDED
                                      </span>
                                      <span className="text-[9px] font-bold text-red-600 hidden sm:inline">
                                        • No Certificate
                                      </span>
                                    </div>
                                  )}
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
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          CONFIRMATION DIALOGS (WINNER, RUNNER, THIRD_PLACE, SKIP, PUBLISH)
          ========================================================================= */}
      {confirmModal.open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 space-y-5 shadow-2xl border border-gray-200 relative modal-dialog-animate modal-dialog-responsive max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-xl ${
                  confirmModal.stage === 'WINNER'
                    ? 'bg-amber-100 text-amber-800'
                    : confirmModal.stage === 'RUNNER'
                    ? 'bg-blue-100 text-kits-blue'
                    : confirmModal.stage === 'THIRD_PLACE'
                    ? 'bg-purple-100 text-purple-800'
                    : confirmModal.stage === 'DIRECT_PUBLISH'
                    ? 'bg-indigo-100 text-indigo-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {confirmModal.stage === 'WINNER' ? (
                    <Trophy className="h-5 w-5" />
                  ) : confirmModal.stage === 'RUNNER' ? (
                    <Medal className="h-5 w-5" />
                  ) : confirmModal.stage === 'THIRD_PLACE' ? (
                    <Award className="h-5 w-5" />
                  ) : confirmModal.stage === 'DIRECT_PUBLISH' ? (
                    <Award className="h-5 w-5" />
                  ) : (
                    <ShieldCheck className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                    {confirmModal.stage === 'WINNER'
                      ? 'Confirm 1st Place Winner'
                      : confirmModal.stage === 'RUNNER'
                      ? 'Confirm 2nd Place Runner-Up'
                      : confirmModal.stage === 'THIRD_PLACE'
                      ? 'Confirm 3rd Place'
                      : confirmModal.stage === 'SKIP_THIRD'
                      ? 'Skip 3rd Place Declaration?'
                      : confirmModal.stage === 'DIRECT_PUBLISH'
                      ? 'Direct Certificate Publishing'
                      : 'Generate & Publish Results?'}
                  </h3>
                  <p className="text-[11px] text-gray-500">Live Database Verification</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmModal({ open: false, stage: 'WINNER' })}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            {confirmModal.candidateDetails && (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-black text-gray-900 text-sm">
                    {confirmModal.candidateDetails.teamName}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                    confirmModal.candidateDetails.isTeam 
                      ? 'bg-blue-100 text-kits-blue' 
                      : 'bg-gray-200 text-gray-800'
                  }`}>
                    {confirmModal.candidateDetails.isTeam ? 'TEAM' : 'SOLO'}
                  </span>
                </div>

                <div className="text-[11px] text-gray-600 space-y-0.5 font-mono">
                  <div>Team Leader: <strong>{confirmModal.candidateDetails.leaderName}</strong> ({confirmModal.candidateDetails.leaderRoll})</div>
                  <div>Dept: <strong>{confirmModal.candidateDetails.leaderDept} (Yr {confirmModal.candidateDetails.leaderYear})</strong></div>
                  <div>College: <strong>{confirmModal.candidateDetails.leaderCollege}</strong></div>
                  <div>Attendance: <strong>{confirmModal.candidateDetails.attendedMembers} / {confirmModal.candidateDetails.totalMembers} Members Attended</strong></div>
                </div>

                {confirmModal.candidateDetails.isTeam && confirmModal.candidateDetails.members.length > 0 && (
                  <div className="pt-2 border-t border-gray-200 text-[10px] text-gray-500">
                    <span className="font-bold text-gray-700 block mb-1">Registered Members ({confirmModal.candidateDetails.members.length}):</span>
                    <ul className="list-disc list-inside space-y-0.5 font-mono">
                      {confirmModal.candidateDetails.members.map((m) => (
                        <li key={m.memberId} className="flex items-center justify-between">
                          <span>{m.name} ({m.rollNumber})</span>
                          <span className={m.isAttended ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold'}>
                            {m.isAttended ? 'ATTENDED (Eligible)' : 'NOT ATTENDED (No Certificate)'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {confirmModal.stage === 'DIRECT_PUBLISH' && (
              <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-2xl text-xs text-indigo-950 space-y-2">
                <span className="font-bold text-indigo-900 block">Direct Participation Certificate Generation:</span>
                <p className="text-[11px] text-indigo-800 leading-relaxed">
                  This sub-event has fewer than 2 eligible competitors ({eligibleCompetitorsCount} eligible {currentSubEvent?.participation_type === 'TEAM' ? 'team' : 'participant'}). Winner and runner-up podium selection are bypassed.
                </p>
                <ul className="space-y-1.5 text-[11px] text-gray-700">
                  <li className="flex items-start gap-1.5">
                    <span className="text-indigo-600 font-bold">•</span>
                    <span><strong>{totalAttendedIndividuals}</strong> attended participant(s) will directly receive official <strong>PARTICIPATION</strong> certificates with unique 10-digit codes.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-amber-600 font-bold">•</span>
                    <span>Absent registered participants will <strong>NOT</strong> receive certificates.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-emerald-600 font-bold">•</span>
                    <span>Results will be marked as published and locked in the database.</span>
                  </li>
                </ul>
              </div>
            )}

            {confirmModal.stage === 'PUBLISH' && (
              <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-2xl text-xs text-blue-950 space-y-2">
                <span className="font-bold text-kits-blue block">Final Results & Certificate Eligibility:</span>
                <ul className="space-y-1.5 text-[11px]">
                  <li>
                    <strong>1st Place (Winner):</strong> {lockedWinner?.teamName}
                    <span className="text-gray-600 block pl-3 text-[10px]">
                      • {lockedWinner?.attendedMembers} of {lockedWinner?.totalMembers} members attended (Only attended members receive Winner certificates)
                    </span>
                  </li>
                  <li>
                    <strong>2nd Place (Runner-Up):</strong> {lockedRunner?.teamName}
                    <span className="text-gray-600 block pl-3 text-[10px]">
                      • {lockedRunner?.attendedMembers} of {lockedRunner?.totalMembers} members attended (Only attended members receive Runner certificates)
                    </span>
                  </li>
                  {lockedThird && (
                    <li>
                      <strong>3rd Place:</strong> {lockedThird.teamName}
                      <span className="text-gray-600 block pl-3 text-[10px]">
                        • {lockedThird.attendedMembers} of {lockedThird.totalMembers} members attended (Only attended members receive 3rd Place certificates)
                      </span>
                    </li>
                  )}
                  <li>
                    <strong>Participation:</strong> {participationCount} eligible attended participants
                    <span className="text-gray-600 block pl-3 text-[10px]">
                      • Absent registered participants will NOT receive certificates
                    </span>
                  </li>
                </ul>
                <div className="p-2 bg-amber-50 rounded-xl border border-amber-200 text-[10px] text-amber-800 font-bold mt-2">
                  🔒 Server-Side Rule Enforced: Individuals with NOT ATTENDED status never receive certificates.
                </div>
              </div>
            )}

            <p className="text-xs text-gray-600 leading-relaxed">
              {confirmModal.stage === 'WINNER'
                ? 'Once locked, this candidate (team) will be permanently locked as the 1st Place Winner and cannot be selected as Runner-Up or Third Place.'
                : confirmModal.stage === 'RUNNER'
                ? 'Once locked, this candidate (team) will be permanently locked as the 2nd Place Runner-Up and cannot be selected for Third Place.'
                : confirmModal.stage === 'THIRD_PLACE'
                ? 'Once locked, this candidate (team) will receive the 3rd Place credential.'
                : confirmModal.stage === 'SKIP_THIRD'
                ? '3rd place will not be declared for this sub-event. All remaining attended participants will receive Participation Certificates.'
                : confirmModal.stage === 'DIRECT_PUBLISH'
                ? 'This action will atomically generate unique digital certificates (KITS-EOS-CERT-XXXXXXXXXX) for all attended participants and publish results directly.'
                : 'This action will atomically generate unique digital certificates (KITS-EOS-CERT-XXXXXXXXXX) for all podium and participation recipients and publish the outcome immediately.'}
            </p>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setConfirmModal({ open: false, stage: 'WINNER' })}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 cursor-pointer"
              >
                Cancel
              </button>

              {confirmModal.stage === 'PUBLISH' || confirmModal.stage === 'DIRECT_PUBLISH' ? (
                <button
                  type="button"
                  disabled={isActionInProgress}
                  onClick={handleExecutePublish}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 transition shadow-2xs cursor-pointer flex items-center gap-1.5"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{isActionInProgress ? 'Publishing...' : confirmModal.stage === 'DIRECT_PUBLISH' ? 'Yes, Publish Certificates' : 'Yes, Generate & Publish'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isActionInProgress}
                  onClick={handleExecuteLock}
                  className="px-6 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 disabled:opacity-50 transition shadow-2xs cursor-pointer flex items-center gap-1.5"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>{isActionInProgress ? 'Locking...' : confirmModal.stage === 'SKIP_THIRD' ? 'Yes, Skip 3rd Place' : 'Confirm & Lock'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          OPERATION B: CORRECT PUBLISHED RESULT MODAL (TWO-STEP SECURITY CONFIRMATION)
          ========================================================================= */}
      {isCorrectPublishedModalOpen && currentSubEvent && (
        <CorrectPublishedResultModal
          subEventId={currentSubEvent.id}
          subEventName={currentSubEvent.name}
          categoryName={categories.find(c => c.id === selectedCategoryId)?.name}
          eventName={events.find(e => e.id === selectedEventId)?.name}
          currentWinnerTeamId={currentSubEvent.winner_team_id || null}
          currentRunnerTeamId={currentSubEvent.runner_team_id || null}
          currentThirdTeamId={currentSubEvent.third_team_id || null}
          subEventUpdatedAt={currentSubEvent.updated_at || null}
          isOpen={isCorrectPublishedModalOpen}
          onClose={() => setIsCorrectPublishedModalOpen(false)}
          onSuccess={() => {
            setSuccessMessage(`Published results for "${currentSubEvent.name}" corrected successfully.`);
            loadSubEventWorkflowData(currentSubEvent.id);
          }}
        />
      )}
    </div>
  );
}
