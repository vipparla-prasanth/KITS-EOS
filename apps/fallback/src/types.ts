export type ActiveAppMode = 'PUBLIC' | 'COORDINATOR';

export interface EventItem {
  id: string;
  name: string;
  banner_path?: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'PERMANENTLY_DELETED';
  created_at: string;
  categories_count?: number;
  sub_events_count?: number;
  description?: string;
  start_date?: string;
  end_date?: string;
}

export interface CategoryItem {
  id: string;
  event_id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'PERMANENTLY_DELETED';
  created_at: string;
}

export interface SubEventItem {
  id: string;
  category_id: string;
  event_id?: string;
  name: string;
  description?: string | null;
  rules?: string | null;
  banner_path?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  venue?: string | null;
  participation_type: 'SOLO' | 'TEAM' | 'BOTH';
  max_team_size: number;
  fee_amount_solo: number;
  fee_amount_team: number;
  payment_instructions?: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'PERMANENTLY_DELETED';
  created_at: string;
}

export interface TeamMemberRecord {
  id: string;
  team_id?: string;
  is_leader: boolean;
  student_name: string;
  roll_number: string;
  college: string;
  department: string;
  year_of_study?: number | string;
}

export interface ParticipantRecord {
  id: string;
  sub_event_id: string;
  registration_type: 'SOLO' | 'TEAM';
  status: 'CONFIRMED' | 'PENDING_PAYMENT' | 'CANCELLED';
  created_at: string;
  student_name: string;
  roll_number: string;
  college: string;
  department: string;
  year_of_study?: number | string;
  team_name?: string | null;
  is_leader?: boolean;
  team_members?: TeamMemberRecord[];
}

export interface CoordinatorSession {
  isAuthenticated: boolean;
  role: 'FALLBACK_COORDINATOR';
  displayName: string;
  loginTime: string;
  expiresAt: string;
}
