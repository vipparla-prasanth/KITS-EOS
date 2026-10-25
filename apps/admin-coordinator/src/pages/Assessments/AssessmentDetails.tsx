import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  Plus,
  Trash2,
  Edit2,
  AlertCircle,
  Trophy,
  ShieldAlert,
  Send,
  Lock,
  Archive,
  RefreshCw,
  Layers,
  CheckCircle2,
  Radio,
  UserCheck,
  Sparkles,
  UserPlus,
  Search,
  CheckSquare,
  Square,
  RotateCcw,
  Download,
  Upload,
  FileSpreadsheet,
  FileText,
  Check,
  X,
  BarChart3,
} from 'lucide-react';
import {
  assessmentService,
  supabase,
  generateQuestionBankTemplateCsv,
  exportQuestionsToCsv,
  parseQuestionBankCsv,
  readTextFromFile,
  type QuestionBankImportResult,
  type Assessment,
  type AssessmentQuestion,
  type QuestionType,
  type LeaderboardEntry,
  extractErrorMessage,
} from '@kits-eos/shared';
import { getCoordinatorSessionToken } from '../../utils/coordinatorSession';
import { AssessmentDeleteModal } from '../../components/assessments/AssessmentDeleteModal';
import { AttemptDeleteModal } from '../../components/assessments/AttemptDeleteModal';
import { AssessmentReopenModal } from '../../components/assessments/AssessmentReopenModal';
import { AssessmentRevisionEditorModal } from '../../components/assessments/AssessmentRevisionEditorModal';
import { AssessmentReportView } from '../../components/assessments/AssessmentReportView';

