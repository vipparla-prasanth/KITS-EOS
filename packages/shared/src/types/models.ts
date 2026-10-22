export type EventLifecycleStatus =
  | 'UPCOMING'
  | 'REGISTRATIONS OPEN'
  | 'REGISTRATIONS CLOSED'
  | 'ONGOING'
  | 'COMPLETED';

export type StatusMode = 'AUTOMATIC' | 'MANUAL';

export interface Event {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  banner_path: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'PERMANENTLY_DELETED';
  status_mode?: StatusMode;
  manual_status?: EventLifecycleStatus | null;
  effective_status?: EventLifecycleStatus;
  registration_start_date?: string | null;
  registration_end_date?: string | null;
  created_at: string;
}

export interface Category {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'PERMANENTLY_DELETED';
  created_at: string;
}

export interface RequiredDocumentConfig {
  id: string;
  name: string;
  description: string;
  required?: boolean;
}

export interface CoordinatorData {
  name: string;
  mobile: string;
  username: string;
  password?: string;
}

export interface Coordinator {
  id: string;
  username: string;
  password_hash?: string;
  display_name: string;
  contact_visible: boolean;
  phone_number: string | null;
  coordinator_type: 'FACULTY' | 'STUDENT' | string;
  status: 'ACTIVE' | 'ARCHIVED' | 'PERMANENTLY_DELETED';
  created_at: string;
}

export interface CoordinatorAssignment {
  id: string;
  coordinator_id: string;
  sub_event_id: string;
  coordinators?: Coordinator;
  sub_events?: SubEvent & {
    events?: Event | null;
    categories?: (Category & { events?: Event | null }) | null;
  };
}

export type SubEventPaymentMode = 'UPI_ONLY' | 'CASH_ONLY' | 'BOTH' | 'REGISTER_ONLINE_PAY_OFFLINE';

export interface SubEvent {
  id: string;
  category_id: string | null;
  event_id?: string | null;
  name: string;
  description: string | null;
  rules: string | null;
  banner_path: string | null;
  start_time: string | null;
  end_time: string | null;
  registration_start_time?: string | null;
  registration_end_time?: string | null;
  venue: string | null;
  participation_type: 'SOLO' | 'TEAM' | 'BOTH';
  max_team_size: number;
  fee_amount_solo: number;
  fee_amount_team: number;
  is_free?: boolean;
  payment_mode?: SubEventPaymentMode | null;
  payment_instructions: string | null;
  required_documents: RequiredDocumentConfig[] | null;
  attendance_token_prefix: string | null;
  results_locked: boolean;
  winner_team_id?: string | null;
  runner_team_id?: string | null;
  third_team_id?: string | null;
  results_published?: boolean;
  results_published_at?: string | null;
  result_edit_count?: number;
  result_edited_at?: string | null;
  result_edited_by?: string | null;
  result_edit_reason?: string | null;
  updated_at?: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'PERMANENTLY_DELETED';
  status_mode?: StatusMode;
  manual_status?: EventLifecycleStatus | null;
  effective_status?: EventLifecycleStatus;
  max_capacity?: number | null;
  registered_count?: number;
  created_at: string;
  coordinators?: {
    faculty?: CoordinatorData | null;
    student?: CoordinatorData | null;
  };
  events?: Event | null;
  categories?: (Category & { events?: Event | null }) | null;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string | null;
  is_leader: boolean;
  qr_identity: string;
  manual_token: string;
  snapshot_name: string;
  snapshot_roll_number: string;
  snapshot_college: string;
  snapshot_department: string;
  snapshot_year: number;
}

export interface Team {
  id: string;
  registration_id: string;
  team_name: string | null;
  team_members?: TeamMember[];
}

export interface Registration {
  id: string;
  sub_event_id: string;
  leader_id: string | null;
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED';
  created_at: string;
  sub_events?: SubEvent;
  teams?: Team[];
  payments?: Payment[];
  users?: {
    id: string;
    email: string;
    role: string;
  } | null;
}

export interface Payment {
  id: string;
  registration_id: string;
  amount: number;
  reference_id: string;
  payment_method: 'UPI' | 'COD' | 'ONLINE' | 'FREE';
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  created_at: string;
  registrations?: Registration & {
    sub_events?: SubEvent & {
      events?: Event | null;
      categories?: (Category & { events?: Event | null }) | null;
    };
    teams?: Team[];
    users?: {
      id: string;
      email: string;
    } | null;
  };
}

