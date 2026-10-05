import { supabase } from '../lib/supabase';
import { isDbClosedError } from './db';
import {
  enqueue as outboxEnqueue,
  getOutboxOps,
  deleteOp,
  updateOp,
  blockDependentOps,
  setSyncingStatus,
  setAuthRequiredStatus,
  setLastSyncedCount,
  subscribeToOutbox,
} from './outbox';
import { executeReplayOp } from './replay';
import { classifyError } from './classify';
import { setIdMapping } from './idmap';
import type {
  OpKind,
  OpPayloadMap,
  EnqueueAndAwaitOptions,
  EnqueueAndAwaitResult,
} from './types';

// In-tab mutex fallback when navigator.locks is unavailable
const userMutexes = new Map<string, Promise<void>>();

export function getOutboxLockName(userId: string): string {
  return `yourbody-outbox-${userId}`;
}

async function runWithMutex(userId: string, fn: () => Promise<void>): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    try {
      return await navigator.locks.request(getOutboxLockName(userId), fn);
    } catch (lockErr) {
      console.warn('[flusher] navigator.locks.request failed, using in-tab fallback:', lockErr);
    }
  }

  // Fallback: in-tab promise mutex
  const prev = userMutexes.get(userId) || Promise.resolve();
  let release: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  userMutexes.set(userId, prev.catch(() => {}).then(() => current));

  try {
    await prev;
    await fn();
  } finally {
    release!();
  }
}

// Synced event subscribers
const syncedListeners = new Set<(count: number) => void>();

export function onSynced(callback: (count: number) => void): () => void {
  syncedListeners.add(callback);
  return () => {
    syncedListeners.delete(callback);
  };
}

function emitSynced(count: number): void {
  for (const listener of syncedListeners) {
    try {
      listener(count);
    } catch (e) {
      console.error('[flusher] onSynced listener error:', e);
    }
  }
}

let activeUserId: string | null = null;
let flusherSessionUserId: string | null = null;
let activeSupabaseClient: any = supabase;
let backoffTimer: any = null;
let retryAttempts = 0;

export function setFlusherSupabaseClient(client: any): void {
  activeSupabaseClient = client;
}

export function getFlusherSupabaseClient(): any {
  return activeSupabaseClient;
}

export function setFlusherSessionUser(userId: string | null): void {
  flusherSessionUserId = userId;
  activeUserId = userId;
  if (!userId) {
    if (backoffTimer) {
      clearTimeout(backoffTimer);
      backoffTimer = null;
    }
    retryAttempts = 0;
  }
}

export function getFlusherSessionUser(): string | null {
  return flusherSessionUserId;
}

export function setActiveUserForFlusher(userId: string | null): void {
  activeUserId = userId;
  flusherSessionUserId = userId;
  if (!userId) {
    if (backoffTimer) {
      clearTimeout(backoffTimer);
      backoffTimer = null;
    }
    retryAttempts = 0;
  }
}

export function resetFlusherForTesting(): void {
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
  retryAttempts = 0;
  syncedListeners.clear();
  userMutexes.clear();
  activeUserId = null;
  flusherSessionUserId = null;
  activeSupabaseClient = supabase;
}

