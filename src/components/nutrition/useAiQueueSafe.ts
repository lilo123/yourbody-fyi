import { useSyncExternalStore, useEffect, useCallback } from 'react';
import {
  subscribeToAiQueue,
  listAiItems,
  getCachedAiQueue,
  type AiQueueState,
  type AiQueueItem,
} from '../../offline';

const DEFAULT_AI_QUEUE_STATE: AiQueueState = {
  items: [],
  counts: { queued: 0, analyzing: 0, ready: 0, failed: 0, total: 0 },
  isAnalyzing: false,
};

interface CachedSnapshotEntry {
  state: AiQueueState;
  rawItems: AiQueueItem[];
}

const aiQueueSnapshotCache = new Map<string, CachedSnapshotEntry>();

function isItemEqual(first: AiQueueItem, second: AiQueueItem): boolean {
  return (
    first.id === second.id &&
    first.status === second.status &&
    first.attempts === second.attempts &&
    first.nextAttemptAt === second.nextAttemptAt &&
    first.lastError === second.lastError &&
    first.result === second.result
  );
}

export function useAiQueueSafe(userId?: string): AiQueueState {
  const target = userId || '';

  useEffect(() => {
    if (target) {
      listAiItems(target).catch((err) => {
        console.warn('[aiQueue] useAiQueueSafe background fetch failed', err);
      });
    }
  }, [target]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToAiQueue(onStoreChange, target),
    [target]
  );

  return useSyncExternalStore(
    subscribe,
    () => {
      if (!target) return DEFAULT_AI_QUEUE_STATE;
      const current = getCachedAiQueue(target);
      const cached = aiQueueSnapshotCache.get(target);

      if (
        cached &&
        cached.state.counts.queued === current.counts.queued &&
        cached.state.counts.analyzing === current.counts.analyzing &&
        cached.state.counts.ready === current.counts.ready &&
        cached.state.counts.failed === current.counts.failed &&
        cached.state.counts.total === current.counts.total &&
        cached.state.isAnalyzing === current.isAnalyzing &&
        cached.state.items.length === current.items.length &&
        cached.state.items.every((item, index) => {
          const comparisonItem = current.items[index];
          return comparisonItem ? isItemEqual(item, comparisonItem) : false;
        })
      ) {
        return cached.state;
      }

      aiQueueSnapshotCache.set(target, { state: current, rawItems: current.items });
      return current;
    },
    () => DEFAULT_AI_QUEUE_STATE
  );
}
