import React, { useState, useEffect } from 'react';
import {
  X,
  Save,
  Send,
  AlertCircle,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Edit2,
  CheckCircle2,
  Clock,
  Layers,
  Eye,
  Settings,
  Zap,
  Lock,
  Upload,
} from 'lucide-react';
import {
  assessmentService,
  parseQuestionBankCsv,
  readTextFromFile,
  extractErrorMessage,
  type Assessment,
  type AssessmentRevision,
  type AssessmentRevisionQuestionData,
  type AssessmentQuestionOption,
  type QuestionType,
} from '@kits-eos/shared';
import { getCoordinatorSessionToken } from '../../utils/coordinatorSession';

interface AssessmentRevisionEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  assessment: Assessment;
  onPublishedSuccess: (publishedRevNumber: number) => void;
}

export function AssessmentRevisionEditorModal({
  isOpen,
  onClose,
  assessment,
  onPublishedSuccess,
}: AssessmentRevisionEditorModalProps) {
  const coordToken = getCoordinatorSessionToken() || undefined;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Active Tab: 'SETTINGS' | 'QUESTIONS' | 'PREVIEW'
  const [activeTab, setActiveTab] = useState<'SETTINGS' | 'QUESTIONS' | 'PREVIEW'>('QUESTIONS');

  // Revision Metadata
  const [revisionNumber, setRevisionNumber] = useState<number>((assessment.current_revision_number || 1) + 1);
  const [changeSummary, setChangeSummary] = useState('');
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [activeAttemptsCount, setActiveAttemptsCount] = useState(0);

  // Form State
  const [title, setTitle] = useState(assessment.title || '');
  const [description, setDescription] = useState(assessment.description || '');
  const [instructions, setInstructions] = useState(assessment.instructions || '');
  const [durationMinutes, setDurationMinutes] = useState(assessment.duration_minutes || 60);
  const [passingPercentage, setPassingPercentage] = useState(assessment.passing_percentage ?? 40);
  const [startTime, setStartTime] = useState(
    assessment.start_time ? new Date(assessment.start_time).toISOString().slice(0, 16) : ''
  );
  const [endTime, setEndTime] = useState(
    assessment.end_time ? new Date(assessment.end_time).toISOString().slice(0, 16) : ''
  );
  const [includeInGlobalLeaderboard, setIncludeInGlobalLeaderboard] = useState(
    Boolean(assessment.include_in_global_leaderboard)
  );
  const [randomizeQuestions, setRandomizeQuestions] = useState(Boolean(assessment.randomize_questions));
  const [randomizeOptions, setRandomizeOptions] = useState(Boolean(assessment.randomize_options));

  // Speed Bonus Config
  const [speedBonusEnabled, setSpeedBonusEnabled] = useState(
    assessment.speed_bonus_config?.enabled ?? true
  );
  const [maxEosPoints, setMaxEosPoints] = useState(
    assessment.speed_bonus_config?.max_eos_points ?? 1000
  );
  const [defaultTimeLimitSeconds, setDefaultTimeLimitSeconds] = useState(
    assessment.speed_bonus_config?.default_time_limit_seconds ?? 30
  );

  // Questions State
  const [questions, setQuestions] = useState<AssessmentRevisionQuestionData[]>([]);

  // Question Edit Sub-Modal / Drawer State
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [qText, setQText] = useState('');
  const [qType, setQType] = useState<QuestionType>('MCQ');
  const [qPoints, setQPoints] = useState(5);
  const [qTimeLimit, setQTimeLimit] = useState(30);
  const [qOptions, setQOptions] = useState<AssessmentQuestionOption[]>([
    { id: '1', option_text: '', sort_order: 0, is_correct: true },
    { id: '2', option_text: '', sort_order: 1, is_correct: false },
    { id: '3', option_text: '', sort_order: 2, is_correct: false },
    { id: '4', option_text: '', sort_order: 3, is_correct: false },
  ]);
  const [qCorrectBoolean, setQCorrectBoolean] = useState<boolean>(true);
  const [qExplanation, setQExplanation] = useState<string>('');
  const [qModalError, setQModalError] = useState<string | null>(null);

  // Initialize or fetch draft revision on modal open
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    async function initRevision() {
      setLoading(true);
      setError(null);
      setSuccessMessage(null);

      try {
        // First check revision status
        const statusRes = await assessmentService.getAssessmentRevisionStatus(assessment.id, coordToken);
        if (statusRes.error) throw statusRes.error;

        if (!isMounted) return;
        const statusData = statusRes.data;
        if (statusData) {
          setActiveAttemptsCount(statusData.active_attempts_count || 0);

          if (!statusData.can_edit && statusData.block_reason) {
            setError(statusData.block_reason);
            setLoading(false);
            return;
          }
        }

        // Initiate or resume draft
        const initRes = await assessmentService.initiateAssessmentRevision(assessment.id, coordToken);
        if (initRes.error) throw initRes.error;

        if (!isMounted) return;
        const rev = initRes.data?.revision;
        if (rev) {
          setRevisionNumber(rev.revision_number);
          setTitle(rev.title || assessment.title);
          setDescription(rev.description || '');
          setInstructions(rev.instructions || '');
          setDurationMinutes(rev.duration_minutes || 60);
          setPassingPercentage(rev.passing_percentage ?? 40);
          if (rev.start_time) {
            setStartTime(new Date(rev.start_time).toISOString().slice(0, 16));
          }
          if (rev.end_time) {
            setEndTime(new Date(rev.end_time).toISOString().slice(0, 16));
          }
          setIncludeInGlobalLeaderboard(Boolean(rev.include_in_global_leaderboard));
          setRandomizeQuestions(Boolean(rev.randomize_questions));
          setRandomizeOptions(Boolean(rev.randomize_options));

          if (rev.speed_bonus_config) {
            setSpeedBonusEnabled(rev.speed_bonus_config.enabled ?? true);
            setMaxEosPoints(rev.speed_bonus_config.max_eos_points ?? 1000);
            setDefaultTimeLimitSeconds(rev.speed_bonus_config.default_time_limit_seconds ?? 30);
          }

          setChangeSummary(rev.change_summary || '');

          // Normalize questions_data
          const loadedQuestions = (rev.questions_data || []).map((q: any, idx: number) => ({
            id: q.id || `temp-${idx}`,
            question_text: q.question_text || '',
            question_type: (q.question_type as QuestionType) || 'MCQ',
            points: Number(q.points) || 5,
            time_limit_seconds: Number(q.time_limit_seconds) || 30,
            sort_order: idx + 1,
            options: (q.options || []).map((o: any, oIdx: number) => ({
              id: o.id || `opt-${idx}-${oIdx}`,
              option_text: o.option_text || '',
              sort_order: oIdx,
              is_correct: Boolean(o.is_correct),
            })),
            correct_boolean: q.correct_boolean ?? null,
          }));

          setQuestions(loadedQuestions);
          if (!initRes.data?.is_new) {
            setLastSavedTime('Previously saved draft resumed');
          }
        }
      } catch (err: any) {
        console.error('Failed to initialize revision:', err);
        setError(err.message || 'Unable to initialize revision editor.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    initRevision();
    return () => {
      isMounted = false;
    };
  }, [isOpen, assessment.id, coordToken]);

  if (!isOpen) return null;

  // Build current payload for saving/publishing
  const getRevisionPayload = (): Partial<AssessmentRevision> => ({
    title: title.trim(),
    description: description.trim(),
    instructions: instructions.trim(),
    duration_minutes: durationMinutes,
    start_time: new Date(startTime).toISOString(),
    end_time: new Date(endTime).toISOString(),
    passing_percentage: passingPercentage,
    include_in_global_leaderboard: includeInGlobalLeaderboard,
    randomize_questions: randomizeQuestions,
    randomize_options: randomizeOptions,
    speed_bonus_config: {
      enabled: speedBonusEnabled,
      max_eos_points: maxEosPoints,
      default_time_limit_seconds: defaultTimeLimitSeconds,
    },
    change_summary: changeSummary.trim(),
    questions_data: questions.map((q, idx) => ({
      ...q,
      sort_order: idx + 1,
    })),
  });

  // Client validation
  const validateBeforePublish = (): string | null => {
    if (!title.trim()) return 'Assessment title is required.';
    if (durationMinutes < 1) return 'Duration must be at least 1 minute.';

    const s = new Date(startTime);
    const e = new Date(endTime);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 'Please provide valid start and end dates.';
    if (e <= s) return 'Assessment closing time must be strictly after the opening start time.';

    if (passingPercentage < 0 || passingPercentage > 100) {
      return 'Passing score must be between 0 and 100%.';
    }

    if (questions.length < 1) {
      return 'Please add at least one question before publishing the revision.';
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question_text.trim()) {
        return `Question ${i + 1} has empty question text.`;
      }
      if (q.points <= 0 || isNaN(q.points)) {
        return `Question ${i + 1} must have a positive points value.`;
      }

      if (q.question_type === 'MCQ') {
        const opts = q.options || [];
        if (opts.length < 3 || opts.length > 5) {
          return `Question ${i + 1} (MCQ) must have between 3 and 5 options.`;
        }
        for (let j = 0; j < opts.length; j++) {
          if (!opts[j].option_text.trim()) {
            return `Question ${i + 1}, Option ${j + 1} text cannot be blank.`;
          }
        }
        const correctCount = opts.filter((o) => o.is_correct).length;
        if (correctCount !== 1) {
          return `Question ${i + 1} (MCQ) must have exactly one correct option marked.`;
        }
      } else if (q.question_type === 'TRUE_FALSE') {
        if (q.correct_boolean === null || q.correct_boolean === undefined) {
          return `Question ${i + 1} (True/False) requires a correct boolean answer.`;
        }
      }
    }

    return null;
  };

  // Save Draft
  const handleSaveDraft = async () => {
    setError(null);
    setSuccessMessage(null);

    if (!title.trim()) {
      setError('Assessment title cannot be empty.');
      return;
    }

    setSaving(true);
    try {
      const payload = getRevisionPayload();
      const res = await assessmentService.saveAssessmentRevisionDraft(assessment.id, payload, coordToken);
      if (res.error) throw res.error;

      const timeStr = new Date().toLocaleTimeString();
      setLastSavedTime(`Draft saved at ${timeStr}`);
      setSuccessMessage(`Draft revision ${revisionNumber} saved successfully.`);
    } catch (err: any) {
      console.error('Save draft error:', err);
      setError(err.message || 'Failed to save draft revision.');
    } finally {
      setSaving(false);
    }
  };

  // Publish Revised Assessment
  const handlePublishRevision = async () => {
    setError(null);
    setSuccessMessage(null);

    const valErr = validateBeforePublish();
    if (valErr) {
      setError(valErr);
      return;
    }

    if (
      !window.confirm(
        `Are you sure you want to publish Revision ${revisionNumber} with ${questions.length} questions? Once published, candidate attempts will access this revision.`
      )
    ) {
      return;
    }

    setPublishing(true);
    try {
      // 1. Save latest draft state first to guarantee consistency
      const payload = getRevisionPayload();
      const saveRes = await assessmentService.saveAssessmentRevisionDraft(assessment.id, payload, coordToken);
      if (saveRes.error) throw saveRes.error;

      // 2. Publish atomically
      const pubRes = await assessmentService.publishAssessmentRevision(
        assessment.id,
        changeSummary.trim() || `Revision ${revisionNumber} published`,
        coordToken
      );
      if (pubRes.error) throw pubRes.error;

      const publishedRev = pubRes.data?.revision_number || revisionNumber;
      onPublishedSuccess(publishedRev);
      onClose();
    } catch (err: any) {
      console.error('Publish revision error:', err);
      setError(extractErrorMessage(err, 'Failed to publish revised assessment.'));
    } finally {
      setPublishing(false);
    }
  };

  // Cancel / Discard
  const handleCancel = async () => {
    if (window.confirm('Do you want to discard your uncommitted draft changes and revert to the published version?')) {
      try {
        await assessmentService.discardAssessmentRevision(assessment.id, coordToken);
      } catch (err) {
        console.warn('Discard notice:', err);
      }
      onClose();
    }
  };

  // Reorder Questions
  const moveQuestion = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= questions.length) return;
    const updated = [...questions];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    setQuestions(updated);
  };

  // Delete Question
  const deleteQuestion = (index: number) => {
    if (window.confirm(`Delete Question ${index + 1}?`)) {
      setQuestions(questions.filter((_, idx) => idx !== index));
    }
  };

  // Question Modal Openers
  const openNewQuestion = () => {
    setEditingQuestionIndex(null);
    setQText('');
    setQType('MCQ');
    setQPoints(5);
    setQTimeLimit(defaultTimeLimitSeconds);
    setQOptions([
      { id: '1', option_text: '', sort_order: 0, is_correct: true },
      { id: '2', option_text: '', sort_order: 1, is_correct: false },
      { id: '3', option_text: '', sort_order: 2, is_correct: false },
      { id: '4', option_text: '', sort_order: 3, is_correct: false },
    ]);
    setQCorrectBoolean(true);
    setQExplanation('');
    setQModalError(null);
    setIsQuestionModalOpen(true);
  };

  const openEditQuestion = (index: number) => {
    const q = questions[index];
    setEditingQuestionIndex(index);
    setQText(q.question_text);
    setQType(q.question_type);
    setQPoints(q.points);
    setQTimeLimit(q.time_limit_seconds || defaultTimeLimitSeconds);

    if (q.question_type === 'MCQ' && q.options && q.options.length > 0) {
      setQOptions(q.options.map((o) => ({ ...o })));
    } else {
      setQOptions([
        { id: '1', option_text: '', sort_order: 0, is_correct: true },
        { id: '2', option_text: '', sort_order: 1, is_correct: false },
        { id: '3', option_text: '', sort_order: 2, is_correct: false },
      ]);
    }

    setQCorrectBoolean(q.correct_boolean ?? true);
    setQExplanation(q.explanation || '');
    setQModalError(null);
    setIsQuestionModalOpen(true);
  };

  const handleQuickImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('File size exceeds 5MB limit. Please upload a smaller CSV file.');
      try {
        inputEl.value = '';
      } catch {}
      return;
    }

    try {
      const text = await readTextFromFile(file);

      // Validate non-binary
      if (text.includes('\0')) {
        setError('The selected file contains binary data and is not a valid CSV text file.');
        return;
      }

      const parsed = parseQuestionBankCsv(text, { defaultMarks: 5 });
      if (parsed.errors.length > 0 && parsed.validQuestions.length === 0) {
        setError(`CSV import error on row ${parsed.errors[0].rowNumber}: ${parsed.errors[0].message}`);
        return;
      }

      if (parsed.validQuestions.length > 0) {
        const nextOrder = questions.length + 1;
        const newQuestions: AssessmentRevisionQuestionData[] = parsed.validQuestions.map((vq, idx) => ({
          id: `imp-${Date.now()}-${idx}`,
          question_text: vq.question_text,
          question_type: vq.question_type,
          points: vq.points,
          time_limit_seconds: vq.time_limit_seconds,
          sort_order: nextOrder + idx,
          explanation: vq.explanation || undefined,
          options: vq.options.map((opt, oIdx) => ({
            id: `opt-${Date.now()}-${idx}-${oIdx}`,
            option_text: opt.option_text,
            sort_order: opt.sort_order,
            is_correct: opt.is_correct,
          })),
          correct_boolean: vq.correct_boolean,
        }));

        setQuestions((prev) => [...prev, ...newQuestions]);
        setSuccessMessage(`Successfully appended ${newQuestions.length} questions from CSV to draft revision.`);
      }
    } catch (err: any) {
      console.error('Quick CSV import error:', err);
      setError(err.message || 'Failed to parse CSV file.');
    } finally {
      try {
        inputEl.value = '';
      } catch {}
    }
  };

  // Save Individual Question into State
  const handleSaveQuestionToDraft = (e: React.FormEvent) => {
    e.preventDefault();
    setQModalError(null);

    if (!qText.trim()) {
      setQModalError('Question text cannot be blank.');
      return;
    }

    if (qPoints <= 0 || isNaN(qPoints)) {
      setQModalError('Points must be a positive number.');
      return;
    }

    if (qTimeLimit <= 0 || isNaN(qTimeLimit)) {
      setQModalError('Time limit must be at least 5 seconds.');
      return;
    }

    if (qType === 'MCQ') {
      if (qOptions.length < 3 || qOptions.length > 5) {
        setQModalError('MCQ must have between 3 and 5 options.');
        return;
      }
      for (let i = 0; i < qOptions.length; i++) {
        if (!qOptions[i].option_text.trim()) {
          setQModalError(`Option ${i + 1} text cannot be blank.`);
          return;
        }
      }
      const correctCount = qOptions.filter((o) => o.is_correct).length;
      if (correctCount !== 1) {
        setQModalError('Mark exactly one option as the correct answer.');
        return;
      }
    }

    const questionItem: AssessmentRevisionQuestionData = {
      id: editingQuestionIndex !== null ? questions[editingQuestionIndex].id : `temp-${Date.now()}`,
      question_text: qText.trim(),
      question_type: qType,
      points: Number(qPoints),
      time_limit_seconds: Number(qTimeLimit),
      sort_order: editingQuestionIndex !== null ? editingQuestionIndex + 1 : questions.length + 1,
      options: qType === 'MCQ' ? qOptions.map((o, idx) => ({ ...o, sort_order: idx })) : undefined,
      correct_boolean: qType === 'TRUE_FALSE' ? qCorrectBoolean : null,
      explanation: qExplanation.trim() || undefined,
    };

    if (editingQuestionIndex !== null) {
      const updated = [...questions];
      updated[editingQuestionIndex] = questionItem;
      setQuestions(updated);
    } else {
      setQuestions([...questions, questionItem]);
    }

    setIsQuestionModalOpen(false);
  };

  // Calculations
  const totalPoints = questions.reduce((acc, q) => acc + (Number(q.points) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
        {/* Header Bar */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
          <div>
            <div className="flex items-center space-x-2.5">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                Draft Revision {revisionNumber}
              </span>
              <span className="text-xs text-gray-500 font-medium">
                Current Published: Rev {assessment.current_revision_number || 1}
              </span>
              {lastSavedTime && (
                <span className="text-[11px] text-emerald-600 font-medium flex items-center">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {lastSavedTime}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-gray-900 mt-1 truncate max-w-xl">
              Edit & Republish Assessment: {assessment.title}
            </h2>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCancel}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-xl transition"
              title="Close Editor"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-gray-200 bg-white flex space-x-6 flex-shrink-0">
          <button
            onClick={() => setActiveTab('QUESTIONS')}
            className={`py-3 text-xs font-bold uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 ${
              activeTab === 'QUESTIONS'
                ? 'border-kits-red text-kits-red'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Questions ({questions.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('SETTINGS')}
            className={`py-3 text-xs font-bold uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 ${
              activeTab === 'SETTINGS'
                ? 'border-kits-red text-kits-red'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Settings & Window</span>
          </button>
          <button
            onClick={() => setActiveTab('PREVIEW')}
            className={`py-3 text-xs font-bold uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 ${
              activeTab === 'PREVIEW'
                ? 'border-kits-red text-kits-red'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Candidate Preview</span>
          </button>
        </div>

        {/* Status / Alert Notices */}
        {error && (
          <div className="mx-6 mt-4 p-3.5 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs flex items-center space-x-2 flex-shrink-0">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mx-6 mt-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center space-x-2 flex-shrink-0">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {activeAttemptsCount > 0 && (
          <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-300 rounded-2xl text-amber-900 text-xs flex items-start space-x-3 flex-shrink-0">
            <Lock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Active Participant Sessions in Progress</p>
              <p className="mt-0.5 text-amber-800">
                There are currently {activeAttemptsCount} active student sessions running. To preserve candidate
                integrity, publishing this revision is blocked until active sessions finish or are closed.
              </p>
            </div>
          </div>
        )}

        {/* Modal Body / Scrollable Tabs */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-24 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-3 border-kits-red border-t-transparent mx-auto" />
              <p className="mt-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Loading revision workspace...
              </p>
            </div>
          ) : (
            <>
              {/* Tab 1: Questions Management */}
              {activeTab === 'QUESTIONS' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-gray-50/80 p-3.5 rounded-2xl border border-gray-200">
                    <div className="flex items-center space-x-4 text-xs font-semibold text-gray-700">
                      <span>Total Questions: <strong>{questions.length}</strong></span>
                      <span>Total Points: <strong>{totalPoints}</strong></span>
                      <span>Passing Mark: <strong>{Math.ceil((totalPoints * passingPercentage) / 100)} pts</strong></span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <div className="relative">
                        <input
                          type="file"
                          accept=".csv,text/csv,text/plain,application/vnd.ms-excel,text/comma-separated-values,application/csv,*/*"
                          onChange={handleQuickImportCsv}
                          id="revision-quick-import-csv"
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          title="Import questions from CSV into this revision"
                        />
                        <button
                          type="button"
                          className="inline-flex items-center px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition shadow-2xs space-x-1.5 pointer-events-none"
                          title="Import questions from CSV into this revision"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Import CSV</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={openNewQuestion}
                        className="inline-flex items-center px-4 py-2 bg-kits-red hover:bg-kits-red/90 text-white text-xs font-bold rounded-xl transition shadow-sm space-x-1.5 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add Question</span>
                      </button>
                    </div>
                  </div>

                  {questions.length === 0 ? (
                    <div className="p-12 text-center border-2 border-dashed border-gray-200 rounded-2xl">
                      <Layers className="w-10 h-10 text-gray-300 mx-auto" />
                      <h4 className="text-sm font-bold text-gray-700 mt-2">No Questions in This Revision</h4>
                      <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                        Add Multiple Choice or True/False questions to this assessment revision.
                      </p>
                      <button
                        type="button"
                        onClick={openNewQuestion}
                        className="mt-4 px-4 py-2 bg-kits-red text-white text-xs font-bold rounded-xl hover:bg-kits-red/90 transition"
                      >
                        Add First Question
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {questions.map((q, idx) => (
                        <div
                          key={q.id || idx}
                          className="p-4 bg-white rounded-2xl border border-gray-200 shadow-2xs hover:border-gray-300 transition space-y-2.5"
                        >
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex items-center space-x-2">
                              <span className="w-7 h-7 rounded-lg bg-gray-100 font-bold text-xs text-gray-700 flex items-center justify-center">
                                Q{idx + 1}
                              </span>
                              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700">
                                {q.question_type}
                              </span>
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                {q.points} Points
                              </span>
                              {q.time_limit_seconds && (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 flex items-center">
                                  <Clock className="w-3 h-3 mr-1" />
                                  {q.time_limit_seconds}s
                                </span>
                              )}
                            </div>

                            <div className="flex items-center space-x-1">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moveQuestion(idx, idx - 1)}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-30"
                                title="Move Up"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === questions.length - 1}
                                onClick={() => moveQuestion(idx, idx + 1)}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-30"
                                title="Move Down"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditQuestion(idx)}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                                title="Edit Question"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteQuestion(idx)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                title="Delete Question"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <p className="text-sm font-semibold text-gray-900 whitespace-pre-wrap">{q.question_text}</p>

                          {q.question_type === 'MCQ' && q.options && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                              {q.options.map((opt, oIdx) => (
                                <div
                                  key={opt.id || oIdx}
                                  className={`p-2 rounded-xl text-xs flex items-center space-x-2 border ${
                                    opt.is_correct
                                      ? 'bg-emerald-50/70 border-emerald-300 text-emerald-900 font-semibold'
                                      : 'bg-gray-50 border-gray-200 text-gray-700'
                                  }`}
                                >
                                  <span className="font-bold text-[10px] w-4 text-center">
                                    {String.fromCharCode(65 + oIdx)}.
                                  </span>
                                  <span className="flex-1 truncate">{opt.option_text}</span>
                                  {opt.is_correct && (
                                    <span className="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                                      Correct
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {q.question_type === 'TRUE_FALSE' && (
                            <div className="pt-1 flex items-center space-x-2 text-xs">
                              <span className="text-gray-500 font-medium">Correct Answer:</span>
                              <span
                                className={`px-2 py-0.5 rounded font-bold ${
                                  q.correct_boolean
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {q.correct_boolean ? 'TRUE' : 'FALSE'}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Settings & Schedule */}
              {activeTab === 'SETTINGS' && (
                <div className="space-y-6">
                  {/* General Details */}
                  <div className="bg-gray-50/60 p-5 rounded-2xl border border-gray-200 space-y-4">
                    <h3 className="text-sm font-bold text-gray-900">General Information</h3>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Assessment Title *</label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. C Programming Comprehensive Assessment"
                        className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Description</label>
                      <textarea
                        rows={2}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Detailed examination scope, topics covered, syllabus, etc."
                        className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Instructions for Candidates</label>
                      <textarea
                        rows={3}
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        placeholder="Exam rules, time limit guidelines, tab-switch warning, etc."
                        className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition font-mono text-xs"
                      />
                    </div>
                  </div>

                  {/* Timing & Passing Score */}
                  <div className="bg-gray-50/60 p-5 rounded-2xl border border-gray-200 space-y-4">
                    <h3 className="text-sm font-bold text-gray-900">Timing & Grading Rules</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Duration (Minutes) *</label>
                        <input
                          type="number"
                          min={1}
                          max={360}
                          value={durationMinutes}
                          onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 60)}
                          className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Passing Percentage (%) *</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={passingPercentage}
                          onChange={(e) => setPassingPercentage(parseFloat(e.target.value) || 40)}
                          className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Window Start Time *</label>
                        <input
                          type="datetime-local"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Window Closing End Time *</label>
                        <input
                          type="datetime-local"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
                        />
                      </div>
                    </div>
                  </div>

                  {/* EOS Speed Bonus & Podium Settings */}
                  <div className="bg-purple-50/50 p-5 rounded-2xl border border-purple-200 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-purple-900 flex items-center">
                          <Zap className="w-4 h-4 mr-1.5 text-purple-600" />
                          Kahoot-Inspired Speed Bonus & Live Podium
                        </h3>
                        <p className="text-xs text-purple-700 mt-0.5">
                          Awards up to 1,000 dynamic speed points based on response timer speed for correct answers.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={speedBonusEnabled}
                          onChange={(e) => setSpeedBonusEnabled(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                      </label>
                    </div>

                    {speedBonusEnabled && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-1">Max EOS Points Per Question</label>
                          <input
                            type="number"
                            min={100}
                            max={5000}
                            value={maxEosPoints}
                            onChange={(e) => setMaxEosPoints(parseInt(e.target.value) || 1000)}
                            className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-200 focus:border-purple-600 transition"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-1">Default Question Timer (Seconds)</label>
                          <input
                            type="number"
                            min={5}
                            max={300}
                            value={defaultTimeLimitSeconds}
                            onChange={(e) => setDefaultTimeLimitSeconds(parseInt(e.target.value) || 30)}
                            className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-200 focus:border-purple-600 transition"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Anti-Cheating & Randomization Toggles */}
                  <div className="bg-gray-50/60 p-5 rounded-2xl border border-gray-200 space-y-3">
                    <h3 className="text-sm font-bold text-gray-900">Shuffling & Leaderboard Toggles</h3>
                    <div className="space-y-2.5">
                      <label className="flex items-center space-x-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={randomizeQuestions}
                          onChange={(e) => setRandomizeQuestions(e.target.checked)}
                          className="w-4 h-4 text-kits-red rounded border-gray-300 focus:ring-kits-red"
                        />
                        <span className="text-xs font-semibold text-gray-700">
                          Randomize question order for each candidate attempt
                        </span>
                      </label>

                      <label className="flex items-center space-x-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={randomizeOptions}
                          onChange={(e) => setRandomizeOptions(e.target.checked)}
                          className="w-4 h-4 text-kits-red rounded border-gray-300 focus:ring-kits-red"
                        />
                        <span className="text-xs font-semibold text-gray-700">
                          Randomize option order for multiple-choice questions
                        </span>
                      </label>

                      <label className="flex items-center space-x-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeInGlobalLeaderboard}
                          onChange={(e) => setIncludeInGlobalLeaderboard(e.target.checked)}
                          className="w-4 h-4 text-kits-red rounded border-gray-300 focus:ring-kits-red"
                        />
                        <span className="text-xs font-semibold text-gray-700">
                          Include results in student portal global leaderboard
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: Candidate Preview */}
              {activeTab === 'PREVIEW' && (
                <div className="space-y-6">
                  <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white p-6 rounded-3xl shadow-sm">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/20 uppercase tracking-wider">
                      Candidate Examination Preview
                    </span>
                    <h3 className="text-xl font-bold mt-2">{title || 'Untitled Assessment'}</h3>
                    <p className="text-xs text-gray-300 mt-1 max-w-2xl">{description || 'No description provided.'}</p>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-white/10 text-xs">
                      <div>
                        <span className="text-gray-400">Duration:</span>
                        <p className="font-bold">{durationMinutes} Minutes</p>
                      </div>
                      <div>
                        <span className="text-gray-400">Total Questions:</span>
                        <p className="font-bold">{questions.length}</p>
                      </div>
                      <div>
                        <span className="text-gray-400">Total Marks:</span>
                        <p className="font-bold">{totalPoints} Points</p>
                      </div>
                      <div>
                        <span className="text-gray-400">Passing Mark:</span>
                        <p className="font-bold">
                          {passingPercentage}% ({Math.ceil((totalPoints * passingPercentage) / 100)} pts)
                        </p>
                      </div>
                    </div>
                  </div>

                  {instructions && (
                    <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-2xl text-xs text-amber-900">
                      <span className="font-bold uppercase tracking-wider text-[10px] block mb-1">
                        Examination Instructions
                      </span>
                      <p className="whitespace-pre-wrap">{instructions}</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-gray-900">Candidate Questions Flow ({questions.length})</h4>
                    {questions.map((q, idx) => (
                      <div key={q.id || idx} className="p-5 bg-white rounded-2xl border border-gray-200 space-y-3">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-gray-500">Question {idx + 1} of {questions.length}</span>
                          <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            {q.points} Points
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 whitespace-pre-wrap">{q.question_text}</p>

                        {q.question_type === 'MCQ' && q.options && (
                          <div className="space-y-2 pt-1">
                            {q.options.map((opt, oIdx) => (
                              <div
                                key={opt.id || oIdx}
                                className="p-3 rounded-xl border border-gray-200 bg-gray-50/60 text-xs text-gray-800 flex items-center space-x-2"
                              >
                                <span className="w-5 h-5 rounded-full border border-gray-300 flex items-center justify-center font-bold text-[10px] text-gray-600">
                                  {String.fromCharCode(65 + oIdx)}
                                </span>
                                <span>{opt.option_text}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {q.question_type === 'TRUE_FALSE' && (
                          <div className="grid grid-cols-2 gap-3 pt-1">
                            <div className="p-3 text-center border border-gray-200 rounded-xl bg-gray-50 text-xs font-bold text-gray-700">
                              TRUE
                            </div>
                            <div className="p-3 text-center border border-gray-200 rounded-xl bg-gray-50 text-xs font-bold text-gray-700">
                              FALSE
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky Bottom Actions Bar */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 flex-shrink-0">
          <div className="w-full sm:w-auto flex-1 max-w-md">
            <input
              type="text"
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              placeholder="Revision notes (e.g. Corrected typo in Q3, updated duration)"
              className="w-full px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red"
            />
          </div>

          <div className="flex items-center space-x-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving || publishing}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-semibold rounded-xl transition disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={saving || publishing}
              className="inline-flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-xs font-bold rounded-xl transition shadow-sm space-x-1.5 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save Draft'}</span>
            </button>

            <button
              type="button"
              onClick={handlePublishRevision}
              disabled={saving || publishing || activeAttemptsCount > 0}
              className="inline-flex items-center px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition shadow-sm space-x-1.5 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{publishing ? 'Publishing...' : `Publish Revision ${revisionNumber}`}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sub-Modal: Add / Edit Individual Question */}
      {isQuestionModalOpen && (
        <div className="fixed inset-0 z-60 overflow-y-auto bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-200 animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-base font-bold text-gray-900">
                {editingQuestionIndex !== null ? `Edit Question ${editingQuestionIndex + 1}` : 'Add New Question'}
              </h3>
              <button
                onClick={() => setIsQuestionModalOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveQuestionToDraft} className="flex-1 overflow-y-auto p-6 space-y-4">
              {qModalError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{qModalError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Question Type *</label>
                  <select
                    value={qType}
                    onChange={(e) => setQType(e.target.value as QuestionType)}
                    className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red"
                  >
                    <option value="MCQ">Multiple Choice (MCQ)</option>
                    <option value="TRUE_FALSE">True / False</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Points Value *</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="100"
                    value={qPoints}
                    onChange={(e) => setQPoints(parseFloat(e.target.value) || 5)}
                    className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Time Limit (Seconds) *</label>
                  <input
                    type="number"
                    min="5"
                    max="300"
                    value={qTimeLimit}
                    onChange={(e) => setQTimeLimit(parseInt(e.target.value) || 30)}
                    className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Question Text *</label>
                <textarea
                  rows={3}
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder="Enter the full question prompt here..."
                  className="w-full px-3.5 py-2 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red"
                />
              </div>

              {/* MCQ Options Authoring */}
              {qType === 'MCQ' && (
                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-bold text-gray-700">
                      Options (3 to 5 options, mark exactly 1 correct)
                    </label>
                    {qOptions.length < 5 && (
                      <button
                        type="button"
                        onClick={() =>
                          setQOptions([
                            ...qOptions,
                            { id: `opt-${Date.now()}`, option_text: '', sort_order: qOptions.length, is_correct: false },
                          ])
                        }
                        className="text-[11px] font-bold text-kits-red hover:underline flex items-center"
                      >
                        <Plus className="w-3 h-3 mr-0.5" /> Add Option
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    {qOptions.map((opt, idx) => (
                      <div key={opt.id || idx} className="flex items-center space-x-2">
                        <label className="flex items-center cursor-pointer" title="Mark as correct answer">
                          <input
                            type="radio"
                            name="correct_option"
                            checked={opt.is_correct}
                            onChange={() => {
                              setQOptions(
                                qOptions.map((o, oIdx) => ({
                                  ...o,
                                  is_correct: oIdx === idx,
                                }))
                              );
                            }}
                            className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                          />
                        </label>
                        <span className="font-bold text-xs text-gray-500 w-5 text-center">
                          {String.fromCharCode(65 + idx)}.
                        </span>
                        <input
                          type="text"
                          value={opt.option_text}
                          onChange={(e) => {
                            const updated = [...qOptions];
                            updated[idx].option_text = e.target.value;
                            setQOptions(updated);
                          }}
                          placeholder={`Option ${String.fromCharCode(65 + idx)} text`}
                          className="flex-1 px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red"
                        />
                        {qOptions.length > 3 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = qOptions.filter((_, oIdx) => oIdx !== idx);
                              // If deleted option was correct, mark first remaining option
                              if (opt.is_correct && updated.length > 0) {
                                updated[0].is_correct = true;
                              }
                              setQOptions(updated);
                            }}
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                            title="Remove option"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* True / False Selection */}
              {qType === 'TRUE_FALSE' && (
                <div className="pt-2 border-t border-gray-100 space-y-2">
                  <label className="block text-xs font-bold text-gray-700">Correct Answer Key *</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setQCorrectBoolean(true)}
                      className={`py-2.5 rounded-xl text-xs font-bold transition border ${
                        qCorrectBoolean
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                      }`}
                    >
                      TRUE
                    </button>
                    <button
                      type="button"
                      onClick={() => setQCorrectBoolean(false)}
                      className={`py-2.5 rounded-xl text-xs font-bold transition border ${
                        !qCorrectBoolean
                          ? 'bg-red-600 text-white border-red-600 shadow-sm'
                          : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                      }`}
                    >
                      FALSE
                    </button>
                  </div>
                </div>
              )}

              {/* Optional Explanation Field */}
              <div className="pt-2 border-t border-gray-100">
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Explanation (Optional)
                </label>
                <textarea
                  rows={3}
                  value={qExplanation}
                  onChange={(e) => setQExplanation(e.target.value)}
                  placeholder="Provide multiline explanation, hints, or solution rationale to assist student review..."
                  className="w-full px-3.5 py-2 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red leading-relaxed"
                />
              </div>

              <div className="pt-4 border-t border-gray-200 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsQuestionModalOpen(false)}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-semibold rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-kits-red hover:bg-kits-red/90 text-white text-xs font-bold rounded-xl transition shadow-sm"
                >
                  Save Question
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
