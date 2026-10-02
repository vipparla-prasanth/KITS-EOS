import type { ReactNode } from 'react';
import { FileQuestion } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="text-center rounded-lg border-2 border-dashed border-gray-300 p-12 bg-white">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
        {icon || <FileQuestion className="h-6 w-6 text-gray-400" />}
      </div>
      <h3 className="mt-4 text-sm font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm text-gray-500">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
