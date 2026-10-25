import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../api/client';
import { formatRelativeTime } from '../utils/date';
import { 
  Bell, 
  Trophy, 
  Award, 
  CheckCircle2, 
  ClipboardList, 
  Calendar, 
  Megaphone, 
  CreditCard,
  ArrowRight,
  Store
} from 'lucide-react';

export interface NotificationCenterProps {
  portal: 'STUDENT' | 'COORDINATOR' | 'ADMIN';
  token?: string | null;
  onNavigate?: (path: string) => void;
  className?: string;
  badgeClassName?: string;
  align?: 'left' | 'right';
}

export interface PortalNotificationItem {
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

function resolveNotificationBadge(category: string, type: string) {
  const cat = (category || '').toUpperCase();
  const t = (type || '').toUpperCase();

  if (cat === 'RESULTS' || t.includes('RESULT')) {
    return {
      label: 'Results',
      badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
      icon: <Trophy className="h-3.5 w-3.5 text-amber-600 shrink-0" />
    };
  }

  if (cat === 'CERTIFICATES' || t.includes('CERTIFICATE')) {
    return {
      label: 'Certificate',
      badgeClass: 'bg-emerald-50 text-emerald-900 border-emerald-200',
      icon: <Award className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
    };
  }

  if (cat === 'ATTENDANCE' || t.includes('ATTENDANCE')) {
    return {
      label: 'Attendance',
      badgeClass: 'bg-blue-50 text-[#003366] border-blue-200',
      icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
    };
  }

  if (cat === 'REGISTRATION' || t.includes('REGISTRATION')) {
    return {
      label: 'Registration',
      badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
      icon: <ClipboardList className="h-3.5 w-3.5 text-slate-700 shrink-0" />
    };
  }

  if (cat === 'PAYMENTS' || t.includes('PAYMENT')) {
    return {
      label: 'Payment',
      badgeClass: 'bg-emerald-50 text-emerald-900 border-emerald-200',
      icon: <CreditCard className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
    };
  }

  if (cat === 'EVENT' || t.includes('EVENT')) {
    return {
      label: 'Event Update',
      badgeClass: 'bg-red-50 text-[#C8102E] border-red-200',
      icon: <Calendar className="h-3.5 w-3.5 text-[#C8102E]" />
    };
  }

  if (cat === 'STALL' || t.includes('STALL')) {
    return {
      label: 'Stall',
      badgeClass: 'bg-blue-50 text-[#003366] border-blue-200',
      icon: <Store className="h-3.5 w-3.5 text-[#003366] shrink-0" />
    };
  }

  return {
    label: 'Notice',
    badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
    icon: <Megaphone className="h-3.5 w-3.5 text-gray-600 shrink-0" />
  };
}

export function NotificationCenter({
  portal,
  token = null,
  onNavigate,
  className = '',
  badgeClassName = '',
  align = 'right'
}: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<PortalNotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const hasEnsuredWelcome = useRef(false);
  const alreadyMarkedIdsRef = useRef<Set<string>>(new Set());
  const inFlightMarkIdsRef = useRef<Set<string>>(new Set());

  // Keep latest state & callbacks in refs to decouple from Realtime subscription lifecycle
  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // 1. Ensure welcome notification exactly once per user/coordinator
  const ensureWelcome = useCallback(async () => {
    if (hasEnsuredWelcome.current) return;
    if (portal === 'COORDINATOR' && !token) return;
    try {
      if (portal !== 'COORDINATOR') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
      }
      await supabase.rpc('ensure_welcome_notification', {
        p_token: token || null
      });
      hasEnsuredWelcome.current = true;
    } catch {
      // Non-blocking
    }
  }, [token, portal]);

