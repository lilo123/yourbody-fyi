import { getOfflineDb, isDbClosedError } from './db';
import type { OutboxOp, OpKind, OpPayloadMap, OutboxSummary } from './types';
import { compactIncomingOp } from './compaction';

// Subscription listeners for outbox state updates
const globalSubscribers = new Set<() => void>();
const userSubscribers = new Map<string, Set<() => void>>();

export const BROADCAST_CHANNEL_NAME = 'yourbody_outbox_channel';
let outboxBroadcastChannel: BroadcastChannel | null = null;
let storageEventListener: ((event: StorageEvent) => void) | null = null;

type RemoteSyncedHandler = (userId: string, count: number) => void;
let remoteSyncedHandler: RemoteSyncedHandler | null = null;

export function registerRemoteSyncedHandler(handler: RemoteSyncedHandler): void {
  ensureListeners();
  remoteSyncedHandler = handler;
}

export function broadcastSynced(userId: string, count: number): void {
  if (!userId || typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
    return;
  }
  ensureListeners();
  if (outboxBroadcastChannel) {
    try {
      outboxBroadcastChannel.postMessage({
        type: 'synced',
        userId,
        count,
      });
    } catch (e) {
      console.warn('[outbox] Failed to broadcast synced event', e);
    }
  }
}

interface InFlightRead {
  promise: Promise<OutboxOp[]>;
  gen: number;
}

const inFlightGetOps = new Map<string, InFlightRead>();
const userMutationGen = new Map<string, number>();

function bumpMutationGen(userId: string): number {
  const next = (userMutationGen.get(userId) || 0) + 1;
  userMutationGen.set(userId, next);
  return next;
}
const pendingRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleOutboxRefresh(userId: string): void {
  if (!userId) return;
  if (pendingRefreshTimers.has(userId)) return;
  const timer = setTimeout(() => {
    pendingRefreshTimers.delete(userId);
    getOutboxOps(userId).catch((e) => {
      // Background outbox refresh after broadcast: absorb closed-DB errors on teardown, warn otherwise
      if (!isDbClosedError(e)) {
        console.warn('[outbox] Failed to refresh outbox ops after channel broadcast', e);
      }
    });
  }, 10);
  pendingRefreshTimers.set(userId, timer);
}

function ensureListeners(): void {
  if (!outboxBroadcastChannel && typeof BroadcastChannel !== 'undefined') {
    try {
      outboxBroadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      outboxBroadcastChannel.onmessage = (event) => {
        if (event.data?.type === 'outbox_changed' && event.data.userId) {
          scheduleOutboxRefresh(event.data.userId);
        } else if (
          event.data?.type === 'synced' &&
          typeof event.data.userId === 'string' &&
          typeof event.data.count === 'number' &&
          event.data.count > 0
        ) {
          if (remoteSyncedHandler) {
            try {
              remoteSyncedHandler(event.data.userId, event.data.count);
            } catch (err) {
              console.error('[outbox] remoteSyncedHandler error:', err);
            }
          }
        }
      };
    } catch (e) {
      console.warn('[outbox] BroadcastChannel setup failed:', e);
    }
  }

  if (!storageEventListener && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    storageEventListener = (event: StorageEvent) => {
      if (event.key?.startsWith('yourbody_outbox_pending_')) {
        const uId = event.key.slice('yourbody_outbox_pending_'.length);
        if (uId) {
          scheduleOutboxRefresh(uId);
        }
      }
    };
    window.addEventListener('storage', storageEventListener);
  }
}

export function subscribeToOutbox(callback: () => void, userId?: string): () => void {
  ensureListeners();
  if (userId) {
    let set = userSubscribers.get(userId);
    if (!set) {
      set = new Set();
      userSubscribers.set(userId, set);
    }
    set.add(callback);
    return () => {
      set?.delete(callback);
      if (set && set.size === 0) {
        userSubscribers.delete(userId);
      }
    };
  }

  globalSubscribers.add(callback);
  return () => {
    globalSubscribers.delete(callback);
  };
}

