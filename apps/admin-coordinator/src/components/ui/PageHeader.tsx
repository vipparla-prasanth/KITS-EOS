import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6 lg:mb-8">
      <div className="min-w-0 flex-1">
        <h2 className="text-xl sm:text-2xl lg:text-3xl font-black leading-tight text-gray-900 tracking-tight">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-xs sm:text-sm text-gray-500 font-medium leading-relaxed">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex shrink-0 w-full sm:w-auto">
          {action}
        </div>
      )}
    </div>
  );
}
export default PageHeader;
