import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  REGISTRATION_SUCCESS_SOUND_URL,
  playRegistrationSuccessSound,
  hasSoundPlayedFor,
  resetSoundDeduplicationState,
} from './registrationSound';

describe('registrationSound utility', () => {
  let playMock: ReturnType<typeof vi.fn>;
  let audioInstanceMock: any;
  let originalAudio: any;

  beforeEach(() => {
    resetSoundDeduplicationState();
    playMock = vi.fn().mockResolvedValue(undefined);
    originalAudio = globalThis.Audio;

    class MockAudio {
      src: string;
      volume: number = 1.0;
      constructor(url: string) {
        this.src = url;
        audioInstanceMock = this;
      }
      play = playMock;
    }

    globalThis.Audio = MockAudio as any;
  });

  afterEach(() => {
    globalThis.Audio = originalAudio;
    vi.restoreAllMocks();
  });

  it('verifies the exact public asset URL matches specifications', () => {
    expect(REGISTRATION_SUCCESS_SOUND_URL).toBe('/sounds/registration-success.mp3');
  });

  it('instantiates Audio with the correct asset URL and plays sound', async () => {
    const result = await playRegistrationSuccessSound({ dedupeKey: 'test-operation-1' });
    expect(result).toBe(true);
    expect(audioInstanceMock.src).toBe('/sounds/registration-success.mp3');
    expect(audioInstanceMock.volume).toBe(0.8);
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it('clamps custom volume between 0.0 and 1.0', async () => {
    await playRegistrationSuccessSound({ dedupeKey: 'test-volume-high', volume: 1.5 });
    expect(audioInstanceMock.volume).toBe(1.0);

    resetSoundDeduplicationState();
    await playRegistrationSuccessSound({ dedupeKey: 'test-volume-low', volume: -0.5 });
    expect(audioInstanceMock.volume).toBe(0.0);

    resetSoundDeduplicationState();
    await playRegistrationSuccessSound({ dedupeKey: 'test-volume-custom', volume: 0.5 });
    expect(audioInstanceMock.volume).toBe(0.5);
  });

  it('guarantees sound plays at most once per operation deduplication key', async () => {
    const key = 'registration-event-sub123-user456';

    expect(hasSoundPlayedFor(key)).toBe(false);

    // First attempt -> plays
    const firstPlay = await playRegistrationSuccessSound({ dedupeKey: key });
    expect(firstPlay).toBe(true);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(hasSoundPlayedFor(key)).toBe(true);

    // Second attempt (duplicate/re-render/tab switch) -> suppressed
    const secondPlay = await playRegistrationSuccessSound({ dedupeKey: key });
    expect(secondPlay).toBe(false);
    expect(playMock).toHaveBeenCalledTimes(1);

    // Third attempt -> still suppressed
    const thirdPlay = await playRegistrationSuccessSound({ dedupeKey: key });
    expect(thirdPlay).toBe(false);
    expect(playMock).toHaveBeenCalledTimes(1);

    // Another distinct operation -> plays once
    const otherKey = 'registration-event-sub999-user456';
    const otherPlay = await playRegistrationSuccessSound({ dedupeKey: otherKey });
    expect(otherPlay).toBe(true);
    expect(playMock).toHaveBeenCalledTimes(2);
  });

  it('allows replay after resetSoundDeduplicationState is called', async () => {
    const key = 'reg-reset-test';

    const first = await playRegistrationSuccessSound({ dedupeKey: key });
    expect(first).toBe(true);
    expect(hasSoundPlayedFor(key)).toBe(true);

    resetSoundDeduplicationState();
    expect(hasSoundPlayedFor(key)).toBe(false);

    const second = await playRegistrationSuccessSound({ dedupeKey: key });
    expect(second).toBe(true);
  });

  it('gracefully handles browser autoplay restrictions without crashing or throwing', async () => {
    playMock.mockRejectedValueOnce(new Error('NotAllowedError: play() failed because the user didn\'t interact with the document first'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await playRegistrationSuccessSound({ dedupeKey: 'autoplay-blocked-op' });
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('gracefully returns false when window or Audio API is unavailable (SSR/headless guard)', async () => {
    (globalThis as any).Audio = undefined;

    const result = await playRegistrationSuccessSound({ dedupeKey: 'headless-test' });
    expect(result).toBe(false);
  });
});
