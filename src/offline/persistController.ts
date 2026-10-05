import type { QueryClient } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from '@tanstack/react-query-persist-client';
import {
  createIdbPersister,
  shouldDehydrateQuery,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE_MS,
  WHITELIST_ROOTS,
} from './persister';
import { clearUserRqStore, isDbClosedError } from './db';
import { setActiveUserForFlusher } from './flusher';
import { loadIdMappings } from './idmap';
import { getOutboxOps } from './outbox';

let currentPersistingUserId: string | null = null;
let currentPersistingQueryClient: QueryClient | null = null;
let unsubscribePersist: (() => void) | null = null;
let persistSessionId = 0;

/**
 * Configure 8-day gcTime for all whitelisted offline query families.
 */
export function setupQueryDefaults(queryClient: QueryClient): void {
  for (const root of WHITELIST_ROOTS) {
    queryClient.setQueryDefaults([root], {
      gcTime: PERSIST_MAX_AGE_MS,
    });
  }
}

/**
 * Initialize persistence for an authenticated user.
 * - Stops persisting previous user
 * - Clears memory queryClient on user switch to ensure cross-user isolation
 * - Restores persisted state from IndexedDB yourbody-offline-<userId>
 * - Subscribes queryClient to auto-save whitelisted queries
 */
export async function initPersistForUser(
  userId: string,
  queryClient: QueryClient
): Promise<void> {
  if (!userId) return;
  if (currentPersistingUserId === userId && currentPersistingQueryClient === queryClient && unsubscribePersist) {
    return;
  }

  // If switching from another user on the same query client, stop persisting and clear in-memory cache
  if (currentPersistingUserId && currentPersistingUserId !== userId) {
    if (currentPersistingQueryClient === queryClient) {
      queryClient.clear();
    }
    stopPersisting();
  } else if (unsubscribePersist) {
    stopPersisting();
  }

  const thisSession = ++persistSessionId;
  currentPersistingUserId = userId;
  currentPersistingQueryClient = queryClient;
  setActiveUserForFlusher(userId);

  // Pre-load ID mappings and outbox cache for fast sync lookups and UI readiness
  try {
    await loadIdMappings(userId);
    if (persistSessionId !== thisSession) return;
    await getOutboxOps(userId);
    if (persistSessionId !== thisSession) return;
  } catch (e) {
    if (persistSessionId !== thisSession) return;
    // Pre-loading ID mappings / outbox may fail if DB is closing during teardown; absorb closed-DB, warn otherwise
    if (!isDbClosedError(e)) {
      console.warn('[persistController] Failed to load ID mappings / outbox:', e);
    }
  }

  if (persistSessionId !== thisSession) return;

  const persister = createIdbPersister(userId);

  // Restore client from IDB
  try {
    await persistQueryClientRestore({
      queryClient,
      persister,
      maxAge: PERSIST_MAX_AGE_MS,
      buster: PERSIST_BUSTER,
    });
  } catch (restoreErr) {
    if (persistSessionId !== thisSession) return;
    // Restoring read cache may fail if DB is closing during teardown; absorb closed-DB, warn otherwise
    if (!isDbClosedError(restoreErr)) {
      console.warn('[persistController] Failed to restore persisted client:', restoreErr);
    }
  }

  if (persistSessionId !== thisSession) return;

  // Subscribe to cache updates
  unsubscribePersist = persistQueryClientSubscribe({
    queryClient,
    persister,
    buster: PERSIST_BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery,
    },
  });
}

/**
 * Stop persisting cache to IndexedDB and unsubscribe event listeners.
 */
export function stopPersisting(): void {
  persistSessionId++;
  if (unsubscribePersist) {
    try {
      unsubscribePersist();
    } catch (err) {
      // Unsubscribing persister may fail if subscriber callback encounters closed DB; absorb closed-DB, warn otherwise
      if (!isDbClosedError(err)) {
        console.warn('[persistController] Error during unsubscribePersist:', err);
      }
    }
    unsubscribePersist = null;
  }
  currentPersistingUserId = null;
  currentPersistingQueryClient = null;
  setActiveUserForFlusher(null);
}

/**
 * Delete a user's persisted read cache (`rq` store in IndexedDB) while keeping outbox and idmap.
 */
export async function clearUserReadCache(userId: string): Promise<void> {
  await clearUserRqStore(userId);
}

export function getCurrentPersistingUserId(): string | null {
  return currentPersistingUserId;
}
