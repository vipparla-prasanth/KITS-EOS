import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import type { Event, Category, SubEvent } from '@kits-eos/shared/src/types/models';
import { 
  resolveEffectiveEventStatus, 
  resolveEffectiveSubEventStatus, 
  isSubEventRegistrationAvailable,
  getLifecycleBadgeTheme 
} from '@kits-eos/shared';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { NotFound } from './NotFound';
import { 
  Calendar, 
  Clock, 
  Folder, 
  ArrowRight, 
  ArrowLeft, 
  Layers,
  Store
} from 'lucide-react';
import { resolveEventBannerUrl } from '../utils/imageUtils';

export function EventDetails() {
  const { eventId } = useParams<{ eventId: string }>();

  const [event, setEvent] = useState<Event | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [directSubEvents, setDirectSubEvents] = useState<SubEvent[]>([]);
  const [hasApprovedStalls, setHasApprovedStalls] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [now, setNow] = useState<number>(Date.now());

  // Periodic automatic lifecycle refresh
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const loadEventData = async () => {
    if (!eventId) return;

    try {
      setIsLoading(true);
      setError(null);
      setIsNotFound(false);

      const [eventRes, catRes, subRes, stallsRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
        supabase.from('categories').select('*').eq('event_id', eventId).eq('status', 'ACTIVE').order('name'),
        supabase.from('sub_events').select('*').eq('event_id', eventId).is('category_id', null).eq('status', 'ACTIVE').order('name'),
        supabase
          .from('stalls')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', eventId)
          .eq('status', 'APPROVED')
          .is('archived_at', null),
      ]);

      if (eventRes.error) {
        // 22P02 = malformed/non-existent UUID parameter in route
        if (eventRes.error.code === '22P02' || eventRes.error.code === 'PGRST116') {
          setIsNotFound(true);
          return;
        }
        throw eventRes.error;
      }

      if (stallsRes.error) {
        console.error('Live Supabase query error fetching event stalls count:', stallsRes.error);
      }

      if (!eventRes.data) {
        setIsNotFound(true);
        return;
      }

      setEvent(eventRes.data as Event);
      setCategories((catRes.data as Category[]) || []);
      setDirectSubEvents((subRes.data as SubEvent[]) || []);
      setHasApprovedStalls(Boolean(stallsRes.count && stallsRes.count > 0));
    } catch (err: any) {
      console.error('Failed to load event:', err);
      setError(err.message || 'Event unavailable due to network or server error.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadEventData();
  }, [eventId]);

  if (isLoading) return <LoadingState message="Loading event information..." />;
  if (isNotFound) return <NotFound />;
  if (error || !event) return <ErrorState message={error || 'Event unavailable.'} onRetry={loadEventData} />;

  const effectiveEventStatus = resolveEffectiveEventStatus(event, now);
  const eventBadgeTheme = getLifecycleBadgeTheme(effectiveEventStatus);
  const isEventCompleted = effectiveEventStatus === 'COMPLETED';

  return (
    <div className="space-y-8">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Link
          to="/events"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-kits-red transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to All Events</span>
        </Link>

        {hasApprovedStalls && (
          <Link
            to={`/stalls?eventId=${event.id}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-kits-blue bg-blue-50 hover:bg-blue-100 border border-blue-200/80 shadow-2xs transition group"
          >
            <Store className="h-3.5 w-3.5 text-kits-blue" />
            <span>View Event Stalls</span>
            <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        )}
      </div>

      {/* Main Event Hero Banner */}
      <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden shadow-sm">
        {event.banner_path ? (
          <div className="h-64 sm:h-80 w-full relative overflow-hidden bg-gray-900">
            <img
              src={resolveEventBannerUrl(event.banner_path) || event.banner_path}
              alt={event.name}
              className={`w-full h-full object-cover ${isEventCompleted ? 'grayscale contrast-90' : ''}`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
            <div className="absolute bottom-6 left-6 sm:left-8 right-6 text-white space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-kits-red text-white shadow">
                  Flagship Event
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-2xs ${eventBadgeTheme.bg} ${eventBadgeTheme.text} ${eventBadgeTheme.border}`}
                >
                  {eventBadgeTheme.indicatorDot && (
                    <span className={`h-1.5 w-1.5 rounded-full ${eventBadgeTheme.indicatorDot}`} />
                  )}
                  {eventBadgeTheme.label}
                </span>
              </div>
              <h1 className="text-2xl sm:text-4xl font-black tracking-tight">{event.name}</h1>
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-r from-gray-900 to-gray-800 p-8 text-white space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-kits-red text-white shadow">
                Flagship Event
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-2xs ${eventBadgeTheme.bg} ${eventBadgeTheme.text} ${eventBadgeTheme.border}`}
              >
                {eventBadgeTheme.indicatorDot && (
                  <span className={`h-1.5 w-1.5 rounded-full ${eventBadgeTheme.indicatorDot}`} />
                )}
                {eventBadgeTheme.label}
              </span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight">{event.name}</h1>
          </div>
        )}

        <div className="p-6 sm:p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-4">
              <div className="space-y-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-400">About Event</h3>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {event.description || 'No description provided.'}
                </p>
              </div>

              {hasApprovedStalls && (
                <div className="pt-1">
                  <Link
                    to={`/stalls?eventId=${event.id}`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-kits-blue border border-blue-200 text-xs font-bold shadow-2xs transition group"
                  >
                    <Store className="h-4 w-4 text-kits-blue" />
                    <span>View Event Stalls</span>
                    <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </div>
              )}
            </div>

            <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200/80 space-y-4 text-xs">
              <h4 className="font-extrabold text-gray-900 uppercase tracking-wider text-[11px] border-b border-gray-200 pb-2">
                Event Schedule & Registration
              </h4>
              <div>
                <span className="text-gray-400 font-bold uppercase block text-[10px] mb-0.5">Start Time</span>
                <p className="font-bold text-gray-900 font-mono flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-kits-red" />
                  {formatDateTime12h(event.start_date)}
                </p>
              </div>
              <div>
                <span className="text-gray-400 font-bold uppercase block text-[10px] mb-0.5">End Time</span>
                <p className="font-bold text-gray-900 font-mono flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-kits-blue" />
                  {formatDateTime12h(event.end_date)}
                </p>
              </div>
              {event.registration_end_date && (
                <div>
                  <span className="text-gray-400 font-bold uppercase block text-[10px] mb-0.5">Registration Deadline</span>
                  <p className="font-bold text-gray-800 font-mono flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-amber-600" />
                    {formatDateTime12h(event.registration_end_date)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Categories Section (if any) */}
      {categories.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5 text-kits-red" />
            <h2 className="text-lg font-black tracking-tight text-gray-900">Competition Categories</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {categories.map((category) => (
              <Link
                key={category.id}
                to={`/events/${eventId}/categories/${category.id}`}
                className="bg-white rounded-2xl border border-gray-200 p-6 shadow-2xs hover:shadow-md transition flex flex-col justify-between group"
              >
                <div className="space-y-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-kits-blue bg-blue-50 px-2 py-0.5 rounded">
                    Category
                  </span>
                  <h3 className="text-base font-extrabold text-gray-900 group-hover:text-kits-red transition">
                    {category.name}
                  </h3>
                  {category.description && (
                    <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                      {category.description}
                    </p>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs font-bold text-kits-blue">
                  <span>View Sub-Events</span>
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Direct Sub-events Section (if any) */}
      {directSubEvents.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-kits-blue" />
            <h2 className="text-lg font-black tracking-tight text-gray-900">Direct Competitions & Sub-events</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {directSubEvents.map((sub) => {
              const subStatus = resolveEffectiveSubEventStatus(sub, event, now);
              const isRegAvailable = isSubEventRegistrationAvailable(sub, event, now);
              const subBadge = getLifecycleBadgeTheme(subStatus);
              const isSubCompleted = subStatus === 'COMPLETED';
              const isSubOngoing = subStatus === 'ONGOING';

              return (
                <Link
                  key={sub.id}
                  to={`/events/${eventId}/sub-events/${sub.id}`}
                  className={`bg-white rounded-2xl border border-gray-200 p-6 shadow-2xs hover:shadow-md transition flex flex-col justify-between group ${
                    isSubCompleted ? 'opacity-85' : ''
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-gray-100 text-gray-800">
                          {sub.participation_type} {sub.participation_type !== 'SOLO' && `(Max ${sub.max_team_size})`}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${subBadge.bg} ${subBadge.text} ${subBadge.border}`}
                        >
                          {subBadge.indicatorDot && (
                            <span className={`h-1.5 w-1.5 rounded-full ${subBadge.indicatorDot}`} />
                          )}
                          {subBadge.label}
                        </span>
                      </div>
                      {sub.is_free || (!sub.fee_amount_solo && !sub.fee_amount_team) ? (
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-300">
                          FREE EVENT
                        </span>
                      ) : (
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border bg-blue-50 text-kits-blue border-blue-200 font-mono">
                          ₹{sub.fee_amount_solo || sub.fee_amount_team}
                        </span>
                      )}
                    </div>

                    <h3 className={`text-base font-extrabold transition ${
                      isSubCompleted ? 'text-gray-700' : 'text-gray-900 group-hover:text-kits-red'
                    }`}>
                      {sub.name}
                    </h3>

                    {sub.description && (
                      <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                        {sub.description}
                      </p>
                    )}
                  </div>

                  <div className={`mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs font-bold ${
                    isSubCompleted ? 'text-gray-400' : isSubOngoing ? 'text-kits-red font-black' : 'text-kits-blue'
                  }`}>
                    <span>
                      {isSubCompleted && 'Concluded • View Details'}
                      {isSubOngoing && (isRegAvailable ? '● Happening Now • Register Now' : '● Happening Now • Details')}
                      {!isSubCompleted && !isSubOngoing && isRegAvailable && 'Register & Full Details'}
                      {!isSubCompleted && !isSubOngoing && !isRegAvailable && subStatus === 'UPCOMING' && 'Registration Opens Soon • Details'}
                      {!isSubCompleted && !isSubOngoing && !isRegAvailable && subStatus !== 'UPCOMING' && 'Registrations Closed • Details'}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
