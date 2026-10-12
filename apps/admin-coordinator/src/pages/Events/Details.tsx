import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase, invokeAdminEdgeFunction } from '@kits-eos/shared/src/api/client';
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
  Calendar, 
  Clock, 
  Layers, 
  Plus, 
  FolderPlus, 
  Tag, 
  ArrowRight,
  Archive,
  RotateCcw,
  Trash2,
  ShieldAlert,
  X,
  ArchiveRestore
} from 'lucide-react';
import { 
  resolveEffectiveEventStatus, 
  resolveEffectiveSubEventStatus,
  isMainEventRegistrationGateOpen,
  isSubEventRegistrationAvailable,
  EVENT_LIFECYCLE_CONFIGS 
} from '@kits-eos/shared/src/utils/eventLifecycle';
import type { EventLifecycleStatus, StatusMode } from '@kits-eos/shared/src/types/models';


interface HistoricalImpactData {
  scope: string;
  entity_id: string;
  entity_name: string;
  confirmation_phrase: string;
  categories_count: number;
  sub_events_count: number;
  registrations_count: number;
  teams_count: number;
  team_members_count: number;
  attendance_count: number;
  payments_count: number;
  feedback_count: number;
  certificates_count: number;
}

export function EventDetails() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [directSubEvents, setDirectSubEvents] = useState<SubEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Modals for Event Lifecycle
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteTypedPhrase, setDeleteTypedPhrase] = useState('');
  const [impactData, setImpactData] = useState<HistoricalImpactData | null>(null);
  const [isLoadingImpact, setIsLoadingImpact] = useState(false);

  // Modals for Category Archive / Restore / Delete
  const [archiveCategoryItem, setArchiveCategoryItem] = useState<Category | null>(null);
  const [restoreCategoryItem, setRestoreCategoryItem] = useState<Category | null>(null);
  const [deleteCategoryItem, setDeleteCategoryItem] = useState<Category | null>(null);

  // Modals for SubEvent Archive / Restore / Delete
  const [archiveSubEventItem, setArchiveSubEventItem] = useState<SubEvent | null>(null);
  const [restoreSubEventItem, setRestoreSubEventItem] = useState<SubEvent | null>(null);
  const [deleteSubEventItem, setDeleteSubEventItem] = useState<SubEvent | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  async function fetchEventDetails() {
    if (!eventId) return;
    try {
      setIsLoading(true);
      setError(null);
      setIsNotFound(false);

      const [eventResponse, categoriesResponse, subEventsResponse] = await Promise.all([
        supabase
          .from('events')
          .select('*')
          .eq('id', eventId)
          .maybeSingle(),
        supabase
          .from('categories')
          .select('*')
          .eq('event_id', eventId)
          .neq('status', 'PERMANENTLY_DELETED')
          .order('name', { ascending: true }),
        supabase
          .from('sub_events')
          .select('*')
          .eq('event_id', eventId)
          .neq('status', 'PERMANENTLY_DELETED')
          .order('name', { ascending: true })
      ]);

      if (eventResponse.error) {
        if (eventResponse.error.code === 'PGRST116' || eventResponse.error.code === '22P02') {
          setIsNotFound(true);
          return;
        } else {
          throw eventResponse.error;
        }
      } else if (eventResponse.data) {
        setEvent(eventResponse.data);
      } else {
        setIsNotFound(true);
        return;
      }

      if (categoriesResponse.data) {
        setCategories(categoriesResponse.data);
      }

      if (subEventsResponse.data) {
        setDirectSubEvents(subEventsResponse.data);
      }
    } catch (err: any) {
      console.error('Failed to fetch event details:', err);
      setError('An unexpected error occurred while loading the event details.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchEventDetails();
  }, [eventId]);

  // Event Archive Submit
  const handleArchiveEvent = async () => {
    if (!event) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_archive_event', { p_event_id: event.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to archive event.');
      setActionSuccess('Event archived successfully.');
      setTimeout(() => {
        setIsArchiveModalOpen(false);
        setActionSuccess(null);
        fetchEventDetails();
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to archive event.');
    } finally {
      setActionLoading(false);
    }
  };

  // Event Restore Submit
  const handleRestoreEvent = async () => {
    if (!event) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_restore_event', { p_event_id: event.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to restore event.');
      setActionSuccess('Event restored successfully.');
      setTimeout(() => {
        setIsRestoreModalOpen(false);
        setActionSuccess(null);
        fetchEventDetails();
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to restore event.');
    } finally {
      setActionLoading(false);
    }
  };

  // Open Delete Modal and calculate live impact
  const handleOpenDeleteEventModal = async () => {
    if (!event) return;
    setIsDeleteModalOpen(true);
    setDeleteTypedPhrase('');
    setActionError(null);
    setActionSuccess(null);
    setIsLoadingImpact(true);

    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_calculate_historical_deletion_impact', {
        p_scope: 'EVENT',
        p_entity_id: event.id,
      });
      if (rpcErr) throw rpcErr;
      setImpactData(data as HistoricalImpactData);
    } catch (err: any) {
      console.error('Failed to calculate impact for event:', err);
      setActionError(err.message || 'Failed to calculate historical deletion impact.');
    } finally {
      setIsLoadingImpact(false);
    }
  };

  // Event Delete Submit
  const handleDeleteEvent = async () => {
    if (!event || !impactData) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: fnErr } = await invokeAdminEdgeFunction('admin-delete-historical-data', {
        body: {
          scope: 'EVENT',
          entity_id: event.id,
          confirmation_phrase: 'CONFIRM',
        },
      });
      if (fnErr || (data && !data.success)) {
        throw new Error(fnErr?.message || data?.error || data?.message || 'Failed to delete event.');
      }

      setActionSuccess('Event and all historical operational records permanently deleted.');
      setTimeout(() => {
        setIsDeleteModalOpen(false);
        navigate('/admin/events');
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete event.');
    } finally {
      setActionLoading(false);
    }
  };

  // Category Delete Submit
  const handleDeleteCategory = async () => {
    if (!deleteCategoryItem) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_delete_category', { p_category_id: deleteCategoryItem.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to delete category.');
      setActionSuccess('Category deleted successfully.');
      setTimeout(() => {
        setDeleteCategoryItem(null);
        setActionSuccess(null);
        fetchEventDetails();
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete category.');
    } finally {
      setActionLoading(false);
    }
  };

  // SubEvent Delete Submit
  const handleDeleteSubEvent = async () => {
    if (!deleteSubEventItem) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: fnErr } = await invokeAdminEdgeFunction('admin-delete-sub-event', {
        body: {
          sub_event_id: deleteSubEventItem.id,
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
        setDeleteSubEventItem(null);
        setActionSuccess(null);
        fetchEventDetails();
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete sub-event.');
    } finally {
      setActionLoading(false);
    }
  };

  // Main Event Status Mode & Manual Status Handlers
  const handleUpdateEventStatusMode = async (newMode: StatusMode) => {
    if (!event) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const effective = resolveEffectiveEventStatus(event, now);
      const { data, error: rpcErr } = await supabase.rpc('admin_set_event_status', {
        p_event_id: event.id,
        p_status_mode: newMode,
        p_manual_status: newMode === 'MANUAL' ? (event.manual_status || effective) : null,
      });
      if (rpcErr || (data && !data.success)) {
        throw new Error(rpcErr?.message || data?.message || 'Failed to update event status mode.');
      }
      setActionSuccess(`Status mode set to ${newMode}`);
      setTimeout(() => {
        setActionSuccess(null);
        fetchEventDetails();
      }, 800);
    } catch (err: any) {
      setActionError(err.message || 'Failed to update status mode.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateEventManualStatus = async (newStatus: EventLifecycleStatus) => {
    if (!event) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_set_event_status', {
        p_event_id: event.id,
        p_status_mode: 'MANUAL',
        p_manual_status: newStatus,
      });
      if (rpcErr || (data && !data.success)) {
        throw new Error(rpcErr?.message || data?.message || 'Failed to update manual status.');
      }
      setActionSuccess(`Manual status set to ${newStatus}`);
      setTimeout(() => {
        setActionSuccess(null);
        fetchEventDetails();
      }, 800);
    } catch (err: any) {
      setActionError(err.message || 'Failed to update manual status.');
    } finally {
      setActionLoading(false);
    }
  };

  // Category Archive / Restore Handlers
  const handleArchiveCategory = async () => {
    if (!archiveCategoryItem) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_archive_category', { p_category_id: archiveCategoryItem.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to archive category.');
      setActionSuccess('Category archived successfully.');
      setTimeout(() => {
        setArchiveCategoryItem(null);
        setActionSuccess(null);
        fetchEventDetails();
      }, 1000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to archive category.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestoreCategory = async () => {
    if (!restoreCategoryItem) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_restore_category', { p_category_id: restoreCategoryItem.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to restore category.');
      setActionSuccess('Category restored successfully.');
      setTimeout(() => {
        setRestoreCategoryItem(null);
        setActionSuccess(null);
        fetchEventDetails();
      }, 1000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to restore category.');
    } finally {
      setActionLoading(false);
    }
  };

  // Sub-Event Status Mode & Manual Status Handlers
  const handleUpdateSubEventStatusMode = async (sub: SubEvent, newMode: StatusMode, currentEffective: EventLifecycleStatus) => {
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_set_sub_event_status', {
        p_sub_event_id: sub.id,
        p_status_mode: newMode,
        p_manual_status: newMode === 'MANUAL' ? (sub.manual_status || currentEffective) : null,
      });
      if (rpcErr || (data && !data.success)) {
        throw new Error(rpcErr?.message || data?.message || 'Failed to update sub-event status mode.');
      }
      fetchEventDetails();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update sub-event status mode.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateSubEventManualStatus = async (subId: string, newStatus: EventLifecycleStatus) => {
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_set_sub_event_status', {
        p_sub_event_id: subId,
        p_status_mode: 'MANUAL',
        p_manual_status: newStatus,
      });
      if (rpcErr || (data && !data.success)) {
        throw new Error(rpcErr?.message || data?.message || 'Failed to update sub-event manual status.');
      }
      fetchEventDetails();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update sub-event manual status.');
    } finally {
      setActionLoading(false);
    }
  };

  // Sub-Event Archive / Restore Handlers
  const handleArchiveSubEvent = async () => {
    if (!archiveSubEventItem) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_archive_sub_event', { p_sub_event_id: archiveSubEventItem.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to archive sub-event.');
      setActionSuccess('Sub-event archived successfully.');
      setTimeout(() => {
        setArchiveSubEventItem(null);
        setActionSuccess(null);
        fetchEventDetails();
      }, 1000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to archive sub-event.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestoreSubEvent = async () => {
    if (!restoreSubEventItem) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_restore_sub_event', { p_sub_event_id: restoreSubEventItem.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to restore sub-event.');
      setActionSuccess('Sub-event restored successfully.');
      setTimeout(() => {
        setRestoreSubEventItem(null);
        setActionSuccess(null);
        fetchEventDetails();
      }, 1000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to restore sub-event.');
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading event details..." />;
  }

  if (isNotFound) {
    return <NotFound />;
  }

  if (error || !event) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <Link to="/admin/events" className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to Events
        </Link>
        <ErrorState message={error || 'Event unavailable.'} onRetry={fetchEventDetails} />
      </div>
    );
  }

  const isArchived = event.status === 'ARCHIVED';
  const effectiveEventStatus = resolveEffectiveEventStatus(event, now);
  const eventLifecycleConfig = EVENT_LIFECYCLE_CONFIGS[effectiveEventStatus];

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      {/* Top Breadcrumb and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Link to="/admin/events" className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red transition">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to Events List
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/admin/events/${event.id}/edit`)}
            className="inline-flex items-center text-xs font-bold text-gray-700 bg-white border border-gray-300 px-3 py-1.5 rounded-xl hover:bg-gray-50 transition shadow-2xs cursor-pointer"
          >
            <Edit2 className="mr-1.5 h-3.5 w-3.5 text-kits-blue" />
            <span>Edit Event</span>
          </button>

          {!isArchived ? (
            <button
              type="button"
              onClick={() => {
                setIsArchiveModalOpen(true);
                setActionError(null);
                setActionSuccess(null);
              }}
              className="inline-flex items-center text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl hover:bg-amber-100 transition shadow-2xs cursor-pointer"
            >
              <Archive className="mr-1.5 h-3.5 w-3.5" />
              <span>Archive Event</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setIsRestoreModalOpen(true);
                  setActionError(null);
                  setActionSuccess(null);
                }}
                className="inline-flex items-center text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                <span>Restore Event</span>
              </button>

              <button
                type="button"
                onClick={handleOpenDeleteEventModal}
                className="inline-flex items-center text-xs font-bold text-kits-red bg-red-50 border border-red-200 px-3 py-1.5 rounded-xl hover:bg-red-100 transition shadow-2xs cursor-pointer"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                <span>Permanently Delete</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Event Card */}
      <div className="bg-white rounded-3xl shadow-2xs border border-gray-200 overflow-hidden">
        {event.banner_path && (
          <div className="h-44 sm:h-56 w-full relative bg-gray-100 overflow-hidden border-b border-gray-200">
            <img
              src={event.banner_path}
              alt={event.name}
              className={`w-full h-full object-cover ${effectiveEventStatus === 'COMPLETED' ? 'grayscale contrast-90' : ''}`}
            />
          </div>
        )}

        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                <StatusBadge status={event.status} />
                <span className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold border shadow-2xs ${eventLifecycleConfig.badgeClass}`}>
                  {effectiveEventStatus === 'ONGOING' && (
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  )}
                  {effectiveEventStatus}
                </span>
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${isMainEventRegistrationGateOpen(event, now) ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                  Gate: {isMainEventRegistrationGateOpen(event, now) ? 'OPEN' : 'CLOSED'}
                </span>
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">
                  Flagship Event
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
                {event.name}
              </h1>
            </div>

            <div className="flex items-center gap-4 text-xs text-gray-600 bg-gray-50 p-3 rounded-2xl border border-gray-200 shrink-0">
              <div className="flex items-center gap-2 font-mono">
                <Calendar className="h-4 w-4 text-kits-red" />
                <span>{formatDateTime12h(event.start_date)}</span>
              </div>
              <span className="text-gray-300">→</span>
              <div className="flex items-center gap-2 font-mono">
                <Clock className="h-4 w-4 text-kits-blue" />
                <span>{formatDateTime12h(event.end_date)}</span>
              </div>
            </div>
          </div>

          {/* Status Mode & Manual Override Selector */}
          <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">Lifecycle Mode:</span>
              <div className="flex items-center bg-white border border-gray-200 rounded-lg p-0.5 shadow-2xs">
                <button
                  type="button"
                  onClick={() => handleUpdateEventStatusMode('AUTOMATIC')}
                  disabled={actionLoading}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wider transition cursor-pointer ${
                    event.status_mode !== 'MANUAL'
                      ? 'bg-kits-blue text-white shadow-2xs'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Automatic
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateEventStatusMode('MANUAL')}
                  disabled={actionLoading}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wider transition cursor-pointer ${
                    event.status_mode === 'MANUAL'
                      ? 'bg-amber-600 text-white shadow-2xs'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Manual
                </button>
              </div>
            </div>

            {event.status_mode === 'MANUAL' && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-amber-800">Manual Status:</span>
                <select
                  value={event.manual_status || effectiveEventStatus}
                  onChange={(e) => handleUpdateEventManualStatus(e.target.value as EventLifecycleStatus)}
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

          {event.description && (
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-1">
                Event Overview
              </h3>
              <p className="text-sm text-gray-700 leading-relaxed font-normal">
                {event.description}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Categories Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-kits-blue" />
            <h2 className="text-lg font-black text-gray-900 tracking-tight">
              Event Categories ({categories.length})
            </h2>
          </div>

          <Link
            to={`/admin/events/${event.id}/categories/new`}
            className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-white bg-kits-blue hover:bg-blue-800 px-3.5 py-2 rounded-xl transition shadow-2xs cursor-pointer"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>Add Category</span>
          </Link>
        </div>

        {categories.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center space-y-3">
            <Layers className="h-8 w-8 text-gray-300 mx-auto" />
            <div className="text-sm font-bold text-gray-700">No categories created yet</div>
            <p className="text-xs text-gray-400 max-w-sm mx-auto">
              Categories allow you to organize departmental symposium tracks or sub-events under this flagship event.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs hover:border-gray-300 transition space-y-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-kits-blue border border-blue-100">
                      Category
                    </span>
                    <StatusBadge status={cat.status} />
                  </div>
                  <h3 className="text-base font-black text-gray-900 tracking-tight">{cat.name}</h3>
                  {cat.description && (
                    <p className="text-xs text-gray-500 line-clamp-2 mt-1">{cat.description}</p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/events/${event.id}/categories/${cat.id}`)}
                    className="inline-flex items-center gap-1 text-xs font-bold text-kits-blue hover:text-blue-800 transition cursor-pointer"
                  >
                    <span>View Track</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/events/${event.id}/categories/${cat.id}/edit`)}
                      className="p-1.5 text-gray-500 hover:text-kits-blue hover:bg-blue-50 rounded-lg transition cursor-pointer"
                      title="Edit Category"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>

                    {cat.status === 'ARCHIVED' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRestoreCategoryItem(cat);
                          setActionError(null);
                          setActionSuccess(null);
                        }}
                        className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition cursor-pointer"
                        title="Restore Category"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setArchiveCategoryItem(cat);
                          setActionError(null);
                          setActionSuccess(null);
                        }}
                        className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-lg transition cursor-pointer"
                        title="Archive Category"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setDeleteCategoryItem(cat);
                        setActionError(null);
                        setActionSuccess(null);
                      }}
                      className="p-1.5 text-gray-500 hover:text-kits-red hover:bg-red-50 rounded-lg transition cursor-pointer"
                      title="Delete Category"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Direct Sub-Events Section */}
      <div className="space-y-4 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-kits-red" />
            <h2 className="text-lg font-black text-gray-900 tracking-tight">
              Direct Sub-Events ({directSubEvents.length})
            </h2>
          </div>

          <Link
            to={`/admin/events/${event.id}/sub-events/new`}
            className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-white bg-kits-red hover:bg-red-700 px-3.5 py-2 rounded-xl transition shadow-2xs cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Sub-Event</span>
          </Link>
        </div>

        {directSubEvents.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center space-y-3">
            <Tag className="h-8 w-8 text-gray-300 mx-auto" />
            <div className="text-sm font-bold text-gray-700">No direct sub-events created</div>
            <p className="text-xs text-gray-400 max-w-sm mx-auto">
              Sub-events can be added directly to this event or organized within category tracks above.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {directSubEvents.map((sub) => {
              const effectiveSubStatus = resolveEffectiveSubEventStatus(sub, event, now);
              const subConfig = EVENT_LIFECYCLE_CONFIGS[effectiveSubStatus];
              const isRegOpen = isSubEventRegistrationAvailable(sub, event, now);

              return (
                <div
                  key={sub.id}
                  className="bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs hover:border-gray-300 transition space-y-4 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-red-50 text-kits-red border border-red-100">
                        Direct Sub-Event
                      </span>
                      <StatusBadge status={sub.status} />
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${subConfig.badgeClass}`}>
                        {effectiveSubStatus === 'ONGOING' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                        {effectiveSubStatus}
                      </span>
                      {!isRegOpen && effectiveSubStatus !== 'COMPLETED' && effectiveSubStatus !== 'REGISTRATIONS CLOSED' && (
                        <span className="inline-flex items-center text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md border border-gray-200">
                          Regs Closed
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-black text-gray-900 tracking-tight">{sub.name}</h3>
                    {sub.description && (
                      <p className="text-xs text-gray-500 line-clamp-2 mt-1">{sub.description}</p>
                    )}
                  </div>

                  {/* Sub-Event Status Mode controls */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-gray-50 rounded-xl border border-gray-100 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-black uppercase text-gray-400">Mode:</span>
                      <select
                        value={sub.status_mode || 'AUTOMATIC'}
                        onChange={(e) => handleUpdateSubEventStatusMode(sub, e.target.value as StatusMode, effectiveSubStatus)}
                        disabled={actionLoading}
                        className="text-[11px] font-semibold bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 cursor-pointer"
                      >
                        <option value="AUTOMATIC">Auto</option>
                        <option value="MANUAL">Manual</option>
                      </select>
                    </div>
                    {sub.status_mode === 'MANUAL' && (
                      <div className="flex items-center gap-1">
                        <select
                          value={sub.manual_status || effectiveSubStatus}
                          onChange={(e) => handleUpdateSubEventManualStatus(sub.id, e.target.value as EventLifecycleStatus)}
                          disabled={actionLoading}
                          className="text-[11px] font-bold bg-amber-50 border border-amber-300 rounded px-1.5 py-0.5 text-amber-900 cursor-pointer"
                        >
                          <option value="UPCOMING">Upcoming</option>
                          <option value="REGISTRATIONS OPEN">Regs Open</option>
                          <option value="REGISTRATIONS CLOSED">Regs Closed</option>
                          <option value="ONGOING">Ongoing</option>
                          <option value="COMPLETED">Completed</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/events/${event.id}/sub-events/${sub.id}`)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-kits-red hover:text-red-700 transition cursor-pointer"
                    >
                      <span>View Details</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/events/${event.id}/sub-events/${sub.id}/edit`)}
                        className="p-1.5 text-gray-500 hover:text-kits-blue hover:bg-blue-50 rounded-lg transition cursor-pointer"
                        title="Edit Sub-Event"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>

                      {sub.status === 'ARCHIVED' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRestoreSubEventItem(sub);
                            setActionError(null);
                            setActionSuccess(null);
                          }}
                          className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition cursor-pointer"
                          title="Restore Sub-Event"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setArchiveSubEventItem(sub);
                            setActionError(null);
                            setActionSuccess(null);
                          }}
                          className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-lg transition cursor-pointer"
                          title="Archive Sub-Event"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setDeleteSubEventItem(sub);
                          setActionError(null);
                          setActionSuccess(null);
                        }}
                        className="p-1.5 text-gray-500 hover:text-kits-red hover:bg-red-50 rounded-lg transition cursor-pointer"
                        title="Delete Sub-Event"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* =========================================================================
          MODAL: Archive Event
          ========================================================================= */}
      {isArchiveModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
                  <Archive className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-black uppercase text-gray-900">Archive Event</h3>
              </div>
              <button onClick={() => setIsArchiveModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-xl cursor-pointer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-amber-900">Target Event:</p>
              <p className="font-black text-gray-900 text-sm">{event.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Archiving this event will remove it from active lists and public discovery. All participant records and registrations remain preserved.
            </p>
            {actionError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setIsArchiveModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <button onClick={handleArchiveEvent} disabled={actionLoading} className="px-5 py-2.5 rounded-xl bg-amber-600 text-white text-xs font-black uppercase tracking-wider hover:bg-amber-700 transition cursor-pointer">
                {actionLoading ? 'Archiving...' : 'Archive Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Restore Event
          ========================================================================= */}
      {isRestoreModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                  <ArchiveRestore className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-black uppercase text-gray-900">Restore Event</h3>
              </div>
              <button onClick={() => setIsRestoreModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-xl cursor-pointer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-emerald-900">Restoring Event:</p>
              <p className="font-black text-gray-900 text-sm">{event.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Restoring this event will return it to Active status in the admin dashboard and make it discoverable on the public portal.
            </p>
            {actionError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setIsRestoreModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <button onClick={handleRestoreEvent} disabled={actionLoading} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 transition cursor-pointer">
                {actionLoading ? 'Restoring...' : 'Restore Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Permanent Delete Event
          ========================================================================= */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-red-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-red-100 pb-3">
              <div className="flex items-center gap-2.5 text-kits-red">
                <div className="p-2 rounded-xl bg-red-50 text-kits-red font-black">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-red-900 tracking-tight">Permanently Delete Historical Data</h3>
                  <p className="text-[10px] text-red-500 font-bold uppercase">High-Risk Irreversible Purge</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-red-900">Target Event:</p>
              <p className="font-black text-gray-900 text-base">{event.name}</p>
            </div>

            {isLoadingImpact ? (
              <LoadingState message="Calculating live affected operational records..." />
            ) : impactData ? (
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-2xl space-y-1 font-mono text-[11px] text-gray-700">
                  <span className="font-bold text-gray-900 block font-sans">Records affected:</span>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <div>Registrations: <strong>{impactData.registrations_count}</strong></div>
                    <div>Teams: <strong>{impactData.teams_count}</strong></div>
                    <div>Team Members: <strong>{impactData.team_members_count}</strong></div>
                    <div>Attendance: <strong>{impactData.attendance_count}</strong></div>
                    <div>Payments: <strong>{impactData.payments_count}</strong></div>
                    <div>Feedback: <strong>{impactData.feedback_count}</strong></div>
                    <div>Certificates: <strong>{impactData.certificates_count}</strong></div>
                    <div>Sub-Events: <strong>{impactData.sub_events_count}</strong></div>
                  </div>
                </div>

                <p className="text-xs text-gray-600 leading-relaxed font-normal">
                  This operation is <strong>permanent and cannot be undone</strong>. 
                  Student login accounts are <strong>NOT affected</strong>.
                </p>

                <div className="space-y-1.5 text-xs">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-700">
                    TYPE <span className="font-mono text-red-600 font-black">CONFIRM</span> TO CONFIRM:
                  </label>
                  <input
                    type="text"
                    placeholder={`Type "CONFIRM"`}
                    value={deleteTypedPhrase}
                    onChange={(e) => setDeleteTypedPhrase(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-red-300 rounded-xl font-mono text-xs text-gray-900 focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>
            ) : null}

            {actionError && <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold">{actionSuccess}</div>}

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setIsDeleteModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <DeleteButton
                onClick={handleDeleteEvent}
                disabled={
                  actionLoading ||
                  !impactData ||
                  deleteTypedPhrase !== 'CONFIRM'
                }
                loading={actionLoading}
                className="px-5 py-2.5 rounded-xl"
                label="Delete Permanently"
                loadingLabel="Deleting..."
              />
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Delete Category
          ========================================================================= */}
      {deleteCategoryItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-red-200 modal-dialog-animate">
            <div className="flex items-center gap-2.5 text-kits-red border-b border-red-100 pb-3">
              <ShieldAlert className="h-5 w-5" />
              <h3 className="text-sm font-black uppercase text-red-900">Delete Category</h3>
            </div>
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-red-900">Target Category:</p>
              <p className="font-black text-gray-900 text-sm">{deleteCategoryItem.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed font-normal">
              Deleting this category removes its track from the event. Any historical student registrations in its sub-events are preserved.
            </p>
            {actionError && <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">{actionError}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setDeleteCategoryItem(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <DeleteButton
                onClick={handleDeleteCategory}
                disabled={actionLoading}
                loading={actionLoading}
                className="px-5 py-2.5 rounded-xl"
                label="Delete Category"
                loadingLabel="Deleting..."
              />
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Delete Sub-Event
          ========================================================================= */}
      {deleteSubEventItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-red-200 modal-dialog-animate">
            <div className="flex items-center gap-2.5 text-kits-red border-b border-red-100 pb-3">
              <ShieldAlert className="h-5 w-5" />
              <h3 className="text-sm font-black uppercase text-red-900">Delete Sub-Event</h3>
            </div>
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-red-900">Target Sub-Event:</p>
              <p className="font-black text-gray-900 text-sm">{deleteSubEventItem.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed font-normal">
              Deleting this sub-event removes it from active operations. 
              <strong> Historical student registrations, team tokens, attendance logs, and certificates are permanently preserved.</strong>
            </p>
            {actionError && <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">{actionError}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setDeleteSubEventItem(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
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
      {/* =========================================================================
          MODAL: Archive Category
          ========================================================================= */}
      {archiveCategoryItem && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
                  <Archive className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-black uppercase text-gray-900">Archive Category</h3>
              </div>
              <button onClick={() => setArchiveCategoryItem(null)} className="p-1 hover:bg-gray-100 rounded-xl cursor-pointer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-amber-900">Target Category:</p>
              <p className="font-black text-gray-900 text-sm">{archiveCategoryItem.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Archiving this category will hide it from active public discovery and prevent new registrations into its sub-events. Existing registrations remain safely preserved.
            </p>
            {actionError && <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setArchiveCategoryItem(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <button
                onClick={handleArchiveCategory}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 transition disabled:opacity-50 cursor-pointer"
              >
                {actionLoading ? 'Archiving...' : 'Confirm Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Restore Category
          ========================================================================= */}
      {restoreCategoryItem && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                  <RotateCcw className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-black uppercase text-gray-900">Restore Category</h3>
              </div>
              <button onClick={() => setRestoreCategoryItem(null)} className="p-1 hover:bg-gray-100 rounded-xl cursor-pointer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-emerald-900">Target Category:</p>
              <p className="font-black text-gray-900 text-sm">{restoreCategoryItem.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Restoring this category will return it to active status. Note that any independently archived sub-events under this category will remain archived.
            </p>
            {actionError && <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setRestoreCategoryItem(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <button
                onClick={handleRestoreCategory}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition disabled:opacity-50 cursor-pointer"
              >
                {actionLoading ? 'Restoring...' : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Archive Sub-Event
          ========================================================================= */}
      {archiveSubEventItem && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
                  <Archive className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-black uppercase text-gray-900">Archive Sub-Event</h3>
              </div>
              <button onClick={() => setArchiveSubEventItem(null)} className="p-1 hover:bg-gray-100 rounded-xl cursor-pointer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-amber-900">Target Sub-Event:</p>
              <p className="font-black text-gray-900 text-sm">{archiveSubEventItem.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Archiving this sub-event will remove it from active registration discovery and prevent new registrations. All existing participant records, payments, and certificates remain intact.
            </p>
            {actionError && <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setArchiveSubEventItem(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <button
                onClick={handleArchiveSubEvent}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 transition disabled:opacity-50 cursor-pointer"
              >
                {actionLoading ? 'Archiving...' : 'Confirm Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Restore Sub-Event
          ========================================================================= */}
      {restoreSubEventItem && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                  <RotateCcw className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-black uppercase text-gray-900">Restore Sub-Event</h3>
              </div>
              <button onClick={() => setRestoreSubEventItem(null)} className="p-1 hover:bg-gray-100 rounded-xl cursor-pointer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-emerald-900">Target Sub-Event:</p>
              <p className="font-black text-gray-900 text-sm">{restoreSubEventItem.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Restoring this sub-event returns it to active operations under this event.
            </p>
            {actionError && <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setRestoreSubEventItem(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <button
                onClick={handleRestoreSubEvent}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition disabled:opacity-50 cursor-pointer"
              >
                {actionLoading ? 'Restoring...' : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
