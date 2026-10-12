/**
 * KITS-EOS GLOBAL EXCEL EXPORT DESIGN STANDARD
 * 
 * Institutional Excel export framework for KITS Akshar Institute of Technology.
 * Applies official institutional visual language:
 * - KITS RED: #C8102E
 * - AKSHAR BLUE: #003366
 * - WHITE: #FFFFFF
 * - Light neutral alternating row zebra stripes: #F8FAFC
 * - Alternating Red/Blue column header styling
 * - Executive report title block & metadata
 * - Freeze panes at table header
 * - Column auto-filters
 * - Human-centric column widths and wrapping
 * - Currency numeric formatting with '₹' symbol
 * - Strict 12-hour institutional date/time formatting (DD-MM-YYYY hh:mm AM/PM)
 * - Restrained semantic status badges
 * - Pure live database data integrity
 */

export interface ExcelExportSection {
  title: string;
  subtitle?: string;
  rows: (string | number | boolean | null | undefined)[][];
}

export interface ExcelExportOptions {
  filename: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows?: (string | number | boolean | null | undefined)[][];
  sections?: ExcelExportSection[];
  colWidths?: number[];
  sheetName?: string;
  metadata?: {
    scope?: string;
    filterNotes?: string[];
    extraMeta?: Record<string, string>;
  };
}

/**
 * Approved Coordinator Operational Overall Participant List Headers
 * Focused, simple operational participant columns (No internal admin IDs, credentials, or audit trails)
 */
export const COORDINATOR_OVERALL_REPORT_HEADERS = [
  'S.No',
  'Name',
  'Roll Number',
  'Year',
  'Department',
  'Sub-Event',
  'Payment Status',
  'Status',
];

/**
 * Approved Global Registration Report Headers (1 Registration = 1 Row)
 * Human-centric column ordering: Registration ID is STRICTLY LAST.
 */
export const REGISTRATION_REPORT_HEADERS = [
  'S.No',
  'Student / Team Leader',
  'Roll Number',
  'Department',
  'Year',
  'College',
  'Registration Date & Time',
  'Email',
  'Mobile Number',
  'Main Event',
  'Category',
  'Sub-Event',
  'Registration Mode',
  'Team Name',
  'Team Size',
  'Team Members / Roster',
  'Registration Status',
  'Payment Status',
  'Payment Amount (₹)',
  'Attendance Status',
  'Attendance Date & Time',
  'Verification Method',
  'Manual Token',
  'Registration ID',
];

/**
 * Approved Global Participant Roster Headers (Expanded per participant)
 * Human-centric column ordering: Registration ID is STRICTLY LAST.
 */
export const REGISTRATION_ROSTER_HEADERS = [
  'S.No',
  'Student Name',
  'Roll Number',
  'Department',
  'Year of Study',
  'College / Institution',
  'Registration Date & Time',
  'Email',
  'Contact Number',
  'Event',
  'Category',
  'Sub-Event',
  'Registration Mode',
  'Team Name',
  'Team Role',
  'Registration Status',
  'Payment Status',
  'Payment Amount (₹)',
  'Attendance Status',
  'Attendance Date/Time',
  'Verification Method',
  'Manual Token',
  'Registration ID',
];

// Institutional Brand Colors (ExcelJS ARGB format: AARRGGBB)
export const KITS_EXCEL_THEME = {
  KITS_RED: 'FFC8102E',       // Institutional Red (#C8102E)
  AKSHAR_BLUE: 'FF003366',    // Institutional Blue (#003366)
  WHITE: 'FFFFFFFF',          // Pure White
  DARK_SLATE: 'FF0F172A',     // Primary text (#0F172A)
  SLATE_BODY: 'FF1E293B',     // Table body text (#1E293B)
  SLATE_MUTED: 'FF475569',    // Secondary / metadata text (#475569)
  LIGHT_BG: 'FFF8FAFC',       // Subtle alternating zebra fill (#F8FAFC)
  TITLE_BG: 'FFF1F5F9',       // Soft slate neutral title fill (#F1F5F9)
  BORDER_HEADER: 'FFCBD5E1',  // Header borders (#CBD5E1)
  BORDER_BODY: 'FFE2E8F0',    // Body row borders (#E2E8F0)
} as const;

