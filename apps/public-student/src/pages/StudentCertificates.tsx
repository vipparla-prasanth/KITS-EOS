import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

// Digital Certificate typography packages (optimized to only required weights)
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import { Link } from 'react-router-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useScrollLock } from '@kits-eos/shared';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from '../components/ui/LoadingState';
import { ErrorState } from '../components/ui/ErrorState';
import { 
  Award, 
  Trophy, 
  CheckCircle2, 
  ExternalLink, 
  Copy, 
  Check, 
  X, 
  ShieldCheck, 
  Users, 
  User, 
  GraduationCap, 
  Medal, 
  FileCheck, 
  Eye,
  Calendar,
  Lock,
  MessageSquare,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  downloadCertificateAsHighResImage, 
  downloadCertificateAsPdf,
  generateCertificateQrDataUrl
} from '../utils/credentialExport';


import { DownloadButton } from '../components/ui/DownloadButton';
import { StudentPublishedResults } from '../components/certificates/StudentPublishedResults';

export interface StudentCertificateItem {
  id: string;
  certificateCode: string;
  type: 'WINNER' | 'RUNNER' | 'THIRD_PLACE' | 'PARTICIPANT';
  status: 'LOCKED' | 'UNLOCKED' | 'REVOKED';
  issuedAt: string | null;
  subEventId: string;
  subEventName: string;
  eventName: string;
  categoryName: string;
  studentName: string;
  rollNumber: string;
  department: string;
  college: string;
  year: number;
  isTeam: boolean;
  teamName: string;
  teamRole?: string;
  teamMemberId?: string;
  isLeader?: boolean;
  attendanceVerified: boolean;
  registrationId?: string;
  eventStartDate?: string | null;
  eventEndDate?: string | null;
}

const CHAIRMAN_NAME = 'Sri. K. Subba Rao';
const PRINCIPAL_NAME = 'Dr. Kalluri Rama Kotaiah';

