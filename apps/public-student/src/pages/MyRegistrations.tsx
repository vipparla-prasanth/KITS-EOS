import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import type { Registration, RequiredDocumentConfig } from '@kits-eos/shared/src/types/models';
import { useScrollLock, uploadRegistrationDocument, executeDocumentDeletion, MAX_DOCUMENT_SIZE } from '@kits-eos/shared';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { playRegistrationSuccessSound } from '../utils/registrationSound';
import { 
  QrCode, 
  CheckCircle2, 
  Clock, 
  Sparkles, 
  Award, 
  MessageSquare, 
  Star, 
  X, 
  Receipt, 
  IdCard, 
  Banknote, 
  Phone, 
  Lock, 
  AlertTriangle, 
  Users, 
  User,
  Upload,
  FileText,
  Check,
  AlertCircle,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { DigitalIdCard } from '../components/credentials/DigitalIdCard';
import { TeamDigitalIdCard } from '../components/credentials/TeamDigitalIdCard';
import { AttendanceQrPass } from '../components/credentials/AttendanceQrPass';
import { TransactionReceipt } from '../components/credentials/TransactionReceipt';
import { OversizedDocumentModal } from '../components/ui/OversizedDocumentModal';

/**
 * Robust, registration-specific document matching helper.
 * Associates an uploaded document record with the corresponding required document configuration.
 */
function findMatchingDocument(docs: any[], docConfig: RequiredDocumentConfig) {
  if (!docs || docs.length === 0) return null;
  if (docs.length === 1) return docs[0];

  const cleanName = (docConfig.name || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  const matchByPath = docs.find((d: any) => {
    const p = (d.storage_path || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return p.includes(cleanName);
  });
  if (matchByPath) return matchByPath;

  const matchByFileName = docs.find((d: any) => {
    const fn = (d.file_name || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return fn.includes(cleanName);
  });
  if (matchByFileName) return matchByFileName;

  return docs[0];
}

interface CoordinatorContact {
  id: string;
  display_name: string;
  coordinator_type: string;
  phone_number: string | null;
}

const CRITERIA = [
  { id: 'r1', label: '1. Overall Experience', desc: 'Overall satisfaction with this competition' },
  { id: 'r2', label: '2. Event Organization & Timing', desc: 'Adherence to schedule and smoothness of rounds' },
  { id: 'r3', label: '3. Venue & Facilities', desc: 'Infrastructure, equipment, and lab/room environment' },
  { id: 'r4', label: '4. Content & Challenge Quality', desc: 'Relevance, fairness, and quality of problem statements/topics' },
  { id: 'r5', label: '5. Coordinator & Volunteer Support', desc: 'Helpfulness and responsiveness of assigned coordinators' },
];

/**
 * Canonical helper to safely resolve team and member records from a registration object.
 * Handles both object and array representations returned by Supabase PostgREST.
 */
function resolveTeamData(reg: any): { team: any; members: any[] } {
  if (!reg?.teams) return { team: null, members: [] };
  const team = Array.isArray(reg.teams) ? (reg.teams.length > 0 ? reg.teams[0] : null) : reg.teams;
  const rawMembers = team?.team_members;
  const members = Array.isArray(rawMembers) ? rawMembers : (rawMembers ? [rawMembers] : []);
  return { team, members };
}

export function MyRegistrations() {
  const { user } = useAuth();
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [submittedFeedbacks, setSubmittedFeedbacks] = useState<Record<string, boolean>>({});
  const [coordinatorMap, setCoordinatorMap] = useState<Record<string, CoordinatorContact[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Document state (registration-specific matching & upload management)
  const [regDocumentsMap, setRegDocumentsMap] = useState<Record<string, any[]>>({});
  const [uploadingDocKey, setUploadingDocKey] = useState<string | null>(null);
  const [deletingDocKey, setDeletingDocKey] = useState<string | null>(null);
  const [docToDelete, setDocToDelete] = useState<{
    reg: any;
    doc: any;
    docConfig: RequiredDocumentConfig;
  } | null>(null);
  const [docDeleteError, setDocDeleteError] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string | null>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Oversized Document Modal state
  const [oversizedModalData, setOversizedModalData] = useState<{
    docConfig: RequiredDocumentConfig;
    subEvent: any;
    reg: any;
    file: File;
    studentName: string;
    uploadKey: string;
  } | null>(null);

  // Active Modals
  const [activeIdCardModal, setActiveIdCardModal] = useState<{ reg: Registration; member: any } | null>(null);
  const [activeQrModal, setActiveQrModal] = useState<{ reg: Registration; member: any } | null>(null);
  const [activeReceiptReg, setActiveReceiptReg] = useState<Registration | null>(null);
  const [activePaymentInfoReg, setActivePaymentInfoReg] = useState<any | null>(null);

  // Feedback Modal
  const [activeFeedbackReg, setActiveFeedbackReg] = useState<Registration | null>(null);
  const [ratings, setRatings] = useState({ r1: 5, r2: 5, r3: 5, r4: 5, r5: 5 });
  const [feedbackComments, setFeedbackComments] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [isUnlockingSubEventId, setIsUnlockingSubEventId] = useState<string | null>(null);

  // Complaint Modal
  const [activeComplaintReg, setActiveComplaintReg] = useState<Registration | null>(null);
  const [complaintCategory, setComplaintCategory] = useState('SCHEDULE');
  const [complaintText, setComplaintText] = useState('');
  const [isSubmittingComplaint, setIsSubmittingComplaint] = useState(false);
  const [complaintSuccess, setComplaintSuccess] = useState<string | null>(null);
  const [complaintError, setComplaintError] = useState<string | null>(null);

  // Safe centralized scroll lock for all modals in MyRegistrations
  const isAnyModalOpen = Boolean(
    activeIdCardModal ||
    activeQrModal ||
    activeReceiptReg ||
    activePaymentInfoReg ||
    activeFeedbackReg ||
    activeComplaintReg ||
    oversizedModalData
  );

  useScrollLock(isAnyModalOpen);

  // Close modals on Escape key
  useEffect(() => {
    if (!isAnyModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveIdCardModal(null);
        setActiveQrModal(null);
        setActiveReceiptReg(null);
        setActivePaymentInfoReg(null);
        setActiveFeedbackReg(null);
        setActiveComplaintReg(null);
        setOversizedModalData(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAnyModalOpen]);

  const fetchMyRegistrations = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      const [regRes, certsRes, fbRes, coordRes, attendRes] = await Promise.all([
        supabase
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
              venue,
              start_time,
              fee_amount_solo,
              fee_amount_team,
              required_documents,
              results_locked,
              results_published,
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
                team_id,
                is_leader,
                manual_token,
                qr_identity,
                snapshot_name,
                snapshot_roll_number,
                snapshot_department,
                snapshot_college,
                snapshot_year
              )
            ),
            payments (
              id,
              amount,
              reference_id,
              payment_method,
              status,
              created_at
            )
          `)
          .eq('leader_id', user.id)
          .order('created_at', { ascending: false }),
        
        supabase
          .from('certificates')
          .select('id, team_member_id, sub_event_id, status, type, certificate_code, issued_at'),

        supabase
          .from('feedback_responses')
          .select('registration_id'),

        supabase
          .from('coordinator_assignments')
          .select(`
            id,
            sub_event_id,
            coordinators (
              id,
              display_name,
              coordinator_type,
              phone_number,
              status
            )
          `),

        supabase
          .from('attendance_records')
          .select('sub_event_id, team_id, scanned_member_id')
      ]);

      if (regRes.error) throw regRes.error;

      // Group coordinators by sub_event_id
      const cmap: Record<string, CoordinatorContact[]> = {};
      if (coordRes.data) {
        coordRes.data.forEach((item: any) => {
          if (item.coordinators && item.coordinators.status !== 'SUSPENDED') {
            if (!cmap[item.sub_event_id]) {
              cmap[item.sub_event_id] = [];
            }
            cmap[item.sub_event_id].push({
              id: item.coordinators.id,
              display_name: item.coordinators.display_name,
              coordinator_type: item.coordinators.coordinator_type || 'COORDINATOR',
              phone_number: item.coordinators.phone_number || null,
            });
          }
        });
      }
      setCoordinatorMap(cmap);

      const fbMap: Record<string, boolean> = {};
      if (fbRes.data) {
        fbRes.data.forEach((fb: any) => {
          fbMap[fb.registration_id] = true;
        });
      }

      // Map individual attendance to team_members (STRICTLY scanned_member_id)
      const attendSet = new Set<string>();
      if (attendRes.data) {
        attendRes.data.forEach((a: any) => {
          if (a.scanned_member_id) {
            attendSet.add(`${a.sub_event_id}_${a.scanned_member_id}`);
          }
        });
      }

      const rawRegs = (regRes.data as any[]) || [];
      const regIds = rawRegs.map(r => r.id).filter(Boolean);

      // Condition 3: Registration-specific document lookup (entity_type = 'REGISTRATION' and entity_id in regIds)
      // NEVER fetch by owner_id alone! Documents are matched strictly per registration.
      const docsMap: Record<string, any[]> = {};
      if (regIds.length > 0) {
        const { data: docsData, error: docsErr } = await supabase
          .from('documents')
          .select('id, owner_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, uploaded_at')
          .eq('entity_type', 'REGISTRATION')
          .in('entity_id', regIds);

        if (!docsErr && docsData) {
          docsData.forEach((doc: any) => {
            if (!docsMap[doc.entity_id]) {
              docsMap[doc.entity_id] = [];
            }
            docsMap[doc.entity_id].push(doc);
          });
        }
      }
      setRegDocumentsMap(docsMap);

      const enrichedRegs = rawRegs.map((reg) => {
        const { team, members } = resolveTeamData(reg);
        if (team && Array.isArray(members)) {
          team.team_members = members.map((m: any) => ({
            ...m,
            is_attended: attendSet.has(`${reg.sub_event_id}_${m.id}`)
          }));
        }
        return reg;
      });

      setRegistrations((enrichedRegs as unknown as Registration[]) || []);
      setCertificates(certsRes.data || []);
      setSubmittedFeedbacks(fbMap);
    } catch (err: any) {
      console.error('Failed to load my registrations:', err);
      setError(err.message || 'Could not load your registrations.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMyRegistrations();

    if (!user?.id) return;

    // Realtime subscription: reflect payment approval and registration updates live without manual reload
    const channel = supabase
      .channel(`student-regs-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'registrations',
          filter: `leader_id=eq.${user.id}`,
        },
        () => {
          fetchMyRegistrations();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payments',
        },
        () => {
          fetchMyRegistrations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Trigger hidden file input for a given registration and document
  const triggerFileInput = (key: string) => {
    const input = fileInputRefs.current[key];
    if (input) {
      input.value = ''; // Reset to ensure re-selecting same file triggers onChange
      input.click();
    }
  };

  // Handle document file selection from My Registrations ("Upload Later" flow)
  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
    reg: any,
    docConfig: RequiredDocumentConfig,
    subEvent: any
  ) => {
    const file = e.target.files?.[0];
    // Immediate reset so re-selecting same file works reliably on mobile
    e.target.value = '';

    if (!file || !user) return;

    const uploadKey = `${reg.id}_${docConfig.name}`;
    setUploadErrors(prev => ({ ...prev, [uploadKey]: null }));

    // 20 MB size validation: if > 20 MB, show OversizedDocumentModal
    if (file.size > MAX_DOCUMENT_SIZE) {
      const { members } = resolveTeamData(reg);
      const leader = members.find((m: any) => m.is_leader) || members[0];
      setOversizedModalData({
        docConfig,
        subEvent,
        reg,
        file,
        studentName: user.user_metadata?.full_name || leader?.snapshot_name || 'Participant',
        uploadKey,
      });
      return;
    }

    // Find previous document if replacing
    const currentRegDocs = regDocumentsMap[reg.id] || [];
    const prevDoc = findMatchingDocument(currentRegDocs, docConfig);

    // Execute upload using centralized uploadRegistrationDocument
    try {
      setUploadingDocKey(uploadKey);

      const result = await uploadRegistrationDocument({
        file,
        docConfig,
        userId: user.id,
        subEventId: subEvent.id,
        registrationId: reg.id,
        supabaseClient: supabase,
        replaceDocumentId: prevDoc?.id,
        replaceStoragePath: prevDoc?.storage_path,
      });

      // Immediately update local state so card reflects "Uploaded" without page reload
      setRegDocumentsMap(prev => {
        const existing = prev[reg.id] || [];
        const cleanDocName = (docConfig.name || 'document').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const filtered = existing.filter(d => {
          const p = (d.storage_path || '').toLowerCase();
          const fn = (d.file_name || '').toLowerCase();
          const isSameDoc = p.includes(cleanDocName) || fn.includes(cleanDocName);
          return !isSameDoc && d.id !== result.document_id;
        });
        return {
          ...prev,
          [reg.id]: [
            ...filtered,
            {
              id: result.document_id,
              entity_id: reg.id,
              entity_type: 'REGISTRATION',
              owner_id: user.id,
              storage_path: result.storage_path,
              file_name: result.file_name,
              mime_type: result.mime_type,
              size_bytes: result.size_bytes,
              uploaded_at: new Date().toISOString(),
            }
          ]
        };
      });
    } catch (err: any) {
      console.error('Failed to upload document from MyRegistrations:', err);
      setUploadErrors(prev => ({
        ...prev,
        [uploadKey]: err.message || 'Failed to upload document. Please try again.'
      }));
    } finally {
      setUploadingDocKey(null);
    }
  };

  // Safe Student Document Deletion Handler
  const handleExecuteDeleteStudentDoc = async () => {
    if (!docToDelete?.doc) return;
    const { reg, doc, docConfig } = docToDelete;
    const uploadKey = `${reg.id}_${docConfig.name}`;

    try {
      setDeletingDocKey(uploadKey);
      setDocDeleteError(null);

      const res = await executeDocumentDeletion({ documentId: doc.id });
      if (!res.success && res.failed_count > 0) {
        const errMsg = res.results.find((r) => r.error)?.error || 'Document deletion failed on server.';
        throw new Error(errMsg);
      }

      // Reconcile React state only after server confirmation
      setRegDocumentsMap((prev) => {
        const existing = prev[reg.id] || [];
        return {
          ...prev,
          [reg.id]: existing.filter((d: any) => d.id !== doc.id),
        };
      });

      // Clear any previous upload error
      setUploadErrors((prev) => {
        const next = { ...prev };
        delete next[uploadKey];
        return next;
      });

      setDocToDelete(null);
    } catch (err: any) {
      console.error('Failed to permanently delete student document:', err);
      setDocDeleteError(err.message || 'Failed to permanently delete document from storage.');
    } finally {
      setDeletingDocKey(null);
    }
  };

  // Submit Feedback
  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFeedbackReg || !user) return;

    try {
      setIsSubmittingFeedback(true);
      setFeedbackError(null);
      setFeedbackSuccess(null);

      const { data: fbResult, error: rpcErr } = await supabase.rpc('submit_event_feedback_and_unlock_certificate', {
        p_registration_id: activeFeedbackReg.id,
        p_rating_1: ratings.r1,
        p_rating_2: ratings.r2,
        p_rating_3: ratings.r3,
        p_rating_4: ratings.r4,
        p_rating_5: ratings.r5,
        p_comments: feedbackComments.trim() || null,
      });

      if (rpcErr || (fbResult && !fbResult.success)) {
        throw new Error(rpcErr?.message || fbResult?.message || 'Failed to submit feedback.');
      }

      playRegistrationSuccessSound({ dedupeKey: `feedback-submit-${activeFeedbackReg.id}` });
      setFeedbackSuccess(fbResult?.message || 'Feedback submitted successfully! Your digital certificate is unlocked.');
      setSubmittedFeedbacks(prev => ({ ...prev, [activeFeedbackReg.id]: true }));

      // Refresh data
      await fetchMyRegistrations();

      setTimeout(() => {
        setActiveFeedbackReg(null);
        setFeedbackSuccess(null);
      }, 1800);
    } catch (err: any) {
      console.error('Feedback submission error:', err);
      setFeedbackError(err.message || 'Failed to submit feedback.');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleUnlockCertificate = async (subEventId: string, registrationId?: string, teamMemberId?: string) => {
    try {
      setIsUnlockingSubEventId(teamMemberId || subEventId);
      const { data, error } = await supabase.rpc('unlock_student_certificate', {
        p_sub_event_id: subEventId,
        p_registration_id: registrationId || null,
        p_team_member_id: teamMemberId || null,
      });

      if (error || (data && !data.success)) {
        throw new Error(error?.message || data?.message || 'Unable to unlock certificate.');
      }

      await fetchMyRegistrations();
    } catch (err: any) {
      console.error('Failed to unlock certificate:', err);
      alert(err.message || 'Unable to unlock certificate.');
    } finally {
      setIsUnlockingSubEventId(null);
    }
  };

  // Submit Complaint / Inquiry
  const handleSubmitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeComplaintReg || !user || !complaintText.trim() || isSubmittingComplaint) return;

    try {
      setIsSubmittingComplaint(true);
      setComplaintSuccess(null);
      setComplaintError(null);

      const sub = (activeComplaintReg as any).sub_events;
      const subName = sub?.name || 'Registered Event';
      const eventName = (activeComplaintReg as any).events?.name || '';
      
      // Authoritative complaints schema: user_id, category, description, status
      // Preserve registration and sub-event context cleanly within the description
      const regHeader = `[Registration Ref: ${activeComplaintReg.id}${subName ? ` | Sub-Event: ${subName}` : ''}${eventName ? ` (${eventName})` : ''}]`;
      const fullDescription = `${regHeader}\n\n${complaintText.trim()}`;

      const { error: compErr } = await supabase
        .from('complaints')
        .insert({
          user_id: user.id,
          category: complaintCategory,
          description: fullDescription,
          status: 'OPEN',
        });

      if (compErr) throw compErr;

      playRegistrationSuccessSound({ dedupeKey: `complaint-submit-${activeComplaintReg.id}-${Date.now()}` });
      setComplaintSuccess('Your inquiry/grievance has been recorded. The coordinator team will review it.');
      setComplaintText('');
      setTimeout(() => {
        setActiveComplaintReg(null);
        setComplaintSuccess(null);
        setComplaintError(null);
      }, 2000);
    } catch (err: any) {
      console.error('Complaint submission error:', err);
      setComplaintError(err.message || 'Failed to submit grievance. Please try again.');
    } finally {
      setIsSubmittingComplaint(false);
    }
  };

  return (
    <div className="space-y-6 pb-6 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-6">
        <div>
          <span className="text-[10px] font-black uppercase tracking-widest text-kits-blue block">
            MY EVENT PORTFOLIO
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
            My Registrations & Credentials
          </h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Access your individual digital ID cards, scannable QR passes, receipts, and event certificates.
          </p>
        </div>

        <Link
          to="/events"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs self-start sm:self-auto cursor-pointer"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Explore Events</span>
        </Link>
      </div>

      {isLoading ? (
        <LoadingState message="Loading your event credentials and registrations..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchMyRegistrations} />
      ) : registrations.length === 0 ? (
        <EmptyState
          title="No Registrations Yet"
          description="You have not registered for any symposium tracks or competitions yet. Explore upcoming campus events to get your digital pass."
          action={
            <Link
              to="/events"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs"
            >
              <span>Browse Flagship Events</span>
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {registrations.map((reg: any) => {
            const sub = reg.sub_events;
            const evName = sub?.events?.name || sub?.categories?.events?.name || 'Flagship Event';
            const catName = sub?.categories?.name;
            const { team, members } = resolveTeamData(reg);
            const leaderMember = members.find((m: any) => m.is_leader) || members[0];
            const isTeam = members.length > 1 || (team?.team_name && team.team_name !== 'Solo Participant') || sub?.participation_type === 'TEAM';
            const isFree = sub?.is_free ?? ((sub?.fee_amount_solo || 0) === 0 && (sub?.fee_amount_team || 0) === 0);
            const cert = certificates.find((c: any) => c.sub_event_id === sub?.id);
            const hasFeedback = submittedFeedbacks[reg.id];
            const feeAmount = isFree ? 0 : (sub?.participation_type === 'TEAM' ? (sub?.fee_amount_team || 0) : (sub?.fee_amount_solo || 0));
            
            const paymentRecord = reg.payments?.[0];
            const isPaymentPending = !isFree && paymentRecord?.status === 'PENDING' && feeAmount > 0;

            return (
              <div 
                key={reg.id}
                className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-2xs p-4 sm:p-7 space-y-4 sm:space-y-5 hover:border-gray-300 card-hover-interactive"
              >
                {/* Card Header: Event Title & Badges */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-gray-100 pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-kits-blue border border-blue-100">
                        {evName}
                      </span>
                      {catName && (
                        <span className="text-[10px] font-bold text-gray-500">
                          • {catName}
                        </span>
                      )}
                    </div>
                    <h3 className="text-xl font-black text-gray-900 tracking-tight">
                      {sub?.name || 'Sub-Event Competition'}
                    </h3>
                  </div>

                  {/* Status Pills */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Payment / Registration Status Badge */}
                    {isFree ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-300">
                        <CheckCircle2 className="h-3 w-3 text-slate-600" />
                        <span>FREE EVENT • CONFIRMED</span>
                      </span>
                    ) : isPaymentPending ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                        <Clock className="h-3 w-3" />
                        <span>PAYMENT PENDING</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>PAYMENT CONFIRMED</span>
                      </span>
                    )}

                    {/* Format Badge */}
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                      {isTeam ? <Users className="h-3 w-3 text-kits-blue" /> : <User className="h-3 w-3 text-gray-500" />}
                      <span>{sub?.participation_type || 'SOLO'}</span>
                    </span>

                    {/* Results / Certificate Badge */}
                    {sub?.results_published && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase px-2.5 py-1 rounded-full bg-blue-100 text-kits-blue border border-blue-200">
                        <Award className="h-3 w-3" />
                        <span>RESULTS RELEASED</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Authoritative Payment Method & Verification Status Banner */}
                {feeAmount > 0 && (
                  <div className={`p-4 rounded-2xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isPaymentPending
                      ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                      : 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                  }`}>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold uppercase text-[10px] tracking-wider px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-700">
                          PAYMENT METHOD: {paymentRecord?.payment_method || (paymentRecord?.reference_id?.startsWith('COD') ? 'COD' : 'UPI')}
                        </span>
                        <span className={`font-mono font-black uppercase text-[10px] tracking-wider px-2 py-0.5 rounded ${
                          isPaymentPending
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        }`}>
                          STATUS: {isPaymentPending ? '⏳ PAYMENT VERIFICATION PENDING' : '✓ PAID / VERIFIED'}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-gray-600">
                        {isPaymentPending
                          ? 'Your registration is recorded. Payment must be verified by Event Operations.'
                          : 'Payment verified. Official passes and digital credentials unlocked.'}
                      </p>
                    </div>
                    <div className="text-left sm:text-right shrink-0">
                      <span className="text-[10px] font-bold text-gray-500 uppercase block">Fee Amount</span>
                      <span className="font-black text-sm font-mono text-gray-900">₹{feeAmount}</span>
                    </div>
                  </div>
                )}

                {/* Team / Solo Information Header */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-gray-50 p-4 rounded-2xl border border-gray-200">
                  <div>
                    <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 block">Registration Type</span>
                    <span className="font-bold text-gray-900">{sub?.participation_type || 'Solo'}</span>
                  </div>

                  <div>
                    <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 block">
                      {isTeam ? 'Team Affiliation' : 'Participant'}
                    </span>
                    <span className="font-bold text-gray-900 truncate block">
                      {team?.team_name || leaderMember?.snapshot_name || 'Participant'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 block">Fee / Status</span>
                    <span className={`font-mono font-black ${isFree ? 'text-slate-700 font-sans' : isPaymentPending ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {feeAmount > 0 
                        ? `₹${feeAmount} (${isPaymentPending ? 'PENDING' : 'PAID'})` 
                        : 'FREE'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 block">Leader Token</span>
                    <span className="font-mono font-bold text-kits-blue truncate block">
                      {leaderMember?.manual_token || 'N/A'}
                    </span>
                  </div>
                </div>

                {/* Registered Team Members Roster */}
                {isTeam && members.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                        <Users className="h-4 w-4 text-kits-blue" />
                        Team Members ({members.length})
                      </span>
                      <span className="text-[10px] text-gray-400">
                        Registered Roster • Individual attendance recorded at check-in
                      </span>
                    </div>

                    <div className="space-y-2">
                      {members.map((m: any) => (
                        <div 
                          key={m.id} 
                          className="p-3 bg-white rounded-2xl border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-gray-300 transition"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl border ${
                              m.is_leader 
                                ? 'bg-amber-50 border-amber-200 text-amber-800' 
                                : 'bg-gray-50 border-gray-200 text-gray-700'
                            }`}>
                              {m.is_leader ? <Sparkles className="h-4 w-4 text-amber-600" /> : <User className="h-4 w-4 text-gray-500" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-black text-xs text-gray-900">{m.snapshot_name}</span>
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                                  m.is_leader 
                                    ? 'bg-amber-100 text-amber-900 border border-amber-200' 
                                    : 'bg-blue-50 text-kits-blue border border-blue-100'
                                }`}>
                                  {m.is_leader ? 'TEAM LEADER' : 'TEAM MEMBER'}
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                                Roll No: <strong>{m.snapshot_roll_number}</strong> • Dept: {m.snapshot_department} (Yr {m.snapshot_year})
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            {/* Member Attendance Status */}
                            {m.is_attended ? (
                              <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                <span>ATTENDED</span>
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200 flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                <span>NOT ATTENDED</span>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Required Documents Section */}
                {Array.isArray(sub?.required_documents) && sub.required_documents.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                        <FileText className="h-4 w-4 text-kits-blue" />
                        Required Documents ({sub.required_documents.length})
                      </span>
                      <span className="text-[10px] text-gray-400">
                        Official verification documents for this sub-event
                      </span>
                    </div>

                    <div className="space-y-2">
                      {sub.required_documents.map((docConfig: RequiredDocumentConfig) => {
                        const docsForReg = regDocumentsMap[reg.id] || [];
                        const uploadedDoc = findMatchingDocument(docsForReg, docConfig);
                        const uploadKey = `${reg.id}_${docConfig.name}`;
                        const isCurrentlyUploading = uploadingDocKey === uploadKey;
                        const uploadErr = uploadErrors[uploadKey];

                        return (
                          <div
                            key={docConfig.id || docConfig.name}
                            className={`p-3.5 sm:p-4 rounded-2xl border transition ${
                              uploadedDoc
                                ? 'bg-emerald-50/40 border-emerald-200/80'
                                : 'bg-amber-50/40 border-amber-200/80'
                            }`}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="flex items-start gap-3 min-w-0">
                                <div className={`p-2 rounded-xl border shrink-0 mt-0.5 ${
                                  uploadedDoc
                                    ? 'bg-emerald-100/80 border-emerald-300 text-emerald-800'
                                    : 'bg-amber-100/80 border-amber-300 text-amber-800'
                                }`}>
                                  {uploadedDoc ? (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                                  ) : (
                                    <Clock className="h-4 w-4 text-amber-700" />
                                  )}
                                </div>

                                <div className="min-w-0 space-y-0.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-black text-xs text-gray-900 break-words">
                                      {docConfig.name}
                                    </span>
                                    {uploadedDoc ? (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                                        <Check className="h-2.5 w-2.5" />
                                        <span>DOCUMENT SUBMITTED</span>
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                                        <Clock className="h-2.5 w-2.5" />
                                        <span>PENDING DOCUMENT SUBMISSION</span>
                                      </span>
                                    )}
                                  </div>

                                  {docConfig.description && (
                                    <p className="text-[11px] text-gray-500 line-clamp-2">
                                      {docConfig.description}
                                    </p>
                                  )}

                                  {uploadedDoc && (
                                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-emerald-800 font-mono mt-1">
                                      <span className="truncate max-w-[200px] sm:max-w-xs font-semibold">
                                        📄 {uploadedDoc.file_name}
                                      </span>
                                      <span>•</span>
                                      <span>{(uploadedDoc.size_bytes / (1024 * 1024)).toFixed(1)} MB</span>
                                      {uploadedDoc.uploaded_at && (
                                        <>
                                          <span>•</span>
                                          <span className="text-gray-500">
                                            {new Date(uploadedDoc.uploaded_at).toLocaleDateString(undefined, {
                                              month: 'short',
                                              day: 'numeric',
                                              hour: '2-digit',
                                              minute: '2-digit',
                                            })}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                                {/* Hidden File Input */}
                                <input
                                  id={`my-reg-file-${uploadKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
                                  ref={(el) => {
                                    fileInputRefs.current[uploadKey] = el;
                                  }}
                                  type="file"
                                  className="sr-only"
                                  tabIndex={-1}
                                  onClick={(e) => {
                                    (e.target as HTMLInputElement).value = '';
                                  }}
                                  onChange={(e) => handleFileSelected(e, reg, docConfig, sub)}
                                  disabled={isCurrentlyUploading}
                                />

                                <label
                                  htmlFor={isCurrentlyUploading ? undefined : `my-reg-file-${uploadKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
                                  role="button"
                                  tabIndex={isCurrentlyUploading ? -1 : 0}
                                  onClick={() => {
                                    const input = fileInputRefs.current[uploadKey];
                                    if (input) input.value = '';
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      if (!isCurrentlyUploading) triggerFileInput(uploadKey);
                                    }
                                  }}
                                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer select-none active:scale-95 ${
                                    isCurrentlyUploading ? 'opacity-50 pointer-events-none cursor-not-allowed' : ''
                                  } ${
                                    uploadedDoc
                                      ? 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                      : 'bg-kits-red text-white hover:bg-red-700'
                                  }`}
                                >
                                  {isCurrentlyUploading ? (
                                    <>
                                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                      <span>Uploading...</span>
                                    </>
                                  ) : uploadedDoc ? (
                                    <>
                                      <Upload className="h-3.5 w-3.5 text-gray-500" />
                                      <span>Re-upload</span>
                                    </>
                                  ) : (
                                    <>
                                      <Upload className="h-3.5 w-3.5" />
                                      <span>Upload Document</span>
                                    </>
                                  )}
                                </label>

                                {uploadedDoc && (
                                  <button
                                    type="button"
                                    onClick={() => setDocToDelete({ reg, doc: uploadedDoc, docConfig })}
                                    disabled={isCurrentlyUploading || deletingDocKey === uploadKey}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition shadow-2xs cursor-pointer select-none active:scale-95 disabled:opacity-50"
                                    title="Permanently delete this uploaded document"
                                  >
                                    {deletingDocKey === uploadKey ? (
                                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                    <span>Delete</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Upload Error Feedback if any */}
                            {uploadErr && (
                              <div className="mt-2.5 p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                                <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
                                <div className="flex-1 space-y-1">
                                  <p className="font-semibold">{uploadErr}</p>
                                  <button
                                    type="button"
                                    onClick={() => triggerFileInput(uploadKey)}
                                    className="text-[11px] font-bold text-red-800 underline hover:no-underline cursor-pointer"
                                  >
                                    Try choosing file again
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Credential Action Suite Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-gray-100">
                  {isPaymentPending ? (
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setActivePaymentInfoReg(reg)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-black uppercase tracking-wider hover:bg-amber-600 transition shadow-2xs cursor-pointer"
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        <span>View Payment Instructions</span>
                      </button>

                      <span className="text-[11px] text-gray-400 flex items-center gap-1">
                        <Lock className="h-3.5 w-3.5" />
                        ID Cards & Passes unlock after payment is confirmed
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {!isTeam ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setActiveIdCardModal({ reg, member: leaderMember })}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-xs cursor-pointer"
                          >
                            <IdCard className="h-3.5 w-3.5" />
                            <span>Digital ID Card</span>
                          </button>

                          {leaderMember && (
                            <button
                              type="button"
                              onClick={() => setActiveQrModal({ reg, member: leaderMember })}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-gray-300 text-xs font-bold text-gray-800 hover:bg-gray-50 transition shadow-2xs cursor-pointer"
                            >
                              <QrCode className="h-3.5 w-3.5 text-kits-blue" />
                              <span>QR Pass</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setActiveIdCardModal({ reg, member: leaderMember || members[0] })}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-xs cursor-pointer"
                          >
                            <IdCard className="h-3.5 w-3.5" />
                            <span>View Team ID Card</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveQrModal({ reg, member: leaderMember || members[0] })}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-gray-300 text-xs font-bold text-gray-800 hover:bg-gray-50 transition shadow-2xs cursor-pointer"
                          >
                            <QrCode className="h-3.5 w-3.5 text-kits-blue" />
                            <span>Team QR Pass</span>
                          </button>
                        </>
                      )}

                      {/* View Transaction Receipt for Paid Events */}
                      {!isFree && (
                        <button
                          type="button"
                          onClick={() => setActiveReceiptReg(reg)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-gray-300 text-xs font-bold text-gray-800 hover:bg-gray-50 transition shadow-2xs cursor-pointer"
                        >
                          <Receipt className="h-3.5 w-3.5 text-slate-700" />
                          <span>Receipt</span>
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* 4-State Authoritative Certificate Lifecycle Action */}
                    {!isPaymentPending && (
                      !sub?.results_published ? (
                        /* State 1: Result Not Released */
                        <span 
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 text-gray-500 text-xs font-bold border border-gray-200"
                          title="The official result for this sub-event has not yet been released by Event Operations."
                        >
                          <Lock className="h-3.5 w-3.5 text-gray-400" />
                          <span>Result Not Released</span>
                        </span>
                      ) : !hasFeedback ? (
                        /* State 2: Result Released + Feedback Incomplete */
                        <button
                          type="button"
                          onClick={() => {
                            setActiveFeedbackReg(reg);
                            setFeedbackError(null);
                            setFeedbackSuccess(null);
                          }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          <span>Complete Feedback</span>
                        </button>
                      ) : cert?.status !== 'UNLOCKED' ? (
                        /* State 3: Result Released + Feedback Complete + Certificate Locked */
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-700 text-xs font-black uppercase tracking-wider flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            <span className="hidden sm:inline">FEEDBACK COMPLETED ✓</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUnlockCertificate(sub.id, reg.id)}
                            disabled={isUnlockingSubEventId === sub.id}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>{isUnlockingSubEventId === sub.id ? 'Unlocking...' : 'UNLOCK CERTIFICATE'}</span>
                          </button>
                        </div>
                      ) : (
                        /* State 4: Certificate Unlocked */
                        <Link
                          to="/certificates"
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-kits-blue hover:bg-blue-800 text-white text-xs font-black uppercase tracking-wider transition shadow-2xs"
                        >
                          <Award className="h-3.5 w-3.5" />
                          <span>VIEW / DOWNLOAD CERTIFICATE</span>
                        </Link>
                      )
                    )}

                    {/* Grievance Link */}
                    <button
                      type="button"
                      onClick={() => setActiveComplaintReg(reg)}
                      className="p-2 text-gray-400 hover:text-kits-red hover:bg-red-50 rounded-xl transition cursor-pointer"
                      title="File Grievance / Inquire"
                    >
                      <MessageSquare className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* =========================================================================
          MODAL: PAYMENT INSTRUCTIONS (FOR COD / PENDING)
          ========================================================================= */}
      {activePaymentInfoReg && createPortal(
        <div 
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-hidden modal-overlay-animate"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActivePaymentInfoReg(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[92vh] sm:max-h-[90vh] flex flex-col shadow-2xl border border-gray-200 relative overflow-hidden modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 sm:px-6 py-4 bg-white shrink-0">
              <div className="flex items-center gap-2">
                <Banknote className="h-5 w-5 text-amber-600" />
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  Payment Submission Instructions
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActivePaymentInfoReg(null)}
                className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1 min-h-0 overscroll-contain">
              {(() => {
                const sub = activePaymentInfoReg.sub_events;
                const feeAmount = sub?.participation_type === 'TEAM' ? (sub?.fee_amount_team || 0) : (sub?.fee_amount_solo || 0);
                const coords = coordinatorMap[sub?.id] || [];
                const { members } = resolveTeamData(activePaymentInfoReg);
                const leader = members.find((m: any) => m.is_leader) || members[0];
                const pay = activePaymentInfoReg.payments?.[0];

                return (
                  <div className="space-y-5">
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wider text-amber-800">
                          Amount Due
                        </span>
                        <span className="text-2xl font-black font-mono text-amber-700">
                          ₹{feeAmount}
                        </span>
                      </div>
                      <p className="text-xs text-amber-800 leading-relaxed">
                        Your registration for <strong>{sub?.name}</strong> is recorded as <strong>PAYMENT PENDING</strong>. Please pay the registration amount to one of the assigned coordinators below.
                      </p>
                    </div>

                    {/* Summary grid */}
                    <div className="grid grid-cols-2 gap-3 text-xs bg-gray-50 p-4 rounded-2xl border border-gray-200">
                      <div>
                        <span className="text-[9px] font-bold uppercase text-gray-400 block">Registration ID</span>
                        <span className="font-mono font-bold text-gray-900 truncate block">
                          {activePaymentInfoReg.id.slice(0, 14)}...
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase text-gray-400 block">Payment Reference</span>
                        <span className="font-mono font-bold text-amber-700 truncate block">
                          {pay?.reference_id || 'COD-PENDING'}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-[9px] font-bold uppercase text-gray-400 block">Registered Participant / Leader</span>
                        <span className="font-bold text-gray-900 block">
                          {leader?.snapshot_name || 'Participant'} {leader?.snapshot_roll_number ? `(${leader.snapshot_roll_number})` : ''}
                        </span>
                      </div>
                    </div>

                    {/* Authorized Coordinators Directory for this sub-event */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">
                          Authorized Payment Coordinators ({coords.length})
                        </span>
                        <span className="text-[10px] font-bold text-kits-blue">
                          Cash on Desk
                        </span>
                      </div>

                      {coords.length > 0 ? (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {coords.map((c) => (
                            <div
                              key={c.id}
                              className="p-3 bg-gray-50 hover:bg-gray-100 rounded-2xl border border-gray-200 flex items-center justify-between transition"
                            >
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-black text-gray-900">
                                    {c.display_name}
                                  </span>
                                  <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                                    c.coordinator_type === 'FACULTY'
                                      ? 'bg-blue-100 text-kits-blue'
                                      : 'bg-emerald-100 text-emerald-800'
                                  }`}>
                                    {c.coordinator_type}
                                  </span>
                                </div>
                                <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                                  {c.phone_number || 'Contact in person at venue'}
                                </p>
                              </div>

                              {c.phone_number && (
                                <a
                                  href={`tel:${c.phone_number}`}
                                  className="p-2 rounded-xl bg-kits-blue text-white hover:bg-blue-800 transition cursor-pointer shadow-2xs"
                                  title={`Call ${c.display_name}`}
                                >
                                  <Phone className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-600">
                          Please pay to the <strong>Event Administrator</strong> at the Central Registration Operations Desk.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* =========================================================================
          MODAL: DIGITAL ID CARD POPUP (Supports individual team member ID card)
          ========================================================================= */}
      {activeIdCardModal && createPortal(
        <div 
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-hidden modal-overlay-animate"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveIdCardModal(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-xl w-full max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] flex flex-col shadow-2xl border border-gray-200 relative overflow-hidden modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-6 py-3.5 sm:py-4 bg-white shrink-0">
              <div className="flex items-center gap-2">
                <IdCard className="h-5 w-5 text-kits-red" />
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  {(() => {
                    const { team, members } = resolveTeamData(activeIdCardModal.reg);
                    const sub = (activeIdCardModal.reg as any).sub_events;
                    const isTeam = members.length > 1 || (team?.team_name && team.team_name !== 'Solo Participant') || sub?.participation_type === 'TEAM';
                    return isTeam ? 'Official Team ID Card' : 'Official Digital Event ID Card';
                  })()}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveIdCardModal(null)}
                className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1 min-h-0 overscroll-contain">
              {(() => {
                const reg = activeIdCardModal.reg as any;
                const sub = reg.sub_events;
                const evName = sub?.events?.name || sub?.categories?.events?.name || 'Flagship Event';
                const { team, members: teamMembers } = resolveTeamData(reg);
                const member = activeIdCardModal.member;
                const isTeam = teamMembers.length > 1 || (team?.team_name && team.team_name !== 'Solo Participant') || sub?.participation_type === 'TEAM';

                if (isTeam) {
                  const leaderMember = teamMembers.find((m: any) => m.is_leader) || member || teamMembers[0];
                  const token = leaderMember?.manual_token || member?.manual_token || reg.manual_token || 'N/A';

                  return (
                    <TeamDigitalIdCard
                      teamName={team?.team_name || 'Registered Team'}
                      eventName={evName}
                      categoryName={sub?.categories?.name}
                      subEventName={sub?.name || 'Sub-Event'}
                      members={teamMembers.map((m: any) => ({
                        id: m.id,
                        name: m.snapshot_name,
                        department: m.snapshot_department,
                        year: m.snapshot_year,
                        rollNumber: m.snapshot_roll_number,
                        college: m.snapshot_college,
                        isLeader: Boolean(m.is_leader),
                      }))}
                      registrationId={reg.id}
                      manualToken={token}
                      qrPayload={token}
                    />
                  );
                }

                const teamRole = 'SOLO PARTICIPANT';

                return (
                  <DigitalIdCard
                    studentName={member?.snapshot_name || 'Participant'}
                    rollNumber={member?.snapshot_roll_number || 'Not provided'}
                    department={member?.snapshot_department || 'Engineering'}
                    year={member?.snapshot_year || 3}
                    college={member?.snapshot_college || 'KITS Akshar Institute of Technology'}
                    eventName={evName}
                    categoryName={sub?.categories?.name}
                    subEventName={sub?.name || 'Sub-Event'}
                    participationType={sub?.participation_type || 'Solo'}
                    teamName={team?.team_name}
                    teamRole={teamRole}
                    registrationId={reg.id}
                    manualToken={member?.manual_token || 'N/A'}
                    qrIdentity={member?.qr_identity}
                  />
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* =========================================================================
          MODAL: ATTENDANCE QR PASS POPUP (Supports Solo or One Team QR)
          ========================================================================= */}
      {activeQrModal && createPortal(
        <div 
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-hidden modal-overlay-animate"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveQrModal(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] flex flex-col shadow-2xl border border-gray-200 relative overflow-hidden modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-6 py-3.5 sm:py-4 bg-white shrink-0">
              <div className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-kits-blue" />
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  {(() => {
                    const { team, members } = resolveTeamData(activeQrModal.reg);
                    const sub = (activeQrModal.reg as any).sub_events;
                    const isTeam = members.length > 1 || (team?.team_name && team.team_name !== 'Solo Participant') || sub?.participation_type === 'TEAM';
                    return isTeam ? 'Official Team Attendance QR Pass' : 'Official Attendance QR Pass';
                  })()}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveQrModal(null)}
                className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1 min-h-0 overscroll-contain">
              {(() => {
                const reg = activeQrModal.reg as any;
                const sub = reg.sub_events;
                const evName = sub?.events?.name || sub?.categories?.events?.name || 'Flagship Event';
                const member = activeQrModal.member;
                const { team, members: teamMembers } = resolveTeamData(reg);
                const isTeam = teamMembers.length > 1 || (team?.team_name && team.team_name !== 'Solo Participant') || sub?.participation_type === 'TEAM';

                if (isTeam) {
                  const leaderMember = teamMembers.find((m: any) => m.is_leader) || member || teamMembers[0];
                  const token = leaderMember?.manual_token || member?.manual_token || reg.manual_token || 'N/A';

                  return (
                    <AttendanceQrPass
                      studentName={team?.team_name || 'Registered Team'}
                      rollNumber={`TEAM PASS (${teamMembers.length} Members)`}
                      eventName={evName}
                      subEventName={sub?.name || 'Sub-Event'}
                      teamName={team?.team_name}
                      registrationId={reg.id}
                      manualToken={token}
                      qrPayload={token}
                    />
                  );
                }

                return (
                  <AttendanceQrPass
                    studentName={member?.snapshot_name || 'Participant'}
                    rollNumber={member?.snapshot_roll_number || 'Not provided'}
                    eventName={evName}
                    subEventName={sub?.name || 'Sub-Event'}
                    teamName={reg.teams?.team_name}
                    registrationId={reg.id}
                    manualToken={member?.manual_token || 'N/A'}
                    qrIdentity={member?.qr_identity}
                  />
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* =========================================================================
          MODAL: TRANSACTION RECEIPT POPUP
          ========================================================================= */}
      {activeReceiptReg && createPortal(
        <div 
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-hidden modal-overlay-animate"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveReceiptReg(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-xl w-full max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] flex flex-col shadow-2xl border border-gray-200 relative overflow-hidden modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-6 py-3.5 sm:py-4 bg-white shrink-0">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-slate-800" />
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  Official Payment Receipt
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveReceiptReg(null)}
                className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1 min-h-0 overscroll-contain">
              {(() => {
                const reg = activeReceiptReg as any;
                const sub = reg.sub_events;
                const evName = sub?.events?.name || sub?.categories?.events?.name || 'Flagship Event';
                const { members } = resolveTeamData(reg);
                const leader = members.find((m: any) => m.is_leader) || members[0];
                const feeAmount = sub?.participation_type === 'TEAM' ? (sub?.fee_amount_team || 0) : (sub?.fee_amount_solo || 0);
                const pay = reg.payments?.[0];

                return (
                  <TransactionReceipt
                    transactionId={pay?.reference_id || `KITS-EOS-TXN-${reg.id.slice(0, 8)}`}
                    paymentStatus={pay?.status || 'SUCCESS'}
                    paymentMethod={pay?.reference_id?.startsWith('COD') ? 'COD' : feeAmount === 0 ? 'FREE' : 'UPI'}
                    registrationId={reg.id}
                    studentName={leader?.snapshot_name || 'Participant'}
                    rollNumber={leader?.snapshot_roll_number || 'Not provided'}
                    department={leader?.snapshot_department || 'Engineering'}
                    year={leader?.snapshot_year || 3}
                    college={leader?.snapshot_college || 'KITS Akshar Institute of Technology'}
                    eventName={evName}
                    categoryName={sub?.categories?.name}
                    subEventName={sub?.name || 'Sub-Event'}
                    participationType={sub?.participation_type || 'Solo'}
                    amount={feeAmount}
                    timestamp={pay?.created_at || reg.created_at}
                  />
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* =========================================================================
          MODAL: FEEDBACK SUBMISSION
          ========================================================================= */}
      {activeFeedbackReg && createPortal(
        <div 
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-hidden modal-overlay-animate"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveFeedbackReg(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] flex flex-col shadow-2xl border border-gray-200 relative overflow-hidden modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-6 py-3.5 sm:py-4 bg-white shrink-0">
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-amber-500" />
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  Event Feedback & Certificate Unlock
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveFeedbackReg(null)}
                className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1 min-h-0 overscroll-contain">
              {feedbackSuccess && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>{feedbackSuccess}</span>
                </div>
              )}

              {feedbackError && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-kits-red shrink-0" />
                  <span>{feedbackError}</span>
                </div>
              )}

              <form onSubmit={handleSubmitFeedback} className="space-y-4">
                <div className="text-xs text-gray-500">
                  Rate each criterion on a scale of 1 to 5 stars to help us improve future symposium editions.
                </div>

                <div className="space-y-3.5">
                  {CRITERIA.map((crit) => {
                    const val = (ratings as any)[crit.id];
                    return (
                      <div key={crit.id} className="p-3 bg-gray-50 rounded-2xl border border-gray-200 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-gray-800">{crit.label}</span>
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                onClick={() => setRatings(prev => ({ ...prev, [crit.id]: star }))}
                                className={`p-1 rounded-lg transition cursor-pointer ${
                                  star <= val ? 'text-amber-500' : 'text-gray-300'
                                }`}
                              >
                                <Star className={`h-4 w-4 ${star <= val ? 'fill-amber-400' : ''}`} />
                              </button>
                            ))}
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-400">{crit.desc}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-black uppercase tracking-wider text-gray-700 block">
                    Additional Comments / Suggestions (Optional)
                  </label>
                  <textarea
                    value={feedbackComments}
                    onChange={(e) => setFeedbackComments(e.target.value)}
                    placeholder="Share what you liked or how we can improve..."
                    rows={3}
                    className="w-full text-xs p-3 rounded-2xl border border-gray-200 focus:outline-hidden focus:border-kits-blue resize-none"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2 border-t border-gray-100 w-full">
                  <button
                    type="button"
                    onClick={() => setActiveFeedbackReg(null)}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingFeedback}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 transition shadow-2xs cursor-pointer disabled:opacity-50 text-center"
                  >
                    {isSubmittingFeedback ? 'Submitting...' : 'Submit & Unlock Certificate'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* =========================================================================
          MODAL: COMPLAINT / GRIEVANCE SUBMISSION
          ========================================================================= */}
      {activeComplaintReg && createPortal(
        <div 
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-hidden modal-overlay-animate"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveComplaintReg(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] flex flex-col shadow-2xl border border-gray-200 relative overflow-hidden modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-6 py-3.5 sm:py-4 bg-white shrink-0">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-kits-red" />
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  Inquiry / Grievance Desk
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveComplaintReg(null)}
                className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1 min-h-0 overscroll-contain">
              {/* Associated Registration Context Badge */}
              {activeComplaintReg && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-0.5">
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 block">
                    Associated Registration
                  </span>
                  <div className="text-xs font-black text-gray-900 truncate">
                    {(activeComplaintReg as any).sub_events?.name || 'Registered Sub-Event'}
                    {(activeComplaintReg as any).events?.name ? ` • ${(activeComplaintReg as any).events?.name}` : ''}
                  </div>
                  <div className="text-[10px] font-mono text-gray-500 truncate">
                    ID: {activeComplaintReg.id}
                  </div>
                </div>
              )}

              {complaintSuccess && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>{complaintSuccess}</span>
                </div>
              )}

              {complaintError && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
                  <span>{complaintError}</span>
                </div>
              )}

              <form onSubmit={handleSubmitComplaint} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-black uppercase tracking-wider text-gray-700 block">
                    Category
                  </label>
                  <select
                    value={complaintCategory}
                    onChange={(e) => setComplaintCategory(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl border border-gray-200 focus:outline-hidden focus:border-kits-blue font-bold"
                  >
                    <option value="SCHEDULE">Event Schedule / Timing</option>
                    <option value="PAYMENT">Payment / Fee Discrepancy</option>
                    <option value="VENUE">Venue / Lab Facilities</option>
                    <option value="COORDINATION">Coordinator Communication</option>
                    <option value="OTHER">Other Issues</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-black uppercase tracking-wider text-gray-700 block">
                    Description
                  </label>
                  <textarea
                    value={complaintText}
                    onChange={(e) => setComplaintText(e.target.value)}
                    placeholder="Describe your inquiry or grievance clearly..."
                    rows={4}
                    required
                    className="w-full text-xs p-3 rounded-2xl border border-gray-200 focus:outline-hidden focus:border-kits-blue resize-none"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2 border-t border-gray-100 w-full">
                  <button
                    type="button"
                    onClick={() => setActiveComplaintReg(null)}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingComplaint || !complaintText.trim()}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs cursor-pointer disabled:opacity-50 text-center"
                  >
                    {isSubmittingComplaint ? 'Submitting...' : 'Submit Grievance'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* =========================================================================
          MODAL: OVERSIZED DOCUMENT MODAL (> 20 MB)
          ========================================================================= */}
      {oversizedModalData && createPortal(
        <OversizedDocumentModal
          isOpen={Boolean(oversizedModalData)}
          onClose={() => setOversizedModalData(null)}
          documentName={oversizedModalData.docConfig.name}
          subEventName={oversizedModalData.subEvent?.name || 'Sub-Event'}
          studentName={oversizedModalData.studentName}
          selectedFileSize={oversizedModalData.file?.size}
          selectedFileName={oversizedModalData.file?.name}
          coordinators={coordinatorMap[oversizedModalData.subEvent?.id] || []}
          onChooseDifferentFile={() => {
            const key = oversizedModalData.uploadKey;
            setOversizedModalData(null);
            triggerFileInput(key);
          }}
          onDeferUploadLater={() => {
            setOversizedModalData(null);
          }}
        />,
        document.body
      )}

      {/* =========================================================================
          MODAL: STUDENT DOCUMENT PERMANENT DELETION
          ========================================================================= */}
      {docToDelete && docToDelete.doc && createPortal(
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
                      Delete Uploaded Document
                    </h3>
                    <p className="text-xs text-gray-500">
                      {docToDelete.docConfig.name}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!deletingDocKey) {
                      setDocToDelete(null);
                      setDocDeleteError(null);
                    }
                  }}
                  disabled={Boolean(deletingDocKey)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200/80 space-y-1">
                <div className="text-xs font-bold text-gray-800 break-words flex items-center gap-2">
                  <FileText className="h-4 w-4 text-kits-blue shrink-0" />
                  <span>{docToDelete.doc.file_name}</span>
                </div>
                <div className="text-[11px] text-gray-500">
                  Size: {(Number(docToDelete.doc.size_bytes) / (1024 * 1024)).toFixed(2)} MB
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900 font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  Are you sure you want to delete this document? The file will be <strong>permanently removed from cloud storage</strong>. You will need to upload a replacement before the deadline.
                </div>
              </div>

              {docDeleteError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{docDeleteError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setDocToDelete(null);
                    setDocDeleteError(null);
                  }}
                  disabled={Boolean(deletingDocKey)}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDeleteStudentDoc}
                  disabled={Boolean(deletingDocKey)}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-kits-red hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer disabled:opacity-50"
                >
                  {deletingDocKey ? (
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
        </div>,
        document.body
      )}
    </div>
  );
}