export function getActiveUserId(): string | null {
  return activeUserId;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Flush all pending outbox operations for a user in strict seq order.
 * Enforces outbox owner verification and navigator.locks concurrency control.
 */
export async function flushNow(targetUserId?: string, callerOpId?: string): Promise<number> {
  const userId = targetUserId || activeUserId;
  if (!userId) return 0;

  let totalSynced = 0;

  await runWithMutex(userId, async () => {
    // 1. Owner check: verify current authenticated user matches userId
    let sessionUser: string | null = null;
    try {
      const {
        data: { session },
      } = await activeSupabaseClient.auth.getSession();
      sessionUser = session?.user?.id || null;
    } catch {
      // Cannot verify session from supabase client
    }
    if (!sessionUser) {
      sessionUser = flusherSessionUserId;
    }

    if (!sessionUser || sessionUser !== userId) {
      // Owner check failed: do not flush!
      return;
    }

    // 2. Fetch pending ops
    const ops = await getOutboxOps(userId);
    const pendingOps = ops.filter((o) => o.state === 'pending' || o.state === 'inflight');
    if (pendingOps.length === 0) {
      return;
    }

    setSyncingStatus(true);
    let syncedThisRun = 0;
    const syncedOpIds = new Set<string>();

    try {
      for (const op of pendingOps) {
        if (op.state === 'attention' || op.blockedBy) {
          continue;
        }

        op.state = 'inflight';
        await updateOp(userId, op);

        try {
          const result = await executeReplayOp(op, activeSupabaseClient);
          if (result.canonicalId && op.kind === 'workout.ensure') {
            await setIdMapping(userId, op.payload.clientWorkoutId, result.canonicalId);
          }

          // Delete completed op from IDB
          await deleteOp(userId, op.opId);
          syncedThisRun++;
          syncedOpIds.add(op.opId);
          retryAttempts = 0;
          setAuthRequiredStatus(false);
        } catch (rawError: any) {
          const classified = classifyError(rawError);

          if (classified.kind === 'TRANSIENT') {
            op.state = 'pending';
            op.attempts = (op.attempts || 0) + 1;
            await updateOp(userId, op);

            // Backoff: 2s..5min with jitter
            retryAttempts++;
            const baseDelay = Math.min(300000, 2000 * Math.pow(2, Math.min(retryAttempts - 1, 7)));
            const jitter = Math.random() * 1000;
            const delay = baseDelay + jitter;

            if (backoffTimer) clearTimeout(backoffTimer);
            backoffTimer = setTimeout(() => {
              flushNow(userId).catch((e) => {
                // Background retry may encounter closed DB during teardown; absorb closed-DB, warn otherwise
                if (!isDbClosedError(e)) {
                  console.warn('[flusher] Background flush retry failed', e);
                }
              });
            }, delay);

            break; // Stop flushing on transient failure
          } else if (classified.kind === 'AUTH') {
            if (classified.isInvalidRefreshToken) {
              setAuthRequiredStatus(true);
              op.state = 'pending';
              await updateOp(userId, op);
              break;
            }

            // Try refreshSession once
            let refreshSuccess = false;
            try {
              const { error: refErr } = await activeSupabaseClient.auth.refreshSession();
              if (!refErr) {
                refreshSuccess = true;
                setAuthRequiredStatus(false);
              } else {
                const refClassified = classifyError(refErr);
                if (refClassified.isInvalidRefreshToken) {
                  setAuthRequiredStatus(true);
                }
              }
            } catch (refEx) {
              const refClassified = classifyError(refEx);
              if (refClassified.isInvalidRefreshToken) {
                setAuthRequiredStatus(true);
              }
            }

            if (refreshSuccess) {
              // Retry current op once with refreshed session
              try {
                const result = await executeReplayOp(op, activeSupabaseClient);
                if (result.canonicalId && op.kind === 'workout.ensure') {
                  await setIdMapping(userId, op.payload.clientWorkoutId, result.canonicalId);
                }
                await deleteOp(userId, op.opId);
                syncedThisRun++;
                retryAttempts = 0;
                setAuthRequiredStatus(false);
                continue;
              } catch (retryErr: any) {
                const secondClassified = classifyError(retryErr);
                if (secondClassified.kind === 'PERMANENT') {
                  op.state = 'attention';
                  op.error = secondClassified.reason;
                  await updateOp(userId, op);
                  await blockDependentOps(userId, op);
                  continue;
                } else {
                  op.state = 'pending';
                  await updateOp(userId, op);
                  break;
                }
              }
            } else {
              op.state = 'pending';
              await updateOp(userId, op);
              break;
            }
          } else if (classified.kind === 'PERMANENT') {
            op.state = 'attention';
            op.error = rawError?.message || classified.reason;
            await updateOp(userId, op);
            await blockDependentOps(userId, op);
            // Continue with independent later ops
          }
        }
      }
    } finally {
      setSyncingStatus(false);
      totalSynced = syncedThisRun;
      if (syncedThisRun > 0) {
        setLastSyncedCount(syncedThisRun);
        // If this flush was triggered by enqueueAndAwait for a specific callerOpId,
        // only emit onSynced for previously queued ops if callerOpId was actually synced in this run.
        // Otherwise, emit for all synced ops.
        const queuedCountToEmit =
          callerOpId && syncedOpIds.has(callerOpId) ? syncedThisRun - 1 : syncedThisRun;
        if (queuedCountToEmit > 0) {
          emitSynced(queuedCountToEmit);
        }
      }
    }
  });

  return totalSynced;
}

/**
 * Enqueue an op and await its immediate sync if online.
 * Timeout falls back to queued status without error.
 * PERMANENT error while online removes op and throws original error.
 */
export async function enqueueAndAwait<K extends OpKind>(
  input: {
    userId: string;
    kind: K;
    payload: OpPayloadMap[K];
  },
  options: EnqueueAndAwaitOptions = {}
): Promise<EnqueueAndAwaitResult> {
  const { timeoutMs = 8000 } = options;
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  const enqueuedOp = await outboxEnqueue(input);

  if (!isOnline) {
    return { status: 'queued', opId: enqueuedOp.opId };
  }

  // Trigger flush immediately with callerOpId
  flushNow(input.userId, enqueuedOp.opId).catch((e) => {
    // Immediate flush may encounter closed DB during teardown; absorb closed-DB, warn otherwise
    if (!isDbClosedError(e)) {
      console.warn('[flusher] Immediate flush failed', e);
    }
  });

  // Wait for op to be deleted (synced), put in attention, or timeout
  return new Promise<EnqueueAndAwaitResult>((resolve, reject) => {
    let resolved = false;

    const cleanupTimer = setTimeout(async () => {
      if (resolved) return;
      resolved = true;
      unsubscribe();
      resolve({ status: 'queued', opId: enqueuedOp.opId });
    }, timeoutMs);

    const unsubscribe = subscribeToOutbox(async () => {
      if (resolved) return;
      const ops = await getOutboxOps(input.userId);
      const currentOp = ops.find((o) => o.opId === enqueuedOp.opId);

      if (!currentOp) {
        // Op is no longer in outbox -> synced successfully!
        resolved = true;
        clearTimeout(cleanupTimer);
        unsubscribe();
        resolve({ status: 'synced', opId: enqueuedOp.opId });
        return;
      }

      if (currentOp.state === 'attention') {
        resolved = true;
        clearTimeout(cleanupTimer);
        unsubscribe();

        // Remove op so existing inline error + kept input behave exactly as today
        await deleteOp(input.userId, currentOp.opId);
        reject(new Error(currentOp.error || 'Operation failed permanently'));
      }
    });
  });
}

// Global lifecycle listener for online reconnect
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    retryAttempts = 0;
    flushNow().catch((e) => {
      // Reconnect flush may encounter closed DB during teardown; absorb closed-DB, warn otherwise
      if (!isDbClosedError(e)) {
        console.warn('[flusher] Online reconnect flush failed', e);
      }
    });
  });
}
