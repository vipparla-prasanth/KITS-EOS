import React from 'react';
import { Calendar } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  icon = <Calendar className="h-8 w-8 text-gray-400" />,
  action,
}: EmptyStateProps) {
  return (
    <div className="text-center bg-white rounded-2xl border border-gray-200 p-12 shadow-2xs max-w-md mx-auto">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-50 border border-gray-100">
        {icon}
      </div>
      <h3 className="mt-4 text-sm font-extrabold text-gray-900">{title}</h3>
      <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">{description}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
