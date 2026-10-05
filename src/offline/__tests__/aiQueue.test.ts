import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDB } from 'idb';
import {
  enqueueAiItem,
  listAiItems,
  discardAiItem,
  markReviewed,
  deleteAfterLog,
  resetStuckAnalyzingItems,
  startAiQueueProcessor,
  AiPhotoTooLargeError,
  MAX_PHOTO_BASE64_BYTES,
} from '../aiQueue';
import { getOfflineDb, closeAllOfflineDbs, deleteOfflineDb, DB_VERSION } from '../db';
import { setActiveUserForFlusher } from '../flusher';
import type { AiQueueItem } from '../types';

describe('AI Queue (aiq) & Processor (§N6, §E5)', () => {
  const userA = 'user-aiq-test-a';
  const userB = 'user-aiq-test-b';

  beforeEach(async () => {
    vi.clearAllMocks();
    setActiveUserForFlusher(userA);
    await closeAllOfflineDbs();
    await deleteOfflineDb(userA);
    await deleteOfflineDb(userB);
  });

  afterEach(async () => {
    setActiveUserForFlusher(null);
    await closeAllOfflineDbs();
    await deleteOfflineDb(userA);
    await deleteOfflineDb(userB);
  });

  describe('DB Upgrade v1 -> v2', () => {
    it('creates v1 DB with outbox & idmap data, reopens at v2, data intact, aiq store added', async () => {
      const dbName = `yourbody-offline-${userA}`;

      // 1. Manually open DB at version 1 (before O2 aiq store existed)
      const v1Db = await openDB(dbName, 1, {
        upgrade(db) {
          db.createObjectStore('rq');
          const outboxStore = db.createObjectStore('outbox', { keyPath: 'opId' });
          outboxStore.createIndex('seq', 'seq', { unique: true });
          outboxStore.createIndex('userId', 'userId', { unique: false });
          outboxStore.createIndex('state', 'state', { unique: false });
          db.createObjectStore('idmap');
          db.createObjectStore('meta');
        },
      });

      // Insert data into outbox and idmap in v1
      const sampleOp = {
        opId: 'op-v1-keep',
        userId: userA,
        seq: 1,
        createdAt: '2026-09-30T10:00:00Z',
        kind: 'workout.ensure',
        payload: { clientWorkoutId: 'w-1', workout_date: '2026-09-30' },
        attempts: 0,
        state: 'pending',
      };
      await v1Db.put('outbox', sampleOp as any);
      await v1Db.put('idmap', 'canonical-w-1', 'client-w-1');

      expect(v1Db.objectStoreNames.contains('aiq')).toBe(false);
      v1Db.close();

      // 2. Open via getOfflineDb which requests DB_VERSION 2
      expect(DB_VERSION).toBe(2);
      const v2Db = await getOfflineDb(userA);

      // Verify existing stores and data are completely intact!
      const preservedOp = await v2Db.get('outbox', 'op-v1-keep');
      expect(preservedOp).toBeDefined();
      expect((preservedOp as any)?.payload?.clientWorkoutId).toBe('w-1');

      const preservedId = await v2Db.get('idmap', 'client-w-1');
      expect(preservedId).toBe('canonical-w-1');

      // Verify aiq store exists with indexes
      expect(v2Db.objectStoreNames.contains('aiq')).toBe(true);
      const tx = v2Db.transaction('aiq', 'readonly');
      const store = tx.objectStore('aiq');
      expect(store.indexNames.contains('status')).toBe(true);
      expect(store.indexNames.contains('capturedAt')).toBe(true);
      v2Db.close();
    });
  });

  describe('Photo Validation & Enqueue', () => {
    it('rejects photo base64 exceeding 4 MB with AiPhotoTooLargeError', async () => {
      const hugeBase64 = 'A'.repeat(MAX_PHOTO_BASE64_BYTES + 1);

      await expect(
        enqueueAiItem({
          userId: userA,
          kind: 'photo',
          photo: {
            base64: hugeBase64,
            mime: 'image/jpeg',
          },
          capturedAt: '2026-10-01T12:00:00+00:00',
          captureDate: '2026-10-01',
        })
      ).rejects.toThrow(AiPhotoTooLargeError);
    });

    it('enqueues photo <= 4 MB and text items successfully', async () => {
      const photoItem = await enqueueAiItem({
        userId: userA,
        kind: 'photo',
        photo: {
          base64: 'validBase64Data',
          mime: 'image/jpeg',
        },
        capturedAt: '2026-10-01T12:00:00+00:00',
        captureDate: '2026-10-01',
      });

      expect(photoItem.id).toBeDefined();
      expect(photoItem.status).toBe('queued');
      expect(photoItem.attempts).toBe(0);
      expect(photoItem.photo?.base64).toBe('validBase64Data');

      const textItem = await enqueueAiItem({
        userId: userA,
        kind: 'text',
        text: '2 eggs and toast with butter',
        capturedAt: '2026-10-01T12:05:00+00:00',
        captureDate: '2026-10-01',
      });

      expect(textItem.status).toBe('queued');
      expect(textItem.text).toBe('2 eggs and toast with butter');

      const items = await listAiItems(userA);
      expect(items).toHaveLength(2);
    });
  });

  describe('Two-User Isolation', () => {
    it('items enqueued by User A are never readable by User B', async () => {
      await enqueueAiItem({
        userId: userA,
        kind: 'text',
        text: 'User A Secret Meal',
        capturedAt: '2026-10-01T10:00:00Z',
        captureDate: '2026-10-01',
      });

      const userAItems = await listAiItems(userA);
      expect(userAItems).toHaveLength(1);
      expect(userAItems[0].text).toBe('User A Secret Meal');

      // User B lists their items -> must be empty
      const userBItems = await listAiItems(userB);
      expect(userBItems).toHaveLength(0);
    });
  });

  describe('Discard & Cleanup', () => {
    it('discardAiItem deletes the item and photo from IDB', async () => {
      const item = await enqueueAiItem({
        userId: userA,
        kind: 'photo',
        photo: { base64: 'photoToDelete', mime: 'image/png' },
        capturedAt: '2026-10-01T11:00:00Z',
        captureDate: '2026-10-01',
      });

      let items = await listAiItems(userA);
      expect(items).toHaveLength(1);

      await discardAiItem(userA, item.id);

      items = await listAiItems(userA);
      expect(items).toHaveLength(0);
    });

    it('markReviewed and deleteAfterLog delete the item after logging', async () => {
      const item1 = await enqueueAiItem({
        userId: userA,
        kind: 'text',
        text: 'Item 1',
        capturedAt: '2026-10-01T11:00:00Z',
        captureDate: '2026-10-01',
      });
      const item2 = await enqueueAiItem({
        userId: userA,
        kind: 'text',
        text: 'Item 2',
        capturedAt: '2026-10-01T11:01:00Z',
        captureDate: '2026-10-01',
      });

      await markReviewed(userA, item1.id);
      let items = await listAiItems(userA);
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(item2.id);

      await deleteAfterLog(userA, item2.id);
      items = await listAiItems(userA);
      expect(items).toHaveLength(0);
    });
  });

  describe('Crash Recovery', () => {
    it('resets analyzing status to queued at startup', async () => {
      // Put item directly in IDB with status 'analyzing' to simulate process crash
      const db = await getOfflineDb(userA);
      const stuckItem: AiQueueItem = {
        id: 'stuck-crash-1',
        userId: userA,
        kind: 'text',
        text: 'Crash meal',
        capturedAt: '2026-10-01T12:00:00Z',
        captureDate: '2026-10-01',
        status: 'analyzing',
        attempts: 1,
        nextAttemptAt: Date.now(),
      };
      await db.put('aiq', stuckItem);

      await resetStuckAnalyzingItems(userA);

      const items = await listAiItems(userA);
      expect(items).toHaveLength(1);
      expect(items[0].status).toBe('queued');
    });
  });

  describe('Processor Execution & Error Handling', () => {
    it('success stores result AND removes photo in the same transaction', async () => {
      const photoItem = await enqueueAiItem({
        userId: userA,
        kind: 'photo',
        photo: { base64: 'myPhotoData', mime: 'image/jpeg' },
        capturedAt: '2026-10-01T12:00:00Z',
        captureDate: '2026-10-01',
      });
      expect(photoItem.id).toBeDefined();

      const mockAnalyze = vi.fn().mockResolvedValue({
        name: 'Avocado Toast',
        calories: 320,
        protein: 10,
        carbs: 25,
        fat: 20,
      });

      const stop = startAiQueueProcessor({
        userId: userA,
        analyze: mockAnalyze,
      });

      try {
        // Wait for processor to process item
        await vi.waitFor(async () => {
          const items = await listAiItems(userA);
          expect(items[0]?.status).toBe('ready');
        }, { timeout: 3000 });

        const items = await listAiItems(userA);
        expect(items[0].status).toBe('ready');
        expect(items[0].result).toEqual(
          expect.objectContaining({ name: 'Avocado Toast', calories: 320 })
        );
        // Photo must be completely deleted in the same transaction
        expect(items[0].photo).toBeUndefined();
      } finally {
        stop();
      }
    });

    it('429 rate limit sets Retry-After without burning attempts', async () => {
      const item = await enqueueAiItem({
        userId: userA,
        kind: 'text',
        text: 'Rate limited text',
        capturedAt: '2026-10-01T12:00:00Z',
        captureDate: '2026-10-01',
      });
      expect(item.id).toBeDefined();

      const beforeTime = Date.now();
      const err429: any = new Error('Too Many Requests');
      err429.status = 429;
      err429.retryAfter = 25; // 25 seconds

      const mockAnalyze = vi.fn().mockRejectedValue(err429);

      const stop = startAiQueueProcessor({
        userId: userA,
        analyze: mockAnalyze,
      });

      try {
        await vi.waitFor(async () => {
          const items = await listAiItems(userA);
          expect(items[0]?.nextAttemptAt).toBeGreaterThan(beforeTime + 20000);
        }, { timeout: 3000 });

        const items = await listAiItems(userA);
        expect(items[0].status).toBe('queued');
        // NO attempt burn!
        expect(items[0].attempts).toBe(0);
        expect(items[0].nextAttemptAt).toBeGreaterThanOrEqual(beforeTime + 25000);
      } finally {
        stop();
      }
    });

    it('5xx error triggers exponential backoff and burns attempt', async () => {
      const item = await enqueueAiItem({
        userId: userA,
        kind: 'text',
        text: 'Server 500 meal',
        capturedAt: '2026-10-01T12:00:00Z',
        captureDate: '2026-10-01',
      });
      expect(item.id).toBeDefined();

      const beforeTime = Date.now();
      const err500: any = new Error('Internal Server Error');
      err500.status = 500;

      const mockAnalyze = vi.fn().mockRejectedValue(err500);

      const stop = startAiQueueProcessor({
        userId: userA,
        analyze: mockAnalyze,
      });

      try {
        await vi.waitFor(async () => {
          const items = await listAiItems(userA);
          expect(items[0]?.attempts).toBe(1);
        }, { timeout: 3000 });

        const items = await listAiItems(userA);
        expect(items[0].status).toBe('queued');
        expect(items[0].attempts).toBe(1);
        // Backoff for attempt 1 is 30s
        expect(items[0].nextAttemptAt).toBeGreaterThanOrEqual(beforeTime + 29000);
      } finally {
        stop();
      }
    });

    it('422 NON_FOOD or validation error transitions to failed status', async () => {
      const item = await enqueueAiItem({
        userId: userA,
        kind: 'photo',
        photo: { base64: 'carKeysPhoto', mime: 'image/jpeg' },
        capturedAt: '2026-10-01T12:00:00Z',
        captureDate: '2026-10-01',
      });
      expect(item.id).toBeDefined();

      const errNonFood: any = new Error('No food detected in image');
      errNonFood.status = 422;
      errNonFood.code = 'NON_FOOD';

      const mockAnalyze = vi.fn().mockRejectedValue(errNonFood);

      const stop = startAiQueueProcessor({
        userId: userA,
        analyze: mockAnalyze,
      });

      try {
        await vi.waitFor(async () => {
          const items = await listAiItems(userA);
          expect(items[0]?.status).toBe('failed');
        }, { timeout: 3000 });

        const items = await listAiItems(userA);
        expect(items[0].status).toBe('failed');
        expect(items[0].lastError).toBe('No food detected in image');
      } finally {
        stop();
      }
    });

    it('processor mutex prevents double processing across two concurrent processor instances', async () => {
      await enqueueAiItem({
        userId: userA,
        kind: 'text',
        text: 'Single execution meal',
        capturedAt: '2026-10-01T12:00:00Z',
        captureDate: '2026-10-01',
      });

      let analyzeCallCount = 0;
      const mockAnalyze = vi.fn().mockImplementation(async () => {
        analyzeCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { name: 'Food', calories: 200 };
      });

      // Start two processor instances concurrently for userA
      const stop1 = startAiQueueProcessor({ userId: userA, analyze: mockAnalyze });
      const stop2 = startAiQueueProcessor({ userId: userA, analyze: mockAnalyze });

      try {
        await vi.waitFor(async () => {
          const items = await listAiItems(userA);
          expect(items[0]?.status).toBe('ready');
        }, { timeout: 3000 });

        // Item must only be analyzed once
        expect(analyzeCallCount).toBe(1);
      } finally {
        stop1();
        stop2();
      }
    });
  });
});
