/**
 * KITS-EOS DIGITAL ID CARD & CREDENTIAL EXPORT ENGINE
 * Official Digital Event Pass & Team Pass Generator
 * EXACT 9:16 Portrait Canvas (1080 x 1920 Base / 2160 x 3840 4K High-Res)
 * Custom 9:16 Single-Page PDF (108mm x 192mm) & Pixel-Accurate Print Engine
 */

export interface IdCardRenderOptions {
  studentName: string;
  rollNumber: string;
  department: string;
  year: number | string;
  college: string;
  email?: string;
  phone?: string;
  eventName: string;
  categoryName?: string;
  subEventName: string;
  participationType: string; // 'SOLO' | 'TEAM' | 'BOTH'
  teamName?: string;
  teamRole?: 'TEAM LEADER' | 'TEAM MEMBER' | 'SOLO PARTICIPANT' | string;
  registrationId: string;
  manualToken: string;
  qrIdentity?: string;
  qrPayload?: string;
  qrSvgElementId?: string;
  registrationDate?: string;
  status?: string;
  academicYear?: string;
}

export interface TeamMemberExportItem {
  id?: string;
  name: string;
  department: string;
  year: number | string;
  rollNumber: string;
  college?: string;
  isLeader?: boolean;
}

export interface TeamIdCardRenderOptions {
  teamName: string;
  eventName: string;
  categoryName?: string;
  subEventName: string;
  members: TeamMemberExportItem[];
  registrationId: string;
  manualToken: string;
  qrPayload?: string;
  qrSvgElementId?: string;
  academicYear?: string;
}

