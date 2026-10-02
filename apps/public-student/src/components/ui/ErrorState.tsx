import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = 'Error', message, onRetry }: ErrorStateProps) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center max-w-lg mx-auto">
      <div className="flex justify-center">
        <AlertTriangle className="h-8 w-8 text-kits-red" />
      </div>
      <h3 className="mt-2 text-sm font-bold text-gray-900">{title}</h3>
      <p className="mt-1 text-xs text-gray-600 leading-relaxed">{message}</p>
      {onRetry && (
        <div className="mt-4">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-kits-red bg-white border border-red-200 rounded-lg hover:bg-red-50 transition shadow-2xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
