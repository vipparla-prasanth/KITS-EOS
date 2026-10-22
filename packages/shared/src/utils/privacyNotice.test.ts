import { describe, it, expect, beforeEach } from 'vitest';
import {
  CURRENT_PRIVACY_NOTICE_VERSION,
  PRIVACY_NOTICE_POSTPONED_KEY,
  isPrivacyNoticeAcknowledged,
  isPrivacyNoticePostponed,
  postponePrivacyNotice,
  clearPrivacyNoticePostponement,
  shouldPromptPrivacyNotice
} from './privacyNotice';

function createStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

describe('DPDP Privacy Notice Utilities', () => {
  let mockSession: Storage;

  beforeEach(() => {
    mockSession = createStorageMock();
    (globalThis as any).window = globalThis.window || {};
    (globalThis as any).window.sessionStorage = mockSession;
    (globalThis as any).sessionStorage = mockSession;
  });

  describe('isPrivacyNoticeAcknowledged', () => {
    it('returns false for null or undefined profile', () => {
      expect(isPrivacyNoticeAcknowledged(null)).toBe(false);
      expect(isPrivacyNoticeAcknowledged(undefined)).toBe(false);
    });

    it('returns false when privacy_acknowledged_at is null or missing', () => {
      expect(isPrivacyNoticeAcknowledged({
        privacy_acknowledged_at: null,
        privacy_notice_version: '1.0'
      })).toBe(false);

      expect(isPrivacyNoticeAcknowledged({
        privacy_notice_version: '1.0'
      })).toBe(false);
    });

    it('returns true when acknowledged_at is present and version matches', () => {
      expect(isPrivacyNoticeAcknowledged({
        privacy_acknowledged_at: '2026-10-22T08:00:00Z',
        privacy_notice_version: '1.0'
      }, '1.0')).toBe(true);
    });

    it('returns false when acknowledged version does not match expected version', () => {
      // User acknowledged v1.0, but current policy is v2.0
      expect(isPrivacyNoticeAcknowledged({
        privacy_acknowledged_at: '2026-10-22T08:00:00Z',
        privacy_notice_version: '1.0'
      }, '2.0')).toBe(false);
    });
  });

  describe('Session Postponement ("Review Later")', () => {
    it('returns false when not postponed', () => {
      expect(isPrivacyNoticePostponed('1.0')).toBe(false);
    });

    it('returns true after postponing for the same version', () => {
      postponePrivacyNotice('1.0');
      expect(isPrivacyNoticePostponed('1.0')).toBe(true);
      expect(isPrivacyNoticePostponed('2.0')).toBe(false);
    });

    it('clears postponement correctly upon explicit acknowledgement', () => {
      postponePrivacyNotice('1.0');
      expect(isPrivacyNoticePostponed('1.0')).toBe(true);

      clearPrivacyNoticePostponement();
      expect(isPrivacyNoticePostponed('1.0')).toBe(false);
      expect(sessionStorage.getItem(PRIVACY_NOTICE_POSTPONED_KEY)).toBeNull();
    });
  });

  describe('shouldPromptPrivacyNotice', () => {
    it('does NOT prompt while loading profile or session', () => {
      const result = shouldPromptPrivacyNotice({
        isLoading: true,
        isAuthTransitioning: false,
        isAuthenticated: true,
        profile: null,
      });
      expect(result).toBe(false);
    });

    it('does NOT prompt while auth transition is in progress', () => {
      const result = shouldPromptPrivacyNotice({
        isLoading: false,
        isAuthTransitioning: true,
        isAuthenticated: true,
        profile: { privacy_acknowledged_at: null },
      });
      expect(result).toBe(false);
    });

    it('does NOT prompt if user is unauthenticated', () => {
      const result = shouldPromptPrivacyNotice({
        isLoading: false,
        isAuthTransitioning: false,
        isAuthenticated: false,
        profile: null,
      });
      expect(result).toBe(false);
    });

    it('prompts newly registered student who has not acknowledged notice', () => {
      const result = shouldPromptPrivacyNotice({
        isLoading: false,
        isAuthTransitioning: false,
        isAuthenticated: true,
        profile: {
          privacy_acknowledged_at: null,
          privacy_notice_version: null,
        },
        expectedVersion: '1.0',
      });
      expect(result).toBe(true);
    });

    it('does NOT prompt student who already acknowledged the current version', () => {
      const result = shouldPromptPrivacyNotice({
        isLoading: false,
        isAuthTransitioning: false,
        isAuthenticated: true,
        profile: {
          privacy_acknowledged_at: '2026-10-22T08:00:00Z',
          privacy_notice_version: '1.0',
        },
        expectedVersion: '1.0',
      });
      expect(result).toBe(false);
    });

    it('prompts again when privacy notice version changes in the future', () => {
      // Student previously acknowledged v1.0, but system requirement updated to v2.0
      const result = shouldPromptPrivacyNotice({
        isLoading: false,
        isAuthTransitioning: false,
        isAuthenticated: true,
        profile: {
          privacy_acknowledged_at: '2026-10-22T08:00:00Z',
          privacy_notice_version: '1.0',
        },
        expectedVersion: '2.0',
      });
      expect(result).toBe(true);
    });

    it('does NOT prompt when user chose "Review Later" in the current session', () => {
      postponePrivacyNotice('1.0');
      const result = shouldPromptPrivacyNotice({
        isLoading: false,
        isAuthTransitioning: false,
        isAuthenticated: true,
        profile: {
          privacy_acknowledged_at: null,
          privacy_notice_version: null,
        },
        expectedVersion: '1.0',
      });
      expect(result).toBe(false);
    });

    it('failed acknowledgement leaves profile unacknowledged and continues prompting', () => {
      // Simulate failed RPC: profile remains untouched
      const profile = {
        privacy_acknowledged_at: null,
        privacy_notice_version: null,
      };

      // Failed request does not call clearPrivacyNoticePostponement or refreshProfile with new dates
      const shouldPrompt = shouldPromptPrivacyNotice({
        isLoading: false,
        isAuthTransitioning: false,
        isAuthenticated: true,
        profile,
        expectedVersion: CURRENT_PRIVACY_NOTICE_VERSION,
      });

      expect(shouldPrompt).toBe(true);
    });
  });
});
