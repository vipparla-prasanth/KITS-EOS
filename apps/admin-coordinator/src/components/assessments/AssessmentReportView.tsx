import { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  Users,
  HelpCircle,
  MessageSquare,
  FileSpreadsheet,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Clock,
  Award,
  RefreshCw,
  Search,
  Filter,
  ArrowUpDown,
  Lock,
  ChevronLeft,
  ChevronRight,
  Zap,
  TrendingDown,
  Check,
  AlertTriangle,
} from 'lucide-react';
import {
  assessmentService,
  generateStudentPerformanceCsv,
  getAssessmentReportCsvFilename,
  renderSequentialStudentPerformancePngs,
  downloadSequentialReportPngs,
} from '@kits-eos/shared';
import type { AssessmentReportData } from '@kits-eos/shared';
import {
  StatusDistributionDonut,
  AccuracyDonutChart,
  OptionDistributionChart,
  PerformanceDistributionCard,
} from './AssessmentCharts';

interface AssessmentReportViewProps {
  assessmentId: string;
  coordinatorToken?: string;
  onBack?: () => void;
  onBackToAssessment?: () => void;
  titlePrefix?: string;
}

export function AssessmentReportView({
  assessmentId,
  coordinatorToken,
  onBack,
  onBackToAssessment,
}: AssessmentReportViewProps) {
  const effectiveBack = onBack || onBackToAssessment;
  const [report, setReport] = useState<AssessmentReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeReportTab, setActiveReportTab] = useState<'SUMMARY' | 'PLAYERS' | 'QUESTIONS' | 'FEEDBACK'>('SUMMARY');

  // Players tab state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PASSED' | 'FAILED' | 'SUBMITTED' | 'EXPIRED' | 'TERMINATED'>('ALL');
  const [sortField, setSortField] = useState<'rank' | 'academic_score' | 'academic_percentage' | 'eos_points' | 'total_response_time_seconds'>('rank');
  const [sortAsc, setSortAsc] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Export progress states
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [pngProgressMessage, setPngProgressMessage] = useState<string | null>(null);
  const [actionSuccessNotice, setActionSuccessNotice] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await assessmentService.getAssessmentReport(assessmentId, coordinatorToken);
      if (err) throw err;
      if (data) {
        setReport(data as AssessmentReportData);
      } else {
        throw new Error('Received empty response from analytics service.');
      }
    } catch (err: any) {
      console.error('Failed to load assessment report:', err);
      setError(err.message || 'Unable to load post-assessment analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (assessmentId) {
      fetchReport();
    }
  }, [assessmentId, coordinatorToken]);

  // Handle Manual Finalize
  const handleFinalizeAssessment = async () => {
    if (!window.confirm('Are you sure you want to close this examination and freeze all student scores? This action will finalize the official leaderboard and report.')) {
      return;
    }
    setIsFinalizing(true);
    try {
      const { error: err } = await assessmentService.closeAndFinalizeAssessment(assessmentId, coordinatorToken);
      if (err) throw err;
      setActionSuccessNotice('Examination closed and report finalized successfully.');
      await fetchReport();
    } catch (err: any) {
      console.error('Finalize error:', err);
      alert(err.message || 'Failed to finalize assessment.');
    } finally {
      setIsFinalizing(false);
    }
  };

  // CSV Export Action
  const handleExportCsv = () => {
    if (!report) return;
    setIsExportingCsv(true);
    try {
      const csvString = generateStudentPerformanceCsv(report);
      const filename = getAssessmentReportCsvFilename(report.assessment?.title || 'Report');

      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setActionSuccessNotice(`Performance CSV downloaded (${report.students?.length || 0} candidate records).`);
    } catch (err: any) {
      console.error('CSV export failed:', err);
      alert('Failed to export CSV: ' + err.message);
    } finally {
      setIsExportingCsv(false);
    }
  };

  // PNG Multi-part Export Action
  const handleExportPng = async () => {
    if (!report) return;
    setIsExportingPng(true);
    setPngProgressMessage('Rendering high-resolution report canvases...');
    try {
      const pages = await renderSequentialStudentPerformancePngs(report, 25);
      setPngProgressMessage(`Generated ${pages.length} sequential parts. Downloading images...`);
      await downloadSequentialReportPngs(pages);
      setActionSuccessNotice(
        pages.length > 1
          ? `Downloaded ${pages.length} sequential PNG parts (Part 1 to ${pages.length}).`
          : 'High-resolution PNG report downloaded successfully.'
      );
    } catch (err: any) {
      console.error('PNG export failed:', err);
      alert('Failed to generate PNG report: ' + err.message);
    } finally {
      setIsExportingPng(false);
      setPngProgressMessage(null);
    }
  };

  // Filtered and Sorted Students
  const filteredStudents = useMemo(() => {
    if (!report?.students) return [];

    let list = [...report.students];

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (st) =>
          st.student_name.toLowerCase().includes(q) ||
          st.roll_number.toLowerCase().includes(q) ||
          st.college_name.toLowerCase().includes(q) ||
          (st.email && st.email.toLowerCase().includes(q))
      );
    }

    // Status filter
    if (statusFilter === 'PASSED') {
      list = list.filter((st) => st.is_passed);
    } else if (statusFilter === 'FAILED') {
      list = list.filter((st) => !st.is_passed && st.attempt_status !== 'IN_PROGRESS');
    } else if (statusFilter === 'SUBMITTED') {
      list = list.filter((st) => st.attempt_status === 'SUBMITTED');
    } else if (statusFilter === 'EXPIRED') {
      list = list.filter((st) => st.attempt_status === 'EXPIRED');
    } else if (statusFilter === 'TERMINATED') {
      list = list.filter((st) => st.attempt_status === 'TERMINATED');
    }

    // Sort
    list.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];
      if (valA === valB) {
        return (a.roll_number || '').localeCompare(b.roll_number || '');
      }
      return sortAsc ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1;
    });

    return list;
  }, [report, searchQuery, statusFilter, sortField, sortAsc]);

  // Paginated Students
  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / rowsPerPage));
  const paginatedStudents = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredStudents.slice(start, start + rowsPerPage);
  }, [filteredStudents, currentPage, rowsPerPage]);

  // Difficult questions (< 40% accuracy)
  const difficultQuestions = useMemo(() => {
    if (!report?.questions) return [];
    return report.questions.filter((q) => q.is_difficult);
  }, [report]);

  // Top 3 Podium
  const topPodium = useMemo(() => {
    if (!report?.students) return [];
    return report.students.slice(0, 3);
  }, [report]);

  if (loading) {
    return (
      <div className="bg-white rounded-3xl border border-gray-200/90 shadow-sm p-16 text-center space-y-4">
        <div className="w-10 h-10 border-3 border-kits-blue border-t-transparent rounded-full animate-spin mx-auto" />
        <h3 className="text-base font-bold text-gray-900">Loading Authoritative Assessment Report...</h3>
        <p className="text-xs text-gray-500">Aggregating student attempts, response timing, and question difficulty.</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="bg-white rounded-3xl border border-red-200 shadow-sm p-12 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-gray-900">Unable to Load Assessment Report</h3>
        <p className="text-xs text-red-700 max-w-md mx-auto">{error || 'Report data is unavailable.'}</p>
        <div className="pt-2 flex justify-center space-x-3">
          {effectiveBack && (
            <button
              onClick={effectiveBack}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition"
            >
              Back
            </button>
          )}
          <button
            onClick={fetchReport}
            className="px-4 py-2 bg-kits-blue hover:bg-kits-blue/90 text-white font-bold text-xs rounded-xl transition inline-flex items-center space-x-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  const { assessment, summary, students, questions, feedback } = report;

  return (
    <div className="space-y-6">
      {/* 1. Header Card (Kahoot-inspired, Navy & Crimson theme) */}
      <div className="bg-white rounded-2xl border border-gray-200/90 p-6 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              {effectiveBack && (
                <button
                  type="button"
                  onClick={effectiveBack}
                  className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition mr-1 cursor-pointer"
                  title="Back"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                {assessment.title}
              </h1>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider inline-flex items-center ${
                  assessment.is_closed
                    ? 'bg-gray-100 text-gray-800 border border-gray-300'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}
              >
                {assessment.is_closed ? (
                  <>
                    <Lock className="w-3 h-3 mr-1 text-gray-500" />
                    Finalized Report
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                    Live Exam In Progress
                  </>
                )}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Authoritative post-assessment analytics, student standings with separate academic marks & EOS points, and question performance breakdown.
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            {!assessment.is_closed && (
              <button
                type="button"
                onClick={handleFinalizeAssessment}
                disabled={isFinalizing}
                className="inline-flex items-center px-3.5 py-2 bg-kits-red hover:bg-kits-red/90 text-white text-xs font-bold rounded-xl transition shadow-2xs space-x-1.5 cursor-pointer disabled:opacity-50"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{isFinalizing ? 'Finalizing...' : 'Close & Finalize Report'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={isExportingCsv || students.length === 0}
              className="inline-flex items-center px-4 py-2 bg-kits-blue hover:bg-kits-blue/90 text-white text-xs font-bold rounded-xl transition shadow-2xs space-x-1.5 cursor-pointer disabled:opacity-50"
              title="Download UTF-8 Spreadsheet CSV"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>{isExportingCsv ? 'Exporting...' : 'Export CSV'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportPng}
              disabled={isExportingPng || students.length === 0}
              className="inline-flex items-center px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl transition shadow-2xs space-x-1.5 cursor-pointer disabled:opacity-50"
              title="Download High-Resolution Multi-part PNG Report"
            >
              <ImageIcon className="w-4 h-4" />
              <span>{isExportingPng ? 'Rendering...' : 'Export PNG'}</span>
            </button>

            <button
              type="button"
              onClick={fetchReport}
              className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition cursor-pointer"
              title="Refresh Analytics"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Feedback Notices */}
        {actionSuccessNotice && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center justify-between shadow-2xs">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span className="font-medium">{actionSuccessNotice}</span>
            </div>
            <button onClick={() => setActionSuccessNotice(null)} className="font-bold underline text-emerald-700">
              Dismiss
            </button>
          </div>
        )}

        {pngProgressMessage && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-800 text-xs flex items-center space-x-2 animate-pulse">
            <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span>{pngProgressMessage}</span>
          </div>
        )}

        {/* Kahoot-Style Tab Navigation */}
        <div className="flex border-b border-gray-200 space-x-2 sm:space-x-4 pt-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveReportTab('SUMMARY')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 cursor-pointer flex-shrink-0 ${
              activeReportTab === 'SUMMARY'
                ? 'border-kits-red text-kits-red'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Summary</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveReportTab('PLAYERS')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 cursor-pointer flex-shrink-0 ${
              activeReportTab === 'PLAYERS'
                ? 'border-kits-red text-kits-red'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Players ({students.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveReportTab('QUESTIONS')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 cursor-pointer flex-shrink-0 ${
              activeReportTab === 'QUESTIONS'
                ? 'border-kits-red text-kits-red'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            <span>Questions ({questions.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveReportTab('FEEDBACK')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 cursor-pointer flex-shrink-0 ${
              activeReportTab === 'FEEDBACK'
                ? 'border-kits-red text-kits-red'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Feedback {feedback?.total_responses ? `(${feedback.total_responses})` : ''}</span>
          </button>
        </div>
      </div>

      {/* 2. SUMMARY TAB CONTENT */}
      {activeReportTab === 'SUMMARY' && (
        <div className="space-y-6">
          {/* 6 Key Performance Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {/* Card 1: Eligible */}
            <div className="bg-white border border-gray-200/90 p-4 rounded-2xl shadow-sm">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center">
                <Users className="w-3.5 h-3.5 mr-1 text-gray-400" /> Eligible
              </span>
              <p className="mt-1 text-2xl font-black text-gray-900">{summary.total_eligible}</p>
              <span className="text-[10px] text-gray-400">Total roster capacity</span>
            </div>

            {/* Card 2: Participants */}
            <div className="bg-white border border-blue-200/80 p-4 rounded-2xl shadow-sm">
              <span className="text-[11px] font-bold text-kits-blue uppercase tracking-wider flex items-center">
                <Users className="w-3.5 h-3.5 mr-1" /> Participants
              </span>
              <p className="mt-1 text-2xl font-black text-kits-blue">{summary.total_participants}</p>
              <span className="text-[10px] text-gray-500">
                {summary.total_eligible > 0
                  ? `${((summary.total_participants * 100) / summary.total_eligible).toFixed(1)}% turnout`
                  : 'Candidates started'}
              </span>
            </div>

            {/* Card 3: Completed */}
            <div className="bg-white border border-emerald-200/80 p-4 rounded-2xl shadow-sm">
              <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Completed
              </span>
              <p className="mt-1 text-2xl font-black text-emerald-700">{summary.completed_attempts}</p>
              <span className="text-[10px] text-gray-500">{summary.completion_rate}% completion rate</span>
            </div>

            {/* Card 4: Incomplete */}
            <div className="bg-white border border-amber-200/80 p-4 rounded-2xl shadow-sm">
              <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider flex items-center">
                <Clock className="w-3.5 h-3.5 mr-1" /> Incomplete
              </span>
              <p className="mt-1 text-2xl font-black text-amber-700">
                {summary.expired_attempts + summary.terminated_attempts + summary.in_progress_attempts}
              </p>
              <span className="text-[10px] text-gray-500">
                {summary.expired_attempts} expired • {summary.terminated_attempts} terminated
              </span>
            </div>

            {/* Card 5: Average Academic Score */}
            <div className="bg-white border border-gray-200/90 p-4 rounded-2xl shadow-sm">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center">
                <Award className="w-3.5 h-3.5 mr-1 text-gray-400" /> Avg Score
              </span>
              <p className="mt-1 text-2xl font-black text-gray-900">
                {summary.avg_academic_score.toFixed(1)}
                <span className="text-xs text-gray-400 font-semibold ml-1">/ {assessment.total_points}</span>
              </p>
              <span className="text-[10px] text-gray-500">{summary.avg_academic_percentage}% academic avg</span>
            </div>

            {/* Card 6: Average Accuracy */}
            <div className="bg-white border border-purple-200/80 p-4 rounded-2xl shadow-sm">
              <span className="text-[11px] font-bold text-purple-700 uppercase tracking-wider flex items-center">
                <Zap className="w-3.5 h-3.5 mr-1" /> Accuracy
              </span>
              <p className="mt-1 text-2xl font-black text-purple-700">{summary.avg_accuracy_percentage}%</p>
              <span className="text-[10px] text-gray-500">{summary.total_correct_answers} / {summary.total_answers_submitted} correct</span>
            </div>
          </div>

          {/* Visual Analytics: Session Status & Overall Accuracy Donut Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <StatusDistributionDonut
              completed={summary.completed_attempts}
              inProgress={summary.in_progress_attempts}
              notStarted={Math.max(0, summary.total_eligible - summary.total_participants)}
              terminated={summary.terminated_attempts}
              expired={summary.expired_attempts}
              totalEligible={summary.total_eligible}
              title="Assessment Session Status Distribution"
              subtitle="Proportions across finalized, in-progress, expired, and unattempted candidates"
            />
            <AccuracyDonutChart
              correct={summary.total_correct_answers}
              incorrect={Math.max(0, summary.total_answers_submitted - summary.total_correct_answers)}
              totalResponses={summary.total_answers_submitted}
              title="Overall Response Accuracy Breakdown"
              size={170}
            />
          </div>

          {/* Score Range & Performance Distribution (Donut Proportions + Horizontal Student Count Bars) */}
          <PerformanceDistributionCard
            students={students}
            passingPercentage={assessment.passing_percentage || 40}
          />

          {/* 2 Kahoot-Inspired Highlight Cards (Difficult Questions & Top Standings) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Card A: Difficult Questions Highlight */}
            <div className="bg-white border border-gray-200/90 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <div className="p-2 bg-red-50 text-red-600 rounded-xl">
                    <TrendingDown className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Difficult Questions ({difficultQuestions.length})</h3>
                    <p className="text-[11px] text-gray-500">Questions answered correctly by less than 40% of candidates.</p>
                  </div>
                </div>
                {difficultQuestions.length > 0 && (
                  <button
                    onClick={() => setActiveReportTab('QUESTIONS')}
                    className="text-xs font-bold text-kits-blue hover:underline"
                  >
                    View All Questions
                  </button>
                )}
              </div>

              {difficultQuestions.length === 0 ? (
                <div className="p-6 bg-emerald-50/50 border border-emerald-100 rounded-xl text-center space-y-1">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto" />
                  <p className="text-xs font-bold text-emerald-900">No Difficult Questions Detected</p>
                  <p className="text-[11px] text-emerald-700">All questions attained 40% or higher correct response rate.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {difficultQuestions.slice(0, 3).map((q) => (
                    <div key={q.question_id} className="p-3.5 bg-red-50/40 border border-red-100 rounded-xl text-xs space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-red-900">Question #{q.question_number}</span>
                        <span className="px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-800 text-[10px]">
                          {q.correct_percentage}% Correct
                        </span>
                      </div>
                      <p className="text-gray-800 line-clamp-2 font-medium">{q.question_text}</p>
                      <div className="text-[11px] text-gray-500 flex items-center space-x-3 pt-0.5">
                        <span>{q.incorrect_count} incorrect answers</span>
                        <span>•</span>
                        <span>{q.avg_response_time_seconds}s avg response time</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Card B: Top Performers Podium Snapshot */}
            <div className="bg-white border border-gray-200/90 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Top Standings</h3>
                    <p className="text-[11px] text-gray-500">Highest ranked candidates based on score and speed.</p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveReportTab('PLAYERS')}
                  className="text-xs font-bold text-kits-blue hover:underline"
                >
                  View All Players
                </button>
              </div>

              {topPodium.length === 0 ? (
                <div className="p-6 bg-gray-50 border border-gray-100 rounded-xl text-center text-xs text-gray-400">
                  No candidate submissions recorded yet.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {topPodium.map((st) => (
                    <div
                      key={st.student_id}
                      className="p-3 bg-gray-50/70 border border-gray-100 rounded-xl flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center space-x-3">
                        <span className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs bg-amber-100 text-amber-900">
                          {st.rank === 1 ? '🥇' : st.rank === 2 ? '🥈' : '🥉'}
                        </span>
                        <div>
                          <div className="font-bold text-gray-900">{st.student_name}</div>
                          <div className="text-[10px] text-gray-500 font-mono">{st.roll_number} • {st.college_name}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold font-mono text-kits-blue text-sm">
                          {st.academic_score} / {st.max_score} pts
                        </div>
                        <div className="text-[10px] text-purple-700 font-mono font-bold">
                          +{st.eos_points} EOS Speed pts
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Timing & Audit Session Card */}
          <div className="bg-white border border-gray-200/90 rounded-2xl p-6 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
              <Clock className="w-4 h-4 text-kits-blue" />
              <span>Examination Lifecycle & Session Audit</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-3 bg-gray-50 rounded-xl space-y-1">
                <span className="text-gray-400 font-medium">Scheduled Window:</span>
                <p className="font-semibold text-gray-800">
                  {new Date(assessment.start_time).toLocaleString()} — {new Date(assessment.end_time).toLocaleString()}
                </p>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl space-y-1">
                <span className="text-gray-400 font-medium">Actual Examination Period:</span>
                <p className="font-semibold text-gray-800">
                  {new Date(assessment.actual_start_time).toLocaleString()} — {new Date(assessment.actual_end_time).toLocaleString()}
                </p>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl space-y-1">
                <span className="text-gray-400 font-medium">Report Freeze & Finalization:</span>
                <p className="font-semibold text-emerald-800">
                  {assessment.report_finalized_at
                    ? new Date(assessment.report_finalized_at).toLocaleString()
                    : 'Awaiting Examination Closure'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. PLAYERS / STUDENT PERFORMANCE TAB */}
      {activeReportTab === 'PLAYERS' && (
        <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-6 space-y-6">
          {/* Search, Filter & Quick Stats Bar */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center space-x-3 w-full md:w-auto flex-1 max-w-md">
              <div className="relative w-full">
                <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search student name, roll number, or college..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-kits-blue"
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 w-full md:w-auto justify-end flex-wrap gap-y-2">
              {/* Status Filter */}
              <div className="flex items-center space-x-1.5 bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs">
                <Filter className="w-3.5 h-3.5 text-gray-400" />
                <select
                  value={statusFilter}
                  onChange={(e: any) => {
                    setStatusFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-transparent text-xs font-semibold text-gray-700 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Candidates ({students.length})</option>
                  <option value="PASSED">Passed Only</option>
                  <option value="FAILED">Failed Only</option>
                  <option value="SUBMITTED">Submitted</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="TERMINATED">Terminated</option>
                </select>
              </div>

              {/* Rows Per Page */}
              <select
                value={rowsPerPage}
                onChange={(e) => {
                  setRowsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none cursor-pointer"
              >
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
              </select>

              {/* Export Actions inside Table Header */}
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={isExportingCsv || students.length === 0}
                className="inline-flex items-center px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold transition space-x-1 cursor-pointer"
                title="Download CSV"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>

              <button
                type="button"
                onClick={handleExportPng}
                disabled={isExportingPng || students.length === 0}
                className="inline-flex items-center px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold transition space-x-1 cursor-pointer"
                title="Download Sequential PNGs"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>PNG</span>
              </button>
            </div>
          </div>

          {/* Student Performance Table */}
          <div className="overflow-x-auto border border-gray-200 rounded-2xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold uppercase text-[10px]">
                <tr>
                  <th
                    className="py-3 px-3.5 text-center cursor-pointer hover:bg-gray-100 transition"
                    onClick={() => {
                      if (sortField === 'rank') setSortAsc(!sortAsc);
                      else {
                        setSortField('rank');
                        setSortAsc(true);
                      }
                    }}
                  >
                    <div className="inline-flex items-center space-x-1">
                      <span>Rank</span>
                      <ArrowUpDown className="w-3 h-3 text-gray-400" />
                    </div>
                  </th>
                  <th className="py-3 px-4">Candidate Details</th>
                  <th className="py-3 px-3">Roll Number</th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:bg-gray-100 transition"
                    onClick={() => {
                      if (sortField === 'academic_score') setSortAsc(!sortAsc);
                      else {
                        setSortField('academic_score');
                        setSortAsc(false);
                      }
                    }}
                  >
                    <div className="inline-flex items-center space-x-1 justify-end">
                      <span>Academic Score</span>
                      <ArrowUpDown className="w-3 h-3 text-gray-400" />
                    </div>
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:bg-gray-100 transition"
                    onClick={() => {
                      if (sortField === 'academic_percentage') setSortAsc(!sortAsc);
                      else {
                        setSortField('academic_percentage');
                        setSortAsc(false);
                      }
                    }}
                  >
                    <div className="inline-flex items-center space-x-1 justify-end">
                      <span>%</span>
                      <ArrowUpDown className="w-3 h-3 text-gray-400" />
                    </div>
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:bg-gray-100 transition"
                    onClick={() => {
                      if (sortField === 'eos_points') setSortAsc(!sortAsc);
                      else {
                        setSortField('eos_points');
                        setSortAsc(false);
                      }
                    }}
                  >
                    <div className="inline-flex items-center space-x-1 justify-end text-purple-700">
                      <span>EOS Speed Pts</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-400" />
                    </div>
                  </th>
                  <th className="py-3 px-3 text-center">Accuracy (C / I / U)</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:bg-gray-100 transition"
                    onClick={() => {
                      if (sortField === 'total_response_time_seconds') setSortAsc(!sortAsc);
                      else {
                        setSortField('total_response_time_seconds');
                        setSortAsc(true);
                      }
                    }}
                  >
                    <div className="inline-flex items-center space-x-1 justify-end">
                      <span>Time</span>
                      <ArrowUpDown className="w-3 h-3 text-gray-400" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginatedStudents.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-xs text-gray-400">
                      No candidate performance records match the selected search or filter criteria.
                    </td>
                  </tr>
                ) : (
                  paginatedStudents.map((st) => (
                    <tr key={st.student_id} className="hover:bg-gray-50/70 transition">
                      {/* Rank */}
                      <td className="py-3 px-3.5 text-center">
                        <span
                          className={`w-7 h-7 rounded-full inline-flex items-center justify-center font-bold text-xs ${
                            st.rank === 1
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : st.rank === 2
                              ? 'bg-gray-200 text-gray-800 border border-gray-300'
                              : st.rank === 3
                              ? 'bg-orange-100 text-orange-900 border border-orange-300'
                              : 'text-gray-600 font-mono'
                          }`}
                        >
                          {st.rank === 1 ? '🥇' : st.rank === 2 ? '🥈' : st.rank === 3 ? '🥉' : st.rank}
                        </span>
                      </td>

                      {/* Candidate Details */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-gray-900">{st.student_name}</div>
                        <div className="text-[10px] text-gray-400">{st.college_name}</div>
                      </td>

                      {/* Roll Number */}
                      <td className="py-3 px-3 font-mono font-semibold text-gray-700">
                        {st.roll_number}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            st.attempt_status === 'SUBMITTED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : st.attempt_status === 'TERMINATED'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {st.attempt_status}
                        </span>
                      </td>

                      {/* Academic Score */}
                      <td className="py-3 px-3 text-right">
                        <span className="font-black font-mono text-gray-900 text-sm">
                          {st.academic_score.toFixed(1)}
                        </span>
                        <span className="text-[10px] text-gray-400 ml-1">/ {st.max_score}</span>
                      </td>

                      {/* Percentage */}
                      <td className="py-3 px-3 text-right">
                        <span
                          className={`font-bold font-mono text-xs ${
                            st.is_passed ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {st.academic_percentage.toFixed(1)}%
                        </span>
                      </td>

                      {/* EOS Speed Bonus (Distinct Column!) */}
                      <td className="py-3 px-3 text-right">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold text-xs bg-purple-50 text-purple-700 border border-purple-200">
                          +{st.eos_points.toFixed(0)} pts
                        </span>
                      </td>

                      {/* Accuracy (C / I / U) */}
                      <td className="py-3 px-3 text-center">
                        <span className="text-[11px] font-mono text-gray-600">
                          <strong className="text-emerald-700">{st.correct_count}</strong> C /{' '}
                          <strong className="text-red-600">{st.incorrect_count}</strong> I /{' '}
                          <span className="text-gray-400">{st.unanswered_count}</span> U
                        </span>
                      </td>

                      {/* Response Time */}
                      <td className="py-3 px-3 text-right font-mono text-xs text-gray-500">
                        {st.total_response_time_seconds.toFixed(0)}s
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {filteredStudents.length > 0 && (
            <div className="flex items-center justify-between text-xs text-gray-500 pt-2">
              <div>
                Showing {(currentPage - 1) * rowsPerPage + 1} to{' '}
                {Math.min(currentPage * rowsPerPage, filteredStudents.length)} of {filteredStudents.length} candidates
              </div>
              <div className="flex items-center space-x-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 font-mono font-bold">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. QUESTIONS PERFORMANCE TAB */}
      {activeReportTab === 'QUESTIONS' && (
        <div className="space-y-4">
          <div className="p-4 bg-white rounded-2xl border border-gray-200/90 shadow-sm flex justify-between items-center">
            <div>
              <h3 className="text-base font-bold text-gray-900">Per-Question Accuracy & Analytics</h3>
              <p className="text-xs text-gray-500">Detailed performance distribution for every registered question.</p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-kits-blue">
              {questions.length} Active Questions
            </span>
          </div>

          {questions.length === 0 ? (
            <div className="p-12 bg-white rounded-2xl border border-gray-200 text-center text-xs text-gray-400">
              No registered questions found for this assessment.
            </div>
          ) : (
            <div className="space-y-4">
              {questions.map((q) => (
                <div key={q.question_id} className="p-5 bg-white rounded-2xl border border-gray-200/90 shadow-sm space-y-4">
                  {/* Question Header */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div className="flex items-center space-x-2">
                      <span className="w-7 h-7 rounded-lg bg-gray-900 text-white font-bold text-xs flex items-center justify-center">
                        #{q.question_number}
                      </span>
                      <span className="px-2 py-0.5 rounded-md font-bold text-[10px] bg-blue-100 text-blue-800">
                        {q.question_type}
                      </span>
                      <span className="font-bold text-xs text-gray-700">
                        {q.points} {q.points === 1 ? 'Mark' : 'Marks'}
                      </span>
                      <span className="text-gray-400 text-xs">
                        • {q.time_limit_seconds}s limit
                      </span>
                      {q.is_difficult && (
                        <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-red-100 text-red-800 flex items-center space-x-1">
                          <AlertTriangle className="w-3 h-3 text-red-600" />
                          <span>Difficult Question (&lt; 40% Correct)</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-4 text-xs">
                      <div>
                        <span className="text-gray-400">Total Responses: </span>
                        <strong className="font-mono text-gray-800">{q.total_responses}</strong>
                      </div>
                      <div>
                        <span className="text-gray-400">Avg Time: </span>
                        <strong className="font-mono text-gray-800">{q.avg_response_time_seconds}s</strong>
                      </div>
                    </div>
                  </div>

                  {/* Question Text */}
                  <div className="font-bold text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">
                    {q.question_text}
                  </div>

                  {/* Accuracy Donut Visualizer */}
                  <div className="p-3.5 bg-gray-50/70 border border-gray-200/80 rounded-xl">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-2">
                      Response Accuracy Proportion:
                    </span>
                    <AccuracyDonutChart
                      correct={q.correct_count}
                      incorrect={q.incorrect_count}
                      unanswered={q.unanswered_count}
                      totalResponses={q.total_responses}
                      compact={true}
                    />
                  </div>

                  {/* Answer Key Callout (Restricted to Authorized Admins / Coordinators) */}
                  {q.correct_answer_preview && (
                    <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs flex items-center space-x-2 text-emerald-900">
                      <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span>
                        <strong>Correct Answer:</strong> {q.correct_answer_preview}
                      </span>
                    </div>
                  )}

                  {/* Option Response Distribution Donut / Pie Visualization for Multiple Choice */}
                  {q.options_breakdown && q.options_breakdown.length > 0 && (
                    <OptionDistributionChart
                      options={q.options_breakdown}
                      totalResponses={q.total_responses}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. FEEDBACK TAB */}
      {activeReportTab === 'FEEDBACK' && (
        <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-6 space-y-6">
          <div className="border-b border-gray-100 pb-4">
            <h3 className="text-base font-bold text-gray-900 flex items-center space-x-2">
              <MessageSquare className="w-5 h-5 text-kits-blue" />
              <span>Participant Post-Assessment Feedback</span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Collected ratings and experience reviews submitted by candidates.
            </p>
          </div>

          {!feedback || !feedback.has_feedback ? (
            <div className="py-12 text-center space-y-2">
              <MessageSquare className="w-10 h-10 text-gray-300 mx-auto" />
              <p className="text-xs font-bold text-gray-700">No Assessment Feedback Responses Recorded</p>
              <p className="text-[11px] text-gray-400 max-w-sm mx-auto">
                No post-examination survey responses have been submitted for this session. Candidate results and question telemetry remain fully available.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Ratings Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 text-center sm:col-span-2">
                  <span className="text-[10px] font-bold uppercase text-blue-600">Overall Average Rating</span>
                  <div className="text-2xl font-black text-blue-900 mt-1">
                    {feedback.avg_rating} / 5.0
                  </div>
                  <span className="text-[10px] text-blue-700">{feedback.total_responses} candidate submissions</span>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-center">
                  <span className="text-[10px] font-bold uppercase text-gray-400">Content</span>
                  <div className="text-lg font-bold font-mono text-gray-800 mt-0.5">{feedback.rating_1_avg}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-center">
                  <span className="text-[10px] font-bold uppercase text-gray-400">Clarity</span>
                  <div className="text-lg font-bold font-mono text-gray-800 mt-0.5">{feedback.rating_2_avg}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-center">
                  <span className="text-[10px] font-bold uppercase text-gray-400">Platform</span>
                  <div className="text-lg font-bold font-mono text-gray-800 mt-0.5">{feedback.rating_3_avg}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-center">
                  <span className="text-[10px] font-bold uppercase text-gray-400">Duration</span>
                  <div className="text-lg font-bold font-mono text-gray-800 mt-0.5">{feedback.rating_4_avg}</div>
                </div>
              </div>

              {/* Sample Comments */}
              {feedback.sample_comments && feedback.sample_comments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                    Candidate Comments & Observations
                  </h4>
                  <div className="space-y-2">
                    {feedback.sample_comments.map((comment, idx) => (
                      <div key={idx} className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-800">
                        "{comment}"
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
export default AssessmentReportView;
