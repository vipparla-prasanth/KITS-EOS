import { useState, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase, invokeAdminEdgeFunction } from '@kits-eos/shared/src/api/client';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { DateTimePicker } from '../../components/ui/DateTimePicker';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { 
  ArrowLeft, 
  Save, 
  Plus, 
  Trash2, 
  CalendarDays, 
  Users, 
  DollarSign, 
  FileText, 
  UserCheck, 
  Clock, 
  Sparkles 
} from 'lucide-react';
import type { Event, Category, SubEvent, RequiredDocumentConfig, SubEventPaymentMode } from '@kits-eos/shared/src/types/models';
import { useFormDraft } from '@kits-eos/shared/src/hooks/useFormDraft';
import { DraftSaveIndicator } from '@kits-eos/shared/src/components/DraftSaveIndicator';
import { ResumeDraftModal } from '@kits-eos/shared/src/components/ResumeDraftModal';

export function EditSubEvent() {
  const { eventId, categoryId, subEventId } = useParams<{ 
    eventId: string; 
    categoryId?: string; 
    subEventId: string; 
  }>();
  const navigate = useNavigate();
  
  const [event, setEvent] = useState<Event | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [bannerPath, setBannerPath] = useState<string | null>(null);
  const [rules, setRules] = useState('');

  const [participationType, setParticipationType] = useState<'SOLO' | 'TEAM' | 'BOTH'>('SOLO');
  const [maxTeamSize, setMaxTeamSize] = useState<number>(4);

  const [paymentType, setPaymentType] = useState<'FREE' | 'PAID'>('FREE');
  const [paymentMode, setPaymentMode] = useState<SubEventPaymentMode>('BOTH');
  const [originalPaymentType, setOriginalPaymentType] = useState<'FREE' | 'PAID'>('FREE');
  const [hasRegistrations, setHasRegistrations] = useState(false);
  const [feeAmountSolo, setFeeAmountSolo] = useState<number>(0);
  const [feeAmountTeam, setFeeAmountTeam] = useState<number>(0);
  const [paymentInstructions, setPaymentInstructions] = useState('');

  const [requireDocument, setRequireDocument] = useState<boolean>(false);
  const [documents, setDocuments] = useState<RequiredDocumentConfig[]>([]);

  const [facultyCoordinator, setFacultyCoordinator] = useState({
    name: '',
    mobile: '',
    username: '',
    password: ''
  });

  const [studentCoordinator, setStudentCoordinator] = useState({
    name: '',
    mobile: '',
    username: '',
    password: ''
  });

  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [venue, setVenue] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [staleDraftNotice, setStaleDraftNotice] = useState<string | null>(null);

  // Draft persistence hook
  const isFirstRenderRef = useRef(true);
  const {
    draft,
    hasExistingDraft,
    saveStatus,
    lastSavedAt,
    triggerAutosave,
    resumeDraft,
    startNew,
    discardDraft,
  } = useFormDraft({
    draftType: 'ADMIN_SUB_EVENT_EDIT',
    entityId: subEventId || null,
    title: name ? `Edit: ${name}` : 'Edit Sub-event Draft',
    enabled: Boolean(subEventId && !isLoading),
  });

  const handleResumeDraft = () => {
    const loaded = resumeDraft();
    if (!loaded?.payload) return;

    if (status === 'ARCHIVED' || event?.status === 'ARCHIVED') {
      setStaleDraftNotice('This sub-event or its parent event is currently ARCHIVED. Applying old draft changes is restricted. You may discard this stale draft.');
      return;
    }

    const p: any = loaded.payload;
    if (p.name !== undefined) setName(p.name);
    if (p.description !== undefined) setDescription(p.description);
    if (p.bannerPath !== undefined) setBannerPath(p.bannerPath);
    if (p.rules !== undefined) setRules(p.rules);
    if (p.participationType !== undefined) setParticipationType(p.participationType);
    if (p.maxTeamSize !== undefined) setMaxTeamSize(p.maxTeamSize);
    if (p.paymentType !== undefined && !hasRegistrations) {
      setPaymentType(p.paymentType);
    }
    if (p.paymentMode !== undefined) setPaymentMode(p.paymentMode);
    if (p.feeAmountSolo !== undefined) setFeeAmountSolo(p.feeAmountSolo);
    if (p.feeAmountTeam !== undefined) setFeeAmountTeam(p.feeAmountTeam);
    if (p.paymentInstructions !== undefined) setPaymentInstructions(p.paymentInstructions);
    if (p.requireDocument !== undefined) setRequireDocument(p.requireDocument);
    if (p.documents && Array.isArray(p.documents)) setDocuments(p.documents);
    if (p.facultyCoordinator) {
      setFacultyCoordinator(prev => ({
        ...prev,
        name: p.facultyCoordinator.name || '',
        mobile: p.facultyCoordinator.mobile || '',
        username: p.facultyCoordinator.username || '',
        password: '',
      }));
    }
    if (p.studentCoordinator) {
      setStudentCoordinator(prev => ({
        ...prev,
        name: p.studentCoordinator.name || '',
        mobile: p.studentCoordinator.mobile || '',
        username: p.studentCoordinator.username || '',
        password: '',
      }));
    }
    if (p.startTime !== undefined) setStartTime(p.startTime);
    if (p.endTime !== undefined) setEndTime(p.endTime);
    if (p.venue !== undefined) setVenue(p.venue);
    if (p.status !== undefined) setStatus(p.status);
  };

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    if (isLoading || !subEventId) return;

    triggerAutosave({
      name,
      description,
      bannerPath,
      rules,
      participationType,
      maxTeamSize,
      paymentType,
      paymentMode,
      feeAmountSolo,
      feeAmountTeam,
      paymentInstructions,
      requireDocument,
      documents,
      // COORDINATOR SANITIZATION: Never save coordinator password in drafts
      facultyCoordinator: {
        name: facultyCoordinator.name,
        mobile: facultyCoordinator.mobile,
        username: facultyCoordinator.username,
      },
      studentCoordinator: {
        name: studentCoordinator.name,
        mobile: studentCoordinator.mobile,
        username: studentCoordinator.username,
      },
      startTime,
      endTime,
      venue,
      status,
    }, 1);
  }, [
    name, description, bannerPath, rules, participationType, maxTeamSize,
    paymentType, paymentMode, feeAmountSolo, feeAmountTeam, paymentInstructions,
    requireDocument, documents, facultyCoordinator, studentCoordinator,
    startTime, endTime, venue, status, isLoading, subEventId, triggerAutosave
  ]);

  useEffect(() => {
    async function fetchData() {
      if (!eventId || !subEventId) return;
      try {
        setIsLoading(true);
        setError(null);

        const [eventRes, subEventRes] = await Promise.all([
          supabase.from('events').select('id, name').eq('id', eventId).single(),
          supabase.from('sub_events').select('*').eq('id', subEventId).single()
        ]);

        if (eventRes.error) throw eventRes.error;
        if (subEventRes.error) throw subEventRes.error;

        setEvent(eventRes.data as unknown as Event);
        const sub = subEventRes.data as SubEvent;

        setName(sub.name);
        setDescription(sub.description || '');
        setBannerPath(sub.banner_path || null);
        setRules(sub.rules || '');
        setParticipationType(sub.participation_type);
        setMaxTeamSize(sub.max_team_size || 4);
        
        const isFree = sub.is_free ?? (sub.fee_amount_solo === 0 && sub.fee_amount_team === 0);
        setPaymentType(isFree ? 'FREE' : 'PAID');
        setOriginalPaymentType(isFree ? 'FREE' : 'PAID');
        setPaymentMode(sub.payment_mode || 'BOTH');
        setHasRegistrations((sub.registered_count || 0) > 0);

        setFeeAmountSolo(sub.fee_amount_solo || 0);
        setFeeAmountTeam(sub.fee_amount_team || 0);
        setPaymentInstructions(sub.payment_instructions || '');
        
        const docs = Array.isArray(sub.required_documents) ? sub.required_documents : [];
        if (docs.length > 0) {
          setRequireDocument(true);
          setDocuments(docs);
        } else {
          setRequireDocument(false);
          setDocuments([{ id: 'doc_1', name: 'Project Report', description: 'Upload report in DOCX format', required: true }]);
        }

        setStartTime(sub.start_time || '');
        setEndTime(sub.end_time || '');
        setVenue(sub.venue || '');
        setStatus(sub.status as 'ACTIVE' | 'ARCHIVED');

        // Fetch category if present
        if (categoryId) {
          const catRes = await supabase.from('categories').select('id, name').eq('id', categoryId).single();
          if (catRes.data) setCategory(catRes.data as unknown as Category);
        }

        // Fetch assigned coordinators
        const { data: assignments } = await supabase
          .from('coordinator_assignments')
          .select('coordinator_id, coordinators(id, username, display_name, phone_number, coordinator_type)')
          .eq('sub_event_id', subEventId);

        let initialFaculty = {
          name: '',
          mobile: '',
          username: '',
          password: ''
        };
        let initialStudent = {
          name: '',
          mobile: '',
          username: '',
          password: ''
        };

        if (assignments && assignments.length > 0) {
          for (const item of assignments) {
            const c: any = Array.isArray(item.coordinators) ? item.coordinators[0] : item.coordinators;
            if (c) {
              const coordType = (c.coordinator_type || '').toUpperCase();
              if (coordType === 'FACULTY') {
                initialFaculty = {
                  name: c.display_name || '',
                  mobile: c.phone_number || '',
                  username: c.username || '',
                  password: ''
                };
              } else if (coordType === 'STUDENT') {
                initialStudent = {
                  name: c.display_name || '',
                  mobile: c.phone_number || '',
                  username: c.username || '',
                  password: ''
                };
              }
            }
          }
        }

        setFacultyCoordinator(initialFaculty);
        setStudentCoordinator(initialStudent);
      } catch (err: any) {
        console.error('Failed to load sub-event:', err);
        setError('Failed to load sub-event data.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [eventId, categoryId, subEventId]);

  const handleAddDocument = () => {
    const nextId = `doc_${Date.now()}`;
    setDocuments([...documents, { id: nextId, name: '', description: '', required: true }]);
  };

  const handleRemoveDocument = (id: string) => {
    setDocuments(documents.filter(d => d.id !== id));
  };

  const handleDocumentChange = (id: string, field: 'name' | 'description', val: string) => {
    setDocuments(documents.map(d => (d.id === id ? { ...d, [field]: val } : d)));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!subEventId || !eventId) return;

    if (!name.trim()) {
      setError('Sub-event name is required.');
      return;
    }

    if (participationType !== 'SOLO' && (!maxTeamSize || maxTeamSize < 2)) {
      setError('Maximum team size must be at least 2 for Team/Both participation.');
      return;
    }

    if (paymentType !== originalPaymentType && hasRegistrations) {
      setError('Cannot change payment type between Free and Paid because registrations already exist for this sub-event.');
      return;
    }

    if (paymentType === 'PAID') {
      if ((participationType === 'SOLO' || participationType === 'BOTH') && (!feeAmountSolo || feeAmountSolo <= 0)) {
        setError('A positive Solo Registration Fee (₹) is required for Paid Events.');
        return;
      }
      if ((participationType === 'TEAM' || participationType === 'BOTH') && (!feeAmountTeam || feeAmountTeam <= 0)) {
        setError('A positive Team Registration Fee (₹) is required for Paid Events.');
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const isFree = paymentType === 'FREE';
      const payload: any = {
        event_id: eventId,
        category_id: categoryId || null,
        sub_event_id: subEventId,
        name: name.trim().toUpperCase(),
        description: description.trim() || null,
        rules: rules.trim() || null,
        banner_path: bannerPath || null,
        participation_type: participationType,
        max_team_size: participationType === 'SOLO' ? 1 : Number(maxTeamSize),
        fee_amount_solo: isFree ? 0 : (participationType === 'TEAM' ? 0 : Number(feeAmountSolo) || 0),
        fee_amount_team: isFree ? 0 : (participationType === 'SOLO' ? 0 : Number(feeAmountTeam) || 0),
        is_free: isFree,
        payment_mode: isFree ? 'BOTH' : paymentMode,
        payment_instructions: paymentInstructions.trim() || null,
        required_documents: requireDocument ? documents : [],
        start_time: startTime ? new Date(startTime).toISOString() : null,
        end_time: endTime ? new Date(endTime).toISOString() : null,
        venue: venue.trim() || null,
        status,
        faculty_coordinator: facultyCoordinator.username.trim() ? {
          name: facultyCoordinator.name.trim(),
          mobile: facultyCoordinator.mobile.trim(),
          username: facultyCoordinator.username.trim(),
          password: facultyCoordinator.password ? facultyCoordinator.password.trim() : ''
        } : null,
        student_coordinator: studentCoordinator.username.trim() ? {
          name: studentCoordinator.name.trim(),
          mobile: studentCoordinator.mobile.trim(),
          username: studentCoordinator.username.trim(),
          password: studentCoordinator.password ? studentCoordinator.password.trim() : ''
        } : null,
        facultyCoordinator: facultyCoordinator.username.trim() ? {
          name: facultyCoordinator.name.trim(),
          mobile: facultyCoordinator.mobile.trim(),
          username: facultyCoordinator.username.trim(),
          password: facultyCoordinator.password ? facultyCoordinator.password.trim() : ''
        } : null,
        studentCoordinator: studentCoordinator.username.trim() ? {
          name: studentCoordinator.name.trim(),
          mobile: studentCoordinator.mobile.trim(),
          username: studentCoordinator.username.trim(),
          password: studentCoordinator.password ? studentCoordinator.password.trim() : ''
        } : null,
      };

      const { data, error: functionError } = await invokeAdminEdgeFunction('admin-update-sub-event', {
        body: payload
      });

      if (functionError) throw functionError;
      if (!data?.success) throw new Error(data?.error?.message || data?.error || 'Failed to update sub-event');
      if (data?.subEvent && data.subEvent.payment_mode !== payload.payment_mode) {
        throw new Error(`Persisted payment mode mismatch: expected "${payload.payment_mode}", but database returned "${data.subEvent.payment_mode}".`);
      }

      // Success: Discard persistent draft
      await discardDraft();

      if (categoryId) {
        navigate(`/admin/events/${eventId}/categories/${categoryId}/sub-events/${subEventId}`);
      } else {
        navigate(`/admin/events/${eventId}/sub-events/${subEventId}`);
      }
    } catch (err: any) {
      console.error('Sub-event update failed:', err);
      let message = 'Failed to update sub-event.';
      if (err instanceof Error) message = err.message;
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const backLink = categoryId 
    ? `/admin/events/${eventId}/categories/${categoryId}/sub-events/${subEventId}`
    : `/admin/events/${eventId}/sub-events/${subEventId}`;

  if (isLoading) {
    return <LoadingState message="Loading sub-event details..." />;
  }

  return (
    <div className="max-w-4xl mx-auto pb-16">
      <div className="mb-4">
        <Link 
          to={backLink} 
          className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red transition"
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to Sub-event Details
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title={`Edit Sub-event: ${name}`}
          description={`Update sub-event operational rules, schedule, payment settings, or coordinators under ${category ? `${category.name} (${event?.name})` : event?.name || 'Event'}.`}
        />
        <div className="flex items-center gap-3">
          <DraftSaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} />
          <button
            type="button"
            onClick={() => {
              triggerAutosave({
                name,
                description,
                bannerPath,
                rules,
                participationType,
                maxTeamSize,
                paymentType,
                paymentMode,
                feeAmountSolo,
                feeAmountTeam,
                paymentInstructions,
                requireDocument,
                documents,
                facultyCoordinator: {
                  name: facultyCoordinator.name,
                  mobile: facultyCoordinator.mobile,
                  username: facultyCoordinator.username,
                },
                studentCoordinator: {
                  name: studentCoordinator.name,
                  mobile: studentCoordinator.mobile,
                  username: studentCoordinator.username,
                },
                startTime,
                endTime,
                venue,
                status,
              }, 1, true);
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 transition"
          >
            Save Draft
          </button>
        </div>
      </div>

      {staleDraftNotice && (
        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
          <span className="text-xs font-medium text-amber-800">{staleDraftNotice}</span>
          <button
            type="button"
            onClick={async () => {
              await discardDraft();
              setStaleDraftNotice(null);
            }}
            className="text-xs font-bold text-amber-900 underline ml-4 cursor-pointer"
          >
            Discard Stale Draft
          </button>
        </div>
      )}

      <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-t-xl px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-kits-red" />
            <h3 className="text-sm font-bold tracking-wide uppercase">Edit Sub-event Configuration</h3>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-white/10 text-gray-300">
            ID: {subEventId?.substring(0, 8)}...
          </span>
        </div>

        <form
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
              e.preventDefault();
            }
          }}
          className="p-6 sm:p-8 space-y-10"
        >
          {error && (
            <div className="rounded-lg bg-red-50 p-4 border border-red-200">
              <ErrorState message={error} />
            </div>
          )}

          {/* Section 1: Basic Info */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
              <CalendarDays className="h-4 w-4 text-kits-red" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-kits-blue">
                1. Sub-event Information
              </h4>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Sub-event Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value.toUpperCase())}
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                />
              </div>

              <div>
                <label htmlFor="description" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                />
              </div>

              <div>
                <ImageUpload
                  value={bannerPath}
                  onChange={setBannerPath}
                  folder="subevents/banners"
                  label="Sub-event Banner"
                  helperText="Official sub-event banner. PNG, JPG, WebP up to 5MB."
                />
              </div>

              <div>
                <label htmlFor="rules" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Competition Rules & Guidelines
                </label>
                <textarea
                  id="rules"
                  name="rules"
                  rows={4}
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-mono text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Participation */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
              <Users className="h-4 w-4 text-kits-red" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-kits-blue">
                2. Participation Mode
              </h4>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">
                Participation Type <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-1 xs:grid-cols-3 gap-2.5 sm:gap-3 max-w-md">
                {(['SOLO', 'TEAM', 'BOTH'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setParticipationType(type)}
                    className={`py-2.5 px-4 text-xs font-extrabold rounded-lg border text-center transition ${
                      participationType === type
                        ? 'bg-kits-red text-white border-kits-red shadow-sm'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {type === 'BOTH' ? 'Solo & Team (Both)' : type}
                  </button>
                ))}
              </div>
            </div>

            {participationType !== 'SOLO' && (
              <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-200/60 max-w-md transition-all">
                <label htmlFor="max_team_size" className="block text-xs font-bold uppercase tracking-wider text-kits-blue mb-1">
                  Maximum Team Size <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="max_team_size"
                  id="max_team_size"
                  min={2}
                  max={20}
                  required
                  value={maxTeamSize}
                  onChange={(e) => setMaxTeamSize(Math.max(2, parseInt(e.target.value) || 2))}
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-blue focus:ring-1 focus:ring-kits-blue transition"
                />
              </div>
            )}
          </div>

          {/* Section 3: Registration & Payment */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
              <DollarSign className="h-4 w-4 text-kits-red" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-kits-blue">
                3. Registration & Fees
              </h4>
            </div>

            {/* Payment Type Selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                  Event Payment Type <span className="text-kits-red">*</span>
                </label>
                {hasRegistrations && (
                  <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                    Locked: Active registrations exist
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <button
                  type="button"
                  disabled={hasRegistrations}
                  onClick={() => {
                    setPaymentType('FREE');
                    setFeeAmountSolo(0);
                    setFeeAmountTeam(0);
                  }}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-black uppercase tracking-wider transition ${
                    hasRegistrations ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    paymentType === 'FREE'
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${paymentType === 'FREE' ? 'bg-slate-300' : 'bg-slate-400'}`} />
                  Free Event
                </button>

                <button
                  type="button"
                  disabled={hasRegistrations}
                  onClick={() => {
                    setPaymentType('PAID');
                    if (feeAmountSolo === 0 && feeAmountTeam === 0) {
                      setFeeAmountSolo(100);
                      setFeeAmountTeam(150);
                    }
                  }}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-black uppercase tracking-wider transition ${
                    hasRegistrations ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    paymentType === 'PAID'
                      ? 'bg-kits-red text-white border-kits-red shadow-sm'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${paymentType === 'PAID' ? 'bg-white' : 'bg-gray-300'}`} />
                  Paid Event
                </button>
              </div>
            </div>

            {paymentType === 'FREE' ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="text-xs font-bold text-slate-800">Zero Registration Fee</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Students can register directly without payment gateways or verification steps.
                </p>
              </div>
            ) : (
              <>
                {/* 4-Option Payment Mode Selector */}
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                    Payment Mode <span className="text-kits-red">*</span>
                  </label>
                  <p className="text-[11px] text-gray-500">
                    Select how participants will complete registration payment for this sub-event.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {/* Mode 1: UPI ONLY */}
                    <div
                      onClick={() => setPaymentMode('UPI_ONLY')}
                      className={`p-3.5 rounded-xl border-2 cursor-pointer transition flex items-start gap-3 ${
                        paymentMode === 'UPI_ONLY'
                          ? 'border-kits-red bg-red-50/40 shadow-xs ring-1 ring-kits-red/20'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className={`h-4 w-4 rounded-full mt-0.5 border flex items-center justify-center shrink-0 ${
                        paymentMode === 'UPI_ONLY' ? 'border-kits-red bg-kits-red' : 'border-gray-300 bg-white'
                      }`}>
                        {paymentMode === 'UPI_ONLY' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </div>
                      <div>
                        <div className="text-xs font-black uppercase text-gray-900 tracking-tight">1. UPI ONLY</div>
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                          Student must complete payment via UPI. Instant verification and automatic ID card unlock. No cash/COD option.
                        </p>
                      </div>
                    </div>

                    {/* Mode 2: CASH / COD ONLY */}
                    <div
                      onClick={() => setPaymentMode('CASH_ONLY')}
                      className={`p-3.5 rounded-xl border-2 cursor-pointer transition flex items-start gap-3 ${
                        paymentMode === 'CASH_ONLY'
                          ? 'border-kits-red bg-red-50/40 shadow-xs ring-1 ring-kits-red/20'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className={`h-4 w-4 rounded-full mt-0.5 border flex items-center justify-center shrink-0 ${
                        paymentMode === 'CASH_ONLY' ? 'border-kits-red bg-kits-red' : 'border-gray-300 bg-white'
                      }`}>
                        {paymentMode === 'CASH_ONLY' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </div>
                      <div>
                        <div className="text-xs font-black uppercase text-gray-900 tracking-tight">2. CASH / COD ONLY</div>
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                          Student registers online; payment is pending until paid directly to the event coordinator. ID card locked until approved.
                        </p>
                      </div>
                    </div>

                    {/* Mode 3: BOTH UPI + COD */}
                    <div
                      onClick={() => setPaymentMode('BOTH')}
                      className={`p-3.5 rounded-xl border-2 cursor-pointer transition flex items-start gap-3 ${
                        paymentMode === 'BOTH'
                          ? 'border-kits-red bg-red-50/40 shadow-xs ring-1 ring-kits-red/20'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className={`h-4 w-4 rounded-full mt-0.5 border flex items-center justify-center shrink-0 ${
                        paymentMode === 'BOTH' ? 'border-kits-red bg-kits-red' : 'border-gray-300 bg-white'
                      }`}>
                        {paymentMode === 'BOTH' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </div>
                      <div>
                        <div className="text-xs font-black uppercase text-gray-900 tracking-tight">3. BOTH UPI + COD</div>
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                          Preserves flexible choice: Student selects either UPI payment (instant unlock) or Cash to coordinator (coordinator approval).
                        </p>
                      </div>
                    </div>

                    {/* Mode 4: REGISTER ONLINE & PAY OFFLINE */}
                    <div
                      onClick={() => setPaymentMode('REGISTER_ONLINE_PAY_OFFLINE')}
                      className={`p-3.5 rounded-xl border-2 cursor-pointer transition flex items-start gap-3 ${
                        paymentMode === 'REGISTER_ONLINE_PAY_OFFLINE'
                          ? 'border-kits-red bg-red-50/40 shadow-xs ring-1 ring-kits-red/20'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className={`h-4 w-4 rounded-full mt-0.5 border flex items-center justify-center shrink-0 ${
                        paymentMode === 'REGISTER_ONLINE_PAY_OFFLINE' ? 'border-kits-red bg-kits-red' : 'border-gray-300 bg-white'
                      }`}>
                        {paymentMode === 'REGISTER_ONLINE_PAY_OFFLINE' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </div>
                      <div>
                        <div className="text-xs font-black uppercase text-gray-900 tracking-tight">4. REGISTER ONLINE & PAY OFFLINE</div>
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                          No online payment screen. Registration completes directly, displays assigned coordinators' contacts to pay offline.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(participationType === 'SOLO' || participationType === 'BOTH') && (
                  <div>
                    <label htmlFor="fee_solo" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                      Solo Registration Fee (₹) {participationType === 'SOLO' ? <span className="text-kits-red">*</span> : <span className="text-gray-400 font-normal lowercase text-[11px]">(if applicable)</span>}
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-2 text-sm font-bold text-gray-400">₹</span>
                      <input
                        type="number"
                        name="fee_solo"
                        id="fee_solo"
                        min={0}
                        value={feeAmountSolo}
                        onChange={(e) => setFeeAmountSolo(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="block w-full pl-8 rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                        required={participationType === 'SOLO'}
                      />
                    </div>
                  </div>
                )}

                {(participationType === 'TEAM' || participationType === 'BOTH') && (
                  <div>
                    <label htmlFor="fee_team" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                      Team Registration Fee (₹) {participationType === 'TEAM' ? <span className="text-kits-red">*</span> : <span className="text-gray-400 font-normal lowercase text-[11px]">(if applicable)</span>}
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-2 text-sm font-bold text-gray-400">₹</span>
                      <input
                        type="number"
                        name="fee_team"
                        id="fee_team"
                        min={0}
                        value={feeAmountTeam}
                        onChange={(e) => setFeeAmountTeam(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="block w-full pl-8 rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                        required={participationType === 'TEAM'}
                      />
                    </div>
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label htmlFor="payment_instructions" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                    Payment Instructions & Notes
                  </label>
                  <textarea
                    id="payment_instructions"
                    name="payment_instructions"
                    rows={2}
                    value={paymentInstructions}
                    onChange={(e) => setPaymentInstructions(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                  />
                </div>
              </div>
            </>
          )}
        </div>

          {/* Section 4: Required Student Document */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
              <FileText className="h-4 w-4 text-kits-red" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-kits-blue">
                4. Student Document Requirements
              </h4>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">
                Require Student Document Submission?
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setRequireDocument(true)}
                  className={`px-4 py-2 text-xs font-bold rounded-lg border transition ${
                    requireDocument
                      ? 'bg-kits-red text-white border-kits-red'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Yes, Required
                </button>
                <button
                  type="button"
                  onClick={() => setRequireDocument(false)}
                  className={`px-4 py-2 text-xs font-bold rounded-lg border transition ${
                    !requireDocument
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  No Document Required
                </button>
              </div>
            </div>

            {requireDocument && (
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Configured Documents ({documents.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddDocument}
                    className="inline-flex items-center text-xs font-bold text-kits-red hover:text-red-800 transition gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" /> + Add Document
                  </button>
                </div>

                <div className="space-y-3">
                  {documents.map((doc, idx) => (
                    <div key={doc.id} className="bg-white p-3.5 rounded-lg border border-gray-200 shadow-sm space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                          Document #{idx + 1}
                        </span>
                        {documents.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveDocument(doc.id)}
                            className="text-red-600 hover:text-red-800 transition p-1"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase">Document Name *</label>
                          <input
                            type="text"
                            required
                            value={doc.name}
                            onChange={(e) => handleDocumentChange(doc.id, 'name', e.target.value)}
                            className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase">Submission Guidance</label>
                          <input
                            type="text"
                            value={doc.description}
                            onChange={(e) => handleDocumentChange(doc.id, 'description', e.target.value)}
                            className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 5: Coordinators */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
              <UserCheck className="h-4 w-4 text-kits-red" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-kits-blue">
                5. Coordinator Assignments
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Faculty Coordinator */}
              <div className="bg-gray-50/80 p-4 rounded-xl border border-gray-200 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-kits-red" />
                  Faculty Coordinator
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase">Coordinator Name</label>
                  <input
                    type="text"
                    value={facultyCoordinator.name}
                    onChange={(e) => setFacultyCoordinator({ ...facultyCoordinator, name: e.target.value })}
                    className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase">Mobile Number</label>
                  <input
                    type="tel"
                    value={facultyCoordinator.mobile}
                    onChange={(e) => setFacultyCoordinator({ ...facultyCoordinator, mobile: e.target.value })}
                    className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-200">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 uppercase">Username</label>
                    <input
                      type="text"
                      value={facultyCoordinator.username}
                      onChange={(e) => setFacultyCoordinator({ ...facultyCoordinator, username: e.target.value })}
                      className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 uppercase">New Password</label>
                    <PasswordInput
                      value={facultyCoordinator.password}
                      onChange={(e) => setFacultyCoordinator({ ...facultyCoordinator, password: e.target.value })}
                      placeholder="Leave blank to keep"
                      autoComplete="new-password"
                      className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red"
                    />
                    <p className="text-[10px] text-gray-500 mt-1 font-medium">Leave blank to keep existing password</p>
                  </div>
                </div>
              </div>

              {/* Student Coordinator */}
              <div className="bg-gray-50/80 p-4 rounded-xl border border-gray-200 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-kits-blue" />
                  Student Coordinator
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase">Coordinator Name</label>
                  <input
                    type="text"
                    value={studentCoordinator.name}
                    onChange={(e) => setStudentCoordinator({ ...studentCoordinator, name: e.target.value })}
                    className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase">Mobile Number</label>
                  <input
                    type="tel"
                    value={studentCoordinator.mobile}
                    onChange={(e) => setStudentCoordinator({ ...studentCoordinator, mobile: e.target.value })}
                    className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-200">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 uppercase">Username</label>
                    <input
                      type="text"
                      value={studentCoordinator.username}
                      onChange={(e) => setStudentCoordinator({ ...studentCoordinator, username: e.target.value })}
                      className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-kits-blue focus:ring-1 focus:ring-kits-blue font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 uppercase">New Password</label>
                    <PasswordInput
                      value={studentCoordinator.password}
                      onChange={(e) => setStudentCoordinator({ ...studentCoordinator, password: e.target.value })}
                      placeholder="Leave blank to keep"
                      autoComplete="new-password"
                      className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                    />
                    <p className="text-[10px] text-gray-500 mt-1 font-medium">Leave blank to keep existing password</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 6: Schedule & Venue */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
              <Clock className="h-4 w-4 text-kits-red" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-kits-blue">
                6. Schedule & Logistics
              </h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <DateTimePicker
                  id="start_time"
                  label="Start Date & Time"
                  value={startTime}
                  onChange={(iso) => setStartTime(iso)}
                  placeholder="DD-MM-YYYY  hh:mm AM/PM"
                />
              </div>

              <div>
                <DateTimePicker
                  id="end_time"
                  label="End Date & Time"
                  value={endTime}
                  onChange={(iso) => setEndTime(iso)}
                  placeholder="DD-MM-YYYY  hh:mm AM/PM"
                />
              </div>

              <div>
                <label htmlFor="venue" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Venue / Lab Location
                </label>
                <input
                  type="text"
                  name="venue"
                  id="venue"
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                />
              </div>

              <div>
                <label htmlFor="status" className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'ARCHIVED')}
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-sm focus:border-kits-red focus:ring-1 focus:ring-kits-red transition"
                >
                  <option value="ACTIVE">ACTIVE (Open for Registration)</option>
                  <option value="ARCHIVED">ARCHIVED (Closed / Draft)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Form Action Buttons */}
          <div className="border-t border-gray-200 pt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 sm:gap-3 w-full">
            <Link
              to={backLink}
              className="btn-secondary w-full sm:w-auto px-4 py-2.5 text-sm font-semibold text-center"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-liquid btn-primary-red w-full sm:w-auto px-6 py-2.5 text-sm font-bold shadow-2xs text-center"
            >
              <span className="btn-content">
                <Save className="h-4 w-4" />
                <span>{isSubmitting ? 'Saving Changes...' : 'Save Sub-event Changes'}</span>
              </span>
            </button>
          </div>
        </form>
      </div>

      <ResumeDraftModal
        isOpen={hasExistingDraft}
        title={draft?.title || (name ? `Sub-event: ${name}` : 'Edit Sub-event Draft')}
        subtitle={category ? `Category: ${category.name}` : (event ? `Event: ${event.name}` : undefined)}
        lastSavedAt={lastSavedAt || draft?.updated_at}
        onResume={handleResumeDraft}
        onStartNew={startNew}
        onDelete={discardDraft}
      />
    </div>
  );
}