export interface AttendanceRecord {
  id: string;
  sub_event_id: string;
  team_id: string;
  scanned_member_id: string;
  check_in_time: string;
  checked_in_by: string | null;
  sub_events?: SubEvent;
  teams?: Team & {
    registrations?: Registration;
  };
  team_members?: TeamMember;
  coordinators?: Coordinator;
}

export interface Certificate {
  id: string;
  team_member_id: string;
  sub_event_id: string;
  type: 'WINNER' | 'RUNNER' | 'THIRD_PLACE' | 'PARTICIPANT';
  status: 'LOCKED' | 'UNLOCKED' | 'REVOKED';
  student_corrections_used: number;
  storage_path: string | null;
  certificate_code?: string;
  issued_at?: string | null;
  team_members?: TeamMember & {
    teams?: Team & {
      registrations?: Registration;
    };
  };
  sub_events?: SubEvent & {
    events?: Event | null;
    categories?: Category | null;
  };
}


export interface CertificateCorrection {
  id: string;
  certificate_id: string;
  corrected_by: string | null;
  old_snapshot_name: string;
  new_snapshot_name: string;
  created_at: string;
}

export interface Document {
  id: string;
  owner_id: string | null;
  entity_type: 'REGISTRATION' | 'STUDENT_ID' | 'OTHER';
  entity_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface FeedbackResponse {
  id: string;
  sub_event_id: string;
  registration_id: string;
  rating_1: number;
  rating_2: number;
  rating_3: number;
  rating_4: number;
  rating_5: number;
  comments: string | null;
  sub_events?: SubEvent;
  registrations?: Registration & {
    teams?: Team[];
  };
}

export interface Complaint {
  id: string;
  user_id: string | null;
  category: string;
  description: string;
  status: 'OPEN' | 'RESOLVED' | 'CLOSED';
  resolution: string | null;
  users?: {
    id: string;
    email: string;
  } | null;
  student_profiles?: StudentProfile | null;
}

export interface User {
  id: string;
  email: string;
  role: 'STUDENT' | 'ADMIN' | string;
  status: 'ACTIVE' | 'DEACTIVATED' | 'ANONYMIZED';
  deactivated_at?: string | null;
  scheduled_permanent_deletion_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentProfile {
  user_id: string;
  full_name: string;
  roll_number: string;
  college: string;
  department: string;
  branch?: string | null;
  other_department?: string | null;
  year_of_study: number;
  phone: string;
  name_change_used?: boolean;
  admin_edit_count?: number;
  privacy_notice_version?: string | null;
  privacy_acknowledged_at?: string | null;
  account_status?: 'ACTIVE' | 'SUSPENDED';
  suspension_reason?: string | null;
  suspended_at?: string | null;
  suspended_by?: string | null;
  deactivated_at?: string | null;
  scheduled_permanent_deletion_at?: string | null;
  users?: {
    id: string;
    email: string;
    role?: string;
    status: string;
    deactivated_at?: string | null;
    scheduled_permanent_deletion_at?: string | null;
  };
}

export type SuspensionRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface StudentAccountSuspensionRequest {
  id: string;
  student_id: string;
  request_message: string;
  status: SuspensionRequestStatus;
  admin_response?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
  student_profiles?: StudentProfile | null;
}

export type PrivacyRequestType = 'DATA_ACCESS' | 'DATA_CORRECTION' | 'DATA_DELETION' | 'DATA_PORTABILITY' | 'OTHER';
export type PrivacyRequestStatus = 'PENDING' | 'UNDER_REVIEW' | 'COMPLETED' | 'REJECTED';

export interface PrivacyRequest {
  id: string;
  user_id: string;
  request_type: PrivacyRequestType;
  description: string;
  status: PrivacyRequestStatus;
  admin_notes?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  student_profiles?: StudentProfile | null;
  users?: {
    id: string;
    email: string;
  } | null;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface DashboardMetrics {
  totalEvents: number;
  totalCategories: number;
  totalSubEvents: number;
  totalCoordinators: number | null;
  totalRegistrations: number;
  confirmedRegistrations: number;
  totalRevenue: number;
  totalAttendance: number;
  totalCertificates: number;
  totalFeedback: number;
  openComplaints: number;
}

export type ResultSubmissionStatus = 'PENDING_ADMIN_APPROVAL' | 'APPROVED' | 'REJECTED';

export interface ResultSubmissionMemberInfo {
  member_id: string;
  name: string;
  roll_number: string;
  college: string;
  department: string;
  year: number | string;
  is_leader: boolean;
  is_attended: boolean;
}

export interface ResultSubmissionTeamInfo {
  team_id: string;
  team_name: string;
  is_team: boolean;
  leader_name: string;
  leader_roll: string;
  leader_college: string;
  leader_dept: string;
  leader_year: number | string;
  members: ResultSubmissionMemberInfo[];
}

export interface ResultSubmissionItem {
  submission_id: string;
  status: ResultSubmissionStatus;
  rejection_reason?: string | null;
  submitted_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  sub_event_id: string;
  sub_event_name: string;
  participation_type: 'SOLO' | 'TEAM' | 'BOTH';
  category_name: string;
  event_name: string;
  coordinator_id: string;
  coordinator_name: string;
  coordinator_username: string;
  winner: ResultSubmissionTeamInfo;
  runner?: ResultSubmissionTeamInfo | null;
  third?: ResultSubmissionTeamInfo | null;
  result_edit_count?: number;
  result_edited_at?: string | null;
  result_edited_by?: string | null;
  result_edit_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ResultEligibleCandidate {
  team_id: string;
  team_name: string;
  registration_id: string;
  is_team: boolean;
  leader_name: string;
  leader_roll: string;
  leader_college: string;
  leader_dept: string;
  leader_year: number | string;
  attended_members_count: number;
  members: ResultSubmissionMemberInfo[];
}

export interface PublishedResultCorrectionPreview {
  sub_event_id: string;
  sub_event_name: string;
  current_podium: {
    winner_team_id: string | null;
    winner_name: string | null;
    runner_team_id: string | null;
    runner_name: string | null;
    third_team_id: string | null;
    third_name: string | null;
  };
  proposed_podium: {
    winner_team_id: string;
    winner_name: string;
    runner_team_id: string | null;
    runner_name: string | null;
    third_team_id: string | null;
    third_name: string | null;
  };
  certificates_to_revoke: Array<{
    certificate_id: string;
    certificate_code: string;
    member_name: string;
    roll_number: string;
    college: string;
    department: string;
    type: 'WINNER' | 'RUNNER' | 'THIRD_PLACE';
  }>;
  certificates_to_issue: Array<{
    member_name: string;
    roll_number: string;
    college: string;
    department: string;
    type: 'WINNER' | 'RUNNER' | 'THIRD_PLACE';
  }>;
  certificates_unchanged: Array<{
    certificate_id: string;
    member_name: string;
    type: 'WINNER' | 'RUNNER' | 'THIRD_PLACE';
  }>;
  participation_certificates_affected: number;
}

// ============================================================================
// Assessment System Models & Interfaces
// ============================================================================

export type AssessmentStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
export type QuestionType = 'MCQ' | 'TRUE_FALSE';
export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED' | 'TERMINATED';

export interface SpeedBonusTier {
  rank?: number;
  min_rank?: number;
  max_rank?: number;
  points: number;
}

export interface SpeedBonusConfig {
  enabled: boolean;
  max_eos_points?: number;
  default_time_limit_seconds?: number;
  tiers?: SpeedBonusTier[];
}

export interface Assessment {
  id: string;
  title: string;
  description: string;
  instructions: string;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  status: AssessmentStatus;
  include_in_global_leaderboard: boolean;
  randomize_questions?: boolean;
  randomize_options?: boolean;
  speed_bonus_config?: SpeedBonusConfig;
  event_id?: string | null;
  sub_event_id?: string | null;
  passing_percentage: number;
  total_questions_count: number;
  created_by?: string | null;
  coordinator_id?: string | null;
  is_deleted?: boolean;
  deleted_at?: string | null;
  reopen_count?: number;
  last_reopened_at?: string | null;
  last_reopened_by?: string | null;
  current_revision_number?: number;
  has_draft_revision?: boolean;
  created_at: string;
  updated_at: string;
}

export type AssessmentRevisionStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';

export interface AssessmentRevisionQuestionData {
  id?: string;
  question_text: string;
  question_type: QuestionType;
  points: number;
  time_limit_seconds?: number;
  sort_order: number;
  options?: AssessmentQuestionOption[];
  correct_boolean?: boolean | null;
}

export interface AssessmentRevision {
  id: string;
  assessment_id: string;
  revision_number: number;
  status: AssessmentRevisionStatus;
  title: string;
  description: string;
  instructions: string;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  passing_percentage: number;
  total_questions_count: number;
  include_in_global_leaderboard: boolean;
  randomize_questions: boolean;
  randomize_options: boolean;
  speed_bonus_config?: SpeedBonusConfig;
  questions_data: AssessmentRevisionQuestionData[];
  change_summary?: string;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
  published_by?: string | null;
}

export interface AssessmentRevisionStatusResponse {
  assessment_id: string;
  title: string;
  status: AssessmentStatus;
  current_revision_number: number;
  has_draft_revision: boolean;
  can_edit: boolean;
  block_reason?: string | null;
  active_attempts_count: number;
  total_attempts_count: number;
  draft_revision?: AssessmentRevision | null;
  published_revisions: Array<{
    id: string;
    revision_number: number;
    status: AssessmentRevisionStatus;
    title: string;
    duration_minutes: number;
    passing_percentage: number;
    total_questions_count: number;
    published_at: string | null;
    change_summary?: string;
  }>;
}

export interface AssessmentQuestionOption {
  id?: string;
  question_id?: string;
  option_text: string;
  sort_order: number;
  created_at?: string;
  is_correct?: boolean; // Available only in admin context via admin_get_assessment_questions
}

export interface AssessmentQuestion {
  id: string;
  assessment_id: string;
  question_text: string;
  question_type: QuestionType;
  points: number;
  time_limit_seconds?: number;
  sort_order: number;
  options?: AssessmentQuestionOption[];
  correct_boolean?: boolean | null; // Available only in admin context via admin_get_assessment_questions
  created_at?: string;
  updated_at?: string;
}

export interface AssessmentAttempt {
  id: string;
  assessment_id: string;
  student_id: string;
  status: AttemptStatus;
  started_at: string;
  deadline: string;
  submitted_at?: string | null;
  score: number;
  question_score?: number;
  eos_points?: number;
  speed_bonus_score?: number;
  total_response_time_seconds?: number;
  correct_answers_count: number;
  strike_count: number;
  question_order?: string[] | null;
  option_orders?: Record<string, string[]> | null;
  leaderboard_event_id?: string | null;
  created_at: string;
  updated_at: string;
  assessments?: Assessment;
}

export interface AssessmentAttemptAnswer {
  id: string;
  attempt_id: string;
  question_id: string;
  selected_option_id?: string | null;
  selected_boolean?: boolean | null;
  is_correct?: boolean | null;
  points_awarded?: number;
  eos_points?: number;
  speed_bonus_awarded?: number;
  speed_bonus_rank?: number | null;
  response_time_seconds?: number | null;
  question_started_at?: string | null;
  answered_at: string;
}

export interface AssessmentAttemptViolation {
  id: string;
  attempt_id: string;
  episode_id: string;
  violation_type: string;
  violation_number?: number;
  question_id?: string | null;
  question_text?: string | null;
  attempted_questions_count?: number;
  recorded_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  student_name: string;
  score?: number;
  total_score?: number;
  question_score?: number;
  eos_points?: number;
  speed_bonus_score?: number;
  correct_answers_count?: number;
  total_response_time_seconds?: number;
}

export type AssessmentAwardType = 'FIRST_PLACE' | 'SECOND_PLACE' | 'THIRD_PLACE' | 'ACHIEVEMENT';

export interface AssessmentCertificate {
  id: string;
  assessment_id: string;
  student_id: string;
  attempt_id: string;
  award_type: AssessmentAwardType;
  rank: number;
  certificate_code: string;
  score: number;
  total_points: number;
  percentage: number;
  template_version: string;
  issued_at: string;
  revoked: boolean;
  revoked_at?: string | null;
  revocation_reason?: string | null;
  created_at: string;
  updated_at: string;
  // Joined or RPC hydrated fields
  assessment_title?: string;
  student_name?: string;
  roll_number?: string;
  department?: string;
  college?: string;
  year?: number;
}

export interface AssessmentCoordinatorAssignment {
  id: string;
  assessment_id: string;
  coordinator_id: string;
  assigned_by?: string | null;
  assigned_at: string;
  coordinators?: {
    id: string;
    username: string;
    display_name: string;
    phone_number?: string | null;
    coordinator_type: string;
    status: string;
  };
}

export type AssessmentLiveEventType = 
  | 'ATTEMPT_STARTED'
  | 'ANSWER_SAVED'
  | 'ATTEMPT_SUBMITTED'
  | 'ATTEMPT_EXPIRED'
  | 'ATTEMPT_TERMINATED'
  | 'STRIKE_RECORDED'
  | 'ATTEMPT_RESUMED'
  | 'ASSESSMENT_CLOSED'
  | 'ASSESSMENT_REOPENED';

export interface AssessmentLiveEvent {
  id: string;
  assessment_id: string;
  student_id?: string | null;
  student_name: string;
  event_type: AssessmentLiveEventType;
  question_context?: string | null;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface AssessmentLiveParticipant {
  attempt_id: string;
  student_id: string;
  student_name: string;
  roll_number: string;
  college: string;
  status: AttemptStatus;
  started_at: string;
  submitted_at?: string | null;
  deadline: string;
  elapsed_seconds: number;
  strike_count: number;
  answered_count: number;
  total_questions: number;
  score?: number | null;
  question_score?: number | null;
  eos_points?: number | null;
  speed_bonus_score?: number | null;
  percentage?: number | null;
  is_passed?: boolean;
  rank?: number | null;
}

export interface AssessmentQuestionProgress {
  question_id: string;
  question_text: string;
  question_type: QuestionType;
  sort_order: number;
  points: number;
  answered_count: number;
  total_attempts: number;
  participation_pct: number;
}

export interface AssessmentLiveHostSnapshot {
  assessment: {
    id: string;
    title: string;
    description: string;
    status: AssessmentStatus;
    duration_minutes: number;
    start_time: string;
    end_time: string;
    passing_percentage: number;
    total_questions_count: number;
    coordinator_name?: string | null;
    coordinator_username?: string | null;
    speed_bonus_config?: SpeedBonusConfig;
  };
  overview: {
    total_eligible: number;
    started_count: number;
    in_progress_count: number;
    submitted_count: number;
    expired_count: number;
    terminated_count: number;
    not_started_count: number;
    completion_rate: number;
  };
  participants: AssessmentLiveParticipant[];
  question_progress: AssessmentQuestionProgress[];
  recent_activity: AssessmentLiveEvent[];
  recent_events?: AssessmentLiveEvent[];
  scoreboard: Array<{
    rank: number;
    student_name: string;
    score: number;
    question_score?: number;
    eos_points?: number;
    speed_bonus_score?: number;
    status: AttemptStatus;
    submitted_at?: string | null;
    correct_answers_count?: number;
    total_response_time_seconds?: number;
  }>;
  server_time: string;
}

export interface AssessmentReportSummary {
  total_eligible: number;
  total_participants: number;
  completed_attempts: number;
  expired_attempts: number;
  terminated_attempts: number;
  in_progress_attempts: number;
  completion_rate: number;
  avg_academic_score: number;
  avg_academic_percentage: number;
  highest_academic_score: number;
  lowest_academic_score: number;
  avg_eos_points: number;
  highest_eos_points: number;
  avg_response_time_seconds: number;
  total_answers_submitted: number;
  total_correct_answers: number;
  avg_accuracy_percentage: number;
}

export interface AssessmentReportStudent {
  rank: number;
  student_id: string;
  student_name: string;
  roll_number: string;
  college_name: string;
  email?: string | null;
  attempt_id: string;
  attempt_status: AttemptStatus;
  academic_score: number;
  max_score: number;
  academic_percentage: number;
  eos_points: number;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  total_response_time_seconds: number;
  started_at: string;
  submitted_at?: string | null;
  is_passed: boolean;
}

export interface AssessmentReportQuestionOption {
  option_id: string;
  option_text: string;
  sort_order: number;
  is_correct: boolean;
  selected_count: number;
}

export interface AssessmentReportQuestion {
  question_id: string;
  question_number: number;
  sort_order: number;
  question_text: string;
  question_type: QuestionType;
  points: number;
  time_limit_seconds: number;
  total_responses: number;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  correct_percentage: number;
  incorrect_percentage: number;
  avg_response_time_seconds: number;
  is_difficult: boolean;
  correct_answer_preview?: string | null;
  options_breakdown: AssessmentReportQuestionOption[];
}

export interface AssessmentReportFeedback {
  has_feedback: boolean;
  total_responses: number;
  avg_rating: number;
  rating_1_avg: number;
  rating_2_avg: number;
  rating_3_avg: number;
  rating_4_avg: number;
  rating_5_avg: number;
  sample_comments: string[];
}

export interface AssessmentReportData {
  assessment: {
    id: string;
    title: string;
    description: string;
    instructions: string;
    status: AssessmentStatus;
    duration_minutes: number;
    start_time: string;
    end_time: string;
    actual_start_time: string;
    actual_end_time: string;
    passing_percentage: number;
    total_questions_count: number;
    total_points: number;
    report_finalized_at: string;
    closed_at?: string | null;
    closed_by?: string | null;
    is_closed: boolean;
  };
  summary: AssessmentReportSummary;
  students: AssessmentReportStudent[];
  questions: AssessmentReportQuestion[];
  feedback: AssessmentReportFeedback | null;
  generated_at: string;
}

export interface AssessmentReportResponse {
  success: boolean;
  assessment: AssessmentReportData['assessment'];
  summary: AssessmentReportSummary;
  students: AssessmentReportStudent[];
  questions: AssessmentReportQuestion[];
  feedback: AssessmentReportFeedback | null;
  generated_at: string;
}
