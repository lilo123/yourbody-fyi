import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  flushNow,
  enqueueAndAwait,
  onSynced,
  setFlusherSessionUser,
  setFlusherSupabaseClient,
} from '../flusher';
import { enqueue, getOutboxOps, getAuthRequiredStatus, setAuthRequiredStatus, getLastSyncedCount } from '../outbox';
import { closeAllOfflineDbs, deleteOfflineDb } from '../db';
import { supabase } from '../../lib/supabase';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
    },
    ['from']: vi.fn(),
  },
}));

describe('Flusher & EnqueueAndAwait (§A4, §D)', () => {
  const userA = 'user-flusher-a';
  const userB = 'user-flusher-b';
  const originalOnLine = navigator.onLine;

  beforeEach(async () => {
    vi.clearAllMocks();
    setFlusherSupabaseClient(supabase);
    setFlusherSessionUser(userA);
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: true,
    });

    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: {
          user: { id: userA },
        },
      },
    });

    ((supabase as any)['from']).mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'canonical-w-1' }, error: null }),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    });

    await closeAllOfflineDbs();
    await deleteOfflineDb(userA);
    await deleteOfflineDb(userB);
  });

  afterEach(async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: originalOnLine,
    });
    await closeAllOfflineDbs();
    await deleteOfflineDb(userA);
    await deleteOfflineDb(userB);
  });

  it('1. outbox owner check: flush does NOT execute if current session user does not match outbox user id', async () => {
    // Enqueue an op for userB
    await enqueue({
      userId: userB,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-b', workout_date: '2026-09-30' },
    });

    // Session is userA
    setFlusherSessionUser(userA);
    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: { user: { id: userA } },
      },
    });

    // Try flushing userB's outbox while signed in as userA
    const syncedCount = await flushNow(userB);
    expect(syncedCount).toBe(0);

    // Op in userB's outbox must still be intact and pending
    const opsB = await getOutboxOps(userB);
    expect(opsB).toHaveLength(1);
    expect(opsB[0].state).toBe('pending');
  });

  it('2. two concurrent flushers execute sequentially without duplicate replay', async () => {
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
    });

    let upsertCount = 0;
    ((supabase as any)['from']).mockReturnValue({
      upsert: vi.fn().mockImplementation(() => {
        upsertCount++;
        return Promise.resolve({ data: null, error: null });
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'canonical-w-1' }, error: null }),
          }),
        }),
      }),
    });

    // Run two flushers concurrently
    const [res1, res2] = await Promise.all([flushNow(userA), flushNow(userA)]);

    // Exactly one flusher synchronizes the single item; total items synced is 1
    expect(res1 + res2).toBe(1);
    expect(upsertCount).toBe(1);

    const remainingOps = await getOutboxOps(userA);
    expect(remainingOps).toHaveLength(0);
  });

  it('3. enqueueAndAwait: online success resolves with status "synced"', async () => {
    const result = await enqueueAndAwait({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
    });

    expect(result.status).toBe('synced');
    expect(result.opId).toBeDefined();

    // Verify op was deleted after sync
    const ops = await getOutboxOps(userA);
    expect(ops).toHaveLength(0);
  });

  it('4. enqueueAndAwait: offline returns { status: "queued" } immediately without error', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: false });

    const result = await enqueueAndAwait({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-offline', workout_date: '2026-09-30' },
    });

    expect(result.status).toBe('queued');

    // Op stays pending in outbox
    const ops = await getOutboxOps(userA);
    expect(ops).toHaveLength(1);
    expect(ops[0].state).toBe('pending');
  });

  it('5. enqueueAndAwait: online permanent error removes op and rethrows original error', async () => {
    ((supabase as any)['from']).mockReturnValue({
      upsert: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: '23503',
          message: 'Foreign key constraint violated (exercise deleted)',
        },
      }),
    });

    await expect(
      enqueueAndAwait({
        userId: userA,
        kind: 'workout.ensure',
        payload: { clientWorkoutId: 'w-fail', workout_date: '2026-09-30' },
      })
    ).rejects.toThrow();

    // Op was removed from outbox so it behaves like online mutation failure
    const ops = await getOutboxOps(userA);
    expect(ops).toHaveLength(0);
  });

  it('6. onSynced listener emits count of ops applied after being queued', async () => {
    // Put op into outbox while offline
    Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: false });
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-queued', workout_date: '2026-09-30' },
    });

    // Reconnect
    Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: true });

    let emittedCount = 0;
    const unsub = onSynced((count) => {
      emittedCount = count;
    });

    await flushNow(userA);

    expect(emittedCount).toBe(1);
    unsub();
  });

  it('7. outbox owner check: flush does NOT execute if supabase.auth.getSession() user does not match outbox user even if flusherSessionUserId matches', async () => {
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-a', workout_date: '2026-09-30' },
    });

    setFlusherSessionUser(userA);
    // But Supabase session has switched to userB!
    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: { user: { id: userB } },
      },
    });

    const syncedCount = await flushNow(userA);
    expect(syncedCount).toBe(0);

    const opsA = await getOutboxOps(userA);
    expect(opsA).toHaveLength(1);
    expect(opsA[0].state).toBe('pending');
  });

  it('8. flusher clears authRequiredStatus after successful standard replay op (D-YB2-2)', async () => {
    setAuthRequiredStatus(true);
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-recovery', workout_date: '2026-09-30' },
    });

    const synced = await flushNow(userA);
    expect(synced).toBe(1);
    expect(getAuthRequiredStatus()).toBe(false);
  });

  it('9. flusher clears authRequiredStatus after successful refresh and retry replay (D-YB2-2)', async () => {
    setAuthRequiredStatus(true);
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-refresh-recovery', workout_date: '2026-09-30' },
    });

    let attempt = 0;
    ((supabase as any)['from']).mockReturnValue({
      upsert: vi.fn().mockImplementation(() => {
        attempt++;
        if (attempt === 1) {
          return Promise.reject({ status: 401, message: 'JWT expired' });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'canonical-w-refresh' }, error: null }),
          }),
        }),
      }),
    });

    (supabase.auth.refreshSession as any).mockResolvedValue({ error: null });

    const synced = await flushNow(userA);
    expect(synced).toBe(1);
    expect(getAuthRequiredStatus()).toBe(false);
  });

  it('10. flusher sets authRequiredStatus on invalid refresh token during replay (D-YB2-2)', async () => {
    setAuthRequiredStatus(false);
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-invalid-ref', workout_date: '2026-09-30' },
    });

    ((supabase as any)['from']).mockReturnValue({
      upsert: vi.fn().mockRejectedValue({ status: 401, message: 'JWT expired' }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'canonical-w-ref' }, error: null }),
          }),
        }),
      }),
    });

    (supabase.auth.refreshSession as any).mockResolvedValue({
      error: { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' },
    });

    const synced = await flushNow(userA);
    expect(synced).toBe(0);
    expect(getAuthRequiredStatus()).toBe(true);
  });

  it('11. flusher skips dependent ops in the same flush run when parent fails permanently', async () => {
    // Seed parent op: workout.ensure
    const parentOp = await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-fail', workout_date: '2026-09-30' },
    });

    // Seed dependent op: set.create referencing w-fail
    await enqueue({
      userId: userA,
      kind: 'set.create',
      payload: {
        id: 's-dep-1',
        workoutRef: 'w-fail',
        exercise_id: 'ex-1',
        set_index: 1,
        reps: 10,
        weight: 100,
      } as any,
    });

    // Seed independent op: workout.ensure for a different workout
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-success', workout_date: '2026-10-01' },
    });

    let setReplayed = false;
    ((supabase as any)['from']).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return {
          upsert: vi.fn().mockImplementation((payload: any) => {
            if (payload?.id === 'w-fail') {
              return Promise.resolve({
                data: null,
                error: {
                  code: '42501',
                  message: 'Permission denied (RLS policy violation)',
                },
              });
            }
            return Promise.resolve({ data: null, error: null });
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'canonical-w-success' }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'sets') {
        return {
          upsert: vi.fn().mockImplementation(() => {
            setReplayed = true;
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }
      return {};
    });

    const synced = await flushNow(userA);

    // w-success synced, but w-fail failed and s-dep-1 was skipped
    expect(synced).toBe(1);
    expect(setReplayed).toBe(false);

    const opsAfter = await getOutboxOps(userA);
    const parentAfter = opsAfter.find((o) => (o.payload as any)?.clientWorkoutId === 'w-fail');
    const dependentAfter = opsAfter.find((o) => o.kind === 'set.create');
    const independentAfter = opsAfter.find((o) => (o.payload as any)?.clientWorkoutId === 'w-success');

    expect(parentAfter?.state).toBe('attention');
    expect(dependentAfter?.state).toBe('attention');
    expect(dependentAfter?.blockedBy).toBe(parentOp.opId);
    expect(independentAfter).toBeUndefined(); // Completed and deleted
  });

  it('12. mid-flush user switch: flush aborts if session user changes after op 1, leaving op 2 pending for user A', async () => {
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
    });
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-2', workout_date: '2026-10-01' },
    });

    let op1Executed = false;
    let op2Executed = false;

    ((supabase as any)['from']).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return {
          upsert: vi.fn().mockImplementation((payload: any) => {
            if (payload?.id === 'w-1') {
              op1Executed = true;
              // User switches to userB (or null) mid-flush after op 1
              (supabase.auth.getSession as any).mockResolvedValue({
                data: { session: { user: { id: userB } } },
              });
              setFlusherSessionUser(userB);
              return Promise.resolve({ data: null, error: null });
            }
            if (payload?.id === 'w-2') {
              op2Executed = true;
              return Promise.resolve({
                data: null,
                error: { code: '42501', message: 'Permission denied (RLS policy violation)' },
              });
            }
            return Promise.resolve({ data: null, error: null });
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'canonical-w-1' }, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const synced = await flushNow(userA);

    expect(synced).toBe(1);
    expect(op1Executed).toBe(true);
    expect(op2Executed).toBe(false);

    const opsA = await getOutboxOps(userA);
    expect(opsA).toHaveLength(1);
    expect(opsA[0].state).toBe('pending');
    expect(opsA[0].error).toBeUndefined();
  });

  it('13. 42501 RLS error during mid-flight session switch is treated as retryable (pending) when op.userId != current session user', async () => {
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-inflight-switch', workout_date: '2026-09-30' },
    });

    ((supabase as any)['from']).mockReturnValue({
      upsert: vi.fn().mockImplementation(() => {
        // While the replay request is in flight, session switches to userB
        (supabase.auth.getSession as any).mockResolvedValue({
          data: { session: { user: { id: userB } } },
        });
        setFlusherSessionUser(userB);
        return Promise.resolve({
          data: null,
          error: { code: '42501', message: 'Permission denied (RLS policy violation)' },
        });
      }),
    });

    const synced = await flushNow(userA);

    expect(synced).toBe(0);

    const opsA = await getOutboxOps(userA);
    expect(opsA).toHaveLength(1);
    expect(opsA[0].state).toBe('pending');
    expect(opsA[0].error).toBeUndefined();
  });

  it('14. 42501 RLS error during mid-flight sign out (session becomes null) is treated as retryable (pending)', async () => {
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-inflight-signout', workout_date: '2026-09-30' },
    });

    ((supabase as any)['from']).mockReturnValue({
      upsert: vi.fn().mockImplementation(() => {
        // While the replay request is in flight, user signs out (session becomes null)
        (supabase.auth.getSession as any).mockResolvedValue({
          data: { session: null },
        });
        setFlusherSessionUser(null);
        return Promise.resolve({
          data: null,
          error: { code: '42501', message: 'Permission denied (RLS policy violation)' },
        });
      }),
    });

    const synced = await flushNow(userA);

    expect(synced).toBe(0);

    const opsA = await getOutboxOps(userA);
    expect(opsA).toHaveLength(1);
    expect(opsA[0].state).toBe('pending');
    expect(opsA[0].error).toBeUndefined();
  });

  it('15. mid-flush sign-out without setFlusherSessionUser(null): flush aborts when getSession returns null after op 1, leaving op 2 pending', async () => {
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
    });
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-2', workout_date: '2026-10-01' },
    });

    let op1Executed = false;
    let op2Executed = false;

    ((supabase as any)['from']).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return {
          upsert: vi.fn().mockImplementation((payload: any) => {
            if (payload?.id === 'w-1') {
              op1Executed = true;
              // User signs out mid-flush after op 1 (session becomes null),
              // but setFlusherSessionUser(null) has NOT been called yet
              (supabase.auth.getSession as any).mockResolvedValue({
                data: { session: null },
              });
              return Promise.resolve({ data: null, error: null });
            }
            if (payload?.id === 'w-2') {
              op2Executed = true;
              return Promise.resolve({
                data: null,
                error: { code: '42501', message: 'Permission denied (RLS policy violation)' },
              });
            }
            return Promise.resolve({ data: null, error: null });
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'canonical-w-1' }, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const synced = await flushNow(userA);

    expect(synced).toBe(1);
    expect(op1Executed).toBe(true);
    expect(op2Executed).toBe(false);

    const opsA = await getOutboxOps(userA);
    expect(opsA).toHaveLength(1);
    expect(opsA[0].state).toBe('pending');
    expect(opsA[0].error).toBeUndefined();
  });

  it('16. getCurrentSessionUserId falls back to cached flusherSessionUserId only when getSession throws', async () => {
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-throw', workout_date: '2026-09-30' },
    });

    setFlusherSessionUser(userA);
    (supabase.auth.getSession as any).mockRejectedValue(new Error('Network/storage failure'));

    const synced = await flushNow(userA);
    expect(synced).toBe(1);

    const opsA = await getOutboxOps(userA);
    expect(opsA).toHaveLength(0);
  });

  describe('Multi-tab Sync Broadcast (B.1, B.3)', () => {
    it('synced broadcast from another tab for the same user emits once and updates last synced count', async () => {
      setFlusherSessionUser(userA);
      const emittedCounts: number[] = [];
      const unsub = onSynced((count) => {
        emittedCounts.push(count);
      });

      try {
        const peerChannel = new BroadcastChannel('yourbody_outbox_channel');
        peerChannel.postMessage({ type: 'synced', userId: userA, count: 3 });

        await new Promise((resolve) => setTimeout(resolve, 50));
        peerChannel.close();

        expect(emittedCounts).toEqual([3]);
        expect(getLastSyncedCount()).toBe(3);
      } finally {
        unsub();
      }
    });

    it('different user broadcast is ignored', async () => {
      setFlusherSessionUser(userA);
      const emittedCounts: number[] = [];
      const unsub = onSynced((count) => {
        emittedCounts.push(count);
      });

      try {
        const peerChannel = new BroadcastChannel('yourbody_outbox_channel');
        peerChannel.postMessage({ type: 'synced', userId: userB, count: 4 });

        await new Promise((resolve) => setTimeout(resolve, 50));
        peerChannel.close();

        expect(emittedCounts).toEqual([]);
      } finally {
        unsub();
      }
    });

    it('count <= 0 broadcast is ignored', async () => {
      setFlusherSessionUser(userA);
      const emittedCounts: number[] = [];
      const unsub = onSynced((count) => {
        emittedCounts.push(count);
      });

      try {
        const peerChannel = new BroadcastChannel('yourbody_outbox_channel');
        peerChannel.postMessage({ type: 'synced', userId: userA, count: 0 });
        peerChannel.postMessage({ type: 'synced', userId: userA, count: -2 });

        await new Promise((resolve) => setTimeout(resolve, 50));
        peerChannel.close();

        expect(emittedCounts).toEqual([]);
      } finally {
        unsub();
      }
    });
  });
});
