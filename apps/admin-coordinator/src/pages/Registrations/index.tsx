import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase, invokeAdminEdgeFunction, executeDocumentDeletion } from '@kits-eos/shared';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import type { Registration, Event, SubEvent, TeamMember } from '@kits-eos/shared/src/types/models';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { DeleteButton } from '../../components/ui/DeleteButton';
import { 
  ClipboardList, 
  Search, 
  Users, 
  User, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  ChevronDown, 
  ChevronUp, 
  Layers,
  Sparkles,
  QrCode,
  FileText,
  ExternalLink,
  Paperclip,
  FileSpreadsheet,
  Trash2,
  AlertTriangle,
  AlertOctagon,
  X,
  ArrowRight,
  ArrowLeft,
  CheckSquare,
  Square,
  MinusSquare,
  Calendar,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

import { DigitalIdCardModal } from '../../components/credentials/DigitalIdCardModal';
import { DownloadButton } from '../../components/ui/DownloadButton';
import { 
  exportToExcel, 
  sortParticipantsCollegeAndAlphabetical, 
  REGISTRATION_ROSTER_HEADERS,
  REGISTRATION_REPORT_HEADERS,
  getRegistrationExportFilename 
} from '@kits-eos/shared/src/utils/export';

export function RegistrationsList() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [subEvents, setSubEvents] = useState<SubEvent[]>([]);
  const [documentsMap, setDocumentsMap] = useState<Record<string, any[]>>({});
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Multi-Selection State (Set of registration IDs)
  const [selectedRegIds, setSelectedRegIds] = useState<Set<string>>(new Set());

  // Unified Single / Bulk Deletion Modal State
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    step: 1 | 2;
    targets: Registration[];
  }>({ open: false, step: 1, targets: [] });
  const [deletePhrase, setDeletePhrase] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Individual Document Deletion Modal State
  const [docDeleteModal, setDocDeleteModal] = useState<{
    open: boolean;
    doc: any;
    regId: string;
  } | null>(null);
  const [isDeletingDoc, setIsDeletingDoc] = useState(false);
  const [docDeleteError, setDocDeleteError] = useState<string | null>(null);

  // Digital ID Card Modal State
  const [selectedIdCard, setSelectedIdCard] = useState<{ member: any; reg: any } | null>(null);

  // Attendance & Payment States
  const [attendanceMap, setAttendanceMap] = useState<Record<string, any>>({});
  const [paymentsMap, setPaymentsMap] = useState<Record<string, any>>({});
  const [attendanceFilter, setAttendanceFilter] = useState<'ALL' | 'ATTENDED' | 'NOT_ATTENDED'>('ALL');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [eventFilter, setEventFilter] = useState<string>('ALL');
  const [subEventFilter, setSubEventFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'CONFIRMED' | 'PENDING_PAYMENT' | 'CANCELLED'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SOLO' | 'TEAM'>('ALL');
  const [dateFilter, setDateFilter] = useState<string>('');

  // Converts administrator's local calendar day to UTC timestamp boundaries for PostgreSQL query
  const getLocalDayTimestampBounds = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const localStart = new Date(y, m - 1, d, 0, 0, 0, 0);
    const localNext = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
    return {
      localStart,
      localNext,
      localStartISO: localStart.toISOString(),
      localNextISO: localNext.toISOString(),
    };
  };

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return '—';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
  };

  // Expanded registration row for team members
  const [expandedRegId, setExpandedRegId] = useState<string | null>(null);
  const [profilesMap, setProfilesMap] = useState<Record<string, any>>({});

  const loadData = useCallback(async (isInitial = false, dateParam?: string) => {
    try {
      if (isInitial) setIsLoading(true);
      setError(null);

      let regQuery = supabase.from('registrations').select(`
        id,
        sub_event_id,
        leader_id,
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
          registration_id,
          team_name,
          team_members (
            id,
            team_id,
            user_id,
            is_leader,
            qr_identity,
            manual_token,
            snapshot_name,
            snapshot_roll_number,
            snapshot_college,
            snapshot_department,
            snapshot_year
          )
        )
      `).order('created_at', { ascending: false });

      if (dateParam) {
        const { localStartISO, localNextISO } = getLocalDayTimestampBounds(dateParam);
        regQuery = regQuery.gte('created_at', localStartISO).lt('created_at', localNextISO);
      }

      const [eventsRes, subEventsRes, regRes, docsRes, profilesRes, attendanceRes, paymentsRes] = await Promise.all([
        supabase.from('events').select('id, name, status').order('name'),
        supabase.from('sub_events').select('id, name, category_id, event_id, participation_type, categories(id, name, event_id)').order('name'),
        regQuery,
        supabase.from('documents').select('id, owner_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, uploaded_at'),
        supabase.from('student_profiles').select('user_id, roll_number, full_name, college, department, year_of_study, phone, users(id, email)'),
        supabase.from('attendance_records').select('id, sub_event_id, team_id, scanned_member_id, check_in_time, checked_in_by'),
        supabase.from('payments').select('id, registration_id, amount, reference_id, status, payment_method, created_at')
      ]);

      if (eventsRes.error) throw eventsRes.error;
      if (subEventsRes.error) throw subEventsRes.error;
      if (regRes.error) throw regRes.error;

      // Map student profiles by user_id
      const pMap: Record<string, any> = {};
      if (profilesRes.data) {
        profilesRes.data.forEach((p: any) => {
          if (p.user_id) pMap[p.user_id] = p;
        });
      }
      setProfilesMap(pMap);

      // Group documents by registration (entity_id)
      const dMap: Record<string, any[]> = {};
      if (docsRes.data) {
        docsRes.data.forEach((d: any) => {
          if (!dMap[d.entity_id]) dMap[d.entity_id] = [];
          dMap[d.entity_id].push(d);
        });
      }
      setDocumentsMap(dMap);

      // Map attendance by scanned_member_id
      const aMap: Record<string, any> = {};
      if (attendanceRes.data) {
        attendanceRes.data.forEach((a: any) => {
          if (a.scanned_member_id) aMap[a.scanned_member_id] = a;
        });
      }
      setAttendanceMap(aMap);

      // Map payments by registration_id
      const payMap: Record<string, any> = {};
      if (paymentsRes.data) {
        paymentsRes.data.forEach((p: any) => {
          if (p.registration_id) payMap[p.registration_id] = p;
        });
      }
      setPaymentsMap(payMap);

      setEvents((eventsRes.data as Event[]) || []);
      setSubEvents((subEventsRes.data as unknown as SubEvent[]) || []);
      setRegistrations((regRes.data as unknown as Registration[]) || []);
    } catch (err: any) {
      console.error('Failed to fetch registrations:', err);
      setError(err.message || 'An unexpected error occurred while loading registrations.');
    } finally {
      if (isInitial) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  // Automatically prune stale selected registration IDs not present in current registrations
  useEffect(() => {
    if (selectedRegIds.size > 0 && registrations.length > 0) {
      const validIds = new Set(registrations.map(r => r.id));
      let changed = false;
      const next = new Set<string>();
      selectedRegIds.forEach(id => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      if (changed) {
        setSelectedRegIds(next);
      }
    }
  }, [registrations, selectedRegIds]);

  // Auto-dismiss success toast
  useEffect(() => {
    if (successToast) {
      const timer = setTimeout(() => {
        setSuccessToast(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [successToast]);

  const handleDocumentAction = async (doc: any, mode: 'view' | 'download') => {
    try {
      setDownloadingDocId(doc.id);
      const { data, error: fnErr } = await invokeAdminEdgeFunction('admin-download-document', {
        body: { document_id: doc.id, mode },
      });

      if (fnErr || !data?.signed_url) {
        throw new Error(fnErr?.message || 'Failed to generate document access URL.');
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
      console.error('Document download failed:', err);
      alert('Unable to download file: ' + (err.message || 'Unknown error'));
    } finally {
      setDownloadingDocId(null);
    }
  };

  const handleExecuteDeleteDoc = async () => {
    if (!docDeleteModal?.doc) return;
    try {
      setIsDeletingDoc(true);
      setDocDeleteError(null);
      const targetDoc = docDeleteModal.doc;
      const regId = docDeleteModal.regId;

      const res = await executeDocumentDeletion({ documentId: targetDoc.id });
      if (!res.success && res.failed_count > 0) {
        const errMsg = res.results.find((r) => r.error)?.error || 'Document deletion failed on server.';
        throw new Error(errMsg);
      }

      // Reconcile React state only after server confirmation
      setDocumentsMap((prev) => ({
        ...prev,
        [regId]: (prev[regId] || []).filter((d: any) => d.id !== targetDoc.id),
      }));

      setSuccessToast(`Document "${targetDoc.file_name}" permanently removed from storage and database.`);
      setDocDeleteModal(null);
    } catch (err: any) {
      console.error('Delete document failed:', err);
      setDocDeleteError(err.message || 'Failed to delete document from storage.');
    } finally {
      setIsDeletingDoc(false);
    }
  };

  // Safe team and member resolution helpers
  const resolveTeamData = (reg: any) => {
    if (!reg?.teams) return { team: null, members: [] as TeamMember[] };
    const team = Array.isArray(reg.teams) ? (reg.teams.length > 0 ? reg.teams[0] : null) : reg.teams;
    const rawMembers = team?.team_members;
    const members: TeamMember[] = Array.isArray(rawMembers)
      ? rawMembers
      : rawMembers ? [rawMembers] : [];
    return { team, members };
  };

  const resolveMemberDetails = (member: any, reg: any) => {
    const isLeader = Boolean(member?.is_leader);
    const profile = (member?.user_id && profilesMap[member.user_id]) ||
                    (isLeader && reg?.leader_id && profilesMap[reg.leader_id]) ||
                    null;

    const name = member?.snapshot_name || profile?.full_name || 'Participant';
    const rollNumber = member?.snapshot_roll_number || profile?.roll_number || 'Not provided';
    const department = member?.snapshot_department || profile?.department || 'Not provided';
    const year = member?.snapshot_year || profile?.year_of_study || 1;
    const college = member?.snapshot_college || (isLeader ? profile?.college : null) || 'KITS Akshar Institute of Technology';
    const manualToken = member?.manual_token || 'Not assigned';
    const qrIdentity = member?.qr_identity || null;
    const phone = profile?.phone || 'Not provided';
    const email = profile?.users?.email || 'Not provided';

    return { name, rollNumber, department, year, college, manualToken, qrIdentity, phone, email };
  };

  const hasRegistrationAttended = (reg: any) => {
    const { members } = resolveTeamData(reg);
    return members.some((m) => Boolean(attendanceMap[m.id]));
  };

  // Filtered registrations
  const filteredRegistrations = useMemo(() => {
    return registrations.filter((reg) => {
      const sub = reg.sub_events;
      const { team, members } = resolveTeamData(reg);
      const leaderMember = members.find(m => m.is_leader) || members[0];
      const leaderDetails = resolveMemberDetails(leaderMember, reg);
      const isTeam = members.length > 1 || (team?.team_name && team.team_name.trim().length > 0 && team.team_name !== 'Solo Participant');

      // Registration creation date filter (Local institutional calendar date)
      if (dateFilter) {
        const { localStart, localNext } = getLocalDayTimestampBounds(dateFilter);
        const createdDate = new Date(reg.created_at);
        if (createdDate < localStart || createdDate >= localNext) return false;
      }

      // Event filter
      if (eventFilter !== 'ALL') {
        const parentEventId = sub?.event_id || sub?.categories?.event_id || sub?.categories?.events?.id;
        if (parentEventId !== eventFilter) return false;
      }

      // Sub-event filter
      if (subEventFilter !== 'ALL') {
        if (reg.sub_event_id !== subEventFilter) return false;
      }

      // Status filter
      if (statusFilter !== 'ALL') {
        if (reg.status !== statusFilter) return false;
      }

      // Type filter (Solo vs Team)
      if (typeFilter !== 'ALL') {
        if (typeFilter === 'SOLO' && isTeam) return false;
        if (typeFilter === 'TEAM' && !isTeam) return false;
      }

      // Attendance filter
      if (attendanceFilter === 'ATTENDED' && !hasRegistrationAttended(reg)) return false;
      if (attendanceFilter === 'NOT_ATTENDED' && hasRegistrationAttended(reg)) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const idMatch = reg.id.toLowerCase().includes(q);
        const subNameMatch = sub?.name?.toLowerCase().includes(q) || false;
        const teamNameMatch = team?.team_name?.toLowerCase().includes(q) || false;
        const leaderNameMatch = leaderDetails.name.toLowerCase().includes(q);
        const rollMatch = leaderDetails.rollNumber.toLowerCase().includes(q);
        const deptMatch = leaderDetails.department.toLowerCase().includes(q);
        const collegeMatch = leaderDetails.college.toLowerCase().includes(q);
        const emailMatch = leaderDetails.email.toLowerCase().includes(q);

        // Check any member in team
        const anyMemberMatch = members.some((m) => {
          const mDetails = resolveMemberDetails(m, reg);
          return mDetails.name.toLowerCase().includes(q) ||
                 mDetails.rollNumber.toLowerCase().includes(q) ||
                 mDetails.email.toLowerCase().includes(q) ||
                 mDetails.manualToken.toLowerCase().includes(q);
        });

        return idMatch || subNameMatch || teamNameMatch || leaderNameMatch || rollMatch || deptMatch || collegeMatch || emailMatch || anyMemberMatch;
      }

      return true;
    });
  }, [registrations, searchQuery, eventFilter, subEventFilter, statusFilter, typeFilter, attendanceFilter, dateFilter, profilesMap, attendanceMap]);

  // Pagination State (25 registrations per page)
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 25;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, eventFilter, subEventFilter, statusFilter, typeFilter, attendanceFilter, dateFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRegistrations.length / PAGE_SIZE));
  const paginatedRegistrations = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredRegistrations.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredRegistrations, currentPage]);

  // Multi-Selection Computations (scoped to visible paginated registrations)
  const allVisibleSelected = useMemo(() => {
    if (paginatedRegistrations.length === 0) return false;
    return paginatedRegistrations.every((r) => selectedRegIds.has(r.id));
  }, [paginatedRegistrations, selectedRegIds]);

  const someVisibleSelected = useMemo(() => {
    if (paginatedRegistrations.length === 0) return false;
    return paginatedRegistrations.some((r) => selectedRegIds.has(r.id)) && !allVisibleSelected;
  }, [paginatedRegistrations, selectedRegIds, allVisibleSelected]);

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      // Deselect all currently visible
      setSelectedRegIds((prev) => {
        const next = new Set(prev);
        paginatedRegistrations.forEach((r) => next.delete(r.id));
        return next;
      });
    } else {
      // Select all currently visible
      setSelectedRegIds((prev) => {
        const next = new Set(prev);
        paginatedRegistrations.forEach((r) => next.add(r.id));
        return next;
      });
    }
  };

  const handleToggleSelectReg = (regId: string) => {
    setSelectedRegIds((prev) => {
      const next = new Set(prev);
      if (next.has(regId)) {
        next.delete(regId);
      } else {
        next.add(regId);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedRegIds(new Set());
  };

  // Modal Open Handlers
  const handleOpenSingleDelete = (reg: Registration) => {
    setDeleteModal({
      open: true,
      step: 1,
      targets: [reg]
    });
    setDeletePhrase('');
    setDeleteError(null);
  };

  const handleOpenBulkDelete = () => {
    const targets = registrations.filter((r) => selectedRegIds.has(r.id));
    if (targets.length === 0) return;

    setDeleteModal({
      open: true,
      step: 1,
      targets
    });
    setDeletePhrase('');
    setDeleteError(null);
  };

  const closeDeleteModal = () => {
    if (isDeleting) return;
    setDeleteModal({ open: false, step: 1, targets: [] });
    setDeletePhrase('');
    setDeleteError(null);
  };

  const handleProceedToStep2 = () => {
    setDeleteModal((prev) => ({ ...prev, step: 2 }));
    setDeletePhrase('');
    setDeleteError(null);
  };

  const handleExecuteDelete = async () => {
    if (deleteModal.targets.length === 0) return;
    if (deletePhrase !== 'DELETE') {
      setDeleteError('Please type "DELETE" exactly as required to proceed.');
      return;
    }

    try {
      setIsDeleting(true);
      setDeleteError(null);

      const targetIds = deleteModal.targets.map((t) => t.id);

      // Clean up physical documents from Supabase Storage for all target registrations
      const docsToDelete = targetIds.flatMap((id) => (documentsMap[id] || []).map((d: any) => d.id));
      if (docsToDelete.length > 0) {
        try {
          await executeDocumentDeletion({ documentIds: docsToDelete });
        } catch (storageCleanErr) {
          console.warn('Storage document cleanup during registration deletion warning:', storageCleanErr);
        }
      }

      if (targetIds.length === 1) {
        // Single delete RPC
        const { data, error: rpcErr } = await supabase.rpc('admin_delete_registration', {
          p_registration_id: targetIds[0],
          p_confirmation_phrase: 'DELETE'
        });

        if (rpcErr || (data && !data.success)) {
          throw new Error(rpcErr?.message || data?.message || 'Failed to permanently delete registration.');
        }

        setSuccessToast(`Registration #${targetIds[0].substring(0, 8)} has been permanently deleted.`);
      } else {
        // Bulk delete RPC
        const { data, error: rpcErr } = await supabase.rpc('admin_bulk_delete_registrations', {
          p_registration_ids: targetIds,
          p_confirmation_phrase: 'DELETE'
        });

        if (rpcErr || (data && !data.success)) {
          throw new Error(rpcErr?.message || data?.message || 'Failed to permanently delete selected registrations.');
        }

        const count = data?.deleted_count || targetIds.length;
        setSuccessToast(`${count} registrations permanently deleted successfully.`);
      }

      // Clean selections for deleted IDs
      setSelectedRegIds((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });

      closeDeleteModal();
      await loadData(false);
    } catch (err: any) {
      console.error('Registration deletion failed:', err);
      setDeleteError(err.message || 'Permanent deletion failed. Transaction rolled back completely.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Handler for exporting filtered registrations to Excel (College-wise & Alphabetical)
  const handleExportExcel = async () => {
    if (filteredRegistrations.length === 0) {
      alert('No registrations match the selected filters to export.');
      return;
    }

    const participantItems: any[] = [];

    filteredRegistrations.forEach((reg) => {
      const sub = reg.sub_events;
      const { team, members } = resolveTeamData(reg);
      const isTeam = members.length > 1 || (team?.team_name && team.team_name.trim().length > 0 && team.team_name !== 'Solo Participant');
      const payment = paymentsMap[reg.id];

      members.forEach((m) => {
        const mDetails = resolveMemberDetails(m, reg);
        const mAttended = Boolean(attendanceMap[m.id]);
        const attRecord = attendanceMap[m.id];

        // Honor active attendance filter at member level
        if (attendanceFilter === 'ATTENDED' && !mAttended) return;
        if (attendanceFilter === 'NOT_ATTENDED' && mAttended) return;

        participantItems.push({
          name: mDetails.name,
          rollNumber: mDetails.rollNumber,
          college: mDetails.college || 'KITS Akshar Institute of Technology',
          dept: mDetails.department,
          year: mDetails.year,
          phone: mDetails.phone || '—',
          email: mDetails.email || '—',
          eventName: sub?.events?.name || sub?.categories?.events?.name || '—',
          categoryName: sub?.categories?.name || '—',
          subEventName: sub?.name || '—',
          participationType: isTeam ? 'TEAM' : 'SOLO',
          teamName: isTeam ? (team?.team_name || 'Team') : 'Solo Participant',
          role: isTeam ? (m.is_leader ? 'TEAM LEADER' : 'TEAM MEMBER') : 'SOLO PARTICIPANT',
          regStatus: reg.status,
          paymentStatus: payment?.status || (reg.status === 'CONFIRMED' ? 'SUCCESS' : 'PENDING'),
          paymentAmount: payment?.amount !== undefined ? payment.amount : 0,
          isAttended: mAttended,
          attendanceTime: attRecord?.check_in_time ? formatDateTime12h(attRecord.check_in_time) : (mAttended ? 'VERIFIED' : '—'),
          verificationMethod: attRecord ? 'VERIFIED' : '—',
          manualToken: mDetails.manualToken,
          regId: reg.id,
          regCreatedAt: reg.created_at ? formatDateTime12h(reg.created_at) : '—',
        });
      });
    });

    if (participantItems.length === 0) {
      alert('No participant records match the active attendance filter.');
      return;
    }

    const sortedParticipants = sortParticipantsCollegeAndAlphabetical(participantItems);

    const rows = sortedParticipants.map((p, idx) => [
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
      p.role || 'SOLO PARTICIPANT',
      p.regStatus || 'CONFIRMED',
      p.paymentStatus || '—',
      p.paymentAmount !== undefined ? p.paymentAmount : 0,
      p.isAttended ? 'ATTENDED' : 'NOT ATTENDED',
      p.attendanceTime ? formatDateTime12h(p.attendanceTime) : (p.isAttended ? 'VERIFIED' : '—'),
      p.verificationMethod || (p.isAttended ? 'VERIFIED' : '—'),
      p.manualToken || '—',
      p.regId || '—',
    ]);

    const activeEvent = eventFilter !== 'ALL' ? events.find(e => e.id === eventFilter)?.name : undefined;
    const activeSub = subEventFilter !== 'ALL' ? subEvents.find(s => s.id === subEventFilter)?.name : undefined;

    const filename = getRegistrationExportFilename({
      scopePrefix: 'KITS-EOS_Admin',
      eventName: activeEvent,
      subEventName: activeSub,
      attendanceFilter: attendanceFilter as any,
    });

    const filterNotes: string[] = [];
    if (activeEvent) filterNotes.push(`Event: ${activeEvent}`);
    if (activeSub) filterNotes.push(`Sub-Event: ${activeSub}`);
    if (statusFilter !== 'ALL') filterNotes.push(`Status: ${statusFilter}`);
    if (typeFilter !== 'ALL') filterNotes.push(`Type: ${typeFilter}`);
    if (attendanceFilter !== 'ALL') filterNotes.push(`Attendance: ${attendanceFilter === 'ATTENDED' ? 'Attended Only' : 'Not Attended Only'}`);
    if (searchQuery.trim()) filterNotes.push(`Search: "${searchQuery.trim()}"`);

    const subtitle = filterNotes.length > 0
      ? `Filters: [${filterNotes.join(', ')}] | Records: ${sortedParticipants.length} (College-wise & Alphabetical)`
      : `Scope: All Registrations | Records: ${sortedParticipants.length} (College-wise & Alphabetical)`;

    await exportToExcel({
      filename,
      title: 'KITS-EOS STUDENT REGISTRATION ROSTER',
      subtitle,
      headers: REGISTRATION_ROSTER_HEADERS,
      rows,
    });
  };

  // Dynamic Sub-events strictly available under selected event filter
  const availableSubEvents = useMemo(() => {
    if (eventFilter === 'ALL') return [];
    return subEvents.filter(s => {
      const parentId = s.event_id || (s.categories as any)?.event_id;
      return parentId === eventFilter;
    });
  }, [subEvents, eventFilter]);

  // Handler when Main Event filter changes (resets Sub-Event to ALL)
  const handleEventFilterChange = (newEventId: string) => {
    setEventFilter(newEventId);
    setSubEventFilter('ALL');
  };

  // Handler when Registration Date filter changes (triggers server-side query)
  const handleDateChange = (newDate: string) => {
    setDateFilter(newDate);
    loadData(false, newDate);
  };

  const hasActiveFilters = Boolean(
    dateFilter ||
    eventFilter !== 'ALL' ||
    subEventFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    typeFilter !== 'ALL' ||
    attendanceFilter !== 'ALL' ||
    searchQuery.trim()
  );

  const handleClearAllFilters = () => {
    setDateFilter('');
    setEventFilter('ALL');
    setSubEventFilter('ALL');
    setStatusFilter('ALL');
    setTypeFilter('ALL');
    setAttendanceFilter('ALL');
    setSearchQuery('');
    loadData(false, '');
  };

  // Authoritative Date-Wise Registration Report Metrics
  const dateMetrics = useMemo(() => {
    if (!dateFilter) return { total: 0, confirmed: 0, pendingPayment: 0, attended: 0 };
    const { localStart, localNext } = getLocalDayTimestampBounds(dateFilter);
    const dateRegs = registrations.filter((r) => {
      const d = new Date(r.created_at);
      return d >= localStart && d < localNext;
    });
    return {
      total: dateRegs.length,
      confirmed: dateRegs.filter(r => r.status === 'CONFIRMED').length,
      pendingPayment: dateRegs.filter(r => r.status === 'PENDING_PAYMENT').length,
      attended: dateRegs.filter(r => hasRegistrationAttended(r)).length,
    };
  }, [registrations, dateFilter, attendanceMap]);

  // Authoritative Sub-Event Registration Report Metrics
  const subEventMetrics = useMemo(() => {
    if (subEventFilter === 'ALL') return { total: 0, confirmed: 0, pendingPayment: 0, attended: 0, solo: 0, team: 0 };
    const subRegs = registrations.filter(r => r.sub_event_id === subEventFilter);
    return {
      total: subRegs.length,
      confirmed: subRegs.filter(r => r.status === 'CONFIRMED').length,
      pendingPayment: subRegs.filter(r => r.status === 'PENDING_PAYMENT').length,
      attended: subRegs.filter(r => hasRegistrationAttended(r)).length,
      solo: subRegs.filter(r => {
        const { members } = resolveTeamData(r);
        return members.length <= 1;
      }).length,
      team: subRegs.filter(r => {
        const { members } = resolveTeamData(r);
        return members.length > 1;
      }).length,
    };
  }, [registrations, subEventFilter, attendanceMap]);

  // Helper to compile authoritative 1-Registration = 1-Row Excel rows
  const buildRegistrationExcelRows = (
    regs: Registration[],
    pMap: Record<string, any>,
    aMap: Record<string, any>,
    profMap: Record<string, any>
  ) => {
    return regs.map((reg, idx) => {
      const sub = reg.sub_events;
      const { team, members } = resolveTeamData(reg);
      const leaderMember = members.find(m => m.is_leader) || members[0];

      const resolveDetails = (member: any) => {
        const isLeader = Boolean(member?.is_leader);
        const profile = (member?.user_id && profMap[member.user_id]) ||
                        (isLeader && reg?.leader_id && profMap[reg.leader_id]) ||
                        null;
        const name = member?.snapshot_name || profile?.full_name || 'Participant';
        const rollNumber = member?.snapshot_roll_number || profile?.roll_number || 'Not provided';
        const department = member?.snapshot_department || profile?.department || 'Not provided';
        const year = member?.snapshot_year || profile?.year_of_study || 1;
        const college = member?.snapshot_college || (isLeader ? profile?.college : null) || 'KITS Akshar Institute of Technology';
        const manualToken = member?.manual_token || 'Not assigned';
        const phone = profile?.phone || 'Not provided';
        const email = profile?.users?.email || 'Not provided';
        return { name, rollNumber, department, year, college, manualToken, phone, email };
      };

      const leaderDetails = resolveDetails(leaderMember);
      const isTeam = members.length > 1 || (team?.team_name && team.team_name.trim().length > 0 && team.team_name !== 'Solo Participant');
      const payment = pMap[reg.id];
      const isAttended = members.some(m => Boolean(aMap[m.id]));
      const attRecord = members.map(m => aMap[m.id]).find(Boolean);

      // Compile team members roster summary into a structured string (1 Registration = 1 Excel Row)
      let teamSummary = 'Solo Participant';
      if (isTeam && members.length > 0) {
        teamSummary = members.map((m, i) => {
          const d = resolveDetails(m);
          const roleLabel = m.is_leader ? 'Leader' : `Member ${i + 1}`;
          const rollPart = d.rollNumber !== 'Not provided' ? d.rollNumber : 'No Roll';
          const deptPart = d.department !== 'Not provided' ? `, ${d.department}` : '';
          const collegePart = d.college ? `, ${d.college}` : '';
          return `[${roleLabel}] ${d.name} (${rollPart}${deptPart}${collegePart})`;
        }).join('; ');
      }

      return [
        idx + 1,
        leaderDetails.name,
        leaderDetails.rollNumber,
        leaderDetails.department,
        leaderDetails.year ? `Year ${leaderDetails.year}` : '—',
        leaderDetails.college,
        reg.created_at ? formatDateTime12h(reg.created_at) : '—',
        leaderDetails.email,
        leaderDetails.phone,
        sub?.events?.name || (sub?.categories as any)?.events?.name || '—',
        (sub?.categories as any)?.name || '—',
        sub?.name || '—',
        isTeam ? 'TEAM' : 'SOLO',
        isTeam ? (team?.team_name || 'Team') : 'Solo Participant',
        isTeam ? members.length : 1,
        teamSummary,
        reg.status || 'CONFIRMED',
        payment?.status || (reg.status === 'CONFIRMED' ? 'SUCCESS' : 'PENDING'),
        payment?.amount !== undefined ? payment.amount : 0,
        isAttended ? 'ATTENDED' : 'NOT ATTENDED',
        attRecord?.check_in_time ? formatDateTime12h(attRecord.check_in_time) : (isAttended ? 'VERIFIED' : '—'),
        attRecord ? 'VERIFIED' : '—',
        leaderDetails.manualToken,
        reg.id,
      ];
    });
  };

  // Authoritative Full-Dataset Fetcher (Zero N+1, Batched Chunk Queries, Independent of UI Pagination)
  const fetchCompleteExportDataset = async (filters: {
    date?: string;
    subEventId?: string;
    eventId?: string;
  }) => {
    let q = supabase
      .from('registrations')
      .select(`
        id,
        sub_event_id,
        leader_id,
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
          categories (
            id,
            name,
            event_id,
            events ( id, name )
          ),
          events ( id, name )
        ),
        teams (
          id,
          registration_id,
          team_name,
          team_members (
            id,
            team_id,
            user_id,
            is_leader,
            qr_identity,
            manual_token,
            snapshot_name,
            snapshot_roll_number,
            snapshot_college,
            snapshot_department,
            snapshot_year
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (filters.date) {
      const { localStartISO, localNextISO } = getLocalDayTimestampBounds(filters.date);
      q = q.gte('created_at', localStartISO).lt('created_at', localNextISO);
    }

    if (filters.subEventId && filters.subEventId !== 'ALL') {
      q = q.eq('sub_event_id', filters.subEventId);
    }

    const { data: rawRegs, error: regErr } = await q;
    if (regErr) throw regErr;
    if (!rawRegs || rawRegs.length === 0) return { regs: [], payments: {}, attendance: {}, profiles: {} };

    let matchingRegs = rawRegs as unknown as Registration[];
    if (filters.eventId && filters.eventId !== 'ALL' && (!filters.subEventId || filters.subEventId === 'ALL')) {
      matchingRegs = matchingRegs.filter(r => {
        const sub = r.sub_events;
        const parentId = sub?.event_id || sub?.categories?.event_id || (sub?.categories as any)?.events?.id;
        return parentId === filters.eventId;
      });
    }

    const regIds = matchingRegs.map(r => r.id);
    const memberIds: string[] = [];
    const userIds: string[] = [];

    matchingRegs.forEach(r => {
      if (r.leader_id) userIds.push(r.leader_id);
      const { members } = resolveTeamData(r);
      members.forEach(m => {
        if (m.id) memberIds.push(m.id);
        if (m.user_id) userIds.push(m.user_id);
      });
    });

    const uniqueRegIds = [...new Set(regIds)];
    const uniqueMemberIds = [...new Set(memberIds)];
    const uniqueUserIds = [...new Set(userIds)];

    // Chunked bulk fetch helper to prevent URL overflow while maintaining ZERO N+1 queries
    const chunkIn = async <T,>(table: string, selectFields: string, inCol: string, ids: string[]): Promise<T[]> => {
      if (ids.length === 0) return [];
      const CHUNK_SIZE = 150;
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        chunks.push(ids.slice(i, i + CHUNK_SIZE));
      }
      const results = await Promise.all(
        chunks.map(chunk => supabase.from(table).select(selectFields).in(inCol, chunk))
      );
      return results.flatMap(res => (res.data as T[]) || []);
    };

    // Bulk fetch in parallel with ZERO N+1 queries
    const [paymentsData, attendanceData, profilesData] = await Promise.all([
      chunkIn<any>('payments', 'id, registration_id, amount, reference_id, status, payment_method', 'registration_id', uniqueRegIds),
      chunkIn<any>('attendance_records', 'id, scanned_member_id, check_in_time', 'scanned_member_id', uniqueMemberIds),
      chunkIn<any>('student_profiles', 'user_id, roll_number, full_name, college, department, year_of_study, phone, users(id, email)', 'user_id', uniqueUserIds)
    ]);

    const pMap: Record<string, any> = {};
    paymentsData.forEach((p: any) => {
      if (p.registration_id) pMap[p.registration_id] = p;
    });

    const aMap: Record<string, any> = {};
    attendanceData.forEach((a: any) => {
      if (a.scanned_member_id) aMap[a.scanned_member_id] = a;
    });

    const prMap: Record<string, any> = {};
    profilesData.forEach((pr: any) => {
      if (pr.user_id) prMap[pr.user_id] = pr;
    });

    return {
      regs: matchingRegs,
      payments: pMap,
      attendance: aMap,
      profiles: prMap,
    };
  };

  // Download Date-Wise Excel Handler
  const handleExportDateWise = async () => {
    if (!dateFilter) return;
    try {
      const dataset = await fetchCompleteExportDataset({
        date: dateFilter,
        subEventId: subEventFilter !== 'ALL' ? subEventFilter : undefined,
        eventId: eventFilter !== 'ALL' ? eventFilter : undefined,
      });

      if (dataset.regs.length === 0) {
        alert('No registrations found matching the selected date to export.');
        return;
      }

      const rows = buildRegistrationExcelRows(dataset.regs, dataset.payments, dataset.attendance, dataset.profiles);
      const filename = `KITS-EOS_Registrations_${dateFilter}.xlsx`;
      const subtitle = `Registrations on ${formatDisplayDate(dateFilter)} | Total Matching Registrations: ${dataset.regs.length} (1 Registration = 1 Row)`;

      await exportToExcel({
        filename,
        title: 'KITS-EOS DATE-WISE REGISTRATION REPORT',
        subtitle,
        headers: REGISTRATION_REPORT_HEADERS,
        rows,
      });
    } catch (err: any) {
      console.error('Date-wise export failed:', err);
      alert('Failed to generate date-wise Excel report: ' + (err.message || 'Unknown error'));
    }
  };

  // Download Sub-Event Registrations Handler
  const handleExportSubEvent = async () => {
    if (subEventFilter === 'ALL') return;
    const activeSub = subEvents.find(s => s.id === subEventFilter);
    const activeEv = events.find(e => e.id === eventFilter);

    try {
      const dataset = await fetchCompleteExportDataset({
        subEventId: subEventFilter,
        date: dateFilter || undefined,
        eventId: eventFilter !== 'ALL' ? eventFilter : undefined,
      });

      if (dataset.regs.length === 0) {
        alert('No registrations found for this sub-event to export.');
        return;
      }

      const rows = buildRegistrationExcelRows(dataset.regs, dataset.payments, dataset.attendance, dataset.profiles);
      const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/_+/g, '_');
      const evPart = activeEv ? sanitize(activeEv.name) : 'Event';
      const subPart = activeSub ? sanitize(activeSub.name) : 'SubEvent';
      const filename = `KITS-EOS_${evPart}_${subPart}_Registrations.xlsx`;
      const subtitle = `Sub-Event: ${activeSub?.name || 'Sub-Event'} (${activeEv?.name || 'Main Event'})${dateFilter ? ` | Date: ${formatDisplayDate(dateFilter)}` : ''} | Total Matching Registrations: ${dataset.regs.length} (1 Registration = 1 Row)`;

      await exportToExcel({
        filename,
        title: 'KITS-EOS SUB-EVENT REGISTRATION REPORT',
        subtitle,
        headers: REGISTRATION_REPORT_HEADERS,
        rows,
      });
    } catch (err: any) {
      console.error('Sub-event export failed:', err);
      alert('Failed to generate sub-event Excel report: ' + (err.message || 'Unknown error'));
    }
  };

  // Metric aggregates
  const totalCount = registrations.length;
  const confirmedCount = registrations.filter(r => r.status === 'CONFIRMED').length;
  const pendingCount = registrations.filter(r => r.status === 'PENDING_PAYMENT').length;
  const totalStudents = registrations.reduce((acc, r) => {
    const team = r.teams && r.teams.length > 0 ? r.teams[0] : null;
    return acc + (team?.team_members?.length || (r.status !== 'CANCELLED' ? 1 : 0));
  }, 0);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {successToast && (
        <div className="fixed top-6 right-6 z-50 max-w-md bg-emerald-900/95 text-white px-4 py-3.5 rounded-2xl shadow-2xl border border-emerald-700/60 backdrop-blur-md flex items-center justify-between gap-3 toast-animate">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <p className="text-xs font-bold leading-snug">{successToast}</p>
          </div>
          <button 
            onClick={() => setSuccessToast(null)}
            className="p-1 text-emerald-300 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Student Registrations"
          description="Inspect, filter, select, track attendance, and securely manage registrations across events and sub-events."
        />
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <DownloadButton
            onDownload={handleExportExcel}
            label="Export Excel"
            preparingLabel="Preparing Excel..."
            downloadingLabel="Generating Export..."
            completedLabel="Exported"
            variant="success"
            size="md"
            icon={<FileSpreadsheet className="h-4 w-4" />}
            title="Download filtered student registration roster as Excel (.xlsx)"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-2xs flex items-center gap-4">
          <div className="p-3 bg-red-50 text-kits-red rounded-lg">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total Registrations</p>
            <p className="text-2xl font-black text-gray-900">{totalCount}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-2xs flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Confirmed</p>
            <p className="text-2xl font-black text-emerald-700">{confirmedCount}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-2xs flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Pending Payment</p>
            <p className="text-2xl font-black text-amber-700">{pendingCount}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-2xs flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-kits-blue rounded-lg">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total Students</p>
            <p className="text-2xl font-black text-kits-blue">{totalStudents}</p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by Student Name, Roll No, Team, Department, or Reg ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-kits-red focus:border-kits-red"
            />
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto flex-wrap">
            {/* Attendance Filter */}
            <select
              value={attendanceFilter}
              onChange={(e) => setAttendanceFilter(e.target.value as any)}
              className="bg-white border border-gray-300 text-gray-700 text-xs font-bold rounded-lg px-3 py-2 focus:ring-1 focus:ring-kits-red focus:border-kits-red"
              title="Filter registrations by attendance status"
            >
              <option value="ALL">Overall Registrations</option>
              <option value="ATTENDED">✓ Attended Only</option>
              <option value="NOT_ATTENDED">○ Not Attended Only</option>
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-white border border-gray-300 text-gray-700 text-xs font-bold rounded-lg px-3 py-2 focus:ring-1 focus:ring-kits-red focus:border-kits-red"
            >
              <option value="ALL">All Statuses</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="PENDING_PAYMENT">Pending Payment</option>
              <option value="CANCELLED">Cancelled</option>
            </select>

            {/* Type Filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="bg-white border border-gray-300 text-gray-700 text-xs font-bold rounded-lg px-3 py-2 focus:ring-1 focus:ring-kits-red focus:border-kits-red"
            >
              <option value="ALL">All Modes (Solo/Team)</option>
              <option value="SOLO">Solo Only</option>
              <option value="TEAM">Team Only</option>
            </select>

            {/* Quick Export Button */}
            <DownloadButton
              onDownload={handleExportExcel}
              label="Export Excel"
              preparingLabel="Preparing..."
              downloadingLabel="Exporting..."
              completedLabel="Exported"
              variant="success"
              size="sm"
              icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
              title="Download filtered student registration roster as Excel (.xlsx)"
            />
          </div>
        </div>

        {/* Cascading Event, Sub-Event & Registration Date Selectors */}
        <div className="pt-2 border-t border-gray-100 flex flex-col lg:flex-row items-center gap-3">
          {/* Registration Date Filter */}
          <div className="flex items-center gap-2 w-full lg:w-1/3">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-kits-red" />
              <span>Date:</span>
            </span>
            <div className="relative flex-1">
              <input
                id="reg-date-filter"
                type="date"
                value={dateFilter}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full bg-white border border-gray-300 text-gray-700 text-xs font-semibold rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-kits-red focus:border-kits-red cursor-pointer"
                title="Filter registrations created on this calendar date (Institutional Local Timezone)"
              />
              {dateFilter && (
                <button
                  type="button"
                  onClick={() => handleDateChange('')}
                  className="absolute right-8 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100 cursor-pointer"
                  title="Clear date filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Main Event Selector */}
          <div className="flex items-center gap-2 w-full lg:w-1/3">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">Event:</span>
            <select
              value={eventFilter}
              onChange={(e) => handleEventFilterChange(e.target.value)}
              className="w-full bg-white border border-gray-300 text-gray-700 text-xs font-semibold rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-kits-red focus:border-kits-red cursor-pointer"
            >
              <option value="ALL">All Main Events</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          </div>

          {/* Sub-Event Selector (Disabled until Main Event is chosen) */}
          <div className="flex items-center gap-2 w-full lg:w-1/3">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">Sub-Event:</span>
            <select
              disabled={eventFilter === 'ALL'}
              value={subEventFilter}
              onChange={(e) => setSubEventFilter(e.target.value)}
              className={`w-full border text-xs font-semibold rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-kits-red focus:border-kits-red ${
                eventFilter === 'ALL'
                  ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                  : 'bg-white text-gray-700 border-gray-300 cursor-pointer'
              }`}
              title={eventFilter === 'ALL' ? 'Select a Main Event first to choose sub-events' : 'Select a Sub-Event'}
            >
              {eventFilter === 'ALL' ? (
                <option value="ALL">Select a Main Event First</option>
              ) : (
                <>
                  <option value="ALL">All Sub-Events in this Event</option>
                  {availableSubEvents.map((sub) => (
                    <option key={sub.id} value={sub.id}>{sub.name}</option>
                  ))}
                </>
              )}
            </select>
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearAllFilters}
              className="px-3 py-1.5 text-xs font-bold text-gray-600 hover:text-kits-red bg-gray-50 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition cursor-pointer whitespace-nowrap shrink-0"
              title="Reset all date, event, status, mode, and search filters"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Dedicated Date-Wise Registration Report Banner */}
      {dateFilter && (
        <div className="bg-gradient-to-r from-red-50/90 via-white to-red-50/50 rounded-2xl border border-red-200/80 p-4 sm:p-5 shadow-2xs space-y-3 animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-red-100 text-kits-red rounded-xl shrink-0">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm sm:text-base font-black text-gray-900 tracking-tight">
                    Registrations on {formatDisplayDate(dateFilter)}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-kits-red text-white">
                    Date Report
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 font-medium">
                  Authoritative calendar day created registrations ({dateMetrics.total} on date, {filteredRegistrations.length} matching active filters)
                </p>
              </div>
            </div>

            <DownloadButton
              onDownload={handleExportDateWise}
              label="Download Date-Wise Excel"
              preparingLabel="Preparing..."
              downloadingLabel="Generating Date Report..."
              completedLabel="Date Report Downloaded"
              variant="success"
              size="md"
              icon={<FileSpreadsheet className="h-4 w-4" />}
              title={`Download registrations created on ${formatDisplayDate(dateFilter)} as Excel (.xlsx)`}
            />
          </div>

          {/* Date Report Metrics Ribbon */}
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-red-100 text-xs font-bold">
            <span className="px-3 py-1 rounded-lg bg-white border border-gray-200 text-gray-800 shadow-2xs">
              Total: <strong className="text-gray-900">{dateMetrics.total}</strong>
            </span>
            <span className="px-3 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 shadow-2xs">
              Confirmed: <strong className="text-emerald-700">{dateMetrics.confirmed}</strong>
            </span>
            <span className="px-3 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 shadow-2xs">
              Pending Payment: <strong className="text-amber-700">{dateMetrics.pendingPayment}</strong>
            </span>
            <span className="px-3 py-1 rounded-lg bg-blue-50 border border-blue-200 text-kits-blue shadow-2xs">
              Attended: <strong className="text-blue-700">{dateMetrics.attended}</strong>
            </span>
          </div>
        </div>
      )}

      {/* Dedicated Sub-Event Registrations Panel */}
      {eventFilter !== 'ALL' && subEventFilter !== 'ALL' && (
        <div className="bg-gradient-to-r from-blue-50/90 via-white to-blue-50/50 rounded-2xl border border-blue-200/80 p-4 sm:p-5 shadow-2xs space-y-3 animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-100 text-kits-blue rounded-xl shrink-0">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm sm:text-base font-black text-gray-900 tracking-tight">
                    {subEvents.find(s => s.id === subEventFilter)?.name || 'Sub-Event'}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-kits-blue text-white">
                    Sub-Event Report
                  </span>
                  <span className="text-xs font-bold text-gray-500">
                    • {events.find(e => e.id === eventFilter)?.name || 'Main Event'}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 font-medium">
                  Authoritative sub-event registration roster ({subEventMetrics.total} total, {filteredRegistrations.length} matching active filters)
                </p>
              </div>
            </div>

            <DownloadButton
              onDownload={handleExportSubEvent}
              label="Download Sub-Event Registrations"
              preparingLabel="Preparing..."
              downloadingLabel="Generating Sub-Event Report..."
              completedLabel="Sub-Event Report Downloaded"
              variant="success"
              size="md"
              icon={<FileSpreadsheet className="h-4 w-4" />}
              title={`Download registrations for this sub-event as Excel (.xlsx)`}
            />
          </div>

          {/* Sub-Event Metrics Ribbon */}
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-blue-100 text-xs font-bold">
            <span className="px-3 py-1 rounded-lg bg-white border border-gray-200 text-gray-800 shadow-2xs">
              Total: <strong className="text-gray-900">{subEventMetrics.total}</strong>
            </span>
            <span className="px-3 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 shadow-2xs">
              Confirmed: <strong className="text-emerald-700">{subEventMetrics.confirmed}</strong>
            </span>
            <span className="px-3 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 shadow-2xs">
              Pending Payment: <strong className="text-amber-700">{subEventMetrics.pendingPayment}</strong>
            </span>
            <span className="px-3 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 shadow-2xs">
              Attended: <strong className="text-indigo-700">{subEventMetrics.attended}</strong>
            </span>
            <span className="px-3 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 shadow-2xs">
              Solo: <strong>{subEventMetrics.solo}</strong> • Team: <strong>{subEventMetrics.team}</strong>
            </span>
          </div>
        </div>
      )}

      {/* Floating Bulk Selection Action Bar */}
      {selectedRegIds.size > 0 && (
        <div className="sticky top-4 z-30 p-3.5 bg-gray-900 text-white rounded-2xl shadow-xl border border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2.5 text-xs">
            <span className="px-2.5 py-0.5 rounded-full bg-kits-red text-white font-black text-[11px]">
              {selectedRegIds.size}
            </span>
            <span className="font-bold">
              {selectedRegIds.size === 1 ? '1 registration selected' : `${selectedRegIds.size} registrations selected`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearSelection}
              className="px-3 py-1.5 text-xs text-gray-300 hover:text-white font-bold transition cursor-pointer rounded-lg hover:bg-white/10"
            >
              Clear Selection
            </button>

            <button
              type="button"
              onClick={handleOpenBulkDelete}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete Selected</span>
            </button>
          </div>
        </div>
      )}

      {/* Select All & Summary Header Bar */}
      {!isLoading && !error && filteredRegistrations.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/90 border border-gray-200 rounded-xl text-xs font-bold text-gray-700">
          <button
            type="button"
            onClick={handleToggleSelectAll}
            className="flex items-center gap-2 text-xs font-bold text-gray-700 hover:text-gray-900 transition cursor-pointer"
            title={allVisibleSelected ? 'Deselect all visible registrations' : 'Select all visible registrations'}
          >
            {allVisibleSelected ? (
              <CheckSquare className="h-4.5 w-4.5 text-kits-red" />
            ) : someVisibleSelected ? (
              <MinusSquare className="h-4.5 w-4.5 text-kits-red" />
            ) : (
              <Square className="h-4.5 w-4.5 text-gray-400" />
            )}
            <span>
              {allVisibleSelected
                ? `Deselect All Visible (${filteredRegistrations.length})`
                : `Select All Visible (${filteredRegistrations.length})`}
            </span>
          </button>

          {selectedRegIds.size > 0 && (
            <span className="text-[11px] font-bold text-gray-500">
              {selectedRegIds.size} of {registrations.length} selected in directory
            </span>
          )}
        </div>
      )}

      {/* Registrations List / Table */}
      {isLoading ? (
        <LoadingState message="Loading registrations directory..." />
      ) : error ? (
        <ErrorState message={error} />
      ) : filteredRegistrations.length === 0 ? (
        <EmptyState
          title="No Registrations Found"
          description={
            dateFilter && subEventFilter !== 'ALL'
              ? "No registrations were created on this date for this sub-event."
              : dateFilter
                ? "No registrations were created on this date."
                : subEventFilter !== 'ALL'
                  ? "No registrations found for this sub-event."
                  : searchQuery || eventFilter !== 'ALL' || statusFilter !== 'ALL' || typeFilter !== 'ALL' || attendanceFilter !== 'ALL'
                    ? "No registrations match your selected filter criteria."
                    : "No student registrations have been submitted yet."
          }
          icon={<ClipboardList className="h-8 w-8 text-gray-400" />}
        />
      ) : (
        <div className="space-y-3">
          {paginatedRegistrations.map((reg) => {
            const sub = reg.sub_events;
            const { team, members } = resolveTeamData(reg);
            const leaderMember = members.find(m => m.is_leader) || members[0];
            const leaderDetails = resolveMemberDetails(leaderMember, reg);
            const isTeam = members.length > 1 || (team?.team_name && team.team_name.trim().length > 0 && team.team_name !== 'Solo Participant');
            const isExpanded = expandedRegId === reg.id;
            const isSelected = selectedRegIds.has(reg.id);
            const eventName = sub?.events?.name || sub?.categories?.events?.name || 'Main Event';

            return (
              <div 
                key={reg.id} 
                className={`bg-white rounded-xl border transition overflow-hidden ${
                  isSelected 
                    ? 'border-red-300 ring-1 ring-red-200 bg-red-50/10 shadow-xs' 
                    : 'border-gray-200 shadow-2xs hover:border-gray-300'
                }`}
              >
                {/* Registration Card Header */}
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex items-start gap-3">
                    {/* Select Checkbox */}
                    <button
                      type="button"
                      onClick={() => handleToggleSelectReg(reg.id)}
                      className="text-gray-400 hover:text-gray-900 transition cursor-pointer p-0.5 rounded shrink-0 mt-0.5"
                      title={isSelected ? 'Deselect registration' : 'Select registration'}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4.5 w-4.5 text-kits-red" />
                      ) : (
                        <Square className="h-4.5 w-4.5 text-gray-300 hover:text-gray-500" />
                      )}
                    </button>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                          #{reg.id.substring(0, 8)}
                        </span>
                        
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold ${
                          isTeam 
                            ? 'bg-blue-50 text-kits-blue border border-blue-200' 
                            : 'bg-gray-100 text-gray-800 border border-gray-200'
                        }`}>
                          {isTeam ? <Users className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          {isTeam ? `Team (${members.length} Members)` : 'Solo'}
                        </span>

                        {/* Status Badge */}
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider ${
                          reg.status === 'CONFIRMED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : reg.status === 'PENDING_PAYMENT'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                          {reg.status === 'CONFIRMED' && <CheckCircle2 className="h-3 w-3" />}
                          {reg.status === 'PENDING_PAYMENT' && <Clock className="h-3 w-3" />}
                          {reg.status === 'CANCELLED' && <XCircle className="h-3 w-3" />}
                          {reg.status.replace('_', ' ')}
                        </span>

                        {/* Attendance Badge */}
                        {hasRegistrationAttended(reg) ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            <span>Attended</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-gray-100 text-gray-600 border border-gray-200">
                            <Clock className="h-3 w-3 text-gray-400" />
                            <span>Not Attended</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Layers className="h-3.5 w-3.5 text-gray-400" />
                        <span className="font-semibold text-gray-800">{sub?.name || 'Sub-Event'}</span>
                        <span>•</span>
                        <span>{eventName} {sub?.categories?.name ? `› ${sub.categories.name}` : ''}</span>
                      </div>
                    </div>
                  </div>

                  {/* Primary Contact / Leader info & Actions */}
                  <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-3 sm:pt-0 border-gray-100 flex-wrap">
                    <div className="text-left sm:text-right">
                      {isTeam && team?.team_name && (
                        <div className="text-xs font-extrabold text-kits-blue">Team: {team.team_name}</div>
                      )}
                      <div className="text-xs font-bold text-gray-900">
                        {leaderDetails.name}
                      </div>
                      <div className="text-[11px] text-gray-500 font-mono">
                        {leaderDetails.rollNumber !== 'Not provided' ? leaderDetails.rollNumber : 'Roll: Not provided'} • {leaderDetails.department !== 'Not provided' ? leaderDetails.department : 'Dept: Not provided'}
                      </div>
                    </div>

                    {/* Action Buttons: View Details & Delete Registration */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setExpandedRegId(isExpanded ? null : reg.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition cursor-pointer"
                      >
                        <span>
                          {isExpanded ? 'Hide Details' : (
                            documentsMap[reg.id]?.length ? `View Details (${documentsMap[reg.id].length} docs)` : 'View Details'
                          )}
                        </span>
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenSingleDelete(reg)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-700 rounded-lg border border-red-200 transition cursor-pointer"
                        title="Delete this registration permanently"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Details Tray: Team Roster & Uploaded Documents */}
                {isExpanded && (
                  <div className="bg-gray-50/80 p-4 sm:p-5 border-t border-gray-200 space-y-4">
                    {/* Team Members Roster */}
                    {isTeam && members.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-kits-blue flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-kits-red" />
                            Team Roster ({members.length} Participants)
                          </h5>
                          <button
                            type="button"
                            onClick={() => setSelectedIdCard({ member: leaderMember, reg })}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-kits-red hover:bg-red-800 text-white rounded-lg text-xs font-extrabold transition shadow-2xs cursor-pointer"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span>View Team ID Card</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {members.map((member: TeamMember) => {
                            const mDetails = resolveMemberDetails(member, reg);
                            return (
                              <div 
                                key={member.id}
                                className="bg-white p-3 rounded-lg border border-gray-200 shadow-2xs space-y-1.5 relative"
                              >
                                {member.is_leader && (
                                  <span className="absolute top-2.5 right-2.5 text-[9px] font-extrabold uppercase tracking-widest bg-blue-50 text-kits-blue px-1.5 py-0.5 rounded border border-blue-200">
                                    Leader
                                  </span>
                                )}
                                <div className="flex items-center justify-between gap-2 pr-12">
                                  <span className="font-bold text-gray-900 text-xs">{mDetails.name}</span>
                                  {attendanceMap[member.id] ? (
                                    <span className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-1 shrink-0">
                                      <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />
                                      Attended
                                    </span>
                                  ) : (
                                    <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200 flex items-center gap-1 shrink-0">
                                      <Clock className="h-2.5 w-2.5 text-gray-400" />
                                      Pending Check-in
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] font-mono text-gray-600">{mDetails.rollNumber}</div>
                                <div className="text-[11px] text-gray-500">
                                  {mDetails.department} (Year {mDetails.year})
                                </div>
                                <div className="text-[10px] text-gray-400 truncate">{mDetails.college}</div>
                                <div className="pt-1.5 border-t border-gray-100 flex items-center justify-between text-[10px] font-mono text-gray-400">
                                  <span className="flex items-center gap-1">
                                    <QrCode className="h-3 w-3 text-gray-400" />
                                    Token:
                                  </span>
                                  <span className="font-bold text-gray-700">{mDetails.manualToken}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Uploaded Documents Section */}
                    {documentsMap[reg.id] && documentsMap[reg.id].length > 0 ? (
                      <div className="space-y-3 pt-2">
                        <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                          <Paperclip className="h-3.5 w-3.5 text-kits-red" />
                          UPLOADED DOCUMENTS ({documentsMap[reg.id].length})
                        </h5>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {documentsMap[reg.id].map((doc: any) => (
                            <div 
                              key={doc.id}
                              className="bg-white p-4 rounded-xl border border-gray-200 shadow-2xs flex flex-col justify-between gap-3 hover:border-gray-300 transition"
                            >
                              <div className="flex items-start gap-3">
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
                                <button
                                  type="button"
                                  onClick={() => setDocDeleteModal({ open: true, doc, regId: reg.id })}
                                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold border border-red-200 transition cursor-pointer"
                                  title="Permanently delete this document from storage and database"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>Delete</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      !isTeam && (
                        <div className="flex items-center justify-between pt-1">
                          <div className="text-xs text-gray-400 italic">
                            No additional documents were uploaded during registration.
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedIdCard({ member: leaderMember, reg })}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-kits-red hover:bg-red-800 text-white rounded-lg text-xs font-extrabold transition shadow-2xs cursor-pointer"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span>View / Download Student ID Card</span>
                          </button>
                        </div>
                      )
                    )}
                  </div>
                )}

                {/* Footer Timestamp & ID Card shortcut */}
                <div className="bg-gray-50 px-4 sm:px-5 py-2.5 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400 font-mono">
                  <span>Registered: {formatDateTime12h(reg.created_at)}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedIdCard({ member: leaderMember, reg })}
                    className="font-sans text-xs font-extrabold text-kits-blue hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <FileText className="h-3.5 w-3.5 text-kits-red" />
                    <span>{isTeam ? 'Team ID Card' : 'Student ID Card'}</span>
                  </button>
                  {isTeam && <span>College: {leaderDetails.college}</span>}
                </div>
              </div>
            );
          })}

          {/* Pagination Controls */}
          <div className="p-4 bg-white rounded-xl border border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600 shadow-2xs">
            <div>
              Showing <strong className="text-gray-900">{filteredRegistrations.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}</strong>–<strong className="text-gray-900">{Math.min(currentPage * PAGE_SIZE, filteredRegistrations.length)}</strong> of <strong className="text-gray-900">{filteredRegistrations.length}</strong> registrations
              {registrations.length !== filteredRegistrations.length && ` (filtered from ${registrations.length})`}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Prev</span>
                </button>

                <span className="px-3 py-1 font-mono font-bold text-gray-800 bg-white border border-gray-200 rounded-lg shadow-2xs">
                  {currentPage} / {totalPages}
                </span>

                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="Next page"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Two-Step Registration Deletion Confirmation Modal (Single & Bulk) */}
      {deleteModal.open && deleteModal.targets.length > 0 && (() => {
        const isBulk = deleteModal.targets.length > 1;
        const singleTarget = !isBulk ? deleteModal.targets[0] : null;
        
        let singleDetails: any = null;
        let singleSub: any = null;
        let singleEventName = 'Flagship Event';
        let singleIsTeam = false;
        let singleTeam: any = null;

        if (singleTarget) {
          singleSub = singleTarget.sub_events;
          const { team, members } = resolveTeamData(singleTarget);
          const leaderMember = members.find(m => m.is_leader) || members[0];
          singleDetails = resolveMemberDetails(leaderMember, singleTarget);
          singleIsTeam = members.length > 1 || (team?.team_name && team.team_name.trim().length > 0 && team.team_name !== 'Solo Participant');
          singleEventName = singleSub?.events?.name || singleSub?.categories?.events?.name || 'Flagship Event';
          singleTeam = team;
        }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-lg w-full overflow-hidden transition-all">
              {/* Modal Header */}
              <div className="px-6 py-4 bg-red-50/80 border-b border-red-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 text-red-600 rounded-xl">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">
                      {isBulk 
                        ? `Bulk Delete Registrations (Step ${deleteModal.step} of 2)` 
                        : `Delete Registration (Step ${deleteModal.step} of 2)`}
                    </h3>
                    <p className="text-[11px] text-red-700 font-semibold">
                      {deleteModal.step === 1 ? 'Permanent Deletion Warning' : 'Explicit Action Verification'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeDeleteModal}
                  disabled={isDeleting}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-red-100/60 transition cursor-pointer disabled:opacity-40"
                  aria-label="Close modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 space-y-4">
                {deleteModal.step === 1 ? (
                  /* STEP 1: WARNING & SUMMARY */
                  <div className="space-y-4 text-xs">
                    <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-900 leading-relaxed font-semibold flex items-start gap-2.5">
                      <AlertOctagon className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                      <span>
                        {isBulk
                          ? `You are about to permanently delete ${deleteModal.targets.length} selected registrations and their associated registration data. This action cannot be undone.`
                          : 'You are about to permanently delete this registration and its associated registration data. This action cannot be undone.'}
                      </span>
                    </div>

                    {/* Single Registration Details */}
                    {!isBulk && singleTarget && singleDetails && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">
                          Registration Details
                        </p>

                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                          <div>
                            <span className="text-gray-400 block text-[10px] uppercase font-bold">Reg ID</span>
                            <span className="font-mono font-bold text-gray-800">#{singleTarget.id.substring(0, 8)}</span>
                          </div>

                          <div>
                            <span className="text-gray-400 block text-[10px] uppercase font-bold">Status</span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                              singleTarget.status === 'CONFIRMED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : singleTarget.status === 'PENDING_PAYMENT'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-red-100 text-red-800'
                            }`}>
                              {singleTarget.status.replace('_', ' ')}
                            </span>
                          </div>

                          <div>
                            <span className="text-gray-400 block text-[10px] uppercase font-bold">Student / Leader</span>
                            <span className="font-bold text-gray-900">{singleDetails.name}</span>
                          </div>

                          <div>
                            <span className="text-gray-400 block text-[10px] uppercase font-bold">Roll Number</span>
                            <span className="font-mono text-gray-700">{singleDetails.rollNumber}</span>
                          </div>

                          <div>
                            <span className="text-gray-400 block text-[10px] uppercase font-bold">Flagship Event</span>
                            <span className="font-semibold text-gray-800">{singleEventName}</span>
                          </div>

                          <div>
                            <span className="text-gray-400 block text-[10px] uppercase font-bold">Sub-Event</span>
                            <span className="font-semibold text-gray-800">{singleSub?.name || 'Sub-Event'}</span>
                          </div>

                          {singleIsTeam && (
                            <div className="col-span-2 pt-1 border-t border-gray-200/60">
                              <span className="text-gray-400 block text-[10px] uppercase font-bold">Team Name</span>
                              <span className="font-bold text-kits-blue">{singleTeam?.team_name || 'Team'}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Bulk Selected Registrations List */}
                    {isBulk && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[11px] font-bold text-gray-600">
                          <span>Selected Registrations ({deleteModal.targets.length})</span>
                          <span className="text-[10px] font-mono text-gray-400">Scroll to review</span>
                        </div>

                        <div className="max-h-56 overflow-y-auto space-y-2 pr-1 border border-gray-200 rounded-xl p-2 bg-gray-50">
                          {deleteModal.targets.map((reg) => {
                            const sub = reg.sub_events;
                            const { team, members } = resolveTeamData(reg);
                            const leaderMember = members.find(m => m.is_leader) || members[0];
                            const leaderDetails = resolveMemberDetails(leaderMember, reg);
                            const isTeam = members.length > 1 || (team?.team_name && team.team_name.trim().length > 0 && team.team_name !== 'Solo Participant');
                            const evName = sub?.events?.name || sub?.categories?.events?.name || 'Event';

                            return (
                              <div 
                                key={reg.id}
                                className="bg-white p-2.5 rounded-lg border border-gray-200 text-xs flex items-center justify-between gap-3 shadow-2xs"
                              >
                                <div className="space-y-0.5 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-mono text-[10px] font-bold bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                                      #{reg.id.substring(0, 8)}
                                    </span>
                                    <span className="font-bold text-gray-900 truncate max-w-[140px]" title={leaderDetails.name}>
                                      {leaderDetails.name}
                                    </span>
                                    <span className="font-mono text-[10px] text-gray-500">
                                      ({leaderDetails.rollNumber})
                                    </span>
                                  </div>

                                  <div className="text-[10px] text-gray-500 truncate">
                                    {sub?.name || 'Sub-Event'} • {evName} {isTeam ? `• Team: ${team?.team_name}` : ''}
                                  </div>
                                </div>

                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase shrink-0 ${
                                  reg.status === 'CONFIRMED'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : reg.status === 'PENDING_PAYMENT'
                                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                      : 'bg-red-50 text-red-700 border border-red-200'
                                }`}>
                                  {reg.status.replace('_', ' ')}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <p className="text-[11px] text-gray-500 leading-normal italic">
                      Associated records (payments, team rosters, attendance, certificates, and uploaded documents) will be purged safely. Student login accounts remain unaffected.
                    </p>

                    {/* Step 1 Actions */}
                    <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={closeDeleteModal}
                        className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 rounded-xl hover:bg-gray-100 transition cursor-pointer"
                      >
                        Cancel
                      </button>

                      <button
                        type="button"
                        onClick={handleProceedToStep2}
                        className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
                      >
                        <span>Continue to Delete</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* STEP 2: TYPED CONFIRMATION */
                  <div className="space-y-4 text-xs">
                    <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl space-y-1.5">
                      <p className="text-[11px] font-black uppercase tracking-wider text-red-800">
                        Final Destructive Confirmation Required
                      </p>
                      <p className="text-xs text-red-900 leading-relaxed">
                        {isBulk ? (
                          <>To permanently delete <strong className="font-black text-red-950">{deleteModal.targets.length} registrations</strong> and their records, type <span className="font-mono text-red-700 font-black">DELETE</span> below:</>
                        ) : (
                          <>To permanently delete registration <span className="font-mono font-black">#{singleTarget?.id.substring(0, 8)}</span> for <strong>{singleDetails?.name}</strong>, type <span className="font-mono text-red-700 font-black">DELETE</span> below:</>
                        )}
                      </p>
                    </div>

                    {/* Typed confirmation input */}
                    <div className="space-y-1.5 pt-1">
                      <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-700">
                        TYPE <span className="font-mono text-red-600 font-black">DELETE</span> TO CONFIRM:
                      </label>
                      <input
                        type="text"
                        placeholder='Type "DELETE"'
                        value={deletePhrase}
                        onChange={(e) => setDeletePhrase(e.target.value)}
                        disabled={isDeleting}
                        className="w-full px-3.5 py-2.5 border border-red-300 rounded-xl font-mono text-xs text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-red-500 uppercase"
                        autoFocus
                      />
                    </div>

                    {deleteError && (
                      <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
                        <span>{deleteError}</span>
                      </div>
                    )}

                    {/* Step 2 Actions */}
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteModal((prev) => ({ ...prev, step: 1 }));
                          setDeleteError(null);
                        }}
                        disabled={isDeleting}
                        className="px-3.5 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 rounded-xl hover:bg-gray-100 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        <span>Back</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={closeDeleteModal}
                          disabled={isDeleting}
                          className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 rounded-xl hover:bg-gray-100 transition cursor-pointer disabled:opacity-40"
                        >
                          Cancel
                        </button>

                        <DeleteButton
                          disabled={isDeleting || deletePhrase !== 'DELETE'}
                          loading={isDeleting}
                          onClick={handleExecuteDelete}
                          className="px-5 py-2.5 rounded-xl"
                          label={
                            isBulk
                              ? `Permanently Delete ${deleteModal.targets.length} Registrations`
                              : 'Permanently Delete Registration'
                          }
                          loadingLabel="Deleting..."
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Digital ID Card Modal */}
      {selectedIdCard && (() => {
        const { member, reg } = selectedIdCard;
        const sub = reg.sub_events;
        const evName = sub?.events?.name || sub?.categories?.events?.name || 'Flagship Event';
        const { team } = resolveTeamData(reg);
        const memberDetails = resolveMemberDetails(member, reg);
        const isTeam = (team?.team_name && team.team_name.trim().length > 0 && team.team_name !== 'Solo Participant');
        const teamRole = isTeam
          ? (member?.is_leader ? 'TEAM LEADER' : 'TEAM MEMBER')
          : 'SOLO PARTICIPANT';

        const teamMembers = isTeam && team?.team_members
          ? team.team_members.map((tm: any) => {
              const d = resolveMemberDetails(tm, reg);
              return {
                id: tm.id,
                name: d.name,
                department: d.department,
                year: d.year,
                rollNumber: d.rollNumber,
                college: d.college,
                isLeader: Boolean(tm.is_leader),
              };
            })
          : [];

        return (
          <DigitalIdCardModal
            isOpen={true}
            onClose={() => setSelectedIdCard(null)}
            studentName={memberDetails.name}
            rollNumber={memberDetails.rollNumber}
            department={memberDetails.department}
            year={memberDetails.year}
            college={memberDetails.college}
            eventName={evName}
            categoryName={sub?.categories?.name}
            subEventName={sub?.name || 'Sub-Event'}
            participationType={sub?.participation_type || (isTeam ? 'Team' : 'Solo')}
            teamName={team?.team_name}
            teamRole={teamRole}
            registrationId={reg.id}
            manualToken={memberDetails.manualToken}
            qrIdentity={!isTeam ? (member?.qr_identity || memberDetails.qrIdentity) : undefined}
            qrPayload={member?.manual_token || memberDetails.manualToken}
            isTeam={isTeam}
            teamMembers={teamMembers}
          />
        );
      })()}

      {/* Individual Document Deletion Confirmation Modal */}
      {docDeleteModal?.open && docDeleteModal.doc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-red-100 text-kits-red rounded-xl">
                    <Trash2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-gray-900">
                      Permanently Delete Document
                    </h3>
                    <p className="text-xs text-gray-500">
                      Registration #{docDeleteModal.regId.substring(0, 8)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!isDeletingDoc) {
                      setDocDeleteModal(null);
                      setDocDeleteError(null);
                    }
                  }}
                  disabled={isDeletingDoc}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200/80 space-y-1">
                <div className="text-xs font-bold text-gray-800 break-words flex items-center gap-2">
                  <FileText className="h-4 w-4 text-kits-red shrink-0" />
                  <span>{docDeleteModal.doc.file_name}</span>
                </div>
                <div className="text-[11px] text-gray-500 font-mono">
                  Path: {docDeleteModal.doc.storage_path}
                </div>
                <div className="text-[11px] text-gray-500">
                  Size: {(Number(docDeleteModal.doc.size_bytes) / 1024).toFixed(1)} KB
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900 font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  This action will <strong>permanently purge the actual file</strong> from Supabase Storage and remove its database metadata record. This cannot be undone.
                </div>
              </div>

              {docDeleteError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold flex items-start gap-2">
                  <AlertOctagon className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{docDeleteError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setDocDeleteModal(null);
                    setDocDeleteError(null);
                  }}
                  disabled={isDeletingDoc}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDeleteDoc}
                  disabled={isDeletingDoc}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-kits-red hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer disabled:opacity-50"
                >
                  {isDeletingDoc ? (
                    <>
                      <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Deleting File...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Confirm Delete</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
