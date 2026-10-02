export interface CertificateRenderOptions {
  studentName: string;
  rollNumber: string;
  department: string;
  year: number | string;
  college: string;
  eventName: string;
  categoryName?: string;
  subEventName: string;
  achievement: string; // 'WINNER' | 'RUNNER' | 'THIRD_PLACE' | 'PARTICIPANT' | string;
  teamName?: string;
  teamRole?: string;
  certificateCode: string;
  issuedAt?: string | null;
  chairmanName?: string;
  principalName?: string;
  qrSvgElementId?: string;
  qrDataUrl?: string;
  bannerUrl?: string;
  logoUrl?: string;
  naacLogoUrl?: string;
  eventStartDate?: string | null;
  eventEndDate?: string | null;
}

/**
 * Formats date into institutional standard format with full year: e.g. "15 September 2026"
 */
function formatLongDate(dateStr?: string | null): string {
  if (!dateStr) return '15 September 2026';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Formats date into short institutional standard format: e.g. "15 Sept 2026"
 */
function formatShortDate(dateStr?: string | null): string {
  if (!dateStr) return '15 Sept 2026';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Text wrapping helper for HTML5 Canvas.
 */
function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = words[0] || '';

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const testLine = `${currentLine} ${word}`;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}


/**
 * Draws a filled diamond glyph centered at (cx, cy).
 */
function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  fillStyle?: string,
  strokeStyle?: string,
  lineWidth = 1
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size, cy);
  ctx.lineTo(cx, cy + size);
  ctx.lineTo(cx - size, cy);
  ctx.closePath();
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/**
 * Draws a decorative diamond wing divider: ───◇───
 */
function drawDiamondWingDivider(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  wingWidth: number,
  diamondSize: number,
  color: string,
  lineWidth = 1.5
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  // Left wing
  ctx.beginPath();
  ctx.moveTo(cx - wingWidth, cy);
  ctx.lineTo(cx - diamondSize * 1.5, cy);
  ctx.stroke();

  // Right wing
  ctx.beginPath();
  ctx.moveTo(cx + diamondSize * 1.5, cy);
  ctx.lineTo(cx + wingWidth, cy);
  ctx.stroke();

  // Center diamond
  drawDiamond(ctx, cx, cy, diamondSize, color);
  // Terminal accent diamonds
  drawDiamond(ctx, cx - wingWidth, cy, diamondSize * 0.45, color);
  drawDiamond(ctx, cx + wingWidth, cy, diamondSize * 0.45, color);
}

/**
 * Draws a technical dot grid matrix pattern (decorative institutional accent).
 */
function drawDotMatrix(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  cols: number,
  rows: number,
  spacing: number,
  color: string,
  alpha = 0.35,
  radius = 2
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.beginPath();
      ctx.arc(startX + c * spacing, startY + r * spacing, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Loads an image safely with cross-origin support.
 */
function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Ensures required professional typography fonts are explicitly loaded before canvas drawing.
 */
async function ensureFontsLoaded(): Promise<void> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await Promise.allSettled([
        document.fonts.load('700 86px Cinzel'),
        document.fonts.load('800 48px Cinzel'),
        document.fonts.load('bold 34px Cinzel'),
        document.fonts.load('700 72px "Cormorant Garamond"'),
        document.fonts.load('italic 600 28px "Cormorant Garamond"'),
        document.fonts.load('italic bold 36px "Cormorant Garamond"'),
        document.fonts.load('900 62px Montserrat'),
        document.fonts.load('800 38px Montserrat'),
        document.fonts.load('700 23px Montserrat'),
        document.fonts.load('600 19px Montserrat'),
        document.fonts.load('700 28px Montserrat'),
        document.fonts.load('800 27px Montserrat'),
        document.fonts.load('500 29px Montserrat'),
        document.fonts.load('700 24px Montserrat'),
        document.fonts.load('600 21px Montserrat'),
        document.fonts.load('900 23px Montserrat'),
        document.fonts.load('800 22px Montserrat'),
      ]);
      await document.fonts.ready;
    } catch (e) {
      console.warn('Font loading check completed with notice:', e);
    }
  }
}

