import { 
  ShieldCheck, 
  ExternalLink,
  ArrowLeft,
  Lock
} from 'lucide-react';
import { CENTRAL_COORDINATOR_PORTAL_URL } from '../utils/authUtils';

interface CoordinatorPortalProps {
  onLogout?: () => void;
}

export function CoordinatorPortal({ onLogout }: CoordinatorPortalProps) {
  const handleBackToPublic = () => {
    if (onLogout) {
      onLogout();
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8 sm:py-16 px-4">
      <div className="bg-white border border-gray-200 shadow-xl rounded-3xl p-6 sm:p-10 text-center space-y-6">
        {/* Security Shield Icon */}
        <div className="mx-auto w-16 h-16 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-md">
          <Lock className="w-8 h-8 text-amber-400" />
        </div>

        {/* Title and Description */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-800 text-[11px] font-black uppercase tracking-wider border border-amber-200">
            <span>Authoritative Security Policy</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
            Coordinator Operations Centralized
          </h2>
          <p className="text-xs sm:text-sm text-gray-600 max-w-md mx-auto leading-relaxed">
            In accordance with KITS-EOS security architecture, operational coordinator actions (attendance check-ins, QR scanning, participant verification, and roster management) are strictly centralized on the primary Central Portal with server-validated cryptographic sessions.
          </p>
        </div>

        {/* Info Box */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-left space-y-2 text-xs text-slate-700">
          <div className="flex items-center gap-2 font-bold text-slate-900">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Cryptographic Session Boundary</span>
          </div>
          <p className="text-slate-600 text-[11px] leading-relaxed">
            This Standby Node operates exclusively as a public contingency event catalog. Operational coordinators must authenticate through the authoritative Central Portal to obtain time-bounded cryptographic tokens.
          </p>
        </div>

        {/* Primary Action Button */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href={CENTRAL_COORDINATOR_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider transition shadow-md flex items-center justify-center gap-2 active:scale-95"
          >
            <span>Open Central Coordinator Portal</span>
            <ExternalLink className="w-4 h-4 text-amber-400" />
          </a>

          <button
            type="button"
            onClick={handleBackToPublic}
            className="w-full sm:w-auto px-5 py-3.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Public Events</span>
          </button>
        </div>
      </div>
    </div>
  );
}
