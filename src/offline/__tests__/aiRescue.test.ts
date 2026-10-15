import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getOfflineDb, deleteOfflineDb, closeAllOfflineDbs } from '../db';
import {
  rescueLegacyAiQueue,
  readLegacyAiQueueLeftovers,
  deleteLegacyAiQueueItems,
  getLegacyAiQueueItems,
} from '../aiRescue';
import { enqueue, getOutboxOps } from '../outbox';
import type { LegacyAiQueueItem } from '../types';

describe('Legacy AI Queue Rescue (aiRescue)', () => {
  const userA = 'user-ai-rescue-a';
  const userB = 'user-ai-rescue-b';

  beforeEach(async () => {
    await closeAllOfflineDbs();
    await deleteOfflineDb(userA);
    await deleteOfflineDb(userB);
  });

  afterEach(async () => {
    await closeAllOfflineDbs();
    await deleteOfflineDb(userA);
    await deleteOfflineDb(userB);
  });

  it('leftover legacy item -> text rescued + queue emptied of it', async () => {
    const db = await getOfflineDb(userA);
    const legacyItem: LegacyAiQueueItem = {
      id: 'legacy-item-1',
      userId: userA,
      kind: 'text',
      text: '2 scrambled eggs and 1 slice toast',
      capturedAt: '2026-10-01T08:00:00.000Z',
      captureDate: '2026-10-01',
      status: 'queued',
      attempts: 0,
    };
    await db.put('aiq', legacyItem);

    // Initial check: item in queue
    const beforeItems = await getLegacyAiQueueItems(userA);
    expect(beforeItems).toHaveLength(1);

    // Rescue
    const rescued = await rescueLegacyAiQueue({
      userId: userA,
      canRescue: () => true,
    });

    expect(rescued).toBe('2 scrambled eggs and 1 slice toast');

    // Queue is emptied of the legacy item
    const afterItems = await getLegacyAiQueueItems(userA);
    expect(afterItems).toHaveLength(0);
  });

  it('two leftovers -> joined text with blank line between, both removed', async () => {
    const db = await getOfflineDb(userA);
    const item1: LegacyAiQueueItem = {
      id: 'legacy-item-1',
      userId: userA,
      kind: 'text',
      text: 'Grilled chicken breast with broccoli',
      capturedAt: '2026-10-01T12:00:00.000Z',
      status: 'queued',
    };
    const item2: LegacyAiQueueItem = {
      id: 'legacy-item-2',
      userId: userA,
      kind: 'text',
      text: '1 apple and peanut butter',
      capturedAt: '2026-10-01T15:00:00.000Z',
      status: 'queued',
    };
    await db.put('aiq', item1);
    await db.put('aiq', item2);

    const rescued = await rescueLegacyAiQueue({
      userId: userA,
      canRescue: () => true,
    });

    expect(rescued).toBe('Grilled chicken breast with broccoli\n\n1 apple and peanut butter');

    const remaining = await getLegacyAiQueueItems(userA);
    expect(remaining).toHaveLength(0);
  });

  it('no leftover -> returns null, queue empty, outbox untouched', async () => {
    // Seed an outbox op to ensure it remains untouched
    await enqueue({
      userId: userA,
      kind: 'nutrition.log',
      payload: {
        id: 'outbox-meal-1',
        user_id: userA,
        food_name: 'Existing Log',
        calories: 250,
        logged_at: '2026-10-01T10:00:00.000Z',
        logged_date: '2026-10-01',
      },
    });

    const outboxBefore = await getOutboxOps(userA);
    expect(outboxBefore).toHaveLength(1);

    const rescued = await rescueLegacyAiQueue({
      userId: userA,
      canRescue: () => true,
    });

    expect(rescued).toBeNull();

    // Outbox is untouched
    const outboxAfter = await getOutboxOps(userA);
    expect(outboxAfter).toHaveLength(1);
    expect(outboxAfter[0].kind).toBe('nutrition.log');
    if (outboxAfter[0].kind === 'nutrition.log') {
      expect(outboxAfter[0].payload.food_name).toBe('Existing Log');
    }

    const queueItems = await getLegacyAiQueueItems(userA);
    expect(queueItems).toHaveLength(0);
  });

  it('input already has text or staged meal shown -> leftovers kept in queue', async () => {
    const db = await getOfflineDb(userA);
    const item: LegacyAiQueueItem = {
      id: 'legacy-item-preserve',
      userId: userA,
      kind: 'text',
      text: 'Oatmeal with blueberries',
      capturedAt: '2026-10-01T07:30:00.000Z',
      status: 'queued',
    };
    await db.put('aiq', item);

    // canRescue returns false (simulating user already typed or staged meal active)
    const rescued = await rescueLegacyAiQueue({
      userId: userA,
      canRescue: () => false,
    });

    expect(rescued).toBeNull();

    // Leftovers remain in queue for later load
    const remaining = await getLegacyAiQueueItems(userA);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text).toBe('Oatmeal with blueberries');
  });

  it('preserves multi-user isolation on shared device', async () => {
    // User A has leftover
    const dbA = await getOfflineDb(userA);
    await dbA.put('aiq', {
      id: 'user-a-legacy',
      userId: userA,
      kind: 'text',
      text: 'User A meal text',
      capturedAt: '2026-10-01T08:00:00.000Z',
    });

    // User B has no leftovers
    const rescuedB = await rescueLegacyAiQueue({
      userId: userB,
      canRescue: () => true,
    });
    expect(rescuedB).toBeNull();

    // User A's leftover is still in User A's queue
    const itemsA = await getLegacyAiQueueItems(userA);
    expect(itemsA).toHaveLength(1);
    expect(itemsA[0].text).toBe('User A meal text');

    // Rescuing User A works independently
    const rescuedA = await rescueLegacyAiQueue({
      userId: userA,
      canRescue: () => true,
    });
    expect(rescuedA).toBe('User A meal text');
    expect(await getLegacyAiQueueItems(userA)).toHaveLength(0);
    expect(await getLegacyAiQueueItems(userB)).toHaveLength(0);
  });

  it('photo-only or empty-text item -> kept untouched in store, text items rescued and deleted', async () => {
    const db = await getOfflineDb(userA);
    const photoOnlyItem: LegacyAiQueueItem = {
      id: 'photo-only-item',
      userId: userA,
      kind: 'photo',
      photo: { dataUrl: 'data:image/jpeg;base64,1234' },
      text: '', // No text
      capturedAt: '2026-10-01T07:00:00.000Z',
      status: 'queued',
    };
    const textItem: LegacyAiQueueItem = {
      id: 'text-item-1',
      userId: userA,
      kind: 'text',
      text: 'Banana with protein shake',
      capturedAt: '2026-10-01T08:00:00.000Z',
      status: 'queued',
    };
    await db.put('aiq', photoOnlyItem);
    await db.put('aiq', textItem);

    const rescued = await rescueLegacyAiQueue({
      userId: userA,
      canRescue: () => true,
    });

    // Only text item is rescued
    expect(rescued).toBe('Banana with protein shake');

    // Photo-only item is NEVER deleted from store; text item is removed
    const remaining = await getLegacyAiQueueItems(userA);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('photo-only-item');
    expect(remaining[0].photo).toBeDefined();
  });

  it('mismatched userId -> kept untouched in store, matching item rescued and deleted', async () => {
    const db = await getOfflineDb(userA);
    const otherUserItem: LegacyAiQueueItem = {
      id: 'other-user-leftover',
      userId: 'different-user-999',
      kind: 'text',
      text: 'Other user secret meal',
      capturedAt: '2026-10-01T06:00:00.000Z',
      status: 'queued',
    };
    const userAItem: LegacyAiQueueItem = {
      id: 'user-a-valid-item',
      userId: userA,
      kind: 'text',
      text: 'User A quinoa bowl',
      capturedAt: '2026-10-01T09:00:00.000Z',
      status: 'queued',
    };
    await db.put('aiq', otherUserItem);
    await db.put('aiq', userAItem);

    const rescued = await rescueLegacyAiQueue({
      userId: userA,
      canRescue: () => true,
    });

    expect(rescued).toBe('User A quinoa bowl');

    // Mismatched userId item is left untouched in store
    const remaining = await getLegacyAiQueueItems(userA);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('other-user-leftover');
    expect(remaining[0].text).toBe('Other user secret meal');
  });

  it('two-step rescue: abort / unmount before write -> nothing deleted from store', async () => {
    const db = await getOfflineDb(userA);
    await db.put('aiq', {
      id: 'legacy-item-safe',
      userId: userA,
      kind: 'text',
      text: 'Steak and potatoes',
      capturedAt: '2026-10-01T12:00:00.000Z',
      status: 'queued',
    });

    // Simulating component unmount / abort before text commit: onCommitText returns false
    const rescued = await rescueLegacyAiQueue({
      userId: userA,
      canRescue: () => true,
      onCommitText: () => false, // aborted write (e.g. isCancelled)
    });

    expect(rescued).toBeNull();

    // Store is completely untouched
    const remaining = await getLegacyAiQueueItems(userA);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text).toBe('Steak and potatoes');
  });

  it('two-step rescue: user typed before write -> nothing deleted from store', async () => {
    const db = await getOfflineDb(userA);
    await db.put('aiq', {
      id: 'legacy-item-safe-2',
      userId: userA,
      kind: 'text',
      text: 'Greek yogurt parfait',
      capturedAt: '2026-10-01T12:00:00.000Z',
      status: 'queued',
    });

    let userTyped = false;
    const canRescue = () => !userTyped;

    // Simulate user typing while read is in flight:
    // canRescue is true at start, but turns false before write commits
    const readResult = await readLegacyAiQueueLeftovers(userA);
    expect(readResult).not.toBeNull();
    expect(readResult?.text).toBe('Greek yogurt parfait');

    // User types into input!
    userTyped = true;

    // In two-step flow: if canRescue() turns false, we must NOT write and NOT delete
    if (canRescue()) {
      await deleteLegacyAiQueueItems(userA, readResult!.ids);
    }

    // Nothing deleted
    const remaining = await getLegacyAiQueueItems(userA);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text).toBe('Greek yogurt parfait');
  });
});
