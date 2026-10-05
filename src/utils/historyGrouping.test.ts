import { describe, it, expect } from 'vitest';
import { groupSessionSetsByExercise } from './historyGrouping';
import type { Exercise } from '../types/database';

const mockExercises: Exercise[] = [
  { id: 'ex-b', name: 'Leg Extension', body_parts: ['Legs'] } as Exercise,
  { id: 'ex-a', name: 'Barbell Bench Press', body_parts: ['Chest'] } as Exercise,
  { id: 'ex-c', name: 'Triceps Pushdown', body_parts: ['Arms'] } as Exercise,
  { id: 'ex-overhead', name: 'Overhead Press', body_parts: ['Shoulders'] } as Exercise,
  { id: 'ex-arnold', name: 'Arnold Press', body_parts: ['Shoulders'] } as Exercise,
];

describe('groupSessionSetsByExercise ordering (D-YB-8)', () => {
  it('B then A then C logged (names chosen so alphabetical differs) -> B, A, C', () => {
    // Alphabetical order: Barbell Bench Press (A), Leg Extension (B), Triceps Pushdown (C)
    // Logged order: B (10:00), A (10:10), C (10:20)
    // Arrival / set_index: all set_index 1, arrival order A, B, C to test that arrival order does not govern
    const sets = [
      { id: 's-a1', exercise_id: 'ex-a', set_index: 1, created_at: '2026-10-02T10:10:00Z', weight: 135, reps: 5 },
      { id: 's-b1', exercise_id: 'ex-b', set_index: 1, created_at: '2026-10-02T10:00:00Z', weight: 100, reps: 10 },
      { id: 's-c1', exercise_id: 'ex-c', set_index: 1, created_at: '2026-10-02T10:20:00Z', weight: 50, reps: 12 },
    ];

    const groups = groupSessionSetsByExercise(sets, mockExercises);
    expect(groups.map((g) => g.exerciseName)).toEqual([
      'Leg Extension',
      'Barbell Bench Press',
      'Triceps Pushdown',
    ]);
  });

  it("interleaved superset logging orders by each exercise's first set", () => {
    // Exercise B logged first at 10:00, then Exercise A at 10:05, then B set 2 at 10:10, A set 2 at 10:15
    const sets = [
      { id: 's-b1', exercise_id: 'ex-b', set_index: 1, created_at: '2026-10-02T10:00:00Z', weight: 100, reps: 10 },
      { id: 's-a1', exercise_id: 'ex-a', set_index: 1, created_at: '2026-10-02T10:05:00Z', weight: 135, reps: 5 },
      { id: 's-b2', exercise_id: 'ex-b', set_index: 2, created_at: '2026-10-02T10:10:00Z', weight: 100, reps: 10 },
      { id: 's-a2', exercise_id: 'ex-a', set_index: 2, created_at: '2026-10-02T10:15:00Z', weight: 135, reps: 5 },
    ];

    const groups = groupSessionSetsByExercise(sets, mockExercises);
    expect(groups.map((g) => g.exerciseName)).toEqual([
      'Leg Extension',
      'Barbell Bench Press',
    ]);
    // Sets inside a card keep their current order (set_index, then created_at)
    expect(groups[0].sets.map((s) => s.id)).toEqual(['s-b1', 's-b2']);
    expect(groups[1].sets.map((s) => s.id)).toEqual(['s-a1', 's-a2']);
  });

  it('a later-logged exercise whose name sorts first comes later', () => {
    // Overhead Press (O) logged first at 09:00:00Z
    // Arnold Press (A) logged second at 09:15:00Z (alphabetically before Overhead Press)
    // Sets passed with Arnold Press first in arrival array
    const sets = [
      { id: 's-ap1', exercise_id: 'ex-arnold', set_index: 1, created_at: '2026-10-02T09:15:00Z', weight: 45, reps: 10 },
      { id: 's-op1', exercise_id: 'ex-overhead', set_index: 1, created_at: '2026-10-02T09:00:00Z', weight: 95, reps: 8 },
    ];

    const groups = groupSessionSetsByExercise(sets, mockExercises);
    expect(groups.map((g) => g.exerciseName)).toEqual([
      'Overhead Press',
      'Arnold Press',
    ]);
  });

  it('equal timestamps -> same order across 2 runs/shuffled input with deterministic input order', () => {
    // Both exercises have identical created_at
    const timestamp = '2026-10-02T10:00:00Z';
    const sets = [
      { id: 's-1', exercise_id: 'ex-b', set_index: 1, created_at: timestamp, weight: 100, reps: 10 },
      { id: 's-2', exercise_id: 'ex-a', set_index: 1, created_at: timestamp, weight: 135, reps: 5 },
    ];

    const run1 = groupSessionSetsByExercise(sets, mockExercises);
    const run2 = groupSessionSetsByExercise(sets, mockExercises);

    expect(run1.map((g) => g.exerciseName)).toEqual(run2.map((g) => g.exerciseName));
    expect(run1.map((g) => g.exerciseName)).toEqual(['Leg Extension', 'Barbell Bench Press']);
  });

  it('offline-created sets with client created_at', () => {
    // Sets created offline where created_at is client capture time
    // Ex a is first in array, but Ex b has earlier client created_at
    const sets = [
      { id: 's-client-2', exercise_id: 'ex-a', set_index: 1, created_at: '2026-10-02T11:05:00.123Z', weight: 185, reps: 5 },
      { id: 's-client-1', exercise_id: 'ex-b', set_index: 1, created_at: '2026-10-02T11:01:00.456Z', weight: 120, reps: 12 },
    ];

    const groups = groupSessionSetsByExercise(sets, mockExercises);
    expect(groups.map((g) => g.exerciseName)).toEqual([
      'Leg Extension',
      'Barbell Bench Press',
    ]);
  });

  it('missing created_at falls back to encounter order and never throws', () => {
    const setsWithMissing = [
      { id: 's-no-time-1', exercise_id: 'ex-a', set_index: 1, weight: 135, reps: 5 },
      { id: 's-no-time-2', exercise_id: 'ex-b', set_index: 1, weight: 100, reps: 10 },
    ];

    expect(() => {
      const groups = groupSessionSetsByExercise(setsWithMissing, mockExercises);
      expect(groups.map((g) => g.exerciseName)).toEqual([
        'Barbell Bench Press',
        'Leg Extension',
      ]);
    }).not.toThrow();

    const setsWithInvalid = [
      { id: 's-inv-1', exercise_id: 'ex-b', set_index: 1, created_at: 'not-a-date', weight: 100, reps: 10 },
      { id: 's-inv-2', exercise_id: 'ex-a', set_index: 1, created_at: 'also-invalid', weight: 135, reps: 5 },
    ];

    expect(() => {
      const groups = groupSessionSetsByExercise(setsWithInvalid, mockExercises);
      expect(groups.map((g) => g.exerciseName)).toEqual([
        'Leg Extension',
        'Barbell Bench Press',
      ]);
    }).not.toThrow();
  });
});
