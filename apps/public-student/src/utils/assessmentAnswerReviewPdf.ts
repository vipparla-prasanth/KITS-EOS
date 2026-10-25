/**
 * Assessment Result & Detailed Answer Review PDF Generation Engine
 * 
 * Generates an institutional, publication-grade multi-page PDF transcript
 * for KITS-AKSHAR-EOS examination results, providing a complete
 * question-by-question performance review:
 *  - Official KITS Akshar Institute of Technology branding & logo
 *  - Candidate & Examination Executive Summary
 *  - Clean typography without stray Unicode glyphs or brackets
 *  - Every question in authoritative candidate sequence
 *  - High-contrast, grayscale-friendly candidate choices
 *  - Standardized answer badges:
 *      * "Your Choice (Correct)"
 *      * "Your Choice (Incorrect)" with visible strike-through
 *      * "Correct Answer"
 *  - Dynamic option layout: side-by-side for short text, stacked for multi-line/code
 *  - Safe text wrapping that handles unbroken strings & URLs without overflow
 *  - Points awarded per question vs maximum possible points
 *  - Question bank explanations & academic feedback
 *  - Intelligent page-breaking, multi-page running headers, and pagination
 */

import type { jsPDF } from 'jspdf';
import type { AssessmentQuestion, AssessmentAttemptAnswer } from '@kits-eos/shared';
import type { AssessmentResultRenderOptions } from '@kits-eos/shared';

export interface AssessmentAnswerReviewPdfOptions extends AssessmentResultRenderOptions {
  questions?: AssessmentQuestion[];
  answers?: AssessmentAttemptAnswer[];
  solutionsMap?: Record<string, {
    correct_option_id?: string | null;
    correct_boolean?: boolean | null;
    explanation?: string | null;
  }>;
  isClosed?: boolean;
}

/**
 * Safely wraps text to a maximum width in millimeters.
 * Handles explicit newlines, paragraphs, long unbroken words (e.g. SQL, URLs, code),
 * and prevents any text from clipping or exceeding printable boundaries.
 */
export function safeWrapText(pdf: jsPDF, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split('\n');
  const resultLines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      resultLines.push('');
      continue;
    }

    const words = para.split(' ');
    const safeWords: string[] = [];

    for (const word of words) {
      if (pdf.getTextWidth(word) > maxWidth) {
        // Break long unbroken token into character chunks that fit within maxWidth
        let remaining = word;
        while (remaining.length > 0) {
          let sliceLen = remaining.length;
          while (sliceLen > 1 && pdf.getTextWidth(remaining.slice(0, sliceLen)) > maxWidth) {
            sliceLen--;
          }
          safeWords.push(remaining.slice(0, sliceLen));
          remaining = remaining.slice(sliceLen);
        }
      } else {
        safeWords.push(word);
      }
    }

    const wrapped = pdf.splitTextToSize(safeWords.join(' '), maxWidth);
    if (Array.isArray(wrapped)) {
      resultLines.push(...wrapped);
    } else if (wrapped) {
      resultLines.push(wrapped);
    }
  }

  return resultLines;
}

/**
 * Safely loads the official KITS Akshar Institute of Technology logo as a PNG Data URL.
 * Gracefully resolves to null in headless / test environments without throwing.
 */
async function loadLogoDataUrl(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 120;
          canvas.height = img.naturalHeight || img.height || 120;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = '/college_logo.png';
    } catch {
      resolve(null);
    }
  });
}

/**
 * Builds the comprehensive question-by-question assessment result PDF.
 */
