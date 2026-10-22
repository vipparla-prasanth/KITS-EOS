/**
 * KITS-EOS Authoritative Post-Assessment Report Export Utilities
 * Provides CSV and Sequential Multi-Part High-Resolution PNG generators.
 */

import type {
  AssessmentReportData,
  AssessmentReportStudent,
} from '../types/models';

// ============================================================================
// 1. CSV Export for Overall Student Performance List
// ============================================================================

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

function sanitizeCsvCell(value: any): string {
  if (value === null || value === undefined) {
    return '""';
  }

  let str = String(value);

  // OWASP CSV Formula Injection Guard
  if (str.length > 0 && FORMULA_TRIGGERS.some((char) => str.startsWith(char))) {
    str = `'${str}`;
  }

  // Quote and escape double quotes
  return `"${str.replace(/"/g, '""')}"`;
}

export function sanitizeReportFilename(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 60) || 'assessment_report'
  );
}

export function getAssessmentReportCsvFilename(title: string, date: Date = new Date()): string {
  const dateStr = date.toISOString().split('T')[0];
  const safeTitle = sanitizeReportFilename(title);
  return `KITS_EOS_${safeTitle}_Report_${dateStr}.csv`;
}

export function generateStudentPerformanceCsv(report: AssessmentReportData): string {
  const headers = [
    'Rank',
    'Student Name',
    'Roll Number',
    'College / Institute',
    'Email',
    'Attempt Status',
    'Academic Marks Earned',
    'Maximum Marks',
    'Academic Percentage (%)',
    'EOS Speed Points',
    'Correct Answers',
    'Incorrect Answers',
    'Unanswered Questions',
    'Total Response Time (s)',
    'Started At',
    'Submitted At',
    'Result Status',
  ];

  const rows: string[] = [];

  // Deterministic ordering: Rank ASC, then roll number ASC
  const sortedStudents = [...(report.students || [])].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return (a.roll_number || '').localeCompare(b.roll_number || '');
  });

  for (const st of sortedStudents) {
    const row = [
      sanitizeCsvCell(st.rank),
      sanitizeCsvCell(st.student_name),
      sanitizeCsvCell(st.roll_number),
      sanitizeCsvCell(st.college_name),
      sanitizeCsvCell(st.email || 'N/A'),
      sanitizeCsvCell(st.attempt_status),
      sanitizeCsvCell(st.academic_score.toFixed(2)),
      sanitizeCsvCell(st.max_score.toFixed(2)),
      sanitizeCsvCell(`${st.academic_percentage.toFixed(1)}%`),
      sanitizeCsvCell(st.eos_points.toFixed(2)),
      sanitizeCsvCell(st.correct_count),
      sanitizeCsvCell(st.incorrect_count),
      sanitizeCsvCell(st.unanswered_count),
      sanitizeCsvCell(st.total_response_time_seconds.toFixed(1)),
      sanitizeCsvCell(st.started_at ? new Date(st.started_at).toLocaleString() : 'N/A'),
      sanitizeCsvCell(st.submitted_at ? new Date(st.submitted_at).toLocaleString() : 'N/A'),
      sanitizeCsvCell(st.is_passed ? 'PASSED' : 'FAILED'),
    ];
    rows.push(row.join(','));
  }

  // Prepend UTF-8 BOM (\uFEFF) for Microsoft Excel compatibility
  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}

// ============================================================================
// 2. Sequential High-Resolution PNG Performance List Generator
// ============================================================================

export const ROWS_PER_PAGE = 25;
export const CANVAS_WIDTH = 1800;

export interface ReportPngPage {
  blob: Blob;
  pageIndex: number; // 1-based
  totalPages: number;
  filename: string;
}

export interface StudentReportPagePartition {
  pageIndex: number;
  totalPages: number;
  students: AssessmentReportStudent[];
  startRankOffset: number;
  totalStudents: number;
}

export function partitionStudentsForReportPages(
  allStudents: AssessmentReportStudent[],
  rowsPerPage: number = ROWS_PER_PAGE
): StudentReportPagePartition[] {
  const sorted = [...(allStudents || [])].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return (a.roll_number || '').localeCompare(b.roll_number || '');
  });

  const totalStudents = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalStudents / rowsPerPage));
  const partitions: StudentReportPagePartition[] = [];

  for (let pageIdx = 1; pageIdx <= totalPages; pageIdx++) {
    const startIdx = (pageIdx - 1) * rowsPerPage;
    const pageStudents = sorted.slice(startIdx, startIdx + rowsPerPage);
    partitions.push({
      pageIndex: pageIdx,
      totalPages,
      students: pageStudents,
      startRankOffset: startIdx,
      totalStudents,
    });
  }

  return partitions;
}

