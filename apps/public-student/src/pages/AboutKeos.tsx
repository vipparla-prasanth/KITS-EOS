import { Link } from 'react-router-dom';
import { 
  Sparkles, 
  CheckCircle2, 
  Layers, 
  Users, 
  Award, 
  Cpu, 
  FileCheck, 
  Lock, 
  Activity, 
  QrCode,
  ArrowRight
} from 'lucide-react';
import { RevealOnScroll } from '../components/motion/RevealOnScroll';

export function AboutKeos() {
  const lifecycleStages = [
    {
      num: '01',
      title: 'Flagship Event Creation',
      desc: 'Central administrators define master events (technical symposiums, cultural fests) with official banners, dates, and overarching guidelines.',
    },
    {
      num: '02',
      title: 'Category Organization',
      desc: 'Events are partitioned into distinct academic tracks (e.g. CSE Technical, Mechanical Robotics, Inter-college Cultural) without redundant banners.',
    },
    {
      num: '03',
      title: 'Sub-Event Scoping & Rules',
      desc: 'Detailed competitions with specific rules, team size limits (Solo vs Team), fee structures, document requirements, and venue timings.',
    },
    {
      num: '04',
      title: 'Student Self-Service Registration',
      desc: 'Students authenticate with academic roll numbers, select sub-events, assemble teams with real-time member validation, and submit registrations.',
    },
    {
      num: '05',
      title: 'Fee Payment & Receipt Reconciliation',
      desc: 'Per-event and team payment recording with reference IDs ensuring transparent financial tracking without double billing.',
    },
    {
      num: '06',
      title: 'Tamper-Evident QR Pass & Manual Token',
      desc: 'Instant generation of encrypted QR identity and standardized 10-digit manual token (e.g., KITS-EOS-PPT-XXXXXXXXXX) for fast offline or online verification.',
    },
    {
      num: '07',
      title: 'Multi-Event Coordinator Assignment',
      desc: 'Faculty and student coordinators are assigned to specific events and sub-events with restricted operational privileges.',
    },
    {
      num: '08',
      title: 'Real-Time Attendance Check-In',
      desc: 'Coordinators scan QR passes or enter manual tokens at event entrances, marking attendance with instant duplicate check-in prevention.',
    },
    {
      num: '09',
      title: 'Official Result Publishing',
      desc: 'Evaluators and coordinators enter verified scores, rankings, and prize winners directly into the central ledger.',
    },
    {
      num: '10',
      title: 'Student Feedback & Grievance Support',
      desc: 'Participants submit structured ratings, qualitative feedback, and operational complaints directly to the coordinating team.',
    },
    {
      num: '11',
      title: 'Cryptographic Digital Certificates',
      desc: 'Automated generation of authentic participation and merit certificates with unique UUIDs verifiable by employers and institutions.',
    },
    {
      num: '12',
      title: 'Administrative Audit Oversight',
      desc: 'Every sensitive operational action, registration update, and password reset is immutably logged for complete administrative traceability.',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-12 pb-12">
      {/* Header Banner */}
      <div className="bg-white rounded-3xl border border-gray-200 p-8 sm:p-12 shadow-2xs space-y-4 stagger-1">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-black bg-red-50 text-kits-red border border-red-100">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Institutional Architecture</span>
        </div>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-gray-900 tracking-tight">
          About <span className="text-kits-red">KITS</span>-<span className="text-kits-blue">EOS</span>
        </h1>
        <p className="text-sm sm:text-base text-gray-600 leading-relaxed max-w-3xl font-medium">
          The official Event Operations System of <strong>KITS Akshar Institute of Technology</strong>, engineered to deliver 
          a secure, transparent, and completely unified campus event lifecycle.
        </p>
      </div>

      {/* Section 1: What is KITS-EOS & Why It Was Created (Scroll Reveal) */}
      <RevealOnScroll>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-2xs space-y-4 card-hover-interactive">
            <div className="h-10 w-10 rounded-2xl bg-red-50 text-kits-red flex items-center justify-center font-black">
              <Cpu className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-black text-gray-900 tracking-tight">
              What is KITS-EOS?
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
              KITS-EOS (KITS Event Operations System) is the authoritative enterprise platform developed for KITS Akshar Institute of Technology. 
              It replaces traditional paper forms, manual token distributions, and fragmented Google Forms with an integrated digital workflow 
              spanning event publication, participant onboarding, attendance enforcement, and verifiable credential issuance.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-2xs space-y-4 card-hover-interactive">
            <div className="h-10 w-10 rounded-2xl bg-blue-50 text-kits-blue flex items-center justify-center font-black">
              <Activity className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-black text-gray-900 tracking-tight">
              Why was it Created?
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
              Prior to KITS-EOS, campus symposiums faced significant administrative overheads: lost participant lists, unregistered walk-ins, 
              attendance discrepancies, delayed certificate distribution, and lack of central audit logs. KITS-EOS was architected to eliminate 
              these friction points and establish an institutional standard of operational excellence.
            </p>
          </div>
        </div>
      </RevealOnScroll>

      {/* Section 2: The 12-Stage Lifecycle (Scroll Reveal) */}
      <RevealOnScroll delay={60}>
        <div className="bg-white rounded-3xl border border-gray-200 p-8 sm:p-10 shadow-2xs space-y-6">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-kits-red block">
              End-to-End Operational Lifecycle
            </span>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">
              12 Stages of Event Management
            </h2>
            <p className="text-xs text-gray-500">
              From initial faculty approval to final certificate verification, every phase is governed by database rules.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {lifecycleStages.map((stage) => (
              <div 
                key={stage.num} 
                className="p-4 rounded-2xl bg-gray-50/70 border border-gray-200 space-y-2 card-hover-interactive"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-black text-kits-red bg-red-100/70 px-2 py-0.5 rounded">
                    Stage {stage.num}
                  </span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </div>
                <h3 className="text-xs font-black text-gray-900 tracking-tight uppercase">
                  {stage.title}
                </h3>
                <p className="text-[11px] text-gray-500 font-normal leading-relaxed">
                  {stage.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </RevealOnScroll>

      {/* Section 3: Institutional Purpose & Pillars (Scroll Reveal) */}
      <RevealOnScroll delay={60}>
        <div className="bg-white rounded-3xl border border-gray-200 p-8 sm:p-10 shadow-2xs space-y-6">
          <div className="space-y-1 text-center max-w-xl mx-auto">
            <span className="text-[10px] font-black uppercase tracking-widest text-kits-blue block">
              System Mission & Goals
            </span>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">
              Core Institutional Benefits
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Layers,
                title: 'Centralization',
                desc: 'One authoritative database for all departments, branches, and symposium organizers across the college.',
              },
              {
                icon: Lock,
                title: 'Transparency & RLS',
                desc: 'Strict Row Level Security ensures students access only their data while coordinators access assigned events.',
              },
              {
                icon: QrCode,
                title: 'Tamper Prevention',
                desc: 'QR passes cannot be forged or transferred; attendance is checked in real-time with duplicate prevention.',
              },
              {
                icon: Award,
                title: 'Certificate Authenticity',
                desc: 'Public verification RPC allows any third party to confirm certificate legitimacy in real time.',
              },
              {
                icon: Users,
                title: 'Accountable Coordination',
                desc: 'Role-based access separating faculty advisors, student coordinators, evaluators, and system administrators.',
              },
              {
                icon: FileCheck,
                title: 'Administrative Traceability',
                desc: 'Immutable audit logs record all sensitive actions, user deletions, password resets, and score updates.',
              },
            ].map((pillar, idx) => {
              const IconComp = pillar.icon;
              return (
                <div key={idx} className="p-5 rounded-2xl border border-gray-200 bg-white space-y-2 card-hover-interactive">
                  <div className="h-8 w-8 rounded-xl bg-gray-100 text-gray-800 flex items-center justify-center font-bold">
                    <IconComp className="h-4 w-4 text-kits-blue" />
                  </div>
                  <h3 className="text-xs font-black text-gray-900 uppercase tracking-wide">
                    {pillar.title}
                  </h3>
                  <p className="text-[11px] text-gray-500 font-normal leading-relaxed">
                    {pillar.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </RevealOnScroll>

      {/* CTA Footer (Scroll Reveal) */}
      <RevealOnScroll delay={100}>
        <div className="bg-gray-900 text-white rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-md card-hover-interactive">
          <div className="space-y-1 text-center sm:text-left">
            <h3 className="text-lg sm:text-xl font-black tracking-tight">
              Ready to participate in upcoming campus events?
            </h3>
            <p className="text-xs text-gray-400">
              Sign in with your student credentials or explore current active symposiums.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/events"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs"
            >
              <span>Explore Events</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              to="/login"
              className="px-5 py-2.5 rounded-xl bg-white text-gray-900 text-xs font-black uppercase tracking-wider hover:bg-gray-100 active:scale-95 transition shadow-2xs"
            >
              Student Sign In
            </Link>
          </div>
        </div>
      </RevealOnScroll>
    </div>
  );
}
