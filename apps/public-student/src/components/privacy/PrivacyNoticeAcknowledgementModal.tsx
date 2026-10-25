import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
  supabase, 
  isSessionValid,
  CURRENT_PRIVACY_NOTICE_VERSION,
  shouldPromptPrivacyNotice,
  postponePrivacyNotice,
  clearPrivacyNoticePostponement
} from '@kits-eos/shared';
import { ShieldCheck, ExternalLink, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

export function PrivacyNoticeAcknowledgementModal() {
  const { user, profile, isLoading, isAuthTransitioning, refreshProfile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Synchronize modal visibility with authoritative profile state and session postponement
  useEffect(() => {
    const shouldPrompt = shouldPromptPrivacyNotice({
      isLoading,
      isAuthTransitioning,
      isAuthenticated: Boolean(user && isSessionValid()),
      profile,
      expectedVersion: CURRENT_PRIVACY_NOTICE_VERSION
    });

    setIsOpen(shouldPrompt);
  }, [isLoading, isAuthTransitioning, user, profile]);

  const handlePostpone = useCallback(() => {
    postponePrivacyNotice(CURRENT_PRIVACY_NOTICE_VERSION);
    setIsOpen(false);
    setErrorMessage(null);
  }, []);

  // Keyboard accessibility: ESC key postpones modal for current session
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isAcknowledging) {
        handlePostpone();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isAcknowledging, handlePostpone]);

  const handleAcknowledge = async () => {
    if (isAcknowledging) return;

    try {
      setIsAcknowledging(true);
      setErrorMessage(null);

      const { data, error: ackErr } = await supabase.rpc('acknowledge_privacy_notice', {
        p_version: CURRENT_PRIVACY_NOTICE_VERSION
      });

      if (ackErr) {
        throw new Error(ackErr.message || 'Network error recording privacy acknowledgement.');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to record privacy acknowledgement.');
      }

      // Refresh cached student profile to immediately update privacy status in memory
      await refreshProfile();
      clearPrivacyNoticePostponement();
      setIsOpen(false);
    } catch (err: any) {
      console.error('[Privacy] Failed to acknowledge privacy notice:', err);
      setErrorMessage(err.message || 'Unable to record privacy acknowledgement. Please try again.');
    } finally {
      setIsAcknowledging(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-notice-title"
      aria-describedby="privacy-notice-desc"
    >
      <div className="relative max-w-lg w-full bg-white rounded-3xl p-6 sm:p-7 shadow-2xl border border-gray-100 flex flex-col gap-5">
        {/* Header with Shield Icon & Close */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-blue-50 text-kits-blue border border-blue-100 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="privacy-notice-title" className="text-base sm:text-lg font-black text-gray-900 tracking-tight">
                  Privacy Notice Review
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-100 text-kits-blue">
                  v{CURRENT_PRIVACY_NOTICE_VERSION} DPDP
                </span>
              </div>
              <p className="text-xs text-gray-500 font-medium mt-0.5">
                KITS Akshar Institute of Technology Data Governance
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handlePostpone}
            disabled={isAcknowledging}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition cursor-pointer shrink-0 disabled:opacity-40"
            aria-label="Close privacy notice modal"
            title="Review Later"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Explanation */}
        <div id="privacy-notice-desc" className="space-y-3 text-xs text-gray-600 leading-relaxed">
          <p>
            Under the <strong>Digital Personal Data Protection (DPDP) Act, 2023</strong> and institutional governance policies, KITS-EOS requires explicit review of how your personal data is collected, processed, and safeguarded.
          </p>

          <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200/80 space-y-2 text-[11px] text-gray-600">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>Academic Identity:</strong> Name, roll number, department, college, and phone for verified campus operations.</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>Event Records:</strong> Pass issuance, live round check-ins, attendance logs, and verifiable digital certificates.</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>Your Rights:</strong> Access your profile at any time to review data, submit correction requests, or download records.</span>
            </div>
          </div>

          <div className="pt-1">
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-kits-blue hover:text-blue-800 hover:underline"
            >
              <span>Read Full Privacy Notice & Data Governance Policy</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 flex items-center gap-2" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={handlePostpone}
            disabled={isAcknowledging}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition cursor-pointer disabled:opacity-50"
          >
            Review Later
          </button>

          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={isAcknowledging}
            className="btn-liquid btn-primary-blue inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white shadow-2xs hover:shadow-md transition cursor-pointer disabled:opacity-50"
          >
            {isAcknowledging ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Recording...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                <span>Acknowledge Notice</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