export async function renderSequentialStudentPerformancePngs(
  report: AssessmentReportData,
  rowsPerPage: number = ROWS_PER_PAGE
): Promise<ReportPngPage[]> {
  const partitions = partitionStudentsForReportPages(report.students || [], rowsPerPage);
  const pages: ReportPngPage[] = [];

  const baseTitle = sanitizeReportFilename(report.assessment?.title || 'Report');
  const dateStr = new Date().toISOString().split('T')[0];

  for (const partition of partitions) {
    const canvas = renderSingleReportPageCanvas({
      report,
      students: partition.students,
      pageIndex: partition.pageIndex,
      totalPages: partition.totalPages,
      startRankOffset: partition.startRankOffset,
      totalStudents: partition.totalStudents,
    });

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('Failed to generate PNG blob from canvas.'));
      }, 'image/png');
    });

    const filename = `KITS_EOS_${baseTitle}_Part_${partition.pageIndex}_of_${partition.totalPages}_${dateStr}.png`;
    pages.push({
      blob,
      pageIndex: partition.pageIndex,
      totalPages: partition.totalPages,
      filename,
    });
  }

  return pages;
}

interface SinglePageRenderOptions {
  report: AssessmentReportData;
  students: AssessmentReportStudent[];
  pageIndex: number;
  totalPages: number;
  startRankOffset: number;
  totalStudents: number;
}

