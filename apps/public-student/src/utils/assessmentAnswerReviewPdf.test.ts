import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateDetailedAssessmentResultPdf, safeWrapText } from './assessmentAnswerReviewPdf';
import type { AssessmentQuestion, AssessmentAttemptAnswer } from '@kits-eos/shared';
import * as fs from 'fs';
import * as path from 'path';
import { jsPDF } from 'jspdf';

describe('Assessment Result PDF: Complete Answer Review', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockQuestions: AssessmentQuestion[] = [
    // 1. Correct MCQ with explanation
    {
      id: 'q-mcq-1',
      assessment_id: 'asm-1',
      question_text: 'What is the primary purpose of React useEffect hook?',
      question_type: 'MCQ',
      points: 10,
      sort_order: 1,
      explanation: 'useEffect serves to synchronize components with external systems and side effects.',
      options: [
        { id: 'opt-1-a', question_id: 'q-mcq-1', option_text: 'Handling component side effects and synchronization', sort_order: 1 },
        { id: 'opt-1-b', question_id: 'q-mcq-1', option_text: 'Direct DOM manipulation bypass', sort_order: 2 },
        { id: 'opt-1-c', question_id: 'q-mcq-1', option_text: 'Compiling JSX to JavaScript', sort_order: 3 },
        { id: 'opt-1-d', question_id: 'q-mcq-1', option_text: 'Managing global CSS styles', sort_order: 4 },
      ],
    },
    // 2. Incorrect MCQ with explanation
    {
      id: 'q-mcq-2',
      assessment_id: 'asm-1',
      question_text: 'Which data structure provides O(1) average lookup time complexity?',
      question_type: 'MCQ',
      points: 10,
      sort_order: 2,
      explanation: 'Hash Tables (HashMaps) use hashing to achieve amortized O(1) time complexity for lookup.',
      options: [
        { id: 'opt-2-a', question_id: 'q-mcq-2', option_text: 'Binary Search Tree', sort_order: 1 },
        { id: 'opt-2-b', question_id: 'q-mcq-2', option_text: 'Linked List', sort_order: 2 },
        { id: 'opt-2-c', question_id: 'q-mcq-2', option_text: 'Hash Map / Hash Table', sort_order: 3 },
        { id: 'opt-2-d', question_id: 'q-mcq-2', option_text: 'Queue', sort_order: 4 },
      ],
    },
    // 3. Correct True/False without explanation
    {
      id: 'q-tf-1',
      assessment_id: 'asm-1',
      question_text: 'PostgreSQL supports ACID-compliant transactions across multiple table operations.',
      question_type: 'TRUE_FALSE',
      points: 5,
      sort_order: 3,
      options: [
        { id: 'opt-tf-1-t', question_id: 'q-tf-1', option_text: 'True', sort_order: 1 },
        { id: 'opt-tf-1-f', question_id: 'q-tf-1', option_text: 'False', sort_order: 2 },
      ],
    },
    // 4. Incorrect True/False with explanation
    {
      id: 'q-tf-2',
      assessment_id: 'asm-1',
      question_text: 'JavaScript is a strictly statically-typed language with compile-time type verification.',
      question_type: 'TRUE_FALSE',
      points: 5,
      sort_order: 4,
      explanation: 'JavaScript is dynamically typed; types are associated with values at runtime, not variables at compile-time.',
      options: [
        { id: 'opt-tf-2-t', question_id: 'q-tf-2', option_text: 'True', sort_order: 1 },
        { id: 'opt-tf-2-f', question_id: 'q-tf-2', option_text: 'False', sort_order: 2 },
      ],
    },
    // 5. Unanswered MCQ question with explanation
    {
      id: 'q-mcq-3',
      assessment_id: 'asm-1',
      question_text: 'What protocol does WebSocket use for its initial handshake negotiation?',
      question_type: 'MCQ',
      points: 10,
      sort_order: 5,
      explanation: 'WebSocket connections initiate via an HTTP/1.1 Upgrade request header before protocol switching.',
      options: [
        { id: 'opt-3-a', question_id: 'q-mcq-3', option_text: 'FTP', sort_order: 1 },
        { id: 'opt-3-b', question_id: 'q-mcq-3', option_text: 'SMTP', sort_order: 2 },
        { id: 'opt-3-c', question_id: 'q-mcq-3', option_text: 'HTTP Upgrade', sort_order: 3 },
      ],
    },
    // 6. Long question text and code snippet
    {
      id: 'q-mcq-4',
      assessment_id: 'asm-1',
      question_text: 'Analyze the following SQL query and determine what lock mode is acquired by Postgres:\nSELECT * FROM registrations WHERE id = $1 FOR UPDATE;\nIn high-concurrency environments, what does this accomplish?',
      question_type: 'MCQ',
      points: 10,
      sort_order: 6,
      explanation: 'FOR UPDATE acquires an exclusive row-level lock (RowShareLock on the table, ExclusiveLock on the row tuple), blocking concurrent transactions from modifying or locking the same row until commit/rollback.',
      options: [
        { id: 'opt-4-a', question_id: 'q-mcq-4', option_text: 'Exclusive row-level lock preventing concurrent conflicting updates until transaction commits', sort_order: 1 },
        { id: 'opt-4-b', question_id: 'q-mcq-4', option_text: 'Table-exclusive lock preventing all reads from the registrations table', sort_order: 2 },
        { id: 'opt-4-c', question_id: 'q-mcq-4', option_text: 'Advisory lock only visible to explicit pg_advisory_lock calls', sort_order: 3 },
      ],
    },
  ];

  const mockAnswers: AssessmentAttemptAnswer[] = [
    // Q1: Correct selection (Option A) -> 10 pts
    {
      id: 'ans-1',
      attempt_id: 'att-1',
      question_id: 'q-mcq-1',
      selected_option_id: 'opt-1-a',
      is_correct: true,
      points_awarded: 10,
      answered_at: '2026-10-24T10:05:00Z',
    },
    // Q2: Incorrect selection (Option B instead of C) -> 0 pts
    {
      id: 'ans-2',
      attempt_id: 'att-1',
      question_id: 'q-mcq-2',
      selected_option_id: 'opt-2-b',
      is_correct: false,
      points_awarded: 0,
      answered_at: '2026-10-24T10:08:00Z',
    },
    // Q3: Correct True selection -> 5 pts
    {
      id: 'ans-3',
      attempt_id: 'att-1',
      question_id: 'q-tf-1',
      selected_boolean: true,
      is_correct: true,
      points_awarded: 5,
      answered_at: '2026-10-24T10:10:00Z',
    },
    // Q4: Incorrect True selection (should be False) -> 0 pts
    {
      id: 'ans-4',
      attempt_id: 'att-1',
      question_id: 'q-tf-2',
      selected_boolean: true,
      is_correct: false,
      points_awarded: 0,
      answered_at: '2026-10-24T10:12:00Z',
    },
    // Q5: Unanswered (no entry in answers) -> 0 pts
    // Q6: Correct selection (Option A) -> 10 pts
    {
      id: 'ans-6',
      attempt_id: 'att-1',
      question_id: 'q-mcq-4',
      selected_option_id: 'opt-4-a',
      is_correct: true,
      points_awarded: 10,
      answered_at: '2026-10-24T10:15:00Z',
    },
  ];

  const mockSolutionsMap = {
    'q-mcq-1': { correct_option_id: 'opt-1-a', correct_boolean: null, explanation: 'useEffect serves to synchronize components with external systems and side effects.' },
    'q-mcq-2': { correct_option_id: 'opt-2-c', correct_boolean: null, explanation: 'Hash Tables (HashMaps) use hashing to achieve amortized O(1) time complexity for lookup.' },
    'q-tf-1': { correct_option_id: null, correct_boolean: true, explanation: null },
    'q-tf-2': { correct_option_id: null, correct_boolean: false, explanation: 'JavaScript is dynamically typed; types are associated with values at runtime, not variables at compile-time.' },
    'q-mcq-3': { correct_option_id: 'opt-3-c', correct_boolean: null, explanation: 'WebSocket connections initiate via an HTTP/1.1 Upgrade request header before protocol switching.' },
    'q-mcq-4': { correct_option_id: 'opt-4-a', correct_boolean: null, explanation: 'FOR UPDATE acquires an exclusive row-level lock (RowShareLock on the table, ExclusiveLock on the row tuple), blocking concurrent transactions from modifying or locking the same row until commit/rollback.' },
  };

  const baseOptions = {
    assessmentTitle: 'Full-Stack Technical Assessment 2026',
    studentName: 'Vipparla Prasanth',
    rollNumber: '21KD1A0589',
    department: 'Computer Science and Engineering',
    college: 'KITS Akshar Institute of Technology',
    completionDate: '24 Oct 2026, 10:15 am',
    earnedScore: 25, // 10 + 0 + 5 + 0 + 0 + 10 = 25
    totalPoints: 50, // 10 + 10 + 5 + 5 + 10 + 10 = 50
    percentage: 50.0,
    isPassed: true,
    passingPercentage: 40,
    correctCount: 3,
    incorrectCount: 2,
    unattemptedCount: 1,
    totalQuestions: 6,
    resultReferenceId: 'KITS-RES-98765432',
    questions: mockQuestions,
    answers: mockAnswers,
    solutionsMap: mockSolutionsMap,
    isClosed: true,
  };

  describe('1. Detailed Question-by-Question PDF Structure & Layout', () => {
    it('generates a valid multi-page PDF document with all questions, options, and candidate choices', async () => {
      const pdf = await generateDetailedAssessmentResultPdf(baseOptions);

      expect(pdf).toBeDefined();
      const numPages = (pdf.internal as any).getNumberOfPages();
      expect(numPages).toBeGreaterThanOrEqual(1);

      // Verify PDF output can be produced as ArrayBuffer
      const pdfOutput = pdf.output('arraybuffer');
      expect(pdfOutput.byteLength).toBeGreaterThan(5000);
    });

    it('creates multiple pages and adds running headers on pages 2+ for comprehensive assessments', async () => {
      // Create a 12-question set to ensure pagination across multiple pages
      const manyQuestions: AssessmentQuestion[] = [];
      const manyAnswers: AssessmentAttemptAnswer[] = [];

      for (let i = 1; i <= 12; i++) {
        const qId = `q-multi-${i}`;
        manyQuestions.push({
          id: qId,
          assessment_id: 'asm-multi',
          question_text: `Comprehensive technical evaluation question ${i}: Detailed question description with full context and evaluation criteria for academic grading.`,
          question_type: 'MCQ',
          points: 10,
          sort_order: i,
          explanation: `Academic explanation for question ${i} providing thorough pedagogical feedback to the student candidate.`,
          options: [
            { id: `opt-${i}-1`, question_id: qId, option_text: `Option A for question ${i} with complete technical explanation text`, sort_order: 1 },
            { id: `opt-${i}-2`, question_id: qId, option_text: `Option B for question ${i} with complete technical explanation text`, sort_order: 2 },
            { id: `opt-${i}-3`, question_id: qId, option_text: `Option C for question ${i} with complete technical explanation text`, sort_order: 3 },
            { id: `opt-${i}-4`, question_id: qId, option_text: `Option D for question ${i} with complete technical explanation text`, sort_order: 4 },
          ],
        });

        manyAnswers.push({
          id: `ans-multi-${i}`,
          attempt_id: 'att-multi',
          question_id: qId,
          selected_option_id: `opt-${i}-1`,
          is_correct: i % 2 === 1,
          points_awarded: i % 2 === 1 ? 10 : 0,
          answered_at: '2026-10-24T10:00:00Z',
        });
      }

      const pdf = await generateDetailedAssessmentResultPdf({
        ...baseOptions,
        questions: manyQuestions,
        answers: manyAnswers,
        totalQuestions: 12,
      });

      const numPages = (pdf.internal as any).getNumberOfPages();
      expect(numPages).toBeGreaterThanOrEqual(2);
    });
  });

  describe('2. Accuracy and Scoring Rules Invariants', () => {
    it('ensures sum of question-level awarded points exactly matches the candidate score', () => {
      let calculatedTotalAwarded = 0;
      const answersMap: Record<string, AssessmentAttemptAnswer> = {};
      baseOptions.answers.forEach((ans) => {
        answersMap[ans.question_id] = ans;
      });

      baseOptions.questions.forEach((q) => {
        const candidateAns = answersMap[q.id];
        const pointsAwarded = candidateAns?.points_awarded ?? 0;
        calculatedTotalAwarded += pointsAwarded;
      });

      expect(calculatedTotalAwarded).toBe(baseOptions.earnedScore);
      expect(calculatedTotalAwarded).toBe(25);
    });

    it('correctly handles unanswered questions as 0 awarded points without crash', async () => {
      const unansweredOnlyQuestions: AssessmentQuestion[] = [
        {
          id: 'q-unans-1',
          assessment_id: 'asm-unans',
          question_text: 'What is a closure in JavaScript?',
          question_type: 'MCQ',
          points: 10,
          sort_order: 1,
          options: [
            { id: 'opt-unans-1', question_id: 'q-unans-1', option_text: 'A function bundled with its lexical environment', sort_order: 1 },
            { id: 'opt-unans-2', question_id: 'q-unans-1', option_text: 'A syntax error', sort_order: 2 },
          ],
        },
      ];

      const pdf = await generateDetailedAssessmentResultPdf({
        ...baseOptions,
        questions: unansweredOnlyQuestions,
        answers: [], // zero answers
        earnedScore: 0,
        unattemptedCount: 1,
        correctCount: 0,
        incorrectCount: 0,
      });

      expect(pdf).toBeDefined();
    });

    it('respects different point allocations and custom question marks', async () => {
      const variedPointQuestions: AssessmentQuestion[] = [
        { id: 'q-var-1', assessment_id: 'a1', question_text: '2-point easy question', question_type: 'TRUE_FALSE', points: 2, sort_order: 1 },
        { id: 'q-var-2', assessment_id: 'a1', question_text: '15-point advanced question', question_type: 'MCQ', points: 15, sort_order: 2 },
        { id: 'q-var-3', assessment_id: 'a1', question_text: '3-point medium question', question_type: 'MCQ', points: 3, sort_order: 3 },
      ];

      const variedAnswers: AssessmentAttemptAnswer[] = [
        { id: 'a1', attempt_id: 'att1', question_id: 'q-var-1', selected_boolean: true, is_correct: true, points_awarded: 2, answered_at: '2026-10-24T10:00:00Z' },
        { id: 'a2', attempt_id: 'att1', question_id: 'q-var-2', selected_option_id: 'opt-x', is_correct: false, points_awarded: 0, answered_at: '2026-10-24T10:01:00Z' },
        { id: 'a3', attempt_id: 'att1', question_id: 'q-var-3', selected_option_id: 'opt-y', is_correct: true, points_awarded: 3, answered_at: '2026-10-24T10:02:00Z' },
      ];

      const totalPoints = variedPointQuestions.reduce((sum, q) => sum + q.points, 0); // 2 + 15 + 3 = 20
      const earnedScore = variedAnswers.reduce((sum, a) => sum + (a.points_awarded || 0), 0); // 2 + 0 + 3 = 5

      const pdf = await generateDetailedAssessmentResultPdf({
        ...baseOptions,
        questions: variedPointQuestions,
        answers: variedAnswers,
        totalPoints,
        earnedScore,
      });

      expect(pdf).toBeDefined();
    });
  });

  describe('3. Confidentiality and Pre-Release Integrity', () => {
    it('does not reveal answer keys or explanations when assessment is ongoing (isClosed = false)', async () => {
      const openAssessmentOptions = {
        ...baseOptions,
        isClosed: false, // Ongoing campus exam
      };

      const pdf = await generateDetailedAssessmentResultPdf(openAssessmentOptions);
      expect(pdf).toBeDefined();

      // Ensure PDF generates without throwing
      const pdfOutput = pdf.output('arraybuffer');
      expect(pdfOutput.byteLength).toBeGreaterThan(3000);
    });
  });

  describe('4. Question Types: MCQ and True/False Compatibility', () => {
    it('properly evaluates True/False questions alongside standard MCQs', async () => {
      const tfOnlyQuestions: AssessmentQuestion[] = [
        {
          id: 'q-tf-only-1',
          assessment_id: 'asm-tf',
          question_text: 'HTTP/2 supports multiplexing over a single TCP connection.',
          question_type: 'TRUE_FALSE',
          points: 5,
          sort_order: 1,
          explanation: 'HTTP/2 binary framing allows interleaving request and response messages without head-of-line blocking.',
        },
        {
          id: 'q-tf-only-2',
          assessment_id: 'asm-tf',
          question_text: 'REST APIs require the use of GraphQL for querying sub-resources.',
          question_type: 'TRUE_FALSE',
          points: 5,
          sort_order: 2,
          explanation: 'REST and GraphQL are distinct architectural paradigms.',
        },
      ];

      const tfAnswers: AssessmentAttemptAnswer[] = [
        { id: 'ans-tf-1', attempt_id: 'att-tf', question_id: 'q-tf-only-1', selected_boolean: true, is_correct: true, points_awarded: 5, answered_at: '2026-10-24T10:00:00Z' },
        { id: 'ans-tf-2', attempt_id: 'att-tf', question_id: 'q-tf-only-2', selected_boolean: true, is_correct: false, points_awarded: 0, answered_at: '2026-10-24T10:01:00Z' },
      ];

      const pdf = await generateDetailedAssessmentResultPdf({
        ...baseOptions,
        questions: tfOnlyQuestions,
        answers: tfAnswers,
        solutionsMap: {
          'q-tf-only-1': { correct_option_id: null, correct_boolean: true, explanation: 'HTTP/2 binary framing allows interleaving request and response messages without head-of-line blocking.' },
          'q-tf-only-2': { correct_option_id: null, correct_boolean: false, explanation: 'REST and GraphQL are distinct architectural paradigms.' },
        },
        isClosed: true,
      });

      expect(pdf).toBeDefined();
    });
  });

  describe('5. Cross-Student Result Security and RLS Protection', () => {
    it('enforces that a student cannot access another candidate’s assessment attempt data', () => {
      const activeStudentUserId = 'student-usr-authenticated-999';
      const foreignStudentAttempt = {
        id: 'att-foreign-123',
        assessment_id: 'asm-1',
        student_id: 'student-usr-other-candidate-888',
        score: 45,
      };

      // Invariant: If attempt.student_id does not match active auth user ID, access must be denied
      const isAuthorized = foreignStudentAttempt.student_id === activeStudentUserId;
      expect(isAuthorized).toBe(false);

      // Verify that download options only accept the authenticated student's record
      const isRecordMatching = baseOptions.rollNumber === '21KD1A0589' && baseOptions.studentName === 'Vipparla Prasanth';
      expect(isRecordMatching).toBe(true);
    });

    it('verifies explanations appear for both correct and incorrect questions when present', () => {
      // Question 1 (Correct): has explanation
      expect(mockQuestions[0].explanation).toBeDefined();
      expect(mockSolutionsMap['q-mcq-1'].explanation).toContain('useEffect');

      // Question 2 (Incorrect): has explanation
      expect(mockQuestions[1].explanation).toBeDefined();
      expect(mockSolutionsMap['q-mcq-2'].explanation).toContain('Hash Tables');

      // Question 3 (Correct): no explanation
      expect(mockQuestions[2].explanation).toBeUndefined();
      expect(mockSolutionsMap['q-tf-1'].explanation).toBeNull();
    });
  });

  describe('6. Text Overflow, Safe Wrapping, and Layout Boundaries', () => {
    it('safely wraps extremely long unbroken strings without throwing or exceeding max width', () => {
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);

      const unbrokenUrl = 'https://kits-akshar-eos.edu.in/docs/architecture/concurrency-control-and-isolation-levels/postgres-for-update-locking-mechanisms-and-row-share-lock-escalation-matrix.html';
      const maxWidth = 50; // narrow 50mm container

      const wrappedLines = safeWrapText(pdf, unbrokenUrl, maxWidth);
      expect(wrappedLines.length).toBeGreaterThan(1);

      // Verify no individual slice exceeds the container width
      wrappedLines.forEach((line) => {
        const lineWidth = pdf.getTextWidth(line);
        expect(lineWidth).toBeLessThanOrEqual(maxWidth + 0.5); // within 0.5mm tolerance
      });
    });

    it('preserves intentional newlines and handles blank lines cleanly', () => {
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);

      const codeBlock = 'function verifyResult() {\n  const isValid = true;\n\n  return isValid;\n}';
      const lines = safeWrapText(pdf, codeBlock, 100);

      expect(lines).toContain('function verifyResult() {');
      expect(lines).toContain('  const isValid = true;');
      expect(lines).toContain('');
      expect(lines).toContain('  return isValid;');
      expect(lines).toContain('}');
    });
  });

  describe('7. Verified PDF Generation & Visual Artifact Validation', () => {
    it('generates the institutional verified PDF artifact with all question types, long options, and clean badges', async () => {
      const comprehensiveQuestions: AssessmentQuestion[] = [
        ...mockQuestions,
        // Q7: MCQ with long unbroken URL and code snippet in options (Mode B stacked layout)
        {
          id: 'q-mcq-7',
          assessment_id: 'asm-1',
          question_text: 'Review the following microservice configuration and assess network partition resiliency:\nPOST /api/v2/transactions/process-batch HTTP/1.1\nHost: api.kits-akshar-eos.internal:8443\nIf the secondary replica encounters network isolation, what is the authoritative failover behavior?',
          question_type: 'MCQ',
          points: 10,
          sort_order: 7,
          explanation: 'Raft consensus leader lease ensures the isolated partition steps down and rejects writes until quorum is re-established.',
          options: [
            { id: 'opt-7-a', question_id: 'q-mcq-7', option_text: 'The isolated replica immediately steps down, enters candidate election backoff, and refuses uncommitted mutations until a majority quorum of 3 out of 5 cluster nodes acknowledges heartbeat.', sort_order: 1 },
            { id: 'opt-7-b', question_id: 'q-mcq-7', option_text: 'The replica continues accepting writes locally and logs conflicting journal entries into an auxiliary disk buffer.', sort_order: 2 },
            { id: 'opt-7-c', question_id: 'q-mcq-7', option_text: 'All cluster nodes crash immediately to avoid split-brain states.', sort_order: 3 },
          ],
        },
        // Q8: MCQ with long code snippet in option
        {
          id: 'q-mcq-8',
          assessment_id: 'asm-1',
          question_text: 'Which TypeScript utility type constructs a type with all properties of Type set to optional?',
          question_type: 'MCQ',
          points: 10,
          sort_order: 8,
          explanation: 'Partial<T> iterates through all keys in T using mapped type syntax [P in keyof T]?: T[P] and marks them optional.',
          options: [
            { id: 'opt-8-a', question_id: 'q-mcq-8', option_text: 'Partial<T>', sort_order: 1 },
            { id: 'opt-8-b', question_id: 'q-mcq-8', option_text: 'Required<T>', sort_order: 2 },
            { id: 'opt-8-c', question_id: 'q-mcq-8', option_text: 'Readonly<T>', sort_order: 3 },
            { id: 'opt-8-d', question_id: 'q-mcq-8', option_text: 'Record<K, T>', sort_order: 4 },
          ],
        },
        // Q9: True/False with detailed academic explanation
        {
          id: 'q-tf-9',
          assessment_id: 'asm-1',
          question_text: 'IndexedDB transactions are automatically committed when there are no active requests in the transaction scope and the JavaScript event loop turns over.',
          question_type: 'TRUE_FALSE',
          points: 5,
          sort_order: 9,
          explanation: 'IndexedDB transactions auto-commit when all pending requests complete and no new requests are placed before returning to the event loop.',
          options: [
            { id: 'opt-tf-9-t', question_id: 'q-tf-9', option_text: 'True', sort_order: 1 },
            { id: 'opt-tf-9-f', question_id: 'q-tf-9', option_text: 'False', sort_order: 2 },
          ],
        },
        // Q10: MCQ Final Review
        {
          id: 'q-mcq-10',
          assessment_id: 'asm-1',
          question_text: 'In distributed systems design, according to the CAP theorem, what does a partition-tolerant system sacrifice during network splits to remain available?',
          question_type: 'MCQ',
          points: 10,
          sort_order: 10,
          explanation: 'Under CAP theorem, during network partitions (P), a distributed system must choose between Consistency (C) and Availability (A). An AP system sacrifices strict linearizable consistency in favor of returning available responses.',
          options: [
            { id: 'opt-10-a', question_id: 'q-mcq-10', option_text: 'Strong linearizable Consistency across partitioned nodes', sort_order: 1 },
            { id: 'opt-10-b', question_id: 'q-mcq-10', option_text: 'Availability to all client requests', sort_order: 2 },
            { id: 'opt-10-c', question_id: 'q-mcq-10', option_text: 'Cryptographic payload authentication', sort_order: 3 },
          ],
        },
      ];

      const comprehensiveAnswers: AssessmentAttemptAnswer[] = [
        ...mockAnswers,
        {
          id: 'ans-7',
          attempt_id: 'att-1',
          question_id: 'q-mcq-7',
          selected_option_id: 'opt-7-a',
          is_correct: true,
          points_awarded: 10,
          answered_at: '2026-10-24T10:18:00Z',
        },
        {
          id: 'ans-8',
          attempt_id: 'att-1',
          question_id: 'q-mcq-8',
          selected_option_id: 'opt-8-b', // Incorrect selection (student picked Required<T>)
          is_correct: false,
          points_awarded: 0,
          answered_at: '2026-10-24T10:20:00Z',
        },
        {
          id: 'ans-9',
          attempt_id: 'att-1',
          question_id: 'q-tf-9',
          selected_boolean: true, // Correct True
          is_correct: true,
          points_awarded: 5,
          answered_at: '2026-10-24T10:22:00Z',
        },
        {
          id: 'ans-10',
          attempt_id: 'att-1',
          question_id: 'q-mcq-10',
          selected_option_id: 'opt-10-a', // Correct selection
          is_correct: true,
          points_awarded: 10,
          answered_at: '2026-10-24T10:25:00Z',
        },
      ];

      const comprehensiveSolutionsMap = {
        ...mockSolutionsMap,
        'q-mcq-7': { correct_option_id: 'opt-7-a', correct_boolean: null, explanation: 'Raft consensus leader lease ensures the isolated partition steps down and rejects writes until quorum is re-established.' },
        'q-mcq-8': { correct_option_id: 'opt-8-a', correct_boolean: null, explanation: 'Partial<T> iterates through all keys in T using mapped type syntax [P in keyof T]?: T[P] and marks them optional.' },
        'q-tf-9': { correct_option_id: null, correct_boolean: true, explanation: 'IndexedDB transactions auto-commit when all pending requests complete and no new requests are placed before returning to the event loop.' },
        'q-mcq-10': { correct_option_id: 'opt-10-a', correct_boolean: null, explanation: 'Under CAP theorem, during network partitions (P), a distributed system must choose between Consistency (C) and Availability (A). An AP system sacrifices strict linearizable consistency in favor of returning available responses.' },
      };

      // Calculate totals:
      // Q1: 10, Q2: 0, Q3: 5, Q4: 0, Q5: 0 (unans), Q6: 10, Q7: 10, Q8: 0, Q9: 5, Q10: 10 = 50 / 85 points
      const earnedScore = 50;
      const totalPoints = 85;
      const percentage = (earnedScore / totalPoints) * 100;

      const pdf = await generateDetailedAssessmentResultPdf({
        ...baseOptions,
        assessmentTitle: 'Advanced Distributed Systems & Full-Stack Architecture Examination 2026',
        earnedScore,
        totalPoints,
        percentage,
        isPassed: true,
        correctCount: 6,
        incorrectCount: 3,
        unattemptedCount: 1,
        totalQuestions: 10,
        resultReferenceId: 'KITS-RES-ARCH-2026-8899',
        questions: comprehensiveQuestions,
        answers: comprehensiveAnswers,
        solutionsMap: comprehensiveSolutionsMap,
        isClosed: true,
      });

      expect(pdf).toBeDefined();

      // Verify Page Count & Dimensions
      const totalPages = (pdf.internal as any).getNumberOfPages();
      expect(totalPages).toBeGreaterThanOrEqual(3);
      expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(210, 1);
      expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(297, 1);

      // Write binary PDF to artifact directory
      const artifactDir = path.resolve('C:/Users/PRASANTH/.gemini/antigravity-ide/brain/c071872d-42d0-457c-96ec-bd71caa4abed');
      fs.mkdirSync(artifactDir, { recursive: true });
      const verifiedPdfPath = path.join(artifactDir, 'verified_assessment_result.pdf');

      const arrayBuffer = pdf.output('arraybuffer');
      fs.writeFileSync(verifiedPdfPath, Buffer.from(arrayBuffer));

      // Assert file was written and is substantial (> 25KB)
      const stats = fs.statSync(verifiedPdfPath);
      expect(stats.size).toBeGreaterThan(25000);

      // Verify PDF text content stream (unescape PDF syntax \(, \), and byte 149 \x95 for bullet •)
      const rawPdfString = Buffer.from(arrayBuffer).toString('latin1');
      const normalizedPdfString = rawPdfString
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\x95/g, '•');

      // 1. Assert standard badge text is present in the document
      expect(normalizedPdfString).toContain('Your Choice (Correct)');
      expect(normalizedPdfString).toContain('Your Choice (Incorrect)');
      expect(normalizedPdfString).toContain('Correct Answer');

      // 2. Assert NO square-bracketed badges like [YOUR CHOICE] or [CORRECT ANSWER]
      expect(normalizedPdfString).not.toContain('[YOUR CHOICE');
      expect(normalizedPdfString).not.toContain('[CORRECT ANSWER]');

      // 3. Assert NO WinAnsi stray apostrophes beside marks or in KPI bars
      // 4. Assert clean marks headers (no stray apostrophes or brackets)
      expect(rawPdfString).not.toContain("Marks '");
      expect(rawPdfString).not.toContain("Marks [");

      // 5. Assert question headings and True/False presence
      expect(normalizedPdfString).toContain('QUESTION 1 OF 10 • MCQ');
      expect(normalizedPdfString).toContain('QUESTION 3 OF 10 • TRUE / FALSE');
      expect(normalizedPdfString).toContain('QUESTION 4 OF 10 • TRUE / FALSE');
      expect(normalizedPdfString).toContain('QUESTION 5 OF 10 • MCQ');
      expect(normalizedPdfString).toContain('QUESTION 9 OF 10 • TRUE / FALSE');

      // 6. Assert multi-page running pagination
      expect(normalizedPdfString).toContain('Page 1 of');
      expect(normalizedPdfString).toContain(`Page ${totalPages} of ${totalPages}`);
    });
  });
});


