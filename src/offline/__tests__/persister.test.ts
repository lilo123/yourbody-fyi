import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shouldDehydrateQuery,
  applyPageCaps,
  createIdbPersister,
  getCivilDateInTz,
  PERSIST_BUSTER,
} from '../persister';
import { clearUserReadCache, initPersistForUser, stopPersisting } from '../persistController';
import { enqueue, getOutboxOps } from '../outbox';
import { setIdMapping, getIdMapping } from '../idmap';
import { closeAllOfflineDbs, deleteOfflineDb } from '../db';
import { QueryClient, type Query } from '@tanstack/react-query';
import type { PersistedClient } from '@tanstack/react-query-persist-client';

describe('Cache Persister & Whitelist (§A3, §A9, §D)', () => {
  const userId = 'user-persist-1';

  function createMockQuery(queryKey: unknown[], status: 'success' | 'error' | 'pending' = 'success'): Query {
    return {
      queryKey,
      state: { status },
    } as unknown as Query;
  }

  beforeEach(async () => {
    await closeAllOfflineDbs();
    await deleteOfflineDb(userId);
  });

  afterEach(async () => {
    await closeAllOfflineDbs();
    await deleteOfflineDb(userId);
  });

  describe('Whitelist Filter (shouldDehydrateQuery)', () => {

    it('allows exercises family with status success', () => {
      expect(shouldDehydrateQuery(createMockQuery(['exercises', 'workout']))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['exercises']))).toBe(true);
    });

    it('rejects queries with status error or pending', () => {
      expect(shouldDehydrateQuery(createMockQuery(['exercises'], 'error'))).toBe(false);
      expect(shouldDehydrateQuery(createMockQuery(['exercises'], 'pending'))).toBe(false);
    });

    it('allows exercise_catalog ONLY for offline_all (A5)', () => {
      expect(shouldDehydrateQuery(createMockQuery(['exercise_catalog', 'offline_all', userId]))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['exercise_catalog', 'infinite', {}]))).toBe(false);
    });

    it('allows routine_templates and routine_template_detail', () => {
      expect(shouldDehydrateQuery(createMockQuery(['routine_templates', userId, 'workout']))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['routine_template_detail', 'template-1']))).toBe(true);
    });

    it('allows workout_sets whitelisted subsets (byDate, recent90d, history_v2, exercise_history, calendar_month)', () => {
      expect(shouldDehydrateQuery(createMockQuery(['workout_sets', userId, '2026-09-30']))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['workout_sets', userId, 'recent90d']))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['workout_sets', userId, 'history_v2', '30d', '2026-09-30']))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['workout_sets', userId, 'exercise_history', 'ex-1', '30d']))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['workout_sets', userId, 'calendar_month', '2026-09-01']))).toBe(true);
    });

    it('allows workouts.byDate, exercise_benchmarks, exercise_stats', () => {
      expect(shouldDehydrateQuery(createMockQuery(['workouts', userId, '2026-09-30']))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['exercise_benchmarks', userId, '2026-09-30', ['ex-1'], 'weight']))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['exercise_stats', userId]))).toBe(true);
    });

    it('allows custom_dishes list and nutrition_logs history_window', () => {
      expect(shouldDehydrateQuery(createMockQuery(['custom_dishes', userId]))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['custom_dishes', userId, 'full']))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['nutrition_logs', userId, 'history_window', 'America/New_York']))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['nutrition_logs', userId, 'history_window']))).toBe(true);
    });

    it('key filter: today-7 kept, today-8 dropped; today+1 kept, today+2 dropped', () => {
      const tz = 'America/New_York';
      const todayStr = getCivilDateInTz(new Date(), tz);
      const [year, month, day] = todayStr.split('-').map(Number);
      const addCivilDays = (days: number): string => {
        const dt = new Date(Date.UTC(year, month - 1, day + days));
        return dt.toISOString().slice(0, 10);
      };

      const minus7 = addCivilDays(-7);
      const minus8 = addCivilDays(-8);
      const plus1 = addCivilDays(1);
      const plus2 = addCivilDays(2);

      expect(shouldDehydrateQuery(createMockQuery(['nutrition_logs', userId, minus7, tz]))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['nutrition_logs', userId, minus8, tz]))).toBe(false);
      expect(shouldDehydrateQuery(createMockQuery(['nutrition_logs', userId, plus1, tz]))).toBe(true);
      expect(shouldDehydrateQuery(createMockQuery(['nutrition_logs', userId, plus2, tz]))).toBe(false);
    });
  });

  describe('Page Caps (applyPageCaps)', () => {
    it('caps history_v2 infinite queries to at most 3 pages', () => {
      const client: PersistedClient = {
        timestamp: Date.now(),
        buster: PERSIST_BUSTER,
        clientState: {
          queries: [
            {
              queryKey: ['workout_sets', userId, 'history_v2', 'all', '2026-09-30'],
              state: {
                data: {
                  pages: [
                    { sessions: [1, 2] },
                    { sessions: [3, 4] },
                    { sessions: [5, 6] },
                    { sessions: [7, 8] },
                    { sessions: [9, 10] },
                  ],
                  pageParams: [null, 1, 2, 3, 4],
                },
              } as any,
              queryHash: 'hash-history',
            },
          ],
          mutations: [],
        },
      };

      const capped = applyPageCaps(client);
      const queryData = capped.clientState.queries[0].state.data as any;
      expect(queryData.pages).toHaveLength(3);
      expect(queryData.pageParams).toHaveLength(3);
    });

    it('caps exercise_history infinite queries to at most 1 page', () => {
      const client: PersistedClient = {
        timestamp: Date.now(),
        buster: PERSIST_BUSTER,
        clientState: {
          queries: [
            {
              queryKey: ['workout_sets', userId, 'exercise_history', 'ex-1', 'all'],
              state: {
                data: {
                  pages: [{ sets: [1, 2] }, { sets: [3, 4] }],
                  pageParams: [null, 1],
                },
              } as any,
              queryHash: 'hash-ex-hist',
            },
          ],
          mutations: [],
        },
      };

      const capped = applyPageCaps(client);
      const queryData = capped.clientState.queries[0].state.data as any;
      expect(queryData.pages).toHaveLength(1);
      expect(queryData.pageParams).toHaveLength(1);
    });

    it('12 day keys in the window -> the 10 nearest kept incl. today', () => {
      const tz = 'America/New_York';
      const todayStr = getCivilDateInTz(new Date(), tz);
      const [year, month, day] = todayStr.split('-').map(Number);
      const addCivilDays = (days: number): string => {
        const dt = new Date(Date.UTC(year, month - 1, day + days));
        return dt.toISOString().slice(0, 10);
      };

      // 12 day keys: from today+1 down to today-10
      const offsets = [1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10];
      const queries = offsets.map((offset) => ({
        queryKey: ['nutrition_logs', userId, addCivilDays(offset), tz],
        state: { data: [{ id: `log-offset-${offset}` }], status: 'success' },
        queryHash: `nutrition-offset-${offset}`,
      }));

      const client: PersistedClient = {
        timestamp: Date.now(),
        buster: PERSIST_BUSTER,
        clientState: {
          queries: queries as any,
          mutations: [],
        },
      };

      const capped = applyPageCaps(client);
      expect(capped.clientState.queries).toHaveLength(10);

      const keptDates = capped.clientState.queries.map((q: any) => q.queryKey[2]);
      // Always keep today's key
      expect(keptDates).toContain(todayStr);

      // The 10 nearest to today:
      // |diff| = 0: today (0)
      // |diff| = 1: today+1 (1), today-1 (-1)
      // |diff| = 2: today-2 (-2)
      // |diff| = 3: today-3 (-3)
      // |diff| = 4: today-4 (-4)
      // |diff| = 5: today-5 (-5)
      // |diff| = 6: today-6 (-6)
      // |diff| = 7: today-7 (-7)
      // |diff| = 8: today-8 (-8)
      // Dropped: today-9, today-10 (furthest from today)
      const expectedKeptOffsets = [0, 1, -1, -2, -3, -4, -5, -6, -7, -8];
      for (const off of expectedKeptOffsets) {
        expect(keptDates).toContain(addCivilDays(off));
      }
      expect(keptDates).not.toContain(addCivilDays(-9));
      expect(keptDates).not.toContain(addCivilDays(-10));
    });

    it('a session that dehydrates 10 old keys, then today\'s key -> today\'s key is persisted', () => {
      const tz = 'America/New_York';
      const todayStr = getCivilDateInTz(new Date(), tz);
      const [year, month, day] = todayStr.split('-').map(Number);
      const addCivilDays = (days: number): string => {
        const dt = new Date(Date.UTC(year, month - 1, day + days));
        return dt.toISOString().slice(0, 10);
      };

      // In a session, 10 old day queries are dehydrated first (today-1 to today-10)
      const oldOffsets = [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10];
      const oldQueries = oldOffsets.map((off) =>
        createMockQuery(['nutrition_logs', userId, addCivilDays(off), tz])
      );

      // Keys in range [today-7, today+1] pass shouldDehydrateQuery
      for (const off of [-1, -2, -3, -4, -5, -6, -7]) {
        const q = createMockQuery(['nutrition_logs', userId, addCivilDays(off), tz]);
        expect(shouldDehydrateQuery(q)).toBe(true);
      }

      // Then today's query arrives
      const todayQuery = createMockQuery(['nutrition_logs', userId, todayStr, tz]);
      // shouldDehydrateQuery must NOT reject today even after checking 10 previous queries
      expect(shouldDehydrateQuery(todayQuery)).toBe(true);

      // When all are persisted via applyPageCaps (10 old keys + today's key = 11 keys)
      const allQueries = [
        ...oldQueries.map((q) => ({
          queryKey: q.queryKey,
          state: q.state,
          queryHash: String(q.queryKey[2]),
        })),
        {
          queryKey: todayQuery.queryKey,
          state: todayQuery.state,
          queryHash: todayStr,
        },
      ];

      const client: PersistedClient = {
        timestamp: Date.now(),
        buster: PERSIST_BUSTER,
        clientState: {
          queries: allQueries as any,
          mutations: [],
        },
      };

      const capped = applyPageCaps(client);
      expect(capped.clientState.queries).toHaveLength(10);

      const keptDates = capped.clientState.queries.map((q: any) => q.queryKey[2]);
      // Today's key MUST be kept
      expect(keptDates).toContain(todayStr);
      // The furthest key (today-10) should be dropped
      expect(keptDates).not.toContain(addCivilDays(-10));
    });
  });

  describe('Sign-out Storage Semantics (§A9)', () => {
    it('sign-out deletes user rq read cache while KEEPING outbox and idmap stores intact', async () => {
      // 1. Write persisted rq cache
      const persister = createIdbPersister(userId);
      const mockClientData: PersistedClient = {
        timestamp: Date.now(),
        buster: PERSIST_BUSTER,
        clientState: {
          queries: [
            {
              queryKey: ['exercises'],
              state: { data: [{ id: 'ex-1', name: 'Bench' }], status: 'success' } as any,
              queryHash: 'exercises',
            },
          ],
          mutations: [],
        },
      };
      await persister.persistClient(mockClientData);

      // Verify rq store contains client
      const restoredBefore = await persister.restoreClient();
      expect(restoredBefore).toBeDefined();

      // 2. Add item to outbox
      const op = await enqueue({
        userId,
        kind: 'workout.ensure',
        payload: { clientWorkoutId: 'w-keep', workout_date: '2026-09-30' },
      });

      // 3. Add mapping to idmap
      await setIdMapping(userId, 'client-w-keep', 'canonical-w-keep');

      // 4. Perform sign-out cleanup for read cache
      await clearUserReadCache(userId);

      // Verify rq read cache is deleted
      const restoredAfter = await persister.restoreClient();
      expect(restoredAfter).toBeUndefined();

      // Verify outbox op is KEPT!
      const opsAfter = await getOutboxOps(userId);
      expect(opsAfter).toHaveLength(1);
      expect(opsAfter[0].opId).toBe(op.opId);

      // Verify idmap is KEPT!
      const mappedId = await getIdMapping(userId, 'client-w-keep');
      expect(mappedId).toBe('canonical-w-keep');
    });

    it('clearUserReadCache does not create an offline database if one does not already exist', async () => {
      const nonExistentUserId = 'user-never-existed-456';
      await clearUserReadCache(nonExistentUserId);

      const dbs = await indexedDB.databases();
      const db = dbs.find((d) => d.name === `yourbody-offline-${nonExistentUserId}`);
      expect(db).toBeUndefined();
    });

    it('persistClient, restoreClient, removeClient absorb closed IndexedDB errors without throwing or rejecting', async () => {
      const persister = createIdbPersister(userId);
      const mockClientData: PersistedClient = {
        timestamp: Date.now(),
        buster: PERSIST_BUSTER,
        clientState: { queries: [], mutations: [] },
      };

      // Mock getOfflineDb to simulate a database in closing/closed state
      const dbModule = await import('../db');
      const spy = vi.spyOn(dbModule, 'getOfflineDb').mockRejectedValue(
        new DOMException('The database connection is closing.', 'InvalidStateError')
      );

      try {
        // Must resolve without rejecting/throwing
        await expect(persister.persistClient(mockClientData)).resolves.toBeUndefined();
        await expect(persister.restoreClient()).resolves.toBeUndefined();
        await expect(persister.removeClient()).resolves.toBeUndefined();
      } finally {
        spy.mockRestore();
      }
    });

    it('initPersistForUser aborts mid-flight when stopPersisting is invoked', async () => {
      const queryClient = new QueryClient();
      const p = initPersistForUser(userId, queryClient);
      stopPersisting();
      await expect(p).resolves.not.toThrow();
    });
  });
});
