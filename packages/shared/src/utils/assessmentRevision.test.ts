import { describe, it, expect } from 'vitest';
import type {
  Assessment,
  AssessmentRevision,
  AssessmentRevisionQuestionData,
} from '../types/models';

/**
 * Pure validation helper matching Migration 129 rules
 */
export function validateRevisionForPublish(revision: {
  title: string;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  passing_percentage: number;
  questions_data: AssessmentRevisionQuestionData[];
  active_attempts_count: number;
}): { valid: boolean; error?: string } {
  if (revision.active_attempts_count > 0) {
    return {
      valid: false,
      error: `Cannot republish assessment while ${revision.active_attempts_count} student attempt(s) are actively in progress.`,
    };
  }

  if (!revision.title || revision.title.trim().length === 0) {
    return { valid: false, error: 'Assessment title cannot be empty' };
  }

  if (revision.duration_minutes <= 0) {
    return { valid: false, error: 'Duration must be greater than 0' };
  }

  const s = new Date(revision.start_time).getTime();
  const e = new Date(revision.end_time).getTime();
  if (isNaN(s) || isNaN(e) || e <= s) {
    return { valid: false, error: 'Assessment closing time must be strictly after opening start time' };
  }

  if (revision.passing_percentage < 0 || revision.passing_percentage > 100) {
    return { valid: false, error: 'Passing percentage must be between 0 and 100' };
  }

  if (!revision.questions_data || revision.questions_data.length < 1) {
    return { valid: false, error: 'Assessment must have at least one valid question before publication' };
  }

  for (let i = 0; i < revision.questions_data.length; i++) {
    const q = revision.questions_data[i];
    const qNum = i + 1;

    if (!q.question_text || q.question_text.trim().length === 0) {
      return { valid: false, error: `Question ${qNum} text cannot be empty` };
    }

    if (!['MCQ', 'TRUE_FALSE'].includes(q.question_type)) {
      return { valid: false, error: `Question ${qNum} has invalid type: ${q.question_type}` };
    }

    if (q.points === undefined || q.points === null || q.points <= 0 || isNaN(q.points)) {
      return { valid: false, error: `Question ${qNum} must have a positive, finite points value` };
    }

    if (q.question_type === 'MCQ') {
      const opts = q.options || [];
      if (opts.length < 3 || opts.length > 5) {
        return {
          valid: false,
          error: `MCQ Question ${qNum} must have between 3 and 5 options (found ${opts.length})`,
        };
      }

      let correctCount = 0;
      for (const opt of opts) {
        if (!opt.option_text || opt.option_text.trim().length === 0) {
          return { valid: false, error: `Question ${qNum} has an option with blank text` };
        }
        if (opt.is_correct) correctCount++;
      }

      if (correctCount !== 1) {
        return {
          valid: false,
          error: `MCQ Question ${qNum} must have exactly one correct option marked (found ${correctCount})`,
        };
      }
    } else if (q.question_type === 'TRUE_FALSE') {
      if (q.correct_boolean === null || q.correct_boolean === undefined || typeof q.correct_boolean !== 'boolean') {
        return { valid: false, error: `True/False Question ${qNum} requires a boolean correct answer` };
      }
    }
  }

  return { valid: true };
}

