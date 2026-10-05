import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enqueue,
  getOutboxOps,
  getOutboxSummary,
  blockDependentOps,
  retryOp,
  discardOp,
  updateOp,
  deleteOp,
  subscribeToOutbox,
  notifyOutboxChanged,
  getCachedOpsForUser,
  getCachedOutboxSummary,
  resetOutboxForTesting,
} from '../outbox';
import * as dbModule from '../db';
import { closeAllOfflineDbs, deleteOfflineDb } from '../db';

describe('Outbox Storage, Ordering & Dependent Blocking (§A4, §D)', () => {
  const userA = 'user-test-a';
  const userB = 'user-test-b';

  beforeEach(async () => {
    await closeAllOfflineDbs();
    await deleteOfflineDb(userA);
    await deleteOfflineDb(userB);
  });

  afterEach(async () => {
    await closeAllOfflineDbs();
    await deleteOfflineDb(userA);
    await deleteOfflineDb(userB);
  });

  it('1. monotonic seq ordering across multiple enqueues', async () => {
    const op1 = await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: {
        clientWorkoutId: 'w-1',
        workout_date: '2026-09-30',
        name: 'Session 1',
      },
    });

    const op2 = await enqueue({
      userId: userA,
      kind: 'set.create',
      payload: {
        id: 's-1',
        workoutRef: 'w-1',
        exercise_id: 'ex-1',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
    });

    const op3 = await enqueue({
      userId: userA,
      kind: 'set.create',
      payload: {
        id: 's-2',
        workoutRef: 'w-1',
        exercise_id: 'ex-1',
        weight: 105,
        reps: 8,
        set_index: 2,
        set_type: 'working',
        created_at: '2026-09-30T10:02:00Z',
      },
    });

    expect(op1.seq).toBe(1);
    expect(op2.seq).toBe(2);
    expect(op3.seq).toBe(3);

    const ops = await getOutboxOps(userA);
    expect(ops.map((o) => o.seq)).toEqual([1, 2, 3]);
  });

  it('2. persistence across module re-instantiation / DB reconnection', async () => {
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
    });
    await enqueue({
      userId: userA,
      kind: 'set.create',
      payload: {
        id: 's-1',
        workoutRef: 'w-1',
        exercise_id: 'ex-1',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
    });

    // Close all connections to simulate app reload / module re-instantiation
    await closeAllOfflineDbs();

    // Reconnect and fetch ops
    const opsAfterReload = await getOutboxOps(userA);
    expect(opsAfterReload).toHaveLength(2);
    expect(opsAfterReload[0].kind).toBe('workout.ensure');
    expect(opsAfterReload[1].kind).toBe('set.create');
    expect(opsAfterReload[0].seq).toBe(1);
    expect(opsAfterReload[1].seq).toBe(2);

    // Enqueue a 3rd op after reload: seq should continue monotonically
    const op3 = await enqueue({
      userId: userA,
      kind: 'set.create',
      payload: {
        id: 's-2',
        workoutRef: 'w-1',
        exercise_id: 'ex-1',
        weight: 110,
        reps: 6,
        set_index: 2,
        set_type: 'working',
        created_at: '2026-09-30T10:05:00Z',
      },
    });

    expect(op3.seq).toBe(3);
  });

  it('3. per-user isolation: User A and User B never cross-contaminate', async () => {
    await enqueue({
      userId: userA,
      kind: 'set.create',
      payload: {
        id: 's-user-a',
        workoutRef: 'w-a',
        exercise_id: 'ex-1',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
    });

    await enqueue({
      userId: userB,
      kind: 'set.create',
      payload: {
        id: 's-user-b',
        workoutRef: 'w-b',
        exercise_id: 'ex-2',
        weight: 200,
        reps: 5,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
    });

    const opsA = await getOutboxOps(userA);
    const opsB = await getOutboxOps(userB);

    expect(opsA).toHaveLength(1);
    expect((opsA[0].payload as any).id).toBe('s-user-a');

    expect(opsB).toHaveLength(1);
    expect((opsB[0].payload as any).id).toBe('s-user-b');

    const summaryA = await getOutboxSummary(userA);
    const summaryB = await getOutboxSummary(userB);
    expect(summaryA.pending).toBe(1);
    expect(summaryB.pending).toBe(1);
  });

  it('4. dependent blocking: failed ensure blocks dependent sets, independent ops continue', async () => {
    // 1. Ensure workout 1
    const ensure1 = await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
    });

    // 2. Set for workout 1
    const set1 = await enqueue({
      userId: userA,
      kind: 'set.create',
      payload: {
        id: 's-1',
        workoutRef: 'w-1',
        exercise_id: 'ex-1',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
    });

    // 3. Independent ensure workout 2
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-2', workout_date: '2026-10-01' },
    });

    // 4. Independent set for workout 2
    const set2 = await enqueue({
      userId: userA,
      kind: 'set.create',
      payload: {
        id: 's-2',
        workoutRef: 'w-2',
        exercise_id: 'ex-1',
        weight: 150,
        reps: 5,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-10-01T10:00:00Z',
      },
    });

    // 5. Update to set1 (transitive dependency on workout 1)
    const set1Update = await enqueue({
      userId: userA,
      kind: 'set.update',
      payload: {
        id: 's-1',
        patch: { weight: 110 },
      },
    });

    // Mark ensure1 as failed with PERMANENT error
    ensure1.state = 'attention';
    ensure1.error = 'Permission denied (RLS policy violation)';
    await updateOp(userA, ensure1);

    // Apply dependent blocking
    await blockDependentOps(userA, ensure1);

    const ops = await getOutboxOps(userA);
    const opMap = new Map(ops.map((o) => [o.opId, o]));

    // ensure1 is in attention
    expect(opMap.get(ensure1.opId)?.state).toBe('attention');

    // set1 depended on w-1 -> blocked by ensure1!
    const updatedSet1 = opMap.get(set1.opId);
    expect(updatedSet1?.state).toBe('attention');
    expect(updatedSet1?.blockedBy).toBe(ensure1.opId);
    expect(updatedSet1?.error).toContain(`blocked by ${ensure1.opId}`);

    // set1Update transitively depended on s-1 -> also blocked by ensure1!
    const updatedSet1Update = opMap.get(set1Update.opId);
    expect(updatedSet1Update?.state).toBe('attention');
    expect(updatedSet1Update?.blockedBy).toBe(ensure1.opId);
    expect(updatedSet1Update?.error).toContain(`blocked by ${ensure1.opId}`);

    // set2 for w-2 is independent -> remains pending!
    const updatedSet2 = opMap.get(set2.opId);
    expect(updatedSet2?.state).toBe('pending');
    expect(updatedSet2?.blockedBy).toBeUndefined();
  });

  it('5. retryOp unblocks dependent operations', async () => {
    const ensure1 = await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
    });

    const set1 = await enqueue({
      userId: userA,
      kind: 'set.create',
      payload: {
        id: 's-1',
        workoutRef: 'w-1',
        exercise_id: 'ex-1',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
    });

    ensure1.state = 'attention';
    ensure1.error = 'Failed';
    await updateOp(userA, ensure1);
    await blockDependentOps(userA, ensure1);

    // Retrying ensure1 unblocks set1 as well
    await retryOp(ensure1.opId, userA);

    const ops = await getOutboxOps(userA);
    const opMap = new Map(ops.map((o) => [o.opId, o]));

    expect(opMap.get(ensure1.opId)?.state).toBe('pending');
    expect(opMap.get(set1.opId)?.state).toBe('pending');
    expect(opMap.get(set1.opId)?.blockedBy).toBeUndefined();
  });

  it('6. discardOp removes op from outbox and unblocks dependents', async () => {
    const ensure1 = await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
    });

    const set1 = await enqueue({
      userId: userA,
      kind: 'set.create',
      payload: {
        id: 's-1',
        workoutRef: 'w-1',
        exercise_id: 'ex-1',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
    });

    ensure1.state = 'attention';
    ensure1.error = 'Failed';
    await updateOp(userA, ensure1);
    await blockDependentOps(userA, ensure1);

    // Discard ensure1
    await discardOp(ensure1.opId, userA);

    const ops = await getOutboxOps(userA);
    expect(ops.find((o) => o.opId === ensure1.opId)).toBeUndefined();

    // set1 is unblocked
    const setOp = ops.find((o) => o.opId === set1.opId);
    expect(setOp?.state).toBe('pending');
    expect(setOp?.blockedBy).toBeUndefined();
  });

  it('7. enqueue immediately updates in-memory cache and notifies subscribers synchronously', async () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribeToOutbox(subscriber);

    expect(getCachedOpsForUser(userA)).toHaveLength(0);
    expect(getCachedOutboxSummary(userA).pending).toBe(0);

    const op = await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
    });

    expect(subscriber).toHaveBeenCalled();
    const cachedOps = getCachedOpsForUser(userA);
    expect(cachedOps).toHaveLength(1);
    expect(cachedOps[0].opId).toBe(op.opId);

    const cachedSummary = getCachedOutboxSummary(userA);
    expect(cachedSummary.pending).toBe(1);

    unsubscribe();
  });

  it('8. getOutboxOps notifies subscribers when cache was empty (e.g. on reload)', async () => {
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
    });

    // Simulate page reload by resetting in-memory caches
    resetOutboxForTesting();
    expect(getCachedOpsForUser(userA)).toHaveLength(0);
    expect(getCachedOutboxSummary(userA).pending).toBe(0);

    const subscriber = vi.fn();
    const unsubscribe = subscribeToOutbox(subscriber);

    // Initial mount hook calls getOutboxOps
    const loadedOps = await getOutboxOps(userA);
    expect(loadedOps).toHaveLength(1);

    // Subscriber must be notified that the cache has been populated
    expect(subscriber).toHaveBeenCalled();
    expect(getCachedOpsForUser(userA)).toHaveLength(1);
    expect(getCachedOutboxSummary(userA).pending).toBe(1);

    // Repeated call with identical data should NOT notify again
    subscriber.mockClear();
    await getOutboxOps(userA);
    expect(subscriber).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('9. deleteOp and updateOp immediately update in-memory cache and notify subscribers', async () => {
    const op = await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
    });

    expect(getCachedOpsForUser(userA)).toHaveLength(1);
    expect(getCachedOutboxSummary(userA).pending).toBe(1);

    // Update op state to attention
    op.state = 'attention';
    op.error = 'Temporary error';
    await updateOp(userA, op);

    expect(getCachedOutboxSummary(userA).pending).toBe(0);
    expect(getCachedOutboxSummary(userA).attention).toBe(1);

    // Delete op
    await deleteOp(userA, op.opId);
    expect(getCachedOpsForUser(userA)).toHaveLength(0);
    expect(getCachedOutboxSummary(userA).pending).toBe(0);
    expect(getCachedOutboxSummary(userA).attention).toBe(0);
  });

  it('10. concurrent enqueues preserve monotonic ordering and maintain in-memory cache coherence', async () => {
    const promises = [
      enqueue({
        userId: userA,
        kind: 'workout.ensure',
        payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
      }),
      enqueue({
        userId: userA,
        kind: 'set.create',
        payload: {
          id: 'set-1',
          workoutRef: 'w-1',
          exercise_id: 'ex-1',
          weight: 100,
          reps: 10,
          set_index: 1,
          created_at: new Date().toISOString(),
        },
      }),
      enqueue({
        userId: userA,
        kind: 'set.create',
        payload: {
          id: 'set-2',
          workoutRef: 'w-1',
          exercise_id: 'ex-1',
          weight: 105,
          reps: 10,
          set_index: 2,
          created_at: new Date().toISOString(),
        },
      }),
    ];

    const results = await Promise.all(promises);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.seq)).toEqual([1, 2, 3]);

    const cachedOps = getCachedOpsForUser(userA);
    expect(cachedOps).toHaveLength(3);
    expect(cachedOps.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(getCachedOutboxSummary(userA).pending).toBe(3);
  });

  it('11. cross-tab cache coherence: pending counts in storage prevent stale 0 pending in other tabs', async () => {
    // Tab B enqueues an operation
    await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-tab-b', workout_date: '2026-09-30' },
    });

    // Simulate Tab A where in-memory cache was not yet populated or reset
    // but localStorage contains the cross-tab pending count from Tab B
    resetOutboxForTesting();
    // restore the localStorage key that Tab B wrote
    localStorage.setItem(`yourbody_outbox_pending_${userA}`, '1');

    const subscriber = vi.fn();
    const unsubscribe = subscribeToOutbox(subscriber);

    // Tab A's synchronous summary check should read the pending count from localStorage
    // rather than incorrectly returning 0
    const summary = getCachedOutboxSummary(userA);
    expect(summary.pending).toBe(1);

    // Simulate cross-tab storage event fired in Tab A
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: `yourbody_outbox_pending_${userA}`,
        newValue: '1',
      })
    );

    // Tab A loads ops from IDB and notifies local subscribers
    await vi.waitFor(() => {
      expect(subscriber).toHaveBeenCalled();
    });

    expect(getCachedOpsForUser(userA)).toHaveLength(1);
    expect(getCachedOutboxSummary(userA).pending).toBe(1);

    unsubscribe();
  });

  it('12. blockDependentOps: if set.batchCreate goes to attention, subsequent ops on its set ids are blocked', async () => {
    const batchOp = await enqueue({
      userId: userA,
      kind: 'set.batchCreate',
      payload: {
        workoutRef: 'w-fail',
        sets: [
          {
            id: 'set-fail-1',
            exercise_id: 'ex-1',
            weight: 100,
            reps: 10,
            set_index: 1,
            created_at: new Date().toISOString(),
          },
          {
            id: 'set-fail-2',
            exercise_id: 'ex-2',
            weight: 200,
            reps: 5,
            set_index: 2,
            created_at: new Date().toISOString(),
          },
        ],
      },
    });

    // Mark batchOp as attention (failed op with permanent error)
    batchOp.state = 'attention';
    batchOp.error = 'Permanent constraint violation';
    await updateOp(userA, batchOp);

    // Enqueue an update targeting one of the sets in the batch
    const updOp = await enqueue({
      userId: userA,
      kind: 'set.update',
      payload: {
        id: 'set-fail-2',
        patch: { weight: 205 },
      },
    });

    await blockDependentOps(userA, batchOp);

    const ops = await getOutboxOps(userA);
    const updated = ops.find((o) => o.opId === updOp.opId);
    expect(updated).toBeDefined();
    expect(updated?.state).toBe('attention');
    expect(updated?.blockedBy).toBe(batchOp.opId);
  });

  it('13. N concurrent getOutboxOps calls result in <= 1 IndexedDB read (in-flight coalescing)', async () => {
    resetOutboxForTesting();
    const getOfflineDbSpy = vi.spyOn(dbModule, 'getOfflineDb');

    // 5 concurrent calls for the same user
    const results = await Promise.all([
      getOutboxOps(userA),
      getOutboxOps(userA),
      getOutboxOps(userA),
      getOutboxOps(userA),
      getOutboxOps(userA),
    ]);

    expect(results).toHaveLength(5);
    expect(results[0]).toEqual(results[1]);
    // Exactly 1 IDB connection / fetch was initiated
    expect(getOfflineDbSpy).toHaveBeenCalledTimes(1);

    getOfflineDbSpy.mockRestore();
  });

  it('14. user-scoped subscriber does not re-run per unrelated notify', () => {
    resetOutboxForTesting();
    const subA = vi.fn();
    const subB = vi.fn();
    const unsubA = subscribeToOutbox(subA, userA);
    const unsubB = subscribeToOutbox(subB, userB);

    // Notify userA only
    notifyOutboxChanged(userA);
    expect(subA).toHaveBeenCalledTimes(1);
    expect(subB).not.toHaveBeenCalled();

    // Notify userB only
    notifyOutboxChanged(userB);
    expect(subA).toHaveBeenCalledTimes(1);
    expect(subB).toHaveBeenCalledTimes(1);

    unsubA();
    unsubB();
  });

  it('15. resetOutboxForTesting cleanly tears down BroadcastChannel and storage listener', () => {
    const subscriber = vi.fn();
    subscribeToOutbox(subscriber, userA);

    resetOutboxForTesting();

    // After reset, notifying shouldn't trigger old subscribers
    notifyOutboxChanged(userA);
    expect(subscriber).not.toHaveBeenCalled();
  });

  it('16. in-flight getOutboxOps does not overwrite cache/returned list if enqueue occurs concurrently', async () => {
    resetOutboxForTesting();
    const realDb = await dbModule.getOfflineDb(userA);

    let releaseRead: () => void = () => {};
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });

    const originalGetAll = realDb.getAll;
    let intercepted = false;
    (realDb as any).getAll = async function (storeName: any, ...args: any[]) {
      const result = await originalGetAll.call(realDb, storeName, ...args);
      if (storeName === 'outbox' && !intercepted) {
        intercepted = true;
        // Wait for enqueue to complete before returning the read result
        await readGate;
      }
      return result;
    };

    try {
      // 1. Start getOutboxOps before enqueue
      const p1 = getOutboxOps(userA);

      // 2. Enqueue an operation before p1 resolves
      const newOp = await enqueue({
        userId: userA,
        kind: 'workout.ensure',
        payload: { clientWorkoutId: 'w-concurrent-1', name: 'Concurrent Test', workout_date: '2026-03-30' },
      });

      // 3. Release the readGate so p1 can finish
      releaseRead();

      // 4. Await p1, and start a new getOutboxOps call (p2)
      const p2 = getOutboxOps(userA);
      const [res1, res2] = await Promise.all([p1, p2]);

      // Both p1 and p2 must include the new op
      expect(res1.some((o) => o.opId === newOp.opId)).toBe(true);
      expect(res2.some((o) => o.opId === newOp.opId)).toBe(true);

      // Cache must include the new op
      const cachedOps = getCachedOpsForUser(userA);
      expect(cachedOps.some((o) => o.opId === newOp.opId)).toBe(true);

      // Outbox summary pending must be correct (1)
      const summary = getCachedOutboxSummary(userA);
      expect(summary.pending).toBe(1);
    } finally {
      delete (realDb as any).getAll;
    }
  });

  it('17. deleteOp during in-flight getOutboxOps does not resurrect the deleted op in cache', async () => {
    resetOutboxForTesting();
    const realDb = await dbModule.getOfflineDb(userA);

    // Pre-populate an op
    const op = await enqueue({
      userId: userA,
      kind: 'workout.ensure',
      payload: { clientWorkoutId: 'w-delete-race', name: 'Delete Race Test', workout_date: '2026-03-30' },
    });
    expect(getCachedOpsForUser(userA)).toHaveLength(1);

    let releaseRead: () => void = () => {};
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });

    const originalGetAll = realDb.getAll;
    let intercepted = false;
    (realDb as any).getAll = async function (storeName: any, ...args: any[]) {
      const result = await originalGetAll.call(realDb, storeName, ...args);
      if (storeName === 'outbox' && !intercepted) {
        intercepted = true;
        // Wait for deleteOp to complete before returning the read result containing the deleted op
        await readGate;
      }
      return result;
    };

    try {
      // 1. Start getOutboxOps while op is in DB
      const p1 = getOutboxOps(userA);

      // 2. Delete the op before p1 resolves
      await deleteOp(userA, op.opId);

      // 3. Release the read gate
      releaseRead();

      const res1 = await p1;

      // The deleted op must NOT be returned or resurrected in cache
      expect(res1.some((o) => o.opId === op.opId)).toBe(false);
      expect(getCachedOpsForUser(userA).some((o) => o.opId === op.opId)).toBe(false);
      expect(getCachedOutboxSummary(userA).pending).toBe(0);
    } finally {
      delete (realDb as any).getAll;
    }
  });
});
