/**
 * Registration & Submission Success Audio Player Engine
 * 
 * Plays the confirmed registration success sound (/sounds/registration-success.mp3)
 * exactly once per successful operation (event registration, online payment verification,
 * assessment submission, stall proposal, support ticket, and feedback).
 * 
 * Safety invariants:
 *  - URL is strictly '/sounds/registration-success.mp3' (served from public/)
 *  - Deduplication prevents multiple plays on re-renders, fast double-clicks, or tab switches
 *  - Never plays for failed, cancelled, pending, or duplicate operations
 *  - Safe fallback in SSR, headless tests, or when browser autoplay policy blocks unprompted audio
 */

export const REGISTRATION_SUCCESS_SOUND_URL = '/sounds/registration-success.mp3';

// Set of operation keys that have already played sound during this session
const playedOperationKeys = new Set<string>();

// Throttle timestamp for anonymous plays
let lastAnonymousPlayTime = 0;
const ANONYMOUS_THROTTLE_MS = 2000;

export interface PlaySoundOptions {
  /**
   * Unique identifier for the operation (e.g. registration ID, attempt ID).
   * Guarantees the sound will play at most once for this specific operation.
   */
  dedupeKey?: string;
  /**
   * Audio volume between 0.0 and 1.0 (defaults to 0.8)
   */
  volume?: number;
}

/**
 * Checks if sound was already played for a given deduplication key.
 */
export function hasSoundPlayedFor(dedupeKey: string): boolean {
  if (!dedupeKey) return false;
  return playedOperationKeys.has(dedupeKey);
}

/**
 * Resets sound deduplication state (useful for tests or new registrations).
 */
export function resetSoundDeduplicationState(): void {
  playedOperationKeys.clear();
  lastAnonymousPlayTime = 0;
}

/**
 * Plays the registration success audio notification.
 * Returns true if audio started playing, false if skipped or blocked.
 */
export async function playRegistrationSuccessSound(options?: PlaySoundOptions): Promise<boolean> {
  const dedupeKey = options?.dedupeKey?.trim();

  // Enforce deduplication
  if (dedupeKey) {
    if (playedOperationKeys.has(dedupeKey)) {
      return false; // Already played for this operation
    }
    playedOperationKeys.add(dedupeKey);
  } else {
    // If no key provided, throttle to prevent accidental rapid double-triggers
    const now = Date.now();
    if (now - lastAnonymousPlayTime < ANONYMOUS_THROTTLE_MS) {
      return false;
    }
    lastAnonymousPlayTime = now;
  }

  // Graceful guard for SSR or headless environments without Audio API
  const hasAudio = typeof Audio !== 'undefined' || (typeof window !== 'undefined' && typeof (window as any).Audio !== 'undefined');
  if (!hasAudio) {
    return false;
  }

  try {
    const AudioCtor = typeof Audio !== 'undefined' ? Audio : (window as any).Audio;
    const audio = new AudioCtor(REGISTRATION_SUCCESS_SOUND_URL);
    audio.volume = Math.min(1.0, Math.max(0.0, options?.volume ?? 0.8));
    
    // Attempt playback (returns promise)
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      await playPromise;
    }
    return true;
  } catch (err) {
    // Browser autoplay policy might block unprompted playback; fail silently without crashing app
    console.warn('[Audio] Registration success sound playback notice:', err);
    return false;
  }
}
