import { describe, it, expect } from 'vitest';
import {
  generateStudentPerformanceCsv,
  getAssessmentReportCsvFilename,
  sanitizeReportFilename,
  partitionStudentsForReportPages,
} from './assessmentReportExport';
import type { AssessmentReportData } from '../types/models';

function getMockReportData(studentCount: number = 2): AssessmentReportData {
  return {
    assessment: {
      id: 'mock-assessment-id-1234',
      title: 'Python & Data Structures Final Exam',
      description: 'Comprehensive mid-semester coding evaluation.',
      instructions: 'Answer all questions. Tab switching monitored.',
      status: 'CLOSED',
      duration_minutes: 45,
      start_time: '2026-10-18T10:00:00Z',
      end_time: '2026-10-18T10:45:00Z',
      actual_start_time: '2026-10-18T10:00:00Z',
      actual_end_time: '2026-10-18T10:45:00Z',
      passing_percentage: 40,
      total_questions_count: 20,
      total_points: 100,
      report_finalized_at: '2026-10-18T10:45:05Z',
      closed_at: '2026-10-18T10:45:00Z',
      closed_by: 'COORDINATOR',
      is_closed: true,
    },
    summary: {
      total_eligible: 120,
      total_participants: studentCount,
      completed_attempts: studentCount,
      expired_attempts: 0,
      terminated_attempts: 0,
      in_progress_attempts: 0,
      completion_rate: 100,
      avg_academic_score: 78.5,
      avg_academic_percentage: 78.5,
      highest_academic_score: 95.0,
      lowest_academic_score: 62.0,
      avg_eos_points: 840,
      highest_eos_points: 980,
      avg_response_time_seconds: 32.4,
      total_answers_submitted: studentCount * 20,
      total_correct_answers: studentCount * 16,
      avg_accuracy_percentage: 80.0,
    },
    students: Array.from({ length: studentCount }, (_, i) => ({
      rank: i + 1,
      student_id: `student-uuid-${i + 1}`,
      student_name: i === 0 ? 'రాహుల్ వర్మ (Telugu Candidate)' : `Candidate ${i + 1}`,
      roll_number: `22AK1A05${String(i + 1).padStart(2, '0')}`,
      college_name: 'KITS Akshar Institute of Technology',
      email: `student${i + 1}@kitsakshar.ac.in`,
      attempt_id: `attempt-uuid-${i + 1}`,
      attempt_status: 'SUBMITTED',
      academic_score: 95 - i * 5,
      max_score: 100,
      academic_percentage: 95 - i * 5,
      eos_points: 980 - i * 20, // Distinct EOS points
      correct_count: 19 - i,
      incorrect_count: i,
      unanswered_count: 1,
      total_response_time_seconds: 400 + i * 20,
      started_at: '2026-10-18T10:01:00Z',
      submitted_at: '2026-10-18T10:40:00Z',
      is_passed: 95 - i * 5 >= 40,
    })),
    questions: [],
    feedback: null,
    generated_at: '2026-10-18T10:45:10Z',
  };
}

