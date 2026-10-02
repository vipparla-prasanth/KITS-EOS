import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { formatDateTime12h } from '@kits-eos/shared';
import {
  ShieldAlert,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  Send,
  LogOut,
  X
} from 'lucide-react';

export function AccountSuspendedScreen() {
  const { user, suspendedInfo, signOut, submitUnsuspensionRequest, refreshAccountStatus } = useAuth();

  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const pendingRequest = suspendedInfo?.pending_request;
  const latestRequest = suspendedInfo?.latest_request;
  const isRejected = latestRequest?.status === 'REJECTED';

  const handleOpenModal = () => {
    setRequestMessage('');
    setSubmitError(null);
    setSubmitSuccess(false);
    setIsRequestModalOpen(true);
  };

  const handleCloseModal = () => {
    if (!isSubmitting) {
      setIsRequestModalOpen(false);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestMessage.trim() || requestMessage.trim().length < 5) {
      setSubmitError('Please provide a descriptive explanation (at least 5 characters).');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitUnsuspensionRequest(requestMessage.trim());
      if (!result.success) {
        throw result.error || new Error(result.message || 'Failed to submit request.');
      }
      setSubmitSuccess(true);
      setTimeout(() => {
        setIsRequestModalOpen(false);
        setSubmitSuccess(false);
        setRequestMessage('');
      }, 1500);
    } catch (err: any) {
      console.error('Unsuspension request failed:', err);
      setSubmitError(err.message || 'Submission failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6 selection:bg-red-100">
      <div className="w-full max-w-xl bg-white rounded-3xl border border-red-200/80 shadow-[0_20px_50px_-15px_rgba(239,68,68,0.12)] p-6 sm:p-8 space-y-6">
        
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div className="flex items-center space-x-3">
            <img
              src="/college_logo.png"
              alt="KITS Logo"
              className="w-10 h-10 object-contain shrink-0"
            />
            <div>
              <h2 className="text-xl font-black tracking-tight leading-none text-gray-900">
                <span className="text-kits-red">KITS</span>-<span className="text-kits-blue">EOS</span>
              </h2>
              <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider mt-0.5">
                Student Event Operations System
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-red-50 text-kits-red border border-red-200">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span>ACCOUNT SUSPENDED</span>
          </span>
        </div>

        {/* Primary Notification Message */}
        <div className="space-y-2">
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">
            Account Access Suspended
          </h1>
          <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
            Your KITS-EOS student account has been suspended due to violations of the platform rules. During this suspension, you cannot access student services, register for sub-events, or view operational dashboards.
          </p>
        </div>

        {/* Official Suspension Reason Box */}
        <div className="p-4 bg-red-50/50 border border-red-200 rounded-2xl space-y-1.5">
          <span className="text-[10px] uppercase font-extrabold tracking-wider text-red-700 flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" />
            Official Reason for Suspension:
          </span>
          <p className="text-xs sm:text-sm font-semibold text-gray-900 leading-normal pl-4 border-l-2 border-red-400">
            {suspendedInfo?.suspension_reason || 'Violation of platform policies and regulations.'}
          </p>
          {suspendedInfo?.suspended_at && (
            <span className="text-[10px] text-gray-400 font-mono block pt-1">
              Issued on {formatDateTime12h(suspendedInfo.suspended_at)}
            </span>
          )}
        </div>

        {/* Unsuspension Status or Call to Action */}
        <div className="space-y-3 pt-1">
          {pendingRequest ? (
            /* Active Pending Review State */
            <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-amber-800 flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-amber-600" />
                  Unsuspension Request: Under Review
                </span>
                <span className="text-[10px] font-mono text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-md font-bold">
                  {formatDateTime12h(pendingRequest.created_at)}
                </span>
              </div>
              <p className="text-xs text-amber-900 font-medium">
                Your request for account review has been submitted to the administration.
              </p>
              <div className="text-[11px] bg-white/80 p-2.5 rounded-xl border border-amber-200 text-gray-700 italic">
                "{pendingRequest.request_message}"
              </div>
              <p className="text-[11px] text-amber-700">
                You will be notified once an administrator evaluates your request.
              </p>
            </div>
          ) : isRejected ? (
            /* Previously Rejected State (Allows Re-application) */
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-red-700 flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 text-red-600" />
                  Previous Request: Rejected
                </span>
                {latestRequest?.reviewed_at && (
                  <span className="text-[10px] font-mono text-gray-500 font-semibold">
                    {formatDateTime12h(latestRequest.reviewed_at)}
                  </span>
                )}
              </div>
              {latestRequest?.admin_response && (
                <div className="p-3 bg-red-50/60 border border-red-100 rounded-xl text-xs text-red-900 space-y-1">
                  <span className="text-[10px] font-black uppercase text-red-600 block">
                    Admin Response:
                  </span>
                  <p>{latestRequest.admin_response}</p>
                </div>
              )}
              <p className="text-xs text-gray-600">
                If you have further clarification or rectified the issue, you may submit an updated request for review.
              </p>
              <button
                type="button"
                onClick={handleOpenModal}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white border-2 border-kits-red text-kits-red text-xs font-black uppercase tracking-wider hover:bg-red-50 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <FileText className="h-4 w-4" />
                <span>Submit New Unsuspension Request</span>
              </button>
            </div>
          ) : (
            /* Initial State (No request yet submitted) */
            <div className="space-y-3">
              <p className="text-xs text-gray-600">
                If you believe this suspension was made in error or would like to appeal for account restoration, you can submit a formal request for review.
              </p>
              <button
                type="button"
                onClick={handleOpenModal}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white border-2 border-kits-red text-kits-red text-xs font-black uppercase tracking-wider hover:bg-red-50 transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <FileText className="h-4 w-4" />
                <span>Request Unsuspension</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-100 text-xs">
          <button
            type="button"
            onClick={() => refreshAccountStatus()}
            className="text-gray-500 hover:text-gray-900 font-semibold text-[11px] underline cursor-pointer"
          >
            Check Status Again
          </button>

          <button
            type="button"
            onClick={signOut}
            className="px-4 py-2 rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-100 font-bold flex items-center gap-1.5 transition cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          REQUEST UNSUSPENSION MODAL
          ========================================================================= */}
      {isRequestModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-gray-200 shadow-2xl max-w-lg w-full p-6 sm:p-7 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-kits-red" />
                <h3 className="text-base font-black text-gray-900 tracking-tight">
                  Request Account Unsuspension
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={isSubmitting}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {submitSuccess ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <span className="font-bold">
                  Your unsuspension request has been submitted successfully!
                </span>
              </div>
            ) : (
              <form onSubmit={handleSubmitRequest} className="space-y-4">
                {submitError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{submitError}</span>
                  </div>
                )}

                {/* Read-only Student Context */}
                <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded-xl border border-gray-100 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Student</span>
                    <span className="font-bold text-gray-800 truncate block">
                      {suspendedInfo?.full_name || user?.email || 'Student'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Roll Number</span>
                    <span className="font-bold font-mono text-gray-800 truncate block">
                      {suspendedInfo?.roll_number || '—'}
                    </span>
                  </div>
                  <div className="col-span-2 pt-1 border-t border-gray-200/60">
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">Suspension Reason</span>
                    <span className="font-medium text-gray-700 text-[11px] block truncate">
                      {suspendedInfo?.suspension_reason || 'Violation of platform rules'}
                    </span>
                  </div>
                </div>

                {/* Request Explanation Textarea */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Explanation / Appeal Message <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                    placeholder="Explain why you are requesting account restoration..."
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-kits-blue focus:border-kits-blue resize-none transition"
                    maxLength={1000}
                    autoFocus
                  />
                  <div className="flex justify-between items-center text-[10px] text-gray-400 mt-1">
                    <span>Be polite, factual, and concise.</span>
                    <span>{requestMessage.length} / 1000</span>
                  </div>
                </div>

                {/* Modal Buttons */}
                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleCloseModal}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || requestMessage.trim().length < 5}
                    className="px-5 py-2.5 rounded-xl bg-white border-2 border-kits-red text-kits-red text-xs font-black uppercase tracking-wider hover:bg-red-50 transition flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-2xs"
                  >
                    <Send className={`h-3.5 w-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
                    <span>{isSubmitting ? 'Submitting...' : 'Submit Request'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
