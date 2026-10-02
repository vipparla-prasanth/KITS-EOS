import { QRCodeSVG } from 'qrcode.react';
import { Printer, QrCode, ShieldCheck, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { downloadSvgAsPng, printDocument } from '../../utils/credentialExport';
import { DownloadButton } from '../ui/DownloadButton';

export interface QrPassProps {
  studentName: string;
  rollNumber: string;
  eventName: string;
  subEventName: string;
  teamName?: string;
  registrationId: string;
  manualToken: string;
  qrIdentity?: string;
  qrPayload?: string;
}

export function AttendanceQrPass(props: QrPassProps) {
  const {
    studentName,
    rollNumber,
    eventName,
    subEventName,
    teamName,
    registrationId,
    manualToken,
    qrIdentity,
    qrPayload,
  } = props;

  const [copied, setCopied] = useState(false);
  const containerId = `qr-pass-container-${registrationId.slice(0, 8)}`;
  const qrSvgId = `qr-pass-svg-${registrationId.slice(0, 8)}`;
  const encodedValue = qrIdentity || qrPayload || manualToken;

  const handleCopyToken = () => {
    navigator.clipboard.writeText(manualToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPng = () => {
    downloadSvgAsPng(qrSvgId, `QR_PASS_${manualToken}`, `KITS-EOS • ${subEventName}`, manualToken);
  };

  const handlePrint = () => {
    printDocument(containerId);
  };

  return (
    <div className="space-y-4 max-w-md mx-auto">
      <div 
        id={containerId} 
        className="bg-white rounded-3xl border border-gray-200 shadow-xl p-4 sm:p-7 space-y-4 sm:space-y-5 text-center"
      >
        {/* Header */}
        <div className="space-y-1 border-b border-gray-100 pb-3 sm:pb-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-kits-red text-[10px] font-black uppercase tracking-wider border border-red-100">
            <QrCode className="h-3.5 w-3.5" />
            <span>Official Attendance Pass</span>
          </div>
          <h2 className="text-lg sm:text-xl font-black text-gray-900 tracking-tight break-words">
            {subEventName}
          </h2>
          <p className="text-xs text-gray-500 font-bold">
            {eventName}
          </p>
        </div>

        {/* Participant Details */}
        <div className="bg-gray-50 p-3 sm:p-3.5 rounded-2xl border border-gray-200 text-xs space-y-1 text-left">
          <div className="flex justify-between gap-2">
            <span className="text-gray-400 font-bold uppercase text-[10px]">Participant:</span>
            <span className="font-black text-gray-900 text-right truncate">{studentName}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-gray-400 font-bold uppercase text-[10px]">Roll Number:</span>
            <span className="font-mono font-bold text-gray-900 text-right">{rollNumber}</span>
          </div>
          {teamName && teamName !== 'Solo Participant' && (
            <div className="flex justify-between gap-2">
              <span className="text-gray-400 font-bold uppercase text-[10px]">Team:</span>
              <span className="font-bold text-kits-blue text-right truncate">{teamName}</span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-gray-400 font-bold uppercase text-[10px]">Reg ID:</span>
            <span className="font-mono text-gray-600 text-right">{registrationId.slice(0, 14)}...</span>
          </div>
        </div>

        {/* Large Decodable QR Code */}
        <div className="p-3 sm:p-4 bg-white rounded-2xl border-2 border-dashed border-gray-300 inline-block shadow-xs max-w-[200px] w-full mx-auto">
          <div className="flex justify-center">
            <QRCodeSVG
              id={qrSvgId}
              value={encodedValue}
              size={160}
              level="H"
              includeMargin={true}
              className="w-full max-w-[160px] h-auto"
            />
          </div>
        </div>

        {/* Manual Token */}
        <div className="space-y-1">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 block">
            Manual Verification Token
          </span>
          <div className="flex items-center justify-center gap-2 p-2.5 bg-slate-900 text-white rounded-xl font-mono text-xs sm:text-sm font-black tracking-wider">
            <span className="break-all">{manualToken}</span>
            <button
              type="button"
              onClick={handleCopyToken}
              className="p-1 hover:bg-white/20 rounded-md transition cursor-pointer text-gray-300 hover:text-white shrink-0"
              title="Copy Token"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-100 flex items-center justify-center gap-1 text-[11px] text-emerald-700 font-bold">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>Present this QR pass to the coordinator at venue gate</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 w-full pt-1">
        <DownloadButton
          onDownload={handleDownloadPng}
          label="Download QR (.png)"
          preparingLabel="Preparing QR..."
          downloadingLabel="Saving QR..."
          completedLabel="QR Saved"
          variant="secondary"
          size="md"
          className="w-full sm:w-auto"
        />

        <button
          type="button"
          onClick={handlePrint}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-kits-blue text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-blue-800 transition shadow-2xs cursor-pointer"
        >
          <Printer className="h-3.5 w-3.5 text-white" />
          <span>Print Pass</span>
        </button>
      </div>
    </div>
  );
}
