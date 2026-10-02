import type { ParticipantRecord } from '../types';
import { exportToExcel } from '@kits-eos/shared';

/**
 * Normalizes participant data into flat export rows.
 */
function buildExportRows(participants: ParticipantRecord[]): (string | number)[][] {
  const rows: (string | number)[][] = [];
  let serialNumber = 1;

  for (const p of participants) {
    const regDate = p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN') : 'N/A';

    if (p.registration_type === 'TEAM' && p.team_members && p.team_members.length > 0) {
      for (const tm of p.team_members) {
        rows.push([
          serialNumber++,
          tm.college || p.college || 'KITS Akshar Institute of Technology',
          tm.student_name,
          tm.roll_number,
          tm.department || 'N/A',
          tm.year_of_study || 1,
          'TEAM',
          p.team_name || 'Team',
          tm.is_leader ? 'Leader' : 'Member',
          p.status,
          regDate,
        ]);
      }
    } else {
      rows.push([
        serialNumber++,
        p.college || 'KITS Akshar Institute of Technology',
        p.student_name,
        p.roll_number,
        p.department || 'N/A',
        p.year_of_study || 1,
        'SOLO',
        '—',
        'Solo Participant',
        p.status,
        regDate,
      ]);
    }
  }

  return rows;
}

const EXPORT_HEADERS = [
  'S.No',
  'College / Institution',
  'Student Name',
  'Roll Number',
  'Department',
  'Year of Study',
  'Registration Mode',
  'Team Name',
  'Team Role',
  'Registration Status',
  'Registration Date',
];

/**
 * Downloads participant roster as an authentic CSV file.
 */
export function exportParticipantsToCSV(eventName: string, subEventName: string, participants: ParticipantRecord[]): void {
  const rows = buildExportRows(participants);

  const escapeCell = (val: string | number | undefined | null): string => {
    if (val === undefined || val === null) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const csvContent = [
    EXPORT_HEADERS.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ].join('\r\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const sanitizedEvent = eventName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedSub = subEventName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dateStr = new Date().toISOString().slice(0, 10);

  link.setAttribute('href', url);
  link.setAttribute('download', `KITS_EOS_${sanitizedEvent}_${sanitizedSub}_Participants_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Downloads participant roster as an authentic Excel (.xlsx) file
 * using the global institutional KITS-EOS styling engine.
 */
export async function exportParticipantsToExcel(eventName: string, subEventName: string, participants: ParticipantRecord[]): Promise<void> {
  const rows = buildExportRows(participants);
  const sanitizedEvent = eventName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedSub = subEventName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dateStr = new Date().toISOString().slice(0, 10);

  await exportToExcel({
    filename: `KITS_EOS_${sanitizedEvent}_${sanitizedSub}_Participants_${dateStr}.xlsx`,
    title: `${eventName.toUpperCase()} — ${subEventName.toUpperCase()}`,
    subtitle: `Participant Roster • Standby Node | Records: ${rows.length}`,
    sheetName: 'Participants',
    headers: EXPORT_HEADERS,
    rows,
  });
}
