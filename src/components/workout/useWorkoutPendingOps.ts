import { useSyncExternalStore, useEffect, useRef } from 'react';
import {
  subscribeToOutbox,
  getOutboxOps,
  getCachedOpsForUser,
} from '../../offline/outbox';
import { getActiveUserId } from '../../offline/flusher';
import type { OutboxOp } from '../../offline/types';

const EMPTY_OPS: OutboxOp[] = [];

/**
 * Safe version of usePendingOps that ensures getSnapshot returns a stable reference
 * when there are no cached ops for the user, preventing React infinite loops.
 */
export function useWorkoutPendingOps(userId?: string): OutboxOp[] {
  const target = userId || getActiveUserId() || '';
  const lastEmptyRef = useRef<OutboxOp[]>(EMPTY_OPS);

  useEffect(() => {
    if (target) {
      getOutboxOps(target).catch(() => {});
    }
  }, [target]);

  return useSyncExternalStore(
    subscribeToOutbox,
    () => {
      if (!target) return EMPTY_OPS;
      const ops = getCachedOpsForUser(target);
      if (!ops || ops.length === 0) {
        return lastEmptyRef.current;
      }
      return ops;
    },
    () => EMPTY_OPS
  );
}
