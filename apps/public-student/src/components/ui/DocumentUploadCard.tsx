import { useState, useRef, useId } from 'react';
import type { RequiredDocumentConfig } from '@kits-eos/shared/src/types/models';
import { 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  Clock, 
  Phone, 
  MessageCircle, 
  RefreshCw,
  X
} from 'lucide-react';

export interface UploadedDocInfo {
  name: string;
  file_name: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string;
}

export interface DeferredDocInfo {
  reason: 'UPLOAD_LATER' | 'WHATSAPP_COORDINATOR';
  timestamp: number;
}

export interface DocumentUploadCardProps {
  doc: RequiredDocumentConfig;
  uploadedDoc?: UploadedDocInfo | null;
  isDeferred?: DeferredDocInfo | null;
  isExternalUploading?: boolean;
  onFileUpload: (doc: RequiredDocumentConfig, file: File) => Promise<void>;
  onOversizedFile: (doc: RequiredDocumentConfig, file: File) => void;
  onOpenCoordinatorModal: (doc: RequiredDocumentConfig) => void;
  maxSizeBytes?: number; // 20 MB default (20 * 1024 * 1024)
  inputRefCallback?: (el: HTMLInputElement | null) => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentUploadCard({
  doc,
  uploadedDoc,
  isDeferred,
  isExternalUploading = false,
  onFileUpload,
  onOversizedFile,
  onOpenCoordinatorModal,
  maxSizeBytes = 20 * 1024 * 1024,
  inputRefCallback,
}: DocumentUploadCardProps) {
  const generatedId = useId();
  const inputId = `doc-file-input-${(doc.id || doc.name || generatedId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLocalUploading, setIsLocalUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isUploading = isLocalUploading || isExternalUploading;

  const handleFileSelect = async (file?: File) => {
    if (!file) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Strict 20 MB size limit check
    if (file.size > maxSizeBytes) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSelectedFile(null);
      setIsLocalUploading(false);
      setUploadError(null);
      onOversizedFile(doc, file);
      return;
    }

    setSelectedFile(file);
    setUploadError(null);
    setIsLocalUploading(true);

    try {
      await onFileUpload(doc, file);
      // Successful upload / replacement: clear local file state since uploadedDoc takes over
      setSelectedFile(null);
      setUploadError(null);
    } catch (err: any) {
      console.error('File upload failed in DocumentUploadCard:', err);
      setUploadError(err.message || 'Upload failed. Please try again.');
    } finally {
      setIsLocalUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRetry = () => {
    if (selectedFile) {
      handleFileSelect(selectedFile);
    } else if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleCancelSelected = () => {
    setSelectedFile(null);
    setUploadError(null);
    setIsLocalUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3 transition-all">
      {/* Mobile-safe Hidden File Input (sr-only without pointer-events-none to ensure reliable mobile tap triggers) */}
      <input
        id={inputId}
        ref={(el) => {
          (fileInputRef as any).current = el;
          if (inputRefCallback) inputRefCallback(el);
        }}
        type="file"
        className="sr-only"
        tabIndex={-1}
        onClick={(e) => {
          // Guarantee input is reset before the OS file picker opens so re-selecting same file fires onChange
          (e.target as HTMLInputElement).value = '';
        }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Always clear immediately so repeated selections are never blocked
          e.target.value = '';
          if (file) handleFileSelect(file);
        }}
        disabled={isUploading}
      />

      {/* Header: Document Title & Accurate Status Badge */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-black text-gray-800 break-words">{doc.name}</span>
        
        {uploadedDoc ? (
          <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Uploaded
          </span>
        ) : isDeferred?.reason === 'UPLOAD_LATER' ? (
          <span className="text-[10px] font-bold text-amber-700 flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 shrink-0">
            <Clock className="h-3 w-3 text-amber-600" /> Upload Deferred
          </span>
        ) : isDeferred?.reason === 'WHATSAPP_COORDINATOR' ? (
          <span className="text-[10px] font-bold text-blue-700 flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 shrink-0">
            <Phone className="h-3 w-3 text-emerald-600" /> Coordinator Contact Provided
          </span>
        ) : (
          <span className="text-[10px] font-bold text-amber-600 bg-amber-50/80 px-2 py-0.5 rounded-full border border-amber-200/70 shrink-0">
            Required
          </span>
        )}
      </div>

      {/* Document Description */}
      {doc.description && (
        <p className="text-[11px] text-gray-500 leading-relaxed font-normal">{doc.description}</p>
      )}

      {/* Body: State-driven interactive card */}
      <div className="pt-0.5">
        {/* State 1: Active Upload In-Progress */}
        {isUploading ? (
          <div className="p-3.5 bg-white rounded-xl border border-blue-200 shadow-2xs space-y-2 relative overflow-hidden">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 rounded-lg bg-blue-50 text-kits-blue shrink-0">
                  <Upload className="h-4 w-4 animate-upload-bounce" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-900 truncate">
                    {selectedFile?.name || 'Uploading document...'}
                  </p>
                  <p className="text-[10px] text-gray-400 font-mono">
                    {formatBytes(selectedFile?.size)} • Secure Cloud Upload
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-bold text-kits-blue font-mono shrink-0">
                Uploading...
              </span>
            </div>

            {/* Continuous gradient shimmer progress track */}
            <div className="h-1.5 w-full bg-blue-50 rounded-full overflow-hidden border border-blue-100 relative">
              <div className="h-full w-1/2 bg-kits-blue animate-transfer-shimmer rounded-full" />
            </div>
          </div>
        ) : uploadError ? (
          /* State 2: Upload Failed / Error */
          <div className="p-3 bg-red-50/70 rounded-xl border border-red-200 space-y-2.5 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-red-800 font-bold">
                <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
                <span>Upload Failed</span>
              </div>
              <button
                type="button"
                onClick={handleCancelSelected}
                className="text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer"
                title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-red-700 leading-tight">
              {uploadError}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRetry}
                className="flex-1 py-1.5 px-3 bg-kits-red hover:bg-red-700 text-white rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry Upload</span>
              </button>
              <label
                htmlFor={inputId}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                      fileInputRef.current.click();
                    }
                  }
                }}
                className="py-1.5 px-3 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded-lg font-bold text-xs transition cursor-pointer inline-flex items-center justify-center select-none"
              >
                Choose Other File
              </label>
            </div>
          </div>
        ) : uploadedDoc ? (
          /* State 3: Successfully Uploaded */
          <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-gray-200 shadow-2xs gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100 shrink-0">
                <FileText className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-bold text-gray-800 truncate" title={uploadedDoc.file_name}>
                  {uploadedDoc.file_name}
                </p>
                {uploadedDoc.size_bytes > 0 && (
                  <p className="text-[10px] text-gray-400 font-mono">
                    {formatBytes(uploadedDoc.size_bytes)}
                  </p>
                )}
              </div>
            </div>

            <label
              htmlFor={inputId}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                    fileInputRef.current.click();
                  }
                }
              }}
              className="text-kits-blue font-bold text-[11px] hover:underline cursor-pointer ml-2 shrink-0 px-2 py-1 bg-blue-50/50 hover:bg-blue-50 rounded-lg transition inline-flex items-center justify-center select-none active:scale-95"
            >
              Replace
            </label>
          </div>
        ) : isDeferred ? (
          /* State 4: Upload Deferred or WhatsApp Contacted */
          <div className="p-3 bg-white rounded-xl border border-gray-200 text-xs space-y-2.5 shadow-2xs">
            <div className="text-[11px] text-gray-700 font-medium leading-tight">
              {isDeferred.reason === 'UPLOAD_LATER'
                ? 'Upload deferred. You can compress and upload this file later through the portal.'
                : 'Coordinator contact provided for alternative submission. File must still be sent directly to your coordinator.'}
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor={inputId}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                      fileInputRef.current.click();
                    }
                  }
                }}
                className="flex-1 text-center py-2 px-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg font-bold text-[11px] text-gray-700 cursor-pointer transition inline-flex items-center justify-center select-none"
              >
                Upload File Instead
              </label>

              <button
                type="button"
                onClick={() => onOpenCoordinatorModal(doc)}
                className="py-2 px-3 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg font-bold text-[11px] text-emerald-700 transition flex items-center gap-1 cursor-pointer shrink-0"
              >
                {isDeferred.reason === 'UPLOAD_LATER' ? (
                  <>
                    <Phone className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Contact Coordinator</span>
                  </>
                ) : (
                  <>
                    <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Reopen WhatsApp</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* State 5: Idle - Ready for File Selection */
          <label
            htmlFor={inputId}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                  fileInputRef.current.click();
                }
              }
            }}
            className="w-full flex items-center justify-center gap-2 p-3 bg-white border border-dashed border-gray-300 rounded-xl hover:border-kits-blue text-xs font-bold text-gray-600 hover:text-kits-blue transition cursor-pointer active:scale-[0.99] group shadow-2xs select-none"
          >
            <Upload className="h-4 w-4 text-gray-400 group-hover:text-kits-blue transition" />
            <span>Choose File (Max 20 MB)</span>
          </label>
        )}
      </div>
    </div>
  );
}
