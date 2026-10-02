import { QRCodeSVG } from 'qrcode.react';
import {
  Building2,
  Calendar,
  CheckCircle2,
  Code2,
  FileCheck,
  FileText,
  GraduationCap,
  IdCard,
  Image,
  MapPin,
  Printer,
  Signal,
  User,
  UserCheck
} from 'lucide-react';
import {
  downloadIdCardAsPdf,
  downloadIdCardAsHighResImage,
  downloadSvgAsPng,
  printDocument,
  type IdCardRenderOptions
} from '@kits-eos/shared';
import { DownloadButton } from '../ui/DownloadButton';

export interface IdCardProps {
  studentName: string;
  rollNumber: string;
  department: string;
  year: number | string;
  college: string;
  eventName: string;
  categoryName?: string;
  subEventName: string;
  participationType: string;
  teamName?: string;
  teamRole?: 'TEAM LEADER' | 'TEAM MEMBER' | 'SOLO PARTICIPANT' | string;
  registrationId: string;
  manualToken: string;
  qrIdentity?: string;
  qrPayload?: string;
  hideActions?: boolean;
  academicYear?: string;
}

export function DigitalIdCard(props: IdCardProps) {
  const {
    studentName,
    rollNumber,
    department,
    year,
    college,
    eventName,
    categoryName,
    subEventName,
    participationType,
    teamName,
    teamRole,
    registrationId,
    manualToken,
    qrIdentity,
    qrPayload,
    hideActions = false,
    academicYear = '2025-26',
  } = props;

  const cardId = `digital-id-card-${registrationId.slice(0, 8)}`;
  const qrSvgId = `qr-svg-${registrationId.slice(0, 8)}`;

  const encodedQrValue = qrIdentity || qrPayload || '';

  const exportOptions: IdCardRenderOptions = {
    studentName,
    rollNumber,
    department,
    year,
    college,
    eventName,
    categoryName,
    subEventName,
    participationType,
    teamName,
    teamRole,
    registrationId,
    manualToken,
    qrIdentity: encodedQrValue,
    qrSvgElementId: qrSvgId,
    academicYear,
  };

  const handleDownloadPdf = async () => {
    await downloadIdCardAsPdf(exportOptions);
  };

  const handleDownloadPng = async () => {
    await downloadIdCardAsHighResImage(exportOptions, 1);
  };

  const handleDownload4kPng = async () => {
    await downloadIdCardAsHighResImage(exportOptions, 2);
  };

  const handleDownloadQr = () => {
    downloadSvgAsPng(qrSvgId, `QR_${manualToken}`, `KITS-EOS • ${subEventName}`, manualToken);
  };

  const handlePrint = () => {
    printDocument(cardId);
  };

  return (
    <div className="space-y-4 font-sans">
      {/* 9:16 Portrait Credential Preview Container */}
      <div
        id={cardId}
        className="bg-white rounded-3xl border-2 border-slate-300 shadow-2xl overflow-hidden max-w-md w-full mx-auto relative select-none"
      >
        {/* =========================================================================
            1. HEADER BANNER (KITS Red sliced into Akshar Blue)
            ========================================================================= */}
        <div className="relative h-28 bg-[#8F0817] overflow-hidden flex items-stretch">
          {/* Left: KITS Red Section with College Branding */}
          <div className="relative z-10 flex-1 px-3 sm:px-4 py-2.5 flex items-center gap-2.5">
            <div className="h-14 w-14 rounded-full bg-white p-1 shrink-0 shadow-md ring-2 ring-black/10 flex items-center justify-center">
              <img
                src="/college_logo.png"
                alt="KITS Logo"
                className="h-full w-full object-contain"
              />
            </div>

            <div className="min-w-0 text-white leading-tight">
              <h1 className="text-sm sm:text-base font-black tracking-tight uppercase leading-none">
                KITS AKSHAR
              </h1>
              <div className="text-[10px] sm:text-[11px] font-extrabold tracking-tight uppercase text-white/95 mt-0.5">
                INSTITUTE OF TECHNOLOGY
              </div>
              <div className="text-[7.5px] sm:text-[8px] font-black tracking-wider text-amber-300 uppercase mt-1">
                CENTRAL EVENT OPERATIONS SYSTEM • KITS-EOS
              </div>
              <div className="text-[8px] sm:text-[8.5px] font-bold tracking-wider text-white/90 uppercase mt-0.5">
                OFFICIAL DIGITAL EVENT PASS • {academicYear}
              </div>
            </div>
          </div>

          {/* Right: Angled Akshar Blue Section with KITS-EOS Navigation Items */}
          <div
            className="w-36 sm:w-40 bg-[#002B49] relative z-20 flex flex-col justify-center px-3 py-2 text-white border-l-2 border-white/40 shadow-[-4px_0_12px_rgba(0,0,0,0.25)]"
            style={{ clipPath: 'polygon(16% 0, 100% 0, 100% 100%, 0 100%)' }}
          >
            <div className="pl-4">
              <div className="text-xs sm:text-sm font-black tracking-wider text-white uppercase text-center mb-1">
                KITS-EOS
              </div>
              <div className="text-[7.5px] sm:text-[8px] font-extrabold space-y-0.5 text-blue-100/90 tracking-wide uppercase">
                <div className="flex items-center gap-1">
                  <span>📅</span> <span>EVENTS</span>
                </div>
                <div className="flex items-center gap-1">
                  <span>👥</span> <span>PARTICIPATION</span>
                </div>
                <div className="flex items-center gap-1">
                  <span>✔</span> <span>ATTENDANCE</span>
                </div>
                <div className="flex items-center gap-1">
                  <span>📜</span> <span>CERTIFICATES</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Card Body Container */}
        <div className="p-3.5 sm:p-5 space-y-3.5 sm:space-y-4">
          {/* =========================================================================
              2. CARD TYPE RIBBON (Centered "INDIVIDUAL EVENT PASS")
              ========================================================================= */}
          <div className="text-center pt-1">
            <div className="flex items-center justify-center gap-3">
              <div className="h-px bg-slate-300 flex-1 max-w-[60px]" />
              <div className="flex items-center gap-1.5 text-[#C8102E]">
                <User className="h-5 w-5 fill-[#C8102E]/20" />
                <span className="text-lg sm:text-xl font-black uppercase tracking-wider">
                  INDIVIDUAL EVENT PASS
                </span>
              </div>
              <div className="h-px bg-slate-300 flex-1 max-w-[60px]" />
            </div>
            <p className="text-[8.5px] sm:text-[9.5px] font-extrabold uppercase tracking-widest text-slate-500 mt-0.5">
              SCAN FOR INDIVIDUAL ATTENDANCE AT THE EVENT
            </p>
          </div>

          {/* =========================================================================
              3. EVENT INFORMATION (Side-by-Side: Event Name & Sub Event)
              ========================================================================= */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <Calendar className="h-4 w-4 text-red-600" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[8.5px] font-black uppercase tracking-wider text-slate-400 block leading-tight">
                  EVENT NAME
                </span>
                <span className="font-black text-slate-900 text-xs sm:text-sm truncate block leading-tight">
                  {eventName}
                </span>
                {categoryName && (
                  <span className="text-[8.5px] font-extrabold text-slate-500 uppercase truncate block">
                    {categoryName}
                  </span>
                )}
              </div>
            </div>

            <div className="p-2.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                <Code2 className="h-4 w-4 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[8.5px] font-black uppercase tracking-wider text-slate-400 block leading-tight">
                  SUB EVENT
                </span>
                <span className="font-black text-[#002855] text-xs sm:text-sm truncate block leading-tight">
                  {subEventName}
                </span>
              </div>
            </div>
          </div>

          {/* =========================================================================
              4. PARTICIPATION TYPE BANNER
              ========================================================================= */}
          <div className="relative overflow-hidden bg-gradient-to-r from-[#003366] to-[#0A4D8C] rounded-2xl p-2.5 sm:p-3 text-white flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2.5 min-w-0 z-10">
              <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                <UserCheck className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <span className="text-[8px] sm:text-[8.5px] font-extrabold uppercase tracking-widest text-sky-200 block leading-tight">
                  PARTICIPATION TYPE
                </span>
                <span className="text-sm sm:text-base font-black tracking-tight uppercase truncate block leading-tight">
                  {participationType} PARTICIPANT {teamRole && teamRole !== 'SOLO PARTICIPANT' ? `• ${teamRole}` : ''}
                </span>
              </div>
            </div>
            <div className="absolute right-0 top-0 bottom-0 w-24 opacity-15 pointer-events-none flex gap-1.5 justify-end -skew-x-12 pr-2">
              <div className="w-2.5 bg-white h-full" />
              <div className="w-2.5 bg-white h-full" />
              <div className="w-2.5 bg-white h-full" />
            </div>
          </div>

          {/* =========================================================================
              5. PARTICIPANT IDENTITY SECTION
              ========================================================================= */}
          <div className="space-y-1.5">
            <div className="bg-[#C8102E] text-white px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-2xs">
              <User className="h-3.5 w-3.5 text-white" />
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider">
                PARTICIPANT DETAILS
              </span>
            </div>

            <div className="p-3 sm:p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-black text-slate-900 text-sm sm:text-base">
                  {studentName}
                </span>
                <span className="text-[8.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                  SOLO PARTICIPANT
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 text-xs">
                <div className="space-y-0.5">
                  <span className="text-[8.5px] font-extrabold uppercase text-slate-400 block">INSTITUTION</span>
                  <div className="flex items-center gap-1 text-[10.5px] text-slate-800 font-bold">
                    <Building2 className="h-3 w-3 text-slate-400 shrink-0" />
                    <span className="truncate">{college || 'KITS Akshar Institute of Technology'}</span>
                  </div>
                </div>

                <div className="space-y-0.5">
                  <span className="text-[8.5px] font-extrabold uppercase text-slate-400 block">ROLL NUMBER</span>
                  <div className="flex items-center gap-1 text-[11px] text-slate-800 font-mono font-black">
                    <IdCard className="h-3 w-3 text-slate-400 shrink-0" />
                    <span>{rollNumber}</span>
                  </div>
                </div>

                <div className="space-y-0.5">
                  <span className="text-[8.5px] font-extrabold uppercase text-slate-400 block">DEPARTMENT</span>
                  <div className="flex items-center gap-1 text-[10.5px] text-slate-700 font-medium">
                    <GraduationCap className="h-3 w-3 text-slate-400 shrink-0" />
                    <span className="truncate">{department || 'Engineering'}</span>
                  </div>
                </div>

                <div className="space-y-0.5">
                  <span className="text-[8.5px] font-extrabold uppercase text-slate-400 block">YEAR OF STUDY</span>
                  <div className="flex items-center gap-1 text-[10.5px] text-slate-700 font-bold">
                    <Signal className="h-3 w-3 text-slate-400 shrink-0" />
                    <span>Year {year || 3}</span>
                  </div>
                </div>
              </div>

              {teamName && teamName !== 'Solo Participant' && (
                <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px]">
                  <span className="font-bold text-slate-500">TEAM AFFILIATION:</span>
                  <span className="font-black text-slate-800">{teamName}</span>
                </div>
              )}
            </div>
          </div>

          {/* =========================================================================
              6. ATTENDANCE QR CODE SECTION
              ========================================================================= */}
          <div className="relative py-2 px-1 flex flex-col items-center justify-center">
            <div
              className="absolute left-1 top-4 bottom-4 w-28 bg-rose-500/12 pointer-events-none rounded-xl"
              style={{ clipPath: 'polygon(0 15%, 100% 35%, 80% 95%, 5% 75%)' }}
            />
            <div
              className="absolute right-1 top-4 bottom-4 w-28 bg-sky-500/15 pointer-events-none rounded-xl"
              style={{ clipPath: 'polygon(20% 35%, 100% 15%, 95% 75%, 0 95%)' }}
            />

            <div className="relative z-10 bg-white p-3.5 rounded-3xl border-2 border-slate-200 shadow-xl text-center flex flex-col items-center">
              <div className="p-1 bg-white rounded-2xl">
                <QRCodeSVG
                  id={qrSvgId}
                  value={encodedQrValue}
                  size={155}
                  level="H"
                  includeMargin={false}
                />
              </div>

              <div className="text-xs font-black uppercase tracking-wider text-slate-900 mt-2">
                INDIVIDUAL QR CODE
              </div>
            </div>

            <p className="text-[9px] font-bold text-slate-500 mt-1.5 text-center">
              Scan by Coordinator for individual participant attendance
            </p>
          </div>

          {/* =========================================================================
              7. IDENTIFIERS ROW
              ========================================================================= */}
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            <div className="p-2 bg-red-50/90 rounded-xl border border-red-200 text-left space-y-0.5">
              <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-wider text-[#C8102E]">
                <User className="h-2.5 w-2.5" />
                <span>PARTICIPANT ID</span>
              </div>
              <div className="text-[8.5px] font-black text-slate-900">TOKEN</div>
              <div className="font-mono text-[9px] font-black text-slate-800 truncate" title={manualToken}>
                {manualToken}
              </div>
            </div>

            <div className="p-2 bg-sky-50/90 rounded-xl border border-sky-200 text-left space-y-0.5">
              <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-wider text-sky-700">
                <FileCheck className="h-2.5 w-2.5" />
                <span>REGISTRATION ID</span>
              </div>
              <div className="font-mono text-[8.5px] font-bold text-slate-800 break-all leading-tight">
                {registrationId.slice(0, 16)}...
              </div>
            </div>

            <div className="p-2 bg-emerald-50/90 rounded-xl border border-emerald-200 text-left flex items-center gap-1.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <div className="text-[7.5px] sm:text-[8px] font-black uppercase text-emerald-800 leading-tight">
                <div>VERIFIED</div>
                <div>INSTITUTIONAL</div>
                <div>DIGITAL CREDENTIAL</div>
                <div className="text-emerald-950 font-bold"> KITS-EOS</div>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            8. CAMPUS SILHOUETTE & INSTITUTIONAL FOOTER BANNER
            ========================================================================= */}
        <div className="relative mt-2">
          <div className="h-16 w-full overflow-hidden opacity-20 pointer-events-none flex items-center justify-center">
            <img
              src="/college_banner.png"
              alt="KITS Campus"
              className="w-full h-full object-cover grayscale"
            />
          </div>

          <div className="relative h-11 bg-[#002244] flex items-stretch overflow-hidden text-white">
            <div className="flex-1 px-3 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-white shrink-0" />
              <div className="min-w-0 text-[8px] sm:text-[8.5px] leading-tight font-extrabold uppercase">
                <div className="truncate">KITS AKSHAR INSTITUTE OF TECHNOLOGY</div>
                <div className="text-slate-300 font-semibold truncate">YANAMADALA, GUNTUR, ANDHRA PRADESH</div>
              </div>
            </div>

            <div
              className="w-40 bg-[#C8102E] flex items-center justify-center px-3 font-black text-[9px] sm:text-[10px] uppercase tracking-wider text-center"
              style={{ clipPath: 'polygon(15% 0, 100% 0, 100% 100%, 0 100%)' }}
            >
              <span className="truncate">{eventName} • {academicYear}</span>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          9. COMPLETE CARD DOWNLOAD & ACTION BUTTONS
          ========================================================================= */}
      {!hideActions && (
        <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-2 max-w-md mx-auto w-full pt-1">
          <DownloadButton
            onDownload={handleDownloadPdf}
            label="Download PDF (9:16)"
            preparingLabel="Preparing PDF..."
            downloadingLabel="Generating PDF..."
            completedLabel="PDF Saved"
            variant="primary"
            size="md"
            icon={<FileText className="h-4 w-4" />}
            className="w-full sm:w-auto shadow-md hover:shadow-lg"
          />

          <DownloadButton
            onDownload={handleDownloadPng}
            label="Download PNG (9:16)"
            preparingLabel="Preparing PNG..."
            downloadingLabel="Rendering PNG..."
            completedLabel="PNG Saved"
            variant="secondary"
            size="md"
            icon={<Image className="h-4 w-4" />}
            className="w-full sm:w-auto shadow-md hover:shadow-lg"
          />

          <DownloadButton
            onDownload={handleDownload4kPng}
            label="High-Res PNG (4K)"
            preparingLabel="Preparing 4K..."
            downloadingLabel="Rendering 4K..."
            completedLabel="4K PNG Saved"
            variant="secondary"
            size="md"
            icon={<Image className="h-4 w-4" />}
            className="w-full sm:w-auto shadow-md hover:shadow-lg"
          />

          <button
            type="button"
            onClick={handlePrint}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer"
          >
            <Printer className="h-3.5 w-3.5 text-slate-600" />
            <span>Print</span>
          </button>

          <DownloadButton
            onDownload={handleDownloadQr}
            label="QR Only"
            preparingLabel="Generating..."
            downloadingLabel="Saving QR..."
            completedLabel="QR Saved"
            variant="ghost"
            size="sm"
            className="w-full sm:w-auto"
          />
        </div>
      )}
    </div>
  );
}
