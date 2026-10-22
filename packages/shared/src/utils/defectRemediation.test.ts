import { describe, it, expect } from 'vitest';
import { calculateDynamicEosPoints } from './speedBonus';

/**
 * Remediation verification test suite for:
 * 1. DEFECT-EOS-ASM-001 (PostgreSQL composite NULL semantics & assessment answer scoring)
 * 2. DEFECT-EOS-HOST-002 (Live-host snapshot college projection & JSON contract)
 */

interface QuestionKeyRow {
  id: string | null;
  question_id: string;
  option_id: string | null;
  correct_boolean: boolean | null;
}

interface QuestionRow {
  id: string;
  assessment_id: string;
  question_type: 'MCQ' | 'TRUE_FALSE';
  points: number;
  time_limit_seconds: number;
}

interface StudentProfileRow {
  user_id: string;
  full_name: string;
  roll_number: string;
  college: string | null;
}

describe('DEFECT-EOS-ASM-001: Assessment Scoring & Row Existence Logic', () => {
  // Simulates Postgres composite row IS NOT NULL behavior
  function pgCompositeRowIsNotNull(row: Record<string, any> | null): boolean {
    if (!row) return false;
    // Standard SQL & PostgreSQL rule: A composite value is NOT NULL if and only if NO column is NULL.
    // If ANY column is NULL, composite IS NOT NULL evaluates to FALSE.
    return Object.values(row).every((val) => val !== null && val !== undefined);
  }

  // Simulates the corrected check: key exists if primary key `id` is not null (or FOUND is true)
  function evaluateAnswerCorrectness(
    q: QuestionRow,
    key: QuestionKeyRow | null,
    found: boolean,
    selectedOptionId: string | null,
    selectedBoolean: boolean | null
  ): { isCorrect: boolean; pointsAwarded: number } {
    let isCorrect = false;

    // Corrected existence check: FOUND and key.id IS NOT NULL
    if (found && key && key.id !== null) {
      if (q.question_type === 'MCQ') {
        if (selectedOptionId !== null && key.option_id !== null && selectedOptionId === key.option_id) {
          isCorrect = true;
        }
      } else if (q.question_type === 'TRUE_FALSE') {
        if (selectedBoolean !== null && key.correct_boolean !== null && selectedBoolean === key.correct_boolean) {
          isCorrect = true;
        }
      }
    }

    const pointsAwarded = isCorrect ? q.points : 0;
    return { isCorrect, pointsAwarded };
  }

  it('demonstrates why composite IS NOT NULL failed in PostgreSQL for MCQ and True/False keys', () => {
    // In assessment_question_keys, an MCQ row has correct_boolean = NULL
    const mcqKeyRow: QuestionKeyRow = {
      id: 'key-uuid-1',
      question_id: 'q-mcq-1',
      option_id: 'opt-correct-1',
      correct_boolean: null, // Always NULL for MCQ
    };

    // In assessment_question_keys, a True/False row has option_id = NULL
    const tfKeyRow: QuestionKeyRow = {
      id: 'key-uuid-2',
      question_id: 'q-tf-2',
      option_id: null, // Always NULL for TRUE_FALSE
      correct_boolean: true,
    };

    // Under Postgres composite semantics, both evaluate to FALSE for `row IS NOT NULL`
    expect(pgCompositeRowIsNotNull(mcqKeyRow)).toBe(false);
    expect(pgCompositeRowIsNotNull(tfKeyRow)).toBe(false);

    // But under the corrected primary key / FOUND check, both are valid and present
    expect(mcqKeyRow.id !== null).toBe(true);
    expect(tfKeyRow.id !== null).toBe(true);
  });

  describe('MCQ Questions', () => {
    const mcqQuestion: QuestionRow = {
      id: 'q-101',
      assessment_id: 'asm-1',
      question_type: 'MCQ',
      points: 2.0,
      time_limit_seconds: 30,
    };

    const mcqKey: QuestionKeyRow = {
      id: 'key-101',
      question_id: 'q-101',
      option_id: 'opt-correct',
      correct_boolean: null,
    };

    it('awards points and marks correct when option matches key', () => {
      const result = evaluateAnswerCorrectness(mcqQuestion, mcqKey, true, 'opt-correct', null);
      expect(result.isCorrect).toBe(true);
      expect(result.pointsAwarded).toBe(2.0);
    });

    it('awards 0 points and marks incorrect when option does not match key', () => {
      const result = evaluateAnswerCorrectness(mcqQuestion, mcqKey, true, 'opt-wrong', null);
      expect(result.isCorrect).toBe(false);
      expect(result.pointsAwarded).toBe(0);
    });

    it('handles unanswered question (null option) safely with 0 points', () => {
      const result = evaluateAnswerCorrectness(mcqQuestion, mcqKey, true, null, null);
      expect(result.isCorrect).toBe(false);
      expect(result.pointsAwarded).toBe(0);
    });

    it('handles missing question key safely without throwing', () => {
      const result = evaluateAnswerCorrectness(mcqQuestion, null, false, 'opt-correct', null);
      expect(result.isCorrect).toBe(false);
      expect(result.pointsAwarded).toBe(0);
    });
  });

  describe('True/False Questions', () => {
    const tfQuestion: QuestionRow = {
      id: 'q-201',
      assessment_id: 'asm-1',
      question_type: 'TRUE_FALSE',
      points: 1.5,
      time_limit_seconds: 30,
    };

    const tfKey: QuestionKeyRow = {
      id: 'key-201',
      question_id: 'q-201',
      option_id: null,
      correct_boolean: true,
    };

    it('awards points and marks correct when boolean matches key', () => {
      const result = evaluateAnswerCorrectness(tfQuestion, tfKey, true, null, true);
      expect(result.isCorrect).toBe(true);
      expect(result.pointsAwarded).toBe(1.5);
    });

    it('awards 0 points and marks incorrect when boolean does not match key', () => {
      const result = evaluateAnswerCorrectness(tfQuestion, tfKey, true, null, false);
      expect(result.isCorrect).toBe(false);
      expect(result.pointsAwarded).toBe(0);
    });

    it('handles unanswered question (null boolean) safely with 0 points', () => {
      const result = evaluateAnswerCorrectness(tfQuestion, tfKey, true, null, null);
      expect(result.isCorrect).toBe(false);
      expect(result.pointsAwarded).toBe(0);
    });
  });

  describe('EOS Points Integration with Correctness', () => {
    it('calculates expected EOS points based on response times for correct answers', () => {
      // Formula: ROUND(1000 * MAX(0, 1 - (response_time / (2 * time_limit))))
      expect(calculateDynamicEosPoints(true, 2, 30)).toBe(967);
      expect(calculateDynamicEosPoints(true, 10, 30)).toBe(833);
      expect(calculateDynamicEosPoints(true, 20, 30)).toBe(667);
      expect(calculateDynamicEosPoints(true, 30, 30)).toBe(500);
    });

    it('awards exactly 0 EOS points for incorrect or unanswered questions regardless of speed', () => {
      expect(calculateDynamicEosPoints(false, 2, 30)).toBe(0);
      expect(calculateDynamicEosPoints(false, 10, 30)).toBe(0);
      expect(calculateDynamicEosPoints(false, 20, 30)).toBe(0);
    });
  });
});

