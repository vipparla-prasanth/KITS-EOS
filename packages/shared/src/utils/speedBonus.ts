import type { SpeedBonusConfig } from '../types/models';

/**
 * Default EOS Speed-Scoring Configuration:
 * - Enabled by default
 * - Max EOS Points: 1,000 points per eligible question
 * - Default Question Time Limit: 30 seconds
 *
 * NOTE: The old fixed-rank bonus model (+100 for 1st, +75 for 2nd, +50 for 3rd)
 * has been strictly removed. Scores are purely dynamic based on response speed.
 */
export const DEFAULT_SPEED_BONUS_CONFIG: SpeedBonusConfig = {
  enabled: true,
  max_eos_points: 1000,
  default_time_limit_seconds: 30,
};

/**
 * Calculates dynamic EOS speed points according to the Kahoot-inspired formula:
 *
 * EOS points = ROUND(1000 * MAX(0, 1 - (response_time_seconds / question_time_limit_seconds) / 2))
 *
 * Rules:
 * - Applicable only for correct, accepted answers.
 * - Incorrect answer: 0 EOS points.
 * - Faster correct answer earns more points; slower earns fewer.
 * - Points do NOT depend on answer rank (e.g., 1st, 2nd, or 3rd to answer).
 * - Capped between 0 and 1,000 points (or custom max_eos_points).
 * - Response time measured from authoritative question-start to first accepted answer.
 *
 * Exact Formula Outputs for a 30-Second Question (1,000 max points):
 * - Correct in 1 second:  ROUND(1000 * (1 - (1/30)/2))  = 983
 * - Correct in 2 seconds: ROUND(1000 * (1 - (2/30)/2))  = 967
 * - Correct in 5 seconds: ROUND(1000 * (1 - (5/30)/2))  = 917
 * - Correct in 10 seconds: ROUND(1000 * (1 - (10/30)/2)) = 833
 * - Correct in 15 seconds: ROUND(1000 * (1 - (15/30)/2)) = 750
 * - Correct in 20 seconds: ROUND(1000 * (1 - (20/30)/2)) = 667
 * - Correct in 25 seconds: ROUND(1000 * (1 - (25/30)/2)) = 583
 * - Correct in 30 seconds: ROUND(1000 * (1 - (30/30)/2)) = 500
 * - Incorrect answer: 0
 */
export function calculateDynamicEosPoints(
  isCorrect: boolean,
  responseTimeSeconds: number,
  timeLimitSeconds: number = 30,
  config?: SpeedBonusConfig | null
): number {
  if (!isCorrect) {
    return 0;
  }

  const effectiveConfig = config ?? DEFAULT_SPEED_BONUS_CONFIG;
  if (!effectiveConfig.enabled) {
    return 0;
  }

  const maxPoints =
    effectiveConfig.max_eos_points && effectiveConfig.max_eos_points > 0
      ? effectiveConfig.max_eos_points
      : 1000;

  const timerLimit =
    timeLimitSeconds && timeLimitSeconds > 0
      ? timeLimitSeconds
      : effectiveConfig.default_time_limit_seconds && effectiveConfig.default_time_limit_seconds > 0
      ? effectiveConfig.default_time_limit_seconds
      : 30;

  // Clamp response time (negative response time from clock skew clamped to 0)
  const clampedResponse = Math.max(0, responseTimeSeconds);

  // Kahoot-inspired speed factor: MAX(0, 1 - (response_time_seconds / question_time_limit_seconds) / 2)
  const factor = Math.max(0, 1 - (clampedResponse / timerLimit) / 2);

  const calculatedPoints = Math.round(maxPoints * factor);

  // Authoritatively cap between 0 and maxPoints
  return Math.min(maxPoints, Math.max(0, calculatedPoints));
}

/**
 * Backward-compatibility wrapper for legacy references.
 * Never awards fixed rank-based bonuses (+100, +75, +50).
 * If passed response time directly as numeric value, computes dynamic points.
 */
export function calculateEosSpeedBonus(
  rankOrResponseTime: number | null | undefined,
  config?: SpeedBonusConfig | null
): number {
  if (rankOrResponseTime == null || rankOrResponseTime < 0) {
    return 0;
  }
  // If invoked with a response time in seconds, calculate dynamic EOS points for a correct answer:
  return calculateDynamicEosPoints(true, rankOrResponseTime, 30, config);
}
