import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatRelativeTime } from '@kits-eos/shared/src/utils/date';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { 
  Bell, 
  RefreshCw, 
  Clock,
  Trophy,
  Award,
  CheckCircle2,
  Calendar,
  ClipboardList,
  ArrowRight,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Store
} from 'lucide-react';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  notification_type: string;
  category: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, any>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  broadcast_id?: string | null;
}

const PAGE_SIZE = 25;

function resolveCategoryDesign(category: string, type: string) {
  const cat = (category || '').toUpperCase();
  const t = (type || '').toUpperCase();

  if (cat === 'RESULTS' || t.includes('RESULT')) {
    return {
      categoryLabel: '🏆 Results',
      badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
      icon: <Trophy className="h-4 w-4 text-amber-600" />,
      actionRoute: '/certificates',
      actionLabel: 'View Results & Credentials',
    };
  }

  if (cat === 'CERTIFICATES' || t.includes('CERTIFICATE')) {
    return {
      categoryLabel: '🎓 Certificate',
      badgeClass: 'bg-emerald-50 text-emerald-900 border-emerald-200',
      icon: <Award className="h-4 w-4 text-emerald-600" />,
      actionRoute: '/certificates',
      actionLabel: 'View Certificate',
    };
  }

  if (cat === 'ATTENDANCE' || t.includes('ATTENDANCE')) {
    return {
      categoryLabel: '🎟️ Attendance',
      badgeClass: 'bg-blue-50 text-[#003366] border-blue-200',
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      actionRoute: '/attendance',
      actionLabel: 'Check Attendance Status',
    };
  }

  if (cat === 'REGISTRATION' || t.includes('REGISTRATION')) {
    return {
      categoryLabel: '📋 Pass & Token',
      badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
      icon: <ClipboardList className="h-4 w-4 text-slate-700" />,
      actionRoute: '/my-registrations',
      actionLabel: 'View My Passes',
    };
  }

  if (cat === 'PAYMENTS' || t.includes('PAYMENT')) {
    return {
      categoryLabel: '💳 Payment',
      badgeClass: 'bg-emerald-50 text-emerald-900 border-emerald-200',
      icon: <CreditCard className="h-4 w-4 text-emerald-700" />,
      actionRoute: '/my-registrations',
      actionLabel: 'View Registration & Receipt',
    };
  }

  if (cat === 'EVENT' || t.includes('EVENT')) {
    return {
      categoryLabel: '📅 Event Update',
      badgeClass: 'bg-red-50 text-[#C8102E] border-red-200',
      icon: <Calendar className="h-4 w-4 text-[#C8102E]" />,
      actionRoute: '/events',
      actionLabel: 'Explore Events',
    };
  }

  if (cat === 'STALL' || t.includes('STALL')) {
    return {
      categoryLabel: '🎪 Stall',
      badgeClass: 'bg-blue-50 text-[#003366] border-blue-200',
      icon: <Store className="h-4 w-4 text-[#003366]" />,
      actionRoute: '/stalls',
      actionLabel: 'View Stall Directory',
    };
  }

  return {
    categoryLabel: '📢 Notice',
    badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
    icon: <Megaphone className="h-4 w-4 text-gray-600" />,
    actionRoute: null,
    actionLabel: null,
  };
}

