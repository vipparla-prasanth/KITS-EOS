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
 * Cross-browser rounded rectangle path helper.
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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
 * Renders an official certificate onto an HTML5 Canvas at high resolution (2000 x 1414 landscape A4 ratio).
 *
 * Implements KITS-EOS Phase 9.1 Premium Institutional Polish:
 * - Refined Multi-layer Border with subtle geometric micro-diamond accents (KITS Red #C8102E, Akshar Blue #003366)
 * - Symmetrical Architectural Corner Ornaments without mechanical blueprint crosshairs
 * - Subtle Side Architectural Framing Pylons balancing whitespace gracefully
 * - Academic Chancellor's Seal watermark at 4% opacity with concentric rings
 * - Prestigious institutional letterhead & dual-rule header divider with central crest
 * - Ceremonial two-level certificate title hierarchy (CERTIFICATE / OF PARTICIPATION, EXCELLENCE, MERIT)
 * - Distinctive central KITS ceremonial divider
 * - Dominant recipient name centerpiece with dynamic font scaling, architectural brackets, and terminal diamond underline
 * - Refined student metadata and balanced typographic narrative statement
 * - Dedicated digital verification cartouche with protected quiet-zone QR code, cert code, and issue date
 * - Anchored institutional signature block with Chairman and Principal signatures
 * - Structural baseline footer with official accreditation information
 */
export async function renderCertificateToCanvas(options: CertificateRenderOptions): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const width = 2000;
  const height = 1414;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D canvas context');

  // =========================================================================
  // 1. BASE BACKGROUND & MULTI-LAYER INSTITUTIONAL BORDERS
  // =========================================================================
  // Pristine white base
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Outer Edge: Thin KITS Red Line (2.5px)
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  // Secondary Frame: Thin Akshar Blue Line (1.5px)
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(38, 38, width - 76, height - 76);

  // Inner Technical Guideline (Hairline Slate)
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.strokeRect(48, 48, width - 96, height - 96);

  // Subtle Repeating Micro-Diamond Accent Motif in Border Inset Gap (y = 32 and y = height - 32)
  [250, 500, 750, 1000, 1250, 1500, 1750].forEach((mx) => {
    drawDiamond(ctx, mx, 32, 2.5, '#C8102E');
    drawDiamond(ctx, mx, height - 32, 2.5, '#C8102E');
  });
  // Side Inset Gap Motifs (x = 32 and x = width - 32)
  [200, 400, 600, 707, 800, 1000, 1200].forEach((my) => {
    drawDiamond(ctx, 32, my, 2.5, '#C8102E');
    drawDiamond(ctx, width - 32, my, 2.5, '#C8102E');
  });

  // Sophisticated Architectural Corner Ornaments (Clean University Aesthetic)
  const drawCornerOrnament = (cornerX: number, cornerY: number, dirX: number, dirY: number) => {
    // Outer Akshar Blue bracket
    ctx.strokeStyle = '#003366';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cornerX + dirX * 42, cornerY);
    ctx.lineTo(cornerX, cornerY);
    ctx.lineTo(cornerX, cornerY + dirY * 42);
    ctx.stroke();

    // 45-degree chamfer connector in KITS Red
    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cornerX + dirX * 36, cornerY);
    ctx.lineTo(cornerX, cornerY + dirY * 36);
    ctx.stroke();

    // Inner stepped bracket in KITS Red
    const stepInsetX = cornerX + dirX * 8;
    const stepInsetY = cornerY + dirY * 8;
    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(stepInsetX + dirX * 24, stepInsetY);
    ctx.lineTo(stepInsetX, stepInsetY);
    ctx.lineTo(stepInsetX, stepInsetY + dirY * 24);
    ctx.stroke();

    // Central corner diamond node
    const nodeX = cornerX + dirX * 18;
    const nodeY = cornerY + dirY * 18;
    drawDiamond(ctx, nodeX, nodeY, 4, '#003366', '#C8102E', 1);
  };

  // Top-Left (48, 48)
  drawCornerOrnament(48, 48, 1, 1);
  // Top-Right (width - 48, 48)
  drawCornerOrnament(width - 48, 48, -1, 1);
  // Bottom-Left (48, height - 48)
  drawCornerOrnament(48, height - 48, 1, -1);
  // Bottom-Right (width - 48, height - 48)
  drawCornerOrnament(width - 48, height - 48, -1, -1);

  // =========================================================================
  // 1B. SUBTLE SIDE ARCHITECTURAL FRAMING (BALANCING UNUSED WHITESPACE)
  // =========================================================================
  ctx.save();
  const drawSideFraming = (sideX1: number, sideX2: number) => {
    // Vertical slender structural guidelines
    ctx.strokeStyle = '#003366';
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sideX1, 360);
    ctx.lineTo(sideX1, 1200);
    ctx.moveTo(sideX2, 360);
    ctx.lineTo(sideX2, 1200);
    ctx.stroke();

    // Horizontal pylon ties with center red diamonds
    [480, 680, 880, 1080].forEach((ty) => {
      ctx.strokeStyle = '#003366';
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sideX1, ty);
      ctx.lineTo(sideX2, ty);
      ctx.stroke();

      ctx.globalAlpha = 0.28;
      drawDiamond(ctx, (sideX1 + sideX2) / 2, ty, 2.5, '#C8102E');
    });

    // Top and bottom terminal diamond caps
    ctx.globalAlpha = 0.25;
    drawDiamond(ctx, (sideX1 + sideX2) / 2, 360, 3, '#003366', '#C8102E', 1);
    drawDiamond(ctx, (sideX1 + sideX2) / 2, 1200, 3, '#003366', '#C8102E', 1);
  };

  // Left side framing (x: 76 & 92)
  drawSideFraming(76, 92);
  // Right side framing (x: width - 92 & width - 76)
  drawSideFraming(width - 92, width - 76);
  ctx.restore();

  // =========================================================================
  // 2. SUBTLE INSTITUTIONAL WATERMARK (ACADEMIC SEAL AESTHETIC)
  // =========================================================================
  const logo = new Image();
  logo.crossOrigin = 'anonymous';
  const logoLoaded = await new Promise<boolean>((resolve) => {
    logo.onload = () => resolve(true);
    logo.onerror = () => resolve(false);
    logo.src = options.logoUrl || '/college_logo.png';
  });

  const wmCenterX = width / 2;
  const wmCenterY = 720;
  const wmSize = 520;

  ctx.save();
  if (logoLoaded && logo.naturalHeight !== 0) {
    ctx.globalAlpha = 0.04; // Extremely subtle, 4% opacity
    ctx.drawImage(logo, wmCenterX - wmSize / 2, wmCenterY - wmSize / 2, wmSize, wmSize);
  }

  // Concentric Academic Seal Security Rings
  ctx.globalAlpha = 0.03;
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(wmCenterX, wmCenterY, 290, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.025;
  ctx.strokeStyle = '#C8102E';
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(wmCenterX, wmCenterY, 276, 0, Math.PI * 2);
  ctx.stroke();

  // 12-point Academic Seal Micro-Diamonds around seal ring
  ctx.globalAlpha = 0.035;
  for (let a = 0; a < 12; a++) {
    const angle = (a * Math.PI) / 6;
    const rx = wmCenterX + Math.cos(angle) * 290;
    const ry = wmCenterY + Math.sin(angle) * 290;
    drawDiamond(ctx, rx, ry, 2.5, '#003366');
  }
  ctx.restore();

  // =========================================================================
  // 3. OFFICIAL COLLEGE BANNER & ARCHITECTURAL HEADER
  // =========================================================================
  const banner = new Image();
  banner.crossOrigin = 'anonymous';
  await new Promise<void>((resolve) => {
    banner.onload = () => resolve();
    banner.onerror = () => resolve();
    banner.src = options.bannerUrl || '/college_banner.png';
  });

  const bannerW = 1540;
  const bannerH = Math.round(bannerW / 6.1317); // ~251px
  const bannerX = (width - bannerW) / 2;
  const bannerY = 62;

  if (banner.complete && banner.naturalHeight !== 0) {
    ctx.drawImage(banner, bannerX, bannerY, bannerW, bannerH);
  }

  // Architectural Dual-Rule Header Divider
  const divY = bannerY + bannerH + 15; // ~328px

  // Primary Akshar Blue Rule
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(160, divY);
  ctx.lineTo(width - 160, divY);
  ctx.stroke();

  // Secondary KITS Red Accent Rule
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(280, divY + 4);
  ctx.lineTo(width - 280, divY + 4);
  ctx.stroke();

  // Central Institutional Diamond Ornament
  drawDiamond(ctx, width / 2, divY + 2, 7, '#003366', '#C8102E', 1.5);
  // Symmetrical flanking accent diamonds
  drawDiamond(ctx, width / 2 - 36, divY + 2, 3, '#C8102E');
  drawDiamond(ctx, width / 2 + 36, divY + 2, 3, '#C8102E');

  // =========================================================================
  // 4. DISTINCTIVE EVENT HEADER & CEREMONIAL CERTIFICATE TITLE
  // =========================================================================
  ctx.textAlign = 'center';

  // Small Institutional Fest Super-Header
  const superHeaderY = divY + 38;
  const festCategory = options.categoryName
    ? `${options.categoryName.toUpperCase()} \u2022 ANNUAL TECHNICAL FEST`
    : 'ANNUAL NATIONAL LEVEL TECHNICAL FEST';

  let superHeaderFontSize = 14;
  ctx.font = `bold ${superHeaderFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  let measuredSuperHeaderWidth = ctx.measureText(festCategory).width;
  if (measuredSuperHeaderWidth > 1500) {
    superHeaderFontSize = Math.max(11, Math.floor(superHeaderFontSize * (1500 / measuredSuperHeaderWidth)));
    ctx.font = `bold ${superHeaderFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  }
  ctx.fillStyle = '#64748B';
  ctx.fillText(festCategory, width / 2, superHeaderY);

  // Event Name with Dynamic Font Scaling (Prevents clipping on long fest names)
  const rawEventName = (options.eventName || 'CENTRAL EVENT OPERATIONS').toUpperCase();
  let eventFontSize = 48;
  ctx.font = `900 ${eventFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  let measuredEventWidth = ctx.measureText(rawEventName).width;
  const maxEventWidth = 1540;

  if (measuredEventWidth > maxEventWidth) {
    eventFontSize = Math.max(26, Math.floor(eventFontSize * (maxEventWidth / measuredEventWidth)));
    ctx.font = `900 ${eventFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  }

  const eventY = superHeaderY + 44;
  ctx.fillStyle = '#003366';
  ctx.fillText(rawEventName, width / 2, eventY);

  // Central Signature Ceremonial Divider below Event Name
  const sepY = eventY + 22;
  // Symmetrical Blue rules with Center Red Accent Bar and Layered Diamond
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 140, sepY);
  ctx.lineTo(width / 2 - 24, sepY);
  ctx.moveTo(width / 2 + 24, sepY);
  ctx.lineTo(width / 2 + 140, sepY);
  ctx.stroke();

  // Center Red Segment
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 24, sepY);
  ctx.lineTo(width / 2 + 24, sepY);
  ctx.stroke();

  // Center Layered Diamond Node
  drawDiamond(ctx, width / 2, sepY, 5, '#003366', '#C8102E', 1.5);
  // Terminal Red Micro-Diamonds
  drawDiamond(ctx, width / 2 - 140, sepY, 2.5, '#C8102E');
  drawDiamond(ctx, width / 2 + 140, sepY, 2.5, '#C8102E');

  // Certificate Type Hierarchy (Prestigious Academic Format: CERTIFICATE / OF ...)
  const isWinner = options.achievement === 'WINNER';
  const isRunner = options.achievement === 'RUNNER';
  const isThird = options.achievement === 'THIRD_PLACE';
  const isPodium = isWinner || isRunner || isThird;

  // Title Line 1: CERTIFICATE (Prestigious Spaced Typography)
  const titleLine1Y = sepY + 42;
  ctx.font = '900 38px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';

  if (isWinner || isRunner || isThird) {
    ctx.fillStyle = '#C8102E';
    ctx.fillText('C E R T I F I C A T E', width / 2, titleLine1Y);
  } else {
    ctx.fillStyle = '#003366';
    ctx.fillText('C E R T I F I C A T E', width / 2, titleLine1Y);
  }

  // Title Line 2: OF PARTICIPATION / OF EXCELLENCE / OF MERIT
  const titleLine2Y = titleLine1Y + 34;

  if (isWinner) {
    ctx.fillStyle = '#C8102E';
    ctx.font = 'bold 24px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('OF EXCELLENCE', width / 2, titleLine2Y);

    // Prestigious Winner Badge
    const badgeY = titleLine2Y + 28;
    ctx.fillStyle = '#003366';
    ctx.font = '900 19px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('1ST PLACE \u2022 WINNER', width / 2, badgeY);

    // Warm metallic accent line
    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 130, badgeY + 8);
    ctx.lineTo(width / 2 + 130, badgeY + 8);
    ctx.stroke();
    drawDiamond(ctx, width / 2, badgeY + 8, 3, '#D97706');
  } else if (isRunner) {
    ctx.fillStyle = '#C8102E';
    ctx.font = 'bold 24px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('OF MERIT', width / 2, titleLine2Y);

    const badgeY = titleLine2Y + 28;
    ctx.fillStyle = '#003366';
    ctx.font = '900 19px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('2ND PLACE \u2022 RUNNER-UP', width / 2, badgeY);

    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 130, badgeY + 8);
    ctx.lineTo(width / 2 + 130, badgeY + 8);
    ctx.stroke();
    drawDiamond(ctx, width / 2, badgeY + 8, 3, '#94A3B8');
  } else if (isThird) {
    ctx.fillStyle = '#C8102E';
    ctx.font = 'bold 24px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('OF MERIT', width / 2, titleLine2Y);

    const badgeY = titleLine2Y + 28;
    ctx.fillStyle = '#003366';
    ctx.font = '900 19px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('3RD PLACE', width / 2, badgeY);

    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 90, badgeY + 8);
    ctx.lineTo(width / 2 + 90, badgeY + 8);
    ctx.stroke();
    drawDiamond(ctx, width / 2, badgeY + 8, 3, '#D97706');
  } else {
    // PARTICIPATION — KITS Red secondary subtitle flanked by delicate geometric wings
    ctx.fillStyle = '#C8102E';
    ctx.font = 'bold 22px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('OF PARTICIPATION', width / 2, titleLine2Y);

    // Flanking subtle geometric wings
    const wingW = 70;
    const wingY = titleLine2Y - 7;
    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = 1;
    // Left wing
    ctx.beginPath();
    ctx.moveTo(width / 2 - 150 - wingW, wingY);
    ctx.lineTo(width / 2 - 150, wingY);
    ctx.stroke();
    drawDiamond(ctx, width / 2 - 150 - wingW, wingY, 2.5, '#C8102E');
    // Right wing
    ctx.beginPath();
    ctx.moveTo(width / 2 + 150, wingY);
    ctx.lineTo(width / 2 + 150 + wingW, wingY);
    ctx.stroke();
    drawDiamond(ctx, width / 2 + 150 + wingW, wingY, 2.5, '#C8102E');
  }

  // =========================================================================
  // 5. CEREMONIAL INTRO & RECIPIENT NAME CENTERPIECE
  // =========================================================================
  const certIntroY = isPodium ? titleLine2Y + 62 : titleLine2Y + 44;
  ctx.fillStyle = '#475569';
  ctx.font = 'italic 24px Georgia, "Times New Roman", serif';
  ctx.fillText('This Certificate Is Proudly Presented To', width / 2, certIntroY);

  // Recipient Name with dynamic font scaling
  const rawName = (options.studentName || '').toUpperCase();
  let nameFontSize = 74;
  ctx.font = `900 ${nameFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  let measuredNameWidth = ctx.measureText(rawName).width;
  const maxNameWidth = 1540;

  if (measuredNameWidth > maxNameWidth) {
    nameFontSize = Math.max(42, Math.floor(nameFontSize * (maxNameWidth / measuredNameWidth)));
    ctx.font = `900 ${nameFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
    measuredNameWidth = ctx.measureText(rawName).width;
  }

  const nameY = certIntroY + 70;
  ctx.fillStyle = '#0F172A';
  ctx.fillText(rawName, width / 2, nameY);

  // Recipient Name Underline with Terminal Diamond Nodes
  const underlinePadding = 48;
  const underlineWidth = Math.min(measuredNameWidth + underlinePadding * 2, 1600);
  const underlineY = nameY + 20;

  // Primary KITS Red Underline (3px)
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo((width - underlineWidth) / 2, underlineY);
  ctx.lineTo((width + underlineWidth) / 2, underlineY);
  ctx.stroke();

  // Terminal Solid Red Diamonds & Centered Node
  drawDiamond(ctx, (width - underlineWidth) / 2, underlineY, 5, '#C8102E');
  drawDiamond(ctx, (width + underlineWidth) / 2, underlineY, 5, '#C8102E');
  drawDiamond(ctx, width / 2, underlineY, 4, '#003366', '#C8102E', 1);

  // Secondary Akshar Blue Structural Guideline below (1px)
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2 - underlineWidth * 0.38, underlineY + 5);
  ctx.lineTo(width / 2 + underlineWidth * 0.38, underlineY + 5);
  ctx.stroke();

  // Subtle Architectural Brackets Framing Recipient Zone
  const frameX1 = (width - underlineWidth) / 2 - 28;
  const frameX2 = (width + underlineWidth) / 2 + 28;
  const frameTopY = nameY - nameFontSize * 0.65;
  const frameHeight = nameFontSize * 0.85;

  ctx.strokeStyle = '#94A3B8';
  ctx.lineWidth = 1.5;
  // Left Bracket: ⌜ with small red diamond node
  ctx.beginPath();
  ctx.moveTo(frameX1 + 14, frameTopY);
  ctx.lineTo(frameX1, frameTopY);
  ctx.lineTo(frameX1, frameTopY + frameHeight);
  ctx.stroke();
  drawDiamond(ctx, frameX1, frameTopY, 2.5, '#C8102E');

  // Right Bracket: ⌝ with small red diamond node
  ctx.beginPath();
  ctx.moveTo(frameX2 - 14, frameTopY);
  ctx.lineTo(frameX2, frameTopY);
  ctx.lineTo(frameX2, frameTopY + frameHeight);
  ctx.stroke();
  drawDiamond(ctx, frameX2, frameTopY, 2.5, '#C8102E');

  // =========================================================================
  // 6. STUDENT METADATA & INSTITUTION
  // =========================================================================
  const rawMeta = `Roll No: ${options.rollNumber}   \u2022   ${options.department} (Year ${options.year})`;
  let metaFontSize = 26;
  ctx.font = `bold ${metaFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  let measuredMetaWidth = ctx.measureText(rawMeta).width;
  const maxMetaWidth = 1660;

  if (measuredMetaWidth > maxMetaWidth) {
    metaFontSize = Math.max(20, Math.floor(metaFontSize * (maxMetaWidth / measuredMetaWidth)));
    ctx.font = `bold ${metaFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  }

  const metaY = underlineY + 46;
  ctx.fillStyle = '#1E293B';
  ctx.fillText(rawMeta, width / 2, metaY);

  // College Name in Akshar Blue
  const collegeName = options.college || 'KITS Akshar Institute of Technology';
  let collegeFontSize = 22;
  ctx.font = `bold ${collegeFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  let measuredCollegeWidth = ctx.measureText(collegeName).width;
  if (measuredCollegeWidth > 1650) {
    collegeFontSize = Math.max(17, Math.floor(collegeFontSize * (1650 / measuredCollegeWidth)));
    ctx.font = `bold ${collegeFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  }

  const collegeY = metaY + 34;
  ctx.fillStyle = '#003366';
  ctx.fillText(collegeName, width / 2, collegeY);

  // =========================================================================
  // 7. FORMAL TYPOGRAPHIC NARRATIVE STATEMENT
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
    teamClause = ` as ${options.teamRole || 'Team Leader'} of "${options.teamName}"`;
  }

  const narrativeText = `has ${placeText} in the competition track "${options.subEventName}"${teamClause} during ${options.eventName}.`;

  ctx.font = '500 31px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#1E293B';

  const narrativeLines = wrapCanvasText(ctx, narrativeText, 1580);
  const narrativeStartY = collegeY + 48;
  const narrativeLineHeight = 44;

  narrativeLines.forEach((line, idx) => {
    ctx.fillText(line, width / 2, narrativeStartY + idx * narrativeLineHeight);
  });

  const narrativeEndY = narrativeStartY + (narrativeLines.length - 1) * narrativeLineHeight;

  // =========================================================================
  // 8. OFFICIAL DIGITAL VERIFICATION ENCLOSURE (SECURITY CARTOUCHE)
  // =========================================================================
  // System Verification Statement above Cartouche
  const verifStmtY = narrativeEndY + 40;
  ctx.fillStyle = '#64748B';
  ctx.font = 'italic 15px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillText(
    'This is an authoritative system-generated certificate digitally verifiable through the KITS-EOS certificate verification system.',
    width / 2,
    verifStmtY
  );

  // Verification Cartouche Container
  const panelW = 420;
  const panelH = 214;
  const panelX = (width - panelW) / 2;
  const panelY = verifStmtY + 16;

  // Dignified container fill and structural borders
  ctx.fillStyle = '#F8FAFC';
  drawRoundedRect(ctx, panelX, panelY, panelW, panelH, 10);
  ctx.fill();

  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, panelX, panelY, panelW, panelH, 10);
  ctx.stroke();

  // Inset hairline security frame
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 0.8;
  ctx.globalAlpha = 0.3;
  drawRoundedRect(ctx, panelX + 3, panelY + 3, panelW - 6, panelH - 6, 8);
  ctx.stroke();
  ctx.globalAlpha = 1.0;

  // Top Akshar Blue Header Tab
  ctx.fillStyle = '#003366';
  ctx.beginPath();
  ctx.moveTo(panelX + 10, panelY);
  ctx.lineTo(panelX + panelW - 10, panelY);
  ctx.quadraticCurveTo(panelX + panelW, panelY, panelX + panelW, panelY + 10);
  ctx.lineTo(panelX + panelW, panelY + 26);
  ctx.lineTo(panelX, panelY + 26);
  ctx.lineTo(panelX, panelY + 10);
  ctx.quadraticCurveTo(panelX, panelY, panelX + 10, panelY);
  ctx.closePath();
  ctx.fill();

  // Tab Header Text with Small Diamond Accents
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 11px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillText('DIGITALLY VERIFIED CREDENTIAL', width / 2, panelY + 18);
  drawDiamond(ctx, panelX + 24, panelY + 13, 2.5, '#C8102E');
  drawDiamond(ctx, panelX + panelW - 24, panelY + 13, 2.5, '#C8102E');

  // QR Code Box inside Cartouche
  const qrBoxSize = 112;
  const qrX = (width - qrBoxSize) / 2;
  const qrY = panelY + 38;

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

  // Draw inner QR white container
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, qrX, qrY, qrBoxSize, qrBoxSize, 6);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, qrX, qrY, qrBoxSize, qrBoxSize, 6);
  ctx.stroke();

  if (qrDataUrl) {
    const qrImg = new Image();
    await new Promise<void>((resolve) => {
      qrImg.onload = () => {
        // Draw with 4px inner quiet zone padding and crisp module edges
        const prevSmoothing = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(qrImg, qrX + 4, qrY + 4, qrBoxSize - 8, qrBoxSize - 8);
        ctx.imageSmoothingEnabled = prevSmoothing;
        resolve();
      };
      qrImg.onerror = () => resolve();
      qrImg.src = qrDataUrl!;
    });
    if (blobUrlToRevoke) {
      URL.revokeObjectURL(blobUrlToRevoke);
    }
  }

  // Certificate Code in Bold Monospace
  const codeY = qrY + qrBoxSize + 22;
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 18px monospace';
  ctx.fillText(options.certificateCode, width / 2, codeY);

  // Issue Date in Clean Monospace
  const issueDate = options.issuedAt
    ? new Date(options.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Verified Digital Credential';
  ctx.fillStyle = '#64748B';
  ctx.font = '13px monospace';
  ctx.fillText(`Issued: ${issueDate}`, width / 2, codeY + 19);

  // =========================================================================
  // 9. OFFICIAL INSTITUTIONAL SIGNATURES (ANCHORED & BALANCED)
  // =========================================================================
  const chairman = options.chairmanName || 'Sri. K. Subba Rao';
  const principal = options.principalName || 'Dr. Kalluri Rama Kotaiah';
  const sigY = 1245;
  const sigLineWidth = 360;

  // Horizontal Structural Connecting Line bridging signatures to verification zone
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(580, sigY);
  ctx.lineTo(panelX - 16, sigY);
  ctx.moveTo(panelX + panelW + 16, sigY);
  ctx.lineTo(1420, sigY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Chairman Signature (Left: center x = 400)
  const leftCenter = 400;
  const leftStartX = leftCenter - sigLineWidth / 2;
  const leftEndX = leftCenter + sigLineWidth / 2;

  // Cursive Signature in deep wine burgundy
  ctx.fillStyle = '#8B0000';
  ctx.font = 'italic bold 38px Georgia, "Times New Roman", serif';
  ctx.fillText('K. Subba Rao', leftCenter, sigY - 20);

  // Signature Rule in Akshar Blue with Center Red Diamond
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(leftStartX, sigY);
  ctx.lineTo(leftEndX, sigY);
  ctx.stroke();
  drawDiamond(ctx, leftCenter, sigY, 4, '#C8102E');

  // Role
  ctx.fillStyle = '#0F172A';
  ctx.font = '900 24px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillText('CHAIRMAN', leftCenter, sigY + 32);

  // Signatory Subtitle
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 20px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillText(chairman, leftCenter, sigY + 58);

  // Principal Signature (Right: center x = 1600)
  const rightCenter = width - 400;
  const rightStartX = rightCenter - sigLineWidth / 2;
  const rightEndX = rightCenter + sigLineWidth / 2;

  // Cursive Signature in deep wine burgundy
  ctx.fillStyle = '#8B0000';
  ctx.font = 'italic bold 38px Georgia, "Times New Roman", serif';
  ctx.fillText('K. Rama Kotaiah', rightCenter, sigY - 20);

  // Signature Rule in Akshar Blue with Center Red Diamond
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(rightStartX, sigY);
  ctx.lineTo(rightEndX, sigY);
  ctx.stroke();
  drawDiamond(ctx, rightCenter, sigY, 4, '#C8102E');

  // Role
  ctx.fillStyle = '#0F172A';
  ctx.font = '900 24px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillText('PRINCIPAL', rightCenter, sigY + 32);

  // Signatory Subtitle
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 20px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillText(principal, rightCenter, sigY + 58);

  // =========================================================================
  // 10. PREMIUM INSTITUTIONAL FOOTER BASELINE
  // =========================================================================
  const footerBaselineY = 1336;

  // Structural Baseline Rule
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(100, footerBaselineY);
  ctx.lineTo(width - 100, footerBaselineY);
  ctx.stroke();

  // Symmetrical Accent Terminal Nodes
  drawDiamond(ctx, 100, footerBaselineY, 4, '#C8102E');
  drawDiamond(ctx, width - 100, footerBaselineY, 4, '#C8102E');

  // Institutional Accreditation Statement
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 13px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillText(
    'KITS AKSHAR INSTITUTE OF TECHNOLOGY   \u2022   AUTONOMOUS   \u2022   APPROVED BY AICTE   \u2022   AFFILIATED TO JNTUK   \u2022   ACCREDITED BY NAAC WITH "A" GRADE',
    width / 2,
    footerBaselineY + 22
  );

  return canvas;
}
