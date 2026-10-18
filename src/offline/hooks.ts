import { useSyncExternalStore, useEffect, useCallback, useRef } from 'react';
import { isDbClosedError } from './db';
import { readLegacyAiQueueLeftovers, deleteLegacyAiQueueItems } from './aiRescue';
import {
  subscribeToOutbox,
  getOutboxOps,
  getCachedOpsForUser,
  getCachedOutboxSummary,
  hasCachedOpsForUser,
} from './outbox';
import { getActiveUserId } from './flusher';
import { applyPendingToNutritionLogs, type OverlayNutritionLogsOptions } from './overlay';
import type { OutboxOp, OutboxSummary } from './types';

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

export interface UseAiRescueOptions {
  targetUserId: string;
  stagedMeal: unknown;
  nlInput: string;
  setNlInput: (text: string) => void;
}

/**
 * Rescues legacy queued AI items from the offline IndexedDB store 'aiq'
 * into the meal text input for the signed-in user.
 *
 * Invariants:
 * 1. Never overwrite user-typed text or a restored staged draft.
 * 2. Two-step safe commit: read -> (if still mounted and canRescue()) set the input -> THEN delete
 *    exactly the ids whose text was written. Otherwise delete nothing.
 */
export function useAiRescue({
  targetUserId,
  stagedMeal,
  nlInput,
  setNlInput,
}: UseAiRescueOptions): void {
  const stagedMealRef = useRef(stagedMeal);
  stagedMealRef.current = stagedMeal;
  const nlInputRef = useRef(nlInput);
  nlInputRef.current = nlInput;

  useEffect(() => {
    if (!targetUserId) return;
    let isCancelled = false;

    const canRescue = () => {
      return !stagedMealRef.current && !nlInputRef.current.trim();
    };

    if (!canRescue()) return;

    void readLegacyAiQueueLeftovers(targetUserId)
      .then(async (result) => {
        if (isCancelled || !result) return;
        if (!canRescue()) return;

        // 1. Set the input first
        setNlInput(result.text);

        // 2. THEN delete exactly the ids whose text was written
        if (!isCancelled) {
          await deleteLegacyAiQueueItems(targetUserId, result.ids);
        }
      })
      .catch((err: unknown) => {
        console.warn('[aiRescue] Failed to rescue legacy queue leftovers:', err);
      });

    return () => {
      isCancelled = true;
    };
  }, [targetUserId, setNlInput]);
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
