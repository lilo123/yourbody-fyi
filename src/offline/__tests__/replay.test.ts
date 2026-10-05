import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeReplayOp } from '../replay';
import { getIdMapping, setIdMapping, clearIdMappingsForTesting } from '../idmap';
import { closeAllOfflineDbs, deleteOfflineDb } from '../db';
import type { OutboxOp } from '../types';

describe('Replay Executor & Idempotency (§A4, §D)', () => {
  const userId = 'user-replay-1';

  beforeEach(async () => {
    vi.clearAllMocks();
    clearIdMappingsForTesting();
    await closeAllOfflineDbs();
    await deleteOfflineDb(userId);
  });

  it('1. set.create is idempotent: upserts onConflict id ignoreDuplicates', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient: any = {
      ['from']: vi.fn().mockReturnValue({
        upsert: mockUpsert,
      }),
    };

    const op: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'set.create',
      payload: {
        id: 'set-uuid-1',
        workoutRef: 'workout-canonical-1',
        exercise_id: 'ex-1',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    // First replay execution
    await executeReplayOp(op, mockClient);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'set-uuid-1',
        workout_id: 'workout-canonical-1',
        weight: 100,
        reps: 10,
      }),
      { onConflict: 'id', ignoreDuplicates: true }
    );

    // Second replay execution (e.g. flushed twice or crash recovery)
    await executeReplayOp(op, mockClient);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  it('2. crash after server success before local delete is a no-op on re-run', async () => {
    let serverSetCreated = false;
    const mockClient: any = {
      ['from']: vi.fn().mockReturnValue({
        upsert: vi.fn().mockImplementation(() => {
          serverSetCreated = true;
          return Promise.resolve({ data: null, error: null });
        }),
      }),
    };

    const op: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'set.create',
      payload: {
        id: 'set-uuid-crash',
        workoutRef: 'workout-canonical-1',
        exercise_id: 'ex-1',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    // Simulate run 1: server receives write, but caller crashes before IDB deletion
    await executeReplayOp(op, mockClient);
    expect(serverSetCreated).toBe(true);

    // Simulate run 2 after reload: re-executing the same op against server
    await expect(executeReplayOp(op, mockClient)).resolves.not.toThrow();
  });

  it('3. workout.ensure remaps clientWorkoutId to canonical id when server already has workout for that date', async () => {
    const canonicalServerId = 'server-workout-uuid-456';
    const clientWorkoutId = 'client-gen-uuid-123';

    const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: canonicalServerId },
      error: null,
    });
    const mockEqWorkoutDate = vi.fn().mockReturnValue({ single: mockSingle });
    const mockEqUserId = vi.fn().mockReturnValue({ eq: mockEqWorkoutDate });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEqUserId });

    const mockClient: any = {
      ['from']: vi.fn().mockReturnValue({
        upsert: mockUpsert,
        select: mockSelect,
      }),
    };

    const op: OutboxOp = {
      opId: 'op-ensure',
      userId,
      seq: 1,
      kind: 'workout.ensure',
      payload: {
        clientWorkoutId,
        workout_date: '2026-09-30',
        name: 'Existing Routine',
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    const res = await executeReplayOp(op, mockClient);
    expect(res.canonicalId).toBe(canonicalServerId);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: clientWorkoutId,
        user_id: userId,
        date: '2026-09-30',
        workout_date: '2026-09-30',
      }),
      { onConflict: 'user_id,workout_date', ignoreDuplicates: true }
    );

    // Save mapping to idmap and verify
    await setIdMapping(userId, clientWorkoutId, res.canonicalId!);
    const mapped = await getIdMapping(userId, clientWorkoutId);
    expect(mapped).toBe(canonicalServerId);
  });

  it('4. set.update pre-image conflict: throws "deleted elsewhere" if row not found', async () => {
    const mockClient: any = {
      ['from']: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    };

    const op: OutboxOp = {
      opId: 'op-up',
      userId,
      seq: 1,
      kind: 'set.update',
      payload: {
        id: 'deleted-set-id',
        patch: { weight: 120 },
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    await expect(executeReplayOp(op, mockClient)).rejects.toThrow('deleted elsewhere');
  });

  it('5. set.update pre-image conflict: returns alreadyApplied if server row matches patch', async () => {
    const mockClient: any = {
      ['from']: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'set-1', weight: 120, reps: 10 },
              error: null,
            }),
          }),
        }),
      }),
    };

    const op: OutboxOp = {
      opId: 'op-up',
      userId,
      seq: 1,
      kind: 'set.update',
      payload: {
        id: 'set-1',
        patch: { weight: 120, reps: 10 },
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    const res = await executeReplayOp(op, mockClient);
    expect(res.alreadyApplied).toBe(true);
  });

  it('6. set.update pre-image conflict: throws "changed elsewhere" if server row differs from expected', async () => {
    const mockClient: any = {
      ['from']: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'set-1', weight: 115, reps: 8 }, // Modified by someone else
              error: null,
            }),
          }),
        }),
      }),
    };

    const op: OutboxOp = {
      opId: 'op-up',
      userId,
      seq: 1,
      kind: 'set.update',
      payload: {
        id: 'set-1',
        patch: { weight: 120 },
        expected: { weight: 100, reps: 10 }, // Pre-image expected
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    await expect(executeReplayOp(op, mockClient)).rejects.toThrow('changed elsewhere');
  });

  it('7. set.update succeeds when expected matches server row', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const mockClient: any = {
      ['from']: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'set-1', weight: 100, reps: 10 },
              error: null,
            }),
          }),
        }),
        update: mockUpdate,
      }),
    };

    const op: OutboxOp = {
      opId: 'op-up',
      userId,
      seq: 1,
      kind: 'set.update',
      payload: {
        id: 'set-1',
        patch: { weight: 105 },
        expected: { weight: 100, reps: 10 },
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    await expect(executeReplayOp(op, mockClient)).resolves.not.toThrow();
    expect(mockUpdate).toHaveBeenCalledWith({ weight: 105 });
  });

  it('8. set.delete is idempotent: deletes by id', async () => {
    const mockDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const mockClient: any = {
      ['from']: vi.fn().mockReturnValue({
        delete: mockDelete,
      }),
    };

    const op: OutboxOp = {
      opId: 'op-del',
      userId,
      seq: 1,
      kind: 'set.delete',
      payload: { id: 'set-del-1' },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    await executeReplayOp(op, mockClient);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('9. set.batchCreate: single op for N sets, replay once = one upsert call with N rows, idempotent replay, and remap', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient: any = {
      ['from']: vi.fn().mockReturnValue({
        upsert: mockUpsert,
      }),
    };

    // Pre-seed an ID mapping for client workout ref -> canonical id
    await setIdMapping(userId, 'client-workout-ref-1', 'canonical-workout-uuid-1');

    const op: OutboxOp = {
      opId: 'op-batch-1',
      userId,
      seq: 1,
      kind: 'set.batchCreate',
      payload: {
        workoutRef: 'client-workout-ref-1',
        sets: [
          {
            id: 'set-uuid-1',
            exercise_id: 'ex-1',
            weight: 205,
            reps: 8,
            set_index: 1,
            set_type: 'working',
            created_at: '2026-09-30T10:00:00Z',
          },
          {
            id: 'set-uuid-2',
            exercise_id: 'ex-2',
            weight: 155,
            reps: 10,
            set_index: 2,
            set_type: 'working',
            created_at: '2026-09-30T10:00:01Z',
          },
        ],
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    // First replay execution: exactly 1 upsert call with array of 2 rows, remapped workout_id
    await executeReplayOp(op, mockClient);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'set-uuid-1',
          workout_id: 'canonical-workout-uuid-1',
          exercise_id: 'ex-1',
          weight: 205,
          reps: 8,
          set_index: 1,
        }),
        expect.objectContaining({
          id: 'set-uuid-2',
          workout_id: 'canonical-workout-uuid-1',
          exercise_id: 'ex-2',
          weight: 155,
          reps: 10,
          set_index: 2,
        }),
      ],
      { onConflict: 'id', ignoreDuplicates: true }
    );

    // Second replay execution (crash-after-success replay / retry): idempotent, no throw
    await expect(executeReplayOp(op, mockClient)).resolves.not.toThrow();
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  // Contract verified against supabaseBuilderMock conventions
  describe('nutrition.log Replay & Idempotency (§N1, §E2)', () => {
    it('1st replay inserts row and increments custom_dishes.use_count when 1 row returned', async () => {
      let capturedTable: string | null = null;
      const mockSelect = vi.fn().mockResolvedValue({ data: [{ id: 'nl-uuid-1' }], error: null });
      const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect });

      const mockDishSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { use_count: 5 }, error: null }),
        }),
      });

      const mockDishUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const mockDishUpdate = vi.fn().mockReturnValue({
        eq: mockDishUpdateEq,
      });

      const mockClient: any = {
        from: vi.fn().mockImplementation((table: string) => {
          capturedTable = table;
          if (table === 'nutrition_logs') {
            return { upsert: mockUpsert };
          }
          if (table === 'custom_dishes') {
            return {
              select: mockDishSelect,
              update: mockDishUpdate,
            };
          }
          return {};
        }),
      };

      const op: OutboxOp = {
        opId: 'op-nl-1',
        userId,
        seq: 1,
        kind: 'nutrition.log',
        payload: {
          id: 'nl-uuid-1',
          user_id: userId,
          food_name: 'Chicken Rice',
          calories: 550,
          protein: 45,
          carbs: 60,
          fat: 10,
          fiber: 4,
          meal_type: 'Lunch',
          serving_size: 1,
          serving_unit: 'serving',
          logged_at: '2026-10-01T12:00:00+00:00',
          logged_date: '2026-10-01',
          items: null,
          incrementDishId: 'dish-uuid-1',
        },
        createdAt: '2026-10-01T12:00:00Z',
        attempts: 0,
        state: 'pending',
      };

      const result = await executeReplayOp(op, mockClient);

      expect(result.canonicalId).toBe('nl-uuid-1');
      expect(result.alreadyApplied).toBeUndefined();

      // Verify nutrition_logs upsert
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'nl-uuid-1',
          user_id: userId,
          food_name: 'Chicken Rice',
          calories: 550,
        }),
        { onConflict: 'id', ignoreDuplicates: true }
      );
      expect(mockSelect).toHaveBeenCalledWith('id');

      // Verify custom_dishes use_count increment
      expect(mockDishSelect).toHaveBeenCalledWith('use_count');
      expect(mockDishUpdate).toHaveBeenCalledWith({ use_count: 6 });
      expect(mockDishUpdateEq).toHaveBeenCalledWith('id', 'dish-uuid-1');
      expect(mockClient.from).toHaveBeenCalledWith('nutrition_logs');
      expect(mockClient.from).toHaveBeenCalledWith('custom_dishes');
      expect(capturedTable).toBe('custom_dishes');
    });

    it('2nd replay (0 rows returned = already applied) succeeds and does NOT increment use_count', async () => {
      let capturedTable: string | null = null;
      // PostgREST returns empty array on ON CONFLICT DO NOTHING when selecting 'id'
      const mockSelect = vi.fn().mockResolvedValue({ data: [], error: null });
      const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect });

      const mockDishSelect = vi.fn();
      const mockDishUpdate = vi.fn();

      const mockClient: any = {
        from: vi.fn().mockImplementation((table: string) => {
          capturedTable = table;
          if (table === 'nutrition_logs') {
            return { upsert: mockUpsert };
          }
          if (table === 'custom_dishes') {
            return {
              select: mockDishSelect,
              update: mockDishUpdate,
            };
          }
          return {};
        }),
      };

      const op: OutboxOp = {
        opId: 'op-nl-2',
        userId,
        seq: 2,
        kind: 'nutrition.log',
        payload: {
          id: 'nl-uuid-1',
          user_id: userId,
          food_name: 'Chicken Rice',
          calories: 550,
          protein: 45,
          carbs: 60,
          fat: 10,
          fiber: 4,
          meal_type: 'Lunch',
          serving_size: 1,
          serving_unit: 'serving',
          logged_at: '2026-10-01T12:00:00+00:00',
          logged_date: '2026-10-01',
          items: null,
          incrementDishId: 'dish-uuid-1',
        },
        createdAt: '2026-10-01T12:00:00Z',
        attempts: 1,
        state: 'pending',
      };

      const result = await executeReplayOp(op, mockClient);

      expect(result.alreadyApplied).toBe(true);
      expect(result.canonicalId).toBe('nl-uuid-1');
      expect(mockClient.from).toHaveBeenCalledWith('nutrition_logs');
      expect(mockSelect).toHaveBeenCalledWith('id');
      expect(capturedTable).toBe('nutrition_logs');

      // custom_dishes must NOT be queried or updated on 2nd replay
      expect(mockDishSelect).not.toHaveBeenCalled();
      expect(mockDishUpdate).not.toHaveBeenCalled();
    });

    it('throws errors from nutrition_logs upsert so classify can catch them', async () => {
      const mockClient: any = {
        from: vi.fn().mockReturnValue({
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '23514', message: 'chk_nl_parent_equals_items_sum' },
            }),
          }),
        }),
      };

      const op: OutboxOp = {
        opId: 'op-nl-err',
        userId,
        seq: 3,
        kind: 'nutrition.log',
        payload: {
          id: 'nl-err-1',
          user_id: userId,
          food_name: 'Invalid Meal',
          calories: 999,
          logged_at: '2026-10-01T12:00:00Z',
          logged_date: '2026-10-01',
        },
        createdAt: '2026-10-01T12:00:00Z',
        attempts: 0,
        state: 'pending',
      };

      await expect(executeReplayOp(op, mockClient)).rejects.toMatchObject({
        code: '23514',
      });
    });

    it('nutrition.log: insert ok + use_count update error -> op succeeds, warn called, no throw', async () => {
      let capturedTable: string | null = null;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mockSelect = vi.fn().mockResolvedValue({ data: [{ id: 'nl-uuid-warn' }], error: null });
      const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect });

      const mockDishUpdateEq = vi.fn().mockResolvedValue({
        data: null,
        error: new Error('Simulated custom_dishes update failure'),
      });
      const mockDishUpdate = vi.fn().mockReturnValue({ eq: mockDishUpdateEq });
      const mockDishSelectEq = vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { use_count: 3 }, error: null }),
      });
      const mockDishSelect = vi.fn().mockReturnValue({ eq: mockDishSelectEq });

      const mockClient: any = {
        from: vi.fn().mockImplementation((table: string) => {
          capturedTable = table;
          if (table === 'nutrition_logs') {
            return { upsert: mockUpsert };
          }
          if (table === 'custom_dishes') {
            return {
              select: mockDishSelect,
              update: mockDishUpdate,
            };
          }
          return {};
        }),
      };

      const op: OutboxOp = {
        opId: 'op-nl-warn',
        userId,
        seq: 4,
        kind: 'nutrition.log',
        payload: {
          id: 'nl-uuid-warn',
          user_id: userId,
          food_name: 'Protein Shake',
          calories: 250,
          logged_at: '2026-10-01T12:00:00Z',
          logged_date: '2026-10-01',
          incrementDishId: 'dish-uuid-fail',
        },
        createdAt: '2026-10-01T12:00:00Z',
        attempts: 0,
        state: 'pending',
      };

      // Must NOT throw
      const result = await executeReplayOp(op, mockClient);
      expect(result.canonicalId).toBe('nl-uuid-warn');
      expect(mockClient.from).toHaveBeenCalledWith('nutrition_logs');
      expect(mockClient.from).toHaveBeenCalledWith('custom_dishes');
      expect(mockSelect).toHaveBeenCalledWith('id');
      expect(mockDishSelect).toHaveBeenCalledWith('use_count');
      expect(capturedTable).toBe('custom_dishes');

      // Must have called console.warn with context
      expect(warnSpy).toHaveBeenCalled();
      const warnCall = warnSpy.mock.calls[0];
      expect(warnCall[0]).toContain('[replay]');
      expect(warnCall[0]).toContain('dish-uuid-fail');

      warnSpy.mockRestore();
    });
  });
});
