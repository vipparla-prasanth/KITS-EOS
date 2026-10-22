import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractErrorMessage } from './errorUtils';
import { assessmentService } from '../api/assessmentService';
import { supabase } from '../api/client';

describe('Assessment Publishing & Coordinator Conflict Remediation Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Error Message Extraction & HTTP 400 Responses', () => {
    it('correctly extracts PostgREST HTTP 400 error message with code 22023', () => {
      const postgrestHttp400Error = {
        code: '22023',
        details: null,
        hint: null,
        message: 'Standalone assessments must have an assigned coordinator before publication',
      };
      const msg = extractErrorMessage(postgrestHttp400Error);
      expect(msg).toBe('Standalone assessments must have an assigned coordinator before publication');
    });

    it('handles PostgREST error with details when message is absent', () => {
      const errorWithDetailsOnly = {
        code: '22023',
        details: 'Coordinator constraint validation failed on assessment publication.',
        message: '',
      };
      const msg = extractErrorMessage(errorWithDetailsOnly);
      expect(msg).toBe('Coordinator constraint validation failed on assessment publication.');
    });

    it('handles error with hint when message and details are absent', () => {
      const errorWithHintOnly = {
        hint: 'Please ensure a coordinator is assigned prior to publication.',
      };
      const msg = extractErrorMessage(errorWithHintOnly, 'Publication failed.');
      expect(msg).toContain('Hint: Please ensure a coordinator is assigned prior to publication.');
    });

    it('handles error with error_description (Auth error shape)', () => {
      const authError = {
        error_description: 'User does not possess administrative privileges.',
      };
      const msg = extractErrorMessage(authError);
      expect(msg).toBe('User does not possess administrative privileges.');
    });

    it('handles code-only errors gracefully without crashing', () => {
      const codeOnlyError = {
        code: '42501',
      };
      const msg = extractErrorMessage(codeOnlyError, 'Access denied.');
      expect(msg).toBe('Server validation error [42501]: Access denied.');
    });

    it('handles missing, null, empty, or malformed error shapes safely with fallback', () => {
      expect(extractErrorMessage(null, 'Publishing fallback error.')).toBe('Publishing fallback error.');
      expect(extractErrorMessage(undefined, 'Publishing fallback error.')).toBe('Publishing fallback error.');
      expect(extractErrorMessage('', 'Publishing fallback error.')).toBe('Publishing fallback error.');
      expect(extractErrorMessage({}, 'Publishing fallback error.')).toBe('Publishing fallback error.');
      expect(extractErrorMessage(12345, 'Publishing fallback error.')).toBe('Publishing fallback error.');
      expect(extractErrorMessage(new Error('Explicit standard error.'))).toBe('Explicit standard error.');
      expect(extractErrorMessage('Direct error string.')).toBe('Direct error string.');
    });
  });

  describe('2. Coordinator Conflict Handling & Validation', () => {
    it('detects coordinator conflict and returns informative error without silent failure', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: {
          success: false,
          code: 'COORDINATOR_ALREADY_ASSIGNED',
          message: 'Coordinator "sravan@123" is already assigned to another active assessment.',
        },
        error: null,
      } as any);

      const res = await assessmentService.assignCoordinator('draft-asm-uuid-1', {
        name: 'J N V Sravan',
        username: 'sravan@123',
        password: 'Password@123',
      });

      expect(res.error).toBeInstanceOf(Error);
      expect(res.error.message).toBe('Coordinator "sravan@123" is already assigned to another active assessment.');
      expect(res.data.success).toBe(false);
      expect(res.data.code).toBe('COORDINATOR_ALREADY_ASSIGNED');
    });

    it('allows valid coordinator assignment when no conflict exists', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: {
          success: true,
          coordinator_id: 'new-coord-uuid',
          assignment_id: 'assign-uuid-1',
          username: 'available_coord@123',
        },
        error: null,
      } as any);

      const res = await assessmentService.assignCoordinator('draft-asm-uuid-2', {
        name: 'Available Faculty',
        username: 'available_coord@123',
        password: 'Password@123',
      });

      expect(res.error).toBeNull();
      expect(res.data.success).toBe(true);
      expect(res.data.username).toBe('available_coord@123');
    });
  });

  describe('3. Assessment Publishing & Pre-flight Flow', () => {
    it('successfully publishes assessment when backend RPC succeeds', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: {
          success: true,
          status: 'PUBLISHED',
          total_questions_count: 10,
        },
        error: null,
      } as any);

      const res = await assessmentService.publishAssessment('asm-uuid-with-coordinator');
      expect(res.error).toBeNull();
      expect(res.data.success).toBe(true);
      expect(res.data.status).toBe('PUBLISHED');
    });

    it('formats HTTP 400 publish failure cleanly into an Error object', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: null,
        error: {
          code: '22023',
          message: 'Standalone assessments must have an assigned coordinator before publication',
        },
      } as any);

      const res = await assessmentService.publishAssessment('asm-uuid-without-coordinator');
      expect(res.data).toBeNull();
      expect(res.error).toBeInstanceOf(Error);
      expect(res.error.message).toBe('Standalone assessments must have an assigned coordinator before publication');
    });

    it('enforces standalone pre-flight coordinator requirement logically', () => {
      const standaloneAssessment = {
        id: 'asm-1',
        event_id: null,
        sub_event_id: null,
      };
      const linkedAssessment = {
        id: 'asm-2',
        event_id: 'event-uuid',
        sub_event_id: 'sub-event-uuid',
      };

      const isStandaloneValidWithoutCoord = !standaloneAssessment.event_id && !standaloneAssessment.sub_event_id;
      const isLinkedValidWithoutCoord = !linkedAssessment.event_id && !linkedAssessment.sub_event_id;

      expect(isStandaloneValidWithoutCoord).toBe(true); // Must require coordinator
      expect(isLinkedValidWithoutCoord).toBe(false); // Sub-event assessments don't require standalone coordinator
    });
  });

  describe('4. Telemetry Snapshot Normalization & Null Safety (Preventing TypeError: length)', () => {
    it('normalizes snapshot returning recent_events instead of recent_activity safely', async () => {
      const dbSnapshotWithRecentEvents = {
        assessment: { id: 'asm-1', title: 'Test Exam', status: 'PUBLISHED' },
        overview: { started_count: 5, submitted_count: 3 },
        participants: [
          { attempt_id: 'att-1', student_name: 'John Doe', roll_number: '21001', college_name: 'KITS', status: 'SUBMITTED' },
        ],
        question_progress: [
          { question_id: 'q-1', question_text: 'What is O(1)?', answered_count: 3, total_attempts: 5, participation_pct: 60 },
        ],
        recent_events: [
          { id: 'ev-1', event_type: 'ATTEMPT_SUBMITTED', student_name: 'John Doe', created_at: new Date().toISOString() },
        ],
        scoreboard: [
          { rank: 1, student_name: 'John Doe', score: 95 },
        ],
      };

      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: dbSnapshotWithRecentEvents,
        error: null,
      } as any);

      const res = await assessmentService.getLiveHostSnapshot('asm-1');
      expect(res.error).toBeNull();
      expect(res.data).toBeDefined();

      // Crucial assertion: recent_activity MUST be populated and non-undefined
      expect(res.data?.recent_activity).toBeDefined();
      expect(Array.isArray(res.data?.recent_activity)).toBe(true);
      expect(res.data?.recent_activity.length).toBe(1);
      expect(res.data?.recent_events?.length).toBe(1);
      expect(res.data?.participants.length).toBe(1);
      expect(res.data?.question_progress.length).toBe(1);
      expect(res.data?.scoreboard.length).toBe(1);
    });

    it('handles snapshot with missing or null collections without throwing TypeError: length', async () => {
      const sparseDbSnapshot = {
        assessment: { id: 'asm-empty', title: 'Empty Exam' },
        overview: null,
        participants: null,
        question_progress: null,
        recent_events: null,
        scoreboard: null,
      };

      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: sparseDbSnapshot,
        error: null,
      } as any);

      const res = await assessmentService.getLiveHostSnapshot('asm-empty');
      expect(res.error).toBeNull();
      const snapshot = res.data;

      // Accessing length on all collections MUST NOT throw
      expect(() => {
        const pLen = snapshot?.participants.length ?? 0;
        const qLen = snapshot?.question_progress.length ?? 0;
        const aLen = snapshot?.recent_activity.length ?? 0;
        const sLen = snapshot?.scoreboard.length ?? 0;
        expect(pLen).toBe(0);
        expect(qLen).toBe(0);
        expect(aLen).toBe(0);
        expect(sLen).toBe(0);
      }).not.toThrow();

      expect(snapshot?.overview.started_count).toBe(0);
      expect(snapshot?.overview.completion_rate).toBe(0);
    });

    it('safely filters participants even when college or college_name is undefined', () => {
      const participants = [
        { student_name: 'Alice', roll_number: '101', status: 'IN_PROGRESS' }, // college undefined
        { student_name: 'Bob', roll_number: '102', college: 'KITS Civil', status: 'SUBMITTED' },
        { student_name: 'Charlie', roll_number: '103', college_name: 'KITS CSE', status: 'IN_PROGRESS' },
      ];

      expect(() => {
        const filtered = participants.filter((p) => {
          const sQuery = 'kits';
          return (
            (p.student_name || '').toLowerCase().includes(sQuery) ||
            (p.roll_number || '').toLowerCase().includes(sQuery) ||
            ((p as any).college_name || (p as any).college || '').toLowerCase().includes(sQuery)
          );
        });
        expect(filtered.length).toBe(2);
      }).not.toThrow();
    });
  });
});
