import { getOfflineDb, isDbClosedError } from './db';
import { getActiveUserId } from './flusher';
import { onSynced } from './flusher';
import type {
  AiQueueItem,
  EnqueueAiItemInput,
  AiQueueState,
  AiQueueCounts,
} from './types';

export const MAX_PHOTO_BASE64_BYTES = 4 * 1024 * 1024; // 4 MB
export const AI_RATE_LIMIT_MS = 5000; // >= 5 s between calls
export const DEFAULT_429_RETRY_AFTER_SECONDS = 15;
export const MIN_BACKOFF_MS = 30 * 1000; // 30 s
export const MAX_BACKOFF_MS = 30 * 60 * 1000; // 30 min

export class AiPhotoTooLargeError extends Error {
  readonly code = 'PHOTO_TOO_LARGE';
  constructor(sizeBytes: number, maxBytes: number = MAX_PHOTO_BASE64_BYTES) {
    super(`Photo base64 size (${sizeBytes} bytes) exceeds maximum allowed ${maxBytes} bytes`);
    this.name = 'AiPhotoTooLargeError';
  }
}

// In-tab mutex fallback for AI queue
const aiUserMutexes = new Map<string, Promise<void>>();

export function getAiQueueLockName(userId: string): string {
  return `yourbody-aiq-${userId}`;
}

export async function runWithAiMutex(userId: string, fn: () => Promise<void>): Promise<void> {
  const lockName = getAiQueueLockName(userId);
  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    try {
      return await navigator.locks.request(lockName, fn);
    } catch (lockErr) {
      console.warn('[aiQueue] navigator.locks.request failed, using in-tab fallback:', lockErr);
    }
  }

  const prev = aiUserMutexes.get(userId) || Promise.resolve();
  let release: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  aiUserMutexes.set(userId, prev.catch(() => {}).then(() => current));

  try {
    await prev;
    await fn();
  } finally {
    release!();
  }
}

// Subscriptions & cache
const aiSubscribers = new Map<string, Set<() => void>>();
const aiItemsCache = new Map<string, AiQueueItem[]>();

function computeCounts(items: AiQueueItem[]): AiQueueCounts {
  const counts: AiQueueCounts = {
    queued: 0,
    analyzing: 0,
    ready: 0,
    failed: 0,
    total: items.length,
  };
  for (const item of items) {
    if (item.status === 'queued') counts.queued++;
    else if (item.status === 'analyzing') counts.analyzing++;
    else if (item.status === 'ready') counts.ready++;
    else if (item.status === 'failed') counts.failed++;
  }
  return counts;
}

export function getCachedAiQueue(userId: string): AiQueueState {
  const items = aiItemsCache.get(userId) || [];
  const counts = computeCounts(items);
  const isAnalyzing = counts.analyzing > 0;
  return {
    items: [...items],
    counts,
    isAnalyzing,
  };
}

export function subscribeToAiQueue(callback: () => void, userId: string): () => void {
  if (!userId) return () => {};
  let set = aiSubscribers.get(userId);
  if (!set) {
    set = new Set();
    aiSubscribers.set(userId, set);
  }
  set.add(callback);
  return () => {
    set?.delete(callback);
    if (set && set.size === 0) {
      aiSubscribers.delete(userId);
    }
  };
}

export function notifyAiQueueChanged(userId: string): void {
  const set = aiSubscribers.get(userId);
  if (set) {
    for (const callback of set) {
      try {
        callback();
      } catch (err) {
        console.error('[aiQueue] Subscriber error:', err);
      }
    }
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'aiq-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

export async function enqueueAiItem(input: EnqueueAiItemInput): Promise<AiQueueItem> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('AI needs a connection: use quick log');
  }

  if (input.photo?.base64 && input.photo.base64.length > MAX_PHOTO_BASE64_BYTES) {
    throw new AiPhotoTooLargeError(input.photo.base64.length, MAX_PHOTO_BASE64_BYTES);
  }

  const id = input.id || generateId();
  const item: AiQueueItem = {
    id,
    userId: input.userId,
    kind: input.kind,
    text: input.text,
    photo: input.photo ? { base64: input.photo.base64, mime: input.photo.mime } : undefined,
    capturedAt: input.capturedAt,
    captureDate: input.captureDate,
    mealType: input.mealType,
    status: 'queued',
    attempts: 0,
    nextAttemptAt: Date.now(),
  };

  const db = await getOfflineDb(input.userId);
  await db.put('aiq', item);

  // Update in-memory cache
  const existing = aiItemsCache.get(input.userId) || [];
  aiItemsCache.set(input.userId, [...existing.filter((it) => it.id !== item.id), item]);

  notifyAiQueueChanged(input.userId);
  return item;
}

