import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  Send,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
} from 'lucide-react';
import {
  assessmentService,
  getRotatingAssessmentMessage,
  type Assessment,
  type AssessmentQuestion,
  type AssessmentAttempt,
  type AssessmentAttemptAnswer,
} from '@kits-eos/shared';
import { playRegistrationSuccessSound } from '../../utils/registrationSound';

export function AssessmentAttempt() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Selected Answers Map: questionId -> { selectedOptionId, selectedBoolean }
  const [answersMap, setAnswersMap] = useState<
    Record<string, { selectedOptionId?: string | null; selectedBoolean?: boolean | null }>
  >({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Autosave Status: 'IDLE' | 'SAVING' | 'SAVED' | 'ERROR'
  const [saveStatus, setSaveStatus] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'ERROR'>('SAVED');

  // Kahoot-style non-revealing reaction on answer selection
  const [answerReaction, setAnswerReaction] = useState<string | null>(null);
  const reactionTimeoutRef = useRef<any>(null);

  // Authoritative Countdown Clock
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);

  // Proctoring Violations / Strikes
  const [strikeCount, setStrikeCount] = useState(0);
  const [warningModalMessage, setWarningModalMessage] = useState<string | null>(null);
  const [isTerminated, setIsTerminated] = useState(false);

  // Submit Modal
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);


  // Fullscreen Proctored State (checked without forcing on page load)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    return Boolean(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );
  });

  // Track fullscreen changes without forcing fullscreen on page load
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = Boolean(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      setIsFullscreen(isFs);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // Safe helper to exit fullscreen on submission, termination, or navigation
  const exitFullscreenSafely = useCallback(() => {
    try {
      if (
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      ) {
        if (typeof document.exitFullscreen === 'function') {
          document.exitFullscreen().catch(() => {});
        } else if (typeof (document as any).webkitExitFullscreen === 'function') {
          (document as any).webkitExitFullscreen();
        } else if (typeof (document as any).msExitFullscreen === 'function') {
          (document as any).msExitFullscreen();
        }
      }
    } catch {
      // Non-blocking exit
    }
  }, []);

  // User gesture handler to enter fullscreen if desired
  const handleEnterFullscreen = async () => {
    try {
      if (document.documentElement && !document.fullscreenElement) {
        if (typeof document.documentElement.requestFullscreen === 'function') {
          await document.documentElement.requestFullscreen().catch((err) => {
            console.warn('Manual fullscreen entry rejected:', err);
          });
        } else if (typeof (document.documentElement as any).webkitRequestFullscreen === 'function') {
          await (document.documentElement as any).webkitRequestFullscreen();
        } else if (typeof (document.documentElement as any).msRequestFullscreen === 'function') {
          await (document.documentElement as any).msRequestFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen entry rejected or unhandled:', err);
    }
  };

  // Focus debouncer to avoid duplicate trigger
  const lastViolationTimeRef = useRef<number>(0);
  const activeQuestionIdRef = useRef<string | null>(null);
  const viewedQuestionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentQ = questions[currentIndex];
    activeQuestionIdRef.current = currentQ?.id || null;

    if (attempt?.id && currentQ?.id && !viewedQuestionsRef.current.has(currentQ.id)) {
      viewedQuestionsRef.current.add(currentQ.id);
      assessmentService.viewQuestion(attempt.id, currentQ.id).catch(() => {});
    }
  }, [questions, currentIndex, attempt?.id]);

  // Clean up fullscreen on component unmount
  useEffect(() => {
    return () => {
      exitFullscreenSafely();
    };
  }, [exitFullscreenSafely]);

  // Load Session Data
  useEffect(() => {
    async function loadSession() {
      if (!assessmentId) return;
      setLoading(true);
      setError(null);
      try {
        const [asmRes, attRes] = await Promise.all([
          assessmentService.getStudentAssessmentById(assessmentId),
          assessmentService.getMyAttempt(assessmentId),
        ]);

        if (!attRes.data) {
          // If no attempt exists yet, navigate back to pre-exam
          navigate(`/assessments/${assessmentId}`, { replace: true });
          return;
        }
        if (attRes.data.status !== 'IN_PROGRESS') {
          // If attempt is already finalized (SUBMITTED, TERMINATED, etc.), navigate directly to result
          navigate(`/assessments/${assessmentId}/result`, { replace: true });
          return;
        }

        // Enforce stable randomized layout by passing the attempt ID
        const qRes = await assessmentService.getCandidateQuestions(assessmentId, attRes.data.id);
        if (qRes.error) throw qRes.error;

        setAssessment(asmRes.data);
        setAttempt(attRes.data);
        setStrikeCount(attRes.data.strike_count || 0);
        setQuestions(qRes.data || []);

        // Load pre-existing saved answers if resuming
        const savedRes = await assessmentService.getSavedAnswers(attRes.data.id);
        if (savedRes.data) {
          const map: Record<string, { selectedOptionId?: string | null; selectedBoolean?: boolean | null }> = {};
          savedRes.data.forEach((ans: AssessmentAttemptAnswer) => {
            map[ans.question_id] = {
              selectedOptionId: ans.selected_option_id,
              selectedBoolean: ans.selected_boolean,
            };
          });
          setAnswersMap(map);
        }

        // Initialize deadline timer
        const deadlineDate = new Date(attRes.data.deadline);
        const diffMs = deadlineDate.getTime() - Date.now();
        setRemainingSeconds(Math.max(0, Math.floor(diffMs / 1000)));
      } catch (err: any) {
        console.error('Failed to initialize assessment session:', err);
        setError(err.message || 'Unable to load examination session.');
      } finally {
        setLoading(false);
      }
    }
    loadSession();
  }, [assessmentId, navigate]);

  // Countdown Interval
  useEffect(() => {
    if (!attempt || remainingSeconds <= 0) return;

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleAutoSubmit('Deadline elapsed.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [attempt, remainingSeconds]);

  // Handle Automatic Finalization on Expiry
  const handleAutoSubmit = useCallback(async (_reason?: string) => {
    if (!attempt || submitting) return;
    setSubmitting(true);
    exitFullscreenSafely();
    try {
      // Safe client-side jitter (500ms - 2500ms) to spread deadline submission bursts across the connection pool
      const jitterMs = Math.floor(Math.random() * 2000) + 500;
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
      const { error: submitErr } = await assessmentService.submitAttempt(attempt.id);
      if (!submitErr) {
        playRegistrationSuccessSound({ dedupeKey: `assessment-submit-${attempt.id}` });
      }
      navigate(`/assessments/${assessmentId}/result`);
    } catch (err) {
      console.error('Auto submit error:', err);
      navigate(`/assessments/${assessmentId}/result`);
    }
  }, [attempt, assessmentId, navigate, submitting, exitFullscreenSafely]);

  // Record Proctoring Violation (Tab-switch detection)
  const triggerViolation = useCallback(async () => {
    if (!attempt || isTerminated || submitting) return;

    const now = Date.now();
    // Debounce 1.5 seconds to prevent double firing on blur + visibilitychange
    if (now - lastViolationTimeRef.current < 1500) return;
    lastViolationTimeRef.current = now;

    const episodeId = crypto.randomUUID();
    const activeQId = activeQuestionIdRef.current;
    try {
      const { data, error: err } = await assessmentService.recordViolation(
        attempt.id,
        episodeId,
        'TAB_SWITCH',
        activeQId
      );
      if (err) return;

      if (data?.terminated) {
        setIsTerminated(true);
        setStrikeCount(3);
        exitFullscreenSafely();
        setWarningModalMessage(
          'Three strikes exceeded! You have repeatedly switched tabs or lost window focus. Your assessment session has been terminated and finalized.'
        );
      } else if (data?.strike_count) {
        const newStrikes = data.strike_count;
        setStrikeCount(newStrikes);
        if (newStrikes === 1) {
          setWarningModalMessage(
            'Warning: Strike 1 of 3! A tab switch or focus loss was detected. Two more violations will terminate your examination session.'
          );
        } else if (newStrikes === 2) {
          setWarningModalMessage(
            'URGENT WARNING: Strike 2 of 3! This is your final warning. The next tab switch will automatically and permanently terminate your examination.'
          );
        }
      }
    } catch (err) {
      console.error('Failed to log violation:', err);
    }
  }, [attempt, isTerminated, submitting, exitFullscreenSafely]);

  // Register Visibility & Blur Listeners with 3-second grace window for non-hidden blur
  useEffect(() => {
    if (loading || isTerminated || !attempt) return;

    let blurGraceTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (blurGraceTimeout) {
          clearTimeout(blurGraceTimeout);
          blurGraceTimeout = null;
        }
        triggerViolation();
      }
    };

    const handleBlur = () => {
      // If document is already hidden, visibilitychange handles it immediately.
      // If document is still visible (OS notification, permission modal, password manager overlay),
      // provide a 3-second recovery window before issuing an authoritative violation strike.
      if (!document.hidden) {
        if (blurGraceTimeout) clearTimeout(blurGraceTimeout);
        blurGraceTimeout = setTimeout(() => {
          blurGraceTimeout = null;
          if (typeof document !== 'undefined' && !document.hasFocus()) {
            triggerViolation();
          }
        }, 3000);
      }
    };

    const handleFocus = () => {
      if (blurGraceTimeout) {
        clearTimeout(blurGraceTimeout);
        blurGraceTimeout = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      if (blurGraceTimeout) clearTimeout(blurGraceTimeout);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loading, isTerminated, attempt, triggerViolation]);

  // Answer Selection & Immediate Autosave
  const handleSelectAnswer = async (selectedOptionId?: string | null, selectedBoolean?: boolean | null) => {
    if (!attempt || questions.length === 0) return;
    const currentQ = questions[currentIndex];
    if (!currentQ) return;

    // Trigger Kahoot-style non-revealing reaction!
    // Critical Anti-Cheat Policy:
    // Identical rotating message pool used regardless of option selected; zero correctness awareness or indication.
    const reactionMsg = getRotatingAssessmentMessage('ANSWER_SELECTED', currentIndex);
    if (reactionMsg) {
      setAnswerReaction(reactionMsg.text);
      if (reactionTimeoutRef.current) clearTimeout(reactionTimeoutRef.current);
      reactionTimeoutRef.current = setTimeout(() => {
        setAnswerReaction(null);
      }, 3500);
    }

    // Optimistic UI update
    setAnswersMap((prev) => ({
      ...prev,
      [currentQ.id]: { selectedOptionId, selectedBoolean },
    }));

    setSaveStatus('SAVING');
    try {
      const { data, error: err } = await assessmentService.autosaveAnswer(
        attempt.id,
        currentQ.id,
        selectedOptionId,
        selectedBoolean
      );

      if (err) throw err;

      if (data?.expired) {
        // Exam deadline elapsed during autosave
        exitFullscreenSafely();
        navigate(`/assessments/${assessmentId}/result`);
        return;
      }

      setSaveStatus('SAVED');
    } catch (err) {
      console.error('Autosave failed:', err);
      setSaveStatus('ERROR');
    }
  };


  // Manual Voluntary Submission
  const handleManualSubmit = async () => {
    if (!attempt || !assessmentId) return;
    setSubmitting(true);
    exitFullscreenSafely();
    try {
      const { error: err } = await assessmentService.submitAttempt(attempt.id);
      if (err) throw err;
      playRegistrationSuccessSound({ dedupeKey: `assessment-submit-${attempt.id}` });
      navigate(`/assessments/${assessmentId}/result`);
    } catch (err: any) {
      console.error('Submit error:', err);
      try {
        const verify = await assessmentService.getMyAttempt(assessmentId);
        if (verify.data && verify.data.status !== 'IN_PROGRESS') {
          playRegistrationSuccessSound({ dedupeKey: `assessment-submit-${attempt.id}` });
          navigate(`/assessments/${assessmentId}/result`, { replace: true });
          return;
        }
      } catch {
        // Fall through to display error
      }
      setError(err.message || 'Failed to submit assessment.');
      setSubmitting(false);
      setIsSubmitModalOpen(false);
    }
  };

  const formatClock = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white">
        <div className="animate-spin rounded-full h-10 w-10 border-3 border-kits-red border-t-transparent" />
        <p className="mt-4 text-xs font-semibold text-gray-400 uppercase tracking-widest">
          Loading Examination Cockpit...
        </p>
      </div>
    );
  }

  if (error || !assessment || !attempt || questions.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <AlertCircle className="w-12 h-12 text-red-500 mb-2" />
        <h2 className="text-lg font-bold text-gray-900">Session Error</h2>
        <p className="text-xs text-gray-500 mt-1">{error || 'No questions available.'}</p>
        <button
          onClick={() => navigate('/assessments')}
          className="mt-4 px-4 py-2 bg-kits-red text-white text-xs font-semibold rounded-xl"
        >
          Return to Assessments
        </button>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const currentAnswer = answersMap[currentQuestion?.id];
  const answeredCount = Object.keys(answersMap).length;

  // Timer Color Classes
  const isTimeCritical = remainingSeconds <= 60;
  const isTimeWarning = remainingSeconds <= 300 && !isTimeCritical;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col select-none">
      {/* Top Examination Cockpit Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 px-4 sm:px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-3 truncate">
          <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
          <h1 className="text-sm sm:text-base font-bold text-gray-900 truncate">{assessment.title}</h1>
        </div>

        {/* Center / Right Telemetry */}
        <div className="flex items-center space-x-3 sm:space-x-6">
          {/* Cloud Autosave Indicator */}
          <div className="hidden sm:flex items-center space-x-1.5 text-xs text-gray-500">
            {saveStatus === 'SAVED' && (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[11px] text-gray-500 font-medium">Answer saved</span>
              </>
            )}
            {saveStatus === 'SAVING' && (
              <>
                <div className="w-3 h-3 border-2 border-kits-red border-t-transparent rounded-full animate-spin" />
                <span className="text-[11px] text-gray-500 font-medium">Saving answer...</span>
              </>
            )}
            {saveStatus === 'ERROR' && (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                <span className="text-[11px] text-red-500 font-medium">Sync interrupted (retrying)</span>
              </>
            )}
          </div>

          {/* Fullscreen Telemetry Status */}
          {isFullscreen ? (
            <span
              className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"
              title="Browser fullscreen is active"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Fullscreen</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handleEnterFullscreen}
              className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition cursor-pointer"
              title="Click to enter browser fullscreen"
            >
              <Minimize2 className="w-3.5 h-3.5 text-amber-600" />
              <span>Windowed Mode</span>
            </button>
          )}

          {/* Anti-Cheat Strikes */}
          <div
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-xl text-xs font-bold ${
              strikeCount >= 2
                ? 'bg-red-100 text-red-800 border border-red-300'
                : strikeCount === 1
                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{strikeCount}/3 Strikes</span>
          </div>

          {/* Synchronized Server Countdown Clock */}
          <div
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-mono text-xs sm:text-sm font-extrabold border ${
              isTimeCritical
                ? 'bg-red-600 text-white border-red-700 animate-pulse'
                : isTimeWarning
                ? 'bg-amber-500 text-white border-amber-600'
                : 'bg-gray-900 text-white border-gray-950'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{formatClock(remainingSeconds)}</span>
          </div>

          {/* Submit Button */}
          <button
            onClick={() => setIsSubmitModalOpen(true)}
            className="px-3.5 py-1.5 bg-kits-red hover:bg-kits-red/90 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center space-x-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Submit Exam</span>
          </button>
        </div>
      </header>

      {/* Authoritative Server Clock Low-Time Reminders */}
      {isTimeCritical ? (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-center text-xs font-bold text-red-800 flex items-center justify-center space-x-2 animate-pulse motion-reduce:animate-none">
          <Clock className="w-4 h-4 text-[#C8102E] flex-shrink-0" />
          <span>Final minute! Complete your active answer and prepare for submission.</span>
        </div>
      ) : isTimeWarning ? (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-xs font-bold text-amber-800 flex items-center justify-center space-x-2">
          <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span>Authoritative server clock: 5 minutes remaining. Review any unattempted questions.</span>
        </div>
      ) : null}

      {/* Non-Blocking Fullscreen Notice (shown when fullscreen is inactive, non-blocking) */}
      {!isFullscreen && (
        <div className="bg-amber-50/95 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between text-xs text-amber-900 shadow-2xs">
          <div className="flex items-center space-x-2.5 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="truncate">
              <strong>Notice:</strong> Fullscreen mode is not active. Your examination continues normally. For an optimal, proctored focus mode, you may enter fullscreen.
            </span>
          </div>
          <button
            type="button"
            onClick={handleEnterFullscreen}
            className="ml-3 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg transition shrink-0 cursor-pointer text-[11px] shadow-sm flex items-center gap-1.5"
            title="Click to enter browser fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Enter Fullscreen</span>
          </button>
        </div>
      )}

      {/* Main Body */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column: Question Card (3 columns) */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-3xl border border-gray-200/90 shadow-sm p-6 sm:p-8 space-y-6">
            {/* Non-revealing Encouraging Reaction */}
            {answerReaction && (
              <div className="p-3 bg-blue-50/90 border border-blue-200 rounded-2xl flex items-center justify-between text-xs text-[#003366] font-bold shadow-2xs animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:transition-none">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-[#C8102E] flex-shrink-0" />
                  <span>{answerReaction}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAnswerReaction(null)}
                  className="text-gray-400 hover:text-gray-600 ml-2"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Question Meta */}
            <div className="flex justify-between items-center text-xs text-gray-500 border-b border-gray-100 pb-4">
              <span className="font-bold text-gray-900 text-sm">
                Question {currentIndex + 1} of {questions.length}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                {currentQuestion.points} Points
              </span>
            </div>

            {/* Prompt */}
            <div className="text-base sm:text-lg font-bold text-gray-900 leading-relaxed whitespace-pre-wrap">
              {currentQuestion.question_text}
            </div>


            {/* MCQ Options */}
            {currentQuestion.question_type === 'MCQ' && (
              <div className="space-y-3 pt-2">
                {currentQuestion.options?.map((opt, oIdx) => {
                  const isSelected = currentAnswer?.selectedOptionId === opt.id;
                  return (
                    <label
                      key={opt.id}
                      onClick={() => handleSelectAnswer(opt.id, null)}
                      className={`flex items-center space-x-3 p-4 rounded-2xl border-2 transition cursor-pointer ${
                        isSelected
                          ? 'bg-kits-red/5 border-kits-red text-gray-900 font-semibold shadow-sm'
                          : 'bg-white border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      <div
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center font-bold text-xs ${
                          isSelected
                            ? 'border-kits-red bg-kits-red text-white'
                            : 'border-gray-300 text-gray-500'
                        }`}
                      >
                        {String.fromCharCode(65 + oIdx)}
                      </div>
                      <span className="text-sm flex-1">{opt.option_text}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* True / False Options */}
            {currentQuestion.question_type === 'TRUE_FALSE' && (
              <div className="grid grid-cols-2 gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => handleSelectAnswer(null, true)}
                  className={`py-5 rounded-2xl border-2 font-bold text-sm transition ${
                    currentAnswer?.selectedBoolean === true
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-md'
                      : 'bg-white border-gray-200 hover:border-gray-300 text-gray-800'
                  }`}
                >
                  TRUE
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectAnswer(null, false)}
                  className={`py-5 rounded-2xl border-2 font-bold text-sm transition ${
                    currentAnswer?.selectedBoolean === false
                      ? 'bg-red-600 text-white border-red-700 shadow-md'
                      : 'bg-white border-gray-200 hover:border-gray-300 text-gray-800'
                  }`}
                >
                  FALSE
                </button>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between items-center pt-6 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                disabled={currentIndex === 0}
                className="inline-flex items-center px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </button>

              <button
                type="button"
                onClick={() => setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                disabled={currentIndex === questions.length - 1}
                className="inline-flex items-center px-5 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Question Navigator Grid (1 column) */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-3xl border border-gray-200/90 shadow-sm p-5 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Question Palette
              </h3>
              <span className="text-xs font-bold text-kits-red">
                {answeredCount} / {questions.length} Answered
              </span>
            </div>

            {/* Grid of question buttons */}
            <div className="grid grid-cols-5 gap-2 max-h-72 overflow-y-auto p-1">
              {questions.map((q, idx) => {
                const isAnswered = Boolean(answersMap[q.id]);
                const isCurrent = currentIndex === idx;

                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-9 rounded-xl font-mono text-xs font-bold transition flex items-center justify-center border ${
                      isCurrent
                        ? 'border-kits-red bg-kits-red text-white shadow-sm ring-2 ring-kits-red/20'
                        : isAnswered
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="text-[11px] text-gray-500 space-y-1.5 pt-3 border-t border-gray-100">
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-kits-red" />
                <span>Current Question</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-gray-900" />
                <span>Answered</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-gray-100 border border-gray-300" />
                <span>Unattempted</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Warning Modal (Strikes 1, 2, or 3) */}
      {warningModalMessage && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-4 text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8" />
            </div>

            <h3 className="text-lg font-extrabold text-gray-900">
              {isTerminated ? 'Assessment Session Terminated' : `Proctoring Warning (Strike ${strikeCount} of 3)`}
            </h3>

            <p className="text-xs text-gray-600 leading-relaxed">{warningModalMessage}</p>

            <div className="pt-2">
              {isTerminated ? (
                <button
                  type="button"
                  onClick={() => navigate(`/assessments/${assessmentId}/result`)}
                  className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-md transition"
                >
                  Proceed to Finalized Results
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setWarningModalMessage(null)}
                  className="w-full py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold rounded-xl shadow-md transition"
                >
                  I Understand — Return to Exam
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manual Submission Confirmation Modal */}
      {isSubmitModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Submit Your Examination?</h3>
            <p className="text-xs text-gray-600">
              You have answered <strong>{answeredCount}</strong> out of{' '}
              <strong>{questions.length}</strong> questions.
            </p>

            {answeredCount < questions.length && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  You have {questions.length - answeredCount} unattempted questions remaining.
                </span>
              </div>
            )}

            <p className="text-xs text-gray-500">
              Once submitted, your session will be locked, scored on the server, and entered into the leaderboard.
            </p>

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsSubmitModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition"
              >
                Continue Working
              </button>
              <button
                type="button"
                onClick={handleManualSubmit}
                disabled={submitting}
                className="px-5 py-2 bg-kits-red hover:bg-kits-red/90 text-white text-xs font-bold rounded-xl shadow-sm transition disabled:opacity-50"
              >
                {submitting ? 'Finalizing...' : 'Yes, Submit Final Exam'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default AssessmentAttempt;
