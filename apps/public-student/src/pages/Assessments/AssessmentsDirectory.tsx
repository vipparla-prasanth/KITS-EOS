import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  GraduationCap,
  Clock,
  Calendar,
  CheckCircle2,
  Trophy,
  ArrowRight,
  AlertCircle,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  assessmentService,
  type Assessment,
} from '@kits-eos/shared';

export function AssessmentsDirectory() {
  const navigate = useNavigate();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'UPCOMING' | 'PAST'>('ACTIVE');
  const [searchQuery, setSearchQuery] = useState('');

  const loadAssessments = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await assessmentService.getAvailableAssessments();
      if (err) throw err;
      setAssessments(data || []);
    } catch (err: any) {
      console.error('Failed to load assessments:', err);
      setError(err.message || 'Unable to load examination schedule.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssessments();
  }, []);

  const now = new Date();

  const categorizedAssessments = assessments.filter((asm) => {
    if (asm.status === 'ARCHIVED' || (asm as any).is_deleted) return false;
    const start = new Date(asm.start_time);
    const end = new Date(asm.end_time);

    let matchesTab = false;
    if (activeTab === 'ACTIVE') {
      matchesTab = asm.status === 'PUBLISHED' && now >= start && now < end;
    } else if (activeTab === 'UPCOMING') {
      matchesTab = asm.status === 'PUBLISHED' && now < start;
    } else if (activeTab === 'PAST') {
      matchesTab = asm.status === 'CLOSED' || (asm.status === 'PUBLISHED' && now >= end);
    }

    const matchesSearch =
      searchQuery.trim() === '' ||
      asm.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asm.description?.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesTab && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Hero Header */}
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-3xl p-8 sm:p-10 text-white shadow-xl relative overflow-hidden">
          <div className="relative z-10 max-w-2xl space-y-3">
            <div className="inline-flex items-center space-x-2 px-3 py-1 bg-white/10 rounded-full text-xs font-semibold backdrop-blur-sm text-kits-red">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Official Institutional Evaluations</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              EOS Assessment Platform
            </h1>
            <p className="text-sm text-gray-300 leading-relaxed">
              Test your technical skills, qualify for certified achievements, and compete for top ranks on the
              campus-wide leaderboard. No event registration required.
            </p>

            <div className="pt-2 flex flex-wrap gap-3">
              <Link
                to="/assessments/leaderboard"
                className="inline-flex items-center px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-xl backdrop-blur-sm transition space-x-2 border border-white/10"
              >
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>View Global Campus Leaderboard</span>
              </Link>
            </div>
          </div>
          <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none transform translate-x-12 translate-y-12">
            <GraduationCap className="w-80 h-80 text-white" />
          </div>
        </div>

        {/* Navigation & Controls */}
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-4 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex space-x-1 p-1 bg-gray-100 rounded-xl">
              <button
                onClick={() => setActiveTab('ACTIVE')}
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                  activeTab === 'ACTIVE'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Active Now
              </button>
              <button
                onClick={() => setActiveTab('UPCOMING')}
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                  activeTab === 'UPCOMING'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Upcoming
              </button>
              <button
                onClick={() => setActiveTab('PAST')}
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                  activeTab === 'PAST'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Completed
              </button>
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search examinations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red"
                />
              </div>
              <button
                onClick={loadAssessments}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-xl border border-gray-200"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Cards Grid */}
          {loading ? (
            <div className="py-20 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-3 border-kits-red border-t-transparent mx-auto" />
              <p className="mt-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Loading available examinations...
              </p>
            </div>
          ) : categorizedAssessments.length === 0 ? (
            <div className="py-16 text-center border-2 border-dashed border-gray-200 rounded-2xl">
              <GraduationCap className="w-12 h-12 text-gray-300 mx-auto" />
              <h3 className="text-sm font-bold text-gray-800 mt-2">
                No {activeTab.toLowerCase()} assessments found
              </h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Check back shortly or view other tabs for scheduled upcoming tests.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {categorizedAssessments.map((asm) => (
                <div
                  key={asm.id}
                  onClick={() => navigate(`/assessments/${asm.id}`)}
                  className="bg-white rounded-2xl border border-gray-200/90 p-5 shadow-sm hover:shadow-md transition hover:border-kits-red/40 cursor-pointer flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="text-base font-bold text-gray-900 group-hover:text-kits-red transition line-clamp-1">
                        {asm.title}
                      </h3>
                      {asm.include_in_global_leaderboard && (
                        <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 flex items-center">
                          <Trophy className="w-3 h-3 mr-1" /> Leaderboard
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2">
                      {asm.description || 'Institutional examination evaluation.'}
                    </p>
                  </div>

                  <div className="space-y-3 pt-3 border-t border-gray-100">
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                      <span className="flex items-center">
                        <Clock className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
                        {asm.duration_minutes} Mins Duration
                      </span>
                      <span className="flex items-center">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
                        Pass: {asm.passing_percentage}%
                      </span>
                      <span className="flex items-center col-span-2 text-[11px] text-gray-400">
                        <Calendar className="w-3.5 h-3.5 mr-1.5" />
                        Closes: {new Date(asm.end_time).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex justify-between items-center pt-1">
                      <span className="text-xs font-bold text-gray-700">
                        {asm.total_questions_count} Questions
                      </span>
                      <span className="inline-flex items-center text-xs font-bold text-kits-red hover:underline">
                        Enter Exam Room <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export default AssessmentsDirectory;
