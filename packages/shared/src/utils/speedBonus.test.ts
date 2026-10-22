import { describe, it, expect } from 'vitest';
import {
  calculateDynamicEosPoints,
  DEFAULT_SPEED_BONUS_CONFIG,
} from './speedBonus';
import type { SpeedBonusConfig } from '../types/models';

describe('Dynamic EOS Speed-Scoring Engine', () => {
  describe('Kahoot-Inspired Formula Verification (30-second question, 1,000 max points)', () => {
    const timeLimit = 30;

    it('awards approximately 983 EOS points for a correct answer in 1 second', () => {
      // 1000 * (1 - (1/30)/2) = 1000 * (1 - 0.0166667) = 983.33 -> 983
      expect(calculateDynamicEosPoints(true, 1, timeLimit)).toBe(983);
    });

    it('awards approximately 967 EOS points for a correct answer in 2 seconds', () => {
      // 1000 * (1 - (2/30)/2) = 1000 * (1 - 0.0333333) = 966.67 -> 967
      expect(calculateDynamicEosPoints(true, 2, timeLimit)).toBe(967);
    });

    it('awards approximately 917 EOS points for a correct answer in 5 seconds', () => {
      // 1000 * (1 - (5/30)/2) = 1000 * (1 - 0.0833333) = 916.67 -> 917
      expect(calculateDynamicEosPoints(true, 5, timeLimit)).toBe(917);
    });

    it('awards approximately 833 EOS points for a correct answer in 10 seconds', () => {
      // 1000 * (1 - (10/30)/2) = 1000 * (1 - 0.1666667) = 833.33 -> 833
      expect(calculateDynamicEosPoints(true, 10, timeLimit)).toBe(833);
    });

    it('awards exactly 750 EOS points for a correct answer in 15 seconds (halfway)', () => {
      // 1000 * (1 - (15/30)/2) = 1000 * (1 - 0.25) = 750
      expect(calculateDynamicEosPoints(true, 15, timeLimit)).toBe(750);
    });

    it('awards approximately 667 EOS points for a correct answer in 20 seconds', () => {
      // 1000 * (1 - (20/30)/2) = 1000 * (1 - 0.3333333) = 666.67 -> 667
      expect(calculateDynamicEosPoints(true, 20, timeLimit)).toBe(667);
    });

    it('awards approximately 583 EOS points for a correct answer in 25 seconds', () => {
      // 1000 * (1 - (25/30)/2) = 1000 * (1 - 0.4166667) = 583.33 -> 583
      expect(calculateDynamicEosPoints(true, 25, timeLimit)).toBe(583);
    });

    it('awards exactly 500 EOS points for a correct answer at the 30-second time limit', () => {
      // 1000 * (1 - (30/30)/2) = 1000 * (1 - 0.5) = 500
      expect(calculateDynamicEosPoints(true, 30, timeLimit)).toBe(500);
    });

    it('strictly awards 0 EOS points for any incorrect answer regardless of speed', () => {
      expect(calculateDynamicEosPoints(false, 0, timeLimit)).toBe(0);
      expect(calculateDynamicEosPoints(false, 1, timeLimit)).toBe(0);
      expect(calculateDynamicEosPoints(false, 5, timeLimit)).toBe(0);
      expect(calculateDynamicEosPoints(false, 15, timeLimit)).toBe(0);
      expect(calculateDynamicEosPoints(false, 29, timeLimit)).toBe(0);
    });
  });

  describe('Section 7 Mandatory Scenario Validation', () => {
    it('verifies exact scores and rankings for Participants A, B, C, D on a 30s question', () => {
      const timeLimit = 30;

      // Participant A answers correctly in 2 seconds -> 967
      const scoreA = calculateDynamicEosPoints(true, 2, timeLimit);
      expect(scoreA).toBe(967);

      // Participant B answers correctly in 10 seconds -> 833
      const scoreB = calculateDynamicEosPoints(true, 10, timeLimit);
      expect(scoreB).toBe(833);

      // Participant C answers incorrectly in 1 second -> 0
      const scoreC = calculateDynamicEosPoints(false, 1, timeLimit);
      expect(scoreC).toBe(0);

      // Participant D answers correctly in 20 seconds -> 667
      const scoreD = calculateDynamicEosPoints(true, 20, timeLimit);
      expect(scoreD).toBe(667);

      // Leaderboard ranking by EOS points: A, B, D, C
      const participants = [
        { name: 'Participant A', eos: scoreA },
        { name: 'Participant B', eos: scoreB },
        { name: 'Participant C', eos: scoreC },
        { name: 'Participant D', eos: scoreD },
      ];

      participants.sort((p1, p2) => p2.eos - p1.eos);

      expect(participants.map((p) => p.name)).toEqual([
        'Participant A',
        'Participant B',
        'Participant D',
        'Participant C',
      ]);
    });

    it('guarantees scores are independent of database processing order', () => {
      const timeLimit = 30;

      // Whether D is processed before A or after A, A always gets 967 and D always gets 667
      const order1_A = calculateDynamicEosPoints(true, 2, timeLimit);
      const order1_D = calculateDynamicEosPoints(true, 20, timeLimit);

      const order2_D = calculateDynamicEosPoints(true, 20, timeLimit);
      const order2_A = calculateDynamicEosPoints(true, 2, timeLimit);

      expect(order1_A).toBe(order2_A);
      expect(order1_D).toBe(order2_D);
      expect(order1_A).toBe(967);
      expect(order1_D).toBe(667);
    });
  });

  describe('Boundary and Clamp Enforcement', () => {
    const timeLimit = 30;

    it('awards 1,000 points for instantaneous correct answer (0 seconds)', () => {
      expect(calculateDynamicEosPoints(true, 0, timeLimit)).toBe(1000);
    });

    it('clamps negative response time to 0, yielding 1,000 points', () => {
      expect(calculateDynamicEosPoints(true, -0.5, timeLimit)).toBe(1000);
      expect(calculateDynamicEosPoints(true, -10, timeLimit)).toBe(1000);
    });

    it('caps maximum points at 1,000 under default config', () => {
      expect(calculateDynamicEosPoints(true, 0, timeLimit)).toBeLessThanOrEqual(1000);
    });

    it('awards 0 points at and beyond 2x the time limit (factor reaches 0)', () => {
      // 1 - (60/30)/2 = 1 - 1 = 0
      expect(calculateDynamicEosPoints(true, 60, timeLimit)).toBe(0);
      // 1 - (75/30)/2 = 1 - 1.25 = -0.25 -> MAX(0, -0.25) = 0
      expect(calculateDynamicEosPoints(true, 75, timeLimit)).toBe(0);
      expect(calculateDynamicEosPoints(true, 300, timeLimit)).toBe(0);
    });
  });

  describe('Varying Question Timers & Custom Configs', () => {
    it('scales correctly for a 15-second question', () => {
      const limit15 = 15;
      // 1s in 15s limit: 1000 * (1 - (1/15)/2) = 1000 * (1 - 0.03333) = 967
      expect(calculateDynamicEosPoints(true, 1, limit15)).toBe(967);
      // 7.5s in 15s limit: 1000 * (1 - 0.25) = 750
      expect(calculateDynamicEosPoints(true, 7.5, limit15)).toBe(750);
      // 15s in 15s limit: 1000 * (1 - 0.5) = 500
      expect(calculateDynamicEosPoints(true, 15, limit15)).toBe(500);
    });

    it('scales correctly for a 60-second question', () => {
      const limit60 = 60;
      // 1s in 60s limit: 1000 * (1 - (1/60)/2) = 1000 * (1 - 0.008333) = 992
      expect(calculateDynamicEosPoints(true, 1, limit60)).toBe(992);
      // 30s in 60s limit: 1000 * (1 - 0.25) = 750
      expect(calculateDynamicEosPoints(true, 30, limit60)).toBe(750);
      // 60s in 60s limit: 1000 * (1 - 0.5) = 500
      expect(calculateDynamicEosPoints(true, 60, limit60)).toBe(500);
    });

    it('supports custom max_eos_points', () => {
      const config500: SpeedBonusConfig = {
        enabled: true,
        max_eos_points: 500,
        default_time_limit_seconds: 30,
      };

      // 0s: 500
      expect(calculateDynamicEosPoints(true, 0, 30, config500)).toBe(500);
      // 15s: 500 * 0.75 = 375
      expect(calculateDynamicEosPoints(true, 15, 30, config500)).toBe(375);
      // 30s: 500 * 0.5 = 250
      expect(calculateDynamicEosPoints(true, 30, 30, config500)).toBe(250);
    });

    it('awards 0 points when speed bonus is explicitly disabled', () => {
      const disabledConfig: SpeedBonusConfig = {
        enabled: false,
        max_eos_points: 1000,
        default_time_limit_seconds: 30,
      };

      expect(calculateDynamicEosPoints(true, 1, 30, disabledConfig)).toBe(0);
      expect(calculateDynamicEosPoints(true, 5, 30, disabledConfig)).toBe(0);
    });

    it('verifies default configuration parameters', () => {
      expect(DEFAULT_SPEED_BONUS_CONFIG.enabled).toBe(true);
      expect(DEFAULT_SPEED_BONUS_CONFIG.max_eos_points).toBe(1000);
      expect(DEFAULT_SPEED_BONUS_CONFIG.default_time_limit_seconds).toBe(30);
    });
  });
});