export async function listAiItems(userId: string): Promise<AiQueueItem[]> {
  if (!userId) return [];
  try {
    const db = await getOfflineDb(userId);
    const all = await db.getAll('aiq');
    // Sort by capturedAt ascending
    all.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    aiItemsCache.set(userId, all);
    return all;
  } catch (err) {
    if (!isDbClosedError(err)) {
      console.warn('[aiQueue] Failed to list AI items:', err);
    }
    return aiItemsCache.get(userId) || [];
  }
}

export async function discardAiItem(userId: string, id: string): Promise<void> {
  if (!userId || !id) return;
  try {
    const db = await getOfflineDb(userId);
    await db.delete('aiq', id);
    const existing = aiItemsCache.get(userId) || [];
    aiItemsCache.set(userId, existing.filter((item) => item.id !== id));
    notifyAiQueueChanged(userId);
  } catch (err) {
    if (!isDbClosedError(err)) {
      console.warn('[aiQueue] Failed to discard AI item:', err);
    }
    throw err;
  }
}

export async function markReviewed(userId: string, id: string): Promise<void> {
  return discardAiItem(userId, id);
}

export async function deleteAfterLog(userId: string, id: string): Promise<void> {
  return discardAiItem(userId, id);
}

export async function resetStuckAnalyzingItems(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const db = await getOfflineDb(userId);
    const all = await db.getAll('aiq');
    const stuck = all.filter((item) => item.status === 'analyzing');
    if (stuck.length > 0) {
      const tx = db.transaction('aiq', 'readwrite');
      for (const item of stuck) {
        item.status = 'queued';
        await tx.store.put(item);
      }
      await tx.done;
      // Refresh cache
      await listAiItems(userId);
      notifyAiQueueChanged(userId);
    }
  } catch (err) {
    if (!isDbClosedError(err)) {
      console.warn('[aiQueue] Failed to reset stuck analyzing items:', err);
    }
  }
}

export interface AiProcessorOptions {
  userId: string;
  analyze: (item: AiQueueItem) => Promise<unknown>;
}

