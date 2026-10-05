import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getNextSetIndex,
  getOrCreateWorkout,
  insertSet,
  batchInsertSets,
  updateSet,
  deleteSet,
  resolveWorkoutRefForDate,
} from './sets';
import { enqueueAndAwait } from '../offline';

vi.mock('../offline', async () => {
  const actual = await vi.importActual<any>('../offline');
  return {
    ...actual,
    enqueueAndAwait: vi.fn(),
  };
});

describe('sets data layer writers (src/lib/sets.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe('getNextSetIndex (W19)', () => {
    it('returns 1 for an empty set list', () => {
      expect(getNextSetIndex([])).toBe(1);
    });

    it('returns max(set_index)+1 when sets are sequential', () => {
      expect(getNextSetIndex([{ set_index: 1 }, { set_index: 2 }, { set_index: 3 }])).toBe(4);
    });

    it('returns 4 when set 1 was deleted from [1, 2, 3] (W19 acceptance)', () => {
      // Deleting set 1 leaves [2, 3]; next set must be max(2,3) + 1 = 4, preventing index collision
      expect(getNextSetIndex([{ set_index: 2 }, { set_index: 3 }])).toBe(4);
    });

    it('handles null/undefined/missing set_index gracefully', () => {
      expect(getNextSetIndex([{ set_index: null }, { set_index: 2 }])).toBe(3);
      expect(getNextSetIndex([{ set_index: undefined }])).toBe(1);
    });
  });

  describe('getOrCreateWorkout (W40, W41)', () => {
    it('returns existing workout id if one already exists for that user and civil date', async () => {
      const mockClient: any = {
        ['from']: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'w-existing-123' },
            error: null,
          }),
        }),
      };

      const id = await getOrCreateWorkout(mockClient, 'user-1', '2026-09-27');
      expect(id).toBe('w-existing-123');
    });

    it('inserts a new workout when no existing session is found', async () => {
      const mockClient: any = {
        ['from']: vi.fn().mockImplementation((table: string) => {
          if (table === 'workouts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              lte: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'w-new-456' },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const id = await getOrCreateWorkout(mockClient, 'user-1', '2026-09-27', 'Leg Day');
      expect(id).toBe('w-new-456');
    });

    it('handles concurrent race condition 23505 (unique_violation) and returns winning row (W41 acceptance)', async () => {
      let callCount = 0;
      const mockClient: any = {
        ['from']: vi.fn().mockImplementation(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // Initial check: not found
              return Promise.resolve({ data: null, error: null });
            }
            // Conflict recovery check: found winning row
            return Promise.resolve({ data: { id: 'w-concurrent-winner' }, error: null });
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint "workouts_user_id_workout_date_key"',
                },
              }),
            }),
          }),
        })),
      };

      const id = await getOrCreateWorkout(mockClient, 'user-1', '2026-09-27');
      expect(id).toBe('w-concurrent-winner');
    });

    it('lookup uses workout_date to find existing workout', async () => {
      const eqMock = vi.fn().mockReturnThis();
      const mockClient: any = {
        ['from']: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: eqMock,
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'w-workout-date-123' },
            error: null,
          }),
        }),
      };

      const id = await getOrCreateWorkout(mockClient, 'user-1', '2026-09-27');
      expect(id).toBe('w-workout-date-123');
      expect(eqMock).toHaveBeenCalledWith('user_id', 'user-1');
      expect(eqMock).toHaveBeenCalledWith('workout_date', '2026-09-27');
    });

    it('recovery after 23505 finds the row by workout_date even when its date is on another UTC day', async () => {
      let selectCount = 0;
      const mockClient: any = {
        ['from']: vi.fn().mockImplementation((table: string) => {
          if (table !== 'workouts') return {};
          let eqFilters: Record<string, any> = {};
          let gteCalled = false;
          let lteCalled = false;

          const builder: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((col: string, val: any) => {
              eqFilters[col] = val;
              return builder;
            }),
            gte: vi.fn().mockImplementation(() => {
              gteCalled = true;
              return builder;
            }),
            lte: vi.fn().mockImplementation(() => {
              lteCalled = true;
              return builder;
            }),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockImplementation(() => {
              selectCount++;
              if (selectCount === 1) {
                // First select (initial check): row not yet committed by concurrent transaction
                return Promise.resolve({ data: null, error: null });
              }
              // Second select (recovery check):
              // If lookup searches by workout_date, the row is found
              if (eqFilters.workout_date === '2026-09-27') {
                return Promise.resolve({ data: { id: 'w-tokyo-row' }, error: null });
              }
              // If lookup searches by UTC date window, the row is missed because its date is 2026-09-26T16:00Z
              if (gteCalled || lteCalled) {
                return Promise.resolve({ data: null, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint "workouts_user_id_workout_date_key"',
                  },
                }),
              }),
            }),
          };
          return builder;
        }),
      };

      const id = await getOrCreateWorkout(mockClient, 'user-1', '2026-09-27');
      expect(id).toBe('w-tokyo-row');
    });

    it('pre-M2 fallback path still works when workout_date column does not exist', async () => {
      let queryCount = 0;
      let dateWindowQueryMade = false;

      const mockClient: any = {
        ['from']: vi.fn().mockImplementation((table: string) => {
          if (table !== 'workouts') return {};
          let eqCol: string | null = null;

          const builder: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((col: string) => {
              if (col === 'workout_date') {
                eqCol = col;
              }
              return builder;
            }),
            gte: vi.fn().mockImplementation((col: string) => {
              if (col === 'date') dateWindowQueryMade = true;
              return builder;
            }),
            lte: vi.fn().mockImplementation((col: string) => {
              if (col === 'date') dateWindowQueryMade = true;
              return builder;
            }),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockImplementation(() => {
              queryCount++;
              if (eqCol === 'workout_date') {
                // Pre-M2 DB: column does not exist error
                return Promise.resolve({
                  data: null,
                  error: {
                    code: '42703',
                    message: 'column workouts.workout_date does not exist',
                  },
                });
              }
              if (dateWindowQueryMade) {
                // Fallback date-window query succeeds
                return Promise.resolve({
                  data: { id: 'w-pre-m2-legacy' },
                  error: null,
                });
              }
              return Promise.resolve({ data: null, error: null });
            }),
          };
          return builder;
        }),
      };

      const id = await getOrCreateWorkout(mockClient, 'user-1', '2026-09-27');
      expect(id).toBe('w-pre-m2-legacy');
      expect(queryCount).toBe(2);
      expect(dateWindowQueryMade).toBe(true);
    });

    it('handles W41 two concurrent calls returning one single workout id', async () => {
      let createdRow: { id: string; date: string; workout_date: string } | null = null;

      const mockClient: any = {
        ['from']: vi.fn().mockImplementation((table: string) => {
          if (table !== 'workouts') return {};
          let eqFilters: Record<string, any> = {};
          let gteVal: string | null = null;
          let lteVal: string | null = null;

          const builder: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((col: string, val: any) => {
              eqFilters[col] = val;
              return builder;
            }),
            gte: vi.fn().mockImplementation((_col: string, val: string) => {
              gteVal = val;
              return builder;
            }),
            lte: vi.fn().mockImplementation((_col: string, val: string) => {
              lteVal = val;
              return builder;
            }),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockImplementation(async () => {
              await new Promise((resolve) => setTimeout(resolve, 5));

              if (!createdRow) {
                return { data: null, error: null };
              }

              // Post-M2 workout_date lookup
              if (eqFilters.workout_date === createdRow.workout_date) {
                return { data: { id: createdRow.id }, error: null };
              }

              // Date-window lookup: misses if date is not in the UTC day window
              if (gteVal && lteVal) {
                if (createdRow.date >= gteVal && createdRow.date <= lteVal) {
                  return { data: { id: createdRow.id }, error: null };
                }
                return { data: null, error: null };
              }

              return { data: null, error: null };
            }),
            insert: vi.fn().mockImplementation((rows: any[]) => ({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(async () => {
                  await new Promise((resolve) => setTimeout(resolve, 5));
                  if (!createdRow) {
                    createdRow = {
                      id: 'w-concurrent-single-id',
                      date: '2026-09-26T16:00:00.000Z', // Tokyo time
                      workout_date: rows[0]?.workout_date || '2026-09-27',
                    };
                    return { data: { id: createdRow.id }, error: null };
                  }
                  return {
                    data: null,
                    error: {
                      code: '23505',
                      message: 'duplicate key value violates unique constraint "workouts_user_id_workout_date_key"',
                    },
                  };
                }),
              }),
            })),
          };
          return builder;
        }),
      };

      const [id1, id2] = await Promise.all([
        getOrCreateWorkout(mockClient, 'user-1', '2026-09-27'),
        getOrCreateWorkout(mockClient, 'user-1', '2026-09-27'),
      ]);

      expect(id1).toBe('w-concurrent-single-id');
      expect(id2).toBe('w-concurrent-single-id');
      expect(id1).toBe(id2);
    });

    it('transient network error in findWorkoutSession falls back to resolveWorkoutRefForDate', async () => {
      const mockClient: any = {
        ['from']: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: new TypeError('Failed to fetch'),
          }),
        }),
      };

      const id = await getOrCreateWorkout(mockClient, 'user-1', '2026-09-27', 'Push Day');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('transient network error in insert falls back to resolveWorkoutRefForDate', async () => {
      const mockClient: any = {
        ['from']: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { status: 503, message: 'Service Unavailable' },
              }),
            }),
          }),
        }),
      };

      const id = await getOrCreateWorkout(mockClient, 'user-1', '2026-09-27', 'Leg Day');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('permanent error in insert throws as before', async () => {
      const mockClient: any = {
        ['from']: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '23503', message: 'foreign_key_violation: user does not exist' },
              }),
            }),
          }),
        }),
      };

      await expect(
        getOrCreateWorkout(mockClient, 'bad-user', '2026-09-27')
      ).rejects.toThrow(/foreign_key_violation/);
    });
  });

  describe('insertSet (resolves by exercise_id UUID, W35)', () => {
    it('offline -> exactly one set.create op with client id and zero supabase calls', async () => {
      const mockClient: any = { ['from']: vi.fn() };
      vi.mocked(enqueueAndAwait).mockResolvedValueOnce({
        status: 'queued',
        opId: 'op-create-1',
      });

      const res = await insertSet(mockClient, 'w-1', {
        exerciseId: 'ex-uuid-1',
        weight: 185,
        reps: 5,
        setIndex: 1,
      });

      expect(enqueueAndAwait).toHaveBeenCalledTimes(1);
      expect(enqueueAndAwait).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'set.create',
          payload: expect.objectContaining({
            workoutRef: 'w-1',
            exercise_id: 'ex-uuid-1',
            weight: 185,
            reps: 5,
          }),
        })
      );
      expect(mockClient['from']).not.toHaveBeenCalled();
      expect(res.pending).toBe(true);
      expect(res.id).toBeDefined();
    });

    it('online -> enqueueAndAwait called, synced result returned', async () => {
      const mockClient: any = { ['from']: vi.fn() };
      vi.mocked(enqueueAndAwait).mockResolvedValueOnce({
        status: 'synced',
        opId: 'op-create-2',
      });

      const res = await insertSet(mockClient, 'w-1', {
        exerciseId: 'ex-uuid-1',
        weight: 200,
        reps: 8,
      });

      expect(enqueueAndAwait).toHaveBeenCalledTimes(1);
      expect(res.pending).toBe(false);
      expect(res.weight).toBe(200);
      expect(res.reps).toBe(8);
      expect(mockClient['from']).not.toHaveBeenCalled();
    });

    it('online PERMANENT -> error surfaces as before', async () => {
      const mockClient: any = { ['from']: vi.fn() };
      vi.mocked(enqueueAndAwait).mockRejectedValueOnce(
        new Error('Referenced item no longer exists (e.g. exercise deleted)')
      );

      await expect(
        insertSet(mockClient, 'w-1', {
          exerciseId: 'ex-deleted',
          weight: 100,
          reps: 5,
        })
      ).rejects.toThrow(/Referenced item no longer exists/);
    });

    it('transient -> resolves as queued with pending', async () => {
      const mockClient: any = { ['from']: vi.fn() };
      vi.mocked(enqueueAndAwait).mockResolvedValueOnce({
        status: 'queued',
        opId: 'op-create-transient',
      });

      const res = await insertSet(mockClient, 'w-1', {
        exerciseId: 'ex-uuid-1',
        weight: 150,
        reps: 10,
      });

      expect(res.pending).toBe(true);
      expect(res.id).toBeDefined();
    });

    it('throws error if exerciseId is missing', async () => {
      const mockClient: any = { ['from']: vi.fn() };
      await expect(
        insertSet(mockClient, 'w-1', { exerciseId: '', weight: 100, reps: 5 })
      ).rejects.toThrow(/exerciseId UUID is required/);
    });
  });

  describe('batchInsertSets', () => {
    it('batch inserts sets routing as a single set.batchCreate through enqueueAndAwait', async () => {
      const mockClient: any = { ['from']: vi.fn() };
      vi.mocked(enqueueAndAwait).mockResolvedValueOnce({ status: 'synced', opId: 'op-batch-1' });

      const results = await batchInsertSets(mockClient, 'w-1', [
        { exerciseId: 'ex-1', weight: 100, reps: 10, setIndex: 1 },
        { exerciseId: 'ex-1', weight: 100, reps: 10, setIndex: 2 },
      ]);

      expect(results).toHaveLength(2);
      expect(enqueueAndAwait).toHaveBeenCalledTimes(1);
      expect(enqueueAndAwait).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'set.batchCreate',
          payload: expect.objectContaining({
            workoutRef: 'w-1',
            sets: expect.arrayContaining([
              expect.objectContaining({ exercise_id: 'ex-1', weight: 100, reps: 10, set_index: 1 }),
              expect.objectContaining({ exercise_id: 'ex-1', weight: 100, reps: 10, set_index: 2 }),
            ]),
          }),
        })
      );
      expect(mockClient['from']).not.toHaveBeenCalled();
    });
  });

  describe('updateSet and deleteSet', () => {
    it('online -> enqueueAndAwait called with set.update, synced result returned', async () => {
      const mockClient: any = { ['from']: vi.fn() };
      vi.mocked(enqueueAndAwait).mockResolvedValueOnce({
        status: 'synced',
        opId: 'op-update-1',
      });

      const res = await updateSet(mockClient, 's-1', { weight: 205, reps: 5 });
      expect(enqueueAndAwait).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'set.update',
          payload: expect.objectContaining({
            id: 's-1',
            patch: { weight: 205, reps: 5 },
          }),
        }),
        expect.anything()
      );
      expect(res.weight).toBe(205);
      expect(res.pending).toBe(false);
      expect(mockClient['from']).not.toHaveBeenCalled();
    });

    it('online PERMANENT -> error surfaces as before on update', async () => {
      const mockClient: any = { ['from']: vi.fn() };
      vi.mocked(enqueueAndAwait).mockRejectedValueOnce(
        new Error('changed elsewhere')
      );

      await expect(
        updateSet(mockClient, 's-1', { weight: 215 }, { weight: 200 })
      ).rejects.toThrow('changed elsewhere');
    });

    it('calls enqueueAndAwait with set.delete', async () => {
      const mockClient: any = { ['from']: vi.fn() };
      vi.mocked(enqueueAndAwait).mockResolvedValueOnce({
        status: 'synced',
        opId: 'op-delete-1',
      });

      await deleteSet(mockClient, 's-1');
      expect(enqueueAndAwait).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'set.delete',
          payload: { id: 's-1' },
        })
      );
      expect(mockClient['from']).not.toHaveBeenCalled();
    });
  });

  describe('resolveWorkoutRefForDate (d & e)', () => {
    const userId = '11111111-1111-4111-8111-111111111111';

    beforeEach(() => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      localStorage.clear();
    });

    it('(d) reuses the same workout ref for the same civil date across multiple calls', async () => {
      const ref1 = await resolveWorkoutRefForDate(userId, '2026-09-27', 'Push Day');
      const ref2 = await resolveWorkoutRefForDate(userId, '2026-09-27', 'Push Day');
      expect(ref1).toBe(ref2);
    });

    it('(e) preserves the active session date across midnight rollover', async () => {
      const sessionDate = '2026-09-27';
      const refPreMidnight = await resolveWorkoutRefForDate(userId, sessionDate, 'Night Workout');

      // Next set logged after midnight with sessionDate preserved
      const refPostMidnight = await resolveWorkoutRefForDate(userId, sessionDate, 'Night Workout');
      expect(refPostMidnight).toBe(refPreMidnight);

      // Starting a new distinct session on next date gets a distinct ref
      const refNextDay = await resolveWorkoutRefForDate(userId, '2026-09-28', 'Morning Workout');
      expect(refNextDay).not.toBe(refPreMidnight);
    });

    it('enqueues workout.ensure even when reusing stored client workout id from localStorage', async () => {
      const ref1 = await resolveWorkoutRefForDate(userId, '2026-09-27', 'Push Day');
      expect(enqueueAndAwait).toHaveBeenCalledTimes(1);

      const ref2 = await resolveWorkoutRefForDate(userId, '2026-09-27', 'Push Day');
      expect(ref2).toBe(ref1);
      // enqueueAndAwait must be called again so that workout.ensure is enqueued
      // ensuring server row existence even if prior session was deleted on server
      expect(enqueueAndAwait).toHaveBeenCalledTimes(2);
      expect(enqueueAndAwait).toHaveBeenLastCalledWith(
        expect.objectContaining({
          userId,
          kind: 'workout.ensure',
          payload: {
            clientWorkoutId: ref1,
            workout_date: '2026-09-27',
            name: 'Push Day',
          },
        })
      );
    });
  });
});
