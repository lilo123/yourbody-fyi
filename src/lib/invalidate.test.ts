import { describe, it, expect, vi } from 'vitest';
import {
  invalidateWorkoutDerived,
  invalidateExerciseDomain,
  invalidateNutritionDerived,
} from './invalidate';
import type { InvalidationClient } from './invalidate';

function createMockQueryClient() {
  const invalidatedKeys: unknown[][] = [];
  const client: InvalidationClient = {
    invalidateQueries: vi.fn(async (options: { queryKey: readonly unknown[] }) => {
      invalidatedKeys.push([...options.queryKey]);
    }),
  };
  return { client, invalidatedKeys };
}

describe('Cache Invalidation Helpers (src/lib/invalidate.ts)', () => {
  describe('invalidateWorkoutDerived', () => {
    it('invalidates the 4 base workout/set derived keys when userId is omitted', async () => {
      const { client, invalidatedKeys } = createMockQueryClient();

      await invalidateWorkoutDerived(client);

      expect(client.invalidateQueries).toHaveBeenCalledTimes(7);
      expect(invalidatedKeys).toEqual([
        ['workout_sets'],
        ['history_sessions'],
        ['exercise_stats'],
        ['session_sets'],
        ['workouts'],
        ['exercise_benchmarks'],
        ['exercise_stats_v2'],
      ]);
    });

    it('invalidates both base keys and 3 user-scoped keys when userId is provided', async () => {
      const { client, invalidatedKeys } = createMockQueryClient();
      const testUserId = 'user-uuid-123';

      await invalidateWorkoutDerived(client, testUserId);

      expect(client.invalidateQueries).toHaveBeenCalledTimes(11);
      expect(invalidatedKeys).toEqual([
        ['workout_sets'],
        ['history_sessions'],
        ['exercise_stats'],
        ['session_sets'],
        ['workouts'],
        ['exercise_benchmarks'],
        ['exercise_stats_v2'],
        ['workout_sets', testUserId],
        ['history_sessions', testUserId],
        ['exercise_stats', testUserId],
        ['exercise_stats_v2', testUserId],
      ]);
    });
  });

  describe('invalidateExerciseDomain', () => {
    it('invalidates the 4 base exercise domain keys when userId is omitted', async () => {
      const { client, invalidatedKeys } = createMockQueryClient();

      await invalidateExerciseDomain(client);

      expect(client.invalidateQueries).toHaveBeenCalledTimes(4);
      expect(invalidatedKeys).toEqual([
        ['exercises'],
        ['routine_templates'],
        ['workout_sets'],
        ['exercise_catalog'],
      ]);
    });

    it('invalidates both base keys and user-scoped keys when userId is provided', async () => {
      const { client, invalidatedKeys } = createMockQueryClient();
      const testUserId = 'user-uuid-456';

      await invalidateExerciseDomain(client, testUserId);

      expect(client.invalidateQueries).toHaveBeenCalledTimes(6);
      expect(invalidatedKeys).toEqual([
        ['exercises'],
        ['routine_templates'],
        ['workout_sets'],
        ['exercise_catalog'],
        ['workout_sets', testUserId],
        ['routine_templates', testUserId],
      ]);
    });
  });

  describe('invalidateNutritionDerived', () => {
    it('invalidates the base nutrition_logs key when userId is omitted', async () => {
      const { client, invalidatedKeys } = createMockQueryClient();

      await invalidateNutritionDerived(client);

      expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
      expect(invalidatedKeys).toEqual([['nutrition_logs']]);
    });

    it('invalidates both base key and user-scoped key when userId is provided', async () => {
      const { client, invalidatedKeys } = createMockQueryClient();
      const testUserId = 'user-uuid-123';

      await invalidateNutritionDerived(client, testUserId);

      expect(client.invalidateQueries).toHaveBeenCalledTimes(2);
      expect(invalidatedKeys).toEqual([
        ['nutrition_logs'],
        ['nutrition_logs', testUserId],
      ]);
    });
  });
});
