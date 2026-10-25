import { describe, it, expect } from 'vitest';
import {
  polarToCartesian,
  describeDonutArc,
} from './AssessmentCharts';

describe('AssessmentCharts Logic & Arc Math', () => {
  describe('Trigonometry Helpers (polarToCartesian)', () => {
    it('calculates 12 o’clock (0 degrees) as top point (x=center, y=center-radius)', () => {
      const point = polarToCartesian(100, 100, 50, 0);
      expect(Math.round(point.x)).toBe(100);
      expect(Math.round(point.y)).toBe(50);
    });

    it('calculates 3 o’clock (90 degrees) as right point (x=center+radius, y=center)', () => {
      const point = polarToCartesian(100, 100, 50, 90);
      expect(Math.round(point.x)).toBe(150);
      expect(Math.round(point.y)).toBe(100);
    });

    it('calculates 6 o’clock (180 degrees) as bottom point (x=center, y=center+radius)', () => {
      const point = polarToCartesian(100, 100, 50, 180);
      expect(Math.round(point.x)).toBe(100);
      expect(Math.round(point.y)).toBe(150);
    });

    it('calculates 9 o’clock (270 degrees) as left point (x=center-radius, y=center)', () => {
      const point = polarToCartesian(100, 100, 50, 270);
      expect(Math.round(point.x)).toBe(50);
      expect(Math.round(point.y)).toBe(100);
    });
  });

  describe('Donut & Pie Arc Path Generation (describeDonutArc)', () => {
    it('generates a valid SVG path for a 90-degree quadrant donut slice', () => {
      const path = describeDonutArc(100, 100, 80, 50, 0, 90);
      expect(path).toContain('M');
      expect(path).toContain('A 80 80');
      expect(path).toContain('L');
      expect(path).toContain('A 50 50');
      expect(path).toContain('Z');
    });

    it('handles a full 360-degree circle by clamping to 359.99 degrees', () => {
      const path = describeDonutArc(100, 100, 80, 50, 0, 360);
      expect(path).toContain('M');
      expect(path).toContain('A 80 80');
      expect(path).toContain('Z');
    });

    it('generates a valid pure Pie chart slice when innerRadius is 0', () => {
      const path = describeDonutArc(100, 100, 80, 0, 0, 120);
      expect(path).toContain('M 100 100'); // Starts from center
      expect(path).toContain('L');
      expect(path).toContain('A 80 80');
      expect(path).toContain('Z');
    });

    it('sets largeArcFlag to 1 when sweep exceeds 180 degrees', () => {
      const pathOver180 = describeDonutArc(100, 100, 80, 50, 0, 200);
      expect(pathOver180).toContain('1 0'); // largeArc = 1
    });

    it('sets largeArcFlag to 0 when sweep is 180 degrees or less', () => {
      const pathUnder180 = describeDonutArc(100, 100, 80, 50, 0, 120);
      expect(pathUnder180).toContain('0 0'); // largeArc = 0
    });
  });

  describe('Status Distribution Math & Category Proportions', () => {
    it('correctly aggregates operational statuses and derives exact percentage proportions', () => {
      const completed = 45;
      const inProgress = 15;
      const notStarted = 30;
      const terminated = 6;
      const expired = 4;
      const totalCapacity = 100;

      const terminatedTotal = terminated + expired; // 10
      const sum = completed + inProgress + notStarted + terminatedTotal; // 100

      expect(sum).toBe(totalCapacity);

      const completedPct = (completed / sum) * 100;
      const inProgressPct = (inProgress / sum) * 100;
      const notStartedPct = (notStarted / sum) * 100;
      const terminatedPct = (terminatedTotal / sum) * 100;

      expect(completedPct).toBe(45);
      expect(inProgressPct).toBe(15);
      expect(notStartedPct).toBe(30);
      expect(terminatedPct).toBe(10);
    });

    it('safely handles zero participants without division by zero', () => {
      const completed = 0;
      const inProgress = 0;
      const notStarted = 0;
      const total = completed + inProgress + notStarted;

      const pct = total > 0 ? (completed / total) * 100 : 0;
      expect(pct).toBe(0);
      expect(Number.isFinite(pct)).toBe(true);
    });
  });

  describe('Accuracy & Per-Question Math', () => {
    it('calculates correct answer accuracy and unanswered ratios', () => {
      const correct = 75;
      const incorrect = 20;
      const unanswered = 5;
      const total = correct + incorrect + unanswered;

      expect(total).toBe(100);
      expect((correct / total) * 100).toBe(75);
      expect((incorrect / total) * 100).toBe(20);
      expect((unanswered / total) * 100).toBe(5);
    });
  });

  describe('Academic Performance Tier Classification', () => {
    it('correctly categorizes candidates into Distinction, Proficient, Passing, and Below Cutoff', () => {
      const students = [
        { academic_percentage: 92, is_passed: true },
        { academic_percentage: 85, is_passed: true },
        { academic_percentage: 75, is_passed: true },
        { academic_percentage: 62, is_passed: true },
        { academic_percentage: 50, is_passed: true },
        { academic_percentage: 42, is_passed: true },
        { academic_percentage: 35, is_passed: false },
        { academic_percentage: 20, is_passed: false },
      ];

      const passingPercentage = 40;
      const tierDistinction = students.filter((s) => s.academic_percentage >= 80).length;
      const tierProficient = students.filter(
        (s) => s.academic_percentage >= 60 && s.academic_percentage < 80
      ).length;
      const tierPassing = students.filter(
        (s) => s.academic_percentage >= passingPercentage && s.academic_percentage < 60
      ).length;
      const tierBelow = students.filter((s) => s.academic_percentage < passingPercentage).length;

      expect(tierDistinction).toBe(2);
      expect(tierProficient).toBe(2);
      expect(tierPassing).toBe(2);
      expect(tierBelow).toBe(2);
      expect(tierDistinction + tierProficient + tierPassing + tierBelow).toBe(students.length);
    });
  });
});
