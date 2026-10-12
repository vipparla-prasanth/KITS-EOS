export {
  exportToExcel,
  createKitsExcelWorkbook,
  formatInstitutionalDateTime,
  KITS_EXCEL_THEME,
  REGISTRATION_REPORT_HEADERS,
  REGISTRATION_ROSTER_HEADERS,
  COORDINATOR_OVERALL_REPORT_HEADERS,
} from './excelExport';
export type { ExcelExportOptions, ExcelExportSection } from './excelExport';

export interface PNGExportOptions {
  filename: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  colWidths?: number[]; // percentage or relative weights e.g. [8, 22, 18, 16, 16, 20]
  rowsPerPage?: number;
}

/**
 * Generates and downloads high-resolution PNG image table(s).
 * Automatically paginates for large recordsets so text remains crisp and readable.
 */
export async function exportTableToPNG(options: PNGExportOptions): Promise<void> {
  const { filename, title, subtitle, headers, rows, rowsPerPage = 25 } = options;

  if (rows.length === 0) {
    throw new Error('No records available to export.');
  }

  const timestamp = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const totalPages = Math.ceil(rows.length / rowsPerPage);

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pageRows = rows.slice(pageIdx * rowsPerPage, (pageIdx + 1) * rowsPerPage);
    await generateAndDownloadPNGPage({
      filename: totalPages > 1 ? `${filename.replace(/\.png$/i, '')}_page_${pageIdx + 1}.png` : filename,
      title,
      subtitle,
      headers,
      rows: pageRows,
      pageNumber: pageIdx + 1,
      totalPages,
      timestamp,
      colWeights: options.colWidths,
    });
  }
}

interface PageRenderOptions {
  filename: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  pageNumber: number;
  totalPages: number;
  timestamp: string;
  colWeights?: number[];
}