export function AssessmentDetails() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const totalQuestionsPoints = useMemo(() => (questions || []).reduce((sum, q) => sum + (Number(q.points) || 0), 0), [questions]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [coordinatorAssignment, setCoordinatorAssignment] = useState<any | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [isRevisionEditorOpen, setIsRevisionEditorOpen] = useState(false);
  const [reopenSuccessNotice, setReopenSuccessNotice] = useState<string | null>(null);

  // Question Bank Import / Export State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importCsvText, setImportCsvText] = useState<string>('');
  const [importDefaultMarks, setImportDefaultMarks] = useState<number>(5);
  const [importParseResult, setImportParseResult] = useState<QuestionBankImportResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importReading, setImportReading] = useState(false);
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);
  const [importTargetRevisionId, setImportTargetRevisionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Attempt Record Management State
  const [selectedAttemptIds, setSelectedAttemptIds] = useState<string[]>([]);
  const [isAttemptDeleteModalOpen, setIsAttemptDeleteModalOpen] = useState(false);
  const [targetAttemptIdsToDelete, setTargetAttemptIdsToDelete] = useState<string[]>([]);
  const [attemptSearchQuery, setAttemptSearchQuery] = useState('');
  const [attemptStatusFilter, setAttemptStatusFilter] = useState<'ALL' | 'IN_PROGRESS' | 'SUBMITTED' | 'TERMINATED' | 'EXPIRED'>('ALL');
  const [attemptActionSuccess, setAttemptActionSuccess] = useState<string | null>(null);

  // Coordinator Assignment Modal State
  const [isAssignCoordModalOpen, setIsAssignCoordModalOpen] = useState(false);
  const [coordName, setCoordName] = useState('');
  const [coordUsername, setCoordUsername] = useState('');
  const [coordPassword, setCoordPassword] = useState('');
  const [coordPhone, setCoordPhone] = useState('');
  const [coordError, setCoordError] = useState<string | null>(null);
  const [coordLoading, setCoordLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'QUESTIONS' | 'QUESTION_BANK' | 'PREVIEW' | 'ATTEMPTS' | 'LEADERBOARD' | 'COORDINATOR' | 'REPORT'>('QUESTIONS');

  // Edit Assessment Settings State
  const [isEditSettingsOpen, setIsEditSettingsOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editDurationMinutes, setEditDurationMinutes] = useState(60);
  const [editPassingPercentage, setEditPassingPercentage] = useState(40);
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editIncludeGlobal, setEditIncludeGlobal] = useState(false);
  const [editRandomizeQuestions, setEditRandomizeQuestions] = useState(false);
  const [editRandomizeOptions, setEditRandomizeOptions] = useState(false);
  const [editEventId, setEditEventId] = useState('');
  const [editSubEventId, setEditSubEventId] = useState('');
  const [eventsList, setEventsList] = useState<Array<{ id: string; name: string }>>([]);
  const [subEventsList, setSubEventsList] = useState<Array<{ id: string; name: string; event_id: string }>>([]);
  const [editSettingsError, setEditSettingsError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('events').select('id, name').order('name').then(({ data }) => {
      if (data) setEventsList(data);
    });
    supabase.from('sub_events').select('id, name, event_id').order('name').then(({ data }) => {
      if (data) setSubEventsList(data);
    });
  }, []);

  // Question Modal State
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [questionText, setQuestionText] = useState('');
  const [questionType, setQuestionType] = useState<QuestionType>('MCQ');
  const [points, setPoints] = useState<number>(5);
  const [options, setOptions] = useState<Array<{ option_text: string; is_correct: boolean }>>([
    { option_text: '', is_correct: true },
    { option_text: '', is_correct: false },
    { option_text: '', is_correct: false },
    { option_text: '', is_correct: false },
  ]);
  const [correctBoolean, setCorrectBoolean] = useState<boolean>(true);
  const [explanation, setExplanation] = useState<string>('');
  const [modalError, setModalError] = useState<string | null>(null);

  // Violations Audit Modal State
  const [selectedAttemptForViolations, setSelectedAttemptForViolations] = useState<any | null>(null);
  const [violationsList, setViolationsList] = useState<any[]>([]);
  const [loadingViolations, setLoadingViolations] = useState(false);

  const loadData = async () => {
    if (!assessmentId) return;
    setLoading(true);
    setError(null);
    try {
      const [asmRes, qRes, coordRes] = await Promise.all([
        assessmentService.getAdminAssessmentById(assessmentId),
        assessmentService.getAdminQuestions(assessmentId),
        assessmentService.getCoordinatorAssignment(assessmentId),
      ]);

      if (asmRes.error) throw asmRes.error;
      setAssessment(asmRes.data);
      setQuestions(qRes.data || []);
      setCoordinatorAssignment(coordRes.data || null);
    } catch (err: any) {
      console.error('Failed to load assessment details:', err);
      setError(err.message || 'Unable to load assessment details.');
    } finally {
      setLoading(false);
    }
  };

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCoordPassword(pwd);
  };

  const handleAssignCoordinator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assessment) return;
    setCoordError(null);

    if (!coordName.trim() || !coordUsername.trim() || !coordPassword.trim()) {
      setCoordError('Display name, username, and password are required.');
      return;
    }
    if (coordUsername.trim().length < 3) {
      setCoordError('Username must be at least 3 characters.');
      return;
    }
    if (coordPassword.trim().length < 6) {
      setCoordError('Password must be at least 6 characters.');
      return;
    }

    setCoordLoading(true);
    try {
      const { error: err } = await assessmentService.assignCoordinator(assessment.id, {
        name: coordName.trim(),
        username: coordUsername.trim(),
        password: coordPassword.trim(),
        phone: coordPhone.trim() || undefined,
      });

      if (err) throw err;
      setIsAssignCoordModalOpen(false);
      setCoordName('');
      setCoordUsername('');
      setCoordPassword('');
      setCoordPhone('');
      await loadData();
    } catch (err: any) {
      console.error('Failed to assign coordinator:', err);
      setCoordError(err.message || 'Failed to assign coordinator.');
    } finally {
      setCoordLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    setSelectedAttemptIds([]);
    setAttemptActionSuccess(null);

    const coordErrorParam = searchParams.get('coordError');
    const tabParam = searchParams.get('tab');
    if (tabParam === 'COORDINATOR') {
      setActiveTab('COORDINATOR');
    }
    if (coordErrorParam) {
      setError(`Coordinator Assignment Warning: ${coordErrorParam}`);
      setIsAssignCoordModalOpen(true);
    }
  }, [assessmentId, searchParams]);

  const refreshAttempts = async () => {
    if (!assessmentId) return;
    const coordToken = getCoordinatorSessionToken();
    const res = await assessmentService.getScopedAttempts(assessmentId, coordToken || undefined);
    if (!res.error && res.data) {
      setAttempts(res.data);
    }
  };

  // Load secondary data when switching tabs
  useEffect(() => {
    if (!assessmentId) return;
    if (activeTab === 'ATTEMPTS') {
      refreshAttempts();
    } else if (activeTab === 'LEADERBOARD') {
      assessmentService.getAssessmentLeaderboard(assessmentId).then((res) => {
        if (!res.error && res.data) setLeaderboard(res.data);
      });
    }
  }, [activeTab, assessmentId]);

  // Filtered attempts based on search and status
  const filteredAttempts = useMemo(() => {
    return attempts.filter((att) => {
      const q = attemptSearchQuery.trim().toLowerCase();
      const matchesSearch =
        q === '' ||
        (att.student_name && att.student_name.toLowerCase().includes(q)) ||
        (att.roll_number && att.roll_number.toLowerCase().includes(q)) ||
        (att.college_name && att.college_name.toLowerCase().includes(q)) ||
        (att.students?.full_name && att.students.full_name.toLowerCase().includes(q)) ||
        (att.students?.roll_number && att.students.roll_number.toLowerCase().includes(q));

      const matchesStatus = attemptStatusFilter === 'ALL' || att.status === attemptStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [attempts, attemptSearchQuery, attemptStatusFilter]);

  // Selection actions
  const toggleSelectAttempt = (id: string) => {
    setSelectedAttemptIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = filteredAttempts.map((a) => a.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedAttemptIds.includes(id));
    if (allSelected) {
      setSelectedAttemptIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedAttemptIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleOpenSingleDelete = (attemptId: string) => {
    setTargetAttemptIdsToDelete([attemptId]);
    setIsAttemptDeleteModalOpen(true);
  };

  const handleOpenBulkDelete = () => {
    if (selectedAttemptIds.length === 0) return;
    setTargetAttemptIdsToDelete(selectedAttemptIds);
    setIsAttemptDeleteModalOpen(true);
  };

  // ==========================================================================
  // Question Bank Import / Export Handlers
  // ==========================================================================

  const downloadCsvFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadTemplate = () => {
    const csv = generateQuestionBankTemplateCsv();
    downloadCsvFile(csv, 'kits_eos_question_bank_template.csv');
  };

  const handleExportCsv = () => {
    if (!assessment || questions.length === 0) return;
    const { filename, csvContent } = exportQuestionsToCsv(questions, assessment.title);
    downloadCsvFile(csvContent, filename);
  };

  const handleCancelImportFile = () => {
    setImportFile(null);
    setImportCsvText('');
    setImportParseResult(null);
    setImportErrorMessage(null);
    setImportSuccessMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setImportErrorMessage('File size exceeds 5MB limit. Please upload a smaller CSV file.');
      try {
        inputEl.value = '';
      } catch {}
      return;
    }

    setImportErrorMessage(null);
    setImportSuccessMessage(null);
    setImportTargetRevisionId(null);
    setImportFile(file);
    setImportReading(true);

    try {
      const text = await readTextFromFile(file);

      // Validate non-binary
      if (text.includes('\0')) {
        setImportErrorMessage('The selected file contains binary data and is not a valid CSV text file.');
        setImportFile(null);
        return;
      }

      setImportCsvText(text);
      const parsed = parseQuestionBankCsv(text, { defaultMarks: importDefaultMarks });
      setImportParseResult(parsed);

      if (!parsed.isValid && parsed.validQuestions.length === 0) {
        const firstErr = parsed.errors[0]?.message || 'CSV file does not contain valid questions.';
        setImportErrorMessage(`CSV validation issue: ${firstErr}`);
      }
    } catch (err: any) {
      console.error('Failed to parse question CSV:', err);
      setImportErrorMessage(err.message || 'Failed to read the selected file. Please try again.');
      setImportFile(null);
    } finally {
      setImportReading(false);
      // Safely reset input value so re-selecting the exact same file fires onChange reliably
      try {
        inputEl.value = '';
      } catch {}
    }
  };

  const handleDefaultMarksChange = (val: number) => {
    const sanitizedVal = Math.max(0, val);
    setImportDefaultMarks(sanitizedVal);
    if (importCsvText) {
      const parsed = parseQuestionBankCsv(importCsvText, { defaultMarks: sanitizedVal });
      setImportParseResult(parsed);
    }
  };

  const handleCommitImport = async () => {
    if (!assessment || !importParseResult || importParseResult.validQuestions.length === 0) return;

    setImportLoading(true);
    setImportErrorMessage(null);
    setImportSuccessMessage(null);

    try {
      const { data, error: err } = await assessmentService.importAssessmentQuestions(
        assessment.id,
        importParseResult.validQuestions,
        importDefaultMarks,
        getCoordinatorSessionToken() || undefined
      );

      if (err) throw err;

      setImportSuccessMessage(
        data?.message || `Successfully appended ${importParseResult.validQuestions.length} questions.`
      );

      if (data?.mode === 'DRAFT_REVISION' && data?.revision_id) {
        setImportTargetRevisionId(data.revision_id);
      }

      setImportFile(null);
      setImportCsvText('');
      setImportParseResult(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      await loadData();
    } catch (err: any) {
      console.error('Question bank import failed:', err);
      setImportErrorMessage(err.message || 'Server error while importing questions.');
    } finally {
      setImportLoading(false);
    }
  };

  const openEditSettingsModal = () => {
    if (!assessment) return;
    setEditTitle(assessment.title || '');
    setEditDescription(assessment.description || '');
    setEditInstructions(assessment.instructions || '');
    setEditDurationMinutes(assessment.duration_minutes || 60);
    setEditPassingPercentage(assessment.passing_percentage || 40);
    setEditStartTime(assessment.start_time ? new Date(assessment.start_time).toISOString().slice(0, 16) : '');
    setEditEndTime(assessment.end_time ? new Date(assessment.end_time).toISOString().slice(0, 16) : '');
    setEditIncludeGlobal(Boolean(assessment.include_in_global_leaderboard));
    setEditRandomizeQuestions(Boolean(assessment.randomize_questions));
    setEditRandomizeOptions(Boolean(assessment.randomize_options));
    setEditEventId(assessment.event_id || '');
    setEditSubEventId(assessment.sub_event_id || '');
    setEditSettingsError(null);
    setIsEditSettingsOpen(true);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assessment) return;
    setEditSettingsError(null);

    if (!editTitle.trim()) {
      setEditSettingsError('Assessment title is required.');
      return;
    }

    if (editDurationMinutes < 1) {
      setEditSettingsError('Duration must be at least 1 minute.');
      return;
    }

    const start = new Date(editStartTime);
    const end = new Date(editEndTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setEditSettingsError('Please provide valid start and end dates.');
      return;
    }

    if (end <= start) {
      setEditSettingsError('Closing end time must be strictly after the start time.');
      return;
    }

    setActionLoading(true);
    try {
      const { error: err } = await assessmentService.updateAssessment(assessment.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        instructions: editInstructions.trim(),
        duration_minutes: editDurationMinutes,
        passing_percentage: editPassingPercentage,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        include_in_global_leaderboard: editIncludeGlobal,
        randomize_questions: editRandomizeQuestions,
        randomize_options: editRandomizeOptions,
        event_id: editEventId || null,
        sub_event_id: editSubEventId || null,
      });

      if (err) throw err;
      setIsEditSettingsOpen(false);
      await loadData();
    } catch (err: any) {
      console.error('Failed to update assessment settings:', err);
      setEditSettingsError(err.message || 'Failed to update assessment settings.');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!assessment) return;
    if ((questions?.length ?? 0) === 0) {
      setError('Cannot publish an assessment with zero questions. Add at least one question first.');
      return;
    }

    const isStandalone = !assessment.event_id && !assessment.sub_event_id;
    if (isStandalone && !coordinatorAssignment) {
      setError('Standalone assessments must have an assigned coordinator before publication. Please assign an available coordinator in the "Coordinator & Live Host" tab first.');
      setActiveTab('COORDINATOR');
      setIsAssignCoordModalOpen(true);
      return;
    }

    if (!window.confirm('Are you sure you want to publish this assessment? Once published, questions are immutable.')) {
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const { error: err } = await assessmentService.publishAssessment(assessment.id);
      if (err) throw err;
      await loadData();
    } catch (err: any) {
      console.error('Publish failed:', err);
      const formatted = extractErrorMessage(err, 'Failed to publish assessment.');
      setError(formatted);
      if (formatted.toLowerCase().includes('coordinator') || formatted.toLowerCase().includes('standalone')) {
        setActiveTab('COORDINATOR');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleClose = async () => {
    if (!assessment) return;
    if (!window.confirm('Are you sure you want to close this assessment? Students will no longer be able to start new attempts.')) {
      return;
    }

    setActionLoading(true);
    try {
      const { error: err } = await assessmentService.closeAssessment(assessment.id);
      if (err) throw err;
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to close assessment.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleArchive = async () => {
    if (!assessment) return;
    if (!window.confirm('Archive this assessment?')) return;

    setActionLoading(true);
    try {
      const { error: err } = await assessmentService.archiveAssessment(assessment.id);
      if (err) throw err;
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to archive assessment.');
    } finally {
      setActionLoading(false);
    }
  };

  // Question Modal Handlers
  const openNewQuestionModal = () => {
    setEditingQuestionId(null);
    setQuestionText('');
    setQuestionType('MCQ');
    setPoints(5);
    setOptions([
      { option_text: '', is_correct: true },
      { option_text: '', is_correct: false },
      { option_text: '', is_correct: false },
      { option_text: '', is_correct: false },
    ]);
    setCorrectBoolean(true);
    setExplanation('');
    setModalError(null);
    setIsQuestionModalOpen(true);
  };

  const openEditQuestionModal = (q: AssessmentQuestion) => {
    setEditingQuestionId(q.id);
    setQuestionText(q.question_text);
    setQuestionType(q.question_type);
    setPoints(q.points);
    if (q.question_type === 'MCQ' && q.options && q.options.length > 0) {
      setOptions(q.options.map((o) => ({ option_text: o.option_text, is_correct: Boolean(o.is_correct) })));
    } else {
      setOptions([
        { option_text: '', is_correct: true },
        { option_text: '', is_correct: false },
        { option_text: '', is_correct: false },
      ]);
    }
    setCorrectBoolean(q.correct_boolean ?? true);
    setExplanation(q.explanation || '');
    setModalError(null);
    setIsQuestionModalOpen(true);
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assessment) return;
    setModalError(null);

    if (!questionText.trim()) {
      setModalError('Question text cannot be empty or whitespace.');
      return;
    }

    if (points <= 0 || isNaN(points)) {
      setModalError('Points must be a positive number greater than 0.');
      return;
    }

    if (questionType === 'MCQ') {
      if (options.length < 3 || options.length > 5) {
        setModalError('MCQ questions must have between 3 and 5 options.');
        return;
      }

      for (let i = 0; i < options.length; i++) {
        if (!options[i].option_text.trim()) {
          setModalError(`Option ${i + 1} text cannot be blank.`);
          return;
        }
      }

      const correctCount = options.filter((o) => o.is_correct).length;
      if (correctCount !== 1) {
        setModalError('Please mark exactly one option as the correct answer.');
        return;
      }
    }

    setActionLoading(true);
    try {
      const { error: err } = await assessmentService.saveQuestionAndOptions({
        assessment_id: assessment.id,
        question_id: editingQuestionId,
        question_text: questionText.trim(),
        question_type: questionType,
        points: points,
        options: questionType === 'MCQ' ? options : undefined,
        correct_boolean: questionType === 'TRUE_FALSE' ? correctBoolean : undefined,
        explanation: explanation.trim() || undefined,
      });

      if (err) throw err;
      setIsQuestionModalOpen(false);
      await loadData();
    } catch (err: any) {
      console.error('Failed to save question:', err);
      setModalError(err.message || 'Failed to save question.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!window.confirm('Delete this question?')) return;
    setActionLoading(true);
    try {
      const { error: err } = await assessmentService.deleteQuestion(questionId);
      if (err) throw err;
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete question.');
    } finally {
      setActionLoading(false);
    }
  };

  const viewViolationsModal = async (att: any) => {
    setSelectedAttemptForViolations(att);
    setLoadingViolations(true);
    setViolationsList([]);
    try {
      const coordToken = getCoordinatorSessionToken();
      const { data, error: err } = await assessmentService.getScopedViolations(att.id, coordToken || undefined);
      if (err) throw err;
      setViolationsList(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingViolations(false);
    }
  };

  if (loading && !assessment) {
    return (
      <div className="py-24 text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-3 border-kits-red border-t-transparent mx-auto" />
        <p className="mt-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Loading assessment command center...
        </p>
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="max-w-4xl mx-auto py-16 px-4 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
        <h2 className="text-lg font-bold text-gray-900 mt-2">Assessment Not Found</h2>
        <Link to="/admin/assessments" className="mt-4 inline-flex items-center text-xs font-semibold text-kits-red">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Assessments
        </Link>
      </div>
    );
  }

  const isDraft = assessment.status === 'DRAFT';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Navigation & Status Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-gray-200/80 shadow-sm">
        <div className="flex items-start space-x-4">
          <Link
            to="/admin/assessments"
            className="p-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{assessment.title}</h1>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  assessment.status === 'PUBLISHED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : assessment.status === 'DRAFT'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : assessment.status === 'ARCHIVED'
                    ? 'bg-gray-100 text-gray-700 border border-gray-300'
                    : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}
              >
                {assessment.status}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-300">
                Rev {assessment.current_revision_number || 1}
              </span>
              {assessment.has_draft_revision && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1 animate-pulse" />
                  Draft Pending
                </span>
              )}
              {assessment.include_in_global_leaderboard && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                  <Trophy className="w-3 h-3 mr-1" />
                  Global Leaderboard
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1 max-w-2xl">{assessment.description || 'No description provided.'}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2 w-full md:w-auto justify-end flex-wrap gap-y-2">
          <Link
            to={`/admin/assessments/${assessment.id}/host`}
            className="inline-flex items-center px-3.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-semibold rounded-xl transition shadow-sm space-x-1.5"
            title="Launch Live Host Screen"
          >
            <Radio className="w-3.5 h-3.5 text-purple-600 animate-pulse" />
            <span>Live Host</span>
          </Link>

          {/* Post-Assessment Report & Analytics Action */}
          <button
            onClick={() => setActiveTab('REPORT')}
            className={`inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-xl transition shadow-sm space-x-1.5 cursor-pointer ${
              activeTab === 'REPORT'
                ? 'bg-blue-600 text-white'
                : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200'
            }`}
            title="View Post-Assessment Report & Analytics"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Report & Analytics</span>
          </button>

          {/* Edit Assessment Action (Revision Editor) */}
          <button
            onClick={() => setIsRevisionEditorOpen(true)}
            disabled={actionLoading}
            className="inline-flex items-center px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-xs font-semibold rounded-xl transition shadow-sm space-x-1.5 cursor-pointer disabled:opacity-50"
            title="Edit Assessment and Prepare Revision"
          >
            <Edit2 className="w-3.5 h-3.5 text-amber-600" />
            <span>Edit Assessment</span>
            {assessment.has_draft_revision && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Draft revision pending" />
            )}
          </button>

          {isDraft && (
            <>
              <button
                onClick={openEditSettingsModal}
                disabled={actionLoading}
                className="inline-flex items-center px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition shadow-sm space-x-1.5 disabled:opacity-50"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Edit Settings</span>
              </button>
              <button
                onClick={handlePublish}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition shadow-sm space-x-1.5 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Publish Assessment</span>
              </button>
            </>
          )}

          {assessment.status === 'PUBLISHED' && (
            <button
              onClick={handleClose}
              disabled={actionLoading}
              className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition shadow-sm space-x-1.5 disabled:opacity-50"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Close Assessment</span>
            </button>
          )}

          {assessment.status === 'CLOSED' && (
            <>
              <button
                onClick={() => {
                  setError(null);
                  setReopenSuccessNotice(null);
                  setIsReopenModalOpen(true);
                }}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition shadow-sm space-x-1.5 disabled:opacity-50 cursor-pointer"
                title="Reopen Assessment for Student Attempts"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reopen Assessment</span>
              </button>

              <button
                onClick={handleArchive}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-xs font-semibold rounded-xl transition shadow-sm space-x-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Archive</span>
              </button>
            </>
          )}

          <button
            onClick={() => setIsDeleteModalOpen(true)}
            disabled={actionLoading}
            className="inline-flex items-center px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-xl transition shadow-sm space-x-1.5"
            title="Delete Assessment"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {isDraft && !assessment.event_id && !assessment.sub_event_id && !coordinatorAssignment && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>
              <strong>Standalone Assessment Notice:</strong> Exactly one dedicated coordinator must be assigned before this assessment can be published.
            </span>
          </div>
          <button
            onClick={() => {
              setCoordError(null);
              setIsAssignCoordModalOpen(true);
            }}
            className="text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-xl transition flex items-center space-x-1"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Assign Coordinator</span>
          </button>
        </div>
      )}

      {reopenSuccessNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs font-semibold flex items-center justify-between shadow-2xs">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{reopenSuccessNotice}</span>
          </div>
          <button
            onClick={() => setReopenSuccessNotice(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-600" />
            <span className="font-medium">{error}</span>
          </div>
          <div className="flex items-center space-x-2 flex-shrink-0">
            {(error.toLowerCase().includes('coordinator') || !coordinatorAssignment) && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('COORDINATOR');
                  setIsAssignCoordModalOpen(true);
                }}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition shadow-xs cursor-pointer whitespace-nowrap"
              >
                Assign Coordinator
              </button>
            )}
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-red-700 hover:text-red-900 font-bold text-xs px-2 py-1 rounded-lg hover:bg-red-100 transition cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Schedule Summary Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-white p-4 rounded-2xl border border-gray-200/80 shadow-sm text-xs">
        <div>
          <span className="text-gray-400 font-medium">Duration:</span>
          <p className="font-bold text-gray-800 text-sm">{assessment.duration_minutes} Minutes</p>
        </div>
        <div>
          <span className="text-gray-400 font-medium">Window:</span>
          <p className="font-bold text-gray-800 text-sm">
            {new Date(assessment.start_time).toLocaleDateString()} — {new Date(assessment.end_time).toLocaleDateString()}
          </p>
        </div>
        <div>
          <span className="text-gray-400 font-medium">Passing Score:</span>
          <p className="font-bold text-gray-800 text-sm">{assessment.passing_percentage}%</p>
        </div>
        <div>
          <span className="text-gray-400 font-medium">Questions:</span>
          <p className="font-bold text-gray-800 text-sm">{questions?.length ?? 0} Registered</p>
        </div>
      </div>

      {/* Tabs Header */}
      <div className="flex border-b border-gray-200 space-x-4">
        <button
          onClick={() => setActiveTab('QUESTIONS')}
          className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 ${
            activeTab === 'QUESTIONS'
              ? 'border-kits-red text-kits-red'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          Questions ({questions?.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('PREVIEW')}
          className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 ${
            activeTab === 'PREVIEW'
              ? 'border-kits-red text-kits-red'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          Candidate Preview
        </button>
        <button
          onClick={() => setActiveTab('ATTEMPTS')}
          className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 ${
            activeTab === 'ATTEMPTS'
              ? 'border-kits-red text-kits-red'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          Attempts & Proctoring Audit
        </button>
        <button
          onClick={() => setActiveTab('LEADERBOARD')}
          className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 ${
            activeTab === 'LEADERBOARD'
              ? 'border-kits-red text-kits-red'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          Live Leaderboard
        </button>
        <button
          onClick={() => setActiveTab('QUESTION_BANK')}
          className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 ${
            activeTab === 'QUESTION_BANK'
              ? 'border-kits-red text-kits-red'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>Question Bank (Import / Export)</span>
        </button>
        <button
          onClick={() => setActiveTab('COORDINATOR')}
          className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 ${
            activeTab === 'COORDINATOR'
              ? 'border-kits-red text-kits-red'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>Coordinator & Live Host</span>
        </button>
        <button
          onClick={() => setActiveTab('REPORT')}
          className={`pb-3 text-xs font-bold uppercase tracking-wider transition border-b-2 flex items-center space-x-1.5 ${
            activeTab === 'REPORT'
              ? 'border-kits-red text-kits-red'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5 text-blue-600" />
          <span>Report & Analytics</span>
        </button>
      </div>

      {/* Tab 1: Questions Authoring */}
      {activeTab === 'QUESTIONS' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <h2 className="text-lg font-bold text-gray-900">Examination Questions</h2>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition shadow-2xs space-x-1.5 cursor-pointer"
                title="Download Canonical Question Bank Template (CSV)"
              >
                <Download className="w-3.5 h-3.5 text-gray-600" />
                <span>Template</span>
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={(questions?.length ?? 0) === 0}
                className="inline-flex items-center px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition shadow-2xs space-x-1.5 disabled:opacity-50 cursor-pointer"
                title="Export Current Question Bank with Answer Keys (CSV)"
              >
                <FileText className="w-3.5 h-3.5 text-gray-600" />
                <span>Export ({questions?.length ?? 0})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('QUESTION_BANK')}
                className="inline-flex items-center px-3 py-2 bg-kits-blue hover:bg-kits-blue/90 text-white text-xs font-bold rounded-xl transition shadow-2xs space-x-1.5 cursor-pointer"
                title="Import Question Bank from CSV"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import Bank</span>
              </button>
              {isDraft && (
                <button
                  onClick={openNewQuestionModal}
                  className="inline-flex items-center px-4 py-2 bg-kits-red text-white text-xs font-bold rounded-xl hover:bg-kits-red/90 transition shadow-sm space-x-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Question</span>
                </button>
              )}
            </div>
          </div>

          {!isDraft && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <Lock className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span>
                  Assessment is currently in <strong>{assessment.status}</strong> status (Revision {assessment.current_revision_number || 1}).
                  Direct question modifying is locked to preserve examination attempt integrity. Use <strong>Edit Assessment</strong> to draft and republish revisions safely without corrupting student records.
                </span>
              </div>
              <button
                onClick={() => setIsRevisionEditorOpen(true)}
                className="self-end sm:self-auto inline-flex items-center px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition flex-shrink-0 cursor-pointer space-x-1"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Edit Assessment</span>
              </button>
            </div>
          )}

          {(questions?.length ?? 0) === 0 ? (
            <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center">
              <Layers className="w-10 h-10 text-gray-300 mx-auto" />
              <h3 className="text-sm font-bold text-gray-800 mt-2">No Questions Created Yet</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Author MCQ or True/False questions. Ensure each question has a positive point value and accurate answer key.
              </p>
              {isDraft && (
                <button
                  onClick={openNewQuestionModal}
                  className="mt-4 inline-flex items-center px-4 py-2 bg-kits-red text-white text-xs font-semibold rounded-xl hover:bg-kits-red/90 transition"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add First Question
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {questions.map((q, idx) => (
                <div
                  key={q.id}
                  className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-sm space-y-3"
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex items-center space-x-2">
                      <span className="w-7 h-7 rounded-lg bg-gray-100 font-bold text-xs text-gray-700 flex items-center justify-center">
                        Q{idx + 1}
                      </span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {q.question_type}
                      </span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {q.points} Points
                      </span>
                    </div>

                    {isDraft && (
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => openEditQuestionModal(q)}
                          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
                          title="Edit Question"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteQuestion(q.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Delete Question"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-sm font-semibold text-gray-900 whitespace-pre-wrap">{q.question_text}</p>

                  {/* Options Display */}
                  {q.question_type === 'MCQ' && q.options && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
                      {q.options.map((opt, oIdx) => (
                        <div
                          key={opt.id || oIdx}
                          className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${
                            opt.is_correct
                              ? 'bg-emerald-50/60 border-emerald-300 text-emerald-900 font-semibold'
                              : 'bg-gray-50 border-gray-200 text-gray-700'
                          }`}
                        >
                          <span className="truncate pr-2">
                            {String.fromCharCode(65 + oIdx)}. {opt.option_text}
                          </span>
                          {opt.is_correct && (
                            <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white">
                              Correct Key
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* True/False Display */}
                  {q.question_type === 'TRUE_FALSE' && (
                    <div className="flex items-center space-x-3 pt-2">
                      <span
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                          q.correct_boolean === true
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        TRUE {q.correct_boolean === true && '✓ (Correct)'}
                      </span>
                      <span
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                          q.correct_boolean === false
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        FALSE {q.correct_boolean === false && '✓ (Correct)'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Candidate Preview */}
      {activeTab === 'PREVIEW' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-sm space-y-6">
          <div className="border-b border-gray-100 pb-4 flex justify-between items-center">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-kits-red">Candidate Examination View</span>
              <h3 className="text-lg font-bold text-gray-900">{assessment.title}</h3>
            </div>
            <div className="flex items-center space-x-2 text-xs text-gray-500 bg-gray-100 px-3 py-1.5 rounded-xl">
              <Clock className="w-3.5 h-3.5" />
              <span>Simulated Timer: {assessment.duration_minutes}:00</span>
            </div>
          </div>

          <div className="space-y-6">
            {questions.map((q, idx) => (
              <div key={q.id} className="p-4 bg-gray-50/70 rounded-xl border border-gray-200 space-y-3">
                <div className="flex justify-between items-center text-xs text-gray-400">
                  <span className="font-bold text-gray-700">Question {idx + 1} of {questions?.length ?? 0}</span>
                  <span>{q.points} Points</span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{q.question_text}</p>

                {q.question_type === 'MCQ' && (
                  <div className="space-y-2">
                    {q.options?.map((opt, oIdx) => (
                      <label
                        key={opt.id || oIdx}
                        className="flex items-center space-x-3 p-3 bg-white rounded-xl border border-gray-200 hover:border-kits-red/50 cursor-pointer text-xs"
                      >
                        <input type="radio" name={`preview-q-${q.id}`} className="text-kits-red focus:ring-kits-red/20" />
                        <span>{opt.option_text}</span>
                      </label>
                    ))}
                  </div>
                )}

                {q.question_type === 'TRUE_FALSE' && (
                  <div className="flex space-x-3">
                    <label className="flex-1 p-3 bg-white rounded-xl border border-gray-200 hover:border-kits-red/50 cursor-pointer text-center text-xs font-bold">
                      <input type="radio" name={`preview-q-${q.id}`} className="mr-2 text-kits-red focus:ring-kits-red/20" />
                      TRUE
                    </label>
                    <label className="flex-1 p-3 bg-white rounded-xl border border-gray-200 hover:border-kits-red/50 cursor-pointer text-center text-xs font-bold">
                      <input type="radio" name={`preview-q-${q.id}`} className="mr-2 text-kits-red focus:ring-kits-red/20" />
                      FALSE
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Attempts & Proctoring Audit */}
      {activeTab === 'ATTEMPTS' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6 space-y-5">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <div className="flex items-center space-x-2.5">
                <h2 className="text-lg font-black text-[#003366] tracking-tight">
                  Student Examination Attempts
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-[#003366] border border-blue-200 font-mono">
                  {attempts?.length ?? 0} Total
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Manage candidate submissions, proctoring telemetry, individual and bulk attempt deletions.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={refreshAttempts}
                className="p-2 text-gray-500 hover:text-[#003366] hover:bg-gray-100 rounded-xl transition border border-gray-200 shadow-sm"
                title="Refresh Telemetry & Attempts"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Success Feedback Alert */}
          {attemptActionSuccess && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs flex items-center justify-between shadow-sm animate-in fade-in duration-150">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span className="font-medium">{attemptActionSuccess}</span>
              </div>
              <button
                onClick={() => setAttemptActionSuccess(null)}
                className="font-bold underline text-emerald-700 hover:text-emerald-900 ml-4"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Search, Filter, and Bulk Action Ribbon */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-1">
            <div className="flex items-center space-x-3 flex-1 flex-wrap sm:flex-nowrap">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by student name, roll number, or college..."
                  value={attemptSearchQuery}
                  onChange={(e) => setAttemptSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
                />
              </div>

              {/* Status Filter */}
              <div className="relative w-auto min-w-[140px]">
                <select
                  value={attemptStatusFilter}
                  onChange={(e) => setAttemptStatusFilter(e.target.value as any)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="SUBMITTED">Submitted</option>
                  <option value="TERMINATED">Terminated</option>
                  <option value="EXPIRED">Expired</option>
                </select>
              </div>
            </div>

            {/* Bulk Action Controls */}
            {selectedAttemptIds.length > 0 && (
              <div className="flex items-center space-x-2.5 bg-red-50/70 border border-red-200/80 px-3.5 py-1.5 rounded-2xl animate-in fade-in duration-100">
                <span className="text-xs font-bold text-[#C8102E]">
                  {selectedAttemptIds.length} Selected
                </span>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedAttemptIds([])}
                  className="text-xs font-semibold text-gray-600 hover:text-gray-900 transition"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleOpenBulkDelete}
                  className="inline-flex items-center px-3 py-1 bg-[#C8102E] hover:bg-[#a50d26] text-white text-xs font-bold rounded-xl transition shadow-sm space-x-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Selected</span>
                </button>
              </div>
            )}
          </div>

          {/* Table */}
          {(filteredAttempts?.length ?? 0) === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400 bg-gray-50/50 rounded-2xl border border-gray-100">
              {(attempts?.length ?? 0) === 0
                ? 'No student attempts recorded for this examination yet.'
                : 'No attempts match the current search or filter criteria.'}
            </div>
          ) : (
            <div className="overflow-x-auto border border-gray-200/80 rounded-2xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50/90 border-b border-gray-200 text-gray-600 font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5 w-10 text-center">
                      <button
                        type="button"
                        onClick={toggleSelectAllVisible}
                        className="p-1 text-gray-400 hover:text-[#003366] transition inline-flex items-center justify-center"
                        title={
                          filteredAttempts.every((a) => selectedAttemptIds.includes(a.id))
                            ? 'Deselect all visible'
                            : 'Select all visible'
                        }
                      >
                        {(filteredAttempts?.length ?? 0) > 0 &&
                        filteredAttempts.every((a) => selectedAttemptIds.includes(a.id)) ? (
                          <CheckSquare className="w-4 h-4 text-[#003366]" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-4">Student Candidate</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Score</th>
                    <th className="py-3 px-3">Timing</th>
                    <th className="py-3 px-3">Strikes</th>
                    <th className="py-3 px-3">Remediation Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700 bg-white">
                  {filteredAttempts.map((att) => {
                    const isSelected = selectedAttemptIds.includes(att.id);

                    return (
                      <tr
                        key={att.id}
                        className={`hover:bg-gray-50/70 transition ${isSelected ? 'bg-red-50/30' : ''}`}
                      >
                        {/* Checkbox */}
                        <td className="py-3 px-3.5 text-center">
                          <button
                            type="button"
                            onClick={() => toggleSelectAttempt(att.id)}
                            className="p-1 text-gray-400 hover:text-[#003366] transition inline-flex items-center justify-center"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-[#C8102E]" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-300" />
                            )}
                          </button>
                        </td>

                        {/* Student Details */}
                        <td className="py-3 px-4">
                          <div className="font-bold text-gray-900">
                            {att.student_name || att.students?.full_name || att.users?.email || 'Anonymous Student'}
                          </div>
                          <div className="flex items-center space-x-2 text-[10px] text-gray-500 font-mono mt-0.5">
                            <span>{att.roll_number || att.students?.roll_number || 'N/A'}</span>
                            {att.college_name && (
                              <>
                                <span>•</span>
                                <span className="truncate max-w-[150px] font-sans">{att.college_name}</span>
                              </>
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              att.status === 'SUBMITTED'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : att.status === 'TERMINATED'
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : att.status === 'EXPIRED'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}
                          >
                            {att.status}
                          </span>
                        </td>

                        {/* Score */}
                        <td className="py-3 px-3">
                          <span className="font-bold font-mono text-gray-900">{att.score ?? 0}</span>
                          <span className="text-[10px] text-gray-400 ml-1">pts</span>
                        </td>

                        {/* Timing */}
                        <td className="py-3 px-3 text-[11px] text-gray-500">
                          <div>{att.started_at ? new Date(att.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                          {att.submitted_at && (
                            <div className="text-[10px] text-gray-400">
                              End: {new Date(att.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </td>

                        {/* Strikes */}
                        <td className="py-3 px-3">
                          <span
                            className={`font-mono font-bold text-xs ${
                              att.strike_count >= 3
                                ? 'text-red-600'
                                : att.strike_count > 0
                                ? 'text-amber-600'
                                : 'text-gray-400'
                            }`}
                          >
                            {att.strike_count || 0}/3
                          </span>
                        </td>

                        {/* Remediation Status */}
                        <td className="py-3 px-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Eligible for deletion
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => viewViolationsModal(att)}
                              className="inline-flex items-center px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-medium transition"
                              title="Audit proctoring violations"
                            >
                              <ShieldAlert className="w-3 h-3 mr-1 text-gray-500" />
                              Audit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenSingleDelete(att.id)}
                              className="p-1.5 text-gray-400 hover:text-[#C8102E] hover:bg-red-50 rounded-lg transition"
                              title="Delete attempt record"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Live Leaderboard */}
      {activeTab === 'LEADERBOARD' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Official Assessment Standings</h2>
              <p className="text-xs text-gray-500">Ranked by score, cumulative completion time, and accuracy.</p>
            </div>
            <button
              onClick={() => assessmentService.getAssessmentLeaderboard(assessment.id).then((r) => setLeaderboard(r.data || []))}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
              title="Refresh Leaderboard"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {(leaderboard?.length ?? 0) === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400">
              No finalized submissions yet to display on the leaderboard.
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
                  <span className="text-sm font-bold text-gray-900">{entry.score} pts</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Question Bank (Import / Export) */}
      {activeTab === 'QUESTION_BANK' && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="p-6 bg-white rounded-2xl border border-gray-200/90 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <FileSpreadsheet className="w-5 h-5 text-kits-blue" />
                <h2 className="text-lg font-bold text-gray-900">Question Bank Management</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                  {questions?.length ?? 0} Active Questions
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Admin-only question bank importing and exporting. Append questions safely from standard spreadsheet CSV files without data loss.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold rounded-xl transition shadow-2xs space-x-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4 text-gray-600" />
                <span>Download Template</span>
              </button>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={(questions?.length ?? 0) === 0}
                className="inline-flex items-center px-4 py-2 bg-kits-blue hover:bg-kits-blue/90 text-white text-xs font-bold rounded-xl transition shadow-2xs space-x-1.5 disabled:opacity-50 cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>Export Questions (CSV)</span>
              </button>
            </div>
          </div>

          {/* Feedback Messages */}
          {importSuccessMessage && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center space-x-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                <span className="font-medium">{importSuccessMessage}</span>
              </div>
              {importTargetRevisionId && (
                <button
                  type="button"
                  onClick={() => setIsRevisionEditorOpen(true)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition flex-shrink-0 cursor-pointer"
                >
                  Review Revision & Publish
                </button>
              )}
            </div>
          )}

          {importErrorMessage && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-xs flex items-center space-x-2.5 shadow-2xs">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <span className="font-medium">{importErrorMessage}</span>
            </div>
          )}

          {/* 3 Main Action Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Card 1: Download Template */}
            <div className="p-6 bg-white rounded-2xl border border-gray-200/90 shadow-sm flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-kits-blue flex items-center justify-center font-bold">
                  <Download className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">1. Question Bank Template</h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Download the official CSV template with canonical headers, sample MCQ & True/False questions, and code snippet formatting.
                </p>
                <div className="pt-2">
                  <span className="text-[11px] font-mono font-semibold text-gray-400 block">
                    Columns: sort_order, question_type, question_text, option_1..5, correct_answer, marks, time_limit_seconds, explanation
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl transition cursor-pointer space-x-1.5"
              >
                <Download className="w-4 h-4" />
                <span>Download Canonical CSV Template</span>
              </button>
            </div>

            {/* Card 2: Export Current Assessment Questions */}
            <div className="p-6 bg-white rounded-2xl border border-gray-200/90 shadow-sm flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
                  <FileText className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">2. Export Questions (CSV)</h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Export all active examination questions with correct answers, option keys, and points. Intended for administrative backup, cross-assessment question reuse, or offline curriculum auditing.
                </p>
                <div className="p-3 bg-purple-50/60 rounded-xl border border-purple-100 text-[11px] text-purple-800 space-y-1">
                  <div className="flex justify-between">
                    <span>Questions Available:</span>
                    <strong className="font-mono">{questions?.length ?? 0}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Marks:</span>
                    <strong className="font-mono">{totalQuestionsPoints} pts</strong>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={(questions?.length ?? 0) === 0}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-kits-blue hover:bg-kits-blue/90 text-white text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50 space-x-1.5"
              >
                <Download className="w-4 h-4" />
                <span>Export Assessment Questions (CSV)</span>
              </button>
            </div>

            {/* Card 3: Safe Revision Notice / Import Workflow Status */}
            <div className="p-6 bg-white rounded-2xl border border-gray-200/90 shadow-sm flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">Safe Revision Assurance</h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Importing questions <strong>always appends</strong> to the question bank and <strong>never silently overwrites</strong> existing questions.
                </p>
                <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-100 text-[11px] text-amber-800 space-y-1">
                  {assessment?.status === 'PUBLISHED' ? (
                    <div>
                      <strong>Published Protection Active:</strong> Questions will be appended to Draft Revision #{ (assessment.current_revision_number || 1) + 1 }. Active candidate attempts remain on the published version until you publish.
                    </div>
                  ) : (
                    <div>
                      <strong>Draft Assessment:</strong> Questions will be appended directly to the assessment question bank and are immediately editable in the editor.
                    </div>
                  )}
                </div>
              </div>
              <div className="text-[11px] text-gray-400 italic">
                Formula injection protected (OWASP). Telugu Unicode preserved.
              </div>
            </div>
          </div>

          {/* Section: Import Question Bank (CSV) Studio */}
          <div className="p-6 bg-white rounded-2xl border border-gray-200/90 shadow-sm space-y-6">
            <div className="border-b border-gray-100 pb-4">
              <h3 className="text-base font-bold text-gray-900 flex items-center space-x-2">
                <Upload className="w-5 h-5 text-kits-red" />
                <span>Import Question Bank (CSV)</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Upload a CSV file containing questions. Valid questions will be validated, mapped, and appended in order.
              </p>
            </div>

            {/* Inline Error & Success Alerts in Studio for Mobile Visibility */}
            {importErrorMessage && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-xs flex items-center space-x-2.5 shadow-2xs">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                <span className="font-medium">{importErrorMessage}</span>
              </div>
            )}

            {importSuccessMessage && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center space-x-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                  <span className="font-medium">{importSuccessMessage}</span>
                </div>
                {importTargetRevisionId && (
                  <button
                    type="button"
                    onClick={() => setIsRevisionEditorOpen(true)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition flex-shrink-0 cursor-pointer"
                  >
                    Review Revision & Publish
                  </button>
                )}
              </div>
            )}

            {/* Step A: Upload File */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                  Select Question Bank CSV File
                </label>
                <div className="relative border-2 border-dashed border-gray-200 hover:border-kits-blue rounded-2xl p-6 text-center transition bg-gray-50/50 overflow-hidden">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv,text/plain,application/vnd.ms-excel,text/comma-separated-values,application/csv,*/*"
                    onChange={handleFileSelect}
                    id="question-bank-file-input"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    title="Click or tap to select CSV file"
                  />
                  <div className="space-y-2 pointer-events-none">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-kits-blue flex items-center justify-center mx-auto">
                      {importReading ? (
                        <div className="w-6 h-6 border-2 border-kits-blue border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Upload className="w-6 h-6" />
                      )}
                    </div>
                    <div className="text-xs font-bold text-gray-800">
                      {importReading
                        ? 'Reading and validating questions from device...'
                        : importFile
                        ? importFile.name
                        : 'Click or tap to select CSV file from your device'}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      Supports Microsoft Excel CSV, UTF-8 with BOM, max 5MB
                    </div>
                  </div>
                  {importFile && !importReading && (
                    <div className="mt-3 relative z-20">
                      <button
                        type="button"
                        onClick={handleCancelImportFile}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 transition border border-red-200 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cancel / Select Another File</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Step B: Configurable Default Marks */}
              <div className="space-y-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                  Configurable Default Marks
                </label>
                <p className="text-[11px] text-gray-500">
                  Applied to any question row where the <code className="bg-gray-200 px-1 py-0.5 rounded text-[10px]">marks</code> cell is left empty in the CSV. Explicit marks in the CSV are always preserved.
                </p>
                <div className="flex items-center space-x-2 pt-2">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={importDefaultMarks}
                    onChange={(e) => handleDefaultMarksChange(Number(e.target.value))}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-xl text-sm font-bold font-mono focus:ring-2 focus:ring-kits-blue focus:outline-none"
                  />
                  <span className="text-xs font-bold text-gray-600">Points per question</span>
                </div>
                {importParseResult && (
                  <div className="text-[11px] text-gray-600 font-medium pt-1">
                    Rows using default marks: <strong className="font-mono text-kits-blue">{importParseResult.summary.defaultMarksAppliedCount}</strong>
                  </div>
                )}
              </div>
            </div>

            {/* Validation Feedback & Preview */}
            {importParseResult && (
              <div className="space-y-4 pt-2">
                {/* Summary Banner */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-center">
                    <span className="text-[10px] font-bold uppercase text-gray-400">Total Rows</span>
                    <div className="text-xl font-bold font-mono text-gray-900 mt-0.5">
                      {importParseResult.totalRows}
                    </div>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-center">
                    <span className="text-[10px] font-bold uppercase text-emerald-600">Valid Questions</span>
                    <div className="text-xl font-bold font-mono text-emerald-700 mt-0.5">
                      {importParseResult.validQuestions.length}
                    </div>
                  </div>
                  <div className="p-3 bg-red-50 rounded-xl border border-red-100 text-center">
                    <span className="text-[10px] font-bold uppercase text-red-600">Invalid Rows</span>
                    <div className="text-xl font-bold font-mono text-red-700 mt-0.5">
                      {importParseResult.errors.length}
                    </div>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-center">
                    <span className="text-[10px] font-bold uppercase text-blue-600">Default Marks Used</span>
                    <div className="text-xl font-bold font-mono text-blue-700 mt-0.5">
                      {importParseResult.summary.defaultMarksAppliedCount}
                    </div>
                  </div>
                </div>

                {/* Errors Table if any */}
                {importParseResult.errors.length > 0 && (
                  <div className="p-4 bg-red-50/70 rounded-2xl border border-red-200 space-y-2">
                    <div className="flex items-center space-x-2 text-xs font-bold text-red-800">
                      <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                      <span>{importParseResult.errors.length} Actionable Row Error(s) Detected</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-red-100/60 text-red-900 text-[10px] font-bold uppercase">
                          <tr>
                            <th className="py-2 px-3">CSV Row #</th>
                            <th className="py-2 px-3">Question Snippet</th>
                            <th className="py-2 px-3">Field</th>
                            <th className="py-2 px-3">Issue Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-red-100 text-red-950 font-medium">
                          {importParseResult.errors.map((err, idx) => (
                            <tr key={idx} className="hover:bg-red-100/40">
                              <td className="py-2 px-3 font-mono font-bold">{err.rowNumber > 0 ? `Row ${err.rowNumber}` : 'Header'}</td>
                              <td className="py-2 px-3 font-mono text-[11px] truncate max-w-xs">{err.questionTextSnippet || '—'}</td>
                              <td className="py-2 px-3 font-mono text-[11px] font-bold">{err.field || 'general'}</td>
                              <td className="py-2 px-3">{err.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-red-700">
                      You can fix the indicated rows in your spreadsheet and upload again, or commit the valid questions below.
                    </p>
                  </div>
                )}

                {/* Valid Questions Preview */}
                {importParseResult.validQuestions.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                        Preview Questions to Append ({importParseResult.validQuestions.length})
                      </h4>
                      <span className="text-[11px] text-gray-400">Showing first 5 questions</span>
                    </div>

                    <div className="space-y-2">
                      {importParseResult.validQuestions.slice(0, 5).map((q, idx) => (
                        <div key={idx} className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <span className="px-2 py-0.5 rounded-md font-bold bg-gray-200 text-gray-800 text-[10px]">
                                #{idx + 1}
                              </span>
                              <span className="px-2 py-0.5 rounded-md font-bold bg-blue-100 text-blue-800 text-[10px]">
                                {q.question_type}
                              </span>
                              <span className="font-bold text-emerald-700 text-[10px]">
                                {q.points} pts {q.marks_was_defaulted && '(default applied)'}
                              </span>
                              <span className="text-gray-400 text-[10px]">
                                {q.time_limit_seconds}s limit
                              </span>
                            </div>
                          </div>
                          <div className="font-semibold text-gray-900">{q.question_text}</div>
                          {q.question_type === 'MCQ' && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-gray-600 pt-1">
                              {q.options.map((opt, oIdx) => (
                                <div
                                  key={oIdx}
                                  className={`px-2 py-1 rounded-lg border ${
                                    opt.is_correct
                                      ? 'bg-emerald-50 border-emerald-200 font-bold text-emerald-900'
                                      : 'bg-white border-gray-100'
                                  }`}
                                >
                                  {String.fromCharCode(65 + oIdx)}. {opt.option_text} {opt.is_correct && '✓ (Correct)'}
                                </div>
                              ))}
                            </div>
                          )}
                          {q.question_type === 'TRUE_FALSE' && (
                            <div className="text-[11px] text-emerald-800 font-bold">
                              Correct Answer: {q.correct_boolean ? 'True' : 'False'}
                            </div>
                          )}
                          {q.explanation && (
                            <div className="text-[11px] text-gray-600 bg-amber-50/60 p-2 rounded-lg border border-amber-200/60 space-x-1">
                              <span className="font-bold text-amber-900">Explanation:</span>{' '}
                              <span className="text-gray-700">{q.explanation}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Step C: Commit Button */}
                    <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                      <div className="text-xs text-gray-500">
                        {assessment?.status === 'PUBLISHED'
                          ? `Will append to Draft Revision #${(assessment.current_revision_number || 1) + 1}. Live exams continue uninterrupted.`
                          : 'Will append to draft assessment question bank. Order preserved.'}
                      </div>
                      <button
                        type="button"
                        onClick={handleCommitImport}
                        disabled={importLoading || importParseResult.validQuestions.length === 0}
                        className="inline-flex items-center px-6 py-2.5 bg-kits-red hover:bg-kits-red/90 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50 space-x-2 cursor-pointer"
                      >
                        {importLoading ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        <span>Confirm & Append {importParseResult.validQuestions.length} Questions</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 6: Dedicated Assessment Coordinator & Live Host */}
      {activeTab === 'COORDINATOR' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-gray-200/80 shadow-sm">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
                <UserCheck className="w-5 h-5 text-kits-blue" />
                <span>Dedicated Assessment Coordinator</span>
              </h2>
              <p className="text-xs text-gray-500 mt-1 max-w-xl">
                Standalone assessments require exactly one assigned coordinator before publication. The coordinator receives dedicated login credentials to launch and monitor the live examination telemetry.
              </p>
            </div>

            <div className="flex items-center space-x-2 flex-wrap gap-y-2">
              <Link
                to={`/admin/assessments/${assessment.id}/host`}
                className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition shadow-sm space-x-1.5"
              >
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                <span>Launch Host Console</span>
              </Link>
              <button
                onClick={() => {
                  setCoordError(null);
                  if (coordinatorAssignment?.coordinators) {
                    setCoordName(coordinatorAssignment.coordinators.display_name || '');
                    setCoordUsername(coordinatorAssignment.coordinators.username || '');
                    setCoordPhone(coordinatorAssignment.coordinators.phone_number || '');
                  }
                  setIsAssignCoordModalOpen(true);
                }}
                className="inline-flex items-center px-4 py-2 bg-kits-blue text-white text-xs font-bold rounded-xl hover:bg-kits-blue/90 transition shadow-sm space-x-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{coordinatorAssignment ? 'Reassign Coordinator' : 'Assign Coordinator'}</span>
              </button>
            </div>
          </div>

          {coordinatorAssignment?.coordinators ? (
            <div className="bg-white p-6 rounded-2xl border border-gray-200/80 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-blue-50 text-kits-blue rounded-2xl flex items-center justify-center font-bold text-base">
                    {coordinatorAssignment.coordinators.display_name?.charAt(0) || 'C'}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-900">
                      {coordinatorAssignment.coordinators.display_name}
                    </h3>
                    <p className="text-xs text-gray-500 font-mono">
                      Username: @{coordinatorAssignment.coordinators.username}
                    </p>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {coordinatorAssignment.coordinators.status}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="text-gray-400 font-medium">Assigned Role:</span>
                  <p className="font-bold text-gray-800 mt-0.5">Assessment Coordinator</p>
                </div>
                <div>
                  <span className="text-gray-400 font-medium">Contact Phone:</span>
                  <p className="font-bold text-gray-800 mt-0.5">
                    {coordinatorAssignment.coordinators.phone_number || 'Not provided'}
                  </p>
                </div>
                <div>
                  <span className="text-gray-400 font-medium">Assigned Timestamp:</span>
                  <p className="font-bold text-gray-800 mt-0.5">
                    {new Date(coordinatorAssignment.assigned_at).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 p-8 rounded-2xl text-center space-y-3">
              <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
              <h3 className="text-sm font-bold text-amber-900">No Coordinator Assigned Yet</h3>
              <p className="text-xs text-amber-800 max-w-md mx-auto">
                {!assessment.event_id && !assessment.sub_event_id
                  ? 'This is a standalone assessment. You must assign exactly one dedicated coordinator before publishing this assessment.'
                  : 'This assessment is linked to an event/sub-event and currently uses the event coordinator permissions.'}
              </p>
              <button
                onClick={() => {
                  setCoordError(null);
                  setIsAssignCoordModalOpen(true);
                }}
                className="mt-2 inline-flex items-center px-4 py-2 bg-kits-blue text-white text-xs font-bold rounded-xl hover:bg-kits-blue/90 transition shadow-sm space-x-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Assign Dedicated Coordinator</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab: Post-Assessment Report & Analytics */}
      {activeTab === 'REPORT' && (
        <AssessmentReportView
          assessmentId={assessment.id}
          onBackToAssessment={() => setActiveTab('QUESTIONS')}
        />
      )}

      {/* Question Modal (Add / Edit) */}
      {isQuestionModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900">
              {editingQuestionId ? 'Edit Question' : 'Add New Question'}
            </h3>

            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveQuestion} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                  Question Text <span className="text-kits-red">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Enter the question prompt..."
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Question Type</label>
                  <select
                    value={questionType}
                    onChange={(e) => setQuestionType(e.target.value as QuestionType)}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none"
                  >
                    <option value="MCQ">Multiple Choice (MCQ)</option>
                    <option value="TRUE_FALSE">True / False</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Points Allocated</label>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    required
                    value={points}
                    onChange={(e) => setPoints(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              {/* MCQ Options */}
              {questionType === 'MCQ' && (
                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-700 uppercase">
                      Options (3–5 required, select 1 correct)
                    </label>
                    {options.length < 5 && (
                      <button
                        type="button"
                        onClick={() => setOptions([...options, { option_text: '', is_correct: false }])}
                        className="text-xs font-semibold text-kits-red hover:underline"
                      >
                        + Add Option
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    {options.map((opt, oIdx) => (
                      <div key={oIdx} className="flex items-center space-x-2">
                        <input
                          type="radio"
                          name="correct-option-choice"
                          checked={opt.is_correct}
                          onChange={() => {
                            const updated = options.map((o, idx) => ({ ...o, is_correct: idx === oIdx }));
                            setOptions(updated);
                          }}
                          className="h-4 w-4 text-emerald-600 focus:ring-emerald-500"
                          title="Mark as correct answer key"
                        />
                        <span className="text-xs font-bold text-gray-400 w-4">{String.fromCharCode(65 + oIdx)}.</span>
                        <input
                          type="text"
                          required
                          placeholder={`Option ${oIdx + 1} text...`}
                          value={opt.option_text}
                          onChange={(e) => {
                            const updated = [...options];
                            updated[oIdx].option_text = e.target.value;
                            setOptions(updated);
                          }}
                          className="flex-1 px-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none"
                        />
                        {options.length > 3 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = options.filter((_, idx) => idx !== oIdx);
                              if (opt.is_correct && updated.length > 0) updated[0].is_correct = true;
                              setOptions(updated);
                            }}
                            className="p-1 text-gray-400 hover:text-red-500"
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

              {/* True / False Options */}
              {questionType === 'TRUE_FALSE' && (
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <label className="text-xs font-bold text-gray-700 uppercase">Correct Answer</label>
                  <div className="flex space-x-4">
                    <label className="flex items-center space-x-2 cursor-pointer text-xs font-bold">
                      <input
                        type="radio"
                        name="tf-correct-boolean"
                        checked={correctBoolean === true}
                        onChange={() => setCorrectBoolean(true)}
                        className="text-emerald-600"
                      />
                      <span>TRUE</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer text-xs font-bold">
                      <input
                        type="radio"
                        name="tf-correct-boolean"
                        checked={correctBoolean === false}
                        onChange={() => setCorrectBoolean(false)}
                        className="text-emerald-600"
                      />
                      <span>FALSE</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Optional Explanation Field */}
              <div className="space-y-1.5 pt-2 border-t border-gray-100">
                <label className="text-xs font-bold text-gray-700 uppercase flex items-center justify-between">
                  <span>Explanation (Optional)</span>
                  <span className="text-[10px] text-gray-400 font-normal lowercase">shown during answer review</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Provide an explanation for the solution, derivation, or helpful context (supports multiline text)..."
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none resize-y"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsQuestionModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 bg-kits-red text-white text-xs font-semibold rounded-xl hover:bg-kits-red/90 disabled:opacity-50"
                >
                  {actionLoading ? 'Saving...' : 'Save Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Assessment Settings Modal */}
      {isEditSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="text-base font-bold text-gray-900">Edit Assessment Settings</h3>
              <button
                onClick={() => setIsEditSettingsOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                ✕
              </button>
            </div>

            {editSettingsError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{editSettingsError}</span>
              </div>
            )}

            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                  Title <span className="text-kits-red">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Description</label>
                <textarea
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Instructions</label>
                <textarea
                  rows={3}
                  value={editInstructions}
                  onChange={(e) => setEditInstructions(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none transition"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                    Duration (Minutes) <span className="text-kits-red">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={editDurationMinutes}
                    onChange={(e) => setEditDurationMinutes(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                    Passing Percentage (%) <span className="text-kits-red">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    required
                    value={editPassingPercentage}
                    onChange={(e) => setEditPassingPercentage(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                    Start Window <span className="text-kits-red">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                    Closing Deadline <span className="text-kits-red">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={editEndTime}
                    onChange={(e) => setEditEndTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              {/* Event / Sub-Event Affiliation */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Linked Main Event</label>
                  <select
                    value={editEventId}
                    onChange={(e) => {
                      setEditEventId(e.target.value);
                      setEditSubEventId('');
                    }}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none"
                  >
                    <option value="">Standalone (No Event Link)</option>
                    {eventsList.map((evt) => (
                      <option key={evt.id} value={evt.id}>
                        {evt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Linked Sub-Event / Round</label>
                  <select
                    value={editSubEventId}
                    onChange={(e) => setEditSubEventId(e.target.value)}
                    disabled={!editEventId}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none disabled:opacity-50"
                  >
                    <option value="">No specific sub-event</option>
                    {subEventsList
                      .filter((se) => se.event_id === editEventId)
                      .map((se) => (
                        <option key={se.id} value={se.id}>
                          {se.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Shuffling & Global Leaderboard Toggles */}
              <div className="space-y-3 pt-2 border-t border-gray-100">
                <label className="flex items-center space-x-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editRandomizeQuestions}
                    onChange={(e) => setEditRandomizeQuestions(e.target.checked)}
                    className="rounded text-kits-red focus:ring-kits-red/20"
                  />
                  <span>Randomize Question Order for candidates</span>
                </label>
                <label className="flex items-center space-x-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editRandomizeOptions}
                    onChange={(e) => setEditRandomizeOptions(e.target.checked)}
                    className="rounded text-kits-red focus:ring-kits-red/20"
                  />
                  <span>Randomize Option Choices (MCQ)</span>
                </label>
                <label className="flex items-center space-x-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIncludeGlobal}
                    onChange={(e) => setEditIncludeGlobal(e.target.checked)}
                    className="rounded text-kits-red focus:ring-kits-red/20"
                  />
                  <span>Include in Global Campus Leaderboard</span>
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsEditSettingsOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 bg-kits-red text-white text-xs font-semibold rounded-xl hover:bg-kits-red/90 disabled:opacity-50"
                >
                  {actionLoading ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Proctoring Violations Audit Modal */}
      {selectedAttemptForViolations && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-gray-900">Anti-Cheat Proctoring Telemetry</h3>
                <p className="text-xs text-gray-500">
                  Candidate:{' '}
                  {selectedAttemptForViolations.students?.full_name ||
                    selectedAttemptForViolations.users?.email ||
                    'Candidate'}
                </p>
              </div>
              <button
                onClick={() => setSelectedAttemptForViolations(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                ✕
              </button>
            </div>

            {loadingViolations ? (
              <div className="py-8 text-center text-xs text-gray-400">Loading violation audit logs...</div>
            ) : (violationsList?.length ?? 0) === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">
                Clean session: zero tab-switch or focus violations recorded.
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {violationsList.map((v, idx) => (
                  <div key={v.id} className="p-3 bg-red-50/60 rounded-xl border border-red-200 text-xs space-y-1">
                    <div className="flex justify-between items-start">
                      <span className="font-bold text-red-700">
                        Strike {v.violation_number || idx + 1}: {v.violation_type}
                      </span>
                      <span className="text-gray-400 text-[10px]">
                        {new Date(v.recorded_at).toLocaleTimeString()}
                      </span>
                    </div>
                    {v.question_text && (
                      <p className="text-[11px] text-gray-700 font-medium">
                        Context Question: {v.question_text}
                      </p>
                    )}
                    <div className="flex items-center space-x-3 text-[10px] text-gray-500">
                      <span>Questions Attempted: {v.attempted_questions_count ?? 'N/A'}</span>
                      <span>•</span>
                      <span>Episode: {v.episode_id}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-gray-100">
              <button
                onClick={() => setSelectedAttemptForViolations(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-xs font-semibold rounded-xl hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign / Reassign Dedicated Assessment Coordinator Modal */}
      {isAssignCoordModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-center space-x-3 pb-3 border-b border-gray-100">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-kits-blue flex items-center justify-center font-bold">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  {coordinatorAssignment ? 'Reassign Assessment Coordinator' : 'Assign Assessment Coordinator'}
                </h3>
                <p className="text-xs text-gray-500">Dedicated live host account provisioning</p>
              </div>
            </div>

            <form onSubmit={handleAssignCoordinator} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1.5">
                  Coordinator Display Name <span className="text-kits-red">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Ramesh Kumar"
                  value={coordName}
                  onChange={(e) => setCoordName(e.target.value)}
                  className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1.5">
                  Coordinator Username <span className="text-kits-red">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. sravan@123 or coord_physics_2026"
                  value={coordUsername}
                  onChange={(e) => setCoordUsername(e.target.value)}
                  className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Tip: Existing coordinator accounts (e.g. Faculty) can be assigned directly without resetting their existing password.
                </p>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-600">
                    Password Setup <span className="text-kits-red">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={generateRandomPassword}
                    className="text-[11px] font-bold text-kits-blue hover:underline flex items-center space-x-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Generate</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  placeholder="Minimum 6 characters"
                  value={coordPassword}
                  onChange={(e) => setCoordPassword(e.target.value)}
                  className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1.5">
                  Phone Number (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. +91 9876543210"
                  value={coordPhone}
                  onChange={(e) => setCoordPhone(e.target.value)}
                  className="w-full px-4 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue"
                />
              </div>

              {coordError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium">
                  {coordError}
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsAssignCoordModalOpen(false)}
                  disabled={coordLoading}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={coordLoading}
                  className="px-5 py-2 bg-kits-blue text-white text-xs font-bold rounded-xl hover:bg-kits-blue/90 disabled:opacity-50 flex items-center space-x-1.5"
                >
                  {coordLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Assignment</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assessment Delete & Safe Archive Modal */}
      <AssessmentDeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        assessment={assessment}
        onSuccess={() => {
          navigate('/admin/assessments');
        }}
      />

      {/* Attempt Deletion Modal (Individual & Bulk with Typed DELETE Confirmation) */}
      <AttemptDeleteModal
        isOpen={isAttemptDeleteModalOpen}
        onClose={() => {
          setIsAttemptDeleteModalOpen(false);
          setTargetAttemptIdsToDelete([]);
        }}
        assessmentId={assessment?.id || ''}
        assessmentTitle={assessment?.title || 'Examination'}
        attemptIds={targetAttemptIdsToDelete}
        attempts={attempts}
        onSuccess={(count) => {
          setAttemptActionSuccess(`Successfully deleted ${count} student assessment attempt record(s).`);
          setSelectedAttemptIds((prev) => prev.filter((id) => !targetAttemptIdsToDelete.includes(id)));
          refreshAttempts();
        }}
      />

      {/* Assessment Reopen Modal */}
      <AssessmentReopenModal
        isOpen={isReopenModalOpen}
        onClose={() => setIsReopenModalOpen(false)}
        assessment={assessment}
        onSuccess={(result) => {
          setReopenSuccessNotice(
            result?.message || `Assessment "${assessment?.title}" successfully reopened and published.`
          );
          loadData();
        }}
      />

      {/* Assessment Revision & Republish Editor Modal */}
      {isRevisionEditorOpen && assessment && (
        <AssessmentRevisionEditorModal
          isOpen={isRevisionEditorOpen}
          onClose={() => setIsRevisionEditorOpen(false)}
          assessment={assessment}
          onPublishedSuccess={(newRev) => {
            setReopenSuccessNotice(
              `Assessment revised and published successfully as Revision ${newRev}! Examination data integrity guaranteed.`
            );
            loadData();
          }}
        />
      )}
    </div>
  );
}
export default AssessmentDetails;