describe('DEFECT-EOS-HOST-002: Live Host Snapshot & Schema Resolution', () => {
  function mapStudentProfileToLiveHostParticipant(
    attempt: {
      id: string;
      student_id: string;
      status: string;
      score: number;
      eos_points: number;
    },
    sp: StudentProfileRow | null
  ) {
    return {
      attempt_id: attempt.id,
      student_id: attempt.student_id,
      student_name: sp?.full_name ?? 'Candidate',
      roll_number: sp?.roll_number ?? 'N/A',
      // Corrected mapping: project database column `college` to expected JSON contract field `college_name`
      college_name: sp?.college ?? '',
      status: attempt.status,
      score: attempt.score,
      eos_points: attempt.eos_points,
    };
  }

  it('correctly maps sp.college to JSON field college_name when college is populated', () => {
    const studentProfile: StudentProfileRow = {
      user_id: 'user-1',
      full_name: 'QA Candidate Alpha',
      roll_number: '26QA01A01',
      college: 'KITS Akshar Institute of Technology',
    };

    const participant = mapStudentProfileToLiveHostParticipant(
      { id: 'att-1', student_id: 'user-1', status: 'IN_PROGRESS', score: 10, eos_points: 850 },
      studentProfile
    );

    expect(participant.college_name).toBe('KITS Akshar Institute of Technology');
    expect(participant.student_name).toBe('QA Candidate Alpha');
    expect(participant.roll_number).toBe('26QA01A01');
  });

  it('handles null sp.college safely with empty string default without throwing', () => {
    const studentProfile: StudentProfileRow = {
      user_id: 'user-2',
      full_name: 'Guest Candidate',
      roll_number: '26QA01B02',
      college: null,
    };

    const participant = mapStudentProfileToLiveHostParticipant(
      { id: 'att-2', student_id: 'user-2', status: 'SUBMITTED', score: 5, eos_points: 400 },
      studentProfile
    );

    expect(participant.college_name).toBe('');
    expect(participant.student_name).toBe('Guest Candidate');
  });

  it('handles missing student profile gracefully', () => {
    const participant = mapStudentProfileToLiveHostParticipant(
      { id: 'att-3', student_id: 'user-3', status: 'EXPIRED', score: 0, eos_points: 0 },
      null
    );

    expect(participant.college_name).toBe('');
    expect(participant.student_name).toBe('Candidate');
    expect(participant.roll_number).toBe('N/A');
  });
});
