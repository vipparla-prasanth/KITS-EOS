import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import type { Event } from '@kits-eos/shared/src/types/models';
import { 
  resolveEffectiveEventStatus, 
  getLifecycleBadgeTheme 
} from '@kits-eos/shared';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { Search, ArrowRight, Sparkles, Clock, FileSpreadsheet, Loader2, Store } from 'lucide-react';
import { RevealOnScroll } from '../components/motion/RevealOnScroll';
import { EventBannerImage } from '../components/ui/EventBannerImage';
import { downloadEventDirectoryExcel } from '../services/eventDirectoryService';

export function EventsList() {
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsWithStalls, setEventsWithStalls] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDownloadingDirectory, setIsDownloadingDirectory] = useState(false);
  const [now, setNow] = useState<number>(Date.now());

  // Periodic automatic lifecycle refresh
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const handleDownloadDirectory = async () => {
    try {
      setIsDownloadingDirectory(true);
      await downloadEventDirectoryExcel();
    } catch (err: any) {
      console.error('Failed to download event directory:', err);
      alert(err.message || 'Unable to generate the Event Directory. Please try again.');
    } finally {
      setIsDownloadingDirectory(false);
    }
  };

  const fetchEvents = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Query live Supabase database: Active events and approved/active public stalls
      const [eventsRes, stallsRes] = await Promise.all([
        supabase
          .from('events')
          .select('*')
          .eq('status', 'ACTIVE')
          .order('start_date', { ascending: true }),
        supabase
          .from('stalls')
          .select('event_id')
          .eq('status', 'APPROVED')
          .is('archived_at', null),
      ]);

      if (eventsRes.error) throw eventsRes.error;
      if (stallsRes.error) {
        // Surface actual database error to console without fabricating mock data
        console.error('Live Supabase query error fetching stalls for event cards:', stallsRes.error);
      }

      const activeStallEventIds = new Set<string>(
        (stallsRes.data || []).map((s: { event_id: string }) => s.event_id)
      );
      setEventsWithStalls(activeStallEventIds);
      setEvents((eventsRes.data as Event[]) || []);
    } catch (err: any) {
      console.error('Failed to fetch events:', err);
      setError(err.message || 'Failed to load flagship events.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();

    // Subscribe to realtime stalls changes so View Stalls button immediately reflects database updates
    const channel = supabase
      .channel(`public-events-stalls-sync-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'stalls' },
        () => {
          fetchEvents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchEvents]);

  const filteredEvents = events.filter(e => 
    e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (e.description && e.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-8">
      {/* Hero Welcome Section */}
      <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 rounded-3xl p-8 sm:p-12 text-white relative overflow-hidden shadow-lg border border-gray-800 stagger-1">
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-extrabold bg-white/10 text-red-200 border border-white/10 backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-kits-red" />
            KITS Akshar Institute of Technology Campus Events & Symposiums
          </div>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
            Discover, Compete & Excel at <span className="text-kits-red">KITS</span>
          </h1>
          <p className="text-sm sm:text-base text-gray-300 leading-relaxed max-w-2xl">
            Explore active flagship technical festivals, cultural symposiums, hackathons, and lab competitions. Register individually or build your dream team.
          </p>

          {/* Quick Search */}
          <div className="pt-2 max-w-md">
            <div className="relative">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search flagship events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-kits-red focus:bg-white/20 transition backdrop-blur-md"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Events Grid Header */}
      <RevealOnScroll>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black tracking-tight text-gray-900">Active Flagship Events</h2>
            <p className="text-xs text-gray-500 mt-0.5">Explore main events and their competition categories</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleDownloadDirectory}
              disabled={isDownloadingDirectory}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-gray-200 text-kits-blue hover:bg-blue-50 hover:border-blue-200 text-xs font-bold shadow-2xs transition cursor-pointer disabled:opacity-50"
              title="Download official Event, Venue & Coordinator Directory (.xlsx)"
            >
              {isDownloadingDirectory ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-kits-blue" />
              ) : (
                <FileSpreadsheet className="h-3.5 w-3.5 text-kits-blue" />
              )}
              <span>{isDownloadingDirectory ? 'Generating Directory...' : 'Download Event Directory (.xlsx)'}</span>
            </button>
            <span className="text-xs font-bold font-mono text-gray-500 bg-gray-100 px-2.5 py-2 rounded-xl border border-gray-200">
              {filteredEvents.length} Active {filteredEvents.length === 1 ? 'Event' : 'Events'}
            </span>
          </div>
        </div>
      </RevealOnScroll>

      {/* Events Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy="true" aria-label="Loading upcoming events">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="bg-white rounded-3xl border border-gray-200 shadow-2xs overflow-hidden flex flex-col justify-between min-h-[420px]"
            >
              <div className="h-48 w-full bg-gray-100 animate-pulse relative">
                <div className="absolute top-3 right-3 h-6 w-28 rounded-full bg-gray-200" />
              </div>
              <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                    <div className="h-4 w-28 bg-gray-100 rounded animate-pulse" />
                  </div>
                  <div className="h-6 w-4/5 bg-gray-200 rounded animate-pulse" />
                  <div className="space-y-1.5 pt-1">
                    <div className="h-3.5 w-full bg-gray-100 rounded animate-pulse" />
                    <div className="h-3.5 w-3/4 bg-gray-100 rounded animate-pulse" />
                  </div>
                </div>
                <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                  <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-4 bg-gray-200 rounded-full animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchEvents} />
      ) : filteredEvents.length === 0 ? (
        <EmptyState
          title="No Events Found"
          description={searchQuery ? "No events match your search query." : "There are currently no active flagship events published. Check back soon!"}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEvents.map((event, idx) => {
            const effectiveStatus = resolveEffectiveEventStatus(event, now);
            const badgeTheme = getLifecycleBadgeTheme(effectiveStatus);
            const isCompleted = effectiveStatus === 'COMPLETED';
            const isOngoing = effectiveStatus === 'ONGOING';
            const isUpcoming = effectiveStatus === 'UPCOMING';

            return (
              <RevealOnScroll key={event.id} delay={idx * 60}>
                <div
                  className={`bg-white rounded-3xl border border-gray-200 shadow-2xs overflow-hidden card-hover-interactive flex flex-col group h-full justify-between ${
                    isCompleted ? 'opacity-90' : ''
                  } ${isUpcoming ? 'ring-1 ring-blue-100' : ''}`}
                >
                  {/* Event Poster / Banner */}
                  <Link
                    to={`/events/${event.id}`}
                    className="h-48 w-full relative overflow-hidden bg-gray-100 block"
                    title={`View ${event.name} details`}
                  >
                    <EventBannerImage
                      bannerPath={event.banner_path}
                      eventName={event.name}
                      className={`w-full h-full ${isCompleted ? 'grayscale contrast-90' : ''}`}
                      imageClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-3 left-3 z-20">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-2xs ${badgeTheme.bg} ${badgeTheme.text} ${badgeTheme.border}`}
                      >
                        {badgeTheme.indicatorDot && (
                          <span className={`h-1.5 w-1.5 rounded-full ${badgeTheme.indicatorDot}`} />
                        )}
                        {badgeTheme.label}
                      </span>
                    </div>
                    <div className="absolute top-3 right-3 z-20">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-gray-900/80 backdrop-blur-md text-white shadow-2xs">
                        Flagship
                      </span>
                    </div>
                  </Link>

                  {/* Event Content */}
                  <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                    <div>
                      <Link to={`/events/${event.id}`} className="block">
                        <h3 className={`text-lg font-black transition line-clamp-1 ${
                          isCompleted ? 'text-gray-700' : 'text-gray-900 group-hover:text-kits-red'
                        }`}>
                          {event.name}
                        </h3>
                      </Link>
                      <p className="text-xs text-gray-600 mt-2 leading-relaxed line-clamp-2">
                        {event.description || 'Explore competitions and sub-events under this flagship event.'}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-gray-100 space-y-2 text-xs text-gray-500">
                      <div className="flex items-center gap-2 font-mono">
                        <Clock className="h-3.5 w-3.5 text-kits-blue shrink-0" />
                        <span>{formatDateTime12h(event.start_date)}</span>
                      </div>
                      <div className={`text-[11px] font-bold ${
                        isCompleted 
                          ? 'text-gray-400' 
                          : isOngoing 
                          ? 'text-kits-red font-black' 
                          : 'text-kits-blue'
                      }`}>
                        {effectiveStatus === 'REGISTRATIONS OPEN' && 'Explore Categories & Competitions'}
                        {effectiveStatus === 'UPCOMING' && 'Registration Opens Soon'}
                        {effectiveStatus === 'REGISTRATIONS CLOSED' && 'Registrations Closed'}
                        {effectiveStatus === 'ONGOING' && '● Happening Now'}
                        {effectiveStatus === 'COMPLETED' && 'Concluded Event'}
                      </div>
                    </div>

                    {/* Contextual Action Buttons */}
                    <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                      <Link
                        to={`/events/${event.id}`}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-2xs ${
                          isCompleted
                            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            : 'bg-red-50 text-kits-red hover:bg-red-100 border border-red-100'
                        }`}
                      >
                        <span>Explore Event</span>
                        <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                      </Link>

                      {eventsWithStalls.has(event.id) && (
                        <Link
                          to={`/stalls?eventId=${event.id}`}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-kits-blue bg-blue-50 hover:bg-blue-100 border border-blue-200 shadow-2xs transition group/stall"
                          title={`View stalls registered for ${event.name}`}
                        >
                          <Store className="h-3.5 w-3.5 text-kits-blue" />
                          <span>View Stalls</span>
                          <ArrowRight className="h-3 w-3 group-hover/stall:translate-x-0.5 transition-transform" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </RevealOnScroll>
            );
          })}
        </div>
      )}
    </div>
  );
}
