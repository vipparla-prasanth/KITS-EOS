import { useEffect } from 'react';
import { useScrollLock } from '@kits-eos/shared';
import { 
  X, 
  FileWarning, 
  ExternalLink, 
  Clock, 
  Phone, 
  AlertCircle,
  MessageCircle,
  Info
} from 'lucide-react';

export interface CoordinatorContact {
  id: string;
  display_name: string;
  coordinator_type: string;
  phone_number: string | null;
}

interface OversizedDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentName: string;
  subEventName: string;
  studentName: string;
  selectedFileSize?: number;
  selectedFileName?: string;
  coordinators: CoordinatorContact[];
  onChooseDifferentFile?: () => void;
  onDeferUploadLater?: () => void;
  onCoordinatorWhatsAppChosen?: (coordinator: CoordinatorContact) => void;
}

export function buildCoordinatorWhatsAppUrl(
  phone: string,
  studentName: string,
  documentName: string,
  subEventName: string
): string {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const targetPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

  const message = `Hello Sir/Madam,

I am ${studentName || 'a participant'}.

The KITS-EOS portal requested me to submit the document: ${documentName || 'Required Document'}.

My registered sub-event is: ${subEventName || 'Registered Sub-Event'}.

The document exceeds the portal's 20 MB upload limit, so I am sending it directly to you here.

Please find the required document attached.

Thank you.`;

  return `https://wa.me/${targetPhone}?text=${encodeURIComponent(message)}`;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || isNaN(bytes)) return 'Oversized (> 20 MB)';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function formatPhoneNumber(phone?: string | null): string {
  if (!phone) return 'Phone not available';
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.length === 10) {
    return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  }
  return phone;
}

