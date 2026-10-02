import { useState } from 'react';
import {
  HelpCircle,
  Mail,
  Phone,
  MapPin,
  ChevronDown,
  ChevronUp,
  Globe,
  ExternalLink,
  Code2,
  Clock,
  Building2,
  ShieldCheck,
  CheckCircle2,
  User,
  Sparkles
} from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  role: string;
  workTag: string;
  isLead: boolean;
  phone: string;
  displayPhone: string;
  email: string;
  image: string;
  accentColor: 'red' | 'blue' | 'emerald';
  bio: string;
}

const TEAM_KEOS_MEMBERS: TeamMember[] = [
  {
    id: 'prasanth',
    name: 'PRASANTH VIPPARLA',
    role: 'Team KEOS Lead',
    workTag: 'TEAM LEAD',
    isLead: true,
    phone: '+917013884363',
    displayPhone: '+91 70138 84363',
    email: 'prasanthv865@gmail.com',
    image: '/team/prasanth.jpg',
    accentColor: 'red',
    bio: 'Platform architect and lead engineer driving architecture, full-stack engineering, and deployment.'
  },
  {
    id: 'manoj',
    name: 'MANOJ HRUTHVIK BANDLAMUDI',
    role: 'Team KEOS',
    workTag: 'CORE DEVELOPER',
    isLead: false,
    phone: '+918019043388',
    displayPhone: '+91 80190 43388',
    email: 'hruthvikmanoj4608@gmail.com',
    image: '/team/manoj.jpg',
    accentColor: 'blue',
    bio: 'Core developer contributing to feature development, frontend workflows, and platform enhancements.'
  },
  {
    id: 'deepak',
    name: 'SAI DEEPAK ABBU',
    role: 'Team KEOS',
    workTag: 'Manual QA Tester',
    isLead: false,
    phone: '+919247231179',
    displayPhone: '+91 92472 31179',
    email: 'saideepak4408@gmail.com',
    image: '/team/deepak.jpg',
    accentColor: 'emerald',
    bio: 'Manual QA tester responsible for functional validation, defect identification, and platform reliability.'
  }
];

interface GuidanceMember {
  id: string;
  name: string;
  designation: string;
  roleTag: string;
  initials: string;
  description: string;
}

const GUIDANCE_SUPPORT_MEMBERS: GuidanceMember[] = [
  {
    id: 'bulli-babu',
    name: 'Dr. R Bulli Babu',
    designation: 'HOD, AI & ML',
    roleTag: 'FACULTY ADVISOR',
    initials: 'BB',
    description: 'First point of contact who approved and granted permission for campus testing.',
  },
  {
    id: 'sravan-kumar',
    name: 'Prof. J N V Sravan Kumar',
    designation: 'Faculty Mentor',
    roleTag: 'FACULTY MENTOR',
    initials: 'SK',
    description: 'Encouraged feature expansion, guided testing, and provided continuous mentorship.',
  },
  {
    id: 'bhavani-lakshmi',
    name: 'N Bhavani Lakshmi',
    designation: 'Senior Student — 4th Year, Data Science',
    roleTag: 'SENIOR SUPPORT',
    initials: 'BL',
    description: 'Senior student supporting the team through platform development and testing. LEAD Club president',
  },
  {
    id: 'baba-noorulla',
    name: 'Shaik Baba Mohiddin Noorulla',
    designation: 'Senior Student — 3rd Year, AI & ML',
    roleTag: 'QUALITY REVIEW',
    initials: 'BN',
    description: 'Identified platform issues, helped refine workflows, and encouraged live deployment. - LEAD Club Campus Ambassador',
  },
];

