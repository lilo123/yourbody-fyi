import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { PersistedClient } from '@tanstack/react-query-persist-client';
import {
  isDbClosedError,
  closeAllOfflineDbs,
} from '../db';
import { enqueue } from '../outbox';
import { enqueueAndAwait } from '../flusher';
import { createIdbPersister, PERSIST_BUSTER } from '../persister';
import { initPersistForUser, stopPersisting } from '../persistController';

describe('Database closed error handling and error surfacing', () => {
  const testUserId = 'test-db-closed-user';

  beforeEach(() => {
    stopPersisting();
  });

  afterEach(async () => {
    stopPersisting();
    await closeAllOfflineDbs();
    vi.restoreAllMocks();
  });

  describe('Contract (a): isDbClosedError exact matching', () => {
    it('returns true for DOMException with name InvalidStateError', () => {
      const domErr1 = new DOMException('The database connection is closing.', 'InvalidStateError');
      const domErr2 = new DOMException(
        'An operation was called on an object on which it is not allowed or at a time when it is not allowed. Also occurs if a request is made on a source object that has been deleted or removed. Use TransactionInactiveError or ReadOnlyError when possible, as they are more specific variations of InvalidStateError.',
        'InvalidStateError'
      );
      const domErr3 = new DOMException('The object is in an invalid state.', 'InvalidStateError');

      expect(isDbClosedError(domErr1)).toBe(true);
      expect(isDbClosedError(domErr2)).toBe(true);
      expect(isDbClosedError(domErr3)).toBe(true);
    });

    it('returns true for exact browser and fake-indexeddb close messages', () => {
      const exactMessages = [
        'The database connection is closing.',
        'The database connection is closed.',
        'Database is closing',
        'Database is closed',
        'The database is closing.',
        'The database is closed.',
        'An operation was called on an object on which it is not allowed or at a time when it is not allowed. Also occurs if a request is made on a source object that has been deleted or removed. Use TransactionInactiveError or ReadOnlyError when possible, as they are more specific variations of InvalidStateError.',
        'The object is in an invalid state.',
      ];

      for (const msg of exactMessages) {
        expect(isDbClosedError(new Error(msg))).toBe(true);
      }
    });

    it('returns FALSE for substring matches, generic errors, and primitives', () => {
      // Must not match on substring 'closed' or 'closing'
      expect(isDbClosedError(new Error('file closed unexpectedly'))).toBe(false);
      expect(isDbClosedError(new Error('connection closed by remote peer'))).toBe(false);
      expect(isDbClosedError(new Error('closing port 5432'))).toBe(false);
      expect(isDbClosedError(new Error('stream was closed'))).toBe(false);

      // Generic errors
      expect(isDbClosedError(new Error('Disk I/O error'))).toBe(false);
      expect(isDbClosedError(new Error('Database query timed out'))).toBe(false);
      expect(isDbClosedError(new TypeError('Invalid argument'))).toBe(false);
      expect(isDbClosedError(new RangeError('Out of range'))).toBe(false);

      // Non-error or non-object values
      expect(isDbClosedError(null)).toBe(false);
      expect(isDbClosedError(undefined)).toBe(false);
      expect(isDbClosedError({})).toBe(false);
      expect(isDbClosedError({ name: 'Error', message: 'other' })).toBe(false);
      expect(isDbClosedError('The database connection is closing.')).toBe(false);
      expect(isDbClosedError(12345)).toBe(false);
    });
  });

  describe('Contract (b): outbox enqueue rejects on DB failure (D-OFF-3)', () => {
    it('enqueue rejects when DB write fails with closed-DB error', async () => {
      const dbModule = await import('../db');
      const spy = vi.spyOn(dbModule, 'getOfflineDb').mockRejectedValue(
        new DOMException('The database connection is closing.', 'InvalidStateError')
      );

      await expect(
        enqueue({
          userId: testUserId,
          kind: 'workout.ensure',
          payload: {
            clientWorkoutId: 'cw-1',
            workout_date: '2026-10-01',
            name: 'Morning Session',
          },
        })
      ).rejects.toThrow('The database connection is closing.');

      spy.mockRestore();
    });

    it('enqueue rejects when DB write fails with generic error', async () => {
      const dbModule = await import('../db');
      const spy = vi.spyOn(dbModule, 'getOfflineDb').mockRejectedValue(
        new Error('Disk quota exceeded')
      );

      await expect(
        enqueue({
          userId: testUserId,
          kind: 'workout.ensure',
          payload: {
            clientWorkoutId: 'cw-2',
            workout_date: '2026-10-01',
            name: 'Evening Session',
          },
        })
      ).rejects.toThrow('Disk quota exceeded');

      spy.mockRestore();
    });

    it('enqueueAndAwait rejects when DB write fails with closed-DB error', async () => {
      const dbModule = await import('../db');
      const spy = vi.spyOn(dbModule, 'getOfflineDb').mockRejectedValue(
        new DOMException('The database connection is closing.', 'InvalidStateError')
      );

      await expect(
        enqueueAndAwait({
          userId: testUserId,
          kind: 'workout.ensure',
          payload: {
            clientWorkoutId: 'cw-3',
            workout_date: '2026-10-01',
            name: 'Late Session',
          },
        })
      ).rejects.toThrow('The database connection is closing.');

      spy.mockRestore();
    });
  });

  describe('Contract (c): read-cache persister absorbs closed-DB errors', () => {
    it('persistClient, restoreClient, removeClient absorb closed IndexedDB errors without rejecting', async () => {
      const persister = createIdbPersister(testUserId);
      const mockClientData: PersistedClient = {
        timestamp: Date.now(),
        buster: PERSIST_BUSTER,
        clientState: { queries: [], mutations: [] },
      };

      const dbModule = await import('../db');
      const spy = vi.spyOn(dbModule, 'getOfflineDb').mockRejectedValue(
        new DOMException('The database connection is closing.', 'InvalidStateError')
      );

      // Must resolve without rejecting or throwing
      await expect(persister.persistClient(mockClientData)).resolves.toBeUndefined();
      await expect(persister.restoreClient()).resolves.toBeUndefined();
      await expect(persister.removeClient()).resolves.toBeUndefined();

      spy.mockRestore();
    });

    it('persister logs console.warn on non-closed-DB errors', async () => {
      const persister = createIdbPersister(testUserId);
      const mockClientData: PersistedClient = {
        timestamp: Date.now(),
        buster: PERSIST_BUSTER,
        clientState: { queries: [], mutations: [] },
      };

      const dbModule = await import('../db');
      const spy = vi.spyOn(dbModule, 'getOfflineDb').mockRejectedValue(
        new Error('Unexpected hardware failure')
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await persister.persistClient(mockClientData);
      expect(warnSpy).toHaveBeenCalledWith(
        '[persister] persistClient failed:',
        expect.any(Error)
      );

      await persister.restoreClient();
      expect(warnSpy).toHaveBeenCalledWith(
        '[persister] restoreClient failed:',
        expect.any(Error)
      );

      await persister.removeClient();
      expect(warnSpy).toHaveBeenCalledWith(
        '[persister] removeClient failed:',
        expect.any(Error)
      );

      spy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('Contract (d): persistController session guard mid-flight cancellation', () => {
    it('initPersistForUser cleanly aborts if stopPersisting is called during setup', async () => {
      const queryClient = new QueryClient();
      const persistPromise = initPersistForUser(testUserId, queryClient);
      stopPersisting();
      await expect(persistPromise).resolves.not.toThrow();
    });
  });
});
