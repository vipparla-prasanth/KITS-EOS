import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCcw,
  Trophy,
  Sparkles,
} from 'lucide-react';
import {
  assessmentService,
  getRotatingAssessmentMessage,
  type Assessment,
  type AssessmentAttempt,
} from '@kits-eos/shared';


export function AssessmentPreExam() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [existingAttempt, setExistingAttempt] = useState<AssessmentAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mandatory 2-minute (120 seconds) rules countdown anchored in sessionStorage
  const [countdownSeconds, setCountdownSeconds] = useState(120);
  const [hasAgreed, setHasAgreed] = useState(false);

  useEffect(() => {
    async function init() {
      if (!assessmentId) return;
      setLoading(true);
      setError(null);
      try {
        const [asmRes, attRes] = await Promise.all([
          assessmentService.getStudentAssessmentById(assessmentId),
          assessmentService.getMyAttempt(assessmentId),
        ]);

        if (asmRes.error) throw asmRes.error;
        setAssessment(asmRes.data);
        if (attRes.data) {
          setExistingAttempt(attRes.data);
        }
      } catch (err: any) {
        console.error('Failed to load assessment pre-exam room:', err);
        setError(err.message || 'Unable to load examination details.');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [assessmentId]);

  // 120-second countdown timer effect anchored to sessionStorage
  useEffect(() => {
    if (existingAttempt || !assessmentId) return; // If attempt already exists, countdown not needed

    const storageKey = `kits_eos_preexam_countdown_${assessmentId}`;
    let startTimeStr = sessionStorage.getItem(storageKey);
    let startTimestamp = startTimeStr ? parseInt(startTimeStr, 10) : null;
    if (!startTimestamp || isNaN(startTimestamp)) {
      startTimestamp = Date.now();
      sessionStorage.setItem(storageKey, startTimestamp.toString());
    }

    const computeRemaining = () => {
      const elapsedSec = Math.floor((Date.now() - (startTimestamp as number)) / 1000);
      return Math.max(0, 120 - elapsedSec);
    };

    const initialSec = computeRemaining();
    setCountdownSeconds(initialSec);

    if (initialSec <= 0) return;

    const interval = setInterval(() => {
      const remaining = computeRemaining();
      setCountdownSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [existingAttempt, assessmentId]);

  const handleStartOrResume = async () => {
    if (!assessmentId) return;
    setStarting(true);
    setError(null);

    // 1. Request browser fullscreen directly as part of this user click interaction (non-blocking)
    try {
      if (document.documentElement && !document.fullscreenElement) {
        if (typeof document.documentElement.requestFullscreen === 'function') {
          await document.documentElement.requestFullscreen().catch((fsErr) => {
            console.warn('Browser fullscreen request rejected or not permitted:', fsErr);
          });
        } else if (typeof (document.documentElement as any).webkitRequestFullscreen === 'function') {
          await (document.documentElement as any).webkitRequestFullscreen();
        } else if (typeof (document.documentElement as any).msRequestFullscreen === 'function') {
          await (document.documentElement as any).msRequestFullscreen();
        }
      }
    } catch (fsErr) {
      console.warn('Fullscreen entry unhandled or unavailable:', fsErr);
    }

    // 2. Start or resume attempt only on server confirmation
    try {
      const { data, error: err } = await assessmentService.startOrResumeAttempt(assessmentId);
      if (err) throw err;
      if (data?.success) {
        navigate(`/assessments/${assessmentId}/attempt`);
      } else {
        throw new Error('Unable to initialize examination session.');
      }
    } catch (err: any) {
      console.error('Start failed:', err);
      setError(err.message || 'Failed to start examination.');
      setStarting(false);
    }
  };

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="animate-spin rounded-full h-10 w-10 border-3 border-kits-red border-t-transparent" />
        <p className="mt-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Connecting to Examination Room...
        </p>
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <AlertCircle className="w-12 h-12 text-red-500 mb-2" />
        <h2 className="text-lg font-bold text-gray-900">Assessment Unavailable</h2>
        <p className="text-xs text-gray-500 mt-1 max-w-sm text-center">
          This assessment is not active, closed, or does not exist.
        </p>
        <Link
          to="/assessments"
          className="mt-4 inline-flex items-center text-xs font-semibold text-kits-red"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Return to Assessments
        </Link>
      </div>
    );
  }

  // If already completed/submitted
  const isFinalized = existingAttempt && existingAttempt.status !== 'IN_PROGRESS';

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Back Link */}
        <Link
          to="/assessments"
          className="inline-flex items-center text-xs font-semibold text-gray-500 hover:text-gray-800 transition"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Assessment Directory
        </Link>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Main Card */}
        <div className="bg-white rounded-3xl border border-gray-200/90 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Official Evaluation
              </span>
              {assessment.include_in_global_leaderboard && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200 flex items-center">
                  <Trophy className="w-3 h-3 mr-1" /> Global Leaderboard
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              {assessment.title}
            </h1>
            <p className="text-xs text-gray-500">{assessment.description || 'Institutional examination.'}</p>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-100 text-xs">
            <div>
              <span className="text-gray-400 font-medium">Allocated Duration:</span>
              <p className="font-bold text-gray-900 text-sm">{assessment.duration_minutes} Mins</p>
            </div>
            <div>
              <span className="text-gray-400 font-medium">Questions:</span>
              <p className="font-bold text-gray-900 text-sm">{assessment.total_questions_count} Total</p>
            </div>
            <div>
              <span className="text-gray-400 font-medium">Passing Score:</span>
              <p className="font-bold text-gray-900 text-sm">{assessment.passing_percentage}%</p>
            </div>
            <div>
              <span className="text-gray-400 font-medium">Closing Date:</span>
              <p className="font-bold text-gray-900 text-sm">{new Date(assessment.end_time).toLocaleDateString()}</p>
            </div>
          </div>

          {/* If already finalized */}
          {isFinalized ? (
            <div className="p-6 bg-blue-50/70 border border-blue-200 rounded-2xl space-y-3 text-center">
              <CheckCircle2 className="w-10 h-10 text-blue-600 mx-auto" />
              <h3 className="text-base font-bold text-gray-900">You Have Completed This Assessment</h3>
              <p className="text-xs text-gray-600 max-w-md mx-auto">
                Status: <strong>{existingAttempt.status}</strong> with an earned score of{' '}
                <strong>{existingAttempt.score} points</strong>.
              </p>
              <button
                onClick={() => navigate(`/assessments/${assessment.id}/result`)}
                className="mt-2 inline-flex items-center px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-sm transition"
              >
                View Finalized Result & Review
              </button>
            </div>
          ) : existingAttempt && existingAttempt.status === 'IN_PROGRESS' ? (
            /* If already in progress */
            <div className="p-6 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-3 text-center">
              <RotateCcw className="w-10 h-10 text-amber-600 mx-auto animate-spin" />
              <h3 className="text-base font-bold text-gray-900">Active Examination In Progress</h3>
              <p className="text-xs text-gray-600 max-w-md mx-auto">
                Your examination timer is actively running on the server. Your authoritative deadline is{' '}
                <strong>{new Date(existingAttempt.deadline).toLocaleTimeString()}</strong>.
              </p>
              <button
                onClick={handleStartOrResume}
                disabled={starting}
                className="mt-2 inline-flex items-center px-6 py-2.5 bg-kits-red hover:bg-kits-red/90 text-white text-xs font-bold rounded-xl shadow-md transition space-x-2"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Resume Examination</span>
              </button>
            </div>
          ) : (
            /* First-time Candidate: Rules & 2-Minute Mandatory Countdown */
            <div className="space-y-6">
              {/* Instructions */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                  Examination Instructions
                </h3>
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-xs text-gray-700 font-mono whitespace-pre-wrap leading-relaxed">
                  {assessment.instructions || 'Answer all questions to the best of your ability.'}
                </div>
              </div>

              {/* Anti-Cheating & Honor Code */}
              <div className="p-5 bg-red-50/60 border border-red-200/80 rounded-2xl space-y-3">
                <div className="flex items-center space-x-2 text-red-800">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <h4 className="text-xs font-bold uppercase tracking-wider">
                    Strict Proctoring & 3-Strike Tab-Switch Policy
                  </h4>
                </div>
                <ul className="text-xs text-red-900/80 space-y-1.5 list-disc list-inside">
                  <li>
                    <strong>Single Attempt:</strong> Each student is permitted exactly one examination session.
                  </li>
                  <li>
                    <strong>Server Timer:</strong> Once started, your authoritative exam clock cannot be paused or reset.
                  </li>
                  <li>
                    <strong>Focus Detection:</strong> Navigating away from this tab, minimizing the browser, or switching
                    applications triggers an automated anti-cheat telemetry strike.
                  </li>
                  <li>
                    <strong>Immediate Termination on 3 Strikes:</strong> The third strike terminates your examination
                    immediately and finalizes your current earned score.
                  </li>
                  <li>
                    <strong>Cloud Autosave:</strong> Each answer is committed to the database in real-time.
                  </li>
                </ul>
              </div>

              {/* Dynamic Kahoot-Style Assessment Motivation Banner */}
              {(() => {
                const msg = countdownSeconds > 0
                  ? getRotatingAssessmentMessage('PRE_EXAM_COUNTDOWN', Math.floor((120 - countdownSeconds) / 20))
                  : getRotatingAssessmentMessage('PRE_EXAM_READY', 0);
                if (!msg) return null;
                return (
                  <div className="p-4 bg-blue-50/80 border border-blue-200/90 rounded-2xl flex items-center space-x-3 text-xs text-[#003366] shadow-xs animate-in fade-in duration-200">
                    <div className="p-2 bg-white rounded-xl text-[#C8102E] border border-red-100 shadow-2xs flex-shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-bold uppercase tracking-wider text-[10px] text-gray-500 block">
                        {msg.category === 'FUNNY' ? 'Campus Warmup' : 'Examination Focus'}
                      </span>
                      <span className="font-bold text-xs">{msg.text}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Countdown Clock Box */}
              <div className="bg-gray-900 text-white p-5 rounded-2xl text-center space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Mandatory Rules Reading Period
                </span>
                <div className="text-4xl font-extrabold tracking-wider font-mono text-kits-red">
                  {countdownSeconds > 0 ? formatCountdown(countdownSeconds) : '00:00 (Rules Completed)'}
                </div>
                <p className="text-xs text-gray-400 max-w-sm mx-auto">
                  {countdownSeconds > 0
                    ? 'Please review the rules thoroughly. The Start button will unlock after this countdown.'
                    : 'You may now accept the honor code and begin.'}
                </p>
              </div>

              {/* Agreement Checkbox */}
              <label className="flex items-start space-x-3 cursor-pointer p-2">
                <input
                  type="checkbox"
                  checked={hasAgreed}
                  onChange={(e) => setHasAgreed(e.target.checked)}
                  disabled={countdownSeconds > 0}
                  className="mt-0.5 h-4 w-4 text-kits-red rounded border-gray-300 focus:ring-kits-red/20 disabled:opacity-50"
                />
                <span className="text-xs text-gray-700">
                  I confirm that I am the registered candidate, have reviewed the exam instructions, and agree to uphold
                  the KITS-EOS academic integrity code without unauthorized assistance.
                </span>
              </label>

              {/* Start Button */}
              <div className="pt-2">
                <button
                  onClick={handleStartOrResume}
                  disabled={countdownSeconds > 0 || !hasAgreed || starting}
                  className="w-full py-3.5 bg-kits-red hover:bg-kits-red/90 text-white text-sm font-bold rounded-2xl shadow-lg transition flex items-center justify-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {starting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Initializing Session...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-white" />
                      <span>
                        {countdownSeconds > 0
                          ? `Rules Lock (${countdownSeconds}s)`
                          : 'Start Assessment Now'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export default AssessmentPreExam;
