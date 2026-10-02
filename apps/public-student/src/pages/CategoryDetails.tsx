import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import type { Category, Event, SubEvent } from '@kits-eos/shared/src/types/models';
import { 
  resolveEffectiveSubEventStatus, 
  isSubEventRegistrationAvailable,
  getLifecycleBadgeTheme 
} from '@kits-eos/shared';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { NotFound } from './NotFound';
import { ArrowLeft, ArrowRight, Layers } from 'lucide-react';

export function CategoryDetails() {
  const { eventId, categoryId } = useParams<{ eventId: string; categoryId: string }>();

  const [category, setCategory] = useState<Category | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [subEvents, setSubEvents] = useState<SubEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [now, setNow] = useState<number>(Date.now());

  // Periodic automatic lifecycle refresh
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const loadCategoryData = async () => {
    if (!categoryId || !eventId) return;

    try {
      setIsLoading(true);
      setError(null);
      setIsNotFound(false);

      const [catRes, evRes, subRes] = await Promise.all([
        supabase.from('categories').select('*').eq('id', categoryId).maybeSingle(),
        supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
        supabase.from('sub_events').select('*').eq('category_id', categoryId).eq('status', 'ACTIVE').order('name'),
      ]);

      if (catRes.error) {
        if (catRes.error.code === '22P02' || catRes.error.code === 'PGRST116') {
          setIsNotFound(true);
          return;
        }
        throw catRes.error;
      }
      if (evRes.error) {
        if (evRes.error.code === '22P02' || evRes.error.code === 'PGRST116') {
          setIsNotFound(true);
          return;
        }
        throw evRes.error;
      }

      if (!catRes.data || !evRes.data) {
        setIsNotFound(true);
        return;
      }

      setCategory(catRes.data as Category);
      setEvent(evRes.data as Event);
      setSubEvents((subRes.data as SubEvent[]) || []);
    } catch (err: any) {
      console.error('Failed to load category:', err);
      setError(err.message || 'Category unavailable due to network or server error.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCategoryData();
  }, [eventId, categoryId]);

  if (isLoading) return <LoadingState message="Loading category and competitions..." />;
  if (isNotFound) return <NotFound />;
  if (error || !category) return <ErrorState message={error || 'Category unavailable.'} onRetry={loadCategoryData} />;

  return (
    <div className="space-y-8">
      {/* Navigation Back */}
      <div>
        <Link
          to={`/events/${eventId}`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-kits-red transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to {event?.name || 'Event'}</span>
        </Link>
      </div>

      {/* Category Overview Card */}
      <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden shadow-2xs">
        <div className="p-6 sm:p-8 space-y-4">
          <div className="space-y-1.5 border-b border-gray-100 pb-4">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-kits-blue bg-blue-50 px-2.5 py-0.5 rounded-md">
              Category
            </span>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">{category.name}</h1>
            <p className="text-xs text-gray-500 font-bold">Event: {event?.name}</p>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-400">Category Overview</h3>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {category.description || 'Competitions and sub-events hosted under this track.'}
            </p>
          </div>
        </div>
      </div>

      {/* Sub-Events List */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-kits-red" />
          <h2 className="text-lg font-black tracking-tight text-gray-900">
            Sub-Events under {category.name}
          </h2>
        </div>

        {subEvents.length === 0 ? (
          <EmptyState
            title="No Sub-Events Published"
            description="There are currently no active sub-events listed under this category. Check back soon!"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {subEvents.map((sub) => {
              const subStatus = resolveEffectiveSubEventStatus(sub, event, now);
              const isRegAvailable = isSubEventRegistrationAvailable(sub, event, now);
              const subBadge = getLifecycleBadgeTheme(subStatus);
              const isSubCompleted = subStatus === 'COMPLETED';
              const isSubOngoing = subStatus === 'ONGOING';

              return (
                <Link
                  key={sub.id}
                  to={`/events/${eventId}/categories/${categoryId}/sub-events/${sub.id}`}
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
                      {!isSubCompleted && !isSubOngoing && isRegAvailable && 'Register & Full Rules'}
                      {!isSubCompleted && !isSubOngoing && !isRegAvailable && subStatus === 'UPCOMING' && 'Registration Opens Soon • Details'}
                      {!isSubCompleted && !isSubOngoing && !isRegAvailable && subStatus !== 'UPCOMING' && 'Registrations Closed • Details'}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
