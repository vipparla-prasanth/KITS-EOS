/**
 * Question Bank CSV Import / Export Utilities
 * 
 * Provides canonical CSV template generation, RFC-4180 compliant parsing,
 * schema validation, formula injection protection, Unicode/Telugu preservation,
 * and seamless roundtrip export for KITS-EOS assessments.
 */

import type { AssessmentQuestion, QuestionType } from '../types/models';

export const QUESTION_BANK_CSV_HEADERS = [
  'sort_order',
  'question_type',
  'question_text',
  'option_1',
  'option_2',
  'option_3',
  'option_4',
  'option_5',
  'correct_answer',
  'marks',
  'time_limit_seconds',
  'explanation',
] as const;

export type QuestionBankCsvHeader = typeof QUESTION_BANK_CSV_HEADERS[number];

export interface ParsedImportQuestion {
  sort_order: number;
  question_type: QuestionType;
  question_text: string;
  points: number;
  time_limit_seconds: number;
  explanation?: string;
  options: Array<{
    option_text: string;
    is_correct: boolean;
    sort_order: number;
  }>;
  correct_boolean?: boolean | null;
  marks_was_defaulted: boolean;
}

export interface QuestionBankImportRowError {
  rowNumber: number;
  questionTextSnippet?: string;
  field?: string;
  message: string;
}

export interface QuestionBankImportResult {
  isValid: boolean;
  totalRows: number;
  validQuestions: ParsedImportQuestion[];
  errors: QuestionBankImportRowError[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    defaultMarksAppliedCount: number;
  };
}

/**
 * Sanitizes a string for CSV formula injection (OWASP standard).
 * If the string starts with =, +, -, or @, prefix with a single quote.
 */
