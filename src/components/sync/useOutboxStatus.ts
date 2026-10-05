import { useSyncExternalStore, useEffect, useRef } from 'react';
import {
  subscribeToOutbox,
  getOutboxOps,
  getCachedOutboxSummary,
  getActiveUserId,
  type OutboxSummary,
} from '../../offline';
import { useAuth } from '../../hooks/useAuth';

const DEFAULT_SUMMARY: OutboxSummary = {
  pending: 0,
  attention: 0,
  syncing: false,
  authRequired: false,
  lastSyncedCount: 0,
  needsAttentionOps: [],
};

const cacheByUser = new Map<string, OutboxSummary>();

function getStableSnapshot(userId: string): OutboxSummary {
  const fresh = getCachedOutboxSummary(userId);
  const prev = cacheByUser.get(userId) || DEFAULT_SUMMARY;

  const sameNeedsAttention =
    fresh.needsAttentionOps === prev.needsAttentionOps ||
    (fresh.needsAttentionOps.length === prev.needsAttentionOps.length &&
      fresh.needsAttentionOps.every(
        (op, i) =>
          op.opId === prev.needsAttentionOps[i]?.opId &&
          op.state === prev.needsAttentionOps[i]?.state &&
          op.error === prev.needsAttentionOps[i]?.error
      ));

  if (
    fresh.pending === prev.pending &&
    fresh.attention === prev.attention &&
    fresh.syncing === prev.syncing &&
    fresh.authRequired === prev.authRequired &&
    fresh.lastSyncedCount === prev.lastSyncedCount &&
    sameNeedsAttention
  ) {
    return prev;
  }

  cacheByUser.set(userId, fresh);
  return fresh;
}

/**
 * Referentially stable hook to read outbox summary without triggering
 * React 19 maximum update depth loops caused by fresh object creation in getSnapshot.
 */
export function useOutboxStatus(explicitUserId?: string): OutboxSummary {
  const { user } = useAuth();
  const target = explicitUserId || user?.id || getActiveUserId() || '';
  const initialFetchDone = useRef<string | null>(null);

  useEffect(() => {
    if (target && initialFetchDone.current !== target) {
      initialFetchDone.current = target;
      getOutboxOps(target).catch(() => {});
    }
  }, [target]);

  return useSyncExternalStore(
    subscribeToOutbox,
    () => (target ? getStableSnapshot(target) : DEFAULT_SUMMARY),
    () => DEFAULT_SUMMARY
  );
}

export default useOutboxStatus;
