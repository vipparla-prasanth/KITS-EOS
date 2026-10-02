import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, FileText, Trash2, ArrowRight, RotateCcw, AlertTriangle } from 'lucide-react';

export interface ResumeDraftModalProps {
  isOpen: boolean;
  title?: string | null;
  subtitle?: string | null;
  lastSavedAt?: Date | string | null;
  currentStep?: number;
  onResume: () => void;
  onStartNew: () => void;
  onDelete?: () => Promise<any> | any;
  onDiscard?: () => Promise<any> | any;
}

export function ResumeDraftModal({
  isOpen,
  title,
  subtitle,
  lastSavedAt,
  currentStep,
  onResume,
  onStartNew,
  onDelete,
  onDiscard,
}: ResumeDraftModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmStartNew, setShowConfirmStartNew] = useState(false);

  if (!isOpen) return null;

  const formatLastSaved = (val?: Date | string | null): string => {
    if (!val) return 'recently';
    const date = typeof val === 'string' ? new Date(val) : val;
    if (isNaN(date.getTime())) return 'recently';

    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 30) return 'just now';
    if (seconds < 60) return `${seconds} seconds ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };

  const handleDeleteClick = async () => {
    try {
      setIsDeleting(true);
      if (onDelete) {
        await onDelete();
      } else if (onDiscard) {
        await onDiscard();
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-draft-title"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-md w-full overflow-hidden p-6 sm:p-7 transition-all scale-100">
        {!showConfirmStartNew ? (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-50 text-kits-red flex items-center justify-center shrink-0 border border-red-100">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3
                  id="resume-draft-title"
                  className="text-base font-bold text-gray-900"
                >
                  Resume your saved draft?
                </h3>
                <p className="text-xs text-gray-500 font-medium">
                  We found an unfinished form saved in your account.
                </p>
              </div>
            </div>

            {/* Draft Details Card */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/80 mb-6 space-y-2">
              <div className="text-sm font-bold text-gray-900 line-clamp-1">
                {title || 'Saved Form Draft'}
              </div>
              {subtitle && (
                <div className="text-xs text-gray-600 font-medium line-clamp-1">
                  {subtitle}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 pt-1 border-t border-gray-200/60 mt-2">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  Last saved: {formatLastSaved(lastSavedAt)}
                </span>
                {currentStep && currentStep > 1 && (
                  <span className="px-2 py-0.5 rounded-md bg-white border border-gray-200 text-gray-700 font-semibold text-[11px]">
                    Step {currentStep}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={onResume}
                className="w-full py-3 px-4 rounded-xl bg-kits-red text-white text-xs font-bold hover:bg-red-700 active:scale-[0.98] transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Resume Draft</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowConfirmStartNew(true)}
                  className="py-2.5 px-3 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition cursor-pointer"
                >
                  Start New
                </button>

                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDeleteClick}
                  className="py-2.5 px-3 rounded-xl border border-red-200 bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100 active:scale-[0.98] transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isDeleting ? 'Deleting...' : 'Delete Draft'}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Confirmation before starting new and abandoning draft */
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Start fresh with a blank form?
                </h3>
                <p className="text-xs text-gray-500 font-medium">
                  Your existing saved draft will remain available unless deleted.
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-600 mb-6 bg-gray-50 p-3.5 rounded-xl border border-gray-200">
              Choosing <strong>Start New</strong> will open an empty form. If you save new changes, they will update your saved draft for this event.
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setShowConfirmStartNew(false)}
                className="py-2.5 px-3 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmStartNew(false);
                  onStartNew();
                }}
                className="py-2.5 px-3 rounded-xl bg-gray-900 text-white text-xs font-bold hover:bg-black transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Start New Form</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
}
