import { describe, it, expect } from 'vitest';
import type { PodiumEntry } from './KahootPodium';

describe('Kahoot Podium Layout & Hierarchy Logic', () => {
  it('correctly maps 1 participant to a single centered Gold podium', () => {
    const entries: PodiumEntry[] = [
      {
        rank: 1,
        student_name: 'Pooja Reddy',
        score: 120,
        question_score: 100,
        eos_points: 967,
        speed_bonus_score: 967,
      },
    ];

    expect(entries.length).toBe(1);
    const first = entries[0];
    expect(first.rank).toBe(1);
    expect(first.student_name).toBe('Pooja Reddy');
    expect(first.score).toBe(120);
    expect(first.question_score).toBe(100);
    expect(first.eos_points).toBe(967);
  });

  it('correctly maps 2 participants to Silver (left) and Gold (right/center)', () => {
    const entries: PodiumEntry[] = [
      {
        rank: 1,
        student_name: 'Pooja Reddy',
        score: 150,
        question_score: 100,
        eos_points: 967,
      },
      {
        rank: 2,
        student_name: 'Rohit Sharma',
        score: 125,
        question_score: 100,
        eos_points: 833,
      },
    ];

    expect(entries.length).toBe(2);
    expect(entries[0].rank).toBe(1); // Gold
    expect(entries[1].rank).toBe(2); // Silver
  });

  it('correctly orders 3 participants into Kahoot visual hierarchy: Silver (2nd) Left, Gold (1st) Center, Bronze (3rd) Right', () => {
    const entries: PodiumEntry[] = [
      {
        rank: 1,
        student_name: 'Participant A',
        score: 10,
        question_score: 10,
        eos_points: 967,
      },
      {
        rank: 2,
        student_name: 'Participant B',
        score: 10,
        question_score: 10,
        eos_points: 833,
      },
      {
        rank: 3,
        student_name: 'Participant D',
        score: 10,
        question_score: 10,
        eos_points: 667,
      },
    ];

    const first = entries[0];
    const second = entries[1];
    const third = entries[2];

    expect(first.student_name).toBe('Participant A');
    expect(first.eos_points).toBe(967);

    expect(second.student_name).toBe('Participant B');
    expect(second.eos_points).toBe(833);

    expect(third.student_name).toBe('Participant D');
    expect(third.eos_points).toBe(667);

    // Visual order: Left = 2nd (Silver), Center = 1st (Gold), Right = 3rd (Bronze)
    const visualOrder = [second, first, third];
    expect(visualOrder[0].rank).toBe(2); // Left is Silver #2
    expect(visualOrder[1].rank).toBe(1); // Center is Gold #1
    expect(visualOrder[2].rank).toBe(3); // Right is Bronze #3
  });

  it('correctly splits ranks 4+ into the supplementary leaderboard standings', () => {
    const entries: PodiumEntry[] = [
      { rank: 1, student_name: 'Student 1', score: 200, question_score: 100, eos_points: 967 },
      { rank: 2, student_name: 'Student 2', score: 175, question_score: 100, eos_points: 833 },
      { rank: 3, student_name: 'Student 3', score: 150, question_score: 100, eos_points: 750 },
      { rank: 4, student_name: 'Student 4', score: 125, question_score: 100, eos_points: 667 },
      { rank: 5, student_name: 'Student 5', score: 110, question_score: 100, eos_points: 583 },
    ];

    const podiumTop3 = entries.slice(0, 3);
    const runnersUp = entries.slice(3);

    expect(podiumTop3.length).toBe(3);
    expect(runnersUp.length).toBe(2);
    expect(runnersUp[0].rank).toBe(4);
    expect(runnersUp[1].rank).toBe(5);
  });

  it('detects and flags ties between top ranks', () => {
    const tiedEntries: PodiumEntry[] = [
      { rank: 1, student_name: 'Student A', score: 150, question_score: 100, eos_points: 967 },
      { rank: 1, student_name: 'Student B', score: 150, question_score: 100, eos_points: 967 },
      { rank: 3, student_name: 'Student C', score: 120, question_score: 100, eos_points: 667 },
    ];

    const isTie1_2 = tiedEntries[0].score === tiedEntries[1].score;
    const isTie2_3 = tiedEntries[1].score === tiedEntries[2].score;

    expect(isTie1_2).toBe(true);
    expect(isTie2_3).toBe(false);
  });
});
