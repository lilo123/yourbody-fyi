import { describe, it, expect } from 'vitest';
import { compactIncomingOp } from '../compaction';
import type { OutboxOp } from '../types';

describe('Outbox Compaction Matrix (§A4)', () => {
  const userId = 'user-1';

  it('1. update of a not-yet-sent create merges into the create', () => {
    const createOp: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'set.create',
      payload: {
        id: 'set-1',
        workoutRef: 'w-1',
        exercise_id: 'ex-1',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        rpe: 8,
        created_at: '2026-09-30T10:00:00Z',
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    const updateOp: OutboxOp = {
      opId: 'op-2',
      userId,
      seq: 2,
      kind: 'set.update',
      payload: {
        id: 'set-1',
        patch: { weight: 105, reps: 12 },
      },
      createdAt: '2026-09-30T10:01:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([createOp], updateOp);

    expect(result.action).toBe('merged-create');
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0].kind).toBe('set.create');
    expect(result.ops[0].payload).toMatchObject({
      id: 'set-1',
      weight: 105,
      reps: 12,
      set_index: 1,
      created_at: '2026-09-30T10:00:00Z', // original capture time preserved
    });
  });

  it('2. delete of a not-yet-sent create removes both (nothing is sent)', () => {
    const createOp: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'set.create',
      payload: {
        id: 'set-1',
        workoutRef: 'w-1',
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

    const deleteOp: OutboxOp = {
      opId: 'op-2',
      userId,
      seq: 2,
      kind: 'set.delete',
      payload: { id: 'set-1' },
      createdAt: '2026-09-30T10:02:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([createOp], deleteOp);

    expect(result.action).toBe('cancelled');
    expect(result.ops).toHaveLength(0);
  });

  it('3. delete of a not-yet-sent create removes intermediate updates too', () => {
    const createOp: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'set.create',
      payload: {
        id: 'set-1',
        workoutRef: 'w-1',
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

    const otherOp: OutboxOp = {
      opId: 'op-other',
      userId,
      seq: 2,
      kind: 'set.create',
      payload: {
        id: 'set-2',
        workoutRef: 'w-1',
        exercise_id: 'ex-2',
        weight: 50,
        reps: 8,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:01:00Z',
      },
      createdAt: '2026-09-30T10:01:00Z',
      attempts: 0,
      state: 'pending',
    };

    const deleteOp: OutboxOp = {
      opId: 'op-3',
      userId,
      seq: 3,
      kind: 'set.delete',
      payload: { id: 'set-1' },
      createdAt: '2026-09-30T10:02:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([createOp, otherOp], deleteOp);

    expect(result.action).toBe('cancelled');
    expect(result.ops).toHaveLength(1);
    expect((result.ops[0].payload as any).id).toBe('set-2');
  });

  it('4. update after update merges, preserving first pre-image (expected)', () => {
    const update1: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'set.update',
      payload: {
        id: 'server-set-1',
        patch: { weight: 100 },
        expected: { weight: 90, reps: 10 }, // First pre-image
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    const update2: OutboxOp = {
      opId: 'op-2',
      userId,
      seq: 2,
      kind: 'set.update',
      payload: {
        id: 'server-set-1',
        patch: { weight: 110, reps: 12 },
        expected: { weight: 100 }, // Second pre-image
      },
      createdAt: '2026-09-30T10:01:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([update1], update2);

    expect(result.action).toBe('merged-update');
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0].payload).toEqual({
      id: 'server-set-1',
      patch: { weight: 110, reps: 12 },
      expected: { weight: 90, reps: 10 }, // First pre-image preserved!
    });
  });

  it('5. delete of an existing server set supersedes prior pending updates', () => {
    const updateOp: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'set.update',
      payload: {
        id: 'server-set-1',
        patch: { weight: 105 },
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    const deleteOp: OutboxOp = {
      opId: 'op-2',
      userId,
      seq: 2,
      kind: 'set.delete',
      payload: { id: 'server-set-1' },
      createdAt: '2026-09-30T10:02:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([updateOp], deleteOp);

    expect(result.action).toBe('appended');
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0].kind).toBe('set.delete');
    expect((result.ops[0].payload as any).id).toBe('server-set-1');
  });

  it('6. workout.rename merges into pending workout.ensure', () => {
    const ensureOp: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'workout.ensure',
      payload: {
        clientWorkoutId: 'client-w-1',
        workout_date: '2026-09-30',
        name: 'Morning Routine',
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    const renameOp: OutboxOp = {
      opId: 'op-2',
      userId,
      seq: 2,
      kind: 'workout.rename',
      payload: {
        workoutRef: 'client-w-1',
        name: 'Evening Routine',
      },
      createdAt: '2026-09-30T10:05:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([ensureOp], renameOp);

    expect(result.action).toBe('merged-rename');
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0].payload).toMatchObject({
      clientWorkoutId: 'client-w-1',
      name: 'Evening Routine',
    });
  });

  it('7. workout.rename merges into prior pending workout.rename', () => {
    const rename1: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'workout.rename',
      payload: {
        workoutRef: 'w-canonical-1',
        name: 'Initial Name',
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    const rename2: OutboxOp = {
      opId: 'op-2',
      userId,
      seq: 2,
      kind: 'workout.rename',
      payload: {
        workoutRef: 'w-canonical-1',
        name: 'Updated Name',
      },
      createdAt: '2026-09-30T10:05:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([rename1], rename2);

    expect(result.action).toBe('merged-rename');
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0].payload).toMatchObject({
      workoutRef: 'w-canonical-1',
      name: 'Updated Name',
    });
  });

  it('8. NEVER compacts across an op in attention state', () => {
    const attentionOp: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'set.update',
      payload: {
        id: 'set-1',
        patch: { weight: 100 },
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 1,
      state: 'attention',
      error: 'changed elsewhere',
    };

    const newUpdate: OutboxOp = {
      opId: 'op-2',
      userId,
      seq: 2,
      kind: 'set.update',
      payload: {
        id: 'set-1',
        patch: { weight: 105 },
      },
      createdAt: '2026-09-30T10:02:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([attentionOp], newUpdate);

    // Cannot compact across attention op! Must be appended
    expect(result.action).toBe('appended');
    expect(result.ops).toHaveLength(2);
    expect(result.ops[0].state).toBe('attention');
    expect(result.ops[1].state).toBe('pending');
  });

  it('9. does not merge incoming update into an inflight create op, appends instead', () => {
    const inflightCreate: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'set.create',
      payload: {
        id: 'set-1',
        workoutRef: 'w-1',
        exercise_id: 'ex-1',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 1,
      state: 'inflight',
    };

    const newUpdate: OutboxOp = {
      opId: 'op-2',
      userId,
      seq: 2,
      kind: 'set.update',
      payload: {
        id: 'set-1',
        patch: { weight: 105 },
      },
      createdAt: '2026-09-30T10:02:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([inflightCreate], newUpdate);
    expect(result.action).toBe('appended');
    expect(result.ops).toHaveLength(2);
    expect(result.ops[0].state).toBe('inflight');
    expect(result.ops[1].state).toBe('pending');
  });

  it('10. does not cancel an inflight create op when delete arrives, appends delete op instead', () => {
    const inflightCreate: OutboxOp = {
      opId: 'op-1',
      userId,
      seq: 1,
      kind: 'set.create',
      payload: {
        id: 'set-1',
        workoutRef: 'w-1',
        exercise_id: 'ex-1',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 1,
      state: 'inflight',
    };

    const deleteOp: OutboxOp = {
      opId: 'op-2',
      userId,
      seq: 2,
      kind: 'set.delete',
      payload: { id: 'set-1' },
      createdAt: '2026-09-30T10:02:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([inflightCreate], deleteOp);
    expect(result.action).toBe('appended');
    expect(result.ops).toHaveLength(2);
    expect(result.ops[0].state).toBe('inflight');
    expect(result.ops[1].kind).toBe('set.delete');
  });

  it('11. set.update folds into pending set.batchCreate item', () => {
    const pendingBatch: OutboxOp = {
      opId: 'op-batch-1',
      userId,
      seq: 1,
      kind: 'set.batchCreate',
      payload: {
        workoutRef: 'w-1',
        sets: [
          {
            id: 'set-b-1',
            exercise_id: 'ex-1',
            weight: 100,
            reps: 10,
            set_index: 1,
            set_type: 'working',
            created_at: '2026-09-30T10:00:00Z',
          },
          {
            id: 'set-b-2',
            exercise_id: 'ex-2',
            weight: 200,
            reps: 5,
            set_index: 2,
            set_type: 'working',
            created_at: '2026-09-30T10:00:00Z',
          },
        ],
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    const updateOp: OutboxOp = {
      opId: 'op-upd-1',
      userId,
      seq: 2,
      kind: 'set.update',
      payload: {
        id: 'set-b-1',
        patch: { weight: 105, reps: 12 },
      },
      createdAt: '2026-09-30T10:02:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([pendingBatch], updateOp);
    expect(result.action).toBe('merged-create');
    expect(result.ops).toHaveLength(1);
    const batch = result.ops[0];
    expect(batch.kind).toBe('set.batchCreate');
    if (batch.kind === 'set.batchCreate') {
      expect(batch.payload.sets[0].weight).toBe(105);
      expect(batch.payload.sets[0].reps).toBe(12);
      expect(batch.payload.sets[1].weight).toBe(200);
    }
  });

  it('12. set.delete removes item from pending set.batchCreate', () => {
    const pendingBatch: OutboxOp = {
      opId: 'op-batch-1',
      userId,
      seq: 1,
      kind: 'set.batchCreate',
      payload: {
        workoutRef: 'w-1',
        sets: [
          {
            id: 'set-b-1',
            exercise_id: 'ex-1',
            weight: 100,
            reps: 10,
            set_index: 1,
            set_type: 'working',
            created_at: '2026-09-30T10:00:00Z',
          },
          {
            id: 'set-b-2',
            exercise_id: 'ex-2',
            weight: 200,
            reps: 5,
            set_index: 2,
            set_type: 'working',
            created_at: '2026-09-30T10:00:00Z',
          },
        ],
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    const deleteOp: OutboxOp = {
      opId: 'op-del-1',
      userId,
      seq: 2,
      kind: 'set.delete',
      payload: { id: 'set-b-1' },
      createdAt: '2026-09-30T10:02:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([pendingBatch], deleteOp);
    expect(result.action).toBe('cancelled');
    expect(result.ops).toHaveLength(1);
    const batch = result.ops[0];
    expect(batch.kind).toBe('set.batchCreate');
    if (batch.kind === 'set.batchCreate') {
      expect(batch.payload.sets).toHaveLength(1);
      expect(batch.payload.sets[0].id).toBe('set-b-2');
    }
  });

  it('13. set.delete drops pending set.batchCreate if it was the last item', () => {
    const pendingBatch: OutboxOp = {
      opId: 'op-batch-1',
      userId,
      seq: 1,
      kind: 'set.batchCreate',
      payload: {
        workoutRef: 'w-1',
        sets: [
          {
            id: 'set-only',
            exercise_id: 'ex-1',
            weight: 100,
            reps: 10,
            set_index: 1,
            set_type: 'working',
            created_at: '2026-09-30T10:00:00Z',
          },
        ],
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 0,
      state: 'pending',
    };

    const deleteOp: OutboxOp = {
      opId: 'op-del-1',
      userId,
      seq: 2,
      kind: 'set.delete',
      payload: { id: 'set-only' },
      createdAt: '2026-09-30T10:02:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([pendingBatch], deleteOp);
    expect(result.action).toBe('cancelled');
    expect(result.ops).toHaveLength(0);
  });

  it('14. never merges set.update into inflight set.batchCreate', () => {
    const inflightBatch: OutboxOp = {
      opId: 'op-batch-1',
      userId,
      seq: 1,
      kind: 'set.batchCreate',
      payload: {
        workoutRef: 'w-1',
        sets: [
          {
            id: 'set-b-1',
            exercise_id: 'ex-1',
            weight: 100,
            reps: 10,
            set_index: 1,
            set_type: 'working',
            created_at: '2026-09-30T10:00:00Z',
          },
        ],
      },
      createdAt: '2026-09-30T10:00:00Z',
      attempts: 1,
      state: 'inflight',
    };

    const updateOp: OutboxOp = {
      opId: 'op-upd-1',
      userId,
      seq: 2,
      kind: 'set.update',
      payload: {
        id: 'set-b-1',
        patch: { weight: 110 },
      },
      createdAt: '2026-09-30T10:02:00Z',
      attempts: 0,
      state: 'pending',
    };

    const result = compactIncomingOp([inflightBatch], updateOp);
    expect(result.action).toBe('appended');
    expect(result.ops).toHaveLength(2);
    expect(result.ops[0].state).toBe('inflight');
    expect(result.ops[1].kind).toBe('set.update');
  });
});
