/**
 * Formats an ISO date string or Date object into KITS-EOS standard 12-hour format:
 * DD-MM-YYYY hh:mm AM/PM
 * Example: 30-08-2026 04:30 PM
 */
export function formatDateTime12h(val: string | Date | null | undefined): string {
  if (!val) return 'TBA';
  const date = typeof val === 'string' ? new Date(val) : val;
  if (isNaN(date.getTime())) return 'TBA';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hoursStr = String(hours).padStart(2, '0');

  return `${day}-${month}-${year} ${hoursStr}:${minutes} ${period}`;
}

export function formatDateOnly(val: string | Date | null | undefined): string {
  if (!val) return 'TBA';
  const date = typeof val === 'string' ? new Date(val) : val;
  if (isNaN(date.getTime())) return 'TBA';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}-${month}-${year}`;
}

export function formatRelativeTime(val: string | Date | null | undefined): string {
  if (!val) return '';
  const date = typeof val === 'string' ? new Date(val) : val;
  if (isNaN(date.getTime())) return '';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;

  return formatDateOnly(date);
}
