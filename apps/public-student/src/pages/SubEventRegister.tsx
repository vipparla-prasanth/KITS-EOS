import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import type { SubEvent, Event, Category, RequiredDocumentConfig } from '@kits-eos/shared/src/types/models';
import { 
  CollegeSelect, 
  uploadRegistrationDocument, 
  MAX_DOCUMENT_SIZE, 
  DEPARTMENTS, 
  isSubEventRegistrationAvailable,
  useFormDraft,
  DraftSaveIndicator,
  ResumeDraftModal
} from '@kits-eos/shared';
import { useAuth } from '../context/AuthContext';
import { ErrorState } from '../components/ui/ErrorState';
import { 
  Users, 
  User, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  ArrowLeft, 
  Plus, 
  Trash2, 
  CreditCard, 
  ShieldCheck, 
  Lock, 
  ArrowRight, 
  Receipt, 
  QrCode, 
  IdCard,
  Clock,
  Phone,
  Building2,
  Sparkles,
  Smartphone,
  Banknote
} from 'lucide-react';
import { DigitalIdCard } from '../components/credentials/DigitalIdCard';
import { TeamDigitalIdCard } from '../components/credentials/TeamDigitalIdCard';
import { AttendanceQrPass } from '../components/credentials/AttendanceQrPass';
import { TransactionReceipt } from '../components/credentials/TransactionReceipt';
import { UpiPaymentSuccessAnimation } from '../components/ui/UpiPaymentSuccessAnimation';
import { 
  OversizedDocumentModal, 
  type CoordinatorContact 
} from '../components/ui/OversizedDocumentModal';
import { DocumentUploadCard } from '../components/ui/DocumentUploadCard';


interface TeamMemberInput {
  id: string;
  name: string;
  roll_number: string;
  department: string;
  year_of_study: number;
  college: string;
}

