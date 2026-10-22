/**
 * Assessment Result & Official Score Report Canvas Renderer
 * Generates high-resolution A4 Portrait (1600 x 2260) transcript for PDF and PNG downloads.
 */

export interface AssessmentResultRenderOptions {
  assessmentTitle: string;
  studentName: string;
  rollNumber: string;
  department?: string;
  college?: string;
  completionDate: string;
  earnedScore: number;
  totalPoints: number;
  percentage: number;
  isPassed: boolean;
  passingPercentage: number;
  rank?: number | null;
  totalCandidates?: number | null;
  awardType?: string | null;
  correctCount: number;
  incorrectCount: number;
  unattemptedCount: number;
  totalQuestions: number;
  strikeCount?: number;
  resultReferenceId: string;
  qrDataUrl?: string;
  logoUrl?: string;
}

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

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src || typeof window === 'undefined') return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function renderAssessmentResultToCanvas(
  options: AssessmentResultRenderOptions
): Promise<HTMLCanvasElement> {
  const width = 1600;
  const height = 2260;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D canvas context');

  // 1. Crisp White Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Subtle Outer Document Border
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 40, width - 80, height - 80);

  // Secondary Inner Accent Hairline
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.strokeRect(48, 48, width - 96, height - 96);

  // 2. Header Banner (Regal Navy with Gold Accent)
  const headerGrad = ctx.createLinearGradient(0, 0, width, 0);
  headerGrad.addColorStop(0, '#0A192F');
  headerGrad.addColorStop(0.5, '#0F2744');
  headerGrad.addColorStop(1, '#0A192F');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(50, 50, width - 100, 220);

  // Gold separator line
  ctx.fillStyle = '#D4AF37';
  ctx.fillRect(50, 266, width - 100, 4);

  // Header Institution Logo
  const logoImg = await loadImage(options.logoUrl || '/kits_logo_official.jpg');
  if (logoImg) {
    try {
      ctx.save();
      ctx.beginPath();
      ctx.arc(150, 160, 64, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(logoImg, 86, 96, 128, 128);
      ctx.restore();

      ctx.strokeStyle = '#D4AF37';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(150, 160, 65, 0, Math.PI * 2);
      ctx.stroke();
    } catch {
      // Fallback if crossOrigin issues
    }
  }

  // Header Typography
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 36px "Montserrat", sans-serif';
  ctx.fillText('KITS AKSHAR INSTITUTE OF TECHNOLOGY', 250, 125);

  ctx.fillStyle = '#F3BA2F';
  ctx.font = '600 20px "Cinzel", serif';
  ctx.fillText('OFFICIAL EXAMINATION TRANSCRIPT & SCORE REPORT', 250, 165);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 16px "Montserrat", sans-serif';
  ctx.fillText('KITS-EOS Assessment Platform • Autonomous Examination Authority', 250, 205);

  // 3. Document Reference Strip
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(50, 270, width - 100, 70);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.strokeRect(50, 270, width - 100, 70);

  ctx.fillStyle = '#64748B';
  ctx.font = '600 14px "Montserrat", sans-serif';
  ctx.fillText('RESULT REFERENCE ID:', 80, 312);
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 16px monospace';
  ctx.fillText(options.resultReferenceId.toUpperCase(), 270, 312);

  ctx.fillStyle = '#64748B';
  ctx.font = '600 14px "Montserrat", sans-serif';
  ctx.fillText('COMPLETED:', 850, 312);
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 15px "Montserrat", sans-serif';
  ctx.fillText(options.completionDate, 960, 312);

  // Status Badge on right of strip
  const badgeX = 1350;
  const badgeY = 287;
  ctx.fillStyle = options.isPassed ? '#ECFDF5' : '#FEF2F2';
  ctx.strokeStyle = options.isPassed ? '#10B981' : '#EF4444';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, 160, 36, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = options.isPassed ? '#065F46' : '#991B1B';
  ctx.font = 'bold 14px "Montserrat", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(options.isPassed ? 'PASSED' : 'NOT QUALIFIED', badgeX + 80, badgeY + 23);
  ctx.textAlign = 'left';

  // 4. Candidate Information Panel
  let currentY = 380;
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 22px "Cinzel", serif';
  ctx.fillText('1. CANDIDATE PROFILE', 80, currentY);

  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, currentY + 12);
  ctx.lineTo(width - 80, currentY + 12);
  ctx.stroke();

  currentY += 45;

  // Student Profile Card
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.roundRect(80, currentY, width - 160, 130, 16);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  // Name
  ctx.fillStyle = '#64748B';
  ctx.font = '600 14px "Montserrat", sans-serif';
  ctx.fillText('STUDENT NAME', 120, currentY + 45);
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 24px "Montserrat", sans-serif';
  ctx.fillText(options.studentName, 120, currentY + 85);

  // Roll Number
  ctx.fillStyle = '#64748B';
  ctx.font = '600 14px "Montserrat", sans-serif';
  ctx.fillText('ROLL NUMBER', 650, currentY + 45);
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 22px monospace';
  ctx.fillText(options.rollNumber || 'N/A', 650, currentY + 85);

  // Department & College
  ctx.fillStyle = '#64748B';
  ctx.font = '600 14px "Montserrat", sans-serif';
  ctx.fillText('INSTITUTION / DEPARTMENT', 1050, currentY + 45);
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 16px "Montserrat", sans-serif';
  const instText = `${options.department ? options.department + ' • ' : ''}${options.college || 'KITS'}`;
  ctx.fillText(instText, 1050, currentY + 85);

  // 5. Assessment Details Panel
  currentY += 175;
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 22px "Cinzel", serif';
  ctx.fillText('2. EXAMINATION PERFORMANCE OVERVIEW', 80, currentY);

  ctx.strokeStyle = '#E2E8F0';
  ctx.beginPath();
  ctx.moveTo(80, currentY + 12);
  ctx.lineTo(width - 80, currentY + 12);
  ctx.stroke();

  currentY += 35;

  // Title Box
  ctx.fillStyle = '#F1F5F9';
  ctx.beginPath();
  ctx.roundRect(80, currentY, width - 160, 75, 12);
  ctx.fill();

  ctx.fillStyle = '#475569';
  ctx.font = '600 13px "Montserrat", sans-serif';
  ctx.fillText('EXAMINATION TITLE', 110, currentY + 30);
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 20px "Montserrat", sans-serif';
  const titleLines = wrapCanvasText(ctx, options.assessmentTitle, width - 240);
  ctx.fillText(titleLines[0] || options.assessmentTitle, 110, currentY + 56);

  currentY += 95;

  // 4 Key Performance Indicator Metric Cards
  const cardWidth = (width - 160 - 45) / 4;
  const cardHeight = 155;

  // Metric 1: Final Score
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.roundRect(80, currentY, cardWidth, cardHeight, 14);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 13px "Montserrat", sans-serif';
  ctx.fillText('FINAL SCORE', 105, currentY + 38);
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 42px monospace';
  ctx.fillText(`${options.earnedScore}`, 105, currentY + 95);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 16px "Montserrat", sans-serif';
  ctx.fillText(`/ ${options.totalPoints} pts`, 105 + ctx.measureText(`${options.earnedScore}`).width + 8, currentY + 95);

  // Metric 2: Percentage
  const m2X = 80 + cardWidth + 15;
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.roundRect(m2X, currentY, cardWidth, cardHeight, 14);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 13px "Montserrat", sans-serif';
  ctx.fillText('SCORE PERCENTAGE', m2X + 25, currentY + 38);
  ctx.fillStyle = options.isPassed ? '#059669' : '#DC2626';
  ctx.font = 'bold 42px monospace';
  ctx.fillText(`${options.percentage.toFixed(1)}%`, m2X + 25, currentY + 95);
  ctx.fillStyle = '#64748B';
  ctx.font = '500 12px "Montserrat", sans-serif';
  ctx.fillText(`Pass Standard: ${options.passingPercentage}%`, m2X + 25, currentY + 128);

  // Metric 3: Official Rank
  const m3X = m2X + cardWidth + 15;
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.roundRect(m3X, currentY, cardWidth, cardHeight, 14);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 13px "Montserrat", sans-serif';
  ctx.fillText('OFFICIAL RANK', m3X + 25, currentY + 38);
  if (options.rank) {
    ctx.fillStyle = options.rank === 1 ? '#D97706' : options.rank === 2 ? '#475569' : options.rank === 3 ? '#B45309' : '#0F172A';
    ctx.font = 'bold 42px monospace';
    ctx.fillText(`#${options.rank}`, m3X + 25, currentY + 95);
    ctx.fillStyle = '#64748B';
    ctx.font = '500 12px "Montserrat", sans-serif';
    ctx.fillText(`of ${options.totalCandidates || options.rank} candidates`, m3X + 25, currentY + 128);
  } else {
    ctx.fillStyle = '#94A3B8';
    ctx.font = 'bold 20px "Montserrat", sans-serif';
    ctx.fillText('Pending Close', m3X + 25, currentY + 80);
    ctx.font = '500 11px "Montserrat", sans-serif';
    ctx.fillText('Available after exam close', m3X + 25, currentY + 115);
  }

  // Metric 4: Award Status
  const m4X = m3X + cardWidth + 15;
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.roundRect(m4X, currentY, cardWidth, cardHeight, 14);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 13px "Montserrat", sans-serif';
  ctx.fillText('HONOR / AWARD', m4X + 25, currentY + 38);

  const awardText = options.awardType === 'FIRST_PLACE'
    ? 'GOLD MEDAL (1ST)'
    : options.awardType === 'SECOND_PLACE'
    ? 'SILVER MEDAL (2ND)'
    : options.awardType === 'THIRD_PLACE'
    ? 'BRONZE MEDAL (3RD)'
    : options.isPassed
    ? 'ACHIEVEMENT PASS'
    : 'PARTICIPATION';

  ctx.fillStyle = options.awardType === 'FIRST_PLACE' ? '#D97706' : options.isPassed ? '#059669' : '#64748B';
  ctx.font = 'bold 18px "Montserrat", sans-serif';
  ctx.fillText(awardText, m4X + 25, currentY + 80);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 11px "Montserrat", sans-serif';
  ctx.fillText(options.isPassed ? 'Official Certificate Granted' : 'Progress Opportunity', m4X + 25, currentY + 115);

  // 6. Question Breakdown & Proctoring Section
  currentY += 195;
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 22px "Cinzel", serif';
  ctx.fillText('3. QUESTION ANALYTICS & PROCTORING INTEGRITY', 80, currentY);

  ctx.strokeStyle = '#E2E8F0';
  ctx.beginPath();
  ctx.moveTo(80, currentY + 12);
  ctx.lineTo(width - 80, currentY + 12);
  ctx.stroke();

  currentY += 40;

  // Analytics Grid: 4 columns
  const statBoxW = (width - 160 - 30) / 4;
  const statBoxH = 100;

  const stats = [
    { label: 'TOTAL QUESTIONS', val: options.totalQuestions, color: '#0F172A', bg: '#F8FAFC' },
    { label: 'CORRECT ANSWERS', val: options.correctCount, color: '#059669', bg: '#ECFDF5' },
    { label: 'INCORRECT ANSWERS', val: options.incorrectCount, color: '#DC2626', bg: '#FEF2F2' },
    { label: 'UNATTEMPTED', val: options.unattemptedCount, color: '#D97706', bg: '#FFFBEB' },
  ];

  stats.forEach((st, idx) => {
    const sX = 80 + idx * (statBoxW + 10);
    ctx.fillStyle = st.bg;
    ctx.beginPath();
    ctx.roundRect(sX, currentY, statBoxW, statBoxH, 12);
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.stroke();

    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 12px "Montserrat", sans-serif';
    ctx.fillText(st.label, sX + 20, currentY + 34);

    ctx.fillStyle = st.color;
    ctx.font = 'bold 32px monospace';
    ctx.fillText(`${st.val}`, sX + 20, currentY + 76);
  });

  // Proctoring Summary Row
  currentY += 125;
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.roundRect(80, currentY, width - 160, 95, 12);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  const strikes = options.strikeCount ?? 0;
  const isTerminated = strikes >= 3;

  ctx.fillStyle = isTerminated ? '#DC2626' : '#059669';
  ctx.beginPath();
  ctx.arc(120, currentY + 48, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 16px "Montserrat", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(isTerminated ? '✕' : '✓', 120, currentY + 54);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 18px "Montserrat", sans-serif';
  ctx.fillText(
    isTerminated ? 'Proctoring Violation: Session Terminated' : 'Proctoring Integrity Clearance: Verified',
    155,
    currentY + 42
  );

  ctx.fillStyle = '#64748B';
  ctx.font = '500 13px "Montserrat", sans-serif';
  ctx.fillText(
    isTerminated
      ? 'Maximum focus lost/tab-switch strikes exceeded (3/3). Assessment finalized under proctored compliance rules.'
      : `Continuous tab-switch and blur detection monitored. Strikes recorded: ${strikes} of 3 allowable violations.`,
    155,
    currentY + 68
  );

  // 7. Verification & Signatures Footer Panel
  currentY += 150;
  ctx.fillStyle = '#0A192F';
  ctx.beginPath();
  ctx.roundRect(80, currentY, width - 160, 260, 16);
  ctx.fill();

  // Draw QR Code
  if (options.qrDataUrl) {
    const qrImg = await loadImage(options.qrDataUrl);
    if (qrImg) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(110, currentY + 30, 200, 200, 12);
      ctx.fill();
      ctx.drawImage(qrImg, 120, currentY + 40, 180, 180);
    }
  }

  // Verification Details Text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 20px "Cinzel", serif';
  ctx.fillText('DIGITAL RECORD VERIFICATION', 340, currentY + 65);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 14px "Montserrat", sans-serif';
  ctx.fillText('Scan the QR code to verify this official examination record on the student portal.', 340, currentY + 98);
  ctx.fillText('Authenticated via KITS-EOS Secure Cryptographic Hash.', 340, currentY + 125);

  ctx.fillStyle = '#F3BA2F';
  ctx.font = 'bold 13px monospace';
  ctx.fillText(`TOKEN REF: ${options.resultReferenceId}`, 340, currentY + 160);

  // Signatory text on right of dark card
  ctx.textAlign = 'right';
  ctx.fillStyle = '#CBD5E1';
  ctx.font = '600 14px "Montserrat", sans-serif';
  ctx.fillText('Controller of Examinations', width - 120, currentY + 165);
  ctx.fillStyle = '#64748B';
  ctx.font = '500 12px "Montserrat", sans-serif';
  ctx.fillText('KITS Akshar Institute of Technology', width - 120, currentY + 190);
  ctx.textAlign = 'left';

  // Bottom Notice
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 12px "Montserrat", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    'This is an official computer-generated score transcript issued by KITS-EOS. No signature required. For verification inquiries: examination@kitsakshar.ac.in',
    width / 2,
    height - 65
  );
  ctx.textAlign = 'left';

  return canvas;
}