export function notifyOutboxChanged(userId?: string): void {
  ensureListeners();
  for (const sub of globalSubscribers) {
    try {
      sub();
    } catch (e) {
      console.error('[outbox] subscriber error:', e);
    }
  }
  if (userId) {
    const userSubs = userSubscribers.get(userId);
    if (userSubs) {
      for (const sub of userSubs) {
        try {
          sub();
        } catch (e) {
          console.error('[outbox] user subscriber error:', e);
        }
      }
    }
    if (outboxBroadcastChannel) {
      try {
        outboxBroadcastChannel.postMessage({ type: 'outbox_changed', userId });
      } catch (e) {
        console.warn('[outbox] Failed to broadcast outbox update', e);
      }
    }
  }
}

// In-memory syncing & authRequired status flags
let isSyncingGlobally = false;
let isAuthRequiredGlobally = false;
let globalLastSyncedCount = 0;

const userOpsCache = new Map<string, OutboxOp[]>();
const userSummaryCache = new Map<string, OutboxSummary>();
const enqueueMutexes = new Map<string, Promise<unknown>>();

function runWithEnqueueMutex<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = enqueueMutexes.get(userId) || Promise.resolve();
  let release: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  enqueueMutexes.set(
    userId,
    prev
      .catch((e) => {
        // If previous enqueue failed with closed-DB during teardown, absorb; otherwise warn
        if (!isDbClosedError(e)) {
          console.warn('[outbox] Previous enqueue task failed in mutex queue', e);
        }
      })
      .then(() => current)
  );

  return prev
    .catch((e) => {
      // If previous enqueue failed with closed-DB during teardown, absorb; otherwise warn
      if (!isDbClosedError(e)) {
        console.warn('[outbox] Previous enqueue task failed in mutex queue', e);
      }
    })
    .then(async () => {
      try {
        return await fn();
      } finally {
        release();
      }
    });
}

export function resetOutboxForTesting(): void {
  globalSubscribers.clear();
  userSubscribers.clear();
  userOpsCache.clear();
  userSummaryCache.clear();
  enqueueMutexes.clear();
  inFlightGetOps.clear();
  userMutationGen.clear();
  for (const timer of pendingRefreshTimers.values()) {
    clearTimeout(timer);
  }
  pendingRefreshTimers.clear();

  if (outboxBroadcastChannel) {
    try {
      outboxBroadcastChannel.close();
    } catch {
      // ignore
    }
    outboxBroadcastChannel = null;
  }

  if (storageEventListener && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    try {
      window.removeEventListener('storage', storageEventListener);
    } catch {
      // ignore
    }
    storageEventListener = null;
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('yourbody_outbox_pending_')) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
    } catch (e) {
      console.warn('[outbox] Failed to clear pending localStorage in resetOutboxForTesting', e);
    }
  }
  isSyncingGlobally = false;
  isAuthRequiredGlobally = false;
  globalLastSyncedCount = 0;
}

export function hasCachedOpsForUser(userId: string): boolean {
  return Boolean(userId && userOpsCache.has(userId));
}

const EMPTY_OPS: OutboxOp[] = [];

export function getCachedOpsForUser(userId: string): OutboxOp[] {
  if (!userId) return EMPTY_OPS;
  return userOpsCache.get(userId) || EMPTY_OPS;
}

const DEFAULT_EMPTY_SUMMARY: OutboxSummary = {
  pending: 0,
  attention: 0,
  syncing: false,
  authRequired: false,
  lastSyncedCount: 0,
  needsAttentionOps: [],
};

export function getCachedOutboxSummary(userId: string): OutboxSummary {
  if (!userId) {
    return DEFAULT_EMPTY_SUMMARY;
  }
  const cached = userSummaryCache.get(userId);
  let pending = cached?.pending ?? 0;
  let attention = cached?.attention ?? 0;

  // Cross-tab fallback: if in-memory cache has 0 pending, check localStorage
  if (pending === 0 && typeof localStorage !== 'undefined') {
    try {
      const storedPending = parseInt(localStorage.getItem('yourbody_outbox_pending_' + userId) || '0', 10);
      if (storedPending > 0) {
        pending = storedPending;
      }
    } catch (e) {
      console.warn('[outbox] Failed to read pending summary from localStorage', e);
    }
  }

  if (cached) {
    if (
      cached.pending === pending &&
      cached.attention === attention &&
      cached.syncing === isSyncingGlobally &&
      cached.authRequired === isAuthRequiredGlobally &&
      cached.lastSyncedCount === globalLastSyncedCount
    ) {
      return cached;
    }
    const updated: OutboxSummary = {
      ...cached,
      pending,
      syncing: isSyncingGlobally,
      authRequired: isAuthRequiredGlobally,
      lastSyncedCount: globalLastSyncedCount,
    };
    userSummaryCache.set(userId, updated);
    return updated;
  }

  const newSummary: OutboxSummary = {
    pending,
    attention,
    syncing: isSyncingGlobally,
    authRequired: isAuthRequiredGlobally,
    lastSyncedCount: globalLastSyncedCount,
    needsAttentionOps: [],
  };
  userSummaryCache.set(userId, newSummary);
  return newSummary;
}

