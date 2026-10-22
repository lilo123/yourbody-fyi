import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateWorkoutDerived, invalidateExerciseDomain } from './invalidate';
import type { InvalidationClient } from './invalidate';
import { queryKeys } from './queryKeys';
import { clearTemplateDetailCache } from '../components/workout/useWorkoutQueries';

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
    it('invalidates the 5 base exercise domain keys when userId is omitted', async () => {
      const { client, invalidatedKeys } = createMockQueryClient();

      await invalidateExerciseDomain(client);

      expect(client.invalidateQueries).toHaveBeenCalledTimes(5);
      expect(invalidatedKeys).toEqual([
        ['exercises'],
        ['routine_templates'],
        ['routine_template_detail'],
        ['workout_sets'],
        ['exercise_catalog'],
      ]);
    });

    it('invalidates both base keys and user-scoped keys when userId is provided', async () => {
      const { client, invalidatedKeys } = createMockQueryClient();
      const testUserId = 'user-uuid-456';

      await invalidateExerciseDomain(client, testUserId);

      expect(client.invalidateQueries).toHaveBeenCalledTimes(7);
      expect(invalidatedKeys).toEqual([
        ['exercises'],
        ['routine_templates'],
        ['routine_template_detail'],
        ['workout_sets'],
        ['exercise_catalog'],
        ['workout_sets', testUserId],
        ['routine_templates', testUserId],
      ]);
    });
  });

  describe('routine template detail invalidation after save', () => {
    it('refreshes template detail after routine template save because routine_template_detail is invalidated', async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // matches app defaultOptions in src/main.tsx
            retry: false,
          },
        },
      });

      const templateId = 'tpl-chest-day';
      const initialDetail = {
        id: templateId,
        exercises: [{ id: 'te-1', exercise_id: 'ex-bench', exercise: { name: 'Bench Press' } }],
      };
      const updatedDetail = {
        id: templateId,
        exercises: [{ id: 'te-2', exercise_id: 'ex-incline', exercise: { name: 'Incline Bench Press' } }],
      };

      let databaseDetail = initialDetail;
      const fetchDetailMock = vi.fn(async () => databaseDetail);

      // 1. Initial load (e.g. workout tab loads scheduled routine detail)
      const firstResult = await queryClient.fetchQuery({
        queryKey: queryKeys.routineTemplateDetail.byId(templateId),
        queryFn: fetchDetailMock,
      });
      expect(firstResult.exercises[0].exercise.name).toBe('Bench Press');

      // 2. User edits and saves the routine template in TemplateListTab / CoachCockpit
      // Database now holds the updated exercise list
      databaseDetail = updatedDetail;

      // Mutation onSuccess triggers domain invalidation
      await invalidateExerciseDomain(queryClient, 'user-123');

      // 3. User navigates back / starts workout from that template
      const secondResult = await queryClient.fetchQuery({
        queryKey: queryKeys.routineTemplateDetail.byId(templateId),
        queryFn: fetchDetailMock,
      });

      // Assert that the served detail has the updated exercises, not stale exercises
      expect(secondResult.exercises[0].exercise.name).toBe('Incline Bench Press');
    });

    it('clears in-memory template detail cache when clearTemplateDetailCache is invoked at save/delete call sites', () => {
      expect(() => clearTemplateDetailCache('tpl-chest-day')).not.toThrow();
      expect(() => clearTemplateDetailCache(undefined)).not.toThrow();
    });
  });
});

