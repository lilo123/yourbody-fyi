import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  runOfflinePrefetch,
  useOfflinePrefetch,
  offlinePrefetchOps,
  PREFETCH_THROTTLE_MS,
  PREFETCH_STORAGE_KEY_PREFIX,
  PREFETCH_INITIAL_DELAY_MS,
  PREFETCH_SETTLE_DELAY_MS,
} from './useOfflinePrefetch';
import * as exercisesModule from '../lib/exercises';
import * as workoutQueriesModule from '../components/workout/useWorkoutQueries';
import * as onlineStatusModule from '../hooks/useOnlineStatus';
import { supabase } from '../lib/supabase';
import {
  createSupabaseBuilder,
  getRecordedSelects,
  getRecordedTables,
  clearMockHistory,
} from '../test/supabaseBuilderMock';

vi.mock('../lib/supabase', () => ({
  supabase: {
    ['from']: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('useOfflinePrefetch', () => {
  let queryClient: QueryClient;
  const mockUserId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    localStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(exercisesModule, 'fetchExerciseCatalogPage').mockResolvedValue({
      items: [
        {
          id: 'ex-1',
          name: 'Bench Press',
          body_parts: ['chest'],
          equipment: 'barbell',
          is_master: true,
          user_id: null,
          is_archived: false,
          is_hidden: false,
        },
      ],
      nextCursor: null,
      totalCount: 1,
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder(table, {
          data: [
            {
              id: 'dish-1',
              user_id: mockUserId,
              name: 'Oatmeal',
              calories: 300,
              items: [{ name: 'Oats', calories: 300 }],
              ingredients: null,
            },
          ],
          error: null,
        });
      }
      return null;
    });

    (supabase.rpc as any).mockImplementation((fn: string) => {
      if (fn === 'get_routine_catalog') {
        return Promise.resolve({
          data: [
            {
              id: 'tmpl-1',
              user_id: mockUserId,
              name: 'Push Day',
              is_master: false,
              assigned_to: null,
              days_of_week: ['Mon'],
              created_at: '2026-09-01T00:00:00Z',
            },
          ],
          error: null,
        });
      }
      if (fn === 'get_exercise_stats') {
        return Promise.resolve({
          data: [{ exercise_id: 'ex-1', set_count: 5, max_weight: 225, pr_reps: 5 }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    vi.spyOn(workoutQueriesModule, 'fetchTemplateDetail').mockResolvedValue({
      id: 'tmpl-1',
      exercises: [
        {
          id: 'te-1',
          template_id: 'tmpl-1',
          exercise_id: 'ex-1',
          order_index: 0,
          target_sets: 3,
          target_reps: 10,
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefetches catalog, routines, details, and stats when online', async () => {
    const success = await runOfflinePrefetch(queryClient, mockUserId, true);
    expect(success).toBe(true);

    // Verify exercise catalog cache
    const catalog = queryClient.getQueryData(['exercise_catalog', 'offline_all', mockUserId]);
    expect(catalog).toBeDefined();
    expect((catalog as any[])[0].name).toBe('Bench Press');

    // Verify routine templates cache
    const templates = queryClient.getQueryData(['routine_templates', mockUserId, 'workout']);
    expect(templates).toBeDefined();
    expect((templates as any[])[0].name).toBe('Push Day');

    // Verify template detail cache
    const detail = queryClient.getQueryData(['routine_template_detail', 'tmpl-1']);
    expect(detail).toBeDefined();

    // Verify custom dishes cache
    const dishes = queryClient.getQueryData(['custom_dishes', mockUserId, 'full']);
    expect(dishes).toBeDefined();
    expect((dishes as any[])[0].name).toBe('Oatmeal');

    // Supabase query mock fidelity assertion
    expect(getRecordedTables()).toContain('custom_dishes');
    expect(getRecordedSelects()).toContainEqual({
      table: 'custom_dishes',
      projection:
        'id, user_id, name, calories, protein, carbs, fat, fiber, created_at, kind, use_count, notes, items, ingredients',
    });

    // Verify localStorage throttle set
    const key = `${PREFETCH_STORAGE_KEY_PREFIX}${mockUserId}`;
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it('throttles within 12 hours unless force is true', async () => {
    const key = `${PREFETCH_STORAGE_KEY_PREFIX}${mockUserId}`;
    localStorage.setItem(key, String(Date.now()));

    // Run again without force -> should skip
    const skipped = await runOfflinePrefetch(queryClient, mockUserId, false);
    expect(skipped).toBe(false);

    // Run with force -> should run
    const forced = await runOfflinePrefetch(queryClient, mockUserId, true);
    expect(forced).toBe(true);
  });

  it('runs prefetch after 12 hours elapsed', async () => {
    const key = `${PREFETCH_STORAGE_KEY_PREFIX}${mockUserId}`;
    const thirteenHoursAgo = Date.now() - (PREFETCH_THROTTLE_MS + 1000);
    localStorage.setItem(key, String(thirteenHoursAgo));

    const ran = await runOfflinePrefetch(queryClient, mockUserId, false);
    expect(ran).toBe(true);
  });

  it('hook skips prefetch when offline', () => {
    vi.spyOn(onlineStatusModule, 'useOnlineStatus').mockReturnValue(false);

    renderHook(() => useOfflinePrefetch(mockUserId), {
      wrapper: ({ children }: { children?: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children),
    });

    const catalog = queryClient.getQueryData(['exercise_catalog', 'offline_all', mockUserId]);
    expect(catalog).toBeUndefined();
  });

  it('does not start prefetch while initial queries are fetching and starts after they settle', async () => {
    vi.useFakeTimers();
    try {
      let resolveQuery: (val: any) => void = () => {};
      const pendingPromise = new Promise((resolve) => {
        resolveQuery = resolve;
      });

      // Start an in-flight query
      queryClient.prefetchQuery({
        queryKey: ['active_route_query'],
        queryFn: () => pendingPromise,
      });

      expect(queryClient.isFetching()).toBe(1);

      renderHook(() => useOfflinePrefetch(mockUserId), {
        wrapper: ({ children }: { children?: React.ReactNode }) =>
          React.createElement(QueryClientProvider, { client: queryClient }, children),
      });

      // Advance past initial delay + settle delay while query is still in flight
      await vi.advanceTimersByTimeAsync(PREFETCH_INITIAL_DELAY_MS + PREFETCH_SETTLE_DELAY_MS + 500);

      // Prefetch must NOT have run
      let catalog = queryClient.getQueryData(['exercise_catalog', 'offline_all', mockUserId]);
      expect(catalog).toBeUndefined();

      // Now resolve the in-flight query so fetching reaches 0
      resolveQuery({ ok: true });
      await vi.advanceTimersByTimeAsync(10);
      expect(queryClient.isFetching()).toBe(0);

      // Settle timer is now counting down; before settle delay it should not have run
      await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_DELAY_MS - 200);
      catalog = queryClient.getQueryData(['exercise_catalog', 'offline_all', mockUserId]);
      expect(catalog).toBeUndefined();

      // Advance past settle delay + idle callback (which uses up to 1000ms fallback)
      await vi.advanceTimersByTimeAsync(1500);
      await vi.runAllTicks();

      catalog = queryClient.getQueryData(['exercise_catalog', 'offline_all', mockUserId]);
      expect(catalog).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hook does not repeat prefetch within 12 hours', async () => {
    vi.useFakeTimers();
    try {
      const key = `${PREFETCH_STORAGE_KEY_PREFIX}${mockUserId}`;
      localStorage.setItem(key, String(Date.now() - 3600000)); // 1 hour ago

      renderHook(() => useOfflinePrefetch(mockUserId), {
        wrapper: ({ children }: { children?: React.ReactNode }) =>
          React.createElement(QueryClientProvider, { client: queryClient }, children),
      });

      await vi.advanceTimersByTimeAsync(PREFETCH_INITIAL_DELAY_MS + PREFETCH_SETTLE_DELAY_MS + 1000);

      const catalog = queryClient.getQueryData(['exercise_catalog', 'offline_all', mockUserId]);
      expect(catalog).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels scheduled prefetch when user signs out or unmounts', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(
        ({ uid }: { uid: string | null }) => useOfflinePrefetch(uid),
        {
          initialProps: { uid: mockUserId as string | null },
          wrapper: ({ children }: { children?: React.ReactNode }) =>
            React.createElement(QueryClientProvider, { client: queryClient }, children),
        }
      );

      // Advance partially during settle timer
      await vi.advanceTimersByTimeAsync(500);

      // Sign out / unmount
      unmount();

      // Advance timers way past prefetch execution time
      await vi.advanceTimersByTimeAsync(PREFETCH_INITIAL_DELAY_MS + PREFETCH_SETTLE_DELAY_MS + 5000);

      const catalog = queryClient.getQueryData(['exercise_catalog', 'offline_all', mockUserId]);
      expect(catalog).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-fetch routine catalog or stats when already cached in queryClient', async () => {
    // Pre-cache routine templates and exercise stats
    const preCachedTemplates = [
      {
        id: 'cached-tmpl-1',
        user_id: mockUserId,
        name: 'Cached Routine',
        is_master: false,
        assigned_to: null,
        days_of_week: ['Tue'],
        created_at: '2026-09-02T00:00:00Z',
      },
    ];
    queryClient.setQueryData(['routine_templates', mockUserId, 'workout'], preCachedTemplates);

    const preCachedStats = [{ exercise_id: 'ex-1', set_count: 10, max_weight: 315 }];
    queryClient.setQueryData(['exercise_stats', mockUserId], preCachedStats);
    queryClient.setQueryData(['exercise_stats', mockUserId, 'e1rm'], preCachedStats);

    const rpcSpy = vi.spyOn(supabase, 'rpc');
    rpcSpy.mockClear();

    const success = await runOfflinePrefetch(queryClient, mockUserId, true);
    expect(success).toBe(true);

    // Verify get_routine_catalog RPC was NOT called because templates were cached
    expect(rpcSpy).not.toHaveBeenCalledWith('get_routine_catalog', expect.anything());

    // Verify weight stats query reuses preCachedStats
    const weightStats = queryClient.getQueryData(['exercise_stats', mockUserId, 'weight']);
    expect(weightStats).toEqual(preCachedStats);

    // Verify get_exercise_stats was NOT called
    expect(rpcSpy).not.toHaveBeenCalledWith('get_exercise_stats', expect.anything());
  });

  it('after failed prefetch, 10 cache events + timer advance -> runOfflinePrefetch called exactly once', async () => {
    vi.useFakeTimers();
    try {
      const prefetchSpy = vi
        .spyOn(offlinePrefetchOps, 'runOfflinePrefetch')
        .mockRejectedValue(new Error('Network failure during prefetch'));

      renderHook(() => useOfflinePrefetch(mockUserId), {
        wrapper: ({ children }: { children?: React.ReactNode }) =>
          React.createElement(QueryClientProvider, { client: queryClient }, children),
      });

      // Settle timer + idle callback to trigger prefetch
      await vi.advanceTimersByTimeAsync(
        PREFETCH_INITIAL_DELAY_MS + PREFETCH_SETTLE_DELAY_MS + 2000
      );
      await vi.runAllTicks();

      expect(prefetchSpy).toHaveBeenCalledTimes(1);

      // Trigger 10 cache events
      for (let i = 0; i < 10; i++) {
        queryClient.setQueryData(['subsequent_cache_event', i], { data: i });
      }

      // Advance timers significantly
      await vi.advanceTimersByTimeAsync(15000);
      await vi.runAllTicks();

      // Must NOT retry in the same effect lifetime; called exactly once
      expect(prefetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('after success, cache listener unsubscribed (no further scheduling)', async () => {
    vi.useFakeTimers();
    try {
      const prefetchSpy = vi
        .spyOn(offlinePrefetchOps, 'runOfflinePrefetch')
        .mockResolvedValue(true);

      const cache = queryClient.getQueryCache();
      const originalSubscribe = cache.subscribe.bind(cache);
      let unsubscribeCalled = false;
      vi.spyOn(cache, 'subscribe').mockImplementation((listener) => {
        const unsubscribe = originalSubscribe(listener);
        return () => {
          unsubscribeCalled = true;
          unsubscribe();
        };
      });

      renderHook(() => useOfflinePrefetch(mockUserId), {
        wrapper: ({ children }: { children?: React.ReactNode }) =>
          React.createElement(QueryClientProvider, { client: queryClient }, children),
      });

      // Settle timer + idle callback to trigger prefetch
      await vi.advanceTimersByTimeAsync(
        PREFETCH_INITIAL_DELAY_MS + PREFETCH_SETTLE_DELAY_MS + 2000
      );
      await vi.runAllTicks();

      expect(prefetchSpy).toHaveBeenCalledTimes(1);
      expect(unsubscribeCalled).toBe(true);

      // Subsequent query cache events should not schedule or call prefetch
      for (let i = 0; i < 5; i++) {
        queryClient.setQueryData(['post_success_query', i], { data: i });
      }
      await vi.advanceTimersByTimeAsync(10000);
      await vi.runAllTicks();

      expect(prefetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