function generateAndDownloadPNGPage(options: PageRenderOptions): Promise<void> {
  return new Promise((resolve) => {
    const { filename, title, subtitle, headers, rows, pageNumber, totalPages, timestamp, colWeights } = options;

    const baseWidth = 1280;
    const headerHeight = 170;
    const tableHeaderHeight = 44;
    const rowHeight = 40;
    const footerHeight = 60;
    const paddingX = 48;

    const totalHeight = headerHeight + tableHeaderHeight + rows.length * rowHeight + footerHeight;

    const scale = 2; // 2x Retina scale for ultra-sharp typography
    const canvas = document.createElement('canvas');
    canvas.width = baseWidth * scale;
    canvas.height = totalHeight * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve();
      return;
    }

    ctx.scale(scale, scale);

    // 1. Background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, baseWidth, totalHeight);

    // 2. Institutional Top Header Bar
    ctx.fillStyle = '#DC2626'; // KITS Red Accent Bar
    ctx.fillRect(0, 0, baseWidth, 6);

    // Brand Name: KITS Akshar Institute of Technology
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
    ctx.fillText('KITS Akshar Institute of Technology', paddingX, 42);

    // System Title: KITS-EOS
    ctx.fillStyle = '#2563EB'; // Akshar Blue
    ctx.font = '900 13px system-ui, -apple-system, sans-serif';
    ctx.fillText('KITS-EOS • EVENT OPERATIONS SYSTEM', paddingX, 62);

    // Directory Subtitle
    ctx.fillStyle = '#1E293B';
    ctx.font = '800 18px system-ui, -apple-system, sans-serif';
    ctx.fillText(subtitle ? `${title.toUpperCase()} — ${subtitle.toUpperCase()}` : title.toUpperCase(), paddingX, 98);

    // Meta Timestamp & Badge
    ctx.fillStyle = '#64748B';
    ctx.font = '500 12px system-ui, -apple-system, sans-serif';
    ctx.fillText(`Generated: ${timestamp} IST  |  Official Campus Directory Record`, paddingX, 122);

    // Divider Line
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingX, 140);
    ctx.lineTo(baseWidth - paddingX, 140);
    ctx.stroke();

    // 3. Table Column Geometry
    const tableWidth = baseWidth - paddingX * 2;
    const numCols = headers.length;

    // Calculate column widths
    const weights = colWeights && colWeights.length === numCols
      ? colWeights
      : Array(numCols).fill(1);
    const sumWeights = weights.reduce((a, b) => a + b, 0);
    const colWidths = weights.map(w => (w / sumWeights) * tableWidth);

    let startY = headerHeight;

    // 4. Table Header Row
    ctx.fillStyle = '#1E293B'; // Dark Slate Table Header
    ctx.fillRect(paddingX, startY, tableWidth, tableHeaderHeight);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';

    let curX = paddingX;
    headers.forEach((headerText, i) => {
      const w = colWidths[i];
      const textX = i === 0 ? curX + w / 2 : curX + 14;
      const align = i === 0 ? 'center' : 'left';
      ctx.textAlign = align;
      ctx.fillText(headerText.toUpperCase(), textX, startY + tableHeaderHeight / 2);
      curX += w;
    });

    startY += tableHeaderHeight;

    // 5. Table Data Rows
    ctx.font = '12px system-ui, -apple-system, sans-serif';

    rows.forEach((row, rowIdx) => {
      const isEven = rowIdx % 2 === 0;
      ctx.fillStyle = isEven ? '#FFFFFF' : '#F8FAFC';
      ctx.fillRect(paddingX, startY, tableWidth, rowHeight);

      // Border Bottom
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(paddingX, startY + rowHeight);
      ctx.lineTo(paddingX + tableWidth, startY + rowHeight);
      ctx.stroke();

      let cellX = paddingX;
      row.forEach((cellVal, colIdx) => {
        const w = colWidths[colIdx];
        const text = cellVal !== undefined && cellVal !== null ? String(cellVal) : '-';

        // Column alignment
        if (colIdx === 0) {
          ctx.textAlign = 'center';
          ctx.fillStyle = '#64748B';
          ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
          ctx.fillText(text, cellX + w / 2, startY + rowHeight / 2);
        } else {
          ctx.textAlign = 'left';

          // Specific formatting for Roles
          if (text.toUpperCase().includes('FACULTY')) {
            ctx.fillStyle = '#DC2626'; // KITS Red
            ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
          } else if (text.toUpperCase().includes('STUDENT')) {
            ctx.fillStyle = '#2563EB'; // Akshar Blue
            ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
          } else if (colIdx === 1) {
            ctx.fillStyle = '#0F172A';
            ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
          } else {
            ctx.fillStyle = '#334155';
            ctx.font = '12px system-ui, -apple-system, sans-serif';
          }

          // Truncate text with ellipsis if too long for column
          const maxTextWidth = w - 24;
          let renderedText = text;
          if (ctx.measureText(renderedText).width > maxTextWidth) {
            while (renderedText.length > 3 && ctx.measureText(renderedText + '...').width > maxTextWidth) {
              renderedText = renderedText.slice(0, -1);
            }
            renderedText += '...';
          }

          ctx.fillText(renderedText, cellX + 14, startY + rowHeight / 2);
        }

        cellX += w;
      });

      startY += rowHeight;
    });

    // Table Outer Border
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.strokeRect(paddingX, headerHeight, tableWidth, tableHeaderHeight + rows.length * rowHeight);

    // 6. Footer
    ctx.textAlign = 'left';
    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 11px system-ui, -apple-system, sans-serif';
    ctx.fillText('KITS Akshar Institute of Technology  •  KITS-EOS Central Platform', paddingX, startY + 32);

    if (totalPages > 1) {
      ctx.textAlign = 'right';
      ctx.fillText(`Page ${pageNumber} of ${totalPages}`, baseWidth - paddingX, startY + 32);
    }

    // 7. Trigger Direct Browser Download
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const finalFilename = filename.endsWith('.png') ? filename : `${filename}.png`;
      link.setAttribute('href', url);
      link.setAttribute('download', finalFilename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
}

export interface RegistrationParticipantExportItem {
  name: string;
  rollNumber: string;
  college: string;
  dept: string;
  year: number | string;
  phone: string;
  email: string;
  eventName: string;
  categoryName: string;
  subEventName: string;
  participationType: string;
  teamName: string;
  role: string;
  regStatus: string;
  paymentMethod?: string;
  paymentStatus: string;
  paymentAmount?: number;
  referenceId?: string;
  isAttended: boolean;
  attendanceTime?: string | null;
  verificationMethod?: string;
  manualToken?: string;
  regId: string;
  regCreatedAt?: string;
}

/**
 * Sorts participants strictly:
 * 1. College / Institution — Alphabetically
 * 2. Student Name — Alphabetically
 * 3. Roll Number — Stable secondary ordering
 */
export function sortParticipantsCollegeAndAlphabetical<T extends { college?: string; name?: string; rollNumber?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    // 1. College / Institution — Alphabetically
    const collegeA = (a.college || 'KITS Akshar Institute of Technology').trim().toLowerCase();
    const collegeB = (b.college || 'KITS Akshar Institute of Technology').trim().toLowerCase();
    const collegeCompare = collegeA.localeCompare(collegeB, undefined, { sensitivity: 'base' });
    if (collegeCompare !== 0) return collegeCompare;

    // 2. Student Name — Alphabetically
    const nameA = (a.name || '').trim().toLowerCase();
    const nameB = (b.name || '').trim().toLowerCase();
    const nameCompare = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    if (nameCompare !== 0) return nameCompare;

    // 3. Roll Number — Stable secondary ordering
    const rollA = (a.rollNumber || '').trim().toLowerCase();
    const rollB = (b.rollNumber || '').trim().toLowerCase();
    return rollA.localeCompare(rollB, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/**
 * Builds standard institutional sanitized export filename
 */
export function getRegistrationExportFilename(params: {
  scopePrefix?: string;
  eventName?: string;
  subEventName?: string;
  attendanceFilter: 'ALL' | 'ATTENDED' | 'NOT_ATTENDED' | 'PENDING';
}): string {
  const sanitize = (str: string) =>
    (str || '')
      .replace(/\[QA-SANDBOX\]/gi, 'QA')
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

  const parts: string[] = [params.scopePrefix ? sanitize(params.scopePrefix) : 'KITS-EOS'];

  if (params.eventName && params.eventName !== 'ALL') {
    parts.push(sanitize(params.eventName));
  }
  if (params.subEventName && params.subEventName !== 'ALL') {
    parts.push(sanitize(params.subEventName));
  }

  if (params.attendanceFilter === 'ATTENDED') {
    parts.push('Attended_Students');
  } else if (params.attendanceFilter === 'NOT_ATTENDED' || params.attendanceFilter === 'PENDING') {
    parts.push('Not_Attended_Students');
  } else {
    parts.push('All_Registrations');
  }

  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  parts.push(`${yyyy}-${mm}-${dd}`);

  return `${parts.join('_')}.xlsx`;
}
