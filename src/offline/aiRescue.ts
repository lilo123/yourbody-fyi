import { getOfflineDb, isDbClosedError } from './db';
import type { LegacyAiQueueItem } from './types';

export interface ReadLegacyAiQueueResult {
  text: string;
  ids: string[];
}

export interface RescueLegacyAiQueueOptions {
  userId: string;
  canRescue: () => boolean;
  onCommitText?: (text: string) => boolean | void;
}

/**
 * Reads eligible legacy queued AI items from the offline IndexedDB store 'aiq'.
 *
 * Rules:
 * 1. Skips items whose userId is set and does not match the active userId (defense in depth).
 * 2. Skips items with empty or photo-only text (never delete items whose text was not written).
 * 3. Preserves chronological order (sorted by capturedAt).
 * 4. Joins non-empty texts with double newline ('\n\n').
 * 5. Returns the combined text and the exact array of item IDs that produced that text.
 */
export async function readLegacyAiQueueLeftovers(
  userId: string
): Promise<ReadLegacyAiQueueResult | null> {
  if (!userId || typeof indexedDB === 'undefined') return null;

  try {
    const db = await getOfflineDb(userId);
    if (!db.objectStoreNames.contains('aiq')) return null;

    const items: LegacyAiQueueItem[] = await db.getAll('aiq');
    if (!items || items.length === 0) return null;

    // Defense in depth: skip items whose userId is set and differs from the active user id.
    // Also skip photo-only / empty-text items (never delete items whose text was not written).
    const eligible = items.filter((item) => {
      if (item.userId && item.userId !== userId) return false;
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      return text.length > 0;
    });

    if (eligible.length === 0) return null;

    // Sort by capturedAt ascending if available to preserve chronological order
    eligible.sort((first, second) => {
      const firstTime = first.capturedAt || '';
      const secondTime = second.capturedAt || '';
      return firstTime.localeCompare(secondTime);
    });

    const texts: string[] = [];
    const ids: string[] = [];
    for (const item of eligible) {
      const text = (item.text || '').trim();
      if (text.length > 0) {
        texts.push(text);
        ids.push(item.id);
      }
    }

    if (texts.length === 0) return null;

    return {
      text: texts.join('\n\n'),
      ids,
    };
  } catch (err) {
    if (!isDbClosedError(err)) {
      console.warn('[aiRescue] Failed to read legacy queued AI items:', err);
    }
    return null;
  }
}

/**
 * Deletes exactly the specified legacy item IDs from 'aiq'.
 * Only called after the text has been successfully written into the input.
 */
export async function deleteLegacyAiQueueItems(
  userId: string,
  ids: string[]
): Promise<void> {
  if (!userId || !ids.length || typeof indexedDB === 'undefined') return;

  try {
    const db = await getOfflineDb(userId);
    if (!db.objectStoreNames.contains('aiq')) return;

    const tx = db.transaction('aiq', 'readwrite');
    for (const id of ids) {
      await tx.store.delete(id);
    }
    await tx.done;
  } catch (err) {
    if (!isDbClosedError(err)) {
      console.warn('[aiRescue] Failed to delete rescued legacy AI items:', err);
    }
  }
}

/**
 * High-level orchestration for legacy AI rescue:
 * 1. Read candidate items.
 * 2. If canRescue() is still true, optionally invoke onCommitText(text).
 * 3. If onCommitText succeeds (or is omitted), delete EXACTLY the ids whose text was written.
 * Otherwise, delete nothing.
 */
export async function rescueLegacyAiQueue(
  options: RescueLegacyAiQueueOptions
): Promise<string | null> {
  const { userId, canRescue, onCommitText } = options;
  if (!userId || typeof indexedDB === 'undefined') return null;
  if (!canRescue()) return null;

  try {
    const result = await readLegacyAiQueueLeftovers(userId);
    if (!result) return null;

    // Verify canRescue() again after async read before writing or deleting
    if (!canRescue()) return null;

    if (onCommitText) {
      const outcome = onCommitText(result.text);
      if (outcome === false) return null;
    }

    // THEN delete exactly the ids whose text was written
    await deleteLegacyAiQueueItems(userId, result.ids);
    return result.text;
  } catch (err) {
    if (!isDbClosedError(err)) {
      console.warn('[aiRescue] Failed to rescue legacy queued AI items:', err);
    }
    return null;
  }
}

/**
 * Helper to inspect legacy AI queue items in testing or diagnostics.
 */
export async function getLegacyAiQueueItems(userId: string): Promise<LegacyAiQueueItem[]> {
  if (!userId || typeof indexedDB === 'undefined') return [];
  try {
    const db = await getOfflineDb(userId);
    if (!db.objectStoreNames.contains('aiq')) return [];
    return await db.getAll('aiq');
  } catch {
    return [];
  }
}