// Semantic Status Color Palette (Restrained, professional institutional badges)
const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  // Positive / Confirmed / Attended / Paid
  CONFIRMED: { bg: 'FFDCFCE7', text: 'FF166534' },
  APPROVED: { bg: 'FFDCFCE7', text: 'FF166534' },
  SUCCESS: { bg: 'FFDCFCE7', text: 'FF166534' },
  ATTENDED: { bg: 'FFDCFCE7', text: 'FF166534' },
  PAID: { bg: 'FFDCFCE7', text: 'FF166534' },
  ACTIVE: { bg: 'FFDCFCE7', text: 'FF166534' },
  VERIFIED: { bg: 'FFDCFCE7', text: 'FF166534' },
  COMPLETED: { bg: 'FFDCFCE7', text: 'FF166534' },

  // Warning / Pending / On Hold
  PENDING: { bg: 'FFFEF3C7', text: 'FF92400E' },
  PENDING_PAYMENT: { bg: 'FFFEF3C7', text: 'FF92400E' },
  PARTIAL: { bg: 'FFFEF3C7', text: 'FF92400E' },
  IN_REVIEW: { bg: 'FFFEF3C7', text: 'FF92400E' },
  DRAFT: { bg: 'FFFEF3C7', text: 'FF92400E' },
  NOT_ASSIGNED: { bg: 'FFFEF3C7', text: 'FF92400E' },
  UNASSIGNED: { bg: 'FFFEF3C7', text: 'FF92400E' },

  // Negative / Cancelled / Unpaid / Not Attended
  UNPAID: { bg: 'FFFEE2E2', text: 'FF991B1B' },
  REJECTED: { bg: 'FFFEE2E2', text: 'FF991B1B' },
  CANCELLED: { bg: 'FFFEE2E2', text: 'FF991B1B' },
  'NOT ATTENDED': { bg: 'FFFEE2E2', text: 'FF991B1B' },
  NOT_ATTENDED: { bg: 'FFFEE2E2', text: 'FF991B1B' },
  FAILED: { bg: 'FFFEE2E2', text: 'FF991B1B' },
  SUSPENDED: { bg: 'FFFEE2E2', text: 'FF991B1B' },
  INACTIVE: { bg: 'FFFEE2E2', text: 'FF991B1B' },

  // Institutional Roles / Highlights
  FACULTY: { bg: 'FFEFF6FF', text: 'FF1E40AF' },
  'FACULTY COORDINATOR': { bg: 'FFEFF6FF', text: 'FF1E40AF' },
  LEADER: { bg: 'FFEFF6FF', text: 'FF1E40AF' },
  'TEAM LEADER': { bg: 'FFEFF6FF', text: 'FF1E40AF' },

  // Secondary Roles / Mode
  'STUDENT COORDINATOR': { bg: 'FFF1F5F9', text: 'FF475569' },
  MEMBER: { bg: 'FFF1F5F9', text: 'FF475569' },
  'TEAM MEMBER': { bg: 'FFF1F5F9', text: 'FF475569' },
  SOLO: { bg: 'FFF1F5F9', text: 'FF475569' },
  TEAM: { bg: 'FFF1F5F9', text: 'FF475569' },
  ARCHIVED: { bg: 'FFF1F5F9', text: 'FF475569' },
};

/**
 * Institutional Date/Time Formatter (DD-MM-YYYY hh:mm AM/PM)
 */
export function formatInstitutionalDateTime(val: any): string {
  if (val === undefined || val === null || val === '') return '—';
  if (typeof val === 'string' && (val === '—' || val === '-' || val === 'N/A')) return val;

  let d: Date | null = null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    d = val;
  } else if (typeof val === 'string') {
    // Already in DD-MM-YYYY format
    if (/^\d{2}-\d{2}-\d{4}/.test(val)) {
      return val;
    }
    // Matches ISO or parseable date string
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) {
      const parsed = new Date(val);
      if (!isNaN(parsed.getTime())) {
        d = parsed;
      }
    }
  }

  if (!d) return String(val);

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  // If input was purely a date without meaningful time (00:00:00.000Z or date-only string)
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return `${day}-${month}-${year}`;
  }

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = String(hours).padStart(2, '0');

  return `${day}-${month}-${year} ${strHours}:${minutes} ${ampm}`;
}

