import { Link } from 'react-router-dom';
import { 
  ShieldCheck, 
  FileText, 
  ArrowLeft,
  Lock,
  Cookie,
  Mail,
  Phone,
  MapPin,
  Globe,
  Award,
  CreditCard,
  UserCheck,
  UserX,
  ShieldAlert,
  HardDrive,
  Users,
  CheckCircle2,
  Server
} from 'lucide-react';
import { openCookiePreferencesModal } from '@kits-eos/shared';

export function PrivacyPolicy() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-16 font-sans">
      {/* Header Banner */}
      <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-10 shadow-2xs space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-black bg-blue-50 text-kits-blue border border-blue-100">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Institutional Privacy & Data Governance</span>
        </div>
        <h1 className="text-2xl sm:text-4xl font-black text-gray-900 tracking-tight">
          Privacy Notice <span className="text-kits-blue">& Cookie Policy</span>
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

      {/* Main Policy Content Card */}
      <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-10 shadow-2xs space-y-10 text-xs sm:text-sm text-gray-700 leading-relaxed">
        
        {/* Section 1: Governance Framework & Purpose */}
        <section className="space-y-3">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-blue-50 text-kits-blue flex items-center justify-center text-xs font-bold shrink-0">1</span>
            <span>Governance Framework & Purpose</span>
          </h2>
          <p>
            This Privacy Notice and Cookie Policy governs the processing of personal information within the KITS-EOS (Event Operations System) platform, operated by KITS Akshar Institute of Technology, Guntur. KITS-EOS is purpose-built to administer collegiate fests, technical symposia, competition registrations, contactless venue check-ins, result management, and verified digital credentialing.
          </p>
          <p>
            Our data practices are guided by principles of purpose limitation, data minimization, transparency, and storage security aligned with the <strong>Digital Personal Data Protection (DPDP) framework</strong>. We collect and process only the minimal personal information strictly necessary for the legitimate administration of campus events.
          </p>
          <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-100 text-xs text-blue-950 space-y-1">
            <div className="font-black flex items-center gap-1.5 text-kits-blue">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Institutional Guarantee</span>
            </div>
            <p className="leading-normal">
              Personal data submitted to KITS-EOS is processed exclusively for institutional event operations, student credentialing, and academic reporting. <strong>KITS-EOS never sells, rents, leases, or monetizes student data, and never shares personal data with third-party advertisers or commercial marketing networks.</strong>
            </p>
          </div>
        </section>

        {/* Section 2: Data We Process */}
        <section className="space-y-4">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-blue-50 text-kits-blue flex items-center justify-center text-xs font-bold shrink-0">2</span>
            <span>Categories of Personal Data We Process</span>
          </h2>
          <p>
            KITS-EOS collects and maintains only the data categories required to deliver event operations and verify credentials:
          </p>

          <div className="space-y-3">
            {/* 2.1 Student Account Information */}
            <div className="p-4 rounded-2xl bg-gray-50/80 border border-gray-200/80 space-y-1.5">
              <h3 className="font-bold text-gray-900 text-xs sm:text-sm flex items-center gap-2">
                <Users className="h-4 w-4 text-kits-blue" />
                <span>A. Student & Account Profile Information</span>
              </h3>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                When you create or update an account, we process your Full Legal Name, Official College Roll Number, Academic Department, Year of Study (Years 1–4), College / Host Institution Name, registered Email Address, active 10-digit Indian Mobile Number, and account authentication identifiers.
              </p>
            </div>

            {/* 2.2 Event Registrations & Team Information */}
            <div className="p-4 rounded-2xl bg-gray-50/80 border border-gray-200/80 space-y-1.5">
              <h3 className="font-bold text-gray-900 text-xs sm:text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-600" />
                <span>B. Event Registrations & Team Rosters</span>
              </h3>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                Records of events, competition tracks, and sub-events you register for; participation format (solo vs team); Team Name; Team Leader identity; teammate rosters (names, roll numbers, departments, years, and colleges); and registration timestamps.
              </p>
            </div>

            {/* 2.3 Payments & Financial Workflow */}
            <div className="p-4 rounded-2xl bg-gray-50/80 border border-gray-200/80 space-y-1.5">
              <h3 className="font-bold text-gray-900 text-xs sm:text-sm flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-amber-600" />
                <span>C. Payment & Accounting Records (Demo UPI & Cash-on-Desk)</span>
              </h3>
              <div className="text-[11px] sm:text-xs text-gray-600 space-y-1.5 leading-normal">
                <p>
                  KITS-EOS records the applicable event registration fee amount, payment mode, payment status (<code className="font-mono text-gray-800">PENDING</code>, <code className="font-mono text-emerald-800">COMPLETED</code>), and reconciliation timestamp.
                </p>
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-semibold text-[11px]">
                  DEMO PAYMENT DISCLOSURE: KITS-EOS provides a demonstration UPI workflow clearly marked as <em>"DEMO PAYMENT • NO REAL MONEY WAS CHARGED"</em>. KITS-EOS is NOT a payment gateway or banking institution. KITS-EOS does NOT process real financial transactions through this demo flow and does NOT collect or store debit/credit card numbers, CVVs, bank passwords, or UPI PINs. Manual Cash-on-Desk (COD) payments are recorded directly at designated on-campus payment desks by authorized staff.
                </div>
              </div>
            </div>

            {/* 2.4 Attendance & Check-In */}
            <div className="p-4 rounded-2xl bg-gray-50/80 border border-gray-200/80 space-y-1.5">
              <h3 className="font-bold text-gray-900 text-xs sm:text-sm flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-purple-600" />
                <span>D. Attendance, QR Verification & Check-In Data</span>
              </h3>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                Registration ID, participant identities, dynamic QR pass tokens, 10-digit manual attendance tokens, physical venue check-in timestamps, and coordinator attendance verification marks. This data is processed strictly to confirm physical presence, prevent duplicate admissions, and establish certificate eligibility.
              </p>
            </div>

            {/* 2.5 Digital Certificates */}
            <div className="p-4 rounded-2xl bg-gray-50/80 border border-gray-200/80 space-y-1.5">
              <h3 className="font-bold text-gray-900 text-xs sm:text-sm flex items-center gap-2">
                <Award className="h-4 w-4 text-kits-red" />
                <span>E. Digital Certificates & Public Credential Records</span>
              </h3>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                System-generated Participation and Achievement (Winner, Runner, Third Place) certificates containing recipient name, roll number, department, academic year, college, event name, competition track, unique Certificate ID (e.g. <code className="font-mono text-gray-800">KITS-EOS-CERT-XXXXXXXXXX</code>), issue date, and institutional signatory names.
              </p>
            </div>

            {/* 2.6 Document Uploads */}
            <div className="p-4 rounded-2xl bg-gray-50/80 border border-gray-200/80 space-y-1.5">
              <h3 className="font-bold text-gray-900 text-xs sm:text-sm flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-blue-600" />
                <span>F. Participant-Uploaded Documents</span>
              </h3>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                Project abstracts, presentation slides (PPT/PDF), and verification files submitted for specialized technical competitions. Documents are stored in access-controlled private storage and made available solely to assigned competition evaluators and coordinators.
              </p>
            </div>
          </div>
        </section>

        {/* Section 3: Cookies & Local Storage */}
        <section id="cookies" className="space-y-4 scroll-mt-20 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-blue-50 text-kits-blue flex items-center justify-center text-xs font-bold shrink-0">3</span>
            <span className="flex items-center gap-2">
              <Cookie className="h-4 w-4 text-amber-600" />
              <span>Cookies, Local Browser Storage & PWA Caching</span>
            </span>
          </h2>
          <p>
            KITS-EOS utilizes browser local storage, session storage, and essential session identifiers to provide a reliable, secure experience. We distinguish between essential operational storage and optional preferences:
          </p>

          <div className="space-y-3 pt-1">
            {/* Essential */}
            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <strong className="text-gray-900 text-xs sm:text-sm flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-kits-blue" />
                  <span>1. Essential Operational Storage (Always Active)</span>
                </strong>
                <span className="text-[10px] font-black uppercase bg-gray-200 text-gray-700 px-2 py-0.5 rounded">Required</span>
              </div>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                <strong>Authentication & Session Tokens:</strong> KITS-EOS maintains active student and administrator login sessions securely in browser <code>localStorage</code> (via Supabase authentication client session tokens). Coordinator authentication utilizes secure <code>HttpOnly</code> session cookies to prevent unauthorized cross-site access.
              </p>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                <strong>Consent Preference Storage:</strong> Stores your current consent choice and policy version in <code>localStorage</code> under <code>kits_eos_cookie_consent_v1</code> (Version 2.0) so the banner does not repeatedly prompt you on subsequent visits.
              </p>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                <strong>Service Worker & PWA Application Shell Caching:</strong> KITS-EOS utilizes a service worker to cache static web application assets (HTML markup, stylesheets, JavaScript bundles, fonts, and institutional logos) locally on your device to accelerate page loading. <em>IMPORTANT DISCLOSURE: The service worker caches static assets only. It does NOT cache sensitive Supabase database records, authentication credentials, dynamic API responses, or private participant documents. KITS-EOS is NOT a fully offline application; real-time operations (registration, payment verification, live attendance scanning) require active network connectivity.</em>
              </p>
            </div>

            {/* Functional */}
            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-1.5">
              <strong className="text-gray-900 text-xs sm:text-sm block">2. Functional Preferences (Optional)</strong>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                Stores your chosen display options, filter preferences, table pagination states, and dismissed informational notices locally on your device to ensure interface continuity between sessions.
              </p>
            </div>

            {/* Analytics */}
            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-1.5">
              <strong className="text-gray-900 text-xs sm:text-sm block">3. Operational Telemetry & Diagnostics (Optional)</strong>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                A consent-gated telemetry interface used solely to monitor client-side load performance and troubleshoot application errors. <strong>KITS-EOS does NOT bundle Google Analytics, Facebook Pixel, tracking pixels, or commercial third-party trackers.</strong>
              </p>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={openCookiePreferencesModal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-bold hover:bg-black transition cursor-pointer"
            >
              <Cookie className="h-3.5 w-3.5 text-amber-400" />
              <span>Customize Cookie & Storage Preferences</span>
            </button>
            <span className="text-[11px] text-gray-500">
              You can adjust or revoke your optional preferences at any time.
            </span>
          </div>
        </section>

        {/* Section 4: Third-Party Infrastructure Services */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-blue-50 text-kits-blue flex items-center justify-center text-xs font-bold shrink-0">4</span>
            <span className="flex items-center gap-2">
              <Server className="h-4 w-4 text-kits-blue" />
              <span>Verified Third-Party Service Providers</span>
            </span>
          </h2>
          <p>
            To reliably operate the cloud application, KITS-EOS utilizes verified technology infrastructure providers under institutional data processing configurations:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-gray-600 text-xs sm:text-sm">
            <li><strong>Supabase:</strong> Provides managed PostgreSQL database infrastructure, authentication services, and encrypted private object storage for uploaded participant documents.</li>
            <li><strong>Google OAuth:</strong> Facilitates secure single sign-on authentication for verified student and institutional email domains.</li>
            <li><strong>Firebase Hosting (Google Cloud):</strong> High-availability Content Delivery Network (CDN) serving static web application bundles, stylesheets, and progressive web app manifests.</li>
          </ul>
          <p className="text-[11px] text-gray-500">
            No other third-party analytics services, advertisement brokers, or tracking networks are utilized by KITS-EOS.
          </p>
        </section>

        {/* Section 5: Attendance, QR Passes & Public Certificate Verification */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-blue-50 text-kits-blue flex items-center justify-center text-xs font-bold shrink-0">5</span>
            <span>Attendance Verification & Certificate Authenticity</span>
          </h2>
          <div className="space-y-2 text-xs sm:text-sm text-gray-600 leading-normal">
            <p>
              <strong>Contactless Check-In:</strong> Upon registering for an event, KITS-EOS issues a digital QR pass and a 10-digit manual token. At the venue, authorized coordinators scan the pass using the internal coordinator portal to verify identity and record attendance stamps in real time. Attendance data is used solely to record participation and validate certificate eligibility.
            </p>
            <p>
              <strong>Public Certificate Verification:</strong> All digital certificates generated by KITS-EOS include an immutable, unique Certificate ID (e.g. <code className="font-mono text-gray-800">KITS-EOS-CERT-XXXXXXXXXX</code>) and an embedded verification QR code linking to <code>https://kits-akshar-eos.web.app/verify/:certId</code>. The verification portal confirms the authenticity of the award, recipient name, sub-event, and date. <strong>The verification portal does NOT expose private student email addresses, mobile numbers, passwords, or authentication credentials to the public.</strong>
            </p>
          </div>
        </section>

        {/* Section 6: Account Deactivation & Suspension Workflows */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-blue-50 text-kits-blue flex items-center justify-center text-xs font-bold shrink-0">6</span>
            <span>Account Deactivation & Suspension Governance</span>
          </h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {/* Deactivation */}
            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-gray-900 text-xs sm:text-sm">
                <UserX className="h-4 w-4 text-amber-600" />
                <span>Voluntary Account Deactivation</span>
              </div>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                Students can voluntarily initiate account deactivation from their Profile page. The platform provides a <strong>15-day reactivation grace period</strong>. During deactivation, your active event registrations and portal access are paused. Logging back into your account within the 15-day window automatically restores active status.
              </p>
            </div>

            {/* Suspension */}
            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-gray-900 text-xs sm:text-sm">
                <ShieldAlert className="h-4 w-4 text-red-600" />
                <span>Administrative Suspension & Appeal</span>
              </div>
              <p className="text-[11px] sm:text-xs text-gray-600 leading-normal">
                Accounts involved in competition misconduct, fraudulent registration, duplicate identity creation, or security rule violations may be administratively suspended. Suspended accounts are restricted from accessing event passes. Students may submit a formal unsuspension appeal through the portal for review by authorized institutional administrators.
              </p>
            </div>
          </div>
        </section>

        {/* Section 7: Role-Based Access & Coordinator Privacy */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-blue-50 text-kits-blue flex items-center justify-center text-xs font-bold shrink-0">7</span>
            <span>Role-Based Access & Coordinator Information</span>
          </h2>
          <p>
            KITS-EOS strictly segments data access according to institutional roles (<code className="font-mono text-gray-800">ADMIN</code>, <code className="font-mono text-gray-800">COORDINATOR</code>, <code className="font-mono text-gray-800">PAYMENT_MANAGER</code>, and <code className="font-mono text-gray-800">STUDENT</code>):
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-gray-600 text-xs sm:text-sm">
            <li><strong>Students:</strong> Can only view and manage their own profile, registrations, digital passes, attendance stamps, and earned certificates.</li>
            <li><strong>Coordinators:</strong> Granted operational access only to the check-in rosters and participant lists for their specifically assigned sub-events. Coordinators cannot access unrelated competitions, financial records, or system configuration.</li>
            <li><strong>Staff & Administrators:</strong> Access aggregated operational logs, approve coordinator assignments, and process student unsuspension requests.</li>
            <li><strong>Coordinator Public vs. Private Data:</strong> Student coordinators' names, event associations, and official contact numbers are displayed publicly to facilitate participant assistance. Coordinator passwords, authentication tokens, and personal administrative credentials remain strictly confidential and are never publicly displayed.</li>
          </ul>
        </section>

        {/* Section 8: Security & Data Retention */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-blue-50 text-kits-blue flex items-center justify-center text-xs font-bold shrink-0">8</span>
            <span>Security Architecture & Data Retention</span>
          </h2>
          <p>
            KITS-EOS protects personal data through multi-layered safeguards including authenticated access controls, database-level Row Level Security (RLS), cryptographically signed session tokens, encrypted object storage for participant attachments, and server-side validation.
          </p>
          <p>
            <strong>Data Retention Policy:</strong> KITS-EOS retains personal information for as long as reasonably necessary for the operational purposes for which it was collected, including fest administration, credential verification, institutional academic records (e.g. NAAC / NIRF accreditation audits), financial accountability, and compliance with institutional policies.
          </p>
        </section>

        {/* Section 9: Institutional Contact & Grievance Redressal */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-blue-50 text-kits-blue flex items-center justify-center text-xs font-bold shrink-0">9</span>
            <span>Institutional Grievance Redressal & Contacts</span>
          </h2>
          <p>
            If you have questions regarding this Privacy Notice, your personal data, or wish to submit an institutional privacy inquiry, contact the administration through official channels:
          </p>
          <div className="p-5 rounded-2xl bg-gray-50 border border-gray-200 text-xs space-y-3 text-gray-800">
            <div>
              <div className="font-bold text-gray-900 text-sm">KITS-EOS Event Operations Cell & Administration</div>
              <div className="text-gray-600">KITS Akshar Institute of Technology</div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-[11px]">
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-kits-red shrink-0 mt-0.5" />
                <span>NH16, Opp. Katuri Medical College, Yanamadala, Guntur, AP 522019</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-kits-blue shrink-0" />
                <span>0863-2288887 / 0863-2288886</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-kits-red shrink-0" />
                <a href="mailto:principalkitsakshar@gmail.com" className="font-mono text-kits-blue hover:underline">
                  principalkitsakshar@gmail.com
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-emerald-600 shrink-0" />
                <a href="https://www.kitsakshar.ac.in/" target="_blank" rel="noopener noreferrer" className="font-mono text-kits-blue hover:underline">
                  https://www.kitsakshar.ac.in/
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Footer Navigation */}
        <div className="pt-6 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Link to="/terms" className="text-xs font-bold text-kits-red hover:underline">
            ← Review Terms & Conditions
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
