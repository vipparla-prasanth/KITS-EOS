import { useState, useRef } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { UploadCloud, X, Check } from 'lucide-react';

interface ImageUploadProps {
  value: string | null;
  onChange: (path: string | null) => void;
  folder?: string;
  bucket?: string;
  label?: string;
  helperText?: string;
}

export function ImageUpload({
  value,
  onChange,
  folder = 'banners',
  bucket = 'events',
  label = 'Banner Image',
  helperText = 'PNG, JPG, WebP up to 5MB. Recommended ratio: 16:9',
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(value);
  const [fileMeta, setFileMeta] = useState<{ name: string; size: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getPublicUrl = (path: string) => {
    if (path.startsWith('http')) return path;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file (PNG, JPG, WebP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Image file size must be less than 5MB.');
      return;
    }

    setError(null);
    setIsUploading(true);
    setIsSuccess(false);
    setFileMeta({
      name: file.name,
      size: formatFileSize(file.size),
    });

    try {
      // Local preview immediately for responsive feedback
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);

      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;

      const { data, error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }

      if (data?.path) {
        const publicUrl = getPublicUrl(data.path);
        setPreviewUrl(publicUrl);
        onChange(publicUrl);
        setIsSuccess(true);
        setTimeout(() => {
          setIsSuccess(false);
        }, 2000);
      }
    } catch (err: any) {
      console.error('Image upload failed:', err);
      setError(err?.message || 'Failed to upload image. Please try again.');
      setPreviewUrl(value);
      setFileMeta(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewUrl(null);
    setFileMeta(null);
    setIsSuccess(false);
    onChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const displayUrl = previewUrl ? (previewUrl.startsWith('blob:') ? previewUrl : getPublicUrl(previewUrl)) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
          {label}
        </label>
        {fileMeta && !isUploading && (
          <span className="text-[11px] text-gray-400 font-mono truncate max-w-xs">
            {fileMeta.name} ({fileMeta.size})
          </span>
        )}
      </div>

      {displayUrl ? (
        <div className="relative rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 shadow-sm max-w-xl group">
          <img
            src={displayUrl}
            alt="Banner Preview"
            className="w-full h-48 sm:h-52 object-cover object-center transition-transform duration-300 group-hover:scale-[1.01]"
          />

          {/* Uploading Overlay */}
          {isUploading && (
            <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs flex flex-col items-center justify-center gap-3 p-4 text-white animate-in fade-in duration-200">
              <div className="p-3 bg-white/10 rounded-2xl border border-white/15 animate-upload-bounce">
                <UploadCloud className="h-6 w-6 text-white" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-xs font-black uppercase tracking-wider">Uploading Banner...</p>
                {fileMeta && (
                  <p className="text-[11px] text-white/70 font-mono truncate max-w-xs">
                    {fileMeta.name} • {fileMeta.size}
                  </p>
                )}
              </div>
              {/* Shimmer Progress Track */}
              <div className="w-44 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-kits-red via-rose-300 to-amber-300 rounded-full animate-transfer-shimmer" />
              </div>
            </div>
          )}

          {/* Success Overlay */}
          {isSuccess && (
            <div className="absolute inset-0 bg-emerald-950/70 backdrop-blur-xs flex flex-col items-center justify-center gap-2 p-4 text-white animate-in fade-in duration-200">
              <div className="h-10 w-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg animate-pop-success">
                <Check className="h-5 w-5 stroke-[3]" />
              </div>
              <span className="text-xs font-black uppercase tracking-wider">Banner Uploaded</span>
            </div>
          )}

          {/* Hover Controls (Only when not uploading) */}
          {!isUploading && !isSuccess && (
            <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 p-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-2 bg-white text-gray-900 text-xs font-bold rounded-xl shadow-md hover:bg-gray-100 transition cursor-pointer"
              >
                Change Banner
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="p-2 bg-red-600 text-white rounded-xl shadow-md hover:bg-red-700 transition cursor-pointer"
                title="Remove banner"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 max-w-xl text-center cursor-pointer transition-all ${
            isUploading
              ? 'border-gray-300 bg-gray-50 cursor-not-allowed'
              : 'border-gray-300 hover:border-kits-red hover:bg-red-50/20 bg-white'
          }`}
        >
          {isUploading ? (
            <div className="flex flex-col items-center justify-center py-2 space-y-3 text-gray-500">
              <div className="p-3 bg-red-50 text-kits-red rounded-2xl border border-red-100 animate-upload-bounce">
                <UploadCloud className="h-6 w-6" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-xs font-black uppercase tracking-wider text-gray-800">Uploading Banner...</p>
                <p className="text-[11px] text-gray-400">Encrypting & saving to storage</p>
              </div>
              <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-kits-red via-rose-400 to-amber-400 rounded-full animate-transfer-shimmer" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-2">
              <div className="w-12 h-12 rounded-2xl bg-red-50 text-kits-red flex items-center justify-center mb-3 shadow-2xs">
                <UploadCloud className="h-6 w-6" />
              </div>
              <p className="text-xs sm:text-sm font-bold text-gray-900 mb-1">
                Click to upload banner image
              </p>
              <p className="text-[11px] text-gray-500">{helperText}</p>
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/jpg"
        onChange={handleFileChange}
        disabled={isUploading}
        className="hidden"
      />

      {error && (
        <p className="mt-2 text-xs font-medium text-red-600 flex items-center gap-1">
          <X className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}