export function StudentCertificates() {
  const { user, profile } = useAuth();
  const [certificates, setCertificates] = useState<StudentCertificateItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Two primary tabs: 'PARTICIPATION' and 'ACHIEVEMENTS'
  const [activeTab, setActiveTab] = useState<'PARTICIPATION' | 'ACHIEVEMENTS'>('PARTICIPATION');
  const [selectedCert, setSelectedCert] = useState<StudentCertificateItem | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);


  const fetchStudentCertificates = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      // 1. Fetch user registrations to resolve sub-events, teams, and member identities
      const { data: regData, error: regErr } = await supabase
        .from('registrations')
        .select(`
          id,
          sub_event_id,
          leader_id,
          status,
          payments (
            id,
            status
          ),
          sub_events (
            id,
            name,
            results_locked,
            results_published,
            events (
              id,
              name
            ),
            categories (
              id,
              name,
              events (
                id,
                name
              )
            )
          ),
          teams (
            id,
            team_name,
            team_members (
              id,
              user_id,
              snapshot_name,
              snapshot_roll_number,
              snapshot_college,
              snapshot_department,
              snapshot_year,
              is_leader
            )
          )
        `)
        .eq('leader_id', user.id)
        .neq('status', 'CANCELLED');

      if (regErr) throw regErr;

      // 2. Also fetch team_members where user_id == user.id (non-leader team members)
      const { data: memberRows } = await supabase
        .from('team_members')
        .select(`
          id,
          user_id,
          snapshot_name,
          snapshot_roll_number,
          snapshot_college,
          snapshot_department,
          snapshot_year,
          is_leader,
          teams (
            id,
            team_name,
            registration_id,
            registrations (
              id,
              sub_event_id,
              leader_id,
              status,
              payments (
                id,
                status
              ),
              sub_events (
                id,
                name,
                results_locked,
                results_published,
                events (
                  id,
                  name
                ),
                categories (
                  id,
                  name,
                  events (
                    id,
                    name
                  )
                )
              )
            )
          )
        `)
        .eq('user_id', user.id);

      // Build member and sub-event lookup context
      const memberContextMap = new Map<string, {
        subEvent: any;
        team: any;
        member: any;
        registrationId?: string;
      }>();

      // Process leader registrations (leader has authorized access to all team members)
      (regData || []).forEach((reg: any) => {
        const team = Array.isArray(reg.teams) ? reg.teams[0] : reg.teams;
        const members = team?.team_members || [];
        members.forEach((m: any) => {
          memberContextMap.set(m.id, {
            subEvent: reg.sub_events,
            team,
            member: m,
            registrationId: reg.id,
          });
        });
      });

      // Process non-leader member registrations
      (memberRows || []).forEach((mr: any) => {
        const team = Array.isArray(mr.teams) ? mr.teams[0] : mr.teams;
        const reg = Array.isArray(team?.registrations) ? team.registrations[0] : team?.registrations;
        if (reg?.sub_events) {
          memberContextMap.set(mr.id, {
            subEvent: reg.sub_events,
            team,
            member: mr,
            registrationId: reg?.id,
          });
        }
      });

      // 3. Fetch all certificates (both LOCKED and UNLOCKED) from the genuine production schema
      const { data: certsData, error: certErr } = await supabase
        .from('certificates')
        .select(`
          id,
          certificate_code,
          type,
          status,
          issued_at,
          sub_event_id,
          team_member_id,
          sub_events (
            id,
            name,
            results_published,
            events (
              id,
              name,
              start_date,
              end_date
            ),
            categories (
              id,
              name,
              events (
                id,
                name,
                start_date,
                end_date
              )
            )
          ),
          team_members (
            id,
            user_id,
            snapshot_name,
            snapshot_roll_number,
            snapshot_department,
            snapshot_college,
            snapshot_year,
            is_leader,
            teams (
              id,
              team_name,
              registration_id
            )
          )
        `)
        .order('issued_at', { ascending: false, nullsFirst: false });

      if (certErr) throw certErr;

      // 4. Map into StudentCertificateItem list
      const mappedItems: StudentCertificateItem[] = [];

      (certsData || []).forEach((cert: any) => {
        const tm = cert.team_members;
        const ctx = cert.team_member_id ? memberContextMap.get(cert.team_member_id) : null;
        const sub = cert.sub_events || ctx?.subEvent;
        const team = tm?.teams ? (Array.isArray(tm.teams) ? tm.teams[0] : tm.teams) : ctx?.team;
        const member = tm || ctx?.member;

        const isTeam = team?.team_name && team.team_name !== 'Solo Participant';
        const teamRole = isTeam ? (member?.is_leader ? 'Team Leader' : 'Team Member') : 'Solo Participant';
        const eventStartDate = sub?.events?.start_date || sub?.categories?.events?.start_date || null;
        const eventEndDate = sub?.events?.end_date || sub?.categories?.events?.end_date || null;

        mappedItems.push({
          id: cert.id,
          certificateCode: cert.certificate_code,
          type: cert.type,
          status: cert.status,
          issuedAt: cert.issued_at,
          subEventId: cert.sub_event_id,
          subEventName: sub?.name || 'Sub-Event Track',
          eventName: sub?.events?.name || sub?.categories?.events?.name || 'Flagship Event',
          categoryName: sub?.categories?.name || 'Main Track',
          studentName: member?.snapshot_name || profile?.full_name || 'Student Participant',
          rollNumber: member?.snapshot_roll_number || profile?.roll_number || 'N/A',
          department: member?.snapshot_department || profile?.department || 'Engineering',
          college: member?.snapshot_college || profile?.college || 'KITS Akshar Institute of Technology',
          year: member?.snapshot_year || profile?.year_of_study || 2,
          isTeam: Boolean(isTeam),
          teamName: team?.team_name || 'Solo Participant',
          teamRole,
          teamMemberId: cert.team_member_id || member?.id,
          isLeader: Boolean(member?.is_leader),
          attendanceVerified: true,
          registrationId: ctx?.registrationId || team?.registration_id,
          eventStartDate,
          eventEndDate,
        });
      });

      setCertificates(mappedItems);
    } catch (err: any) {
      console.error('Failed to load certificates:', err);
      setError(err.message || 'An unexpected error occurred while loading certificates.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStudentCertificates();
  }, [user]);

  // Modal Scroll Lock and ESC Key Handling
  useScrollLock(Boolean(selectedCert));

  useEffect(() => {
    if (!selectedCert) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedCert(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedCert]);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const handleDownloadPdf = async (cert: StudentCertificateItem) => {
    if (!cert.certificateCode || cert.status !== 'UNLOCKED') return;
    downloadCertificateAsPdf({
      studentName: cert.studentName,
      rollNumber: cert.rollNumber,
      department: cert.department,
      year: cert.year,
      college: cert.college,
      eventName: cert.eventName,
      categoryName: cert.categoryName,
      subEventName: cert.subEventName,
      achievement: cert.type,
      teamName: cert.teamName,
      teamRole: cert.teamRole,
      certificateCode: cert.certificateCode,
      issuedAt: cert.issuedAt,
      chairmanName: CHAIRMAN_NAME,
      principalName: PRINCIPAL_NAME,
      eventStartDate: cert.eventStartDate,
      eventEndDate: cert.eventEndDate,
      logoUrl: '/kits_logo_official.jpg',
      naacLogoUrl: '/naac_a_logo.png',
    });
  };

  const handleDownloadImage = async (cert: StudentCertificateItem) => {
    if (!cert.certificateCode || cert.status !== 'UNLOCKED') return;
    try {
      await downloadCertificateAsHighResImage({
        studentName: cert.studentName,
        rollNumber: cert.rollNumber,
        department: cert.department,
        year: cert.year,
        college: cert.college,
        eventName: cert.eventName,
        categoryName: cert.categoryName,
        subEventName: cert.subEventName,
        achievement: cert.type,
        teamName: cert.teamName,
        teamRole: cert.teamRole,
        certificateCode: cert.certificateCode,
        qrDataUrl: generateCertificateQrDataUrl(cert.certificateCode, 280),
        issuedAt: cert.issuedAt,
        chairmanName: CHAIRMAN_NAME,
        principalName: PRINCIPAL_NAME,
        eventStartDate: cert.eventStartDate,
        eventEndDate: cert.eventEndDate,
        logoUrl: '/kits_logo_official.jpg',
        naacLogoUrl: '/naac_a_logo.png',
      });
    } catch (err) {
      console.error('Failed to download certificate image:', err);
    }
  };

  const handleViewCertificate = (cert: StudentCertificateItem) => {
    if (cert.status !== 'UNLOCKED') return;
    setSelectedCert(cert);
  };


  // Group certificates into Participation vs Achievements
  const participationCertificates = useMemo(() => {
    return certificates.filter((c) => c.type === 'PARTICIPANT');
  }, [certificates]);

  const achievementCertificates = useMemo(() => {
    return certificates.filter(
      (c) => (c.type === 'WINNER' || c.type === 'RUNNER' || c.type === 'THIRD_PLACE') && c.status === 'UNLOCKED'
    );
  }, [certificates]);

  const groupedParticipation = useMemo(() => {
    const groups: {
      key: string;
      isTeam: boolean;
      teamName: string;
      subEventName: string;
      eventName: string;
      certificates: StudentCertificateItem[];
    }[] = [];

    const map = new Map<string, (typeof groups)[0]>();

    participationCertificates.forEach((cert) => {
      const key = cert.isTeam
        ? `team-${cert.registrationId || cert.teamName}-${cert.subEventId}`
        : `solo-${cert.id}`;
      if (!map.has(key)) {
        const group = {
          key,
          isTeam: cert.isTeam,
          teamName: cert.teamName,
          subEventName: cert.subEventName,
          eventName: cert.eventName,
          certificates: [],
        };
        map.set(key, group);
        groups.push(group);
      }
      map.get(key)!.certificates.push(cert);
    });

    return groups;
  }, [participationCertificates]);

  const groupedAchievements = useMemo(() => {
    const groups: {
      key: string;
      isTeam: boolean;
      teamName: string;
      subEventName: string;
      eventName: string;
      certificates: StudentCertificateItem[];
    }[] = [];

    const map = new Map<string, (typeof groups)[0]>();

    achievementCertificates.forEach((cert) => {
      const key = cert.isTeam
        ? `team-${cert.registrationId || cert.teamName}-${cert.subEventId}`
        : `solo-${cert.id}`;
      if (!map.has(key)) {
        const group = {
          key,
          isTeam: cert.isTeam,
          teamName: cert.teamName,
          subEventName: cert.subEventName,
          eventName: cert.eventName,
          certificates: [],
        };
        map.set(key, group);
        groups.push(group);
      }
      map.get(key)!.certificates.push(cert);
    });

    return groups;
  }, [achievementCertificates]);

  const multiMemberParticipationGroups = useMemo(() => {
    return groupedParticipation.filter((g) => g.isTeam && g.certificates.length > 1);
  }, [groupedParticipation]);

  const individualParticipationCerts = useMemo(() => {
    const multiMemberCertIds = new Set(
      multiMemberParticipationGroups.flatMap((g) => g.certificates.map((c) => c.id))
    );
    return participationCertificates.filter((c) => !multiMemberCertIds.has(c.id));
  }, [participationCertificates, multiMemberParticipationGroups]);

  const multiMemberAchievementGroups = useMemo(() => {
    return groupedAchievements.filter((g) => g.isTeam && g.certificates.length > 1);
  }, [groupedAchievements]);

  const individualAchievementCerts = useMemo(() => {
    const multiMemberCertIds = new Set(
      multiMemberAchievementGroups.flatMap((g) => g.certificates.map((c) => c.id))
    );
    return achievementCertificates.filter((c) => !multiMemberCertIds.has(c.id));
  }, [achievementCertificates, multiMemberAchievementGroups]);

  if (isLoading) return <LoadingState message="Loading your official credentials..." />;
  if (error) return <ErrorState message={error} onRetry={fetchStudentCertificates} />;

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16 font-sans page-enter">
      {/* =========================================================================
          PAGE HEADER
          ========================================================================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-2xl bg-amber-500/10 text-amber-600 border border-amber-500/20 shadow-2xs">
              <Award className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
                Certificates
              </h1>
              <p className="mt-0.5 text-xs sm:text-sm text-gray-500">
                View your participation and achievement credentials.
              </p>
            </div>
          </div>
        </div>

        <Link
          to="/verify"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white border border-gray-200 text-xs font-bold text-gray-700 hover:text-kits-blue hover:border-blue-200 transition shadow-2xs kits-btn-fill-outline-blue shrink-0"
        >
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <span>Public Verification Portal</span>
        </Link>
      </div>

      {/* =========================================================================
          SUMMARY KPI STRIP
          ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-2xs flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-blue-50 text-kits-blue shrink-0">
            <FileCheck className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
              Total Issued
            </span>
            <span className="text-xl font-black text-gray-900">
              {certificates.length}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-emerald-200/80 p-4 shadow-2xs flex items-center gap-3.5 bg-gradient-to-br from-white to-emerald-50/30">
          <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-700 shrink-0">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">
              Participation
            </span>
            <span className="text-xl font-black text-emerald-900">
              {participationCertificates.length}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-amber-200/80 p-4 shadow-2xs flex items-center gap-3.5 bg-gradient-to-br from-white to-amber-50/30 col-span-2 sm:col-span-1">
          <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 shrink-0">
            <Trophy className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">
              Achievements
            </span>
            <span className="text-xl font-black text-amber-900">
              {achievementCertificates.length}
            </span>
          </div>
        </div>
      </div>
      {/* =========================================================================
          COMPACT YOUR EVENT RESULTS SECTION (Authoritative Published Podium Only)
          ========================================================================= */}
      <StudentPublishedResults
        onDownloadAchievementPdf={(certCode) => {
          const cert = certificates.find((c) => c.certificateCode === certCode);
          if (cert) handleDownloadPdf(cert);
        }}
        onViewAchievement={(certCode) => {
          const cert = certificates.find((c) => c.certificateCode === certCode);
          if (cert) handleViewCertificate(cert);
        }}
      />

      {/* =========================================================================
          TWO PRIMARY TABS: [ 🎓 Participation ]   [ 🏆 Achievements ]
          ========================================================================= */}
      <div className="flex items-center gap-3 border-b border-gray-200 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('PARTICIPATION')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'PARTICIPATION'
              ? 'bg-emerald-700 text-white shadow-2xs'
              : 'text-gray-600 hover:text-emerald-800 hover:bg-emerald-50'
          }`}
        >
          <GraduationCap className="h-4 w-4" />
          <span>Participation</span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
            activeTab === 'PARTICIPATION' ? 'bg-emerald-900 text-white' : 'bg-gray-200 text-gray-700'
          }`}>
            {participationCertificates.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ACHIEVEMENTS')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'ACHIEVEMENTS'
              ? 'bg-amber-600 text-white shadow-2xs'
              : 'text-gray-600 hover:text-amber-800 hover:bg-amber-50'
          }`}
        >
          <Trophy className="h-4 w-4" />
          <span>Event Honors</span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
            activeTab === 'ACHIEVEMENTS' ? 'bg-amber-800 text-white' : 'bg-gray-200 text-gray-700'
          }`}>
            {achievementCertificates.length}
          </span>
        </button>

      </div>

      {/* =========================================================================
          TAB 1: 🎓 PARTICIPATION CERTIFICATES
          ========================================================================= */}
      {activeTab === 'PARTICIPATION' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-black tracking-tight text-gray-900 flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-emerald-600" />
              <span>Your Participation Certificates</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Awarded immediately upon verified attendance check-in for registered events and tracks.
            </p>
          </div>

          {participationCertificates.length === 0 ? (
            <div className="bg-white rounded-3xl border border-gray-200/90 p-8 sm:p-12 text-center space-y-4 max-w-xl mx-auto shadow-sm">
              <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200 shadow-2xs">
                <GraduationCap className="h-8 w-8 text-emerald-600" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-black text-gray-900 tracking-tight">
                  No Participation Certificates Yet
                </h3>
                <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">
                  Your participation certificates will appear here immediately after your attendance is recorded at your registered events.
                </p>
              </div>
              <div className="pt-3 flex flex-wrap items-center justify-center gap-3">
                <Link
                  to="/events"
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs kits-btn-fill-red"
                >
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Browse Upcoming Events</span>
                </Link>
                <Link
                  to="/my-registrations"
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-xs font-bold hover:bg-gray-50 transition shadow-2xs kits-btn-fill-outline-blue"
                >
                  <span>View My Passes</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-6 w-full">
              {/* Multi-member team grouped certificates */}
              {multiMemberParticipationGroups.map((group) => (
                <div key={group.key} className="p-5 sm:p-6 bg-slate-50/80 rounded-3xl border border-slate-200 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-kits-blue text-white shadow-2xs">
                        <Users className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-gray-900 tracking-tight">
                          {group.teamName} • {group.subEventName}
                        </h3>
                        <span className="text-[11px] font-bold text-gray-500">
                          {group.eventName} • {group.certificates.length} Team Participants
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {group.certificates.map((cert) => (
                      <CertificateCard
                        key={cert.id}
                        cert={cert}
                        onView={() => handleViewCertificate(cert)}
                        onDownloadPdf={() => handleDownloadPdf(cert)}
                        onDownloadImage={() => handleDownloadImage(cert)}
                        copiedCode={copiedCode}
                        onCopyCode={handleCopyCode}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Individual / Solo certificates side-by-side in responsive 2-column grid */}
              {individualParticipationCerts.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                  {individualParticipationCerts.map((cert) => (
                    <CertificateCard
                      key={cert.id}
                      cert={cert}
                      onView={() => handleViewCertificate(cert)}
                      onDownloadPdf={() => handleDownloadPdf(cert)}
                      onDownloadImage={() => handleDownloadImage(cert)}
                      copiedCode={copiedCode}
                      onCopyCode={handleCopyCode}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* =========================================================================
          TAB 2: 🏆 ACHIEVEMENTS
          ========================================================================= */}
      {activeTab === 'ACHIEVEMENTS' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-black tracking-tight text-gray-900 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-600" />
              <span>Your Achievements</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Official merit and excellence credentials awarded for securing podium rankings.
            </p>
          </div>

          {achievementCertificates.length === 0 ? (
            <div className="bg-white rounded-3xl border border-gray-200/90 p-8 sm:p-12 text-center space-y-4 max-w-xl mx-auto shadow-sm">
              <div className="w-16 h-16 rounded-3xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200 shadow-2xs">
                <Trophy className="h-8 w-8 text-amber-500" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-black text-gray-900 tracking-tight">
                  No achievements yet
                </h3>
                <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">
                  Your participation certificates are available separately in the Participation tab.
                </p>
              </div>
              <div className="pt-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('PARTICIPATION')}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-700 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-800 transition shadow-2xs cursor-pointer"
                >
                  <GraduationCap className="h-4 w-4" />
                  <span>Go to Participation Certificates</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6 w-full">
              {/* Multi-member team grouped achievement certificates */}
              {multiMemberAchievementGroups.map((group) => (
                <div key={group.key} className="p-5 sm:p-6 bg-amber-50/50 rounded-3xl border border-amber-200/80 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/60 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-amber-500 text-white shadow-2xs">
                        <Trophy className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-gray-900 tracking-tight">
                          {group.teamName} • {group.subEventName}
                        </h3>
                        <span className="text-[11px] font-bold text-gray-500">
                          {group.eventName} • {group.certificates.length} Team Participants
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {group.certificates.map((cert) => (
                      <CertificateCard
                        key={cert.id}
                        cert={cert}
                        onView={() => handleViewCertificate(cert)}
                        onDownloadPdf={() => handleDownloadPdf(cert)}
                        onDownloadImage={() => handleDownloadImage(cert)}
                        copiedCode={copiedCode}
                        onCopyCode={handleCopyCode}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Individual / Solo achievement certificates side-by-side in responsive 2-column grid */}
              {individualAchievementCerts.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                  {individualAchievementCerts.map((cert) => (
                    <CertificateCard
                      key={cert.id}
                      cert={cert}
                      onView={() => handleViewCertificate(cert)}
                      onDownloadPdf={() => handleDownloadPdf(cert)}
                      onDownloadImage={() => handleDownloadImage(cert)}
                      copiedCode={copiedCode}
                      onCopyCode={handleCopyCode}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}



      {/* =========================================================================
          OFFICIAL INSTITUTIONAL CERTIFICATE MODAL
          ========================================================================= */}
      {selectedCert && selectedCert.status !== 'LOCKED' && createPortal(
        <div 
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-hidden modal-overlay-animate"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedCert(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cert-modal-title"
        >
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-3xl w-full max-h-[92vh] sm:max-h-[90vh] flex flex-col shadow-2xl border border-gray-200 relative overflow-hidden modal-dialog-animate">
            {/* Modal Controls Header */}
            <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-3 sm:p-5 bg-white z-10">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 shrink-0">
                  <Award className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 id="cert-modal-title" className="text-xs font-black uppercase text-gray-900 tracking-tight truncate">
                    Official Institutional Credential
                  </h3>
                  <p className="text-[10px] text-gray-500 font-mono truncate">
                    {selectedCert.certificateCode}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <DownloadButton
                  onDownload={() => handleDownloadPdf(selectedCert)}
                  label="Download PDF"
                  preparingLabel="Preparing PDF..."
                  downloadingLabel="Generating PDF..."
                  completedLabel="PDF Downloaded"
                  variant="primary"
                  size="sm"
                  title="Download Certificate as Landscape PDF"
                />

                <DownloadButton
                  onDownload={() => handleDownloadImage(selectedCert)}
                  label="Download Image"
                  preparingLabel="Preparing Image..."
                  downloadingLabel="Rendering PNG..."
                  completedLabel="Image Saved"
                  variant="secondary"
                  size="sm"
                  title="Download Certificate as High-Resolution PNG"
                />

                <Link
                  to={`/verify/${selectedCert.certificateCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-kits-blue text-[11px] sm:text-xs font-bold transition flex items-center gap-1 cursor-pointer kits-btn-fill-outline-blue"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Verify Online</span>
                </Link>

                <button
                  type="button"
                  onClick={() => setSelectedCert(null)}
                  className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
                  title="Close Preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Certificate Frame */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 sm:p-5 min-h-0 bg-slate-100/70">
              <div 
                id="student-certificate-canvas" 
                className="relative bg-white text-center p-4 sm:p-7 md:p-8 rounded-2xl shadow-xl max-w-full overflow-hidden border-[3px] sm:border-[4px] border-[#C8102E] outline outline-1 outline-[#003366] -outline-offset-[6px] sm:-outline-offset-[8px]"
              >
                {/* Inset Hairline Technical Frame */}
                <div className="absolute inset-[8px] sm:inset-[12px] border border-[#CBD5E1] pointer-events-none rounded-lg"></div>

                {/* Corner Decorative Waves (SVG-based Institutional Borders) */}
                {/* Top-Left Decorative Wave */}
                <svg className="absolute top-0 left-0 w-36 sm:w-56 md:w-64 h-36 sm:h-56 md:h-64 pointer-events-none" viewBox="0 0 200 200" fill="none">
                  <path d="M0 0 L180 0 C140 35 60 90 0 170 Z" fill="#003366" />
                  <path d="M140 0 C100 60 40 120 0 190 L0 150 C35 90 85 45 105 0 Z" fill="#C8102E" />
                  <path d="M150 0 C110 55 50 110 0 180" stroke="#FFFFFF" strokeWidth="2" />
                </svg>

                {/* Top-Right Decorative Wave */}
                <svg className="absolute top-0 right-0 w-36 sm:w-56 md:w-64 h-36 sm:h-56 md:h-64 pointer-events-none" viewBox="0 0 200 200" fill="none">
                  <path d="M200 0 L20 0 C60 35 140 90 200 170 Z" fill="#003366" />
                  <path d="M60 0 C100 60 160 120 200 190 L200 150 C165 90 115 45 95 0 Z" fill="#C8102E" />
                  <path d="M50 0 C90 55 150 110 200 180" stroke="#FFFFFF" strokeWidth="2" />
                </svg>

                {/* Bottom Sweeping Institutional Wave (Refined Lower Profile) */}
                <svg className="absolute bottom-0 left-0 right-0 w-full h-12 sm:h-16 md:h-20 pointer-events-none" viewBox="0 0 1000 80" preserveAspectRatio="none" fill="none">
                  <path d="M0 80 L0 25 C180 35 340 60 500 60 C660 60 820 35 1000 25 L1000 80 Z" fill="#003366" />
                  <path d="M0 45 C180 52 340 70 500 70 C660 70 820 52 1000 45 L1000 62 C820 68 660 78 500 78 C340 78 180 68 0 62 Z" fill="#C8102E" />
                  <path d="M0 45 C180 52 340 70 500 70 C660 70 820 52 1000 45" stroke="#FFFFFF" strokeWidth="1.5" />
                </svg>

                {/* Subtle Centered Background Watermark (Official KITS Emblem) */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
                  <div className="relative w-48 h-48 sm:w-72 sm:h-72 md:w-96 md:h-96 rounded-full overflow-hidden">
                    <img
                      src="/kits_logo_official.jpg"
                      alt=""
                      aria-hidden="true"
                      className="w-full h-full object-cover opacity-[0.04]"
                    />
                    <div className="absolute inset-0 rounded-full border border-[#003366] border-dashed opacity-[0.035]"></div>
                    <div className="absolute -inset-2 rounded-full border border-[#C8102E] opacity-[0.025]"></div>
                  </div>
                </div>

                {/* Content Container */}
                <div className="relative z-10 space-y-3 sm:space-y-4">
                  {/* Institutional Header (Large Prominent Crest & Letterhead) */}
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 md:gap-8 px-2 sm:px-4 pt-1">
                    {/* Left: Official KITS Logo (Substantially Enlarged & Balanced) */}
                    <div className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-2 border-amber-400 shadow-2xs shrink-0 flex items-center justify-center bg-white">
                      <img
                        src="/kits_logo_official.jpg"
                        alt="KITS Logo"
                        className="w-full h-full object-cover rounded-full"
                      />
                    </div>

                    {/* Center: Institutional Letterhead (Prominent & Commanding) */}
                    <div className="text-center space-y-0.5 sm:space-y-1 font-['Montserrat']">
                      <div className="tracking-tight leading-none">
                        <span className="text-2xl sm:text-3xl md:text-4xl font-black text-[#C8102E]">KITS </span>
                        <span className="text-2xl sm:text-3xl md:text-4xl font-black text-[#003366]">AKSHAR</span>
                      </div>
                      <div className="inline-block border-b-2 border-[#003366] pb-0.5">
                        <span className="text-sm sm:text-base md:text-lg font-extrabold uppercase tracking-wide text-[#003366] block">
                          INSTITUTE OF TECHNOLOGY
                        </span>
                      </div>
                      <span className="text-[11px] sm:text-xs md:text-sm font-bold uppercase tracking-[0.3em] text-[#003366] block">
                        AUTONOMOUS
                      </span>
                      <span className="text-[9.5px] sm:text-xs md:text-[13px] font-semibold text-slate-600 block">
                        Approved by AICTE, New Delhi | Affiliated to JNTUK, Kakinada
                      </span>
                    </div>

                    {/* Right: Official NAAC A-Grade Logo (Substantially Enlarged & Balanced) */}
                    <div className="shrink-0 flex items-center justify-center">
                      <img
                        src="/naac_a_logo.png"
                        alt="NAAC Accredited Grade A"
                        className="w-24 sm:w-32 md:w-36 h-auto object-contain"
                      />
                    </div>
                  </div>

                  {/* Header Dual-Rule Divider with Central Diamond */}
                  <div className="w-full max-w-2xl mx-auto relative flex items-center justify-center py-1">
                    <div className="w-full h-[1.5px] bg-[#003366]"></div>
                    <div className="absolute top-[5px] w-[85%] h-[1px] bg-[#C8102E]"></div>
                    <div className="absolute w-2.5 h-2.5 bg-[#003366] border border-[#C8102E] rotate-45 flex items-center justify-center shadow-2xs">
                      <div className="w-1 h-1 bg-[#C8102E]"></div>
                    </div>
                  </div>

                  {/* Institutional Event Header & Certificate Title */}
                  <div className="space-y-1 pt-0.5">
                    {/* Event Name with Symmetrical Diamond Dividers */}
                    <div className="flex items-center justify-center gap-2 sm:gap-3">
                      <div className="w-8 sm:w-16 h-[1.5px] bg-[#C8102E] relative flex items-center justify-end">
                        <div className="w-1.5 h-1.5 bg-[#C8102E] rotate-45 -mr-1"></div>
                      </div>
                      <span className="text-base sm:text-xl md:text-2xl font-black uppercase tracking-wider text-[#003366] font-['Cinzel']">
                        {selectedCert.eventName}
                      </span>
                      <div className="w-8 sm:w-16 h-[1.5px] bg-[#C8102E] relative flex items-center justify-start">
                        <div className="w-1.5 h-1.5 bg-[#C8102E] rotate-45 -ml-1"></div>
                      </div>
                    </div>

                    {/* Certificate Title Hierarchy */}
                    {selectedCert.type === 'WINNER' ? (
                      <div className="space-y-0.5 pt-0.5">
                        <span className="text-xl sm:text-3xl md:text-4xl font-bold uppercase tracking-[0.15em] text-[#C8102E] block font-['Cinzel']">
                          CERTIFICATE
                        </span>
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-6 sm:w-10 h-[1.5px] bg-[#C8102E]"></div>
                          <span className="text-xs sm:text-base font-bold uppercase tracking-widest text-[#C8102E] block font-['Cinzel']">
                            OF EXCELLENCE
                          </span>
                          <div className="w-6 sm:w-10 h-[1.5px] bg-[#C8102E]"></div>
                        </div>
                        <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-[#003366] block pt-0.5 font-['Montserrat']">
                          1ST PLACE • WINNER
                        </span>
                      </div>
                    ) : selectedCert.type === 'RUNNER' ? (
                      <div className="space-y-0.5 pt-0.5">
                        <span className="text-xl sm:text-3xl md:text-4xl font-bold uppercase tracking-[0.15em] text-[#C8102E] block font-['Cinzel']">
                          CERTIFICATE
                        </span>
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-6 sm:w-10 h-[1.5px] bg-[#C8102E]"></div>
                          <span className="text-xs sm:text-base font-bold uppercase tracking-widest text-[#C8102E] block font-['Cinzel']">
                            OF MERIT
                          </span>
                          <div className="w-6 sm:w-10 h-[1.5px] bg-[#C8102E]"></div>
                        </div>
                        <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-[#003366] block pt-0.5 font-['Montserrat']">
                          2ND PLACE • RUNNER-UP
                        </span>
                      </div>
                    ) : selectedCert.type === 'THIRD_PLACE' ? (
                      <div className="space-y-0.5 pt-0.5">
                        <span className="text-xl sm:text-3xl md:text-4xl font-bold uppercase tracking-[0.15em] text-[#C8102E] block font-['Cinzel']">
                          CERTIFICATE
                        </span>
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-6 sm:w-10 h-[1.5px] bg-[#C8102E]"></div>
                          <span className="text-xs sm:text-base font-bold uppercase tracking-widest text-[#C8102E] block font-['Cinzel']">
                            OF MERIT
                          </span>
                          <div className="w-6 sm:w-10 h-[1.5px] bg-[#C8102E]"></div>
                        </div>
                        <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-[#003366] block pt-0.5 font-['Montserrat']">
                          3RD PLACE
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-0.5 pt-0.5">
                        <span className="text-xl sm:text-3xl md:text-4xl font-bold uppercase tracking-[0.15em] text-[#002B49] block font-['Cinzel']">
                          CERTIFICATE
                        </span>
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-6 sm:w-12 h-[1.5px] bg-[#C8102E]"></div>
                          <span className="text-xs sm:text-base font-bold uppercase tracking-widest text-[#C8102E] block font-['Cinzel']">
                            OF PARTICIPATION
                          </span>
                          <div className="w-6 sm:w-12 h-[1.5px] bg-[#C8102E]"></div>
                        </div>
                      </div>
                    )}

                    <p className="text-xs sm:text-sm md:text-base text-slate-500 font-semibold italic font-['Cormorant_Garamond'] pt-1">
                      This Certificate Is Proudly Presented To
                    </p>
                  </div>

                  {/* Student Full Name Centerpiece */}
                  <div className="space-y-1">
                    <div className="relative inline-block max-w-[95%]">
                      <span className="hidden sm:inline-block absolute -left-4 top-1 text-slate-300 font-mono text-xl select-none">[</span>
                      <h3 className="text-2xl sm:text-4xl md:text-5xl font-bold text-slate-900 px-4 sm:px-6 uppercase tracking-tight break-words font-['Cormorant_Garamond']">
                        {selectedCert.studentName}
                      </h3>
                      <span className="hidden sm:inline-block absolute -right-4 top-1 text-slate-300 font-mono text-xl select-none">]</span>

                      {/* Recipient Underline with Terminal Diamond Nodes */}
                      <div className="relative mx-auto mt-1 w-full flex items-center justify-center">
                        <div className="w-full h-[2.5px] bg-[#C8102E]"></div>
                        <div className="absolute -left-1 w-2 h-2 bg-[#C8102E] rotate-45"></div>
                        <div className="absolute -right-1 w-2 h-2 bg-[#C8102E] rotate-45"></div>
                        <div className="absolute w-1.5 h-1.5 bg-[#003366] border border-[#C8102E] rotate-45"></div>
                      </div>
                      <div className="w-2/3 h-[1px] bg-[#003366] mx-auto mt-0.5"></div>
                    </div>

                    <p className="text-xs sm:text-sm md:text-base font-bold text-slate-800 pt-0.5 font-['Montserrat']">
                      Roll No: {selectedCert.rollNumber}   •   {selectedCert.department} (Year {selectedCert.year})
                    </p>
                    <p className="text-xs sm:text-sm md:text-base text-[#003366] font-extrabold font-['Montserrat']">
                      {selectedCert.college}
                    </p>
                  </div>

                  {/* Typographic Event Description Narrative (Comfortable Reading Width & Increased Scale) */}
                  <p className="text-xs sm:text-sm md:text-base text-slate-800 max-w-2xl mx-auto leading-relaxed font-medium px-2 font-['Montserrat']">
                    has {selectedCert.type === 'WINNER'
                      ? 'secured 1st Place (Winner)'
                      : selectedCert.type === 'RUNNER'
                      ? 'secured 2nd Place (Runner-Up)'
                      : selectedCert.type === 'THIRD_PLACE'
                      ? 'secured 3rd Place'
                      : 'actively participated'}{' '}
                    {selectedCert.isTeam && (
                      <>
                        as <strong>{selectedCert.teamRole || 'Team Leader'}</strong> of team{' '}
                        <strong className="text-[#003366]">{selectedCert.teamName}</strong>{' '}
                      </>
                    )}
                    in the event <strong className="text-slate-900 font-black">"{selectedCert.eventName}"</strong>{' '}
                    {selectedCert.eventStartDate && selectedCert.eventEndDate && selectedCert.eventStartDate !== selectedCert.eventEndDate
                      ? `held from ${new Date(selectedCert.eventStartDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} to ${new Date(selectedCert.eventEndDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`
                      : selectedCert.eventStartDate
                      ? `held on ${new Date(selectedCert.eventStartDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`
                      : selectedCert.issuedAt
                      ? `held in ${new Date(selectedCert.issuedAt).getFullYear()}`
                      : 'held in 2026'
                    }, in the sub-event <strong className="text-[#C8102E] font-bold">"{selectedCert.subEventName}"</strong>, organized by KITS Akshar Institute of Technology, Yanamadala, Guntur, Andhra Pradesh.
                  </p>

                  {/* Certificate Number & Issue Date in Middle-to-Lower Central Region */}
                  <div className="flex flex-col items-center justify-center pt-1 space-y-1 font-['Montserrat']">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-[#C8102E] rotate-45"></div>
                      <span className="font-mono text-xs sm:text-sm font-bold text-slate-900 select-all">
                        Certificate No: {selectedCert.certificateCode}
                      </span>
                      <div className="w-1.5 h-1.5 bg-[#C8102E] rotate-45"></div>
                    </div>
                    <span className="text-[10px] sm:text-xs text-slate-500 font-semibold">
                      Issued on: {selectedCert.issuedAt ? new Date(selectedCert.issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '15 Sept 2026'}
                    </span>
                  </div>

                  {/* Lower Section: Signatures (Left & Center-Right) + QR Code (Lower-Right) */}
                  <div className="pt-4 sm:pt-6 border-t border-slate-200/80 flex flex-col sm:flex-row items-center sm:items-end justify-between gap-4 px-2 sm:px-8 text-center relative font-['Montserrat']">
                    {/* Chairman (Left) */}
                    <div className="space-y-1 text-center min-w-0">
                      <div className="font-['Cormorant_Garamond'] italic font-bold text-lg sm:text-2xl text-[#8B0000] truncate">
                        K. Subba Rao
                      </div>
                      <div className="relative w-28 sm:w-40 mx-auto">
                        <div className="border-t-2 border-[#003366]"></div>
                        <div className="absolute top-[-3px] left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#C8102E] rotate-45"></div>
                      </div>
                      <span className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-slate-900 block truncate">
                        CHAIRMAN
                      </span>
                      <span className="text-[9px] sm:text-[11px] text-slate-500 font-bold block truncate">
                        {CHAIRMAN_NAME}
                      </span>
                    </div>

                    {/* Principal (Center-Right) */}
                    <div className="space-y-1 text-center min-w-0">
                      <div className="font-['Cormorant_Garamond'] italic font-bold text-lg sm:text-2xl text-[#8B0000] truncate">
                        K. Rama Kotaiah
                      </div>
                      <div className="relative w-28 sm:w-40 mx-auto">
                        <div className="border-t-2 border-[#003366]"></div>
                        <div className="absolute top-[-3px] left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#C8102E] rotate-45"></div>
                      </div>
                      <span className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-slate-900 block truncate">
                        PRINCIPAL
                      </span>
                      <span className="text-[9px] sm:text-[11px] text-slate-500 font-bold block truncate">
                        {PRINCIPAL_NAME}
                      </span>
                    </div>

                    {/* Standalone Scannable QR Code (Lower-Right — NO surrounding card/box) */}
                    <div className="flex flex-col items-center justify-center shrink-0">
                      <div className="p-1.5 bg-white rounded-md shadow-2xs border border-slate-200 inline-block">
                        <QRCodeSVG
                          id={`cert-qr-${selectedCert.certificateCode}`}
                          value={`${window.location.origin}/verify/${selectedCert.certificateCode}`}
                          size={84}
                          level="H"
                          marginSize={1}
                        />
                      </div>
                      <span className="text-[11px] sm:text-xs font-black text-slate-900 mt-1 block">
                        Scan to Verify
                      </span>
                      <div className="w-8 h-[1.5px] bg-[#C8102E] mt-0.5"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/**
 * Reusable Certificate Card Component
 */
function CertificateCard({
  cert,
  onView,
  onDownloadPdf,
  onDownloadImage,
  copiedCode,
  onCopyCode,
}: {
  cert: StudentCertificateItem;
  onView: () => void;
  onDownloadPdf: () => void;
  onDownloadImage: () => void;
  copiedCode: string | null;
  onCopyCode: (code: string) => void;
}) {
  const isLocked = cert.status === 'LOCKED';
  const isWinner = cert.type === 'WINNER';
  const isRunner = cert.type === 'RUNNER';
  const isThird = cert.type === 'THIRD_PLACE';
  const isPodium = isWinner || isRunner || isThird;

  return (
    <div className={`bg-white rounded-3xl border shadow-sm overflow-hidden flex flex-col justify-between hover:shadow-md transition group ${
      isLocked
        ? 'border-amber-200/90'
        : isWinner 
        ? 'border-amber-300 ring-1 ring-amber-200/50' 
        : isRunner 
        ? 'border-slate-300 ring-1 ring-slate-200/50' 
        : isThird 
        ? 'border-orange-300 ring-1 ring-orange-200/50' 
        : 'border-emerald-200/80'
    }`}>
      {/* Card Header Banner */}
      <div className={`px-6 py-4 border-b flex items-center justify-between ${
        isLocked
          ? 'bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-transparent border-amber-200/60'
          : isWinner
          ? 'bg-gradient-to-r from-amber-500/15 via-amber-400/10 to-transparent border-amber-200'
          : isRunner
          ? 'bg-gradient-to-r from-slate-400/15 via-slate-300/10 to-transparent border-slate-200'
          : isThird
          ? 'bg-gradient-to-r from-orange-500/15 via-orange-400/10 to-transparent border-orange-200'
          : 'bg-gradient-to-r from-emerald-500/10 via-emerald-400/5 to-transparent border-emerald-100'
      }`}>
        <div>
          <span className="text-[10px] font-black uppercase tracking-wider text-kits-blue block">
            {cert.eventName} {cert.categoryName ? `• ${cert.categoryName}` : ''}
          </span>
          <h3 className="text-base font-black text-gray-900 tracking-tight mt-0.5">
            {cert.subEventName}
          </h3>
        </div>

        {/* Badge */}
        {isLocked ? (
          <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border flex items-center gap-1.5 bg-amber-100 text-amber-900 border-amber-300 shadow-2xs">
            <Lock className="h-3 w-3 text-amber-700" />
            <span>LOCKED</span>
          </span>
        ) : (
          <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border flex items-center gap-1.5 ${
            isWinner
              ? 'bg-amber-100 text-amber-900 border-amber-300 shadow-2xs'
              : isRunner
              ? 'bg-slate-200 text-slate-800 border-slate-300 shadow-2xs'
              : isThird
              ? 'bg-orange-100 text-orange-900 border-orange-300 shadow-2xs'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}>
            {isWinner ? (
              <>
                <Trophy className="h-3 w-3 text-amber-600" />
                <span>1st Winner</span>
              </>
            ) : isRunner ? (
              <>
                <Medal className="h-3 w-3 text-slate-600" />
                <span>2nd Runner</span>
              </>
            ) : isThird ? (
              <>
                <Medal className="h-3 w-3 text-orange-600" />
                <span>3rd Place</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                <span>Participation</span>
              </>
            )}
          </span>
        )}
      </div>

      {/* Card Body */}
      <div className="p-6 space-y-4">
        {/* Recipient info */}
        <div className="flex items-center justify-between text-xs pb-3 border-b border-gray-100">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              Recipient
            </span>
            <span className="font-bold text-gray-800">
              {cert.studentName} ({cert.rollNumber})
            </span>
            <div className="text-[11px] text-gray-500 font-medium">
              {[cert.college, cert.department, cert.year ? `Year ${cert.year}` : null].filter(Boolean).join(' • ')}
            </div>
          </div>

          <div className="text-right space-y-0.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              Participation Unit
            </span>
            <span className="font-bold text-gray-800 flex items-center gap-1 justify-end">
              {cert.isTeam ? <Users className="h-3.5 w-3.5 text-kits-blue" /> : <User className="h-3.5 w-3.5 text-gray-500" />}
              {cert.isTeam ? `${cert.teamName} (${cert.teamRole})` : 'Solo Participant'}
            </span>
          </div>
        </div>

        {/* Verification / Lock Box */}
        {isLocked ? (
          <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/80 space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded-xl bg-amber-100 text-amber-800 shrink-0 border border-amber-200">
                <Lock className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-black uppercase tracking-wider text-amber-900 block">
                  LOCKED
                </span>
                <p className="text-xs font-medium text-amber-800 leading-relaxed">
                  Complete the required event feedback to unlock your participation certificate.
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-amber-200/80 flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-800">
                Event feedback required
              </span>
              <Link
                to={cert.registrationId ? `/feedback?regId=${cert.registrationId}` : '/feedback'}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Give Feedback</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className={`p-4 rounded-2xl border space-y-2 ${
            isPodium 
              ? 'bg-amber-50/50 border-amber-200/80' 
              : 'bg-emerald-50/60 border-emerald-200'
          }`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-black flex items-center gap-1.5 ${
                isPodium ? 'text-amber-900' : 'text-emerald-800'
              }`}>
                <CheckCircle2 className={`h-4 w-4 ${isPodium ? 'text-amber-600' : 'text-emerald-600'}`} />
                Official Credential Unlocked & Verified
              </span>
              <span className="text-[10px] font-mono font-bold text-gray-500">
                {cert.issuedAt ? new Date(cert.issuedAt).toLocaleDateString('en-IN') : 'Verified'}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-gray-200/60">
              <span className="text-[10px] font-mono font-bold text-gray-700">
                {cert.certificateCode}
              </span>
              <button
                type="button"
                onClick={() => onCopyCode(cert.certificateCode)}
                className="text-[11px] text-kits-blue hover:text-blue-900 font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                {copiedCode === cert.certificateCode ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" /> 
                    <span className="text-emerald-600">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> 
                    <span>Copy Code</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Card Actions */}
      <div className="px-6 py-4 bg-gray-50/70 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
        {isLocked ? (
          <>
            <span className="text-xs font-bold text-gray-400 flex items-center gap-1">
              <Lock className="h-3.5 w-3.5" />
              <span>Preview & Downloads Locked</span>
            </span>

            <Link
              to={cert.registrationId ? `/feedback?regId=${cert.registrationId}` : '/feedback'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer kits-btn-fill-emerald"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Give Feedback</span>
            </Link>
          </>
        ) : (
          <>
            <Link
              to={`/verify/${cert.certificateCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-gray-500 hover:text-kits-blue transition inline-flex items-center gap-1"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              <span>Verify Credential</span>
            </Link>

            <div className="flex items-center gap-1.5 flex-wrap">
              <DownloadButton
                onDownload={onDownloadPdf}
                label="PDF"
                preparingLabel="..."
                downloadingLabel="..."
                completedLabel="Done"
                variant="secondary"
                size="sm"
                title="Download PDF Certificate"
              />

              <DownloadButton
                onDownload={onDownloadImage}
                label="PNG"
                preparingLabel="..."
                downloadingLabel="..."
                completedLabel="Done"
                variant="secondary"
                size="sm"
                title="Download PNG Certificate"
              />

              <button
                type="button"
                onClick={onView}
                className={`px-3 py-1.5 rounded-xl text-white text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer flex items-center gap-1 ${
                  isWinner 
                    ? 'bg-amber-600 hover:bg-amber-700 kits-btn-fill-gold' 
                    : 'bg-kits-blue hover:bg-blue-700 kits-btn-fill-blue'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>View</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
