import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import {
  renderAssessmentResultToCanvas,
  type AssessmentResultRenderOptions,
} from '@kits-eos/shared';

export type { AssessmentResultRenderOptions };
export { renderAssessmentResultToCanvas };

/**
 * Generates an SVG string for QR verification.
 */
export function generateVerificationQrSvg(urlOrCode: string, size = 160): string {
  const verifyUrl = urlOrCode.startsWith('http')
    ? urlOrCode
    : `${typeof window !== 'undefined' ? window.location.origin : 'https://kits-akshar-eos.web.app'}/verify/${urlOrCode}`;

  let svgString = renderToStaticMarkup(
    React.createElement(QRCodeSVG, {
      value: verifyUrl,
      size,
      level: 'H',
      includeMargin: false,
    })
  );

  if (!svgString.includes('xmlns=')) {
    svgString = svgString.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  }
  return svgString;
}

/**
 * Generates an export-safe Data URL for QR verification code.
 */
export function generateVerificationQrDataUrl(urlOrCode: string, size = 240): string {
  const svgString = generateVerificationQrSvg(urlOrCode, size);
  let base64 = '';
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    base64 = window.btoa(unescape(encodeURIComponent(svgString)));
  } else if (typeof globalThis !== 'undefined') {
    const maybeBuffer = (globalThis as unknown as { Buffer?: { from: (str: string) => { toString: (enc: string) => string } } }).Buffer;
    if (maybeBuffer) {
      base64 = maybeBuffer.from(svgString).toString('base64');
    }
  }
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Downloads the Assessment Score Report / Result as a High-Res PNG Image.
 */
export async function downloadAssessmentResultAsImage(options: AssessmentResultRenderOptions): Promise<void> {
  const renderOpts = { ...options };
  if (!renderOpts.qrDataUrl && renderOpts.resultReferenceId) {
    const verifyTarget = typeof window !== 'undefined'
      ? `${window.location.origin}/assessments/${options.resultReferenceId}`
      : options.resultReferenceId;
    renderOpts.qrDataUrl = generateVerificationQrDataUrl(verifyTarget, 220);
  }

  const canvas = await renderAssessmentResultToCanvas(renderOpts);
  const pngUrl = canvas.toDataURL('image/png', 1.0);
  const downloadLink = document.createElement('a');
  const safeTitle = options.assessmentTitle.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  downloadLink.download = `Result_${safeTitle}_${options.rollNumber || 'Score'}.png`;
  downloadLink.href = pngUrl;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

import {
  generateDetailedAssessmentResultPdf,
  type AssessmentAnswerReviewPdfOptions,
} from './assessmentAnswerReviewPdf';

export type { AssessmentAnswerReviewPdfOptions };
export { generateDetailedAssessmentResultPdf };

/**
 * Downloads the Assessment Score Report / Result as an A4 Portrait PDF.
 * When questions and answers are supplied, generates an institutional,
 * multi-page question-by-question answer review transcript.
 */
export async function downloadAssessmentResultAsPdf(
  options: AssessmentAnswerReviewPdfOptions
): Promise<void> {
  const safeTitle = (options.assessmentTitle || 'Assessment')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 30);
  const fileName = `Result_${safeTitle}_${options.rollNumber || 'Score'}.pdf`;

  // 1. Detailed Question-by-Question Answer Review Mode
  if (options.questions && options.questions.length > 0) {
    const pdf = await generateDetailedAssessmentResultPdf(options);
    pdf.save(fileName);
    return;
  }

  // 2. Summary Fallback Mode (Single Page Canvas)
  const renderOpts = { ...options };
  if (!renderOpts.qrDataUrl && renderOpts.resultReferenceId) {
    const verifyTarget = typeof window !== 'undefined'
      ? `${window.location.origin}/assessments/${options.resultReferenceId}`
      : options.resultReferenceId;
    renderOpts.qrDataUrl = generateVerificationQrDataUrl(verifyTarget, 240);
  }

  const canvas = await renderAssessmentResultToCanvas(renderOpts);
  const canvasPngDataUrl = canvas.toDataURL('image/png', 1.0);

  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4', // 210 x 297 mm
  });

  pdf.addImage(canvasPngDataUrl, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  pdf.save(fileName);
}


