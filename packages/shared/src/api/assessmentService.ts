import { supabase } from './client';
import type {
  Assessment,
  AssessmentQuestion,
  AssessmentAttempt,
  AssessmentAttemptAnswer,
  AssessmentAttemptViolation,
  LeaderboardEntry,
  QuestionType,
  AssessmentRevision,
  AssessmentRevisionStatusResponse,
  AssessmentLiveHostSnapshot,
} from '../types/models';
import { extractErrorMessage } from '../utils/errorUtils';

export interface SaveQuestionPayload {
  assessment_id: string;
  question_id?: string | null;
  question_text: string;
  question_type: QuestionType;
  points: number;
  options?: Array<{ option_text: string; is_correct: boolean }>;
  correct_boolean?: boolean | null;
}

export const assessmentService = {
  // ==========================================================================
  // Admin Operations
  // ==========================================================================

  async getAdminAssessments(): Promise<{ data: Assessment[] | null; error: any }> {
    const { data, error } = await supabase
      .from('assessments')
      .select('*')
      .order('created_at', { ascending: false });

    return { data, error };
  },

  async getAdminAssessmentById(id: string): Promise<{ data: Assessment | null; error: any }> {
    const { data, error } = await supabase
      .from('assessments')
      .select('*')
      .eq('id', id)
      .single();

    return { data, error };
  },

  async createAssessment(payload: Partial<Assessment>): Promise<{ data: Assessment | null; error: any }> {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('assessments')
      .insert({
        title: payload.title?.trim(),
        description: payload.description?.trim() || '',
        instructions: payload.instructions?.trim() || '',
        duration_minutes: payload.duration_minutes || 60,
        start_time: payload.start_time,
        end_time: payload.end_time,
        passing_percentage: payload.passing_percentage ?? 40.0,
        include_in_global_leaderboard: Boolean(payload.include_in_global_leaderboard),
        randomize_questions: Boolean(payload.randomize_questions),
        randomize_options: Boolean(payload.randomize_options),
        event_id: payload.event_id || null,
        sub_event_id: payload.sub_event_id || null,
        status: 'DRAFT',
        created_by: user?.id || null,
      })
      .select('*')
      .single();

    return { data, error };
  },

  async updateAssessment(id: string, payload: Partial<Assessment>): Promise<{ data: any; error: any }> {
    const { data, error } = await supabase.rpc('admin_update_assessment', {
      p_assessment_id: id,
      p_title: payload.title?.trim(),
      p_description: payload.description?.trim() || '',
      p_instructions: payload.instructions?.trim() || '',
      p_duration_minutes: payload.duration_minutes || 60,
      p_start_time: payload.start_time,
      p_end_time: payload.end_time,
      p_passing_percentage: payload.passing_percentage ?? 40.0,
      p_include_in_global_leaderboard: Boolean(payload.include_in_global_leaderboard),
      p_randomize_questions: Boolean(payload.randomize_questions),
      p_randomize_options: Boolean(payload.randomize_options),
      p_event_id: payload.event_id || null,
      p_sub_event_id: payload.sub_event_id || null,
    });

    return { data, error };
  },

  async publishAssessment(id: string): Promise<{ data: any; error: any }> {
    const { data, error } = await supabase.rpc('admin_publish_assessment', {
      p_assessment_id: id,
    });
    if (error) {
      return {
        data: null,
        error: new Error(extractErrorMessage(error, 'Failed to publish assessment.')),
      };
    }
    return { data, error: null };
  },

  async closeAssessment(id: string): Promise<{ data: any; error: any }> {
    const rpcRes = await this.closeAndFinalizeAssessment(id);
    if (!rpcRes.error) {
      return { data: rpcRes.data, error: null };
    }

    const { data, error } = await supabase
      .from('assessments')
      .update({
        status: 'CLOSED',
        report_finalized_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    return { data, error };
  },

  async reopenAssessment(
    id: string,
    options?: {
      newStartTime?: string | null;
      newEndTime?: string | null;
      reason?: string;
    }
  ): Promise<{ data: any; error: any }> {
    const { data, error } = await supabase.rpc('admin_reopen_assessment', {
      p_assessment_id: id,
      p_new_start_time: options?.newStartTime ? new Date(options.newStartTime).toISOString() : null,
      p_new_end_time: options?.newEndTime ? new Date(options.newEndTime).toISOString() : null,
      p_reason: options?.reason?.trim() || 'Reopened by administrator',
    });
    return { data, error };
  },

  async archiveAssessment(id: string): Promise<{ data: any; error: any }> {
    const { data, error } = await supabase
      .from('assessments')
      .update({
        status: 'ARCHIVED',
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    return { data, error };
  },

  async getAdminQuestions(assessmentId: string): Promise<{ data: AssessmentQuestion[] | null; error: any }> {
    const { data, error } = await supabase.rpc('admin_get_assessment_questions', {
      p_assessment_id: assessmentId,
    });

    return { data: data as AssessmentQuestion[], error };
  },

  async saveQuestionAndOptions(payload: SaveQuestionPayload): Promise<{ data: any; error: any }> {
    const { data, error } = await supabase.rpc('admin_save_question_and_options', {
      p_assessment_id: payload.assessment_id,
      p_question_id: payload.question_id || null,
      p_question_text: payload.question_text.trim(),
      p_question_type: payload.question_type,
      p_points: payload.points,
      p_options: payload.question_type === 'MCQ' ? payload.options || [] : null,
      p_correct_boolean: payload.question_type === 'TRUE_FALSE' ? payload.correct_boolean ?? null : null,
    });

    return { data, error };
  },

  async deleteQuestion(questionId: string): Promise<{ error: any }> {
    const { error } = await supabase
      .from('assessment_questions')
      .delete()
      .eq('id', questionId);

    return { error };
  },

  async getAdminAttempts(assessmentId: string, coordinatorToken?: string): Promise<{ data: any[] | null; error: any }> {
    const { data, error } = await supabase.rpc('get_assessment_attempts_scoped', {
      p_assessment_id: assessmentId,
      p_coordinator_token: coordinatorToken || null,
    });

    if (error) {
      return { data: null, error };
    }

    const attempts = (data || []).map((att: any) => ({
      ...att,
      students: {
        full_name: att.student_name,
        roll_number: att.roll_number,
        college_name: att.college_name,
        department: '',
      },
    }));

    return { data: attempts, error: null };
  },

  async getAttemptViolations(attemptId: string, coordinatorToken?: string): Promise<{ data: AssessmentAttemptViolation[] | null; error: any }> {
    const { data, error } = await supabase.rpc('get_attempt_violations_scoped', {
      p_attempt_id: attemptId,
      p_coordinator_token: coordinatorToken || null,
    });

    return { data, error };
  },

  // ==========================================================================
  // Student Operations
  // ==========================================================================

  async getAvailableAssessments(): Promise<{ data: Assessment[] | null; error: any }> {
    const { data, error } = await supabase
      .from('assessments')
      .select('*')
      .in('status', ['PUBLISHED', 'CLOSED'])
      .eq('is_deleted', false)
      .order('start_time', { ascending: true });

    return { data, error };
  },

  async getStudentAssessmentById(id: string): Promise<{ data: Assessment | null; error: any }> {
    const { data, error } = await supabase
      .from('assessments')
      .select('*')
      .eq('id', id)
      .in('status', ['PUBLISHED', 'CLOSED'])
      .eq('is_deleted', false)
      .single();

    return { data, error };
  },

  async getMyAttempt(assessmentId: string): Promise<{ data: AssessmentAttempt | null; error: any }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: new Error('Authentication required') };

    const { data, error } = await supabase
      .from('assessment_attempts')
      .select('*')
      .eq('assessment_id', assessmentId)
      .eq('student_id', user.id)
      .maybeSingle();

    return { data, error };
  },

  async startOrResumeAttempt(assessmentId: string): Promise<{
    data: {
      success: boolean;
      is_resumed: boolean;
      attempt_id: string;
      status: string;
      deadline: string;
      score: number;
      strike_count: number;
    } | null;
    error: any;
  }> {
    const { data, error } = await supabase.rpc('student_start_or_resume_attempt', {
      p_assessment_id: assessmentId,
    });

    return { data, error };
  },

  async getCandidateQuestions(assessmentId: string, attemptId?: string): Promise<{ data: AssessmentQuestion[] | null; error: any }> {
    if (attemptId) {
      const { data, error } = await supabase.rpc('student_get_attempt_questions', {
        p_attempt_id: attemptId,
      });
      if (!error && data) {
        return { data: data as AssessmentQuestion[], error: null };
      }
    }

    // Direct fallback for pre-attempt preview
    const { data: questions, error: qErr } = await supabase
      .from('assessment_questions')
      .select(`
        id,
        assessment_id,
        question_text,
        question_type,
        points,
        sort_order
      `)
      .eq('assessment_id', assessmentId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (qErr || !questions) return { data: null, error: qErr };

    const qIds = questions.map((q) => q.id);
    const { data: options, error: optErr } = await supabase
      .from('assessment_question_options')
      .select('id, question_id, option_text, sort_order')
      .in('question_id', qIds)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (optErr) return { data: null, error: optErr };

    // Group options under each question
    const grouped = questions.map((q) => ({
      ...q,
      options: options?.filter((opt) => opt.question_id === q.id) || [],
    }));

    return { data: grouped, error: null };
  },

  async getClosedAssessmentSolutions(assessmentId: string): Promise<{ data: any[] | null; error: any }> {
    const { data, error } = await supabase.rpc('student_get_closed_assessment_solutions', {
      p_assessment_id: assessmentId,
    });
    return { data, error };
  },

  async getSavedAnswers(attemptId: string): Promise<{ data: AssessmentAttemptAnswer[] | null; error: any }> {
    const { data, error } = await supabase
      .from('assessment_attempt_answers')
      .select('*')
      .eq('attempt_id', attemptId);

    return { data, error };
  },

  async autosaveAnswer(
    attemptId: string,
    questionId: string,
    selectedOptionId?: string | null,
    selectedBoolean?: boolean | null
  ): Promise<{ data: any; error: any }> {
    const { data, error } = await supabase.rpc('student_autosave_answer', {
      p_attempt_id: attemptId,
      p_question_id: questionId,
      p_selected_option_id: selectedOptionId || null,
      p_selected_boolean: selectedBoolean !== undefined ? selectedBoolean : null,
    });

    return { data, error };
  },

  async viewQuestion(attemptId: string, questionId: string): Promise<{ data: any; error: any }> {
    const { data, error } = await supabase.rpc('student_view_question', {
      p_attempt_id: attemptId,
      p_question_id: questionId,
    });

    return { data, error };
  },

  async submitAttempt(attemptId: string): Promise<{ data: any; error: any }> {
    const { data, error } = await supabase.rpc('student_submit_attempt', {
      p_attempt_id: attemptId,
    });

    return { data, error };
  },

  async recordViolation(
    attemptId: string,
    episodeId: string,
    violationType = 'TAB_SWITCH',
    questionId?: string | null
  ): Promise<{ data: any; error: any }> {
    const { data, error } = await supabase.rpc('student_record_violation', {
      p_attempt_id: attemptId,
      p_episode_id: episodeId,
      p_violation_type: violationType,
      p_question_id: questionId || null,
    });

    return { data, error };
  },

  async getScopedAttempts(assessmentId: string, coordinatorToken?: string): Promise<{ data: any[] | null; error: any }> {
    const { data, error } = await supabase.rpc('get_assessment_attempts_scoped', {
      p_assessment_id: assessmentId,
      p_coordinator_token: coordinatorToken || null,
    });
    return { data, error };
  },

  async getScopedViolations(attemptId: string, coordinatorToken?: string): Promise<{ data: any[] | null; error: any }> {
    const { data, error } = await supabase.rpc('get_attempt_violations_scoped', {
      p_attempt_id: attemptId,
      p_coordinator_token: coordinatorToken || null,
    });
    return { data, error };
  },

  async getAssessmentLeaderboard(assessmentId: string): Promise<{ data: LeaderboardEntry[] | null; error: any }> {
    const { data, error } = await supabase.rpc('get_assessment_leaderboard', {
      p_assessment_id: assessmentId,
    });

    return { data, error };
  },

  async getGlobalLeaderboard(): Promise<{ data: LeaderboardEntry[] | null; error: any }> {
    const { data, error } = await supabase.rpc('get_global_assessment_leaderboard');
    return { data, error };
  },

  // ==========================================================================
  // Question Bank Import / Export Operations
  // ==========================================================================

  async importAssessmentQuestions(
    assessmentId: string,
    questions: any[],
    defaultPoints: number = 5,
    coordinatorToken?: string
  ): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase.rpc('admin_import_assessment_questions', {
      p_assessment_id: assessmentId,
      p_questions: questions,
      p_default_points: defaultPoints,
      p_coordinator_token: coordinatorToken || null,
    });
    return { data, error };
  },

  // ==========================================================================
  // Assessment Certificates (DISCONTINUED - Assessment certificates do not exist)
  // ==========================================================================

  /** @deprecated Assessment certificates discontinued */
  async processAssessmentAwards(_assessmentId: string): Promise<{ data: any; error: any }> {
    return { data: { success: false, message: 'Assessment certificates are discontinued.' }, error: null };
  },

  /** @deprecated Assessment certificates discontinued */
  async getAdminAssessmentCertificates(_assessmentId: string): Promise<{ data: any[] | null; error: any }> {
    return { data: [], error: null };
  },

  /** @deprecated Assessment certificates discontinued */
  async getMyAssessmentCertificate(_assessmentId: string): Promise<{ data: any | null; error: any }> {
    return { data: null, error: null };
  },

  /** @deprecated Assessment certificates discontinued */
  async getMyAllAssessmentCertificates(): Promise<{ data: any[] | null; error: any }> {
    return { data: [], error: null };
  },

  // ==========================================================================
  // Assessment Deletion & Coordinator Assignment Operations
  // ==========================================================================

  async deleteAssessment(
    assessmentId: string,
    forcePermanent: boolean = false
  ): Promise<{ data: { success: boolean; action: 'ARCHIVED' | 'PERMANENTLY_DELETED' | 'BLOCKED'; is_permanent: boolean; message: string; attempts_count?: number; certificates_count?: number } | null; error: any }> {
    const { data, error } = await supabase.rpc('admin_delete_assessment', {
      p_assessment_id: assessmentId,
      p_force_permanent: forcePermanent,
    });
    return { data, error };
  },

  async assignCoordinator(
    assessmentId: string,
    payload: { name: string; username: string; password: string; phone?: string }
  ): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase.rpc('admin_assign_assessment_coordinator', {
      p_assessment_id: assessmentId,
      p_coordinator_name: payload.name.trim(),
      p_username: payload.username.trim(),
      p_password: payload.password.trim(),
      p_phone: payload.phone?.trim() || null,
    });

    if (error) {
      return { data: null, error };
    }

    if (data && !data.success) {
      return {
        data,
        error: new Error(data.message || 'Failed to assign coordinator.'),
      };
    }

    return { data, error: null };
  },

  async getCoordinatorAssignment(assessmentId: string): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase
      .from('assessment_coordinator_assignments')
      .select(`
        id,
        assessment_id,
        coordinator_id,
        assigned_at,
        coordinators (
          id,
          username,
          display_name,
          phone_number,
          coordinator_type,
          status
        )
      `)
      .eq('assessment_id', assessmentId)
      .maybeSingle();

    return { data, error };
  },

  // ==========================================================================
  // Live Assessment Host Dashboard Operations
  // ==========================================================================

  async getLiveHostSnapshot(
    assessmentId: string,
    coordinatorToken?: string
  ): Promise<{ data: AssessmentLiveHostSnapshot | null; error: any }> {
    const { data, error } = await supabase.rpc('get_assessment_live_host_snapshot', {
      p_assessment_id: assessmentId,
      p_coordinator_token: coordinatorToken || null,
    });

    if (error) {
      return { data: null, error };
    }

    if (data && typeof data === 'object') {
      const recentEvents = Array.isArray(data.recent_activity)
        ? data.recent_activity
        : Array.isArray(data.recent_events)
        ? data.recent_events
        : [];

      const normalized: AssessmentLiveHostSnapshot = {
        assessment: data.assessment || {},
        overview: {
          total_eligible: Number(data.overview?.total_eligible) || 0,
          started_count: Number(data.overview?.started_count) || 0,
          in_progress_count: Number(data.overview?.in_progress_count) || 0,
          submitted_count: Number(data.overview?.submitted_count) || 0,
          expired_count: Number(data.overview?.expired_count) || 0,
          terminated_count: Number(data.overview?.terminated_count) || 0,
          not_started_count: Number(data.overview?.not_started_count) || 0,
          completion_rate: Number(data.overview?.completion_rate) || 0,
        },
        participants: Array.isArray(data.participants) ? data.participants : [],
        question_progress: Array.isArray(data.question_progress) ? data.question_progress : [],
        recent_activity: recentEvents,
        recent_events: recentEvents,
        scoreboard: Array.isArray(data.scoreboard) ? data.scoreboard : [],
        server_time: data.server_time || new Date().toISOString(),
      };
      return { data: normalized, error: null };
    }

    return { data, error };
  },

  async getAssignedAssessment(
    coordinatorToken: string
  ): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase.rpc('coordinator_get_assigned_assessment', {
      p_token: coordinatorToken.trim(),
    });
    return { data, error };
  },

  async closeAssessmentEarly(
    assessmentId: string,
    coordinatorToken?: string,
    reason: string = 'Early closure triggered by host coordinator'
  ): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase.rpc('coordinator_close_assessment_early', {
      p_assessment_id: assessmentId,
      p_coordinator_token: coordinatorToken || null,
      p_reason: reason,
    });
    return { data, error };
  },

  async coordinatorAssessmentLogin(
    username: string,
    password: string
  ): Promise<{ data: any | null; error: any }> {
    // 1. Primary: Secure RPC in PostgreSQL
    const { data, error } = await supabase.rpc('coordinator_assessment_login', {
      p_username: username.trim(),
      p_password: password.trim(),
    });

    if (!error && data?.success) {
      return { data, error: null };
    }

    // 2. Secondary: Edge Function invocation fallback
    try {
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('coordinator-login', {
        body: { username: username.trim(), password: password.trim() },
      });
      if (fnErr) return { data: null, error: fnErr };
      return { data: fnData, error: null };
    } catch (fallbackErr) {
      return { data: null, error: error || fallbackErr };
    }
  },

  // ==========================================================================
  // Assessment Attempt Deletion
  // ==========================================================================

  async deleteAssessmentAttempts(
    assessmentId: string,
    attemptIds: string[]
  ): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase.rpc('admin_delete_assessment_attempts', {
      p_assessment_id: assessmentId,
      p_attempt_ids: attemptIds,
    });

    if (error) {
      return { data: null, error };
    }

    if (data && !data.success) {
      return {
        data,
        error: new Error(data.message || 'Failed to delete assessment attempts.'),
      };
    }

    return { data, error: null };
  },

  // ==========================================================================
  // Assessment Revision & Republish Operations
  // ==========================================================================

  async getAssessmentRevisionStatus(
    assessmentId: string,
    coordinatorToken?: string
  ): Promise<{ data: AssessmentRevisionStatusResponse | null; error: any }> {
    const { data, error } = await supabase.rpc('admin_get_assessment_revision_status', {
      p_assessment_id: assessmentId,
      p_coordinator_token: coordinatorToken || null,
    });

    if (error) {
      return { data: null, error };
    }

    return { data: data as AssessmentRevisionStatusResponse, error: null };
  },

  async initiateAssessmentRevision(
    assessmentId: string,
    coordinatorToken?: string
  ): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase.rpc('admin_initiate_assessment_revision', {
      p_assessment_id: assessmentId,
      p_coordinator_token: coordinatorToken || null,
    });

    if (error) {
      return { data: null, error };
    }

    return { data, error: null };
  },

  async saveAssessmentRevisionDraft(
    assessmentId: string,
    revisionData: Partial<AssessmentRevision>,
    coordinatorToken?: string
  ): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase.rpc('admin_save_assessment_revision_draft', {
      p_assessment_id: assessmentId,
      p_revision_data: revisionData,
      p_coordinator_token: coordinatorToken || null,
    });

    if (error) {
      return { data: null, error };
    }

    return { data, error: null };
  },

  async discardAssessmentRevision(
    assessmentId: string,
    coordinatorToken?: string
  ): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase.rpc('admin_discard_assessment_revision', {
      p_assessment_id: assessmentId,
      p_coordinator_token: coordinatorToken || null,
    });

    if (error) {
      return { data: null, error };
    }

    return { data, error: null };
  },

  async publishAssessmentRevision(
    assessmentId: string,
    changeSummary: string = '',
    coordinatorToken?: string
  ): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase.rpc('admin_publish_assessment_revision', {
      p_assessment_id: assessmentId,
      p_change_summary: changeSummary.trim(),
      p_coordinator_token: coordinatorToken || null,
    });

    if (error) {
      return { data: null, error };
    }

    return { data, error: null };
  },

  // ==========================================================================
  // Assessment Reports & Post-Assessment Analytics Operations
  // ==========================================================================

  async getAssessmentReport(
    assessmentId: string,
    coordinatorToken?: string
  ): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase.rpc('get_assessment_report', {
      p_assessment_id: assessmentId,
      p_coordinator_token: coordinatorToken || null,
    });

    if (error) {
      return { data: null, error };
    }

    if (data && !data.success) {
      return {
        data: null,
        error: new Error(data.message || 'Failed to generate assessment report.'),
      };
    }

    return { data, error: null };
  },

  async closeAndFinalizeAssessment(
    assessmentId: string,
    coordinatorToken?: string
  ): Promise<{ data: any | null; error: any }> {
    if (coordinatorToken) {
      return this.closeAssessmentEarly(assessmentId, coordinatorToken, 'Assessment finalized by coordinator');
    }

    const { data, error } = await supabase.rpc('close_and_finalize_assessment', {
      p_assessment_id: assessmentId,
      p_caller_type: 'ADMIN',
    });

    if (error) {
      return { data: null, error };
    }

    return { data, error: null };
  },
};


