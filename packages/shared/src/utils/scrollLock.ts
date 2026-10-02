import { useEffect } from 'react';

let lockCount = 0;
let originalBodyOverflow: string | null = null;

/**
 * Acquire a body scroll lock.
 * Uses reference-counting so multiple active modals or components do not
 * overwrite each other or restore invalid 'hidden' states.
 *
 * @returns A release function to be called on cleanup.
 */
export function lockScroll(): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }

  if (lockCount === 0) {
    const current = document.body.style.overflow;
    // Guard: if body was somehow already 'hidden', baseline should be cleared ('') on unlock
    originalBodyOverflow = current === 'hidden' ? '' : current;
    document.body.style.overflow = 'hidden';
  }
  lockCount++;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      if (typeof document !== 'undefined' && document.body) {
        document.body.style.overflow =
          originalBodyOverflow && originalBodyOverflow !== 'hidden'
            ? originalBodyOverflow
            : '';
      }
      originalBodyOverflow = null;
    }
  };
}

/**
 * Force-resets all scroll locks and unconditionally restores body overflow to ''.
 * Critical for route transitions or global recovery to ensure no orphaned locks survive.
 */
export function forceResetScrollLock(): void {
  lockCount = 0;
  originalBodyOverflow = null;
  if (typeof document !== 'undefined' && document.body) {
    document.body.style.overflow = '';
  }
}

/**
 * React hook to lock body scrolling while `isLocked` is true.
 * Safely releases lock on unmount or when `isLocked` becomes false.
 */
export function useScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) return;
    const unlock = lockScroll();
    return () => {
      unlock();
    };
  }, [isLocked]);
}
