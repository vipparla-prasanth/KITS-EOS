import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { useScrollLock, NotificationCenter } from '@kits-eos/shared';
import type { CoordinatorAccessValidation } from '../../components/CoordinatorProtectedRoute';
import { 
  getCoordinatorSessionToken, 
  clearCoordinatorSession, 
  getCoordinatorAuthHeaders,
  signOutCoordinator,
} from '../../utils/coordinatorSession';
import { 
  Users, 
  CheckCircle2, 
  Clock, 
  LogOut, 
  Search, 
  RefreshCw, 
  Sparkles,
  Calendar,
  Layers,
  LayoutGrid,
  ArrowLeft,
  MapPin,
  ChevronRight,
  CheckCheck,
  X,
  AlertTriangle,
  AlertCircle,
  CreditCard,
  FileText,
  ExternalLink,
  Paperclip,
  BarChart3,
  Trash2,
  CheckSquare,
  Square,
  Trophy,
  Check,
  Lock
} from 'lucide-react';
import { CoordinatorResultDeclaration } from '../../components/coordinator/CoordinatorResultDeclaration';
import type { Coordinator, CoordinatorAssignment } from '@kits-eos/shared/src/types/models';
import { 
  exportToExcel, 
  sortParticipantsCollegeAndAlphabetical, 
  REGISTRATION_ROSTER_HEADERS,
  COORDINATOR_OVERALL_REPORT_HEADERS,
  getRegistrationExportFilename 
} from '@kits-eos/shared/src/utils/export';
import type { ExcelExportSection } from '@kits-eos/shared/src/utils/export';
import { 
  resolveEffectiveEventStatus, 
  resolveEffectiveSubEventStatus 
} from '@kits-eos/shared/src/utils/eventLifecycle';
import { AttendanceVerificationHub } from '../../components/ui/AttendanceVerificationHub';
import { LogoutConfirmationModal } from '../../components/ui/LogoutConfirmationModal';
import { DigitalIdCardModal } from '../../components/credentials/DigitalIdCardModal';
import { DownloadButton } from '../../components/ui/DownloadButton';
import { ScopedAnalyticsView } from '../../components/analytics/ScopedAnalyticsView';

interface GroupedEvent {
  id: string;
  name: string;
  event?: any;
  effectiveStatus: string;
  assignments: CoordinatorAssignment[];
}

