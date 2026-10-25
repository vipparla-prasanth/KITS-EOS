import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Trophy,
  Medal,
  Award,
  Search,
  Sparkles,
  ArrowLeft,
  Flame,
  Globe,
  Radio,
  BookOpen,
  Zap,
} from 'lucide-react';
import {
  assessmentService,
  supabase,
  type LeaderboardEntry,
  type Assessment,
} from '@kits-eos/shared';

export function GlobalLeaderboard() {
  const [activeTab, setActiveTab] = useState<'GLOBAL' | 'ASSESSMENT'>('GLOBAL');
  const [globalEntries, setGlobalEntries] = useState<LeaderboardEntry[]>([]);
  const [assessmentEntries, setAssessmentEntries] = useState<LeaderboardEntry[]>([]);
  const [assessmentsList, setAssessmentsList] = useState<Assessment[]>([]);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // 1. Load Initial Global Leaderboard & Available Assessments
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [globalRes, asmRes] = await Promise.all([
          assessmentService.getGlobalLeaderboard(),
          assessmentService.getAvailableAssessments(),
        ]);

        if (globalRes.data) {
          setGlobalEntries(globalRes.data);
        }
        if (asmRes.data && asmRes.data.length > 0) {
          setAssessmentsList(asmRes.data);
          setSelectedAssessmentId(asmRes.data[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch leaderboard data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // 2. Load Per-Assessment Leaderboard when selectedAssessmentId changes
  useEffect(() => {
    if (activeTab === 'ASSESSMENT' && selectedAssessmentId) {
      let isMounted = true;
      async function loadPerAssessment() {
        const { data } = await assessmentService.getAssessmentLeaderboard(selectedAssessmentId);
        if (isMounted && data) {
          setAssessmentEntries(data);
        }
      }
      loadPerAssessment();
      return () => {
        isMounted = false;
      };
    }
  }, [activeTab, selectedAssessmentId]);

  // 3. Supabase Realtime Subscription for Live Score Broadcasts
  useEffect(() => {
    const channel = supabase
      .channel('public:assessment_leaderboard_events')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'assessment_leaderboard_events' },
        async () => {
          // Refresh global leaderboard when an attempt is finalized
          const { data: updatedGlobal } = await assessmentService.getGlobalLeaderboard();
          if (updatedGlobal) setGlobalEntries(updatedGlobal);

          // If currently viewing per-assessment, refresh that too
          if (selectedAssessmentId) {
            const { data: updatedAsm } = await assessmentService.getAssessmentLeaderboard(selectedAssessmentId);
            if (updatedAsm) setAssessmentEntries(updatedAsm);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeConnected(true);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setRealtimeConnected(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedAssessmentId]);

  // Active entries based on tab
  const activeEntries = activeTab === 'GLOBAL' ? globalEntries : assessmentEntries;

  // Filtered by Search
  const filteredEntries = useMemo(() => {
    if (!searchTerm.trim()) return activeEntries;
    const term = searchTerm.toLowerCase();
    return activeEntries.filter((e) => e.student_name.toLowerCase().includes(term));
  }, [activeEntries, searchTerm]);

  // Top 3 Podium
  const top1 = filteredEntries.find((e) => e.rank === 1);
  const top2 = filteredEntries.find((e) => e.rank === 2);
  const top3 = filteredEntries.find((e) => e.rank === 3);

  return (
    <div className="space-y-8 animate-fadeIn pb-16">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-8 sm:p-12 shadow-2xl border border-indigo-900/40">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-80 h-80 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <Link
              to="/assessments"
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition group mb-2"
            >
              <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
              <span>Back to Assessments</span>
            </Link>

            <div className="flex items-center gap-3">
              <span className="p-3 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30">
                <Trophy className="h-7 w-7" />
              </span>
              <div>
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white flex items-center gap-3">
                  Hall of Champions
                  <Sparkles className="h-6 w-6 text-amber-400" />
                </h1>
                <p className="text-sm text-slate-300 font-medium">
                  Authoritative live standings and global assessment rankings for verified EOS registered Students.
                </p>
              </div>
            </div>
          </div>

          {/* Realtime Status Indicator */}
          <div className="flex flex-col items-start md:items-end gap-2 shrink-0">
            <div
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-black border transition ${
                realtimeConnected
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              }`}
            >
              <Radio
                className={`h-3.5 w-3.5 ${
                  realtimeConnected ? 'animate-pulse text-emerald-400' : 'text-amber-400'
                }`}
              />
              <span>{realtimeConnected ? 'Live Broadcast Connected' : 'Syncing Standings...'}</span>
            </div>
            <span className="text-[11px] text-slate-400">
              Only includes authorized, finalized attempts.
            </span>
          </div>
        </div>
      </div>

      {/* Mode Navigation & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Tab Toggle */}
        <div className="flex items-center p-1.5 bg-gray-100 rounded-2xl border border-gray-200">
          <button
            type="button"
            onClick={() => setActiveTab('GLOBAL')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition ${
              activeTab === 'GLOBAL'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Globe className="h-4 w-4 text-indigo-600" />
            <span>Global Championship</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ASSESSMENT')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition ${
              activeTab === 'ASSESSMENT'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <BookOpen className="h-4 w-4 text-emerald-600" />
            <span>Per-Assessment</span>
          </button>
        </div>

        {/* Assessment Dropdown if Per-Assessment is selected */}
        {activeTab === 'ASSESSMENT' && (
          <div className="flex-1 max-w-xs">
            <select
              value={selectedAssessmentId}
              onChange={(e) => setSelectedAssessmentId(e.target.value)}
              className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-kits-red"
            >
              {assessmentsList.map((asm) => (
                <option key={asm.id} value={asm.id}>
                  {asm.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Search Filter */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search candidate name..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-kits-red"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-16 text-center text-gray-500 font-bold animate-pulse">
          Loading rankings...
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="p-16 text-center bg-white rounded-3xl border border-gray-200">
          <Trophy className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-base font-black text-gray-700">No Standings Available Yet</h3>
          <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
            {searchTerm
              ? `No candidates match "${searchTerm}".`
              : 'Standings will appear here as soon as candidates submit and finalize their assessment attempts.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Top 3 Podium (Shown if top 1 exists and no active search term) */}
          {!searchTerm && top1 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8 pb-4 items-end">
              {/* 2nd Place */}
              {top2 ? (
                <div className="bg-gradient-to-b from-slate-50 to-slate-100 rounded-3xl p-6 border-2 border-slate-300 shadow-lg text-center flex flex-col items-center relative order-2 md:order-1">
                  <div className="w-16 h-16 rounded-full bg-slate-200 text-slate-700 font-black text-xl flex items-center justify-center border-4 border-slate-300 shadow-md mb-3">
                    <Medal className="h-8 w-8 text-slate-500" />
                  </div>
                  <span className="px-3 py-1 bg-slate-200 text-slate-800 rounded-full text-xs font-black uppercase tracking-wider mb-2">
                    Rank #2 • Silver
                  </span>
                  <h3 className="text-lg font-black text-gray-900 truncate max-w-full">
                    {top2.student_name}
                  </h3>
                  <p className="text-2xl font-black text-slate-700 mt-2">
                    {top2.score ?? top2.total_score ?? 0}{' '}
                    <span className="text-xs font-bold text-gray-500">PTS</span>
                  </p>
                </div>
              ) : (
                <div className="order-2 md:order-1" />
              )}

              {/* 1st Place - Winner */}
              <div className="bg-gradient-to-b from-amber-50 via-yellow-50 to-amber-100 rounded-3xl p-8 border-2 border-amber-400 shadow-2xl text-center flex flex-col items-center relative order-1 md:order-2 transform md:-translate-y-4">
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 p-2 bg-amber-400 text-amber-950 rounded-full shadow-lg">
                  <Flame className="h-6 w-6" />
                </div>
                <div className="w-20 h-20 rounded-full bg-amber-400/20 text-amber-600 font-black text-2xl flex items-center justify-center border-4 border-amber-400 shadow-md mb-3 mt-2">
                  <Trophy className="h-10 w-10 text-amber-600" />
                </div>
                <span className="px-4 py-1.5 bg-amber-400 text-amber-950 rounded-full text-xs font-black uppercase tracking-wider mb-2 shadow-sm">
                  Champion • Rank #1
                </span>
                <h3 className="text-xl font-black text-gray-900 truncate max-w-full">
                  {top1.student_name}
                </h3>
                <p className="text-3xl font-black text-amber-700 mt-2">
                  {top1.score ?? top1.total_score ?? 0}{' '}
                  <span className="text-sm font-bold text-amber-900/70">PTS</span>
                </p>
              </div>

              {/* 3rd Place */}
              {top3 ? (
                <div className="bg-gradient-to-b from-orange-50 to-amber-50 rounded-3xl p-6 border-2 border-amber-300 shadow-lg text-center flex flex-col items-center relative order-3">
                  <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-800 font-black text-xl flex items-center justify-center border-4 border-amber-300 shadow-md mb-3">
                    <Award className="h-8 w-8 text-amber-700" />
                  </div>
                  <span className="px-3 py-1 bg-amber-200 text-amber-900 rounded-full text-xs font-black uppercase tracking-wider mb-2">
                    Rank #3 • Bronze
                  </span>
                  <h3 className="text-lg font-black text-gray-900 truncate max-w-full">
                    {top3.student_name}
                  </h3>
                  <p className="text-2xl font-black text-amber-800 mt-2">
                    {top3.score ?? top3.total_score ?? 0}{' '}
                    <span className="text-xs font-bold text-gray-500">PTS</span>
                  </p>
                </div>
              ) : (
                <div className="order-3" />
              )}
            </div>
          )}

          {/* Complete Rankings Table */}
          <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between">
              <span className="text-xs font-black text-gray-600 uppercase tracking-wider">
                Official Leaderboard Standings ({filteredEntries.length})
              </span>
              <span className="text-[11px] font-bold text-gray-400">
                Sorted by Score & Completion Speed
              </span>
            </div>

            <div className="divide-y divide-gray-100">
              {filteredEntries.map((entry) => {
                const isFirst = entry.rank === 1;
                const isSecond = entry.rank === 2;
                const isThird = entry.rank === 3;

                return (
                  <div
                    key={`${entry.rank}-${entry.student_name}`}
                    className={`flex items-center justify-between px-6 py-4 transition ${
                      isFirst
                        ? 'bg-amber-50/40'
                        : isSecond
                        ? 'bg-slate-50/60'
                        : isThird
                        ? 'bg-orange-50/30'
                        : 'hover:bg-gray-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xs font-black shrink-0 ${
                          isFirst
                            ? 'bg-amber-400 text-amber-950 ring-2 ring-amber-300'
                            : isSecond
                            ? 'bg-slate-200 text-slate-800'
                            : isThird
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        #{entry.rank}
                      </div>

                      <div className="min-w-0">
                        <div className="text-sm font-black text-gray-900 truncate flex items-center gap-2">
                          <span>{entry.student_name}</span>
                          {isFirst && <Trophy className="h-4 w-4 text-amber-500 shrink-0" />}
                        </div>
                        <div className="text-[11px] font-bold text-gray-400">
                          Verified Candidate
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-base font-black text-gray-900 font-mono">
                        {entry.eos_points ?? entry.score ?? entry.total_score ?? 0}
                      </div>
                      {(entry.eos_points != null ? entry.eos_points : entry.speed_bonus_score) != null &&
                      (entry.eos_points ?? entry.speed_bonus_score ?? 0) > 0 ? (
                        <div className="text-[10px] font-bold text-amber-600 font-mono flex items-center justify-end">
                          <Zap className="w-2.5 h-2.5 mr-0.5 text-amber-500" />
                          {entry.eos_points ?? entry.speed_bonus_score} EOS pts
                        </div>
                      ) : (
                        <div className="text-[10px] font-black text-gray-400 tracking-wider">
                          POINTS
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
