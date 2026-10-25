/**
 * Candidate Name & Title Formatting Utilities for Result Declaration
 * Ensures canonical student full names are prominently displayed alongside roll numbers.
 */

/**
 * Resolves a student's full name canonically with graceful fallbacks.
 *
 * Precedence:
 * 1. Non-empty `snapshot_name` (unless it is the generic placeholder 'Participant')
 * 2. Canonical `student_profiles.full_name`
 * 3. Non-empty `snapshot_name`
 * 4. Fallback to 'Name unavailable'
 */
export function resolveStudentName(
  snapshotName?: string | null,
  profileFullName?: string | null
): string {
  const cleanSnapshot = snapshotName?.trim();
  const cleanProfile = profileFullName?.trim();

  if (cleanSnapshot && cleanSnapshot.toLowerCase() !== 'participant') {
    return cleanSnapshot;
  }
  if (cleanProfile) {
    return cleanProfile;
  }
  if (cleanSnapshot) {
    return cleanSnapshot;
  }
  return 'Name unavailable';
}

/**
 * Derives the prominent display title for a candidate card in Result Declaration.
 *
 * For SOLO participants: displays the student's full name prominently.
 * For TEAM participants: displays the registered team name (or falls back to "Team (Leader Name)" / "Team").
 */
export function resolveCandidateTitle(options: {
  isTeam: boolean;
  teamName?: string | null;
  leaderName?: string | null;
}): string {
  const { isTeam, teamName, leaderName } = options;
  const cleanTeamName = teamName?.trim();
  const cleanLeaderName = leaderName?.trim();

  if (!isTeam) {
    if (cleanLeaderName && cleanLeaderName !== 'Name unavailable' && cleanLeaderName.toLowerCase() !== 'participant') {
      return cleanLeaderName;
    }
    if (cleanTeamName && cleanTeamName !== 'Solo Participant') {
      return cleanTeamName;
    }
    return cleanLeaderName || 'Name unavailable';
  }

  if (cleanTeamName && cleanTeamName !== 'Solo Participant') {
    return cleanTeamName;
  }

  if (cleanLeaderName && cleanLeaderName !== 'Name unavailable' && cleanLeaderName.toLowerCase() !== 'participant') {
    return `Team (${cleanLeaderName})`;
  }

  return 'Team';
}

/**
 * Formats roll numbers cleanly with uppercase letters and a graceful fallback.
 */
export function formatRollNumber(rollNumber?: string | null): string {
  const clean = rollNumber?.trim();
  return clean ? clean.toUpperCase() : 'N/A';
}