function renderSingleReportPageCanvas(options: SinglePageRenderOptions): HTMLCanvasElement {
  const { report, students, pageIndex, totalPages, startRankOffset, totalStudents } = options;

  const headerHeight = 280;
  const tableHeaderHeight = 56;
  const rowHeight = 48;
  const footerHeight = 90;

  const rowCount = Math.max(students.length, 1);
  const totalHeight = headerHeight + tableHeaderHeight + rowCount * rowHeight + footerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D Canvas context unavailable');

  // Background
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, CANVAS_WIDTH, totalHeight);

  // 1. Top Brand Banner
  ctx.fillStyle = '#003366'; // KITS Navy
  ctx.fillRect(0, 0, CANVAS_WIDTH, 140);

  // Accent Line (KITS Red)
  ctx.fillStyle = '#C8102E';
  ctx.fillRect(0, 136, CANVAS_WIDTH, 4);

  // Institution & Header Text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 30px "Montserrat", sans-serif';
  ctx.fillText('KITS AKSHAR INSTITUTE OF TECHNOLOGY', 60, 52);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 16px "Montserrat", sans-serif';
  ctx.fillText('EXAMINATION OPERATIONS SYSTEM (EOS) • AUTHORITATIVE PERFORMANCE AUDIT', 60, 82);

  // Sequential Page Number Badge (Top Right)
  const partText = `PART ${pageIndex} OF ${totalPages}`;
  ctx.font = 'bold 18px "Montserrat", sans-serif';
  const partMetrics = ctx.measureText(partText);
  const badgeWidth = partMetrics.width + 36;
  const badgeX = CANVAS_WIDTH - 60 - badgeWidth;

  ctx.fillStyle = '#C8102E';
  ctx.beginPath();
  ctx.roundRect(badgeX, 36, badgeWidth, 38, 8);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(partText, badgeX + 18, 62);

  // Date / Timestamp (under badge)
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '500 13px "Montserrat", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Generated: ${new Date().toLocaleString()}`, CANVAS_WIDTH - 60, 110);
  ctx.textAlign = 'left';

  // 2. Assessment Summary Card (Below Banner)
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(60, 160, CANVAS_WIDTH - 120, 96, 12);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Assessment Title
  ctx.fillStyle = '#003366';
  ctx.font = 'bold 22px "Montserrat", sans-serif';
  const title = report.assessment?.title || 'Assessment Performance Report';
  ctx.fillText(title, 84, 198);

  ctx.fillStyle = '#64748B';
  ctx.font = '500 13px "Montserrat", sans-serif';
  const timingInfo = `Status: ${report.assessment?.status || 'CLOSED'} • Scheduled End: ${
    report.assessment?.end_time ? new Date(report.assessment.end_time).toLocaleDateString() : 'N/A'
  } • Total Questions: ${report.assessment?.total_questions_count || 0} • Max Points: ${
    report.assessment?.total_points || 0
  } pts • Passing: ${report.assessment?.passing_percentage || 40}%`;
  ctx.fillText(timingInfo, 84, 230);

  // Quick stats summary on right side of card
  const sum = report.summary;
  const statsX = CANVAS_WIDTH - 580;
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 14px "Montserrat", sans-serif';
  ctx.fillText(`Total Candidates: ${totalStudents}`, statsX, 198);
  ctx.fillText(`Avg Academic Score: ${sum?.avg_academic_score?.toFixed(1) || '0.0'} (${sum?.avg_academic_percentage?.toFixed(1) || '0.0'}%)`, statsX, 230);

  const statsX2 = CANVAS_WIDTH - 280;
  ctx.fillText(`Avg EOS Points: ${sum?.avg_eos_points?.toFixed(0) || '0'} pts`, statsX2, 198);
  ctx.fillText(`Completion Rate: ${sum?.completion_rate?.toFixed(1) || '0.0'}%`, statsX2, 230);

  // 3. Table Column Layout
  const tableX = 60;
  const tableY = headerHeight;
  const tableWidth = CANVAS_WIDTH - 120;

  // Columns definition:
  // [Title, X, Width, Alignment]
  const cols: { title: string; x: number; w: number; align: CanvasTextAlign }[] = [
    { title: 'RANK', x: tableX + 20, w: 70, align: 'center' },
    { title: 'CANDIDATE DETAILS', x: tableX + 110, w: 380, align: 'left' },
    { title: 'ROLL / ID', x: tableX + 510, w: 180, align: 'left' },
    { title: 'STATUS', x: tableX + 710, w: 140, align: 'center' },
    { title: 'ACADEMIC SCORE', x: tableX + 870, w: 170, align: 'right' },
    { title: '%', x: tableX + 1060, w: 90, align: 'right' },
    { title: 'EOS SPEED POINTS', x: tableX + 1170, w: 180, align: 'right' },
    { title: 'ACCURACY (C / I / U)', x: tableX + 1370, w: 180, align: 'center' },
    { title: 'TOTAL TIME', x: tableX + 1570, w: 110, align: 'right' },
  ];

  // Table Header Background
  ctx.fillStyle = '#0F172A'; // Slate 900
  ctx.beginPath();
  ctx.roundRect(tableX, tableY, tableWidth, tableHeaderHeight, [8, 8, 0, 0]);
  ctx.fill();

  // Table Header Text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 13px "Montserrat", sans-serif';
  for (const col of cols) {
    ctx.textAlign = col.align;
    ctx.fillText(col.title, col.align === 'center' ? col.x + col.w / 2 : col.align === 'right' ? col.x + col.w : col.x, tableY + 34);
  }

  // 4. Table Rows
  let currentY = tableY + tableHeaderHeight;

  if (students.length === 0) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(tableX, currentY, tableWidth, rowHeight * 2);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 14px "Montserrat", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No finalized candidate attempt records available for this assessment.', tableX + tableWidth / 2, currentY + 54);
    currentY += rowHeight * 2;
  } else {
    for (let i = 0; i < students.length; i++) {
      const st = students[i];
      const isZebra = i % 2 === 1;

      // Row Background
      ctx.fillStyle = isZebra ? '#F1F5F9' : '#FFFFFF';
      ctx.fillRect(tableX, currentY, tableWidth, rowHeight);

      // Row Border
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tableX, currentY + rowHeight);
      ctx.lineTo(tableX + tableWidth, currentY + rowHeight);
      ctx.stroke();

      const textY = currentY + 30;

      // Rank
      ctx.textAlign = 'center';
      if (st.rank === 1) {
        ctx.fillStyle = '#D97706'; // Gold
        ctx.font = 'bold 16px "Montserrat", sans-serif';
        ctx.fillText('🥇 1', cols[0].x + cols[0].w / 2, textY);
      } else if (st.rank === 2) {
        ctx.fillStyle = '#64748B'; // Silver
        ctx.font = 'bold 15px "Montserrat", sans-serif';
        ctx.fillText('🥈 2', cols[0].x + cols[0].w / 2, textY);
      } else if (st.rank === 3) {
        ctx.fillStyle = '#B45309'; // Bronze
        ctx.font = 'bold 15px "Montserrat", sans-serif';
        ctx.fillText('🥉 3', cols[0].x + cols[0].w / 2, textY);
      } else {
        ctx.fillStyle = '#334155';
        ctx.font = 'bold 14px monospace';
        ctx.fillText(String(st.rank), cols[0].x + cols[0].w / 2, textY);
      }

      // Candidate Name & College
      ctx.textAlign = 'left';
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 14px "Montserrat", sans-serif';
      const name = st.student_name.length > 28 ? st.student_name.slice(0, 26) + '…' : st.student_name;
      ctx.fillText(name, cols[1].x, textY);

      // Roll Number
      ctx.fillStyle = '#475569';
      ctx.font = '600 13px monospace';
      ctx.fillText(st.roll_number || 'N/A', cols[2].x, textY);

      // Status Badge
      ctx.textAlign = 'center';
      const statusBadgeW = 100;
      const statusBadgeX = cols[3].x + (cols[3].w - statusBadgeW) / 2;
      const statusBadgeY = currentY + 11;
      ctx.fillStyle =
        st.attempt_status === 'SUBMITTED' ? '#ECFDF5' : st.attempt_status === 'TERMINATED' ? '#FEF2F2' : '#FFFBEB';
      ctx.strokeStyle =
        st.attempt_status === 'SUBMITTED' ? '#A7F3D0' : st.attempt_status === 'TERMINATED' ? '#FECACA' : '#FDE68A';
      ctx.beginPath();
      ctx.roundRect(statusBadgeX, statusBadgeY, statusBadgeW, 26, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle =
        st.attempt_status === 'SUBMITTED' ? '#065F46' : st.attempt_status === 'TERMINATED' ? '#991B1B' : '#92400E';
      ctx.font = 'bold 11px "Montserrat", sans-serif';
      ctx.fillText(st.attempt_status, statusBadgeX + statusBadgeW / 2, statusBadgeY + 17);

      // Academic Score
      ctx.textAlign = 'right';
      ctx.fillStyle = '#003366'; // Navy
      ctx.font = 'bold 15px "Montserrat", sans-serif';
      ctx.fillText(`${st.academic_score.toFixed(1)} / ${st.max_score.toFixed(0)}`, cols[4].x + cols[4].w, textY);

      // Percentage
      ctx.fillStyle = st.is_passed ? '#059669' : '#DC2626';
      ctx.font = 'bold 13px "Montserrat", sans-serif';
      ctx.fillText(`${st.academic_percentage.toFixed(1)}%`, cols[5].x + cols[5].w, textY);

      // EOS Speed Points (Distinct styling: Purple Pill)
      const eosW = 110;
      const eosX = cols[6].x + cols[6].w - eosW;
      const eosY = currentY + 11;
      ctx.fillStyle = '#F5F3FF';
      ctx.strokeStyle = '#DDD6FE';
      ctx.beginPath();
      ctx.roundRect(eosX, eosY, eosW, 26, 6);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#6D28D9'; // Purple
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`${st.eos_points.toFixed(0)} pts`, eosX + eosW / 2, eosY + 17);

      // Accuracy (C / I / U)
      ctx.textAlign = 'center';
      ctx.fillStyle = '#334155';
      ctx.font = '600 12px "Montserrat", sans-serif';
      ctx.fillText(`${st.correct_count} C  /  ${st.incorrect_count} I  /  ${st.unanswered_count} U`, cols[7].x + cols[7].w / 2, textY);

      // Total Time
      ctx.textAlign = 'right';
      ctx.fillStyle = '#64748B';
      ctx.font = '600 12px monospace';
      ctx.fillText(`${st.total_response_time_seconds.toFixed(0)}s`, cols[8].x + cols[8].w, textY);

      currentY += rowHeight;
    }
  }

  // 5. Page Footer
  ctx.fillStyle = '#64748B';
  ctx.font = '500 13px "Montserrat", sans-serif';
  ctx.textAlign = 'left';
  const startNum = startRankOffset + 1;
  const endNum = Math.min(startRankOffset + students.length, totalStudents);
  ctx.fillText(
    `Part ${pageIndex} of ${totalPages} • Showing candidates ${startNum} to ${endNum} of ${totalStudents} • KITS-EOS Examination System`,
    60,
    totalHeight - 40
  );

  ctx.textAlign = 'right';
  ctx.fillText(
    'Authoritative computer-generated examination performance report • Strict data integrity preserved',
    CANVAS_WIDTH - 60,
    totalHeight - 40
  );

  return canvas;
}

// Download helper with delay to ensure browser allows sequential downloads
export async function downloadSequentialReportPngs(pages: ReportPngPage[]): Promise<void> {
  if (typeof window === 'undefined') return;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const url = URL.createObjectURL(page.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = page.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Revoke after delay
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    // Stagger downloads by 350ms so browser doesn't block sequential popup downloads
    if (i < pages.length - 1) {
      await new Promise((res) => setTimeout(res, 350));
    }
  }
}
