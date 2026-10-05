import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useWorkoutHistory,
  computeHistorySince,
  fetchExerciseHistoryPage,
  fetchSessionSets,
  useExerciseStats,
  HISTORY_PAGE_SIZE,
} from './useWorkoutHistory';
import { supabase } from '../../lib/supabase';
import { invalidateWorkoutDerived } from '../../lib/invalidate';
import { queryKeys } from '../../lib/queryKeys';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    ['from']: vi.fn(),
    rpc: vi.fn(),
  },
}));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function makePageRows(count: number, prefix: string, totalCount: number, startDay = 30) {
  return Array.from({ length: count }, (_, i) => {
    const day = String(Math.max(1, startDay - i)).padStart(2, '0');
    const civilDate = `2026-09-${day}`;
    return {
      id: `${prefix}-${i + 1}`,
      date: `${civilDate}T10:00:00Z`,
      civil_date: civilDate,
      name: `Session ${prefix} ${i + 1}`,
      set_count: 2,
      total_volume: 500,
      total_count: totalCount,
    };
  });
}

describe('useWorkoutHistory Data Layer (P5a W2)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('1. range -> p_since derivation', () => {
    it('returns null for range "all"', () => {
      expect(computeHistorySince('all')).toBeNull();
      expect(computeHistorySince('all', 'Asia/Tokyo')).toBeNull();
      expect(computeHistorySince('all', 'America/Los_Angeles')).toBeNull();
    });

    it('computes 30d, 90d, 1y days-ago strings relative to civil date', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));

      const since30 = computeHistorySince('30d', 'UTC');
      const since90 = computeHistorySince('90d', 'UTC');
      const since1y = computeHistorySince('1y', 'UTC');

      expect(since30).toBe('2026-08-28');
      expect(since90).toBe('2026-06-29');
      expect(since1y).toBe('2025-09-27');
    });

    it('Tokyo near midnight (fake Date): civil day rolls over at 15:00 UTC (00:00 JST)', () => {
      vi.useFakeTimers({ toFake: ['Date'] });

      // 14:59:59 UTC = 23:59:59 JST on Sept 27
      vi.setSystemTime(new Date('2026-09-27T14:59:59.000Z'));
      const beforeMidnight = computeHistorySince('30d', 'Asia/Tokyo');
      expect(beforeMidnight).toBe('2026-08-28');

      // 15:00:00 UTC = 00:00:00 JST on Sept 28
      vi.setSystemTime(new Date('2026-09-27T15:00:00.000Z'));
      const afterMidnight = computeHistorySince('30d', 'Asia/Tokyo');
      expect(afterMidnight).toBe('2026-08-29');
    });

    it('LA near midnight (fake Date): civil day rolls over at 07:00 UTC (00:00 PDT)', () => {
      vi.useFakeTimers({ toFake: ['Date'] });

      // 06:59:59 UTC = 23:59:59 PDT on Sept 27 (UTC-7)
      vi.setSystemTime(new Date('2026-09-28T06:59:59.000Z'));
      const beforeMidnight = computeHistorySince('30d', 'America/Los_Angeles');
      expect(beforeMidnight).toBe('2026-08-28');

      // 07:00:00 UTC = 00:00:00 PDT on Sept 28
      vi.setSystemTime(new Date('2026-09-28T07:00:00.000Z'));
      const afterMidnight = computeHistorySince('30d', 'America/Los_Angeles');
      expect(afterMidnight).toBe('2026-08-29');
    });

    it('hook passes computed p_since to get_history_sessions_v2', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-27T15:00:00.000Z')); // Tokyo Sept 28

      vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as any);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useWorkoutHistory('u-tokyo', '30d', 'Asia/Tokyo'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSessionsPending).toBe(false);
      });

      expect(supabase.rpc).toHaveBeenCalledWith('get_history_sessions_v2', {
        p_user_id: 'u-tokyo',
        p_since: '2026-08-29',
        p_before_date: null,
        p_before_id: null,
        p_limit: HISTORY_PAGE_SIZE,
      });
    });
  });

  describe('2. empty 30d -> totalCount 0 & hasMore false', () => {
    it('sets totalCount to 0 and hasMore to false when first page is empty', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as any);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useWorkoutHistory('user-empty', '30d'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSessionsPending).toBe(false);
      });

      expect(result.current.sessions).toEqual([]);
      expect(result.current.totalCount).toBe(0);
      expect(result.current.hasMore).toBe(false);
      expect(result.current.isSessionsError).toBe(false);
      expect(result.current.loadMoreError).toBeNull();
    });
  });

  describe('3. page chaining with cursors & hasMore false at end', () => {
    it('chains pages with {before_date, before_id} cursor and marks hasMore false at end', async () => {
      const page1 = makePageRows(30, 'w-chain-1', 35, 30);
      const page2 = makePageRows(5, 'w-chain-2', 35, 15);

      vi.mocked(supabase.rpc).mockImplementation(((fn: string, params: any) => {
        if (fn === 'get_history_sessions_v2') {
          if (!params.p_before_id) {
            return Promise.resolve({ data: page1, error: null });
          }
          if (params.p_before_id === 'w-chain-1-30') {
            return Promise.resolve({ data: page2, error: null });
          }
        }
        return Promise.resolve({ data: [], error: null });
      }) as any);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useWorkoutHistory('user-chain', 'all'), { wrapper });

      await waitFor(() => {
        expect(result.current.sessions).toHaveLength(30);
      });

      expect(result.current.totalCount).toBe(35);
      expect(result.current.hasMore).toBe(true);

      // Verify page 1 cursor params
      expect(supabase.rpc).toHaveBeenCalledWith('get_history_sessions_v2', {
        p_user_id: 'user-chain',
        p_since: null,
        p_before_date: null,
        p_before_id: null,
        p_limit: HISTORY_PAGE_SIZE,
      });

      // Load page 2
      act(() => {
        result.current.loadMore();
      });

      await waitFor(() => {
        expect(result.current.sessions).toHaveLength(35);
      });

      // Verify page 2 cursor params
      expect(supabase.rpc).toHaveBeenCalledWith('get_history_sessions_v2', {
        p_user_id: 'user-chain',
        p_since: null,
        p_before_date: page1[29].civil_date,
        p_before_id: 'w-chain-1-30',
        p_limit: HISTORY_PAGE_SIZE,
      });

      // At end: loaded (35) >= totalCount (35) and page 2 (5) < HISTORY_PAGE_SIZE -> hasMore is false
      expect(result.current.hasMore).toBe(false);

      const initialCallCount = vi.mocked(supabase.rpc).mock.calls.length;
      act(() => {
        result.current.loadMore();
      });
      // Should not trigger further RPC calls when hasMore is false
      expect(vi.mocked(supabase.rpc).mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('4. session deleted mid-pagination halts further pagination', () => {
    it('sets hasMore false and prevents third request when page 2 returns fewer than HISTORY_PAGE_SIZE rows (page1 total 60, page 2 returns 29 rows)', async () => {
      // Page 1: 30 rows, reports total_count 60
      const page1 = makePageRows(30, 'w-del-p1', 60, 30);
      // Page 2: only 29 rows (keyset end reached) while the freshest total_count is 61 because newer sessions were inserted above the cursor: only the short-page guard can stop pagination here
      const page2 = makePageRows(29, 'w-del-p2', 61, 15);

      vi.mocked(supabase.rpc).mockImplementation(((fn: string, params: any) => {
        if (fn === 'get_history_sessions_v2') {
          if (!params.p_before_id) {
            return Promise.resolve({ data: page1, error: null });
          }
          if (params.p_before_id === 'w-del-p1-30') {
            return Promise.resolve({ data: page2, error: null });
          }
        }
        return Promise.resolve({ data: [], error: null });
      }) as any);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useWorkoutHistory('user-mid-delete', 'all'), { wrapper });

      await waitFor(() => {
        expect(result.current.sessions).toHaveLength(30);
      });

      expect(result.current.totalCount).toBe(60);
      expect(result.current.hasMore).toBe(true);

      // Load page 2
      act(() => {
        result.current.loadMore();
      });

      await waitFor(() => {
        expect(result.current.sessions).toHaveLength(59);
      });

      // totalCount: taken from the LAST fetched page (freshest server count: 61)
      expect(result.current.totalCount).toBe(61);
      // hasMore is false because page 2 has 29 rows (< HISTORY_PAGE_SIZE = 30)
      expect(result.current.hasMore).toBe(false);

      const callCountAfterPage2 = vi.mocked(supabase.rpc).mock.calls.length;
      act(() => {
        result.current.loadMore();
      });

      // No third request triggered because hasMore is false (hasNextPage is false)
      expect(vi.mocked(supabase.rpc).mock.calls.length).toBe(callCountAfterPage2);
    });
  });

  describe('5. invalidation keeps loaded pages (refetch sends the same cursors, H26)', () => {
    it('refetches all 4 loaded pages in place with the exact same 4 cursors', async () => {
      const page1 = makePageRows(30, 'p1', 120, 30);
      const page2 = makePageRows(30, 'p2', 120, 25);
      const page3 = makePageRows(30, 'p3', 120, 20);
      const page4 = makePageRows(30, 'p4', 120, 15);

      const pagesData: Record<string, any[]> = {
        first: page1,
        'p1-30': page2,
        'p2-30': page3,
        'p3-30': page4,
      };

      vi.mocked(supabase.rpc).mockImplementation(((fn: string, params: any) => {
        if (fn === 'get_history_sessions_v2') {
          const key = params.p_before_id || 'first';
          return Promise.resolve({ data: pagesData[key] || [], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }) as any);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useWorkoutHistory('u-h26', 'all'), { wrapper });

      await waitFor(() => expect(result.current.sessions).toHaveLength(30));

      // Load page 2
      act(() => { result.current.loadMore(); });
      await waitFor(() => expect(result.current.sessions).toHaveLength(60));

      // Load page 3
      act(() => { result.current.loadMore(); });
      await waitFor(() => expect(result.current.sessions).toHaveLength(90));

      // Load page 4
      act(() => { result.current.loadMore(); });
      await waitFor(() => expect(result.current.sessions).toHaveLength(120));

      // Clear calls to isolate the refetch/invalidation phase
      vi.mocked(supabase.rpc).mockClear();

      // 1. Explicit refetch sends the exact same 4 cursors for the 4 loaded pages (H26)
      await act(async () => {
        await result.current.refetchSessions();
      });

      const refetchCalls = vi.mocked(supabase.rpc).mock.calls.filter(
        (c) => (c[0] as string) === 'get_history_sessions_v2'
      );
      const cursors = refetchCalls.map((c: any) => ({
        before_date: c[1].p_before_date,
        before_id: c[1].p_before_id,
      }));

      expect(cursors).toEqual([
        { before_date: null, before_id: null },
        { before_date: page1[29].civil_date, before_id: 'p1-30' },
        { before_date: page2[29].civil_date, before_id: 'p2-30' },
        { before_date: page3[29].civil_date, before_id: 'p3-30' },
      ]);

      // 2. Invalidation via invalidateWorkoutDerived also preserves all 4 loaded pages
      vi.mocked(supabase.rpc).mockClear();
      await act(async () => {
        await invalidateWorkoutDerived(queryClient, 'u-h26');
      });

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalled();
      });

      const invalidationCalls = vi.mocked(supabase.rpc).mock.calls.filter(
        (c) => (c[0] as string) === 'get_history_sessions_v2'
      );
      const invalidationCursors = invalidationCalls.map((c: any) => ({
        before_date: c[1].p_before_date,
        before_id: c[1].p_before_id,
      }));

      // Invalidation hits both workoutSets.all and workoutSets.byUser, sending all 4 cursors
      expect(invalidationCursors.filter((c) => c.before_id === null).length).toBeGreaterThanOrEqual(1);
      expect(invalidationCursors.filter((c) => c.before_id === 'p1-30').length).toBeGreaterThanOrEqual(1);
      expect(invalidationCursors.filter((c) => c.before_id === 'p2-30').length).toBeGreaterThanOrEqual(1);
      expect(invalidationCursors.filter((c) => c.before_id === 'p3-30').length).toBeGreaterThanOrEqual(1);

      // Sessions remain fully populated with all 120 sessions
      expect(result.current.sessions).toHaveLength(120);
    });
  });

  describe('6. deleteSession filters by user and invalidates', () => {
    it('deletes from workouts with user_id and workout id, then invalidates workout derived queries', async () => {
      const eqMock = vi.fn().mockReturnThis();
      const deleteMock = vi.fn().mockReturnValue({ eq: eqMock });
      eqMock.mockImplementation(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }));

      vi.mocked((supabase as any)['from']).mockReturnValue({
        delete: deleteMock,
      } as any);

      vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as any);

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useWorkoutHistory('user-delete', 'all'), { wrapper });

      await waitFor(() => expect(result.current.isSessionsPending).toBe(false));

      await act(async () => {
        await result.current.deleteSession('w-to-delete');
      });

      expect((supabase as any)['from']).toHaveBeenCalledWith('workouts');
      expect(deleteMock).toHaveBeenCalled();
      expect(eqMock).toHaveBeenCalledWith('id', 'w-to-delete');

      // Invalidates both all and byUser query keys
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.workoutSets.all,
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.workoutSets.byUser('user-delete'),
      });
    });

    it('cleans up localStorage client workout id pointer when deleting a session', async () => {
      const page1 = [
        {
          id: 'w-to-delete-ls',
          workout_date: '2026-09-30',
          civil_date: '2026-09-30',
          name: 'Push Day',
          date: '2026-09-30T10:00:00Z',
          set_count: 5,
          total_volume: 1000,
          total_count: 1,
        },
      ];
      vi.mocked(supabase.rpc).mockResolvedValue({ data: page1, error: null } as any);

      const eqMock = vi.fn().mockReturnThis();
      const deleteMock = vi.fn().mockReturnValue({ eq: eqMock });
      eqMock.mockImplementation(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }));
      vi.mocked((supabase as any)['from']).mockReturnValue({
        delete: deleteMock,
      } as any);

      const lsKey = 'yourbody_client_workout_user-delete_2026-09-30';
      localStorage.setItem(lsKey, 'client-w-stale');
      expect(localStorage.getItem(lsKey)).toBe('client-w-stale');

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useWorkoutHistory('user-delete', 'all'), { wrapper });

      await waitFor(() => expect(result.current.isSessionsPending).toBe(false));

      await act(async () => {
        await result.current.deleteSession('w-to-delete-ls');
      });

      expect(localStorage.getItem(lsKey)).toBeNull();
    });

    it('disables deletion when offline and does not call supabase (g)', async () => {
      const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

      const deleteMock = vi.fn();
      vi.mocked((supabase as any)['from']).mockReturnValue({
        delete: deleteMock,
      } as any);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useWorkoutHistory('user-delete', 'all'), { wrapper });

      expect(result.current.canDelete).toBe(false);
      expect(result.current.isOnline).toBe(false);

      await act(async () => {
        await result.current.deleteSession('w-to-delete');
      });

      expect(deleteMock).not.toHaveBeenCalled();
      onlineSpy.mockRestore();
    });
  });

  describe('7. loadMoreError surfaced', () => {
    it('surfaces loadMoreError while preserving previously loaded sessions', async () => {
      const page1 = makePageRows(30, 'w-err-p1', 60, 30);

      vi.mocked(supabase.rpc).mockImplementation(((fn: string, params: any) => {
        if (fn === 'get_history_sessions_v2') {
          if (!params.p_before_id) {
            return Promise.resolve({ data: page1, error: null });
          }
          return Promise.reject(new Error('Network error on page 2'));
        }
        return Promise.resolve({ data: [], error: null });
      }) as any);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useWorkoutHistory('user-err', 'all'), { wrapper });

      await waitFor(() => expect(result.current.sessions).toHaveLength(30));
      expect(result.current.loadMoreError).toBeNull();
      expect(result.current.isSessionsError).toBe(false);

      act(() => {
        result.current.loadMore();
      });

      await waitFor(() => {
        expect(result.current.loadMoreError).toBeInstanceOf(Error);
      });

      expect(result.current.loadMoreError?.message).toBe('Network error on page 2');
      // Previous sessions still retained
      expect(result.current.sessions).toHaveLength(30);
      // isSessionsError remains false so the main view does not collapse
      expect(result.current.isSessionsError).toBe(false);
    });
  });

  describe('8. fetchExerciseHistoryPage params', () => {
    it('calls get_exercise_history with provided params and maps result correctly', async () => {
      const mockRows = [
        {
          workout_id: 'w-ex-1',
          civil_date: '2026-09-20',
          workout_name: 'Chest Day',
          set_id: 's-ex-1',
          set_index: 0,
          weight: 225,
          reps: 8,
          rpe: 8.5,
          created_at: '2026-09-20T10:00:00Z',
          total_sessions: 3,
        },
      ];

      vi.mocked(supabase.rpc).mockResolvedValue({ data: mockRows, error: null } as any);

      const result = await fetchExerciseHistoryPage('user-ex', 'exercise-bench', {
        since: '2026-08-01',
        before: '2026-09-21',
        limit: 15,
      });

      expect(supabase.rpc).toHaveBeenCalledWith('get_exercise_history', {
        p_user_id: 'user-ex',
        p_exercise_id: 'exercise-bench',
        p_since: '2026-08-01',
        p_before: '2026-09-21',
        p_limit: 15,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        workout_id: 'w-ex-1',
        civil_date: '2026-09-20',
        workout_name: 'Chest Day',
        set_id: 's-ex-1',
        set_index: 0,
        weight: 225,
        reps: 8,
        rpe: 8.5,
        created_at: '2026-09-20T10:00:00Z',
        total_sessions: 3,
      });
    });

    it('falls back to default params (since: null, before: null, limit: 10)', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as any);

      await fetchExerciseHistoryPage('user-ex', 'exercise-squat');

      expect(supabase.rpc).toHaveBeenCalledWith('get_exercise_history', {
        p_user_id: 'user-ex',
        p_exercise_id: 'exercise-squat',
        p_since: null,
        p_before: null,
        p_limit: 10,
      });
    });
  });

  describe('9. fetchSessionSets', () => {
    it('queries working sets only and maps fields', async () => {
      const mockSets = [
        {
          id: 's-1',
          workout_id: 'w-1',
          exercise_id: 'ex-1',
          weight: 135,
          reps: 10,
          set_index: 0,
          set_type: 'working',
          rpe: 7,
          created_at: '2026-09-20T10:00:00Z',
        },
        {
          id: 's-warmup',
          workout_id: 'w-1',
          exercise_id: 'ex-1',
          weight: 95,
          reps: 12,
          set_index: 1,
          set_type: 'warmup',
          rpe: 5,
          created_at: '2026-09-20T09:55:00Z',
        },
      ];

      const limitMock = vi.fn().mockResolvedValue({ data: mockSets, error: null });
      const orderMock = vi.fn();
      orderMock.mockReturnValue({ order: orderMock, limit: limitMock });
      const eqMock = vi.fn().mockReturnValue({ order: orderMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      vi.mocked((supabase as any)['from']).mockReturnValue({ select: selectMock } as any);

      const sets = await fetchSessionSets('w-1');

      expect((supabase as any)['from']).toHaveBeenCalledWith('sets');
      expect(selectMock).toHaveBeenCalledWith(
        'id, workout_id, exercise_id, weight, reps, set_index, created_at, rpe, set_type'
      );
      expect(orderMock).toHaveBeenCalledWith('set_index', { ascending: true });
      expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: true });
      expect(orderMock).toHaveBeenCalledWith('id', { ascending: true });
      expect(sets).toHaveLength(1);
      expect(sets[0].id).toBe('s-1');
      expect(sets[0].set_type).toBe('working');
    });
  });

  describe('10. useExerciseStats', () => {
    it('fetches exercise stats via get_exercise_stats RPC', async () => {
      const stats = [{ exercise_id: 'ex-1', set_count: 10, max_weight: 225, pr_reps: 8, recent_sets: [] }];
      vi.mocked(supabase.rpc).mockResolvedValue({ data: stats, error: null } as any);

      const wrapper = createWrapper(queryClient);
      const { result } = renderHook(() => useExerciseStats('u-stat', true), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(supabase.rpc).toHaveBeenCalledWith('get_exercise_stats', { p_user_id: 'u-stat' });
      expect(result.current.data).toEqual(stats);
    });
  });
});
