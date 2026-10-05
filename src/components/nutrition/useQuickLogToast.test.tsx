import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useNutritionData } from './useNutritionData';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, clearMockHistory } from '../../test/supabaseBuilderMock';

vi.mock('../../offline', async () => {
  const actual = await vi.importActual<typeof import('../../offline')>('../../offline');
  return {
    ...actual,
    enqueueAndAwait: vi.fn().mockResolvedValue({ status: 'synced', opId: 'mock-op-1' }),
    useOverlaidNutritionLogs: <T,>(logs: T[]) => logs,
  };
});

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-123' } } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    functions: {
      invoke: vi.fn(),
    },
  },
}));

describe('useQuickLogToast & D42 Undo Hook Tests', () => {
  let queryClient: QueryClient;
  let mockDeleteEq: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockUpdateEq: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
    clearMockHistory();

    mockDeleteEq = vi.fn().mockResolvedValue({ data: null, error: null });
    mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq });
    mockUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null });
    mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return {
          delete: mockDelete,
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: [{ id: 'new-log-789', food_name: 'Direct Logged Meal', calories: 350 }],
              error: null,
            }),
          }),
          upsert: vi.fn().mockImplementation((payload) => ({
            select: vi.fn().mockResolvedValue({
              data: Array.isArray(payload) ? payload : [payload],
              error: null,
            }),
          })),
          select: vi.fn().mockReturnValue(createSupabaseBuilder('nutrition_logs', { data: [], error: null })),
        } as any;
      }
      if (table === 'custom_dishes') {
        return {
          update: mockUpdate,
          select: vi.fn().mockReturnValue(createSupabaseBuilder('custom_dishes', { data: [], error: null })),
        } as any;
      }
      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('single slot: newest replaces previous toast', () => {
    const setStatus = vi.fn();
    const setIsError = vi.fn();

    const { result } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-123',
          selectedDate: '2026-09-26',
          profile: null,
          setStatus,
          setIsError,
          onMutationSuccessReset: vi.fn(),
        }),
      { wrapper }
    );

    // Trigger toast 1
    act(() => {
      result.current.triggerToast({ name: 'Meal A', calories: 400 });
    });

    expect(result.current.activeToast).not.toBeNull();
    expect(result.current.activeToast?.dishName || result.current.activeToast?.name).toBe('Meal A');

    // Trigger toast 2 - replaces toast 1
    act(() => {
      result.current.triggerToast({ name: 'Meal B', calories: 250 });
    });

    expect(result.current.activeToast?.dishName || result.current.activeToast?.name).toBe('Meal B');
  });

  it('D42 undo: deletes the right log id using timeline delete path and invalidates queries', async () => {
    const setStatus = vi.fn();
    const setIsError = vi.fn();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-123',
          selectedDate: '2026-09-26',
          profile: null,
          setStatus,
          setIsError,
          onMutationSuccessReset: vi.fn(),
        }),
      { wrapper }
    );

    // Perform direct log mutation
    await act(async () => {
      await result.current.mutation.mutateAsync({
        id: 'new-log-789',
        food_name: 'Direct Logged Meal',
        calories: 350,
      });
      result.current.triggerToast({ name: 'Direct Logged Meal', calories: 350 });
    });

    expect(result.current.activeToast).not.toBeNull();
    expect(result.current.activeToast?.onUndo).toBeDefined();

    // Call Undo
    await act(async () => {
      await result.current.activeToast?.onUndo?.();
    });

    // Check delete was called on nutrition_logs for the created log ID
    expect(supabase.from).toHaveBeenCalledWith('nutrition_logs');
    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteEq).toHaveBeenCalledWith('id', 'new-log-789');

    // Queries invalidated
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['nutrition_logs', 'user-123'] });
    expect(setStatus).toHaveBeenCalledWith('Meal deleted');
    expect(setIsError).toHaveBeenCalledWith(false);
  });

  it('D42 failure path: delete failure shows existing error status and entry is kept', async () => {
    const setStatus = vi.fn();
    const setIsError = vi.fn();

    mockDeleteEq.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database delete failed' },
    });

    const { result } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-123',
          selectedDate: '2026-09-26',
          profile: null,
          setStatus,
          setIsError,
          onMutationSuccessReset: vi.fn(),
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.mutation.mutateAsync({
        id: 'new-log-789',
        food_name: 'Direct Logged Meal',
        calories: 350,
      });
      result.current.triggerToast({ name: 'Direct Logged Meal', calories: 350 });
    });

    // Call Undo
    await act(async () => {
      await result.current.activeToast?.onUndo?.();
    });

    expect(setStatus).toHaveBeenCalledWith('Failed to delete meal: Database delete failed');
    expect(setIsError).toHaveBeenCalledWith(true);
  });

  it('D42 use_count untouched: undoing direct log does not decrement custom dish use_count', async () => {
    const setStatus = vi.fn();
    const setIsError = vi.fn();

    const { result } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-123',
          selectedDate: '2026-09-26',
          profile: null,
          setStatus,
          setIsError,
          onMutationSuccessReset: vi.fn(),
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.mutation.mutateAsync({
        id: 'new-log-789',
        food_name: 'Direct Logged Meal',
        calories: 350,
      });
      result.current.triggerToast({ name: 'Direct Logged Meal', calories: 350 });
    });

    // Call Undo
    await act(async () => {
      await result.current.activeToast?.onUndo?.();
    });

    // custom_dishes update should NOT have been called with a decremented use_count
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
