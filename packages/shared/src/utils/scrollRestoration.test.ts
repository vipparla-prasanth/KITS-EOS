import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveScrollPosition,
  getSavedScrollPosition,
  clearScrollPositions,
  isOAuthHashFragment,
  determineNavigationScrollAction,
  applyNavigationScrollPolicy,
} from './scrollRestoration';

describe('Navigation Scroll Policy & Restoration Engine', () => {
  beforeEach(() => {
    clearScrollPositions();
    vi.restoreAllMocks();
  });

  describe('isOAuthHashFragment', () => {
    it('identifies OAuth fragments correctly and ignores them', () => {
      expect(isOAuthHashFragment('#access_token=xyz123&refresh_token=abc')).toBe(true);
      expect(isOAuthHashFragment('access_token=xyz123')).toBe(true);
      expect(isOAuthHashFragment('#error=unauthorized_client')).toBe(true);
      expect(isOAuthHashFragment('#code=authcode456')).toBe(true);
      expect(isOAuthHashFragment('#token_type=bearer')).toBe(true);
    });

    it('allows valid in-page anchor hashes', () => {
      expect(isOAuthHashFragment('#team-keos')).toBe(false);
      expect(isOAuthHashFragment('#faq-section')).toBe(false);
      expect(isOAuthHashFragment('#overview')).toBe(false);
      expect(isOAuthHashFragment('')).toBe(false);
    });
  });

  describe('Position Registry', () => {
    it('saves and retrieves scroll positions by history key', () => {
      saveScrollPosition('page-key-1', { x: 0, y: 450, containerY: 200 });
      const saved = getSavedScrollPosition('page-key-1');
      expect(saved).toEqual({ x: 0, y: 450, containerY: 200 });
    });

    it('returns undefined for unregistered keys', () => {
      expect(getSavedScrollPosition('unknown-key')).toBeUndefined();
    });

    it('clears all registered positions on clearScrollPositions()', () => {
      saveScrollPosition('key-1', { x: 0, y: 100 });
      saveScrollPosition('key-2', { x: 0, y: 250 });
      clearScrollPositions();
      expect(getSavedScrollPosition('key-1')).toBeUndefined();
      expect(getSavedScrollPosition('key-2')).toBeUndefined();
    });
  });

  describe('determineNavigationScrollAction Decision Matrix', () => {
    // Acceptance Test 1 & 2: PUSH to genuinely new page
    it('returns SCROLL_TO_TOP on PUSH navigation to a new route', () => {
      const decision = determineNavigationScrollAction({
        navigationType: 'PUSH',
        currentPathname: '/events/123',
        previousPathname: '/events',
        currentHash: '',
        hasSavedPosition: false,
      });
      expect(decision).toBe('SCROLL_TO_TOP');
    });

    // Acceptance Test 3: Programmatic navigation
    it('returns SCROLL_TO_TOP on programmatic navigation', () => {
      const decision = determineNavigationScrollAction({
        navigationType: 'PUSH',
        currentPathname: '/assessments',
        previousPathname: '/dashboard',
        currentHash: '',
        hasSavedPosition: false,
      });
      expect(decision).toBe('SCROLL_TO_TOP');
    });

    // Acceptance Test 4: Browser Back & Forward (POP)
    it('returns RESTORE_POSITION on POP navigation when a position was saved', () => {
      const decision = determineNavigationScrollAction({
        navigationType: 'POP',
        currentPathname: '/events',
        previousPathname: '/events/123',
        currentHash: '',
        hasSavedPosition: true,
      });
      expect(decision).toBe('RESTORE_POSITION');
    });

    it('falls back to SCROLL_TO_TOP on POP navigation if no position was recorded', () => {
      const decision = determineNavigationScrollAction({
        navigationType: 'POP',
        currentPathname: '/events',
        previousPathname: '/events/123',
        currentHash: '',
        hasSavedPosition: false,
      });
      expect(decision).toBe('SCROLL_TO_TOP');
    });

    // Acceptance Test 5: Hash links
    it('returns SCROLL_TO_HASH when a valid anchor hash is present', () => {
      const decision = determineNavigationScrollAction({
        navigationType: 'PUSH',
        currentPathname: '/tech-support',
        previousPathname: '/home',
        currentHash: '#team-keos',
        hasSavedPosition: false,
      });
      expect(decision).toBe('SCROLL_TO_HASH');
    });

    it('ignores OAuth hash fragments and scrolls to top instead', () => {
      const decision = determineNavigationScrollAction({
        navigationType: 'PUSH',
        currentPathname: '/reset-password',
        previousPathname: null,
        currentHash: '#access_token=secret&type=recovery',
        hasSavedPosition: false,
      });
      expect(decision).toBe('SCROLL_TO_TOP');
    });

    // Acceptance Test 6: In-page query or filter changes without changing pathname
    it('returns PRESERVE_SCROLL on REPLACE when pathname has not changed', () => {
      const decision = determineNavigationScrollAction({
        navigationType: 'REPLACE',
        currentPathname: '/admin/registrations',
        previousPathname: '/admin/registrations',
        currentHash: '',
        hasSavedPosition: false,
      });
      expect(decision).toBe('PRESERVE_SCROLL');
    });

    it('returns SCROLL_TO_TOP on REPLACE when pathname has changed (e.g. redirect)', () => {
      const decision = determineNavigationScrollAction({
        navigationType: 'REPLACE',
        currentPathname: '/dashboard',
        previousPathname: '/student',
        currentHash: '',
        hasSavedPosition: false,
      });
      expect(decision).toBe('SCROLL_TO_TOP');
    });
  });

  describe('applyNavigationScrollPolicy Integration', () => {
    it('executes SCROLL_TO_TOP and resets container scrollTop', () => {
      const mockContainer = { scrollTop: 500 } as HTMLElement;
      const decision = applyNavigationScrollPolicy({
        navigationType: 'PUSH',
        locationKey: 'key-push-1',
        currentPathname: '/admin/analytics',
        previousPathname: '/admin',
        containerElement: mockContainer,
      });

      expect(decision).toBe('SCROLL_TO_TOP');
      expect(mockContainer.scrollTop).toBe(0);
    });

    it('executes RESTORE_POSITION and restores container scrollTop on POP', () => {
      saveScrollPosition('key-pop-restore', { x: 0, y: 720, containerY: 340 });
      const mockContainer = { scrollTop: 0 } as HTMLElement;

      const decision = applyNavigationScrollPolicy({
        navigationType: 'POP',
        locationKey: 'key-pop-restore',
        currentPathname: '/events',
        previousPathname: '/events/details',
        containerElement: mockContainer,
      });

      expect(decision).toBe('RESTORE_POSITION');
      expect(mockContainer.scrollTop).toBe(340);
    });

    it('executes PRESERVE_SCROLL without altering container scrollTop on filter changes', () => {
      const mockContainer = { scrollTop: 420 } as HTMLElement;

      const decision = applyNavigationScrollPolicy({
        navigationType: 'REPLACE',
        locationKey: 'key-filter-replace',
        currentPathname: '/events',
        previousPathname: '/events',
        containerElement: mockContainer,
      });

      expect(decision).toBe('PRESERVE_SCROLL');
      expect(mockContainer.scrollTop).toBe(420);
    });
  });
});
