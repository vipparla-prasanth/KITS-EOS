import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  GraduationCap,
  Plus,
  Search,
  Calendar,
  Clock,
  AlertCircle,
  Eye,
  RefreshCw,
  Trophy,
  Trash2,
  Radio,
  CheckCircle2,
  BarChart3,
} from 'lucide-react';
import { assessmentService, type Assessment, type AssessmentStatus } from '@kits-eos/shared';
import { AssessmentDeleteModal } from '../../components/assessments/AssessmentDeleteModal';

export function AssessmentsList() {
  const navigate = useNavigate();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AssessmentStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAsmForDelete, setSelectedAsmForDelete] = useState<Assessment | null>(null);

  const loadAssessments = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await assessmentService.getAdminAssessments();
      if (err) throw err;
      setAssessments(data || []);
    } catch (err: any) {
      console.error('Failed to load assessments:', err);
      setError(err.message || 'Unable to load assessments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssessments();
  }, []);

  const isArchived = (asm: Assessment) => asm.status === 'ARCHIVED' || Boolean((asm as any).is_deleted);

  const filteredAssessments = assessments.filter((asm) => {
    const matchesTab =
      activeTab === 'ALL'
        ? !isArchived(asm)
        : activeTab === 'ARCHIVED'
        ? isArchived(asm)
        : asm.status === activeTab && !isArchived(asm);

    const matchesSearch =
      searchQuery.trim() === '' ||
      asm.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asm.description?.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesTab && matchesSearch;
  });

  const getStatusBadge = (status: AssessmentStatus) => {
    switch (status) {
      case 'DRAFT':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            Draft
          </span>
        );
      case 'PUBLISHED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
            Published
          </span>
        );
      case 'CLOSED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            Closed
          </span>
        );
      case 'ARCHIVED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-300">
            Archived
          </span>
        );
    }
  };

  // Metrics: Count only active non-archived examinations for primary KPIs
  const activeAssessments = assessments.filter((a) => !isArchived(a));
  const totalCount = activeAssessments.length;
  const publishedCount = assessments.filter((a) => a.status === 'PUBLISHED' && !isArchived(a)).length;
  const draftCount = assessments.filter((a) => a.status === 'DRAFT' && !isArchived(a)).length;
  const closedCount = assessments.filter((a) => a.status === 'CLOSED' && !isArchived(a)).length;
  const archivedCount = assessments.filter((a) => isArchived(a)).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-kits-red/10 rounded-xl">
              <GraduationCap className="w-6 h-6 text-kits-red" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Assessments & Examinations</h1>
              <p className="text-sm text-gray-500">
                Author, schedule, proctor, and review automated multiple-choice and true/false examinations.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3 w-full sm:w-auto">
          <button
            onClick={loadAssessments}
            className="p-2.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition border border-gray-200"
            title="Refresh Assessments"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link
            to="/admin/assessments/new"
            className="inline-flex items-center justify-center px-4 py-2.5 bg-kits-red text-white text-sm font-semibold rounded-xl hover:bg-kits-red/90 transition shadow-sm space-x-2"
          >
            <Plus className="w-4 h-4" />
            <span>Create Assessment</span>
          </Link>
        </div>
      </div>

      {successNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-sm flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span className="font-medium">{successNotice}</span>
          </div>
          <button
            onClick={() => setSuccessNotice(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold px-2 py-1 rounded-lg hover:bg-emerald-100/50"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Exams</p>
          <p className="text-3xl font-extrabold text-gray-900 mt-1">{totalCount}</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Active / Published</p>
          <p className="text-3xl font-extrabold text-emerald-600 mt-1">{publishedCount}</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">In Draft</p>
          <p className="text-3xl font-extrabold text-amber-600 mt-1">{draftCount}</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Concluded</p>
          <p className="text-3xl font-extrabold text-blue-600 mt-1">{closedCount}</p>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-4 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl">
            {(['ALL', 'DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'] as const).map((tab) => {
              const count =
                tab === 'ALL'
                  ? totalCount
                  : tab === 'ARCHIVED'
                  ? archivedCount
                  : tab === 'PUBLISHED'
                  ? publishedCount
                  : tab === 'DRAFT'
                  ? draftCount
                  : closedCount;

              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 ${
                    activeTab === tab
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <span>{tab === 'ALL' ? 'All Assessments' : tab.charAt(0) + tab.slice(1).toLowerCase()}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      activeTab === tab ? 'bg-gray-100 text-gray-800' : 'bg-gray-200/70 text-gray-600'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search assessments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
            />
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Assessment Cards List */}
        {loading ? (
          <div className="py-16 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-3 border-kits-red border-t-transparent mx-auto" />
            <p className="mt-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Loading assessment records...
            </p>
          </div>
        ) : filteredAssessments.length === 0 ? (
          <div className="py-16 text-center border-2 border-dashed border-gray-200 rounded-xl">
            <GraduationCap className="w-12 h-12 text-gray-300 mx-auto" />
            <h3 className="mt-3 text-base font-semibold text-gray-800">
              {activeTab === 'ARCHIVED' ? 'No Archived Assessments' : 'No assessments found'}
            </h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              {searchQuery
                ? 'Try adjusting your search filter.'
                : activeTab === 'ARCHIVED'
                ? 'Assessments with historical student records that are safely archived will appear here.'
                : 'Get started by creating your first student assessment.'}
            </p>
            {!searchQuery && activeTab !== 'ARCHIVED' && (
              <Link
                to="/admin/assessments/new"
                className="mt-4 inline-flex items-center px-4 py-2 bg-kits-red text-white text-xs font-semibold rounded-xl hover:bg-kits-red/90 transition"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Create New Assessment
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredAssessments.map((asm) => (
              <div
                key={asm.id}
                onClick={() => navigate(`/admin/assessments/${asm.id}`)}
                className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-gray-50/70 p-3 rounded-xl transition cursor-pointer"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                    <h3 className="text-base font-bold text-gray-900 truncate hover:text-kits-red transition">
                      {asm.title}
                    </h3>
                    {getStatusBadge(asm.status)}
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                      Rev {asm.current_revision_number || 1}
                    </span>
                    {asm.has_draft_revision && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                        Draft Rev {(asm.current_revision_number || 1) + 1}
                      </span>
                    )}
                    {asm.include_in_global_leaderboard && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                        <Trophy className="w-3 h-3 mr-1" />
                        Global Leaderboard
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-1">
                    {asm.description || 'No description provided.'}
                  </p>
                  <div className="flex flex-wrap items-center text-xs text-gray-400 gap-x-4 gap-y-1 pt-1">
                    <span className="flex items-center">
                      <Clock className="w-3.5 h-3.5 mr-1" />
                      {asm.duration_minutes} Minutes
                    </span>
                    <span className="flex items-center">
                      <Calendar className="w-3.5 h-3.5 mr-1" />
                      {new Date(asm.start_time).toLocaleDateString()} — {new Date(asm.end_time).toLocaleDateString()}
                    </span>
                    <span className="flex items-center text-gray-600 font-medium">
                      Passing: {asm.passing_percentage}%
                    </span>
                    <span className="flex items-center text-gray-600 font-medium">
                      Questions: {asm.total_questions_count}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-shrink-0">
                  <Link
                    to={`/admin/assessments/${asm.id}/host`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-semibold rounded-xl transition space-x-1"
                    title="Launch Live Host Screen"
                  >
                    <Radio className="w-3.5 h-3.5 text-purple-600 animate-pulse" />
                    <span>Live Host</span>
                  </Link>

                  <Link
                    to={`/admin/assessments/${asm.id}/report`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold rounded-xl transition space-x-1"
                    title="View Assessment Report & Analytics"
                  >
                    <BarChart3 className="w-3.5 h-3.5 text-blue-600" />
                    <span>Report</span>
                  </Link>

                  <Link
                    to={`/admin/assessments/${asm.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold rounded-xl transition space-x-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Manage Exam</span>
                  </Link>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAsmForDelete(asm);
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition"
                    title="Delete or Archive Assessment"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete / Archive Modal */}
      <AssessmentDeleteModal
        isOpen={selectedAsmForDelete !== null}
        onClose={() => setSelectedAsmForDelete(null)}
        assessment={selectedAsmForDelete}
        onSuccess={(action) => {
          setSuccessNotice(
            action === 'PERMANENTLY_DELETED'
              ? 'Assessment and all associated records have been permanently deleted.'
              : 'Assessment contained student records and has been safely archived.'
          );
          loadAssessments();
        }}
      />
    </div>
  );
}
export default AssessmentsList;