/**
 * Checks if a column represents a currency/fee value.
 */
function isCurrencyColumn(header: string): boolean {
  const h = header.toLowerCase();
  return (
    h.includes('₹') ||
    h.includes('(inr)') ||
    h.includes('amount') ||
    h.includes('fee') ||
    h.includes('price') ||
    h.includes('payment amount')
  );
}

/**
 * Checks if a column represents a date or timestamp.
 */
function isDateColumn(header: string): boolean {
  const h = header.toLowerCase();
  return (
    h.includes('date') ||
    h.includes('time') ||
    h.includes('created at') ||
    h.includes('registered at') ||
    h.includes('check-in')
  );
}

/**
 * Checks if a column should wrap long text.
 */
function isWrapTextColumn(header: string): boolean {
  const h = header.toLowerCase();
  return (
    h.includes('roster') ||
    h.includes('members') ||
    h.includes('description') ||
    h.includes('rules') ||
    h.includes('comments') ||
    h.includes('reasons') ||
    h.includes('venue') ||
    h.includes('notes')
  );
}

/**
 * Core Global KITS-EOS Excel Workbook Builder.
 * Produces an authentic, institutional-grade styled ExcelJS Workbook.
 */
export async function createKitsExcelWorkbook(options: ExcelExportOptions) {
  const { title, subtitle, headers, rows, sections, colWidths, sheetName } = options;

  let ExcelJSModule: any;
  try {
    ExcelJSModule = await import('exceljs');
  } catch (err) {
    console.error('Failed to load exceljs library dynamically:', err);
    throw new Error('Excel generation library failed to load.');
  }

  const ExcelJS = ExcelJSModule.default || ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KITS-EOS Central Platform (KITS Akshar Institute of Technology)';
  workbook.created = new Date();
  workbook.modified = new Date();

  const sanitizedSheetName = (sheetName || 'Report')
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31) || 'Report';

  const hasSections = Boolean(sections && sections.length > 0);
  const allRows: (string | number | boolean | null | undefined)[][] = hasSections
    ? sections!.flatMap((s) => s.rows)
    : rows || [];

  const ws = workbook.addWorksheet(sanitizedSheetName, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: hasSections ? 4 : 6 }],
    properties: { defaultRowHeight: 22 },
  });

  const numCols = Math.max(headers.length, 6);

  // Helper to apply full borders to a cell
  const applyCellBorder = (cell: any, borderColor: string, isThin = true) => {
    cell.border = {
      top: { style: isThin ? 'thin' : 'medium', color: { argb: borderColor } },
      bottom: { style: isThin ? 'thin' : 'medium', color: { argb: borderColor } },
      left: { style: isThin ? 'thin' : 'medium', color: { argb: borderColor } },
      right: { style: isThin ? 'thin' : 'medium', color: { argb: borderColor } },
    };
  };

  // Helper to style and format an individual table data cell
  const renderDataCell = (
    cell: any,
    headerText: string,
    colIdx: number,
    rawVal: any,
    rowIdx: number,
    rowBg: string
  ) => {
    const isCurr = isCurrencyColumn(headerText);
    const isDate = isDateColumn(headerText);
    const isWrap = isWrapTextColumn(headerText);

    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: rowBg },
    };
    cell.font = {
      name: 'Segoe UI',
      size: 9.5,
      color: { argb: KITS_EXCEL_THEME.SLATE_BODY },
    };
    applyCellBorder(cell, KITS_EXCEL_THEME.BORDER_BODY, true);

    let horizontalAlign: 'left' | 'center' | 'right' = 'left';

    // 1. S.No or First Numeric Column
    if (
      colIdx === 0 &&
      (headerText.toLowerCase() === 's.no' ||
        headerText.toLowerCase() === '#' ||
        headerText.toLowerCase() === 'sl.no')
    ) {
      cell.value = rawVal !== undefined && rawVal !== null ? rawVal : rowIdx + 1;
      horizontalAlign = 'center';
      cell.font = {
        name: 'Segoe UI',
        size: 9.5,
        bold: true,
        color: { argb: KITS_EXCEL_THEME.SLATE_MUTED },
      };
    }
    // 2. Currency Column
    else if (isCurr) {
      horizontalAlign = 'right';
      if (rawVal !== undefined && rawVal !== null && rawVal !== '' && rawVal !== '—') {
        const num = typeof rawVal === 'number' ? rawVal : Number(String(rawVal).replace(/[^0-9.-]/g, ''));
        if (!isNaN(num)) {
          cell.value = num;
          cell.numFmt = '"₹"#,##0';
        } else {
          cell.value = String(rawVal);
        }
      } else {
        cell.value = 0;
        cell.numFmt = '"₹"#,##0';
      }
    }
    // 3. Date / Time Column
    else if (isDate) {
      horizontalAlign = 'center';
      cell.value = formatInstitutionalDateTime(rawVal);
    }
    // 4. Status Column Check (Restrained Institutional Semantic Badges)
    else if (typeof rawVal === 'string' && STATUS_STYLES[rawVal.trim().toUpperCase()]) {
      horizontalAlign = 'center';
      const stKey = rawVal.trim().toUpperCase();
      const style = STATUS_STYLES[stKey];
      cell.value = rawVal.trim();
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: style.bg },
      };
      cell.font = {
        name: 'Segoe UI',
        size: 9,
        bold: true,
        color: { argb: style.text },
      };
    }
    // 5. Short Academic / Roll Number / Mobile / Tokens / Mode / Year
    else if (
      headerText.toLowerCase().includes('roll') ||
      headerText.toLowerCase().includes('year') ||
      headerText.toLowerCase().includes('mobile') ||
      headerText.toLowerCase().includes('phone') ||
      headerText.toLowerCase().includes('token') ||
      headerText.toLowerCase().includes('mode') ||
      headerText.toLowerCase().includes('team size')
    ) {
      horizontalAlign = 'center';
      cell.value = rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '' ? rawVal : '—';
    }
    // 6. Generic Text / Identifiers
    else {
      cell.value = rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '' ? rawVal : '—';
    }

    cell.alignment = {
      horizontal: horizontalAlign,
      vertical: 'middle',
      wrapText: isWrap,
    };
  };

  // ==========================================
  // 1. INSTITUTIONAL TITLE BLOCK (Rows 1 to 4)
  // ==========================================

  // ROW 1: System Title Bar (KITS RED)
  ws.mergeCells(1, 1, 1, numCols);
  const row1Cell = ws.getCell(1, 1);
  row1Cell.value = 'KITS-EOS  •  EVENT OPERATIONS SYSTEM';
  row1Cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: KITS_EXCEL_THEME.KITS_RED },
  };
  row1Cell.font = {
    name: 'Segoe UI',
    size: 13,
    bold: true,
    color: { argb: KITS_EXCEL_THEME.WHITE },
  };
  row1Cell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  // ROW 2: Institution Bar (AKSHAR BLUE)
  ws.mergeCells(2, 1, 2, numCols);
  const row2Cell = ws.getCell(2, 1);
  row2Cell.value = 'KITS Akshar Institute of Technology';
  row2Cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: KITS_EXCEL_THEME.AKSHAR_BLUE },
  };
  row2Cell.font = {
    name: 'Segoe UI',
    size: 11,
    bold: true,
    color: { argb: KITS_EXCEL_THEME.WHITE },
  };
  row2Cell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 22;

  // ROW 3: Report Title & Subtitle Bar (Soft Neutral)
  ws.mergeCells(3, 1, 3, numCols);
  const row3Cell = ws.getCell(3, 1);
  const formattedReportTitle = subtitle ? `${title.toUpperCase()} — ${subtitle}` : title.toUpperCase();
  row3Cell.value = formattedReportTitle;
  row3Cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: KITS_EXCEL_THEME.TITLE_BG },
  };
  row3Cell.font = {
    name: 'Segoe UI',
    size: 11,
    bold: true,
    color: { argb: KITS_EXCEL_THEME.DARK_SLATE },
  };
  row3Cell.alignment = { horizontal: 'center', vertical: 'middle' };
  applyCellBorder(row3Cell, KITS_EXCEL_THEME.BORDER_HEADER, true);
  ws.getRow(3).height = 24;

  // ROW 4: Executive Metadata Bar
  ws.mergeCells(4, 1, 4, numCols);
  const row4Cell = ws.getCell(4, 1);
  const now = new Date();
  const timestampStr = formatInstitutionalDateTime(now);
  const metaParts: string[] = [
    `Generated On: ${timestampStr} IST`,
    `Total Records: ${allRows.length}`,
    'Official Campus Record',
  ];
  if (options.metadata?.scope) {
    metaParts.push(`Scope: ${options.metadata.scope}`);
  }
  row4Cell.value = metaParts.join('   |   ');
  row4Cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: KITS_EXCEL_THEME.LIGHT_BG },
  };
  row4Cell.font = {
    name: 'Segoe UI',
    size: 9.5,
    italic: true,
    color: { argb: KITS_EXCEL_THEME.SLATE_MUTED },
  };
  row4Cell.alignment = { horizontal: 'center', vertical: 'middle' };
  applyCellBorder(row4Cell, KITS_EXCEL_THEME.BORDER_BODY, true);
  ws.getRow(4).height = 20;

  // ROW 5: Spacing Row
  ws.getRow(5).height = 10;

  // ==========================================
  // 2. BODY CONTENT (Sections vs. Single Flat Table)
  // ==========================================
  if (hasSections) {
    let curRow = 6;

    sections!.forEach((sec, secIdx) => {
      // A. Section Heading Banner Row (e.g. "TECH INNOVATION CHALLENGE")
      ws.mergeCells(curRow, 1, curRow, numCols);
      const secCell = ws.getCell(curRow, 1);
      secCell.value = sec.title.toUpperCase();
      secCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: KITS_EXCEL_THEME.AKSHAR_BLUE },
      };
      secCell.font = {
        name: 'Segoe UI',
        size: 11,
        bold: true,
        color: { argb: KITS_EXCEL_THEME.WHITE },
      };
      secCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      applyCellBorder(secCell, KITS_EXCEL_THEME.BORDER_HEADER, true);
      ws.getRow(curRow).height = 26;
      curRow++;

      // B. Section Column Headers Row
      const sHeaderRow = ws.getRow(curRow);
      sHeaderRow.height = 28;
      headers.forEach((headerText, colIdx) => {
        const colNumber = colIdx + 1;
        const cell = sHeaderRow.getCell(colNumber);
        cell.value = headerText;

        const isRed = colIdx % 2 === 0;
        const headerBg = isRed ? KITS_EXCEL_THEME.KITS_RED : KITS_EXCEL_THEME.AKSHAR_BLUE;

        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: headerBg },
        };
        cell.font = {
          name: 'Segoe UI',
          size: 10,
          bold: true,
          color: { argb: KITS_EXCEL_THEME.WHITE },
        };
        cell.alignment = {
          horizontal: 'center',
          vertical: 'middle',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin', color: { argb: KITS_EXCEL_THEME.BORDER_HEADER } },
          bottom: { style: 'medium', color: { argb: KITS_EXCEL_THEME.DARK_SLATE } },
          left: { style: 'thin', color: { argb: KITS_EXCEL_THEME.BORDER_HEADER } },
          right: { style: 'thin', color: { argb: KITS_EXCEL_THEME.BORDER_HEADER } },
        };
      });
      curRow++;

      // C. Section Participant Data Rows
      sec.rows.forEach((row, rowIdx) => {
        const dataRow = ws.getRow(curRow);
        dataRow.height = 24;
        const isZebra = rowIdx % 2 !== 0;
        const rowBg = isZebra ? KITS_EXCEL_THEME.LIGHT_BG : KITS_EXCEL_THEME.WHITE;

        headers.forEach((headerText, colIdx) => {
          const colNumber = colIdx + 1;
          const cell = dataRow.getCell(colNumber);
          const rawVal = row[colIdx];
          renderDataCell(cell, headerText, colIdx, rawVal, rowIdx, rowBg);
        });
        curRow++;
      });

      // D. Spacing Row between grouped sections
      if (secIdx < sections!.length - 1) {
        ws.getRow(curRow).height = 14;
        curRow++;
      }
    });
  } else {
    // Flat Table Architecture (Row 6 Global Headers + Row 7+ Data Rows)
    const headerRow = ws.getRow(6);
    headerRow.height = 30;

    headers.forEach((headerText, colIdx) => {
      const colNumber = colIdx + 1;
      const cell = headerRow.getCell(colNumber);
      cell.value = headerText;

      const isRed = colIdx % 2 === 0;
      const headerBg = isRed ? KITS_EXCEL_THEME.KITS_RED : KITS_EXCEL_THEME.AKSHAR_BLUE;

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: headerBg },
      };
      cell.font = {
        name: 'Segoe UI',
        size: 10,
        bold: true,
        color: { argb: KITS_EXCEL_THEME.WHITE },
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: KITS_EXCEL_THEME.BORDER_HEADER } },
        bottom: { style: 'medium', color: { argb: KITS_EXCEL_THEME.DARK_SLATE } },
        left: { style: 'thin', color: { argb: KITS_EXCEL_THEME.BORDER_HEADER } },
        right: { style: 'thin', color: { argb: KITS_EXCEL_THEME.BORDER_HEADER } },
      };
    });

    // Auto-Filter on Row 6
    ws.autoFilter = {
      from: { row: 6, column: 1 },
      to: { row: 6, column: headers.length },
    };

    allRows.forEach((row, rowIdx) => {
      const rowNumber = rowIdx + 7;
      const dataRow = ws.getRow(rowNumber);
      dataRow.height = 24;

      const isZebra = rowIdx % 2 !== 0;
      const rowBg = isZebra ? KITS_EXCEL_THEME.LIGHT_BG : KITS_EXCEL_THEME.WHITE;

      headers.forEach((headerText, colIdx) => {
        const colNumber = colIdx + 1;
        const cell = dataRow.getCell(colNumber);
        const rawVal = row[colIdx];
        renderDataCell(cell, headerText, colIdx, rawVal, rowIdx, rowBg);
      });
    });
  }

  // ==========================================
  // 3. COLUMN WIDTH CALCULATION
  // Generous human-readable widths + padding
  // ==========================================
  headers.forEach((headerText, colIdx) => {
    const colNumber = colIdx + 1;
    const column = ws.getColumn(colNumber);

    if (colWidths && colWidths[colIdx]) {
      column.width = colWidths[colIdx];
      return;
    }

    let maxLen = headerText.length;
    for (let r = 0; r < Math.min(allRows.length, 250); r++) {
      const cellVal = allRows[r][colIdx];
      if (cellVal !== undefined && cellVal !== null) {
        const str = String(cellVal);
        const lines = str.split('\n');
        for (const line of lines) {
          if (line.length > maxLen) {
            maxLen = line.length;
          }
        }
      }
    }

    const isWrap = isWrapTextColumn(headerText);
    const minWidth = colIdx === 0 ? 8 : (headerText.toLowerCase().includes('roll') ? 16 : 14);
    const maxWidth = isWrap ? 60 : 42;
    column.width = Math.min(Math.max(maxLen + 4, minWidth), maxWidth);
  });

  return workbook;
}

/**
 * Universal Global KITS-EOS Excel Downloader.
 * Generates and downloads an authentic, beautifully styled .xlsx spreadsheet in the browser.
 */
export async function exportToExcel(options: ExcelExportOptions): Promise<void> {
  const workbook = await createKitsExcelWorkbook(options);

  const rawFilename = options.filename.trim();
  const finalFilename = rawFilename.toLowerCase().endsWith('.xlsx')
    ? rawFilename
    : `${rawFilename}.xlsx`;

  try {
    const buffer = await workbook.xlsx.writeBuffer();

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = finalFilename;
      document.body.appendChild(anchor);
      anchor.click();

      setTimeout(() => {
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }, 300);
    } else {
      // Server/Node context fallback
      await (workbook.xlsx as any).writeFile(finalFilename);
    }
  } catch (err) {
    console.error('Failed to write or download Excel workbook:', err);
    throw err;
  }
}