export function StudentNotifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const hasEnsuredWelcome = useRef(false);

  // Authoritative fetch with Automatic Read-on-Open
  const fetchNotifications = useCallback(async (pageIndex: number = page) => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      // 1. Ensure welcome notification exists (idempotent)
      if (!hasEnsuredWelcome.current) {
        await supabase.rpc('ensure_welcome_notification', { p_token: null });
        hasEnsuredWelcome.current = true;
      }

      // 2. Fetch paginated notifications using server-side RPC
      const offset = pageIndex * PAGE_SIZE;
      const { data, error: err } = await supabase.rpc('get_portal_notifications', {
        p_limit: PAGE_SIZE + 1, // +1 to check hasMore
        p_offset: offset,
        p_token: null
      });

      if (err) throw err;

      const rawItems: NotificationItem[] = Array.isArray(data) ? data : [];
      const hasNext = rawItems.length > PAGE_SIZE;
      const presentedItems = hasNext ? rawItems.slice(0, PAGE_SIZE) : rawItems;

      setHasMore(hasNext);
      setNotifications(presentedItems);

      // 3. CRITICAL AUTOMATIC READ-ON-OPEN:
      // Exactly the notifications presented/visible to the user become READ automatically.
      // There is NO manual "Mark as Read" or "Mark All as Read" button.
      const unreadIds = presentedItems.filter((n) => !n.is_read).map((n) => n.id);

      if (unreadIds.length > 0) {
        const { error: markErr } = await supabase.rpc('mark_notifications_read_on_open', {
          p_notification_ids: unreadIds,
          p_token: null
        });

        if (!markErr) {
          // Immediately reflect in UI that visible notifications are now READ
          setNotifications((prev) =>
            prev.map((n) => (unreadIds.includes(n.id) ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
          );
        }
      }
    } catch (err: any) {
      console.error('Failed to load notifications:', err);
      setError(err.message || 'Failed to load notifications.');
    } finally {
      setIsLoading(false);
    }
  }, [user, page]);

  useEffect(() => {
    fetchNotifications(page);
  }, [fetchNotifications, page]);

  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const fetchNotifsRef = useRef(fetchNotifications);
  useEffect(() => {
    fetchNotifsRef.current = fetchNotifications;
  }, [fetchNotifications]);

  // Realtime updates subscription
  useEffect(() => {
    if (!user) return;

    let channel: any = null;
    try {
      const topic = `student-notifs-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            fetchNotifsRef.current(pageRef.current);
          }
        );
      channel.subscribe((status: string, err?: Error) => {
        if (err) console.warn('[StudentNotifications] Realtime warning:', status, err);
      });
    } catch (err) {
      console.warn('[StudentNotifications] Failed to subscribe to notifications:', err);
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // ignore
        }
      }
    };
  }, [user]);

  const handleActionClick = (destination: string) => {
    navigate(destination);
  };

  const handleNextPage = () => {
    if (hasMore) {
      setPage((prev) => prev + 1);
    }
  };

  const handlePrevPage = () => {
    if (page > 0) {
      setPage((prev) => prev - 1);
    }
  };

  if (isLoading && notifications.length === 0) {
    return <LoadingState message="Loading your notification center..." />;
  }

  if (error && notifications.length === 0) {
    return <ErrorState message={error} onRetry={() => fetchNotifications(page)} />;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-16 font-sans page-enter">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-red-50 text-[#C8102E] border border-red-100 shadow-2xs">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black text-gray-900 tracking-tight">Notification Center</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Auto Synced
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Official announcements, verified payments, attendance confirmations, and published certificates.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fetchNotifications(page)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-bold text-gray-700 transition cursor-pointer shadow-2xs"
            title="Refresh notifications"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <EmptyState
          title="No Notifications Yet"
          description="You're all caught up! Event updates, registrations, and published credentials will appear here automatically."
          icon={<Bell className="h-8 w-8 text-gray-400" />}
        />
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => {
            const ctx = resolveCategoryDesign(n.category, n.notification_type);

            return (
              <div
                key={n.id}
                className="p-5 rounded-3xl border bg-white border-gray-200/80 shadow-2xs transition space-y-3 hover:border-gray-300"
              >
                {/* Header row with Category, Title, Timestamp */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2.5 rounded-xl bg-gray-50 border border-gray-100 text-gray-700 shrink-0 mt-0.5 shadow-2xs">
                      {ctx.icon}
                    </div>

                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${ctx.badgeClass}`}>
                          {ctx.categoryLabel}
                        </span>

                        <span className="text-[10px] text-gray-400 font-mono">
                          {formatRelativeTime(n.created_at)}
                        </span>
                      </div>

                      <h3 className="text-sm font-bold text-gray-900 tracking-tight">
                        {n.title}
                      </h3>

                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-mono">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(n.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Message Body */}
                <p className="text-xs text-gray-700 leading-relaxed pl-12 whitespace-pre-wrap">
                  {n.message}
                </p>

                {/* Safe Navigation Action Button */}
                {ctx.actionRoute && (
                  <div className="pl-12 pt-1 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => handleActionClick(ctx.actionRoute!)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-900 hover:bg-[#003366] text-white text-xs font-bold transition shadow-2xs cursor-pointer active:scale-95"
                    >
                      <span>{ctx.actionLabel}</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Pagination Controls */}
          <div className="flex items-center justify-between pt-4 px-2">
            <button
              type="button"
              disabled={page === 0 || isLoading}
              onClick={handlePrevPage}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer shadow-2xs"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Previous</span>
            </button>

            <span className="text-xs font-mono text-gray-500">
              Page {page + 1}
            </span>

            <button
              type="button"
              disabled={!hasMore || isLoading}
              onClick={handleNextPage}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer shadow-2xs"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
