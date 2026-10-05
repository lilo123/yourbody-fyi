import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useHistoryMealDeferredDelete } from './useHistoryMealDeferredDelete';
import { supabase } from '../../lib/supabase';
import { deleteCachedLogItems } from '../nutrition/useNutritionData';
import { createSupabaseBuilder, clearMockHistory, getRecordedTables } from '../../test/supabaseBuilderMock';
import type { NutritionLog } from '../../types/database';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('../nutrition/useNutritionData', () => ({
  deleteCachedLogItems: vi.fn(),
}));

describe('useHistoryMealDeferredDelete (RD-7 contract)', () => {
  let queryClient: QueryClient;
  const setMutationError = vi.fn();
  const targetUserId = 'athlete-123';

  const mockMeal: NutritionLog = {
    id: 'meal-test-1',
    user_id: targetUserId,
    food_name: 'Salmon & Asparagus',
    meal_type: 'dinner',
    calories: 450,
    protein: 42,
    carbs: 8,
    fat: 28,
    fiber: 4,
    logged_at: '2026-09-27T19:00:00Z',
    logged_date: '2026-09-27',
  };

  let mockDeleteFn: ReturnType<typeof vi.fn<(id?: string) => void>>;
  let mockDeleteError: Error | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearMockHistory();
    mockDeleteError = null;

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    mockDeleteFn = vi.fn();

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        const builder = createSupabaseBuilder('nutrition_logs', {
          resolver: (b: any) => {
            if (b.isDeleted) {
              const eqFilter = b.filters?.find((f: any) => f.method === 'eq' && f.column === 'id');
              const id = eqFilter?.value;
              mockDeleteFn(id);
              if (mockDeleteError) {
                return { data: null, error: mockDeleteError };
              }
              return { data: null, error: null };
            }
            return { data: [], error: null };
          },
        });
        return builder as any;
      }
      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );

  it('undo -> 0 DELETE and restores row', async () => {
    // NO_PROJECTION_APPLIES: Meal deferred delete mutation only; no database select queries issued
    const builder = createSupabaseBuilder('nutrition_logs', null);
    expect(builder.tableName).toBe('nutrition_logs');
    expect(getRecordedTables()).toContain('nutrition_logs');

    const { result } = renderHook(
      () =>
        useHistoryMealDeferredDelete({
          targetUserId,
          setMutationError,
          isActive: true,
          meals: [mockMeal],
        }),
      { wrapper }
    );

    // Request deletion
    act(() => {
      result.current.handleDeleteMealRequested(mockMeal);
    });

    // Optimistically hidden
    expect(result.current.pendingDelete).not.toBeNull();
    expect(result.current.pendingDeleteMealId).toBe(mockMeal.id);
    expect(result.current.isMealPendingDelete(mockMeal.id)).toBe(true);

    // Toast displayed with correct copy
    expect(result.current.toastItem).not.toBeNull();
    expect(result.current.toastItem?.verb).toBe('Meal deleted');
    expect(result.current.toastItem?.subject).toBe('Salmon & Asparagus');
    expect(result.current.toastItem?.detail).toBe('450 kcal');

    // Click Undo before 6s expiry
    act(() => {
      result.current.toastItem?.onUndo?.();
    });

    // Advance past expiry window
    act(() => {
      vi.advanceTimersByTime(7000);
    });

    // Zero DELETE requests sent
    expect(mockDeleteFn).toHaveBeenCalledTimes(0);

    // Row is restored (no longer pending delete)
    expect(result.current.pendingDelete).toBeNull();
    expect(result.current.pendingDeleteMealId).toBeNull();
    expect(result.current.isMealPendingDelete(mockMeal.id)).toBe(false);
    expect(result.current.toastItem).toBeNull();
  });

  it('expiry -> 1 DELETE after 6s', async () => {
    const { result } = renderHook(
      () =>
        useHistoryMealDeferredDelete({
          targetUserId,
          setMutationError,
          isActive: true,
          meals: [mockMeal],
        }),
      { wrapper }
    );

    act(() => {
      result.current.handleDeleteMealRequested(mockMeal);
    });

    expect(mockDeleteFn).toHaveBeenCalledTimes(0);

    // Advance 6000ms
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    expect(mockDeleteFn).toHaveBeenCalledTimes(1);
    expect(mockDeleteFn).toHaveBeenCalledWith(mockMeal.id);
  });

  it('unmount -> 1 DELETE flushed immediately', async () => {
    const { result, unmount } = renderHook(
      () =>
        useHistoryMealDeferredDelete({
          targetUserId,
          setMutationError,
          isActive: true,
          meals: [mockMeal],
        }),
      { wrapper }
    );

    act(() => {
      result.current.handleDeleteMealRequested(mockMeal);
    });

    expect(mockDeleteFn).toHaveBeenCalledTimes(0);

    // Unmount hook before expiry
    await act(async () => {
      unmount();
    });

    expect(mockDeleteFn).toHaveBeenCalledTimes(1);
    expect(mockDeleteFn).toHaveBeenCalledWith(mockMeal.id);
  });

  it('isActive false -> 1 DELETE flushed immediately on route navigation', async () => {
    let active = true;
    const { result, rerender } = renderHook(
      () =>
        useHistoryMealDeferredDelete({
          targetUserId,
          setMutationError,
          isActive: active,
          meals: [mockMeal],
        }),
      { wrapper }
    );

    act(() => {
      result.current.handleDeleteMealRequested(mockMeal);
    });

    expect(mockDeleteFn).toHaveBeenCalledTimes(0);

    // User navigates away: HistoryView remains mounted in <Activity> but isActive becomes false
    active = false;
    await act(async () => {
      rerender();
    });

    expect(mockDeleteFn).toHaveBeenCalledTimes(1);
    expect(mockDeleteFn).toHaveBeenCalledWith(mockMeal.id);
  });

  it('failure -> restore + error via setMutationError', async () => {
    mockDeleteError = new Error('Database connection failed');

    const { result } = renderHook(
      () =>
        useHistoryMealDeferredDelete({
          targetUserId,
          setMutationError,
          isActive: true,
          meals: [mockMeal],
        }),
      { wrapper }
    );

    act(() => {
      result.current.handleDeleteMealRequested(mockMeal);
    });

    // Flush delete
    await act(async () => {
      result.current.flushDelete();
    });

    // Error reported exactly once (no duplicate invocation between commit and onError)
    expect(setMutationError).toHaveBeenCalledTimes(1);
    expect(setMutationError).toHaveBeenCalledWith('Database connection failed');

    // Row restored: pending cleared
    expect(result.current.pendingDelete).toBeNull();
    expect(result.current.pendingDeleteMealId).toBeNull();

    // Cache not deleted on error
    expect(deleteCachedLogItems).not.toHaveBeenCalled();
  });

  it('cache removed only on success', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () =>
        useHistoryMealDeferredDelete({
          targetUserId,
          setMutationError,
          isActive: true,
          meals: [mockMeal],
        }),
      { wrapper }
    );

    act(() => {
      result.current.handleDeleteMealRequested(mockMeal);
    });

    // Before commit, cache is untouched
    expect(deleteCachedLogItems).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Flush successfully
    await act(async () => {
      result.current.flushDelete();
    });

    expect(deleteCachedLogItems).toHaveBeenCalledWith(mockMeal.id);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['nutrition_logs', targetUserId] });
  });

  it('no double commit when both isActive->false and unmount happen', async () => {
    let active = true;
    const { result, rerender, unmount } = renderHook(
      () =>
        useHistoryMealDeferredDelete({
          targetUserId,
          setMutationError,
          isActive: active,
          meals: [mockMeal],
        }),
      { wrapper }
    );

    act(() => {
      result.current.handleDeleteMealRequested(mockMeal);
    });

    expect(mockDeleteFn).toHaveBeenCalledTimes(0);

    // Route leave occurs: isActive becomes false
    active = false;
    await act(async () => {
      rerender();
    });

    expect(mockDeleteFn).toHaveBeenCalledTimes(1);
    expect(mockDeleteFn).toHaveBeenCalledWith(mockMeal.id);

    // Component subsequently unmounts
    await act(async () => {
      unmount();
    });

    // Exactly 1 DELETE committed total: no double commit
    expect(mockDeleteFn).toHaveBeenCalledTimes(1);
  });

  it('two quick deletes: first is committed immediately when second is scheduled (no lost delete)', async () => {
    const secondMeal: NutritionLog = {
      ...mockMeal,
      id: 'meal-test-2',
      food_name: 'Greek Yogurt Bowl',
      calories: 220,
    };

    const { result } = renderHook(
      () =>
        useHistoryMealDeferredDelete({
          targetUserId,
          setMutationError,
          isActive: true,
          meals: [mockMeal, secondMeal],
        }),
      { wrapper }
    );

    // 1. Delete first meal
    act(() => {
      result.current.handleDeleteMealRequested(mockMeal);
    });
    expect(result.current.pendingDeleteMealId).toBe(mockMeal.id);
    expect(mockDeleteFn).toHaveBeenCalledTimes(0);

    // 2. Immediately delete second meal before first expires
    await act(async () => {
      result.current.handleDeleteMealRequested(secondMeal);
    });

    // First meal must be flushed/committed immediately on scheduling second
    expect(mockDeleteFn).toHaveBeenCalledTimes(1);
    expect(mockDeleteFn).toHaveBeenLastCalledWith(mockMeal.id);

    // Second meal is now pending
    expect(result.current.pendingDeleteMealId).toBe(secondMeal.id);

    // 3. Let second meal expire
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    // Both meals committed; exactly 2 DELETEs, 0 lost
    expect(mockDeleteFn).toHaveBeenCalledTimes(2);
    expect(mockDeleteFn).toHaveBeenLastCalledWith(secondMeal.id);
  });
});
