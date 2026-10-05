import { describe, it, expect } from 'vitest';
import { isUuidLike, resolveExerciseLabel } from './exerciseLabel';
import { groupSessionSetsByExercise } from './historyGrouping';
import type { Exercise, WorkoutSet } from '../types/database';

describe('exerciseLabel utility', () => {
  describe('isUuidLike', () => {
    it('returns true for canonical lowercase UUID', () => {
      expect(isUuidLike('a3f1c2de-4b5a-4c6d-8e9f-0123456789ab')).toBe(true);
    });

    it('returns true for canonical uppercase UUID', () => {
      expect(isUuidLike('A3F1C2DE-4B5A-4C6D-8E9F-0123456789AB')).toBe(true);
    });

    it('returns true for mixed-case UUID', () => {
      expect(isUuidLike('A3f1C2de-4B5a-4C6D-8e9F-0123456789ab')).toBe(true);
    });

    it('returns true for UUID with leading/trailing whitespace', () => {
      expect(isUuidLike('  a3f1c2de-4b5a-4c6d-8e9f-0123456789ab  ')).toBe(true);
    });

    it('returns false for empty string and whitespace-only', () => {
      expect(isUuidLike('')).toBe(false);
      expect(isUuidLike('   ')).toBe(false);
    });

    it('returns false for null and undefined', () => {
      expect(isUuidLike(null)).toBe(false);
      expect(isUuidLike(undefined)).toBe(false);
    });

    it('returns false for non-string types', () => {
      expect(isUuidLike(12345)).toBe(false);
      expect(isUuidLike({})).toBe(false);
      expect(isUuidLike([])).toBe(false);
      expect(isUuidLike(true)).toBe(false);
    });

    it('returns false for normal exercise names', () => {
      expect(isUuidLike('Barbell Bench Press')).toBe(false);
      expect(isUuidLike('Squat')).toBe(false);
    });

    it('returns false for near-miss exercise names with hyphens', () => {
      expect(isUuidLike('Cable Cross-Over')).toBe(false);
      expect(isUuidLike('Pull-Up')).toBe(false);
      expect(isUuidLike('Face-Pull')).toBe(false);
      expect(isUuidLike('T-Bar Row')).toBe(false);
    });

    it('returns false for wrong-length hex-ish strings', () => {
      expect(isUuidLike('a3f1c2de-4b5a-4c6d-8e9f-0123456789a')).toBe(false);
      expect(isUuidLike('a3f1c2de-4b5a-4c6d-8e9f-0123456789abcde')).toBe(false);
      expect(isUuidLike('a3f1c2de-4b5a-4c6d-8e9f')).toBe(false);
      expect(isUuidLike('0123456789abcdef0123456789abcdef')).toBe(false);
    });
  });

  describe('resolveExerciseLabel', () => {
    it('returns fallback for lowercase UUID', () => {
      expect(resolveExerciseLabel('a3f1c2de-4b5a-4c6d-8e9f-0123456789ab')).toBe('Unknown exercise');
    });

    it('returns custom fallback for uppercase UUID', () => {
      expect(
        resolveExerciseLabel('A3F1C2DE-4B5A-4C6D-8E9F-0123456789AB', 'Custom Fallback')
      ).toBe('Custom Fallback');
    });

    it('returns fallback for null or undefined', () => {
      expect(resolveExerciseLabel(null)).toBe('Unknown exercise');
      expect(resolveExerciseLabel(undefined)).toBe('Unknown exercise');
      expect(resolveExerciseLabel(null, 'Unknown Exercise')).toBe('Unknown Exercise');
    });

    it('returns fallback for blank or whitespace-only string', () => {
      expect(resolveExerciseLabel('')).toBe('Unknown exercise');
      expect(resolveExerciseLabel('   ')).toBe('Unknown exercise');
      expect(resolveExerciseLabel('   ', 'Custom Fallback')).toBe('Custom Fallback');
    });

    it('returns fallback for non-string candidates', () => {
      expect(resolveExerciseLabel(42)).toBe('Unknown exercise');
      expect(resolveExerciseLabel({})).toBe('Unknown exercise');
    });

    it('preserves valid exercise names', () => {
      expect(resolveExerciseLabel('Barbell Bench Press')).toBe('Barbell Bench Press');
      expect(resolveExerciseLabel('Cable Cross-Over')).toBe('Cable Cross-Over');
      expect(resolveExerciseLabel('  Incline Dumbbell Press  ')).toBe('Incline Dumbbell Press');
    });
  });

  describe('historyGrouping regression coverage', () => {
    it('prevents raw UUID from reaching rendered label when exercise catalog is missing row', () => {
      const missingUuid = 'a3f1c2de-4b5a-4c6d-8e9f-0123456789ab';
      const sets: Partial<WorkoutSet>[] = [
        {
          id: 'set-1',
          exercise_id: missingUuid,
          weight: 100,
          reps: 10,
          set_index: 0,
        },
      ];
      const emptyCatalog: Exercise[] = [];

      const groups = groupSessionSetsByExercise(sets as any, emptyCatalog);
      expect(groups).toHaveLength(1);
      expect(groups[0].exerciseName).not.toBe(missingUuid);
      expect(groups[0].exerciseName).toBe('Unknown Exercise');
      expect(groups[0].exerciseId).toBe(missingUuid);
    });

    it('groups by distinct UUIDs producing distinct groups without merging into a shared group', () => {
      const uuid1 = '11111111-1111-4111-8111-111111111111';
      const uuid2 = '22222222-2222-4222-8222-222222222222';
      const sets: Partial<WorkoutSet>[] = [
        {
          id: 'set-1',
          exercise_id: uuid1,
          weight: 100,
          reps: 10,
          set_index: 0,
        },
        {
          id: 'set-2',
          exercise_id: uuid1,
          weight: 105,
          reps: 8,
          set_index: 1,
        },
        {
          id: 'set-3',
          exercise_id: uuid2,
          weight: 50,
          reps: 12,
          set_index: 0,
        },
      ];
      const emptyCatalog: Exercise[] = [];

      const groups = groupSessionSetsByExercise(sets as any, emptyCatalog);
      expect(groups).toHaveLength(2);

      const group1 = groups.find((g) => g.exerciseId === uuid1);
      const group2 = groups.find((g) => g.exerciseId === uuid2);

      expect(group1).toBeDefined();
      expect(group2).toBeDefined();
      expect(group1!.exerciseName).toBe('Unknown Exercise');
      expect(group2!.exerciseName).toBe('Unknown Exercise');
      expect(group1!.sets).toHaveLength(2);
      expect(group2!.sets).toHaveLength(1);
    });

    it('still merges two catalog rows that share a name into one group', () => {
      // Pre-existing behaviour: this function has always grouped by resolved name, so a custom
      // duplicate of a master exercise renders as one card. Keying the group map on the exercise
      // id instead would silently split it into two identically-labelled cards.
      const masterId = '11111111-1111-4111-8111-111111111111';
      const customId = '22222222-2222-4222-8222-222222222222';
      const catalog = [
        { id: masterId, name: 'Bench Press', body_parts: ['Chest'], is_master: true },
        { id: customId, name: 'Bench Press', body_parts: ['Chest'], is_master: false },
      ] as unknown as Exercise[];
      const sets = [
        { id: 'set-1', exercise_id: masterId, weight: 100, reps: 5, set_index: 0 },
        { id: 'set-2', exercise_id: customId, weight: 110, reps: 3, set_index: 1 },
      ];

      const groups = groupSessionSetsByExercise(sets as unknown as WorkoutSet[], catalog);

      expect(groups).toHaveLength(1);
      expect(groups[0].exerciseName).toBe('Bench Press');
      expect(groups[0].sets).toHaveLength(2);
    });
  });
});
