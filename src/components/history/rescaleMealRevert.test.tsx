import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useNutritionData,
  clearLogItemsMemoryCache,
  getCachedLogItems,
  logItemsMemoryCache,
} from '../nutrition/useNutritionData';
import { useHistoryData } from './useHistoryData';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, clearMockHistory, getRecordedTables, getRecordedSelects } from '../../test/supabaseBuilderMock';
import type { NutritionLog } from '../../types/database';
import type { NutritionItem } from '../../utils/itemModel';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('../../offline', () => ({
  useOverlaidNutritionLogs: vi.fn((logs: any) => logs),
  usePendingOps: vi.fn(() => []),
  enqueueAndAwait: vi.fn().mockImplementation(async (input: any) => {
    await (supabase.from('nutrition_logs') as any).insert(input.payload);
    return { status: 'synced', opId: 'mock-op-1' };
  }),
  setFlusherSessionUser: vi.fn(),
  subscribeToOutbox: vi.fn(() => () => {}),
  getOutboxOps: vi.fn().mockResolvedValue([]),
}));

describe('NEW-16: Rescale meal from /history consistency and silent revert prevention', () => {
  let queryClient: QueryClient;
  let mockDatabase: Record<string, any>;

  beforeEach(() => {
    // Explicitly reset module-scoped memory cache between test cases to prevent state leakage
    clearLogItemsMemoryCache();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
    clearMockHistory();
    mockDatabase = {};

    vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as any);

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        const builder = createSupabaseBuilder('nutrition_logs', {
          resolver: (b: any) => {
            // Detail fetch: projection includes 'items'
            if (b.projection && b.projection.includes('items')) {
              const eqIdFilter = b.filters.find((f: any) => f.column === 'id');
              const id = eqIdFilter?.value;
              return id && mockDatabase[id] ? mockDatabase[id] : null;
            }

            // Update mutation
            if (b.updatedData) {
              const eqIdFilter = b.filters.find((f: any) => f.column === 'id');
              const id = eqIdFilter?.value;
              if (id && mockDatabase[id]) {
                mockDatabase[id] = {
                  ...mockDatabase[id],
                  ...b.updatedData,
                };
                return { data: [mockDatabase[id]], error: null };
              }
              return { data: [b.updatedData], error: null };
            }

            // Insert mutation
            if (b.insertedData) {
              const items = Array.isArray(b.insertedData) ? b.insertedData : [b.insertedData];
              const saved = items.map((row: any, idx: number) => {
                const id = row.id || `mock-id-${idx + 1}`;
                const savedRow = { ...row, id, created_at: row.created_at || new Date().toISOString() };
                mockDatabase[id] = savedRow;
                return savedRow;
              });
              return { data: saved, error: null };
            }

            // Delete mutation
            if (b.isDeleted) {
              const eqIdFilter = b.filters.find((f: any) => f.column === 'id');
              const id = eqIdFilter?.value;
              if (id) {
                delete mockDatabase[id];
              }
              return { data: null, error: null };
            }

            // List query (deliberately omits 'items' jsonb column for payload optimization)
            const rows = Object.values(mockDatabase).map((row) => {
              const { items: _omittedItems, ...rest } = row;
              return rest;
            });
            return rows;
          },
        });
        return builder as any;
      }

      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });
  });

  afterEach(() => {
    clearLogItemsMemoryCache();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('reproduces silent data-loss: rescaling from /history must update cache so /nutrition rehydrates rescaled items', async () => {
    const targetUserId = 'test-athlete-1';
    const testLogId = 'test-meal-rescale-1';
    const selectedDate = '2026-09-22';

    const initialItems: NutritionItem[] = [
      {
        id: 'item-1',
        name: 'Chicken Breast',
        quantity: 200,
        unit: 'g',
        calories: 330,
        protein: 62,
        carbs: 0,
        fat: 7,
        fiber: 0,
      },
      {
        id: 'item-2',
        name: 'Brown Rice',
        quantity: 150,
        unit: 'g',
        calories: 165,
        protein: 4,
        carbs: 35,
        fat: 1.5,
        fiber: 2,
      },
    ];

    // 1. Seed a log with known items via /nutrition path to prime the cache
    const { result: nutritionResult } = renderHook(
      () =>
        useNutritionData({
          targetUserId,
          selectedDate,
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    await nutritionResult.current.mutation.mutateAsync({
      id: testLogId,
      user_id: targetUserId,
      food_name: 'Chicken & Rice',
      meal_type: 'lunch',
      calories: 495,
      protein: 66,
      carbs: 35,
      fat: 8.5,
      fiber: 2,
      logged_at: '2026-09-22T12:00:00.000Z',
      items: initialItems,
    } as any);

    // Verify initial state in mockDatabase and cache
    expect(mockDatabase[testLogId]).toBeDefined();
    expect(mockDatabase[testLogId].items).toHaveLength(2);
    expect(getCachedLogItems(testLogId)).toEqual(initialItems);

    // 2. Rescale the meal (x2) through the /history path
    const { result: historyResult } = renderHook(
      () => useHistoryData(targetUserId),
      { wrapper }
    );

    const rescaledItems: NutritionItem[] = [
      {
        id: 'item-1',
        name: 'Chicken Breast',
        quantity: 400,
        unit: 'g',
        calories: 660,
        protein: 124,
        carbs: 0,
        fat: 14,
        fiber: 0,
      },
      {
        id: 'item-2',
        name: 'Brown Rice',
        quantity: 300,
        unit: 'g',
        calories: 330,
        protein: 8,
        carbs: 70,
        fat: 3,
        fiber: 4,
      },
    ];

    const unscaledHistoryLog: NutritionLog = {
      id: testLogId,
      user_id: targetUserId,
      food_name: 'Chicken & Rice',
      meal_type: 'lunch',
      calories: 495,
      protein: 66,
      carbs: 35,
      fat: 8.5,
      fiber: 2,
      logged_at: '2026-09-22T12:00:00.000Z',
    };

    await historyResult.current.scaleMealMutation.mutateAsync({
      log: unscaledHistoryLog,
      items: rescaledItems,
    });

    // Verify the DB updated properly
    expect(mockDatabase[testLogId].calories).toBe(990);
    expect(mockDatabase[testLogId].items[0].quantity).toBe(400);

    // 3. Re-read through the /nutrition rehydration path
    await nutritionResult.current.refetchNutritionLogs();

    await waitFor(() => {
      expect(nutritionResult.current.nutritionLogs.length).toBeGreaterThan(0);
    });

    const rehydratedLog = nutritionResult.current.nutritionLogs.find((l) => l.id === testLogId);
    expect(rehydratedLog).toBeDefined();

    // 4. Assert the observable rehydrated items are the rescaled ones (NOT the pre-rescale cached ones)
    expect(rehydratedLog!.items).toBeDefined();
    expect(rehydratedLog!.items![0].quantity).toBe(400);
    expect(rehydratedLog!.items![1].quantity).toBe(300);
    expect(rehydratedLog!.items![0].calories).toBe(660);
    expect(rehydratedLog!.items![1].calories).toBe(330);

    expect(getRecordedTables()).toContain('nutrition_logs');
    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
    });
  });

  it('prevents silent revert: subsequent write-back from /nutrition after /history rescale does not roll back to pre-rescale items', async () => {
    const targetUserId = 'test-athlete-2';
    const testLogId = 'test-meal-revert-prevention';
    const selectedDate = '2026-09-22';

    const initialItems: NutritionItem[] = [
      {
        id: 'item-1',
        name: 'Oatmeal',
        quantity: 100,
        unit: 'g',
        calories: 380,
        protein: 13,
        carbs: 68,
        fat: 7,
        fiber: 10,
      },
    ];

    const { result: nutritionResult } = renderHook(
      () =>
        useNutritionData({
          targetUserId,
          selectedDate,
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    // Seed log in /nutrition
    await nutritionResult.current.mutation.mutateAsync({
      id: testLogId,
      user_id: targetUserId,
      food_name: 'Morning Oats',
      meal_type: 'breakfast',
      calories: 380,
      protein: 13,
      carbs: 68,
      fat: 7,
      fiber: 10,
      logged_at: '2026-09-22T08:00:00.000Z',
      items: initialItems,
    } as any);

    // Rescale to 1.5x in /history
    const { result: historyResult } = renderHook(
      () => useHistoryData(targetUserId),
      { wrapper }
    );

    const rescaledItems: NutritionItem[] = [
      {
        id: 'item-1',
        name: 'Oatmeal',
        quantity: 150,
        unit: 'g',
        calories: 570,
        protein: 19.5,
        carbs: 102,
        fat: 10.5,
        fiber: 15,
      },
    ];

    await historyResult.current.scaleMealMutation.mutateAsync({
      log: {
        id: testLogId,
        user_id: targetUserId,
        food_name: 'Morning Oats',
        calories: 380,
        protein: 13,
        carbs: 68,
        fat: 7,
        fiber: 10,
        logged_at: '2026-09-22T08:00:00.000Z',
      } as any,
      items: rescaledItems,
    });

    // Re-fetch in /nutrition
    await nutritionResult.current.refetchNutritionLogs();
    await waitFor(() => {
      const rehydrated = nutritionResult.current.nutritionLogs.find((l) => l.id === testLogId);
      expect(rehydrated?.items?.[0].quantity).toBe(150);
    });
    const rehydrated = nutritionResult.current.nutritionLogs.find((l) => l.id === testLogId)!;

    // Now user in MealLogRow edits the portion (e.g. adjusts oatmeal to 160g)
    const editedItems: NutritionItem[] = [
      {
        ...rehydrated!.items![0],
        quantity: 160,
        calories: 608,
        protein: 20.8,
        carbs: 108.8,
        fat: 11.2,
        fiber: 16,
      },
    ];

    // Write back via /nutrition scaleLogMutation
    await nutritionResult.current.scaleLogMutation.mutateAsync({
      log: rehydrated!,
      items: editedItems,
    });

    // Verify DB contains the new edit based on the rescaled 150g, NOT reverted to 100g
    expect(mockDatabase[testLogId].items[0].quantity).toBe(160);
    expect(mockDatabase[testLogId].calories).toBe(608);
  });

  it('refetches items on-demand inside scaleMealMutation when items are omitted and updates cache', async () => {
    const targetUserId = 'test-athlete-3';
    const testLogId = 'test-meal-ondemand-scale';

    // Seed mockDatabase directly with items, but cache is empty
    mockDatabase[testLogId] = {
      id: testLogId,
      user_id: targetUserId,
      food_name: 'Salmon Salad',
      meal_type: 'dinner',
      calories: 400,
      protein: 30,
      carbs: 10,
      fat: 25,
      fiber: 4,
      logged_at: '2026-09-22T19:00:00.000Z',
      items: [
        {
          id: 'item-salmon',
          name: 'Salmon',
          quantity: 100,
          unit: 'g',
          calories: 200,
          protein: 22,
          carbs: 0,
          fat: 12,
          fiber: 0,
        },
        {
          id: 'item-salad',
          name: 'Greens',
          quantity: 200,
          unit: 'g',
          calories: 200,
          protein: 8,
          carbs: 10,
          fat: 13,
          fiber: 4,
        },
      ],
    };

    expect(getCachedLogItems(testLogId)).toBeUndefined();

    const { result: historyResult } = renderHook(
      () => useHistoryData(targetUserId),
      { wrapper }
    );

    // Call scaleMealMutation without items, passing log without items
    await historyResult.current.scaleMealMutation.mutateAsync({
      log: {
        id: testLogId,
        user_id: targetUserId,
        food_name: 'Salmon Salad',
        calories: 400,
        protein: 30,
        carbs: 10,
        fat: 25,
        fiber: 4,
        logged_at: '2026-09-22T19:00:00.000Z',
      } as any,
    });

    // The items fetched on demand are normalized and cached
    const cached = getCachedLogItems(testLogId);
    expect(cached).toBeDefined();
    expect(cached).toHaveLength(2);
    expect(cached[0].name).toBe('Salmon');

    expect(getRecordedTables()).toContain('nutrition_logs');
    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection: 'id, items, calories, protein, carbs, fat, fiber',
    });
  });

  it('deleteMealMutation in /history evicts the deleted log from logItemsMemoryCache', async () => {
    const targetUserId = 'test-athlete-4';
    const testLogId = 'test-meal-to-delete';

    mockDatabase[testLogId] = {
      id: testLogId,
      user_id: targetUserId,
      food_name: 'Snack Bar',
      calories: 200,
      items: [{ id: 'bar', name: 'Bar', quantity: 1, unit: 'unit', calories: 200, protein: 10, carbs: 20, fat: 5, fiber: 2 }],
    };

    // Prime the cache
    logItemsMemoryCache.set(testLogId, mockDatabase[testLogId].items);
    expect(getCachedLogItems(testLogId)).toBeDefined();

    const { result: historyResult } = renderHook(
      () => useHistoryData(targetUserId),
      { wrapper }
    );

    await historyResult.current.deleteMealMutation.mutateAsync(testLogId);

    // Assert cache was evicted
    expect(getCachedLogItems(testLogId)).toBeUndefined();
    expect(mockDatabase[testLogId]).toBeUndefined();
  });
});
