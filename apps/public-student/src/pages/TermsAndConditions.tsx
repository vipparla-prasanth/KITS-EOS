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
  UserX
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
            By accessing or using the KITS-EOS (Event Operations System) platform, you acknowledge that you have read, understood, and agreed to be bound by these Terms & Conditions, the KITS-EOS Privacy Notice, and all specific guidelines published for individual campus events, fests, and competitions.
          </p>
          <p>
            If you do not agree to these terms, you must refrain from registering for events or using the KITS-EOS platform.
          </p>
        </section>

        {/* Section 2: Student Account Authenticity */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">2</span>
            <span>Student Eligibility & Account Authenticity</span>
          </h2>
          <p>
            Students registering on KITS-EOS must provide true, complete, and accurate institutional information, including Full Legal Name, Official College Roll Number, Academic Department, Year of Study, College / Institution Name, and an active 10-digit Indian Mobile Number.
          </p>
          <div className="p-3.5 rounded-2xl bg-red-50/70 border border-red-200 text-red-950 font-medium text-xs space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-red-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Strict Prohibition on Misrepresentation</span>
            </div>
            <p className="leading-normal">
              Impersonation, creating accounts with fraudulent or borrowed roll numbers, registering multiple accounts, or misrepresenting institutional affiliation is strictly prohibited. Violations will result in immediate account suspension, event disqualification, and referral to the college disciplinary committee.
            </p>
          </div>
        </section>

        {/* Section 3: Event Registration & Team Formation */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">3</span>
            <span>Event Registrations & Team Responsibilities</span>
          </h2>
          <p>
            Sub-event registrations are subject to published eligibility criteria, category limits, track requirements, and registration deadlines. For team competitions:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 text-xs sm:text-sm">
            <li>The registering Team Leader is responsible for obtaining explicit consent from all team members prior to submitting their details.</li>
            <li>All team members must satisfy the eligibility criteria of the chosen competition track.</li>
            <li>Duplicate registration of the same student roll number across competing teams in the same sub-event track is prohibited.</li>
            <li>Teams must comply with the minimum and maximum member thresholds specified for each sub-event.</li>
          </ul>
        </section>

        {/* Section 4: Registration Fees & Payment Terms */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">4</span>
            <span className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-kits-blue" />
              <span>Registration Fees & Payment Verification</span>
            </span>
          </h2>
          <p>
            Where a registration fee applies to a competition, KITS-EOS supports two operational payment modes:
          </p>
          <div className="space-y-2.5">
            <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 text-xs space-y-1.5">
              <div className="font-bold text-gray-900 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-kits-blue" />
                <span>Demo UPI Payment Workflow</span>
              </div>
              <p className="text-gray-600 leading-normal">
                KITS-EOS includes a demonstration UPI payment flow clearly marked as <strong>"DEMO PAYMENT • NO REAL MONEY WAS CHARGED"</strong>. This workflow is provided for operational simulation and user testing. KITS-EOS does not charge bank accounts, does not store payment card credentials, and is not a financial intermediary.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 text-xs space-y-1.5">
              <div className="font-bold text-gray-900 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-kits-blue" />
                <span>Cash-on-Desk (COD) Payment Workflow</span>
              </div>
              <p className="text-gray-600 leading-normal">
                Participants selecting Cash-on-Desk must complete payment in person at the designated on-campus registration desk. An authorized coordinator or payment manager will confirm the payment in the system to unlock the participant's verified digital event pass.
              </p>
            </div>
          </div>
          <p className="text-gray-600 text-xs sm:text-sm pt-1">
            <strong>Non-Refundable Policy:</strong> Event registration fees are strictly non-refundable once confirmed, except in the rare event of official competition cancellation by the institution.
          </p>
        </section>

        {/* Section 5: Attendance & Mandatory Check-In Rule */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">5</span>
            <span className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-emerald-600" />
              <span>Physical Attendance & Certificate Eligibility Rule</span>
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
            Each registered participant receives a personalized QR pass and 10-digit manual token. Passes are non-transferable. Attempting proxy check-ins, sharing passes with non-registered persons, or tampering with attendance tokens will result in immediate disqualification.
          </p>
        </section>

        {/* Section 6: Digital Certificates & Verification */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">6</span>
            <span className="flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-600" />
              <span>Digital Certificates & Credential Integrity</span>
            </span>
          </h2>
          <p>
            Participation certificates are generated based on verified attendance records. Achievement certificates (Winner, Runner, Third Place) are unlocked following the official publication of competition results by event faculty and coordinators.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 text-xs sm:text-sm">
            <li>All generated certificates bear an official Certificate ID (<code className="font-mono text-gray-800">KITS-EOS-CERT-XXXXXXXXXX</code>) verifiable publicly through <code>/verify/:certId</code>.</li>
            <li>Certificates must not be altered, modified, or forged in any format.</li>
            <li>The institution reserves the right to revoke any certificate if post-event evaluation discovers academic dishonesty, cheating, rule violations, or fraudulent attendance records.</li>
          </ul>
        </section>

        {/* Section 7: Account Suspension & Deactivation */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">7</span>
            <span className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-red-600" />
              <span>Account Suspension & Voluntary Deactivation</span>
            </span>
          </h2>
          <p>
            <strong>Administrative Suspension:</strong> The administration reserves the right to suspend any student or coordinator account found violating platform terms, engaging in unauthorized access, or disrupting campus events. Suspended students may submit an unsuspension appeal through the portal for formal administrative review.
          </p>
          <p>
            <strong>Voluntary Deactivation:</strong> Students can voluntarily deactivate their accounts from their Profile. Deactivated accounts have a 15-day reactivation grace period during which logging in restores the account.
          </p>
        </section>

        {/* Section 8: Prohibited Conduct */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">8</span>
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-600" />
              <span>Prohibited Platform Conduct</span>
            </span>
          </h2>
          <p>Users shall not:</p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 text-xs sm:text-sm">
            <li>Attempt unauthorized access to administrator, coordinator, or payment management dashboards.</li>
            <li>Bypass or attempt to circumvent security controls, database access policies, or API rate limits.</li>
            <li>Scrape participant rosters, contact details, or internal event directories.</li>
            <li>Submit fraudulent transaction reference IDs or fake payment verifications.</li>
            <li>Upload malicious scripts, viruses, or inappropriate content through document upload channels.</li>
            <li>Interfere with or disrupt the normal operation of event servers or client applications.</li>
          </ul>
        </section>

        {/* Section 9: Institutional Authority & Intellectual Property */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-red-50 text-kits-red flex items-center justify-center text-xs font-bold shrink-0">9</span>
            <span className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-gray-800" />
              <span>Institutional Authority & Disclaimers</span>
            </span>
          </h2>
          <p>
            KITS-EOS is developed and maintained under the authority of KITS Akshar Institute of Technology. The event organizing committee and college administration reserve the right to:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 text-xs sm:text-sm">
            <li>Adjust event schedules, venues, competition criteria, or team sizes when operationally necessary.</li>
            <li>Disqualify any team or participant found in violation of competition rules or institutional conduct standards.</li>
            <li>Make final and binding evaluations regarding competition rankings and award determinations.</li>
          </ul>
          <p className="text-gray-500 text-xs pt-1">
            <strong>System Availability:</strong> KITS-EOS is provided for campus event operations on an "as-is" basis. While we strive for high availability, system access depends on local network connectivity and cloud services; uninterrupted operation is not guaranteed.
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
