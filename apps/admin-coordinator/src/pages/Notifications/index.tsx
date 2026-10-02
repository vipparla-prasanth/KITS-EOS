import { useState, useEffect, useMemo } from 'react';
import { supabase, invokeAdminEdgeFunction } from '@kits-eos/shared';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { EmptyState } from '../../components/ui/EmptyState';
import { DeleteButton } from '../../components/ui/DeleteButton';
import { 
  Bell, 
  Send, 
  Search, 
  Users, 
  UserCheck, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Megaphone,
  RadioTower,
  Trash2,
  CheckSquare,
  Square
} from 'lucide-react';

interface BroadcastRecord {
  broadcast_id: string;
  title: string;
  message: string;
  audience: 'ALL' | 'STUDENT' | 'COORDINATOR';
  created_at: string;
  student_deliveries: number;
  coordinator_deliveries: number;
  total_deliveries: number;
  read_count: number;
  unread_count: number;
  delivery_ids: string[];
}

interface RecipientCounts {
  students_count: number;
  coordinators_count: number;
  total_count: number;
}

export function NotificationsList() {
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);
  const [recipientCounts, setRecipientCounts] = useState<RecipientCounts>({
    students_count: 0,
    coordinators_count: 0,
    total_count: 0,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAudience, setFilterAudience] = useState<'ALL' | 'STUDENT' | 'COORDINATOR'>('ALL');
  const [filterRead, setFilterRead] = useState<'ALL' | 'UNREAD' | 'READ'>('ALL');

  // Broadcast Composer State
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerStep, setComposerStep] = useState<'COMPOSE' | 'REVIEW' | 'SUCCESS'>('COMPOSE');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [targetAudience, setTargetAudience] = useState<'ALL' | 'STUDENT' | 'COORDINATOR'>('ALL');
  
  const [isSending, setIsSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sendSuccessResult, setSendSuccessResult] = useState<any | null>(null);

  // Selection & Permanent Deletion State (stores broadcast_ids)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteSuccessMsg, setDeleteSuccessMsg] = useState<string | null>(null);

  // Load Data
  const loadNotificationData = async () => {
    try {
      setIsLoading(true);
      setActionError(null);

      const [broadcastsRes, countsRes] = await Promise.all([
        supabase.rpc('admin_get_broadcast_notifications'),
        supabase.rpc('admin_get_notification_recipient_counts'),
      ]);

      if (broadcastsRes.error) throw broadcastsRes.error;

      setBroadcasts((broadcastsRes.data as BroadcastRecord[]) || []);
      if (countsRes.data) {
        setRecipientCounts(countsRes.data as RecipientCounts);
      }
    } catch (err: any) {
      console.error('Failed to load notification center data:', err);
      setActionError(err.message || 'Failed to load notifications.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadNotificationData();
  }, []);

  // Filtered Broadcasts
  const filteredBroadcasts = useMemo(() => {
    return broadcasts.filter((b) => {
      const q = searchTerm.toLowerCase().trim();
      const matchSearch =
        !q ||
        b.title.toLowerCase().includes(q) ||
        b.message.toLowerCase().includes(q);

      let matchAudience = true;
      if (filterAudience === 'STUDENT') {
        matchAudience =
          b.audience === 'ALL' ||
          b.audience === 'STUDENT' ||
          Number(b.student_deliveries) > 0;
      } else if (filterAudience === 'COORDINATOR') {
        matchAudience =
          b.audience === 'ALL' ||
          b.audience === 'COORDINATOR' ||
          Number(b.coordinator_deliveries) > 0;
      }

      let matchRead = true;
      if (filterRead === 'UNREAD') {
        matchRead = Number(b.unread_count) > 0;
      } else if (filterRead === 'READ') {
        matchRead = Number(b.unread_count) === 0;
      }

      return matchSearch && matchAudience && matchRead;
    });
  }, [broadcasts, searchTerm, filterAudience, filterRead]);

  // Statistics
  const totalBroadcastsCount = broadcasts.length;
  const totalStudentDeliveries = broadcasts.reduce(
    (sum, b) => sum + Number(b.student_deliveries || 0),
    0
  );
  const totalCoordinatorDeliveries = broadcasts.reduce(
    (sum, b) => sum + Number(b.coordinator_deliveries || 0),
    0
  );

  // Handlers
  const handleOpenComposer = () => {
    setTitle('');
    setMessage('');
    setTargetAudience('ALL');
    setComposerStep('COMPOSE');
    setActionError(null);
    setSendSuccessResult(null);
    setIsComposerOpen(true);
  };

  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      setActionError('Both title and message are required.');
      return;
    }
    setActionError(null);
    setComposerStep('REVIEW');
  };

  const handleDispatchBroadcast = async () => {
    if (isSending) return; // Prevent duplicate clicks

    try {
      setIsSending(true);
      setActionError(null);

      const { data, error: rpcErr } = await supabase.rpc('admin_send_broadcast_notification', {
        p_title: title.trim(),
        p_message: message.trim(),
        p_audience: targetAudience,
      });

      if (rpcErr || (data && !data.success)) {
        throw new Error(rpcErr?.message || data?.message || 'Failed to dispatch broadcast.');
      }

      setSendSuccessResult(data);
      setComposerStep('SUCCESS');
      await loadNotificationData();
    } catch (err: any) {
      console.error('Broadcast dispatch error:', err);
      setActionError(err.message || 'Unable to dispatch notification. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  // Selection & Bulk Deletion Handlers
  const handleToggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredBroadcasts.length && filteredBroadcasts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredBroadcasts.map((b) => b.broadcast_id)));
    }
  };

  const handleOpenDeleteModal = () => {
    if (selectedIds.size === 0) return;
    setActionError(null);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (selectedIds.size === 0 || isDeleting) return;

    try {
      setIsDeleting(true);
      setActionError(null);

      const idsToDelete = Array.from(selectedIds);
      const { data, error } = await invokeAdminEdgeFunction('admin-delete-notifications', {
        body: { notification_ids: idsToDelete }
      });

      if (error) {
        throw new Error(error.message || 'Failed to delete selected broadcasts.');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to delete selected broadcasts.');
      }

      const deletedCount = data.deleted_count || idsToDelete.length;
      setSelectedIds(new Set());
      setIsDeleteModalOpen(false);
      setDeleteSuccessMsg(`${deletedCount} broadcast notification${deletedCount > 1 ? 's' : ''} permanently deleted.`);

      // Authoritative database requery
      await loadNotificationData();

      setTimeout(() => {
        setDeleteSuccessMsg(null);
      }, 5000);

    } catch (err: any) {
      console.error('Failed to delete notifications:', err);
      setActionError(err.message || 'Failed to delete selected notifications.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-24 font-sans page-enter">
      {/* Header */}
      <PageHeader
        title="Notification Center & Broadcasts"
        description="Institutional communication hub: dispatch real-time system alerts, updates, and broadcasts to students and coordinators."
        action={
          <button
            type="button"
            onClick={handleOpenComposer}
            className="px-4 py-2.5 bg-kits-red text-white text-xs font-black uppercase tracking-wider rounded-xl hover:bg-red-700 transition shadow-2xs cursor-pointer flex items-center gap-2 shrink-0"
          >
            <Megaphone className="h-4 w-4" />
            <span>New Broadcast</span>
          </button>
        }
      />

      {/* Action Error Banner */}
      {actionError && !isComposerOpen && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
            <span>{actionError}</span>
          </div>
          <button type="button" onClick={() => setActionError(null)} className="text-red-700 hover:text-red-900 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Delete Success Banner */}
      {deleteSuccessMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{deleteSuccessMsg}</span>
          </div>
          <button type="button" onClick={() => setDeleteSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* =========================================================================
          1. STATISTICS CARDS
          ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Total Notifications</span>
            <Bell className="h-4 w-4 text-kits-blue" />
          </div>
          <p className="text-2xl font-black text-gray-900">{totalBroadcastsCount}</p>
          <span className="text-[11px] text-gray-500 font-medium">Dispatched broadcasts</span>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Student Deliveries</span>
            <Users className="h-4 w-4 text-kits-red" />
          </div>
          <p className="text-2xl font-black text-gray-900">{totalStudentDeliveries}</p>
          <span className="text-[11px] text-gray-500 font-medium">Delivered to student portals</span>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Coordinator Deliveries</span>
            <UserCheck className="h-4 w-4 text-purple-600" />
          </div>
          <p className="text-2xl font-black text-gray-900">{totalCoordinatorDeliveries}</p>
          <span className="text-[11px] text-gray-500 font-medium">Delivered to coordinators</span>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Active Audience Reach</span>
            <RadioTower className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-gray-900">{recipientCounts.total_count}</p>
          <span className="text-[11px] text-emerald-700 font-bold">
            {recipientCounts.students_count} Students • {recipientCounts.coordinators_count} Coordinators
          </span>
        </div>
      </div>

      {/* =========================================================================
          2. SEARCH & FILTER CONTROLS
          ========================================================================= */}
      <div className="bg-white p-4 sm:p-5 rounded-3xl border border-gray-200 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="h-3.5 w-3.5 text-gray-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search notifications by title or message..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Audience Pills */}
            <div className="flex items-center bg-gray-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setFilterAudience('ALL')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                  filterAudience === 'ALL'
                    ? 'bg-white text-gray-900 shadow-2xs font-black'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                All Audiences
              </button>
              <button
                type="button"
                onClick={() => setFilterAudience('STUDENT')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                  filterAudience === 'STUDENT'
                    ? 'bg-white text-kits-red shadow-2xs font-black'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Students Only
              </button>
              <button
                type="button"
                onClick={() => setFilterAudience('COORDINATOR')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                  filterAudience === 'COORDINATOR'
                    ? 'bg-white text-purple-700 shadow-2xs font-black'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Coordinators Only
              </button>
            </div>

            {/* Read Status Pills */}
            <div className="flex items-center bg-gray-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setFilterRead('ALL')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                  filterRead === 'ALL'
                    ? 'bg-white text-gray-900 shadow-2xs font-black'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                All Read States
              </button>
              <button
                type="button"
                onClick={() => setFilterRead('UNREAD')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                  filterRead === 'UNREAD'
                    ? 'bg-white text-emerald-700 shadow-2xs font-black'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Unread
              </button>
              <button
                type="button"
                onClick={() => setFilterRead('READ')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                  filterRead === 'READ'
                    ? 'bg-white text-gray-700 shadow-2xs font-black'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Read
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          3. NOTIFICATION LIST
          ========================================================================= */}
      {isLoading ? (
        <LoadingState message="Loading notifications log..." />
      ) : filteredBroadcasts.length === 0 ? (
        <EmptyState
          title="No Notifications Found"
          description={
            searchTerm
              ? 'No notifications match your search query. Try clearing the filter.'
              : 'No broadcast notifications have been dispatched yet. Click "+ New Broadcast" to send an announcement.'
          }
          icon={<Bell className="h-10 w-10 text-gray-300" />}
          action={
            <button
              type="button"
              onClick={handleOpenComposer}
              className="px-4 py-2 bg-kits-red text-white text-xs font-black uppercase tracking-wider rounded-xl hover:bg-red-700 transition shadow-2xs cursor-pointer flex items-center gap-1.5 mx-auto"
            >
              <Megaphone className="h-3.5 w-3.5" />
              <span>Compose First Broadcast</span>
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {/* Selection Management Toolbar */}
          <div className="bg-white px-4 py-3 rounded-2xl border border-gray-200 shadow-2xs flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-bold transition border border-gray-200 cursor-pointer"
              >
                {selectedIds.size === filteredBroadcasts.length && filteredBroadcasts.length > 0 ? (
                  <CheckSquare className="h-4 w-4 text-kits-red" />
                ) : (
                  <Square className="h-4 w-4 text-gray-400" />
                )}
                <span>
                  {selectedIds.size === filteredBroadcasts.length && filteredBroadcasts.length > 0
                    ? 'Deselect All'
                    : 'Select All'}
                </span>
              </button>

              <span className="text-xs text-gray-500 font-medium">
                {selectedIds.size > 0 ? (
                  <strong className="text-gray-900">{selectedIds.size} of {filteredBroadcasts.length} selected</strong>
                ) : (
                  `${filteredBroadcasts.length} broadcast${filteredBroadcasts.length !== 1 ? 's' : ''}`
                )}
              </span>
            </div>

            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={handleOpenDeleteModal}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-kits-red hover:bg-red-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer animate-fade-in"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Selected ({selectedIds.size})</span>
              </button>
            )}
          </div>

          {/* Broadcast Cards (One Card per Campaign) */}
          {filteredBroadcasts.map((b) => {
            const hasStudents = Number(b.student_deliveries) > 0;
            const hasCoordinators = Number(b.coordinator_deliveries) > 0;
            const isSelected = selectedIds.has(b.broadcast_id);

            // Audience display determination
            const isAllAudiences = b.audience === 'ALL' || (hasStudents && hasCoordinators);
            const isStudentOnly = b.audience === 'STUDENT' || (hasStudents && !hasCoordinators);
            const isCoordinatorOnly = b.audience === 'COORDINATOR' || (!hasStudents && hasCoordinators);

            return (
              <div
                key={b.broadcast_id}
                className={`p-4 sm:p-5 rounded-2xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isSelected
                    ? 'bg-red-50/40 border-red-200 shadow-2xs'
                    : 'bg-white border-gray-200 shadow-2xs hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {/* Selection Checkbox */}
                  <button
                    type="button"
                    onClick={() => handleToggleSelectOne(b.broadcast_id)}
                    className="p-1 -ml-1 text-gray-400 hover:text-kits-red transition shrink-0 cursor-pointer mt-0.5"
                    aria-label={isSelected ? 'Deselect broadcast' : 'Select broadcast'}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-5 w-5 text-kits-red" />
                    ) : (
                      <Square className="h-5 w-5 text-gray-300 hover:text-gray-500" />
                    )}
                  </button>

                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900 text-sm tracking-tight">
                        {b.title}
                      </span>

                      {/* Audience Badge */}
                      {isAllAudiences ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-50 text-kits-blue border border-blue-200 flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          <span>Students + Coordinators</span>
                        </span>
                      ) : isStudentOnly ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-50 text-kits-red border border-red-200 flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          <span>Students</span>
                        </span>
                      ) : isCoordinatorOnly ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                          <UserCheck className="h-3 w-3" />
                          <span>Coordinators</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-gray-100 text-gray-700 border border-gray-200">
                          {b.audience}
                        </span>
                      )}

                      {/* Read Status Badge */}
                      {Number(b.unread_count) > 0 ? (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200">
                          Unread
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-bold text-gray-500 bg-gray-100">
                          Read
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed font-normal whitespace-pre-wrap">
                      {b.message}
                    </p>

                    {/* Delivery Summary Metrics */}
                    <div className="flex items-center gap-2 flex-wrap pt-1 text-[11px] font-bold">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 text-gray-700 border border-gray-200">
                        <Users className="h-3.5 w-3.5 text-kits-red" />
                        <span>Students: <strong className="text-gray-900 font-mono">{b.student_deliveries}</strong> delivered</span>
                      </span>

                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 text-gray-700 border border-gray-200">
                        <UserCheck className="h-3.5 w-3.5 text-purple-600" />
                        <span>Coordinators: <strong className="text-gray-900 font-mono">{b.coordinator_deliveries}</strong> delivered</span>
                      </span>

                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 font-black">
                        <RadioTower className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Total Audience Reach: <strong className="font-mono">{b.total_deliveries}</strong></span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-right shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-gray-100 pl-8 sm:pl-0 self-start sm:self-center">
                  <div className="text-[11px] text-gray-400 font-mono">
                    {formatDateTime12h(b.created_at)}
                  </div>

                  <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 uppercase tracking-wider">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    Delivered
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* =========================================================================
          4. NEW BROADCAST COMPOSER MODAL (Compact 3-Step Flow)
          ========================================================================= */}
      {isComposerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-7 space-y-5 shadow-2xl border border-gray-200 modal-dialog-animate modal-dialog-responsive max-h-[calc(100dvh-2rem)] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-red-50 text-kits-red font-bold">
                  <Megaphone className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                    {composerStep === 'COMPOSE' && 'Compose Institutional Broadcast'}
                    {composerStep === 'REVIEW' && 'Review & Confirm Dispatch'}
                    {composerStep === 'SUCCESS' && 'Broadcast Dispatched'}
                  </h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                    Live System Communication
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsComposerOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Error Message inside Modal */}
            {actionError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                {actionError}
              </div>
            )}

            {/* STEP 1: COMPOSE */}
            {composerStep === 'COMPOSE' && (
              <form onSubmit={handleProceedToReview} className="space-y-4 text-xs">
                {/* Title */}
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-gray-600 block mb-1">
                    Notification Title <span className="text-kits-red">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., Hackathon Registration Deadline Extended"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
                  />
                </div>

                {/* Message */}
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-gray-600 block mb-1">
                    Message Description <span className="text-kits-red">*</span>
                  </label>
                  <textarea
                    required
                    rows={4}
                    placeholder="Enter the complete message or instructions for recipients..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs leading-relaxed focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue resize-none"
                  />
                </div>

                {/* Target Audience Selector */}
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-gray-600 block mb-2">
                    Target Recipient Audience <span className="text-kits-red">*</span>
                  </label>
                  <div className="space-y-2">
                    <label
                      className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition ${
                        targetAudience === 'ALL'
                          ? 'bg-blue-50/70 border-kits-blue ring-1 ring-kits-blue'
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <input
                        type="radio"
                        name="audience"
                        value="ALL"
                        checked={targetAudience === 'ALL'}
                        onChange={() => setTargetAudience('ALL')}
                        className="mt-0.5 text-kits-blue"
                      />
                      <div>
                        <span className="font-bold text-gray-900 block text-xs">
                          Students & Coordinators (System Broadcast)
                        </span>
                        <span className="text-[11px] text-gray-500">
                          Delivers announcement to all {recipientCounts.total_count} active institutional accounts.
                        </span>
                      </div>
                    </label>

                    <label
                      className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition ${
                        targetAudience === 'STUDENT'
                          ? 'bg-red-50/70 border-kits-red ring-1 ring-kits-red'
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <input
                        type="radio"
                        name="audience"
                        value="STUDENT"
                        checked={targetAudience === 'STUDENT'}
                        onChange={() => setTargetAudience('STUDENT')}
                        className="mt-0.5 text-kits-red"
                      />
                      <div>
                        <span className="font-bold text-gray-900 block text-xs">
                          Students Only
                        </span>
                        <span className="text-[11px] text-gray-500">
                          Delivers announcement exclusively to {recipientCounts.students_count} student accounts.
                        </span>
                      </div>
                    </label>

                    <label
                      className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition ${
                        targetAudience === 'COORDINATOR'
                          ? 'bg-purple-50/70 border-purple-600 ring-1 ring-purple-600'
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <input
                        type="radio"
                        name="audience"
                        value="COORDINATOR"
                        checked={targetAudience === 'COORDINATOR'}
                        onChange={() => setTargetAudience('COORDINATOR')}
                        className="mt-0.5 text-purple-600"
                      />
                      <div>
                        <span className="font-bold text-gray-900 block text-xs">
                          Coordinators Only
                        </span>
                        <span className="text-[11px] text-gray-500">
                          Delivers announcement exclusively to {recipientCounts.coordinators_count} assigned coordinators.
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Modal Actions */}
                <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsComposerOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs cursor-pointer flex items-center gap-1.5"
                  >
                    <span>Review Broadcast</span>
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2: REVIEW & CONFIRM */}
            {composerStep === 'REVIEW' && (
              <div className="space-y-4 text-xs">
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-3">
                  <div>
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Title</span>
                    <span className="font-black text-gray-900 text-sm">{title}</span>
                  </div>

                  <div>
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Message Content</span>
                    <p className="text-gray-700 leading-relaxed font-normal whitespace-pre-wrap">{message}</p>
                  </div>

                  <div className="border-t border-gray-200 pt-2 grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Audience</span>
                      <span className="font-bold text-kits-blue">
                        {targetAudience === 'ALL' ? 'Students & Coordinators' : targetAudience === 'STUDENT' ? 'Students Only' : 'Coordinators Only'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Target Recipients</span>
                      <span className="font-bold text-gray-900">
                        {targetAudience === 'ALL'
                          ? `${recipientCounts.total_count} accounts (${recipientCounts.students_count} students + ${recipientCounts.coordinators_count} coords)`
                          : targetAudience === 'STUDENT'
                          ? `${recipientCounts.students_count} students`
                          : `${recipientCounts.coordinators_count} coordinators`}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    disabled={isSending}
                    onClick={() => setComposerStep('COMPOSE')}
                    className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 cursor-pointer"
                  >
                    Back to Edit
                  </button>

                  <button
                    type="button"
                    disabled={isSending}
                    onClick={handleDispatchBroadcast}
                    className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 transition shadow-2xs cursor-pointer flex items-center gap-2"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>{isSending ? 'Dispatching Broadcast...' : 'Send Broadcast Now'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: ANIMATED SUCCESS */}
            {composerStep === 'SUCCESS' && sendSuccessResult && (
              <div className="space-y-5 text-center py-4">
                <div className="h-16 w-16 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-md animate-scale-up">
                  <CheckCircle2 className="h-9 w-9" />
                </div>

                <div className="space-y-1">
                  <h4 className="text-base font-black text-gray-900 tracking-tight">
                    Notification Broadcast Sent!
                  </h4>
                  <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
                    Your institutional message was delivered successfully across live student and coordinator portals.
                  </p>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 font-mono inline-block">
                  {sendSuccessResult.students_count} Students Reached • {sendSuccessResult.coordinators_count} Coordinators Reached
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setIsComposerOpen(false)}
                    className="px-6 py-2.5 bg-gray-950 text-white text-xs font-black uppercase tracking-wider rounded-xl hover:bg-black transition cursor-pointer shadow-md"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          5. PERMANENT DELETE CONFIRMATION MODAL
          ========================================================================= */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 modal-overlay-animate">
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-md w-full p-4 sm:p-7 space-y-4 sm:space-y-5 shadow-2xl border border-gray-200 modal-dialog-animate max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
              <div className="p-3 bg-red-50 text-kits-red rounded-2xl shrink-0 border border-red-100">
                <Trash2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-black uppercase text-gray-900 tracking-tight">
                  DELETE BROADCASTS?
                </h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                  Permanent Database Removal
                </p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-gray-600 leading-relaxed">
              <p className="font-bold text-gray-900 text-sm">
                You are about to permanently delete {selectedIds.size} broadcast notification{selectedIds.size > 1 ? 's' : ''}.
              </p>
              <p className="text-gray-500">
                This action removes the selected notification records from the database and cannot be undone.
              </p>
            </div>

            {/* Error Message inside Delete Modal */}
            {actionError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-3 border-t border-gray-100 w-full">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setIsDeleteModalOpen(false)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer disabled:opacity-50 disabled:pointer-events-none text-center"
              >
                Cancel
              </button>

              <DeleteButton
                disabled={isDeleting}
                loading={isDeleting}
                onClick={handleConfirmDelete}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl"
                label="Delete Permanently"
                loadingLabel="Deleting Permanently..."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
