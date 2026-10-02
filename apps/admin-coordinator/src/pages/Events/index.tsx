import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, invokeAdminEdgeFunction } from '@kits-eos/shared';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import type { Event, EventLifecycleStatus, StatusMode } from '@kits-eos/shared/src/types/models';
import { 
  resolveEffectiveEventStatus, 
  getLifecycleBadgeTheme 
} from '@kits-eos/shared';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { DeleteButton } from '../../components/ui/DeleteButton';
import { 
  Plus, 
  Calendar as CalendarIcon, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  Eye, 
  Edit2, 
  Archive, 
  RotateCcw, 
  Trash2, 
  Layers, 
  Tag, 
  ShieldAlert, 
  X, 
  CheckCircle2,
  ArchiveRestore,
  CreditCard,
  BarChart3,
  Award
} from 'lucide-react';

const PAGE_SIZE = 10;

interface EventWithCounts extends Event {
  categories_count?: number;
  sub_events_count?: number;
}

interface HistoricalImpactData {
  scope: string;
  entity_id: string;
  entity_name: string;
  event_name?: string;
  status: string;
  is_archived: boolean;
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

export function EventsList() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventWithCounts[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [archivedCount, setArchivedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active Tab: 'ACTIVE' vs 'ARCHIVED'
  const [viewMode, setViewMode] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');

  // Filters and Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Modal States
  const [archiveModalEvent, setArchiveModalEvent] = useState<Event | null>(null);
  const [restoreModalEvent, setRestoreModalEvent] = useState<Event | null>(null);
  
  // Historical Review & Permanent Delete Modal States
  const [reviewModalEvent, setReviewModalEvent] = useState<Event | null>(null);
  const [impactData, setImpactData] = useState<HistoricalImpactData | null>(null);
  const [isLoadingImpact, setIsLoadingImpact] = useState(false);

  const [deleteModalEvent, setDeleteModalEvent] = useState<Event | null>(null);
  const [deleteTypedPhrase, setDeleteTypedPhrase] = useState('');
  const [deletedSummary, setDeletedSummary] = useState<any | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [now, setNow] = useState<number>(Date.now());
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  // Periodic automatic lifecycle refresh
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [viewMode]);

  async function fetchCounts() {
    try {
      const [actRes, arcRes] = await Promise.all([
        supabase.from('events').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
        supabase.from('events').select('id', { count: 'exact', head: true }).eq('status', 'ARCHIVED'),
      ]);
      if (actRes.count !== null) setActiveCount(actRes.count);
      if (arcRes.count !== null) setArchivedCount(arcRes.count);
    } catch (e) {
      console.error('Failed to fetch counts:', e);
    }
  }

  async function fetchEvents() {
    try {
      setIsLoading(true);
      setError(null);

      let query = supabase
        .from('events')
        .select(`
          id, 
          name, 
          description, 
          start_date, 
          end_date, 
          registration_start_date,
          registration_end_date,
          banner_path, 
          status, 
          status_mode,
          manual_status,
          created_at,
          categories (
            id
          ),
          sub_events (
            id
          )
        `, { count: 'exact' })
        .eq('status', viewMode);

      if (debouncedQuery.trim()) {
        query = query.ilike('name', `%${debouncedQuery.trim()}%`);
      }

      // Pagination
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      query = query.order('created_at', { ascending: false }).range(from, to);

      const { data, error: fetchError, count } = await query;

      if (fetchError) throw fetchError;

      const formatted = (data || []).map((ev: any) => ({
        ...ev,
        categories_count: ev.categories?.length || 0,
        sub_events_count: ev.sub_events?.length || 0,
      }));

      setEvents(formatted);
      setTotalCount(count || 0);
      await fetchCounts();
    } catch (err: any) {
      console.error('Failed to fetch events:', err);
      setError('Failed to load events. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchEvents();
  }, [debouncedQuery, viewMode, currentPage]);

  // Handle Archive Event Submit
  const handleArchiveSubmit = async () => {
    if (!archiveModalEvent) return;
    try {
      setActionLoading(true);
      setActionError(null);

      const { data, error: rpcErr } = await supabase.rpc('admin_archive_event', {
        p_event_id: archiveModalEvent.id,
      });

      if (rpcErr || (data && !data.success)) {
        throw new Error(rpcErr?.message || data?.message || 'Failed to archive event.');
      }

      setActionSuccess(`"${archiveModalEvent.name}" has been successfully archived.`);
      setTimeout(() => {
        setArchiveModalEvent(null);
        setActionSuccess(null);
        fetchEvents();
      }, 1200);
    } catch (err: any) {
      console.error('Archive event failed:', err);
      setActionError(err.message || 'Failed to archive event.');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Restore Event Submit
  const handleRestoreSubmit = async () => {
    if (!restoreModalEvent) return;
    try {
      setActionLoading(true);
      setActionError(null);

      const { data, error: rpcErr } = await supabase.rpc('admin_restore_event', {
        p_event_id: restoreModalEvent.id,
      });

      if (rpcErr || (data && !data.success)) {
        throw new Error(rpcErr?.message || data?.message || 'Failed to restore event.');
      }

      setActionSuccess(`"${restoreModalEvent.name}" has been restored to Active status.`);
      setTimeout(() => {
        setRestoreModalEvent(null);
        setActionSuccess(null);
        fetchEvents();
      }, 1200);
    } catch (err: any) {
      console.error('Restore event failed:', err);
      setActionError(err.message || 'Failed to restore event.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateStatusMode = async (
    ev: EventWithCounts,
    mode: StatusMode,
    manualStatus?: EventLifecycleStatus
  ) => {
    try {
      setUpdatingStatusId(ev.id);
      const targetManual =
        mode === 'MANUAL'
          ? (manualStatus || ev.manual_status || resolveEffectiveEventStatus(ev, now))
          : null;

      const { data, error: rpcErr } = await supabase.rpc('admin_set_event_status', {
        p_event_id: ev.id,
        p_status_mode: mode,
        p_manual_status: targetManual,
      });

      if (rpcErr) throw rpcErr;
      if (data && !data.success) {
        throw new Error(data.message || 'Failed to update event status mode.');
      }

      setEvents((prev) =>
        prev.map((e) =>
          e.id === ev.id ? { ...e, status_mode: mode, manual_status: targetManual } : e
        )
      );
    } catch (err: any) {
      console.error('Failed to update event status:', err);
      alert(err.message || 'Failed to update event status.');
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleUpdateManualStatus = async (
    ev: EventWithCounts,
    status: EventLifecycleStatus
  ) => {
    try {
      setUpdatingStatusId(ev.id);
      const { data, error: rpcErr } = await supabase.rpc('admin_set_event_status', {
        p_event_id: ev.id,
        p_status_mode: 'MANUAL',
        p_manual_status: status,
      });

      if (rpcErr) throw rpcErr;
      if (data && !data.success) {
        throw new Error(data.message || 'Failed to update manual status.');
      }

      setEvents((prev) =>
        prev.map((e) =>
          e.id === ev.id ? { ...e, status_mode: 'MANUAL', manual_status: status } : e
        )
      );
    } catch (err: any) {
      console.error('Failed to update manual status:', err);
      alert(err.message || 'Failed to update manual status.');
    } finally {
      setUpdatingStatusId(null);
    }
  };

  // Load Impact Data for Review
  const handleOpenReviewModal = async (event: Event) => {
    setReviewModalEvent(event);
    setImpactData(null);
    setIsLoadingImpact(true);
    setActionError(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_calculate_historical_deletion_impact', {
        p_scope: 'EVENT',
        p_entity_id: event.id,
      });
      if (rpcErr) throw rpcErr;
      setImpactData(data as HistoricalImpactData);
    } catch (err: any) {
      console.error('Failed to calculate impact:', err);
      setActionError(err.message || 'Failed to calculate historical data impact.');
    } finally {
      setIsLoadingImpact(false);
    }
  };

  // Open Permanent Deletion Modal
  const handleOpenDeleteModal = async (event: Event) => {
    setDeleteModalEvent(event);
    setDeleteTypedPhrase('');
    setActionError(null);
    setDeletedSummary(null);

    if (!impactData || impactData.entity_id !== event.id) {
      setIsLoadingImpact(true);
      try {
        const { data, error: rpcErr } = await supabase.rpc('admin_calculate_historical_deletion_impact', {
          p_scope: 'EVENT',
          p_entity_id: event.id,
        });
        if (rpcErr) throw rpcErr;
        setImpactData(data as HistoricalImpactData);
      } catch (err: any) {
        console.error('Failed to load impact for delete modal:', err);
        setActionError(err.message || 'Failed to load historical data impact.');
      } finally {
        setIsLoadingImpact(false);
      }
    }
  };

  // Execute Permanent Historical Deletion Submit
  const handleDeleteSubmit = async () => {
    if (!deleteModalEvent || !impactData) return;
    try {
      setActionLoading(true);
      setActionError(null);

      const { data, error: fnErr } = await invokeAdminEdgeFunction('admin-delete-historical-data', {
        body: {
          scope: 'EVENT',
          entity_id: deleteModalEvent.id,
          confirmation_phrase: 'CONFIRM',
        },
      });

      if (fnErr || (data && !data.success)) {
        throw new Error(fnErr?.message || data?.error || data?.message || 'Failed to permanently delete historical data.');
      }

      setDeletedSummary(data);
      setActionSuccess(`Historical data for "${deleteModalEvent.name}" has been permanently purged.`);
      await fetchEvents();
    } catch (err: any) {
      console.error('Permanent historical deletion failed:', err);
      setActionError(err.message || 'Permanent deletion failed. Transaction rolled back completely.');
    } finally {
      setActionLoading(false);
    }
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16 font-sans page-enter">
      {/* Page Header */}
      <PageHeader
        title="Event Operations & Lifecycle Management"
        description="Configure institutional festivals, manage live tracks, archive concluded events, and safely review or permanently purge historical records."
        action={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setViewMode(viewMode === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE')}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl border transition flex items-center gap-2 cursor-pointer ${
                viewMode === 'ARCHIVED'
                  ? 'bg-amber-50 border-amber-300 text-amber-900 shadow-2xs'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Archive className="h-3.5 w-3.5 text-amber-600" />
              <span>{viewMode === 'ACTIVE' ? `View Archived (${archivedCount})` : `Back to Active (${activeCount})`}</span>
            </button>

            {viewMode === 'ACTIVE' && (
              <button
                type="button"
                onClick={() => navigate('/admin/events/new')}
                className="btn-liquid btn-primary-red px-4 py-2 text-xs font-black uppercase tracking-wider shadow-2xs"
              >
                <span className="btn-content">
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create Event</span>
                </span>
              </button>
            )}
          </div>
        }
      />

      {/* Mode Selector Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setViewMode('ACTIVE')}
            className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer flex items-center gap-2 ${
              viewMode === 'ACTIVE'
                ? 'bg-kits-red text-white shadow-2xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Active Events ({activeCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('ARCHIVED')}
            className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer flex items-center gap-2 ${
              viewMode === 'ARCHIVED'
                ? 'bg-amber-600 text-white shadow-2xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Archive className="h-3.5 w-3.5" />
            <span>Archived ({archivedCount})</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64 text-xs">
          <Search className="h-3.5 w-3.5 text-gray-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search events by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
          />
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <LoadingState message="Loading events directory..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchEvents} />
      ) : events.length === 0 ? (
        <EmptyState
          title={viewMode === 'ACTIVE' ? 'No Active Events Found' : 'No Archived Events'}
          description={
            viewMode === 'ACTIVE'
              ? 'There are currently no active events. Click "Create Event" to set up a new institutional event.'
              : 'Archived events will appear here once archived from the active events list.'
          }
          icon={<Layers className="h-10 w-10 text-gray-300" />}
          action={
            viewMode === 'ACTIVE' ? (
              <button
                type="button"
                onClick={() => navigate('/admin/events/new')}
                className="px-4 py-2 bg-kits-red text-white text-xs font-black uppercase tracking-wider rounded-xl hover:bg-red-700 transition shadow-2xs cursor-pointer flex items-center gap-1.5 mx-auto"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create New Event</span>
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map((ev) => {
              const effectiveStatus = resolveEffectiveEventStatus(ev, now);
              const badgeTheme = getLifecycleBadgeTheme(effectiveStatus);
              const isCompleted = effectiveStatus === 'COMPLETED';

              return (
                <div
                  key={ev.id}
                  className="bg-white rounded-3xl border border-gray-200 shadow-2xs overflow-hidden flex flex-col hover:border-gray-300 transition"
                >
                  {/* Banner / Header */}
                  <div className="h-28 bg-slate-900 relative overflow-hidden flex items-center justify-center">
                    {ev.banner_path ? (
                      <img
                        src={ev.banner_path}
                        alt={ev.name}
                        className={`w-full h-full object-cover opacity-60 ${isCompleted ? 'grayscale contrast-90' : ''}`}
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-white/50 text-xs font-mono">
                        <Layers className="h-6 w-6" />
                        <span>{ev.name}</span>
                      </div>
                    )}
                    <div className="absolute top-3 left-3 z-10">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-2xs ${badgeTheme.bg} ${badgeTheme.text} ${badgeTheme.border}`}
                      >
                        {badgeTheme.indicatorDot && (
                          <span className={`h-1.5 w-1.5 rounded-full ${badgeTheme.indicatorDot}`} />
                        )}
                        {badgeTheme.label}
                      </span>
                    </div>
                    <div className="absolute top-3 right-3 z-10">
                      <StatusBadge status={ev.status} />
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div>
                      <h3 className={`font-black text-sm tracking-tight line-clamp-1 ${isCompleted ? 'text-gray-600' : 'text-gray-900'}`}>
                        {ev.name}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed font-normal">
                        {ev.description || 'No description provided.'}
                      </p>
                    </div>

                    {/* Dates & Metrics */}
                    <div className="space-y-2 border-t border-gray-100 pt-3 text-[11px] text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <CalendarIcon className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <span className="font-mono">
                          {formatDateTime12h(ev.start_date)}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1 font-bold text-gray-700 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-200">
                          <Tag className="h-3 w-3 text-kits-blue" />
                          {ev.categories_count} Categories
                        </span>
                        <span className="inline-flex items-center gap-1 font-bold text-gray-700 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-200">
                          <Layers className="h-3 w-3 text-purple-600" />
                          {ev.sub_events_count} Sub-Events
                        </span>
                      </div>
                    </div>

                    {/* Event Lifecycle Mode & Manual Controls */}
                    <div className="bg-gray-50 p-3 rounded-2xl border border-gray-200 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase text-gray-500 tracking-wider">Status Mode</span>
                        <div className="flex items-center bg-white border border-gray-200 rounded-lg p-0.5">
                          <button
                            type="button"
                            onClick={() => handleUpdateStatusMode(ev, 'AUTOMATIC')}
                            disabled={updatingStatusId === ev.id}
                            className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider transition cursor-pointer ${
                              ev.status_mode !== 'MANUAL' 
                                ? 'bg-kits-blue text-white shadow-2xs' 
                                : 'text-gray-500 hover:text-gray-900'
                            }`}
                          >
                            Automatic
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateStatusMode(ev, 'MANUAL', ev.manual_status || effectiveStatus)}
                            disabled={updatingStatusId === ev.id}
                            className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider transition cursor-pointer ${
                              ev.status_mode === 'MANUAL' 
                                ? 'bg-amber-600 text-white shadow-2xs' 
                                : 'text-gray-500 hover:text-gray-900'
                            }`}
                          >
                            Manual
                          </button>
                        </div>
                      </div>

                      {ev.status_mode === 'MANUAL' && (
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-200">
                          <span className="text-[10px] font-bold text-gray-500">Override:</span>
                          <select
                            value={ev.manual_status || effectiveStatus}
                            onChange={(e) => handleUpdateManualStatus(ev, e.target.value as EventLifecycleStatus)}
                            disabled={updatingStatusId === ev.id}
                            className="bg-white border border-gray-300 rounded-lg px-2 py-1 text-[11px] font-bold text-gray-800 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue cursor-pointer"
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

                  {/* Action Bar based on Lifecycle View */}
                  <div className="border-t border-gray-100 pt-3 flex items-center justify-between gap-2">
                    <Link
                      to={`/admin/events/${ev.id}`}
                      className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl transition flex items-center gap-1 border border-gray-200"
                    >
                      <Eye className="h-3.5 w-3.5 text-gray-500" />
                      <span>Details</span>
                    </Link>

                    {viewMode === 'ACTIVE' ? (
                      <div className="flex items-center gap-1.5">
                        <Link
                          to={`/admin/events/${ev.id}/edit`}
                          className="p-1.5 hover:bg-gray-100 text-gray-500 hover:text-kits-blue rounded-xl transition"
                          title="Edit Event"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Link>

                        <button
                          type="button"
                          onClick={() => setArchiveModalEvent(ev)}
                          className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-xl transition flex items-center gap-1 cursor-pointer"
                          title="Archive Event"
                        >
                          <Archive className="h-3.5 w-3.5 text-amber-600" />
                          <span>Archive</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenReviewModal(ev)}
                          className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-kits-blue text-xs font-bold rounded-xl transition flex items-center gap-1 cursor-pointer"
                          title="Review Historical Data"
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                          <span>Review Data</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setRestoreModalEvent(ev)}
                          className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl transition cursor-pointer"
                          title="Restore Event"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenDeleteModal(ev)}
                          className="p-1.5 bg-red-50 hover:bg-red-100 text-kits-red rounded-xl transition cursor-pointer"
                          title="Permanently Delete Historical Data"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 pt-4 text-xs">
              <span className="text-gray-500">
                Showing {events.length} of {totalCount} events
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition cursor-pointer flex items-center gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Previous</span>
                </button>
                <span className="px-3 py-1.5 font-bold text-gray-700">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition cursor-pointer flex items-center gap-1"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          MODAL: Archive Event Confirmation
          ========================================================================= */}
      {archiveModalEvent && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-100 text-amber-800 font-bold">
                  <Archive className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                    Archive Event?
                  </h3>
                  <p className="text-[10px] text-gray-500 font-bold uppercase">Institutional Lifecycle</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setArchiveModalEvent(null)}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-1">
              <p className="text-xs font-bold text-amber-900">Target Event:</p>
              <p className="text-sm font-black text-gray-900">{archiveModalEvent.name}</p>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed font-normal">
              Archiving moves this event into the Archived Events directory and removes it from public discovery. 
              <strong> All historical registrations, attendance records, certificates, and student accounts are fully preserved.</strong>
            </p>

            {actionError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                {actionError}
              </div>
            )}

            {actionSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{actionSuccess}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setArchiveModalEvent(null)}
                className="btn-secondary px-4 py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleArchiveSubmit}
                className="px-5 py-2.5 rounded-xl bg-amber-600 text-white text-xs font-black uppercase tracking-wider hover:bg-amber-700 disabled:opacity-50 transition shadow-2xs cursor-pointer flex items-center gap-1.5"
              >
                <Archive className="h-3.5 w-3.5" />
                <span>{actionLoading ? 'Archiving...' : 'Archive Event'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Restore Event Confirmation
          ========================================================================= */}
      {restoreModalEvent && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-800 font-bold">
                  <ArchiveRestore className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                    Restore Event to Active?
                  </h3>
                  <p className="text-[10px] text-gray-500 font-bold uppercase">Institutional Lifecycle</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRestoreModalEvent(null)}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-2xl space-y-1">
              <p className="text-xs font-bold text-emerald-900">Restoring Event:</p>
              <p className="text-sm font-black text-gray-900">{restoreModalEvent.name}</p>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed font-normal">
              Restoring this event will make it active again in the administrator dashboard and eligible for public event discovery.
            </p>

            {actionError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                {actionError}
              </div>
            )}

            {actionSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{actionSuccess}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setRestoreModalEvent(null)}
                className="btn-secondary px-4 py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleRestoreSubmit}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 transition shadow-2xs cursor-pointer flex items-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>{actionLoading ? 'Restoring...' : 'Restore Event'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Review Historical Data Impact (Live Calculation)
          ========================================================================= */}
      {reviewModalEvent && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 space-y-5 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-100 text-kits-blue font-bold">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                    Historical Data Impact Review
                  </h3>
                  <p className="text-[10px] text-gray-500 font-mono">{reviewModalEvent.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReviewModalEvent(null)}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isLoadingImpact ? (
              <LoadingState message="Calculating live database operational records..." />
            ) : actionError ? (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                {actionError}
              </div>
            ) : impactData ? (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Categories</span>
                    <span className="text-base font-black text-gray-900">{impactData.categories_count}</span>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Sub-Events</span>
                    <span className="text-base font-black text-gray-900">{impactData.sub_events_count}</span>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Registrations</span>
                    <span className="text-base font-black text-gray-900">{impactData.registrations_count}</span>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Teams / Solo</span>
                    <span className="text-base font-black text-gray-900">{impactData.teams_count}</span>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Team Members</span>
                    <span className="text-base font-black text-gray-900">{impactData.team_members_count}</span>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Attendance</span>
                    <span className="text-base font-black text-emerald-700">{impactData.attendance_count}</span>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Payments</span>
                    <span className="text-base font-black text-gray-900">{impactData.payments_count}</span>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Feedback</span>
                    <span className="text-base font-black text-gray-900">{impactData.feedback_count}</span>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Certificates</span>
                    <span className="text-base font-black text-amber-700">{impactData.certificates_count}</span>
                  </div>
                </div>

                {/* Explicit Warnings */}
                <div className="space-y-2 pt-2">
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-[11px] text-amber-900 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <Award className="h-3.5 w-3.5 text-amber-600" />
                      <span>Certificate Invalidation Warning:</span>
                    </div>
                    <p className="leading-relaxed">
                      Certificates issued for this event will be permanently removed. Existing public verification codes will no longer resolve to valid certificates.
                    </p>
                  </div>

                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl text-[11px] text-blue-900 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <CreditCard className="h-3.5 w-3.5 text-kits-blue" />
                      <span>Payment Records Notice:</span>
                    </div>
                    <p className="leading-relaxed">
                      Payment history will be permanently removed from KITS-EOS. This does not reverse or refund any external payment.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setReviewModalEvent(null)}
                className="btn-secondary px-4 py-2 text-xs font-bold"
              >
                Back
              </button>

              <button
                type="button"
                onClick={() => {
                  const ev = reviewModalEvent;
                  setReviewModalEvent(null);
                  handleOpenDeleteModal(ev);
                }}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl border-2 border-kits-red text-kits-red bg-white hover:bg-red-50 active:scale-[0.98] text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Permanently Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Permanent Historical Data Deletion (High Risk with Typed Confirmation)
          ========================================================================= */}
      {deleteModalEvent && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-red-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-red-100 pb-3">
              <div className="flex items-center gap-2.5 text-kits-red">
                <div className="p-2 rounded-xl bg-red-50 text-kits-red font-black">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-red-900 tracking-tight">
                    Permanent Historical Data Deletion
                  </h3>
                  <p className="text-[10px] text-red-500 font-bold uppercase tracking-wider">
                    High-Risk Irreversible Purge
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteModalEvent(null)}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {deletedSummary ? (
              <div className="space-y-4 text-xs">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 space-y-2">
                  <div className="flex items-center gap-2 font-black text-sm text-emerald-800">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <span>Historical Data Deleted</span>
                  </div>
                  <p className="font-mono text-[11px] text-emerald-700 font-bold">
                    Target Event: {deletedSummary.entity_name}
                  </p>
                  <ul className="text-[11px] space-y-0.5 list-disc list-inside text-emerald-800">
                    <li>{deletedSummary.deleted_counts?.categories || 0} categories removed</li>
                    <li>{deletedSummary.deleted_counts?.sub_events || 0} sub-events removed</li>
                    <li>{deletedSummary.deleted_counts?.registrations || 0} registrations removed</li>
                    <li>{deletedSummary.deleted_counts?.teams || 0} teams removed</li>
                    <li>{deletedSummary.deleted_counts?.team_members || 0} team members removed</li>
                    <li>{deletedSummary.deleted_counts?.attendance_records || 0} attendance records removed</li>
                    <li>{deletedSummary.deleted_counts?.payments || 0} payment records removed</li>
                    <li>{deletedSummary.deleted_counts?.feedback_responses || 0} feedback records removed</li>
                    <li>{deletedSummary.deleted_counts?.certificates || 0} certificates removed</li>
                  </ul>
                  <p className="text-[10px] text-emerald-600 font-mono pt-1">
                    ✓ Permanent audit record created and preserved.
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteModalEvent(null);
                      setDeletedSummary(null);
                    }}
                    className="btn-secondary px-5 py-2.5 text-xs font-bold"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-wider text-red-700">Target Entity for Deletion:</p>
                  <p className="text-base font-black text-gray-900">{deleteModalEvent.name}</p>
                </div>

                {impactData && (
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
                )}

                <p className="text-xs text-gray-600 leading-relaxed">
                  This operation is <strong>permanent and cannot be undone</strong>. 
                  Student login accounts are <strong>NOT affected</strong>.
                </p>

                {/* Typed Phrase Confirmation */}
                <div className="space-y-1.5 pt-1">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-700">
                    TYPE <span className="font-mono text-red-600 font-black">CONFIRM</span> TO CONFIRM:
                  </label>
                  <input
                    type="text"
                    placeholder={`Type "CONFIRM"`}
                    value={deleteTypedPhrase}
                    onChange={(e) => setDeleteTypedPhrase(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-red-300 rounded-xl font-mono text-xs text-gray-900 focus:ring-1 focus:ring-red-500 focus:border-red-500"
                  />
                </div>

                {actionError && (
                  <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">
                    {actionError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setDeleteModalEvent(null)}
                    className="btn-secondary px-4 py-2 text-xs font-bold"
                  >
                    Cancel
                  </button>

                  <DeleteButton
                    disabled={
                      actionLoading ||
                      !impactData ||
                      deleteTypedPhrase !== 'CONFIRM'
                    }
                    loading={actionLoading}
                    onClick={handleDeleteSubmit}
                    className="px-6 py-2.5 rounded-xl"
                    label="Permanently Delete Data"
                    loadingLabel="Purging Data..."
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