export function sanitizeCsvFormula(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Strips prepended formula sanitization character on import if present.
 */
export function desanitizeCsvFormula(value: string): string {
  if (value.startsWith("'") && /^[=+\-@\t\r]/.test(value.slice(1))) {
    return value.slice(1);
  }
  return value;
}

/**
 * Escapes a cell according to RFC 4180 rules.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Parses raw CSV text into a 2D array of strings respecting RFC 4180.
 * Handles multiline quoted cells, escaped quotes, Windows and Unix line endings.
 */
export function parseCsvRows(csvText: string): string[][] {
  // Strip UTF-8 BOM if present
  let cleanText = csvText;
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  let i = 0;
  const len = cleanText.length;

  while (i < len) {
    const char = cleanText[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && cleanText[i + 1] === '"') {
          // Escaped quote
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentCell += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentCell);
        currentCell = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < len && cleanText[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentCell);
        currentCell = '';
        if (currentRow.some((c) => c.trim().length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentCell);
        currentCell = '';
        if (currentRow.some((c) => c.trim().length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      } else {
        currentCell += char;
        i++;
        continue;
      }
    }
  }

  // Push final cell and row if non-empty
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    if (currentRow.some((c) => c.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Generates the canonical Question Bank CSV template.
 * Includes column documentation and exemplary rows for all supported question types.
 */
export function generateQuestionBankTemplateCsv(): string {
  const header = QUESTION_BANK_CSV_HEADERS.join(',');

  const sampleRows: (string | number)[][] = [
    // 1. Standard 4-option MCQ
    [
      1,
      'MCQ',
      'What is the worst-case time complexity of binary search on a sorted array of size n?',
      'O(1)',
      'O(log n)',
      'O(n)',
      'O(n log n)',
      '',
      2, // Option 2 (B) is correct
      5,
      30,
      'Binary search divides the search space in half at each logarithmic step.',
    ],
    // 2. 5-option MCQ with code snippet and quotation
    [
      2,
      'MCQ',
      'What is the output of the following C code snippet?\n#include <stdio.h>\nint main() {\n    int a = 5;\n    printf("%d", a++ + ++a);\n    return 0;\n}',
      '10',
      '11',
      '12',
      'Undefined behavior in C standard',
      'Compilation error',
      4,
      5,
      45,
      'Modifying a variable multiple times without an intervening sequence point invokes undefined behavior in standard C.',
    ],
    // 3. True / False question
    [
      3,
      'TRUE_FALSE',
      'In JavaScript, primitive strings and numbers are passed by value, not by reference.',
      'True',
      'False',
      '',
      '',
      '',
      'True',
      2,
      20,
      'Primitives in JavaScript are immutable and passed by value.',
    ],
    // 4. Unicode / Telugu multilingual question
    [
      4,
      'MCQ',
      'భారత రాజ్యాంగ నిర్మాత ఎవరు? (Who is known as the Chief Architect of the Indian Constitution?)',
      'మహాత్మా గాంధీ (Mahatma Gandhi)',
      'డా. బి. ఆర్. అంబేద్కర్ (Dr. B. R. Ambedkar)',
      'జవహర్‌లాల్ నెహ్రూ (Jawaharlal Nehru)',
      'సర్దార్ వల్లభ్‌భాయ్ పటేల్ (Sardar Vallabhbhai Patel)',
      '',
      2,
      4,
      30,
      'Dr. B. R. Ambedkar was the Chairman of the Drafting Committee of the Constituent Assembly.',
    ],
    // 5. Question with empty marks (illustrating automatic default marks application)
    [
      5,
      'MCQ',
      'Which SQL clause is used to filter records after aggregation with the GROUP BY clause?',
      'WHERE',
      'ORDER BY',
      'HAVING',
      'DISTINCT',
      '',
      3,
      '', // Empty marks -> configurable default marks applied automatically on import!
      30,
      'The HAVING clause filters groups after the aggregate functions have been computed.',
    ],
  ];

  const serializedRows = sampleRows.map((row) =>
    row.map((val) => escapeCsvCell(sanitizeCsvFormula(val))).join(',')
  );

  // Prepend UTF-8 Byte Order Mark (\uFEFF) for Microsoft Excel compatibility
  return '\uFEFF' + [header, ...serializedRows].join('\r\n') + '\r\n';
}

/**
 * Exports assessment questions to a canonical CSV string.
 * Includes correct answers and points for authorized administrators.
 */
export function exportQuestionsToCsv(
  questions: AssessmentQuestion[],
  assessmentTitle: string
): { filename: string; csvContent: string } {
  const header = QUESTION_BANK_CSV_HEADERS.join(',');

  const rows: string[] = [];

  const sortedQuestions = [...questions].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );

  sortedQuestions.forEach((q, index) => {
    const sortOrder = q.sort_order || index + 1;
    const qType: QuestionType = q.question_type || 'MCQ';
    const qText = q.question_text || '';
    const marks = q.points ?? 5;
    const timeLimit = q.time_limit_seconds ?? 30;
    const explanation = (q as any).explanation || '';

    let opt1 = '';
    let opt2 = '';
    let opt3 = '';
    let opt4 = '';
    let opt5 = '';
    let correctAnswerStr = '';

    if (qType === 'MCQ') {
      const opts = (q.options || []).slice(0, 5);
      opts.forEach((opt, idx) => {
        const text = opt.option_text || '';
        if (idx === 0) opt1 = text;
        else if (idx === 1) opt2 = text;
        else if (idx === 2) opt3 = text;
        else if (idx === 3) opt4 = text;
        else if (idx === 4) opt5 = text;

        if (opt.is_correct) {
          // Export 1-based index (e.g., 1, 2, 3, 4, 5)
          correctAnswerStr = String(idx + 1);
        }
      });
    } else if (qType === 'TRUE_FALSE') {
      opt1 = 'True';
      opt2 = 'False';
      if (q.correct_boolean === true) {
        correctAnswerStr = 'True';
      } else if (q.correct_boolean === false) {
        correctAnswerStr = 'False';
      } else {
        // Fallback: check options array if boolean key was stored in options
        const trueOpt = (q.options || []).find(
          (o) => o.option_text.trim().toLowerCase() === 'true' && o.is_correct
        );
        correctAnswerStr = trueOpt ? 'True' : 'False';
      }
    }

    const rowCells = [
      sortOrder,
      qType,
      qText,
      opt1,
      opt2,
      opt3,
      opt4,
      opt5,
      correctAnswerStr,
      marks,
      timeLimit,
      explanation,
    ];

    rows.push(rowCells.map((val) => escapeCsvCell(sanitizeCsvFormula(val))).join(','));
  });

  const cleanTitle = (assessmentTitle || 'assessment')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40);
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${cleanTitle}_question_bank_${dateStr}.csv`;

  const csvContent = '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';

  return { filename, csvContent };
}

/**
 * Parses and validates an uploaded question bank CSV text.
 */
export function parseQuestionBankCsv(
  csvText: string,
  options?: { defaultMarks?: number }
): QuestionBankImportResult {
  const configuredDefaultMarks = options?.defaultMarks ?? 5;
  const rawRows = parseCsvRows(csvText);

  if (rawRows.length === 0) {
    return {
      isValid: false,
      totalRows: 0,
      validQuestions: [],
      errors: [{ rowNumber: 0, message: 'The uploaded file is empty.' }],
      summary: { total: 0, valid: 0, invalid: 0, defaultMarksAppliedCount: 0 },
    };
  }

  // 1. Map and validate header row
  const rawHeader = rawRows[0].map((h) =>
    desanitizeCsvFormula(h.trim().toLowerCase().replace(/\s+/g, '_'))
  );

  const colIdx = {
    sort_order: rawHeader.indexOf('sort_order'),
    question_type: rawHeader.indexOf('question_type'),
    question_text: rawHeader.indexOf('question_text'),
    option_1: rawHeader.indexOf('option_1'),
    option_2: rawHeader.indexOf('option_2'),
    option_3: rawHeader.indexOf('option_3'),
    option_4: rawHeader.indexOf('option_4'),
    option_5: rawHeader.indexOf('option_5'),
    correct_answer: rawHeader.indexOf('correct_answer'),
    marks: rawHeader.indexOf('marks'),
    time_limit_seconds: rawHeader.indexOf('time_limit_seconds'),
    explanation: rawHeader.indexOf('explanation'),
  };

  // Check required header columns
  const missingHeaders: string[] = [];
  if (colIdx.question_type === -1) missingHeaders.push('question_type');
  if (colIdx.question_text === -1) missingHeaders.push('question_text');
  if (colIdx.correct_answer === -1) missingHeaders.push('correct_answer');

  if (missingHeaders.length > 0) {
    return {
      isValid: false,
      totalRows: rawRows.length - 1,
      validQuestions: [],
      errors: [
        {
          rowNumber: 1,
          message: `Missing required header column(s): ${missingHeaders.join(', ')}. Please use the canonical template format.`,
        },
      ],
      summary: { total: 0, valid: 0, invalid: 0, defaultMarksAppliedCount: 0 },
    };
  }

  const validQuestions: ParsedImportQuestion[] = [];
  const errors: QuestionBankImportRowError[] = [];
  let defaultMarksAppliedCount = 0;
  const seenQuestionTexts = new Set<string>();

  // Process data rows
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    const rowNum = r + 1; // 1-indexed spreadsheet row number

    const getCell = (idx: number): string => {
      if (idx === -1 || idx >= row.length) return '';
      return desanitizeCsvFormula(row[idx].trim());
    };

    const rawType = getCell(colIdx.question_type).toUpperCase();
    const qText = getCell(colIdx.question_text);
    const rawSortOrder = getCell(colIdx.sort_order);
    const rawMarks = getCell(colIdx.marks);
    const rawTimeLimit = getCell(colIdx.time_limit_seconds);
    const explanation = getCell(colIdx.explanation);
    const rawCorrect = getCell(colIdx.correct_answer);

    const textSnippet = qText.length > 40 ? `${qText.slice(0, 40)}...` : qText;

    // Validate Question Text
    if (!qText) {
      errors.push({
        rowNumber: rowNum,
        field: 'question_text',
        message: 'Question text cannot be empty.',
      });
      continue;
    }

    // Check duplicate in file
    const normalizedTextKey = qText.toLowerCase().replace(/\s+/g, ' ');
    if (seenQuestionTexts.has(normalizedTextKey)) {
      errors.push({
        rowNumber: rowNum,
        questionTextSnippet: textSnippet,
        field: 'question_text',
        message: 'Duplicate question text detected within the imported CSV file.',
      });
      continue;
    }
    seenQuestionTexts.add(normalizedTextKey);

    // Validate Question Type
    if (rawType !== 'MCQ' && rawType !== 'TRUE_FALSE') {
      errors.push({
        rowNumber: rowNum,
        questionTextSnippet: textSnippet,
        field: 'question_type',
        message: `Unsupported question type "${rawType}". Supported types are "MCQ" and "TRUE_FALSE".`,
      });
      continue;
    }

    // Validate Marks
    let points = configuredDefaultMarks;
    let marksWasDefaulted = false;
    if (rawMarks === '') {
      points = configuredDefaultMarks;
      marksWasDefaulted = true;
      defaultMarksAppliedCount++;
    } else {
      const parsedMarks = parseFloat(rawMarks);
      if (isNaN(parsedMarks) || parsedMarks < 0) {
        errors.push({
          rowNumber: rowNum,
          questionTextSnippet: textSnippet,
          field: 'marks',
          message: `Invalid marks value "${rawMarks}". Marks must be a non-negative number, or left empty to use the default.`,
        });
        continue;
      }
      points = parsedMarks;
    }

    // Validate Time Limit Seconds
    let timeLimit = 30;
    if (rawTimeLimit !== '') {
      const parsedTime = parseInt(rawTimeLimit, 10);
      if (isNaN(parsedTime) || parsedTime <= 0) {
        errors.push({
          rowNumber: rowNum,
          questionTextSnippet: textSnippet,
          field: 'time_limit_seconds',
          message: `Invalid time limit "${rawTimeLimit}". Must be a positive integer in seconds.`,
        });
        continue;
      }
      timeLimit = parsedTime;
    }

    // Validate Sort Order
    let sortOrder = validQuestions.length + 1;
    if (rawSortOrder !== '') {
      const parsedSort = parseInt(rawSortOrder, 10);
      if (!isNaN(parsedSort) && parsedSort > 0) {
        sortOrder = parsedSort;
      }
    }

    // Validate Options and Correct Answer according to Question Type
    if (rawType === 'MCQ') {
      const rawOptions = [
        getCell(colIdx.option_1),
        getCell(colIdx.option_2),
        getCell(colIdx.option_3),
        getCell(colIdx.option_4),
        getCell(colIdx.option_5),
      ].filter((opt) => opt.length > 0);

      if (rawOptions.length < 2) {
        errors.push({
          rowNumber: rowNum,
          questionTextSnippet: textSnippet,
          field: 'options',
          message: 'MCQ questions require at least 2 non-empty options (option_1 and option_2).',
        });
        continue;
      }

      if (!rawCorrect) {
        errors.push({
          rowNumber: rowNum,
          questionTextSnippet: textSnippet,
          field: 'correct_answer',
          message: 'Missing correct answer for MCQ question.',
        });
        continue;
      }

      // Resolve correct answer index (1-based: 1..5, letters: A..E, or matching option text)
      let correctIndex = -1;
      const parsedIndex = parseInt(rawCorrect, 10);
      if (!isNaN(parsedIndex) && parsedIndex >= 1 && parsedIndex <= rawOptions.length) {
        correctIndex = parsedIndex - 1;
      } else {
        // Check letter notation (A, B, C, D, E)
        const letterMatch = rawCorrect.toUpperCase();
        const letterMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
        if (letterMap[letterMatch] !== undefined && letterMap[letterMatch] < rawOptions.length) {
          correctIndex = letterMap[letterMatch];
        } else {
          // Check exact text match against options
          const matchIdx = rawOptions.findIndex(
            (opt) => opt.toLowerCase() === rawCorrect.toLowerCase()
          );
          if (matchIdx !== -1) {
            correctIndex = matchIdx;
          }
        }
      }

      if (correctIndex === -1) {
        errors.push({
          rowNumber: rowNum,
          questionTextSnippet: textSnippet,
          field: 'correct_answer',
          message: `Invalid correct answer "${rawCorrect}". Must be an option number (1-${rawOptions.length}), letter (A-${String.fromCharCode(64 + rawOptions.length)}), or exact option text.`,
        });
        continue;
      }

      const formattedOptions = rawOptions.map((optText, idx) => ({
        option_text: optText,
        is_correct: idx === correctIndex,
        sort_order: idx + 1,
      }));

      validQuestions.push({
        sort_order: sortOrder,
        question_type: 'MCQ',
        question_text: qText,
        points,
        time_limit_seconds: timeLimit,
        explanation: explanation || undefined,
        options: formattedOptions,
        correct_boolean: null,
        marks_was_defaulted: marksWasDefaulted,
      });
    } else if (rawType === 'TRUE_FALSE') {
      if (!rawCorrect) {
        errors.push({
          rowNumber: rowNum,
          questionTextSnippet: textSnippet,
          field: 'correct_answer',
          message: 'Missing correct answer for True/False question.',
        });
        continue;
      }

      const cleanBool = rawCorrect.toLowerCase();
      let boolValue: boolean | null = null;
      if (['true', 't', 'yes', 'y', '1'].includes(cleanBool)) {
        boolValue = true;
      } else if (['false', 'f', 'no', 'n', '0'].includes(cleanBool)) {
        boolValue = false;
      }

      if (boolValue === null) {
        errors.push({
          rowNumber: rowNum,
          questionTextSnippet: textSnippet,
          field: 'correct_answer',
          message: `Invalid True/False correct answer "${rawCorrect}". Use "True" or "False".`,
        });
        continue;
      }

      const tfOptions = [
        { option_text: 'True', is_correct: boolValue === true, sort_order: 1 },
        { option_text: 'False', is_correct: boolValue === false, sort_order: 2 },
      ];

      validQuestions.push({
        sort_order: sortOrder,
        question_type: 'TRUE_FALSE',
        question_text: qText,
        points,
        time_limit_seconds: timeLimit,
        explanation: explanation || undefined,
        options: tfOptions,
        correct_boolean: boolValue,
        marks_was_defaulted: marksWasDefaulted,
      });
    }
  }

  const totalEvaluated = rawRows.length - 1;
  const isAllValid = errors.length === 0 && validQuestions.length > 0;

  return {
    isValid: isAllValid,
    totalRows: totalEvaluated,
    validQuestions,
    errors,
    summary: {
      total: totalEvaluated,
      valid: validQuestions.length,
      invalid: errors.length,
      defaultMarksAppliedCount,
    },
  };
}
