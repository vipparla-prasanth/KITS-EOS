import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
  MessageSquare
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
  status: 'LOCKED' | 'UNLOCKED';
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
  attendanceVerified: boolean;
  registrationId?: string;
}

const CHAIRMAN_NAME = 'Sri. K. Subba Rao';
const PRINCIPAL_NAME = 'Dr. Kalluri Rama Kotaiah';

export function StudentCertificates() {
  const { user, profile } = useAuth();
  const [certificates, setCertificates] = useState<StudentCertificateItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Exactly two primary tabs: 'PARTICIPATION' (default) and 'ACHIEVEMENTS'
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

      // Process leader registrations
      (regData || []).forEach((reg: any) => {
        const team = Array.isArray(reg.teams) ? reg.teams[0] : reg.teams;
        const members = team?.team_members || [];
        const studentMember = members.find((m: any) => m.user_id === user.id) || 
                              members.find((m: any) => m.is_leader) || 
                              members[0];

        if (studentMember) {
          memberContextMap.set(studentMember.id, {
            subEvent: reg.sub_events,
            team,
            member: studentMember,
            registrationId: reg.id,
          });
        }
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
          attendanceVerified: true,
          registrationId: ctx?.registrationId || team?.registration_id,
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
    if (!cert.certificateCode || cert.status === 'LOCKED') return;
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
    });
  };

  const handleDownloadImage = async (cert: StudentCertificateItem) => {
    if (!cert.certificateCode || cert.status === 'LOCKED') return;
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
      });
    } catch (err) {
      console.error('Failed to download certificate image:', err);
    }
  };

  const handleViewCertificate = (cert: StudentCertificateItem) => {
    if (cert.status === 'LOCKED') return;
    setSelectedCert(cert);
  };


  // Group certificates into Participation vs Achievements
  const participationCertificates = useMemo(() => {
    return certificates.filter((c) => c.type === 'PARTICIPANT');
  }, [certificates]);

  const achievementCertificates = useMemo(() => {
    return certificates.filter((c) => c.type === 'WINNER' || c.type === 'RUNNER' || c.type === 'THIRD_PLACE');
  }, [certificates]);

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
          <span>🎓 Participation</span>
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
          <span>🏆 Achievements</span>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {participationCertificates.map((cert) => (
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
                  🏆 No achievements yet
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {achievementCertificates.map((cert) => (
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
                className="relative bg-white text-center p-4 sm:p-7 md:p-8 rounded-2xl shadow-xl max-w-full overflow-hidden border-[3.5px] sm:border-[4.5px] border-[#C8102E] outline outline-2 outline-[#003366] -outline-offset-[6px] sm:-outline-offset-[8px]"
              >
                {/* Subtle Inner Drafting Frame */}
                <div className="absolute inset-[10px] sm:inset-[14px] border border-[#CBD5E1] pointer-events-none rounded-lg"></div>

                {/* Precision Geometric Corner Brackets */}
                {/* Top-Left Bracket */}
                <div className="absolute top-[10px] left-[10px] sm:top-[14px] sm:left-[14px] w-6 h-6 sm:w-10 sm:h-10 pointer-events-none">
                  <div className="absolute top-0 left-0 w-full h-[2px] bg-[#003366]"></div>
                  <div className="absolute top-0 left-0 w-[2px] h-full bg-[#003366]"></div>
                  <div className="absolute top-[3px] left-[3px] sm:top-[4px] sm:left-[4px] w-[60%] h-[1.5px] bg-[#C8102E]"></div>
                  <div className="absolute top-[3px] left-[3px] sm:top-[4px] sm:left-[4px] w-[1.5px] h-[60%] bg-[#C8102E]"></div>
                  <div className="absolute top-[8px] left-[8px] sm:top-[12px] sm:left-[12px] w-1.5 h-1.5 sm:w-2 sm:h-2 bg-[#003366] rotate-45 border border-[#C8102E]"></div>
                </div>

                {/* Top-Right Bracket */}
                <div className="absolute top-[10px] right-[10px] sm:top-[14px] sm:right-[14px] w-6 h-6 sm:w-10 sm:h-10 pointer-events-none">
                  <div className="absolute top-0 right-0 w-full h-[2px] bg-[#003366]"></div>
                  <div className="absolute top-0 right-0 w-[2px] h-full bg-[#003366]"></div>
                  <div className="absolute top-[3px] right-[3px] sm:top-[4px] sm:right-[4px] w-[60%] h-[1.5px] bg-[#C8102E]"></div>
                  <div className="absolute top-[3px] right-[3px] sm:top-[4px] sm:right-[4px] w-[1.5px] h-[60%] bg-[#C8102E]"></div>
                  <div className="absolute top-[8px] right-[8px] sm:top-[12px] sm:right-[12px] w-1.5 h-1.5 sm:w-2 sm:h-2 bg-[#003366] rotate-45 border border-[#C8102E]"></div>
                </div>

                {/* Bottom-Left Bracket */}
                <div className="absolute bottom-[10px] left-[10px] sm:bottom-[14px] sm:left-[14px] w-6 h-6 sm:w-10 sm:h-10 pointer-events-none">
                  <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[#003366]"></div>
                  <div className="absolute bottom-0 left-0 w-[2px] h-full bg-[#003366]"></div>
                  <div className="absolute bottom-[3px] left-[3px] sm:bottom-[4px] sm:left-[4px] w-[60%] h-[1.5px] bg-[#C8102E]"></div>
                  <div className="absolute bottom-[3px] left-[3px] sm:bottom-[4px] sm:left-[4px] w-[1.5px] h-[60%] bg-[#C8102E]"></div>
                  <div className="absolute bottom-[8px] left-[8px] sm:bottom-[12px] sm:left-[12px] w-1.5 h-1.5 sm:w-2 sm:h-2 bg-[#003366] rotate-45 border border-[#C8102E]"></div>
                </div>

                {/* Bottom-Right Bracket */}
                <div className="absolute bottom-[10px] right-[10px] sm:bottom-[14px] sm:right-[14px] w-6 h-6 sm:w-10 sm:h-10 pointer-events-none">
                  <div className="absolute bottom-0 right-0 w-full h-[2px] bg-[#003366]"></div>
                  <div className="absolute bottom-0 right-0 w-[2px] h-full bg-[#003366]"></div>
                  <div className="absolute bottom-[3px] right-[3px] sm:bottom-[4px] sm:right-[4px] w-[60%] h-[1.5px] bg-[#C8102E]"></div>
                  <div className="absolute bottom-[3px] right-[3px] sm:bottom-[4px] sm:right-[4px] w-[1.5px] h-[60%] bg-[#C8102E]"></div>
                  <div className="absolute bottom-[8px] right-[8px] sm:bottom-[12px] sm:right-[12px] w-1.5 h-1.5 sm:w-2 sm:h-2 bg-[#003366] rotate-45 border border-[#C8102E]"></div>
                </div>

                {/* Subtle Background Watermark with Concentric Drafting Rings */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
                  <div className="relative w-64 h-64 sm:w-96 sm:h-96 md:w-[480px] md:h-[480px]">
                    <img
                      src="/college_logo.png"
                      alt=""
                      aria-hidden="true"
                      className="w-full h-full object-contain opacity-[0.04]"
                    />
                    <div className="absolute inset-0 rounded-full border border-[#003366] border-dashed opacity-[0.035]"></div>
                    <div className="absolute -inset-3 rounded-full border border-[#C8102E] opacity-[0.025]"></div>
                  </div>
                </div>

                {/* Content Container */}
                <div className="relative z-10 space-y-3 sm:space-y-5">
                  {/* Official College Banner Header */}
                  <div className="w-full flex flex-col items-center">
                    <img
                      src="/college_banner.png"
                      alt="KITS Akshar Institute of Technology"
                      className="w-full max-w-xl md:max-w-2xl h-auto object-contain"
                    />

                    {/* Architectural Dual-Rule Header Divider with Central Diamond */}
                    <div className="w-full mt-2 sm:mt-3 relative flex items-center justify-center">
                      <div className="w-full h-[1.5px] bg-[#003366]"></div>
                      <div className="absolute top-[3px] w-[90%] h-[1px] bg-[#C8102E]"></div>
                      <div className="absolute w-3 h-3 bg-[#003366] border border-[#C8102E] rotate-45 flex items-center justify-center shadow-2xs">
                        <div className="w-1 h-1 bg-[#C8102E]"></div>
                      </div>
                    </div>
                  </div>

                  {/* Institutional Event Header & Certificate Title */}
                  <div className="space-y-1">
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-slate-500 block">
                      {selectedCert.categoryName ? `${selectedCert.categoryName.toUpperCase()} • ANNUAL TECHNICAL FEST` : 'ANNUAL NATIONAL LEVEL TECHNICAL FEST'}
                    </span>
                    <span className="text-lg sm:text-2xl md:text-3xl font-black uppercase tracking-wider text-[#003366] block">
                      {selectedCert.eventName}
                    </span>

                    {/* Refined Section Divider */}
                    <div className="flex items-center justify-center gap-2 py-0.5">
                      <div className="w-12 sm:w-16 h-[1.5px] bg-[#C8102E]"></div>
                      <div className="w-1.5 h-1.5 bg-[#C8102E] rotate-45"></div>
                      <div className="w-12 sm:w-16 h-[1.5px] bg-[#C8102E]"></div>
                    </div>

                    {/* Certificate Title Hierarchy */}
                    {selectedCert.type === 'WINNER' ? (
                      <div className="space-y-0.5">
                        <span className="text-sm sm:text-xl font-black uppercase tracking-widest text-[#C8102E] block">
                          CERTIFICATE OF EXCELLENCE
                        </span>
                        <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#003366] block">
                          1ST PLACE • WINNER
                        </span>
                      </div>
                    ) : selectedCert.type === 'RUNNER' ? (
                      <div className="space-y-0.5">
                        <span className="text-sm sm:text-xl font-black uppercase tracking-widest text-[#C8102E] block">
                          CERTIFICATE OF MERIT
                        </span>
                        <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#003366] block">
                          2ND PLACE • RUNNER-UP
                        </span>
                      </div>
                    ) : selectedCert.type === 'THIRD_PLACE' ? (
                      <div className="space-y-0.5">
                        <span className="text-sm sm:text-xl font-black uppercase tracking-widest text-[#C8102E] block">
                          CERTIFICATE OF MERIT
                        </span>
                        <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#003366] block">
                          3RD PLACE
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm sm:text-xl font-black uppercase tracking-widest text-[#003366] block">
                        CERTIFICATE OF PARTICIPATION
                      </span>
                    )}

                    <p className="text-xs sm:text-sm text-slate-500 font-medium italic font-serif pt-1">
                      This Certificate Is Proudly Presented To
                    </p>
                  </div>

                  {/* Student Full Name & Institutional Credentials Centerpiece */}
                  <div className="space-y-1.5 sm:space-y-2">
                    <div className="relative inline-block max-w-[95%]">
                      {/* Recipient Framing Tick Brackets */}
                      <span className="hidden sm:inline-block absolute -left-4 top-1 text-slate-300 font-mono text-xl select-none">[</span>
                      <h3 className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-900 px-4 sm:px-6 uppercase tracking-tight break-words">
                        {selectedCert.studentName}
                      </h3>
                      <span className="hidden sm:inline-block absolute -right-4 top-1 text-slate-300 font-mono text-xl select-none">]</span>

                      {/* Recipient Underline with Terminal Diamond Nodes */}
                      <div className="relative mx-auto mt-1 w-full flex items-center justify-center">
                        <div className="w-full h-[3px] bg-[#C8102E]"></div>
                        <div className="absolute -left-1 w-2 h-2 bg-[#C8102E] rotate-45"></div>
                        <div className="absolute -right-1 w-2 h-2 bg-[#C8102E] rotate-45"></div>
                      </div>
                      <div className="w-2/3 h-[1px] bg-[#003366] mx-auto mt-0.5"></div>
                    </div>

                    <p className="text-xs sm:text-sm md:text-base font-bold text-slate-800 pt-0.5">
                      Roll No: {selectedCert.rollNumber}   •   {selectedCert.department} (Year {selectedCert.year})
                    </p>
                    <p className="text-[11px] sm:text-xs md:text-sm text-[#003366] font-bold">
                      {selectedCert.college}
                    </p>
                  </div>

                  {/* Typographic Event Description Narrative */}
                  <p className="text-xs sm:text-sm md:text-base text-slate-800 max-w-2xl mx-auto leading-relaxed font-medium px-2">
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
                    in the competition track{' '}
                    <strong className="text-[#003366] font-bold">"{selectedCert.subEventName}"</strong> during{' '}
                    <strong className="text-slate-900 font-black">{selectedCert.eventName}</strong>.
                  </p>

                  {/* System-Generated Verification Statement */}
                  <p className="text-[10px] sm:text-xs text-slate-500 italic max-w-lg mx-auto">
                    This is an authoritative system-generated certificate digitally verifiable through the KITS-EOS certificate verification system.
                  </p>

                  {/* Dedicated Digital Verification Cartouche */}
                  <div className="max-w-xs mx-auto bg-slate-50/90 border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                    {/* Header Tab */}
                    <div className="bg-[#003366] text-white text-[9px] sm:text-[10px] font-bold tracking-widest uppercase py-1 px-3 text-center">
                      DIGITALLY VERIFIED CREDENTIAL
                    </div>

                    {/* QR Code & Information */}
                    <div className="p-2.5 flex flex-col items-center justify-center space-y-1">
                      <div className="p-1.5 bg-white border border-slate-200 rounded-lg shadow-2xs inline-block">
                        <QRCodeSVG
                          id={`cert-qr-${selectedCert.certificateCode}`}
                          value={`${window.location.origin}/verify/${selectedCert.certificateCode}`}
                          size={84}
                          level="H"
                          marginSize={1}
                        />
                      </div>
                      <span className="font-mono text-xs sm:text-sm font-black text-slate-900 select-all">
                        {selectedCert.certificateCode}
                      </span>
                      <span className="font-mono text-[9px] sm:text-[11px] text-slate-500 font-semibold">
                        Issued: {selectedCert.issuedAt ? new Date(selectedCert.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Verified Digital Credential'}
                      </span>
                    </div>
                  </div>

                  {/* Official Institutional Signatures Block */}
                  <div className="pt-4 sm:pt-6 border-t border-slate-200 flex items-end justify-between px-4 sm:px-14 text-center relative">
                    {/* Horizontal connecting structural line */}
                    <div className="absolute top-0 left-8 right-8 h-[1px] bg-slate-200 border-t border-dashed border-slate-300 pointer-events-none"></div>

                    {/* Chairman */}
                    <div className="space-y-1 text-center min-w-0">
                      <div className="font-serif italic font-bold text-base sm:text-xl text-[#8B0000] truncate">
                        K. Subba Rao
                      </div>
                      <div className="relative w-28 sm:w-44 mx-auto">
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

                    {/* Principal */}
                    <div className="space-y-1 text-center min-w-0">
                      <div className="font-serif italic font-bold text-base sm:text-xl text-[#8B0000] truncate">
                        K. Rama Kotaiah
                      </div>
                      <div className="relative w-28 sm:w-44 mx-auto">
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
                  </div>

                  {/* Institutional Accreditation Footer Baseline */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[7px] sm:text-[9px] font-bold text-slate-400 tracking-wider uppercase px-2">
                    <span className="truncate">KITS AKSHAR INSTITUTE OF TECHNOLOGY • AUTONOMOUS</span>
                    <span className="hidden sm:inline-block">•</span>
                    <span className="truncate">ACCREDITED BY NAAC 'A' GRADE • AICTE APPROVED</span>
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
                <span>🏆 1st Winner</span>
              </>
            ) : isRunner ? (
              <>
                <Medal className="h-3 w-3 text-slate-600" />
                <span>🥈 2nd Runner</span>
              </>
            ) : isThird ? (
              <>
                <Medal className="h-3 w-3 text-orange-600" />
                <span>🥉 3rd Place</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                <span>🎓 Participation</span>
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
