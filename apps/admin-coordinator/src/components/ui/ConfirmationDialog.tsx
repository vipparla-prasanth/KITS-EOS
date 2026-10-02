import type { ReactNode } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';
import { DeleteButton } from './DeleteButton';

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
}

export function ConfirmationDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  isDestructive = false
}: ConfirmationDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto modal-overlay-animate" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-center justify-center min-h-screen p-3 sm:p-4 text-center">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity" 
          aria-hidden="true" 
          onClick={onCancel}
        />

        {/* Modal Dialog */}
        <div className="relative bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-7 text-left overflow-hidden shadow-2xl border border-gray-200 w-full max-w-lg modal-dialog-animate space-y-4 sm:space-y-5 max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <div className="flex items-start justify-between border-b border-gray-100 pb-3">
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                isDestructive 
                  ? 'bg-red-50 text-kits-red border-red-200' 
                  : 'bg-blue-50 text-kits-blue border-blue-200'
              }`}>
                {isDestructive ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
              </div>
              <h3 className="text-base sm:text-lg font-black text-gray-900 tracking-tight" id="modal-title">
                {title}
              </h3>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="text-xs sm:text-sm text-gray-600 leading-relaxed">
            {message}
          </div>

          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 pt-3 border-t border-gray-100">
            <button
              type="button"
              className="btn-secondary w-full sm:w-auto px-5 py-2.5 text-xs font-bold"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
            {isDestructive ? (
              <DeleteButton
                className="w-full sm:w-auto"
                onClick={onConfirm}
                label={confirmLabel}
              />
            ) : (
              <button
                type="button"
                className="btn-liquid btn-primary-blue w-full sm:w-auto px-6 py-2.5 text-xs font-black uppercase tracking-wider shadow-2xs text-center"
                onClick={onConfirm}
              >
                <span className="btn-content">
                  {confirmLabel}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