export async function generateDetailedAssessmentResultPdf(
  options: AssessmentAnswerReviewPdfOptions
): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4', // 210 x 297 mm
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const leftMargin = 16;
  const rightMargin = 16;
  const topMargin = 18;
  const bottomMargin = 18;
  const contentWidth = pageWidth - leftMargin - rightMargin; // 178 mm

  const logoDataUrl = await loadLogoDataUrl();
  let currentY = topMargin;

  // Helper: check page space and break cleanly if needed
  const checkPageBreak = (neededHeight: number): boolean => {
    if (currentY + neededHeight > pageHeight - bottomMargin) {
      pdf.addPage();
      currentY = topMargin;
      return true;
    }
    return false;
  };

  // ============================================================================
  // 1. INSTITUTIONAL HEADER (Page 1)
  // ============================================================================
  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, 'PNG', leftMargin, currentY, 18, 18, undefined, 'FAST');
    } catch {
      // Graceful fallback if image cannot be rendered
    }
  }

  const headerTextX = logoDataUrl ? leftMargin + 22 : leftMargin;

  // College Name (Bold, Navy)
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(0, 40, 85); // KITS Navy #002855
  pdf.text('KITS AKSHAR INSTITUTE OF TECHNOLOGY', headerTextX, currentY + 4.5);

  // Subtitle (Bold, KITS Red)
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(200, 16, 46); // KITS Red #C8102E
  pdf.text('KITS-AKSHAR-EOS • OFFICIAL CANDIDATE ASSESSMENT ANSWER REVIEW', headerTextX, currentY + 9.5);

  // Accreditation & Sub-heading
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text('Department of Technical Examinations • Question-by-Question Verified Result Transcript', headerTextX, currentY + 14);

  currentY += 20;

  // Double accent divider lines (Red 0.8mm + Navy 0.3mm)
  pdf.setDrawColor(200, 16, 46);
  pdf.setLineWidth(0.8);
  pdf.line(leftMargin, currentY, leftMargin + contentWidth, currentY);

  pdf.setDrawColor(0, 40, 85);
  pdf.setLineWidth(0.3);
  pdf.line(leftMargin, currentY + 1.2, leftMargin + contentWidth, currentY + 1.2);

  currentY += 5;

  // ============================================================================
  // 2. CANDIDATE & ASSESSMENT SUMMARY CARD
  // ============================================================================
  const summaryBoxHeight = 44;
  pdf.setFillColor(248, 250, 252); // #F8FAFC
  pdf.setDrawColor(203, 213, 225); // #CBD5E1
  pdf.setLineWidth(0.4);
  pdf.roundedRect(leftMargin, currentY, contentWidth, summaryBoxHeight, 2, 2, 'FD');

  // Top Title Bar of Summary Box
  pdf.setFillColor(0, 40, 85);
  pdf.roundedRect(leftMargin, currentY, contentWidth, 7, 2, 2, 'F');
  pdf.rect(leftMargin, currentY + 4, contentWidth, 3, 'F'); // square off bottom corners of bar

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(255, 255, 255);
  pdf.text('EXAMINATION & CANDIDATE PERFORMANCE SUMMARY', leftMargin + 4, currentY + 4.8);
  pdf.text(`REF ID: ${options.resultReferenceId || 'KITS-EXAM'}`, leftMargin + contentWidth - 4, currentY + 4.8, { align: 'right' });

  const cardContentY = currentY + 11.5;
  const col1X = leftMargin + 4;
  const col2X = leftMargin + (contentWidth / 2) + 2;

  // Left Column: Candidate Info
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text('Candidate Name:', col1X, cardContentY);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text(options.studentName || 'Student Candidate', col1X + 26, cardContentY);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text('Roll Number:', col1X, cardContentY + 5);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text(options.rollNumber || 'N/A', col1X + 26, cardContentY + 5);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text('Institution:', col1X, cardContentY + 10);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(51, 65, 85);
  const collegeText = options.department
    ? `${options.department} • ${options.college || 'KITS Akshar'}`
    : (options.college || 'KITS Akshar Institute of Technology');
  const splitCollege = safeWrapText(pdf, collegeText, (contentWidth / 2) - 28);
  pdf.text(splitCollege[0] || collegeText, col1X + 26, cardContentY + 10);

  // Right Column: Assessment Info
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text('Assessment:', col2X, cardContentY);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(15, 23, 42);
  const splitTitle = safeWrapText(pdf, options.assessmentTitle, (contentWidth / 2) - 26);
  pdf.text(splitTitle[0] || options.assessmentTitle, col2X + 22, cardContentY);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text('Date / Time:', col2X, cardContentY + 5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(51, 65, 85);
  pdf.text(options.completionDate || new Date().toLocaleDateString('en-IN'), col2X + 22, cardContentY + 5);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text('Final Result:', col2X, cardContentY + 10);

  const isPass = options.isPassed;
  if (isPass) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(22, 101, 52); // Dark Green
    pdf.text(`PASSED (${options.percentage.toFixed(1)}%) • Passing Mark: ${options.passingPercentage}%`, col2X + 22, cardContentY + 10);
  } else {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(185, 28, 28); // Dark Red
    pdf.text(`DID NOT PASS (${options.percentage.toFixed(1)}%) • Passing Mark: ${options.passingPercentage}%`, col2X + 22, cardContentY + 10);
  }

  // Summary Metrics Bar (5 KPIs across the bottom of the card)
  // Standard ASCII text only to guarantee zero WinAnsi encoding artifacts or stray apostrophes
  const metricBarY = currentY + 28;
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.3);
  pdf.line(leftMargin + 2, metricBarY, leftMargin + contentWidth - 2, metricBarY);

  const totalQuestions = options.totalQuestions || (options.questions?.length ?? 0);
  const earnedScore = options.earnedScore;
  const totalPoints = options.totalPoints;
  const correctCount = options.correctCount;
  const incorrectCount = options.incorrectCount;
  const unattemptedCount = options.unattemptedCount;

  const kpiWidth = contentWidth / 5;
  const kpis = [
    { label: 'TOTAL QUESTIONS', val: `${totalQuestions}`, color: [15, 23, 42] },
    { label: 'TOTAL MARKS', val: `${earnedScore} / ${totalPoints}`, color: isPass ? [22, 101, 52] : [185, 28, 28] },
    { label: 'CORRECT ANSWERS', val: `${correctCount}`, color: [22, 101, 52] },
    { label: 'INCORRECT ANSWERS', val: `${incorrectCount}`, color: [185, 28, 28] },
    { label: 'UNANSWERED', val: `${unattemptedCount}`, color: [146, 64, 14] },
  ];

  kpis.forEach((kpi, kIdx) => {
    const kpiX = leftMargin + kIdx * kpiWidth;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(5.8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(kpi.label, kpiX + (kpiWidth / 2), metricBarY + 4.8, { align: 'center' });

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    pdf.text(kpi.val, kpiX + (kpiWidth / 2), metricBarY + 10, { align: 'center' });

    if (kIdx < 4) {
      pdf.setDrawColor(226, 232, 240);
      pdf.line(kpiX + kpiWidth, metricBarY + 2, kpiX + kpiWidth, metricBarY + 12.5);
    }
  });

  currentY += summaryBoxHeight + 6;

  // ============================================================================
  // 3. SECTION HEADER: QUESTION-BY-QUESTION REVIEW
  // ============================================================================
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setTextColor(0, 40, 85);
  pdf.text('QUESTION-BY-QUESTION ANSWER REVIEW', leftMargin, currentY);

  const isClosed = Boolean(options.isClosed);
  if (isClosed) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(22, 101, 52);
    pdf.text('Authoritative Answer Key & Explanations Officially Released', leftMargin + contentWidth, currentY, { align: 'right' });
  } else {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(185, 28, 28);
    pdf.text('Answer Keys Confidential (Assessment Window Ongoing)', leftMargin + contentWidth, currentY, { align: 'right' });
  }

  currentY += 3;
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.3);
  pdf.line(leftMargin, currentY, leftMargin + contentWidth, currentY);
  currentY += 5;

  // ============================================================================
  // 4. QUESTION RENDERING LOOP
  // ============================================================================
  const questions = options.questions || [];
  const answers = options.answers || [];
  const solutionsMap = options.solutionsMap || {};

  // Build Answer Lookup Map: question_id -> answer
  const answersByQuestionId: Record<string, AssessmentAttemptAnswer> = {};
  answers.forEach((ans) => {
    answersByQuestionId[ans.question_id] = ans;
  });

  questions.forEach((q, qIdx) => {
    const candidateAns = answersByQuestionId[q.id];
    const isAnswered = Boolean(candidateAns);
    const isCorrect = candidateAns?.is_correct === true;
    const pointsAwarded = candidateAns?.points_awarded !== undefined && candidateAns?.points_awarded !== null
      ? Number(candidateAns.points_awarded)
      : 0;
    const maxPoints = Number(q.points) || 0;

    const correctOptionId = isClosed ? solutionsMap[q.id]?.correct_option_id : null;
    const correctBoolean = isClosed ? solutionsMap[q.id]?.correct_boolean : null;
    const explanation = (isClosed ? (solutionsMap[q.id]?.explanation || q.explanation) : null)?.trim();

    // Prepare Question Text lines with safe wrap
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.2);
    const qLines = safeWrapText(pdf, q.question_text || '', contentWidth - 8);
    const qTextHeight = qLines.length * 4.2;

    // Check minimum required space before starting question:
    // Estimate total question block height (header + text + options + explanation)
    // If the question fits on a single page, break cleanly beforehand to prevent splitting options across pages.
    const numOptions = q.question_type === 'TRUE_FALSE' ? 2 : (q.options?.length || 4);
    const estimatedOptionsHeight = numOptions * 9.0;
    const estimatedExpHeight = explanation ? 18.0 : 0;
    const totalQuestionBlockHeight = 8.5 + qTextHeight + estimatedOptionsHeight + estimatedExpHeight + 6;

    if (totalQuestionBlockHeight < (pageHeight - topMargin - bottomMargin - 15)) {
      checkPageBreak(totalQuestionBlockHeight);
    } else {
      // For exceptionally long questions, ensure at least header, text, and 2 options fit
      checkPageBreak(qTextHeight + 25);
    }

    // 1. Question Header Banner
    pdf.setFillColor(241, 245, 249); // #F1F5F9
    pdf.rect(leftMargin, currentY, contentWidth, 6, 'F');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(0, 40, 85);
    const qTypeLabel = q.question_type === 'TRUE_FALSE' ? 'TRUE / FALSE' : 'MCQ';
    pdf.text(`QUESTION ${qIdx + 1} OF ${questions.length} • ${qTypeLabel}`, leftMargin + 3, currentY + 4.2);

    // Right-aligned status and awarded marks (Standard characters without stray glyphs or brackets)
    if (!isAnswered) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(180, 83, 9); // Amber
      pdf.text(`Unanswered • 0 / ${maxPoints} Marks`, leftMargin + contentWidth - 3, currentY + 4.2, { align: 'right' });
    } else if (!isClosed) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(71, 85, 105); // Neutral
      pdf.text(`Recorded • ${maxPoints} Marks`, leftMargin + contentWidth - 3, currentY + 4.2, { align: 'right' });
    } else if (isCorrect) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(22, 101, 52); // Green
      pdf.text(`Correct • +${pointsAwarded} / ${maxPoints} Marks`, leftMargin + contentWidth - 3, currentY + 4.2, { align: 'right' });
    } else {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(185, 28, 28); // Red
      pdf.text(`Incorrect • ${pointsAwarded} / ${maxPoints} Marks`, leftMargin + contentWidth - 3, currentY + 4.2, { align: 'right' });
    }

    currentY += 8.5;

    // 2. Question Text
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.2);
    pdf.setTextColor(15, 23, 42); // #0F172A
    pdf.text(qLines, leftMargin + 3, currentY);
    currentY += qTextHeight + 2;

    // 3. Options Rendering Function (MCQ and True/False Unified Engine)
    interface RenderOptionItem {
      id: string;
      label: string;
      text: string;
      isSelected: boolean;
      isCorrectKey: boolean;
    }

    const optionItems: RenderOptionItem[] = [];

    if (q.question_type === 'MCQ') {
      const opts = q.options || [];
      opts.forEach((opt, oIdx) => {
        optionItems.push({
          id: opt.id || `opt-${oIdx}`,
          label: `${String.fromCharCode(65 + oIdx)}.`,
          text: opt.option_text || '',
          isSelected: candidateAns?.selected_option_id === opt.id,
          isCorrectKey: isClosed && Boolean(correctOptionId && correctOptionId === opt.id),
        });
      });
    } else {
      // TRUE_FALSE Question Type
      const tfChoices = [
        { label: 'A.', text: 'True', val: true },
        { label: 'B.', text: 'False', val: false },
      ];
      tfChoices.forEach((choice, cIdx) => {
        const matchingOpt = q.options?.find(
          (o) => o.option_text?.toLowerCase() === choice.text.toLowerCase()
        ) || q.options?.[cIdx];

        const isSelected = candidateAns?.selected_boolean === choice.val ||
          Boolean(matchingOpt && candidateAns?.selected_option_id === matchingOpt.id);

        const isCorrectKey = isClosed && (
          (correctBoolean !== null && correctBoolean !== undefined && correctBoolean === choice.val) ||
          Boolean(matchingOpt && correctOptionId && correctOptionId === matchingOpt.id)
        );

        optionItems.push({
          id: matchingOpt?.id || `tf-${choice.val}`,
          label: choice.label,
          text: choice.text,
          isSelected,
          isCorrectKey,
        });
      });
    }

    // Render each option with dynamic layout (side-by-side vs stacked badge row)
    optionItems.forEach((optItem) => {
      const isSelected = optItem.isSelected;
      const isCorrectKey = optItem.isCorrectKey;
      const isIncorrectSelection = isSelected && isClosed ? !isCorrectKey : isSelected && !isCorrect;
      const isCorrectSelection = isSelected && isClosed ? isCorrectKey : isSelected && isCorrect;

      // Determine clean status badge text (NO square brackets, NO stray symbols)
      let badgeText: string | null = null;
      let badgeColor: [number, number, number] = [71, 85, 105];
      let badgeBgColor: [number, number, number] = [241, 245, 249];
      let badgeBorderColor: [number, number, number] = [203, 213, 225];

      if (!isClosed) {
        if (isSelected) {
          badgeText = 'Your Choice';
          badgeColor = [30, 58, 138];       // Blue text
          badgeBgColor = [239, 246, 255];    // #EFF6FF
          badgeBorderColor = [191, 219, 254];
        }
      } else if (isCorrectSelection) {
        badgeText = 'Your Choice (Correct)';
        badgeColor = [22, 101, 52];       // Green text
        badgeBgColor = [220, 252, 231];    // #DCFCE7
        badgeBorderColor = [22, 101, 52];
      } else if (isIncorrectSelection) {
        badgeText = 'Your Choice (Incorrect)';
        badgeColor = [185, 28, 28];      // Red text
        badgeBgColor = [254, 226, 226];    // #FEE2E2
        badgeBorderColor = [185, 28, 28];
      } else if (isCorrectKey) {
        badgeText = 'Correct Answer';
        badgeColor = [22, 101, 52];       // Green text
        badgeBgColor = [220, 252, 231];    // #DCFCE7
        badgeBorderColor = [22, 101, 52];
      }

      // Calculate Badge dimensions if present
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.8);
      const badgeWidth = badgeText ? Math.ceil(pdf.getTextWidth(badgeText)) + 6 : 0;
      const badgeHeight = 5.2;

      // Determine Box Mode:
      // Side-by-side mode: text width is contentWidth - prefix (12mm) - badgeWidth - padding (12mm)
      const prefixWidth = 12;
      const sideTextWidth = badgeText
        ? Math.max(60, contentWidth - prefixWidth - badgeWidth - 8)
        : contentWidth - prefixWidth - 6;

      pdf.setFont('helvetica', isSelected || isCorrectKey ? 'bold' : 'normal');
      pdf.setFontSize(7.5);
      const sideLines = safeWrapText(pdf, optItem.text, sideTextWidth);

      // If text fits in 1 or 2 lines in side-by-side mode, use Mode A (side-by-side)
      // Otherwise, use Mode B (stacked badge row below full-width text) to avoid any cramping
      const useSideBySide = sideLines.length <= 2;

      let optLines: string[];
      let boxHeight: number;
      const lineHeight = 4.0;

      if (useSideBySide) {
        optLines = sideLines;
        boxHeight = Math.max(7.5, optLines.length * lineHeight + 3.5);
      } else {
        const fullTextWidth = contentWidth - prefixWidth - 6;
        optLines = safeWrapText(pdf, optItem.text, fullTextWidth);
        const textSectionHeight = optLines.length * lineHeight + 3.5;
        boxHeight = badgeText ? textSectionHeight + badgeHeight + 3.5 : textSectionHeight + 2.0;
      }

      // Check page break before rendering the option box
      checkPageBreak(boxHeight + 2);

      // Determine option box background fill and border
      if (isCorrectSelection || isCorrectKey) {
        pdf.setFillColor(240, 253, 244); // #F0FDF4 Soft Green
        pdf.setDrawColor(22, 101, 52);   // #166534
        pdf.setLineWidth(0.5);
      } else if (isIncorrectSelection) {
        pdf.setFillColor(254, 242, 242); // #FEF2F2 Soft Red
        pdf.setDrawColor(185, 28, 28);   // #B91C1C
        pdf.setLineWidth(0.5);
      } else {
        pdf.setFillColor(248, 250, 252); // #F8FAFC Neutral
        pdf.setDrawColor(226, 232, 240); // #E2E8F0
        pdf.setLineWidth(0.2);
      }

      // Draw Option Container Box
      pdf.roundedRect(leftMargin, currentY, contentWidth, boxHeight, 1.2, 1.2, 'FD');

      // Draw Option Prefix (A., B., True, etc.)
      pdf.setFont('helvetica', isSelected || isCorrectKey ? 'bold' : 'normal');
      pdf.setFontSize(7.5);
      if (isCorrectSelection || isCorrectKey) {
        pdf.setTextColor(20, 83, 45);
      } else if (isIncorrectSelection) {
        pdf.setTextColor(153, 27, 27);
      } else {
        pdf.setTextColor(51, 65, 85);
      }
      pdf.text(optItem.label, leftMargin + 3.5, currentY + 4.8);

      // Draw Option Text
      const textStartX = leftMargin + prefixWidth;
      pdf.text(optLines, textStartX, currentY + 4.8);

      // If Incorrect Selection: Render visible strike-through strictly over the option text
      if (isIncorrectSelection) {
        pdf.setDrawColor(185, 28, 28);
        pdf.setLineWidth(0.35);
        optLines.forEach((lineText, lIdx) => {
          const lineW = Math.min(
            useSideBySide ? sideTextWidth : contentWidth - prefixWidth - 6,
            pdf.getTextWidth(lineText)
          );
          if (lineW > 0) {
            const strikeY = currentY + 4.8 + (lIdx * lineHeight) - 1.0;
            pdf.line(textStartX, strikeY, textStartX + lineW, strikeY);
          }
        });
      }

      // Draw Answer Indicator Badge if present
      if (badgeText) {
        let badgeX: number;
        let badgeY: number;

        if (useSideBySide) {
          badgeX = leftMargin + contentWidth - badgeWidth - 3.5;
          badgeY = currentY + (boxHeight - badgeHeight) / 2;
        } else {
          // Mode B: Dedicated bottom badge row, right-aligned
          badgeX = leftMargin + contentWidth - badgeWidth - 3.5;
          badgeY = currentY + (optLines.length * lineHeight) + 3.2;
        }

        // Draw Pill Badge Background & Border
        pdf.setFillColor(badgeBgColor[0], badgeBgColor[1], badgeBgColor[2]);
        pdf.setDrawColor(badgeBorderColor[0], badgeBorderColor[1], badgeBorderColor[2]);
        pdf.setLineWidth(0.35);
        pdf.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 1.0, 1.0, 'FD');

        // Draw Pill Badge Text
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.8);
        pdf.setTextColor(badgeColor[0], badgeColor[1], badgeColor[2]);
        pdf.text(badgeText, badgeX + (badgeWidth / 2), badgeY + 3.6, { align: 'center' });
      }

      currentY += boxHeight + 2;
    });

    // 4. Unanswered Notice (if candidate skipped question)
    if (!isAnswered) {
      const unansHeight = 7;
      checkPageBreak(unansHeight + 2);

      pdf.setFillColor(254, 243, 199); // #FEF3C7
      pdf.setDrawColor(253, 230, 138); // #FDE68A
      pdf.setLineWidth(0.3);
      pdf.roundedRect(leftMargin, currentY, contentWidth, unansHeight, 1, 1, 'FD');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.2);
      pdf.setTextColor(146, 64, 14); // Amber
      pdf.text(`Notice: Candidate did not select an answer for this question (0 / ${maxPoints} Marks Awarded)`, leftMargin + 4, currentY + 4.8);
      currentY += unansHeight + 2.5;
    }

    // 5. Question Bank Explanation Box (when explanation exists & released)
    if (explanation) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.2);
      const expLines = safeWrapText(pdf, explanation, contentWidth - 12);
      const expBoxHeight = expLines.length * 3.8 + 8.5;

      checkPageBreak(expBoxHeight + 2);

      pdf.setFillColor(239, 246, 255); // Light Blue #EFF6FF
      pdf.setDrawColor(191, 219, 254); // Border #BFDBFE
      pdf.setLineWidth(0.35);
      pdf.roundedRect(leftMargin, currentY, contentWidth, expBoxHeight, 1.2, 1.2, 'FD');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      pdf.setTextColor(30, 58, 138); // #1E3A8A
      pdf.text('Academic Explanation & Question Review:', leftMargin + 4, currentY + 4.8);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.2);
      pdf.setTextColor(51, 65, 85);
      pdf.text(expLines, leftMargin + 4, currentY + 9.2);

      currentY += expBoxHeight + 3;
    }

    // Subtle divider line between questions
    currentY += 1.5;
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);
    pdf.line(leftMargin, currentY, leftMargin + contentWidth, currentY);
    currentY += 4.5; // Spacing before next question
  });

  // ============================================================================
  // 5. MULTI-PAGE RUNNING HEADERS & FOOTERS (All Pages)
  // ============================================================================
  const totalPages = (pdf.internal as any).getNumberOfPages();

  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);

    // Running Header (Pages 2+)
    if (i > 1) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(0, 40, 85);
      pdf.text('KITS AKSHAR INSTITUTE OF TECHNOLOGY • ASSESSMENT ANSWER REVIEW', leftMargin, 10.5);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.5);
      pdf.setTextColor(100, 116, 139);
      const titleSnippet = options.assessmentTitle.length > 38
        ? `${options.assessmentTitle.slice(0, 38)}...`
        : options.assessmentTitle;
      pdf.text(titleSnippet, leftMargin + contentWidth, 10.5, { align: 'right' });

      pdf.setDrawColor(203, 213, 225);
      pdf.setLineWidth(0.3);
      pdf.line(leftMargin, 12.5, leftMargin + contentWidth, 12.5);
    }

    // Running Footer (All Pages)
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.3);
    pdf.line(leftMargin, pageHeight - 12, leftMargin + contentWidth, pageHeight - 12);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(
      `KITS-AKSHAR-EOS • Ref: ${options.resultReferenceId || 'KITS-EXAM'} • Candidate: ${options.studentName || 'Student'} (${options.rollNumber || 'N/A'})`,
      leftMargin,
      pageHeight - 8
    );

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(71, 85, 105);
    pdf.text(`Page ${i} of ${totalPages}`, leftMargin + contentWidth, pageHeight - 8, { align: 'right' });
  }

  return pdf;
}
