import type {
  OutboxOp,
  OutboxOpEnsure,
  OutboxOpRename,
  OutboxOpCreate,
  OutboxOpBatchCreate,
  OutboxOpUpdate,
} from './types';

export type CompactionAction =
  | 'appended'
  | 'merged-create'
  | 'merged-update'
  | 'merged-rename'
  | 'cancelled';

export interface CompactionResult {
  action: CompactionAction;
  ops: OutboxOp[];
  compactedOp?: OutboxOp;
}

/**
 * Pure compaction function applied at enqueue time.
 * Compaction rules per §A4:
 * - update of a not-yet-sent create merges into the create
 * - delete of a not-yet-sent create removes both (and nothing is sent)
 * - update after update merges (expected = first pre-image)
 * - Never compact across an op in `attention`.
 */
export function compactIncomingOp(
  existingOps: OutboxOp[],
  incomingOp: OutboxOp
): CompactionResult {
  if (incomingOp.kind === 'set.update') {
    const setId = incomingOp.payload.id;
    // Check if any op affecting this set is in attention
    const hasAttention = existingOps.some(
      (op) =>
        ((op.kind === 'set.create' || op.kind === 'set.update' || op.kind === 'set.delete') &&
          (op.payload as { id: string }).id === setId &&
          op.state === 'attention') ||
        (op.kind === 'set.batchCreate' &&
          op.payload.sets.some((s) => s.id === setId) &&
          op.state === 'attention')
    );

    if (hasAttention) {
      return { action: 'appended', ops: [...existingOps, incomingOp] };
    }

    // Find the latest pending op for this set
    let targetIndex = -1;
    for (let i = existingOps.length - 1; i >= 0; i--) {
      const op = existingOps[i];
      if (
        (op.kind === 'set.create' || op.kind === 'set.update') &&
        (op.payload as { id: string }).id === setId
      ) {
        if (op.state === 'pending') {
          targetIndex = i;
          break;
        }
      } else if (
        op.kind === 'set.batchCreate' &&
        op.payload.sets.some((s) => s.id === setId)
      ) {
        if (op.state === 'pending') {
          targetIndex = i;
          break;
        }
      }
    }

    if (targetIndex !== -1) {
      const targetOp = existingOps[targetIndex];
      if (targetOp.kind === 'set.create') {
        // Merge patch into create payload
        const updatedOp: OutboxOpCreate = {
          ...targetOp,
          payload: {
            ...targetOp.payload,
            ...incomingOp.payload.patch,
          },
        };
        const nextOps = [...existingOps];
        nextOps[targetIndex] = updatedOp;
        return {
          action: 'merged-create',
          ops: nextOps,
          compactedOp: updatedOp,
        };
      } else if (targetOp.kind === 'set.batchCreate') {
        // Merge patch into batch item
        const nextSets = targetOp.payload.sets.map((s) =>
          s.id === setId ? { ...s, ...incomingOp.payload.patch } : s
        );
        const updatedOp: OutboxOpBatchCreate = {
          ...targetOp,
          payload: {
            ...targetOp.payload,
            sets: nextSets,
          },
        };
        const nextOps = [...existingOps];
        nextOps[targetIndex] = updatedOp;
        return {
          action: 'merged-create',
          ops: nextOps,
          compactedOp: updatedOp,
        };
      } else if (targetOp.kind === 'set.update') {
        // Merge update into existing update, preserving the first pre-image (expected)
        const updatedOp: OutboxOpUpdate = {
          ...targetOp,
          payload: {
            ...targetOp.payload,
            patch: {
              ...targetOp.payload.patch,
              ...incomingOp.payload.patch,
            },
            // Expected = first pre-image: preserve targetOp.payload.expected
            expected: targetOp.payload.expected ?? incomingOp.payload.expected,
          },
        };
        const nextOps = [...existingOps];
        nextOps[targetIndex] = updatedOp;
        return {
          action: 'merged-update',
          ops: nextOps,
          compactedOp: updatedOp,
        };
      }
    }

    return { action: 'appended', ops: [...existingOps, incomingOp] };
  }

  if (incomingOp.kind === 'set.delete') {
    const setId = incomingOp.payload.id;
    const hasAttention = existingOps.some(
      (op) =>
        ((op.kind === 'set.create' || op.kind === 'set.update' || op.kind === 'set.delete') &&
          (op.payload as { id: string }).id === setId &&
          op.state === 'attention') ||
        (op.kind === 'set.batchCreate' &&
          op.payload.sets.some((s) => s.id === setId) &&
          op.state === 'attention')
    );

    if (hasAttention) {
      return { action: 'appended', ops: [...existingOps, incomingOp] };
    }

    // Check if there is a pending batch containing this set
    const pendingBatchIdx = existingOps.findIndex(
      (op) =>
        op.kind === 'set.batchCreate' &&
        op.payload.sets.some((s) => s.id === setId) &&
        op.state === 'pending'
    );

    if (pendingBatchIdx !== -1) {
      const targetOp = existingOps[pendingBatchIdx] as OutboxOpBatchCreate;
      const remainingSets = targetOp.payload.sets.filter((s) => s.id !== setId);
      if (remainingSets.length === 0) {
        // Drop the batch op completely, and any intermediate updates
        const nextOps = existingOps.filter(
          (op, idx) =>
            idx !== pendingBatchIdx &&
            !(op.kind === 'set.update' && op.payload.id === setId)
        );
        return { action: 'cancelled', ops: nextOps };
      } else {
        const updatedOp: OutboxOpBatchCreate = {
          ...targetOp,
          payload: {
            ...targetOp.payload,
            sets: remainingSets,
          },
        };
        const nextOps = existingOps
          .map((op, idx) => (idx === pendingBatchIdx ? updatedOp : op))
          .filter((op) => !(op.kind === 'set.update' && op.payload.id === setId));
        return { action: 'cancelled', ops: nextOps, compactedOp: updatedOp };
      }
    }

    // Check if there is a pending create for this set
    const pendingCreateIdx = existingOps.findIndex(
      (op) =>
        op.kind === 'set.create' &&
        (op.payload as { id: string }).id === setId &&
        op.state === 'pending'
    );

    if (pendingCreateIdx !== -1) {
      // Set was created offline and not yet sent.
      // Remove both the create and any intermediate updates! Nothing is sent.
      const nextOps = existingOps.filter(
        (op) =>
          !(
            (op.kind === 'set.create' || op.kind === 'set.update') &&
            (op.payload as { id: string }).id === setId
          )
      );
      return { action: 'cancelled', ops: nextOps };
    }

    // If set was already on the server, remove any pending updates (since delete supersedes them)
    // and append the delete op
    const nextOps = existingOps.filter(
      (op) =>
        !(
          op.kind === 'set.update' &&
          op.payload.id === setId &&
          op.state === 'pending'
        )
    );
    return { action: 'appended', ops: [...nextOps, incomingOp] };
  }

  if (incomingOp.kind === 'workout.rename') {
    const ref = incomingOp.payload.workoutRef;
    const hasAttention = existingOps.some(
      (op) =>
        (op.kind === 'workout.ensure' && op.payload.clientWorkoutId === ref && op.state === 'attention') ||
        (op.kind === 'workout.rename' && op.payload.workoutRef === ref && op.state === 'attention')
    );

    if (!hasAttention) {
      // Check for pending workout.ensure
      const ensureIdx = existingOps.findIndex(
        (op) =>
          op.kind === 'workout.ensure' &&
          op.payload.clientWorkoutId === ref &&
          op.state === 'pending'
      );
      if (ensureIdx !== -1) {
        const ensureOp = existingOps[ensureIdx] as OutboxOpEnsure;
        const updatedOp: OutboxOpEnsure = {
          ...ensureOp,
          payload: {
            ...ensureOp.payload,
            name: incomingOp.payload.name,
          },
        };
        const nextOps = [...existingOps];
        nextOps[ensureIdx] = updatedOp;
        return { action: 'merged-rename', ops: nextOps, compactedOp: updatedOp };
      }

      // Check for prior pending workout.rename
      const renameIdx = existingOps.findIndex(
        (op) =>
          op.kind === 'workout.rename' &&
          op.payload.workoutRef === ref &&
          op.state === 'pending'
      );
      if (renameIdx !== -1) {
        const renameOp = existingOps[renameIdx] as OutboxOpRename;
        const updatedOp: OutboxOpRename = {
          ...renameOp,
          payload: {
            ...renameOp.payload,
            name: incomingOp.payload.name,
          },
        };
        const nextOps = [...existingOps];
        nextOps[renameIdx] = updatedOp;
        return { action: 'merged-rename', ops: nextOps, compactedOp: updatedOp };
      }
    }
  }

  return { action: 'appended', ops: [...existingOps, incomingOp] };
}
