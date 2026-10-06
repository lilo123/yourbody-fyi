import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useWorkoutQueries } from './useWorkoutQueries';
import { supabase } from '../../lib/supabase';
import * as pendingOpsModule from './useWorkoutPendingOps';
import { AuthContext } from '../../context/AuthContextTypes';

describe('useWorkoutQueries', () => {
  let queryClient: QueryClient;
  const targetUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  it('exposes isExercisesError and exercisesError when exercises query fails', async () => {
    const errorSpy = vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'exercises') {
        const b: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: null,
            error: new Error('Exercises query network failure'),
          }),
          range: vi.fn().mockResolvedValue({
            data: null,
            error: new Error('Exercises query network failure'),
          }),
        };
        return b;
      }
      return {
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const { result } = renderHook(
      () => useWorkoutQueries(targetUserId, '2026-09-27'),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isExercisesError).toBe(true);
    });

    expect(result.current.exercisesError?.message).toBe('Exercises query network failure');
    errorSpy.mockRestore();
  });

  it('queries exercises with is_archived = false', async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const selectSpy = vi.fn().mockReturnValue({
      eq: eqSpy,
      order: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: [
            { id: 'ex-1', name: 'Active Exercise', body_parts: ['Chest'], is_master: true, is_archived: false },
          ],
          error: null,
        }),
        range: vi.fn().mockResolvedValue({
          data: [
            { id: 'ex-1', name: 'Active Exercise', body_parts: ['Chest'], is_master: true, is_archived: false },
          ],
          error: null,
        }),
      }),
    });

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'exercises') {
        return {
          select: selectSpy,
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const { result } = renderHook(
      () => useWorkoutQueries(targetUserId, '2026-09-27'),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.exercisesFetched).toBe(true);
    });

    // select does not need is_archived in projection
    expect(eqSpy).toHaveBeenCalledWith('is_archived', false);
  });

  it('refetches when workoutDate changes', async () => {
    let queriedDate = '';
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'workouts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockImplementation((_col: string, val: string) => {
            queriedDate = val.split('T')[0];
            return {
              lte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        limit: vi.fn().mockReturnThis(),
      } as any;
    });

    const { result, rerender } = renderHook(
      ({ date }: { date: string }) => useWorkoutQueries(targetUserId, date),
      { wrapper, initialProps: { date: '2026-09-20' } }
    );

    await waitFor(() => {
      expect(result.current.logsFetched).toBe(true);
    });
    expect(queriedDate).toBe('2026-09-20');

    // Change date to 2026-09-27
    rerender({ date: '2026-09-27' });

    await waitFor(() => {
      expect(queriedDate).toBe('2026-09-27');
    });
  });

  it('queries get_exercise_benchmarks RPC and merges today sets', async () => {
    const exerciseUUID = '00000000-0000-4000-8000-000000000010';
    (supabase as any).rpc = vi.fn().mockImplementation((fn: string) => {
      if (fn === 'get_exercise_benchmarks') {
        return Promise.resolve({
          data: [
            {
              exercise_id: exerciseUUID,
              pr_weight: 200,
              pr_reps: 8,
              pr_date: '2026-09-01',
              pr_workout_id: 'w-1',
              last_date: '2026-09-20',
              last_workout_id: 'w-2',
              last_sets: [
                { id: 's-1', weight: 185, reps: 8, set_index: 0, set_type: 'working' },
                { id: 's-2', weight: 185, reps: 8, set_index: 1, set_type: 'working' },
              ],
            },
          ],
          error: null,
        });
      }
      const fallback = Promise.resolve({ data: [], error: null });
      (fallback as any).select = vi.fn().mockReturnValue(fallback);
      return fallback;
    });

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'exercises') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                { id: exerciseUUID, name: 'Bench Press', body_parts: ['Chest'], is_master: true },
              ],
              error: null,
            }),
          }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const { result } = renderHook(
      () => useWorkoutQueries(targetUserId, '2026-09-27'),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.benchmarksFetched).toBe(true);
    });

    expect(result.current.benchmarks[exerciseUUID]).toBeDefined();
    expect(result.current.benchmarks[exerciseUUID].pr?.weight).toBe(200);
    expect(result.current.benchmarks[exerciseUUID].lastSession?.date).toBe('2026-09-20');
    expect(result.current.benchmarks[exerciseUUID].lastSession?.summaryText).toBe('185×8, 185×8');
  });

  it('queries get_routine_catalog RPC with p_limit: 200 and projects narrow columns', async () => {
    const routineId = '00000000-0000-4000-8000-000000000020';
    let rpcCalledWith: any = null;
    let selectCalledWith: any = null;

    const selectSpy = vi.fn().mockImplementation((projection: string) => {
      selectCalledWith = projection;
      return Promise.resolve({
        data: [
          {
            id: routineId,
            name: 'Leg Day Catalog',
            is_master: false,
            user_id: targetUserId,
            assigned_to: null,
            days_of_week: ['Sun'],
            created_at: '2026-09-01T00:00:00Z',
          },
        ],
        error: null,
      });
    });

    (supabase as any).rpc = vi.fn().mockImplementation((fn: string, params: any) => {
      if (fn === 'get_routine_catalog') {
        rpcCalledWith = { fn, params };
        return { select: selectSpy };
      }
      const fallback = Promise.resolve({ data: [], error: null });
      (fallback as any).select = vi.fn().mockReturnValue(fallback);
      return fallback;
    });

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'exercises') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                { id: 'ex-leg-1', name: 'Leg Curl', body_parts: ['Legs'], is_master: true },
              ],
              error: null,
            }),
          }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const { result } = renderHook(
      () => useWorkoutQueries(targetUserId, '2026-09-27'),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.templatesFetched).toBe(true);
    });

    expect(rpcCalledWith).toEqual({
      fn: 'get_routine_catalog',
      params: {
        p_user_id: targetUserId,
        p_limit: 200,
        p_cursor: null,
      },
    });
    expect(selectCalledWith).toBe('id,user_id,name,is_master,assigned_to,days_of_week,created_at');
    expect(result.current.customTemplates.some((t) => t.name === 'Leg Day Catalog')).toBe(true);
    const loadedRoutine = result.current.customTemplates.find((t) => t.id === routineId);
    expect((loadedRoutine as any)?.exercises).toBeUndefined();
  });

  it('falls back to legacy REST routine_templates query and logs warning when get_routine_catalog RPC errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rpcError = new Error('RPC connection failure');

    (supabase as any).rpc = vi.fn().mockImplementation((fn: string) => {
      if (fn === 'get_routine_catalog') {
        return {
          select: vi.fn().mockResolvedValue({ data: null, error: rpcError }),
        };
      }
      const fallback = Promise.resolve({ data: [], error: null });
      (fallback as any).select = vi.fn().mockReturnValue(fallback);
      return fallback;
    });

    let restQueried = false;
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'routine_templates') {
        restQueried = true;
        return {
          select: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'rest-fallback-1',
                name: 'Fallback Routine',
                is_master: false,
                user_id: targetUserId,
                assigned_to: null,
                days_of_week: ['Sun'],
                created_at: '2026-09-01T00:00:00Z',
              },
            ],
            error: null,
          }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const { result } = renderHook(
      () => useWorkoutQueries(targetUserId, '2026-09-27'),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.templatesFetched).toBe(true);
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[useWorkoutQueries] get_routine_catalog RPC warning:',
      rpcError
    );
    expect(restQueried).toBe(true);
    expect(result.current.customTemplates.some((t) => t.name === 'Fallback Routine')).toBe(true);
    warnSpy.mockRestore();
  });
  it('pages exercises with .range() to load complete 210-row catalog without silent truncation', async () => {
    const mock210 = Array.from({ length: 210 }, (_, i) => ({
      id: `ex-${i + 1}`,
      name: i === 209 ? 'Zottman Curl' : `Exercise ${String(i + 1).padStart(3, '0')}`,
      body_parts: ['Arms'],
      is_master: true,
    }));

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'exercises') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockImplementation((start: number, end: number) => {
            const slice = mock210.slice(start, end + 1);
            return Promise.resolve({ data: slice, error: null });
          }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        range: vi.fn().mockResolvedValue({ data: [], error: null }),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const { result } = renderHook(
      () => useWorkoutQueries(targetUserId, '2026-09-27'),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.exercisesFetched).toBe(true);
    });

    expect(result.current.exercises).toHaveLength(210);
    expect(result.current.exercises[209].name).toBe('Zottman Curl');
  });

  it('overlays pending sets and updates PR benchmarks in weight and e1rm mode (c)', async () => {
    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue([
      {
        opId: 'op-1',
        seq: 1,
        userId: targetUserId,
        createdAt: '2026-09-27T10:00:00.000Z',
        attempts: 0,
        state: 'pending',
        kind: 'workout.ensure',
        payload: {
          clientWorkoutId: 'offline-workout-2026-09-27',
          workout_date: '2026-09-27',
          name: 'Push Day',
        },
      },
      {
        opId: 'op-2',
        seq: 2,
        userId: targetUserId,
        createdAt: '2026-09-27T10:05:00.000Z',
        attempts: 0,
        state: 'pending',
        kind: 'set.create',
        payload: {
          id: 'set-offline-1',
          workoutRef: 'offline-workout-2026-09-27',
          exercise_id: 'ex-bench-uuid',
          weight: 315,
          reps: 5,
          set_index: 1,
          set_type: 'working',
          created_at: '2026-09-27T10:05:00.000Z',
        },
      },
    ]);

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any);

    // Test in weight mode
    const { result } = renderHook(
      () => useWorkoutQueries(targetUserId, '2026-09-27'),
      { wrapper }
    );

    // Verify todaySets has the pending set
    expect(result.current.todaySets.some((s) => s.id === 'set-offline-1')).toBe(true);
    const pendingSet = result.current.todaySets.find((s) => s.id === 'set-offline-1');
    expect(pendingSet?.weight).toBe(315);
    expect(pendingSet?.reps).toBe(5);

    // Verify benchmarks has the PR calculated from the pending set
    expect(result.current.benchmarks['ex-bench-uuid']).toBeDefined();
    expect(result.current.benchmarks['ex-bench-uuid'].pr?.weight).toBe(315);
    expect(result.current.benchmarks['ex-bench-uuid'].pr?.reps).toBe(5);

    // Test in e1rm mode via AuthContext
    const authWrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          AuthContext.Provider,
          { value: { profile: { pr_mode: 'e1rm' } } as any },
          children
        )
      );

    const { result: e1rmResult } = renderHook(
      () => useWorkoutQueries(targetUserId, '2026-09-27'),
      { wrapper: authWrapper }
    );

    expect((e1rmResult.current.benchmarks['ex-bench-uuid'].pr as any)?.e1rm).toBeGreaterThan(315);
  });
});
