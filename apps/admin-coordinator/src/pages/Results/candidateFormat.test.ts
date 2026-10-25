import { describe, it, expect } from 'vitest';
import {
  resolveStudentName,
  resolveCandidateTitle,
  formatRollNumber,
} from './candidateFormat';

describe('candidateFormat utilities', () => {
  describe('resolveStudentName', () => {
    it('uses snapshot_name when present and specific', () => {
      expect(resolveStudentName('Prasanth Vipparla', 'P. Vipparla')).toBe('Prasanth Vipparla');
    });

    it('falls back to profile full_name if snapshot_name is generic "Participant"', () => {
      expect(resolveStudentName('Participant', 'John Doe')).toBe('John Doe');
      expect(resolveStudentName('participant', 'John Doe')).toBe('John Doe');
    });

    it('falls back to profile full_name if snapshot_name is null, empty, or whitespace', () => {
      expect(resolveStudentName('', 'Jane Doe')).toBe('Jane Doe');
      expect(resolveStudentName(null, 'Jane Doe')).toBe('Jane Doe');
      expect(resolveStudentName('   ', 'Jane Doe')).toBe('Jane Doe');
    });

    it('uses snapshot_name if profile full_name is missing even if generic', () => {
      expect(resolveStudentName('Participant', null)).toBe('Participant');
    });

    it('returns "Name unavailable" if both snapshot_name and profile full_name are empty', () => {
      expect(resolveStudentName(null, null)).toBe('Name unavailable');
      expect(resolveStudentName('', '')).toBe('Name unavailable');
      expect(resolveStudentName('   ', undefined)).toBe('Name unavailable');
    });
  });

  describe('resolveCandidateTitle', () => {
    it('displays student full name prominently for solo participant', () => {
      const title = resolveCandidateTitle({
        isTeam: false,
        teamName: 'Solo Participant',
        leaderName: 'Prasanth Vipparla',
      });
      expect(title).toBe('Prasanth Vipparla');
    });

    it('falls back gracefully for solo participant with missing leader name', () => {
      const title = resolveCandidateTitle({
        isTeam: false,
        teamName: 'Solo Participant',
        leaderName: 'Name unavailable',
      });
      expect(title).toBe('Name unavailable');
    });

    it('displays custom team name for team event', () => {
      const title = resolveCandidateTitle({
        isTeam: true,
        teamName: 'Code Ninjas',
        leaderName: 'Bob Leader',
      });
      expect(title).toBe('Code Ninjas');
    });

    it('falls back to "Team (Leader Name)" when team has no custom name', () => {
      const title = resolveCandidateTitle({
        isTeam: true,
        teamName: 'Solo Participant',
        leaderName: 'Bob Leader',
      });
      expect(title).toBe('Team (Bob Leader)');
    });

    it('falls back to "Team" when both team name and leader name are missing for team', () => {
      const title = resolveCandidateTitle({
        isTeam: true,
        teamName: '',
        leaderName: 'Name unavailable',
      });
      expect(title).toBe('Team');
    });
  });

  describe('formatRollNumber', () => {
    it('formats roll number in uppercase', () => {
      expect(formatRollNumber('25jk5a4203')).toBe('25JK5A4203');
    });

    it('returns "N/A" for null, undefined, or empty roll number', () => {
      expect(formatRollNumber(null)).toBe('N/A');
      expect(formatRollNumber('')).toBe('N/A');
      expect(formatRollNumber('   ')).toBe('N/A');
    });
  });
});
