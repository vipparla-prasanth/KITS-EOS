import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, X } from 'lucide-react';
import { useScrollLock } from '@kits-eos/shared';
import { TeamDigitalIdCard, type TeamMemberItem } from './TeamDigitalIdCard';
import { DigitalIdCard } from './DigitalIdCard';

export interface IdCardModalProps {
  isOpen: boolean;
  onClose: () => void;
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
  isTeam?: boolean;
  teamMembers?: TeamMemberItem[];
}

export function DigitalIdCardModal(props: IdCardModalProps) {
  const {
    isOpen,
    onClose,
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
    isTeam = false,
    teamMembers = [],
  } = props;

  const encodedQrValue = qrIdentity || qrPayload || '';

  useScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-hidden modal-overlay-animate"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[calc(100dvh-2rem)] sm:max-h-[92vh] flex flex-col shadow-2xl border border-gray-200 relative overflow-hidden modal-dialog-animate">
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-6 py-3.5 bg-white shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#C8102E]" />
            <h3 className="text-xs sm:text-sm font-black uppercase text-slate-900 tracking-tight">
              {isTeam ? 'Official Digital Team ID Card' : 'Official Digital Student ID Card'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body containing 9:16 Credential */}
        <div className="p-3 sm:p-5 overflow-y-auto flex-1 min-h-0 overscroll-contain">
          {isTeam && teamMembers && teamMembers.length > 0 ? (
            <TeamDigitalIdCard
              teamName={teamName || 'Registered Team'}
              eventName={eventName}
              categoryName={categoryName}
              subEventName={subEventName}
              members={teamMembers}
              registrationId={registrationId}
              manualToken={manualToken}
              qrPayload={encodedQrValue}
            />
          ) : (
            <DigitalIdCard
              studentName={studentName}
              rollNumber={rollNumber}
              department={department}
              year={year}
              college={college}
              eventName={eventName}
              categoryName={categoryName}
              subEventName={subEventName}
              participationType={participationType}
              teamName={teamName}
              teamRole={teamRole}
              registrationId={registrationId}
              manualToken={manualToken}
              qrIdentity={qrIdentity}
              qrPayload={qrPayload}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
