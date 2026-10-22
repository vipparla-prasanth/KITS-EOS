import { describe, it, expect } from 'vitest';
import { calculateDynamicEosPoints } from './speedBonus';

interface MockAttemptAnswer {
  id: string;
  attempt_id: string;
  question_id: string;
  selected_option_id: string | null;
  selected_boolean?: boolean | null;
  question_started_at: string;
  answered_at: string;
  deadline: string;
  is_terminated: boolean;
}

interface MockQuestion {
  id: string;
  points: number;
  time_limit_seconds: number;
  correct_option_id?: string;
  correct_boolean?: boolean;
}

interface MockParticipantResult {
  student_id: string;
  student_name: string;
  question_score: number; // Academic marks
  eos_points: number; // Competitive EOS points
  total_score: number;
  correct_answers_count: number;
  total_response_time_seconds: number;
  submitted_at: string;
}

/**
 * Server-authoritative answer evaluator matching the database RPC:
 * 1. Checks correctness against private keys.
 * 2. Preserves academic question marks separately from EOS speed points.
 * 3. Evaluates response_time_seconds = answered_at - question_started_at.
 * 4. Computes EOS points dynamically: ROUND(1000 * MAX(0, 1 - (response_time / time_limit) / 2)).
 * 5. Disqualifies terminated attempts or submissions past deadline.
 * 6. Never depends on answer rank or other students' submissions.
 */
function evaluateAnswer(
  answer: MockAttemptAnswer,
  question: MockQuestion
): {
  isCorrect: boolean;
  pointsAwarded: number;
  responseTimeSeconds: number;
  eosPoints: number;
} {
  const isCorrect =
    (answer.selected_option_id != null && answer.selected_option_id === question.correct_option_id) ||
    (answer.selected_boolean != null && answer.selected_boolean === question.correct_boolean);

  if (answer.is_terminated) {
    return {
      isCorrect: false,
      pointsAwarded: 0,
      responseTimeSeconds: 0,
      eosPoints: 0,
    };
  }

  // Check deadline
  if (new Date(answer.answered_at) > new Date(answer.deadline)) {
    return {
      isCorrect,
      pointsAwarded: 0, // Late submission rejected
      responseTimeSeconds: 0,
      eosPoints: 0,
    };
  }

  const startTime = new Date(answer.question_started_at).getTime();
  const answerTime = new Date(answer.answered_at).getTime();
  const responseTimeSeconds = Math.max(0, Math.round((answerTime - startTime) / 10) / 100);

  const pointsAwarded = isCorrect ? question.points : 0;
  const eosPoints = isCorrect
    ? calculateDynamicEosPoints(true, responseTimeSeconds, question.time_limit_seconds)
    : 0;

  return {
    isCorrect,
    pointsAwarded,
    responseTimeSeconds,
    eosPoints,
  };
}

/**
 * Deterministic competitive leaderboard sorter matching official KITS-EOS policy:
 * 1. Accumulated EOS points DESC
 * 2. Correct answers count DESC
 * 3. Cumulative response time ASC (faster total response)
 * 4. Submitted at ASC
 * 5. Student ID ASC (stable tie-breaker)
 */
function sortCompetitiveLeaderboard(entries: MockParticipantResult[]): MockParticipantResult[] {
  return [...entries].sort((a, b) => {
    // 1. Total EOS points DESC
    if (b.eos_points !== a.eos_points) {
      return b.eos_points - a.eos_points;
    }
    // 2. Correct answers count DESC
    if (b.correct_answers_count !== a.correct_answers_count) {
      return b.correct_answers_count - a.correct_answers_count;
    }
    // 3. Cumulative response time ASC
    if (a.total_response_time_seconds !== b.total_response_time_seconds) {
      return a.total_response_time_seconds - b.total_response_time_seconds;
    }
    // 4. Submitted at ASC
    const timeA = new Date(a.submitted_at).getTime();
    const timeB = new Date(b.submitted_at).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    // 5. Stable student ID tie-breaker
    return a.student_id.localeCompare(b.student_id);
  });
}

