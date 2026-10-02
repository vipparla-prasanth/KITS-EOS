import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import type { Event, Category, SubEvent } from '@kits-eos/shared/src/types/models';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { NotFound } from '../NotFound';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { DeleteButton } from '../../components/ui/DeleteButton';
import { 
  ArrowLeft, 
  Edit2, 
  Users, 
  Clock, 
  MapPin, 
  UserCheck, 
  FileText,
  Archive,
  RotateCcw,
  Trash2,
  ShieldAlert,
  X
} from 'lucide-react';
import { 
  resolveEffectiveSubEventStatus,
  isSubEventRegistrationAvailable,
  isMainEventRegistrationGateOpen,
  EVENT_LIFECYCLE_CONFIGS 
} from '@kits-eos/shared/src/utils/eventLifecycle';
import type { EventLifecycleStatus, StatusMode } from '@kits-eos/shared/src/types/models';

export function SubEventDetails() {
  const { eventId, categoryId, subEventId } = useParams<{ 
    eventId: string; 
    categoryId?: string; 
    subEventId: string; 
  }>();
  const navigate = useNavigate();

  const [event, setEvent] = useState<Event | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [subEvent, setSubEvent] = useState<SubEvent | null>(null);
  const [coordinators, setCoordinators] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const [isNotFound, setIsNotFound] = useState(false);

  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  async function fetchDetails() {
    if (!eventId || !subEventId) return;
    try {
      setIsLoading(true);
      setError(null);
      setIsNotFound(false);

      const [eventRes, subRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
        supabase.from('sub_events').select('*').eq('id', subEventId).maybeSingle()
      ]);

      if (eventRes.error) {
        if (eventRes.error.code === 'PGRST116' || eventRes.error.code === '22P02') {
          setIsNotFound(true);
          return;
        }
        throw eventRes.error;
      }
      if (subRes.error) {
        if (subRes.error.code === 'PGRST116' || subRes.error.code === '22P02') {
          setIsNotFound(true);
          return;
        }
        throw subRes.error;
      }

      if (!eventRes.data || !subRes.data) {
        setIsNotFound(true);
        return;
      }

      setEvent(eventRes.data as unknown as Event);
      setSubEvent(subRes.data as SubEvent);

      if (categoryId) {
        const catRes = await supabase.from('categories').select('id, name').eq('id', categoryId).maybeSingle();
        if (catRes.data) setCategory(catRes.data as unknown as Category);
      }

      // Fetch coordinators
      const { data: assignments } = await supabase
        .from('coordinator_assignments')
        .select('coordinator_id, coordinators(id, username, display_name, phone_number, coordinator_type)')
        .eq('sub_event_id', subEventId);

      if (assignments) {
        setCoordinators(assignments.map(a => a.coordinators).filter(Boolean));
      }
    } catch (err: any) {
      console.error('Failed to load sub-event details:', err);
      setError('Failed to load sub-event information.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchDetails();
  }, [eventId, categoryId, subEventId]);

  const editLink = categoryId 
    ? `/admin/events/${eventId}/categories/${categoryId}/sub-events/${subEventId}/edit`
    : `/admin/events/${eventId}/sub-events/${subEventId}/edit`;

  const backLink = categoryId 
    ? `/admin/events/${eventId}/categories/${categoryId}`
    : `/admin/events/${eventId}`;

  // SubEvent Archive Submit
  const handleArchiveSubEvent = async () => {
    if (!subEvent) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_archive_sub_event', { p_sub_event_id: subEvent.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to archive sub-event.');
      setActionSuccess('Sub-event archived successfully.');
      setTimeout(() => {
        setIsArchiveModalOpen(false);
        setActionSuccess(null);
        fetchDetails();
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to archive sub-event.');
    } finally {
      setActionLoading(false);
    }
  };

  // SubEvent Restore Submit
  const handleRestoreSubEvent = async () => {
    if (!subEvent) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_restore_sub_event', { p_sub_event_id: subEvent.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to restore sub-event.');
      setActionSuccess('Sub-event restored successfully.');
      setTimeout(() => {
        setIsRestoreModalOpen(false);
        setActionSuccess(null);
        fetchDetails();
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to restore sub-event.');
    } finally {
      setActionLoading(false);
    }
  };

  // SubEvent Delete Submit
  const handleDeleteSubEvent = async () => {
    if (!subEvent) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: fnErr } = await supabase.functions.invoke('admin-delete-sub-event', {
        body: {
          sub_event_id: subEvent.id,
          confirmation_phrase: 'CONFIRM',
        },
      });
      if (fnErr) {
        let serverError = fnErr.message;
        try {
          if (fnErr.context && typeof fnErr.context.json === 'function') {
            const errBody = await fnErr.context.json();
            if (errBody?.error) serverError = errBody.error;
            else if (errBody?.message) serverError = errBody.message;
          }
        } catch {
          // ignore parsing error
        }
        console.error('[handleDeleteSubEvent] Edge Function Error:', serverError, fnErr);
        throw new Error(serverError || 'Failed to delete sub-event.');
      }
      if (data && !data.success) {
        throw new Error(data?.error || data?.message || 'Failed to delete sub-event.');
      }

      setActionSuccess('Sub-event deleted successfully.');
      setTimeout(() => {
        setIsDeleteModalOpen(false);
        navigate(backLink);
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete sub-event.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateStatusMode = async (newMode: StatusMode) => {
    if (!subEvent) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const effective = resolveEffectiveSubEventStatus(subEvent, event, now);
      const { data, error: rpcErr } = await supabase.rpc('admin_set_sub_event_status', {
        p_sub_event_id: subEvent.id,
        p_status_mode: newMode,
        p_manual_status: newMode === 'MANUAL' ? (subEvent.manual_status || effective) : null,
      });
      if (rpcErr || (data && !data.success)) {
        throw new Error(rpcErr?.message || data?.message || 'Failed to update status mode.');
      }
      setActionSuccess(`Status mode set to ${newMode}`);
      setTimeout(() => {
        setActionSuccess(null);
        fetchDetails();
      }, 800);
    } catch (err: any) {
      setActionError(err.message || 'Failed to update status mode.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateManualStatus = async (newStatus: EventLifecycleStatus) => {
    if (!subEvent) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_set_sub_event_status', {
        p_sub_event_id: subEvent.id,
        p_status_mode: 'MANUAL',
        p_manual_status: newStatus,
      });
      if (rpcErr || (data && !data.success)) {
        throw new Error(rpcErr?.message || data?.message || 'Failed to update manual status.');
      }
      setActionSuccess(`Manual status set to ${newStatus}`);
      setTimeout(() => {
        setActionSuccess(null);
        fetchDetails();
      }, 800);
    } catch (err: any) {
      setActionError(err.message || 'Failed to update manual status.');
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading sub-event configuration..." />;
  }

  if (isNotFound) {
    return <NotFound />;
  }

  if (error || !subEvent || !event) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <Link to={backLink} className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back
        </Link>
        <ErrorState message={error || 'Sub-event unavailable.'} onRetry={fetchDetails} />
      </div>
    );
  }

  const facultyCoord = coordinators.find(c => c.coordinator_type === 'FACULTY');
  const studentCoord = coordinators.find(c => c.coordinator_type === 'STUDENT');
  const isArchived = subEvent.status === 'ARCHIVED';
  const effectiveStatus = resolveEffectiveSubEventStatus(subEvent, event, now);
  const isRegOpen = isSubEventRegistrationAvailable(subEvent, event, now);
  const isParentGateOpen = event ? isMainEventRegistrationGateOpen(event, now) : true;
  const lifecycleConfig = EVENT_LIFECYCLE_CONFIGS[effectiveStatus];

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      {/* Top Breadcrumbs & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
          <Link to="/admin/events" className="hover:text-kits-red transition">Events</Link>
          <span>/</span>
          <Link to={`/admin/events/${event.id}`} className="hover:text-kits-red transition">{event.name}</Link>
          {category && (
            <>
              <span>/</span>
              <Link to={`/admin/events/${event.id}/categories/${category.id}`} className="hover:text-kits-red transition">{category.name}</Link>
            </>
          )}
          <span>/</span>
          <span className="text-gray-900 font-bold">{subEvent.name}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(editLink)}
            className="inline-flex items-center text-xs font-bold text-gray-700 bg-white border border-gray-300 px-3.5 py-2 rounded-xl hover:bg-gray-50 transition shadow-2xs cursor-pointer"
          >
            <Edit2 className="mr-1.5 h-3.5 w-3.5 text-kits-blue" />
            <span>Edit Sub-Event</span>
          </button>

          {!isArchived ? (
            <button
              type="button"
              onClick={() => {
                setIsArchiveModalOpen(true);
                setActionError(null);
                setActionSuccess(null);
              }}
              className="inline-flex items-center text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl hover:bg-amber-100 transition shadow-2xs cursor-pointer"
            >
              <Archive className="mr-1.5 h-3.5 w-3.5" />
              <span>Archive</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setIsRestoreModalOpen(true);
                setActionError(null);
                setActionSuccess(null);
              }}
              className="inline-flex items-center text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              <span>Restore</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setIsDeleteModalOpen(true);
              setActionError(null);
              setActionSuccess(null);
            }}
            className="inline-flex items-center text-xs font-bold text-kits-red bg-red-50 border border-red-200 px-3 py-2 rounded-xl hover:bg-red-100 transition shadow-2xs cursor-pointer"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {/* Sub-event Header Card */}
      <div className="bg-white rounded-3xl shadow-2xs border border-gray-200 overflow-hidden">
        {subEvent.banner_path && (
          <div className="h-52 w-full bg-gray-100 relative overflow-hidden border-b border-gray-200">
            <img 
              src={subEvent.banner_path} 
              alt={subEvent.name} 
              className={`w-full h-full object-cover ${effectiveStatus === 'COMPLETED' ? 'grayscale contrast-90' : ''}`} 
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute top-4 right-4 flex items-center gap-2">
              <StatusBadge status={subEvent.status} />
              <span className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold border shadow-2xs ${lifecycleConfig.badgeClass}`}>
                {effectiveStatus === 'ONGOING' && (
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                )}
                {effectiveStatus}
              </span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-2xs ${isRegOpen ? 'bg-emerald-500/90 text-white border-emerald-400' : 'bg-black/60 text-gray-300 border-white/20'}`}>
                Registration: {isRegOpen ? 'OPEN' : 'CLOSED'}
              </span>
            </div>
            <div className="absolute bottom-4 left-6 text-white">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest bg-kits-red px-2.5 py-0.5 rounded-full shadow">
                  {subEvent.participation_type} Competition
                </span>
                <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full shadow border ${subEvent.is_free ? 'bg-slate-800 text-white border-slate-700' : 'bg-kits-blue text-white border-blue-500'}`}>
                  {subEvent.is_free ? 'FREE EVENT' : 'PAID EVENT'}
                </span>
              </div>
              <h1 className="text-2xl font-black tracking-tight mt-1">{subEvent.name}</h1>
            </div>
          </div>
        )}

        <div className="p-6 sm:p-8 space-y-4">
          {!subEvent.banner_path && (
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-kits-red bg-red-50 px-2 py-0.5 rounded-md border border-red-100">
                    {subEvent.participation_type} Sub-event
                  </span>
                  <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${subEvent.is_free ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-blue-50 text-kits-blue border-blue-200'}`}>
                    {subEvent.is_free ? 'FREE EVENT' : 'PAID EVENT'}
                  </span>
                </div>
                <h1 className="text-2xl font-black text-gray-900 mt-1">{subEvent.name}</h1>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={subEvent.status} />
                <span className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold border shadow-2xs ${lifecycleConfig.badgeClass}`}>
                  {effectiveStatus === 'ONGOING' && (
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  )}
                  {effectiveStatus}
                </span>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${isRegOpen ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                  Registration: {isRegOpen ? 'OPEN' : 'CLOSED'}
                </span>
              </div>
            </div>
          )}

          {/* Sub-Event Lifecycle Status Mode & Manual Override */}
          <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">Lifecycle Mode:</span>
              <div className="flex items-center bg-white border border-gray-200 rounded-lg p-0.5 shadow-2xs">
                <button
                  type="button"
                  onClick={() => handleUpdateStatusMode('AUTOMATIC')}
                  disabled={actionLoading}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wider transition cursor-pointer ${
                    subEvent.status_mode !== 'MANUAL'
                      ? 'bg-kits-blue text-white shadow-2xs'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Automatic
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateStatusMode('MANUAL')}
                  disabled={actionLoading}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wider transition cursor-pointer ${
                    subEvent.status_mode === 'MANUAL'
                      ? 'bg-amber-600 text-white shadow-2xs'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Manual
                </button>
              </div>
            </div>

            {subEvent.status_mode === 'MANUAL' && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-amber-800">Manual Status:</span>
                <select
                  value={subEvent.manual_status || effectiveStatus}
                  onChange={(e) => handleUpdateManualStatus(e.target.value as EventLifecycleStatus)}
                  disabled={actionLoading}
                  className="bg-white border border-amber-300 rounded-lg px-2.5 py-1 text-xs font-bold text-amber-900 shadow-2xs focus:ring-1 focus:ring-amber-500 cursor-pointer"
                >
                  <option value="UPCOMING">Upcoming</option>
                  <option value="REGISTRATIONS OPEN">Registrations Open</option>
                  <option value="REGISTRATIONS CLOSED">Registrations Closed</option>
                  <option value="ONGOING">Ongoing</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>
            )}
          </div>

          {!isParentGateOpen && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
              <span>
                <strong>Parent Gate Closed:</strong> The flagship event's registration gate is currently closed, so registrations for this sub-event remain closed regardless of sub-event settings.
              </span>
            </div>
          )}

          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-1">Description</h4>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-normal">
              {subEvent.description || <span className="text-gray-400 italic">No description provided.</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Information Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Participation & Fees Card */}
        <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-2xs space-y-4">
          <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
            <Users className="h-5 w-5 text-kits-red" />
            <h3 className="text-sm font-black uppercase tracking-wide text-gray-900">
              Participation & Pricing
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between items-center py-1 border-b border-gray-50">
              <span className="text-gray-500 font-bold uppercase text-[10px]">Payment Type:</span>
              <span className={`font-bold text-[10px] px-2 py-0.5 rounded-full border ${subEvent.is_free ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-blue-50 text-kits-blue border-blue-200'}`}>
                {subEvent.is_free ? 'FREE EVENT' : 'PAID EVENT'}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-50">
              <span className="text-gray-500 font-bold uppercase text-[10px]">Format:</span>
              <span className="font-extrabold text-gray-900">{subEvent.participation_type}</span>
            </div>
            {subEvent.participation_type !== 'SOLO' && (
              <div className="flex justify-between py-1 border-b border-gray-50">
                <span className="text-gray-500 font-bold uppercase text-[10px]">Max Team Size:</span>
                <span className="font-extrabold text-gray-900">{subEvent.max_team_size} Members</span>
              </div>
            )}
            {subEvent.is_free ? (
              <div className="flex justify-between py-1 border-b border-gray-50">
                <span className="text-gray-500 font-bold uppercase text-[10px]">Registration Fee:</span>
                <span className="font-bold text-slate-700">Free of Cost (₹0)</span>
              </div>
            ) : (
              <>
                {(subEvent.participation_type === 'SOLO' || subEvent.participation_type === 'BOTH') && (
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-gray-500 font-bold uppercase text-[10px]">Solo Fee:</span>
                    <span className="font-mono font-black text-gray-900">₹{subEvent.fee_amount_solo}</span>
                  </div>
                )}
                {(subEvent.participation_type === 'TEAM' || subEvent.participation_type === 'BOTH') && (
                  <div className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-gray-500 font-bold uppercase text-[10px]">Team Fee:</span>
                    <span className="font-mono font-black text-gray-900">₹{subEvent.fee_amount_team}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Schedule & Venue Card */}
        <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-2xs space-y-4">
          <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
            <Clock className="h-5 w-5 text-kits-blue" />
            <h3 className="text-sm font-black uppercase tracking-wide text-gray-900">
              Schedule & Venue
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1 border-b border-gray-50">
              <span className="text-gray-500 font-bold uppercase text-[10px]">Venue / Lab:</span>
              <span className="font-extrabold text-gray-900 flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-kits-red" />
                {subEvent.venue || 'TBA'}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-50">
              <span className="text-gray-500 font-bold uppercase text-[10px]">Start Time:</span>
              <span className="font-mono font-bold text-gray-900">{formatDateTime12h(subEvent.start_time)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-50">
              <span className="text-gray-500 font-bold uppercase text-[10px]">End Time:</span>
              <span className="font-mono font-bold text-gray-900">{formatDateTime12h(subEvent.end_time)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Coordinators Section */}
      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-2xs space-y-4">
        <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
          <UserCheck className="h-5 w-5 text-kits-blue" />
          <h3 className="text-sm font-black uppercase tracking-wide text-gray-900">
            Assigned Event Coordinators
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Faculty Coordinator */}
          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-1 text-xs">
            <span className="text-[10px] font-black uppercase tracking-wider text-kits-red">Faculty Coordinator</span>
            {facultyCoord ? (
              <div>
                <p className="font-black text-gray-900 text-sm">{facultyCoord.display_name}</p>
                <p className="text-gray-500 font-mono">@{facultyCoord.username} • {facultyCoord.phone_number || 'No phone'}</p>
              </div>
            ) : (
              <p className="text-gray-400 italic">No faculty coordinator assigned</p>
            )}
          </div>

          {/* Student Coordinator */}
          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-1 text-xs">
            <span className="text-[10px] font-black uppercase tracking-wider text-kits-blue">Student Lead</span>
            {studentCoord ? (
              <div>
                <p className="font-black text-gray-900 text-sm">{studentCoord.display_name}</p>
                <p className="text-gray-500 font-mono">@{studentCoord.username} • {studentCoord.phone_number || 'No phone'}</p>
              </div>
            ) : (
              <p className="text-gray-400 italic">No student coordinator assigned</p>
            )}
          </div>
        </div>
      </div>

      {/* Rules Section */}
      {subEvent.rules && (
        <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-2xs space-y-3">
          <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
            <FileText className="h-5 w-5 text-gray-700" />
            <h3 className="text-sm font-black uppercase tracking-wide text-gray-900">Rules & Guidelines</h3>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-normal">
            {subEvent.rules}
          </p>
        </div>
      )}

      {/* =========================================================================
          MODAL: Archive Sub-Event
          ========================================================================= */}
      {isArchiveModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Archive className="h-5 w-5 text-amber-600" />
                <h3 className="text-sm font-black uppercase text-gray-900">Archive Sub-Event</h3>
              </div>
              <button onClick={() => setIsArchiveModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-xl cursor-pointer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="p-3 bg-amber-50 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-amber-900">Target Sub-Event:</p>
              <p className="font-black text-gray-900 text-sm">{subEvent.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Archiving hides this sub-event from student discovery while retaining all existing registrations and tokens.
            </p>
            {actionError && <div className="p-3 bg-red-50 text-xs text-red-700 rounded-xl">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-bold rounded-xl">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setIsArchiveModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <button onClick={handleArchiveSubEvent} disabled={actionLoading} className="px-5 py-2.5 rounded-xl bg-amber-600 text-white text-xs font-black uppercase tracking-wider hover:bg-amber-700 cursor-pointer">
                {actionLoading ? 'Archiving...' : 'Archive Sub-Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Restore Sub-Event
          ========================================================================= */}
      {isRestoreModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black uppercase text-gray-900">Restore Sub-Event</h3>
              </div>
              <button onClick={() => setIsRestoreModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-xl cursor-pointer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="p-3 bg-emerald-50 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-emerald-900">Restoring Sub-Event:</p>
              <p className="font-black text-gray-900 text-sm">{subEvent.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Restoring this sub-event makes it active again for student registrations.
            </p>
            {actionError && <div className="p-3 bg-red-50 text-xs text-red-700 rounded-xl">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-bold rounded-xl">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setIsRestoreModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <button onClick={handleRestoreSubEvent} disabled={actionLoading} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 cursor-pointer">
                {actionLoading ? 'Restoring...' : 'Restore Sub-Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Delete Sub-Event
          ========================================================================= */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-red-200 modal-dialog-animate">
            <div className="flex items-center gap-2.5 text-kits-red border-b border-red-100 pb-3">
              <ShieldAlert className="h-5 w-5" />
              <h3 className="text-sm font-black uppercase text-red-900">Delete Sub-Event</h3>
            </div>
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-red-900">Target Sub-Event:</p>
              <p className="font-black text-gray-900 text-sm">{subEvent.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed font-normal">
              Permanently deleting this sub-event will remove it and all associated registrations, teams, attendance logs, certificates, and uploaded assets from the database and storage.
              <strong className="block text-red-700 pt-1">⚠️ This action is irreversible and cannot be undone.</strong>
            </p>
            {actionError && <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-bold rounded-xl">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setIsDeleteModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <DeleteButton
                onClick={handleDeleteSubEvent}
                disabled={actionLoading}
                loading={actionLoading}
                className="px-5 py-2.5 rounded-xl"
                label="Delete Sub-Event"
                loadingLabel="Deleting..."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
