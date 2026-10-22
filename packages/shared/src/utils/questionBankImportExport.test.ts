import { describe, it, expect } from 'vitest';
import {
  generateQuestionBankTemplateCsv,
  exportQuestionsToCsv,
  parseQuestionBankCsv,
  sanitizeCsvFormula,
  desanitizeCsvFormula,
  QUESTION_BANK_CSV_HEADERS,
} from './questionBankCsv';
import type { AssessmentQuestion } from '../types/models';

describe('Question Bank CSV Import / Export Suite', () => {
  describe('1. Canonical CSV Template Generation', () => {
    it('generates a valid CSV template containing the exact documented headers', () => {
      const template = generateQuestionBankTemplateCsv();
      expect(template.charCodeAt(0)).toBe(0xfeff); // UTF-8 Byte Order Mark

      const cleanTemplate = template.slice(1);
      const lines = cleanTemplate.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const headerLine = lines[0];

      QUESTION_BANK_CSV_HEADERS.forEach((h) => {
        expect(headerLine).toContain(h);
      });
    });

    it('includes sample rows for every supported question type (MCQ and TRUE_FALSE)', () => {
      const template = generateQuestionBankTemplateCsv();
      const parsed = parseQuestionBankCsv(template, { defaultMarks: 5 });

      expect(parsed.totalRows).toBeGreaterThanOrEqual(4);
      expect(parsed.errors.length).toBe(0);
      expect(parsed.isValid).toBe(true);

      const hasMcq = parsed.validQuestions.some((q) => q.question_type === 'MCQ');
      const hasTf = parsed.validQuestions.some((q) => q.question_type === 'TRUE_FALSE');
      expect(hasMcq).toBe(true);
      expect(hasTf).toBe(true);
    });

    it('correctly applies configurable default marks to template rows with empty marks', () => {
      const template = generateQuestionBankTemplateCsv();
      const parsedWith5 = parseQuestionBankCsv(template, { defaultMarks: 5 });
      const rowWithBlankMarks5 = parsedWith5.validQuestions.find((q) => q.marks_was_defaulted);
      expect(rowWithBlankMarks5).toBeDefined();
      expect(rowWithBlankMarks5?.points).toBe(5);

      const parsedWith10 = parseQuestionBankCsv(template, { defaultMarks: 10 });
      const rowWithBlankMarks10 = parsedWith10.validQuestions.find((q) => q.marks_was_defaulted);
      expect(rowWithBlankMarks10).toBeDefined();
      expect(rowWithBlankMarks10?.points).toBe(10);
    });
  });

  describe('2. OWASP Formula Injection Protection', () => {
    it('prepends single quote to cells beginning with =, +, -, @, \\t, \\r', () => {
      expect(sanitizeCsvFormula('=SUM(1+1)')).toBe("'=SUM(1+1)");
      expect(sanitizeCsvFormula('+100 points')).toBe("'+100 points");
      expect(sanitizeCsvFormula('-5 penalty')).toBe("'-5 penalty");
      expect(sanitizeCsvFormula('@username')).toBe("'@username");
      expect(sanitizeCsvFormula('Regular question')).toBe('Regular question');
    });

    it('strips leading quote on import when followed by formula trigger characters', () => {
      expect(desanitizeCsvFormula("'=SUM(1+1)")).toBe('=SUM(1+1)');
      expect(desanitizeCsvFormula("'+100 points")).toBe('+100 points');
      expect(desanitizeCsvFormula("'-5 penalty")).toBe('-5 penalty');
      expect(desanitizeCsvFormula("'@username")).toBe('@username');
      expect(desanitizeCsvFormula("'Regular text")).toBe("'Regular text");
    });
  });

  describe('3. Export Questions to CSV & Roundtrip Fidelity', () => {
    const mockQuestions: AssessmentQuestion[] = [
      {
        id: 'q1',
        assessment_id: 'asm-1',
        sort_order: 1,
        question_type: 'MCQ',
        question_text: 'Which algorithm finds the shortest path in a weighted graph without negative cycles?',
        points: 4,
        time_limit_seconds: 40,
        options: [
          { id: 'opt1', option_text: "Dijkstra's Algorithm", sort_order: 1, is_correct: true },
          { id: 'opt2', option_text: 'Depth First Search', sort_order: 2, is_correct: false },
          { id: 'opt3', option_text: 'Breadth First Search', sort_order: 3, is_correct: false },
          { id: 'opt4', option_text: "Kruskal's Algorithm", sort_order: 4, is_correct: false },
        ],
      },
      {
        id: 'q2',
        assessment_id: 'asm-1',
        sort_order: 2,
        question_type: 'TRUE_FALSE',
        question_text: 'HTTP/2 supports header compression using HPACK.',
        points: 2,
        time_limit_seconds: 25,
        correct_boolean: true,
      },
      {
        id: 'q3',
        assessment_id: 'asm-1',
        sort_order: 3,
        question_type: 'MCQ',
        question_text: 'భారత రాజ్యాంగం ఎప్పుడు అమలులోకి వచ్చింది? (When did the Constitution of India come into effect?)',
        points: 5,
        time_limit_seconds: 30,
        options: [
          { id: 'opt5', option_text: '15 ఆగస్టు 1947', sort_order: 1, is_correct: false },
          { id: 'opt6', option_text: '26 జనవరి 1950', sort_order: 2, is_correct: true },
          { id: 'opt7', option_text: '26 నవంబర్ 1949', sort_order: 3, is_correct: false },
        ],
      },
      {
        id: 'q4',
        assessment_id: 'asm-1',
        sort_order: 4,
        question_type: 'MCQ',
        question_text: 'What is printed by:\nint x = 10;\nprintf("%d", x);',
        points: 3,
        time_limit_seconds: 35,
        options: [
          { id: 'opt8', option_text: '10', sort_order: 1, is_correct: true },
          { id: 'opt9', option_text: '0', sort_order: 2, is_correct: false },
          { id: 'opt10', option_text: 'Garbage', sort_order: 3, is_correct: false },
        ],
      },
    ];

    it('exports assessment questions including correct answer keys for administrators', () => {
      const { filename, csvContent } = exportQuestionsToCsv(mockQuestions, 'Data Structures & Algorithms Final');
      expect(filename).toContain('data_structures');
      expect(filename).toContain('.csv');
      expect(csvContent.charCodeAt(0)).toBe(0xfeff); // BOM

      expect(csvContent).toContain("Dijkstra's Algorithm");
      expect(csvContent).toContain('26 జనవరి 1950');
      expect(csvContent).toContain('printf(""%d"", x);');
    });

    it('re-imports exported CSV with 100% preservation of types, options, keys, and points', () => {
      const { csvContent } = exportQuestionsToCsv(mockQuestions, 'Midterm Exam');
      const parsed = parseQuestionBankCsv(csvContent);

      expect(parsed.isValid).toBe(true);
      expect(parsed.errors.length).toBe(0);
      expect(parsed.validQuestions.length).toBe(mockQuestions.length);

      // Verify Question 1 (MCQ)
      const q1 = parsed.validQuestions[0];
      expect(q1.question_type).toBe('MCQ');
      expect(q1.points).toBe(4);
      expect(q1.time_limit_seconds).toBe(40);
      expect(q1.options.length).toBe(4);
      expect(q1.options[0].is_correct).toBe(true);
      expect(q1.options[0].option_text).toBe("Dijkstra's Algorithm");
      expect(q1.options[1].is_correct).toBe(false);

      // Verify Question 2 (TRUE_FALSE)
      const q2 = parsed.validQuestions[1];
      expect(q2.question_type).toBe('TRUE_FALSE');
      expect(q2.points).toBe(2);
      expect(q2.time_limit_seconds).toBe(25);
      expect(q2.correct_boolean).toBe(true);

      // Verify Question 3 (Telugu Unicode)
      const q3 = parsed.validQuestions[2];
      expect(q3.question_text).toContain('భారత రాజ్యాంగం');
      expect(q3.options[1].option_text).toBe('26 జనవరి 1950');
      expect(q3.options[1].is_correct).toBe(true);

      // Verify Question 4 (Multiline Code with Quotes)
      const q4 = parsed.validQuestions[3];
      expect(q4.question_text).toContain('printf("%d", x);');
      expect(q4.options[0].option_text).toBe('10');
      expect(q4.options[0].is_correct).toBe(true);
    });
  });

  describe('4. Parser Validation & Error Handling', () => {
    it('rejects CSV with missing required headers with clear message', () => {
      const invalidCsv = 'random_column,another_column\nval1,val2';
      const result = parseQuestionBankCsv(invalidCsv);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('Missing required header');
    });

    it('rejects unsupported question types with actionable row number', () => {
      const csv = `question_type,question_text,option_1,option_2,correct_answer,marks\nFILL_IN_BLANKS,The capital of India is ___,New Delhi,Mumbai,1,5`;
      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.rowNumber === 2 && e.message.includes('Unsupported question type'))).toBe(true);
    });

    it('rejects MCQ with fewer than 2 non-empty options', () => {
      const csv = `question_type,question_text,option_1,option_2,correct_answer,marks\nMCQ,Single option question,Only Option,,1,5`;
      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.rowNumber === 2 && e.message.includes('at least 2 non-empty options'))).toBe(true);
    });

    it('rejects invalid correct answer indices or letters for MCQ', () => {
      const csv = `question_type,question_text,option_1,option_2,correct_answer,marks\nMCQ,Which is correct?,Alpha,Beta,9,5`;
      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.rowNumber === 2 && e.field === 'correct_answer')).toBe(true);
    });

    it('detects duplicate question text within the uploaded CSV', () => {
      const csv = `question_type,question_text,option_1,option_2,correct_answer,marks\nMCQ,Duplicate Question?,A,B,1,5\nMCQ,Duplicate Question?,C,D,2,5`;
      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.rowNumber === 3 && e.message.includes('Duplicate question text'))).toBe(true);
      expect(result.validQuestions.length).toBe(1); // First occurrence is accepted
    });

    it('accepts option letters (A, B, C, D) and exact text matches for MCQ correct answer', () => {
      const csv = `question_type,question_text,option_1,option_2,option_3,correct_answer,marks\nMCQ,Test by letter,Red,Green,Blue,B,5\nMCQ,Test by text,Red,Green,Blue,Blue,5`;
      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.validQuestions.length).toBe(2);
      expect(result.validQuestions[0].options[1].is_correct).toBe(true); // Green (B)
      expect(result.validQuestions[1].options[2].is_correct).toBe(true); // Blue (Text)
    });
  });
});
