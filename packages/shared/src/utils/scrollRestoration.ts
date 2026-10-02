/**
 * Scroll restoration and position management utility for single-page applications.
 * Prevents premature clamping to footers on page load, reload, or cross-route navigation.
 */

let isRestorationInitialized = false;

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
    // Temporarily disable smooth scroll so the jump is immediate and does not clamp
    const prevScrollBehavior = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (body) body.scrollTop = 0;
    if (html) html.scrollTop = 0;

    // Restore smooth scroll on the next animation frame for in-page interactions
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

  const targetId = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!targetId) return false;

  // IMPORTANT: OAuth callback fragments contain tokens, error codes, query parameters
  // (e.g. #access_token=..., #error=...). They are NOT DOM elements and must never be queried!
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
      // 1. Direct ID lookup is fastest and safest
      const byId = document.getElementById(targetId);
      if (byId) return byId;

      // 2. Safely escape before querying with selector
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return document.querySelector(`#${CSS.escape(targetId)}`);
      }
    } catch {
      // Never allow a selector error to crash the application
    }
    return null;
  };

  const targetElement = findElement();
  if (targetElement) {
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  // Element might still be mounting during dynamic route render; retry after frame
  requestAnimationFrame(() => {
    const retryElement = findElement();
    if (retryElement) {
      retryElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  return false;
}
