import { Loader2 as Spinner } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Loading...' }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-64">
      <Spinner className="w-8 h-8 text-kits-red animate-spin mb-4" />
      <p className="text-sm font-medium text-gray-500">{message}</p>
    </div>
  );
}
