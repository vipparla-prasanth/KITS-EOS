import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { useScrollLock } from '@kits-eos/shared';
import type { SubEvent, Event, Category, RequiredDocumentConfig } from '@kits-eos/shared/src/types/models';
import { 
  resolveEffectiveSubEventStatus, 
  isSubEventRegistrationAvailable,
  getLifecycleBadgeTheme 
} from '@kits-eos/shared';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { NotFound } from './NotFound';
import { 
  MapPin, 
  Users, 
  User, 
  IndianRupee, 
  FileText, 
  ArrowLeft, 
  Phone, 
  UserCheck, 
  GraduationCap,
  Sparkles,
  CheckCircle2,
  X,
  Info,
  Clock
} from 'lucide-react';
import { resolveEventBannerUrl } from '../utils/imageUtils';

interface PublicCoordinator {
  assignment_id: string;
  coordinator_id: string;
  display_name: string;
  phone_number: string | null;
  coordinator_type: 'FACULTY' | 'STUDENT' | string;
  contact_visible: boolean;
}

export function SubEventDetails() {
  const { eventId, categoryId, subEventId } = useParams<{ eventId: string; categoryId?: string; subEventId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [subEvent, setSubEvent] = useState<SubEvent | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [coordinators, setCoordinators] = useState<PublicCoordinator[]>([]);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [now, setNow] = useState<number>(Date.now());

  // Periodic automatic lifecycle refresh
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const loadSubEventData = async () => {
    if (!subEventId || !eventId) return;

    try {
      setIsLoading(true);
      setError(null);
      setIsNotFound(false);

      const [subRes, evRes] = await Promise.all([
        supabase.from('sub_events').select('*').eq('id', subEventId).maybeSingle(),
        supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
      ]);

      if (subRes.error) {
        if (subRes.error.code === '22P02' || subRes.error.code === 'PGRST116') {
          setIsNotFound(true);
          return;
        }
        throw subRes.error;
      }
      if (evRes.error) {
        if (evRes.error.code === '22P02' || evRes.error.code === 'PGRST116') {
          setIsNotFound(true);
          return;
        }
        throw evRes.error;
      }

      if (!subRes.data || !evRes.data) {
        setIsNotFound(true);
        return;
      }

      let catRes: any = null;
      if (categoryId) {
        catRes = await supabase.from('categories').select('*').eq('id', categoryId).maybeSingle();
      }

      setSubEvent(subRes.data as SubEvent);
      setEvent(evRes.data as Event);
      if (catRes?.data) setCategory(catRes.data as Category);

        // Fetch coordinators via dedicated RPC first
        const { data: rpcData, error: rpcErr } = await supabase.rpc('get_sub_event_coordinators', {
          p_sub_event_id: subEventId
        });

        if (!rpcErr && Array.isArray(rpcData)) {
          setCoordinators(rpcData);
        } else {
          // Direct fallback query
          const coordRes = await supabase.from('coordinator_assignments').select(`
            id,
            coordinator_id,
            sub_event_id,
            coordinators (
              id,
              display_name,
              phone_number,
              contact_visible,
              coordinator_type
            )
          `).eq('sub_event_id', subEventId);

          if (coordRes.data) {
            const mapped: PublicCoordinator[] = (coordRes.data as any[])
              .filter((c: any) => c.coordinators)
              .map((c: any) => ({
                assignment_id: c.id,
                coordinator_id: c.coordinator_id,
                display_name: c.coordinators.display_name,
                phone_number: c.coordinators.phone_number,
                coordinator_type: c.coordinators.coordinator_type || 'FACULTY',
                contact_visible: c.coordinators.contact_visible ?? true,
              }));
            setCoordinators(mapped);
          }
        }

        // Check if current student is already registered
        if (user) {
          const { data: regData } = await supabase
            .from('registrations')
            .select('id, status')
            .eq('sub_event_id', subEventId)
            .eq('leader_id', user.id)
            .neq('status', 'CANCELLED')
            .maybeSingle();

          if (regData) {
            setAlreadyRegistered(true);
          }
        }
      } catch (err: any) {
        console.error('Failed to load sub-event:', err);
        setError(err.message || 'Sub-event not found.');
      } finally {
        setIsLoading(false);
      }
  };

  useEffect(() => {
    loadSubEventData();
  }, [eventId, subEventId, categoryId, user]);

  // Safe scroll lock and Escape key when contact coordinator modal is open
  useScrollLock(showContactModal);

  useEffect(() => {
    if (!showContactModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowContactModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showContactModal]);

  if (isLoading) return <LoadingState message="Loading sub-event details..." />;
  if (isNotFound) return <NotFound />;
  if (error || !subEvent) return <ErrorState message={error || 'Sub-event unavailable.'} onRetry={loadSubEventData} />;

  const backUrl = categoryId 
    ? `/events/${eventId}/categories/${categoryId}`
    : `/events/${eventId}`;

  const registerUrl = categoryId
    ? `/events/${eventId}/categories/${categoryId}/sub-events/${subEventId}/register`
    : `/events/${eventId}/sub-events/${subEventId}/register`;

  const requiredDocs = (subEvent.required_documents as RequiredDocumentConfig[]) || [];

  const effectiveStatus = resolveEffectiveSubEventStatus(subEvent, event, now);
  const isRegAvailable = isSubEventRegistrationAvailable(subEvent, event, now);
  const badgeTheme = getLifecycleBadgeTheme(effectiveStatus);
  const isCompleted = effectiveStatus === 'COMPLETED';
  const isOngoing = effectiveStatus === 'ONGOING';
  const isUpcoming = effectiveStatus === 'UPCOMING';

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Breadcrumb Navigation */}
      <div>
        <Link
          to={backUrl}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-kits-red transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to {category ? category.name : event?.name || 'Event'}</span>
        </Link>
      </div>

      {/* Hero Header & Banner */}
      <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden shadow-sm">
        {subEvent.banner_path && (
          <div className="h-64 sm:h-80 w-full relative overflow-hidden bg-gray-900">
            <img
              src={resolveEventBannerUrl(subEvent.banner_path) || subEvent.banner_path}
              alt={subEvent.name}
              className={`w-full h-full object-cover ${isCompleted ? 'grayscale contrast-90' : ''}`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
            <div className="absolute bottom-6 left-6 sm:left-8 right-6 text-white space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-kits-red text-white shadow">
                  Sub-Event
                </span>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider shadow border ${subEvent.is_free ? 'bg-slate-800 text-white border-slate-700' : 'bg-kits-blue text-white border-blue-500'}`}>
                  {subEvent.is_free ? 'FREE EVENT' : 'PAID EVENT'}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-white/20 text-white backdrop-blur-md">
                  {event?.name} {category && `› ${category.name}`}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-2xs ${badgeTheme.bg} ${badgeTheme.text} ${badgeTheme.border}`}
                >
                  {badgeTheme.indicatorDot && (
                    <span className={`h-1.5 w-1.5 rounded-full ${badgeTheme.indicatorDot}`} />
                  )}
                  {badgeTheme.label}
                </span>
              </div>
              <h1 className="text-2xl sm:text-4xl font-black tracking-tight">{subEvent.name}</h1>
            </div>
          </div>
        )}

        <div className="p-6 sm:p-8 space-y-6">
          {!subEvent.banner_path && (
            <div className="space-y-2 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-kits-red text-white">
                  Sub-Event
                </span>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${subEvent.is_free ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-blue-50 text-kits-blue border-blue-200'}`}>
                  {subEvent.is_free ? 'FREE EVENT' : 'PAID EVENT'}
                </span>
                <span className="text-xs text-gray-500 font-bold">
                  {event?.name} {category && `› ${category.name}`}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-2xs ${badgeTheme.bg} ${badgeTheme.text} ${badgeTheme.border}`}
                >
                  {badgeTheme.indicatorDot && (
                    <span className={`h-1.5 w-1.5 rounded-full ${badgeTheme.indicatorDot}`} />
                  )}
                  {badgeTheme.label}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-gray-900">{subEvent.name}</h1>
            </div>
          )}

          {/* Quick Summary Pill Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-200/80">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-gray-400 block mb-0.5">Participation</span>
              <span className="text-xs font-black text-gray-900 flex items-center gap-1">
                {subEvent.participation_type === 'SOLO' ? <User className="h-3.5 w-3.5 text-kits-red" /> : <Users className="h-3.5 w-3.5 text-kits-blue" />}
                {subEvent.participation_type} {subEvent.participation_type !== 'SOLO' && `(Max ${subEvent.max_team_size})`}
              </span>
            </div>

            <div>
              <span className="text-[10px] font-extrabold uppercase text-gray-400 block mb-0.5">Registration Fee</span>
              <span className="text-xs font-black text-gray-900 font-mono flex items-center gap-1">
                <IndianRupee className="h-3.5 w-3.5 text-slate-600" />
                {subEvent.is_free || (!subEvent.fee_amount_solo && !subEvent.fee_amount_team)
                  ? 'Free Entry (₹0)'
                  : (subEvent.participation_type === 'BOTH'
                      ? `₹${subEvent.fee_amount_solo} (Solo) / ₹${subEvent.fee_amount_team} (Team)`
                      : `₹${subEvent.fee_amount_solo || subEvent.fee_amount_team}`)}
              </span>
            </div>

            <div>
              <span className="text-[10px] font-extrabold uppercase text-gray-400 block mb-0.5">Schedule</span>
              <span className="text-xs font-bold text-gray-900 font-mono">
                {subEvent.start_time ? formatDateTime12h(subEvent.start_time) : 'TBA'}
              </span>
            </div>

            <div>
              <span className="text-[10px] font-extrabold uppercase text-gray-400 block mb-0.5">Venue</span>
              <span className="text-xs font-bold text-gray-900 flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-kits-red shrink-0" />
                <span className="truncate">{subEvent.venue || 'Campus Arena'}</span>
              </span>
            </div>
          </div>

          {/* Main Description */}
          {subEvent.description && (
            <div className="space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-400">Competition Overview</h3>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {subEvent.description}
              </p>
            </div>
          )}

          {/* Official Rules & Guidelines */}
          {subEvent.rules && (
            <div className="space-y-2 bg-red-50/40 p-5 rounded-2xl border border-red-100">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-kits-red flex items-center gap-1.5">
                <FileText className="h-4 w-4" />
                Official Rules & Instructions
              </h3>
              <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">
                {subEvent.rules}
              </p>
            </div>
          )}

          {/* Required Documents Notice */}
          {requiredDocs.length > 0 && (
            <div className="space-y-3 bg-blue-50/40 p-5 rounded-2xl border border-blue-100">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-kits-blue flex items-center gap-1.5">
                <FileText className="h-4 w-4" />
                Required Document Submissions ({requiredDocs.length})
              </h3>
              <p className="text-xs text-gray-600">
                You will be required to upload the following files during or after registration:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {requiredDocs.map((doc, idx) => (
                  <div key={doc.id || idx} className="bg-white p-3 rounded-xl border border-blue-200/80 shadow-2xs space-y-1">
                    <div className="text-xs font-bold text-gray-900">{doc.name}</div>
                    <div className="text-[11px] text-gray-500">{doc.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Coordinators Contact Section */}
          <div className="space-y-3 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-400">
                Event Coordinators & Contact
              </h3>
              <button
                type="button"
                onClick={() => setShowContactModal(true)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-kits-blue hover:text-blue-800 transition cursor-pointer"
              >
                <Phone className="h-3.5 w-3.5" />
                <span>Contact Coordinator</span>
              </button>
            </div>

            {coordinators.length === 0 ? (
              <div className="bg-gray-50 p-4 rounded-xl border border-dashed border-gray-200 text-xs text-gray-500 flex items-center gap-2">
                <Info className="h-4 w-4 text-gray-400 shrink-0" />
                <span>No coordinator has been assigned to this sub-event yet.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {coordinators.map((coord) => {
                  const isFaculty = (coord.coordinator_type || 'FACULTY').toUpperCase() === 'FACULTY';

                  return (
                    <div 
                      key={coord.assignment_id} 
                      className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                          isFaculty ? 'bg-blue-100 text-kits-blue' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {isFaculty ? <UserCheck className="h-5 w-5" /> : <GraduationCap className="h-5 w-5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-gray-900 truncate">{coord.display_name}</div>
                          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-extrabold">
                            {isFaculty ? 'Faculty Coordinator' : 'Student Coordinator'}
                          </div>
                        </div>
                      </div>

                      {coord.contact_visible && coord.phone_number && (
                        <a 
                          href={`tel:${coord.phone_number}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-mono font-bold text-gray-800 hover:border-kits-red hover:text-kits-red transition shrink-0"
                          title="Call Coordinator"
                        >
                          <Phone className="h-3 w-3 text-kits-red" />
                          <span>{coord.phone_number}</span>
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Registration & Contact CTA Section */}
          <div className="pt-6 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4 bg-gray-50 -mx-6 sm:-mx-8 -mb-6 sm:-mb-8 p-6 sm:p-8 rounded-b-3xl">
            <div>
              <div className="text-xs font-bold text-gray-500">Participation Type</div>
              <div className="text-base font-black text-gray-900">
                {subEvent.participation_type === 'SOLO' ? 'Individual (Solo)' : subEvent.participation_type === 'TEAM' ? `Team Entry (Max ${subEvent.max_team_size})` : 'Solo or Team Option'}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setShowContactModal(true)}
                className="btn-liquid btn-outline-blue px-5 py-3.5 text-xs sm:text-sm font-black shadow-2xs"
              >
                <span className="btn-content">
                  <Phone className="h-4 w-4" />
                  <span>Contact Coordinator</span>
                </span>
              </button>

              {alreadyRegistered ? (
                <div className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-100 text-emerald-800 font-bold text-xs sm:text-sm">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <span>You are registered</span>
                </div>
              ) : isCompleted ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gray-100 text-gray-500 border border-gray-200 text-xs sm:text-sm font-bold opacity-90 cursor-not-allowed"
                >
                  <span>Event Concluded</span>
                </button>
              ) : isRegAvailable ? (
                <button
                  type="button"
                  onClick={() => navigate(registerUrl)}
                  className="btn-liquid btn-primary-red px-7 py-3.5 text-xs sm:text-sm font-black shadow-md"
                >
                  <span className="btn-content">
                    <Sparkles className="h-4 w-4" />
                    <span>{isOngoing ? 'Register Now (Event Ongoing)' : 'Register for this Sub-Event'}</span>
                  </span>
                </button>
              ) : isOngoing ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-red-50 text-kits-red border border-red-200 text-xs sm:text-sm font-black cursor-not-allowed"
                >
                  <span className="h-2 w-2 rounded-full bg-kits-red animate-pulse" />
                  <span>Event in Progress • Registrations Closed</span>
                </button>
              ) : isUpcoming ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-blue-50 text-kits-blue border border-blue-200 text-xs sm:text-sm font-black opacity-90 cursor-not-allowed"
                >
                  <Clock className="h-4 w-4" />
                  <span>Registration Opens Soon</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 text-xs sm:text-sm font-black opacity-90 cursor-not-allowed"
                >
                  <Clock className="h-4 w-4" />
                  <span>Registrations Closed</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Clean Contact Coordinator Modal */}
      {showContactModal && createPortal(
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200 overflow-hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowContactModal(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="contact-coordinator-title"
        >
          <div 
            className="bg-white rounded-3xl border border-gray-200 shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
          >
            {/* Modal Header */}
            <div className="shrink-0 bg-gradient-to-r from-gray-900 to-gray-800 px-6 py-5 flex items-center justify-between text-white">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-kits-red bg-red-950/60 px-2 py-0.5 rounded border border-red-900/50">
                  Sub-Event Contact
                </span>
                <h3 id="contact-coordinator-title" className="text-base sm:text-lg font-black tracking-tight mt-1">
                  Contact Coordinator
                </h3>
                <p className="text-xs text-gray-300 font-medium truncate max-w-xs">
                  SUB-EVENT: {subEvent.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-gray-300 hover:text-white transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 flex-1 overflow-y-auto min-h-0">
              <div className="text-xs text-gray-500 font-medium">
                Reach out to the authorized faculty and student coordinators assigned to <strong className="text-gray-800">{subEvent.name}</strong> for queries regarding rules, schedule, or team participation.
              </div>

              {coordinators.length === 0 ? (
                <div className="p-6 rounded-2xl bg-gray-50 border border-gray-200 text-center space-y-2">
                  <Info className="h-8 w-8 text-gray-400 mx-auto" />
                  <div className="text-sm font-bold text-gray-800">No Coordinator Assigned</div>
                  <p className="text-xs text-gray-500 max-w-xs mx-auto">
                    No coordinator has been assigned to this sub-event yet. Please check back later or contact the main event helpdesk.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
                    Assigned Coordinators ({coordinators.length})
                  </div>

                  {coordinators.map((coord) => {
                    const isFaculty = (coord.coordinator_type || 'FACULTY').toUpperCase() === 'FACULTY';

                    return (
                      <div 
                        key={coord.assignment_id}
                        className="bg-gray-50 hover:bg-gray-100/80 p-4 rounded-2xl border border-gray-200 transition space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className={`h-11 w-11 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0 border ${
                              isFaculty 
                                ? 'bg-blue-50 text-kits-blue border-blue-100' 
                                : 'bg-emerald-50 text-emerald-800 border-emerald-100'
                            }`}>
                              {isFaculty ? <UserCheck className="h-6 w-6" /> : <GraduationCap className="h-6 w-6" />}
                            </div>
                            <div>
                              <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded ${
                                isFaculty ? 'bg-blue-100 text-kits-blue' : 'bg-emerald-100 text-emerald-800'
                              }`}>
                                {isFaculty ? 'Faculty Coordinator' : 'Student Coordinator'}
                              </span>
                              <h4 className="text-sm font-black text-gray-900 mt-1">
                                {coord.display_name}
                              </h4>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-gray-200/60 flex items-center justify-between text-xs">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-gray-400 block">Mobile Number</span>
                            <span className="font-mono font-bold text-gray-800">
                              {coord.phone_number || 'Not provided'}
                            </span>
                          </div>

                          {coord.contact_visible && coord.phone_number ? (
                            <a
                              href={`tel:${coord.phone_number}`}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-kits-blue text-white font-bold text-xs hover:bg-blue-800 transition shadow-2xs"
                            >
                              <Phone className="h-3.5 w-3.5" />
                              <span>Call Coordinator</span>
                            </a>
                          ) : (
                            <span className="text-[11px] text-gray-400 italic">Direct call unavailable</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="shrink-0 p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="btn-secondary px-5 py-2 text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

