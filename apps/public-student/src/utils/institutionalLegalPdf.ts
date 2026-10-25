/**
 * Institutional Legal Document PDF Generation Engine
 * Generates downloadable, publication-grade PDFs for KITS-AKSHAR-EOS:
 *  1. Privacy Notice & Cookie Policy
 *  2. Terms & Conditions of Service
 *
 * Designed with authentic KITS Akshar Institute of Technology branding,
 * institutional typography, vector layout, running headers, and multi-page pagination.
 */

interface DocumentSection {
  title: string;
  subsections?: { title: string; content: string }[];
  paragraphs?: string[];
  callout?: { title: string; content: string; type?: 'info' | 'warning' | 'notice' };
}

interface LegalDocConfig {
  docTitle: string;
  subtitle: string;
  version: string;
  effectiveDate: string;
  filename: string;
  sections: DocumentSection[];
}

async function loadLogoDataUrl(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  return new Promise((resolve) => {
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
  });
}

export async function generateLegalDocumentPdf(config: LegalDocConfig): Promise<void> {
  const { jsPDF } = await import('jspdf');

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const leftMargin = 18;
  const rightMargin = 18;
  const topMargin = 26;
  const bottomMargin = 22;
  const contentWidth = pageWidth - leftMargin - rightMargin;

  const logoDataUrl = await loadLogoDataUrl();

  let currentY = topMargin;

  const checkPageBreak = (neededHeight: number) => {
    if (currentY + neededHeight > pageHeight - bottomMargin) {
      pdf.addPage();
      currentY = topMargin;
    }
  };

  // ==========================================
  // FIRST PAGE INSTITUTIONAL HEADER
  // ==========================================
  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, 'PNG', leftMargin, currentY, 18, 18, undefined, 'FAST');
    } catch {
      // Fallback without image
    }
  }

  const headerTextX = logoDataUrl ? leftMargin + 22 : leftMargin;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(0, 40, 85); // KITS Navy (#002855)
  pdf.text('KITS AKSHAR INSTITUTE OF TECHNOLOGY', headerTextX, currentY + 5);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(200, 16, 46); // KITS Red (#C8102E)
  pdf.text('KITS-EOS • EVENT OPERATIONS & ASSESSMENT SYSTEM', headerTextX, currentY + 10);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(100, 110, 120);
  pdf.text('Accredited Institutional Operational Framework • Academic Year 2025–2026', headerTextX, currentY + 14.5);

  currentY += 22;

  // Header separator bar
  pdf.setDrawColor(200, 16, 46);
  pdf.setLineWidth(0.8);
  pdf.line(leftMargin, currentY, pageWidth - rightMargin, currentY);

  pdf.setDrawColor(0, 40, 85);
  pdf.setLineWidth(0.3);
  pdf.line(leftMargin, currentY + 1.2, pageWidth - rightMargin, currentY + 1.2);

  currentY += 8;

  // Document Title Banner
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(leftMargin, currentY, contentWidth, 20, 2, 2, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(15, 23, 42);
  pdf.text(config.docTitle, leftMargin + 4, currentY + 7);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text(`${config.subtitle} • Version ${config.version} • Effective: ${config.effectiveDate}`, leftMargin + 4, currentY + 13);

  currentY += 26;

  // Notice about legal approval
  pdf.setFillColor(254, 242, 242);
  pdf.setDrawColor(254, 202, 202);
  pdf.roundedRect(leftMargin, currentY, contentWidth, 12, 1.5, 1.5, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(153, 27, 27);
  pdf.text('INSTITUTIONAL NOTICE & REGULATORY SCOPE:', leftMargin + 3, currentY + 4.5);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  const noticeLines = pdf.splitTextToSize(
    'This document reflects current technical and operational implementations of the KITS-AKSHAR-EOS platform for the 2025–2026 academic year. Formal institutional legal approval remains subject to authorized college authorities.',
    contentWidth - 6
  );
  pdf.text(noticeLines, leftMargin + 3, currentY + 8);

  currentY += 17;

  // ==========================================
  // DOCUMENT SECTIONS
  // ==========================================
  config.sections.forEach((section, sIdx) => {
    // Section Header
    checkPageBreak(14);

    pdf.setFillColor(241, 245, 249);
    pdf.setDrawColor(203, 213, 225);
    pdf.roundedRect(leftMargin, currentY, contentWidth, 7, 1, 1, 'FD');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(0, 40, 85);
    pdf.text(`${sIdx + 1}. ${section.title}`, leftMargin + 3, currentY + 5);

    currentY += 10;

    // Paragraphs
    if (section.paragraphs) {
      section.paragraphs.forEach((pText) => {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(30, 41, 59);
        const lines = pdf.splitTextToSize(pText, contentWidth);
        const needed = lines.length * 3.8 + 2;
        checkPageBreak(needed);
        pdf.text(lines, leftMargin, currentY);
        currentY += needed;
      });
    }

    // Subsections
    if (section.subsections) {
      section.subsections.forEach((sub) => {
        checkPageBreak(12);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.setTextColor(15, 23, 42);
        pdf.text(sub.title, leftMargin + 2, currentY);
        currentY += 4.5;

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.8);
        pdf.setTextColor(51, 65, 85);
        const subLines = pdf.splitTextToSize(sub.content, contentWidth - 4);
        const needed = subLines.length * 3.6 + 3;
        checkPageBreak(needed);
        pdf.text(subLines, leftMargin + 2, currentY);
        currentY += needed;
      });
    }

    // Callout Box
    if (section.callout) {
      const calloutTitle = section.callout.title;
      const calloutText = section.callout.content;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      const calloutLines = pdf.splitTextToSize(calloutText, contentWidth - 8);
      const calloutHeight = calloutLines.length * 3.5 + 9;

      checkPageBreak(calloutHeight + 3);

      if (section.callout.type === 'warning') {
        pdf.setFillColor(254, 242, 242);
        pdf.setDrawColor(252, 165, 165);
        pdf.setTextColor(153, 27, 27);
      } else {
        pdf.setFillColor(239, 246, 255);
        pdf.setDrawColor(191, 219, 254);
        pdf.setTextColor(30, 58, 138);
      }

      pdf.roundedRect(leftMargin, currentY, contentWidth, calloutHeight, 1.5, 1.5, 'FD');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.text(calloutTitle, leftMargin + 4, currentY + 5);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.2);
      pdf.text(calloutLines, leftMargin + 4, currentY + 9);

      currentY += calloutHeight + 4;
    }

    currentY += 3;
  });

  // ==========================================
  // MULTI-PAGE RUNNING HEADERS & FOOTERS
  // ==========================================
  const totalPages = (pdf.internal as any).getNumberOfPages();

  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);

    // Running Header (Pages 2+)
    if (i > 1) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(0, 40, 85);
      pdf.text('KITS AKSHAR INSTITUTE OF TECHNOLOGY • KITS-EOS OFFICIAL DOCUMENTATION', leftMargin, 12);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.5);
      pdf.setTextColor(100, 116, 139);
      pdf.text(config.docTitle, pageWidth - rightMargin, 12, { align: 'right' });

      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.3);
      pdf.line(leftMargin, 14, pageWidth - rightMargin, 14);
    }

    // Running Footer (All Pages)
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);
    pdf.line(leftMargin, pageHeight - 14, pageWidth - rightMargin, pageHeight - 14);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);
    pdf.text(
      'KITS-AKSHAR-EOS v3.0 • Institutional Data Governance & Legal Regulations',
      leftMargin,
      pageHeight - 9
    );

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(71, 85, 105);
    pdf.text(`Page ${i} of ${totalPages}`, pageWidth - rightMargin, pageHeight - 9, { align: 'right' });
  }

  pdf.save(config.filename);
}

