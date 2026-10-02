import { useState, useEffect } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { 
  MessageSquare, 
  Star, 
  Search, 
  ThumbsUp
} from 'lucide-react';
import type { FeedbackResponse } from '@kits-eos/shared/src/types/models';

export function FeedbackList() {
  const [feedbackList, setFeedbackList] = useState<FeedbackResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    async function fetchFeedback() {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchErr } = await supabase
          .from('feedback_responses')
          .select(`
            id,
            sub_event_id,
            registration_id,
            rating_1,
            rating_2,
            rating_3,
            rating_4,
            rating_5,
            comments,
            sub_events (
              id,
              name,
              events (
                id,
                name
              )
            ),
            registrations (
              id,
              teams (
                id,
                team_name,
                team_members (
                  snapshot_name,
                  snapshot_roll_number,
                  snapshot_college,
                  is_leader
                )
              )
            )
          `)
          .order('id', { ascending: false });

        if (fetchErr) throw fetchErr;
        setFeedbackList((data as unknown as FeedbackResponse[]) || []);
      } catch (err: any) {
        console.error('Failed to load feedback:', err);
        setError('Failed to load feedback submissions.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchFeedback();
  }, []);

  const filteredFeedback = feedbackList.filter((fb) => {
    const sub = fb.sub_events;
    const team: any = Array.isArray(fb.registrations?.teams) ? fb.registrations.teams[0] : fb.registrations?.teams;
    const leader = team?.team_members?.find((m: any) => m.is_leader) || team?.team_members?.[0];
    const q = searchTerm.toLowerCase();

    if (!q) return true;
    return (
      sub?.name?.toLowerCase().includes(q) ||
      leader?.snapshot_name?.toLowerCase().includes(q) ||
      leader?.snapshot_roll_number?.toLowerCase().includes(q) ||
      fb.comments?.toLowerCase().includes(q)
    );
  });

  const totalReviews = feedbackList.length;
  const avgOverall = totalReviews > 0
    ? (feedbackList.reduce((acc, curr) => acc + (curr.rating_1 + curr.rating_2 + curr.rating_3 + curr.rating_4 + curr.rating_5) / 5, 0) / totalReviews).toFixed(1)
    : '0.0';

  if (isLoading) {
    return <LoadingState message="Loading Student Feedback..." />;
  }

  return (
    <div className="space-y-8 pb-16">
      <PageHeader
        title="Student Feedback & Experience Reviews"
        description="Comprehensive participant evaluations, ratings across 5 institutional criteria, and suggestions."
      />

      {/* Ratings KPI Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Average Rating</span>
            <div className="flex items-center gap-2 mt-1">
              <h3 className="text-4xl font-black text-gray-900">{avgOverall}</h3>
              <div className="flex text-amber-400">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className="h-4 w-4 fill-amber-400" />
                ))}
              </div>
            </div>
            <p className="text-[11px] text-gray-500 mt-1 font-medium">Across all sub-event criteria</p>
          </div>
          <div className="p-3 rounded-2xl bg-amber-50 text-amber-600">
            <ThumbsUp className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Total Reviews</span>
            <h3 className="text-4xl font-black text-gray-900 mt-1">{totalReviews}</h3>
            <p className="text-[11px] text-emerald-600 font-bold mt-1">Verified participants submitted</p>
          </div>
          <div className="p-3 rounded-2xl bg-blue-50 text-kits-blue">
            <MessageSquare className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xs flex flex-col justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Evaluation Criteria</span>
          <p className="text-xs text-gray-600 font-medium mt-1">
            1. Overall • 2. Organization • 3. Venue • 4. Content • 5. Coordinators
          </p>
          <span className="text-[11px] text-gray-400 mt-2">Required for team certificate unlock</span>
        </div>
      </div>

      {/* Feedback Feed & Search */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by student, sub-event, comments..."
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
            />
          </div>
          <span className="text-xs text-gray-500 font-medium">
            Showing {filteredFeedback.length} of {feedbackList.length} reviews
          </span>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border-b border-red-200">
            <ErrorState message={error} />
          </div>
        )}

        {filteredFeedback.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-400">
            No feedback responses received yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredFeedback.map((fb) => {
              const sub = fb.sub_events;
              const ev = (sub as any)?.events;
              const team: any = Array.isArray(fb.registrations?.teams) ? fb.registrations.teams[0] : fb.registrations?.teams;
              const leader = team?.team_members?.find((m: any) => m.is_leader) || team?.team_members?.[0];
              const avgScore = ((fb.rating_1 + fb.rating_2 + fb.rating_3 + fb.rating_4 + fb.rating_5) / 5).toFixed(1);

              return (
                <div key={fb.id} className="p-5 hover:bg-gray-50/60 transition space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-gray-900">{leader?.snapshot_name || 'Participant'}</span>
                        <span className="font-mono text-xs text-gray-500">({leader?.snapshot_roll_number})</span>
                        <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          {leader?.snapshot_college || 'KITS'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        Sub-event: <span className="font-bold text-gray-800">{sub?.name}</span> • Event: {ev?.name || 'Main Event'}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 shrink-0">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
                      <span className="font-black text-sm text-amber-900">{avgScore} / 5.0</span>
                    </div>
                  </div>

                  {/* Individual Scores Breakdown */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                    <div>
                      <span className="text-gray-400 block text-[9px] font-bold uppercase">Overall</span>
                      <span className="font-bold text-gray-800">{fb.rating_1} ★</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[9px] font-bold uppercase">Organization</span>
                      <span className="font-bold text-gray-800">{fb.rating_2} ★</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[9px] font-bold uppercase">Venue</span>
                      <span className="font-bold text-gray-800">{fb.rating_3} ★</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[9px] font-bold uppercase">Content</span>
                      <span className="font-bold text-gray-800">{fb.rating_4} ★</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[9px] font-bold uppercase">Coord Support</span>
                      <span className="font-bold text-gray-800">{fb.rating_5} ★</span>
                    </div>
                  </div>

                  {fb.comments && (
                    <div className="p-3 bg-white rounded-lg border border-gray-200 text-xs text-gray-700 italic">
                      "{fb.comments}"
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