  // 2. Fetch authoritative unread count
  const fetchUnreadCount = useCallback(async () => {
    if (portal === 'COORDINATOR' && !token) {
      setUnreadCount(0);
      return;
    }
    try {
      if (portal !== 'COORDINATOR') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setUnreadCount(0);
          return;
        }
      }
      const { data, error: err } = await supabase.rpc('get_portal_unread_count', {
        p_token: token || null
      });
      if (!err && typeof data === 'number') {
        setUnreadCount(data);
      }
    } catch {
      // Non-blocking
    }
  }, [token, portal]);

  const fetchUnreadCountRef = useRef(fetchUnreadCount);
  useEffect(() => {
    fetchUnreadCountRef.current = fetchUnreadCount;
  }, [fetchUnreadCount]);

  // 3. Fetch notifications and automatically mark visible ones as read
  const fetchAndAutoMarkNotifications = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: err } = await supabase.rpc('get_portal_notifications', {
        p_limit: 10,
        p_offset: 0,
        p_token: token || null
      });

      if (err) throw err;

      const rawItems: PortalNotificationItem[] = Array.isArray(data) ? data : [];
      
      // Canonical deduplication using database ID
      const seenIds = new Set<string>();
      const items: PortalNotificationItem[] = [];
      for (const item of rawItems) {
        if (item?.id && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          // If already marked locally in this session, ensure is_read is true in state
          if (alreadyMarkedIdsRef.current.has(item.id)) {
            items.push({ ...item, is_read: true, read_at: item.read_at || new Date().toISOString() });
          } else {
            items.push(item);
          }
        }
      }
      setNotifications(items);

      // AUTOMATIC READ-ON-OPEN:
      // Identify which items among the presented ones are currently UNREAD and not already marked
      const unreadIds = items
        .filter((n) => !n.is_read && !alreadyMarkedIdsRef.current.has(n.id) && !inFlightMarkIdsRef.current.has(n.id))
        .map((n) => n.id);

      if (unreadIds.length > 0) {
        unreadIds.forEach((id) => inFlightMarkIdsRef.current.add(id));
        const nowIso = new Date().toISOString();

        // 1. Immediately update in-memory state & decrement badge so user sees instant transition
        setNotifications((prev) =>
          prev.map((n) => (unreadIds.includes(n.id) ? { ...n, is_read: true, read_at: nowIso } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - unreadIds.length));

        // 2. Authoritative backend RPC to persist read_at and is_read in database
        try {
          const { error: markErr } = await supabase.rpc('mark_notifications_read_on_open', {
            p_notification_ids: unreadIds,
            p_token: token || null
          });

          if (markErr) {
            console.warn('[NotificationCenter] Notice marking read on server:', markErr);
            fetchUnreadCountRef.current();
          } else {
            unreadIds.forEach((id) => alreadyMarkedIdsRef.current.add(id));
          }
        } finally {
          unreadIds.forEach((id) => inFlightMarkIdsRef.current.delete(id));
        }
      }
    } catch (err: any) {
      console.error('Failed to load notifications in NotificationCenter:', err);
      setError('Failed to load notifications.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const fetchAndAutoMarkRef = useRef(fetchAndAutoMarkNotifications);
  useEffect(() => {
    fetchAndAutoMarkRef.current = fetchAndAutoMarkNotifications;
  }, [fetchAndAutoMarkNotifications]);

  // Setup on mount: ensure welcome notification + initial unread count
  useEffect(() => {
    ensureWelcome().then(() => {
      fetchUnreadCountRef.current();
    });
  }, [ensureWelcome]);

  // Periodic polling & Window focus refresh (Runs for ALL portals including Coordinator)
  useEffect(() => {
    let lastPollTime = Date.now();
    const handleFocus = () => {
      // Avoid firing if focus happens within 15 seconds of last check
      if (Date.now() - lastPollTime >= 15000) {
        lastPollTime = Date.now();
        fetchUnreadCountRef.current();
        if (isOpenRef.current) {
          fetchAndAutoMarkRef.current();
        }
      }
    };

    window.addEventListener('focus', handleFocus);

    // Polling every 45 seconds as resilient fallback when tab is visible
    const pollInterval = setInterval(() => {
      if (!document.hidden) {
        lastPollTime = Date.now();
        fetchUnreadCountRef.current();
      }
    }, 45000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(pollInterval);
    };
  }, []);

  // Realtime updates subscription (ADMIN and STUDENT only; Coordinator uses secure polling)
  useEffect(() => {
    // Coordinators authenticate via custom backend session tokens, not Supabase Auth JWT.
    // Supabase Realtime postgres_changes enforces Supabase Auth RLS.
    // Coordinator notifications are securely handled via periodic polling & focus refresh.
    if (portal === 'COORDINATOR') {
      return;
    }

    let channelInstance: any = null;
    let isSubscribed = true;

    // Only establish Realtime subscription for authenticated users to avoid CHANNEL_ERROR and 401s
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isSubscribed || !session?.user?.id) {
        return;
      }

      try {
        // Deterministic topic per user session to avoid collision and channel proliferation
        const topic = `notifs-${portal.toLowerCase()}-${session.user.id.slice(0, 8)}`;

        const existingChannel = supabase.getChannels().find((ch: any) => ch.topic === topic || ch.topic === `realtime:${topic}`);
        if (existingChannel) {
          try {
            supabase.removeChannel(existingChannel);
          } catch {
            // Ignore channel removal error
          }
        }

        channelInstance = supabase
          .channel(topic)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'notifications',
              filter: `user_id=eq.${session.user.id}`
            },
            () => {
              fetchUnreadCountRef.current();
              if (isOpenRef.current) {
                fetchAndAutoMarkRef.current();
              }
            }
          );

        // Subscribe only after all callbacks are registered
        channelInstance.subscribe((status: string, err?: Error) => {
          if (err) {
            console.warn(`[NotificationCenter] Realtime subscription status (${status}):`, err);
          }
        });
      } catch (realtimeErr) {
        // Fail safely: Never allow a Realtime error to crash the portal UI
        console.warn('[NotificationCenter] Realtime subscription could not be established; falling back to polling:', realtimeErr);
      }
    });

    return () => {
      isSubscribed = false;
      if (channelInstance) {
        try {
          supabase.removeChannel(channelInstance);
        } catch (cleanupErr) {
          console.warn('[NotificationCenter] Error removing channel:', cleanupErr);
        }
        channelInstance = null;
      }
    };
  }, [portal]);

  // Outside click & Escape key dismiss
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      fetchAndAutoMarkNotifications();
    }
  };

  const handleNotificationClick = (item: PortalNotificationItem) => {
    setIsOpen(false);

    let targetPath = '/notifications';

    if (portal === 'STUDENT') {
      const cat = (item.category || '').toUpperCase();
      const type = (item.notification_type || '').toUpperCase();

      if (cat === 'REGISTRATION' || cat === 'PAYMENTS' || type.includes('PAYMENT') || type.includes('REGISTRATION')) {
        targetPath = '/my-registrations';
      } else if (cat === 'CERTIFICATES' || type.includes('CERTIFICATE')) {
        targetPath = '/certificates';
      } else if (cat === 'RESULTS' || type.includes('RESULT')) {
        targetPath = '/certificates';
      } else if (cat === 'ATTENDANCE' || type.includes('ATTENDANCE')) {
        targetPath = '/attendance';
      } else if (cat === 'EVENT') {
        targetPath = '/events';
      } else if (cat === 'STALL' || type.includes('STALL')) {
        targetPath = '/stalls';
      } else {
        targetPath = '/notifications';
      }
    } else if (portal === 'COORDINATOR') {
      targetPath = '/coordinator';
    } else if (portal === 'ADMIN') {
      const cat = (item.category || '').toUpperCase();
      const type = (item.notification_type || '').toUpperCase();
      if (cat === 'STALL' || type.includes('STALL')) {
        targetPath = '/admin/stalls';
      } else {
        targetPath = '/admin/notifications';
      }
    }

    if (onNavigate) {
      onNavigate(targetPath);
    } else {
      window.location.href = targetPath;
    }
  };

  const handleViewAll = () => {
    setIsOpen(false);
    let allPath = '/notifications';
    if (portal === 'ADMIN') {
      allPath = '/admin/notifications';
    } else if (portal === 'COORDINATOR') {
      allPath = '/coordinator';
    }

    if (onNavigate) {
      onNavigate(allPath);
    } else {
      window.location.href = allPath;
    }
  };

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      {/* Notification Bell Button */}
      <button
        type="button"
        onClick={handleToggle}
        className={`relative p-2 rounded-xl border transition cursor-pointer flex items-center justify-center shrink-0 ${
          isOpen
            ? 'bg-red-50 text-kits-red border-red-200 shadow-2xs'
            : 'border-gray-200/80 hover:border-gray-300 bg-gray-50/70 text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
        }`}
        title="Notifications Center"
        aria-label="Notifications Center"
        aria-expanded={isOpen}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            className={`absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-[#C8102E] text-white text-[9px] font-black flex items-center justify-center animate-pulse shadow-2xs ${badgeClassName}`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Premium Notification Center Dropdown */}
      {isOpen && (
        <div
          className={`absolute top-full mt-2.5 w-[330px] sm:w-[380px] max-w-[calc(100vw-1.5rem)] glass-surface-dropdown rounded-2xl border border-gray-200/90 shadow-2xl p-0 z-50 overflow-hidden flex flex-col text-left dropdown-animate ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
          style={{ maxHeight: 'calc(100vh - 120px)' }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-gray-900">
                Notifications
              </span>
              {unreadCount > 0 ? (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-kits-red">
                  {unreadCount} new
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                  All caught up
                </span>
              )}
            </div>
            <span className="text-[10px] font-bold text-gray-400">
              {portal} PORTAL
            </span>
          </div>

          {/* List Content */}
          <div className="overflow-y-auto flex-1 divide-y divide-gray-100 max-h-[380px] sm:max-h-[420px]">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse flex items-start gap-3 p-2">
                    <div className="h-8 w-8 rounded-xl bg-gray-200 shrink-0" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-3 bg-gray-200 rounded w-3/4" />
                      <div className="h-2.5 bg-gray-100 rounded w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="p-6 text-center text-xs text-red-600 space-y-1">
                <p className="font-bold">{error}</p>
                <button
                  type="button"
                  onClick={fetchAndAutoMarkNotifications}
                  className="text-kits-blue underline text-[11px] cursor-pointer"
                >
                  Retry loading
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <div className="h-10 w-10 mx-auto rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                  <Bell className="h-5 w-5 opacity-60" />
                </div>
                <div className="text-xs font-bold text-gray-800">No Notifications</div>
                <p className="text-[11px] text-gray-500 max-w-[240px] mx-auto leading-relaxed">
                  You are all caught up. Updates on registrations, payments, attendance, and results will appear here.
                </p>
              </div>
            ) : (
              notifications.map((item) => {
                const badge = resolveNotificationBadge(item.category, item.notification_type);
                return (
                  <div
                    key={item.id}
                    onClick={() => handleNotificationClick(item)}
                    className={`p-3.5 transition cursor-pointer hover:bg-gray-50/90 relative flex items-start gap-3 group ${
                      !item.is_read
                        ? 'bg-red-50/30'
                        : 'bg-white'
                    }`}
                  >
                    {/* Category Icon Bubble */}
                    <div className="h-8 w-8 rounded-xl bg-white border border-gray-200/80 shadow-2xs flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition">
                      {badge.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${badge.badgeClass}`}
                        >
                          {badge.label}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap shrink-0">
                          {formatRelativeTime(item.created_at)}
                        </span>
                      </div>

                      <div className="text-xs font-bold text-gray-900 leading-tight mb-1 truncate">
                        {item.title}
                      </div>

                      <p className="text-[11px] text-gray-600 leading-relaxed line-clamp-2">
                        {item.message}
                      </p>
                    </div>

                    {/* Unread Accent Dot */}
                    {!item.is_read && (
                      <span
                        className="h-2 w-2 rounded-full bg-[#C8102E] shrink-0 mt-1 shadow-2xs"
                        title="Unread"
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Action */}
          <div className="px-4 py-2.5 bg-gray-50/90 border-t border-gray-100 flex items-center justify-between">
            <button
              type="button"
              onClick={handleViewAll}
              className="text-xs font-bold text-kits-blue hover:text-blue-800 transition inline-flex items-center gap-1 cursor-pointer"
            >
              <span>View all notifications</span>
              <ArrowRight className="h-3 w-3" />
            </button>
            <span className="text-[10px] text-gray-400">
              KITS-EOS
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