/**
 * Downloads the official KITS-AKSHAR-EOS Privacy Notice & Cookie Policy PDF
 */
export async function downloadPrivacyPolicyPdf(): Promise<void> {
  const config: LegalDocConfig = {
    docTitle: 'KITS-AKSHAR-EOS Privacy Notice & Cookie Policy',
    subtitle: 'Institutional Privacy, Data Minimization & Cookie Governance',
    version: '2.0',
    effectiveDate: 'September 2025 (Academic Year 2025–2026)',
    filename: 'KITS_Akshar_EOS_Privacy_Policy_2025-2026.pdf',
    sections: [
      {
        title: 'Governance Framework & Purpose',
        paragraphs: [
          'This Privacy Notice and Cookie Policy governs the processing of personal information within the KITS-EOS (Event Operations System) platform, operated by KITS Akshar Institute of Technology, Guntur. KITS-EOS is purpose-built to administer collegiate fests, technical symposia, competition registrations, contactless venue check-ins, assessment examinations, result publication, and verified digital credentialing.',
          'Our data practices are guided by principles of purpose limitation, data minimization, transparency, and storage security aligned with the Digital Personal Data Protection (DPDP) framework. We collect and process only the minimal personal information strictly necessary for the legitimate administration of campus events.',
        ],
        callout: {
          title: 'Institutional Privacy Commitment',
          content: 'Personal data submitted to KITS-EOS is processed exclusively for institutional event operations, student credentialing, and academic reporting. KITS-EOS does not sell, rent, lease, or monetize student data, and does not share personal data with third-party advertisers or commercial marketing networks.',
          type: 'info',
        },
      },
      {
        title: 'Categories of Personal Data We Process',
        paragraphs: [
          'KITS-EOS collects and maintains only the specific data categories required to deliver campus event operations and verify credentials:',
        ],
        subsections: [
          {
            title: 'A. Student Profile & Academic Identity',
            content: 'Full Legal Name, Official College Roll Number, Academic Department, Year of Study (Years 1–4), College / Host Institution Name, registered Email Address, active 10-digit Indian Mobile Number, and authentication identifiers.',
          },
          {
            title: 'B. Event Registrations & Team Rosters',
            content: 'Records of registered events, categories, and sub-events; participation format (Solo or Team); Team Name; Team Leader identity; teammate rosters (names, roll numbers, departments, years, colleges, and contact numbers); and registration timestamps.',
          },
          {
            title: 'C. Payment Records (UPI & Cash-on-Desk)',
            content: 'Applicable registration fee amount, selected payment mode (UPI or Cash-on-Desk), transaction reference UTR number, uploaded payment proof screenshot, payment status (PENDING, COMPLETED), and coordinator verification timestamp. KITS-EOS does not collect or store credit/debit card numbers, CVVs, or UPI PINs.',
          },
          {
            title: 'D. Attendance & Physical Venue Check-In Data',
            content: 'Registration ID, participant identities, dynamic QR pass tokens, standardized 10-digit manual tokens, physical venue check-in timestamps, and coordinator attendance verification marks. Processed strictly to prevent duplicate entries and establish certificate eligibility.',
          },
          {
            title: 'E. Assessment Participation & Question Review Data',
            content: 'Examination start and submission timestamps, answered question responses, auto-scored marks, speed bonus points, browser violation alerts (e.g., tab switches or proctoring strikes), and post-closing solutions review status. Answer keys and explanations remain confidential until assessment closing time.',
          },
          {
            title: 'F. Digital Certificates & Public Credential Records',
            content: 'System-generated Participation and Merit (1st, 2nd, 3rd Place) certificates containing recipient name, roll number, department, academic year, college, event name, competition track, unique Certificate ID (e.g., KITS-EOS-CERT-XXXXXXXXXX), issue date, and institutional signatory names.',
          },
          {
            title: 'G. Participant-Uploaded Documents',
            content: 'Competition project submissions, presentation slide decks (PPT/PDF), source code archives (ZIP), and payment proof image screenshots uploaded directly by students into institutional cloud storage.',
          },
        ],
      },
      {
        title: 'Lawful Basis & Institutional Purpose of Processing',
        paragraphs: [
          'Under applicable data governance principles, personal data within KITS-EOS is processed under lawful bases:',
          '1. Legitimate Institutional Interest: Delivering educational competitions, managing campus events, verifying student eligibility, recording event attendance, and preserving institutional academic records.',
          '2. Consent of the Data Principal: Explicit consent provided by students upon account registration and voluntary participation in specific events or assessments.',
          '3. Academic Credential Verification: Generating tamper-evident certificates with verifiable credential codes for career, resume, and higher-education verification.',
        ],
      },
      {
        title: 'Data Sharing & Third-Party Architecture',
        paragraphs: [
          'Personal data is never distributed to third-party commercial vendors. Technical data hosting is restricted to:',
          '• Database and Storage Infrastructure: Supabase backend hosting with Row Level Security (RLS) policies enforcing role-based isolation between students, coordinators, and administrators.',
          '• Web Hosting & Content Delivery: Firebase Hosting providing fast, SSL-encrypted global distribution of web applications and static assets.',
          '• Public Credential Verification: Public certificate verification endpoints display only non-sensitive certificate details (recipient name, event title, college, issue date) to confirm authentic issuance.',
        ],
      },
      {
        title: 'Security Measures & Storage Integrity',
        paragraphs: [
          'KITS-EOS implements defense-in-depth security practices:',
          '• End-to-End Transport Security: All client-server traffic is strictly encrypted using modern Transport Layer Security (TLS/HTTPS).',
          '• Row Level Security (RLS): Database-level policies ensure students can only view or modify their own authorized records, while coordinators access only their assigned events.',
          '• Role-Based Access Control (RBAC): Strict segregation among Students, Event Coordinators, Assessment Coordinators, Payment Managers, and System Administrators.',
          '• Audit Logs: Administrative actions, result declarations, and certificate issuances are immutably logged with timestamps.',
        ],
      },
      {
        title: 'Cookie & Local Storage Governance',
        paragraphs: [
          'KITS-EOS uses minimal cookies and browser storage solely for operational security and user preferences:',
          '• Strictly Necessary Tokens: Authentication session tokens in local storage, coordinator session markers in session storage, CSRF protection, and static asset caching via the KITS-EOS Service Worker.',
          '• Functional Preferences: Optional local form auto-save drafts (useFormDraft) and client UI view states. Disabling functional preferences halts optional local drafts without affecting active login sessions.',
          '• Operational Diagnostics: Consent-governed client-side error and responsiveness diagnostics. KITS-EOS employs zero advertising pixels, commercial trackers, or marketing scripts.',
        ],
      },
      {
        title: 'Student Data Rights & Privacy Contacts',
        paragraphs: [
          'Students have the right to review their stored profile, verify event registration histories, view attendance marks, and access issued certificates at any time through the Student Portal.',
          'For data privacy inquiries, corrections, or grievance submissions, contact the KITS-EOS Data Governance Desk at KITS Akshar Institute of Technology, Guntur. Inquiries will be reviewed by the institutional coordinator committee.',
        ],
      },
    ],
  };

  await generateLegalDocumentPdf(config);
}

