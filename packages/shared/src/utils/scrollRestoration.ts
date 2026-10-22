/**
 * Scroll restoration and position management utility for single-page applications.
 * Prevents premature clamping to footers on page load, reload, or cross-route navigation,
 * while preserving natural browser Back/Forward (POP) scroll restoration and anchor navigation.
 */

import { forceResetScrollLock } from './scrollLock';

export type NavigationActionType = 'PUSH' | 'POP' | 'REPLACE';

export interface ScrollCoordinates {
  x: number;
  y: number;
  containerY?: number;
}

export type ScrollDecision = 'SCROLL_TO_TOP' | 'RESTORE_POSITION' | 'SCROLL_TO_HASH' | 'PRESERVE_SCROLL';

let isRestorationInitialized = false;
let pendingHashFrame: number | null = null;

// Registry of saved scroll positions keyed by history key or route path
const positionRegistry = new Map<string, ScrollCoordinates>();

/**
 * Checks whether a hash fragment is an OAuth token fragment (#access_token=..., #error=..., etc.)
 * rather than a DOM element selector.
 */
export function isOAuthHashFragment(hash: string): boolean {
  if (!hash) return false;
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  return Boolean(
    clean.includes('access_token=') ||
    clean.includes('refresh_token=') ||
    clean.includes('error=') ||
    clean.includes('error_description=') ||
    clean.includes('code=') ||
    clean.includes('token_type=')
  );
}

/**
 * Initializes browser scroll restoration mode.
 * Disables the browser's default 'auto' scroll restoration which prematurely restores
 * scroll offsets on empty client-side SPA shells and causes pages to open at the footer.
 */
export function initScrollRestoration(): void {
  if (isRestorationInitialized) return;
  if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
    try {
      window.history.scrollRestoration = 'manual';
      isRestorationInitialized = true;
    } catch {
      // Ignore if browser restricts manipulation
    }
  }
}

/**
 * Saves current scroll coordinates for a given history key or route identifier.
 */
export function saveScrollPosition(
  key: string,
  coordinates: { x: number; y: number; containerY?: number }
): void {
  if (!key) return;
  positionRegistry.set(key, coordinates);
}

/**
 * Retrieves the saved scroll position for a given history key or route identifier.
 */
export function getSavedScrollPosition(key: string): ScrollCoordinates | undefined {
  if (!key) return undefined;
  return positionRegistry.get(key);
}

/**
 * Clears the scroll position registry. Primarily used for automated testing.
 */
export function clearScrollPositions(): void {
  positionRegistry.clear();
}

/**
 * Teleports the scroll position instantly to the top of the page.
 * Temporarily disables global CSS `scroll-behavior: smooth` during the transition so
 * the browser does not smoothly animate from the previous page's footer or get clamped
 * at the bottom of the incoming route.
 */
export function scrollToPageTop(options?: { behavior?: 'instant' | 'smooth' }): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const targetBehavior = options?.behavior || 'instant';
  const html = document.documentElement;
  const body = document.body;

  if (targetBehavior === 'instant') {
    const prevScrollBehavior = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (body) body.scrollTop = 0;
    if (html) html.scrollTop = 0;

    requestAnimationFrame(() => {
      html.style.scrollBehavior = prevScrollBehavior;
    });
  } else {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }
}

/**
 * Handles smooth scrolling to an anchor hash (e.g. #team-keos).
 * Retries briefly if the target element is still mounting/rendering.
 * Safely guards against OAuth callback fragments (#access_token=..., #error=..., etc.)
 *
 * @returns boolean indicating if the target element was found
 */
export function handleHashScroll(hash: string): boolean {
  if (typeof document === 'undefined' || !hash) return false;
  if (isOAuthHashFragment(hash)) return false;

  const targetId = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!targetId) return false;

  if (
    targetId.includes('=') ||
    targetId.includes('&') ||
    targetId.includes('/') ||
    targetId.includes('?') ||
    targetId.includes(':') ||
    targetId.includes(';')
  ) {
    return false;
  }

  const findElement = (): HTMLElement | null => {
    try {
      const byId = document.getElementById(targetId);
      if (byId) return byId;

      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return document.querySelector(`#${CSS.escape(targetId)}`);
      }
    } catch {
      // Guard against querySelector syntax errors
    }
    return null;
  };

  if (pendingHashFrame !== null && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(pendingHashFrame);
    pendingHashFrame = null;
  }

  const targetElement = findElement();
  if (targetElement) {
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  if (typeof requestAnimationFrame !== 'undefined') {
    pendingHashFrame = requestAnimationFrame(() => {
      pendingHashFrame = null;
      const retryElement = findElement();
      if (retryElement) {
        retryElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  return false;
}

/**
 * Pure decision engine: determines which scroll action to take based on navigation semantics.
 * Fully deterministic and testable without a browser environment.
 */
export function determineNavigationScrollAction(params: {
  navigationType: NavigationActionType;
  currentPathname: string;
  previousPathname: string | null;
  currentHash?: string;
  hasSavedPosition: boolean;
}): ScrollDecision {
  const { navigationType, currentPathname, previousPathname, currentHash, hasSavedPosition } = params;

  // 1. If valid anchor hash is present, target the anchor
  if (currentHash && !isOAuthHashFragment(currentHash)) {
    return 'SCROLL_TO_HASH';
  }

  // 2. On browser Back/Forward (POP), restore saved position if available
  if (navigationType === 'POP' && hasSavedPosition) {
    return 'RESTORE_POSITION';
  }

  // 3. On in-place history replacement (REPLACE) without pathname change (e.g. query param tab or filter change),
  // preserve existing scroll position.
  if (navigationType === 'REPLACE' && previousPathname !== null && currentPathname === previousPathname) {
    return 'PRESERVE_SCROLL';
  }

  // 4. In all other cases (PUSH to new page, direct entry, or REPLACE with new pathname), open at top
  return 'SCROLL_TO_TOP';
}

/**
 * Applies the comprehensive navigation scroll policy.
 * Synchronizes window scrolling, optional inner container scrolling, scroll locks, and hash links.
 */
export function applyNavigationScrollPolicy(params: {
  navigationType: NavigationActionType;
  locationKey: string;
  currentPathname: string;
  previousPathname: string | null;
  currentHash?: string;
  containerElement?: HTMLElement | null;
  behavior?: 'instant' | 'smooth';
}): ScrollDecision {
  const {
    navigationType,
    locationKey,
    currentPathname,
    previousPathname,
    currentHash = '',
    containerElement,
    behavior = 'instant',
  } = params;

  initScrollRestoration();
  forceResetScrollLock();

  const savedPosition = getSavedScrollPosition(locationKey);
  const decision = determineNavigationScrollAction({
    navigationType,
    currentPathname,
    previousPathname,
    currentHash,
    hasSavedPosition: Boolean(savedPosition),
  });

  switch (decision) {
    case 'SCROLL_TO_HASH':
      handleHashScroll(currentHash);
      break;

    case 'RESTORE_POSITION':
      if (savedPosition) {
        if (typeof window !== 'undefined') {
          window.scrollTo({ left: savedPosition.x, top: savedPosition.y, behavior });
        }
        if (containerElement && typeof savedPosition.containerY === 'number') {
          containerElement.scrollTop = savedPosition.containerY;
        }
      }
      break;

    case 'PRESERVE_SCROLL':
      // Do not mutate scroll offset on in-page query string or tab filter changes
      break;

    case 'SCROLL_TO_TOP':
    default:
      scrollToPageTop({ behavior });
      if (containerElement) {
        containerElement.scrollTop = 0;
      }
      break;
  }

  return decision;
}
