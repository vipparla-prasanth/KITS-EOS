import type React from 'react';
import { Link } from 'react-router-dom';
import { OperationsLottiePlayer } from './OperationsLottiePlayer';
import { Plus } from 'lucide-react';

export interface OperationsEmptyStateProps {
  title: string;
  description: string;
  actionText?: string;
  actionHref?: string;
  onActionClick?: () => void;
  icon?: React.ReactNode;
  className?: string;
}

export function OperationsEmptyState({
  title,
  description,
  actionText,
  actionHref,
  onActionClick,
  className = '',
}: OperationsEmptyStateProps) {
  return (
    <div className={`bg-white rounded-3xl border border-gray-200 shadow-2xs p-8 sm:p-12 text-center max-w-lg mx-auto space-y-5 page-enter ${className}`}>
      {/* Compact Lottie Illustration */}
      <div className="w-44 h-36 mx-auto flex items-center justify-center relative">
        <div className="absolute inset-0 bg-blue-50/50 rounded-full blur-2xl -z-10" />
        <OperationsLottiePlayer width={180} height={140} />
      </div>

      <div className="space-y-1.5">
        <h3 className="text-lg font-black text-gray-900 tracking-tight">
          {title}
        </h3>
        <p className="text-xs text-gray-500 leading-relaxed max-w-sm mx-auto">
          {description}
        </p>
      </div>

      {(actionText && actionHref) && (
        <Link
          to={actionHref}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 shadow-2xs active:scale-95 transition cursor-pointer"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          <span>{actionText}</span>
        </Link>
      )}

      {(actionText && onActionClick && !actionHref) && (
        <button
          type="button"
          onClick={onActionClick}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 shadow-2xs active:scale-95 transition cursor-pointer"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          <span>{actionText}</span>
        </button>
      )}
    </div>
  );
}
