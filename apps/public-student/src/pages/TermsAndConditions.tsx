import { Link } from 'react-router-dom';
import { 
  FileText, 
  ArrowLeft,
  ShieldAlert,
  Award,
  CreditCard,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  Scale,
  UserX,
  KeyRound,
  MessageSquare,
  HardDrive,
  Users
} from 'lucide-react';

export function TermsAndConditions() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-16 font-sans">
      {/* Header Banner */}
      <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-10 shadow-2xs space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-black bg-gray-100 text-gray-800 border border-gray-200">
          <FileText className="h-3.5 w-3.5 text-kits-red" />
          <span>Institutional Regulations & Terms of Service</span>
        </div>
        <h1 className="text-2xl sm:text-4xl font-black text-gray-900 tracking-tight">
          Terms & <span className="text-kits-red">Conditions</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-gray-500 font-medium">
          <span className="font-semibold text-gray-700">KITS Akshar Institute of Technology</span>
          <span>•</span>
          <span>KITS-EOS v3.0</span>
          <span>•</span>
          <span className="font-mono font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded">Version 2.0</span>
          <span>•</span>
          <span>Effective: Academic Year 2025–2026 (Updated: September 2025)</span>
        </div>
      </div>

      {/* Content Card */}
      <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-10 shadow-2xs space-y-10 text-xs sm:text-sm text-gray-700 leading-relaxed">
        
        {/* Section 1: Acceptance */}
        <section className="space-y-3">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">1</span>
            <span>Acceptance of Institutional Terms</span>
          </h2>
          <p>
            By accessing, creating an account on, or using the KITS-EOS (Event Operations System) platform, you acknowledge that you have read, understood, and agreed to be bound by these Terms & Conditions, the KITS-EOS Privacy Notice & Cookie Policy, and all specific operational guidelines published for individual campus events, symposia, and competitions.
          </p>
          <p>
            If you do not agree to these terms, you must refrain from registering for events or using the KITS-EOS platform. Specific competition rules established by organizing departments may supplement or govern particular event tracks; in the event of an operational conflict, official institutional rules prevail.
          </p>
        </section>

        {/* Section 2: Student Account Authenticity */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">2</span>
            <span>Student Eligibility & Account Authenticity</span>
          </h2>
          <p>
            Students registering on KITS-EOS must provide true, complete, and verifiable institutional information, including Full Legal Name, Official College Roll Number, Academic Department, Year of Study (Years 1–4), College / Host Institution Name, and an active 10-digit Indian Mobile Number.
          </p>
          <div className="p-3.5 rounded-2xl bg-red-50/70 border border-red-200 text-red-950 font-medium text-xs space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-red-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Strict Prohibition on Misrepresentation & Duplicate Accounts</span>
            </div>
            <p className="leading-normal">
              Each student roll number is unique within KITS-EOS to preserve academic identity. Impersonation, registering with fraudulent or borrowed roll numbers, creating duplicate accounts, or falsifying departmental affiliation is strictly prohibited. Violations will result in immediate account suspension, competition disqualification, and referral to the college disciplinary committee.
            </p>
          </div>
        </section>

        {/* Section 3: Account Credentials & Password Recovery */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">3</span>
            <span className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-kits-blue" />
              <span>Account Credentials & Password Recovery</span>
            </span>
          </h2>
          <p>
            Students are responsible for maintaining the confidentiality of their portal login credentials and for all activities conducted under their account. Sharing passwords, transferring account credentials, or allowing unauthorized third parties to register on your behalf is strictly prohibited.
          </p>
          <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 space-y-2 text-xs">
            <div className="font-bold text-gray-900 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-kits-blue" />
              <span>Self-Service Password Recovery Workflow</span>
            </div>
            <p className="text-gray-600 leading-normal">
              If you forget your password, you can initiate self-service recovery via the Student Login page by clicking [ Forgot Password? ]. After submitting your registered email address, you will receive an official password-recovery email containing a secure reset link. Opening this link allows you to create a new password (minimum 6 characters) and resume portal access.
            </p>
            <p className="text-gray-500 text-[11px] leading-normal">
              Notice: Self-service recovery is available for Student accounts. Successful email delivery depends on standard external network routing and valid mailbox status. Never share your recovery link with anyone.
            </p>
          </div>
        </section>

        {/* Section 4: Event Registration & Capacity Limits */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">4</span>
            <span>Event Registration, Deadlines & Capacity</span>
          </h2>
          <p>
            Sub-event registrations are subject to published eligibility requirements, track categories, and registration deadlines.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 text-xs sm:text-sm">
            <li><strong>Registration Deadlines:</strong> Sub-events close automatically once the official deadline has passed. Registrations cannot be submitted after the deadline.</li>
            <li><strong>Event Capacity Limits:</strong> Competitions with defined participant or team capacity will automatically close when full. KITS-EOS does not guarantee entry once maximum threshold limits are reached.</li>
            <li><strong>Multiple Tracks:</strong> Students may register for multiple non-conflicting sub-events across categories, provided they satisfy each competition's rules and scheduling constraints.</li>
          </ul>
        </section>

        {/* Section 5: Team Registration Responsibilities */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">5</span>
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4 text-kits-blue" />
              <span>Team Registrations & Team Leader Responsibilities</span>
            </span>
          </h2>
          <p>
            For team competitions (e.g., Hackathons, Paper Presentations, Robotics, Group Cultural Tracks):
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 text-xs sm:text-sm">
            <li><strong>Team Leader Authority:</strong> The registering student serves as Team Leader and must obtain explicit consent from all team members prior to submitting their academic information.</li>
            <li><strong>Member Eligibility:</strong> All teammates must meet the eligibility criteria (department, year, college) defined for the competition track.</li>
            <li><strong>Team Size Thresholds:</strong> Teams must strictly comply with the minimum and maximum member counts configured for each sub-event.</li>
            <li><strong>No Duplicate Roster Entries:</strong> The same student roll number cannot be registered across multiple competing teams in the exact same sub-event track.</li>
          </ul>
        </section>

        {/* Section 6: Registration Fees & Payment Terms */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">6</span>
            <span className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-kits-blue" />
              <span>Registration Fees & Payment Modes</span>
            </span>
          </h2>
          <p>
            Where a registration fee applies to a competition, KITS-EOS supports two operational payment modes:
          </p>
          <div className="space-y-2.5">
            <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 text-xs space-y-1.5">
              <div className="font-bold text-gray-900 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-kits-blue" />
                <span>UPI Payment Workflow</span>
              </div>
              <p className="text-gray-600 leading-normal">
                Participants complete payment using the official event UPI QR code via their chosen UPI app, submit the 12-digit UTR transaction reference number, and upload an image of the payment confirmation screenshot. Submissions are verified before pass validation.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 text-xs space-y-1.5">
              <div className="font-bold text-gray-900 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-kits-blue" />
                <span>Cash-on-Desk (COD) Workflow</span>
              </div>
              <p className="text-gray-600 leading-normal">
                Participants selecting Cash-on-Desk register their intent online and pay the registration fee in person at the designated on-campus payment desk. An authorized coordinator or payment manager records payment confirmation in the portal to unlock the verified digital event pass.
              </p>
            </div>
          </div>
          <p className="text-gray-600 text-xs sm:text-sm pt-1">
            <strong>Strict Non-Refundable Policy:</strong> Registration fees are non-refundable once confirmed, except in the rare circumstance of official cancellation of the entire event by institutional authorities.
          </p>
        </section>

        {/* Section 7: Attendance & Mandatory Check-In Rule */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">7</span>
            <span className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-emerald-600" />
              <span>Physical Attendance, QR Passes & Proxy Prohibition</span>
            </span>
          </h2>
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 font-medium space-y-1.5">
            <div className="flex items-center gap-2 font-black text-xs sm:text-sm text-amber-900">
              <CheckCircle2 className="h-4 w-4 text-amber-700 shrink-0" />
              <span>Mandatory Physical Attendance Requirement</span>
            </div>
            <p className="text-xs text-amber-900 leading-relaxed">
              Certificate eligibility (both Participation and Merit/Achievement certificates) is strictly conditional on confirmed physical venue attendance verified by an authorized coordinator. 
              <strong> Registered students or teams without a verified attendance stamp recorded by an event coordinator will not receive participation or achievement certificates.</strong>
            </p>
          </div>
          <p className="text-gray-600 text-xs sm:text-sm">
            Each registered participant receives a personalized dynamic QR pass and a standardized 10-digit manual token (e.g., <code className="font-mono text-gray-800">KITS-EOS-XXX-XXXXXXXXXX</code>). Passes are personal and non-transferable. Attempting proxy check-ins, sharing passes with non-registered individuals, or forging attendance stamps will result in immediate disqualification and disciplinary action.
          </p>
        </section>

        {/* Section 8: Feedback Requirement & Digital Certificates */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">8</span>
            <span className="flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-600" />
              <span>Post-Event Feedback & Certificate Issuance</span>
            </span>
          </h2>
          <p>
            KITS-EOS upholds high institutional standards for credential generation:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 text-xs sm:text-sm">
            <li><strong>Feedback-Gated Participation Certificates:</strong> To unlock a participation certificate, an attendee must complete brief event feedback under [ Feedback ] (/feedback) in addition to having an official attendance stamp.</li>
            <li><strong>Achievement Certificates:</strong> Merit awards (1st, 2nd, 3rd Place) are unlocked solely upon official result publication by faculty evaluators.</li>
            <li><strong>Public Verification:</strong> All certificates bear an official Certificate ID (<code className="font-mono text-gray-800">KITS-EOS-CERT-XXXXXXXXXX</code>) verifiable publicly through <code>/verify-certificate</code> without requiring login.</li>
            <li><strong>Revocation Authority:</strong> The institution reserves the right to revoke any issued certificate if post-event review reveals academic dishonesty, plagiarism, cheating, or fraudulent credentials.</li>
          </ul>
        </section>

        {/* Section 9: Document Uploads & Content Standards */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">9</span>
            <span className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-blue-600" />
              <span>Document Uploads & Content Standards</span>
            </span>
          </h2>
          <p>
            Where a competition requires document submissions (e.g., project abstracts, presentation slides, code documentation):
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 text-xs sm:text-sm">
            <li>Submissions must not exceed the system file size limit of <strong>20 MB</strong> per document.</li>
            <li>Files must be in accepted formats (PDF, PPT, PPTX, DOC, DOCX, ZIP, or standard images).</li>
            <li>Uploaded documents must be original academic work. Submitting plagiarized content, malicious files, executable scripts, or offensive material is strictly prohibited.</li>
            <li>Documents are stored in secure access-controlled storage accessible only to assigned evaluators and event coordinators.</li>
          </ul>
        </section>

        {/* Section 10: Grievance Redressal & Complaints */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">10</span>
            <span className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-kits-blue" />
              <span>Student Grievance Redressal & Complaints</span>
            </span>
          </h2>
          <p>
            Students encountering operational disputes, attendance discrepancies, or technical issues may submit a formal complaint ticket through the portal under [ Help & Grievances ] (/complaints).
          </p>
          <p>
            Tickets are categorized, assigned to event coordinators or platform administrators, and tracked through formal status stages (<code className="font-mono text-gray-800">PENDING</code>, <code className="font-mono text-kits-blue">IN_REVIEW</code>, <code className="font-mono text-emerald-800">RESOLVED</code>). Administrative responses are visible directly in your portal.
          </p>
        </section>

        {/* Section 11: Prohibited Conduct */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">11</span>
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-600" />
              <span>Prohibited Platform Conduct</span>
            </span>
          </h2>
          <p>Users shall not:</p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 text-xs sm:text-sm">
            <li>Attempt unauthorized access to administrator, coordinator, or payment management dashboards.</li>
            <li>Bypass or attempt to circumvent system access controls, security headers, or rate limits.</li>
            <li>Scrape participant rosters, student contact directories, or internal event records.</li>
            <li>Submit fraudulent transaction reference IDs (UTRs) or forged payment screenshots.</li>
            <li>Upload malicious software, scripts, or corrupted files through upload interfaces.</li>
            <li>Interfere with or disrupt the normal operation of event servers or network infrastructure.</li>
          </ul>
        </section>

        {/* Section 12: Account Suspension & Voluntary Deactivation */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">12</span>
            <span className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-red-600" />
              <span>Account Suspension & Voluntary Deactivation</span>
            </span>
          </h2>
          <p>
            <strong>Administrative Suspension:</strong> The administration reserves the right to suspend any account found in violation of platform rules, academic ethics, or campus conduct guidelines. Suspended students may submit an unsuspension appeal through the portal for review by authorized institutional authorities.
          </p>
          <p>
            <strong>Voluntary Deactivation:</strong> Students can voluntarily deactivate their accounts from their Profile. Deactivated accounts have a <strong>15-day reactivation grace period</strong>, during which signing back in restores active status.
          </p>
        </section>

        {/* Section 13: Institutional Authority & Disclaimers */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">13</span>
            <span className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-gray-800" />
              <span>Institutional Authority & Platform Disclaimers</span>
            </span>
          </h2>
          <p>
            KITS-EOS is developed and operated under the institutional authority of KITS Akshar Institute of Technology. The event organizing committee and college administration reserve the right to:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 text-xs sm:text-sm">
            <li>Adjust event schedules, competition venues, judging rubrics, or team sizes when operationally necessary.</li>
            <li>Disqualify any participant or team found in violation of competition rules or institutional conduct policies.</li>
            <li>Render final and binding evaluations regarding competition scores, rankings, and prize determinations.</li>
          </ul>
          <p className="text-gray-500 text-xs pt-1">
            <strong>Platform Availability:</strong> KITS-EOS is provided for campus event operations on an "as-is" and "as-available" basis. While we strive for high reliability and operational uptime, access depends on campus connectivity and cloud services; uninterrupted or error-free operation is not guaranteed.
          </p>
        </section>

        {/* Footer Navigation */}
        <div className="pt-6 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Link to="/privacy" className="text-xs font-bold text-kits-blue hover:underline">
            Read our Privacy Notice & Cookie Policy →
          </Link>
          <Link to="/" className="text-xs font-bold text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" />
            <span>Return to Home</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
