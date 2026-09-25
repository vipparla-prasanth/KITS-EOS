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
 * Implements the authoritative KITS-EOS Phase 9 Premium Institutional Visual Redesign:
 * - Multi-layer Institutional Border (KITS Red #C8102E, Akshar Blue #003366, Inner Blueprint Margin)
 * - Precision Engineering Geometric Corner Brackets with chamfers, crosshairs, and diamond nodes
 * - Subtle institutional central watermark (KITS emblem at 4% opacity with concentric drafting rings)
 * - Prestigious institutional letterhead & dual-rule header divider with central crest
 * - Distinctive event header and authoritative title hierarchy (Akshar Blue primary, KITS Red accent, NO brown/orange)
 * - Dominant recipient name centerpiece with dynamic font scaling, red accent underline, and terminal diamond nodes
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

  // Outer Edge: Thin KITS Red Line
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 3.5;
  ctx.strokeRect(26, 26, width - 52, height - 52);

  // Secondary Frame: Thin Akshar Blue Line
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 2;
  ctx.strokeRect(38, 38, width - 76, height - 76);

  // Inner Technical Drafting Frame
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.strokeRect(48, 48, width - 96, height - 96);

  // Precision Engineering Geometric Corner Brackets (All 4 Corners)
  const drawCornerBracket = (cornerX: number, cornerY: number, dirX: number, dirY: number) => {
    // Outer Akshar Blue bracket
    ctx.strokeStyle = '#003366';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cornerX + dirX * 46, cornerY);
    ctx.lineTo(cornerX, cornerY);
    ctx.lineTo(cornerX, cornerY + dirY * 46);
    ctx.stroke();

    // 45-degree chamfer tie line
    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cornerX + dirX * 40, cornerY);
    ctx.lineTo(cornerX, cornerY + dirY * 40);
    ctx.stroke();

    // Inner stepped bracket in KITS Red
    const stepInsetX = cornerX + dirX * 10;
    const stepInsetY = cornerY + dirY * 10;
    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(stepInsetX + dirX * 28, stepInsetY);
    ctx.lineTo(stepInsetX, stepInsetY);
    ctx.lineTo(stepInsetX, stepInsetY + dirY * 28);
    ctx.stroke();

    // Central corner diamond node
    const nodeX = cornerX + dirX * 20;
    const nodeY = cornerY + dirY * 20;
    drawDiamond(ctx, nodeX, nodeY, 4, '#003366', '#C8102E', 1);

    // Subtle precision drafting crosshairs
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nodeX - 7, nodeY);
    ctx.lineTo(nodeX + 7, nodeY);
    ctx.moveTo(nodeX, nodeY - 7);
    ctx.lineTo(nodeX, nodeY + 7);
    ctx.stroke();
  };

  // Top-Left (48, 48)
  drawCornerBracket(48, 48, 1, 1);
  // Top-Right (width - 48, 48)
  drawCornerBracket(width - 48, 48, -1, 1);
  // Bottom-Left (48, height - 48)
  drawCornerBracket(48, height - 48, 1, -1);
  // Bottom-Right (width - 48, height - 48)
  drawCornerBracket(width - 48, height - 48, -1, -1);

  // Precision Drafting Registration Ticks along Frames
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1;
  // Midpoint marks (top and bottom)
  [1000].forEach((mx) => {
    // Top
    ctx.beginPath();
    ctx.moveTo(mx - 8, 38);
    ctx.lineTo(mx + 8, 38);
    ctx.moveTo(mx, 26);
    ctx.lineTo(mx, 48);
    ctx.stroke();
    drawDiamond(ctx, mx, 38, 2.5, '#C8102E');

    // Bottom
    ctx.beginPath();
    ctx.moveTo(mx - 8, height - 38);
    ctx.lineTo(mx + 8, height - 38);
    ctx.moveTo(mx, height - 48);
    ctx.lineTo(mx, height - 26);
    ctx.stroke();
    drawDiamond(ctx, mx, height - 38, 2.5, '#C8102E');
  });

  // Quarter ticks (top and bottom)
  [500, 1500].forEach((qx) => {
    ctx.beginPath();
    ctx.moveTo(qx, 32);
    ctx.lineTo(qx, 44);
    ctx.moveTo(qx, height - 44);
    ctx.lineTo(qx, height - 32);
    ctx.stroke();
  });

  // Midpoint marks (left and right)
  [707].forEach((my) => {
    ctx.beginPath();
    ctx.moveTo(38, my - 8);
    ctx.lineTo(38, my + 8);
    ctx.moveTo(26, my);
    ctx.lineTo(48, my);
    ctx.moveTo(width - 38, my - 8);
    ctx.lineTo(width - 38, my + 8);
    ctx.moveTo(width - 48, my);
    ctx.lineTo(width - 26, my);
    ctx.stroke();
    drawDiamond(ctx, 38, my, 2.5, '#C8102E');
    drawDiamond(ctx, width - 38, my, 2.5, '#C8102E');
  });


  // =========================================================================
  // 2. SUBTLE INSTITUTIONAL WATERMARK (BACKGROUND)
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
  const wmSize = 540;

  ctx.save();
  if (logoLoaded && logo.naturalHeight !== 0) {
    ctx.globalAlpha = 0.04; // Extremely subtle, 4% opacity
    ctx.drawImage(logo, wmCenterX - wmSize / 2, wmCenterY - wmSize / 2, wmSize, wmSize);
  }

  // Concentric drafting watermark security rings
  ctx.globalAlpha = 0.035;
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(wmCenterX, wmCenterY, 280, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.025;
  ctx.strokeStyle = '#C8102E';
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(wmCenterX, wmCenterY, 298, 0, Math.PI * 2);
  ctx.stroke();

  // 8-point radial drafting ticks
  for (let a = 0; a < 8; a++) {
    const angle = (a * Math.PI) / 4;
    const r1 = 298;
    const r2 = 312;
    ctx.beginPath();
    ctx.moveTo(wmCenterX + Math.cos(angle) * r1, wmCenterY + Math.sin(angle) * r1);
    ctx.lineTo(wmCenterX + Math.cos(angle) * r2, wmCenterY + Math.sin(angle) * r2);
    ctx.stroke();
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

  // Architectural Dual Rule Header Divider
  const divY = bannerY + bannerH + 15; // ~328px

  // Primary Akshar Blue Rule
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(140, divY);
  ctx.lineTo(width - 140, divY);
  ctx.stroke();

  // Secondary KITS Red Accent Rule
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(240, divY + 4);
  ctx.lineTo(width - 240, divY + 4);
  ctx.stroke();

  // Central Institutional Diamond Ornament
  drawDiamond(ctx, width / 2, divY + 2, 7, '#003366', '#C8102E', 1.5);
  // Symmetrical flanking accent dots
  ctx.fillStyle = '#C8102E';
  ctx.beginPath();
  ctx.arc(width / 2 - 40, divY + 2, 2.5, 0, Math.PI * 2);
  ctx.arc(width / 2 + 40, divY + 2, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Terminal registration crosshairs
  ctx.strokeStyle = '#94A3B8';
  ctx.lineWidth = 1;
  [140, width - 140].forEach((tx) => {
    ctx.beginPath();
    ctx.moveTo(tx, divY - 6);
    ctx.lineTo(tx, divY + 6);
    ctx.stroke();
  });

  // =========================================================================
  // 4. DISTINCTIVE EVENT HEADER & CERTIFICATE TITLE
  // =========================================================================
  ctx.textAlign = 'center';

  // Small Institutional Fest Super-Header
  const superHeaderY = divY + 42;
  const festCategory = options.categoryName
    ? `${options.categoryName.toUpperCase()} \u2022 ANNUAL TECHNICAL FEST`
    : 'ANNUAL NATIONAL LEVEL TECHNICAL FEST';

  let superHeaderFontSize = 15;
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
  let eventFontSize = 52;
  ctx.font = `900 ${eventFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  let measuredEventWidth = ctx.measureText(rawEventName).width;
  const maxEventWidth = 1560;

  if (measuredEventWidth > maxEventWidth) {
    eventFontSize = Math.max(28, Math.floor(eventFontSize * (maxEventWidth / measuredEventWidth)));
    ctx.font = `900 ${eventFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  }

  const eventY = superHeaderY + 50;
  ctx.fillStyle = '#003366';
  ctx.fillText(rawEventName, width / 2, eventY);

  // Refined Section Divider below Event Name
  const sepY = eventY + 20;
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 100, sepY);
  ctx.lineTo(width / 2 + 100, sepY);
  ctx.stroke();
  drawDiamond(ctx, width / 2, sepY, 3.5, '#C8102E');

  // Certificate Type Heading
  const isWinner = options.achievement === 'WINNER';
  const isRunner = options.achievement === 'RUNNER';
  const isThird = options.achievement === 'THIRD_PLACE';
  const isPodium = isWinner || isRunner || isThird;

  const mainTitleY = sepY + 46;

  if (isWinner) {
    ctx.fillStyle = '#C8102E';
    ctx.font = '900 42px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('CERTIFICATE OF EXCELLENCE', width / 2, mainTitleY);

    // Sub-Badge for Winner
    const badgeY = mainTitleY + 28;
    ctx.fillStyle = '#003366';
    ctx.font = 'bold 20px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('1ST PLACE \u2022 WINNER', width / 2, badgeY);

    // Subtle warm metallic framing line
    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 140, badgeY + 8);
    ctx.lineTo(width / 2 + 140, badgeY + 8);
    ctx.stroke();
  } else if (isRunner) {
    ctx.fillStyle = '#C8102E';
    ctx.font = '900 42px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('CERTIFICATE OF MERIT', width / 2, mainTitleY);

    const badgeY = mainTitleY + 28;
    ctx.fillStyle = '#003366';
    ctx.font = 'bold 20px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('2ND PLACE \u2022 RUNNER-UP', width / 2, badgeY);

    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 140, badgeY + 8);
    ctx.lineTo(width / 2 + 140, badgeY + 8);
    ctx.stroke();
  } else if (isThird) {
    ctx.fillStyle = '#C8102E';
    ctx.font = '900 42px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('CERTIFICATE OF MERIT', width / 2, mainTitleY);

    const badgeY = mainTitleY + 28;
    ctx.fillStyle = '#003366';
    ctx.font = 'bold 20px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('3RD PLACE', width / 2, badgeY);

    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 90, badgeY + 8);
    ctx.lineTo(width / 2 + 90, badgeY + 8);
    ctx.stroke();
  } else {
    // PARTICIPATION — Akshar Blue primary title, Prestigious KITS Branding (NO BROWN/ORANGE)
    ctx.fillStyle = '#003366';
    ctx.font = '900 42px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
    ctx.fillText('CERTIFICATE OF PARTICIPATION', width / 2, mainTitleY);

    // Subtle blue accent rule with center red diamond
    const subY = mainTitleY + 12;
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 120, subY);
    ctx.lineTo(width / 2 + 120, subY);
    ctx.stroke();
    drawDiamond(ctx, width / 2, subY, 3, '#C8102E');
  }

  // =========================================================================
  // 5. CEREMONIAL INTRO & RECIPIENT NAME CENTERPIECE
  // =========================================================================
  const certIntroY = isPodium ? mainTitleY + 74 : mainTitleY + 56;
  ctx.fillStyle = '#475569';
  ctx.font = 'italic 26px Georgia, "Times New Roman", serif';
  ctx.fillText('This Certificate Is Proudly Presented To', width / 2, certIntroY);

  // Recipient Name with dynamic font scaling
  const rawName = (options.studentName || '').toUpperCase();
  let nameFontSize = 78;
  ctx.font = `900 ${nameFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  let measuredNameWidth = ctx.measureText(rawName).width;
  const maxNameWidth = 1560;

  if (measuredNameWidth > maxNameWidth) {
    nameFontSize = Math.max(44, Math.floor(nameFontSize * (maxNameWidth / measuredNameWidth)));
    ctx.font = `900 ${nameFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
    measuredNameWidth = ctx.measureText(rawName).width;
  }

  const nameY = certIntroY + 88;
  ctx.fillStyle = '#0F172A';
  ctx.fillText(rawName, width / 2, nameY);

  // Recipient Name Underline with Diamond Terminal Nodes
  const underlinePadding = 48;
  const underlineWidth = Math.min(measuredNameWidth + underlinePadding * 2, 1620);
  const underlineY = nameY + 22;

  // Primary KITS Red Underline
  ctx.strokeStyle = '#C8102E';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo((width - underlineWidth) / 2, underlineY);
  ctx.lineTo((width + underlineWidth) / 2, underlineY);
  ctx.stroke();

  // Terminal Solid Red Diamonds
  drawDiamond(ctx, (width - underlineWidth) / 2, underlineY, 5, '#C8102E');
  drawDiamond(ctx, (width + underlineWidth) / 2, underlineY, 5, '#C8102E');

  // Secondary Subtle Blue Accent Line below
  ctx.strokeStyle = '#003366';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2 - underlineWidth * 0.35, underlineY + 5);
  ctx.lineTo(width / 2 + underlineWidth * 0.35, underlineY + 5);
  ctx.stroke();

  // Subtle Precision Blueprint Corner Brackets Framing Recipient Zone
  const frameX1 = (width - underlineWidth) / 2 - 24;
  const frameX2 = (width + underlineWidth) / 2 + 24;
  const frameY = nameY - nameFontSize * 0.6;
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.5;
  // Left bracket [
  ctx.beginPath();
  ctx.moveTo(frameX1 + 12, frameY);
  ctx.lineTo(frameX1, frameY);
  ctx.lineTo(frameX1, frameY + 36);
  ctx.stroke();
  // Right bracket ]
  ctx.beginPath();
  ctx.moveTo(frameX2 - 12, frameY);
  ctx.lineTo(frameX2, frameY);
  ctx.lineTo(frameX2, frameY + 36);
  ctx.stroke();

  // =========================================================================
  // 6. STUDENT METADATA & INSTITUTION
  // =========================================================================
  const rawMeta = `Roll No: ${options.rollNumber}   \u2022   ${options.department} (Year ${options.year})`;
  let metaFontSize = 29;
  ctx.font = `bold ${metaFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  let measuredMetaWidth = ctx.measureText(rawMeta).width;
  const maxMetaWidth = 1660;

  if (measuredMetaWidth > maxMetaWidth) {
    metaFontSize = Math.max(22, Math.floor(metaFontSize * (maxMetaWidth / measuredMetaWidth)));
    ctx.font = `bold ${metaFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  }

  const metaY = underlineY + 54;
  ctx.fillStyle = '#1E293B';
  ctx.fillText(rawMeta, width / 2, metaY);

  // College Name in Akshar Blue
  const collegeName = options.college || 'KITS Akshar Institute of Technology';
  let collegeFontSize = 23;
  ctx.font = `bold ${collegeFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  let measuredCollegeWidth = ctx.measureText(collegeName).width;
  if (measuredCollegeWidth > 1650) {
    collegeFontSize = Math.max(18, Math.floor(collegeFontSize * (1650 / measuredCollegeWidth)));
    ctx.font = `bold ${collegeFontSize}px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif`;
  }

  const collegeY = metaY + 38;
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

  ctx.font = '500 34px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#1E293B';

  const narrativeLines = wrapCanvasText(ctx, narrativeText, 1600);
  const narrativeStartY = collegeY + 56;
  const narrativeLineHeight = 48;

  narrativeLines.forEach((line, idx) => {
    ctx.fillText(line, width / 2, narrativeStartY + idx * narrativeLineHeight);
  });

  const narrativeEndY = narrativeStartY + (narrativeLines.length - 1) * narrativeLineHeight;

  // =========================================================================
  // 8. DIGITAL VERIFICATION SECTION (SECURITY CARTOUCHE)
  // =========================================================================
  // System Verification Statement above Cartouche
  const verifStmtY = narrativeEndY + 44;
  ctx.fillStyle = '#64748B';
  ctx.font = 'italic 16px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillText(
    'This is an authoritative system-generated certificate digitally verifiable through the KITS-EOS certificate verification system.',
    width / 2,
    verifStmtY
  );

  // Verification Cartouche Panel Container
  const panelW = 420;
  const panelH = 210;
  const panelX = (width - panelW) / 2;
  const panelY = verifStmtY + 16;

  // Subtle blue-tinted card background
  ctx.fillStyle = '#F8FAFC';
  drawRoundedRect(ctx, panelX, panelY, panelW, panelH, 10);
  ctx.fill();

  // Subtle card border
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, panelX, panelY, panelW, panelH, 10);
  ctx.stroke();

  // Top Akshar Blue Header Tab
  ctx.fillStyle = '#003366';
  ctx.beginPath();
  ctx.moveTo(panelX + 10, panelY);
  ctx.lineTo(panelX + panelW - 10, panelY);
  ctx.quadraticCurveTo(panelX + panelW, panelY, panelX + panelW, panelY + 10);
  ctx.lineTo(panelX + panelW, panelY + 24);
  ctx.lineTo(panelX, panelY + 24);
  ctx.lineTo(panelX, panelY + 10);
  ctx.quadraticCurveTo(panelX, panelY, panelX + 10, panelY);
  ctx.closePath();
  ctx.fill();

  // Tab Header Text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 11px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillText('DIGITALLY VERIFIED CREDENTIAL', width / 2, panelY + 16);

  // QR Code Box inside Cartouche
  const qrBoxSize = 104;
  const qrX = (width - qrBoxSize) / 2;
  const qrY = panelY + 36;

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
  ctx.font = 'bold 19px monospace';
  ctx.fillText(options.certificateCode, width / 2, codeY);

  // Issue Date in Clean Monospace
  const issueDate = options.issuedAt
    ? new Date(options.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Verified Digital Credential';
  ctx.fillStyle = '#64748B';
  ctx.font = '13.5px monospace';
  ctx.fillText(`Issued: ${issueDate}`, width / 2, codeY + 20);

  // =========================================================================
  // 9. OFFICIAL INSTITUTIONAL SIGNATURES (ANCHORED & BALANCED)
  // =========================================================================
  const chairman = options.chairmanName || 'Sri. K. Subba Rao';
  const principal = options.principalName || 'Dr. Kalluri Rama Kotaiah';
  const sigY = 1240;
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

  // Institutional Accreditation & Credential Statement
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 13px "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif';
  ctx.fillText(
    'KITS AKSHAR INSTITUTE OF TECHNOLOGY   \u2022   AUTONOMOUS   \u2022   APPROVED BY AICTE   \u2022   AFFILIATED TO JNTUK   \u2022   ACCREDITED BY NAAC WITH "A" GRADE',
    width / 2,
    footerBaselineY + 22
  );

  return canvas;
}

