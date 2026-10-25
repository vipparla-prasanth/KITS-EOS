import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  AlertCircle,
  Lock,
  ArrowLeft,
  RefreshCw,
  Download,
  Sparkles,
  FileText,
  Image as ImageIcon,
  ShieldAlert,
} from 'lucide-react';
import {
  assessmentService,
  type Assessment,
  type AssessmentAttempt,
  type AssessmentQuestion,
  type AssessmentAttemptAnswer,
  type LeaderboardEntry,
  getRandomAssessmentMessage,
} from '@kits-eos/shared';
import { useAuth } from '../../context/AuthContext';
import {
  downloadAssessmentResultAsPdf,
  downloadAssessmentResultAsImage,
} from '../../utils/assessmentExport';

interface AssessmentResultViewProps {
  assessment: Assessment;
  attempt: AssessmentAttempt;
  questions: AssessmentQuestion[];
  answers: AssessmentAttemptAnswer[];
  leaderboard: LeaderboardEntry[];
  solutionsMap: Record<string, any>;
  profile: any;
  onRefreshLeaderboard: () => void;
}

/**
 * Presentational child component for displaying finalized assessment results.
 * Isolated to strictly guarantee identical Hook order and unconditional Hook execution
 * on every render pass, completely preventing React Hook error #310.
 */