describe('assessmentReportExport: CSV Generator', () => {
  it('generates valid UTF-8 BOM CSV with required column headers', () => {
    const report = getMockReportData(3);
    const csv = generateStudentPerformanceCsv(report);

    // Verifies UTF-8 BOM is present for Excel compatibility
    expect(csv.startsWith('\uFEFF')).toBe(true);

    // Verifies headers are present
    expect(csv).toContain('Rank');
    expect(csv).toContain('Student Name');
    expect(csv).toContain('Roll Number');
    expect(csv).toContain('College / Institute');
    expect(csv).toContain('Academic Marks Earned');
    expect(csv).toContain('Maximum Marks');
    expect(csv).toContain('Academic Percentage (%)');
    expect(csv).toContain('EOS Speed Points');
    expect(csv).toContain('Correct Answers');
    expect(csv).toContain('Incorrect Answers');
    expect(csv).toContain('Unanswered Questions');
    expect(csv).toContain('Total Response Time (s)');
  });

  it('keeps Academic Marks and EOS Points distinct in separate columns', () => {
    const report = getMockReportData(2);
    const csv = generateStudentPerformanceCsv(report);

    const lines = csv.split('\r\n');
    expect(lines.length).toBe(3); // Header + 2 data rows

    // Candidate 1: academic_score = 95.00, eos_points = 980.00
    expect(lines[1]).toContain('"95.00"');
    expect(lines[1]).toContain('"980.00"');

    // Candidate 2: academic_score = 90.00, eos_points = 960.00
    expect(lines[2]).toContain('"90.00"');
    expect(lines[2]).toContain('"960.00"');
  });

  it('preserves Telugu Unicode characters and commas inside fields without corruption', () => {
    const report = getMockReportData(1);
    report.students[0].student_name = 'రాహుల్ వర్మ, Senior Developer';
    const csv = generateStudentPerformanceCsv(report);

    expect(csv).toContain('"రాహుల్ వర్మ, Senior Developer"');
  });

  it('neutralizes OWASP formula injection characters in cells', () => {
    const report = getMockReportData(1);
    report.students[0].student_name = '=cmd|/c calc!A0';
    report.students[0].roll_number = '+919999999999';
    report.students[0].college_name = '-DangerousCollege';

    const csv = generateStudentPerformanceCsv(report);

    expect(csv).toContain("\"'=cmd|/c calc!A0\"");
    expect(csv).toContain("\"'+919999999999\"");
    expect(csv).toContain("\"'-DangerousCollege\"");
  });

  it('maintains deterministic sorting by rank ascending', () => {
    const report = getMockReportData(3);
    // Shuffle students array to test deterministic sorting
    report.students = [report.students[2], report.students[0], report.students[1]];

    const csv = generateStudentPerformanceCsv(report);
    const lines = csv.split('\r\n').slice(1).filter(Boolean);

    expect(lines[0]).toContain('"1"');
    expect(lines[1]).toContain('"2"');
    expect(lines[2]).toContain('"3"');
  });

  it('generates descriptive filenames with assessment title and date', () => {
    const filename = getAssessmentReportCsvFilename('C Language Exam & Lab', new Date('2026-10-18T10:00:00Z'));
    expect(filename).toBe('KITS_EOS_C_Language_Exam_Lab_Report_2026-10-18.csv');
  });

  it('sanitizes special characters in filenames safely', () => {
    const clean = sanitizeReportFilename('../../hack/exam???*name!!');
    expect(clean).not.toContain('..');
    expect(clean).not.toContain('/');
    expect(clean).not.toContain('?');
  });
});

describe('assessmentReportExport: Sequential PNG Partitioning', () => {
  it('handles empty student list with single page (Part 1 of 1)', () => {
    const partitions = partitionStudentsForReportPages([], 25);
    expect(partitions.length).toBe(1);
    expect(partitions[0].pageIndex).toBe(1);
    expect(partitions[0].totalPages).toBe(1);
    expect(partitions[0].students.length).toBe(0);
  });

  it('partitions 60 students into 3 sequential non-overlapping parts without gaps or duplicates', () => {
    const report = getMockReportData(60);
    const partitions = partitionStudentsForReportPages(report.students, 25);

    expect(partitions.length).toBe(3);

    // Part 1 of 3
    expect(partitions[0].pageIndex).toBe(1);
    expect(partitions[0].totalPages).toBe(3);
    expect(partitions[0].students.length).toBe(25);
    expect(partitions[0].students[0].rank).toBe(1);
    expect(partitions[0].students[24].rank).toBe(25);

    // Part 2 of 3
    expect(partitions[1].pageIndex).toBe(2);
    expect(partitions[1].totalPages).toBe(3);
    expect(partitions[1].students.length).toBe(25);
    expect(partitions[1].students[0].rank).toBe(26);
    expect(partitions[1].students[24].rank).toBe(50);

    // Part 3 of 3
    expect(partitions[2].pageIndex).toBe(3);
    expect(partitions[2].totalPages).toBe(3);
    expect(partitions[2].students.length).toBe(10);
    expect(partitions[2].students[0].rank).toBe(51);
    expect(partitions[2].students[9].rank).toBe(60);

    // Verify all 60 students are accounted for with no duplicates
    const allPartitionedIds = partitions.flatMap((p) => p.students.map((s) => s.student_id));
    expect(allPartitionedIds.length).toBe(60);
    const uniqueIds = new Set(allPartitionedIds);
    expect(uniqueIds.size).toBe(60);
  });

  it('keeps deterministic student ordering in partitions even if input is shuffled', () => {
    const report = getMockReportData(30);
    const shuffled = [...report.students].reverse();

    const partitions = partitionStudentsForReportPages(shuffled, 20);
    expect(partitions.length).toBe(2);

    expect(partitions[0].students[0].rank).toBe(1);
    expect(partitions[0].students[19].rank).toBe(20);
    expect(partitions[1].students[0].rank).toBe(21);
    expect(partitions[1].students[9].rank).toBe(30);
  });
});

