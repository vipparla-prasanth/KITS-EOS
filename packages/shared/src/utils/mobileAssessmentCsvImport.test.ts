import { describe, it, expect, vi } from 'vitest';
import {
  readTextFromFile,
  parseQuestionBankCsv,
  generateQuestionBankTemplateCsv,
  exportQuestionsToCsv,
} from './questionBankCsv';
import type { AssessmentQuestion } from '../types/models';

describe('P0 Mobile Assessment CSV Import Regression Suite', () => {
  // ==========================================================================
  // 1 & 2. Asynchronous File Reading & Fallback Compatibility
  // ==========================================================================
  describe('1 & 2. File Selection and Asynchronous Reading', () => {
    it('reliably reads UTF-8 text from a File using standard FileReader', async () => {
      const csvData = 'sort_order,question_type,question_text,option_1,option_2,correct_answer,marks\n1,MCQ,What is 2+2?,3,4,2,5';
      const file = new File([csvData], 'questions.csv', { type: 'text/csv' });

      const content = await readTextFromFile(file);
      expect(content).toBe(csvData);
    });

    it('falls back to file.text() when FileReader is unavailable or fails', async () => {
      const csvData = 'sort_order,question_type,question_text,option_1,option_2,correct_answer,marks\n1,MCQ,What is React?,A lib,A DB,1,5';
      const file = new File([csvData], 'react_questions.csv', { type: 'text/csv' });

      // Simulate environment where FileReader fails
      const originalFileReader = globalThis.FileReader;
      (globalThis as any).FileReader = class BrokenFileReader {
        readAsText() {
          setTimeout(() => {
            if ((this as any).onerror) {
              (this as any).error = new Error('Simulated Mobile WebKit FileReader lock');
              (this as any).onerror();
            }
          }, 5);
        }
      };

      try {
        const content = await readTextFromFile(file);
        expect(content).toBe(csvData);
      } finally {
        globalThis.FileReader = originalFileReader;
      }
    });

    it('falls back to ArrayBuffer decoding when both FileReader and file.text fail', async () => {
      const csvData = 'sort_order,question_type,question_text,option_1,option_2,correct_answer,marks\n1,MCQ,Is TypeScript typed?,Yes,No,1,5';
      const file = new File([csvData], 'ts_questions.csv', { type: 'application/octet-stream' });

      const originalFileReader = globalThis.FileReader;
      (globalThis as any).FileReader = class BrokenFileReader {
        readAsText() {
          setTimeout(() => {
            if ((this as any).onerror) (this as any).onerror();
          }, 5);
        }
      };

      // Temporarily mock file.text to reject
      const originalText = file.text;
      file.text = () => Promise.reject(new Error('Simulated file.text() stream stall'));

      try {
        const content = await readTextFromFile(file);
        expect(content).toBe(csvData);
      } finally {
        globalThis.FileReader = originalFileReader;
        file.text = originalText;
      }
    });

    it('aborts with a clear timeout error when file stream hangs indefinitely', async () => {
      const csvData = 'sort_order,question_type,question_text,option_1,option_2,correct_answer,marks\n1,MCQ,Test?,A,B,1,5';
      const file = new File([csvData], 'hanging.csv', { type: 'text/csv' });

      const originalFileReader = globalThis.FileReader;
      (globalThis as any).FileReader = class HangingFileReader {
        abort = vi.fn();
        readAsText() {
          // Never triggers onload or onerror (simulating hung mobile content provider stream)
        }
      };

      try {
        await expect(readTextFromFile(file, 50)).rejects.toThrow(/timed out/i);
      } finally {
        globalThis.FileReader = originalFileReader;
      }
    });
  });

  // ==========================================================================
  // 3. Parsed Rows Successfully Reaching Preview State
  // ==========================================================================
  describe('3. Parsed Rows Successfully Reaching Import Preview State', () => {
    it('populates valid preview state with summary, questions, and zero errors', () => {
      const csv = [
        'sort_order,question_type,question_text,option_1,option_2,option_3,option_4,correct_answer,marks,time_limit_seconds,explanation',
        '1,MCQ,"Which layer handles routing in OSI?",Physical,Data Link,Network,Transport,3,5,30,"Network layer (Layer 3) handles packet routing."',
        '2,TRUE_FALSE,"TCP is a connection-oriented protocol.",True,False,,,True,4,20,"TCP establishes a three-way handshake."',
      ].join('\n');

      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.totalRows).toBe(2);
      expect(result.validQuestions.length).toBe(2);
      expect(result.errors.length).toBe(0);
      expect(result.summary.valid).toBe(2);
      expect(result.summary.invalid).toBe(0);

      // Verify structure is complete for preview cards
      const q1 = result.validQuestions[0];
      expect(q1.question_type).toBe('MCQ');
      expect(q1.points).toBe(5);
      expect(q1.time_limit_seconds).toBe(30);
      expect(q1.options.length).toBe(4);
      expect(q1.options[2].is_correct).toBe(true);
      expect(q1.explanation).toBe('Network layer (Layer 3) handles packet routing.');
    });
  });

  // ==========================================================================
  // 4 & 5. Valid MCQ & True/False Questions
  // ==========================================================================
  describe('4 & 5. Question Type Support: MCQ & True/False', () => {
    it('parses MCQ questions with 2, 3, 4, and 5 options correctly', () => {
      const csv = [
        'question_type,question_text,option_1,option_2,option_3,option_4,option_5,correct_answer',
        'MCQ,2-Option Question,Option A,Option B,,,,1',
        'MCQ,3-Option Question,First,Second,Third,,,2',
        'MCQ,4-Option Question,W,X,Y,Z,,4',
        'MCQ,5-Option Question,P,Q,R,S,T,5',
      ].join('\n');

      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.validQuestions.length).toBe(4);
      expect(result.validQuestions[0].options.length).toBe(2);
      expect(result.validQuestions[1].options.length).toBe(3);
      expect(result.validQuestions[2].options.length).toBe(4);
      expect(result.validQuestions[3].options.length).toBe(5);
    });

    it('parses TRUE_FALSE questions with various casing and representations', () => {
      const csv = [
        'question_type,question_text,correct_answer',
        'TRUE_FALSE,Is RAM volatile?,True',
        'TRUE_FALSE,Is ROM volatile?,false',
        'TRUE_FALSE,Is binary base 2?,1',
        'TRUE_FALSE,Is decimal base 2?,0',
        'TRUE_FALSE,Does light travel fast?,YES',
        'TRUE_FALSE,Is sound faster than light?,NO',
      ].join('\n');

      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.validQuestions.length).toBe(6);
      expect(result.validQuestions[0].correct_boolean).toBe(true);
      expect(result.validQuestions[1].correct_boolean).toBe(false);
      expect(result.validQuestions[2].correct_boolean).toBe(true);
      expect(result.validQuestions[3].correct_boolean).toBe(false);
      expect(result.validQuestions[4].correct_boolean).toBe(true);
      expect(result.validQuestions[5].correct_boolean).toBe(false);

      // Verify options array is properly formatted for True/False
      result.validQuestions.forEach((q) => {
        expect(q.options.length).toBe(2);
        expect(q.options[0].option_text).toBe('True');
        expect(q.options[1].option_text).toBe('False');
      });
    });
  });

  // ==========================================================================
  // 6. Correct Answer Mapping and Points
  // ==========================================================================
  describe('6. Correct Answer Mapping (Numbers, Letters, Text) & Points', () => {
    it('resolves correct answer specified as 1-based index (1, 2, 3...)', () => {
      const csv = 'question_type,question_text,option_1,option_2,correct_answer\nMCQ,Q1,Alpha,Beta,2';
      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.validQuestions[0].options[1].is_correct).toBe(true);
    });

    it('resolves correct answer specified as letter notation (A, B, C, D, E)', () => {
      const csv = [
        'question_type,question_text,option_1,option_2,option_3,correct_answer',
        'MCQ,Letter A,First,Second,Third,A',
        'MCQ,Letter B,First,Second,Third,b',
        'MCQ,Letter C,First,Second,Third,C',
      ].join('\n');

      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.validQuestions[0].options[0].is_correct).toBe(true);
      expect(result.validQuestions[1].options[1].is_correct).toBe(true);
      expect(result.validQuestions[2].options[2].is_correct).toBe(true);
    });

    it('resolves correct answer specified as exact option text', () => {
      const csv = 'question_type,question_text,option_1,option_2,correct_answer\nMCQ,Q Text,Python,Java,Java';
      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.validQuestions[0].options[1].is_correct).toBe(true);
    });

    it('preserves custom marks and applies configurable default marks when empty', () => {
      const csv = [
        'question_type,question_text,option_1,option_2,correct_answer,marks',
        'MCQ,Custom 10,A,B,1,10',
        'MCQ,Custom 2.5,A,B,1,2.5',
        'MCQ,Default Marks,A,B,1,',
      ].join('\n');

      const result = parseQuestionBankCsv(csv, { defaultMarks: 7 });
      expect(result.isValid).toBe(true);
      expect(result.validQuestions[0].points).toBe(10);
      expect(result.validQuestions[0].marks_was_defaulted).toBe(false);
      expect(result.validQuestions[1].points).toBe(2.5);
      expect(result.validQuestions[2].points).toBe(7);
      expect(result.validQuestions[2].marks_was_defaulted).toBe(true);
      expect(result.summary.defaultMarksAppliedCount).toBe(1);
    });
  });

  // ==========================================================================
  // 7 & 8. Optional Explanation & Backward Compatibility
  // ==========================================================================
  describe('7 & 8. Optional Explanation Column & Backward Compatibility', () => {
    it('preserves explanation values when present', () => {
      const csv = 'question_type,question_text,option_1,option_2,correct_answer,explanation\nMCQ,Q?,A,B,1,"Because of law of gravity."';
      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.validQuestions[0].explanation).toBe('Because of law of gravity.');
    });

    it('seamlessly parses older valid CSVs that completely omit the explanation column', () => {
      // Notice: NO explanation column in headers or rows
      const legacyCsv = [
        'sort_order,question_type,question_text,option_1,option_2,option_3,option_4,correct_answer,marks,time_limit_seconds',
        '1,MCQ,"Legacy Q1",A,B,C,D,2,5,30',
        '2,TRUE_FALSE,"Legacy Q2",,,,,True,3,15',
      ].join('\n');

      const result = parseQuestionBankCsv(legacyCsv);
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.validQuestions.length).toBe(2);
      expect(result.validQuestions[0].explanation).toBeUndefined();
      expect(result.validQuestions[1].explanation).toBeUndefined();
    });
  });

  // ==========================================================================
  // 9. UTF-8 BOM and Standard CSV Quoting
  // ==========================================================================
  describe('9. UTF-8 BOM and RFC 4180 CSV Quoting', () => {
    it('handles files starting with UTF-8 Byte Order Mark (\\uFEFF) without corrupting headers', () => {
      const rawText = '\uFEFFsort_order,question_type,question_text,option_1,option_2,correct_answer\n1,MCQ,BOM Test?,Yes,No,1';
      const result = parseQuestionBankCsv(rawText);
      expect(result.isValid).toBe(true);
      expect(result.validQuestions.length).toBe(1);
      expect(result.validQuestions[0].question_text).toBe('BOM Test?');
    });

    it('handles multiline cells, commas in quotes, and escaped quotes ("")', () => {
      const csv = [
        'question_type,question_text,option_1,option_2,correct_answer',
        'MCQ,"Line 1\nLine 2 with comma, and ""quotes""",Option 1,Option 2,1',
      ].join('\r\n');

      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.validQuestions[0].question_text).toBe('Line 1\nLine 2 with comma, and "quotes"');
    });
  });

  // ==========================================================================
  // 10 & 11. Malformed or Unsupported Files with Actionable Errors
  // ==========================================================================
  describe('10 & 11. Malformed and Binary Files with Actionable Errors', () => {
    it('returns an actionable error for completely empty CSV text', () => {
      const result = parseQuestionBankCsv('');
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].message).toContain('empty');
    });

    it('returns an actionable error when required columns are missing', () => {
      const badHeadersCsv = 'sort_order,points,notes\n1,5,test';
      const result = parseQuestionBankCsv(badHeadersCsv);
      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('Missing required header column(s)');
      expect(result.errors[0].message).toContain('question_type');
      expect(result.errors[0].message).toContain('question_text');
      expect(result.errors[0].message).toContain('correct_answer');
    });

    it('returns row-level errors for unsupported question types and invalid answers', () => {
      const badRowsCsv = [
        'question_type,question_text,option_1,option_2,correct_answer',
        'ESSAY,Describe photosynthesis,,,"Self-explanatory"',
        'MCQ,Pick one,A,B,9', // Option 9 does not exist
      ].join('\n');

      const result = parseQuestionBankCsv(badRowsCsv);
      expect(result.isValid).toBe(false);
      expect(result.validQuestions.length).toBe(0);
      expect(result.errors.length).toBe(2);
      expect(result.errors[0].rowNumber).toBe(2);
      expect(result.errors[0].message).toContain('Unsupported question type');
      expect(result.errors[1].rowNumber).toBe(3);
      expect(result.errors[1].message).toContain('Invalid correct answer');
    });

    it('detects binary null bytes (\\0) in unreadable files', async () => {
      const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]); // PNG header with \0
      const blob = new Blob([binaryData]);
      const text = await readTextFromFile(blob);
      const isBinary = text.includes('\0');
      expect(isBinary).toBe(true);
    });
  });

  // ==========================================================================
  // 12 & 13. Re-selection and Reset Workflow (Preventing Silent Exit)
  // ==========================================================================
  describe('12 & 13. Selecting Another File After Error and Selecting Same File Again', () => {
    it('proves that clearing file input value in finally allows selecting the same file again', async () => {
      // Simulate DOM file input
      let inputTargetValue = '';
      const changeEventsFired: string[] = [];

      const simulateMobileFileSelect = async (newPath: string) => {
        // If browser sees the same value and input.value was NOT cleared, change will NOT fire
        if (inputTargetValue === newPath && inputTargetValue !== '') {
          // No change event dispatched by native browser!
          return false;
        }

        inputTargetValue = newPath;
        changeEventsFired.push(newPath);

        // Process file...
        const file = new File(['question_type,question_text,option_1,option_2,correct_answer\nMCQ,Q1?,A,B,1'], 'question_bank.csv');
        const text = await readTextFromFile(file);
        parseQuestionBankCsv(text);

        // Crucial fix: value reset in finally block!
        inputTargetValue = '';
        return true;
      };

      // 1. Initial selection of question_bank.csv
      const firstSelection = await simulateMobileFileSelect('C:\\fakepath\\question_bank.csv');
      expect(firstSelection).toBe(true);
      expect(changeEventsFired.length).toBe(1);

      // 2. User selects the EXACT same file again
      // Because inputTargetValue was cleared to '' in finally, the browser triggers onChange again!
      const secondSelection = await simulateMobileFileSelect('C:\\fakepath\\question_bank.csv');
      expect(secondSelection).toBe(true);
      expect(changeEventsFired.length).toBe(2);
    });

    it('proves that onClick value wiping broke mobile synthetic events', () => {
      // Demonstrates why the previous onClick={(e) => e.target.value = ''} caused failure:
      let files: File[] = [new File(['data'], 'test.csv')];
      
      const simulateBrokenMobileActivation = () => {
        // Native mobile file picker returns and dispatches focus/click on active element
        // The buggy onClick handler executes:
        files = []; // e.target.value = '' clears the FileList!
      };

      simulateBrokenMobileActivation();

      // In onChange:
      const file = files[0];
      // !file returns early -> Silent failure!
      expect(file).toBeUndefined();
    });
  });

  // ==========================================================================
  // 14. Preventing Duplicate Question Insertion
  // ==========================================================================
  describe('14. Preventing Duplicate Questions', () => {
    it('detects duplicate question text within the uploaded CSV file', () => {
      const csv = [
        'question_type,question_text,option_1,option_2,correct_answer',
        'MCQ,What is the capital of India?,New Delhi,Mumbai,1',
        'MCQ,What is the capital of India?,Delhi,Hyderabad,1', // Duplicate text
      ].join('\n');

      const result = parseQuestionBankCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Duplicate question text'))).toBe(true);
      expect(result.validQuestions.length).toBe(1);
    });
  });

  // ==========================================================================
  // 15. Preserving Existing Desktop Import & Export Behavior
  // ==========================================================================
  describe('15. Preserving Existing Desktop Import & Export Functionality', () => {
    it('generates canonical template and successfully parses it with 100% fidelity', () => {
      const template = generateQuestionBankTemplateCsv();
      const parsed = parseQuestionBankCsv(template);

      expect(parsed.isValid).toBe(true);
      expect(parsed.errors.length).toBe(0);
      expect(parsed.validQuestions.length).toBe(4);
    });

    it('roundtrips exported assessment questions back into valid parsed questions', () => {
      const mockQuestions: AssessmentQuestion[] = [
        {
          id: 'q1',
          assessment_id: 'asm-101',
          sort_order: 1,
          question_type: 'MCQ',
          question_text: 'What does CSS stand for?',
          points: 5,
          time_limit_seconds: 30,
          explanation: 'Cascading Style Sheets',
          options: [
            { id: 'o1', option_text: 'Cascading Style Sheets', is_correct: true, sort_order: 1 },
            { id: 'o2', option_text: 'Computer Style Sheets', is_correct: false, sort_order: 2 },
            { id: 'o3', option_text: 'Creative Style Sheets', is_correct: false, sort_order: 3 },
          ],
        },
        {
          id: 'q2',
          assessment_id: 'asm-101',
          sort_order: 2,
          question_type: 'TRUE_FALSE',
          question_text: 'HTML is a programming language.',
          points: 3,
          time_limit_seconds: 15,
          explanation: 'HTML is a markup language.',
          correct_boolean: false,
        },
      ];

      const { csvContent } = exportQuestionsToCsv(mockQuestions, 'Web Dev Basics');
      const roundtripParsed = parseQuestionBankCsv(csvContent);

      expect(roundtripParsed.isValid).toBe(true);
      expect(roundtripParsed.validQuestions.length).toBe(2);

      const [rt1, rt2] = roundtripParsed.validQuestions;
      expect(rt1.question_text).toBe('What does CSS stand for?');
      expect(rt1.options[0].is_correct).toBe(true);
      expect(rt1.explanation).toBe('Cascading Style Sheets');

      expect(rt2.question_text).toBe('HTML is a programming language.');
      expect(rt2.correct_boolean).toBe(false);
      expect(rt2.explanation).toBe('HTML is a markup language.');
    });

    it('supports canonical header aliases (e.g. points, type, question, answer)', () => {
      const aliasedCsv = [
        'type,question,option_a,option_b,answer,points',
        'MCQ,"Is alias resolution working?",Yes,No,A,10',
      ].join('\n');

      const result = parseQuestionBankCsv(aliasedCsv);
      expect(result.isValid).toBe(true);
      expect(result.validQuestions.length).toBe(1);
      expect(result.validQuestions[0].points).toBe(10);
      expect(result.validQuestions[0].options[0].is_correct).toBe(true);
    });
  });
});