export function updateUserCache(userId: string, ops: OutboxOp[]): OutboxSummary {
  userOpsCache.set(userId, ops);
  let pending = 0;
  let attention = 0;
  const needsAttentionOps: OutboxOp[] = [];

  for (const op of ops) {
    if (op.state === 'pending' || op.state === 'inflight') {
      pending++;
    } else if (op.state === 'attention') {
      attention++;
      needsAttentionOps.push(op);
    }
  }

  const summary: OutboxSummary = {
    pending,
    attention,
    syncing: isSyncingGlobally,
    authRequired: isAuthRequiredGlobally,
    lastSyncedCount: globalLastSyncedCount,
    needsAttentionOps,
  };
  userSummaryCache.set(userId, summary);

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('yourbody_outbox_pending_' + userId, String(pending));
    } catch (e) {
      console.warn('[outbox] Failed to update pending summary in localStorage', e);
    }
  }

  return summary;
}

export function setSyncingStatus(syncing: boolean): void {
  if (isSyncingGlobally !== syncing) {
    isSyncingGlobally = syncing;
    notifyOutboxChanged();
  }
}

export function setAuthRequiredStatus(required: boolean): void {
  if (isAuthRequiredGlobally !== required) {
    isAuthRequiredGlobally = required;
    notifyOutboxChanged();
  }
}

export function setLastSyncedCount(count: number): void {
  globalLastSyncedCount = count;
  notifyOutboxChanged();
}

export function getSyncingStatus(): boolean {
  return isSyncingGlobally;
}

export function getAuthRequiredStatus(): boolean {
  return isAuthRequiredGlobally;
}

export function getLastSyncedCount(): number {
  return globalLastSyncedCount;
}

/**
 * Enqueue an operation into the durable outbox for a user.
 * Applies compaction within a single IDB transaction.
 */
export async function enqueue<K extends OpKind>(input: {
  userId: string;
  kind: K;
  payload: OpPayloadMap[K];
}): Promise<OutboxOp> {
  const { userId, kind, payload } = input;
  return runWithEnqueueMutex(userId, async () => {
  const db = await getOfflineDb(userId);

  const tx = db.transaction(['outbox', 'meta'], 'readwrite');
  const outboxStore = tx.objectStore('outbox');
  const metaStore = tx.objectStore('meta');

  // Read all existing ops sorted by seq
  const allOpsRaw = await outboxStore.getAll();
  const existingOps = allOpsRaw
    .filter((op) => op.userId === userId)
    .sort((a, b) => a.seq - b.seq);

  // Compute next monotonic seq
  const lastSeqMeta = ((await metaStore.get('last_seq')) as number) || 0;
  const maxExistingSeq = existingOps.length > 0 ? existingOps[existingOps.length - 1].seq : 0;
  const nextSeq = Math.max(lastSeqMeta, maxExistingSeq) + 1;

  const incomingOp: OutboxOp = {
    opId: crypto.randomUUID(),
    userId,
    seq: nextSeq,
    kind,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    state: 'pending',
  } as OutboxOp;

  const compaction = compactIncomingOp(existingOps, incomingOp);

  switch (compaction.action) {
    case 'merged-create':
    case 'merged-update':
    case 'merged-rename': {
      if (compaction.compactedOp) {
        await outboxStore.put(compaction.compactedOp);
      }
      await tx.done;
      bumpMutationGen(userId);
      updateUserCache(userId, compaction.ops);
      notifyOutboxChanged(userId);
      return compaction.compactedOp || incomingOp;
    }

    case 'cancelled': {
      // Find ops that were removed
      const remainingIds = new Set(compaction.ops.map((o) => o.opId));
      for (const op of existingOps) {
        if (!remainingIds.has(op.opId)) {
          await outboxStore.delete(op.opId);
        }
      }
      await tx.done;
      bumpMutationGen(userId);
      updateUserCache(userId, compaction.ops);
      notifyOutboxChanged(userId);
      return incomingOp;
    }

    case 'appended': {
      // If some prior ops were removed (e.g. updates superseded by a delete)
      const remainingIds = new Set(compaction.ops.map((o) => o.opId));
      for (const op of existingOps) {
        if (!remainingIds.has(op.opId)) {
          await outboxStore.delete(op.opId);
        }
      }
      await outboxStore.put(incomingOp);
      await metaStore.put(nextSeq, 'last_seq');
      await tx.done;
      bumpMutationGen(userId);
      updateUserCache(userId, compaction.ops);
      notifyOutboxChanged(userId);
      return incomingOp;
    }
  }
  });
}