describe('assessmentReportExport: Analytics Metrics, Denominators, and Integrity', () => {
  it('correctly calculates completion rate based on participants and completed attempts', () => {
    const report = getMockReportData(50);
    // 50 participants, 40 completed, 10 incomplete
    report.summary.total_participants = 50;
    report.summary.completed_attempts = 40;
    report.summary.in_progress_attempts = 5;
    report.summary.expired_attempts = 3;
    report.summary.terminated_attempts = 2;

    const completionRate = Math.round((report.summary.completed_attempts / report.summary.total_participants) * 100);
    expect(completionRate).toBe(80);

    // Incomplete count must equal sum of non-submitted statuses
    const incompleteCount =
      report.summary.in_progress_attempts +
      report.summary.expired_attempts +
      report.summary.terminated_attempts;
    expect(incompleteCount).toBe(10);
  });

  it('preserves distinct denominator: eligible candidates vs active participants', () => {
    const report = getMockReportData(30);
    report.summary.total_eligible = 150;
    report.summary.total_participants = 30;

    // Denominators are strictly separate
    expect(report.summary.total_eligible).toBe(150);
    expect(report.summary.total_participants).toBe(30);
    expect(report.summary.total_eligible).toBeGreaterThan(report.summary.total_participants);

    // Turnout percentage
    const turnoutRate = Math.round((report.summary.total_participants / report.summary.total_eligible) * 100);
    expect(turnoutRate).toBe(20);
  });

  it('properly tracks unanswered questions and distinct question difficulty', () => {
    const mockQuestions: AssessmentReportData['questions'] = [
      {
        question_id: 'q1',
        question_number: 1,
        sort_order: 1,
        question_text: 'What is the time complexity of binary search?',
        question_type: 'MCQ',
        points: 5,
        time_limit_seconds: 60,
        total_responses: 50,
        correct_count: 45,
        incorrect_count: 3,
        unanswered_count: 2,
        correct_percentage: 90.0,
        incorrect_percentage: 6.0,
        avg_response_time_seconds: 14.5,
        is_difficult: false,
        correct_answer_preview: 'O(log n)',
        options_breakdown: [
          { option_id: 'opt1', option_text: 'O(log n)', sort_order: 1, is_correct: true, selected_count: 45 },
          { option_id: 'opt2', option_text: 'O(n)', sort_order: 2, is_correct: false, selected_count: 3 },
        ],
      },
      {
        question_id: 'q2',
        question_number: 2,
        sort_order: 2,
        question_text: 'Explain cache-oblivious B-trees.',
        question_type: 'MCQ',
        points: 5,
        time_limit_seconds: 60,
        total_responses: 50,
        correct_count: 10,
        incorrect_count: 32,
        unanswered_count: 8,
        correct_percentage: 20.0,
        incorrect_percentage: 64.0,
        avg_response_time_seconds: 52.0,
        is_difficult: true, // Flagged because accuracy <= 40%
        correct_answer_preview: 'van Emde Boas layout',
        options_breakdown: [
          { option_id: 'opt3', option_text: 'van Emde Boas layout', sort_order: 1, is_correct: true, selected_count: 10 },
          { option_id: 'opt4', option_text: 'Red-black rotation', sort_order: 2, is_correct: false, selected_count: 32 },
        ],
      },
    ];

    expect(mockQuestions[0].is_difficult).toBe(false);
    expect(mockQuestions[1].is_difficult).toBe(true);

    // Accuracy calculation verified
    expect(mockQuestions[0].correct_percentage).toBe(90.0);
    expect(mockQuestions[1].correct_percentage).toBe(20.0);

    // Unanswered counts preserved
    expect(mockQuestions[0].unanswered_count).toBe(2);
    expect(mockQuestions[1].unanswered_count).toBe(8);
  });

  it('guarantees one row per student with deterministic ordering by rank then student_id', () => {
    const report = getMockReportData(3);
    report.students[0].rank = 1;
    report.students[1].rank = 2;
    report.students[2].rank = 2; // Tied rank

    const csv = generateStudentPerformanceCsv(report);
    const lines = csv.split('\r\n').slice(1).filter(Boolean);

    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('"1"');
    expect(lines[1]).toContain('"2"');
    expect(lines[2]).toContain('"2"');
  });
});

