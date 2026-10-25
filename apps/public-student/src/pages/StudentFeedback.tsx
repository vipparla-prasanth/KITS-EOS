import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { playRegistrationSuccessSound } from '../utils/registrationSound';
import { 
  MessageSquare, 
  Star, 
  CheckCircle2, 
  Send, 
  Users, 
  RefreshCw,
  User,
  GraduationCap,
  Building2,
  X,
  Award
} from 'lucide-react';

interface RegistrationFeedbackItem {
  registrationId: string;
  subEventId: string;
  subEventName: string;
  eventName: string;
  teamName: string;
  hasSubmittedFeedback: boolean;
  feedbackData?: {
    rating_1: number;
    rating_2: number;
    rating_3: number;
    rating_4: number;
    rating_5: number;
    comments: string | null;
  };
}

const CRITERIA = [
  { id: 'r1', label: '1. Overall Experience', desc: 'Overall satisfaction with this competition' },
  { id: 'r2', label: '2. Event Organization & Timing', desc: 'Adherence to schedule and smoothness of rounds' },
  { id: 'r3', label: '3. Venue & Facilities', desc: 'Infrastructure, equipment, and lab/room environment' },
  { id: 'r4', label: '4. Content & Challenge Quality', desc: 'Relevance, fairness, and quality of problem statements/topics' },
  { id: 'r5', label: '5. Coordinator & Volunteer Support', desc: 'Helpfulness and responsiveness of assigned coordinators' },
];