// ============================================================================
// CANVAS 2D DRAWING & GEOMETRY HELPERS
// ============================================================================

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  initialSize: number,
  minSize = 12,
  weight = '800',
  fontFamily = 'Montserrat, "Segoe UI", -apple-system, sans-serif'
): number {
  let size = initialSize;
  ctx.font = `${weight} ${size}px ${fontFamily}`;
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${fontFamily}`;
  }

  let displayText = text;
  if (ctx.measureText(displayText).width > maxWidth) {
    while (displayText.length > 3 && ctx.measureText(displayText + '...').width > maxWidth) {
      displayText = displayText.slice(0, -1);
    }
    displayText += '...';
  }

  ctx.fillText(displayText, x, y);
  return size;
}

function drawTokenBadgeText(
  ctx: CanvasRenderingContext2D,
  token: string,
  centerX: number,
  badgeY: number,
  badgeW: number,
  badgeH: number
): void {
  if (!token) return;

  ctx.save();
  ctx.fillStyle = '#FCD34D'; // Amber 300
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxW = badgeW - 24;
  let fontSize = 21;
  ctx.font = `900 ${fontSize}px monospace`;

  // Scale down if needed to fit on 1 line
  while (ctx.measureText(token).width > maxW && fontSize > 13) {
    fontSize -= 1;
    ctx.font = `900 ${fontSize}px monospace`;
  }

  // If fits on 1 line with size >= 13, draw single line centered
  if (ctx.measureText(token).width <= maxW) {
    ctx.fillText(token, centerX, badgeY + badgeH / 2);
    ctx.restore();
    return;
  }

  // Otherwise, wrap onto 2 lines cleanly without ANY ellipsis or clipping
  const mid = Math.floor(token.length / 2);
  let splitIndex = token.lastIndexOf('-', mid);
  if (splitIndex < Math.floor(token.length * 0.28)) {
    splitIndex = token.indexOf('-', mid);
  }
  if (splitIndex === -1 || splitIndex < Math.floor(token.length * 0.2) || splitIndex > Math.floor(token.length * 0.8)) {
    splitIndex = mid;
  } else {
    splitIndex += 1;
  }

  const line1 = token.slice(0, splitIndex);
  const line2 = token.slice(splitIndex);

  let lineFontSize = 13;
  ctx.font = `900 ${lineFontSize}px monospace`;
  while ((ctx.measureText(line1).width > maxW || ctx.measureText(line2).width > maxW) && lineFontSize > 8) {
    lineFontSize -= 1;
    ctx.font = `900 ${lineFontSize}px monospace`;
  }

  ctx.fillText(line1, centerX, badgeY + badgeH / 2 - (lineFontSize * 0.65));
  ctx.fillText(line2, centerX, badgeY + badgeH / 2 + (lineFontSize * 0.65));
  ctx.restore();
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function getQrImage(
  svgId?: string,
  registrationId?: string
): Promise<HTMLImageElement | null> {
  let qrSvg: SVGElement | null = null;
  if (svgId) {
    qrSvg = document.getElementById(svgId) as unknown as SVGElement | null;
  }
  if (!qrSvg && registrationId) {
    qrSvg = document.getElementById(`team-qr-svg-${registrationId.slice(0, 8)}`) as unknown as SVGElement | null;
  }
  if (!qrSvg && registrationId) {
    qrSvg = document.getElementById(`qr-svg-${registrationId.slice(0, 8)}`) as unknown as SVGElement | null;
  }
  if (!qrSvg && registrationId) {
    qrSvg = document.getElementById(`admin-qr-svg-${registrationId.slice(0, 8)}`) as unknown as SVGElement | null;
  }
  if (!qrSvg) {
    qrSvg = document.querySelector('.qr-box svg') || document.querySelector('.qr-container svg');
  }

  if (qrSvg) {
    const svgData = new XMLSerializer().serializeToString(qrSvg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = await loadImage(url);
    URL.revokeObjectURL(url);
    return img;
  }
  return null;
}

// ============================================================================
// NATIVE VECTOR PATH ICONS (Guaranteed 100% crispness across all resolutions)
// ============================================================================

function drawCalendarIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.08;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const w = size * 0.8;
  const h = size * 0.75;
  const ox = x + size * 0.1;
  const oy = y + size * 0.15;

  // Box
  ctx.beginPath();
  drawRoundedRect(ctx, ox, oy, w, h, size * 0.12);
  ctx.stroke();

  // Top header line
  ctx.beginPath();
  ctx.moveTo(ox, oy + h * 0.28);
  ctx.lineTo(ox + w, oy + h * 0.28);
  ctx.stroke();

  // Binder hooks
  ctx.beginPath();
  ctx.moveTo(ox + w * 0.25, oy - size * 0.08);
  ctx.lineTo(ox + w * 0.25, oy + size * 0.06);
  ctx.moveTo(ox + w * 0.75, oy - size * 0.08);
  ctx.lineTo(ox + w * 0.75, oy + size * 0.06);
  ctx.stroke();

  // Grid dots
  const dotSize = size * 0.05;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      ctx.beginPath();
      ctx.arc(ox + w * (0.25 + c * 0.25), oy + h * (0.5 + r * 0.25), dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawCodeIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const cx = x + size / 2;
  const cy = y + size / 2;
  const span = size * 0.32;

  // <
  ctx.beginPath();
  ctx.moveTo(cx - span * 0.3, cy - span * 0.7);
  ctx.lineTo(cx - span * 1.0, cy);
  ctx.lineTo(cx - span * 0.3, cy + span * 0.7);
  ctx.stroke();

  // >
  ctx.beginPath();
  ctx.moveTo(cx + span * 0.3, cy - span * 0.7);
  ctx.lineTo(cx + span * 1.0, cy);
  ctx.lineTo(cx + span * 0.3, cy + span * 0.7);
  ctx.stroke();

  // /
  ctx.beginPath();
  ctx.moveTo(cx + span * 0.25, cy - span * 0.85);
  ctx.lineTo(cx - span * 0.25, cy + span * 0.85);
  ctx.stroke();

  ctx.restore();
}

function drawUsersIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.08;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const cx = x + size / 2;
  const cy = y + size / 2;

  // Main user head
  ctx.beginPath();
  ctx.arc(cx - size * 0.08, cy - size * 0.15, size * 0.16, 0, Math.PI * 2);
  ctx.stroke();

  // Main user body
  ctx.beginPath();
  ctx.arc(cx - size * 0.08, cy + size * 0.45, size * 0.32, Math.PI * 1.2, Math.PI * 1.8);
  ctx.stroke();

  // Secondary user head
  ctx.beginPath();
  ctx.arc(cx + size * 0.22, cy - size * 0.22, size * 0.12, 0, Math.PI * 2);
  ctx.stroke();

  // Secondary user body
  ctx.beginPath();
  ctx.arc(cx + size * 0.22, cy + size * 0.35, size * 0.24, Math.PI * 1.25, Math.PI * 1.75);
  ctx.stroke();

  ctx.restore();
}

function drawUserIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.09;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const cx = x + size / 2;
  const cy = y + size / 2;

  // Head
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.15, size * 0.22, 0, Math.PI * 2);
  ctx.stroke();

  // Body
  ctx.beginPath();
  ctx.arc(cx, cy + size * 0.5, size * 0.42, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  ctx.restore();
}

function drawBuildingIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.08;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const ox = x + size * 0.1;
  const oy = y + size * 0.1;
  const w = size * 0.8;
  const h = size * 0.8;

  // Pediment roof
  ctx.beginPath();
  ctx.moveTo(ox, oy + h * 0.3);
  ctx.lineTo(ox + w / 2, oy);
  ctx.lineTo(ox + w, oy + h * 0.3);
  ctx.closePath();
  ctx.stroke();

  // Architrave line
  ctx.beginPath();
  ctx.moveTo(ox - size * 0.05, oy + h * 0.35);
  ctx.lineTo(ox + w + size * 0.05, oy + h * 0.35);
  ctx.stroke();

  // 3 Columns
  ctx.beginPath();
  ctx.moveTo(ox + w * 0.18, oy + h * 0.35);
  ctx.lineTo(ox + w * 0.18, oy + h * 0.85);

  ctx.moveTo(ox + w * 0.5, oy + h * 0.35);
  ctx.lineTo(ox + w * 0.5, oy + h * 0.85);

  ctx.moveTo(ox + w * 0.82, oy + h * 0.35);
  ctx.lineTo(ox + w * 0.82, oy + h * 0.85);
  ctx.stroke();

  // Base
  ctx.beginPath();
  ctx.moveTo(ox - size * 0.08, oy + h * 0.88);
  ctx.lineTo(ox + w + size * 0.08, oy + h * 0.88);
  ctx.moveTo(ox - size * 0.04, oy + h);
  ctx.lineTo(ox + w + size * 0.04, oy + h);
  ctx.stroke();

  ctx.restore();
}

function drawGraduationCapIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.08;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const cx = x + size / 2;
  const cy = y + size * 0.42;
  const rx = size * 0.42;
  const ry = size * 0.2;

  // Mortarboard diamond
  ctx.beginPath();
  ctx.moveTo(cx, cy - ry);
  ctx.lineTo(cx + rx, cy);
  ctx.lineTo(cx, cy + ry);
  ctx.lineTo(cx - rx, cy);
  ctx.closePath();
  ctx.stroke();

  // Skull cap below
  ctx.beginPath();
  ctx.arc(cx, cy + ry * 0.6, rx * 0.55, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  // Tassel
  ctx.beginPath();
  ctx.moveTo(cx + rx * 0.6, cy + ry * 0.3);
  ctx.lineTo(cx + rx * 0.75, cy + ry * 1.8);
  ctx.stroke();

  ctx.restore();
}

function drawBarChartIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;

  const bw = size * 0.18;
  const ox = x + size * 0.1;
  const base = y + size * 0.9;

  // Bar 1
  ctx.fillRect(ox, base - size * 0.35, bw, size * 0.35);
  // Bar 2
  ctx.fillRect(ox + bw + size * 0.12, base - size * 0.55, bw, size * 0.55);
  // Bar 3
  ctx.fillRect(ox + (bw + size * 0.12) * 2, base - size * 0.8, bw, size * 0.8);

  ctx.restore();
}

function drawIdBadgeIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.08;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const ox = x + size * 0.1;
  const oy = y + size * 0.15;
  const w = size * 0.8;
  const h = size * 0.7;

  // Outer badge card
  ctx.beginPath();
  drawRoundedRect(ctx, ox, oy, w, h, size * 0.1);
  ctx.stroke();

  // Photo box
  ctx.strokeRect(ox + size * 0.1, oy + size * 0.12, size * 0.22, size * 0.25);

  // Lines
  ctx.beginPath();
  ctx.moveTo(ox + size * 0.4, oy + size * 0.18);
  ctx.lineTo(ox + w - size * 0.1, oy + size * 0.18);

  ctx.moveTo(ox + size * 0.4, oy + size * 0.32);
  ctx.lineTo(ox + w - size * 0.1, oy + size * 0.32);

  ctx.moveTo(ox + size * 0.1, oy + size * 0.52);
  ctx.lineTo(ox + w - size * 0.1, oy + size * 0.52);
  ctx.stroke();

  ctx.restore();
}

function drawCheckBadgeIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.44;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = size * 0.12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(cx - r * 0.45, cy);
  ctx.lineTo(cx - r * 0.1, cy + r * 0.4);
  ctx.lineTo(cx + r * 0.5, cy - r * 0.35);
  ctx.stroke();

  ctx.restore();
}

function drawLocationPinIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.08;

  const cx = x + size / 2;
  const cy = y + size * 0.4;
  const r = size * 0.32;

  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.8, Math.PI * 0.2, true);
  ctx.lineTo(cx, y + size * 0.95);
  ctx.closePath();
  ctx.fill();

  // Center circle hole
  ctx.fillStyle = '#002B49';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCheckmarkIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + size * 0.2, y + size * 0.52);
  ctx.lineTo(x + size * 0.44, y + size * 0.76);
  ctx.lineTo(x + size * 0.82, y + size * 0.26);
  ctx.stroke();
  ctx.restore();
}

function drawAwardIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const cx = x + size / 2;
  const cy = y + size * 0.38;
  const r = size * 0.28;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy + r * 0.8);
  ctx.lineTo(cx - r * 0.8, y + size * 0.95);
  ctx.lineTo(cx - r * 0.2, y + size * 0.82);
  ctx.lineTo(cx, y + size * 0.95);
  ctx.lineTo(cx + r * 0.2, y + size * 0.82);
  ctx.lineTo(cx + r * 0.8, y + size * 0.95);
  ctx.lineTo(cx + r * 0.5, cy + r * 0.8);
  ctx.stroke();

  ctx.restore();
}

// ============================================================================
// CORE CANVASES RENDERER (1080 x 1920 Base • 9:16 Aspect Ratio)
// ============================================================================

const BASE_WIDTH = 1080;
const BASE_HEIGHT = 1920;

export async function renderTeamIdCardToCanvas(
  options: TeamIdCardRenderOptions,
  scale = 1
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = BASE_WIDTH * scale;
  canvas.height = BASE_HEIGHT * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  if (scale !== 1) {
    ctx.scale(scale, scale);
  }

  // 1. Crisp White Background & Outer Frame
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

  // Outer border & soft inner frame
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, BASE_WIDTH - 16, BASE_HEIGHT - 16);

  // 2. HEADER BANNER (KITS Red sliced into Akshar Blue)
  const headerHeight = 220;

  // Left Section: KITS Red Polygon
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(760, 0);
  ctx.lineTo(680, headerHeight);
  ctx.lineTo(0, headerHeight);
  ctx.closePath();
  const redGrad = ctx.createLinearGradient(0, 0, 760, headerHeight);
  redGrad.addColorStop(0, '#8F0817');
  redGrad.addColorStop(0.5, '#A00E1E');
  redGrad.addColorStop(1, '#C8102E');
  ctx.fillStyle = redGrad;
  ctx.fill();
  ctx.restore();

  // Right Section: Akshar Blue Polygon
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(760, 0);
  ctx.lineTo(BASE_WIDTH, 0);
  ctx.lineTo(BASE_WIDTH, headerHeight);
  ctx.lineTo(680, headerHeight);
  ctx.closePath();
  const blueGrad = ctx.createLinearGradient(680, 0, BASE_WIDTH, headerHeight);
  blueGrad.addColorStop(0, '#001F38');
  blueGrad.addColorStop(0.6, '#002B49');
  blueGrad.addColorStop(1, '#003366');
  ctx.fillStyle = blueGrad;
  ctx.fill();
  ctx.restore();

  // White / Gold Angled Divider Stripe
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(760, 0);
  ctx.lineTo(680, headerHeight);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Subtle gold accent parallel line
  ctx.beginPath();
  ctx.moveTo(768, 0);
  ctx.lineTo(688, headerHeight);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // College Logo (Circular medallion on left)
  const logoCircleX = 110;
  const logoCircleY = 110;
  const logoRadius = 72;

  ctx.save();
  ctx.beginPath();
  ctx.arc(logoCircleX, logoCircleY, logoRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 3;
  ctx.stroke();

  const logoImg = await loadImage('/college_logo.png');
  if (logoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoCircleX, logoCircleY, logoRadius - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, logoCircleX - 60, logoCircleY - 60, 120, 120);
    ctx.restore();
  }
  ctx.restore();

  // Header Typography (Left Red Section)
  const textLeftX = 215;
  ctx.textAlign = 'left';

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 36px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('KITS AKSHAR', textLeftX, 72);

  ctx.font = '800 23px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('INSTITUTE OF TECHNOLOGY', textLeftX, 108);

  ctx.fillStyle = '#FBBF24'; // Restrained Gold
  ctx.font = '800 13px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('CENTRAL EVENT OPERATIONS SYSTEM • KITS-EOS', textLeftX, 140);

  const academicYear = options.academicYear || '2025-26';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 14px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText(`OFFICIAL DIGITAL EVENT PASS • ${academicYear}`, textLeftX, 172);

  // Header Right Panel (KITS-EOS Brand & Feature List)
  const navyCenterX = 890;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 32px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('KITS-EOS', navyCenterX, 56);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '800 12px Montserrat, "Segoe UI", sans-serif';
  const navX = 810;
  drawCalendarIcon(ctx, navX, 81, 15, '#93C5FD');
  ctx.fillText('EVENTS', navX + 24, 94);
  drawUsersIcon(ctx, navX, 111, 15, '#93C5FD');
  ctx.fillText('PARTICIPATION', navX + 24, 124);
  drawCheckmarkIcon(ctx, navX, 141, 15, '#86EFAC');
  ctx.fillText('ATTENDANCE', navX + 24, 154);
  drawAwardIcon(ctx, navX, 171, 15, '#FDE047');
  ctx.fillText('CERTIFICATES', navX + 24, 184);

  // 3. CARD TYPE RIBBON (Centered "TEAM PASS")
  const ribbonY = 280;
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(60, ribbonY - 6);
  ctx.lineTo(340, ribbonY - 6);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(740, ribbonY - 6);
  ctx.lineTo(1020, ribbonY - 6);
  ctx.stroke();

  // Users icon next to TEAM PASS
  drawUsersIcon(ctx, 360, ribbonY - 38, 44, '#C8102E');

  ctx.textAlign = 'center';
  ctx.fillStyle = '#C8102E';
  ctx.font = '900 42px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('TEAM PASS', 565, ribbonY);

  ctx.fillStyle = '#64748B';
  ctx.font = '800 14px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('SCAN FOR TEAM ATTENDANCE AT THE EVENT', BASE_WIDTH / 2, ribbonY + 34);

  // 4. EVENT INFORMATION CARDS (Side-by-Side: Event Name & Sub Event)
  const eventBoxY = 345;
  const eventBoxH = 100;
  const eventBoxW = 475;

  // Box 1: EVENT NAME (Left)
  ctx.fillStyle = '#F8FAFC';
  drawRoundedRect(ctx, 50, eventBoxY, eventBoxW, eventBoxH, 16);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Calendar Icon Container
  ctx.fillStyle = '#FEE2E2';
  drawRoundedRect(ctx, 68, eventBoxY + 18, 64, 64, 14);
  ctx.fill();
  drawCalendarIcon(ctx, 75, eventBoxY + 25, 50, '#DC2626');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#64748B';
  ctx.font = '800 12px Montserrat, sans-serif';
  ctx.fillText('EVENT NAME', 148, eventBoxY + 35);

  ctx.fillStyle = '#0F172A';
  drawFittedText(ctx, (options.eventName || 'EVENT').toUpperCase(), 148, eventBoxY + 66, 360, 24, 15, '900');

  if (options.categoryName) {
    ctx.fillStyle = '#475569';
    ctx.font = '800 12px Montserrat, sans-serif';
    ctx.fillText(options.categoryName.toUpperCase(), 148, eventBoxY + 86);
  }

  // Box 2: SUB EVENT (Right)
  const subBoxX = 555;
  ctx.fillStyle = '#F8FAFC';
  drawRoundedRect(ctx, subBoxX, eventBoxY, eventBoxW, eventBoxH, 16);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Code Icon Container
  ctx.fillStyle = '#DBEAFE';
  drawRoundedRect(ctx, subBoxX + 18, eventBoxY + 18, 64, 64, 14);
  ctx.fill();
  drawCodeIcon(ctx, subBoxX + 25, eventBoxY + 25, 50, '#2563EB');

  ctx.fillStyle = '#64748B';
  ctx.font = '800 12px Montserrat, sans-serif';
  ctx.fillText('SUB EVENT', subBoxX + 98, eventBoxY + 35);

  ctx.fillStyle = '#002855';
  drawFittedText(ctx, (options.subEventName || 'SUB EVENT').toUpperCase(), subBoxX + 98, eventBoxY + 70, 360, 24, 15, '900');

  // 5. TEAM NAME BANNER
  const teamBannerY = 465;
  const teamBannerH = 75;
  const bannerW = 980;

  // Blue Gradient Banner
  ctx.save();
  drawRoundedRect(ctx, 50, teamBannerY, bannerW, teamBannerH, 14);
  const tGrad = ctx.createLinearGradient(50, teamBannerY, 50 + bannerW, teamBannerY);
  tGrad.addColorStop(0, '#003366');
  tGrad.addColorStop(1, '#0A4D8C');
  ctx.fillStyle = tGrad;
  ctx.fill();

  // Decorative right-side angled stripes
  ctx.beginPath();
  drawRoundedRect(ctx, 50, teamBannerY, bannerW, teamBannerH, 14);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 12;
  for (let s = 0; s < 4; s++) {
    ctx.beginPath();
    ctx.moveTo(920 + s * 30, teamBannerY - 20);
    ctx.lineTo(840 + s * 30, teamBannerY + teamBannerH + 20);
    ctx.stroke();
  }
  ctx.restore();

  // Users Icon on Banner
  drawUsersIcon(ctx, 70, teamBannerY + 14, 46, '#FFFFFF');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#93C5FD';
  ctx.font = '800 12px Montserrat, sans-serif';
  ctx.fillText('TEAM NAME', 135, teamBannerY + 28);

  ctx.fillStyle = '#FFFFFF';
  drawFittedText(ctx, (options.teamName || 'REGISTERED TEAM').toUpperCase(), 135, teamBannerY + 60, 800, 28, 16, '900');

  // 6. TEAM MEMBERS ROSTER
  const membersSectionY = 560;
  const membersHeaderH = 40;

  // Section Header Bar (Red)
  ctx.fillStyle = '#C8102E';
  drawRoundedRect(ctx, 50, membersSectionY, bannerW, membersHeaderH, 10);
  ctx.fill();

  drawUsersIcon(ctx, 68, membersSectionY + 7, 26, '#FFFFFF');
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 16px Montserrat, sans-serif';
  ctx.fillText(`TEAM MEMBERS (${options.members.length})`, 108, membersSectionY + 26);

  // Member Rows (Calculated dynamically to fill available vertical space without overlap)
  let curMemberY = membersSectionY + membersHeaderH + 10;
  const totalRosterBudget = 360;
  const count = Math.max(1, options.members.length);
  const gap = count <= 3 ? 10 : 6;
  const rowH = Math.min(95, Math.floor((totalRosterBudget - (count - 1) * gap) / count));

  for (let idx = 0; idx < options.members.length; idx++) {
    const m = options.members[idx];
    const isLeader = Boolean(m.isLeader || idx === 0);

    // Card container
    ctx.fillStyle = '#FFFFFF';
    drawRoundedRect(ctx, 50, curMemberY, bannerW, rowH, 12);
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Circle number badge
    const badgeR = Math.min(22, Math.floor(rowH * 0.28));
    const badgeX = 85;
    const badgeY = curMemberY + rowH / 2;

    ctx.fillStyle = isLeader ? '#FEE2E2' : '#EFF6FF';
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = isLeader ? '#991B1B' : '#1D4ED8';
    ctx.font = `900 ${badgeR}px Montserrat, sans-serif`;
    ctx.fillText(`${idx + 1}`, badgeX, badgeY + badgeR * 0.36);

    // Member Info Column 1 (Left: Name, Badge, College, Department)
    ctx.textAlign = 'left';
    const textBaseX = 125;
    const nameY = curMemberY + Math.min(26, rowH * 0.3);

    ctx.fillStyle = '#0F172A';
    const nameSize = rowH > 75 ? 20 : 16;
    ctx.font = `900 ${nameSize}px Montserrat, sans-serif`;
    ctx.fillText(m.name, textBaseX, nameY);

    const nameWidth = ctx.measureText(m.name).width;

    // TEAM LEADER Badge
    if (isLeader) {
      const badgeW = 105;
      const badgeH = 20;
      const bX = textBaseX + nameWidth + 14;
      const bY = nameY - 15;

      ctx.fillStyle = '#FEF3C7';
      drawRoundedRect(ctx, bX, bY, badgeW, badgeH, 6);
      ctx.fill();
      ctx.strokeStyle = '#FCD34D';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#92400E';
      ctx.font = '900 10px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('TEAM LEADER', bX + badgeW / 2, bY + 14);
      ctx.textAlign = 'left';
    }

    // Row 2: College (Dynamic per member! Never copies leader's college)
    const collegeY = nameY + (rowH > 75 ? 23 : 18);
    const collegeIconSize = rowH > 75 ? 16 : 14;
    drawBuildingIcon(ctx, textBaseX, collegeY - collegeIconSize + 3, collegeIconSize, '#475569');

    ctx.fillStyle = '#334155';
    const collegeText = m.college || 'KITS Akshar Institute of Technology';
    drawFittedText(ctx, collegeText, textBaseX + collegeIconSize + 6, collegeY, 560, rowH > 75 ? 13 : 11, 10, '700');

    // Row 3: Department (if room permits)
    if (rowH > 68) {
      const deptY = collegeY + 20;
      const deptIconSize = 16;
      drawGraduationCapIcon(ctx, textBaseX, deptY - deptIconSize + 3, deptIconSize, '#475569');

      ctx.fillStyle = '#475569';
      drawFittedText(ctx, m.department || 'Engineering', textBaseX + deptIconSize + 6, deptY, 560, 13, 10, '600');
    }

    // Column 2 (Right side: Year & Roll)
    const rightColX = 740;
    const yearY = curMemberY + (rowH > 75 ? 35 : 28);

    drawBarChartIcon(ctx, rightColX, yearY - 14, 18, '#334155');
    ctx.fillStyle = '#1E293B';
    ctx.font = '800 13px Montserrat, sans-serif';
    ctx.fillText(`Year ${m.year || 3}`, rightColX + 26, yearY);

    const rollY = yearY + (rowH > 75 ? 26 : 20);
    drawIdBadgeIcon(ctx, rightColX, rollY - 14, 18, '#334155');
    ctx.fillStyle = '#1E293B';
    ctx.font = '800 13px monospace';
    ctx.fillText(`Roll: ${m.rollNumber}`, rightColX + 26, rollY);

    curMemberY += rowH + gap;
  }

  // 7. QR CODE ATTENDANCE SECTION (Centered white box with pastel angled polygons)
  const qrSectionCenterY = 1210;

  // Background pastel polygonal wings (as seen in the reference image)
  // Left pastel rose polygon
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(30, qrSectionCenterY - 110);
  ctx.lineTo(310, qrSectionCenterY - 40);
  ctx.lineTo(240, qrSectionCenterY + 110);
  ctx.lineTo(20, qrSectionCenterY + 40);
  ctx.closePath();
  ctx.fillStyle = 'rgba(244, 63, 94, 0.12)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(60, qrSectionCenterY - 80);
  ctx.lineTo(280, qrSectionCenterY);
  ctx.lineTo(210, qrSectionCenterY + 130);
  ctx.lineTo(40, qrSectionCenterY + 60);
  ctx.closePath();
  ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
  ctx.fill();

  // Right pastel sky-blue polygon
  ctx.beginPath();
  ctx.moveTo(770, qrSectionCenterY - 40);
  ctx.lineTo(1050, qrSectionCenterY - 110);
  ctx.lineTo(1060, qrSectionCenterY + 40);
  ctx.lineTo(840, qrSectionCenterY + 110);
  ctx.closePath();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(800, qrSectionCenterY);
  ctx.lineTo(1020, qrSectionCenterY - 80);
  ctx.lineTo(1040, qrSectionCenterY + 60);
  ctx.lineTo(870, qrSectionCenterY + 130);
  ctx.closePath();
  ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
  ctx.fill();
  ctx.restore();

  // Centered White QR Box
  const qrBoxW = 390;
  const qrBoxH = 430;
  const qrBoxX = (BASE_WIDTH - qrBoxW) / 2;
  const qrBoxY = qrSectionCenterY - qrBoxH / 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxW, qrBoxH, 24);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.stroke();

  // QR Code Image
  const qrImgSize = 270;
  const qrImgX = (BASE_WIDTH - qrImgSize) / 2;
  const qrImgY = qrBoxY + 30;

  const qrImg = await getQrImage(options.qrSvgElementId, options.registrationId);
  if (qrImg) {
    ctx.drawImage(qrImg, qrImgX, qrImgY, qrImgSize, qrImgSize);
  } else {
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2;
    ctx.strokeRect(qrImgX, qrImgY, qrImgSize, qrImgSize);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0F172A';
    ctx.font = '800 16px monospace';
    ctx.fillText('ONE TEAM QR', BASE_WIDTH / 2, qrImgY + qrImgSize / 2);
  }

  // QR Caption below image (inside white card)
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = '900 18px Montserrat, sans-serif';
  ctx.fillText('ONE TEAM QR CODE', BASE_WIDTH / 2, qrBoxY + 350);

  // Subtitle below QR container
  ctx.fillStyle = '#64748B';
  ctx.font = '700 14px Montserrat, sans-serif';
  ctx.fillText('Scan by Coordinator for individual member attendance', BASE_WIDTH / 2, qrBoxY + 410);

  // 8. IDENTIFIERS ROW (3 Rounded Cards: Team Identifier, Registration ID, Verified Badge)
  const idRowY = 1495;
  const idCardW = 310;
  const idCardH = 110;
  const idGap = 25;

  // Card 1: TEAM IDENTIFIER (Left)
  const id1X = 50;
  ctx.fillStyle = '#FEF2F2';
  drawRoundedRect(ctx, id1X, idRowY, idCardW, idCardH, 14);
  ctx.fill();
  ctx.strokeStyle = '#FECACA';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Icon
  ctx.fillStyle = '#FEE2E2';
  drawRoundedRect(ctx, id1X + 16, idRowY + 16, 44, 44, 10);
  ctx.fill();
  drawUsersIcon(ctx, id1X + 22, idRowY + 22, 32, '#C8102E');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#C8102E';
  ctx.font = '900 11px Montserrat, sans-serif';
  ctx.fillText('TEAM IDENTIFIER', id1X + 70, idRowY + 32);

  ctx.fillStyle = '#0F172A';
  ctx.font = '800 12px Montserrat, sans-serif';
  ctx.fillText('TEAM ID', id1X + 70, idRowY + 50);

  ctx.fillStyle = '#0F172A';
  drawFittedText(ctx, options.manualToken || 'KITS-TEAM-001', id1X + 16, idRowY + 86, idCardW - 32, 13, 10, '900', 'monospace');

  // Card 2: REGISTRATION ID (Middle)
  const id2X = id1X + idCardW + idGap;
  ctx.fillStyle = '#F0F9FF';
  drawRoundedRect(ctx, id2X, idRowY, idCardW, idCardH, 14);
  ctx.fill();
  ctx.strokeStyle = '#BAE6FD';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#E0F2FE';
  drawRoundedRect(ctx, id2X + 16, idRowY + 16, 44, 44, 10);
  ctx.fill();
  drawIdBadgeIcon(ctx, id2X + 22, idRowY + 22, 32, '#0284C7');

  ctx.fillStyle = '#0284C7';
  ctx.font = '900 11px Montserrat, sans-serif';
  ctx.fillText('REGISTRATION ID', id2X + 70, idRowY + 35);

  ctx.fillStyle = '#0F172A';
  const regIdStr = options.registrationId || '';
  if (regIdStr.length > 20) {
    drawFittedText(ctx, regIdStr.slice(0, 20), id2X + 16, idRowY + 68, idCardW - 32, 12, 10, '800', 'monospace');
    drawFittedText(ctx, regIdStr.slice(20), id2X + 16, idRowY + 88, idCardW - 32, 12, 10, '800', 'monospace');
  } else {
    drawFittedText(ctx, regIdStr, id2X + 16, idRowY + 76, idCardW - 32, 13, 10, '800', 'monospace');
  }

  // Card 3: VERIFIED BADGE (Right)
  const id3X = id2X + idCardW + idGap;
  ctx.fillStyle = '#F0FDF4';
  drawRoundedRect(ctx, id3X, idRowY, idCardW, idCardH, 14);
  ctx.fill();
  ctx.strokeStyle = '#BBF7D0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  drawCheckBadgeIcon(ctx, id3X + 18, idRowY + 18, 42, '#16A34A');

  ctx.fillStyle = '#047857';
  ctx.font = '900 12px Montserrat, sans-serif';
  ctx.fillText('VERIFIED', id3X + 70, idRowY + 32);
  ctx.fillText('INSTITUTIONAL', id3X + 70, idRowY + 50);
  ctx.fillText('TEAM CREDENTIAL', id3X + 70, idRowY + 68);
  ctx.fillText('• KITS-EOS', id3X + 70, idRowY + 86);

  // 9. CAMPUS SILHOUETTE & INSTITUTIONAL FOOTER BANNER
  // Campus building silhouette above bottom bar
  const campusImg = await loadImage('/college_banner.png');
  if (campusImg) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(campusImg, 40, 1630, 1000, 200);
    ctx.restore();
  }

  // Bottom Footer Bar (90px height)
  const footerY = BASE_HEIGHT - 90;

  // Navy Blue Section (Left)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, footerY);
  ctx.lineTo(660, footerY);
  ctx.lineTo(610, BASE_HEIGHT);
  ctx.lineTo(0, BASE_HEIGHT);
  ctx.closePath();
  ctx.fillStyle = '#002244';
  ctx.fill();
  ctx.restore();

  // Red Angled Section (Right)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(660, footerY);
  ctx.lineTo(BASE_WIDTH, footerY);
  ctx.lineTo(BASE_WIDTH, BASE_HEIGHT);
  ctx.lineTo(610, BASE_HEIGHT);
  ctx.closePath();
  ctx.fillStyle = '#C8102E';
  ctx.fill();
  ctx.restore();

  // Location Pin & Text on Left
  drawLocationPinIcon(ctx, 35, footerY + 22, 40, '#FFFFFF');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 16px Montserrat, sans-serif';
  ctx.fillText('KITS AKSHAR INSTITUTE OF TECHNOLOGY', 85, footerY + 42);

  ctx.fillStyle = '#CBD5E1';
  ctx.font = '800 12px Montserrat, sans-serif';
  ctx.fillText('YANAMADALA, GUNTUR, ANDHRA PRADESH', 85, footerY + 66);

  // Event & Year on Right
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 18px Montserrat, sans-serif';
  const rightText = `${(options.eventName || 'EVENT').toUpperCase()} • ${academicYear}`;
  drawFittedText(ctx, rightText, 840, footerY + 54, 420, 18, 13, '900');

  return canvas;
}

export async function renderSoloIdCardToCanvas(
  options: IdCardRenderOptions,
  scale = 1
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = BASE_WIDTH * scale;
  canvas.height = BASE_HEIGHT * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  if (scale !== 1) {
    ctx.scale(scale, scale);
  }

  // 1. Crisp White Background & Outer Frame
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, BASE_WIDTH - 16, BASE_HEIGHT - 16);

  // 2. HEADER BANNER (KITS Red sliced into Akshar Blue)
  const headerHeight = 220;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(760, 0);
  ctx.lineTo(680, headerHeight);
  ctx.lineTo(0, headerHeight);
  ctx.closePath();
  const redGrad = ctx.createLinearGradient(0, 0, 760, headerHeight);
  redGrad.addColorStop(0, '#8F0817');
  redGrad.addColorStop(0.5, '#A00E1E');
  redGrad.addColorStop(1, '#C8102E');
  ctx.fillStyle = redGrad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(760, 0);
  ctx.lineTo(BASE_WIDTH, 0);
  ctx.lineTo(BASE_WIDTH, headerHeight);
  ctx.lineTo(680, headerHeight);
  ctx.closePath();
  const blueGrad = ctx.createLinearGradient(680, 0, BASE_WIDTH, headerHeight);
  blueGrad.addColorStop(0, '#001F38');
  blueGrad.addColorStop(0.6, '#002B49');
  blueGrad.addColorStop(1, '#003366');
  ctx.fillStyle = blueGrad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(760, 0);
  ctx.lineTo(680, headerHeight);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(768, 0);
  ctx.lineTo(688, headerHeight);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Logo
  const logoCircleX = 110;
  const logoCircleY = 110;
  const logoRadius = 72;

  ctx.save();
  ctx.beginPath();
  ctx.arc(logoCircleX, logoCircleY, logoRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 3;
  ctx.stroke();

  const logoImg = await loadImage('/college_logo.png');
  if (logoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoCircleX, logoCircleY, logoRadius - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, logoCircleX - 60, logoCircleY - 60, 120, 120);
    ctx.restore();
  }
  ctx.restore();

  // Typography
  const textLeftX = 215;
  ctx.textAlign = 'left';

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 36px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('KITS AKSHAR', textLeftX, 72);

  ctx.font = '800 23px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('INSTITUTE OF TECHNOLOGY', textLeftX, 108);

  ctx.fillStyle = '#FBBF24';
  ctx.font = '800 13px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('CENTRAL EVENT OPERATIONS SYSTEM • KITS-EOS', textLeftX, 140);

  const academicYear = options.academicYear || '2025-26';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 14px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText(`OFFICIAL DIGITAL EVENT PASS • ${academicYear}`, textLeftX, 172);

  // Right Panel
  const navyCenterX = 890;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 32px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('KITS-EOS', navyCenterX, 56);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '800 12px Montserrat, "Segoe UI", sans-serif';
  const navX = 810;
  drawCalendarIcon(ctx, navX, 81, 15, '#93C5FD');
  ctx.fillText('EVENTS', navX + 24, 94);
  drawUsersIcon(ctx, navX, 111, 15, '#93C5FD');
  ctx.fillText('PARTICIPATION', navX + 24, 124);
  drawCheckmarkIcon(ctx, navX, 141, 15, '#86EFAC');
  ctx.fillText('ATTENDANCE', navX + 24, 154);
  drawAwardIcon(ctx, navX, 171, 15, '#FDE047');
  ctx.fillText('CERTIFICATES', navX + 24, 184);

  // 3. CARD TYPE RIBBON (Centered "INDIVIDUAL EVENT PASS")
  const ribbonY = 280;
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(60, ribbonY - 6);
  ctx.lineTo(260, ribbonY - 6);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(820, ribbonY - 6);
  ctx.lineTo(1020, ribbonY - 6);
  ctx.stroke();

  drawUserIcon(ctx, 275, ribbonY - 38, 44, '#C8102E');

  ctx.textAlign = 'center';
  ctx.fillStyle = '#C8102E';
  ctx.font = '900 38px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('INDIVIDUAL EVENT PASS', 565, ribbonY);

  ctx.fillStyle = '#64748B';
  ctx.font = '800 14px Montserrat, "Segoe UI", sans-serif';
  ctx.fillText('SCAN FOR INDIVIDUAL ATTENDANCE AT THE EVENT', BASE_WIDTH / 2, ribbonY + 34);

  // 4. EVENT INFORMATION CARDS (Side-by-Side)
  const eventBoxY = 345;
  const eventBoxH = 100;
  const eventBoxW = 475;

  // Box 1: EVENT NAME
  ctx.fillStyle = '#F8FAFC';
  drawRoundedRect(ctx, 50, eventBoxY, eventBoxW, eventBoxH, 16);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#FEE2E2';
  drawRoundedRect(ctx, 68, eventBoxY + 18, 64, 64, 14);
  ctx.fill();
  drawCalendarIcon(ctx, 75, eventBoxY + 25, 50, '#DC2626');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#64748B';
  ctx.font = '800 12px Montserrat, sans-serif';
  ctx.fillText('EVENT NAME', 148, eventBoxY + 35);

  ctx.fillStyle = '#0F172A';
  drawFittedText(ctx, (options.eventName || 'EVENT').toUpperCase(), 148, eventBoxY + 66, 360, 24, 15, '900');

  if (options.categoryName) {
    ctx.fillStyle = '#475569';
    ctx.font = '800 12px Montserrat, sans-serif';
    ctx.fillText(options.categoryName.toUpperCase(), 148, eventBoxY + 86);
  }

  // Box 2: SUB EVENT
  const subBoxX = 555;
  ctx.fillStyle = '#F8FAFC';
  drawRoundedRect(ctx, subBoxX, eventBoxY, eventBoxW, eventBoxH, 16);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#DBEAFE';
  drawRoundedRect(ctx, subBoxX + 18, eventBoxY + 18, 64, 64, 14);
  ctx.fill();
  drawCodeIcon(ctx, subBoxX + 25, eventBoxY + 25, 50, '#2563EB');

  ctx.fillStyle = '#64748B';
  ctx.font = '800 12px Montserrat, sans-serif';
  ctx.fillText('SUB EVENT', subBoxX + 98, eventBoxY + 35);

  ctx.fillStyle = '#002855';
  drawFittedText(ctx, (options.subEventName || 'SUB EVENT').toUpperCase(), subBoxX + 98, eventBoxY + 70, 360, 24, 15, '900');

  // 5. PARTICIPATION TYPE BANNER
  const partBannerY = 465;
  const partBannerH = 75;
  const bannerW = 980;

  ctx.save();
  drawRoundedRect(ctx, 50, partBannerY, bannerW, partBannerH, 14);
  const pGrad = ctx.createLinearGradient(50, partBannerY, 50 + bannerW, partBannerY);
  pGrad.addColorStop(0, '#003366');
  pGrad.addColorStop(1, '#0A4D8C');
  ctx.fillStyle = pGrad;
  ctx.fill();

  ctx.beginPath();
  drawRoundedRect(ctx, 50, partBannerY, bannerW, partBannerH, 14);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 12;
  for (let s = 0; s < 4; s++) {
    ctx.beginPath();
    ctx.moveTo(920 + s * 30, partBannerY - 20);
    ctx.lineTo(840 + s * 30, partBannerY + partBannerH + 20);
    ctx.stroke();
  }
  ctx.restore();

  drawUserIcon(ctx, 70, partBannerY + 14, 46, '#FFFFFF');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#93C5FD';
  ctx.font = '800 12px Montserrat, sans-serif';
  ctx.fillText('PARTICIPATION TYPE', 135, partBannerY + 28);

  ctx.fillStyle = '#FFFFFF';
  const roleText = options.teamRole && options.teamRole !== 'SOLO PARTICIPANT'
    ? `${options.participationType.toUpperCase()} PARTICIPANT • ${options.teamRole}`
    : `${options.participationType.toUpperCase()} PARTICIPANT`;
  drawFittedText(ctx, roleText, 135, partBannerY + 60, 800, 28, 16, '900');

  // 6. PARTICIPANT IDENTITY SECTION (Prominent card)
  const partSectionY = 560;
  const partHeaderH = 40;

  ctx.fillStyle = '#C8102E';
  drawRoundedRect(ctx, 50, partSectionY, bannerW, partHeaderH, 10);
  ctx.fill();

  drawUserIcon(ctx, 68, partSectionY + 7, 26, '#FFFFFF');
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 16px Montserrat, sans-serif';
  ctx.fillText('PARTICIPANT DETAILS', 108, partSectionY + 26);

  // Identity Card Box
  const cardY = partSectionY + partHeaderH + 12;
  const cardH = 220;

  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, 50, cardY, bannerW, cardH, 16);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Participant Name & Badge
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0F172A';
  ctx.font = '900 32px Montserrat, sans-serif';
  ctx.fillText(options.studentName, 85, cardY + 48);

  const nameW = ctx.measureText(options.studentName).width;
  const badgeW = 145;
  const badgeH = 26;
  const bX = 85 + nameW + 16;
  const bY = cardY + 24;

  ctx.fillStyle = '#EFF6FF';
  drawRoundedRect(ctx, bX, bY, badgeW, badgeH, 8);
  ctx.fill();
  ctx.strokeStyle = '#BFDBFE';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#1D4ED8';
  ctx.font = '900 12px Montserrat, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SOLO PARTICIPANT', bX + badgeW / 2, bY + 18);
  ctx.textAlign = 'left';

  // Details Grid inside card
  // Row 1: College & Roll Number
  const r1Y = cardY + 105;
  drawBuildingIcon(ctx, 85, r1Y - 20, 24, '#475569');
  ctx.fillStyle = '#64748B';
  ctx.font = '800 11px Montserrat, sans-serif';
  ctx.fillText('INSTITUTION', 118, r1Y - 10);
  ctx.fillStyle = '#0F172A';
  drawFittedText(ctx, options.college || 'KITS Akshar Institute of Technology', 118, r1Y + 12, 480, 16, 12, '800');

  drawIdBadgeIcon(ctx, 640, r1Y - 20, 24, '#475569');
  ctx.fillStyle = '#64748B';
  ctx.font = '800 11px Montserrat, sans-serif';
  ctx.fillText('ROLL NUMBER', 673, r1Y - 10);
  ctx.fillStyle = '#0F172A';
  ctx.font = '900 18px monospace';
  ctx.fillText(options.rollNumber, 673, r1Y + 12);

  // Row 2: Department & Year
  const r2Y = cardY + 165;
  drawGraduationCapIcon(ctx, 85, r2Y - 20, 24, '#475569');
  ctx.fillStyle = '#64748B';
  ctx.font = '800 11px Montserrat, sans-serif';
  ctx.fillText('DEPARTMENT', 118, r2Y - 10);
  ctx.fillStyle = '#0F172A';
  drawFittedText(ctx, options.department || 'Engineering', 118, r2Y + 12, 480, 16, 12, '800');

  drawBarChartIcon(ctx, 640, r2Y - 20, 24, '#475569');
  ctx.fillStyle = '#64748B';
  ctx.font = '800 11px Montserrat, sans-serif';
  ctx.fillText('YEAR OF STUDY', 673, r2Y - 10);
  ctx.fillStyle = '#0F172A';
  ctx.font = '800 16px Montserrat, sans-serif';
  ctx.fillText(`Year ${options.year || 3}`, 673, r2Y + 12);

  // 7. QR CODE ATTENDANCE SECTION
  const qrSectionCenterY = 1200;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(30, qrSectionCenterY - 110);
  ctx.lineTo(310, qrSectionCenterY - 40);
  ctx.lineTo(240, qrSectionCenterY + 110);
  ctx.lineTo(20, qrSectionCenterY + 40);
  ctx.closePath();
  ctx.fillStyle = 'rgba(244, 63, 94, 0.12)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(770, qrSectionCenterY - 40);
  ctx.lineTo(1050, qrSectionCenterY - 110);
  ctx.lineTo(1060, qrSectionCenterY + 40);
  ctx.lineTo(840, qrSectionCenterY + 110);
  ctx.closePath();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.fill();
  ctx.restore();

  const qrBoxW = 420;
  const qrBoxH = 460;
  const qrBoxX = (BASE_WIDTH - qrBoxW) / 2;
  const qrBoxY = qrSectionCenterY - qrBoxH / 2 - 25;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxW, qrBoxH, 24);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.stroke();

  const qrImgSize = 250;
  const qrImgX = (BASE_WIDTH - qrImgSize) / 2;
  const qrImgY = qrBoxY + 22;

  const qrImg = await getQrImage(options.qrSvgElementId, options.registrationId);
  if (qrImg) {
    ctx.drawImage(qrImg, qrImgX, qrImgY, qrImgSize, qrImgSize);
  } else {
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2;
    ctx.strokeRect(qrImgX, qrImgY, qrImgSize, qrImgSize);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0F172A';
    ctx.font = '800 16px monospace';
    ctx.fillText('ATTENDANCE QR', BASE_WIDTH / 2, qrImgY + qrImgSize / 2);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = '900 16px Montserrat, sans-serif';
  ctx.fillText('INDIVIDUAL QR CODE', BASE_WIDTH / 2, qrBoxY + 300);

  // Divider inside QR box
  ctx.strokeStyle = '#F1F5F9';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(qrBoxX + 20, qrBoxY + 318);
  ctx.lineTo(qrBoxX + qrBoxW - 20, qrBoxY + 318);
  ctx.stroke();

  // MANUAL VERIFICATION TOKEN - DIRECTLY UNDER QR CODE
  ctx.fillStyle = '#64748B';
  ctx.font = '800 12px Montserrat, sans-serif';
  ctx.fillText('MANUAL VERIFICATION TOKEN', BASE_WIDTH / 2, qrBoxY + 340);

  // Akshar Blue token badge
  const tokenBadgeW = 380;
  const tokenBadgeH = 54;
  const tokenBadgeX = (BASE_WIDTH - tokenBadgeW) / 2;
  const tokenBadgeY = qrBoxY + 353;
  ctx.fillStyle = '#002B49';
  drawRoundedRect(ctx, tokenBadgeX, tokenBadgeY, tokenBadgeW, tokenBadgeH, 12);
  ctx.fill();

  drawTokenBadgeText(ctx, options.manualToken || '', BASE_WIDTH / 2, tokenBadgeY, tokenBadgeW, tokenBadgeH);

  // Below QR Box subtitle
  ctx.fillStyle = '#64748B';
  ctx.font = '700 14px Montserrat, sans-serif';
  ctx.fillText('Scan by Coordinator for individual participant attendance', BASE_WIDTH / 2, qrBoxY + qrBoxH + 30);

  // 8. IDENTIFIERS ROW (2 Rounded Cards: Registration ID & Verified Digital Credential)
  const idRowY = 1485;
  const idCardW = 475;
  const idCardH = 110;
  const idGap = 30;
  const id1X = (BASE_WIDTH - (idCardW * 2 + idGap)) / 2;

  // Card 1: REGISTRATION ID
  ctx.fillStyle = '#F0F9FF';
  drawRoundedRect(ctx, id1X, idRowY, idCardW, idCardH, 14);
  ctx.fill();
  ctx.strokeStyle = '#BAE6FD';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#E0F2FE';
  drawRoundedRect(ctx, id1X + 16, idRowY + 16, 44, 44, 10);
  ctx.fill();
  drawIdBadgeIcon(ctx, id1X + 22, idRowY + 22, 32, '#0284C7');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#0284C7';
  ctx.font = '900 12px Montserrat, sans-serif';
  ctx.fillText('REGISTRATION ID', id1X + 70, idRowY + 35);

  ctx.fillStyle = '#0F172A';
  const regIdStr = options.registrationId || '';
  drawFittedText(ctx, regIdStr, id1X + 70, idRowY + 68, idCardW - 85, 14, 11, '800', 'monospace');

  // Card 2: VERIFIED BADGE
  const id2X = id1X + idCardW + idGap;
  ctx.fillStyle = '#F0FDF4';
  drawRoundedRect(ctx, id2X, idRowY, idCardW, idCardH, 14);
  ctx.fill();
  ctx.strokeStyle = '#BBF7D0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  drawCheckBadgeIcon(ctx, id2X + 18, idRowY + 18, 42, '#16A34A');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#047857';
  ctx.font = '900 12px Montserrat, sans-serif';
  ctx.fillText('VERIFIED INSTITUTIONAL', id2X + 70, idRowY + 40);
  ctx.fillText('DIGITAL CREDENTIAL • KITS-EOS', id2X + 70, idRowY + 64);

  // 9. CAMPUS SILHOUETTE & FOOTER BANNER
  const campusImg = await loadImage('/college_banner.png');
  if (campusImg) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(campusImg, 40, 1630, 1000, 200);
    ctx.restore();
  }

  const footerY = BASE_HEIGHT - 90;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, footerY);
  ctx.lineTo(660, footerY);
  ctx.lineTo(610, BASE_HEIGHT);
  ctx.lineTo(0, BASE_HEIGHT);
  ctx.closePath();
  ctx.fillStyle = '#002244';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(660, footerY);
  ctx.lineTo(BASE_WIDTH, footerY);
  ctx.lineTo(BASE_WIDTH, BASE_HEIGHT);
  ctx.lineTo(610, BASE_HEIGHT);
  ctx.closePath();
  ctx.fillStyle = '#C8102E';
  ctx.fill();
  ctx.restore();

  drawLocationPinIcon(ctx, 35, footerY + 22, 40, '#FFFFFF');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 16px Montserrat, sans-serif';
  ctx.fillText('KITS AKSHAR INSTITUTE OF TECHNOLOGY', 85, footerY + 42);

  ctx.fillStyle = '#CBD5E1';
  ctx.font = '800 12px Montserrat, sans-serif';
  ctx.fillText('YANAMADALA, GUNTUR, ANDHRA PRADESH', 85, footerY + 66);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 18px Montserrat, sans-serif';
  const rightText = `${(options.eventName || 'EVENT').toUpperCase()} • ${academicYear}`;
  drawFittedText(ctx, rightText, 840, footerY + 54, 420, 18, 13, '900');

  return canvas;
}

// ============================================================================
// EXPORT & DOWNLOAD HANDLERS (PNG, PDF, PRINT)
// ============================================================================

export async function downloadTeamIdCardAsHighResImage(
  options: TeamIdCardRenderOptions,
  scale = 2
): Promise<void> {
  const canvas = await renderTeamIdCardToCanvas(options, scale);
  const pngUrl = canvas.toDataURL('image/png', 1.0);
  const downloadLink = document.createElement('a');
  const safeTeam = (options.teamName || 'TEAM').replace(/[^a-zA-Z0-9]/g, '_');
  const safeSub = (options.subEventName || 'EVENT').replace(/[^a-zA-Z0-9]/g, '_');
  const resLabel = scale >= 2 ? '_HighRes_4K' : '';
  downloadLink.download = `TeamIDCard_${safeTeam}_${safeSub}${resLabel}.png`;
  downloadLink.href = pngUrl;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

export async function downloadIdCardAsHighResImage(
  options: IdCardRenderOptions,
  scale = 2
): Promise<void> {
  const canvas = await renderSoloIdCardToCanvas(options, scale);
  const pngUrl = canvas.toDataURL('image/png', 1.0);
  const downloadLink = document.createElement('a');
  const safeRoll = (options.rollNumber || 'STUDENT').replace(/[^a-zA-Z0-9]/g, '_');
  const safeSub = (options.subEventName || 'EVENT').replace(/[^a-zA-Z0-9]/g, '_');
  const resLabel = scale >= 2 ? '_HighRes_4K' : '';
  downloadLink.download = `StudentIDCard_${safeRoll}_${safeSub}${resLabel}.png`;
  downloadLink.href = pngUrl;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

export async function downloadTeamIdCardAsPdf(options: TeamIdCardRenderOptions): Promise<void> {
  const canvas = await renderTeamIdCardToCanvas(options, 2);
  const canvasDataUrl = canvas.toDataURL('image/png', 1.0);
  const safeTeam = (options.teamName || 'TEAM').replace(/[^a-zA-Z0-9]/g, '_');
  const safeSub = (options.subEventName || 'EVENT').replace(/[^a-zA-Z0-9]/g, '_');

  try {
    const { jsPDF } = await import('jspdf');
    // EXACT 9:16 aspect ratio: 108mm width x 192mm height (108 / 192 = 9 / 16)
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [108, 192],
    });

    pdf.addImage(canvasDataUrl, 'PNG', 0, 0, 108, 192, undefined, 'FAST');
    pdf.save(`TeamIDCard_${safeTeam}_${safeSub}.pdf`);
    return;
  } catch (pdfErr) {
    console.warn('Direct jsPDF export error, falling back to 9:16 print window:', pdfErr);
    printCanvasAs916(canvasDataUrl, `Team ID Card - ${options.teamName}`);
  }
}

export async function downloadIdCardAsPdf(options: IdCardRenderOptions): Promise<void> {
  const canvas = await renderSoloIdCardToCanvas(options, 2);
  const canvasDataUrl = canvas.toDataURL('image/png', 1.0);
  const safeRoll = (options.rollNumber || 'STUDENT').replace(/[^a-zA-Z0-9]/g, '_');
  const safeSub = (options.subEventName || 'EVENT').replace(/[^a-zA-Z0-9]/g, '_');

  try {
    const { jsPDF } = await import('jspdf');
    // EXACT 9:16 aspect ratio: 108mm width x 192mm height (108 / 192 = 9 / 16)
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [108, 192],
    });

    pdf.addImage(canvasDataUrl, 'PNG', 0, 0, 108, 192, undefined, 'FAST');
    pdf.save(`StudentIDCard_${safeRoll}_${safeSub}.pdf`);
    return;
  } catch (pdfErr) {
    console.warn('Direct jsPDF export error, falling back to 9:16 print window:', pdfErr);
    printCanvasAs916(canvasDataUrl, `Student ID Card - ${options.rollNumber}`);
  }
}

function printCanvasAs916(imageDataUrl: string, title: string): void {
  const printWindow = window.open('', '_blank', 'width=600,height=960');
  if (!printWindow) {
    window.print();
    return;
  }

  printWindow.document.title = title || 'KITS-EOS Digital Credential';

  const style = printWindow.document.createElement('style');
  style.textContent = `
    @page { size: 108mm 192mm; margin: 0; }
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; width: 108mm; height: 192mm;
      background: #ffffff; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .card-print-img {
      width: 108mm; height: 192mm; object-fit: cover; display: block;
    }
    @media print {
      html, body { width: 108mm; height: 192mm; }
      .card-print-img {
        width: 108mm; height: 192mm;
        page-break-after: avoid; page-break-inside: avoid;
      }
    }
  `;
  printWindow.document.head.appendChild(style);

  const img = printWindow.document.createElement('img');
  img.src = imageDataUrl;
  img.className = 'card-print-img';
  img.alt = title || 'Digital Credential';

  const printWhenReady = () => {
    setTimeout(() => {
      try {
        printWindow.print();
        printWindow.close();
      } catch {}
    }, 300);
  };

  if (img.complete) {
    printWhenReady();
  } else {
    img.onload = printWhenReady;
    img.onerror = printWhenReady;
  }

  printWindow.document.body.appendChild(img);
}

export function printDocument(elementId: string): void {
  const elem = document.getElementById(elementId);
  if (!elem) {
    window.print();
    return;
  }

  const printWindow = window.open('', '_blank', 'width=600,height=960');
  if (!printWindow) {
    window.print();
    return;
  }

  printWindow.document.title = 'KITS-EOS Digital Credential';

  const style = printWindow.document.createElement('style');
  style.textContent = `
    @page { size: 108mm 192mm; margin: 0; }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #ffffff; margin: 0; padding: 0; color: #0f172a;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      display: flex; justify-content: center; align-items: center;
    }
    @media print {
      body { padding: 0; margin: 0; }
      button { display: none !important; }
    }
  `;
  printWindow.document.head.appendChild(style);

  const cloned = elem.cloneNode(true);
  printWindow.document.body.appendChild(cloned);

  setTimeout(() => {
    try {
      printWindow.print();
      printWindow.close();
    } catch {}
  }, 300);
}

export function downloadSvgAsPng(
  svgElementId: string,
  filename: string,
  title?: string,
  subtitle?: string
): void {
  const svgElement = document.getElementById(svgElementId) as unknown as SVGElement | null;
  if (!svgElement) {
    console.error(`SVG element #${svgElementId} not found.`);
    return;
  }

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const padding = 40;
    const headerHeight = title ? 60 : 0;
    const footerHeight = subtitle ? 40 : 0;

    const estimatedSubW = subtitle ? subtitle.length * 9 + 40 : 0;
    canvas.width = Math.max((img.width || 300) + padding * 2, estimatedSubW, 360);
    canvas.height = (img.height || 300) + padding * 2 + headerHeight + footerHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

    let yOffset = padding;

    if (title) {
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(title, canvas.width / 2, yOffset + 20);
      yOffset += headerHeight;
    }

    const imgX = (canvas.width - (img.width || 300)) / 2;
    ctx.drawImage(img, imgX, yOffset, img.width || 300, img.height || 300);
    yOffset += img.height || 300;

    if (subtitle) {
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'center';
      let subFontSize = 12;
      const maxSubW = canvas.width - 24;
      ctx.font = `bold ${subFontSize}px monospace`;
      while (ctx.measureText(subtitle).width > maxSubW && subFontSize > 8) {
        subFontSize -= 1;
        ctx.font = `bold ${subFontSize}px monospace`;
      }
      ctx.fillText(subtitle, canvas.width / 2, yOffset + 25);
    }

    URL.revokeObjectURL(url);

    const pngUrl = canvas.toDataURL('image/png');
    const downloadLink = document.createElement('a');
    downloadLink.download = filename.endsWith('.png') ? filename : `${filename}.png`;
    downloadLink.href = pngUrl;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  img.src = url;
}