async function readOpsFromDb(userId: string): Promise<OutboxOp[]> {
  const db = await getOfflineDb(userId);
  const allOps = await db.getAll('outbox');
  return allOps
    .filter((op) => op.userId === userId)
    .sort((a, b) => a.seq - b.seq);
}

export async function getOutboxOps(userId: string): Promise<OutboxOp[]> {
  if (!userId) return EMPTY_OPS;
  const currentGen = userMutationGen.get(userId) || 0;
  const existing = inFlightGetOps.get(userId);
  if (existing && existing.gen === currentGen) {
    return existing.promise;
  }

  let promise!: Promise<OutboxOp[]>;
  promise = (async () => {
    try {
      let attempts = 0;
      let lastSorted: OutboxOp[] = EMPTY_OPS;
      while (attempts < 3) {
        attempts++;
        const startGen = userMutationGen.get(userId) || 0;
        const sorted = await readOpsFromDb(userId);
        lastSorted = sorted;

        const endGen = userMutationGen.get(userId) || 0;
        if (endGen !== startGen) {
          // Mutation occurred during read: do not overwrite cache with stale result
          continue;
        }

        const current = userOpsCache.get(userId);
        const isDifferent =
          current === undefined
            ? sorted.length > 0
            : current.length !== sorted.length ||
              current.some((op, i) => op.opId !== sorted[i]?.opId || op.state !== sorted[i]?.state);

        updateUserCache(userId, sorted);

        if (isDifferent) {
          notifyOutboxChanged(userId);
        }

        return sorted;
      }

      return lastSorted;
    } finally {
      if (inFlightGetOps.get(userId)?.promise === promise) {
        inFlightGetOps.delete(userId);
      }
    }
  })();

  inFlightGetOps.set(userId, { promise, gen: currentGen });
  return promise;
}

export async function getOutboxSummary(userId: string): Promise<OutboxSummary> {
  const ops = await getOutboxOps(userId);
  return updateUserCache(userId, ops);
}

export async function updateOp(userId: string, op: OutboxOp): Promise<void> {
  const db = await getOfflineDb(userId);
  await db.put('outbox', op);
  bumpMutationGen(userId);
  const current = userOpsCache.get(userId);
  if (current) {
    const idx = current.findIndex((o) => o.opId === op.opId);
    if (idx !== -1) {
      const next = [...current];
      next[idx] = op;
      updateUserCache(userId, next);
    } else {
      updateUserCache(userId, [...current, op]);
    }
  } else {
    getOutboxOps(userId).catch((e) => {
      // Background outbox refresh after update: absorb closed-DB errors on teardown, warn otherwise
      if (!isDbClosedError(e)) {
        console.warn('[outbox] Failed to refresh outbox ops after updateOp', e);
      }
    });
  }
  notifyOutboxChanged(userId);
}

export async function deleteOp(userId: string, opId: string): Promise<void> {
  const db = await getOfflineDb(userId);
  await db.delete('outbox', opId);
  bumpMutationGen(userId);
  const current = userOpsCache.get(userId);
  if (current) {
    updateUserCache(userId, current.filter((op) => op.opId !== opId));
  } else {
    getOutboxOps(userId).catch((e) => {
      // Background outbox refresh after delete: absorb closed-DB errors on teardown, warn otherwise
      if (!isDbClosedError(e)) {
        console.warn('[outbox] Failed to refresh outbox ops after deleteOp', e);
      }
    });
  }
  notifyOutboxChanged(userId);
}

/**
 * Mark dependent ops as blocked when an op fails with a PERMANENT error.
 */