export function TechSupport() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  const handleImageError = (id: string) => {
    setImgErrors(prev => ({ ...prev, [id]: true }));
  };

  const faqs = [
    {
      question: 'How do I register for a team competition?',
      answer: 'After signing into the Student Portal, navigate to Events → Select your Event & Category → Open the Sub-Event → Click [ REGISTER NOW ]. Select "TEAM" mode, enter your team name, and add your teammates by providing their Full Name, Roll Number, Department, College, and Phone number. Submit to generate your team pass.'
    },
    {
      question: 'Where can I find my QR Pass and 10-Digit Manual Token after registering?',
      answer: 'Your confirmed passes are permanently stored in your Student Portal under [ My Passes ] (/my-registrations). You can download the high-resolution QR code image or present your 10-digit manual token (e.g., KITS-EOS-PPT-XXXXXXXXXX) directly at the venue check-in desk.'
    },
    {
      question: 'What should I do if I see "Duplicate Roll Number" during signup?',
      answer: 'Each student roll number is unique within KITS-EOS. If your roll number is already registered, please sign in with your email and password. If you forgot your password, contact your department faculty coordinator or system admin to initiate an administrative password reset.'
    },
    {
      question: 'How do coordinators verify my attendance at the competition hall?',
      answer: 'At the entrance of the event venue, present your digital QR pass from your phone or give your 10-digit token to the assigned coordinator. The coordinator scans or validates the token in real time and marks your attendance as CONFIRMED.'
    },
    {
      question: 'How do I verify the authenticity of a KITS-EOS certificate?',
      answer: 'Anyone (employers, university evaluators, students) can navigate to [ Verify Certificate ] (/verify-certificate) and input the Certificate UUID printed on the official PDF. The system queries the live cryptographically verifiable database to confirm validity.'
    },
    {
      question: 'Can I edit my department or phone number after account creation?',
      answer: 'Yes. Once signed in, navigate to [ Profile ] in the upper navigation menu to update your contact number or check your verified academic department and year of study.'
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-16 font-sans">
      {/* =========================================================================
          PAGE HEADER: INSTITUTIONAL & REFINED
          ========================================================================= */}
      <header className="bg-white rounded-3xl border border-gray-200/90 p-8 sm:p-10 shadow-2xs relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-72 h-72 bg-gradient-to-br from-blue-50/60 to-red-50/40 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-3.5 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-black bg-blue-50 text-kits-blue border border-blue-100">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>KITS-EOS Support & Operations Helpdesk</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-gray-900 tracking-tight leading-tight">
            Technical <span className="text-kits-red">Support</span> & Help Center
          </h1>

          <p className="text-sm sm:text-base text-gray-600 leading-relaxed font-normal pt-0.5">
            Need assistance with event registration, QR pass verification, token validation, or certificate issuance?
            Connect directly with the platform engineering team below or reach out to official college administration.
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-2 text-xs font-semibold text-gray-500">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>Direct Developer Support</span>
            </div>
            <span className="text-gray-300">•</span>
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-kits-blue shrink-0" />
              <span>Official Institutional Helpdesk</span>
            </div>
            <span className="text-gray-300">•</span>
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-gray-400 shrink-0" />
              <span>24/7 Portal System Health</span>
            </div>
          </div>
        </div>
      </header>

      {/* =========================================================================
          SECTION 1: OUR TEAM & GUIDANCE
          ========================================================================= */}
      <section
        id="team-keos"
        className="bg-white rounded-3xl border border-gray-200/90 p-6 sm:p-10 shadow-2xs space-y-8 scroll-mt-24 relative overflow-hidden"
      >
        {/* Subtle background glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-red-50/20 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

        {/* Section Header: OUR TEAM */}
        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gray-100 pb-5">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-50 text-kits-red border border-red-100">
              <Code2 className="h-3 w-3" />
              <span>Platform Engineering</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              OUR TEAM
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 font-medium">
              The students who architected, engineered, and deployed KITS-EOS.
            </p>
          </div>

          <div className="text-left md:text-right shrink-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">
              Core Engineering
            </span>
            <span className="text-xs font-bold text-gray-700">
              Platform Creators
            </span>
          </div>
        </div>

        {/* Team Members Grid: Exactly 3 Cards in Strict Sequence with Distinct Accent Identities */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
          {TEAM_KEOS_MEMBERS.map((member) => {
            const hasImgError = imgErrors[member.id];

            // Distinct Accent System for each member
            const accentStyles = {
              red: {
                card: 'border-2 border-red-200/90 shadow-2xs hover:border-kits-red hover:shadow-md ring-4 ring-red-50/60',
                topStrip: 'bg-kits-red h-1.5 w-full',
                tag: 'bg-red-50 text-kits-red border border-red-200/90',
                imgRing: 'border-2 border-kits-red/30 ring-2 ring-red-100',
                hoverName: 'group-hover:text-kits-red',
                iconHover: 'group-hover:bg-red-50 group-hover:text-kits-red',
                emailLink: 'text-kits-red hover:underline',
              },
              blue: {
                card: 'border-2 border-blue-200/90 shadow-2xs hover:border-kits-blue hover:shadow-md ring-4 ring-blue-50/60',
                topStrip: 'bg-kits-blue h-1.5 w-full',
                tag: 'bg-blue-50 text-kits-blue border border-blue-200/90',
                imgRing: 'border-2 border-kits-blue/30 ring-2 ring-blue-100',
                hoverName: 'group-hover:text-kits-blue',
                iconHover: 'group-hover:bg-blue-50 group-hover:text-kits-blue',
                emailLink: 'text-kits-blue hover:underline',
              },
              emerald: {
                card: 'border-2 border-emerald-200/90 shadow-2xs hover:border-emerald-600 hover:shadow-md ring-4 ring-emerald-50/60',
                topStrip: 'bg-emerald-600 h-1.5 w-full',
                tag: 'bg-emerald-50 text-emerald-800 border border-emerald-200/90',
                imgRing: 'border-2 border-emerald-600/30 ring-2 ring-emerald-100',
                hoverName: 'group-hover:text-emerald-700',
                iconHover: 'group-hover:bg-emerald-50 group-hover:text-emerald-700',
                emailLink: 'text-emerald-700 hover:underline',
              },
            }[member.accentColor];

            return (
              <div
                key={member.id}
                className={`bg-white rounded-2xl transition-all duration-200 flex flex-col justify-between overflow-hidden group ${accentStyles.card}`}
              >
                {/* Colored Top Accent Strip */}
                <div className={accentStyles.topStrip} />

                <div className="p-5 sm:p-6 space-y-5 flex-1 flex flex-col justify-between">
                  {/* Avatar & Work Tag Header */}
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      {/* Clean Profile Image without any initials overlay */}
                      <div className="relative shrink-0">
                        {!hasImgError ? (
                          <img
                            src={member.image}
                            alt={`${member.name} - ${member.role}`}
                            onError={() => handleImageError(member.id)}
                            className={`h-20 w-20 sm:h-24 sm:w-24 rounded-2xl object-cover shadow-2xs transition-transform duration-200 group-hover:scale-[1.02] ${accentStyles.imgRing}`}
                            loading="eager"
                          />
                        ) : (
                          <div
                            className={`h-20 w-20 sm:h-24 sm:w-24 rounded-2xl flex items-center justify-center shadow-2xs ${member.accentColor === 'red'
                              ? 'bg-red-50 text-kits-red border border-red-200'
                              : member.accentColor === 'blue'
                                ? 'bg-blue-50 text-kits-blue border border-blue-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}
                          >
                            <User className="h-8 w-8" />
                          </div>
                        )}
                      </div>

                      {/* Work Role Tag (Top-Right Corner of Image Area) */}
                      <div className="text-right">
                        <span
                          className={`inline-flex items-center font-mono text-[10px] sm:text-[11px] font-black tracking-wider px-2.5 py-1 rounded-lg shadow-2xs ${accentStyles.tag}`}
                        >
                          {member.workTag}
                        </span>
                      </div>
                    </div>

                    {/* Member Identity & Bio */}
                    <div>
                      <h3 className={`text-base sm:text-lg font-black text-gray-900 tracking-tight transition ${accentStyles.hoverName}`}>
                        {member.name}
                      </h3>
                      <p className="text-xs font-bold text-gray-500 mt-0.5">
                        {member.role}
                      </p>
                      <p className="text-[11px] text-gray-600 leading-relaxed font-normal mt-2 line-clamp-3">
                        {member.bio}
                      </p>
                    </div>
                  </div>

                  {/* Visual Divider */}
                  <div className="pt-4 border-t border-gray-100 space-y-2.5">
                    {/* Phone Number */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`p-1.5 rounded-lg bg-gray-100 text-gray-600 shrink-0 transition ${accentStyles.iconHover}`}>
                          <Phone className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider shrink-0">
                          Mobile
                        </span>
                      </div>
                      <a
                        href={`tel:${member.phone}`}
                        className="font-mono text-xs font-bold text-gray-900 hover:text-kits-blue transition truncate"
                      >
                        {member.displayPhone}
                      </a>
                    </div>

                    {/* Email Address */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`p-1.5 rounded-lg bg-gray-100 text-gray-600 shrink-0 transition ${accentStyles.iconHover}`}>
                          <Mail className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider shrink-0">
                          Email
                        </span>
                      </div>
                      <a
                        href={`mailto:${member.email}`}
                        className={`font-mono text-xs font-bold text-right break-all ${accentStyles.emailLink}`}
                        title={member.email}
                      >
                        {member.email}
                      </a>
                    </div>
                  </div>
                </div>

                {/* Card Footer: Clean institutional status without any initials */}
                <div className="bg-gray-50/90 border-t border-gray-100 px-5 py-2.5 flex items-center justify-between text-[10px] font-bold text-gray-500">
                  <span>KITS-EOS Core Team</span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold text-gray-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    ACTIVE
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* =========================================================================
            OUR GUIDANCE & SUPPORT (Directly below the three core team cards)
            ========================================================================= */}
        <div className="pt-8 border-t border-gray-100 space-y-6 relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-gray-100/80 pb-4">
            <div className="space-y-1 max-w-xl">
              <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-50 text-kits-blue border border-blue-100">
                <Sparkles className="h-3 w-3" />
                <span>Mentorship & Testing Collaboration</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                OUR GUIDANCE & SUPPORT
              </h3>
              <p className="text-xs text-gray-500 font-medium">
                Mentor and senior who guided, challenged, and supported our testing and platform deployment.
              </p>
            </div>

            <div className="text-left sm:text-right shrink-0">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">
                Testing & Mentorship
              </span>
              <span className="text-xs font-bold text-gray-700">
                Institutional Advisory
              </span>
            </div>
          </div>

          {/* 4 Compact Guidance & Support Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {GUIDANCE_SUPPORT_MEMBERS.map((person) => (
              <div
                key={person.id}
                className="bg-gray-50/70 hover:bg-white rounded-2xl border border-gray-200/90 p-4 sm:p-5 shadow-2xs hover:shadow-xs hover:border-kits-blue/40 transition duration-200 flex flex-col justify-between space-y-3"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    {/* Initials / Avatar Circle (No photo, clean institutional treatment) */}
                    <div className="h-10 w-10 rounded-xl bg-blue-50 text-kits-blue border border-blue-100 flex items-center justify-center font-black text-xs tracking-wider shadow-2xs shrink-0">
                      {person.initials}
                    </div>
                    <span className="font-mono text-[9px] font-black uppercase tracking-wider text-kits-blue bg-blue-50/80 border border-blue-100/80 px-2 py-0.5 rounded-md">
                      {person.roleTag}
                    </span>
                  </div>

                  <div>
                    <h4 className="text-xs sm:text-sm font-black text-gray-900 tracking-tight leading-snug">
                      {person.name}
                    </h4>
                    <p className="text-[11px] font-semibold text-kits-blue mt-0.5">
                      {person.designation}
                    </p>
                    <p className="text-[11px] text-gray-600 leading-relaxed font-normal mt-2">
                      {person.description}
                    </p>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-gray-200/60 flex items-center justify-between text-[10px] text-gray-400 font-semibold">
                  <span>Guidance & Testing</span>
                  <span className="font-mono text-[9px]">KITS-EOS</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 2: OFFICIAL KITS SUPPORT (MANDATORY SECOND POSITION)
          ========================================================================= */}
      <section className="bg-white rounded-3xl border border-gray-200/90 p-6 sm:p-10 shadow-2xs space-y-8">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gray-100 pb-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-blue-50 text-kits-blue border border-blue-100">
              <Building2 className="h-3.5 w-3.5" />
              <span>Campus Administration & Helpdesk</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              Official KITS Support
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 leading-relaxed font-medium">
              For official institutional assistance, campus information, and general KITS administrative support.
            </p>
          </div>

          <div className="text-left md:text-right shrink-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">
              Official Desk
            </span>
            <span className="text-xs font-bold text-gray-700">
              Administrative & Principal Secretariat
            </span>
          </div>
        </div>

        {/* Official 4-Card Helpdesk Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Card 1: Official Support Email */}
          <div className="bg-gray-50/70 hover:bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs hover:shadow-xs hover:border-kits-red/40 transition flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-red-50 text-kits-red flex items-center justify-center font-bold border border-red-100">
                  <Mail className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-kits-red bg-red-50/60 px-2 py-0.5 rounded-md">
                  Official
                </span>
              </div>
              <div>
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wide">
                  Official Support Email
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Direct administrative desk
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200/60 space-y-2">
              <a
                href="mailto:principalkitsakshar@gmail.com"
                className="text-xs font-mono font-bold text-kits-blue hover:underline block break-all"
                title="principalkitsakshar@gmail.com"
              >
                principalkitsakshar@gmail.com
              </a>
              <a
                href="mailto:principal@kitsakshar.ac.in"
                className="text-xs font-mono font-bold text-kits-blue hover:underline block break-all"
                title="principal@kitsakshar.ac.in"
              >
                principal@kitsakshar.ac.in
              </a>
              <p className="text-[10px] font-medium text-gray-400 pt-1">
                Institutional desk response within 24 hours.
              </p>
            </div>
          </div>

          {/* Card 2: Primary Campus Cell Helpline */}
          <div className="bg-gray-50/70 hover:bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs hover:shadow-xs hover:border-kits-blue/40 transition flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-blue-50 text-kits-blue flex items-center justify-center font-bold border border-blue-100">
                  <Phone className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-kits-blue bg-blue-50/60 px-2 py-0.5 rounded-md">
                  Helpline
                </span>
              </div>
              <div>
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wide">
                  Campus Cell Helpline
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Direct voice assistance
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200/60 space-y-1.5">
              <a
                href="tel:08632288887"
                className="text-xs font-mono font-bold text-gray-900 hover:text-kits-blue transition block"
              >
                0863-2288887
              </a>
              <a
                href="tel:08632288886"
                className="text-xs font-mono font-bold text-gray-900 hover:text-kits-blue transition block"
              >
                0863-2288886
              </a>
              <div className="flex items-start gap-1.5 pt-1 text-[10px] font-medium text-gray-500">
                <Clock className="h-3 w-3 text-gray-400 shrink-0 mt-0.5" />
                <span>Mon – Sat: 9:00 AM – 5:00 PM IST</span>
              </div>
            </div>
          </div>

          {/* Card 3: Campus Address / Venue */}
          <div className="bg-gray-50/70 hover:bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs hover:shadow-xs hover:border-amber-600/40 transition flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold border border-amber-100">
                  <MapPin className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 bg-amber-50/60 px-2 py-0.5 rounded-md">
                  Location
                </span>
              </div>
              <div>
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wide">
                  Campus Address / Venue
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Physical institutional campus
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200/60">
              <p className="text-xs font-semibold text-gray-700 leading-relaxed">
                KITS Akshar Institute of Technology, NH16, Opposite Katuri Medical College, Yanamadala, Guntur, Andhra Pradesh 522019
              </p>
            </div>
          </div>

          {/* Card 4: Institution Website */}
          <div className="bg-gray-50/70 hover:bg-white rounded-2xl border border-gray-200/80 p-5 shadow-2xs hover:shadow-xs hover:border-emerald-600/40 transition flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold border border-emerald-100">
                  <Globe className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50/60 px-2 py-0.5 rounded-md">
                  Web Portal
                </span>
              </div>
              <div>
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wide">
                  Institution Website
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Official university website
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200/60 space-y-1.5">
              <a
                href="https://www.kitsakshar.ac.in/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-kits-blue hover:underline break-all"
              >
                <span>https://www.kitsakshar.ac.in/</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <p className="text-[10px] font-medium text-gray-400">
                Official KITS Akshar portal & academic directory.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 3: FREQUENTLY ASKED QUESTIONS (FAQ)
          ========================================================================= */}
      <section className="bg-white rounded-3xl border border-gray-200/90 p-6 sm:p-10 shadow-2xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-gray-100 pb-5">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-kits-red block">
              Knowledge Base & Self Help
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              Frequently Asked Questions
            </h2>
          </div>
          <p className="text-xs text-gray-500 font-medium">
            Common questions regarding tokens, passes, and events.
          </p>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={idx}
                className="rounded-2xl border border-gray-200/90 overflow-hidden bg-white transition shadow-2xs"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className="w-full p-4 sm:p-5 text-left flex items-center justify-between gap-4 font-black text-xs sm:text-sm text-gray-900 hover:bg-gray-50/80 transition cursor-pointer"
                  aria-expanded={isOpen}
                >
                  <span className="leading-snug">{faq.question}</span>
                  <div className={`p-1 rounded-lg shrink-0 transition ${isOpen ? 'bg-red-50 text-kits-red' : 'bg-gray-100 text-gray-500'}`}>
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="p-4 sm:p-5 pt-0 text-xs sm:text-sm text-gray-600 font-normal leading-relaxed border-t border-gray-100 bg-gray-50/40">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