// Replay path for existing IndexedDB AI queue items is kept for backwards compatibility
// with older clients that have queued items, and is scheduled for removal in a later release.
export function startAiQueueProcessor(options: AiProcessorOptions): () => void {
  const { userId, analyze } = options;
  let isStopped = false;
  let runningPromise: Promise<void> | null = null;
  let lastAnalyzeTimestamp = 0;
  let scheduleTimer: ReturnType<typeof setTimeout> | null = null;

  const checkIsOnline = (): boolean => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  };

  const scheduleNext = (delayMs = 0) => {
    if (isStopped) return;
    if (scheduleTimer) {
      clearTimeout(scheduleTimer);
      scheduleTimer = null;
    }
    scheduleTimer = setTimeout(() => {
      void runCycle();
    }, delayMs);
  };

  const runCycle = async (): Promise<void> => {
    if (isStopped) return;
    if (runningPromise) return;

    runningPromise = runWithAiMutex(userId, async () => {
      if (isStopped) return;

      // 1. Owner check: active user must match
      const activeUser = getActiveUserId();
      if (activeUser && activeUser !== userId) {
        return;
      }

      // 2. Connectivity check
      if (!checkIsOnline()) {
        return;
      }

      // 3. Reset stuck analyzing items on startup / cycle start
      await resetStuckAnalyzingItems(userId);
      if (isStopped) return;

      // 4. Fetch queued items eligible for processing
      let items: AiQueueItem[];
      try {
        items = await listAiItems(userId);
      } catch (err) {
        if (!isDbClosedError(err)) {
          console.warn('[aiQueue] Failed to list items in processor:', err);
        }
        return;
      }

      const now = Date.now();
      const eligibleItems = items
        .filter((item) => item.status === 'queued' && (item.nextAttemptAt || 0) <= now)
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

      if (eligibleItems.length === 0) {
        // If there are future queued items, schedule next check
        const futureItems = items.filter((item) => item.status === 'queued' && (item.nextAttemptAt || 0) > now);
        if (futureItems.length > 0) {
          const earliest = Math.min(...futureItems.map((item) => item.nextAttemptAt));
          scheduleNext(Math.max(100, earliest - Date.now()));
        }
        return;
      }

      // 5. Process sequentially
      for (const item of eligibleItems) {
        if (isStopped) break;

        const currentActive = getActiveUserId();
        if (currentActive && currentActive !== userId) break;
        if (!checkIsOnline()) break;

        // Rate limit: ensure >= 5 s between calls
        const elapsedSinceLast = Date.now() - lastAnalyzeTimestamp;
        if (elapsedSinceLast < AI_RATE_LIMIT_MS) {
          const waitMs = AI_RATE_LIMIT_MS - elapsedSinceLast;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        if (isStopped) break;

        // Transition to 'analyzing'
        try {
          const db = await getOfflineDb(userId);
          const current = await db.get('aiq', item.id);
          if (!current || current.status !== 'queued') {
            continue;
          }
          current.status = 'analyzing';
          await db.put('aiq', current);
          await listAiItems(userId);
          notifyAiQueueChanged(userId);
        } catch (err) {
          if (!isDbClosedError(err)) {
            console.warn('[aiQueue] Failed to transition to analyzing:', err);
          }
          continue;
        }

        lastAnalyzeTimestamp = Date.now();

        try {
          const result = await analyze(item);

          if (isStopped) break;

          // Success: store result AND delete photo field in SAME IDB transaction
          const db = await getOfflineDb(userId);
          const tx = db.transaction('aiq', 'readwrite');
          const stored = await tx.store.get(item.id);
          if (stored) {
            stored.status = 'ready';
            stored.result = result;
            delete stored.photo;
            await tx.store.put(stored);
          }
          await tx.done;

          await listAiItems(userId);
          notifyAiQueueChanged(userId);
        } catch (error: any) {
          if (isStopped) break;

          const errStatus = Number(error?.status || error?.statusCode || 0);
          const errCode = String(error?.code || '');
          const errMsg = String(error?.message || '');

          try {
            const db = await getOfflineDb(userId);
            const stored = await db.get('aiq', item.id);
            if (!stored) continue;

            if (errStatus === 429) {
              // 429: Retry-After, NO attempt burn
              let retryAfterSec = DEFAULT_429_RETRY_AFTER_SECONDS;
              if (typeof error?.retryAfter === 'number' && Number.isFinite(error.retryAfter)) {
                retryAfterSec = error.retryAfter;
              } else if (error?.headers?.get && typeof error.headers.get === 'function') {
                const headerVal = Number(error.headers.get('Retry-After'));
                if (Number.isFinite(headerVal) && headerVal > 0) {
                  retryAfterSec = headerVal;
                }
              }

              stored.status = 'queued';
              stored.nextAttemptAt = Date.now() + retryAfterSec * 1000;
              stored.lastError = errMsg || 'Rate limited';
              await db.put('aiq', stored);
              await listAiItems(userId);
              notifyAiQueueChanged(userId);

              // Pause processing until retryAfterSec
              scheduleNext(retryAfterSec * 1000);
              break;
            } else if (
              errStatus === 422 ||
              errCode === 'NON_FOOD' ||
              (errStatus >= 400 && errStatus < 500 && errStatus !== 408)
            ) {
              // 4xx validation / NON_FOOD -> status 'failed'
              stored.status = 'failed';
              stored.lastError = errMsg || 'Validation error';
              await db.put('aiq', stored);
              await listAiItems(userId);
              notifyAiQueueChanged(userId);
            } else {
              // 5xx / timeout / network -> exponential backoff 30s..30min unlimited retries
              stored.attempts = (stored.attempts || 0) + 1;
              const backoffMs = Math.min(
                MAX_BACKOFF_MS,
                MIN_BACKOFF_MS * Math.pow(2, stored.attempts - 1)
              );
              stored.status = 'queued';
              stored.nextAttemptAt = Date.now() + backoffMs;
              stored.lastError = errMsg || 'Transient server or network error';
              await db.put('aiq', stored);
              await listAiItems(userId);
              notifyAiQueueChanged(userId);
            }
          } catch (storageErr) {
            if (!isDbClosedError(storageErr)) {
              console.warn('[aiQueue] Error updating status on failure:', storageErr);
            }
          }
        }
      }
    }).finally(() => {
      runningPromise = null;
    });

    try {
      await runningPromise;
    } catch (cycleErr) {
      if (!isDbClosedError(cycleErr)) {
        console.warn('[aiQueue] Unhandled processor cycle error:', cycleErr);
      }
    }
  };

  // Event handlers
  const handleOnline = () => {
    scheduleNext(0);
  };

  const handleVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      scheduleNext(0);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }

  // Trigger on flush sync
  const unsubscribeSynced = onSynced(() => {
    scheduleNext(0);
  });

  // Initial trigger at app start
  scheduleNext(0);

  return () => {
    isStopped = true;
    if (scheduleTimer) {
      clearTimeout(scheduleTimer);
      scheduleTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
    unsubscribeSynced();
  };
}
