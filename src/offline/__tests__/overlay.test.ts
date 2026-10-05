import { describe, it, expect } from 'vitest';
import {
  applyPendingToDaySets,
  pendingSetsBefore,
  applyPendingToHistory,
  applyPendingToNutritionLogs,
} from '../overlay';
import type { OutboxOp } from '../types';
import type { WorkoutSet } from '../../types/database';
import type { HistorySession } from '../../components/history/useWorkoutHistory';

describe('overlay', () => {
  describe('applyPendingToDaySets', () => {
    it('overlays synthetic sets onto server sets for the target date', () => {
      const serverSets: WorkoutSet[] = [
        {
          id: 'server-1',
          workout_id: 'w-server',
          exercise_id: 'ex-1',
          weight: 100,
          reps: 5,
          set_index: 0,
          set_type: 'working',
          created_at: '2026-03-30T10:00:00Z',
        },
      ];

      const ops: OutboxOp[] = [
        {
          opId: 'op-1',
          userId: 'u1',
          seq: 1,
          createdAt: '2026-03-30T10:00:00Z',
          kind: 'workout.ensure',
          payload: {
            clientWorkoutId: 'w-local',
            workout_date: '2026-03-30',
            name: 'Leg Day',
          },
          state: 'pending',
          attempts: 0,
        },
        {
          opId: 'op-2',
          userId: 'u1',
          seq: 2,
          createdAt: '2026-03-30T10:01:00Z',
          kind: 'set.create',
          payload: {
            id: 'local-set-1',
            workoutRef: 'w-local',
            exercise_id: 'ex-1',
            weight: 105,
            reps: 5,
            set_index: 1,
            created_at: '2026-03-30T10:05:00Z',
          },
          state: 'pending',
          attempts: 0,
        },
        // Set for different date should be ignored
        {
          opId: 'op-3',
          userId: 'u1',
          seq: 3,
          createdAt: '2026-03-30T10:02:00Z',
          kind: 'set.create',
          payload: {
            id: 'local-set-diff-date',
            workoutRef: 'w-other',
            exercise_id: 'ex-1',
            weight: 90,
            reps: 8,
            set_index: 0,
            created_at: '2026-03-29T10:00:00Z',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      const result = applyPendingToDaySets(serverSets, ops, '2026-03-30');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('server-1');
      expect(result[0].pending).toBe(false);
      expect(result[1].id).toBe('local-set-1');
      expect(result[1].pending).toBe(true);
      expect(result[1].workout_name).toBe('Leg Day');
      expect(result[1].weight).toBe(105);
    });

    it('does not duplicate sets when serverSets already contains the created set id', () => {
      const serverSets: WorkoutSet[] = [
        {
          id: 'set-synced-1',
          workout_id: 'w-1',
          exercise_id: 'ex-1',
          weight: 100,
          reps: 5,
          set_index: 0,
          set_type: 'working',
          created_at: '2026-03-30T10:00:00Z',
        },
      ];

      const ops: OutboxOp[] = [
        {
          opId: 'op-1',
          userId: 'u1',
          seq: 1,
          createdAt: '2026-03-30T10:00:00Z',
          kind: 'set.create',
          payload: {
            id: 'set-synced-1',
            workoutRef: 'w-1',
            exercise_id: 'ex-1',
            weight: 100,
            reps: 5,
            set_index: 0,
            created_at: '2026-03-30T10:00:00Z',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      const result = applyPendingToDaySets(serverSets, ops, '2026-03-30');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('set-synced-1');
      expect(result[0].pending).toBe(true);
    });

    it('applies pending updates and deletes to existing sets', () => {
      const serverSets: WorkoutSet[] = [
        {
          id: 'server-1',
          workout_id: 'w-server',
          exercise_id: 'ex-1',
          weight: 100,
          reps: 5,
          set_index: 0,
          set_type: 'working',
          created_at: '2026-03-30T10:00:00Z',
        },
        {
          id: 'server-2',
          workout_id: 'w-server',
          exercise_id: 'ex-1',
          weight: 100,
          reps: 5,
          set_index: 1,
          set_type: 'working',
          created_at: '2026-03-30T10:05:00Z',
        },
      ];

      const ops: OutboxOp[] = [
        {
          opId: 'op-1',
          userId: 'u1',
          seq: 1,
          createdAt: '2026-03-30T10:00:00Z',
          kind: 'set.update',
          payload: {
            id: 'server-1',
            patch: { weight: 110, reps: 6 },
            expected: { weight: 100, reps: 5 },
          },
          state: 'pending',
          attempts: 0,
        },
        {
          opId: 'op-2',
          userId: 'u1',
          seq: 2,
          createdAt: '2026-03-30T10:01:00Z',
          kind: 'set.delete',
          payload: {
            id: 'server-2',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      const result = applyPendingToDaySets(serverSets, ops, '2026-03-30');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('server-1');
      expect(result[0].weight).toBe(110);
      expect(result[0].reps).toBe(6);
      expect(result[0].pending).toBe(true);
    });

    it('applies workout rename to sets belonging to that workout', () => {
      const serverSets: WorkoutSet[] = [
        {
          id: 'server-1',
          workout_id: 'w-1',
          exercise_id: 'ex-1',
          weight: 100,
          reps: 5,
          set_index: 0,
          set_type: 'working',
          created_at: '2026-03-30T10:00:00Z',
          workout_name: 'Old Name',
        },
      ];

      const ops: OutboxOp[] = [
        {
          opId: 'op-rename',
          userId: 'u1',
          seq: 1,
          createdAt: '2026-03-30T10:00:00Z',
          kind: 'workout.rename',
          payload: {
            workoutRef: 'w-1',
            name: 'New Power Workout',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      const result = applyPendingToDaySets(serverSets, ops, '2026-03-30');
      expect(result[0].workout_name).toBe('New Power Workout');
      expect(result[0].pending).toBe(true);
    });
  });

  describe('pendingSetsBefore', () => {
    it('returns pending sets created strictly before target date', () => {
      const ops: OutboxOp[] = [
        {
          opId: 'op-w1',
          userId: 'u1',
          seq: 1,
          createdAt: '2026-03-25T10:00:00Z',
          kind: 'workout.ensure',
          payload: { clientWorkoutId: 'w-past', workout_date: '2026-03-25' },
          state: 'pending',
          attempts: 0,
        },
        {
          opId: 'op-s1',
          userId: 'u1',
          seq: 2,
          createdAt: '2026-03-25T12:00:00Z',
          kind: 'set.create',
          payload: {
            id: 'past-set-1',
            workoutRef: 'w-past',
            exercise_id: 'bench-press',
            weight: 225,
            reps: 5,
            set_index: 0,
            created_at: '2026-03-25T12:00:00Z',
          },
          state: 'pending',
          attempts: 0,
        },
        {
          opId: 'op-w2',
          userId: 'u1',
          seq: 3,
          createdAt: '2026-03-31T10:00:00Z',
          kind: 'workout.ensure',
          payload: { clientWorkoutId: 'w-future', workout_date: '2026-03-31' },
          state: 'pending',
          attempts: 0,
        },
        {
          opId: 'op-s2',
          userId: 'u1',
          seq: 4,
          createdAt: '2026-03-31T12:00:00Z',
          kind: 'set.create',
          payload: {
            id: 'future-set-1',
            workoutRef: 'w-future',
            exercise_id: 'bench-press',
            weight: 235,
            reps: 3,
            set_index: 0,
            created_at: '2026-03-31T12:00:00Z',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      const pastSets = pendingSetsBefore('2026-03-30', ops);
      expect(pastSets).toHaveLength(1);
      expect(pastSets[0].id).toBe('past-set-1');
      expect(pastSets[0].weight).toBe(225);
      expect(pastSets[0].workout_date).toBe('2026-03-25');
      expect(pastSets[0].pending).toBe(true);
    });

    it('handles updates and deletes on past pending sets', () => {
      const ops: OutboxOp[] = [
        {
          opId: 'op-s1',
          userId: 'u1',
          seq: 1,
          createdAt: '2026-03-20T10:00:00Z',
          kind: 'set.create',
          payload: {
            id: 'pullup-1',
            workoutRef: 'w-calisthenics',
            exercise_id: 'pullups',
            weight: 0,
            reps: 15,
            set_index: 0,
            created_at: '2026-03-20T10:00:00Z',
          },
          state: 'pending',
          attempts: 0,
        },
        {
          opId: 'op-s2',
          userId: 'u1',
          seq: 2,
          createdAt: '2026-03-20T10:01:00Z',
          kind: 'set.update',
          payload: {
            id: 'pullup-1',
            patch: { reps: 20 },
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      const sets = pendingSetsBefore('2026-03-30', ops);
      expect(sets).toHaveLength(1);
      expect(sets[0].reps).toBe(20);
    });
  });

  describe('applyPendingToHistory', () => {
    it('synthesizes new session for pending workouts not in history list', () => {
      const existingHistory: HistorySession[] = [
        {
          id: 'hist-1',
          date: '2026-03-20T10:00:00Z',
          workout_date: '2026-03-20',
          civil_date: '2026-03-20',
          name: 'Chest Day',
          set_count: 5,
          total_volume: 5000,
        },
      ];

      const ops: OutboxOp[] = [
        {
          opId: 'op-1',
          userId: 'u1',
          seq: 1,
          createdAt: '2026-03-28T10:00:00Z',
          kind: 'workout.ensure',
          payload: {
            clientWorkoutId: 'offline-w-1',
            workout_date: '2026-03-28',
            name: 'Back & Biceps',
          },
          state: 'pending',
          attempts: 0,
        },
        {
          opId: 'op-2',
          userId: 'u1',
          seq: 2,
          createdAt: '2026-03-28T14:00:00Z',
          kind: 'set.create',
          payload: {
            id: 'offline-s-1',
            workoutRef: 'offline-w-1',
            exercise_id: 'deadlift',
            weight: 315,
            reps: 5,
            set_index: 0,
            set_type: 'working',
            created_at: '2026-03-28T14:00:00Z',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      const updatedHistory = applyPendingToHistory(existingHistory, ops);

      expect(updatedHistory).toHaveLength(2);
      // Sorted descending by date: 2026-03-28 should come first
      expect(updatedHistory[0].workout_date).toBe('2026-03-28');
      expect(updatedHistory[0].name).toBe('Back & Biceps');
      expect(updatedHistory[0].set_count).toBe(1);
      expect(updatedHistory[0].total_volume).toBe(315 * 5);
      expect(updatedHistory[0].pending).toBe(true);

      expect(updatedHistory[1].workout_date).toBe('2026-03-20');
      expect(updatedHistory[1].pending).toBe(false);
    });

    it('updates set_count and total_volume for existing session when sets added/removed', () => {
      const existingHistory: HistorySession[] = [
        {
          id: 'hist-1',
          date: '2026-03-28T10:00:00Z',
          workout_date: '2026-03-28',
          civil_date: '2026-03-28',
          name: 'Leg Day',
          set_count: 3,
          total_volume: 3000,
        },
      ];

      const ops: OutboxOp[] = [
        {
          opId: 'op-1',
          userId: 'u1',
          seq: 1,
          createdAt: '2026-03-28T11:00:00Z',
          kind: 'set.create',
          payload: {
            id: 'extra-squat',
            workoutRef: 'hist-1',
            exercise_id: 'squat',
            weight: 200,
            reps: 10,
            set_index: 3,
            set_type: 'working',
            created_at: '2026-03-28T11:00:00Z',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      const updatedHistory = applyPendingToHistory(existingHistory, ops);

      expect(updatedHistory).toHaveLength(1);
      expect(updatedHistory[0].set_count).toBe(4);
      expect(updatedHistory[0].total_volume).toBe(5000); // 3000 + (200 * 10)
      expect(updatedHistory[0].pending).toBe(true);
    });

    it('overlays set.batchCreate ops into today sets and pendingSetsBefore', () => {
      const ops: OutboxOp[] = [
        {
          opId: 'batch-op-1',
          userId: 'u1',
          seq: 1,
          createdAt: '2026-03-28T10:00:00Z',
          kind: 'workout.ensure',
          payload: {
            clientWorkoutId: 'w-batch',
            workout_date: '2026-03-28',
            name: 'Batch Day',
          },
          state: 'pending',
          attempts: 0,
        },
        {
          opId: 'batch-op-2',
          userId: 'u1',
          seq: 2,
          createdAt: '2026-03-28T10:05:00Z',
          kind: 'set.batchCreate',
          payload: {
            workoutRef: 'w-batch',
            sets: [
              {
                id: 'b-set-1',
                exercise_id: 'bench',
                weight: 205,
                reps: 8,
                set_index: 1,
                set_type: 'working',
                created_at: '2026-03-28T10:05:00Z',
              },
              {
                id: 'b-set-2',
                exercise_id: 'squat',
                weight: 315,
                reps: 5,
                set_index: 2,
                set_type: 'working',
                created_at: '2026-03-28T10:06:00Z',
              },
            ],
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      const daySets = applyPendingToDaySets([], ops, '2026-03-28');
      expect(daySets).toHaveLength(2);
      expect(daySets[0].id).toBe('b-set-1');
      expect(daySets[0].weight).toBe(205);
      expect(daySets[0].pending).toBe(true);
      expect(daySets[1].id).toBe('b-set-2');
      expect(daySets[1].weight).toBe(315);
      expect(daySets[1].pending).toBe(true);

      const beforeSets = pendingSetsBefore('2026-03-29', ops);
      expect(beforeSets).toHaveLength(2);
      expect(beforeSets.map((s) => s.id)).toEqual(['b-set-1', 'b-set-2']);
    });
  });

  describe('applyPendingToNutritionLogs (§N2, §N3)', () => {
    const userId = 'user-nl-overlay';

    it('deduplicates by id: pending op replaces server log with pending: true', () => {
      const serverLogs = [
        {
          id: 'meal-1',
          food_name: 'Old Meal Name',
          calories: 300,
          logged_at: '2026-10-01T08:00:00Z',
          logged_date: '2026-10-01',
        },
      ];

      const ops: OutboxOp[] = [
        {
          opId: 'op-1',
          userId,
          seq: 1,
          createdAt: '2026-10-01T08:05:00Z',
          kind: 'nutrition.log',
          payload: {
            id: 'meal-1', // same id -> dedupe
            user_id: userId,
            food_name: 'Updated Meal Name',
            calories: 350,
            logged_at: '2026-10-01T08:00:00Z',
            logged_date: '2026-10-01',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      const result = applyPendingToNutritionLogs(serverLogs, ops, { date: '2026-10-01', userId });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('meal-1');
      expect(result[0].food_name).toBe('Updated Meal Name');
      expect(result[0].calories).toBe(350);
      expect(result[0].pending).toBe(true);
    });

    it('appends new pending op when id is not in server logs', () => {
      const serverLogs = [
        {
          id: 'meal-server-1',
          food_name: 'Breakfast',
          calories: 400,
          logged_at: '2026-10-01T08:00:00Z',
          logged_date: '2026-10-01',
        },
      ];

      const ops: OutboxOp[] = [
        {
          opId: 'op-2',
          userId,
          seq: 1,
          createdAt: '2026-10-01T12:00:00Z',
          kind: 'nutrition.log',
          payload: {
            id: 'meal-local-1',
            user_id: userId,
            food_name: 'Lunch Salad',
            calories: 500,
            logged_at: '2026-10-01T12:00:00Z',
            logged_date: '2026-10-01',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      const result = applyPendingToNutritionLogs(serverLogs, ops, { date: '2026-10-01', userId });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('meal-local-1');
      expect(result[0].pending).toBe(true);
      expect(result[1].id).toBe('meal-server-1');
      expect(result[1].pending).toBe(false);
    });

    it('filters pending ops by target date when options.date is provided', () => {
      const ops: OutboxOp[] = [
        {
          opId: 'op-today',
          userId,
          seq: 1,
          createdAt: '2026-10-01T12:00:00Z',
          kind: 'nutrition.log',
          payload: {
            id: 'meal-today',
            user_id: userId,
            food_name: 'Today Lunch',
            calories: 500,
            logged_at: '2026-10-01T12:00:00Z',
            logged_date: '2026-10-01',
          },
          state: 'pending',
          attempts: 0,
        },
        {
          opId: 'op-yesterday',
          userId,
          seq: 2,
          createdAt: '2026-09-30T12:00:00Z',
          kind: 'nutrition.log',
          payload: {
            id: 'meal-yesterday',
            user_id: userId,
            food_name: 'Yesterday Lunch',
            calories: 600,
            logged_at: '2026-09-30T12:00:00Z',
            logged_date: '2026-09-30',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      type TestLog = { id: string; food_name?: string; calories?: number; logged_at?: string; logged_date?: string | null };
      const emptyLogs: TestLog[] = [];

      const todayResult = applyPendingToNutritionLogs(emptyLogs, ops, { date: '2026-10-01', userId });
      expect(todayResult).toHaveLength(1);
      expect(todayResult[0].id).toBe('meal-today');

      const yesterdayResult = applyPendingToNutritionLogs(emptyLogs, ops, { date: '2026-09-30', userId });
      expect(yesterdayResult).toHaveLength(1);
      expect(yesterdayResult[0].id).toBe('meal-yesterday');
    });

    it('includes pending ops across multiple dates when options.date is omitted (history window)', () => {
      const ops: OutboxOp[] = [
        {
          opId: 'op-1',
          userId,
          seq: 1,
          createdAt: '2026-10-01T12:00:00Z',
          kind: 'nutrition.log',
          payload: {
            id: 'meal-1',
            user_id: userId,
            food_name: 'Meal Oct 1',
            calories: 500,
            logged_at: '2026-10-01T12:00:00Z',
            logged_date: '2026-10-01',
          },
          state: 'pending',
          attempts: 0,
        },
        {
          opId: 'op-2',
          userId,
          seq: 2,
          createdAt: '2026-09-30T12:00:00Z',
          kind: 'nutrition.log',
          payload: {
            id: 'meal-2',
            user_id: userId,
            food_name: 'Meal Sep 30',
            calories: 600,
            logged_at: '2026-09-30T12:00:00Z',
            logged_date: '2026-09-30',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      type TestLog = { id: string; food_name?: string; calories?: number; logged_at?: string; logged_date?: string | null };
      const emptyLogs: TestLog[] = [];

      const historyResult = applyPendingToNutritionLogs(emptyLogs, ops, { userId });
      expect(historyResult).toHaveLength(2);
      expect(historyResult[0].id).toBe('meal-1');
      expect(historyResult[1].id).toBe('meal-2');
    });

    it('ignores pending ops belonging to a different user', () => {
      const ops: OutboxOp[] = [
        {
          opId: 'op-other',
          userId: 'other-user',
          seq: 1,
          createdAt: '2026-10-01T12:00:00Z',
          kind: 'nutrition.log',
          payload: {
            id: 'meal-other',
            user_id: 'other-user',
            food_name: 'Other User Meal',
            calories: 700,
            logged_at: '2026-10-01T12:00:00Z',
            logged_date: '2026-10-01',
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      type TestLog = { id: string; food_name?: string; calories?: number; logged_at?: string; logged_date?: string | null };
      const emptyLogs: TestLog[] = [];
      const result = applyPendingToNutritionLogs(emptyLogs, ops, { userId });
      expect(result).toHaveLength(0);
    });
  });
});
