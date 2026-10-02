export type StatusType = 'ACTIVE' | 'ARCHIVED' | 'PERMANENTLY_DELETED' | 'PENDING' | 'COMPLETED' | 'FAILED' | 'SUCCESS';

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  let bgColor = 'bg-gray-100';
  let textColor = 'text-gray-800';

  switch (status.toUpperCase()) {
    case 'ACTIVE':
    case 'SUCCESS':
    case 'COMPLETED':
      bgColor = 'bg-green-100';
      textColor = 'text-green-800';
      break;
    case 'ARCHIVED':
      bgColor = 'bg-yellow-100';
      textColor = 'text-yellow-800';
      break;
    case 'PERMANENTLY_DELETED':
    case 'FAILED':
      bgColor = 'bg-red-100';
      textColor = 'text-red-800';
      break;
    case 'PENDING':
      bgColor = 'bg-blue-100';
      textColor = 'text-blue-800';
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${bgColor} ${textColor}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