export function AssessmentResultView({
  assessment,
  attempt,
  questions,
  answers,
  leaderboard,
  solutionsMap,
  profile,
  onRefreshLeaderboard,
}: AssessmentResultViewProps) {
  const [activeTab, setActiveTab] = useState<'SCORE' | 'REVIEW' | 'LEADERBOARD'>('SCORE');
  const [downloadingResultPdf, setDownloadingResultPdf] = useState(false);
  const [downloadingResultPng, setDownloadingResultPng] = useState(false);

  // Calculate total possible points
  const totalPoints = useMemo(
    () => questions.reduce((acc, q) => acc + (Number(q.points) || 0), 0),
    [questions]
  );
  const earnedScore = Number(attempt.question_score ?? attempt.score) || 0;
  const eosPoints = Number(attempt.eos_points ?? attempt.speed_bonus_score) || 0;
  const scorePercentage = totalPoints > 0 ? (earnedScore / totalPoints) * 100 : 0;
  const isPassed = scorePercentage >= assessment.passing_percentage;
  const isTerminated =
    attempt.status === 'TERMINATED' || (attempt.strike_count != null && attempt.strike_count >= 3);

  // Answers Map: questionId -> answer
  const answersByQuestionId = useMemo(() => {
    const map: Record<string, AssessmentAttemptAnswer> = {};
    answers.forEach((ans) => {
      map[ans.question_id] = ans;
    });
    return map;
  }, [answers]);

  // Analytics counts
  const { correctCount, incorrectCount, unattemptedCount } = useMemo(() => {
    const correct = answers.filter((a) => a.is_correct === true).length;
    const incorrect = answers.filter((a) => a.is_correct === false).length;
    const unattempted = Math.max(0, questions.length - answers.length);
    return { correctCount: correct, incorrectCount: incorrect, unattemptedCount: unattempted };
  }, [answers, questions.length]);

  // Closing Time Check
  const isClosed = useMemo(() => {
    const now = new Date();
    return now >= new Date(assessment.end_time) || assessment.status === 'CLOSED';
  }, [assessment.end_time, assessment.status]);

  // Find official rank if closed
  const officialRank = useMemo(() => {
    return isClosed ? leaderboard.find((l) => l.student_name === profile?.full_name)?.rank : null;
  }, [isClosed, leaderboard, profile?.full_name]);

  // Campus-appropriate result message (terminated proctoring, passing celebration, or encouragement)
  const resultMessage = useMemo(() => {
    if (isTerminated) {
      return getRandomAssessmentMessage('PROCTORING_TERMINATED');
    }
    if (isPassed) {
      return getRandomAssessmentMessage('RESULT_QUALIFYING_PASS');
    }
    return getRandomAssessmentMessage('RESULT_ENCOURAGEMENT');
  }, [isTerminated, isPassed]);

  // Export Options Payload
  const getExportOptions = useCallback(
    () => ({
      assessmentTitle: assessment.title,
      studentName: profile?.full_name || 'Student Candidate',
      rollNumber: profile?.roll_number || '',
      department: profile?.department || '',
      college: profile?.college || 'KITS Akshar Institute of Technology',
      completionDate: attempt.submitted_at
        ? new Date(attempt.submitted_at).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        : new Date().toLocaleDateString('en-IN'),
      earnedScore,
      totalPoints,
      percentage: scorePercentage,
      isPassed: isTerminated ? false : isPassed,
      passingPercentage: assessment.passing_percentage,
      rank: isTerminated ? null : officialRank,
      totalCandidates: leaderboard.length > 0 ? leaderboard.length : null,
      awardType: null,
      correctCount,
      incorrectCount,
      unattemptedCount,
      totalQuestions: questions.length,
      strikeCount: attempt.strike_count || 0,
      resultReferenceId: `KITS-RES-${attempt.id.slice(0, 8)}`,
      questions,
      answers,
      solutionsMap,
      isClosed,
    }),
    [
      assessment.title,
      assessment.passing_percentage,
      profile?.full_name,
      profile?.roll_number,
      profile?.department,
      profile?.college,
      attempt.submitted_at,
      attempt.strike_count,
      attempt.id,
      earnedScore,
      totalPoints,
      scorePercentage,
      isPassed,
      isTerminated,
      officialRank,
      leaderboard.length,
      correctCount,
      incorrectCount,
      unattemptedCount,
      questions,
      answers,
      solutionsMap,
      isClosed,
    ]
  );

  const handleDownloadResultPdf = async () => {
    setDownloadingResultPdf(true);
    try {
      await downloadAssessmentResultAsPdf(getExportOptions());
    } catch (err) {
      console.error('Failed to download PDF result:', err);
    } finally {
      setDownloadingResultPdf(false);
    }
  };

  const handleDownloadResultPng = async () => {
    setDownloadingResultPng(true);
    try {
      await downloadAssessmentResultAsImage(getExportOptions());
    } catch (err) {
      console.error('Failed to download PNG result:', err);
    } finally {
      setDownloadingResultPng(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top Action Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <Link
            to="/assessments"
            className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-gray-800 transition"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Assessment Directory
          </Link>

          {/* Download Result Document Actions */}
          <div className="flex items-center space-x-2">
            <button
              onClick={handleDownloadResultPdf}
              disabled={downloadingResultPdf}
              className="inline-flex items-center px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 shadow-2xs transition cursor-pointer disabled:opacity-50"
              title="Download print-ready official score report PDF"
            >
              {downloadingResultPdf ? (
                <div className="w-3.5 h-3.5 border-2 border-gray-600 border-t-transparent rounded-full animate-spin mr-1.5" />
              ) : (
                <FileText className="w-3.5 h-3.5 mr-1.5 text-kits-red" />
              )}
              Download Result (PDF)
            </button>

            <button
              onClick={handleDownloadResultPng}
              disabled={downloadingResultPng}
              className="inline-flex items-center px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 shadow-2xs transition cursor-pointer disabled:opacity-50"
              title="Download high-resolution score report PNG"
            >
              {downloadingResultPng ? (
                <div className="w-3.5 h-3.5 border-2 border-gray-600 border-t-transparent rounded-full animate-spin mr-1.5" />
              ) : (
                <ImageIcon className="w-3.5 h-3.5 mr-1.5 text-kits-blue" />
              )}
              Download Result (PNG)
            </button>
          </div>
        </div>

        {/* Hero Score Card */}
        <div className="bg-white rounded-3xl border border-gray-200/90 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-6">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Examination Finalized
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight mt-1">
                {assessment.title}
              </h1>
            </div>

            <span
              className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                attempt.status === 'SUBMITTED'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : attempt.status === 'TERMINATED'
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}
            >
              Session Status: {attempt.status}
            </span>
          </div>

          {/* Kahoot-Style Post-Exam Motivational Banner */}
          {resultMessage && (
            <div
              className={`flex items-center space-x-3 px-4 py-3 rounded-2xl border text-xs font-semibold shadow-2xs ${
                isTerminated
                  ? 'bg-red-50/90 border-red-200 text-red-800'
                  : 'bg-gradient-to-r from-red-50/70 via-white to-blue-50/70 border-gray-200 text-gray-800'
              }`}
            >
              {isTerminated ? (
                <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
              ) : (
                <Sparkles className="w-4 h-4 text-kits-red shrink-0" />
              )}
              <span>{resultMessage.text}</span>
            </div>
          )}

          {/* Proctoring Warning Callout if Terminated */}
          {isTerminated && (
            <div className="p-4 bg-red-50/80 border border-red-200 rounded-2xl flex items-start space-x-3 text-red-800 text-xs">
              <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Proctoring Enforcement Record: Session Terminated</p>
                <p className="mt-0.5 text-red-700 leading-relaxed">
                  This examination session was automatically terminated and locked because 3 tab-switch or window focus violations were detected during proctoring. All answers saved up to the moment of termination have been securely recorded and scored.
                </p>
              </div>
            </div>
          )}

          {/* Large Metrics Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Academic Score
              </span>
              <div className="text-3xl font-extrabold text-gray-900 mt-1 font-mono">
                {earnedScore}
                <span className="text-xs font-normal text-gray-400"> / {totalPoints} pts</span>
              </div>
              <span className="text-[10px] text-gray-500 font-mono block mt-1">
                Standard Question Marks
              </span>
            </div>

            <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-200 text-center">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                EOS Speed Points
              </span>
              <div className="text-3xl font-extrabold text-amber-900 mt-1 font-mono">
                {eosPoints}
                <span className="text-xs font-normal text-amber-700"> pts</span>
              </div>
              <span className="text-[10px] text-amber-700 font-mono font-bold block mt-1">
                Live Leaderboard Competition
              </span>
            </div>

            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Score Percentage
              </span>
              <div className="text-3xl font-extrabold text-gray-900 mt-1 font-mono">
                {scorePercentage.toFixed(1)}%
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Evaluation
              </span>
              <div className="mt-1">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
                    isTerminated
                      ? 'bg-red-100 text-red-800 border border-red-300'
                      : isPassed
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-red-100 text-red-800 border border-red-300'
                  }`}
                >
                  {isTerminated ? 'DISQUALIFIED / TERMINATED' : isPassed ? 'PASSED' : 'NOT QUALIFIED'}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Passing standard: {assessment.passing_percentage}%
              </p>
            </div>

            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Proctoring Telemetry
              </span>
              <div className="text-2xl font-extrabold mt-1">
                <span className={(attempt.strike_count || 0) >= 3 ? 'text-red-600' : 'text-gray-900'}>
                  {attempt.strike_count || 0} / 3 Strikes
                </span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                {(attempt.strike_count || 0) >= 3
                  ? 'Session terminated by proctor'
                  : (attempt.strike_count || 0) > 0
                  ? 'Violations recorded'
                  : 'Clean proctoring log'}
              </p>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* AWARDS & CERTIFICATE SECTION                                      */}
        {/* ================================================================= */}
        {isTerminated ? (
          <div className="p-5 bg-red-50/70 border border-red-200 rounded-3xl flex items-start space-x-3.5 text-red-900">
            <ShieldAlert className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs space-y-1">
              <h4 className="font-bold text-sm text-red-950">
                Examination Terminated — Proctoring Disqualification
              </h4>
              <p className="text-red-800 leading-relaxed">
                Because this examination session incurred 3 proctoring strikes for window focus loss or tab switching, it has been disqualified from institutional certificates and leaderboard awards. Your saved answers and score transcript remain on record for administrative verification.
              </p>
            </div>
          </div>
        ) : !isClosed ? (
          <div className="p-5 bg-blue-50/70 border border-blue-200 rounded-3xl flex items-start space-x-3.5 text-blue-900">
            <Lock className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs space-y-1">
              <h4 className="font-bold text-sm text-blue-950">
                Final Institutional Rankings & Official Awards Pending
              </h4>
              <p className="text-blue-800 leading-relaxed">
                This examination is currently open campus-wide. Official institutional rankings, Gold/Silver/Bronze awards, and verified achievement certificates will be officially processed and published once the assessment closes on{' '}
                <strong>
                  {new Date(assessment.end_time).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </strong>
                .
              </p>
              <p className="text-[11px] text-blue-700">
                You can download your preliminary score report and proctoring clearance transcript at any time using the buttons above.
              </p>
            </div>
          </div>
        ) : isPassed ? (
          <div className="p-5 bg-gradient-to-br from-emerald-50 to-teal-50/40 border border-emerald-200 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-emerald-900 shadow-2xs">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-2xl bg-emerald-100 text-emerald-800 border border-emerald-200">
                <CheckCircle2 className="w-6 h-6 text-emerald-700 flex-shrink-0" />
              </div>
              <div>
                <span className="font-extrabold text-sm text-emerald-950 block">Passing Standard Achieved!</span>
                <p className="text-emerald-800 mt-0.5">
                  You scored <strong>{earnedScore} pts</strong> ({scorePercentage.toFixed(1)}%) satisfying the examination passing threshold of <strong>{assessment.passing_percentage}%</strong>.
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleDownloadResultPdf}
                disabled={downloadingResultPdf}
                className="inline-flex items-center px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl font-bold text-xs shadow-2xs transition cursor-pointer disabled:opacity-50 space-x-1.5"
                title="Download Official Score Report PDF"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Result Slip</span>
              </button>
            </div>
          </div>
        ) : (
          /* Constructive Motivational Message for Failed Candidates */
          <div className="p-6 bg-gradient-to-br from-rose-50/60 to-orange-50/30 border border-rose-200/80 rounded-3xl space-y-3">
            <div className="flex items-center space-x-2.5 text-rose-800">
              <Sparkles className="w-5 h-5 flex-shrink-0" />
              <h4 className="font-bold text-sm text-gray-900">Academic Progress & Reflection</h4>
            </div>
            <p className="text-xs text-gray-700 leading-relaxed font-medium">
              "Every attempt is progress. Review what you learned, strengthen the topics you found difficult, and keep practising. Your next result can be better."
            </p>
            <div className="pt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span>
                Earned: <strong>{earnedScore} pts</strong> ({scorePercentage.toFixed(1)}%)
              </span>
              <span>•</span>
              <span>
                Required Pass Threshold: <strong>{assessment.passing_percentage}%</strong>
              </span>
              <span>•</span>
              <span className="italic">
                You can download your official score report above.
              </span>
            </div>
          </div>
        )}

        {/* Tab Selection */}
        <div className="flex border-b border-gray-200 space-x-6">
          <button
            onClick={() => setActiveTab('SCORE')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 cursor-pointer ${
              activeTab === 'SCORE'
                ? 'border-kits-red text-kits-red'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('REVIEW')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 cursor-pointer ${
              activeTab === 'REVIEW'
                ? 'border-kits-red text-kits-red'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            Question Review {!isClosed && '(Locked)'}
          </button>
          <button
            onClick={() => setActiveTab('LEADERBOARD')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 cursor-pointer ${
              activeTab === 'LEADERBOARD'
                ? 'border-kits-red text-kits-red'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            Assessment Leaderboard
          </button>
        </div>

        {/* Tab 1: Overview */}
        {activeTab === 'SCORE' && (
          <div className="bg-white rounded-3xl border border-gray-200/90 shadow-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Session Summary</h3>
            <div className="divide-y divide-gray-100 text-xs">
              <div className="py-2.5 flex justify-between">
                <span className="text-gray-500">Attempt Started At:</span>
                <span className="font-semibold text-gray-800">
                  {new Date(attempt.started_at).toLocaleString()}
                </span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-gray-500">Attempt Submitted At:</span>
                <span className="font-semibold text-gray-800">
                  {attempt.submitted_at
                    ? new Date(attempt.submitted_at).toLocaleString()
                    : 'Automated Expiry'}
                </span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-gray-500">Total Questions:</span>
                <span className="font-semibold text-gray-800">{questions.length} questions</span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-gray-500">Questions Answered:</span>
                <span className="font-semibold text-gray-800">
                  {answers.length} of {questions.length} questions
                </span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-gray-500">Correct Answers Verified:</span>
                <span className="font-semibold text-emerald-600">{correctCount} Questions</span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-gray-500">Incorrect Answers:</span>
                <span className="font-semibold text-red-600">{incorrectCount} Questions</span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-gray-500">Unattempted Questions:</span>
                <span className="font-semibold text-amber-600">{unattemptedCount} Questions</span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Question Review */}
        {activeTab === 'REVIEW' && (
          <div className="space-y-4">
            {isClosed ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>
                  Examination window closed. Full question solutions and verified answer keys are now revealed below.
                </span>
              </div>
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-xs flex items-center space-x-2">
                <Lock className="w-4 h-4 flex-shrink-0 text-amber-600" />
                <span>
                  Examination is ongoing across campus. Your question correctness status is verified below, but specific answer keys remain confidential until the examination closes on{' '}
                  <strong>{new Date(assessment.end_time).toLocaleString()}</strong>.
                </span>
              </div>
            )}

            <div className="space-y-4">
              {questions.map((q, idx) => {
                const candidateAns = answersByQuestionId[q.id];
                const isAnswered = Boolean(candidateAns);
                const isCorrect = candidateAns?.is_correct === true;
                const correctOptionId = isClosed ? solutionsMap[q.id]?.correct_option_id : null;
                const correctBoolean = isClosed ? solutionsMap[q.id]?.correct_boolean : null;

                return (
                  <div
                    key={q.id}
                    className={`bg-white rounded-2xl border p-5 shadow-sm space-y-3 ${
                      !isAnswered
                        ? 'border-amber-200 bg-amber-50/20'
                        : isCorrect
                        ? 'border-emerald-300 bg-emerald-50/10'
                        : 'border-red-300 bg-red-50/10'
                    }`}
                  >
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-gray-900">Question {idx + 1}</span>
                      <div className="flex items-center space-x-2">
                        {!isAnswered ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            Unattempted (0 pts)
                          </span>
                        ) : isCorrect ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            Correct (+{candidateAns.points_awarded} pts)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">
                            Incorrect (0 pts)
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-sm font-semibold text-gray-900">{q.question_text}</p>

                    {/* MCQ Options Display */}
                    {q.question_type === 'MCQ' && (
                      <div className="space-y-2 pt-1">
                        {q.options?.map((opt, oIdx) => {
                          const isSelected = candidateAns?.selected_option_id === opt.id;
                          const isCorrectKey = isClosed && correctOptionId === opt.id;
                          const isIncorrectSelection = isSelected && isClosed ? !isCorrectKey : isSelected && !isCorrect;
                          const isCorrectSelection = isSelected && isClosed ? isCorrectKey : isSelected && isCorrect;

                          return (
                            <div
                              key={opt.id}
                              className={`p-3 rounded-xl border text-xs flex items-center justify-between transition ${
                                isCorrectSelection
                                  ? 'bg-emerald-50 border-emerald-500 font-semibold text-emerald-950 shadow-xs'
                                  : isIncorrectSelection
                                  ? 'bg-red-50 border-red-400 font-semibold text-red-950'
                                  : isCorrectKey
                                  ? 'bg-emerald-50/70 border-emerald-500 border-2 font-semibold text-emerald-950'
                                  : 'bg-gray-50 border-gray-200 text-gray-600'
                              }`}
                            >
                              <span className="leading-snug pr-2">
                                <strong className="text-gray-900 mr-1">{String.fromCharCode(65 + oIdx)}.</strong>
                                {opt.option_text}
                              </span>
                              <div className="flex items-center space-x-1.5 flex-shrink-0">
                                {isCorrectSelection && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-700 text-white flex items-center space-x-1 shadow-2xs">
                                    <span>Your Choice (Correct)</span>
                                    <span>✓</span>
                                  </span>
                                )}
                                {isIncorrectSelection && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-700 text-white flex items-center space-x-1 shadow-2xs">
                                    <span>Your Choice (Incorrect)</span>
                                    <span>✕</span>
                                  </span>
                                )}
                                {!isSelected && isCorrectKey && (
                                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-600 text-white flex items-center space-x-1 shadow-2xs">
                                    <span>Correct Answer</span>
                                    <span>✓</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* True/False Display */}
                    {q.question_type === 'TRUE_FALSE' && (
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        {[
                          { label: 'TRUE', val: true },
                          { label: 'FALSE', val: false },
                        ].map((choice) => {
                          const isSelected = candidateAns?.selected_boolean === choice.val;
                          const isCorrectKey = isClosed && correctBoolean === choice.val;
                          const isIncorrectSelection = isSelected && isClosed ? !isCorrectKey : isSelected && !isCorrect;
                          const isCorrectSelection = isSelected && isClosed ? isCorrectKey : isSelected && isCorrect;

                          return (
                            <div
                              key={choice.label}
                              className={`p-3 rounded-xl border text-center text-xs font-bold transition flex flex-col items-center justify-center space-y-1.5 min-h-[56px] ${
                                isCorrectSelection
                                  ? 'bg-emerald-50 border-emerald-500 text-emerald-950 shadow-xs'
                                  : isIncorrectSelection
                                  ? 'bg-red-50 border-red-400 text-red-950'
                                  : isCorrectKey
                                  ? 'bg-emerald-50/70 border-emerald-500 border-2 text-emerald-950'
                                  : 'bg-gray-50 border-gray-200 text-gray-500'
                              }`}
                            >
                              <span className="text-sm tracking-wide">{choice.label}</span>
                              <div className="flex flex-wrap items-center justify-center gap-1">
                                {isCorrectSelection && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-700 text-white shadow-2xs">
                                    Your Choice (Correct) ✓
                                  </span>
                                )}
                                {isIncorrectSelection && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-700 text-white shadow-2xs">
                                    Your Choice (Incorrect) ✕
                                  </span>
                                )}
                                {!isSelected && isCorrectKey && (
                                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-600 text-white shadow-2xs">
                                    Correct Answer ✓
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Explanation Callout (Revealed when review permitted) */}
                    {isClosed && (solutionsMap[q.id]?.explanation || q.explanation) && (
                      <div className="mt-3 p-3.5 bg-blue-50/70 border border-blue-200/90 rounded-xl text-xs space-y-1.5">
                        <div className="flex items-center space-x-1.5 font-bold text-blue-900">
                          <Sparkles className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                          <span>Explanation:</span>
                        </div>
                        <p className="text-gray-700 whitespace-pre-line leading-relaxed pl-5">
                          {solutionsMap[q.id]?.explanation || q.explanation}
                        </p>
                      </div>
                    )}

                    {!isClosed && (
                      <p className="text-[10px] text-gray-400 italic pt-1">
                        Answer key hidden until examination closing time.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 3: Leaderboard */}
        {activeTab === 'LEADERBOARD' && (
          <div className="bg-white rounded-3xl border border-gray-200/90 shadow-sm p-6 space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-gray-900">Assessment Leaderboard</h3>
                <p className="text-xs text-gray-500">
                  Official student scores and rankings for this assessment.
                </p>
              </div>
              <button
                onClick={onRefreshLeaderboard}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {leaderboard.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400">
                No submissions recorded yet for this leaderboard.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {leaderboard.map((entry) => (
                  <div key={entry.rank} className="py-3 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${
                          entry.rank === 1
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : entry.rank === 2
                            ? 'bg-gray-100 text-gray-700 border border-gray-300'
                            : entry.rank === 3
                            ? 'bg-orange-100 text-orange-800 border border-orange-300'
                            : 'text-gray-400'
                        }`}
                      >
                        {entry.rank}
                      </span>
                      <span className="text-sm font-semibold text-gray-800">{entry.student_name}</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900 font-mono">{entry.score} pts</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Container component for loading and lifecycle management of assessment results.
 * Manages data retrieval, authentication state, and error handling.
 * Unconditional Hook declarations guarantee identical Hook execution order across all states.
 */
export function AssessmentResult() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [answers, setAnswers] = useState<AssessmentAttemptAnswer[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [solutionsMap, setSolutionsMap] = useState<Record<string, any>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadResultData() {
      if (!assessmentId) return;
      setLoading(true);
      setError(null);
      try {
        const [asmRes, attRes] = await Promise.all([
          assessmentService.getStudentAssessmentById(assessmentId),
          assessmentService.getMyAttempt(assessmentId),
        ]);

        if (asmRes.error || !asmRes.data) throw asmRes.error || new Error('Assessment not found');
        if (!attRes.data) throw new Error('Attempt record not found.');

        // If the candidate's attempt is still in progress, redirect to the active examination cockpit
        if (attRes.data.status === 'IN_PROGRESS') {
          navigate(`/assessments/${assessmentId}/attempt`, { replace: true });
          return;
        }

        // Pass attempt ID to preserve stable candidate question order
        const qRes = await assessmentService.getCandidateQuestions(assessmentId, attRes.data.id);

        setAssessment(asmRes.data);
        setAttempt(attRes.data);
        setQuestions(qRes.data || []);

        // Load saved answers
        const ansRes = await assessmentService.getSavedAnswers(attRes.data.id);
        if (ansRes.data) {
          setAnswers(ansRes.data);
        }

        // Check if assessment is closed to fetch solutions & certificates
        const isClosedNow =
          new Date() >= new Date(asmRes.data.end_time) || asmRes.data.status === 'CLOSED';
        if (isClosedNow) {
          try {
            const solRes = await assessmentService.getClosedAssessmentSolutions(assessmentId);

            if (solRes.data) {
              const sMap: Record<string, any> = {};
              solRes.data.forEach((s: any) => {
                sMap[s.question_id] = s;
              });
              setSolutionsMap(sMap);
            }
          } catch (e) {
            console.error('Failed to load closed solutions:', e);
          }
        }

        // Pre-load leaderboard
        const leadRes = await assessmentService.getAssessmentLeaderboard(assessmentId);
        if (leadRes.data) {
          setLeaderboard(leadRes.data);
        }
      } catch (err: any) {
        console.error('Failed to load assessment results:', err);
        setError(err.message || 'Unable to load examination results.');
      } finally {
        setLoading(false);
      }
    }
    loadResultData();
  }, [assessmentId, navigate]);



  const handleRefreshLeaderboard = useCallback(async () => {
    if (!assessmentId) return;
    try {
      const leadRes = await assessmentService.getAssessmentLeaderboard(assessmentId);
      if (leadRes.data) {
        setLeaderboard(leadRes.data);
      }
    } catch (err) {
      console.error('Failed to refresh leaderboard:', err);
    }
  }, [assessmentId]);

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="animate-spin rounded-full h-10 w-10 border-3 border-kits-red border-t-transparent" />
        <p className="mt-4 text-xs font-semibold text-gray-400 uppercase tracking-widest">
          Calculating Finalized Examination Results...
        </p>
      </div>
    );
  }

  // Error or Missing State
  if (error || !assessment || !attempt) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <AlertCircle className="w-12 h-12 text-red-500 mb-2" />
        <h2 className="text-lg font-bold text-gray-900">Result Unavailable</h2>
        <p className="text-xs text-gray-500 mt-1">{error || 'Session record missing.'}</p>
        <Link
          to="/assessments"
          className="mt-4 inline-flex items-center text-xs font-semibold text-kits-red"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Assessments
        </Link>
      </div>
    );
  }

  return (
    <AssessmentResultView
      assessment={assessment}
      attempt={attempt}
      questions={questions}
      answers={answers}
      leaderboard={leaderboard}
      solutionsMap={solutionsMap}
      profile={profile}
      onRefreshLeaderboard={handleRefreshLeaderboard}
    />
  );
}

export default AssessmentResult;
