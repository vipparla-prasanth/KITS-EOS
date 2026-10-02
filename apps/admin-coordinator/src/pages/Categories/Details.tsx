import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import type { Event, Category, SubEvent } from '@kits-eos/shared/src/types/models';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { NotFound } from '../NotFound';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { DeleteButton } from '../../components/ui/DeleteButton';
import { 
  ArrowLeft, 
  Edit2, 
  Plus, 
  CalendarDays,
  Folder,
  Archive,
  RotateCcw,
  Trash2,
  ShieldAlert, 
  X, 
  ArrowRight 
} from 'lucide-react';
import { 
  resolveEffectiveSubEventStatus,
  isSubEventRegistrationAvailable,
  EVENT_LIFECYCLE_CONFIGS 
} from '@kits-eos/shared/src/utils/eventLifecycle';
import type { EventLifecycleStatus, StatusMode } from '@kits-eos/shared/src/types/models';

export function CategoryDetails() {
  const { eventId, categoryId } = useParams<{ eventId: string; categoryId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [subEvents, setSubEvents] = useState<SubEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Category Lifecycle Modals
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // SubEvent Lifecycle Modals
  const [archiveSubEventItem, setArchiveSubEventItem] = useState<SubEvent | null>(null);
  const [restoreSubEventItem, setRestoreSubEventItem] = useState<SubEvent | null>(null);
  const [deleteSubEventItem, setDeleteSubEventItem] = useState<SubEvent | null>(null);

  const [isNotFound, setIsNotFound] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  async function fetchCategoryDetails() {
    if (!eventId || !categoryId) return;
    try {
      setIsLoading(true);
      setError(null);
      setIsNotFound(false);

      const [eventRes, categoryRes, subEventsRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
        supabase.from('categories').select('*').eq('id', categoryId).maybeSingle(),
        supabase.from('sub_events').select('*').eq('category_id', categoryId).neq('status', 'PERMANENTLY_DELETED').order('name', { ascending: true })
      ]);

      if (eventRes.error) {
        if (eventRes.error.code === 'PGRST116' || eventRes.error.code === '22P02') {
          setIsNotFound(true);
          return;
        }
        throw eventRes.error;
      }
      if (categoryRes.error) {
        if (categoryRes.error.code === 'PGRST116' || categoryRes.error.code === '22P02') {
          setIsNotFound(true);
          return;
        }
        throw categoryRes.error;
      }

      if (!eventRes.data || !categoryRes.data) {
        setIsNotFound(true);
        return;
      }

      setEvent(eventRes.data as unknown as Event);
      setCategory(categoryRes.data as unknown as Category);
      setSubEvents(subEventsRes.data || []);
    } catch (err: any) {
      console.error('Failed to fetch category details:', err);
      setError('Failed to load category information.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchCategoryDetails();
  }, [eventId, categoryId]);

  // Category Archive
  const handleArchiveCategory = async () => {
    if (!category) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_archive_category', { p_category_id: category.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to archive category.');
      setActionSuccess('Category archived successfully.');
      setTimeout(() => {
        setIsArchiveModalOpen(false);
        setActionSuccess(null);
        fetchCategoryDetails();
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to archive category.');
    } finally {
      setActionLoading(false);
    }
  };

  // Category Restore
  const handleRestoreCategory = async () => {
    if (!category) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_restore_category', { p_category_id: category.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to restore category.');
      setActionSuccess('Category restored successfully.');
      setTimeout(() => {
        setIsRestoreModalOpen(false);
        setActionSuccess(null);
        fetchCategoryDetails();
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to restore category.');
    } finally {
      setActionLoading(false);
    }
  };

  // Category Delete
  const handleDeleteCategory = async () => {
    if (!category) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_delete_category', { p_category_id: category.id });
      if (rpcErr || (data && !data.success)) throw new Error(rpcErr?.message || data?.message || 'Failed to delete category.');
      setActionSuccess('Category deleted successfully.');
      setTimeout(() => {
        setIsDeleteModalOpen(false);
        navigate(`/admin/events/${eventId}`);
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete category.');
    } finally {
      setActionLoading(false);
    }
  };

  // Sub-Event Delete
  const handleDeleteSubEvent = async () => {
    if (!deleteSubEventItem) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const { data, error: fnErr } = await supabase.functions.invoke('admin-delete-sub-event', {
        body: {
          sub_event_id: deleteSubEventItem.id,
          confirmation_phrase: 'CONFIRM',
        },
      });

      if (fnErr) {
        // Fallback to direct RPC if edge function has routing or network error
        const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_delete_sub_event', { p_sub_event_id: deleteSubEventItem.id });
        if (rpcErr || (rpcData && !rpcData.success)) {
          throw new Error(rpcErr?.message || rpcData?.message || fnErr.message || 'Failed to delete sub-event.');
        }
      } else if (data && !data.success) {
        throw new Error(data?.error || data?.message || 'Failed to delete sub-event.');
      }

      setActionSuccess('Sub-event deleted successfully.');
      setTimeout(() => {
        setDeleteSubEventItem(null);
        setActionSuccess(null);
        fetchCategoryDetails();
      }, 1200);
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete sub-event.');
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
      fetchCategoryDetails();
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
      fetchCategoryDetails();
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
        fetchCategoryDetails();
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
        fetchCategoryDetails();
      }, 1000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to restore sub-event.');
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading category details..." />;
  }

  if (isNotFound) {
    return <NotFound />;
  }

  if (error || !category || !event) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <Link to={`/admin/events/${eventId}`} className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-kits-red">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to Event
        </Link>
        <ErrorState message={error || 'Category unavailable.'} onRetry={fetchCategoryDetails} />
      </div>
    );
  }

  const isArchived = category.status === 'ARCHIVED';

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      {/* Breadcrumb Header and Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
          <Link to="/admin/events" className="hover:text-kits-red transition">Events</Link>
          <span>/</span>
          <Link to={`/admin/events/${event.id}`} className="hover:text-kits-red transition">{event.name}</Link>
          <span>/</span>
          <span className="text-gray-900 font-bold">{category.name}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/admin/events/${eventId}/categories/${categoryId}/edit`)}
            className="inline-flex items-center text-xs font-bold text-gray-700 bg-white border border-gray-300 px-3 py-1.5 rounded-xl hover:bg-gray-50 transition shadow-2xs cursor-pointer"
          >
            <Edit2 className="mr-1.5 h-3.5 w-3.5 text-kits-blue" />
            <span>Edit Category</span>
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
              className="inline-flex items-center text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
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
            className="inline-flex items-center text-xs font-bold text-kits-red bg-red-50 border border-red-200 px-3 py-1.5 rounded-xl hover:bg-red-100 transition shadow-2xs cursor-pointer"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {/* Category Overview Card */}
      <div className="bg-white rounded-3xl shadow-2xs border border-gray-200 overflow-hidden">
        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex items-start justify-between border-b border-gray-100 pb-4">
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-kits-blue bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-100">
                Track Category
              </span>
              <h1 className="text-2xl sm:text-3xl font-black text-gray-900 mt-1 tracking-tight">{category.name}</h1>
              <div className="flex items-center gap-2 text-xs text-gray-500 font-bold mt-0.5">
                <Folder className="h-3.5 w-3.5 text-kits-blue" />
                <span>Parent Event: {event.name}</span>
              </div>
            </div>
            <StatusBadge status={category.status} />
          </div>

          {/* Description Section */}
          <div className="space-y-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-gray-400">
              Description
            </h4>
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
              {category.description ? (
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-normal">
                  {category.description}
                </p>
              ) : (
                <p className="text-xs text-gray-400 italic">
                  No description provided for this category.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sub-events Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-kits-red" />
            <h2 className="text-lg font-black text-gray-900 tracking-tight">
              Sub-Events in Track ({subEvents.length})
            </h2>
          </div>
          <Link
            to={`/admin/events/${eventId}/categories/${categoryId}/sub-events/new`}
            className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-white bg-kits-red hover:bg-red-700 px-3.5 py-2 rounded-xl transition shadow-2xs cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Sub-Event</span>
          </Link>
        </div>

        {subEvents.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center space-y-3">
            <CalendarDays className="h-8 w-8 text-gray-300 mx-auto" />
            <div className="text-sm font-bold text-gray-700">No sub-events in this category yet</div>
            <p className="text-xs text-gray-400 max-w-sm mx-auto">
              Add competitions, paper presentations, workshops, or technical challenges to this category track.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {subEvents.map((sub) => {
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
                        Sub-Event
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
                      onClick={() => navigate(`/admin/events/${eventId}/categories/${categoryId}/sub-events/${sub.id}`)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-kits-red hover:text-red-700 transition cursor-pointer"
                    >
                      <span>View Configuration</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/events/${eventId}/categories/${categoryId}/sub-events/${sub.id}/edit`)}
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
          MODAL: Archive Category
          ========================================================================= */}
      {isArchiveModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Archive className="h-5 w-5 text-amber-600" />
                <h3 className="text-sm font-black uppercase text-gray-900">Archive Category</h3>
              </div>
              <button onClick={() => setIsArchiveModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-xl cursor-pointer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="p-3 bg-amber-50 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-amber-900">Target Category:</p>
              <p className="font-black text-gray-900 text-sm">{category.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Archiving this category hides its track and sub-events from public listings while retaining all participant history.
            </p>
            {actionError && <div className="p-3 bg-red-50 text-xs text-red-700 rounded-xl">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-bold rounded-xl">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setIsArchiveModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <button onClick={handleArchiveCategory} disabled={actionLoading} className="px-5 py-2.5 rounded-xl bg-amber-600 text-white text-xs font-black uppercase tracking-wider hover:bg-amber-700 cursor-pointer">
                {actionLoading ? 'Archiving...' : 'Archive Category'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Restore Category
          ========================================================================= */}
      {isRestoreModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black uppercase text-gray-900">Restore Category</h3>
              </div>
              <button onClick={() => setIsRestoreModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-xl cursor-pointer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="p-3 bg-emerald-50 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-emerald-900">Restoring Category:</p>
              <p className="font-black text-gray-900 text-sm">{category.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Restoring this category will make it active and eligible for public event display.
            </p>
            {actionError && <div className="p-3 bg-red-50 text-xs text-red-700 rounded-xl">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-bold rounded-xl">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setIsRestoreModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
              <button onClick={handleRestoreCategory} disabled={actionLoading} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 cursor-pointer">
                {actionLoading ? 'Restoring...' : 'Restore Category'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Delete Category
          ========================================================================= */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-red-200 modal-dialog-animate">
            <div className="flex items-center gap-2.5 text-kits-red border-b border-red-100 pb-3">
              <ShieldAlert className="h-5 w-5" />
              <h3 className="text-sm font-black uppercase text-red-900">Delete Category</h3>
            </div>
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-red-900">Target Category:</p>
              <p className="font-black text-gray-900 text-sm">{category.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed font-normal">
              Deleting this category removes the track from active event operations.
              If student registrations exist under this category, historical records are preserved in the archive. If empty, the category and track are permanently removed.
            </p>
            {actionError && <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-bold rounded-xl">{actionSuccess}</div>}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button onClick={() => setIsDeleteModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">Cancel</button>
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
          MODAL: Delete SubEvent
          ========================================================================= */}
      {deleteSubEventItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-red-200 modal-dialog-animate">
            <div className="flex items-center gap-2.5 text-kits-red border-b border-red-100 pb-3">
              <ShieldAlert className="h-5 w-5" />
              <h3 className="text-sm font-black uppercase text-red-900">Delete Sub-Event</h3>
            </div>
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs space-y-1">
              <p className="font-bold text-red-900">Target Sub-Event:</p>
              <p className="font-black text-gray-900 text-sm">{deleteSubEventItem.name}</p>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed font-normal">
              Permanently deleting this sub-event will remove it and all associated registrations, teams, attendance logs, certificates, and uploaded assets from the database and storage.
              <strong className="block text-red-700 pt-1">⚠️ This action is irreversible and cannot be undone.</strong>
            </p>
            {actionError && <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-bold rounded-xl">{actionSuccess}</div>}
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
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-bold rounded-xl">{actionSuccess}</div>}
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
              Restoring this sub-event returns it to active operations under this category.
            </p>
            {actionError && <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">{actionError}</div>}
            {actionSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-bold rounded-xl">{actionSuccess}</div>}
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
