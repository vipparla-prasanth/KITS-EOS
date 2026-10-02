import React, { useState, useRef, useEffect } from 'react';
import { Download, CheckCircle2, AlertCircle } from 'lucide-react';

export type DownloadState = 'idle' | 'starting' | 'progress' | 'complete' | 'error';

export interface DownloadButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onDownload: () => Promise<void> | void;
  label?: string;
  loadingLabel?: string;
  preparingLabel?: string;
  downloadingLabel?: string;
  completeLabel?: string;
  completedLabel?: string;
  errorLabel?: string;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'success' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  progress?: number | null; // Real progress percentage (0-100) if available
  resetDelayMs?: number; // Time before returning to idle after completion (default 1800ms)
}

export function DownloadButton({
  onDownload,
  label = 'Download',
  loadingLabel,
  preparingLabel,
  downloadingLabel = 'Downloading...',
  completeLabel,
  completedLabel,
  errorLabel = 'Download failed',
  icon,
  variant = 'primary',
  size = 'md',
  progress = null,
  resetDelayMs = 1800,
  className = '',
  disabled = false,
  title,
  onClick,
  ...rest
}: DownloadButtonProps) {
  const [state, setState] = useState<DownloadState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeLoadingLabel = preparingLabel || loadingLabel || 'Preparing download...';
  const activeCompleteLabel = completedLabel || completeLabel || 'Downloaded';

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (onClick) onClick(e);
    if (state !== 'idle' || disabled) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    try {
      // Step 1: Starting / Preparing
      setState('starting');

      // Subtle step transition into downloading progress state
      const progressTimer = setTimeout(() => {
        setState((current) => (current === 'starting' ? 'progress' : current));
      }, 250);

      // Execute actual download promise / function
      const result = onDownload();
      if (result instanceof Promise) {
        await result;
      }

      clearTimeout(progressTimer);

      // Step 2: Download Complete
      setState('complete');

      // Auto return to idle after specified duration
      timerRef.current = setTimeout(() => {
        setState('idle');
      }, resetDelayMs);

    } catch (err) {
      console.error('Download operation failed:', err);
      setState('error');
      timerRef.current = setTimeout(() => {
        setState('idle');
      }, 2400);
    }
  };

  // Base styling per size
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-[11px] gap-1.5 rounded-xl min-h-[34px]',
    md: 'px-4 py-2 text-xs gap-2 rounded-xl min-h-[40px]',
    lg: 'px-5 py-2.5 text-sm gap-2.5 rounded-2xl min-h-[46px]',
  }[size];

  // Base styling per variant
  const variantClasses = {
    primary:
      'bg-kits-red text-white hover:bg-red-800 shadow-2xs active:bg-red-900 border border-red-700/20',
    secondary:
      'bg-kits-blue text-white hover:bg-blue-800 shadow-2xs active:bg-blue-900 border border-blue-900/20',
    outline:
      'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 shadow-2xs active:bg-gray-100',
    success:
      'bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs active:bg-emerald-800 border border-emerald-700/20',
    ghost:
      'bg-transparent text-gray-700 hover:bg-gray-100 active:bg-gray-200 border border-transparent',
  }[variant];

  // State-specific overrides
  const isBusy = state === 'starting' || state === 'progress';
  const isComplete = state === 'complete';
  const isError = state === 'error';

  let currentVariantClasses = variantClasses;
  if (isComplete) {
    currentVariantClasses = 'bg-emerald-600 text-white border border-emerald-500 shadow-2xs';
  } else if (isError) {
    currentVariantClasses = 'bg-amber-600 text-white border border-amber-500 shadow-2xs';
  }

  // Determine current label & icon
  let currentLabel = label;
  let currentIcon = icon || <Download className="h-4 w-4 shrink-0" />;

  if (state === 'starting') {
    currentLabel = activeLoadingLabel;
    currentIcon = <Download className="h-4 w-4 shrink-0 animate-download-bounce" />;
  } else if (state === 'progress') {
    currentLabel = typeof progress === 'number' ? `Downloading ${Math.round(progress)}%` : downloadingLabel;
    currentIcon = <Download className="h-4 w-4 shrink-0 animate-download-bounce text-amber-200" />;
  } else if (isComplete) {
    currentLabel = activeCompleteLabel;
    currentIcon = <CheckCircle2 className="h-4 w-4 shrink-0 animate-pop-success text-white" />;
  } else if (isError) {
    currentLabel = errorLabel;
    currentIcon = <AlertCircle className="h-4 w-4 shrink-0 animate-pop-success text-white" />;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isBusy || isComplete}
      title={title || (isComplete ? activeCompleteLabel : isBusy ? downloadingLabel : label)}
      aria-live="polite"
      aria-busy={isBusy}
      className={`relative overflow-hidden font-black uppercase tracking-wider inline-flex items-center justify-center select-none transition-all duration-200 cursor-pointer disabled:cursor-not-allowed ${sizeClasses} ${currentVariantClasses} ${className}`}
      {...rest}
    >
      {/* Indeterminate or determinate progress track */}
      {isBusy && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20 overflow-hidden">
          {typeof progress === 'number' ? (
            <div
              className="h-full bg-white transition-all duration-200 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          ) : (
            <div className="h-full w-1/2 bg-white/70 animate-transfer-shimmer rounded-full" />
          )}
        </div>
      )}

      {/* Button content */}
      <span className="relative z-10 flex items-center gap-2 truncate">
        {currentIcon}
        <span className="truncate">{currentLabel}</span>
      </span>
    </button>
  );
}
