import { useState, useEffect } from 'react';
import { Check, Cloud, RefreshCw, AlertCircle, AlertTriangle } from 'lucide-react';
import type { DraftSaveStatus } from '../hooks/useFormDraft';

interface DraftSaveIndicatorProps {
  status: DraftSaveStatus;
  lastSavedAt?: Date | null;
  errorMessage?: string | null;
  className?: string;
}

export function DraftSaveIndicator({
  status,
  lastSavedAt,
  errorMessage,
  className = '',
}: DraftSaveIndicatorProps) {
  const [, setTick] = useState(0);

  // Update relative time display every 15 seconds
  useEffect(() => {
    if (!lastSavedAt) return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 15000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);

  const getRelativeTime = (date: Date): string => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  if (status === 'idle' && !lastSavedAt) {
    return null;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 ${className} ${
        status === 'saving'
          ? 'bg-blue-50 text-blue-700 border border-blue-200'
          : status === 'error'
          ? 'bg-amber-50 text-amber-800 border border-amber-200'
          : status === 'conflict'
          ? 'bg-amber-100 text-amber-900 border border-amber-300'
          : 'bg-gray-100 text-gray-600 border border-gray-200'
      }`}
      role="status"
      aria-live="polite"
    >
      {status === 'saving' && (
        <>
          <RefreshCw className="w-3 h-3 animate-spin text-blue-600 shrink-0" />
          <span>Saving draft...</span>
        </>
      )}

      {status === 'saved' && (
        <>
          <Check className="w-3 h-3 text-emerald-600 shrink-0" />
          <span>
            Saved {lastSavedAt ? getRelativeTime(lastSavedAt) : 'just now'}
          </span>
        </>
      )}

      {status === 'idle' && lastSavedAt && (
        <>
          <Cloud className="w-3 h-3 text-gray-400 shrink-0" />
          <span>Saved {getRelativeTime(lastSavedAt)}</span>
        </>
      )}

      {status === 'conflict' && (
        <>
          <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
          <span title={errorMessage || 'Draft updated elsewhere'}>
            Sync note: updated in another tab
          </span>
        </>
      )}

      {status === 'error' && (
        <>
          <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
          <span title={errorMessage || 'Unable to save'}>Autosave paused</span>
        </>
      )}
    </div>
  );
}