/**
 * Renders an official KITS Akshar Institute of Technology certificate onto an HTML5 Canvas
 * at ultra-crisp resolution (2000 x 1414 landscape, A4 ratio).
 *
 * Strict Compliance:
 * - Master Color System: KITS Red (#C8102E), Akshar Blue (#003366), White (#FFFFFF)
 * - Flowing institutional red-and-blue corner/edge waves inspired by design reference
 * - Official KITS Emblem (Image 2) in upper-left header and as subtle 4.5% centered watermark
 * - Official NAAC A-Grade Medallion (Image 3) in upper-right header
 * - Institutional Header (KITS AKSHAR / INSTITUTE OF TECHNOLOGY / AUTONOMOUS / Approved by AICTE...)
 * - Zero college banner image, zero historical name phrases, zero unauthorized taglines
 * - Dynamically populated event, sub-event, participant name, roll number, department, year, college, and dates with year
 * - Standalone scannable QR code in lower-right region with "Scan to Verify" label (no surrounding box)
 * - Formal signatures of Sri. K. Subba Rao (Chairman) and Dr. Kalluri Rama Kotaiah (Principal)
 * - Central certificate code and issue date
 */
export async function renderCertificateToCanvas(options: CertificateRenderOptions): Promise<HTMLCanvasElement> {
  // Ensure custom professional fonts are loaded in document.fonts
  await ensureFontsLoaded();

  const canvas = document.createElement('canvas');
  const width = 2000;
  const height = 1414;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D canvas context');

  // =========================================================================
  // 1. BASE BACKGROUND & SUBTLE INSTITUTIONAL CANVAS
  // =========================================================================
  // Pure white base
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // =========================================================================
  // 2. FLOWING INSTITUTIONAL CORNER & BORDER WAVES (RED + BLUE + WHITE)
  // =========================================================================
  ctx.save();

  // -------------------------------------------------------------------------
  // 2A. TOP-LEFT CORNER WAVE CLUSTER (Restrained to corner for logo clearance)
  // -------------------------------------------------------------------------
  const tlBlueGrad = ctx.createLinearGradient(0, 0, 220, 240);
  tlBlueGrad.addColorStop(0, '#001A33');
  tlBlueGrad.addColorStop(0.7, '#003366');
  tlBlueGrad.addColorStop(1, '#004080');
  ctx.fillStyle = tlBlueGrad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(260, 0);
  ctx.bezierCurveTo(180, 60, 80, 160, 0, 280);
  ctx.closePath();
  ctx.fill();

  // White separator
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(210, 0);
  ctx.bezierCurveTo(140, 80, 60, 180, 0, 305);
  ctx.stroke();

  // KITS Red ribbon wave
  const tlRedGrad = ctx.createLinearGradient(0, 60, 200, 280);
  tlRedGrad.addColorStop(0, '#99001A');
  tlRedGrad.addColorStop(0.5, '#C8102E');
  tlRedGrad.addColorStop(1, '#E61E3F');
  ctx.fillStyle = tlRedGrad;
  ctx.beginPath();
  ctx.moveTo(180, 0);
  ctx.bezierCurveTo(120, 100, 45, 200, 0, 325);
  ctx.lineTo(0, 240);
  ctx.bezierCurveTo(40, 140, 100, 65, 120, 0);
  ctx.closePath();
  ctx.fill();

  // Dot Matrix Accent near Top-Left
  drawDotMatrix(ctx, 38, 335, 6, 4, 13, '#003366', 0.28, 2);

  // -------------------------------------------------------------------------
  // 2B. TOP-RIGHT CORNER WAVE CLUSTER (Restrained to corner for NAAC logo clearance)
  // -------------------------------------------------------------------------
  const trBlueGrad = ctx.createLinearGradient(width, 0, width - 220, 240);
  trBlueGrad.addColorStop(0, '#001A33');
  trBlueGrad.addColorStop(0.7, '#003366');
  trBlueGrad.addColorStop(1, '#004080');
  ctx.fillStyle = trBlueGrad;
  ctx.beginPath();
  ctx.moveTo(width, 0);
  ctx.lineTo(width - 260, 0);
  ctx.bezierCurveTo(width - 180, 60, width - 80, 160, width, 280);
  ctx.closePath();
  ctx.fill();

  // White separator
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(width - 210, 0);
  ctx.bezierCurveTo(width - 140, 80, width - 60, 180, width, 305);
  ctx.stroke();

  // KITS Red ribbon wave
  const trRedGrad = ctx.createLinearGradient(width, 60, width - 200, 280);
  trRedGrad.addColorStop(0, '#99001A');
  trRedGrad.addColorStop(0.5, '#C8102E');
  trRedGrad.addColorStop(1, '#E61E3F');
  ctx.fillStyle = trRedGrad;
  ctx.beginPath();
  ctx.moveTo(width - 180, 0);
  ctx.bezierCurveTo(width - 120, 100, width - 45, 200, width, 325);
  ctx.lineTo(width, 240);
  ctx.bezierCurveTo(width - 40, 140, width - 100, 65, width - 120, 0);
  ctx.closePath();
  ctx.fill();

  // Dot Matrix Accent near Top-Right
  drawDotMatrix(ctx, width - 110, 335, 6, 4, 13, '#003366', 0.28, 2);

  // -------------------------------------------------------------------------
  // 2C. BOTTOM SWEEPING INSTITUTIONAL WAVE CLUSTER (REFINED PROFILE)
  // -------------------------------------------------------------------------
  // Deep Akshar Blue baseline wave with refined, elegant height profile
  const btmBlueGrad = ctx.createLinearGradient(0, height - 160, width, height);
  btmBlueGrad.addColorStop(0, '#001A33');
  btmBlueGrad.addColorStop(0.3, '#002B4D');
  btmBlueGrad.addColorStop(0.7, '#003366');
  btmBlueGrad.addColorStop(1, '#001A33');

  ctx.fillStyle = btmBlueGrad;
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, height - 150);
  ctx.bezierCurveTo(340, height - 120, 620, height - 38, 1000, height - 38);
  ctx.bezierCurveTo(1380, height - 38, 1660, height - 120, width, height - 150);
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  // Vibrant KITS Red flowing wave ribbon
  const btmRedGrad = ctx.createLinearGradient(0, height - 115, width, height - 80);
  btmRedGrad.addColorStop(0, '#C8102E');
  btmRedGrad.addColorStop(0.5, '#E61E3F');
  btmRedGrad.addColorStop(1, '#C8102E');

  ctx.fillStyle = btmRedGrad;
  ctx.beginPath();
  ctx.moveTo(0, height - 115);
  ctx.bezierCurveTo(360, height - 85, 680, height - 18, 1000, height - 18);
  ctx.bezierCurveTo(1320, height - 18, 1640, height - 85, width, height - 115);
  ctx.lineTo(width, height - 75);
  ctx.bezierCurveTo(1640, height - 50, 1320, height + 10, 1000, height + 10);
  ctx.bezierCurveTo(680, height + 10, 360, height - 50, 0, height - 75);
  ctx.closePath();
  ctx.fill();

  // White ribbon accent dividing stroke
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, height - 115);
  ctx.bezierCurveTo(360, height - 85, 680, height - 18, 1000, height - 18);
  ctx.bezierCurveTo(1320, height - 18, 1640, height - 85, width, height - 115);
  ctx.stroke();

  // Side Dot Matrices near lower region
  drawDotMatrix(ctx, 160, height - 380, 5, 8, 15, '#003366', 0.22, 2);
  drawDotMatrix(ctx, width - 235, height - 380, 5, 8, 15, '#003366', 0.22, 2);

  ctx.restore();

  // =========================================================================
  // 3. ARCHITECTURAL INSET BORDER GUIDELINES & STEPPED CORNERS
  // =========================================================================
  // Thin KITS Red outer guideline (2px)
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 2;
  ctx.strokeRect(38, 38, width - 76, height - 76);

  // Thin Akshar Blue inner guideline (1px)
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1;
  ctx.strokeRect(46, 46, width - 92, height - 92);

  // Stepped Corner Bracket Ornaments
  const drawCornerTick = (cx: number, cy: number, dx: number, dy: number) => {
    ctx.strokeStyle = '#003366';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + dx * 34, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * 34);
    ctx.stroke();

    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + dx * 28, cy + dy * 6);
    ctx.lineTo(cx + dx * 6, cy + dy * 6);
    ctx.lineTo(cx + dx * 6, cy + dy * 28);
    ctx.stroke();

    drawDiamond(ctx, cx + dx * 14, cy + dy * 14, 3.5, '#003366', '#C8102E', 1);
  };

  drawCornerTick(46, 46, 1, 1);
  drawCornerTick(width - 46, 46, -1, 1);
  drawCornerTick(46, height - 46, 1, -1);
  drawCornerTick(width - 46, height - 46, -1, -1);

  // Subtle Repeating Micro-Diamonds along Inset Border Gap
  [300, 550, 800, 1000, 1200, 1450, 1700].forEach((mx) => {
    drawDiamond(ctx, mx, 42, 2.5, '#C8102E');
    drawDiamond(ctx, mx, height - 42, 2.5, '#C8102E');
  });

  // =========================================================================
  // 4. KITS OFFICIAL LOGO AS SUBTLE BACKGROUND WATERMARK (IMAGE 2)
  // =========================================================================
  const kitsLogoUrl = options.logoUrl || '/kits_logo_official.jpg';
  const kitsLogoImg = await loadImageSafe(kitsLogoUrl);

  const wmCenterX = width / 2;
  const wmCenterY = 720;
  const wmRadius = 290;

  ctx.save();
  ctx.globalAlpha = 0.04; // 4% opacity (extremely subtle, behind text)

  if (kitsLogoImg && kitsLogoImg.naturalHeight !== 0) {
    ctx.beginPath();
    ctx.arc(wmCenterX, wmCenterY, wmRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(kitsLogoImg, wmCenterX - wmRadius, wmCenterY - wmRadius, wmRadius * 2, wmRadius * 2);
  }

  ctx.restore();

  // Subtle concentric watermark rings
  ctx.save();
  ctx.globalAlpha = 0.035;
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.arc(wmCenterX, wmCenterY, wmRadius + 18, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.025;
  ctx.strokeStyle = '#C8102E';
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(wmCenterX, wmCenterY, wmRadius + 32, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // =========================================================================
  // 5. OFFICIAL INSTITUTIONAL HEADER (LARGE PROMINENT CREST & LETTERHEAD)
  // =========================================================================
  // -------------------------------------------------------------------------
  // 5A. LEFT ZONE — OFFICIAL KITS LOGO (IMAGE 2, SUBSTANTIALLY ENLARGED)
  // -------------------------------------------------------------------------
  const logoRadius = 96; // Diameter = 192px (Visually commanding, perfectly legible emblem)
  const logoCenterX = 430; // Inward balanced placement framing the institutional letterhead
  const logoCenterY = 160;

  if (kitsLogoImg && kitsLogoImg.naturalHeight !== 0) {
    ctx.save();
    // Clip cleanly to the circular emblem
    ctx.beginPath();
    ctx.arc(logoCenterX, logoCenterY, logoRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(kitsLogoImg, logoCenterX - logoRadius, logoCenterY - logoRadius, logoRadius * 2, logoRadius * 2);
    ctx.restore();

    // Delicate outer gold/navy ring border
    ctx.save();
    ctx.strokeStyle = '#D4AF37';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(logoCenterX, logoCenterY, logoRadius + 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 51, 102, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(logoCenterX, logoCenterY, logoRadius + 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // 5B. CENTER ZONE — INSTITUTION INFORMATION (PROMINENT, READABLE, COMMANDING)
  // -------------------------------------------------------------------------
  ctx.textAlign = 'center';

  // Line 1: KITS AKSHAR (Target ~55-65px: KITS in Red, AKSHAR in Blue)
  const line1Y = 118;
  ctx.font = '900 64px "Montserrat", "Plus Jakarta Sans", "Segoe UI", sans-serif';

  const kitsText = 'KITS ';
  const aksharText = 'AKSHAR';
  const kitsMetrics = ctx.measureText(kitsText);
  const aksharMetrics = ctx.measureText(aksharText);
  const totalLine1Width = kitsMetrics.width + aksharMetrics.width;

  const line1StartX = width / 2 - totalLine1Width / 2;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#C8102E'; // KITS Red
  ctx.fillText(kitsText, line1StartX, line1Y);

  ctx.fillStyle = '#003366'; // Akshar Blue
  ctx.fillText(aksharText, line1StartX + kitsMetrics.width, line1Y);

  // Line 2: INSTITUTE OF TECHNOLOGY (Target ~34-42px: Major institutional heading)
  ctx.textAlign = 'center';
  const line2Y = 168;
  ctx.fillStyle = '#003366';
  ctx.font = '800 40px "Montserrat", "Plus Jakarta Sans", "Segoe UI", sans-serif';
  ctx.fillText('INSTITUTE OF TECHNOLOGY', width / 2, line2Y);

  // Line 2 Underline rule with micro-diamond
  const instWidth = ctx.measureText('INSTITUTE OF TECHNOLOGY').width;
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2 - instWidth / 2, line2Y + 6);
  ctx.lineTo(width / 2 + instWidth / 2, line2Y + 6);
  ctx.stroke();

  // Line 3: AUTONOMOUS (Target ~20-26px: Clearly readable with elegant spacing)
  const line3Y = 210;
  ctx.fillStyle = '#003366';
  ctx.font = '700 24px "Montserrat", "Plus Jakarta Sans", "Segoe UI", sans-serif';
  ctx.fillText('A   U   T   O   N   O   M   O   U   S', width / 2, line3Y);

  // Line 4: Approved by AICTE, New Delhi | Affiliated to JNTUK, Kakinada (Target ~17-21px)
  const line4Y = 248;
  ctx.fillStyle = '#334155';
  ctx.font = '600 19px "Montserrat", "Plus Jakarta Sans", "Segoe UI", sans-serif';
  ctx.fillText('Approved by AICTE, New Delhi | Affiliated to JNTUK, Kakinada', width / 2, line4Y);

  // -------------------------------------------------------------------------
  // 5C. RIGHT ZONE — OFFICIAL NAAC A-GRADE MEDALLION (IMAGE 3, SUBSTANTIALLY ENLARGED)
  // -------------------------------------------------------------------------
  const naacUrl = options.naacLogoUrl || '/naac_a_logo.png';
  const naacImg = await loadImageSafe(naacUrl);

  const naacH = 142; // Target ~120-150px height
  const naacW = 252; // 142 * 1.774 aspect ratio
  const naacX = 1425; // Symmetrical placement matching left logo
  const naacY = 89;   // Center Y = 160, exactly vertically aligned with KITS logoCenterY = 160

  if (naacImg && naacImg.naturalHeight !== 0) {
    ctx.drawImage(naacImg, naacX, naacY, naacW, naacH);
  }

  // Dual-Rule Header Divider with Central Diamond
  const divY = 280;
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(300, divY);
  ctx.lineTo(width - 300, divY);
  ctx.stroke();

  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(400, divY + 3.5);
  ctx.lineTo(width - 400, divY + 3.5);
  ctx.stroke();

  drawDiamond(ctx, width / 2, divY + 2, 6, '#003366', '#C8102E', 1.5);
  drawDiamond(ctx, width / 2 - 38, divY + 2, 2.5, '#C8102E');
  drawDiamond(ctx, width / 2 + 38, divY + 2, 2.5, '#C8102E');

  // =========================================================================
  // 6. MAIN EVENT IDENTITY (PROMINENT DISPLAY TYPOGRAPHY)
  // =========================================================================
  ctx.textAlign = 'center';
  const rawEventName = (options.eventName || 'CENTRAL EVENT OPERATIONS').toUpperCase();
  let eventFontSize = 48; // Target ~42-52px
  ctx.font = `800 ${eventFontSize}px "Cinzel", "Times New Roman", Georgia, serif`;
  let measuredEventW = ctx.measureText(rawEventName).width;
  const maxEventW = 1350;

  if (measuredEventW > maxEventW) {
    eventFontSize = Math.max(30, Math.floor(eventFontSize * (maxEventW / measuredEventW)));
    ctx.font = `800 ${eventFontSize}px "Cinzel", "Times New Roman", Georgia, serif`;
    measuredEventW = ctx.measureText(rawEventName).width;
  }

  const eventY = 348;
  ctx.fillStyle = '#003366';
  ctx.fillText(rawEventName, width / 2, eventY);

  // Symmetrical Diamond Wing Dividers flanking Event Name
  const eventWingSpacing = Math.min(measuredEventW / 2 + 32, 680);
  const wingY = eventY - 14;
  drawDiamondWingDivider(ctx, width / 2 - eventWingSpacing - 50, wingY, 48, 4.5, '#C8102E');
  drawDiamondWingDivider(ctx, width / 2 + eventWingSpacing + 50, wingY, 48, 4.5, '#C8102E');

  // =========================================================================
  // 7. CERTIFICATE TITLE HIERARCHY (STRONG VISUAL PRESENCE IN CINZEL)
  // =========================================================================
  const isWinner = options.achievement === 'WINNER';
  const isRunner = options.achievement === 'RUNNER';
  const isThird = options.achievement === 'THIRD_PLACE';
  const isPodium = isWinner || isRunner || isThird;

  // Title Line 1: CERTIFICATE (Target ~70-90px)
  const titleLine1Y = 440;
  ctx.font = '700 86px "Cinzel", "Times New Roman", Georgia, serif';

  if (isPodium) {
    ctx.fillStyle = '#C8102E';
  } else {
    ctx.fillStyle = '#002B49';
  }
  ctx.fillText('CERTIFICATE', width / 2, titleLine1Y);

  // Title Line 2: OF PARTICIPATION / OF EXCELLENCE / OF MERIT (Target ~28-36px)
  const titleLine2Y = titleLine1Y + 50;
  let podiumBadgeY = 0;

  if (isWinner) {
    ctx.fillStyle = '#C8102E';
    ctx.font = 'bold 32px "Cinzel", "Montserrat", sans-serif';
    ctx.fillText('OF EXCELLENCE', width / 2, titleLine2Y);
    drawDiamondWingDivider(ctx, width / 2 - 210, titleLine2Y - 9, 58, 4.5, '#C8102E');
    drawDiamondWingDivider(ctx, width / 2 + 210, titleLine2Y - 9, 58, 4.5, '#C8102E');

    podiumBadgeY = titleLine2Y + 34;
    ctx.fillStyle = '#003366';
    ctx.font = '800 22px "Montserrat", "Plus Jakarta Sans", sans-serif';
    ctx.fillText('1ST PLACE \u2022 WINNER', width / 2, podiumBadgeY);
  } else if (isRunner) {
    ctx.fillStyle = '#C8102E';
    ctx.font = 'bold 32px "Cinzel", "Montserrat", sans-serif';
    ctx.fillText('OF MERIT', width / 2, titleLine2Y);
    drawDiamondWingDivider(ctx, width / 2 - 170, titleLine2Y - 9, 58, 4.5, '#C8102E');
    drawDiamondWingDivider(ctx, width / 2 + 170, titleLine2Y - 9, 58, 4.5, '#C8102E');

    podiumBadgeY = titleLine2Y + 34;
    ctx.fillStyle = '#003366';
    ctx.font = '800 22px "Montserrat", "Plus Jakarta Sans", sans-serif';
    ctx.fillText('2ND PLACE \u2022 RUNNER-UP', width / 2, podiumBadgeY);
  } else if (isThird) {
    ctx.fillStyle = '#C8102E';
    ctx.font = 'bold 32px "Cinzel", "Montserrat", sans-serif';
    ctx.fillText('OF MERIT', width / 2, titleLine2Y);
    drawDiamondWingDivider(ctx, width / 2 - 170, titleLine2Y - 9, 58, 4.5, '#C8102E');
    drawDiamondWingDivider(ctx, width / 2 + 170, titleLine2Y - 9, 58, 4.5, '#C8102E');

    podiumBadgeY = titleLine2Y + 34;
    ctx.fillStyle = '#003366';
    ctx.font = '800 22px "Montserrat", "Plus Jakarta Sans", sans-serif';
    ctx.fillText('3RD PLACE', width / 2, podiumBadgeY);
  } else {
    // Default PARTICIPATION
    ctx.fillStyle = '#C8102E';
    ctx.font = 'bold 32px "Cinzel", "Montserrat", sans-serif';
    ctx.fillText('OF PARTICIPATION', width / 2, titleLine2Y);
    drawDiamondWingDivider(ctx, width / 2 - 240, titleLine2Y - 9, 64, 4.5, '#C8102E');
    drawDiamondWingDivider(ctx, width / 2 + 240, titleLine2Y - 9, 64, 4.5, '#C8102E');
  }

  // =========================================================================
  // 8. CEREMONIAL INTRO & PARTICIPANT NAME (PRIMARY FOCAL ELEMENT)
  // =========================================================================
  // Presented-To Line (Target ~24-30px, elegant ceremonial italic)
  const certIntroY = isPodium ? podiumBadgeY + 44 : titleLine2Y + 48;
  ctx.fillStyle = '#475569';
  ctx.font = 'italic 600 27px "Cormorant Garamond", Georgia, serif';
  ctx.fillText('This Certificate Is Proudly Presented To', width / 2, certIntroY);

  // Recipient Name (PRIMARY FOCAL ELEMENT: Target ~55-75px, commanding display)
  const rawName = (options.studentName || '').toUpperCase();
  let nameFontSize = 70;
  ctx.font = `700 ${nameFontSize}px "Cormorant Garamond", "Cinzel", Georgia, serif`;
  let measuredNameWidth = ctx.measureText(rawName).width;
  const maxNameWidth = 1520;

  if (measuredNameWidth > maxNameWidth) {
    nameFontSize = Math.max(42, Math.floor(nameFontSize * (maxNameWidth / measuredNameWidth)));
    ctx.font = `700 ${nameFontSize}px "Cormorant Garamond", "Cinzel", Georgia, serif`;
    measuredNameWidth = ctx.measureText(rawName).width;
  }

  const nameY = certIntroY + 76;
  ctx.fillStyle = '#0F172A';
  ctx.fillText(rawName, width / 2, nameY);

  // Recipient Underline with Terminal Diamonds
  const underlinePadding = 40;
  const underlineWidth = Math.min(measuredNameWidth + underlinePadding * 2, 1560);
  const underlineY = nameY + 20;

  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo((width - underlineWidth) / 2, underlineY);
  ctx.lineTo((width + underlineWidth) / 2, underlineY);
  ctx.stroke();

  drawDiamond(ctx, (width - underlineWidth) / 2, underlineY, 5, '#C8102E');
  drawDiamond(ctx, (width + underlineWidth) / 2, underlineY, 5, '#C8102E');
  drawDiamond(ctx, width / 2, underlineY, 4, '#003366', '#C8102E', 1);

  // =========================================================================
  // 9. PARTICIPANT METADATA & DYNAMIC STUDENT COLLEGE NAME
  // =========================================================================
  // Roll Number • Department • Year (Target ~25-31px)
  const rawMeta = `Roll No: ${options.rollNumber}   \u2022   ${options.department} (Year ${options.year})`;
  let metaFontSize = 28;
  ctx.font = `700 ${metaFontSize}px "Montserrat", "Plus Jakarta Sans", sans-serif`;
  let measuredMetaWidth = ctx.measureText(rawMeta).width;
  const maxMetaWidth = 1650;

  if (measuredMetaWidth > maxMetaWidth) {
    metaFontSize = Math.max(20, Math.floor(metaFontSize * (maxMetaWidth / measuredMetaWidth)));
    ctx.font = `700 ${metaFontSize}px "Montserrat", "Plus Jakarta Sans", sans-serif`;
  }

  const metaY = underlineY + 46;
  ctx.fillStyle = '#1E293B';
  ctx.fillText(rawMeta, width / 2, metaY);

  // Dynamic Student College Name (Target ~24-30px, with multi-line wrap if long)
  const collegeName = options.college || 'KITS Akshar Institute of Technology';
  let collegeFontSize = 27;
  ctx.font = `800 ${collegeFontSize}px "Montserrat", "Plus Jakarta Sans", sans-serif`;
  const collegeLines = wrapCanvasText(ctx, collegeName, 1550);
  const collegeLineHeight = 36;
  const collegeStartY = metaY + 38;

  ctx.fillStyle = '#003366';
  collegeLines.forEach((cline, cidx) => {
    ctx.fillText(cline, width / 2, collegeStartY + cidx * collegeLineHeight);
  });

  const collegeEndY = collegeStartY + (collegeLines.length - 1) * collegeLineHeight;

  // =========================================================================
  // 10. MAIN CERTIFICATE NARRATIVE STATEMENT (MAJOR SIZE INCREASE: ~27-32px)
  // =========================================================================
  const placeText = isWinner
    ? 'secured 1st Place (Winner)'
    : isRunner
    ? 'secured 2nd Place (Runner-Up)'
    : isThird
    ? 'secured 3rd Place'
    : 'actively participated';

  let teamClause = '';
  if (options.teamName && options.teamName !== 'Solo Participant') {
    teamClause = ` as ${options.teamRole || 'Team Leader'} of team "${options.teamName}"`;
  }

  // Human-readable date formatting with mandatory year
  let datePhrase = '';
  const startDateStr = options.eventStartDate ? formatLongDate(options.eventStartDate) : null;
  const endDateStr = options.eventEndDate ? formatLongDate(options.eventEndDate) : null;

  if (startDateStr && endDateStr && startDateStr !== endDateStr) {
    datePhrase = `held from ${startDateStr} to ${endDateStr}`;
  } else if (startDateStr) {
    datePhrase = `held on ${startDateStr}`;
  } else if (options.issuedAt) {
    datePhrase = `held in ${new Date(options.issuedAt).getFullYear()}`;
  } else {
    datePhrase = `held in 2026`;
  }

  const narrativeText = `has ${placeText}${teamClause} in the event "${options.eventName}" ${datePhrase}, in the sub-event "${options.subEventName}", organized by KITS Akshar Institute of Technology, Yanamadala, Guntur, Andhra Pradesh.`;

  ctx.font = '500 29px "Montserrat", "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = '#1E293B';

  const narrativeLines = wrapCanvasText(ctx, narrativeText, 1480);
  const narrativeStartY = collegeEndY + 48;
  const narrativeLineHeight = 44;

  narrativeLines.forEach((line, idx) => {
    ctx.fillText(line, width / 2, narrativeStartY + idx * narrativeLineHeight);
  });

  const narrativeEndY = narrativeStartY + (narrativeLines.length - 1) * narrativeLineHeight;

  // =========================================================================
  // 11. CERTIFICATE NUMBER & ISSUE DATE (OFFICIAL CREDENTIAL METADATA)
  // =========================================================================
  const certNumberY = narrativeEndY + 50;

  // Subtle dividing hairline with center diamond
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 250, certNumberY - 14);
  ctx.lineTo(width / 2 + 250, certNumberY - 14);
  ctx.stroke();
  drawDiamond(ctx, width / 2, certNumberY - 14, 3.5, '#C8102E');

  // Certificate Code Text (Target ~22-26px)
  ctx.textAlign = 'center';
  ctx.font = '700 24px "Montserrat", monospace, sans-serif';
  ctx.fillStyle = '#0F172A';
  ctx.fillText(`Certificate No: ${options.certificateCode}`, width / 2, certNumberY + 12);

  // Flanking red micro-diamonds
  const codeWidth = ctx.measureText(`Certificate No: ${options.certificateCode}`).width;
  drawDiamond(ctx, width / 2 - codeWidth / 2 - 24, certNumberY + 6, 4, '#C8102E');
  drawDiamond(ctx, width / 2 + codeWidth / 2 + 24, certNumberY + 6, 4, '#C8102E');

  // Issue Date (Target ~20-24px, with full year)
  const issueDateFormatted = options.issuedAt ? formatShortDate(options.issuedAt) : '15 Sept 2026';
  ctx.fillStyle = '#475569';
  ctx.font = '600 21px "Montserrat", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`Issued on: ${issueDateFormatted}`, width / 2, certNumberY + 44);

  // =========================================================================
  // 12. OFFICIAL SIGNATURES (CHAIRMAN LEFT, PRINCIPAL CENTER-RIGHT)
  // =========================================================================
  const chairman = options.chairmanName || 'Sri. K. Subba Rao';
  const principal = options.principalName || 'Dr. Kalluri Rama Kotaiah';
  const sigY = 1145;
  const sigLineWidth = 340;

  // Chairman Signature (Left Zone: Center X = 440)
  const leftCenter = 440;
  const leftStartX = leftCenter - sigLineWidth / 2;
  const leftEndX = leftCenter + sigLineWidth / 2;

  ctx.fillStyle = '#8B0000'; // Deep burgundy formal cursive
  ctx.font = 'italic bold 36px "Cormorant Garamond", Georgia, serif';
  ctx.fillText('K. Subba Rao', leftCenter, sigY - 20);

  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(leftStartX, sigY);
  ctx.lineTo(leftEndX, sigY);
  ctx.stroke();
  drawDiamond(ctx, leftCenter, sigY, 4, '#C8102E');

  ctx.fillStyle = '#0F172A';
  ctx.font = '900 23px "Montserrat", "Plus Jakarta Sans", sans-serif';
  ctx.fillText('CHAIRMAN', leftCenter, sigY + 30);

  ctx.fillStyle = '#64748B';
  ctx.font = '600 20px "Montserrat", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(chairman, leftCenter, sigY + 56);

  // Principal Signature (Center-Right Zone: Center X = 1120)
  const rightCenter = 1120;
  const rightStartX = rightCenter - sigLineWidth / 2;
  const rightEndX = rightCenter + sigLineWidth / 2;

  ctx.fillStyle = '#8B0000';
  ctx.font = 'italic bold 36px "Cormorant Garamond", Georgia, serif';
  ctx.fillText('K. Rama Kotaiah', rightCenter, sigY - 20);

  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rightStartX, sigY);
  ctx.lineTo(rightEndX, sigY);
  ctx.stroke();
  drawDiamond(ctx, rightCenter, sigY, 4, '#C8102E');

  ctx.fillStyle = '#0F172A';
  ctx.font = '900 23px "Montserrat", "Plus Jakarta Sans", sans-serif';
  ctx.fillText('PRINCIPAL', rightCenter, sigY + 30);

  ctx.fillStyle = '#64748B';
  ctx.font = '600 20px "Montserrat", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(principal, rightCenter, sigY + 56);

  // =========================================================================
  // 13. STANDALONE SCANNABLE QR CODE (LOWER-RIGHT REGION — 138px, NO BOX)
  // =========================================================================
  const qrSize = 138;
  const qrX = 1730 - qrSize / 2;
  const qrY = 1055;

  let qrDataUrl = options.qrDataUrl;
  let blobUrlToRevoke: string | null = null;

  if (!qrDataUrl && options.qrSvgElementId) {
    const qrSvg = document.getElementById(options.qrSvgElementId) as unknown as SVGElement | null;
    if (qrSvg) {
      let svgData = new XMLSerializer().serializeToString(qrSvg);
      if (!svgData.includes('xmlns=')) {
        svgData = svgData.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      }
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      qrDataUrl = URL.createObjectURL(svgBlob);
      blobUrlToRevoke = qrDataUrl;
    }
  }

  // Draw clean white quiet zone pad for the QR code
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8);

  if (qrDataUrl) {
    const qrImg = await loadImageSafe(qrDataUrl);
    if (qrImg && qrImg.naturalHeight !== 0) {
      const prevSmoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false; // Crisp module pixels
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
      ctx.imageSmoothingEnabled = prevSmoothing;
    }
    if (blobUrlToRevoke) {
      URL.revokeObjectURL(blobUrlToRevoke);
    }
  }

  // "Scan to Verify" Label below QR (Target ~20-24px)
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = '800 22px "Montserrat", "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Scan to Verify', 1730, qrY + qrSize + 26);

  // Delicate underline accent below "Scan to Verify"
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1730 - 40, qrY + qrSize + 34);
  ctx.lineTo(1730 + 40, qrY + qrSize + 34);
  ctx.stroke();

  return canvas;
}
