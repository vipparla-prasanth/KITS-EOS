import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Trash2,
  X,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react';
import { assessmentService } from '@kits-eos/shared';

interface AttemptDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  assessmentId: string;
  assessmentTitle: string;
  attemptIds: string[];
  attempts: any[];
  onSuccess: (deletedCount: number) => void;
  onRequestRevocation?: (certificateId: string, attemptId: string) => void;
}

export function AttemptDeleteModal({
  isOpen,
  onClose,
  assessmentId,
  assessmentTitle,
  attemptIds,
  attempts,
  onSuccess,
  onRequestRevocation,
}: AttemptDeleteModalProps) {
  const [typedConfirm, setTypedConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTypedConfirm('');
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Identify any attempts in the selection that have active official certificates
  const selectedAttempts = attempts.filter((att) => attemptIds.includes(att.id));
  const protectedAttempts = selectedAttempts.filter(
    (att) => att.has_active_certificate || (att.certificate_id && !att.certificate_revoked)
  );
  const isBlockedByCertificate = protectedAttempts.length > 0;
  const isInputValid = typedConfirm.trim() === 'DELETE';

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isInputValid || isBlockedByCertificate || loading) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: err } = await assessmentService.deleteAssessmentAttempts(
        assessmentId,
        attemptIds
      );

      if (err) throw err;

      if (data?.success) {
        onSuccess(data.deleted_count || attemptIds.length);
        onClose();
      } else {
        throw new Error(data?.message || 'Failed to delete assessment attempts.');
      }
    } catch (err: any) {
      console.error('Failed to delete assessment attempts:', err);
      setError(err.message || 'Server error while deleting attempts.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-gray-200 space-y-5 animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center text-[#C8102E]">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-[#003366] tracking-tight">
                Delete Assessment Attempt{attemptIds.length > 1 ? 's' : ''}
              </h3>
              <p className="text-xs text-gray-500 font-medium">Permanent Record Remediation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Assessment Scope & Records Summary */}
        <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 text-xs space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-gray-500 font-medium">Target Assessment:</span>
            <span className="font-bold text-[#003366] truncate max-w-[240px]">{assessmentTitle}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-500 font-medium">Selected Attempts:</span>
            <span className="font-extrabold text-[#C8102E] font-mono">
              {attemptIds.length} Attempt{attemptIds.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="pt-2 border-t border-gray-200/80 text-[11px] text-gray-600 leading-relaxed">
            This operation permanently deletes all student responses, answer logs, and proctoring violation records for the selected attempt{attemptIds.length > 1 ? 's' : ''}. Assessment scoreboards, rankings, and completion metrics will automatically reflect this removal.
          </div>
        </div>

        {/* Certificate / Award Protection Safeguard */}
        {isBlockedByCertificate && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3">
            <div className="flex items-start space-x-2.5">
              <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-amber-900">
                  Protected by Active Official Certificate ({protectedAttempts.length})
                </h4>
                <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                  Institutional policy prohibits deleting attempts associated with active official certificates or awards. An authorized administrator must first revoke the certificate before the attempt becomes eligible for deletion.
                </p>
              </div>
            </div>

            <div className="bg-white/80 rounded-xl p-2.5 max-h-32 overflow-y-auto space-y-1.5 border border-amber-100 text-[11px]">
              {protectedAttempts.map((att) => (
                <div key={att.id} className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
                  <div className="truncate mr-2">
                    <span className="font-semibold text-gray-900">{att.student_name}</span>
                    <span className="text-gray-500 font-mono text-[10px] ml-1.5">({att.roll_number || 'N/A'})</span>
                  </div>
                  {onRequestRevocation && (att.certificate_id || att.id) && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onRequestRevocation(att.certificate_id, att.id);
                      }}
                      className="text-[10px] font-bold text-[#C8102E] hover:underline flex-shrink-0"
                    >
                      Revoke First →
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Feedback */}
        {error && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-[#C8102E]" />
            <span>{error}</span>
          </div>
        )}

        {/* Form with typed DELETE confirmation */}
        <form onSubmit={handleDelete} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Type <span className="text-[#C8102E] font-mono">DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={typedConfirm}
              onChange={(e) => setTypedConfirm(e.target.value)}
              placeholder="Type DELETE"
              disabled={loading || isBlockedByCertificate}
              autoComplete="off"
              className="w-full px-4 py-2.5 text-xs font-mono bg-gray-50 border border-gray-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#C8102E]/20 focus:border-[#C8102E] disabled:opacity-50"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-semibold rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isInputValid || isBlockedByCertificate || loading}
              className="flex-1 inline-flex items-center justify-center px-4 py-2.5 bg-[#C8102E] hover:bg-[#a50d26] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition shadow-sm space-x-1.5"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Confirm Delete</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