export function StudentFeedback() {
  const { user, profile } = useAuth();
  const [searchParams] = useSearchParams();
  const targetRegId = searchParams.get('regId');
  const [items, setItems] = useState<RegistrationFeedbackItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form State for Active Feedback Submission
  const [activeRegId, setActiveRegId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({ r1: 5, r2: 5, r3: 5, r4: 5, r5: 5 });
  const [comments, setComments] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchRegistrationsAndFeedback = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      // 1. Fetch student's confirmed registrations
      const { data: regData, error: regErr } = await supabase
        .from('registrations')
        .select(`
          id,
          sub_event_id,
          status,
          sub_events (
            id,
            name,
            events (
              id,
              name
            ),
            categories (
              id,
              name,
              events (
                id,
                name
              )
            )
          ),
          teams (
            id,
            team_name
          )
        `)
        .eq('leader_id', user.id)
        .eq('status', 'CONFIRMED');

      if (regErr) throw regErr;
      const regs = regData || [];

      // 2. Fetch existing feedback responses for this student's registrations
      const regIds = regs.map((r) => r.id);
      const { data: fbData, error: fbErr } = await supabase
        .from('feedback_responses')
        .select('*')
        .in('registration_id', regIds.length > 0 ? regIds : ['00000000-0000-0000-0000-000000000000']);

      if (fbErr) throw fbErr;
      const fbMap = new Map<string, any>();
      fbData?.forEach((f) => {
        fbMap.set(f.registration_id, f);
      });

      // 3. Map into items
      const mapped: RegistrationFeedbackItem[] = regs.map((r: any) => {
        const sub: any = Array.isArray(r.sub_events) ? r.sub_events[0] : r.sub_events;
        const team: any = Array.isArray(r.teams) ? r.teams[0] : r.teams;
        const existingFb = fbMap.get(r.id);

        return {
          registrationId: r.id,
          subEventId: sub?.id,
          subEventName: sub?.name || 'Sub-Event',
          eventName: sub?.events?.name || sub?.categories?.events?.name || 'Flagship Event',
          teamName: team?.team_name || 'Solo Participant',
          hasSubmittedFeedback: Boolean(existingFb),
          feedbackData: existingFb,
        };
      });

      setItems(mapped);

      // Auto-focus requested registration from URL query if feedback pending
      if (targetRegId) {
        const matching = mapped.find((i) => i.registrationId === targetRegId && !i.hasSubmittedFeedback);
        if (matching) {
          setActiveRegId(matching.registrationId);
        }
      }
    } catch (err: any) {
      console.error('Failed to load feedback page:', err);
      setError(err.message || 'Failed to load feedback entries.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRegistrationsAndFeedback();
  }, [user]);

  const handleSubmitFeedback = async (e: React.FormEvent, reg: RegistrationFeedbackItem) => {
    e.preventDefault();
    if (!user || !reg) return;

    try {
      setIsSubmitting(true);
      setError(null);

      const { data, error: rpcErr } = await supabase.rpc('submit_event_feedback_and_unlock_certificate', {
        p_registration_id: reg.registrationId,
        p_rating_1: ratings.r1,
        p_rating_2: ratings.r2,
        p_rating_3: ratings.r3,
        p_rating_4: ratings.r4,
        p_rating_5: ratings.r5,
        p_comments: comments.trim() || null,
      });

      if (rpcErr || (data && !data.success)) {
        throw new Error(rpcErr?.message || data?.message || 'Failed to submit feedback.');
      }

      playRegistrationSuccessSound({ dedupeKey: `feedback-submit-${reg.registrationId}` });
      setSuccessMessage(data.message || `Thank you! Your feedback for "${reg.subEventName}" has been submitted.`);
      setActiveRegId(null);
      setComments('');
      await fetchRegistrationsAndFeedback();
    } catch (err: any) {
      console.error('Feedback submit error:', err);
      setError(err.message || 'Failed to submit feedback.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <LoadingState message="Loading event feedback..." />;
  if (error) return <ErrorState message={error} onRetry={fetchRegistrationsAndFeedback} />;

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-16 font-sans page-enter">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-kits-blue" />
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
              Event Experience & Feedback
            </h1>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-gray-500">
            Share your feedback on event management, technical challenge quality, and venue infrastructure.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchRegistrationsAndFeedback}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-700 hover:text-kits-blue hover:border-blue-200 transition shadow-2xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/certificates"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition shadow-2xs cursor-pointer"
            >
              <Award className="h-3.5 w-3.5" />
              <span>View Unlocked Certificate</span>
            </Link>
            <button onClick={() => setSuccessMessage(null)} className="text-emerald-700 hover:text-emerald-900 p-1">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No Registered Events Found"
          description="You can provide institutional feedback once you register and attend competitions."
          icon={<MessageSquare className="h-10 w-10 text-gray-300" />}
          action={
            <Link
              to="/events"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-kits-red text-white text-xs font-bold"
            >
              Explore Events
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {items.map((item) => (
            <div
              key={item.registrationId}
              className="bg-white rounded-3xl border border-gray-200 p-6 shadow-2xs space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-kits-blue">
                    {item.eventName}
                  </span>
                  <h3 className="text-base font-black text-gray-900">{item.subEventName}</h3>
                  <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
                    <Users className="h-3.5 w-3.5 text-gray-400" />
                    <span>Team: <strong className="text-gray-800">{item.teamName}</strong></span>
                  </div>
                </div>

                <div>
                  {item.hasSubmittedFeedback ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      Feedback Submitted
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveRegId(activeRegId === item.registrationId ? null : item.registrationId)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs cursor-pointer"
                    >
                      <Star className="h-3.5 w-3.5" />
                      <span>{activeRegId === item.registrationId ? 'Close Form' : 'Submit Feedback'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Already Submitted Ratings View */}
              {item.hasSubmittedFeedback && item.feedbackData && (
                <div className="pt-4 border-t border-gray-100 bg-gray-50/70 p-4 rounded-2xl space-y-3">
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                    Your Submitted Ratings
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <div className="bg-white p-3 rounded-xl border border-gray-200">
                      <span className="text-[10px] text-gray-400 font-bold block">Overall</span>
                      <span className="font-mono font-black text-gray-900 flex items-center gap-1 mt-0.5">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {item.feedbackData.rating_1}/5
                      </span>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-gray-200">
                      <span className="text-[10px] text-gray-400 font-bold block">Organization</span>
                      <span className="font-mono font-black text-gray-900 flex items-center gap-1 mt-0.5">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {item.feedbackData.rating_2}/5
                      </span>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-gray-200">
                      <span className="text-[10px] text-gray-400 font-bold block">Venue</span>
                      <span className="font-mono font-black text-gray-900 flex items-center gap-1 mt-0.5">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {item.feedbackData.rating_3}/5
                      </span>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-gray-200">
                      <span className="text-[10px] text-gray-400 font-bold block">Content</span>
                      <span className="font-mono font-black text-gray-900 flex items-center gap-1 mt-0.5">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {item.feedbackData.rating_4}/5
                      </span>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-gray-200">
                      <span className="text-[10px] text-gray-400 font-bold block">Coordinators</span>
                      <span className="font-mono font-black text-gray-900 flex items-center gap-1 mt-0.5">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {item.feedbackData.rating_5}/5
                      </span>
                    </div>
                  </div>

                  {item.feedbackData.comments && (
                    <div className="pt-2 text-xs text-gray-600 italic">
                      "{item.feedbackData.comments}"
                    </div>
                  )}
                </div>
              )}

              {/* Feedback Submission Form */}
              {activeRegId === item.registrationId && !item.hasSubmittedFeedback && (
                <form
                  onSubmit={(e) => handleSubmitFeedback(e, item)}
                  className="pt-4 border-t border-gray-100 space-y-5"
                >
                  {/* Read-Only Authenticated Student Profile Details */}
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Student Name</span>
                      <span className="font-bold text-gray-900 flex items-center gap-1">
                        <User className="h-3 w-3 text-gray-400" />
                        {profile?.full_name || 'Authenticated Student'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Roll Number</span>
                      <span className="font-mono font-bold text-gray-900 flex items-center gap-1">
                        <GraduationCap className="h-3 w-3 text-gray-400" />
                        {profile?.roll_number || 'N/A'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-black uppercase text-gray-400 block">College</span>
                      <span className="font-bold text-gray-900 flex items-center gap-1 truncate">
                        <Building2 className="h-3 w-3 text-gray-400" />
                        {profile?.college || 'KITS Akshar Institute of Technology'}
                      </span>
                    </div>
                  </div>

                  {/* 5 Institutional Criteria */}
                  <div className="space-y-3">
                    <span className="text-xs font-black uppercase tracking-wider text-gray-900 block">
                      Institutional Feedback Criteria (1 to 5 Stars)
                    </span>

                    <div className="space-y-2.5">
                      {CRITERIA.map((crit) => (
                        <div
                          key={crit.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 bg-gray-50/70 rounded-2xl border border-gray-200"
                        >
                          <div>
                            <span className="text-xs font-bold text-gray-900 block">{crit.label}</span>
                            <span className="text-[11px] text-gray-500">{crit.desc}</span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                onClick={() => setRatings((prev) => ({ ...prev, [crit.id]: star }))}
                                className="p-1 text-gray-300 hover:text-amber-400 transition cursor-pointer"
                              >
                                <Star
                                  className={`h-5 w-5 ${
                                    ratings[crit.id] >= star
                                      ? 'fill-amber-400 text-amber-400'
                                      : 'text-gray-300'
                                  }`}
                                />
                              </button>
                            ))}
                            <span className="font-mono text-xs font-black text-gray-800 ml-1.5 w-6">
                              {ratings[crit.id]}/5
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Comments Field */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1">
                      Qualitative Remarks & Suggestions (Optional)
                    </label>
                    <textarea
                      rows={3}
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      placeholder="Share what went well or what could be improved..."
                      className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:bg-white focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                    />
                  </div>

                  {/* Form Actions */}
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveRegId(null)}
                      className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider shadow-2xs hover:bg-red-700 disabled:opacity-50 transition cursor-pointer"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>{isSubmitting ? 'Submitting...' : 'Submit Feedback'}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