export async function blockDependentOps(userId: string, failedOp: OutboxOp): Promise<void> {
  const db = await getOfflineDb(userId);
  const tx = db.transaction('outbox', 'readwrite');
  const store = tx.store;
  const allOps = (await store.getAll())
    .filter((o) => o.userId === userId)
    .sort((a, b) => a.seq - b.seq);

  // Check if failedOp was workout.ensure or a set op
  const blockedWorkoutIds = new Set<string>();
  if (failedOp.kind === 'workout.ensure') {
    blockedWorkoutIds.add(failedOp.payload.clientWorkoutId);
  }

  const blockedSetIds = new Set<string>();
  if (failedOp.kind === 'set.create' || failedOp.kind === 'set.update') {
    blockedSetIds.add((failedOp.payload as { id: string }).id);
  } else if (failedOp.kind === 'set.batchCreate') {
    for (const s of failedOp.payload.sets) {
      blockedSetIds.add(s.id);
    }
  }

  for (const op of allOps) {
    if (op.seq <= failedOp.seq) continue;
    if (op.state === 'attention') continue;

    let isDependent = false;
    if (
      (op.kind === 'workout.rename' && blockedWorkoutIds.has(op.payload.workoutRef)) ||
      (op.kind === 'set.create' && blockedWorkoutIds.has(op.payload.workoutRef)) ||
      (op.kind === 'set.batchCreate' && blockedWorkoutIds.has(op.payload.workoutRef))
    ) {
      isDependent = true;
      if (op.kind === 'set.create') {
        blockedSetIds.add(op.payload.id);
      } else if (op.kind === 'set.batchCreate') {
        for (const s of op.payload.sets) {
          blockedSetIds.add(s.id);
        }
      }
    } else if (
      (op.kind === 'set.update' || op.kind === 'set.delete') &&
      blockedSetIds.has((op.payload as { id: string }).id)
    ) {
      isDependent = true;
    } else if (
      op.kind === 'set.batchCreate' &&
      op.payload.sets.some((s) => blockedSetIds.has(s.id))
    ) {
      isDependent = true;
    }

    if (isDependent) {
      op.state = 'attention';
      op.error = `blocked by ${failedOp.opId}`;
      op.blockedBy = failedOp.opId;
      await store.put(op);
    }
  }

  await tx.done;
  bumpMutationGen(userId);
  updateUserCache(userId, allOps);
  notifyOutboxChanged(userId);
}

/**
 * Retry an operation that is currently in attention.
 * Unblocks any ops that were blocked by this op.
 */
export async function retryOp(opId: string, userId: string): Promise<void> {
  const db = await getOfflineDb(userId);
  const tx = db.transaction('outbox', 'readwrite');
  const store = tx.store;
  const op = await store.get(opId);
  if (!op || op.userId !== userId) {
    await tx.done;
    return;
  }

  op.state = 'pending';
  delete op.error;
  delete op.blockedBy;
  op.attempts = 0;
  await store.put(op);

  // Also unblock dependent ops that were blocked by this op
  const allOps = await store.getAll();
  for (const other of allOps) {
    if (other.userId === userId && other.blockedBy === opId) {
      other.state = 'pending';
      delete other.error;
      delete other.blockedBy;
      await store.put(other);
    }
  }

  await tx.done;
  bumpMutationGen(userId);
  updateUserCache(userId, allOps.filter((o) => o.userId === userId));
  notifyOutboxChanged(userId);
}

/**
 * Discard an operation that is in attention.
 * If other ops were blocked by it, unblock them so they can be attempted or evaluated.
 */
export async function discardOp(opId: string, userId: string): Promise<void> {
  const db = await getOfflineDb(userId);
  const tx = db.transaction('outbox', 'readwrite');
  const store = tx.store;
  const op = await store.get(opId);
  if (!op || op.userId !== userId) {
    await tx.done;
    return;
  }

  await store.delete(opId);

  // Unblock dependent ops so they can be processed or re-evaluated
  const allOps = await store.getAll();
  for (const other of allOps) {
    if (other.userId === userId && other.blockedBy === opId) {
      other.state = 'pending';
      delete other.error;
      delete other.blockedBy;
      await store.put(other);
    }
  }

  await tx.done;
  bumpMutationGen(userId);
  updateUserCache(userId, allOps.filter((o) => o.userId === userId));
  notifyOutboxChanged(userId);
}
