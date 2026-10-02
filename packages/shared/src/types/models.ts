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
  status: 'LOCKED' | 'UNLOCKED';
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
  other_department?: string | null;
  year_of_study: number;
  phone: string;
  name_change_used?: boolean;
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
