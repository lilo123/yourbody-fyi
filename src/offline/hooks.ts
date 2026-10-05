import { useSyncExternalStore, useEffect, useCallback, useRef } from 'react';
import { isDbClosedError } from './db';
import {
  subscribeToOutbox,
  getOutboxOps,
  getCachedOpsForUser,
  getCachedOutboxSummary,
  hasCachedOpsForUser,
} from './outbox';
import { getActiveUserId } from './flusher';
import { subscribeToAiQueue, listAiItems, getCachedAiQueue } from './aiQueue';
import { applyPendingToNutritionLogs, type OverlayNutritionLogsOptions } from './overlay';
import type { OutboxOp, OutboxSummary, AiQueueState } from './types';

const EMPTY_OPS: OutboxOp[] = [];
const DEFAULT_SUMMARY: OutboxSummary = {
  pending: 0,
  attention: 0,
  syncing: false,
  authRequired: false,
  lastSyncedCount: 0,
  needsAttentionOps: [],
};

/**
 * Hook to track all outbox operations for a user via useSyncExternalStore.
 */
export function usePendingOps(userId?: string): OutboxOp[] {
  const target = userId || getActiveUserId() || '';
  const lastEmptyRef = useRef<OutboxOp[]>(EMPTY_OPS);

  // Trigger initial IDB fetch in background if not already in memory cache
  useEffect(() => {
    let active = true;
    if (target && !hasCachedOpsForUser(target)) {
      getOutboxOps(target).catch((e) => {
        // Closed-DB errors in this read-cache prewarm are expected at unmount/teardown.
        if (!active || isDbClosedError(e)) return;
        console.warn('[outbox] usePendingOps background prewarm failed', e);
      });
    }
    return () => {
      active = false;
    };
  }, [target]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToOutbox(onStoreChange, target),
    [target]
  );

  return useSyncExternalStore(
    subscribe,
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

/**
 * Hook to track overall outbox summary (pending count, attention count, syncing state, authRequired).
 */
export function useOutboxSummary(userId?: string): OutboxSummary {
  const target = userId || getActiveUserId() || '';

  useEffect(() => {
    let active = true;
    if (target && !hasCachedOpsForUser(target)) {
      getOutboxOps(target).catch((e) => {
        // Closed-DB errors in this read-cache prewarm are expected at unmount/teardown.
        if (!active || isDbClosedError(e)) return;
        console.warn('[outbox] useOutboxSummary background prewarm failed', e);
      });
    }
    return () => {
      active = false;
    };
  }, [target]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToOutbox(onStoreChange, target),
    [target]
  );

  return useSyncExternalStore(
    subscribe,
    () => (target ? getCachedOutboxSummary(target) : DEFAULT_SUMMARY),
    () => DEFAULT_SUMMARY
  );
}

const DEFAULT_AI_QUEUE_STATE: AiQueueState = {
  items: [],
  counts: { queued: 0, analyzing: 0, ready: 0, failed: 0, total: 0 },
  isAnalyzing: false,
};

/**
 * Hook to track AI queue items and summary counts for a user.
 */
export function useAiQueue(userId?: string): AiQueueState {
  const target = userId || getActiveUserId() || '';

  useEffect(() => {
    let active = true;
    if (target) {
      listAiItems(target).catch((e) => {
        // Closed-DB errors in this read-cache prewarm are expected at unmount/teardown.
        if (!active || isDbClosedError(e)) return;
        console.warn('[aiQueue] useAiQueue background fetch failed', e);
      });
    }
    return () => {
      active = false;
    };
  }, [target]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToAiQueue(onStoreChange, target),
    [target]
  );

  return useSyncExternalStore(
    subscribe,
    () => (target ? getCachedAiQueue(target) : DEFAULT_AI_QUEUE_STATE),
    () => DEFAULT_AI_QUEUE_STATE
  );
}

/**
 * Hook to apply pending outbox operations to nutrition logs.
 */
export function useOverlaidNutritionLogs<
  T extends { id: string; logged_at?: string; logged_date?: string | null }
>(
  serverLogs: T[],
  options?: OverlayNutritionLogsOptions
): (T & { pending?: boolean })[] {
  const targetUserId = options?.userId || getActiveUserId() || undefined;
  const pendingOps = usePendingOps(targetUserId);
  return applyPendingToNutritionLogs(serverLogs, pendingOps, { ...options, userId: targetUserId });
}
