import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useAuth } from '../../context/AuthContext';
import { 
  Trophy, 
  Award, 
  Medal,
  Download, 
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { formatDateOnly } from '@kits-eos/shared/src/utils/date';

export interface PublishedResultItem {
  sub_event_id: string;
  sub_event_name: string;
  event_name: string;
  category_name: string;
  participation_type: 'SOLO' | 'TEAM' | 'BOTH';
  winner_name: string;
  runner_name: string;
  has_third_place: boolean;
  third_name: string | null;
  my_position: 'WINNER' | 'RUNNER' | 'THIRD_PLACE' | 'NONE';
  achievement_certificate_code: string | null;
  achievement_certificate_id: string | null;
  achievement_certificate_status: string | null;
  results_published_at: string | null;
}

interface StudentPublishedResultsProps {
  onDownloadAchievementPdf?: (certificateCode: string) => void;
  onViewAchievement?: (certificateCode: string) => void;
}

export function StudentPublishedResults({ 
  onDownloadAchievementPdf, 
  onViewAchievement 
}: StudentPublishedResultsProps) {
  const { user } = useAuth();
  const [results, setResults] = useState<PublishedResultItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPublishedResults = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      // Server-side authoritative RPC; minimal fields returned under strict RLS
      const { data, error: rpcErr } = await supabase.rpc('get_student_published_results');

      if (rpcErr) throw rpcErr;
      setResults((data as PublishedResultItem[]) || []);
    } catch (err: any) {
      console.error('Failed to load published results for student:', err);
      setError(err.message || 'Unable to load published event results.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPublishedResults();
  }, [fetchPublishedResults]);

  // If loading, show a compact skeleton
  if (isLoading) {
    return (
      <div className="bg-white rounded-3xl border border-gray-200/90 p-5 shadow-2xs animate-pulse space-y-3">
        <div className="h-4 bg-gray-200 rounded w-48"></div>
        <div className="h-16 bg-gray-100 rounded-2xl"></div>
      </div>
    );
  }

  // If error or no published results for the student's sub-events, quietly render nothing
  // (per guardrails: do not clutter or dominate Certificates page if no results published)
  if (error || results.length === 0) {
    return null;
  }

  return (
    <section aria-label="Your Published Event Results" className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
            <Trophy className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black tracking-tight text-gray-900 flex items-center gap-2">
              <span>YOUR EVENT RESULTS</span>
            </h2>
            <p className="text-[11px] text-gray-500">
              Officially published podium standings for your participated competitions.
            </p>
          </div>
        </div>

        <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
          {results.length} Published
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {results.map((res) => {
          const isWinner = res.my_position === 'WINNER';
          const isRunner = res.my_position === 'RUNNER';
          const isThird = res.my_position === 'THIRD_PLACE';
          const isPodiumCandidate = isWinner || isRunner || isThird;

          return (
            <div
              key={res.sub_event_id}
              className={`rounded-3xl border transition overflow-hidden shadow-2xs flex flex-col justify-between ${
                isWinner
                  ? 'bg-gradient-to-b from-amber-50/60 via-white to-white border-amber-300'
                  : isRunner
                  ? 'bg-gradient-to-b from-slate-50/70 via-white to-white border-blue-200'
                  : isThird
                  ? 'bg-gradient-to-b from-amber-50/40 via-white to-white border-amber-200'
                  : 'bg-white border-gray-200/90'
              }`}
            >
              {/* Header Bar */}
              <div className="p-4 sm:p-5 border-b border-gray-100 flex items-start justify-between gap-3 bg-white/70">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-blue-50 text-[#003366] text-[10px] font-black uppercase tracking-wider border border-blue-100">
                      {res.event_name}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wider">
                      {res.category_name}
                    </span>
                  </div>

                  <h3 className="text-sm sm:text-base font-black text-gray-900 tracking-tight truncate">
                    {res.sub_event_name.toUpperCase()}
                  </h3>
                </div>

                {/* Published Date Tag */}
                {res.results_published_at && (
                  <span className="text-[10px] font-mono font-bold text-gray-400 shrink-0">
                    {formatDateOnly(res.results_published_at)}
                  </span>
                )}
              </div>

              {/* Podium Listing: Minimal, only Winner, Runner, and Third Place if exists */}
              <div className="p-4 sm:p-5 space-y-2.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">
                  Official Podium
                </span>

                {/* 1st Place: Winner */}
                <div className={`p-2.5 rounded-2xl flex items-center justify-between gap-3 transition ${
                  isWinner ? 'bg-amber-100/70 border border-amber-300 font-bold' : 'bg-slate-50 border border-gray-100'
                }`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1 rounded-lg bg-amber-500/10 text-amber-600 shrink-0">
                      <Trophy className="h-4 w-4" aria-label="First Place" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 block">
                        Winner
                      </span>
                      <span className="text-xs font-black text-gray-900 truncate block">
                        {res.winner_name}
                      </span>
                    </div>
                  </div>
                  {isWinner && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-600 text-white text-[9px] font-black uppercase tracking-wider shrink-0">
                      You
                    </span>
                  )}
                </div>

                {/* 2nd Place: Runner-Up */}
                <div className={`p-2.5 rounded-2xl flex items-center justify-between gap-3 transition ${
                  isRunner ? 'bg-blue-50 border border-blue-300 font-bold' : 'bg-slate-50 border border-gray-100'
                }`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1 rounded-lg bg-slate-500/10 text-slate-600 shrink-0">
                      <Medal className="h-4 w-4" aria-label="Second Place" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-700 block">
                        Runner-Up
                      </span>
                      <span className="text-xs font-black text-gray-900 truncate block">
                        {res.runner_name}
                      </span>
                    </div>
                  </div>
                  {isRunner && (
                    <span className="px-2 py-0.5 rounded-full bg-[#003366] text-white text-[9px] font-black uppercase tracking-wider shrink-0">
                      You
                    </span>
                  )}
                </div>

                {/* 3rd Place: Rendered ONLY if valid and published */}
                {res.has_third_place && res.third_name && (
                  <div className={`p-2.5 rounded-2xl flex items-center justify-between gap-3 transition ${
                    isThird ? 'bg-amber-50 border border-amber-300 font-bold' : 'bg-slate-50 border border-gray-100'
                  }`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="p-1 rounded-lg bg-amber-600/10 text-amber-700 shrink-0">
                        <Award className="h-4 w-4" aria-label="Third Place" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 block">
                          Third Place
                        </span>
                        <span className="text-xs font-black text-gray-900 truncate block">
                          {res.third_name}
                        </span>
                      </div>
                    </div>
                    {isThird && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-700 text-white text-[9px] font-black uppercase tracking-wider shrink-0">
                        You
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Personalized Standing Section (Winner, Runner, Third, or Clean Podium only) */}
              {isPodiumCandidate ? (
                <div className={`p-4 sm:p-5 border-t space-y-3 ${
                  isWinner 
                    ? 'bg-amber-500/10 border-amber-200' 
                    : isRunner 
                    ? 'bg-blue-50/70 border-blue-200' 
                    : 'bg-amber-50/50 border-amber-200'
                }`}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-amber-600 animate-pulse" />
                      <h4 className="text-xs font-black uppercase tracking-wider text-gray-900">
                        {isWinner 
                          ? 'Wooo-Hoooo! 🎉 Congratulations!' 
                          : 'Congratulations! 🎉'}
                      </h4>
                    </div>

                    <p className="text-xs text-gray-700 leading-relaxed font-medium">
                      {isWinner ? (
                        <>
                          <strong>You are the Winner of this sub-event!</strong> We are very glad to see you achieve this milestone. Please download your official KITS-EOS Achievement Certificate and celebrate your achievement.
                        </>
                      ) : isRunner ? (
                        <>
                          <strong>You are the Runner-up of this sub-event!</strong> Your achievement has been officially recognized by KITS-EOS. Please download your official Achievement Certificate.
                        </>
                      ) : (
                        <>
                          <strong>You secured Third Place in this sub-event!</strong> We are glad to recognize your achievement. Please download your official Achievement Certificate.
                        </>
                      )}
                    </p>
                  </div>

                  {/* Certificate Action Button */}
                  <div className="pt-1 flex flex-wrap items-center gap-2">
                    {res.achievement_certificate_code ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onDownloadAchievementPdf?.(res.achievement_certificate_code!)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#C8102E] hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer active:scale-95"
                          title="Download official Achievement Certificate as PDF"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Download Achievement Certificate</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onViewAchievement?.(res.achievement_certificate_code!)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-xs font-bold transition shadow-2xs cursor-pointer"
                          title="Preview Certificate Modal"
                        >
                          <Award className="h-3.5 w-3.5 text-amber-600" />
                          <span>View</span>
                        </button>
                      </>
                    ) : (
                      <div className="text-[11px] font-bold text-gray-500 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Achievement Certificate registered in portal credentials.</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