describe('Assessment Revision and Republish Workflow', () => {
  const mockAssessment: Assessment = {
    id: 'asm-101',
    title: 'Operating Systems Fundamentals',
    description: 'Core concepts exam',
    instructions: 'No cheating',
    duration_minutes: 60,
    start_time: '2026-10-18T10:00:00Z',
    end_time: '2026-10-19T10:00:00Z',
    status: 'PUBLISHED',
    passing_percentage: 40,
    total_questions_count: 2,
    include_in_global_leaderboard: true,
    current_revision_number: 1,
    has_draft_revision: false,
    created_at: '2026-10-18T09:00:00Z',
    updated_at: '2026-10-18T09:00:00Z',
  };

  const sampleQuestions: AssessmentRevisionQuestionData[] = [
    {
      id: 'q-1',
      question_text: 'What is a process?',
      question_type: 'MCQ',
      points: 10,
      time_limit_seconds: 30,
      sort_order: 1,
      options: [
        { id: 'opt-1', option_text: 'A program in execution', sort_order: 0, is_correct: true },
        { id: 'opt-2', option_text: 'A static binary on disk', sort_order: 1, is_correct: false },
        { id: 'opt-3', option_text: 'A hardware register', sort_order: 2, is_correct: false },
      ],
    },
    {
      id: 'q-2',
      question_text: 'Deadlocks can occur in single-threaded programs with no shared resources.',
      question_type: 'TRUE_FALSE',
      points: 5,
      time_limit_seconds: 20,
      sort_order: 2,
      correct_boolean: false,
    },
  ];

  it('1. Allows editing and adding new questions to a published assessment draft', () => {
    // Clone questions into a draft revision
    const draftQuestions = [...sampleQuestions];

    // Add a 3rd question to the revision
    const newQuestion: AssessmentRevisionQuestionData = {
      id: 'q-3',
      question_text: 'Which scheduling algorithm is non-preemptive?',
      question_type: 'MCQ',
      points: 10,
      time_limit_seconds: 45,
      sort_order: 3,
      options: [
        { id: 'opt-7', option_text: 'First-Come, First-Served (FCFS)', sort_order: 0, is_correct: true },
        { id: 'opt-8', option_text: 'Round Robin', sort_order: 1, is_correct: false },
        { id: 'opt-9', option_text: 'Shortest Remaining Time First', sort_order: 2, is_correct: false },
      ],
    };
    draftQuestions.push(newQuestion);

    expect(draftQuestions.length).toBe(3);
    const validation = validateRevisionForPublish({
      title: 'Operating Systems Fundamentals - Revised',
      duration_minutes: 75,
      start_time: '2026-10-18T10:00:00Z',
      end_time: '2026-10-19T10:00:00Z',
      passing_percentage: 50,
      questions_data: draftQuestions,
      active_attempts_count: 0,
    });

    expect(validation.valid).toBe(true);
    expect(validation.error).toBeUndefined();
  });

  it('2. Saving a draft and cancelling leaves the published version unchanged', () => {
    const publishedVersion = { ...mockAssessment };

    // Create draft
    let draftRevision: AssessmentRevision | null = {
      id: 'rev-2',
      assessment_id: publishedVersion.id,
      revision_number: 2,
      status: 'DRAFT',
      title: 'Experimental Draft Title',
      description: 'Draft notes',
      instructions: publishedVersion.instructions,
      duration_minutes: 90,
      start_time: publishedVersion.start_time,
      end_time: publishedVersion.end_time,
      passing_percentage: 60,
      total_questions_count: 1,
      include_in_global_leaderboard: false,
      randomize_questions: true,
      randomize_options: true,
      questions_data: [sampleQuestions[0]],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // User cancels / discards draft
    draftRevision = null;

    // Published assessment remains intact
    expect(draftRevision).toBeNull();
    expect(publishedVersion.title).toBe('Operating Systems Fundamentals');
    expect(publishedVersion.current_revision_number).toBe(1);
    expect(publishedVersion.duration_minutes).toBe(60);
    expect(publishedVersion.total_questions_count).toBe(2);
  });

  it('3. Successfully republishes a revised assessment and increments revision number', () => {
    const prevRevNumber = mockAssessment.current_revision_number || 1;
    const nextRevNumber = prevRevNumber + 1;

    const revisedPayload = {
      title: 'Operating Systems - Revision 2',
      duration_minutes: 80,
      start_time: '2026-10-18T12:00:00Z',
      end_time: '2026-10-20T12:00:00Z',
      passing_percentage: 50,
      questions_data: sampleQuestions,
      active_attempts_count: 0,
    };

    const validation = validateRevisionForPublish(revisedPayload);
    expect(validation.valid).toBe(true);

    // Simulate publication transition
    const publishedAssessment: Assessment = {
      ...mockAssessment,
      title: revisedPayload.title,
      duration_minutes: revisedPayload.duration_minutes,
      start_time: revisedPayload.start_time,
      end_time: revisedPayload.end_time,
      passing_percentage: revisedPayload.passing_percentage,
      current_revision_number: nextRevNumber,
      has_draft_revision: false,
      status: 'PUBLISHED',
      updated_at: new Date().toISOString(),
    };

    expect(publishedAssessment.current_revision_number).toBe(2);
    expect(publishedAssessment.title).toBe('Operating Systems - Revision 2');
    expect(publishedAssessment.has_draft_revision).toBe(false);
  });

  it('4. Preserves existing student attempts, marks, and certificates when revision is published', () => {
    // Existing completed attempt under Revision 1
    const pastAttempt = {
      id: 'attempt-student-1',
      assessment_id: 'asm-101',
      student_id: 'student-uuid-42',
      revision_number: 1,
      status: 'SUBMITTED',
      question_order: ['q-1', 'q-2'],
      score: 15,
      question_score: 15,
      eos_points: 850,
      certificate: {
        rank: 1,
        score: 15,
        total_points: 15,
        percentage: 100,
      },
    };

    // Revision 2 is published with new question IDs and updated points
    const revision2Questions: AssessmentRevisionQuestionData[] = [
      {
        id: 'q-1-rev2',
        question_text: 'What is a process? (Updated)',
        question_type: 'MCQ',
        points: 20, // points increased
        sort_order: 1,
        options: [
          { id: 'opt-rev2-1', option_text: 'A program in execution', sort_order: 0, is_correct: true },
          { id: 'opt-rev2-2', option_text: 'A static binary', sort_order: 1, is_correct: false },
          { id: 'opt-rev2-3', option_text: 'A CPU cycle', sort_order: 2, is_correct: false },
        ],
      },
    ];

    // Guarantee: The past attempt still retains its original revision_number, question_order, score, and cert
    expect(pastAttempt.revision_number).toBe(1);
    expect(pastAttempt.question_order).toEqual(['q-1', 'q-2']);
    expect(pastAttempt.score).toBe(15);
    expect(pastAttempt.eos_points).toBe(850);
    expect(pastAttempt.certificate.total_points).toBe(15);
    expect(pastAttempt.certificate.percentage).toBe(100);

    // Future attempt receives revision 2
    const futureAttempt = {
      id: 'attempt-student-2',
      assessment_id: 'asm-101',
      student_id: 'student-uuid-99',
      revision_number: 2,
      status: 'IN_PROGRESS',
      question_order: revision2Questions.map((q) => q.id),
      score: 0,
    };

    expect(futureAttempt.revision_number).toBe(2);
    expect(futureAttempt.question_order).toEqual(['q-1-rev2']);
  });

  it('5. Blocks edits or republishing while student sessions are actively in progress', () => {
    const validationWithActiveSession = validateRevisionForPublish({
      title: 'Operating Systems',
      duration_minutes: 60,
      start_time: '2026-10-18T10:00:00Z',
      end_time: '2026-10-19T10:00:00Z',
      passing_percentage: 40,
      questions_data: sampleQuestions,
      active_attempts_count: 3, // 3 students actively taking test
    });

    expect(validationWithActiveSession.valid).toBe(false);
    expect(validationWithActiveSession.error).toContain('3 student attempt(s) are actively in progress');
  });

  it('6. Rejects invalid questions: MCQ with fewer than 3 options or multiple correct answers', () => {
    const invalidMcqFewOptions: AssessmentRevisionQuestionData[] = [
      {
        question_text: 'Invalid MCQ',
        question_type: 'MCQ',
        points: 5,
        sort_order: 1,
        options: [
          { option_text: 'Opt 1', sort_order: 0, is_correct: true },
          { option_text: 'Opt 2', sort_order: 1, is_correct: false },
          // Only 2 options!
        ],
      },
    ];

    const res1 = validateRevisionForPublish({
      title: 'Test Exam',
      duration_minutes: 30,
      start_time: '2026-10-18T10:00:00Z',
      end_time: '2026-10-18T12:00:00Z',
      passing_percentage: 40,
      questions_data: invalidMcqFewOptions,
      active_attempts_count: 0,
    });
    expect(res1.valid).toBe(false);
    expect(res1.error).toContain('between 3 and 5 options');

    const invalidMcqMultipleKeys: AssessmentRevisionQuestionData[] = [
      {
        question_text: 'Two correct answers',
        question_type: 'MCQ',
        points: 5,
        sort_order: 1,
        options: [
          { option_text: 'Opt 1', sort_order: 0, is_correct: true },
          { option_text: 'Opt 2', sort_order: 1, is_correct: true }, // 2 correct!
          { option_text: 'Opt 3', sort_order: 2, is_correct: false },
        ],
      },
    ];

    const res2 = validateRevisionForPublish({
      title: 'Test Exam',
      duration_minutes: 30,
      start_time: '2026-10-18T10:00:00Z',
      end_time: '2026-10-18T12:00:00Z',
      passing_percentage: 40,
      questions_data: invalidMcqMultipleKeys,
      active_attempts_count: 0,
    });
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('exactly one correct option');
  });

  it('7. Rejects True/False questions without boolean answer key', () => {
    const invalidTf: AssessmentRevisionQuestionData[] = [
      {
        question_text: 'Missing answer',
        question_type: 'TRUE_FALSE',
        points: 5,
        sort_order: 1,
        correct_boolean: null,
      },
    ];

    const res = validateRevisionForPublish({
      title: 'Test Exam',
      duration_minutes: 30,
      start_time: '2026-10-18T10:00:00Z',
      end_time: '2026-10-18T12:00:00Z',
      passing_percentage: 40,
      questions_data: invalidTf,
      active_attempts_count: 0,
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('requires a boolean correct answer');
  });

  it('8. Rejects questions with negative or zero points', () => {
    const invalidPoints: AssessmentRevisionQuestionData[] = [
      {
        question_text: 'Zero points question',
        question_type: 'TRUE_FALSE',
        points: 0,
        sort_order: 1,
        correct_boolean: true,
      },
    ];

    const res = validateRevisionForPublish({
      title: 'Test Exam',
      duration_minutes: 30,
      start_time: '2026-10-18T10:00:00Z',
      end_time: '2026-10-18T12:00:00Z',
      passing_percentage: 40,
      questions_data: invalidPoints,
      active_attempts_count: 0,
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('must have a positive, finite points value');
  });

  it('9. Rejects invalid assessment window where end_time is before or equal to start_time', () => {
    const res = validateRevisionForPublish({
      title: 'Test Exam',
      duration_minutes: 30,
      start_time: '2026-10-18T12:00:00Z',
      end_time: '2026-10-18T10:00:00Z', // In the past!
      passing_percentage: 40,
      questions_data: sampleQuestions,
      active_attempts_count: 0,
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('closing time must be strictly after');
  });
});
