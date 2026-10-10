import { deleteOfflineDb } from '../offline/db';
import type { QueryClient } from '@tanstack/react-query';

export interface WipeUserDataOptions {
  queryClient?: QueryClient;
}

/**
 * Wipes all client-side cached and persisted data for the specified user.
 * 1. Closes and deletes the user's IndexedDB database (`yourbody-offline-${userId}`).
 * 2. Clears the in-memory React Query cache.
 * 3. Removes user-scoped and session `yourbody_*` localStorage keys,
 *    preserving keys belonging to other users or third-party applications.
 */
export async function wipeUserData(userId: string, options?: WipeUserDataOptions): Promise<void> {
  if (!userId) return;

  // 1. Delete user-specific IndexedDB database
  try {
    await deleteOfflineDb(userId);
  } catch (err) {
    console.warn('[wipeUserData] Failed to delete offline database:', err);
  }

  // 2. Clear React Query client cache
  if (options?.queryClient) {
    try {
      options.queryClient.clear();
    } catch (err) {
      console.warn('[wipeUserData] Failed to clear query client cache:', err);
    }
  }

  // 3. Clear localStorage keys scoped to this user and current session
  if (typeof localStorage !== 'undefined') {
    try {
      const keysToRemove: string[] = [];
      const totalKeys = localStorage.length;

      for (let i = 0; i < totalKeys; i++) {
        const key = localStorage.key(i);
        if (!key) continue;

        if (key.startsWith('yourbody_')) {
          const isUserScoped = key.includes(userId);
          const isSessionKey =
            key === 'yourbody_user' ||
            key === 'yourbody_view_mode' ||
            key === 'yourbody_auto_rest_timer' ||
            key === 'yourbody_extra_custom_key';

          // Preserve keys explicitly tagged with a different user identifier (e.g. UUID)
          const hasDifferentUuid = !isUserScoped && /[a-f0-9-]{36}/i.test(key);

          if (isUserScoped || (isSessionKey && !hasDifferentUuid)) {
            keysToRemove.push(key);
          }
        }
      }

      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
    } catch (err) {
      console.warn('[wipeUserData] Failed to clear localStorage keys:', err);
    }
  }
}