export function OversizedDocumentModal({
  isOpen,
  onClose,
  documentName,
  subEventName,
  studentName,
  selectedFileSize,
  selectedFileName,
  coordinators,
  onChooseDifferentFile,
  onDeferUploadLater,
  onCoordinatorWhatsAppChosen,
}: OversizedDocumentModalProps) {
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

  const validCoordinators = coordinators.filter(c => c.phone_number && c.phone_number.trim().length >= 8);

  const handleWhatsAppClick = (coordinator: CoordinatorContact) => {
    if (!coordinator.phone_number) return;
    const url = buildCoordinatorWhatsAppUrl(
      coordinator.phone_number,
      studentName,
      documentName,
      subEventName
    );
    window.open(url, '_blank', 'noopener,noreferrer');
    if (onCoordinatorWhatsAppChosen) {
      onCoordinatorWhatsAppChosen(coordinator);
    }
  };

  const handleDeferAndClose = () => {
    if (onDeferUploadLater) {
      onDeferUploadLater();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 modal-overlay-animate">
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-2xl border border-gray-200 modal-dialog-animate max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2 text-amber-600 font-black text-xs uppercase tracking-wider">
            <FileWarning className="h-4 w-4" />
            <span>Upload Size Limit Exceeded</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition hover:bg-gray-100 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Title & Core Notification */}
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-2xl border border-amber-200 shrink-0">
              <FileWarning className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-gray-900 tracking-tight leading-snug">
                Document Upload Limit Exceeded
              </h3>
              <p className="text-xs text-gray-600 font-semibold mt-0.5">
                This document is larger than the maximum upload limit of <span className="text-red-600 font-black">20 MB</span>.
              </p>
            </div>
          </div>

          {/* Document & File Info Card */}
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-1.5 text-xs">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <span className="text-gray-500 font-medium">Document Required:</span>
              <span className="font-black text-gray-900 break-words">{documentName || 'Required Document'}</span>
            </div>
            {selectedFileName && (
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-gray-500 font-medium">Selected File:</span>
                <span className="font-mono text-[11px] text-gray-700 truncate max-w-[220px]">{selectedFileName}</span>
              </div>
            )}
            <div className="flex items-center justify-between flex-wrap gap-1">
              <span className="text-gray-500 font-medium">File Size:</span>
              <span className="font-black text-red-600">
                {formatFileSize(selectedFileSize)} <span className="text-gray-400 font-normal">(Max allowed: 20.0 MB)</span>
              </span>
            </div>
          </div>
        </div>

        {/* Two Options Explanatory Banner */}
        <div className="space-y-2.5">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">
            You have two options:
          </p>

          <div className="grid grid-cols-1 gap-2.5">
            {/* Option 1 */}
            <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 flex items-start gap-2.5">
              <div className="p-1.5 bg-white text-kits-blue rounded-lg border border-blue-200 shrink-0 mt-0.5">
                <Clock className="h-4 w-4" />
              </div>
              <div className="text-xs space-y-0.5">
                <span className="font-black text-gray-900 block">Option 1 — Upload Later</span>
                <p className="text-gray-600 leading-relaxed">
                  Compress your document to under 20 MB and upload it later through the KITS-EOS portal. Uploading now is not mandatory to continue.
                </p>
              </div>
            </div>

            {/* Option 2 */}
            <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100 flex items-start gap-2.5">
              <div className="p-1.5 bg-white text-emerald-600 rounded-lg border border-emerald-200 shrink-0 mt-0.5">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div className="text-xs space-y-0.5">
                <span className="font-black text-gray-900 block">Option 2 — Send Directly to Your Coordinator</span>
                <p className="text-gray-600 leading-relaxed">
                  You can send this document directly to the coordinator responsible for your sub-event through WhatsApp with your registration details pre-filled.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Coordinators Contact Section */}
        <div className="space-y-2.5 pt-2 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-gray-800 flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-emerald-600" />
              Your Coordinators ({validCoordinators.length})
            </h4>
            <span className="text-[10px] text-gray-400 font-mono">
              Sub-event: {subEventName}
            </span>
          </div>

          {validCoordinators.length === 0 ? (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-gray-700">
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                <span>Coordinator Contact Unavailable</span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                Coordinator contact information is currently unavailable for this sub-event. Please contact event administration for assistance or upload a compressed version under 20 MB.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {validCoordinators.map((coord) => (
                <div 
                  key={coord.id} 
                  className="p-3 bg-white rounded-xl border border-gray-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:border-emerald-300 transition"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-xs text-gray-900 break-words">
                        {coord.display_name}
                      </span>
                      <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                        {coord.coordinator_type === 'FACULTY' 
                          ? 'Faculty Coordinator' 
                          : coord.coordinator_type === 'STUDENT' 
                            ? 'Student Coordinator' 
                            : 'Sub-Event Coordinator'}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-gray-500 block mt-0.5">
                      {formatPhoneNumber(coord.phone_number)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleWhatsAppClick(coord)}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white rounded-xl text-xs font-bold uppercase tracking-wider transition shadow-2xs cursor-pointer shrink-0 min-h-[40px]"
                  >
                    <MessageCircle className="h-3.5 w-3.5 fill-white" />
                    <span>WhatsApp {coord.display_name.split(' ')[0]}</span>
                    <ExternalLink className="h-3 w-3 opacity-80" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Explicit third-party delivery & privacy disclaimer */}
          <div className="flex items-start gap-2 p-2.5 bg-amber-50/80 border border-amber-200/70 rounded-xl text-[10.5px] text-amber-900 leading-relaxed">
            <Info className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            <span>
              <strong>Third-Party Privacy Notice:</strong> When choosing to contact a coordinator via WhatsApp, you leave KITS-EOS and communicate through a third-party service subject to WhatsApp's own terms and privacy policies. KITS-EOS does not automatically transmit files or log external messages. You remain in control of what you attach and share.
            </span>
          </div>
        </div>

        {/* Clear non-blocking guidance & Actions */}
        <div className="pt-3 border-t border-gray-100 space-y-3">
          <div className="bg-blue-50/70 p-2.5 rounded-xl border border-blue-200/60 text-center">
            <p className="text-[11px] text-blue-900 font-bold">
              Uploading now is not mandatory. You can upload this document later or send it directly to your coordinator.
            </p>
          </div>

          <div className="flex flex-col-reverse sm:grid sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onChooseDifferentFile ? () => { onChooseDifferentFile(); onClose(); } : onClose}
              className="w-full py-2.5 px-4 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition cursor-pointer text-center min-h-[42px]"
            >
              Try Another File
            </button>
            <button
              type="button"
              onClick={handleDeferAndClose}
              className="w-full py-2.5 px-4 rounded-xl bg-kits-blue text-white text-xs font-black uppercase tracking-wider shadow-2xs hover:bg-blue-800 active:scale-[0.98] transition cursor-pointer text-center min-h-[42px]"
            >
              Upload Later / Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
