/**
 * Utility functions for exporting and downloading Complete Digital ID Cards, QR Passes, Receipts, and Certificates.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { renderCertificateToCanvas } from '@kits-eos/shared';
import type { CertificateRenderOptions } from '@kits-eos/shared';

export type { CertificateRenderOptions };
export { renderCertificateToCanvas };

/**
 * Generates an export-safe SVG string for certificate QR verification.
 * Injects xmlns attribute to guarantee rendering compatibility when converted to image/canvas/PDF.
 */
export function generateCertificateQrSvg(certificateCode: string, size = 120): string {
  const origin = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : 'https://kits-akshar-eos.web.app';
  const verifyUrl = `${origin}/verify/${certificateCode}`;

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
 * Generates an export-safe Data URL for the QR code to be drawn directly onto HTML5 Canvas.
 */
export function generateCertificateQrDataUrl(certificateCode: string, size = 220): string {
  const svgString = generateCertificateQrSvg(certificateCode, size);
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

// Re-export consolidated Digital ID Card & Credential Export utilities from @kits-eos/shared
export {
  downloadSvgAsPng,
  printDocument,
  downloadIdCardAsHighResImage,
  downloadIdCardAsPdf,
  downloadTeamIdCardAsPdf,
  downloadTeamIdCardAsHighResImage,
  type IdCardRenderOptions,
  type TeamMemberExportItem,
  type TeamIdCardRenderOptions,
} from '@kits-eos/shared';

export async function downloadCertificateAsHighResImage(options: CertificateRenderOptions): Promise<void> {
  const renderOpts = { ...options };
  if (!renderOpts.qrDataUrl && renderOpts.certificateCode) {
    renderOpts.qrDataUrl = generateCertificateQrDataUrl(renderOpts.certificateCode, 220);
  }
  const canvas = await renderCertificateToCanvas(renderOpts);
  const pngUrl = canvas.toDataURL('image/png', 1.0);
  const downloadLink = document.createElement('a');
  downloadLink.download = `Certificate_${options.certificateCode}.png`;
  downloadLink.href = pngUrl;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

/**
 * Triggers clean Landscape PDF generation of the certificate using the official
 * college banner asset, authoritative institutional typography, and embedded QR code.
 */
export async function downloadCertificateAsPdf(options: CertificateRenderOptions): Promise<void> {
  const renderOpts = { ...options };
  if (!renderOpts.qrDataUrl && renderOpts.certificateCode) {
    renderOpts.qrDataUrl = generateCertificateQrDataUrl(renderOpts.certificateCode, 280);
  }
  const canvas = await renderCertificateToCanvas(renderOpts);
  const canvasPngDataUrl = canvas.toDataURL('image/png', 1.0);

  const printWindow = window.open('', '_blank', 'width=1100,height=800');
  if (!printWindow) {
    window.print();
    return;
  }

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Certificate - ${options.certificateCode}</title>
        <style>
          @page {
            size: A4 landscape;
            margin: 0;
          }
          *, *::before, *::after {
            box-sizing: border-box;
          }
          html, body {
            margin: 0;
            padding: 0;
            width: 100vw;
            height: 100vh;
            background: #ffffff;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .cert-print-img {
            width: 100vw;
            height: 100vh;
            object-fit: contain;
            display: block;
          }
          @media print {
            html, body {
              width: 100%;
              height: 100%;
            }
            .cert-print-img {
              width: 100%;
              height: 100%;
              page-break-after: avoid;
              page-break-inside: avoid;
            }
          }
        </style>
      </head>
      <body>
        <img src="${canvasPngDataUrl}" class="cert-print-img" alt="Certificate - ${options.certificateCode}" />
        <script>
          function printWhenReady() {
            setTimeout(function() {
              window.print();
              window.close();
            }, 300);
          }
          if (document.images[0] && document.images[0].complete) {
            printWhenReady();
          } else if (document.images[0]) {
            document.images[0].onload = printWhenReady;
          } else {
            window.addEventListener('load', printWhenReady);
          }
        </script>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

