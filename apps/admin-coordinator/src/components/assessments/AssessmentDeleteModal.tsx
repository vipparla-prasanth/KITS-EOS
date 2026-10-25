import { useState } from 'react';
import {
  AlertTriangle,
  Trash2,
  ShieldAlert,
  Archive,
  X,
} from 'lucide-react';
import { assessmentService, type Assessment } from '@kits-eos/shared';

interface AssessmentDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  assessment: Assessment | null;
  onSuccess: (action: 'ARCHIVED' | 'PERMANENTLY_DELETED') => void;
}

export function AssessmentDeleteModal({
  isOpen,
  onClose,
  assessment,
  onSuccess,
}: AssessmentDeleteModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !assessment) return null;

  const isArchived = assessment.status === 'ARCHIVED' || (assessment as any).is_deleted;
  const isPublishedOrClosed = assessment.status === 'PUBLISHED' || assessment.status === 'CLOSED';

  const handleDelete = async () => {
    if (confirmText.trim().toUpperCase() !== 'DELETE') {
      setError('Please type DELETE in capital letters to confirm.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // If already archived, force permanent deletion
      const forcePermanent = Boolean(isArchived);
      const { data, error: err } = await assessmentService.deleteAssessment(assessment.id, forcePermanent);
      if (err) throw err;

      if (data?.success) {
        onSuccess(data.action as 'ARCHIVED' | 'PERMANENTLY_DELETED');
        onClose();
      } else {
        setError(data?.message || 'Failed to process assessment deletion.');
      }
    } catch (err: any) {
      console.error('Assessment deletion failed:', err);
      setError(err.message || 'Server error occurred while deleting assessment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-gray-100 relative animate-in fade-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-5 right-5 p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3.5 mb-5">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${
              isArchived
                ? 'bg-red-600 text-white shadow-lg shadow-red-500/20'
                : isPublishedOrClosed
                ? 'bg-amber-100 text-amber-700'
                : 'bg-red-100 text-red-600'
            }`}
          >
            {isArchived ? (
              <Trash2 className="w-6 h-6" />
            ) : isPublishedOrClosed ? (
              <Archive className="w-6 h-6" />
            ) : (
              <Trash2 className="w-6 h-6" />
            )}
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900 tracking-tight">
              {isArchived
                ? 'Permanently Delete Assessment'
                : isPublishedOrClosed
                ? 'Archive Assessment'
                : 'Delete Draft Assessment'}
            </h3>
            <p className="text-xs text-gray-500 font-medium">
              {isArchived
                ? 'Stage 2: Permanent destruction of assessment and dependent data'
                : isPublishedOrClosed
                ? 'Stage 1: Safe academic records archival'
                : 'Safe draft deletion'}
            </p>
          </div>
        </div>

        {/* Assessment Card */}
        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200/80 mb-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Assessment Title</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                isArchived
                  ? 'bg-gray-200 text-gray-800'
                  : assessment.status === 'PUBLISHED'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {assessment.status}
            </span>
          </div>
          <p className="text-sm font-bold text-gray-900">{assessment.title}</p>
        </div>

        {/* Informational Guidance */}
        {isArchived ? (
          <div className="bg-red-50 border border-red-300 p-4 rounded-2xl mb-5 space-y-2 text-xs text-red-900">
            <div className="flex items-center space-x-2 font-bold text-red-900">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <span>Irreversible Permanent Deletion</span>
            </div>
            <p>
              This assessment is currently in the <strong>Archived</strong> tab. Permanently deleting it will permanently remove:
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-red-800 pl-1">
              <li>All authored questions, options, and private answer keys</li>
              <li>All candidate attempts, answers, and proctoring violations</li>
              <li>All issued certificates and rank leaderboard events</li>
              <li>Coordinator live host assignments for this exam</li>
            </ul>
            <p className="font-semibold text-red-950 pt-1">
              This action cannot be undone and the record will be erased from the database forever.
            </p>
          </div>
        ) : isPublishedOrClosed ? (
          <div className="bg-amber-50 border border-amber-200/80 p-4 rounded-2xl mb-5 space-y-2 text-xs text-amber-800">
            <div className="flex items-center space-x-2 font-bold text-amber-900">
              <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>Protected Historical Records</span>
            </div>
            <p>
              This examination is or was active. If students have submitted attempts, scores, or received rank certificates,
              the server will safely <strong>ARCHIVE</strong> this assessment.
            </p>
            <p className="text-amber-900 font-semibold">
              It will disappear from All Assessments and active tabs and move to the Archived tab. You can permanently purge it later from Archived if needed.
            </p>
          </div>
        ) : (
          <div className="bg-red-50 border border-red-200/80 p-4 rounded-2xl mb-5 space-y-2 text-xs text-red-800">
            <div className="flex items-center space-x-2 font-bold text-red-900">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <span>Permanent Draft Deletion</span>
            </div>
            <p>
              This draft assessment has no candidate attempts. All draft questions and options will be permanently deleted from the database.
            </p>
          </div>
        )}

        {/* Confirmation Input */}
        <div className="space-y-2 mb-6">
          <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
            Type <span className="text-red-600 font-mono font-black">DELETE</span> to confirm
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            disabled={loading}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 font-mono text-sm tracking-widest text-center"
          />
        </div>

        {error && (
          <div className="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-500" />
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 rounded-xl transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading || confirmText.trim().toUpperCase() !== 'DELETE'}
            className={`px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition shadow-sm flex items-center space-x-2 ${
              isArchived
                ? 'bg-red-700 hover:bg-red-800'
                : isPublishedOrClosed
                ? 'bg-amber-700 hover:bg-amber-800'
                : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Processing...</span>
              </>
            ) : isArchived ? (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Permanently Delete</span>
              </>
            ) : isPublishedOrClosed ? (
              <>
                <Archive className="w-4 h-4" />
                <span>Safely Archive</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Delete Draft</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
export default AssessmentDeleteModal;