/**
 * Downloads the official KITS-AKSHAR-EOS Terms & Conditions of Service PDF
 */
export async function downloadTermsAndConditionsPdf(): Promise<void> {
  const config: LegalDocConfig = {
    docTitle: 'KITS-AKSHAR-EOS Terms & Conditions of Service',
    subtitle: 'Institutional Regulations, Competition Rules & Acceptable Use Policy',
    version: '2.0',
    effectiveDate: 'September 2025 (Academic Year 2025–2026)',
    filename: 'KITS_Akshar_EOS_Terms_and_Conditions_2025-2026.pdf',
    sections: [
      {
        title: 'Acceptance of Institutional Terms',
        paragraphs: [
          'By accessing, registering an account on, or participating in activities hosted on KITS-EOS (Event Operations System), you acknowledge that you have read, understood, and agreed to be bound by these Terms & Conditions, the KITS-EOS Privacy Notice & Cookie Policy, and all specific operational guidelines published for individual campus events, technical symposia, and academic competitions.',
          'If you do not agree to these terms, you must refrain from registering for events or utilizing the KITS-EOS platform. In the event of an operational conflict between departmental competition instructions and these institutional terms, official institutional regulations prevail.',
        ],
      },
      {
        title: 'Student Eligibility & Account Authenticity',
        paragraphs: [
          'Students registering on KITS-EOS must provide true, complete, and verifiable academic information, including Full Legal Name, Official College Roll Number, Academic Department, Year of Study (Years 1–4), College / Host Institution Name, and an active Indian Mobile Number.',
        ],
        callout: {
          title: 'Strict Prohibition on Impersonation & Duplicate Accounts',
          content: 'Each student roll number is unique within KITS-EOS to preserve academic identity. Impersonation, registering with fraudulent or borrowed roll numbers, creating duplicate accounts, or falsifying departmental affiliation is strictly prohibited. Violations result in immediate account suspension, competition disqualification, and referral to the college disciplinary committee.',
          type: 'warning',
        },
      },
      {
        title: 'Account Credentials & Security',
        paragraphs: [
          'Students are responsible for maintaining the confidentiality of their portal login credentials and for all activities conducted under their account. Sharing passwords, transferring account credentials, or allowing unauthorized third parties to register on your behalf is strictly prohibited.',
          'Self-service password recovery is available via the Student Login page. Never share one-time reset links or account recovery tokens with any person.',
        ],
      },
      {
        title: 'Event Registration & Team Participation Rules',
        paragraphs: [
          'Registration for events constitutes a firm commitment to participate. The following guidelines govern all competitions:',
          '• Solo Registrations: Individual registrations are strictly non-transferable to other students.',
          '• Team Registrations: Team leaders are responsible for entering accurate roll numbers and contact details for all team members. All team members must be enrolled students in good standing.',
          '• Multiple Event Clashes: Students are responsible for verifying schedule compatibility when registering for multiple competitions occurring simultaneously.',
        ],
      },
      {
        title: 'Fee Payments, Verification & Refund Policy',
        paragraphs: [
          'For events requiring registration fees:',
          '• Payment Options: Students may submit payment via UPI reference (UTR entry + screenshot upload) or in person via Cash-on-Desk at designated registration counters.',
          '• Verification Requirement: Registrations remain in PENDING status until an authorized event coordinator verifies transaction authenticity.',
          '• Non-Refundable Nature: Event registration fees collected for fests, symposia, and competitions are strictly non-refundable once approved, as funds are committed to event logistics and participant kits.',
        ],
      },
      {
        title: 'QR Pass & Physical Venue Attendance Rules',
        paragraphs: [
          '• Dynamic Attendance Pass: Each registration generates an attendance pass with a secure QR code and a 10-digit manual entry token.',
          '• Venue Verification: Students must present their digital QR pass and physical college ID card at event registration desks. Duplicate scans or forged tokens are blocked by the system.',
          '• Certificate Eligibility: Only participants who have completed physical attendance verification with an authorized coordinator are eligible for Participation and Merit certificates.',
        ],
      },
      {
        title: 'Assessment Platform Rules & Proctoring Standards',
        paragraphs: [
          'For technical assessments, quizzes, and online examinations administered through KITS-EOS:',
          '• Single Authorized Attempt: Candidates receive exactly one attempt per assessment unless an administrator explicitly resets the attempt due to verified technical interruption.',
          '• Proctoring & Focus Monitoring: Fullscreen enforcement and tab-switch monitoring are active during exams. Exceeding proctoring strike thresholds triggers automatic test termination.',
          '• Answer Key & Explanation Confidentiality: Authoritative answer keys and question explanations remain strictly confidential during active testing and are released only after the configured assessment closing time.',
        ],
      },
      {
        title: 'Intellectual Property & Document Submissions',
        paragraphs: [
          'Participants retain intellectual property rights to original project submissions, code repositories, presentation slides, and technical writeups uploaded to KITS-EOS.',
          'By uploading materials, participants grant KITS Akshar Institute of Technology a non-exclusive, royalty-free license to review, evaluate, score, and archive submissions for academic evaluation and exhibition purposes.',
        ],
      },
      {
        title: 'Disciplinary Violations & Sanctions',
        paragraphs: [
          'The following actions constitute severe institutional violations: attempt manipulation, cheating or external assistance during assessments, submitting fraudulent payment screenshots, abusing system APIs, or harassing coordinators.',
          'Sanctions include immediate forfeiture of entry fees, nullification of test scores, revocation of certificates, platform ban, and reporting to the College Academic Disciplinary Council.',
        ],
      },
      {
        title: 'Limitation of Liability & Institutional Disclaimers',
        paragraphs: [
          'KITS-EOS is provided on an institutional "as is" and "as available" basis. While college administrators strive for 99.9% uptime during fests, the institution is not liable for external network outages, third-party UPI bank delays, or personal device malfunctions.',
          'All competition podium standings, prize declarations, and certificate issuances finalized by faculty coordinators and department heads are authoritative and final.',
        ],
      },
    ],
  };

  await generateLegalDocumentPdf(config);
}
