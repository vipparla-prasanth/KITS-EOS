/**
 * KITS-EOS DPDP Privacy Notice Governance Utilities
 * Standardized version tracking, non-repudiation acknowledgement checks, and session postponement.
 */

export const CURRENT_PRIVACY_NOTICE_VERSION = '1.0';
export const PRIVACY_NOTICE_POSTPONED_KEY = 'kits_eos_privacy_postponed_version';

export interface PrivacyCheckableProfile {
  privacy_acknowledged_at?: string | null;
  privacy_notice_version?: string | null;
}

/**
 * Checks whether the student has explicitly acknowledged the specified privacy notice version.
 */
export function isPrivacyNoticeAcknowledged(
  profile?: PrivacyCheckableProfile | null,
  expectedVersion: string = CURRENT_PRIVACY_NOTICE_VERSION
): boolean {
  if (!profile || !profile.privacy_acknowledged_at) {
    return false;
  }
  const cleanVersion = (profile.privacy_notice_version || '').trim();
  return cleanVersion === expectedVersion.trim();
}

/**
 * Checks whether the current session has postponed reviewing the privacy notice.
 */
export function isPrivacyNoticePostponed(
  expectedVersion: string = CURRENT_PRIVACY_NOTICE_VERSION
): boolean {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return false;
  }
  try {
    const postponed = window.sessionStorage.getItem(PRIVACY_NOTICE_POSTPONED_KEY);
    return postponed === expectedVersion.trim();
  } catch (err) {
    console.warn('[Privacy] Failed to read postponement state:', err);
    return false;
  }
}

/**
 * Temporarily postpones the privacy notice prompt for the remainder of the active browser session.
 */
export function postponePrivacyNotice(
  version: string = CURRENT_PRIVACY_NOTICE_VERSION
): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }
  try {
    window.sessionStorage.setItem(PRIVACY_NOTICE_POSTPONED_KEY, version.trim());
  } catch (err) {
    console.warn('[Privacy] Failed to persist postponement state:', err);
  }
}

/**
 * Clears postponement state from session storage (e.g., after acknowledgement).
 */
export function clearPrivacyNoticePostponement(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }
  try {
    window.sessionStorage.removeItem(PRIVACY_NOTICE_POSTPONED_KEY);
  } catch (err) {
    console.warn('[Privacy] Failed to clear postponement state:', err);
  }
}

export interface ShouldPromptPrivacyNoticeParams {
  isLoading?: boolean;
  isAuthTransitioning?: boolean;
  isAuthenticated: boolean;
  profile?: PrivacyCheckableProfile | null;
  expectedVersion?: string;
}

/**
 * Determines whether the privacy notice acknowledgement modal should automatically display.
 * Strictly prevents flashing before profile has finished loading or during session restoration.
 */
export function shouldPromptPrivacyNotice({
  isLoading = false,
  isAuthTransitioning = false,
  isAuthenticated,
  profile,
  expectedVersion = CURRENT_PRIVACY_NOTICE_VERSION
}: ShouldPromptPrivacyNoticeParams): boolean {
  // Never prompt while authentication or profile data is resolving
  if (isLoading || isAuthTransitioning) {
    return false;
  }

  // Only prompt authenticated users with an existing profile
  if (!isAuthenticated || !profile) {
    return false;
  }

  // If already acknowledged the target version, do not prompt
  if (isPrivacyNoticeAcknowledged(profile, expectedVersion)) {
    return false;
  }

  // If user chose "Review Later" in this session, do not prompt
  if (isPrivacyNoticePostponed(expectedVersion)) {
    return false;
  }

  return true;
}