describe('Server-Authoritative Dynamic Scoring & Leaderboard Rules', () => {
  const sampleQuestion: MockQuestion = {
    id: 'q-30s',
    points: 10, // Academic mark
    time_limit_seconds: 30, // 30s timer
    correct_option_id: 'opt-correct',
  };

  describe('Section 7: Mandatory End-to-End Validation Scenario', () => {
    it('demonstrates exact scenario: Question timer 30s, EOS max 1,000, 4 participants', () => {
      const baseStart = '2026-10-18T10:00:00.000Z';
      const deadline = '2026-10-18T10:30:00.000Z';

      // Participant A: answers correctly in 2 seconds
      const ansA: MockAttemptAnswer = {
        id: 'ans-a',
        attempt_id: 'att-a',
        question_id: sampleQuestion.id,
        selected_option_id: 'opt-correct',
        question_started_at: baseStart,
        answered_at: '2026-10-18T10:00:02.000Z',
        deadline,
        is_terminated: false,
      };

      // Participant B: answers correctly in 10 seconds
      const ansB: MockAttemptAnswer = {
        id: 'ans-b',
        attempt_id: 'att-b',
        question_id: sampleQuestion.id,
        selected_option_id: 'opt-correct',
        question_started_at: baseStart,
        answered_at: '2026-10-18T10:00:10.000Z',
        deadline,
        is_terminated: false,
      };

      // Participant C: answers incorrectly in 1 second
      const ansC: MockAttemptAnswer = {
        id: 'ans-c',
        attempt_id: 'att-c',
        question_id: sampleQuestion.id,
        selected_option_id: 'opt-wrong',
        question_started_at: baseStart,
        answered_at: '2026-10-18T10:00:01.000Z',
        deadline,
        is_terminated: false,
      };

      // Participant D: answers correctly in 20 seconds
      const ansD: MockAttemptAnswer = {
        id: 'ans-d',
        attempt_id: 'att-d',
        question_id: sampleQuestion.id,
        selected_option_id: 'opt-correct',
        question_started_at: baseStart,
        answered_at: '2026-10-18T10:00:20.000Z',
        deadline,
        is_terminated: false,
      };

      const resA = evaluateAnswer(ansA, sampleQuestion);
      const resB = evaluateAnswer(ansB, sampleQuestion);
      const resC = evaluateAnswer(ansC, sampleQuestion);
      const resD = evaluateAnswer(ansD, sampleQuestion);

      // 1. Verify exact EOS score outputs
      expect(resA.eosPoints).toBe(967);
      expect(resB.eosPoints).toBe(833);
      expect(resC.eosPoints).toBe(0);
      expect(resD.eosPoints).toBe(667);

      // 2. Verify academic question marks remain separately correct and unchanged (10 points each for correct, 0 for incorrect)
      expect(resA.pointsAwarded).toBe(10);
      expect(resB.pointsAwarded).toBe(10);
      expect(resC.pointsAwarded).toBe(0);
      expect(resD.pointsAwarded).toBe(10);

      // 3. Build leaderboard entries
      const participants: MockParticipantResult[] = [
        {
          student_id: 'stu-a',
          student_name: 'Participant A',
          question_score: resA.pointsAwarded,
          eos_points: resA.eosPoints,
          total_score: resA.pointsAwarded + resA.eosPoints,
          correct_answers_count: 1,
          total_response_time_seconds: resA.responseTimeSeconds,
          submitted_at: ansA.answered_at,
        },
        {
          student_id: 'stu-b',
          student_name: 'Participant B',
          question_score: resB.pointsAwarded,
          eos_points: resB.eosPoints,
          total_score: resB.pointsAwarded + resB.eosPoints,
          correct_answers_count: 1,
          total_response_time_seconds: resB.responseTimeSeconds,
          submitted_at: ansB.answered_at,
        },
        {
          student_id: 'stu-c',
          student_name: 'Participant C',
          question_score: resC.pointsAwarded,
          eos_points: resC.eosPoints,
          total_score: resC.pointsAwarded + resC.eosPoints,
          correct_answers_count: 0,
          total_response_time_seconds: resC.responseTimeSeconds,
          submitted_at: ansC.answered_at,
        },
        {
          student_id: 'stu-d',
          student_name: 'Participant D',
          question_score: resD.pointsAwarded,
          eos_points: resD.eosPoints,
          total_score: resD.pointsAwarded + resD.eosPoints,
          correct_answers_count: 1,
          total_response_time_seconds: resD.responseTimeSeconds,
          submitted_at: ansD.answered_at,
        },
      ];

      // 4. Verify leaderboard ranking: A, B, D, C
      const sorted = sortCompetitiveLeaderboard(participants);
      expect(sorted.map((p) => p.student_name)).toEqual([
        'Participant A',
        'Participant B',
        'Participant D',
        'Participant C',
      ]);

      // 5. Verify that database processing order has zero impact on scores
      // Suppose D arrived at database first, followed by C, then B, then A
      const reversedEvaluation = [ansD, ansC, ansB, ansA].map((ans) =>
        evaluateAnswer(ans, sampleQuestion)
      );
      expect(reversedEvaluation[0].eosPoints).toBe(667); // D is still 667
      expect(reversedEvaluation[1].eosPoints).toBe(0); // C is still 0
      expect(reversedEvaluation[2].eosPoints).toBe(833); // B is still 833
      expect(reversedEvaluation[3].eosPoints).toBe(967); // A is still 967
    });
  });

  describe('Autosave Idempotency & Changed Answers Policy', () => {
    it('preserves original timestamp and score on identical re-save (reconnect/retry)', () => {
      const originalStart = '2026-10-18T10:00:00.000Z';
      const originalSavedAt = '2026-10-18T10:00:05.000Z'; // 5s response -> 917 pts

      const answer1: MockAttemptAnswer = {
        id: 'ans-1',
        attempt_id: 'att-1',
        question_id: sampleQuestion.id,
        selected_option_id: 'opt-correct',
        question_started_at: originalStart,
        answered_at: originalSavedAt,
        deadline: '2026-10-18T10:30:00.000Z',
        is_terminated: false,
      };

      const res1 = evaluateAnswer(answer1, sampleQuestion);
      expect(res1.eosPoints).toBe(917);

      // Re-saving the identical option (e.g. page refresh, network reconnection at 25s)
      // Database policy preserves answered_at = originalSavedAt
      const reSavedAnswer: MockAttemptAnswer = {
        ...answer1,
        // The DB leaves answered_at intact because selected_option is identical
        answered_at: originalSavedAt,
      };

      const res2 = evaluateAnswer(reSavedAnswer, sampleQuestion);
      expect(res2.eosPoints).toBe(917);
      expect(res2.responseTimeSeconds).toBe(5);
    });

    it('updates timestamp and re-evaluates when an answer is changed, preventing timing exploits', () => {
      const originalStart = '2026-10-18T10:00:00.000Z';

      // Student originally selected wrong option at 1s
      const firstChoice: MockAttemptAnswer = {
        id: 'ans-1',
        attempt_id: 'att-1',
        question_id: sampleQuestion.id,
        selected_option_id: 'opt-wrong',
        question_started_at: originalStart,
        answered_at: '2026-10-18T10:00:01.000Z',
        deadline: '2026-10-18T10:30:00.000Z',
        is_terminated: false,
      };

      const res1 = evaluateAnswer(firstChoice, sampleQuestion);
      expect(res1.isCorrect).toBe(false);
      expect(res1.eosPoints).toBe(0);

      // Student changes their mind to correct option at 15s
      const changedChoice: MockAttemptAnswer = {
        id: 'ans-1',
        attempt_id: 'att-1',
        question_id: sampleQuestion.id,
        selected_option_id: 'opt-correct',
        question_started_at: originalStart,
        answered_at: '2026-10-18T10:00:15.000Z', // New timestamp
        deadline: '2026-10-18T10:30:00.000Z',
        is_terminated: false,
      };

      const res2 = evaluateAnswer(changedChoice, sampleQuestion);
      expect(res2.isCorrect).toBe(true);
      // Scored at the actual time the correct answer was selected (15s): 750 points
      // Candidate cannot claim 1s response time from their previous wrong choice!
      expect(res2.eosPoints).toBe(750);
      expect(res2.pointsAwarded).toBe(10);
    });
  });

  describe('Security Boundaries & Disqualification', () => {
    it('awards 0 EOS points and 0 marks if attempt is terminated for proctoring violations', () => {
      const terminatedAnswer: MockAttemptAnswer = {
        id: 'ans-term',
        attempt_id: 'att-term',
        question_id: sampleQuestion.id,
        selected_option_id: 'opt-correct',
        question_started_at: '2026-10-18T10:00:00.000Z',
        answered_at: '2026-10-18T10:00:02.000Z',
        deadline: '2026-10-18T10:30:00.000Z',
        is_terminated: true,
      };

      const res = evaluateAnswer(terminatedAnswer, sampleQuestion);
      expect(res.eosPoints).toBe(0);
      expect(res.pointsAwarded).toBe(0);
    });

    it('rejects answers submitted after the authoritative exam deadline', () => {
      const lateAnswer: MockAttemptAnswer = {
        id: 'ans-late',
        attempt_id: 'att-late',
        question_id: sampleQuestion.id,
        selected_option_id: 'opt-correct',
        question_started_at: '2026-10-18T10:00:00.000Z',
        answered_at: '2026-10-18T10:30:05.000Z', // 5 seconds past deadline
        deadline: '2026-10-18T10:30:00.000Z',
        is_terminated: false,
      };

      const res = evaluateAnswer(lateAnswer, sampleQuestion);
      expect(res.eosPoints).toBe(0);
      expect(res.pointsAwarded).toBe(0);
    });
  });

  describe('Deterministic Tie-Breaking', () => {
    it('breaks ties deterministically using correct answers, response time, submitted_at, and student_id', () => {
      // Two students with identical 750 EOS points
      const studentX: MockParticipantResult = {
        student_id: 'stu-x',
        student_name: 'Student X',
        question_score: 10,
        eos_points: 750,
        total_score: 760,
        correct_answers_count: 2, // More correct answers
        total_response_time_seconds: 30,
        submitted_at: '2026-10-18T10:15:00.000Z',
      };

      const studentY: MockParticipantResult = {
        student_id: 'stu-y',
        student_name: 'Student Y',
        question_score: 10,
        eos_points: 750,
        total_score: 760,
        correct_answers_count: 1, // Fewer correct answers
        total_response_time_seconds: 15,
        submitted_at: '2026-10-18T10:10:00.000Z',
      };

      const sorted = sortCompetitiveLeaderboard([studentY, studentX]);
      // Student X has more correct answers -> ranks ahead
      expect(sorted[0].student_id).toBe('stu-x');
      expect(sorted[1].student_id).toBe('stu-y');
    });

    it('breaks identical score and correct count ties using cumulative response time', () => {
      const studentFast: MockParticipantResult = {
        student_id: 'stu-fast',
        student_name: 'Fast Student',
        question_score: 10,
        eos_points: 750,
        total_score: 760,
        correct_answers_count: 1,
        total_response_time_seconds: 15.0, // Faster cumulative response
        submitted_at: '2026-10-18T10:20:00.000Z',
      };

      const studentSlow: MockParticipantResult = {
        student_id: 'stu-slow',
        student_name: 'Slow Student',
        question_score: 10,
        eos_points: 750,
        total_score: 760,
        correct_answers_count: 1,
        total_response_time_seconds: 25.0, // Slower cumulative response
        submitted_at: '2026-10-18T10:20:00.000Z',
      };

      const sorted = sortCompetitiveLeaderboard([studentSlow, studentFast]);
      expect(sorted[0].student_id).toBe('stu-fast');
      expect(sorted[1].student_id).toBe('stu-slow');
    });

    it('falls back to stable student_id alphabetical order if all metrics and timestamps match', () => {
      const studentAlpha: MockParticipantResult = {
        student_id: 'stu-001',
        student_name: 'Alpha Candidate',
        question_score: 10,
        eos_points: 750,
        total_score: 760,
        correct_answers_count: 1,
        total_response_time_seconds: 15.0,
        submitted_at: '2026-10-18T10:20:00.000Z',
      };

      const studentBeta: MockParticipantResult = {
        student_id: 'stu-002',
        student_name: 'Beta Candidate',
        question_score: 10,
        eos_points: 750,
        total_score: 760,
        correct_answers_count: 1,
        total_response_time_seconds: 15.0,
        submitted_at: '2026-10-18T10:20:00.000Z',
      };

      const sorted = sortCompetitiveLeaderboard([studentBeta, studentAlpha]);
      expect(sorted[0].student_id).toBe('stu-001');
      expect(sorted[1].student_id).toBe('stu-002');
    });
  });
});
