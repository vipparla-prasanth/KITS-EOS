import { useEffect } from 'react';
import { LogOut, X } from 'lucide-react';
import { useScrollLock } from '@kits-eos/shared';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function LogoutConfirmationModal({ isOpen, onClose, onConfirm }: Props) {
  useScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 modal-overlay-animate">
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-sm w-full p-4 sm:p-6 text-center space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2 text-kits-red font-black text-xs uppercase tracking-wider">
            <LogOut className="h-4 w-4" />
            <span>Confirm Logout</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition hover:bg-gray-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="py-2">
          <div className="h-12 w-12 rounded-2xl bg-red-50 text-kits-red flex items-center justify-center mx-auto mb-3 border border-red-100 shadow-2xs">
            <LogOut className="h-6 w-6" />
          </div>
          <h3 className="text-base font-black text-gray-900 tracking-tight">Are you sure you want to sign out?</h3>
          <p className="text-xs text-gray-500 mt-1">
            You will need to sign in again to access your event passes and credentials.
          </p>
        </div>

        <div className="flex flex-col-reverse xs:grid xs:grid-cols-2 gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary w-full py-2.5 px-4 text-xs font-bold text-center"
          >
            Stay Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-liquid btn-primary-red w-full py-2.5 px-4 text-xs font-black uppercase tracking-wider text-center shadow-2xs"
          >
            <span className="btn-content">
              <LogOut className="h-4 w-4" />
              <span>Confirm Logout</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