interface UploadedDocMeta {
  name: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

type RegistrationStep = 'DETAILS' | 'REVIEW' | 'PAYMENT' | 'PROCESSING' | 'CONFIRMED';
type PaymentMethod = 'UPI' | 'COD';

export function SubEventRegister() {
  const { eventId, categoryId, subEventId } = useParams<{ eventId: string; categoryId?: string; subEventId: string }>();
  const { user, profile } = useAuth();

  const [subEvent, setSubEvent] = useState<SubEvent | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [coordinators, setCoordinators] = useState<CoordinatorContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Workflow Step
  const [step, setStep] = useState<RegistrationStep>('DETAILS');

  // Form State
  const [mode, setMode] = useState<'SOLO' | 'TEAM'>('SOLO');
  const [teamName, setTeamName] = useState('');
  
  // Leader info
  const [leaderName, setLeaderName] = useState('');
  const [leaderRoll, setLeaderRoll] = useState('');
  const [leaderDept, setLeaderDept] = useState('');
  const [leaderYear, setLeaderYear] = useState(3);
  const [leaderCollege, setLeaderCollege] = useState('KITS Akshar Institute of Technology');

  // Additional team members
  const [teamMembers, setTeamMembers] = useState<TeamMemberInput[]>([]);

  // Document uploads & 20MB limit fallback state
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, UploadedDocMeta>>({});
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);
  const [oversizedModalDoc, setOversizedModalDoc] = useState<RequiredDocumentConfig | null>(null);
  const [oversizedFile, setOversizedFile] = useState<File | null>(null);
  const [deferredDocs, setDeferredDocs] = useState<Record<string, {
    reason: 'WHATSAPP_COORDINATOR' | 'UPLOAD_LATER';
    timestamp: number;
  }>>({});
  const docInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Terms Acceptance
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeAccuracy, setAgreeAccuracy] = useState(false);

  // Payment Selection State
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [demoPaymentRef, setDemoPaymentRef] = useState('');

  // Submission result from server
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [registrationResult, setRegistrationResult] = useState<any | null>(null);
  const [isAlreadyRegistered, setIsAlreadyRegistered] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // Active view tab on confirmed screen: 'IDCARD' | 'QRPASS' | 'RECEIPT' | 'TOKEN'
  const [confirmedTab, setConfirmedTab] = useState<'IDCARD' | 'QRPASS' | 'RECEIPT' | 'TOKEN'>('IDCARD');

  // Persistent Draft Management
  const hasInitialPreFilledRef = useRef(false);
  const isDraftResumedRef = useRef(false);
  const isFirstRenderRef = useRef(true);

  const {
    draft,
    hasExistingDraft,
    saveStatus,
    saveErrorMessage,
    lastSavedAt,
    triggerAutosave,
    resumeDraft,
    startNew,
    discardDraft,
  } = useFormDraft({
    draftType: 'STUDENT_REGISTRATION',
    entityId: subEventId || null,
    title: subEvent ? `${subEvent.name} (${event?.name || 'Event'})` : 'Student Registration',
    enabled: Boolean(user?.id && subEventId && !isAlreadyRegistered && step !== 'CONFIRMED'),
  });

  const handleResumeDraft = () => {
    const loadedDraft = resumeDraft();
    if (!loadedDraft || !loadedDraft.payload) return;

    isDraftResumedRef.current = true;
    hasInitialPreFilledRef.current = true;
    const p = loadedDraft.payload;

    if (p.mode) setMode(p.mode);
    if (p.teamName !== undefined) setTeamName(p.teamName);
    if (p.leaderName !== undefined) setLeaderName(p.leaderName);
    if (p.leaderRoll !== undefined) setLeaderRoll(p.leaderRoll);
    if (p.leaderDept !== undefined) setLeaderDept(p.leaderDept);
    if (p.leaderYear !== undefined) setLeaderYear(p.leaderYear);
    if (p.leaderCollege !== undefined) setLeaderCollege(p.leaderCollege);
    if (Array.isArray(p.teamMembers)) {
      setTeamMembers(p.teamMembers.map((m: any) => ({
        id: m.id || crypto.randomUUID(),
        name: m.name || '',
        roll_number: m.roll_number || '',
        department: m.department || '',
        year_of_study: m.year_of_study || 3,
        college: m.college || '',
      })));
    }
    if (p.uploadedDocs) setUploadedDocs(p.uploadedDocs);
    if (p.deferredDocs) setDeferredDocs(p.deferredDocs);
    if (p.paymentMethod) setPaymentMethod(p.paymentMethod);
    if (p.demoPaymentRef) setDemoPaymentRef(p.demoPaymentRef);
    if (p.agreeTerms !== undefined) setAgreeTerms(Boolean(p.agreeTerms));
    if (p.agreeAccuracy !== undefined) setAgreeAccuracy(Boolean(p.agreeAccuracy));
    if (p.step && p.step !== 'CONFIRMED' && p.step !== 'PROCESSING') {
      if ((subEvent?.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE' || subEvent?.payment_mode === 'CASH_ONLY') && p.step === 'PAYMENT') {
        setStep('REVIEW');
      } else {
        setStep(p.step);
      }
    }
  };

  const handleStartNew = () => {
    startNew();
    hasInitialPreFilledRef.current = true;
  };

  const handleDeleteDraft = async () => {
    const pathsToRemove = Object.values(uploadedDocs).map(d => d.storage_path).filter(Boolean);
    if (pathsToRemove.length > 0) {
      try {
        await supabase.storage.from('documents').remove(pathsToRemove);
      } catch {
        // non-fatal cleanup
      }
    }
    await discardDraft();
    setUploadedDocs({});
  };

  // Load Sub-event info, pre-check existing registration, and assigned coordinators dynamically
  useEffect(() => {
    async function loadData() {
      if (!subEventId || !eventId) return;

      try {
        setIsLoading(true);
        setError(null);

        const [subRes, evRes, coordRpcRes, coordRes] = await Promise.all([
          supabase.from('sub_events').select('*').eq('id', subEventId).single(),
          supabase.from('events').select('*').eq('id', eventId).single(),
          supabase.rpc('get_sub_event_coordinators', { p_sub_event_id: subEventId }),
          supabase
            .from('coordinator_assignments')
            .select(`
              id,
              coordinators (
                id,
                display_name,
                coordinator_type,
                phone_number,
                status
              )
            `)
            .eq('sub_event_id', subEventId),
        ]);

        if (subRes.error) throw subRes.error;
        if (evRes.error) throw evRes.error;

        const sub = subRes.data as SubEvent;
        setSubEvent(sub);
        setEvent(evRes.data as Event);

        // Process assigned coordinators dynamically for this specific registered sub-event
        let validCoords: CoordinatorContact[] = [];

        if (!coordRpcRes.error && Array.isArray(coordRpcRes.data) && coordRpcRes.data.length > 0) {
          validCoords = coordRpcRes.data
            .filter((item: any) => item.phone_number && item.phone_number.trim().length >= 8)
            .map((item: any) => ({
              id: item.coordinator_id,
              display_name: item.display_name,
              coordinator_type: item.coordinator_type || 'COORDINATOR',
              phone_number: item.phone_number,
            }));
        }

        // Fallback to table join if RPC returned empty
        if (validCoords.length === 0 && coordRes.data) {
          coordRes.data.forEach((item: any) => {
            if (item.coordinators && item.coordinators.status !== 'SUSPENDED' && item.coordinators.phone_number) {
              validCoords.push({
                id: item.coordinators.id,
                display_name: item.coordinators.display_name,
                coordinator_type: item.coordinators.coordinator_type || 'COORDINATOR',
                phone_number: item.coordinators.phone_number,
              });
            }
          });
        }
        setCoordinators(validCoords);

        // Determine initial mode
        if (sub.participation_type === 'TEAM') {
          setMode('TEAM');
          setTeamMembers([{
            id: crypto.randomUUID(),
            name: '',
            roll_number: '',
            department: '',
            year_of_study: 3,
            college: '',
          }]);
        } else {
          setMode('SOLO');
        }

        // Initialize payment method based on sub-event payment_mode
        if (sub.payment_mode === 'CASH_ONLY' || sub.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE') {
          setPaymentMethod('COD');
        } else {
          setPaymentMethod('UPI');
        }

        if (categoryId) {
          const { data: catData } = await supabase.from('categories').select('*').eq('id', categoryId).single();
          if (catData) setCategory(catData as Category);
        }

        // Check if current user already has an active registration for this sub-event
        if (user?.id) {
          const { data: existingReg } = await supabase
            .from('registrations')
            .select('id, status')
            .eq('sub_event_id', subEventId)
            .eq('leader_id', user.id)
            .neq('status', 'CANCELLED')
            .maybeSingle();

          if (existingReg) {
            setIsAlreadyRegistered(true);
            setConflictMessage('You are already registered for this sub-event. You can view your pass and credentials in My Registrations.');
          }
        }

        // Initialize demo payment reference
        setDemoPaymentRef(`UPI-DEMO-${Date.now().toString().slice(-8)}`);
      } catch (err: any) {
        console.error('Failed to load sub-event:', err);
        setError(err.message || 'Sub-event not found.');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [eventId, categoryId, subEventId, user?.id]);

  // Pre-fill leader information when profile loads (only once, never stomping active edits or resumed drafts)
  useEffect(() => {
    if (profile && !hasInitialPreFilledRef.current && !isDraftResumedRef.current) {
      if (profile.full_name) setLeaderName(profile.full_name);
      if (profile.roll_number) setLeaderRoll(profile.roll_number);
      if (profile.department) setLeaderDept(profile.department);
      if (profile.year_of_study) setLeaderYear(profile.year_of_study);
      if (profile.college) setLeaderCollege(profile.college);
      hasInitialPreFilledRef.current = true;
    }
  }, [profile]);

  // Autosave listener across form fields
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    if (isLoading || isAlreadyRegistered || step === 'CONFIRMED' || step === 'PROCESSING') {
      return;
    }

    const payload = {
      mode,
      teamName,
      leaderName,
      leaderRoll,
      leaderDept,
      leaderYear,
      leaderCollege,
      teamMembers,
      uploadedDocs,
      deferredDocs,
      paymentMethod,
      demoPaymentRef,
      agreeTerms,
      agreeAccuracy,
      step,
    };

    triggerAutosave(payload, step === 'DETAILS' ? 1 : step === 'REVIEW' ? 2 : 3);
  }, [
    mode, teamName, leaderName, leaderRoll, leaderDept, leaderYear,
    leaderCollege, teamMembers, uploadedDocs, deferredDocs,
    paymentMethod, demoPaymentRef, agreeTerms, agreeAccuracy, step,
    isLoading, isAlreadyRegistered, triggerAutosave
  ]);

  // Guard: Offline payment modes never access the PAYMENT selection screen
  useEffect(() => {
    if ((subEvent?.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE' || subEvent?.payment_mode === 'CASH_ONLY') && step === 'PAYMENT') {
      setStep('REVIEW');
    }
  }, [subEvent?.payment_mode, step]);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-pulse" aria-busy="true" aria-label="Loading registration form">
        <div className="h-4 w-32 bg-gray-200 rounded"></div>
        <div className="bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="h-4 w-24 bg-gray-200 rounded"></div>
            <div className="h-7 w-64 bg-gray-300 rounded-lg"></div>
          </div>
          <div className="flex gap-2">
            <div className="h-2 flex-1 bg-gray-200 rounded-full"></div>
            <div className="h-2 flex-1 bg-gray-100 rounded-full"></div>
            <div className="h-2 flex-1 bg-gray-100 rounded-full"></div>
          </div>
          <div className="space-y-4 pt-4">
            <div className="h-10 w-full bg-gray-100 rounded-xl"></div>
            <div className="h-10 w-full bg-gray-100 rounded-xl"></div>
            <div className="h-10 w-full bg-gray-100 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !subEvent || !event) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Link to="/events" className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to Events
        </Link>
        <ErrorState message={error || 'Sub-event not found'} />
      </div>
    );
  }

  const requiredDocs = Array.isArray(subEvent.required_documents) 
    ? (subEvent.required_documents as RequiredDocumentConfig[]) 
    : [];

  const maxAllowedTeamSize = subEvent.max_team_size || 4;
  const currentTotalTeamSize = 1 + teamMembers.length;
  const isFreeEvent = Boolean(subEvent.is_free) || ((subEvent.fee_amount_solo || 0) === 0 && (subEvent.fee_amount_team || 0) === 0);
  const feeToPay = isFreeEvent ? 0 : (mode === 'TEAM' ? (subEvent.fee_amount_team || 0) : (subEvent.fee_amount_solo || 0));
  const isRegAvailable = isSubEventRegistrationAvailable(subEvent, event);

  const backUrl = categoryId 
    ? `/events/${eventId}/categories/${categoryId}/sub-events/${subEvent.id}`
    : `/events/${eventId}/sub-events/${subEvent.id}`;

  const handleAddMember = () => {
    if (currentTotalTeamSize >= maxAllowedTeamSize) return;
    setTeamMembers(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: '',
        roll_number: '',
        department: '',
        year_of_study: 3,
        college: '',
      }
    ]);
  };

  const handleRemoveMember = (idx: number) => {
    setTeamMembers(prev => prev.filter((_, i) => i !== idx));
  };

  const handleMemberChange = (idx: number, field: keyof TeamMemberInput, val: any) => {
    setTeamMembers(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  // Upload file to Supabase Storage with strict 20 MB pre-upload limit
  const handleFileUpload = async (docConfig: RequiredDocumentConfig, file: File) => {
    if (!user || !subEvent) return;

    // Strict 20 MB size validation: block BEFORE storage upload begins
    if (file.size > MAX_DOCUMENT_SIZE) {
      setOversizedModalDoc(docConfig);
      setOversizedFile(file);
      return;
    }

    const key = docConfig.id || docConfig.name;
    const prevUploaded = uploadedDocs[key];
    setUploadingDocId(key);

    try {
      const uploadedResult = await uploadRegistrationDocument({
        file,
        docConfig,
        userId: user.id,
        subEventId: subEvent.id,
        registrationId: null,
        supabaseClient: supabase,
        replaceStoragePath: prevUploaded?.storage_path,
      });

      setUploadedDocs(prev => ({
        ...prev,
        [key]: {
          name: uploadedResult.name,
          storage_path: uploadedResult.storage_path,
          file_name: uploadedResult.file_name,
          mime_type: uploadedResult.mime_type,
          size_bytes: uploadedResult.size_bytes,
        }
      }));

      // If document was previously deferred, clear deferral since it's now successfully uploaded
      setDeferredDocs(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (err: any) {
      console.error('File upload error in SubEventRegister:', err);
      // Re-throw so DocumentUploadCard receives the error and displays the retry UI cleanly
      throw err;
    } finally {
      setUploadingDocId(null);
    }
  };

  // Step 1 -> Step 2: Validate Details
  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!isSubEventRegistrationAvailable(subEvent, event)) {
      setSubmitError('Registration is currently closed for this event.');
      return;
    }

    if (!leaderName.trim() || !leaderRoll.trim() || !leaderDept.trim()) {
      setSubmitError('Please complete all participant profile details.');
      return;
    }

    if (mode === 'TEAM') {
      if (!teamName.trim()) {
        setSubmitError('Please provide a Team Name for team registration.');
        return;
      }
      if (teamMembers.length === 0) {
        setSubmitError('Team registration requires at least 2 members (Leader + 1 Member).');
        return;
      }
      const leaderRollClean = leaderRoll.trim().toUpperCase();
      const seenRolls = new Set<string>([leaderRollClean]);

      for (let i = 0; i < teamMembers.length; i++) {
        const memberName = teamMembers[i].name.trim();
        const memberRoll = teamMembers[i].roll_number.trim().toUpperCase();
        const memberDept = teamMembers[i].department.trim();
        const memberCollege = teamMembers[i].college.trim();
        const memberYear = teamMembers[i].year_of_study;

        if (!memberName || !memberRoll || !memberDept || !memberCollege || !memberYear) {
          setSubmitError(`Please complete all details (Full Name, Roll Number, Department, Year, College) for Team Member #${i + 2}.`);
          return;
        }

        if (memberRoll === leaderRollClean) {
          setSubmitError(`Team Member #${i + 2} cannot have the same roll number (${memberRoll}) as the team leader. Each participant must be distinct.`);
          return;
        }

        if (seenRolls.has(memberRoll)) {
          setSubmitError(`Duplicate roll number detected: ${memberRoll} is assigned to multiple team members. Each participant must be distinct.`);
          return;
        }

        seenRolls.add(memberRoll);
      }
    }

    // Document upload is optional for completing registration (Problem 4).
    // Any un-uploaded required documents are automatically marked as deferred for later submission.
    for (const doc of requiredDocs) {
      const key = doc.id || doc.name;
      if (!uploadedDocs[key] && !deferredDocs[key]) {
        setDeferredDocs(prev => ({
          ...prev,
          [key]: {
            reason: 'UPLOAD_LATER',
            timestamp: Date.now(),
          },
        }));
      }
    }

    setStep('REVIEW');
    triggerAutosave({
      mode,
      teamName,
      leaderName,
      leaderRoll,
      leaderDept,
      leaderYear,
      leaderCollege,
      teamMembers,
      uploadedDocs,
      deferredDocs,
      paymentMethod,
      demoPaymentRef,
      agreeTerms,
      agreeAccuracy,
      step: 'REVIEW',
    }, 2, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 2 -> Step 3: Review -> Payment / Direct Confirmation
  const handleReviewToPayment = () => {
    if (isSubmittingRef.current || isSubmitting) return;
    if (!isSubEventRegistrationAvailable(subEvent, event)) {
      setSubmitError('Registration is currently closed for this event.');
      return;
    }
    if (!agreeTerms || !agreeAccuracy) {
      setSubmitError('You must accept the Terms & Conditions and acknowledge data accuracy to proceed.');
      return;
    }
    setSubmitError(null);

    if (feeToPay > 0) {
      if (subEvent?.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE' || subEvent?.payment_mode === 'CASH_ONLY') {
        executeServerRegistration('COD');
        return;
      }

      if (subEvent?.payment_mode === 'UPI_ONLY') {
        setPaymentMethod('UPI');
      }

      setStep('PAYMENT');
      triggerAutosave({
        mode,
        teamName,
        leaderName,
        leaderRoll,
        leaderDept,
        leaderYear,
        leaderCollege,
        teamMembers,
        uploadedDocs,
        deferredDocs,
        paymentMethod: subEvent?.payment_mode === 'UPI_ONLY' ? 'UPI' : paymentMethod,
        demoPaymentRef,
        agreeTerms,
        agreeAccuracy,
        step: 'PAYMENT',
      }, 3, true);
    } else {
      executeServerRegistration('FREE');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 3 -> Step 4/5: Process Payment & Execute Authoritative Backend Registration
  const handleProceedWithPayment = () => {
    if (isSubmittingRef.current || isSubmitting) return;
    executeServerRegistration(paymentMethod);
  };

  const executeServerRegistration = async (selectedMethod: PaymentMethod | 'FREE') => {
    if (isSubmittingRef.current) return;
    if (!isSubEventRegistrationAvailable(subEvent, event)) {
      setSubmitError('Registration is currently closed for this event.');
      return;
    }
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    setStep('PROCESSING');

    try {
      const allMembers = [
        {
          snapshot_name: leaderName.trim(),
          snapshot_roll_number: leaderRoll.trim().toUpperCase(),
          snapshot_department: leaderDept.trim(),
          snapshot_year: Number(leaderYear),
          snapshot_college: leaderCollege.trim(),
          is_leader: true,
        },
        ...(mode === 'TEAM' ? teamMembers.map(m => ({
          snapshot_name: m.name.trim(),
          snapshot_roll_number: m.roll_number.trim().toUpperCase(),
          snapshot_department: m.department.trim(),
          snapshot_year: Number(m.year_of_study),
          snapshot_college: m.college.trim(),
          is_leader: false,
        })) : [])
      ];

      const refCode = selectedMethod === 'COD' 
        ? (subEvent?.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE' ? `OFFLINE-${Date.now().toString().slice(-8)}` : `COD-${Date.now().toString().slice(-8)}`)
        : selectedMethod === 'FREE'
          ? `FREE-${Date.now().toString().slice(-8)}`
          : (demoPaymentRef || `UPI-DEMO-${Date.now().toString().slice(-8)}`);

      const payload = {
        sub_event_id: subEvent.id,
        mode,
        team_name: mode === 'TEAM' ? teamName.trim() : null,
        team_members: allMembers,
        uploaded_documents: Object.values(uploadedDocs),
        payment_method: selectedMethod,
        payment_reference: refCode,
      };

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      // Authoritative call to student-register Edge Function
      const { data: result, error: funcErr } = await supabase.functions.invoke('student-register', {
        body: payload,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (funcErr) {
        let msg = 'Registration failed';
        let isConflict = false;

        if (funcErr.status === 409) {
          isConflict = true;
        }

        if (funcErr.context && typeof funcErr.context.json === 'function') {
          try {
            const body = await funcErr.context.json();
            if (body?.error?.message) msg = body.error.message;
            if (body?.error?.code === 'CONFLICT' || body?.error?.code === 'ALREADY_REGISTERED') {
              isConflict = true;
            }
          } catch {
            // ignore
          }
        } else if (funcErr.message) {
          msg = funcErr.message;
        }

        if (
          isConflict ||
          msg.toLowerCase().includes('already registered') ||
          msg.toLowerCase().includes('conflict') ||
          msg.toLowerCase().includes('duplicate')
        ) {
          setIsAlreadyRegistered(true);
          setConflictMessage(msg.includes('already registered') ? msg : 'You are already registered for this event.');
          setSubmitError(null);
          setStep('REVIEW');
          return;
        }

        throw new Error(msg);
      }

      setRegistrationResult(result);
      setStep('CONFIRMED');
      // Final backend transaction succeeded: safely delete draft
      await discardDraft();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      console.error('Registration submission failed:', err);
      const msg = err.message || 'An unexpected error occurred during registration.';
      const isConflict = msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('conflict');
      if (isConflict) {
        setIsAlreadyRegistered(true);
        setConflictMessage(msg.includes('already registered') ? msg : 'You are already registered for this event.');
        setSubmitError(null);
        setStep('REVIEW');
      } else {
        // Prevent false registration failure: Check if registration actually succeeded in database despite network timeout
        try {
          if (user?.id && subEvent?.id) {
            const { data: verifiedReg } = await supabase
              .from('registrations')
              .select(`
                id,
                status,
                created_at,
                teams (
                  id,
                  team_name,
                  team_members (*)
                ),
                payments (*)
              `)
              .eq('sub_event_id', subEvent.id)
              .eq('leader_id', user.id)
              .neq('status', 'CANCELLED')
              .maybeSingle();

            if (verifiedReg) {
              console.log('[SubEventRegister] Registration verified in DB despite network timeout:', verifiedReg.id);
              const p = Array.isArray(verifiedReg.payments) ? verifiedReg.payments[0] : verifiedReg.payments;
              const t = Array.isArray(verifiedReg.teams) ? verifiedReg.teams[0] : verifiedReg.teams;
              const authoritativeStatus = verifiedReg.status;
              setRegistrationResult({
                success: true,
                registration_id: verifiedReg.id,
                team_id: t?.id,
                status: authoritativeStatus,
                registration_status: authoritativeStatus,
                is_free: isFreeEvent,
                payment: p || null,
                members: t?.team_members || [],
                registration: {
                  id: verifiedReg.id,
                  status: authoritativeStatus,
                  created_at: verifiedReg.created_at,
                  payment: p || null,
                  team: {
                    id: t?.id,
                    team_name: t?.team_name,
                    members: t?.team_members || [],
                  },
                },
              });
              setStep('CONFIRMED');
              await discardDraft();
              window.scrollTo({ top: 0, behavior: 'smooth' });
              return;
            }
          }
        } catch (verifyErr) {
          console.warn('[SubEventRegister] Verification check notice:', verifyErr);
        }

        setSubmitError(msg);
        setStep('DETAILS');
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const isPaymentSuccess = registrationResult?.registration?.payment?.status === 'SUCCESS' || isFreeEvent;

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-16">
      {/* Top Breadcrumbs */}
      <div className="flex items-center justify-between">
        <Link 
          to={backUrl} 
          className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red transition"
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to Sub-Event
        </Link>
        <div className="flex items-center gap-3">
          <DraftSaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} errorMessage={saveErrorMessage} />
          <span className="text-[10px] font-black uppercase tracking-widest text-kits-blue bg-blue-50 px-2.5 py-1 rounded-md border border-blue-100">
            Official Registration Flow
          </span>
        </div>
      </div>

      {/* Already Registered Dedicated Friendly Banner */}
      {isAlreadyRegistered && (
        <div className="bg-white rounded-3xl border-2 border-amber-300 shadow-md p-6 sm:p-8 text-center max-w-xl mx-auto space-y-4 page-enter">
          <div className="h-14 w-14 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto shadow-2xs">
            <CheckCircle2 className="h-7 w-7 text-amber-700" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-800 block">
              REGISTRATION RECORDED
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
              You are already registered for this event
            </h2>
            <p className="text-xs text-gray-600 leading-relaxed max-w-md mx-auto">
              {conflictMessage || 'Your registration has already been recorded in KITS-EOS. You can access your official Event ID card, Attendance QR Pass, and Receipt directly in My Registrations.'}
            </p>
          </div>
          <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/my-registrations"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-sm"
            >
              <span>Go to My Registrations</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to={backUrl}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-gray-300 bg-white text-gray-700 text-xs font-bold hover:bg-gray-50 transition"
            >
              <span>Back to Sub-Event</span>
            </Link>
          </div>
        </div>
      )}

      {/* Registration Closed / Gate Closed Barrier Banner */}
      {!isAlreadyRegistered && !isRegAvailable && (
        <div className="bg-white rounded-3xl border-2 border-red-200 shadow-md p-6 sm:p-8 text-center max-w-xl mx-auto space-y-4 page-enter">
          <div className="h-14 w-14 rounded-2xl bg-red-100 text-kits-red flex items-center justify-center mx-auto shadow-2xs">
            <Lock className="h-7 w-7 text-kits-red" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-kits-red block">
              REGISTRATION UNAVAILABLE
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
              Registrations Are Currently Closed
            </h2>
            <p className="text-xs text-gray-600 leading-relaxed max-w-md mx-auto">
              Registrations for {subEvent.name} are not currently open. This sub-event may have reached maximum capacity, its schedule or parent event registration gate is closed, or registration has completed.
            </p>
          </div>
          <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to={backUrl}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-sm"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Sub-Event</span>
            </Link>
          </div>
        </div>
      )}

      {/* Multi-Step Progress Tracker */}
      {!isAlreadyRegistered && isRegAvailable && step !== 'CONFIRMED' && (
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs">
          <div className="flex items-center justify-between max-w-2xl mx-auto text-xs">
            <div className={`flex items-center gap-2 font-bold ${step === 'DETAILS' ? 'text-kits-red font-black' : 'text-gray-400'}`}>
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-black ${step === 'DETAILS' ? 'bg-kits-red text-white' : 'bg-gray-100 text-gray-600'}`}>
                1
              </span>
              <span>Details</span>
            </div>

            <div className="flex-1 mx-3 h-0.5 bg-gray-200" />

            <div className={`flex items-center gap-2 font-bold ${step === 'REVIEW' ? 'text-kits-red font-black' : 'text-gray-400'}`}>
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-black ${step === 'REVIEW' ? 'bg-kits-red text-white' : 'bg-gray-100 text-gray-600'}`}>
                2
              </span>
              <span>Review</span>
            </div>

            <div className="flex-1 mx-3 h-0.5 bg-gray-200" />

            <div className={`flex items-center gap-2 font-bold ${step === 'PAYMENT' || step === 'PROCESSING' ? 'text-kits-red font-black' : 'text-gray-400'}`}>
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-black ${step === 'PAYMENT' || step === 'PROCESSING' ? 'bg-kits-red text-white' : 'bg-gray-100 text-gray-600'}`}>
                3
              </span>
              <span>
                {subEvent?.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE' ? 'Submission' : isFreeEvent ? 'Confirmation' : 'Payment'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Global Error Banner */}
      {!isAlreadyRegistered && submitError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3 text-xs text-red-800 font-bold animate-in fade-in duration-200">
          <AlertCircle className="h-5 w-5 text-kits-red shrink-0 mt-0.5" />
          <div>{submitError}</div>
        </div>
      )}

      {/* =========================================================================
          STEP 1: REGISTRATION DETAILS
          ========================================================================= */}
      {!isAlreadyRegistered && isRegAvailable && step === 'DETAILS' && (
        <div className="bg-white rounded-3xl border border-gray-200 shadow-2xs page-enter">
          {/* Header */}
          <div className="p-6 sm:p-8 bg-gradient-to-r from-red-50/70 to-blue-50/70 border-b border-gray-200 space-y-2 rounded-t-3xl">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-red-100 text-kits-red">
                Step 1 of 3
              </span>
              <span className="text-xs font-bold text-gray-500">
                {event.name} {category ? `• ${category.name}` : ''}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              Register for {subEvent.name}
            </h1>
            <p className="text-xs text-gray-600 leading-relaxed max-w-2xl">
              Complete your participation profile and team roster. Validated details will be encoded into your institutional Event ID Card.
            </p>
          </div>

          <form onSubmit={handleProceedToReview} className="p-4 sm:p-8 space-y-6 sm:space-y-8">
            {/* Mode Selection */}
            {subEvent.participation_type === 'BOTH' && (
              <div className="space-y-3">
                <label className="text-xs font-black uppercase tracking-wider text-gray-700 block">
                  Participation Format
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('SOLO');
                      setTeamMembers([]);
                    }}
                    className={`p-4 rounded-2xl border text-left transition flex items-center gap-3 cursor-pointer ${
                      mode === 'SOLO'
                        ? 'border-kits-red bg-red-50/50 shadow-2xs'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl ${mode === 'SOLO' ? 'bg-kits-red text-white' : 'bg-gray-100 text-gray-600'}`}>
                      <User className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-gray-900">Solo Participant</div>
                      <div className="text-[11px] text-gray-500 font-bold">
                        {isFreeEvent ? 'Fee: FREE' : `Fee: ₹${subEvent.fee_amount_solo || 0}`}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode('TEAM');
                      if (teamMembers.length === 0) {
                        setTeamMembers([{
                          id: crypto.randomUUID(),
                          name: '',
                          roll_number: '',
                          department: '',
                          year_of_study: 3,
                          college: '',
                        }]);
                      }
                    }}
                    className={`p-4 rounded-2xl border text-left transition flex items-center gap-3 cursor-pointer ${
                      mode === 'TEAM'
                        ? 'border-kits-blue bg-blue-50/50 shadow-2xs'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl ${mode === 'TEAM' ? 'bg-kits-blue text-white' : 'bg-gray-100 text-gray-600'}`}>
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-gray-900">Team Participation</div>
                      <div className="text-[11px] text-gray-500 font-bold">
                        {isFreeEvent ? 'Fee: FREE' : `Fee: ₹${subEvent.fee_amount_team || 0}`} (Max {maxAllowedTeamSize})
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Team Configuration */}
            {mode === 'TEAM' && (
              <div className="space-y-4 p-5 bg-blue-50/30 rounded-2xl border border-blue-100">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-kits-blue flex items-center gap-1.5">
                    <Users className="h-4 w-4" />
                    Team Details
                  </h3>
                  <span className="text-[11px] font-bold text-gray-500">
                    {currentTotalTeamSize} / {maxAllowedTeamSize} Members
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Team Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="e.g. Code Ninjas, Circuit Masters"
                    className="w-full px-3.5 py-2.5 text-xs bg-white border border-gray-300 rounded-xl focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  />
                </div>
              </div>
            )}

            {/* Primary Participant / Leader Profile */}
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                <User className="h-4 w-4 text-kits-red" />
                {mode === 'TEAM' ? 'Team Leader Profile' : 'Participant Profile'}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={leaderName}
                    onChange={(e) => setLeaderName(e.target.value)}
                    placeholder="Enter student full name"
                    className="w-full px-3.5 py-2.5 text-xs bg-white border border-gray-300 rounded-xl focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Roll Number / Hall Ticket <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={leaderRoll}
                    onChange={(e) => setLeaderRoll(e.target.value.toUpperCase())}
                    placeholder="e.g. 21AK1A0501"
                    className="w-full px-3.5 py-2.5 text-xs font-mono uppercase bg-white border border-gray-300 rounded-xl focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Department / Branch <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={leaderDept}
                    onChange={(e) => setLeaderDept(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs bg-white border border-gray-300 rounded-xl focus:border-kits-blue focus:ring-1 focus:ring-kits-blue cursor-pointer"
                  >
                    <option value="" disabled>Select Department / Branch</option>
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                    {leaderDept && !DEPARTMENTS.includes(leaderDept as any) && (
                      <option value={leaderDept}>{leaderDept}</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Year of Study <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={leaderYear}
                    onChange={(e) => setLeaderYear(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 text-xs bg-white border border-gray-300 rounded-xl focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  >
                    <option value={1}>1st Year (Freshman)</option>
                    <option value={2}>2nd Year (Sophomore)</option>
                    <option value={3}>3rd Year (Junior)</option>
                    <option value={4}>4th Year (Senior)</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <CollegeSelect
                    label="College / Institution"
                    required
                    value={leaderCollege}
                    onChange={setLeaderCollege}
                    placeholder="Search or Select College 🔍"
                  />
                </div>
              </div>
            </div>

            {/* Additional Team Members */}
            {mode === 'TEAM' && (
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-gray-700">
                    Additional Team Members
                  </h3>
                  {currentTotalTeamSize < maxAllowedTeamSize && (
                    <button
                      type="button"
                      onClick={handleAddMember}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-50 text-kits-blue border border-blue-200 text-xs font-bold hover:bg-blue-100 transition cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Member</span>
                    </button>
                  )}
                </div>

                <div className="space-y-4">
                  {teamMembers.map((member, idx) => (
                    <div key={member.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3 relative">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-gray-700">
                          Member #{idx + 2}
                        </span>
                        {teamMembers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(idx)}
                            className="text-gray-400 hover:text-red-600 transition p-1 cursor-pointer"
                            title="Remove Member"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-gray-600 mb-1">
                            Full Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            value={member.name}
                            onChange={(e) => handleMemberChange(idx, 'name', e.target.value)}
                            placeholder="Student Name"
                            className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-gray-600 mb-1">
                            Roll Number <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            value={member.roll_number}
                            onChange={(e) => handleMemberChange(idx, 'roll_number', e.target.value.toUpperCase())}
                            placeholder="21AK1A0..."
                            className="w-full px-3 py-2 text-xs font-mono uppercase bg-white border border-gray-300 rounded-lg focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-gray-600 mb-1">
                            Department / Branch <span className="text-red-500">*</span>
                          </label>
                          <select
                            required
                            value={member.department}
                            onChange={(e) => handleMemberChange(idx, 'department', e.target.value)}
                            className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg focus:border-kits-blue focus:ring-1 focus:ring-kits-blue cursor-pointer"
                          >
                            <option value="" disabled>Select Department</option>
                            {DEPARTMENTS.map((dept) => (
                              <option key={dept} value={dept}>
                                {dept}
                              </option>
                            ))}
                            {member.department && !DEPARTMENTS.includes(member.department as any) && (
                              <option value={member.department}>{member.department}</option>
                            )}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-gray-600 mb-1">
                            Year <span className="text-red-500">*</span>
                          </label>
                          <select
                            value={member.year_of_study}
                            onChange={(e) => handleMemberChange(idx, 'year_of_study', Number(e.target.value))}
                            className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                          >
                            <option value={1}>1st Year</option>
                            <option value={2}>2nd Year</option>
                            <option value={3}>3rd Year</option>
                            <option value={4}>4th Year</option>
                          </select>
                        </div>

                        <div className="sm:col-span-2">
                          <CollegeSelect
                            label="College / Institution"
                            required
                            value={member.college}
                            onChange={(col) => handleMemberChange(idx, 'college', col)}
                            placeholder="Search or Select Member's College 🔍"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Document Uploads */}
            {requiredDocs.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                    <Upload className="h-4 w-4 text-kits-blue" />
                    Required Document Uploads
                  </h3>
                  <span className="text-[10px] font-bold text-gray-400">
                    Max 20 MB per file
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {requiredDocs.map((doc, idx) => {
                    const key = doc.id || doc.name;
                    const uploaded = uploadedDocs[key];
                    const isUploading = uploadingDocId === key;
                    const isDeferred = deferredDocs[key];

                    return (
                      <DocumentUploadCard
                        key={doc.id || doc.name || idx}
                        doc={doc}
                        uploadedDoc={uploaded}
                        isDeferred={isDeferred}
                        isExternalUploading={isUploading}
                        maxSizeBytes={MAX_DOCUMENT_SIZE}
                        inputRefCallback={(el) => {
                          docInputRefs.current[key] = el;
                        }}
                        onFileUpload={(d, f) => handleFileUpload(d, f)}
                        onOversizedFile={(d, f) => {
                          setOversizedModalDoc(d);
                          setOversizedFile(f);
                        }}
                        onOpenCoordinatorModal={(d) => {
                          setOversizedModalDoc(d);
                          setOversizedFile(null);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Dynamic Pre-Submission Payment Information Box */}
            <div className={`p-4 rounded-2xl border text-xs space-y-1.5 ${
              isFreeEvent
                ? 'bg-slate-50 border-slate-200 text-slate-800'
                : subEvent.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE'
                  ? 'bg-amber-50/80 border-amber-200 text-amber-900'
                  : subEvent.payment_mode === 'CASH_ONLY'
                    ? 'bg-amber-50/80 border-amber-200 text-amber-900'
                    : subEvent.payment_mode === 'UPI_ONLY'
                      ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                      : 'bg-blue-50/80 border-blue-200 text-blue-900'
            }`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-white/80 border border-gray-200 text-gray-700">
                  {isFreeEvent
                    ? 'PAYMENT: FREE'
                    : subEvent.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE'
                      ? 'PAYMENT: REGISTER ONLINE & PAY OFFLINE'
                      : subEvent.payment_mode === 'CASH_ONLY'
                        ? 'PAYMENT: PAY OFFLINE (IN-PERSON CASH)'
                        : subEvent.payment_mode === 'UPI_ONLY'
                          ? 'PAYMENT: DEMO UPI'
                          : 'PAYMENT: ONLINE UPI OR OFFLINE CASH'}
                </span>
                <span className="font-mono font-black text-sm">
                  {isFreeEvent ? '₹0 (Free)' : `₹${feeToPay}`}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed opacity-90">
                {isFreeEvent
                  ? 'No payment required for this sub-event. Event ID Card and Attendance QR Pass unlock immediately upon registration submission.'
                  : subEvent.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE'
                    ? `Payment of ₹${feeToPay} will be collected offline by the coordinator. Payment Status will be PENDING VERIFICATION. Credentials unlock after payment approval.`
                    : subEvent.payment_mode === 'CASH_ONLY'
                      ? `Registration is submitted online; fee of ₹${feeToPay} is paid in-person to the coordinator. Payment Status will be PENDING VERIFICATION. Credentials unlock after payment approval.`
                      : subEvent.payment_mode === 'UPI_ONLY'
                        ? 'Instant demo payment simulation. No real money will be charged. Event ID Card, QR Pass, and Receipt unlock immediately.'
                        : 'Choose between instant Demo UPI payment or in-person cash payment to the coordinator in the next steps.'}
              </p>
            </div>

            {/* Submit Button */}
            <div className="flex flex-col xs:flex-row xs:items-center justify-between gap-3 pt-4 border-t border-gray-100">
              <div className="text-xs">
                <span className="text-gray-500 font-bold">Total Fee: </span>
                <span className="font-mono font-black text-gray-900 text-sm">
                  {feeToPay > 0 ? `₹${feeToPay}` : 'FREE'}
                </span>
              </div>

              <button
                type="submit"
                className="w-full xs:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs cursor-pointer"
              >
                <span>Proceed to Review</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =========================================================================
          STEP 2: REGISTRATION REVIEW
          ========================================================================= */}
      {!isAlreadyRegistered && isRegAvailable && step === 'REVIEW' && (
        <div className="bg-white rounded-3xl border border-gray-200 shadow-2xs overflow-hidden space-y-6 page-enter">
          <div className="p-6 sm:p-8 bg-gradient-to-r from-red-50/70 to-blue-50/70 border-b border-gray-200 space-y-2">
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-red-100 text-kits-red">
              Step 2 of 3
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              Review Registration Summary
            </h1>
            <p className="text-xs text-gray-600">
              Verify all entered details and accept institutional terms before proceeding.
            </p>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {/* Institutional Summary Box */}
            <div className="bg-gray-50 rounded-2xl border border-gray-200 p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-gray-200 pb-3">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-kits-blue block">
                    KITS-EOS EVENT REGISTRATION
                  </span>
                  <h3 className="text-lg font-black text-gray-900">{subEvent.name}</h3>
                  <div className="text-xs text-gray-500 font-bold">{event.name} {category ? `• ${category.name}` : ''}</div>
                </div>
                <span className="text-xs font-black uppercase px-3 py-1 bg-red-50 text-kits-red rounded-full border border-red-200">
                  {mode} PARTICIPATION
                </span>
              </div>

              {/* Leader & Team Breakdown */}
              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-500 font-bold">Primary Participant / Leader:</span>
                  <span className="font-black text-gray-900">{leaderName} ({leaderRoll})</span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-500 font-bold">Department & Year:</span>
                  <span className="font-bold text-gray-800">{leaderDept} • Year {leaderYear}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-500 font-bold">Institution:</span>
                  <span className="font-bold text-gray-800">{leaderCollege}</span>
                </div>

                {mode === 'TEAM' && (
                  <>
                    <div className="flex justify-between py-1 border-b border-gray-100">
                      <span className="text-kits-blue font-black">Official Team Name:</span>
                      <span className="font-black text-gray-900">{teamName}</span>
                    </div>
                    <div className="py-2">
                      <span className="text-gray-500 font-bold block mb-1.5">Registered Team Members ({currentTotalTeamSize}):</span>
                      <div className="space-y-1.5 pl-3 border-l-2 border-kits-blue">
                        <div className="font-bold text-gray-900">
                          1. {leaderName} ({leaderRoll}) — <span className="text-amber-800 font-extrabold">Leader</span> • {leaderDept} • Year {leaderYear} • {leaderCollege}
                        </div>
                        {teamMembers.map((m, i) => (
                          <div key={m.id || i} className="text-gray-700 font-medium">
                            {i + 2}. {m.name} ({m.roll_number}) • {m.department} • Year {m.year_of_study} • {m.college}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Documents Breakdown in Review */}
                {requiredDocs.length > 0 && (
                  <div className="py-2.5 border-t border-gray-100 space-y-2">
                    <span className="text-gray-500 font-bold block text-xs">Required Documents Status:</span>
                    <div className="space-y-1.5">
                      {requiredDocs.map((doc, i) => {
                        const key = doc.id || doc.name;
                        const uploaded = uploadedDocs[key];
                        const isDeferred = deferredDocs[key];

                        return (
                          <div key={i} className="flex items-center justify-between text-xs py-1.5 px-3 bg-white rounded-xl border border-gray-200 flex-wrap gap-1">
                            <span className="font-bold text-gray-800">{doc.name}</span>
                            {uploaded ? (
                              <span className="font-mono text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1 font-semibold truncate max-w-[200px]">
                                <CheckCircle2 className="h-3 w-3 shrink-0" /> {uploaded.file_name}
                              </span>
                            ) : isDeferred?.reason === 'UPLOAD_LATER' ? (
                              <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 font-bold flex items-center gap-1">
                                <Clock className="h-3 w-3 text-amber-600 shrink-0" /> Upload Deferred
                              </span>
                            ) : isDeferred?.reason === 'WHATSAPP_COORDINATOR' ? (
                              <span className="text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 font-bold flex items-center gap-1">
                                <Phone className="h-3 w-3 text-emerald-600 shrink-0" /> Coordinator Contact Provided
                              </span>
                            ) : (
                              <span className="text-[11px] text-amber-600 italic font-medium">Pending Document Submission</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 bg-white p-4 rounded-xl border border-gray-200 mt-2">
                  <div>
                    <span className="text-xs font-black uppercase text-gray-700 block">Total Registration Fee</span>
                    <span className="text-[11px] font-bold text-gray-500">
                      {isFreeEvent 
                        ? 'Free Event • No Payment Required' 
                        : subEvent?.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE'
                          ? 'Register Online & Pay Offline (Status: Pending Verification)'
                          : subEvent?.payment_mode === 'CASH_ONLY'
                            ? 'Pay Offline in Cash to Coordinator (Status: Pending Verification)'
                            : subEvent?.payment_mode === 'UPI_ONLY'
                              ? 'Online Demo UPI Payment (Instant Verification)'
                              : 'Select Payment Method (Demo UPI or In-Person Cash)'}
                    </span>
                  </div>
                  <span className="text-xl font-black font-mono text-kits-red self-start sm:self-auto">
                    {feeToPay > 0 ? `₹${feeToPay}` : 'FREE'}
                  </span>
                </div>
              </div>
            </div>

            {/* Mandatory Terms & Conditions Checkboxes */}
            <div className="space-y-3 p-5 bg-blue-50/50 rounded-2xl border border-blue-100">
              <h4 className="text-xs font-black uppercase tracking-wider text-kits-blue flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" />
                Institutional Agreements & Compliance
              </h4>

              <div className="space-y-2.5 text-xs">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                    className="mt-0.5 h-4 w-4 text-kits-red rounded border-gray-300 focus:ring-kits-red"
                  />
                  <span className="text-gray-700">
                    I agree to the{' '}
                    <Link to="/terms" target="_blank" className="font-bold text-kits-blue hover:underline">
                      KITS-EOS Terms & Conditions
                    </Link>{' '}
                    governing event participation, attendance verification, and award regulations.
                  </span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={agreeAccuracy}
                    onChange={(e) => setAgreeAccuracy(e.target.checked)}
                    className="mt-0.5 h-4 w-4 text-kits-red rounded border-gray-300 focus:ring-kits-red"
                  />
                  <span className="text-gray-700">
                    I acknowledge that all information provided is accurate and adheres to the{' '}
                    <Link to="/privacy" target="_blank" className="font-bold text-kits-blue hover:underline">
                      Privacy Policy
                    </Link>.
                  </span>
                </label>
              </div>
            </div>

            {/* Navigation Buttons */}
            <div className="flex flex-col-reverse xs:flex-row xs:items-center justify-between gap-3 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setStep('DETAILS')}
                className="w-full xs:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back & Edit</span>
              </button>

              <button
                type="button"
                disabled={!agreeTerms || !agreeAccuracy || isSubmitting}
                onClick={handleReviewToPayment}
                className="w-full xs:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs cursor-pointer"
              >
                <span>
                  {isSubmitting 
                    ? 'Processing...' 
                    : isFreeEvent || feeToPay === 0 
                      ? 'Confirm Free Registration' 
                      : subEvent?.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE'
                        ? `Register Online & Pay Offline (₹${feeToPay})`
                        : subEvent?.payment_mode === 'CASH_ONLY'
                          ? `Submit Registration & Pay Cash (₹${feeToPay})`
                          : subEvent?.payment_mode === 'UPI_ONLY'
                            ? `Proceed to Demo Payment (₹${feeToPay})`
                            : `Proceed to Payment Selection (₹${feeToPay})`}
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          STEP 3: PROFESSIONAL PAYMENT SELECTION SCREEN (UPI vs COD)
          ========================================================================= */}
      {!isAlreadyRegistered && isRegAvailable && step === 'PAYMENT' && (
        <div className="bg-white rounded-3xl border border-gray-200 shadow-2xs overflow-hidden max-w-2xl mx-auto space-y-6 page-enter">
          <div className="p-6 sm:p-7 bg-slate-900 text-white flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 block">
                STEP 3 OF 3 • PAYMENT METHOD
              </span>
              <h2 className="text-xl font-black tracking-tight mt-0.5">
                KITS-EOS Payment Portal
              </h2>
            </div>
            <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center text-emerald-400">
              <Lock className="h-5 w-5" />
            </div>
          </div>

          <div className="p-6 sm:p-7 space-y-6">
            {/* Payment Summary Box */}
            <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200 text-xs space-y-2.5">
              <div className="flex justify-between py-1 border-b border-gray-200">
                <span className="text-gray-500 font-bold">Sub-Event:</span>
                <span className="font-black text-gray-900">{subEvent.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-200">
                <span className="text-gray-500 font-bold">Participant / Leader:</span>
                <span className="font-bold text-gray-900">{leaderName} ({leaderRoll})</span>
              </div>
              {mode === 'TEAM' && (
                <div className="flex justify-between py-1 border-b border-gray-200">
                  <span className="text-gray-500 font-bold">Team Name:</span>
                  <span className="font-bold text-kits-blue">{teamName} ({currentTotalTeamSize} members)</span>
                </div>
              )}
              <div className="flex justify-between py-1 items-center pt-2">
                <span className="text-xs font-black uppercase text-gray-700">Total Payable Amount:</span>
                <span className="text-2xl font-black font-mono text-gray-900">₹{feeToPay}</span>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="space-y-3">
              <label className="text-xs font-black uppercase tracking-wider text-gray-700 block">
                Select Preferred Payment Method <span className="text-red-500">*</span>
              </label>

              <div className="space-y-3">
                {/* Option 1: Simulated UPI (Render only if UPI_ONLY or BOTH) */}
                {(!subEvent?.payment_mode || subEvent.payment_mode === 'UPI_ONLY' || subEvent.payment_mode === 'BOTH') && (
                  <div
                    onClick={() => setPaymentMethod('UPI')}
                    className={`p-4 rounded-2xl border-2 transition cursor-pointer flex items-start gap-4 ${
                      paymentMethod === 'UPI'
                        ? 'border-emerald-600 bg-emerald-50/40 shadow-xs ring-1 ring-emerald-600/20'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl mt-0.5 ${paymentMethod === 'UPI' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-black text-gray-900">
                          UPI Payment (Instant Simulated Demo)
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                          INSTANT RELEASE
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">
                        Complete a simulated UPI payment. Event ID Card, QR Pass, and Receipt will be unlocked immediately.
                      </p>
                      <div className="text-[11px] font-bold text-emerald-700 pt-1 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        DEMO PAYMENT • NO REAL MONEY WILL BE CHARGED
                      </div>
                    </div>
                  </div>
                )}

                {/* Option 2: COD / Pay to Coordinator (Render only if CASH_ONLY or BOTH) */}
                {(!subEvent?.payment_mode || subEvent.payment_mode === 'CASH_ONLY' || subEvent.payment_mode === 'BOTH') && (
                  <div
                    onClick={() => setPaymentMethod('COD')}
                    className={`p-4 rounded-2xl border-2 transition cursor-pointer flex items-start gap-4 ${
                      paymentMethod === 'COD'
                        ? 'border-amber-500 bg-amber-50/40 shadow-xs ring-1 ring-amber-500/20'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl mt-0.5 ${paymentMethod === 'COD' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                      <Banknote className="h-5 w-5" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-black text-gray-900">
                          COD / Pay to Coordinator (In-Person Cash)
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          PAY LATER
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">
                        Pay the registration amount directly to the assigned coordinator or event administrator.
                      </p>
                      <div className="text-[11px] font-bold text-amber-800 pt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Registration recorded as PENDING. Event ID Card released upon coordinator confirmation.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* DPDP Pre-Collection Transparency Notice */}
            <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200/60 text-xs text-gray-700">
              <ShieldCheck className="h-4 w-4 text-kits-blue shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-gray-900 block text-xs">
                  Event Data Processing & Privacy Notice
                </span>
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  KITS-EOS processes registration and participation details strictly to coordinate competition operations, generate verifiable QR passes, mark attendance, and award certificates under institutional data governance standards.
                </p>
                <div className="pt-0.5">
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold text-kits-blue hover:underline inline-flex items-center gap-1"
                  >
                    <span>Read KITS-EOS Privacy Policy →</span>
                  </a>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col-reverse xs:flex-row xs:items-center justify-between gap-3 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setStep('REVIEW')}
                className="w-full xs:w-auto px-5 py-2.5 text-xs font-bold text-gray-600 hover:text-gray-900 transition cursor-pointer text-center"
              >
                Back to Review
              </button>

              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleProceedWithPayment}
                className={`w-full xs:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl text-white text-xs font-black uppercase tracking-wider disabled:opacity-50 transition shadow-md cursor-pointer ${
                  paymentMethod === 'UPI'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {paymentMethod === 'UPI' ? <CreditCard className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
                <span>
                  {isSubmitting 
                    ? 'Processing...' 
                    : paymentMethod === 'UPI' 
                      ? `Pay ₹${feeToPay} via Demo UPI`
                      : `Submit (Pay ₹${feeToPay} to Coordinator)`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          STEP 4: PROCESSING ANIMATION
          ========================================================================= */}
      {!isAlreadyRegistered && isRegAvailable && step === 'PROCESSING' && (
        <div className="bg-white rounded-3xl border border-gray-200 shadow-2xs p-12 text-center max-w-md mx-auto space-y-6 page-enter">
          <div className="relative mx-auto w-16 h-16">
            <div className="w-16 h-16 border-4 border-emerald-500/20 border-t-emerald-600 rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-emerald-600">
              <Lock className="h-6 w-6" />
            </div>
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-black text-gray-900">
              {isFreeEvent
                ? 'Recording Free Registration...'
                : subEvent?.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE'
                  ? 'Submitting Online Registration...'
                  : subEvent?.payment_mode === 'CASH_ONLY' || paymentMethod === 'COD'
                    ? 'Submitting Offline Registration...'
                    : 'Submitting Registration & Demo Payment...'}
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Synchronizing authoritative registration and payment records with central database...
            </p>
          </div>
        </div>
      )}

      {/* =========================================================================
          STEP 5: CONFIRMED SCREEN (FREE vs UPI SUCCESS vs COD PENDING)
          ========================================================================= */}
      {step === 'CONFIRMED' && registrationResult?.registration && (
        <div className="space-y-8 page-enter">
          {isFreeEvent ? (
            /* =====================================================================
               FREE EVENT CONFIRMATION CARD (INSTITUTIONAL SLATE / BLUE / RED)
               ===================================================================== */
            <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6 sm:p-10 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 rounded-2xl bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center font-black shrink-0 shadow-2xs">
                    <CheckCircle2 className="h-8 w-8 text-slate-700" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                        REGISTRATION CONFIRMED
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-700 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                        FREE EVENT
                      </span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight mt-1">
                      Registration Confirmed!
                    </h1>
                  </div>
                </div>

                <div className="bg-slate-50 px-5 py-3 rounded-2xl border border-slate-200 self-start sm:self-auto text-right">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                    Registration Fee
                  </span>
                  <span className="text-xl font-black font-sans text-slate-800">
                    Free (₹0)
                  </span>
                </div>
              </div>

              {/* Notice */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-700 space-y-1">
                <div className="font-black uppercase tracking-wide text-slate-900">
                  Institutional Pass Unlocked
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Your registration for <strong>{subEvent.name}</strong> is confirmed. 
                  Your official <strong>Event ID Card</strong> and <strong>Attendance QR Pass</strong> have been generated below and are accessible anytime from your account.
                </p>
              </div>

              {/* Details & Quick Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                <div className="text-xs space-y-1 w-full sm:w-auto">
                  <div className="text-gray-500">
                    <span className="font-bold">Participant:</span> {leaderName} ({leaderRoll})
                  </div>
                  {mode === 'TEAM' && (
                    <div className="text-gray-500">
                      <span className="font-bold">Team:</span> {teamName} ({currentTotalTeamSize} members)
                    </div>
                  )}
                  <div className="text-gray-500 font-mono text-[11px]">
                    <span className="font-bold font-sans">Token:</span> {registrationResult.registration.team?.members?.[0]?.manual_token || `KITS-EOS-${subEvent.name.toUpperCase()}-0000000000`}
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmedTab('IDCARD');
                      setTimeout(() => {
                        document.getElementById('credentials-suite-section')?.scrollIntoView({ behavior: 'smooth' });
                      }, 50);
                    }}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs cursor-pointer"
                  >
                    <IdCard className="h-4 w-4" />
                    <span>View ID Card</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmedTab('QRPASS');
                      setTimeout(() => {
                        document.getElementById('credentials-suite-section')?.scrollIntoView({ behavior: 'smooth' });
                      }, 50);
                    }}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-kits-blue text-white text-xs font-black uppercase tracking-wider hover:bg-blue-800 transition shadow-2xs cursor-pointer"
                  >
                    <QrCode className="h-4 w-4" />
                    <span>View QR Pass</span>
                  </button>
                </div>
              </div>
            </div>
          ) : isPaymentSuccess ? (
            /* =====================================================================
               REBUILT 3D UPI DEMO PAYMENT SUCCESS ANIMATION EXPERIENCE
               ===================================================================== */
            <UpiPaymentSuccessAnimation
              feeAmount={feeToPay}
              eventName={event.name}
              categoryName={category?.name}
              subEventName={subEvent.name}
              participationType={mode}
              registrationId={registrationResult.registration.id}
              transactionId={registrationResult.registration.payment?.reference_id || demoPaymentRef}
              paymentMethod={paymentMethod}
              manualToken={registrationResult.registration.team?.members?.[0]?.manual_token || `KITS-EOS-${subEvent.name.toUpperCase()}-0000000000`}
              leaderName={leaderName}
              leaderRoll={leaderRoll}
              leaderDept={leaderDept}
              leaderYear={leaderYear}
              leaderCollege={leaderCollege}
              teamName={registrationResult.registration.team?.team_name}
              qrIdentity={registrationResult.registration.team?.members?.[0]?.qr_identity}
              qrPayload={registrationResult.registration.team?.members?.[0]?.manual_token}
              activeTab={confirmedTab}
              onSelectTab={(tab) => setConfirmedTab(tab)}
              onViewPass={() => {
                setConfirmedTab('IDCARD');
                setTimeout(() => {
                  document.getElementById('credentials-suite-section')?.scrollIntoView({ behavior: 'smooth' });
                }, 50);
              }}
              onDownloadReceipt={() => {
                setConfirmedTab('RECEIPT');
                setTimeout(() => {
                  document.getElementById('credentials-suite-section')?.scrollIntoView({ behavior: 'smooth' });
                }, 50);
              }}
            />
          ) : (
            /* =====================================================================
               COD / PAY TO COORDINATOR / PAYMENT PENDING SCREEN
               ===================================================================== */
            <div className="bg-white rounded-3xl border-2 border-amber-300 shadow-md p-6 sm:p-10 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-amber-100 pb-5">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center font-black shrink-0 shadow-2xs">
                    <Clock className="h-8 w-8" />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 block">
                      REGISTRATION SUBMITTED • AWAITING PAYMENT APPROVAL
                    </span>
                    <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
                      Registration Recorded!
                    </h1>
                  </div>
                </div>

                <div className="bg-amber-50 px-5 py-3 rounded-2xl border border-amber-200 self-start sm:self-auto text-right">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 block">
                    Amount Due
                  </span>
                  <span className="text-2xl font-black font-mono text-amber-700">
                    ₹{feeToPay}
                  </span>
                </div>
              </div>

              {/* Explanatory Banner */}
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-1">
                <div className="font-black uppercase tracking-wide">
                  Payment Status: PENDING VERIFICATION
                </div>
                <p className="text-amber-800 leading-relaxed">
                  Your registration has been submitted and recorded in the live KITS-EOS database. 
                  Payment is pending offline verification. Please pay the registration fee of <strong>₹{feeToPay}</strong> directly to the assigned event coordinator or administrator listed below.
                  Your <strong>Official Event ID Card, QR credentials and receipt will unlock after payment approval.</strong>
                </p>
              </div>

              {/* Authoritative Live Database State Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs bg-gray-50 p-4 rounded-2xl border border-gray-200">
                <div>
                  <span className="text-[9px] font-black uppercase text-gray-400 block">Registration ID</span>
                  <span className="font-mono font-bold text-gray-900 select-all break-all text-[11px]">
                    {registrationResult.registration.id}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-gray-400 block">Event</span>
                  <span className="font-bold text-gray-900 truncate block">
                    {event.name}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-gray-400 block">Sub-Event</span>
                  <span className="font-bold text-gray-900 truncate block">
                    {subEvent.name}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-gray-400 block">Registration Status</span>
                  <span className="font-black text-amber-700">
                    Awaiting Payment Approval ({registrationResult.registration.status})
                  </span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-gray-400 block">Payment Status</span>
                  <span className="font-black text-amber-700">
                    {registrationResult.registration.payment?.status || 'PENDING'} (PENDING VERIFICATION)
                  </span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-gray-400 block">Payment Method</span>
                  <span className="font-bold text-gray-900">
                    {subEvent.payment_mode === 'REGISTER_ONLINE_PAY_OFFLINE' 
                      ? 'REGISTER ONLINE & PAY OFFLINE' 
                      : (registrationResult.registration.payment?.payment_method === 'COD' ? 'OFFLINE CASH' : registrationResult.registration.payment?.payment_method || 'OFFLINE')}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-gray-400 block">Registration Token</span>
                  <span className="font-mono font-bold text-kits-blue">
                    {registrationResult.registration.team?.members?.[0]?.manual_token || 'PENDING APPROVAL'}
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-[9px] font-black uppercase text-gray-400 block">Payment Reference</span>
                  <span className="font-mono font-bold text-amber-800">
                    {registrationResult.registration.payment?.reference_id || 'PENDING'}
                  </span>
                </div>
              </div>

              {/* Live Assigned Coordinators Payment Information */}
              <div className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-kits-blue" />
                  Assigned Coordinators for Payment Submission
                </h3>

                {coordinators.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {coordinators.map((c) => (
                      <div key={c.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-200 flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-blue-100 text-kits-blue">
                            {c.coordinator_type === 'FACULTY' ? 'Faculty Coordinator' : 'Student Coordinator'}
                          </span>
                          <div className="text-sm font-black text-gray-900 pt-1">
                            {c.display_name}
                          </div>
                          {c.phone_number && (
                            <div className="text-xs font-mono text-gray-600 flex items-center gap-1">
                              <Phone className="h-3 w-3 text-gray-400" />
                              {c.phone_number}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 text-xs text-gray-600 flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-gray-400" />
                    <span>Please pay to the <strong>Event Administrator</strong> at the Central Event Operations Desk.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* =====================================================================
              CREDENTIAL PACKAGE SUITE (REVEALED IMMEDIATELY ON SUCCESSFUL REGISTRATION)
              ===================================================================== */}
          {(isPaymentSuccess || isFreeEvent) && (
            <div id="credentials-suite-section" className="space-y-6 pt-2">
              {/* Credential Suite Navigation Tabs */}
              <div className="bg-white p-2.5 sm:p-3 rounded-2xl border border-gray-200 shadow-2xs flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmedTab('IDCARD')}
                  className={`w-full xs:w-auto px-4 sm:px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    confirmedTab === 'IDCARD'
                      ? 'bg-kits-red text-white shadow-2xs'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <IdCard className="h-4 w-4" />
                  <span>{mode === 'TEAM' ? 'Team ID Card' : 'Digital ID Card'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmedTab('QRPASS')}
                  className={`w-full xs:w-auto px-4 sm:px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    confirmedTab === 'QRPASS'
                      ? 'bg-kits-blue text-white shadow-2xs'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <QrCode className="h-4 w-4" />
                  <span>{mode === 'TEAM' ? 'Team QR Pass' : 'Attendance QR Pass'}</span>
                </button>

                {!isFreeEvent && (
                  <button
                    type="button"
                    onClick={() => setConfirmedTab('RECEIPT')}
                    className={`w-full xs:w-auto px-4 sm:px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5 ${
                      confirmedTab === 'RECEIPT'
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <Receipt className="h-4 w-4" />
                    <span>Transaction Receipt</span>
                  </button>
                )}
              </div>

              {/* Tab 1: Digital ID Card / Team ID Card */}
              {confirmedTab === 'IDCARD' && (
                <div className="space-y-4">
                  {mode === 'TEAM' ? (
                    <TeamDigitalIdCard
                      teamName={registrationResult.registration.team?.team_name || teamName || 'Registered Team'}
                      eventName={event.name}
                      categoryName={category?.name}
                      subEventName={subEvent.name}
                      members={[
                        {
                          name: leaderName,
                          rollNumber: leaderRoll,
                          department: leaderDept,
                          year: leaderYear,
                          college: leaderCollege,
                          isLeader: true,
                        },
                        ...teamMembers.map((m) => ({
                          name: m.name,
                          rollNumber: m.roll_number,
                          department: m.department,
                          year: m.year_of_study,
                          college: m.college,
                          isLeader: false,
                        })),
                      ]}
                      registrationId={registrationResult.registration.id}
                      manualToken={registrationResult.registration.team?.members?.[0]?.manual_token || `KITS-EOS-${subEvent.name.toUpperCase()}-0000000000`}
                      qrPayload={registrationResult.registration.team?.members?.[0]?.manual_token}
                    />
                  ) : (
                    <DigitalIdCard
                      studentName={leaderName}
                      rollNumber={leaderRoll}
                      department={leaderDept}
                      year={leaderYear}
                      college={leaderCollege}
                      eventName={event.name}
                      categoryName={category?.name}
                      subEventName={subEvent.name}
                      participationType={mode}
                      teamName={registrationResult.registration.team?.team_name}
                      registrationId={registrationResult.registration.id}
                      manualToken={registrationResult.registration.team?.members?.[0]?.manual_token || `KITS-EOS-${subEvent.name.toUpperCase()}-0000000000`}
                      qrIdentity={registrationResult.registration.team?.members?.[0]?.qr_identity}
                    />
                  )}
                </div>
              )}

              {/* Tab 2: Attendance QR Pass (One Team QR for teams) */}
              {confirmedTab === 'QRPASS' && (
                <div className="space-y-4">
                  <AttendanceQrPass
                    studentName={mode === 'TEAM' ? (registrationResult.registration.team?.team_name || teamName || 'Registered Team') : leaderName}
                    rollNumber={mode === 'TEAM' ? `TEAM PASS (${1 + teamMembers.length} Members)` : leaderRoll}
                    eventName={event.name}
                    subEventName={subEvent.name}
                    teamName={registrationResult.registration.team?.team_name || (mode === 'TEAM' ? teamName : undefined)}
                    registrationId={registrationResult.registration.id}
                    manualToken={registrationResult.registration.team?.members?.[0]?.manual_token || `KITS-EOS-${subEvent.name.toUpperCase()}-0000000000`}
                    qrIdentity={mode !== 'TEAM' ? registrationResult.registration.team?.members?.[0]?.qr_identity : undefined}
                    qrPayload={registrationResult.registration.team?.members?.[0]?.manual_token}
                  />
                </div>
              )}

              {/* Tab 3: Transaction Receipt */}
              {confirmedTab === 'RECEIPT' && (
                <div className="space-y-4">
                  <TransactionReceipt
                    transactionId={registrationResult.registration.payment?.reference_id || demoPaymentRef}
                    paymentStatus={registrationResult.registration.payment?.status || (isFreeEvent ? 'SUCCESS' : 'PENDING')}
                    paymentMethod={paymentMethod}
                    registrationId={registrationResult.registration.id}
                    studentName={leaderName}
                    rollNumber={leaderRoll}
                    department={leaderDept}
                    year={leaderYear}
                    college={leaderCollege}
                    eventName={event.name}
                    categoryName={category?.name}
                    subEventName={subEvent.name}
                    participationType={mode}
                    amount={feeToPay}
                    timestamp={registrationResult.registration.created_at}
                  />
                </div>
              )}
            </div>
          )}

          {/* Bottom Navigation Links */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-5 bg-white rounded-2xl border border-gray-200">
            <Link
              to="/registrations"
              className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs"
            >
              <span>Go to My Registrations</span>
              <ArrowRight className="h-4 w-4" />
            </Link>

            <Link
              to="/events"
              className="text-xs font-bold text-gray-600 hover:text-gray-900 transition"
            >
              Browse More Events →
            </Link>
          </div>
        </div>
      )}

      {/* 20 MB Limit Exceeded & Coordinator WhatsApp Fallback Modal */}
      {oversizedModalDoc && createPortal(
        <OversizedDocumentModal
          isOpen={Boolean(oversizedModalDoc)}
          onClose={() => {
            setOversizedModalDoc(null);
            setOversizedFile(null);
          }}
          documentName={oversizedModalDoc?.name || 'Required Document'}
          subEventName={subEvent?.name || 'Registered Sub-Event'}
          studentName={profile?.full_name || leaderName || user?.user_metadata?.full_name || 'Participant'}
          selectedFileSize={oversizedFile?.size}
          selectedFileName={oversizedFile?.name}
          coordinators={coordinators}
          onChooseDifferentFile={() => {
            const targetDoc = oversizedModalDoc;
            setOversizedModalDoc(null);
            setOversizedFile(null);
            if (targetDoc) {
              const key = targetDoc.id || targetDoc.name;
              const input = docInputRefs.current[key];
              if (input) {
                input.value = '';
                input.click();
              }
            }
          }}
          onDeferUploadLater={() => {
            if (oversizedModalDoc) {
              const key = oversizedModalDoc.id || oversizedModalDoc.name;
              // Guard: An oversized replacement attempt must NEVER overwrite or destroy an already successfully uploaded document
              if (!uploadedDocs[key]) {
                setDeferredDocs(prev => ({
                  ...prev,
                  [key]: {
                    reason: 'UPLOAD_LATER',
                    timestamp: Date.now()
                  }
                }));
              }
            }
            setOversizedModalDoc(null);
            setOversizedFile(null);
          }}
          onCoordinatorWhatsAppChosen={(_coord) => {
            if (oversizedModalDoc) {
              const key = oversizedModalDoc.id || oversizedModalDoc.name;
              // Guard: If document was already uploaded, preserve uploaded state
              if (!uploadedDocs[key]) {
                setDeferredDocs(prev => ({
                  ...prev,
                  [key]: {
                    reason: 'WHATSAPP_COORDINATOR',
                    timestamp: Date.now()
                  }
                }));
              }
            }
          }}
        />,
        document.body
      )}

      {/* Resume Draft Prompt Modal */}
      <ResumeDraftModal
        isOpen={hasExistingDraft}
        title={draft?.title || (subEvent ? `${subEvent.name}` : 'Registration Draft')}
        subtitle={event?.name ? `Main Event: ${event.name}` : undefined}
        lastSavedAt={lastSavedAt || draft?.updated_at}
        currentStep={draft?.current_step}
        onResume={handleResumeDraft}
        onStartNew={handleStartNew}
        onDelete={handleDeleteDraft}
      />
    </div>
  );
}