export function CoordinatorPortal() {
  const navigate = useNavigate();
  const validation = useOutletContext<CoordinatorAccessValidation | null>();

  const [coordinator, setCoordinator] = useState<Coordinator | null>(validation?.coordinator as any || null);
  const [assignments, setAssignments] = useState<CoordinatorAssignment[]>(validation?.assignments || []);
  const [groupedEvents, setGroupedEvents] = useState<GroupedEvent[]>([]);

  // Navigation State
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedSubEventId, setSelectedSubEventId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'ATTENDANCE' | 'PAYMENTS' | 'DOCUMENTS' | 'ANALYTICS' | 'RESULTS'>('ATTENDANCE');
  const [resultSubEventStatus, setResultSubEventStatus] = useState<string | null>(null);

  // Operational Data for active Sub-event
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(!validation);
  const [isRosterLoading, setIsRosterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Authorized Scoped Analytics State
  const [scopedAnalytics, setScopedAnalytics] = useState<any | null>(null);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [isScopedAnalyticsModalOpen, setIsScopedAnalyticsModalOpen] = useState(false);

  // Documents State
  const [subEventDocs, setSubEventDocs] = useState<any[]>([]);
  const [isDocsLoading, setIsDocsLoading] = useState(false);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);

  // Document Selection & Two-Step Deletion State
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [deleteModalStep, setDeleteModalStep] = useState<0 | 1 | 2>(0);
  const [isDeletingDocs, setIsDeletingDocs] = useState(false);
  const [deleteDocError, setDeleteDocError] = useState<string | null>(null);
  const [deleteDocSuccess, setDeleteDocSuccess] = useState<string | null>(null);

  // Payment Approval & Verification State
  const [paymentToConfirm, setPaymentToConfirm] = useState<any | null>(null);
  const [coordPaymentSearch, setCoordPaymentSearch] = useState('');
  const [coordPaymentFilter, setCoordPaymentFilter] = useState<'ALL' | 'PENDING' | 'PAID'>('ALL');
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<Set<string>>(new Set());
  const [paymentApprovalModal, setPaymentApprovalModal] = useState<{
    isOpen: boolean;
    paymentIds: string[];
    totalAmount: number;
    count: number;
    studentSummary?: string;
  } | null>(null);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  const [paymentActionMessage, setPaymentActionMessage] = useState<string | null>(null);

  // Digital ID Card Viewer State
  const [selectedIdCardParticipant, setSelectedIdCardParticipant] = useState<any | null>(null);

  // Filter & Export States
  const [attendanceFilter, setAttendanceFilter] = useState<'ALL' | 'ATTENDED' | 'PENDING'>('ALL');
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | 'SUCCESS' | 'PENDING'>('ALL');
  const [exportMessage, setExportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Logout Modal State
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  // Assignment Lifecycle State ('ACTIVE_ASSIGNMENTS' | 'SUB_EVENT_DELETED' | 'NO_ASSIGNMENT')
  const [assignmentState, setAssignmentState] = useState<'ACTIVE_ASSIGNMENTS' | 'SUB_EVENT_DELETED' | 'NO_ASSIGNMENT'>('ACTIVE_ASSIGNMENTS');

  // Safe scroll lock for modals in Coordinator Portal
  const isAnyCoordinatorModalOpen = Boolean(
    paymentToConfirm ||
    paymentApprovalModal?.isOpen ||
    selectedIdCardParticipant ||
    isLogoutModalOpen ||
    isScopedAnalyticsModalOpen ||
    deleteModalStep > 0
  );
  useScrollLock(isAnyCoordinatorModalOpen);

  const fetchCoordinatorAnalytics = async () => {
    const token = getCoordinatorSessionToken();
    if (!token) return;
    try {
      setIsAnalyticsLoading(true);
      setAnalyticsError(null);
      const { data, error: err } = await supabase.rpc('get_scope_analytics', {
        p_coordinator_token: token,
        p_event_id: selectedEventId || null,
        p_sub_event_id: selectedSubEventId || null,
      });
      if (err) throw err;
      if (!data?.success) {
        throw new Error(data?.message || 'Failed to load coordinator analytics.');
      }
      setScopedAnalytics(data);
    } catch (err: any) {
      console.error('Coordinator analytics fetch error:', err);
      setAnalyticsError(err.message || 'Failed to load assigned analytics.');
    } finally {
      setIsAnalyticsLoading(false);
    }
  };

  // Close Payment confirmation on Escape key
  useEffect(() => {
    if ((!paymentToConfirm && !paymentApprovalModal) || isConfirmingPayment) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPaymentToConfirm(null);
        setPaymentApprovalModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [paymentToConfirm, paymentApprovalModal, isConfirmingPayment]);

  // Close Document Deletion confirmation on Escape key
  useEffect(() => {
    if (deleteModalStep === 0 || isDeletingDocs) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDeleteModalStep(0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteModalStep, isDeletingDocs]);

  // Effective sub-event status strictly respecting parent Main Event authority
  // If parent Main Event is COMPLETED, all sub-events inside are strictly COMPLETED.
  const getSubEventEffectiveStatus = (sub: any, parentEvent?: any): string => {
    const pEv = parentEvent || currentEvent?.event || sub?.events || sub?.categories?.events;
    const pEffective = currentEvent?.effectiveStatus || (pEv ? (pEv.effective_status || resolveEffectiveEventStatus(pEv, Date.now())) : null);
    if (
      pEffective === 'COMPLETED' ||
      pEv?.manual_status === 'COMPLETED' ||
      pEv?.effective_status === 'COMPLETED' ||
      (pEv?.status as any) === 'COMPLETED'
    ) {
      return 'COMPLETED';
    }
    if (sub?.effective_status) {
      return sub.effective_status;
    }
    return resolveEffectiveSubEventStatus(sub, pEv, Date.now());
  };

  const groupAndSetEvents = (activeAssignments: CoordinatorAssignment[]) => {
    const eventMap = new Map<string, GroupedEvent>();

    activeAssignments.forEach((a) => {
      const sub = a.sub_events;
      const ev = sub?.events || sub?.categories?.events;
      const evId = ev?.id || sub?.event_id || 'DEFAULT_EVENT';
      const evName = (ev?.name || 'INSTITUTIONAL EVENT').toUpperCase();

      // Authoritative Main Event Status Determination
      // Priority: DB effective_status -> resolveEffectiveEventStatus -> manual_status
      let effectiveStatus = 'UPCOMING';
      if (ev) {
        if (ev.effective_status) {
          effectiveStatus = ev.effective_status;
        } else if (ev.manual_status === 'COMPLETED' || (ev.status as any) === 'COMPLETED') {
          effectiveStatus = 'COMPLETED';
        } else {
          effectiveStatus = resolveEffectiveEventStatus(ev, Date.now());
        }
      }

      if (!eventMap.has(evId)) {
        eventMap.set(evId, {
          id: evId,
          name: evName,
          event: ev,
          effectiveStatus,
          assignments: []
        });
      }
      eventMap.get(evId)!.assignments.push(a);
    });

    const eventsList = Array.from(eventMap.values());
    setGroupedEvents(eventsList);

    if (eventsList.length === 1) {
      setSelectedEventId(eventsList[0].id);
    } else if (selectedEventId && !eventMap.has(selectedEventId)) {
      setSelectedEventId(null);
      setSelectedSubEventId(null);
    }
  };

  const fetchCoordinatorAssignments = async (isInitial = false) => {
    const token = getCoordinatorSessionToken();
    if (!token) {
      clearCoordinatorSession();
      navigate('/', { replace: true });
      return;
    }

    try {
      if (isInitial) setIsLoading(true);
      setError(null);

      // Server-side session token derived assignment fetch
      const { data, error: rpcErr } = await supabase.rpc('validate_coordinator_session', {
        p_token: token,
      });

      if (rpcErr) {
        console.error('Coordinator session validation RPC failed code:', rpcErr.code);
        setError('Unable to load assigned events from the database.');
        return;
      }

      if (data?.coordinator) {
        setCoordinator(data.coordinator);
      }

      const activeAssignments: CoordinatorAssignment[] = data?.assignments || [];
      setAssignments(activeAssignments);
      groupAndSetEvents(activeAssignments);

      if (activeAssignments.length > 0) {
        setAssignmentState('ACTIVE_ASSIGNMENTS');
      } else {
        setAssignmentState('NO_ASSIGNMENT');
      }
    } catch {
      setError('An unexpected error occurred while loading assignments.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (validation?.coordinator) {
      setCoordinator(validation.coordinator as any);
      const activeAssignments = validation.assignments || [];
      setAssignments(activeAssignments);
      groupAndSetEvents(activeAssignments);
      setIsLoading(false);
    } else {
      fetchCoordinatorAssignments(true);
    }
  }, [validation]);

  const loadSubEventAttendance = async () => {
    const token = getCoordinatorSessionToken();
    if (!selectedSubEventId || !coordinator || !token) return;

    try {
      setIsRosterLoading(true);
      setRosterError(null);

      const { data, error: rosterErr } = await supabase.rpc('get_coordinator_sub_event_roster', {
        p_token: token,
        p_sub_event_id: selectedSubEventId,
      });

      if (rosterErr) {
        console.error('Coordinator roster RPC failed code:', rosterErr.code);
        setRosterError('Failed to load participant roster.');
        return;
      }

      if (data?.success) {
        setRegistrations(data.registrations || []);
        setAttendanceRecords(data.attendance || data.attendance_records || []);
      } else {
        setRosterError(data?.error || 'Failed to load participant roster.');
      }
    } catch {
      setRosterError('Unexpected error loading attendance roster.');
    } finally {
      setIsRosterLoading(false);
    }
  };

  const fetchSubEventDocs = async () => {
    const token = getCoordinatorSessionToken();
    if (!selectedSubEventId || !coordinator || !token) return;
    try {
      setIsDocsLoading(true);
      const { data, error } = await supabase.rpc('get_sub_event_documents_for_coordinator', {
        p_token: token,
        p_sub_event_id: selectedSubEventId,
      });
      if (!error && data?.success) {
        setSubEventDocs(data.documents || []);
      }
    } catch {
      // silent
    } finally {
      setIsDocsLoading(false);
    }
  };

  const toggleDocSelection = (docId: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const toggleSelectAllDocs = () => {
    if (selectedDocIds.size === subEventDocs.length && subEventDocs.length > 0) {
      setSelectedDocIds(new Set());
    } else {
      setSelectedDocIds(new Set(subEventDocs.map((d: any) => d.id)));
    }
  };

  const handleExecuteDeleteDocuments = async () => {
    if (isDeletingDocs || selectedDocIds.size === 0) return;
    try {
      setIsDeletingDocs(true);
      setDeleteDocError(null);
      setDeleteDocSuccess(null);

      const idsToDelete = Array.from(selectedDocIds);
      const authHeaders = getCoordinatorAuthHeaders();

      const { data, error } = await supabase.functions.invoke('coordinator-delete-document', {
        headers: authHeaders,
        body: {
          documentIds: idsToDelete,
        },
      });

      if (error) {
        throw new Error(error.message || 'Server error while deleting documents.');
      }

      if (!data) {
        throw new Error('No response returned from document deletion service.');
      }

      const { deleted_count, failed_count, results, partial_success, all_succeeded } = data;

      // Extract successfully deleted IDs
      const deletedIds = new Set(
        (results || [])
          .filter((r: any) => r.status === 'DELETED')
          .map((r: any) => r.id)
      );

      // Reconcile optimistic React state immediately
      if (deletedIds.size > 0) {
        setSubEventDocs((prev) => prev.filter((d: any) => !deletedIds.has(d.id)));
        setSelectedDocIds((prev) => {
          const next = new Set(prev);
          deletedIds.forEach((id: any) => next.delete(id));
          return next;
        });
      }

      // Close modal on completion
      setDeleteModalStep(0);

      // Set user-facing status message according to results
      if (all_succeeded || (deleted_count > 0 && failed_count === 0)) {
        setDeleteDocSuccess(
          `Successfully deleted ${deleted_count} uploaded document${deleted_count > 1 ? 's' : ''}.`
        );
      } else if (partial_success) {
        setDeleteDocError(
          `${deleted_count} document${deleted_count > 1 ? 's' : ''} deleted. ${failed_count} document${failed_count > 1 ? 's' : ''} could not be deleted.`
        );
      } else if (failed_count > 0 && deleted_count === 0) {
        const firstErrMsg = results?.find((r: any) => r.error)?.error;
        setDeleteDocError(
          `Failed to delete selected documents: ${firstErrMsg || 'Unauthorized or server error'}`
        );
      }

      // Reconcile from backend to guarantee complete database/storage synchronization
      await fetchSubEventDocs();
    } catch (err: any) {
      console.error('Delete documents error:', err);
      setDeleteDocError(err.message || 'Failed to delete documents.');
      setDeleteModalStep(0);
      await fetchSubEventDocs();
    } finally {
      setIsDeletingDocs(false);
    }
  };

  const handleDocumentAction = async (doc: any, mode: 'view' | 'download') => {
    if (!coordinator) return;
    try {
      setDownloadingDocId(doc.id);
      const authHeaders = getCoordinatorAuthHeaders();
      const { data, error } = await supabase.functions.invoke('admin-download-document', {
        headers: authHeaders,
        body: {
          document_id: doc.id,
          coordinator_id: coordinator.id,
          mode,
        }
      });

      if (error || !data?.signed_url) {
        throw new Error(error?.message || 'Failed to generate document access URL.');
      }

      if (mode === 'view') {
        window.open(data.signed_url, '_blank', 'noopener,noreferrer');
      } else {
        const link = document.createElement('a');
        link.href = data.signed_url;
        link.setAttribute('download', doc.file_name);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err: any) {
      alert('Unable to access file: ' + (err.message || 'Unauthorized or file missing'));
    } finally {
      setDownloadingDocId(null);
    }
  };

  const handleExecuteApproval = async () => {
    if (!coordinator || !paymentApprovalModal || paymentApprovalModal.paymentIds.length === 0) return;
    const token = getCoordinatorSessionToken();
    if (!token) {
      alert('Coordinator session expired. Please sign in again.');
      return;
    }

    try {
      setIsConfirmingPayment(true);
      const { data, error: rpcErr } = await supabase.rpc('confirm_bulk_payments', {
        p_payment_ids: paymentApprovalModal.paymentIds,
        p_token: token,
      });

      if (rpcErr) {
        throw new Error(rpcErr.message || 'Payment approval failed.');
      }

      if (data && data.success === false) {
        throw new Error(data.error || 'Payment approval failed.');
      }

      setPaymentActionMessage(
        `Successfully approved ${paymentApprovalModal.count} payment(s) (Total: ₹${paymentApprovalModal.totalAmount}). Registrations confirmed and ID cards unlocked.`
      );
      setSelectedPaymentIds(new Set());
      setPaymentApprovalModal(null);
      setPaymentToConfirm(null);
      await loadSubEventAttendance();
    } catch (err: any) {
      alert('Failed to approve payment: ' + (err.message || 'Unknown error'));
    } finally {
      setIsConfirmingPayment(false);
    }
  };

  const handleOpenBulkApprovalModal = () => {
    if (currentEvent?.effectiveStatus === 'COMPLETED') {
      alert('Cannot approve payments: The parent Main Event has been concluded (COMPLETED) by Administrator.');
      return;
    }
    if (selectedPaymentIds.size === 0) return;
    setPaymentApprovalModal({
      isOpen: true,
      paymentIds: Array.from(selectedPaymentIds),
      totalAmount: selectedTotalAmount,
      count: selectedPaymentIds.size,
    });
  };

  const handleOpenSingleApprovalModal = (p: any) => {
    if (currentEvent?.effectiveStatus === 'COMPLETED') {
      alert('Cannot approve payments: The parent Main Event has been concluded (COMPLETED) by Administrator.');
      return;
    }
    if (!p.paymentId) return;
    setPaymentApprovalModal({
      isOpen: true,
      paymentIds: [p.paymentId],
      totalAmount: p.amount,
      count: 1,
      studentSummary: `${p.studentName} (${p.rollNumber})`,
    });
  };

  const fetchSubEventResultStatus = async (subId: string) => {
    const token = getCoordinatorSessionToken();
    if (!subId || !token) return;
    try {
      const { data } = await supabase.rpc('get_coordinator_sub_event_result_status', {
        p_token: token,
        p_sub_event_id: subId,
      });
      if (data?.success) {
        setResultSubEventStatus(data.status);
      }
    } catch {
      // silent
    }
  };

  useEffect(() => {
    if (selectedSubEventId) {
      setSelectedDocIds(new Set());
      setSelectedPaymentIds(new Set());
      setPaymentApprovalModal(null);
      setPaymentToConfirm(null);
      setPaymentActionMessage(null);
      setCoordPaymentSearch('');
      setCoordPaymentFilter('ALL');
      setDeleteModalStep(0);
      setDeleteDocError(null);
      setDeleteDocSuccess(null);
      loadSubEventAttendance();
      fetchSubEventDocs();
      fetchSubEventResultStatus(selectedSubEventId);
    }
  }, [selectedSubEventId]);

  const handleConfirmLogout = async () => {
    setIsLogoutModalOpen(false);
    await signOutCoordinator(navigate);
  };

  // Active Context Objects
  const currentEvent = groupedEvents.find((e) => e.id === selectedEventId);
  const currentAssignment = assignments.find((a) => a.sub_event_id === selectedSubEventId);
  const currentSubEvent = currentAssignment?.sub_events;
  const coordinatorName = coordinator?.display_name || (coordinator as any)?.name || coordinator?.username || 'Coordinator';



  // Flatten registered participants for sub-event attendance table (INDIVIDUAL MEMBER ATTENDANCE)
  const attendedMemberIds = new Set(attendanceRecords.map((a) => a.scanned_member_id).filter(Boolean));

  // Compute eligible attended candidates for Result Declaration
  const eligibleCandidatesForResults = useMemo(() => {
    const list: {
      teamId: string;
      teamName: string;
      isTeam: boolean;
      leaderName: string;
      leaderCollege: string;
      membersCount: number;
      attendedCount: number;
    }[] = [];

    const seenTeamIds = new Set<string>();

    registrations.forEach((reg) => {
      if (reg.status !== 'CONFIRMED') return;
      const teamList = Array.isArray(reg.teams) ? reg.teams : reg.teams ? [reg.teams] : [];
      teamList.forEach((t: any) => {
        if (!t || !t.id || seenTeamIds.has(t.id)) return;
        const members = Array.isArray(t.team_members) ? t.team_members : t.team_members ? [t.team_members] : [];
        const attendedMembers = members.filter((m: any) =>
          m.is_attended !== undefined ? Boolean(m.is_attended) : attendedMemberIds.has(m.id)
        );
        if (attendedMembers.length === 0) return;

        const leader = members.find((m: any) => m.is_leader) || members[0];
        const isTeam = members.length > 1 || (t.team_name && t.team_name !== 'Solo Participant');
        const teamName = isTeam
          ? (t.team_name || 'Team')
          : (leader?.snapshot_name ? `${leader.snapshot_name} (Solo)` : 'Solo Participant');

        seenTeamIds.add(t.id);
        list.push({
          teamId: t.id,
          teamName,
          isTeam,
          leaderName: leader?.snapshot_name || 'Participant',
          leaderCollege: leader?.snapshot_college || 'KITS Akshar Institute of Technology',
          membersCount: members.length,
          attendedCount: attendedMembers.length,
        });
      });
    });

    return list;
  }, [registrations, attendanceRecords]);
  const participantRows: any[] = [];
  registrations.forEach((reg) => {
    const team = reg.teams?.[0] || reg.teams;
    const members = team?.team_members || [];

    members.forEach((m: any) => {
      const isMemberAttended = m.is_attended !== undefined ? Boolean(m.is_attended) : attendedMemberIds.has(m.id);
      const regPayment = (reg.payments && reg.payments.length > 0) ? reg.payments[0] : (reg.payment || null);
      participantRows.push({
        memberId: m.id,
        regId: reg.id,
        regCreatedAt: reg.created_at,
        teamId: team?.id,
        teamName: team?.team_name || 'Solo Participant',
        isLeader: m.is_leader,
        role: members.length > 1 ? (m.is_leader ? 'TEAM LEADER' : 'TEAM MEMBER') : 'SOLO PARTICIPANT',
        name: m.snapshot_name,
        rollNumber: m.snapshot_roll_number,
        college: m.snapshot_college,
        dept: m.snapshot_department,
        year: m.snapshot_year,
        email: m.email || '—',
        phone: m.phone || '—',
        manualToken: m.manual_token || '—',
        qrIdentity: m.qr_identity || null,
        isAttended: isMemberAttended,
        attendanceTime: m.attendance_record?.check_in_time || null,
        verificationMethod: m.attendance_record?.verification_method || (isMemberAttended ? 'VERIFIED' : '—'),
        regStatus: currentEvent?.effectiveStatus === 'COMPLETED' || currentEvent?.event?.manual_status === 'COMPLETED' ? 'COMPLETED' : reg.status,
        paymentMethod: regPayment?.payment_method || 'ONLINE',
        paymentStatus: regPayment?.status || (reg.status === 'CONFIRMED' ? 'SUCCESS' : 'PENDING'),
        paymentAmount: regPayment?.amount !== undefined ? regPayment.amount : 0,
        referenceId: regPayment?.reference_id || '—',
        documentCount: reg.document_count || 0,
        eventName: reg.sub_event?.event_name || currentEvent?.name || '—',
        categoryName: reg.sub_event?.category_name || '—',
        subEventName: reg.sub_event?.name || currentSubEvent?.name || '—',
        participationType: reg.sub_event?.participation_type || currentSubEvent?.participation_type || 'SOLO',
      });
    });
  });

  const filteredParticipants = participantRows.filter((p) => {
    const q = searchTerm.toLowerCase().trim();
    if (q) {
      const matchesSearch =
        p.name?.toLowerCase().includes(q) ||
        p.rollNumber?.toLowerCase().includes(q) ||
        p.teamName?.toLowerCase().includes(q) ||
        p.manualToken?.toLowerCase().includes(q) ||
        (p.email && p.email !== '—' && p.email.toLowerCase().includes(q)) ||
        (p.phone && p.phone !== '—' && p.phone.toLowerCase().includes(q));
      if (!matchesSearch) return false;
    }

    if (attendanceFilter === 'ATTENDED' && !p.isAttended) return false;
    if (attendanceFilter === 'PENDING' && p.isAttended) return false;

    if (paymentFilter === 'SUCCESS' && p.paymentStatus !== 'SUCCESS') return false;
    if (paymentFilter === 'PENDING' && p.paymentStatus === 'SUCCESS') return false;

    return true;
  });

  // Reusable Excel exporter enforcing full participant fields & institutional header
  const exportParticipantList = async (
    items: any[],
    scopeTitle: string,
    filename: string,
    subtitleInfo?: string
  ) => {
    if (items.length === 0) {
      setExportMessage({
        type: 'error',
        text: 'No participants match the selected filters. Please adjust your filters before exporting.'
      });
      return;
    }

    const sortedItems = sortParticipantsCollegeAndAlphabetical(items);

    const rows = sortedItems.map((p, idx) => [
      idx + 1,
      p.name || '—',
      p.rollNumber || '—',
      p.dept || '—',
      p.year ? `Year ${p.year}` : '—',
      p.college || 'KITS Akshar Institute of Technology',
      p.regCreatedAt ? formatDateTime12h(p.regCreatedAt) : '—',
      p.email || '—',
      p.phone || '—',
      p.eventName || '—',
      p.categoryName || '—',
      p.subEventName || '—',
      p.participationType || '—',
      p.teamName || 'Solo Participant',
      p.role || (p.isLeader ? 'TEAM LEADER' : 'TEAM MEMBER'),
      p.regStatus || 'CONFIRMED',
      p.paymentStatus || '—',
      p.paymentAmount !== undefined ? p.paymentAmount : 0,
      p.isAttended ? 'ATTENDED' : 'NOT ATTENDED',
      p.attendanceTime ? formatDateTime12h(p.attendanceTime) : (p.isAttended ? 'VERIFIED' : '—'),
      p.verificationMethod || (p.isAttended ? 'VERIFIED' : '—'),
      p.manualToken || '—',
      p.regId || '—',
    ]);

    await exportToExcel({
      filename,
      title: scopeTitle,
      subtitle: subtitleInfo || `Coordinator: ${coordinatorName} | Records: ${sortedItems.length} (College-wise & Alphabetical)`,
      headers: REGISTRATION_ROSTER_HEADERS,
      rows,
    });

    setExportMessage({
      type: 'success',
      text: `Successfully exported ${sortedItems.length} participant row(s) to ${filename}`
    });
  };

  const handleExportSubEventExcel = async () => {
    try {
      const filename = getRegistrationExportFilename({
        scopePrefix: 'KITS-EOS',
        eventName: currentEvent?.name,
        subEventName: currentSubEvent?.name,
        attendanceFilter: attendanceFilter as any,
      });

      const filterNotes: string[] = [];
      if (attendanceFilter !== 'ALL') filterNotes.push(`Attendance: ${attendanceFilter}`);
      if (paymentFilter !== 'ALL') filterNotes.push(`Payment: ${paymentFilter}`);
      if (searchTerm.trim()) filterNotes.push(`Search: "${searchTerm.trim()}"`);

      const subtitleInfo = filterNotes.length > 0
        ? `Coordinator: ${coordinatorName} | Active Filters: [${filterNotes.join(', ')}] | Records: ${filteredParticipants.length} (College-wise & Alphabetical)`
        : `Coordinator: ${coordinatorName} | Scope: Full Sub-Event Roster | Records: ${filteredParticipants.length} (College-wise & Alphabetical)`;

      await exportParticipantList(
        filteredParticipants,
        `${currentEvent?.name} — ${currentSubEvent?.name?.toUpperCase()}`,
        filename,
        subtitleInfo
      );
    } catch (err: any) {
      console.error('Export error:', err);
      setExportMessage({
        type: 'error',
        text: 'Failed to generate Excel export: ' + (err.message || 'Unknown error')
      });
      throw err;
    }
  };

  const fetchRosterForSubEvent = async (subEventId: string) => {
    const token = getCoordinatorSessionToken();
    if (!coordinator || !token) return [];
    try {
      const { data, error } = await supabase.rpc('get_coordinator_sub_event_roster', {
        p_token: token,
        p_sub_event_id: subEventId,
      });
      if (error || !data?.success) {
        return [];
      }
      const regs = data.registrations || [];
      const rows: any[] = [];
      regs.forEach((reg: any) => {
        const team = reg.teams?.[0] || reg.teams;
        const members = team?.team_members || [];
        const regPay = (reg.payments && reg.payments.length > 0) ? reg.payments[0] : (reg.payment || null);

        // Authoritative parent Main Event status precedence
        const parentEvStatus = reg.sub_event?.event_effective_status;
        const isParentCompleted =
          parentEvStatus === 'COMPLETED' ||
          currentEvent?.effectiveStatus === 'COMPLETED' ||
          currentEvent?.event?.manual_status === 'COMPLETED';
        const effectiveRegStatus = isParentCompleted ? 'COMPLETED' : (reg.status || 'CONFIRMED');
        const isPaid = regPay?.status === 'SUCCESS' || reg.status === 'CONFIRMED';

        members.forEach((m: any) => {
          rows.push({
            memberId: m.id,
            regId: reg.id,
            regCreatedAt: reg.created_at,
            teamId: team?.id,
            teamName: team?.team_name || 'Solo Participant',
            isLeader: m.is_leader,
            role: members.length > 1 ? (m.is_leader ? 'TEAM LEADER' : 'TEAM MEMBER') : 'SOLO PARTICIPANT',
            name: m.snapshot_name,
            rollNumber: m.snapshot_roll_number,
            college: m.snapshot_college,
            dept: m.snapshot_department,
            year: m.snapshot_year,
            email: m.email || '—',
            phone: m.phone || '—',
            manualToken: m.manual_token || '—',
            isAttended: Boolean(m.is_attended),
            attendanceTime: m.attendance_record?.check_in_time || null,
            verificationMethod: m.attendance_record?.verification_method || (m.is_attended ? 'VERIFIED' : '—'),
            regStatus: effectiveRegStatus,
            paymentMethod: regPay?.payment_method || 'ONLINE',
            paymentStatus: isPaid ? 'PAID' : 'UNPAID',
            rawPaymentStatus: regPay?.status || (reg.status === 'CONFIRMED' ? 'SUCCESS' : 'PENDING'),
            paymentAmount: regPay?.amount !== undefined ? regPay.amount : 0,
            referenceId: regPay?.reference_id || '—',
            documentCount: reg.document_count || 0,
            eventName: reg.sub_event?.event_name || currentEvent?.name || '—',
            categoryName: reg.sub_event?.category_name || '—',
            subEventName: reg.sub_event?.name || currentSubEvent?.name || '—',
            participationType: reg.sub_event?.participation_type || currentSubEvent?.participation_type || 'SOLO',
            subEventEffectiveStatus: isParentCompleted ? 'COMPLETED' : reg.sub_event?.effective_status,
          });
        });
      });
      return rows;
    } catch (e) {
      console.error('Fetch roster error:', e);
      return [];
    }
  };

  /**
   * Coordinator Operational Overall Participant List Download
   * Exports focused 8-column table grouped by Sub-Event section headings:
   * 1. S.No | 2. Name | 3. Roll Number | 4. Year | 5. Department | 6. Sub-Event | 7. Payment Status | 8. Status
   * Pure live database data, strict institutional styling, visually clear PAID/UNPAID distinction.
   */
  const handleDownloadOverallList = async (targetEvent?: GroupedEvent) => {
    setExportMessage(null);
    try {
      const activeAssignments = targetEvent ? targetEvent.assignments : assignments;
      if (activeAssignments.length === 0) {
        setExportMessage({
          type: 'error',
          text: 'No assigned sub-events available to export.',
        });
        return;
      }

      const sections: ExcelExportSection[] = [];
      let totalParticipantCount = 0;

      for (const assignment of activeAssignments) {
        const sub = assignment.sub_events;
        const subName = (sub?.name || 'Assigned Sub-Event').toUpperCase();
        const rosterRows = await fetchRosterForSubEvent(assignment.sub_event_id);

        // Sort participants alphabetically
        rosterRows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Focused operational participant columns (No sensitive internal credentials, IDs, or audit info)
        const sectionRows = rosterRows.map((p, idx) => [
          idx + 1,
          p.name || '—',
          p.rollNumber || '—',
          p.year ? `Year ${p.year}` : '—',
          p.dept || '—',
          p.subEventName || subName,
          p.paymentStatus || 'UNPAID',
          p.regStatus || 'CONFIRMED',
        ]);

        totalParticipantCount += sectionRows.length;

        sections.push({
          title: subName,
          subtitle: `Sub-Event: ${subName} | Department: ${(sub as any)?.department || 'All'} | Participants: ${sectionRows.length}`,
          rows: sectionRows,
        });
      }

      if (totalParticipantCount === 0) {
        setExportMessage({
          type: 'error',
          text: 'No participants registered in the assigned sub-event(s) yet.',
        });
        return;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const scopeName = targetEvent ? targetEvent.name.replace(/[^a-zA-Z0-9_-]/g, '_') : 'All_Assigned';
      const filename = `KITS_EOS_${scopeName}_Overall_Participants_${dateStr}.xlsx`;

      await exportToExcel({
        filename,
        title: targetEvent
          ? `${targetEvent.name} — Operational Participant List`
          : 'Coordinator Assigned Sub-Events — Overall Participant List',
        subtitle: `Coordinator: ${coordinatorName} | Sub-Events: ${sections.length} | Total Participants: ${totalParticipantCount} | Generated: ${new Date().toLocaleDateString('en-IN')}`,
        headers: COORDINATOR_OVERALL_REPORT_HEADERS,
        sections,
      });

      setExportMessage({
        type: 'success',
        text: `Successfully exported ${totalParticipantCount} participant(s) across ${sections.length} sub-event(s) to ${filename}`,
      });
    } catch (err: any) {
      console.error('Download overall list error:', err);
      setExportMessage({
        type: 'error',
        text: 'Failed to download overall participant list: ' + (err.message || 'Unknown error'),
      });
    }
  };

  const handleExportEventExcel = async (eventGroup: GroupedEvent) => {
    await handleDownloadOverallList(eventGroup);
  };

  const handleExportAllExcel = async () => {
    await handleDownloadOverallList();
  };

  // Authorized Sub-event Payments Mapping (Solo & Team handled consistently)
  const subEventPayments = useMemo(() => {
    return registrations.map((r) => {
      const p = (r.payments && r.payments.length > 0) ? r.payments[0] : (r.payment || null);
      const team = Array.isArray(r.teams) ? r.teams[0] : (r.teams || r.team);
      const members = Array.isArray(team?.team_members) ? team.team_members : (team?.members || []);
      const leader = members.find((m: any) => m.is_leader) || members[0];
      const isTeam = members.length > 1 || (team?.team_name && team.team_name !== 'Solo Participant');
      const teamName = isTeam ? (team?.team_name || 'Team') : 'Solo Participant';
      const membersCount = members.length || 1;
      const isPaid = p?.status === 'SUCCESS' || r.status === 'CONFIRMED';
      const fee = p?.amount !== undefined ? Number(p.amount) : 0;

      return {
        registrationId: r.id,
        regCreatedAt: r.created_at,
        regStatus: currentEvent?.effectiveStatus === 'COMPLETED' ? 'COMPLETED' : r.status,
        paymentId: p?.id || null,
        amount: fee,
        status: p?.status || (r.status === 'CONFIRMED' ? 'SUCCESS' : 'PENDING'),
        paymentMethod: p?.payment_method || (fee === 0 ? 'FREE' : 'COD'),
        referenceId: p?.reference_id || '—',
        studentName: leader?.snapshot_name || r.student_profiles?.full_name || 'Participant',
        rollNumber: leader?.snapshot_roll_number || r.student_profiles?.roll_number || 'N/A',
        department: leader?.snapshot_department || r.student_profiles?.department || 'N/A',
        college: leader?.snapshot_college || r.student_profiles?.college || 'N/A',
        email: leader?.email || r.student_profiles?.email || '—',
        phone: leader?.phone || r.student_profiles?.phone || '—',
        teamName,
        isTeam,
        membersCount,
        isPaid,
        isPending: !isPaid && p?.id != null,
        rawReg: r,
        leaderMember: leader,
      };
    });
  }, [registrations]);

  // KPI Live Totals
  const totalRegistrationsCount = subEventPayments.length;
  const pendingPaymentsList = useMemo(() => subEventPayments.filter((p) => !p.isPaid), [subEventPayments]);
  const paidPaymentsList = useMemo(() => subEventPayments.filter((p) => p.isPaid), [subEventPayments]);
  
  const pendingCount = pendingPaymentsList.length;
  const paidCount = paidPaymentsList.length;
  
  const totalExpectedAmount = useMemo(() => subEventPayments.reduce((sum, p) => sum + p.amount, 0), [subEventPayments]);
  const totalCollectedAmount = useMemo(() => paidPaymentsList.reduce((sum, p) => sum + p.amount, 0), [paidPaymentsList]);
  const totalPendingAmount = useMemo(() => pendingPaymentsList.reduce((sum, p) => sum + p.amount, 0), [pendingPaymentsList]);

  // Filtered Payments List
  const filteredPaymentList = useMemo(() => {
    return subEventPayments.filter((p) => {
      if (coordPaymentFilter === 'PENDING' && p.isPaid) return false;
      if (coordPaymentFilter === 'PAID' && !p.isPaid) return false;

      const q = coordPaymentSearch.toLowerCase().trim();
      if (!q) return true;

      return (
        p.studentName?.toLowerCase().includes(q) ||
        p.rollNumber?.toLowerCase().includes(q) ||
        p.registrationId?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.teamName?.toLowerCase().includes(q) ||
        p.status?.toLowerCase().includes(q) ||
        p.paymentMethod?.toLowerCase().includes(q) ||
        p.referenceId?.toLowerCase().includes(q)
      );
    });
  }, [subEventPayments, coordPaymentFilter, coordPaymentSearch]);

  // Selectable Pending Payments
  const selectablePendingPayments = useMemo(() => {
    return filteredPaymentList.filter((p) => p.isPending && p.paymentId);
  }, [filteredPaymentList]);

  const isAllSelectableSelected = selectablePendingPayments.length > 0 && selectablePendingPayments.every((p) => selectedPaymentIds.has(p.paymentId!));

  const toggleSelectAllPayments = () => {
    if (isAllSelectableSelected) {
      setSelectedPaymentIds((prev) => {
        const next = new Set(prev);
        selectablePendingPayments.forEach((p) => next.delete(p.paymentId!));
        return next;
      });
    } else {
      setSelectedPaymentIds((prev) => {
        const next = new Set(prev);
        selectablePendingPayments.forEach((p) => next.add(p.paymentId!));
        return next;
      });
    }
  };

  const togglePaymentSelection = (paymentId: string) => {
    setSelectedPaymentIds((prev) => {
      const next = new Set(prev);
      if (next.has(paymentId)) {
        next.delete(paymentId);
      } else {
        next.add(paymentId);
      }
      return next;
    });
  };

  const selectedPayments = useMemo(() => {
    return subEventPayments.filter((p) => p.paymentId && selectedPaymentIds.has(p.paymentId));
  }, [subEventPayments, selectedPaymentIds]);

  const selectedTotalAmount = useMemo(() => {
    return selectedPayments.reduce((sum, p) => sum + p.amount, 0);
  }, [selectedPayments]);

  const totalRegistered = participantRows.length;
  const totalAttended = participantRows.filter((p) => p.isAttended).length;
  const totalPending = totalRegistered - totalAttended;
  const attendanceRate = totalRegistered > 0 ? Math.round((totalAttended / totalRegistered) * 100) : 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-gray-900 font-sans">
        <div className="text-center space-y-3">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto text-kits-red" />
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Loading Coordinator Portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-20 w-full overflow-x-clip">
      {/* Top Institutional Header */}
      <header className="sticky top-2 sm:top-3 lg:top-4 z-30 px-2.5 sm:px-4 lg:px-8 font-sans shrink-0 header-enter pointer-events-none">
        <div className="max-w-7xl mx-auto glass-header-floating rounded-2xl sm:rounded-3xl pointer-events-auto transition-all duration-300">
          <div className="px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl bg-white border border-gray-200 p-0.5 flex items-center justify-center shadow-2xs overflow-hidden flex-shrink-0">
                <img
                  src="/college_logo.png"
                  alt="KITS-EOS Logo"
                  className="object-contain w-full h-full"
                />
              </div>
              <div>
                <div className="text-xs sm:text-sm font-black tracking-tight text-gray-900">
                  <span className="text-kits-red">KITS</span>
                  <span className="text-kits-blue">-EOS</span>
                </div>
                <span className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider text-gray-400 block truncate max-w-[90px] sm:max-w-none">
                  Operations
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
              {/* Manual Sync / Refresh Button */}
              <button
                type="button"
                onClick={() => fetchCoordinatorAssignments(false)}
                className="p-1.5 sm:p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 hover:text-gray-900 transition shadow-2xs cursor-pointer flex-shrink-0"
                title="Refresh Assignments"
              >
                <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>

              {/* Universal Notification Center with Auto Read-on-Open */}
              <NotificationCenter
                portal="COORDINATOR"
                token={getCoordinatorSessionToken()}
                onNavigate={(path) => navigate(path)}
              />

              <div className="text-right min-w-0 truncate max-w-[110px] sm:max-w-[200px] md:max-w-none">
                <div className="text-xs font-bold text-gray-900 truncate" title={`Welcome, ${coordinatorName}`}>
                  Welcome, {coordinatorName}
                </div>
                <div className="text-[10px] font-mono text-gray-500 hidden sm:block">@{coordinator?.username}</div>
              </div>

              <button
                type="button"
                onClick={() => navigate('/coordinator/select')}
                className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg border border-gray-200 hover:border-blue-200 bg-white hover:bg-blue-50 text-gray-700 hover:text-kits-blue text-xs font-bold transition shadow-2xs cursor-pointer flex-shrink-0"
                title="All Dashboards & Assignments"
              >
                <LayoutGrid className="h-3.5 w-3.5 text-[#003366]" />
                <span className="hidden sm:inline">All Dashboards</span>
              </button>

              <button
                onClick={() => setIsLogoutModalOpen(true)}
                className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg border border-red-200 hover:border-red-300 bg-white hover:bg-red-50 text-gray-700 hover:text-kits-red text-xs font-bold transition shadow-2xs cursor-pointer flex-shrink-0"
                title="Sign Out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-6 space-y-6 w-full min-w-0">
        {/* Dual Assignment Active Banner */}
        {Boolean(validation?.assigned_assessment?.id || (validation?.assigned_assessments && validation.assigned_assessments.length > 0)) && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-red-50 via-white to-blue-50 border border-blue-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-xl bg-blue-100 text-[#003366]">
                <Trophy className="w-5 h-5 text-[#003366]" />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-[#003366]">Dual Assignment Active</span>
                <p className="text-xs font-bold text-gray-900">
                  {validation?.assigned_assessments && validation.assigned_assessments.length > 1 ? (
                    <>You are assigned to host <span className="text-[#C8102E] font-bold">{validation.assigned_assessments.length} examinations</span></>
                  ) : (
                    <>You are also assigned to host examination: <span className="text-[#C8102E]">{validation?.assigned_assessment?.title || validation?.assigned_assessments?.[0]?.title}</span></>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                if (validation?.assigned_assessments && validation.assigned_assessments.length > 1) {
                  navigate('/coordinator/select');
                } else if (validation?.assigned_assessment?.id) {
                  navigate(`/coordinator/assessment-host/${validation.assigned_assessment.id}`);
                } else {
                  navigate('/coordinator/assessment-host');
                }
              }}
              className="inline-flex items-center px-4 py-2 rounded-xl bg-[#003366] hover:bg-[#002852] text-white text-xs font-bold transition shadow-sm cursor-pointer whitespace-nowrap"
            >
              Open Live Host Console →
            </button>
          </div>
        )}

        {/* Compact Reference-Inspired Welcome Panel */}
        <div className="bg-[#081a30] text-white rounded-2xl sm:rounded-3xl px-4 py-3.5 sm:px-6 sm:py-4 shadow-sm border border-[#0f2c52] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5">
          <div className="space-y-1.5 min-w-0">
            {/* Active Session Pill */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 text-white/90 border border-white/10 text-[10px] sm:text-[11px] font-black uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>KITS-EOS COORDINATOR CONSOLE • ACTIVE SESSION</span>
            </div>

            {/* Dynamic Welcome Greeting */}
            <h1 className="text-lg sm:text-2xl font-black text-white tracking-tight truncate">
              Welcome back, {coordinatorName}
            </h1>

            {/* Identity Metadata */}
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="px-2 py-0.5 rounded-md bg-white/10 text-white/80 font-mono text-[11px]">
                @{coordinator?.username}
              </span>
              <span className="text-white/40">•</span>
              <span className="text-white/70 font-semibold text-xs">Coordinator Operations</span>
            </div>
          </div>

          {/* Existing Coordinator Action Buttons */}
          <div className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => { setSelectedEventId(null); setSelectedSubEventId(null); }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-kits-red hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider transition shadow-2xs cursor-pointer"
              title="View Assigned Events"
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>Assigned Events</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!selectedEventId && groupedEvents.length > 0) {
                  const ev = groupedEvents[0];
                  setSelectedEventId(ev.id);
                  if (ev.assignments.length > 0) {
                    setSelectedSubEventId(ev.assignments[0].sub_event_id);
                  }
                } else if (selectedEventId && !selectedSubEventId && currentEvent?.assignments.length) {
                  setSelectedSubEventId(currentEvent.assignments[0].sub_event_id);
                }
                setActiveTab('ATTENDANCE');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white border border-white/15 text-xs font-bold uppercase tracking-wider transition shadow-2xs cursor-pointer"
              title="Open Attendance Check-in"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Attendance</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsScopedAnalyticsModalOpen(true);
                fetchCoordinatorAnalytics();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white border border-white/15 text-xs font-bold uppercase tracking-wider transition shadow-2xs cursor-pointer"
              title="View Scope Analytics"
            >
              <BarChart3 className="h-3.5 w-3.5 text-amber-400" />
              <span>Scope Analytics</span>
            </button>

            {assignments.length > 0 && (
              <DownloadButton
                onDownload={() => handleDownloadOverallList(currentEvent || undefined)}
                label="Download Overall List"
                preparingLabel="Preparing List..."
                downloadingLabel="Generating Excel..."
                completedLabel="Downloaded"
                variant="success"
                size="sm"
                className="flex-shrink-0"
                title="Download simple operational participant list for assigned sub-events"
              />
            )}
          </div>
        </div>

        {/* =========================================================================
            LEVEL 1: ASSIGNED EVENTS SELECTION SCREEN (When no event is chosen)
            ========================================================================= */}
        {!selectedEventId && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-kits-red flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                Institutional Event Assignments
              </span>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-gray-900 tracking-tight">
                    ASSIGNED EVENTS
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Select an assigned event below to open its coordinator operations dashboard.
                  </p>
                </div>
                {groupedEvents.length > 0 && (
                  <DownloadButton
                    onDownload={handleExportAllExcel}
                    label="Download Overall List"
                    preparingLabel="Preparing List..."
                    downloadingLabel="Generating Excel..."
                    completedLabel="Downloaded"
                    variant="success"
                    size="sm"
                    className="self-start sm:self-auto"
                    title="Download simple operational participant list (Excel) for all assigned sub-events"
                  />
                )}
              </div>
            </div>

            {error ? (
              <div className="bg-white p-10 sm:p-12 rounded-3xl border border-red-200 shadow-2xs text-center space-y-4">
                <div className="h-12 w-12 rounded-2xl bg-red-50 text-kits-red flex items-center justify-center mx-auto shadow-2xs">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-black text-gray-900 tracking-tight">
                    Unable to load assigned events
                  </h3>
                  <p className="text-xs text-red-600 font-mono max-w-md mx-auto leading-relaxed">
                    {error}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fetchCoordinatorAssignments(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-bold uppercase tracking-wider hover:bg-red-700 transition shadow-2xs cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>Retry Loading</span>
                </button>
              </div>
            ) : groupedEvents.length === 0 ? (
              assignmentState === 'SUB_EVENT_DELETED' ? (
                <div className="bg-white p-10 sm:p-12 rounded-3xl border border-red-200 shadow-2xs text-center space-y-3">
                  <div className="h-12 w-12 rounded-2xl bg-red-50 text-kits-red flex items-center justify-center mx-auto shadow-2xs">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-black text-gray-900 tracking-tight">
                    Sorry {coordinator?.display_name || 'Coordinator'}, the sub-event has been deleted by the admin.
                  </h3>
                  <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed font-normal">
                    The operational sub-event previously assigned to your account was permanently removed by the Administrator. 
                    Please reach out to the administrative team if you require a new assignment.
                  </p>
                </div>
              ) : (
                <div className="bg-white p-12 rounded-3xl border border-gray-200 text-center space-y-2">
                  <Calendar className="h-10 w-10 text-gray-300 mx-auto" />
                  <h3 className="text-sm font-bold text-gray-900">No Events Assigned</h3>
                  <p className="text-xs text-gray-500 max-w-md mx-auto">
                    Your coordinator account has no active event or sub-event assignments. Contact administrators.
                  </p>
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {groupedEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs hover:border-kits-blue hover:shadow-xs transition space-y-4 flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="p-3 bg-red-50 text-kits-red rounded-xl w-fit border border-red-100">
                          <Calendar className="h-5 w-5" />
                        </div>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          ev.effectiveStatus === 'COMPLETED' ? 'bg-indigo-100 text-indigo-900 border border-indigo-200' :
                          ev.effectiveStatus === 'LIVE' ? 'bg-emerald-100 text-emerald-900 border border-emerald-200' :
                          'bg-blue-100 text-blue-900 border border-blue-200'
                        }`}>
                          {ev.effectiveStatus}
                        </span>
                      </div>
                      <h3 className="text-lg font-black text-gray-900 tracking-tight">
                        {ev.name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs text-gray-600 font-bold">
                        <Layers className="h-3.5 w-3.5 text-kits-blue" />
                        <span>{ev.assignments.length} Assigned Sub-event{ev.assignments.length > 1 ? 's' : ''}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => setSelectedEventId(ev.id)}
                      className="w-full py-2.5 px-4 rounded-xl bg-gray-900 hover:bg-kits-red text-white text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-2xs"
                    >
                      <span>Open Event Dashboard</span>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            LEVEL 2: EVENT DASHBOARD & ASSIGNED SUB-EVENTS (Event selected, no sub-event)
            ========================================================================= */}
        {selectedEventId && !selectedSubEventId && currentEvent && (
          <div className="space-y-6">
            {/* Breadcrumbs & Navigation */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-gray-500 font-bold">
                <button
                  onClick={() => setSelectedEventId(null)}
                  className="hover:text-kits-red transition"
                >
                  COORDINATOR OPERATIONS
                </button>
                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-gray-900 font-black">{currentEvent.name}</span>
              </div>

              {groupedEvents.length > 1 && (
                <button
                  onClick={() => setSelectedEventId(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 transition"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Switch Event</span>
                </button>
              )}
            </div>

            {/* Event Header Banner */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
                    <span>Welcome, <strong className="text-gray-900">{coordinatorName}</strong></span>
                  </div>
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <span className="text-xs font-black uppercase text-kits-red">Selected Event:</span>
                    <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                      {currentEvent.name}
                    </h2>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      currentEvent.effectiveStatus === 'COMPLETED' ? 'bg-indigo-100 text-indigo-900 border border-indigo-200' :
                      currentEvent.effectiveStatus === 'LIVE' ? 'bg-emerald-100 text-emerald-900 border border-emerald-200' :
                      'bg-blue-100 text-blue-900 border border-blue-200'
                    }`}>
                      {currentEvent.effectiveStatus}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Select one of your assigned sub-events below to perform participant check-ins and review attendance.
                  </p>
                  {currentEvent.effectiveStatus === 'COMPLETED' && (
                    <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-2 text-xs font-bold text-indigo-900 mt-2">
                      <AlertCircle className="h-4 w-4 text-indigo-600 flex-shrink-0" />
                      <span>Event Concluded: This Main Event is marked COMPLETED by Administrator. All sub-events and operations under this event are in COMPLETED status.</span>
                    </div>
                  )}
                </div>
                {currentEvent.assignments.length > 0 && (
                  <DownloadButton
                    onDownload={() => handleExportEventExcel(currentEvent)}
                    label="Download Overall List"
                    preparingLabel="Preparing List..."
                    downloadingLabel="Generating Excel..."
                    completedLabel="Downloaded"
                    variant="success"
                    size="sm"
                    className="self-start sm:self-auto"
                    title={`Download simple operational participant list for ${currentEvent.name}`}
                  />
                )}
              </div>
            </div>

            {/* Assigned Sub-events List */}
            <div className="space-y-4">
              <h3 className="text-sm font-black uppercase tracking-tight text-gray-900">
                ASSIGNED SUB-EVENTS ({currentEvent.assignments.length})
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {currentEvent.assignments.map((a) => {
                  const sub = a.sub_events;
                  const isTeam = sub?.participation_type === 'TEAM';
                  const subEffectiveStatus = getSubEventEffectiveStatus(sub, currentEvent.event);

                  return (
                    <div
                      key={a.sub_event_id}
                      className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs hover:border-kits-red hover:shadow-xs transition space-y-4 flex flex-col justify-between"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                              isTeam ? 'bg-blue-50 text-kits-blue border border-blue-200' : 'bg-gray-100 text-gray-700 border border-gray-200'
                            }`}>
                              {isTeam ? <Users className="h-3 w-3" /> : null}
                              {sub?.participation_type || 'SOLO'}
                            </span>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              subEffectiveStatus === 'COMPLETED' ? 'bg-indigo-100 text-indigo-900 border border-indigo-200' :
                              subEffectiveStatus === 'LIVE' ? 'bg-emerald-100 text-emerald-900 border border-emerald-200' :
                              'bg-blue-100 text-blue-900 border border-blue-200'
                            }`}>
                              {subEffectiveStatus}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono font-bold text-gray-400">
                            Assigned Coordinator
                          </span>
                        </div>

                        <h4 className="text-lg font-black text-gray-900 tracking-tight">
                          {sub?.name?.toUpperCase()}
                        </h4>

                        {sub?.venue && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <MapPin className="h-3.5 w-3.5 text-gray-400" />
                            <span>Venue: {sub.venue}</span>
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => setSelectedSubEventId(a.sub_event_id)}
                        className="w-full py-2.5 px-4 rounded-xl bg-kits-red hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-2xs"
                      >
                        <span>Open Sub-Event Attendance</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            LEVEL 3: SUB-EVENT ATTENDANCE OPERATIONS (Single-Column Vertical Layout)
            ========================================================================= */}
        {selectedEventId && selectedSubEventId && currentEvent && currentSubEvent && (
          <div className="space-y-6">
            {/* Breadcrumb Context Navigation */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-gray-500 font-bold flex-wrap">
                <button onClick={() => { setSelectedEventId(null); setSelectedSubEventId(null); }} className="hover:text-kits-red">
                  COORDINATOR OPERATIONS
                </button>
                <ChevronRight className="h-3 w-3 text-gray-400" />
                <button onClick={() => setSelectedSubEventId(null)} className="hover:text-kits-red">
                  {currentEvent.name}
                </button>
                <ChevronRight className="h-3 w-3 text-gray-400" />
                <span className="text-gray-900 font-black">{currentSubEvent.name?.toUpperCase()}</span>
                <ChevronRight className="h-3 w-3 text-gray-400" />
                <span className="text-kits-red font-black">ATTENDANCE</span>
              </div>

              <button
                onClick={() => setSelectedSubEventId(null)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 transition"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to Sub-Events</span>
              </button>
            </div>

            {/* Scope Details Banner */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs border-b border-gray-100 pb-3">
                <div>
                  <span className="text-gray-400 block text-[10px] font-bold uppercase">Event</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-black text-gray-900">{currentEvent.name}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                      currentEvent.effectiveStatus === 'COMPLETED' ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900'
                    }`}>
                      {currentEvent.effectiveStatus}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] font-bold uppercase">Sub-Event</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-black text-kits-red">{currentSubEvent.name?.toUpperCase()}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                      getSubEventEffectiveStatus(currentSubEvent, currentEvent.event) === 'COMPLETED' ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900'
                    }`}>
                      {getSubEventEffectiveStatus(currentSubEvent, currentEvent.event)}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] font-bold uppercase">Coordinator</span>
                  <span className="font-bold text-gray-900">Welcome, {coordinatorName}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] font-bold uppercase">Status Authority</span>
                  <span className="font-mono text-[11px] font-bold text-gray-600">Admin-Controlled</span>
                </div>
              </div>
              {currentEvent.effectiveStatus === 'COMPLETED' && (
                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-2 text-xs font-bold text-indigo-900 mt-2">
                  <AlertCircle className="h-4 w-4 text-indigo-600 flex-shrink-0" />
                  <span>This Main Event has been concluded (COMPLETED) by Administrator. Operations are in archived/read-only mode.</span>
                </div>
              )}
            </div>

            {/* Tab Navigation for Sub-Event Operations */}
            <div className="flex items-center gap-2 border-b border-gray-200 pb-2 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveTab('ATTENDANCE')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                  activeTab === 'ATTENDANCE'
                    ? 'bg-kits-red text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Attendance & Check-in</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('PAYMENTS')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                  activeTab === 'PAYMENTS'
                    ? 'bg-kits-red text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                <CreditCard className="h-4 w-4" />
                <span>Approve Payments</span>
                {pendingCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                    {pendingCount} PENDING
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab('DOCUMENTS'); fetchSubEventDocs(); }}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                  activeTab === 'DOCUMENTS'
                    ? 'bg-kits-red text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                <Paperclip className="h-4 w-4" />
                <span>Uploaded Documents</span>
                {subEventDocs.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-gray-100 text-gray-700">
                    {subEventDocs.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab('ANALYTICS'); fetchCoordinatorAnalytics(); }}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                  activeTab === 'ANALYTICS'
                    ? 'bg-kits-red text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                <BarChart3 className="h-4 w-4" />
                <span>Assigned Analytics</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('RESULTS')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                  activeTab === 'RESULTS'
                    ? 'bg-kits-red text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                <Trophy className="h-4 w-4" />
                <span>Result Declaration</span>
                {resultSubEventStatus === 'PENDING_ADMIN_APPROVAL' && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                    PENDING
                  </span>
                )}
                {resultSubEventStatus === 'APPROVED' && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                    APPROVED
                  </span>
                )}
                {resultSubEventStatus === 'REJECTED' && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-900 border border-red-300">
                    REJECTED
                  </span>
                )}
              </button>
            </div>

            {/* Notification alert banner if payment was just verified */}
            {paymentActionMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-800 font-bold">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  {paymentActionMessage}
                </span>
                <button
                  type="button"
                  onClick={() => setPaymentActionMessage(null)}
                  className="p-1 hover:bg-emerald-100 rounded text-emerald-600 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* TAB 1: ATTENDANCE & CHECK-IN */}
            {activeTab === 'ATTENDANCE' && (
              <div className="space-y-6">
                {/* Single-Column 3-Method Verification Hub */}
                <AttendanceVerificationHub
                  subEventId={selectedSubEventId}
                  subEventName={currentSubEvent.name?.toUpperCase()}
                  coordinatorId={coordinator?.id}
                  onAttendanceRecorded={loadSubEventAttendance}
                />

                {/* Attendance Summary Statistics */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Registered</span>
                      <h4 className="text-2xl font-black text-gray-900 mt-1">{totalRegistered}</h4>
                      <p className="text-[11px] text-gray-500 font-medium">Confirmed entries</p>
                    </div>
                    <div className="p-3 bg-blue-50 text-kits-blue rounded-xl">
                      <Users className="h-5 w-5" />
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Attended</span>
                      <h4 className="text-2xl font-black text-emerald-600 mt-1">{totalAttended}</h4>
                      <p className="text-[11px] text-emerald-700 font-medium">Verified on venue</p>
                    </div>
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Check-in Pending</span>
                      <h4 className="text-2xl font-black text-amber-600 mt-1">{totalPending}</h4>
                      <p className="text-[11px] text-amber-700 font-medium">Awaiting check-in</p>
                    </div>
                    <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
                      <Clock className="h-5 w-5" />
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Turnout Rate</span>
                      <h4 className="text-2xl font-black text-kits-red mt-1">{attendanceRate}%</h4>
                    </div>
                    <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden mt-2">
                      <div className="bg-kits-red h-full transition-all duration-500" style={{ width: `${attendanceRate}%` }} />
                    </div>
                  </div>
                </div>

                {/* Participant Roster Table, Search, Filters & Full Excel Export */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
                  {/* Export message banner */}
                  {exportMessage && (
                    <div className={`px-5 py-3 border-b flex items-center justify-between text-xs font-bold transition ${
                      exportMessage.type === 'success'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}>
                      <span className="flex items-center gap-2">
                        {exportMessage.type === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                        )}
                        <span>{exportMessage.text}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setExportMessage(null)}
                        className="p-1 hover:bg-black/5 rounded cursor-pointer"
                        title="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="p-4 sm:p-5 border-b border-gray-100 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
                    {/* Search input */}
                    <div className="relative w-full xl:w-72">
                      <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search student, roll, token, team..."
                        className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                      />
                    </div>

                    {/* Filter Dropdowns + Count + Export button */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      {/* Attendance Filter */}
                      <select
                        value={attendanceFilter}
                        onChange={(e) => setAttendanceFilter(e.target.value as any)}
                        className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 focus:bg-white focus:border-kits-blue cursor-pointer"
                        title="Filter by Attendance Status"
                      >
                        <option value="ALL">Attendance: All</option>
                        <option value="ATTENDED">Attended ({totalAttended})</option>
                        <option value="PENDING">Pending Check-in ({totalPending})</option>
                      </select>

                      {/* Payment Filter */}
                      <select
                        value={paymentFilter}
                        onChange={(e) => setPaymentFilter(e.target.value as any)}
                        className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 focus:bg-white focus:border-kits-blue cursor-pointer"
                        title="Filter by Payment Status"
                      >
                        <option value="ALL">Payment: All</option>
                        <option value="SUCCESS">Paid (SUCCESS)</option>
                        <option value="PENDING">Pending Payment</option>
                      </select>

                      <span className="text-xs text-gray-500 font-mono hidden md:inline-block">
                        Showing {filteredParticipants.length} of {totalRegistered}
                      </span>

                      <button
                        onClick={loadSubEventAttendance}
                        className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200 transition cursor-pointer"
                        title="Refresh Roster"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>

                      {/* Export Excel Button */}
                      <DownloadButton
                        onDownload={handleExportSubEventExcel}
                        label="Export Excel"
                        preparingLabel="Preparing..."
                        downloadingLabel="Exporting..."
                        completedLabel="Exported"
                        variant="success"
                        size="sm"
                        className="ml-auto sm:ml-0"
                        title="Download filtered participant list as Excel (.xlsx)"
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-gray-700">
                      <thead className="bg-gray-50/80 text-[10px] font-extrabold uppercase tracking-wider text-gray-500 border-b border-gray-200">
                        <tr>
                          <th className="px-5 py-3">Participant</th>
                          <th className="px-5 py-3">Roll Number</th>
                          <th className="px-5 py-3">Team / Mode</th>
                          <th className="px-5 py-3">Manual Token</th>
                          <th className="px-5 py-3 text-center">Payment</th>
                          <th className="px-5 py-3 text-center">Attendance</th>
                          <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {isRosterLoading ? (
                          <tr>
                            <td colSpan={7} className="text-center py-12 text-gray-500">
                              <RefreshCw className="h-6 w-6 animate-spin mx-auto text-kits-red mb-2" />
                              <span className="text-xs font-bold uppercase tracking-wider">Loading participant roster...</span>
                            </td>
                          </tr>
                        ) : rosterError ? (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-red-600">
                              <AlertCircle className="h-6 w-6 mx-auto mb-1 text-kits-red" />
                              <span className="text-xs font-bold block">{rosterError}</span>
                              <button
                                type="button"
                                onClick={loadSubEventAttendance}
                                className="mt-2 text-xs font-bold text-kits-blue hover:underline cursor-pointer"
                              >
                                Retry loading roster
                              </button>
                            </td>
                          </tr>
                        ) : filteredParticipants.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center py-12 text-gray-400">
                              No participants found matching your active filters.
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
                              <td className="px-5 py-3.5 text-center">
                                {p.paymentStatus === 'SUCCESS' ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <CheckCircle2 className="h-3 w-3" /> Paid {p.paymentAmount > 0 ? `(₹${p.paymentAmount})` : ''}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                                    <Clock className="h-3 w-3" /> Pending
                                  </span>
                                )}
                              </td>
                              <td className="px-5 py-3.5 text-center">
                                {p.isAttended ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <CheckCircle2 className="h-3 w-3" /> Checked In
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                                    <Clock className="h-3 w-3" /> Awaiting Check-in
                                  </span>
                                )}
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => setSelectedIdCardParticipant(p)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-50 hover:bg-kits-red hover:text-white border border-gray-200 text-[10px] font-bold text-gray-700 transition cursor-pointer shadow-2xs"
                                >
                                  <FileText className="h-3 w-3" />
                                  <span>ID Card</span>
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: APPROVE PAYMENTS */}
            {activeTab === 'PAYMENTS' && (
              <div className="space-y-6">
                {/* Payment Action Feedback Banner */}
                {paymentActionMessage && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs font-bold text-emerald-800 animate-in fade-in">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span>{paymentActionMessage}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPaymentActionMessage(null)}
                      className="p-1 hover:bg-emerald-100 rounded-lg text-emerald-700 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {currentEvent.effectiveStatus === 'COMPLETED' && (
                  <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-2 text-xs font-bold text-indigo-900">
                    <AlertCircle className="h-4 w-4 text-indigo-600 flex-shrink-0" />
                    <span>Payment Verification Locked: The parent Main Event is COMPLETED. Offline payments cannot be modified after event completion.</span>
                  </div>
                )}

                {/* Scope Header Card */}
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-red-50 text-kits-red">
                        <CreditCard className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-black uppercase text-gray-900 tracking-tight">
                          Payment Approval & Verification
                        </h3>
                        <p className="text-xs text-gray-500 font-medium">
                          Sub-Event: <strong className="text-kits-red">{currentSubEvent.name}</strong> • Verify offline cash payments & bulk approve registrations
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={loadSubEventAttendance}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 text-xs font-bold transition cursor-pointer"
                      title="Refresh Payments"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isRosterLoading ? 'animate-spin text-kits-red' : ''}`} />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                {/* KPI Summary Cards Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
                    <div className="flex items-center justify-between text-gray-400">
                      <span className="text-[10px] font-bold uppercase tracking-wider">Total Regs</span>
                      <Users className="h-4 w-4 text-kits-blue" />
                    </div>
                    <div className="text-2xl font-black text-gray-900">{totalRegistrationsCount}</div>
                    <p className="text-[10px] text-gray-500">Registrations</p>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
                    <div className="flex items-center justify-between text-amber-500">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Pending</span>
                      <Clock className="h-4 w-4 text-amber-500" />
                    </div>
                    <div className="text-2xl font-black text-amber-600">{pendingCount}</div>
                    <p className="text-[10px] text-amber-700 font-medium">Awaiting payment</p>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
                    <div className="flex items-center justify-between text-emerald-500">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Paid</span>
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    </div>
                    <div className="text-2xl font-black text-emerald-600">{paidCount}</div>
                    <p className="text-[10px] text-emerald-700 font-medium">Confirmed / Verified</p>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
                    <div className="flex items-center justify-between text-gray-400">
                      <span className="text-[10px] font-bold uppercase tracking-wider">Expected</span>
                      <CreditCard className="h-4 w-4 text-gray-500" />
                    </div>
                    <div className="text-2xl font-black text-gray-900">₹{totalExpectedAmount.toLocaleString('en-IN')}</div>
                    <p className="text-[10px] text-gray-500">Total revenue value</p>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-amber-200 bg-amber-50/20 shadow-2xs space-y-1">
                    <div className="flex items-center justify-between text-amber-600">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Pending ₹</span>
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                    </div>
                    <div className="text-2xl font-black text-amber-700">₹{totalPendingAmount.toLocaleString('en-IN')}</div>
                    <p className="text-[10px] text-amber-800 font-medium">Cash to collect</p>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-emerald-200 bg-emerald-50/20 shadow-2xs space-y-1">
                    <div className="flex items-center justify-between text-emerald-600">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Collected</span>
                      <Sparkles className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="text-2xl font-black text-emerald-700">₹{totalCollectedAmount.toLocaleString('en-IN')}</div>
                    <p className="text-[10px] text-emerald-800 font-medium">Authoritative collected</p>
                  </div>
                </div>

                {/* Bulk Selection Bar */}
                {selectedPaymentIds.size > 0 && (
                  <div className="p-4 bg-[#081a30] text-white rounded-2xl border border-[#0f2c52] shadow-md flex flex-col sm:flex-row items-center justify-between gap-3 animate-in fade-in">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-kits-red text-white flex items-center justify-center font-black text-sm">
                        {selectedPaymentIds.size}
                      </div>
                      <div>
                        <div className="text-xs font-black uppercase tracking-wider text-amber-400">
                          {selectedPaymentIds.size} payment{selectedPaymentIds.size > 1 ? 's' : ''} selected
                        </div>
                        <div className="text-sm font-black text-white">
                          Total Amount: <span className="text-emerald-400 font-mono">₹{selectedTotalAmount.toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                      <button
                        type="button"
                        onClick={() => setSelectedPaymentIds(new Set())}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold text-gray-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      >
                        Clear Selection
                      </button>

                      <button
                        type="button"
                        onClick={handleOpenBulkApprovalModal}
                        disabled={currentEvent.effectiveStatus === 'COMPLETED'}
                        className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-xs font-black uppercase tracking-wider transition shadow-md ${
                          currentEvent.effectiveStatus === 'COMPLETED'
                            ? 'bg-gray-400 cursor-not-allowed opacity-60'
                            : 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer'
                        }`}
                        title={currentEvent.effectiveStatus === 'COMPLETED' ? 'Event is completed' : undefined}
                      >
                        <CheckCheck className="h-4 w-4" />
                        <span>APPROVE PAYMENTS ({selectedPaymentIds.size})</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Search & Filter Toolbar */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
                  <div className="p-4 sm:p-5 border-b border-gray-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-md">
                      <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
                      <input
                        type="text"
                        value={coordPaymentSearch}
                        onChange={(e) => setCoordPaymentSearch(e.target.value)}
                        placeholder="Search student, roll number, team, reg ID..."
                        className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                      />
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="inline-flex rounded-xl bg-gray-100 p-1 border border-gray-200 text-xs font-bold">
                        <button
                          type="button"
                          onClick={() => setCoordPaymentFilter('ALL')}
                          className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                            coordPaymentFilter === 'ALL'
                              ? 'bg-white text-gray-900 shadow-2xs font-black'
                              : 'text-gray-600 hover:text-gray-900'
                          }`}
                        >
                          All ({subEventPayments.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setCoordPaymentFilter('PENDING')}
                          className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                            coordPaymentFilter === 'PENDING'
                              ? 'bg-amber-500 text-white shadow-2xs font-black'
                              : 'text-amber-800 hover:text-amber-900'
                          }`}
                        >
                          Pending ({pendingCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => setCoordPaymentFilter('PAID')}
                          className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                            coordPaymentFilter === 'PAID'
                              ? 'bg-emerald-600 text-white shadow-2xs font-black'
                              : 'text-emerald-800 hover:text-emerald-900'
                          }`}
                        >
                          Paid ({paidCount})
                        </button>
                      </div>

                      {selectablePendingPayments.length > 0 && (
                        <button
                          type="button"
                          onClick={toggleSelectAllPayments}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-xs font-bold text-gray-700 transition cursor-pointer"
                        >
                          {isAllSelectableSelected ? (
                            <>
                              <CheckSquare className="h-4 w-4 text-kits-red" />
                              <span>Deselect All</span>
                            </>
                          ) : (
                            <>
                              <Square className="h-4 w-4 text-gray-500" />
                              <span>Select All ({selectablePendingPayments.length})</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Payment Records Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-gray-700">
                      <thead className="bg-gray-50/80 text-[10px] font-extrabold uppercase tracking-wider text-gray-500 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 w-10 text-center">
                            {selectablePendingPayments.length > 0 ? (
                              <input
                                type="checkbox"
                                checked={isAllSelectableSelected}
                                onChange={toggleSelectAllPayments}
                                className="h-4 w-4 rounded border-gray-300 text-kits-red focus:ring-kits-red cursor-pointer"
                                title="Select All Pending Payments"
                              />
                            ) : (
                              <span className="text-gray-300">#</span>
                            )}
                          </th>
                          <th className="px-4 py-3">Participant / Leader</th>
                          <th className="px-4 py-3">Roll & Reg ID</th>
                          <th className="px-4 py-3">Team / Mode</th>
                          <th className="px-4 py-3">Reg Date</th>
                          <th className="px-4 py-3">Fee</th>
                          <th className="px-4 py-3">Mode</th>
                          <th className="px-4 py-3">Payment Status</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredPaymentList.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="text-center py-12 text-gray-400">
                              No payment records found matching your filters.
                            </td>
                          </tr>
                        ) : (
                          filteredPaymentList.map((p) => {
                            const isSelected = p.paymentId ? selectedPaymentIds.has(p.paymentId) : false;
                            return (
                              <tr
                                key={p.registrationId}
                                className={`transition ${
                                  isSelected ? 'bg-amber-50/50' : 'hover:bg-gray-50/60'
                                }`}
                              >
                                <td className="px-4 py-3.5 text-center">
                                  {p.isPending && p.paymentId ? (
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => togglePaymentSelection(p.paymentId!)}
                                      className="h-4 w-4 rounded border-gray-300 text-kits-red focus:ring-kits-red cursor-pointer"
                                    />
                                  ) : (
                                    <Check className="h-3.5 w-3.5 text-emerald-600 mx-auto" />
                                  )}
                                </td>

                                <td className="px-4 py-3.5 font-bold text-gray-900">
                                  <div>{p.studentName}</div>
                                  <div className="text-[10px] text-gray-400 font-normal">
                                    {p.college} • {p.department}
                                  </div>
                                </td>

                                <td className="px-4 py-3.5 font-mono">
                                  <div className="font-bold text-gray-800">{p.rollNumber}</div>
                                  <div className="text-[10px] text-gray-400 truncate max-w-[120px]" title={p.registrationId}>
                                    {p.registrationId.slice(0, 8)}...
                                  </div>
                                </td>

                                <td className="px-4 py-3.5">
                                  {p.isTeam ? (
                                    <div className="space-y-0.5">
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-blue-50 text-kits-blue border border-blue-200">
                                        <Users className="h-2.5 w-2.5" />
                                        TEAM ({p.membersCount})
                                      </span>
                                      <div className="font-bold text-gray-800 text-xs truncate max-w-[140px]" title={p.teamName}>
                                        {p.teamName}
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-gray-100 text-gray-700">
                                      SOLO
                                    </span>
                                  )}
                                </td>

                                <td className="px-4 py-3.5 text-gray-500 text-[11px] whitespace-nowrap">
                                  {p.regCreatedAt ? new Date(p.regCreatedAt).toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  }) : '—'}
                                </td>

                                <td className="px-4 py-3.5 font-black text-sm">
                                  <span className={p.isPaid ? 'text-emerald-700' : 'text-gray-900'}>
                                    ₹{p.amount}
                                  </span>
                                </td>

                                <td className="px-4 py-3.5 font-mono text-[11px] font-bold text-gray-600">
                                  <span className="px-2 py-0.5 rounded bg-gray-100 border border-gray-200 text-[10px]">
                                    {p.paymentMethod}
                                  </span>
                                </td>

                                <td className="px-4 py-3.5">
                                  {p.isPaid ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      <CheckCircle2 className="h-3 w-3" /> PAID / VERIFIED
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                                      <Clock className="h-3 w-3" /> PENDING
                                    </span>
                                  )}
                                </td>

                                <td className="px-4 py-3.5 text-right">
                                  {currentEvent.effectiveStatus === 'COMPLETED' ? (
                                    <span className="text-xs font-bold text-gray-400 inline-flex items-center gap-1">
                                      <Lock className="h-3.5 w-3.5" /> Event Closed
                                    </span>
                                  ) : p.isPending && p.paymentId ? (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenSingleApprovalModal(p)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-2xs transition cursor-pointer"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      <span>MARK AS PAID</span>
                                    </button>
                                  ) : (
                                    <span className="text-xs font-bold text-emerald-700 inline-flex items-center gap-1">
                                      <CheckCircle2 className="h-3.5 w-3.5" /> Confirmed
                                    </span>
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

            {/* TAB 3: UPLOADED DOCUMENTS */}
            {activeTab === 'DOCUMENTS' && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs p-6 space-y-4">
                {/* Header with Title and Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-100 pb-3 gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-black uppercase text-gray-900">
                        Uploaded Documents for {currentSubEvent.name?.toUpperCase()}
                      </h4>
                      {subEventDocs.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-kits-red border border-red-200">
                          {subEventDocs.length} Total
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Participant reports, abstracts, and presentation documents.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                    {subEventDocs.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleSelectAllDocs}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-xs font-bold text-gray-700 transition cursor-pointer"
                        title={selectedDocIds.size === subEventDocs.length ? "Deselect All Documents" : "Select All Documents"}
                      >
                        {selectedDocIds.size === subEventDocs.length && subEventDocs.length > 0 ? (
                          <>
                            <CheckSquare className="h-3.5 w-3.5 text-kits-red" />
                            <span>Deselect All</span>
                          </>
                        ) : (
                          <>
                            <Square className="h-3.5 w-3.5 text-gray-500" />
                            <span>Select All ({subEventDocs.length})</span>
                          </>
                        )}
                      </button>
                    )}

                    <button
                      onClick={fetchSubEventDocs}
                      className="p-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200 transition cursor-pointer"
                      title="Refresh Documents"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Operation Alerts */}
                {deleteDocSuccess && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-2 text-xs text-emerald-800 font-bold animate-in fade-in duration-150">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span>{deleteDocSuccess}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeleteDocSuccess(null)}
                      className="text-emerald-600 hover:text-emerald-800 p-1"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {deleteDocError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-2 text-xs text-red-800 font-bold animate-in fade-in duration-150">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                      <span>{deleteDocError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeleteDocError(null)}
                      className="text-red-600 hover:text-red-800 p-1"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Multi-Selection Dynamic Action Toolbar */}
                {selectedDocIds.size > 0 && (
                  <div className="bg-red-50/70 border border-red-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-150 shadow-2xs">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-black bg-kits-red text-white">
                        {selectedDocIds.size}
                      </span>
                      <span className="text-xs font-bold text-gray-900">
                        {selectedDocIds.size === 1 ? '1 document selected' : `${selectedDocIds.size} documents selected`}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedDocIds(new Set())}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 transition cursor-pointer"
                      >
                        Clear Selection
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteDocError(null);
                          setDeleteDocSuccess(null);
                          setDeleteModalStep(1);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-kits-red hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete {selectedDocIds.size} Document{selectedDocIds.size > 1 ? 's' : ''}</span>
                      </button>
                    </div>
                  </div>
                )}

                {isDocsLoading ? (
                  <div className="py-12 text-center text-gray-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto text-kits-red mb-2" />
                    <span className="text-xs font-bold uppercase">Loading documents...</span>
                  </div>
                ) : subEventDocs.length === 0 ? (
                  <div className="py-12 text-center text-gray-400 text-xs">
                    No files have been uploaded by registered participants for this sub-event.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {subEventDocs.map((doc: any) => {
                      const isSelected = selectedDocIds.has(doc.id);
                      return (
                        <div
                          key={doc.id}
                          className={`bg-white p-4 rounded-xl border transition flex flex-col justify-between gap-3 ${
                            isSelected
                              ? 'border-kits-red/60 bg-red-50/15 shadow-xs'
                              : 'border-gray-200 shadow-2xs hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Accessible Document Checkbox */}
                            <div className="pt-0.5 shrink-0">
                              <label
                                htmlFor={`doc-select-${doc.id}`}
                                className="cursor-pointer block"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  id={`doc-select-${doc.id}`}
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleDocSelection(doc.id)}
                                  className="h-4 w-4 rounded border-gray-300 text-kits-red focus:ring-kits-red cursor-pointer"
                                  aria-label={`Select document ${doc.file_name}`}
                                />
                              </label>
                            </div>

                            <div className="p-2.5 rounded-xl bg-red-50 text-kits-red shrink-0 border border-red-100">
                              <FileText className="h-5 w-5" />
                            </div>

                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="text-xs font-black text-gray-900 truncate" title={doc.file_name}>
                                {doc.file_name}
                              </div>
                              <div className="text-[10px] text-gray-400 font-mono">
                                Uploaded: {formatDateTime12h(doc.uploaded_at)}
                              </div>
                              <div className="text-[10px] text-gray-500">
                                Size: {(Number(doc.size_bytes) / 1024).toFixed(1)} KB • {doc.mime_type}
                              </div>
                              {doc.student_name && (
                                <div className="text-[10px] text-gray-600 font-semibold truncate">
                                  Participant: {doc.student_name} {doc.roll_number ? `(${doc.roll_number})` : ''}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                            <button
                              type="button"
                              onClick={() => handleDocumentAction(doc, 'view')}
                              disabled={downloadingDocId === doc.id}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-bold border border-gray-200 transition cursor-pointer"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span>View</span>
                            </button>
                            <DownloadButton
                              onDownload={() => handleDocumentAction(doc, 'download')}
                              label="Download"
                              preparingLabel="Preparing..."
                              downloadingLabel="Downloading..."
                              completedLabel="Saved"
                              variant="secondary"
                              size="sm"
                              className="flex-1"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TWO-STEP CONFIRMATION: STEP 1 (Summary Review - Non-destructive) */}
            {deleteModalStep === 1 && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-step1-title"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setDeleteModalStep(0);
                }}
              >
                <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h3 id="delete-step1-title" className="text-sm font-black uppercase tracking-wider text-gray-900">
                      Delete Uploaded Documents?
                    </h3>
                    <button
                      type="button"
                      onClick={() => setDeleteModalStep(0)}
                      className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer"
                      aria-label="Close dialog"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs text-gray-600">
                      You selected <strong className="text-gray-900 font-bold">{selectedDocIds.size} document{selectedDocIds.size > 1 ? 's' : ''}</strong> for deletion.
                    </p>

                    {/* Selected Documents Summary Box */}
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1.5 max-h-40 overflow-y-auto">
                      <div className="text-[11px] font-black uppercase text-gray-500 tracking-wider">
                        Selected Documents ({selectedDocIds.size})
                      </div>
                      <ul className="space-y-1">
                        {Array.from(selectedDocIds).slice(0, 5).map((id) => {
                          const d = subEventDocs.find((doc) => doc.id === id);
                          return (
                            <li key={id} className="flex items-center gap-1.5 text-gray-700 truncate font-mono text-[11px]">
                              <span className="text-kits-red font-bold">•</span>
                              <span className="truncate">{d?.file_name || id}</span>
                            </li>
                          );
                        })}
                        {selectedDocIds.size > 5 && (
                          <li className="text-[11px] text-gray-500 font-semibold italic pt-1">
                            + {selectedDocIds.size - 5} more document{selectedDocIds.size - 5 > 1 ? 's' : ''}
                          </li>
                        )}
                      </ul>
                    </div>

                    {/* Scope Context */}
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1">
                      <div className="text-[10px] font-black uppercase text-gray-500 tracking-wider">Assigned Context</div>
                      <div className="font-bold text-gray-900">{currentEvent?.name || 'Institutional Event'}</div>
                      <div className="text-gray-600 font-semibold">{currentSubEvent?.name?.toUpperCase() || 'Assigned Sub-Event'}</div>
                    </div>

                    {/* Safety Guarantee Callout */}
                    <div className="p-3 bg-blue-50/80 rounded-xl border border-blue-200 flex items-start gap-2.5">
                      <AlertCircle className="h-4 w-4 text-blue-700 shrink-0 mt-0.5" />
                      <div className="text-xs text-blue-900 leading-relaxed">
                        <span className="font-black">Notice: </span>
                        Only the selected uploaded documents will be deleted.
                        Student registrations, payments, attendance, certificates and other event data will <strong>NOT</strong> be deleted.
                        <div className="font-bold text-blue-950 mt-1">
                          This action cannot be undone.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => setDeleteModalStep(0)}
                      className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteModalStep(2)}
                      className="px-4 py-2 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-2xs"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TWO-STEP CONFIRMATION: STEP 2 (Final Destructive Confirmation) */}
            {deleteModalStep === 2 && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-step2-title"
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && !isDeletingDocs) setDeleteModalStep(0);
                }}
              >
                <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h3 id="delete-step2-title" className="text-sm font-black uppercase tracking-wider text-red-900 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-kits-red" />
                      <span>Final Confirmation</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => !isDeletingDocs && setDeleteModalStep(0)}
                      disabled={isDeletingDocs}
                      className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer disabled:opacity-50"
                      aria-label="Close dialog"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="p-4 bg-red-50 rounded-xl border border-red-200 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-kits-red shrink-0 mt-0.5" />
                    <div className="space-y-1.5 text-xs text-red-900 leading-relaxed">
                      <div className="font-bold">
                        You are about to permanently delete:
                      </div>
                      <div className="font-black text-sm text-red-950">
                        {selectedDocIds.size} uploaded document{selectedDocIds.size > 1 ? 's' : ''}
                      </div>
                      <div className="text-[11px] text-red-800 font-semibold">
                        from: <span className="font-bold">{currentEvent?.name} — {currentSubEvent?.name?.toUpperCase()}</span>
                      </div>
                      <p className="pt-1 text-red-900 font-medium">
                        The selected files will be permanently removed from the system. This cannot be undone.
                      </p>
                      <p className="text-[11px] text-red-800 font-semibold">
                        Only these uploaded documents will be deleted. Student registrations and event records will remain unchanged.
                      </p>
                      <div className="font-black text-red-950 pt-1 uppercase tracking-wider text-[11px]">
                        Are you sure you want to continue?
                      </div>
                    </div>
                  </div>

                  {deleteDocError && (
                    <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">
                      {deleteDocError}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => setDeleteModalStep(1)}
                      disabled={isDeletingDocs}
                      className="px-4 py-2 rounded-xl text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      <span>Go Back</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExecuteDeleteDocuments}
                      disabled={isDeletingDocs}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-kits-red hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider transition shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDeletingDocs ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Deleting Permanently...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete Permanently</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: ASSIGNED OPERATIONAL ANALYTICS */}
            {activeTab === 'ANALYTICS' && (
              <div className="space-y-6 page-enter">
                {isAnalyticsLoading ? (
                  <div className="p-12 text-center bg-white rounded-2xl border border-gray-200 shadow-2xs space-y-2">
                    <RefreshCw className="h-6 w-6 animate-spin text-kits-red mx-auto" />
                    <p className="text-xs text-gray-500 font-bold">Loading Authorized Analytics...</p>
                  </div>
                ) : analyticsError ? (
                  <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold">
                    {analyticsError}
                  </div>
                ) : scopedAnalytics?.success ? (
                  <ScopedAnalyticsView
                    summary={scopedAnalytics.scope_summary}
                    categories={scopedAnalytics.categories}
                    subEvents={scopedAnalytics.sub_events}
                    role="COORDINATOR"
                    onRefresh={fetchCoordinatorAnalytics}
                    isRefreshing={isAnalyticsLoading}
                  />
                ) : null}
              </div>
            )}

            {/* TAB 5: RESULT DECLARATION */}
            {activeTab === 'RESULTS' && (
              <div className="space-y-6 page-enter">
                <CoordinatorResultDeclaration
                  subEventId={selectedSubEventId}
                  subEventName={currentSubEvent.name?.toUpperCase()}
                  eventName={currentEvent.name}
                  categoryName={currentSubEvent.categories?.name}
                  participationType={currentSubEvent.participation_type}
                  eligibleCandidates={eligibleCandidatesForResults}
                  onStatusChange={(status) => setResultSubEventStatus(status)}
                />
              </div>
            )}

            {/* UNIFIED PAYMENT APPROVAL MODAL (BULK & SINGLE) */}
            {paymentApprovalModal && paymentApprovalModal.isOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
                <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-gray-100 space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700 font-bold">
                        <CreditCard className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black uppercase tracking-wider text-gray-900">
                          PAYMENT APPROVAL
                        </h3>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                          Coordinator Confirmation
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => !isConfirmingPayment && setPaymentApprovalModal(null)}
                      disabled={isConfirmingPayment}
                      className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 flex items-start gap-2.5">
                    <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900 font-semibold space-y-0.5">
                      <div>
                        You are about to approve:
                      </div>
                      <div className="text-sm font-black text-amber-950">
                        {paymentApprovalModal.count} payment{paymentApprovalModal.count > 1 ? 's' : ''}
                      </div>
                      <div className="text-xs font-bold text-amber-800">
                        Total amount: <span className="font-black font-mono text-emerald-800">₹{paymentApprovalModal.totalAmount.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  </div>

                  {paymentApprovalModal.studentSummary && (
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-700">
                      <span className="font-bold text-gray-500 block text-[10px] uppercase">Participant</span>
                      <span className="font-black text-gray-900">{paymentApprovalModal.studentSummary}</span>
                    </div>
                  )}

                  <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-200/60 text-xs text-gray-700 space-y-1">
                    <p className="font-bold text-gray-900">
                      These registrations will be marked as <span className="text-emerald-700 font-black">PAID</span> and their eligible ID cards will become available.
                    </p>
                    <p className="text-[11px] text-gray-500">
                      Sub-Event: <strong>{currentSubEvent?.name}</strong>
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setPaymentApprovalModal(null)}
                      disabled={isConfirmingPayment}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition cursor-pointer disabled:opacity-50"
                    >
                      CANCEL
                    </button>
                    <button
                      type="button"
                      onClick={handleExecuteApproval}
                      disabled={isConfirmingPayment}
                      className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-emerald-600 hover:bg-emerald-700 transition shadow-2xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isConfirmingPayment ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>MARKING AS PAID...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>MARK AS PAID</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Global Logout Confirmation Modal */}
      <LogoutConfirmationModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={handleConfirmLogout}
      />

      {/* Digital ID Card Modal */}
      {selectedIdCardParticipant && currentSubEvent && (() => {
        const isTeam = Boolean(
          selectedIdCardParticipant.teamName &&
          selectedIdCardParticipant.teamName !== 'Solo Participant' &&
          selectedIdCardParticipant.teamName.trim().length > 0
        );

        const teamMembers = isTeam
          ? participantRows
              .filter((p) => p.regId === selectedIdCardParticipant.regId)
              .map((tm) => ({
                id: tm.memberId,
                name: tm.name,
                department: tm.dept,
                year: tm.year,
                rollNumber: tm.rollNumber,
                isLeader: Boolean(tm.isLeader),
              }))
          : [];

        const leaderMember = teamMembers.find((m) => m.isLeader) || teamMembers[0];
        const token = isTeam ? (leaderMember?.rollNumber ? selectedIdCardParticipant.manualToken : selectedIdCardParticipant.manualToken) : selectedIdCardParticipant.manualToken;

        return (
          <DigitalIdCardModal
            isOpen={true}
            onClose={() => setSelectedIdCardParticipant(null)}
            studentName={selectedIdCardParticipant.name}
            rollNumber={selectedIdCardParticipant.rollNumber}
            department={selectedIdCardParticipant.dept || 'Engineering'}
            year={selectedIdCardParticipant.year || 3}
            college={selectedIdCardParticipant.college || 'KITS'}
            eventName={currentEvent?.name || 'Flagship Event'}
            categoryName={currentSubEvent.categories?.name}
            subEventName={currentSubEvent.name}
            participationType={currentSubEvent.participation_type || (isTeam ? 'TEAM' : 'Solo')}
            teamName={selectedIdCardParticipant.teamName}
            teamRole={selectedIdCardParticipant.isLeader ? 'TEAM LEADER' : (isTeam ? 'TEAM MEMBER' : 'SOLO PARTICIPANT')}
            registrationId={selectedIdCardParticipant.regId || selectedIdCardParticipant.memberId}
            manualToken={token}
            qrIdentity={!isTeam ? selectedIdCardParticipant.qrIdentity : undefined}
            qrPayload={token}
            isTeam={isTeam}
            teamMembers={teamMembers}
          />
        );
      })()}

      {/* =========================================================================
          COORDINATOR SCOPE ANALYTICS MODAL
          ========================================================================= */}
      {isScopedAnalyticsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-gray-50 rounded-3xl border border-gray-200 shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="p-4 sm:p-5 bg-white border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-red-50 text-kits-red">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900 tracking-tight">
                    Authorized Scope Analytics
                  </h3>
                  <p className="text-xs text-gray-500 font-medium">
                    Coordinator: {coordinatorName} • Assigned Categories & Sub-Events
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsScopedAnalyticsModalOpen(false)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
              {isAnalyticsLoading ? (
                <div className="p-16 text-center space-y-2">
                  <RefreshCw className="h-7 w-7 animate-spin text-kits-red mx-auto" />
                  <p className="text-xs text-gray-500 font-bold">Loading Authorized Analytics...</p>
                </div>
              ) : analyticsError ? (
                <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold">
                  {analyticsError}
                </div>
              ) : scopedAnalytics?.success ? (
                <ScopedAnalyticsView
                  summary={scopedAnalytics.scope_summary}
                  categories={scopedAnalytics.categories}
                  subEvents={scopedAnalytics.sub_events}
                  role="COORDINATOR"
                  onRefresh={fetchCoordinatorAnalytics}
                  isRefreshing={isAnalyticsLoading}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
