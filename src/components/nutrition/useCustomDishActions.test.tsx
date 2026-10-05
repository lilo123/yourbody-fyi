import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useCustomDishActions } from './useCustomDishActions';
import type { CustomDish, CustomDishDetail } from '../../types/database';
import { isWithinDayBounds } from '../../utils/date';
import { supabase } from '../../lib/supabase';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('useCustomDishActions', () => {
  let queryClient: QueryClient;
  let mockUpdateEq: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();

    mockUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null });
    mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });
    vi.mocked(supabase.from).mockReturnValue({
      update: mockUpdate,
    } as any);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('stages a single-component dish into a staged meal with calculated macros and updates use_count', async () => {
    const setStagedMeal = vi.fn();
    const setDishFetchError = vi.fn();
    const dish: CustomDish = {
      id: 'dish-single-1',
      user_id: 'user-123',
      name: 'Oatmeal',
      calories: 150,
      protein: 5,
      carbs: 27,
      fat: 3,
      fiber: 4,
      kind: 'food',
      use_count: 3,
      notes: 'Steel cut oats',
    };

    const dishDetail: CustomDishDetail = {
      ...dish,
      items: [
        {
          id: 'item-1',
          name: 'Steel Cut Oats',
          quantity: 40,
          unit: 'g',
          displayPortion: '40g',
          calories: 150,
          protein: 5,
          carbs: 27,
          fat: 3,
          fiber: 4,
        },
      ],
    };

    const fetchDishDetail = vi.fn().mockResolvedValue(dishDetail);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () =>
        useCustomDishActions({
          targetUserId: 'user-123',
          selectedDate: '2026-09-26',
          setStagedMeal,
          setDishFetchError,
          fetchDishDetail,
          mutation: { mutate: vi.fn() },
          triggerToast: vi.fn(),
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleStageCustomDish(dish);
    });

    expect(setDishFetchError).toHaveBeenCalledWith(null);
    expect(fetchDishDetail).toHaveBeenCalledWith('dish-single-1');
    expect(setStagedMeal).toHaveBeenCalledTimes(1);

    const stagedArg = setStagedMeal.mock.calls[0][0];
    expect(stagedArg.name).toBe('Oatmeal');
    expect(stagedArg.mealType).toBe('Breakfast');
    expect(stagedArg.items).toHaveLength(1);
    expect(stagedArg.items[0].name).toBe('Steel Cut Oats');
    expect(stagedArg.calories).toBe(150);
    expect(stagedArg.protein).toBe(5);
    expect(stagedArg.carbs).toBe(27);
    expect(stagedArg.fat).toBe(3);
    expect(stagedArg.fiber).toBe(4);
    expect(stagedArg.notes).toBe('Steel cut oats');
    expect(stagedArg.servingSize).toBe(1);
    expect(stagedArg.servingUnit).toBe('serving');

    // use_count update
    expect(supabase.from).toHaveBeenCalledWith('custom_dishes');
    expect(mockUpdate).toHaveBeenCalledWith({ use_count: 4 });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'dish-single-1');

    await vi.waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['custom_dishes', 'user-123'] });
    });
  });

  it('stages a multi-component dish preserving all components and total macros', async () => {
    const setStagedMeal = vi.fn();
    const dish: CustomDish = {
      id: 'dish-multi-1',
      user_id: 'user-123',
      name: 'Chicken Rice Bowl',
      calories: 550,
      protein: 45,
      carbs: 60,
      fat: 12,
      fiber: 5,
      kind: 'recipe',
      use_count: 10,
    };

    const dishDetail: CustomDishDetail = {
      ...dish,
      items: [
        {
          id: 'item-chicken',
          name: 'Chicken Breast',
          quantity: 200,
          unit: 'g',
          displayPortion: '200g',
          calories: 330,
          protein: 40,
          carbs: 0,
          fat: 7,
          fiber: 0,
        },
        {
          id: 'item-rice',
          name: 'Jasmine Rice',
          quantity: 150,
          unit: 'g',
          displayPortion: '150g',
          calories: 220,
          protein: 5,
          carbs: 60,
          fat: 5,
          fiber: 5,
        },
      ],
    };

    const fetchDishDetail = vi.fn().mockResolvedValue(dishDetail);

    const { result } = renderHook(
      () =>
        useCustomDishActions({
          targetUserId: 'user-123',
          selectedDate: '2026-09-26',
          setStagedMeal,
          fetchDishDetail,
          mutation: { mutate: vi.fn() },
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleStageCustomDish(dish);
    });

    expect(setStagedMeal).toHaveBeenCalledTimes(1);
    const stagedArg = setStagedMeal.mock.calls[0][0];
    expect(stagedArg.name).toBe('Chicken Rice Bowl');
    expect(stagedArg.items).toHaveLength(2);
    expect(stagedArg.calories).toBe(550);
    expect(stagedArg.protein).toBe(45);
    expect(stagedArg.carbs).toBe(60);
    expect(stagedArg.fat).toBe(12);
    expect(stagedArg.fiber).toBe(5);
    expect(stagedArg.explanation).toBeDefined();

    expect(mockUpdate).toHaveBeenCalledWith({ use_count: 11 });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'dish-multi-1');
  });

  it('stages a synthetic single serving when dish detail has no items or ingredients', async () => {
    const setStagedMeal = vi.fn();
    const dish: CustomDish = {
      id: 'dish-empty-1',
      user_id: 'user-123',
      name: 'Protein Shake',
      calories: 200,
      protein: 30,
      carbs: 5,
      fat: 3,
      fiber: 2,
      kind: 'food',
      use_count: 0,
    };

    const fetchDishDetail = vi.fn().mockResolvedValue({ ...dish, items: null, ingredients: null });

    const { result } = renderHook(
      () =>
        useCustomDishActions({
          targetUserId: 'user-123',
          selectedDate: '2026-09-26',
          setStagedMeal,
          fetchDishDetail,
          mutation: { mutate: vi.fn() },
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleStageCustomDish(dish);
    });

    expect(setStagedMeal).toHaveBeenCalledTimes(1);
    const stagedArg = setStagedMeal.mock.calls[0][0];
    expect(stagedArg.name).toBe('Protein Shake');
    expect(stagedArg.items).toHaveLength(1);
    expect(stagedArg.items[0].name).toBe('Protein Shake');
    expect(stagedArg.items[0].portion).toBe('1 serving');
    expect(stagedArg.calories).toBe(200);
    expect(stagedArg.protein).toBe(30);

    expect(mockUpdate).toHaveBeenCalledWith({ use_count: 1 });
  });

  it('directly quick-logs custom dish when nothing is staged with exact mutation payload, date, use_count and toast', async () => {
    const mutate = vi.fn().mockImplementation((_payload, options) => {
      options?.onSuccess?.();
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const triggerToast = vi.fn();
    const dish: CustomDish = {
      id: 'dish-quick-1',
      user_id: 'user-123',
      name: 'Greek Yogurt Cup',
      calories: 130.4,
      protein: 15.2,
      carbs: 8.7,
      fat: 2.1,
      fiber: 0,
      kind: 'food',
      notes: 'Vanilla flavor',
      use_count: 7,
    };

    const { result } = renderHook(
      () =>
        useCustomDishActions({
          targetUserId: 'user-123',
          selectedDate: '2026-09-26',
          setStagedMeal: vi.fn(),
          mutation: { mutate },
          triggerToast,
        }),
      { wrapper }
    );

    const stopPropagation = vi.fn();
    const mockEvent = { stopPropagation } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleQuickLogCustomDishDirect(dish, mockEvent);
    });

    expect(stopPropagation).toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledTimes(1);
    const payload = mutate.mock.calls[0][0];
    expect(payload).toEqual({
      id: expect.any(String),
      food_name: 'Greek Yogurt Cup',
      calories: 130.4,
      protein: 15.2,
      carbs: 8.7,
      fat: 2.1,
      fiber: 0,
      meal_type: 'Breakfast',
      serving_size: 1,
      serving_unit: 'serving',
      logged_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      logged_date: '2026-09-26',
      notes: 'Vanilla flavor',
      incrementDishId: 'dish-quick-1',
    });
    expect(isWithinDayBounds(payload.logged_at, '2026-09-26')).toBe(true);

    // Quick-log does not perform direct custom_dishes update; replay flushes it via incrementDishId
    expect(mockUpdate).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['custom_dishes', 'user-123'] });
    });

    expect(triggerToast).toHaveBeenCalledWith(dish);
  });

  it('sets dish fetch error with retry callback when detail fetching fails and clears error on next attempt', async () => {
    const setDishFetchError = vi.fn();
    const setStagedMeal = vi.fn();
    const dish: CustomDish = {
      id: 'dish-fail-1',
      user_id: 'user-123',
      name: 'Failing Dish',
      calories: 100,
      protein: 10,
      carbs: 10,
      fat: 2,
      fiber: 1,
      kind: 'food',
      use_count: 0,
    };

    const fetchDishDetail = vi.fn().mockRejectedValueOnce(new Error('Network error loading details'));

    const { result } = renderHook(
      () =>
        useCustomDishActions({
          targetUserId: 'user-123',
          selectedDate: '2026-09-26',
          setStagedMeal,
          setDishFetchError,
          fetchDishDetail,
          mutation: { mutate: vi.fn() },
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleStageCustomDish(dish);
    });

    expect(setDishFetchError).toHaveBeenNthCalledWith(1, null);
    expect(setDishFetchError).toHaveBeenNthCalledWith(2, {
      message: 'Network error loading details',
      retry: expect.any(Function),
    });
    expect(setStagedMeal).not.toHaveBeenCalled();

    // Now retry after successful fetch
    fetchDishDetail.mockResolvedValueOnce(null);
    const retryFn = setDishFetchError.mock.calls[1][0].retry;

    await act(async () => {
      retryFn();
    });

    expect(fetchDishDetail).toHaveBeenCalledTimes(2);
    expect(setStagedMeal).toHaveBeenCalledTimes(1);
  });

  it('stages a custom dish offline when fetcher rejects with Available when online', async () => {
    const originalOnLine = navigator.onLine;
    try {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      const setStagedMeal = vi.fn();
      const setDishFetchError = vi.fn();
      const dish: CustomDish = {
        id: 'dish-offline-1',
        user_id: 'user-123',
        name: 'Offline Pudding',
        calories: 200,
        protein: 25,
        carbs: 10,
        fat: 4,
        fiber: 0,
        kind: 'food',
        created_at: '2026-09-26T12:00:00Z',
        use_count: 0,
      };

      const fetchDishDetail = vi.fn().mockRejectedValue(new Error('Available when online'));

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            setStagedMeal,
            setDishFetchError,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleStageCustomDish(dish);
      });

      expect(setDishFetchError).toHaveBeenNthCalledWith(1, null);
      expect(setStagedMeal).toHaveBeenCalledTimes(1);
      expect(setStagedMeal).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Offline Pudding',
          calories: 200,
          protein: 25,
          carbs: 10,
          fat: 4,
          fiber: 0,
        })
      );
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
    }
  });

  describe('D33: handleAddCustomDishToStaged', () => {
    it('appends favorite items to staged meal without replacing it', async () => {
      const initialStagedMeal = {
        name: 'Breakfast Bowl',
        mealType: 'Breakfast',
        explanation: '300 kcal (Eggs)',
        items: [
          {
            id: 'item-eggs',
            name: 'Scrambled Eggs',
            portion: '2 eggs',
            quantity: 2,
            unit: 'unit' as const,
            baseQuantity: 2,
            baseCalories: 140,
            baseProtein: 12,
            baseCarbs: 2,
            baseFat: 10,
            baseFiber: 0,
            calories: 140,
            protein: 12,
            carbs: 2,
            fat: 10,
            fiber: 0,
            portionMultiplier: 1,
          },
        ],
        calories: 140,
        protein: 12,
        carbs: 2,
        fat: 10,
        fiber: 0,
        servingSize: 1,
        servingUnit: 'serving',
        notes: null,
      };

      const setStagedMeal = vi.fn();
      const dish: CustomDish = {
        id: 'dish-toast-1',
        user_id: 'user-123',
        name: 'Avocado Toast',
        calories: 250,
        protein: 6,
        carbs: 28,
        fat: 13,
        fiber: 5,
        kind: 'recipe',
        use_count: 2,
      };

      const dishDetail: CustomDishDetail = {
        ...dish,
        items: [
          {
            id: 'item-toast-comp',
            name: 'Sourdough Toast',
            quantity: 1,
            unit: 'unit',
            displayPortion: '1 slice',
            calories: 250,
            protein: 6,
            carbs: 28,
            fat: 13,
            fiber: 5,
          },
        ],
      };

      const fetchDishDetail = vi.fn().mockResolvedValue(dishDetail);

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal: initialStagedMeal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleAddCustomDishToStaged(dish);
      });

      expect(setStagedMeal).toHaveBeenCalledTimes(1);
      const updated = setStagedMeal.mock.calls[0][0];
      // Meal name and meal type are preserved
      expect(updated.name).toBe('Breakfast Bowl');
      expect(updated.mealType).toBe('Breakfast');
      // Has both items: original eggs and appended toast
      expect(updated.items).toHaveLength(2);
      expect(updated.items[0].name).toBe('Scrambled Eggs');
      expect(updated.items[1].name).toBe('Sourdough Toast');
      // Totals recomputed as sum of items
      expect(updated.calories).toBe(390);
      expect(updated.protein).toBe(18);
      expect(updated.carbs).toBe(30);
      expect(updated.fat).toBe(23);
      expect(updated.fiber).toBe(5);

      // Banner is set
      expect(result.current.addedFavoriteBanner).not.toBeNull();
      expect(result.current.addedFavoriteBanner?.message).toBe('Added Avocado Toast to staged meal');
    });

    it('adds all components of a multi-component favorite to staged meal', async () => {
      const initialStagedMeal = {
        name: 'Lunch',
        mealType: 'Lunch',
        explanation: '100 kcal (Salad)',
        items: [
          {
            id: 'item-salad',
            name: 'Garden Salad',
            portion: '1 bowl',
            quantity: 1,
            unit: 'unit' as const,
            baseQuantity: 1,
            baseCalories: 100,
            baseProtein: 2,
            baseCarbs: 10,
            baseFat: 5,
            baseFiber: 4,
            calories: 100,
            protein: 2,
            carbs: 10,
            fat: 5,
            fiber: 4,
            portionMultiplier: 1,
          },
        ],
        calories: 100,
        protein: 2,
        carbs: 10,
        fat: 5,
        fiber: 4,
        servingSize: 1,
        servingUnit: 'serving',
        notes: null,
      };

      const setStagedMeal = vi.fn();
      const dish: CustomDish = {
        id: 'dish-combo-1',
        user_id: 'user-123',
        name: 'Protein Combo',
        calories: 400,
        protein: 40,
        carbs: 20,
        fat: 10,
        fiber: 2,
        kind: 'recipe',
        use_count: 5,
      };

      const dishDetail: CustomDishDetail = {
        ...dish,
        items: [
          {
            id: 'c1',
            name: 'Grilled Chicken',
            quantity: 150,
            unit: 'g',
            displayPortion: '150g',
            calories: 250,
            protein: 35,
            carbs: 0,
            fat: 5,
            fiber: 0,
          },
          {
            id: 'c2',
            name: 'Quinoa',
            quantity: 100,
            unit: 'g',
            displayPortion: '100g',
            calories: 150,
            protein: 5,
            carbs: 20,
            fat: 5,
            fiber: 2,
          },
        ],
      };

      const fetchDishDetail = vi.fn().mockResolvedValue(dishDetail);

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal: initialStagedMeal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleAddCustomDishToStaged(dish);
      });

      expect(setStagedMeal).toHaveBeenCalledTimes(1);
      const updated = setStagedMeal.mock.calls[0][0];
      // All 3 items present: original salad + 2 combo components
      expect(updated.items).toHaveLength(3);
      expect(updated.items[0].name).toBe('Garden Salad');
      expect(updated.items[1].name).toBe('Grilled Chicken');
      expect(updated.items[2].name).toBe('Quinoa');
      expect(updated.calories).toBe(500);
      expect(updated.protein).toBe(42);
      expect(updated.carbs).toBe(30);
      expect(updated.fat).toBe(15);
      expect(updated.fiber).toBe(6);
    });

    it('merges identical items by incrementing quantity (1 serving -> 2) and appends non-identical items', async () => {
      const initialStagedMeal = {
        name: 'Oatmeal Meal',
        mealType: 'Breakfast',
        explanation: '150 kcal (Oatmeal)',
        items: [
          {
            id: 'item-oatmeal',
            name: 'Rolled Oats',
            portion: '1 serving',
            quantity: 1,
            unit: 'unit' as const,
            baseQuantity: 1,
            baseCalories: 150,
            baseProtein: 5,
            baseCarbs: 27,
            baseFat: 3,
            baseFiber: 4,
            calories: 150,
            protein: 5,
            carbs: 27,
            fat: 3,
            fiber: 4,
            portionMultiplier: 1,
          },
        ],
        calories: 150,
        protein: 5,
        carbs: 27,
        fat: 3,
        fiber: 4,
        servingSize: 1,
        servingUnit: 'serving',
        notes: null,
      };

      const setStagedMeal = vi.fn();
      // dish has identical Rolled Oats (1 serving) + non-identical Banana
      const dish: CustomDish = {
        id: 'dish-oats-banana',
        user_id: 'user-123',
        name: 'Oats & Banana',
        calories: 255,
        protein: 6.3,
        carbs: 54,
        fat: 3.4,
        fiber: 7.1,
        kind: 'recipe',
        use_count: 1,
      };

      const dishDetail: CustomDishDetail = {
        ...dish,
        items: [
          {
            id: 'comp-oats',
            name: '  rolled oats  ', // case-insensitive trimmed
            quantity: 1,
            unit: 'unit',
            displayPortion: '1 serving',
            calories: 150,
            protein: 5,
            carbs: 27,
            fat: 3,
            fiber: 4,
          },
          {
            id: 'comp-banana',
            name: 'Banana',
            quantity: 1,
            unit: 'unit',
            displayPortion: '1 medium',
            calories: 105,
            protein: 1.3,
            carbs: 27,
            fat: 0.4,
            fiber: 3.1,
          },
        ],
      };

      const fetchDishDetail = vi.fn().mockResolvedValue(dishDetail);

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal: initialStagedMeal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleAddCustomDishToStaged(dish);
      });

      expect(setStagedMeal).toHaveBeenCalledTimes(1);
      const updated = setStagedMeal.mock.calls[0][0];
      // Rolled Oats merged: length is 2 (Oats + Banana), not 3!
      expect(updated.items).toHaveLength(2);
      // Oats quantity is merged from 1 to 2
      expect(updated.items[0].name).toBe('Rolled Oats');
      expect(updated.items[0].quantity).toBe(2);
      expect(updated.items[0].calories).toBe(300);
      expect(updated.items[0].protein).toBe(10);
      expect(updated.items[0].carbs).toBe(54);
      expect(updated.items[0].fat).toBe(6);
      expect(updated.items[0].fiber).toBe(8);

      // Banana is appended
      expect(updated.items[1].name).toBe('Banana');
      expect(updated.items[1].quantity).toBe(1);

      // Meal totals are the sum
      expect(updated.calories).toBe(405);
      expect(updated.protein).toBe(11.3);
      expect(updated.carbs).toBe(81);
      expect(updated.fat).toBe(6.4);
      expect(updated.fiber).toBe(11.1);
    });

    it('Undo restores the exact previous staged meal and hides the banner', async () => {
      const initialStagedMeal = {
        name: 'My Special Meal',
        mealType: 'Dinner',
        explanation: '200 kcal (Salmon)',
        items: [
          {
            id: 'item-salmon',
            name: 'Salmon Fillet',
            portion: '150g',
            quantity: 150,
            unit: 'g' as const,
            baseQuantity: 150,
            baseCalories: 200,
            baseProtein: 30,
            baseCarbs: 0,
            baseFat: 8,
            baseFiber: 0,
            calories: 200,
            protein: 30,
            carbs: 0,
            fat: 8,
            fiber: 0,
            portionMultiplier: 1,
            userOverridden: true,
          },
        ],
        calories: 200,
        protein: 30,
        carbs: 0,
        fat: 8,
        fiber: 0,
        servingSize: 1,
        servingUnit: 'serving',
        notes: 'Wild caught',
      };

      const setStagedMeal = vi.fn();
      const dish: CustomDish = {
        id: 'dish-rice',
        user_id: 'user-123',
        name: 'Rice',
        calories: 150,
        protein: 3,
        carbs: 32,
        fat: 0.5,
        fiber: 1,
        kind: 'food',
        use_count: 4,
      };

      const fetchDishDetail = vi.fn().mockResolvedValue(null);

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal: initialStagedMeal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleAddCustomDishToStaged(dish);
      });

      expect(result.current.addedFavoriteBanner).not.toBeNull();
      expect(result.current.addedFavoriteBanner?.message).toBe('Added Rice to staged meal');

      // Now trigger Undo
      act(() => {
        result.current.addedFavoriteBanner?.onUndo();
      });

      // Banner is hidden
      expect(result.current.addedFavoriteBanner).toBeNull();
      // setStagedMeal called with the EXACT previous staged meal object
      expect(setStagedMeal).toHaveBeenLastCalledWith(initialStagedMeal);
      const restored = setStagedMeal.mock.calls[1][0];
      expect(restored.name).toBe('My Special Meal');
      expect(restored.notes).toBe('Wild caught');
      expect(restored.items[0].userOverridden).toBe(true);
      expect(restored.items).toHaveLength(1);
    });

    it('displays banner text and Undo button and auto-hides after 5s (fake timers)', async () => {
      vi.useFakeTimers();
      try {
        const initialStagedMeal = {
          name: 'Meal',
          mealType: 'Breakfast',
          explanation: '100 kcal',
          items: [],
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          fiber: 0,
          servingSize: 1,
          servingUnit: 'serving',
          notes: null,
        };

        const setStagedMeal = vi.fn();
        const dish: CustomDish = {
          id: 'dish-snack',
          user_id: 'user-123',
          name: 'Almonds',
          calories: 160,
          protein: 6,
          carbs: 6,
          fat: 14,
          fiber: 3,
          kind: 'food',
          use_count: 1,
        };

        const fetchDishDetail = vi.fn().mockResolvedValue(null);

        const { result } = renderHook(
          () =>
            useCustomDishActions({
              targetUserId: 'user-123',
              selectedDate: '2026-09-26',
              stagedMeal: initialStagedMeal,
              setStagedMeal,
              fetchDishDetail,
              mutation: { mutate: vi.fn() },
            }),
          { wrapper }
        );

        await act(async () => {
          await result.current.handleAddCustomDishToStaged(dish);
        });

        expect(result.current.addedFavoriteBanner).not.toBeNull();
        expect(result.current.addedFavoriteBanner?.message).toBe('Added Almonds to staged meal');

        // Advance 4900ms: still visible (>= 5s required)
        act(() => {
          vi.advanceTimersByTime(4900);
        });
        expect(result.current.addedFavoriteBanner).not.toBeNull();

        // Advance past 5000ms: hides
        act(() => {
          vi.advanceTimersByTime(150);
        });
        expect(result.current.addedFavoriteBanner).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('increments use_count on add but does NOT decrement use_count on Undo', async () => {
      const initialStagedMeal = {
        name: 'Meal',
        mealType: 'Breakfast',
        explanation: '100 kcal',
        items: [],
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        servingSize: 1,
        servingUnit: 'serving',
        notes: null,
      };

      const setStagedMeal = vi.fn();
      const dish: CustomDish = {
        id: 'dish-count-1',
        user_id: 'user-123',
        name: 'Protein Shake',
        calories: 180,
        protein: 25,
        carbs: 5,
        fat: 2,
        fiber: 1,
        kind: 'food',
        use_count: 5,
      };

      const fetchDishDetail = vi.fn().mockResolvedValue(null);

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal: initialStagedMeal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleAddCustomDishToStaged(dish);
      });

      // Incremented once: 5 -> 6
      expect(supabase.from).toHaveBeenCalledWith('custom_dishes');
      expect(mockUpdate).toHaveBeenCalledWith({ use_count: 6 });
      expect(mockUpdateEq).toHaveBeenCalledWith('id', 'dish-count-1');

      // Clear calls
      mockUpdate.mockClear();
      mockUpdateEq.mockClear();

      // Undo
      act(() => {
        result.current.addedFavoriteBanner?.onUndo();
      });

      // Undo does NOT decrement
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('replaces banner on subsequent add and Undo reverts only the latest add', async () => {
      const meal0 = {
        name: 'Meal 0',
        mealType: 'Breakfast',
        explanation: '0 kcal',
        items: [],
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        servingSize: 1,
        servingUnit: 'serving',
        notes: null,
      };

      let currentStaged = meal0;
      const setStagedMeal = vi.fn((m) => {
        currentStaged = m;
      });

      const dishA: CustomDish = {
        id: 'dish-a',
        user_id: 'user-123',
        name: 'Dish A',
        calories: 100,
        protein: 10,
        carbs: 10,
        fat: 2,
        fiber: 1,
        kind: 'food',
        use_count: 0,
      };

      const dishB: CustomDish = {
        id: 'dish-b',
        user_id: 'user-123',
        name: 'Dish B',
        calories: 200,
        protein: 20,
        carbs: 20,
        fat: 4,
        fiber: 2,
        kind: 'food',
        use_count: 0,
      };

      const fetchDishDetail = vi.fn().mockResolvedValue(null);

      const { result, rerender } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal: currentStaged,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          }),
        { wrapper }
      );

      // Add Dish A
      await act(async () => {
        await result.current.handleAddCustomDishToStaged(dishA);
      });

      expect(result.current.addedFavoriteBanner?.message).toBe('Added Dish A to staged meal');
      rerender();

      // Add Dish B while banner is visible
      await act(async () => {
        await result.current.handleAddCustomDishToStaged(dishB);
      });

      expect(result.current.addedFavoriteBanner?.message).toBe('Added Dish B to staged meal');

      // Undo reverts only Dish B, restoring the state after Dish A was added
      act(() => {
        result.current.addedFavoriteBanner?.onUndo();
      });

      expect(setStagedMeal).toHaveBeenLastCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ name: 'Dish A' })]),
        })
      );
      const reverted = setStagedMeal.mock.calls[setStagedMeal.mock.calls.length - 1][0];
      expect(reverted.items).toHaveLength(1);
      expect(reverted.items[0].name).toBe('Dish A');
    });

    it('log or discard during fetch does not resurrect the meal', async () => {
      let resolveFetch!: (val: CustomDishDetail | null) => void;
      const fetchPromise = new Promise<CustomDishDetail | null>((resolve) => {
        resolveFetch = resolve;
      });
      const fetchDishDetail = vi.fn().mockImplementation(() => fetchPromise);
      const setStagedMeal = vi.fn();

      const initialStagedMeal = {
        name: 'Initial Meal',
        mealType: 'Breakfast',
        explanation: '200 kcal',
        items: [
          {
            id: 'item-init',
            name: 'Initial Item',
            portion: '1 serving',
            quantity: 1,
            unit: 'unit' as const,
            baseQuantity: 1,
            baseCalories: 200,
            baseProtein: 10,
            baseCarbs: 20,
            baseFat: 5,
            baseFiber: 2,
            calories: 200,
            protein: 10,
            carbs: 20,
            fat: 5,
            fiber: 2,
            portionMultiplier: 1,
          },
        ],
        calories: 200,
        protein: 10,
        carbs: 20,
        fat: 5,
        fiber: 2,
        servingSize: 1,
        servingUnit: 'serving',
        notes: null,
      };

      const dish: CustomDish = {
        id: 'dish-async-1',
        user_id: 'user-123',
        name: 'Async Dish',
        calories: 150,
        protein: 5,
        carbs: 20,
        fat: 5,
        fiber: 1,
        kind: 'food',
        use_count: 1,
      };

      const { result, rerender } = renderHook(
        ({ stagedMeal }) =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          }),
        {
          wrapper,
          initialProps: { stagedMeal: initialStagedMeal as any },
        }
      );

      // Start adding favorite (fetch is now in flight)
      const addPromise = result.current.handleAddCustomDishToStaged(dish);

      // While fetch is pending, user logs or discards the meal
      rerender({ stagedMeal: null });

      // Resolve the fetch detail now
      await act(async () => {
        resolveFetch({
          ...dish,
          items: [
            {
              id: 'it-1',
              name: 'Async Dish',
              displayPortion: '1 serving',
              quantity: 1,
              unit: 'unit',
              calories: 150,
              protein: 5,
              carbs: 20,
              fat: 5,
              fiber: 1,
            },
          ],
        });
        await addPromise;
      });

      // Must NOT resurrect the meal or update staged meal
      expect(setStagedMeal).not.toHaveBeenCalled();
      // Must NOT set the added favorite banner
      expect(result.current.addedFavoriteBanner).toBeNull();
      // Must NOT increment use_count
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('two rapid adds with deferred fetch promises resolved in order B then A keep both favorites and Undo reverts only the last applied one', async () => {
      let resolveA!: (val: CustomDishDetail | null) => void;
      let resolveB!: (val: CustomDishDetail | null) => void;
      const promiseA = new Promise<CustomDishDetail | null>((resolve) => {
        resolveA = resolve;
      });
      const promiseB = new Promise<CustomDishDetail | null>((resolve) => {
        resolveB = resolve;
      });

      const dishA: CustomDish = {
        id: 'dish-A',
        user_id: 'user-123',
        name: 'Dish A',
        calories: 100,
        protein: 10,
        carbs: 10,
        fat: 2,
        fiber: 1,
        kind: 'food',
        use_count: 1,
      };
      const dishB: CustomDish = {
        id: 'dish-B',
        user_id: 'user-123',
        name: 'Dish B',
        calories: 200,
        protein: 20,
        carbs: 20,
        fat: 4,
        fiber: 2,
        kind: 'food',
        use_count: 1,
      };

      const fetchDishDetail = vi.fn((id: string) => {
        if (id === 'dish-A') return promiseA;
        return promiseB;
      });

      const initialStagedMeal = {
        name: 'Base Meal',
        mealType: 'Dinner',
        explanation: '300 kcal',
        items: [
          {
            id: 'item-base',
            name: 'Base Rice',
            portion: '1 cup',
            quantity: 1,
            unit: 'unit' as const,
            baseQuantity: 1,
            baseCalories: 300,
            baseProtein: 5,
            baseCarbs: 60,
            baseFat: 1,
            baseFiber: 2,
            calories: 300,
            protein: 5,
            carbs: 60,
            fat: 1,
            fiber: 2,
            portionMultiplier: 1,
          },
        ],
        calories: 300,
        protein: 5,
        carbs: 60,
        fat: 1,
        fiber: 2,
        servingSize: 1,
        servingUnit: 'serving',
        notes: null,
      };

      const { result } = renderHook(
        () => {
          const [stagedMeal, setStagedMeal] = React.useState<any>(initialStagedMeal);
          const actions = useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          });
          return { ...actions, stagedMeal };
        },
        { wrapper }
      );

      // Rapidly tap Dish A, then Dish B
      const actionPromiseA = result.current.handleAddCustomDishToStaged(dishA);
      const actionPromiseB = result.current.handleAddCustomDishToStaged(dishB);

      // Resolve B first
      await act(async () => {
        resolveB({
          ...dishB,
          items: [
            {
              id: 'it-b',
              name: 'Dish B',
              displayPortion: '1 serving',
              quantity: 1,
              unit: 'unit',
              calories: 200,
              protein: 20,
              carbs: 20,
              fat: 4,
              fiber: 2,
            },
          ],
        });
        await actionPromiseB;
      });

      // Resolve A second
      await act(async () => {
        resolveA({
          ...dishA,
          items: [
            {
              id: 'it-a',
              name: 'Dish A',
              displayPortion: '1 serving',
              quantity: 1,
              unit: 'unit',
              calories: 100,
              protein: 10,
              carbs: 10,
              fat: 2,
              fiber: 1,
            },
          ],
        });
        await actionPromiseA;
      });

      // Both items MUST be present in staged meal (Base Rice + Dish B + Dish A)
      expect(result.current.stagedMeal.items).toHaveLength(3);
      const itemNames = result.current.stagedMeal.items.map((it: any) => it.name);
      expect(itemNames).toContain('Base Rice');
      expect(itemNames).toContain('Dish B');
      expect(itemNames).toContain('Dish A');
      expect(result.current.stagedMeal.calories).toBe(600); // 300 + 200 + 100

      // Banner should announce Dish A (the last applied one)
      expect(result.current.addedFavoriteBanner?.message).toBe('Added Dish A to staged meal');

      // Undo reverts ONLY the last applied one (Dish A)
      await act(async () => {
        result.current.addedFavoriteBanner?.onUndo();
      });

      // Staged meal should now contain Base Rice + Dish B (Dish A removed)
      expect(result.current.stagedMeal.items).toHaveLength(2);
      const revertedNames = result.current.stagedMeal.items.map((it: any) => it.name);
      expect(revertedNames).toContain('Base Rice');
      expect(revertedNames).toContain('Dish B');
      expect(revertedNames).not.toContain('Dish A');
      expect(result.current.stagedMeal.calories).toBe(500); // 300 + 200
    });

    it('two rapid adds with deferred fetch promises resolved in order A then B keep both favorites and Undo reverts only the last applied one', async () => {
      let resolveA!: (val: CustomDishDetail | null) => void;
      let resolveB!: (val: CustomDishDetail | null) => void;
      const promiseA = new Promise<CustomDishDetail | null>((resolve) => {
        resolveA = resolve;
      });
      const promiseB = new Promise<CustomDishDetail | null>((resolve) => {
        resolveB = resolve;
      });

      const dishA: CustomDish = {
        id: 'dish-A2',
        user_id: 'user-123',
        name: 'Dish A2',
        calories: 100,
        protein: 10,
        carbs: 10,
        fat: 2,
        fiber: 1,
        kind: 'food',
        use_count: 1,
      };
      const dishB: CustomDish = {
        id: 'dish-B2',
        user_id: 'user-123',
        name: 'Dish B2',
        calories: 200,
        protein: 20,
        carbs: 20,
        fat: 4,
        fiber: 2,
        kind: 'food',
        use_count: 1,
      };

      const fetchDishDetail = vi.fn((id: string) => {
        if (id === 'dish-A2') return promiseA;
        return promiseB;
      });

      const initialStagedMeal = {
        name: 'Base Meal 2',
        mealType: 'Dinner',
        explanation: '300 kcal',
        items: [
          {
            id: 'item-base-2',
            name: 'Base Rice 2',
            portion: '1 cup',
            quantity: 1,
            unit: 'unit' as const,
            baseQuantity: 1,
            baseCalories: 300,
            baseProtein: 5,
            baseCarbs: 60,
            baseFat: 1,
            baseFiber: 2,
            calories: 300,
            protein: 5,
            carbs: 60,
            fat: 1,
            fiber: 2,
            portionMultiplier: 1,
          },
        ],
        calories: 300,
        protein: 5,
        carbs: 60,
        fat: 1,
        fiber: 2,
        servingSize: 1,
        servingUnit: 'serving',
        notes: null,
      };

      const { result } = renderHook(
        () => {
          const [stagedMeal, setStagedMeal] = React.useState<any>(initialStagedMeal);
          const actions = useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          });
          return { ...actions, stagedMeal };
        },
        { wrapper }
      );

      // Rapidly tap Dish A2, then Dish B2
      const actionPromiseA = result.current.handleAddCustomDishToStaged(dishA);
      const actionPromiseB = result.current.handleAddCustomDishToStaged(dishB);

      // Resolve A first
      await act(async () => {
        resolveA({
          ...dishA,
          items: [
            {
              id: 'it-a2',
              name: 'Dish A2',
              displayPortion: '1 serving',
              quantity: 1,
              unit: 'unit',
              calories: 100,
              protein: 10,
              carbs: 10,
              fat: 2,
              fiber: 1,
            },
          ],
        });
        await actionPromiseA;
      });

      // Resolve B second
      await act(async () => {
        resolveB({
          ...dishB,
          items: [
            {
              id: 'it-b2',
              name: 'Dish B2',
              displayPortion: '1 serving',
              quantity: 1,
              unit: 'unit',
              calories: 200,
              protein: 20,
              carbs: 20,
              fat: 4,
              fiber: 2,
            },
          ],
        });
        await actionPromiseB;
      });

      // Both items MUST be present in staged meal (Base Rice 2 + Dish A2 + Dish B2)
      expect(result.current.stagedMeal.items).toHaveLength(3);
      const itemNames = result.current.stagedMeal.items.map((it: any) => it.name);
      expect(itemNames).toContain('Base Rice 2');
      expect(itemNames).toContain('Dish A2');
      expect(itemNames).toContain('Dish B2');
      expect(result.current.stagedMeal.calories).toBe(600); // 300 + 100 + 200

      // Banner should announce Dish B2 (the last applied one)
      expect(result.current.addedFavoriteBanner?.message).toBe('Added Dish B2 to staged meal');

      // Undo reverts ONLY the last applied one (Dish B2)
      await act(async () => {
        result.current.addedFavoriteBanner?.onUndo();
      });

      // Staged meal should now contain Base Rice 2 + Dish A2 (Dish B2 removed)
      expect(result.current.stagedMeal.items).toHaveLength(2);
      const revertedNames = result.current.stagedMeal.items.map((it: any) => it.name);
      expect(revertedNames).toContain('Base Rice 2');
      expect(revertedNames).toContain('Dish A2');
      expect(revertedNames).not.toContain('Dish B2');
      expect(result.current.stagedMeal.calories).toBe(400); // 300 + 100
    });
  });

  describe('Audit Fixes: W-A (#1, #4a, #4b, #7)', () => {
    it('#1 log within 5s -> stage new meal -> no banner', async () => {
      let stagedMealState: any = {
        name: 'Meal A',
        mealType: 'Breakfast',
        explanation: '100 kcal',
        items: [
          {
            id: 'it-a',
            name: 'Item A',
            portion: '1 serving',
            quantity: 1,
            unit: 'unit',
            calories: 100,
            protein: 10,
            carbs: 10,
            fat: 2,
            fiber: 1,
            baseQuantity: 1,
            baseCalories: 100,
            baseProtein: 10,
            baseCarbs: 10,
            baseFat: 2,
            baseFiber: 1,
            portionMultiplier: 1,
          },
        ],
        calories: 100,
        protein: 10,
        carbs: 10,
        fat: 2,
        fiber: 1,
        servingSize: 1,
        servingUnit: 'serving',
      };
      const setStagedMeal = vi.fn((next) => {
        stagedMealState = next;
      });

      const dish: CustomDish = {
        id: 'dish-1',
        user_id: 'user-123',
        name: 'Favorite Dish',
        calories: 200,
        protein: 10,
        carbs: 20,
        fat: 5,
        fiber: 2,
        kind: 'food',
        use_count: 1,
      };

      const fetchDishDetail = vi.fn().mockResolvedValue({
        ...dish,
        items: [
          {
            id: 'dish-it-1',
            name: 'Favorite Item',
            displayPortion: '1 serving',
            quantity: 1,
            unit: 'unit',
            calories: 200,
            protein: 10,
            carbs: 20,
            fat: 5,
            fiber: 2,
          },
        ],
      });

      const { result, rerender } = renderHook(
        ({ meal }) =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal: meal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          }),
        {
          initialProps: { meal: stagedMealState },
          wrapper,
        }
      );

      // Add dish to staged meal
      await act(async () => {
        await result.current.handleAddCustomDishToStaged(dish);
      });

      // Rerender hook with updated staged meal returned by setStagedMeal
      rerender({ meal: stagedMealState });
      expect(result.current.addedFavoriteBanner).not.toBeNull();
      expect(result.current.addedFavoriteBanner?.message).toBe('Added Favorite Dish to staged meal');

      // User logs/discards meal within 5s: stagedMeal transitions to null
      stagedMealState = null;
      rerender({ meal: null });
      expect(result.current.addedFavoriteBanner).toBeNull();

      // Later, user stages a new meal (Meal B)
      const newMealB = {
        name: 'Meal B',
        mealType: 'Lunch',
        explanation: '300 kcal',
        items: [],
        calories: 300,
        protein: 20,
        carbs: 30,
        fat: 5,
        fiber: 2,
        servingSize: 1,
        servingUnit: 'serving',
      };
      stagedMealState = newMealB;
      rerender({ meal: newMealB });

      // Stale banner MUST NOT resurrect on new meal
      expect(result.current.addedFavoriteBanner).toBeNull();
    });

    it('#4a edit qty within 5s -> banner gone, meal keeps the edit', async () => {
      let stagedMealState: any = {
        name: 'Meal A',
        mealType: 'Breakfast',
        explanation: '100 kcal',
        items: [
          {
            id: 'it-a',
            name: 'Item A',
            portion: '1 serving',
            quantity: 1,
            unit: 'unit',
            calories: 100,
            protein: 10,
            carbs: 10,
            fat: 2,
            fiber: 1,
            baseQuantity: 1,
            baseCalories: 100,
            baseProtein: 10,
            baseCarbs: 10,
            baseFat: 2,
            baseFiber: 1,
            portionMultiplier: 1,
          },
        ],
        calories: 100,
        protein: 10,
        carbs: 10,
        fat: 2,
        fiber: 1,
        servingSize: 1,
        servingUnit: 'serving',
      };
      const setStagedMeal = vi.fn((next) => {
        stagedMealState = next;
      });

      const dish: CustomDish = {
        id: 'dish-1',
        user_id: 'user-123',
        name: 'Favorite Dish',
        calories: 200,
        protein: 10,
        carbs: 20,
        fat: 5,
        fiber: 2,
        kind: 'food',
        use_count: 1,
      };

      const fetchDishDetail = vi.fn().mockResolvedValue({
        ...dish,
        items: [
          {
            id: 'dish-it-1',
            name: 'Favorite Item',
            displayPortion: '1 serving',
            quantity: 1,
            unit: 'unit',
            calories: 200,
            protein: 10,
            carbs: 20,
            fat: 5,
            fiber: 2,
          },
        ],
      });

      const { result, rerender } = renderHook(
        ({ meal }) =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal: meal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          }),
        {
          initialProps: { meal: stagedMealState },
          wrapper,
        }
      );

      await act(async () => {
        await result.current.handleAddCustomDishToStaged(dish);
      });
      rerender({ meal: stagedMealState });
      expect(result.current.addedFavoriteBanner).not.toBeNull();

      // User edits item quantity within 5s
      const editedMeal = {
        ...stagedMealState,
        items: stagedMealState.items.map((it: any) =>
          it.name === 'Item A' ? { ...it, quantity: 5, calories: 500 } : it
        ),
        calories: 700,
      };
      stagedMealState = editedMeal;
      rerender({ meal: editedMeal });

      // Banner MUST be gone immediately when meal identity changes
      expect(result.current.addedFavoriteBanner).toBeNull();
      // Meal keeps the edit
      expect(stagedMealState.items.find((it: any) => it.name === 'Item A').quantity).toBe(5);
    });

    it('untouched -> banner visible at 4999ms, Undo works', async () => {
      vi.useFakeTimers();
      try {
        let stagedMealState: any = {
          name: 'Original Meal',
          mealType: 'Breakfast',
          explanation: '100 kcal',
          items: [
            {
              id: 'it-orig',
              name: 'Original Item',
              portion: '1 serving',
              quantity: 1,
              unit: 'unit',
              calories: 100,
              protein: 10,
              carbs: 10,
              fat: 2,
              fiber: 1,
              baseQuantity: 1,
              baseCalories: 100,
              baseProtein: 10,
              baseCarbs: 10,
              baseFat: 2,
              baseFiber: 1,
              portionMultiplier: 1,
            },
          ],
          calories: 100,
          protein: 10,
          carbs: 10,
          fat: 2,
          fiber: 1,
          servingSize: 1,
          servingUnit: 'serving',
        };
        const setStagedMeal = vi.fn((next) => {
          stagedMealState = next;
        });

        const dish: CustomDish = {
          id: 'dish-1',
          user_id: 'user-123',
          name: 'Favorite Dish',
          calories: 200,
          protein: 10,
          carbs: 20,
          fat: 5,
          fiber: 2,
          kind: 'food',
          use_count: 1,
        };

        const fetchDishDetail = vi.fn().mockResolvedValue({
          ...dish,
          items: [
            {
              id: 'dish-it-1',
              name: 'Favorite Item',
              displayPortion: '1 serving',
              quantity: 1,
              unit: 'unit',
              calories: 200,
              protein: 10,
              carbs: 20,
              fat: 5,
              fiber: 2,
            },
          ],
        });

        const { result, rerender } = renderHook(
          ({ meal }) =>
            useCustomDishActions({
              targetUserId: 'user-123',
              selectedDate: '2026-09-26',
              stagedMeal: meal,
              setStagedMeal,
              fetchDishDetail,
              mutation: { mutate: vi.fn() },
            }),
          {
            initialProps: { meal: stagedMealState },
            wrapper,
          }
        );

        await act(async () => {
          await result.current.handleAddCustomDishToStaged(dish);
        });
        rerender({ meal: stagedMealState });

        // Untouched at 4999ms -> still visible
        act(() => {
          vi.advanceTimersByTime(4999);
        });
        expect(result.current.addedFavoriteBanner).not.toBeNull();

        // Undo works at 4999ms
        act(() => {
          result.current.addedFavoriteBanner?.onUndo();
        });
        rerender({ meal: stagedMealState });
        expect(stagedMealState.name).toBe('Original Meal');
        expect(stagedMealState.items).toHaveLength(1);
        expect(stagedMealState.items[0].name).toBe('Original Item');
      } finally {
        vi.useRealTimers();
      }
    });

    it('#4b while the log mutation is pending, adds are ignored (no stage, no use_count, no banner)', async () => {
      const setStagedMeal = vi.fn();
      const dish: CustomDish = {
        id: 'dish-pending',
        user_id: 'user-123',
        name: 'Pending Test Dish',
        calories: 150,
        protein: 5,
        carbs: 20,
        fat: 2,
        fiber: 1,
        kind: 'food',
        use_count: 5,
      };
      const fetchDishDetail = vi.fn().mockResolvedValue({
        ...dish,
        items: [],
      });

      const stagedMeal = {
        name: 'Staged Meal',
        mealType: 'Breakfast',
        explanation: '100 kcal',
        items: [],
        calories: 100,
        protein: 10,
        carbs: 10,
        fat: 2,
        fiber: 1,
        servingSize: 1,
        servingUnit: 'serving',
      };

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn(), isPending: true },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleAddCustomDishToStaged(dish);
      });

      expect(fetchDishDetail).not.toHaveBeenCalled();
      expect(setStagedMeal).not.toHaveBeenCalled();
      expect(supabase.from).not.toHaveBeenCalled();
      expect(result.current.addedFavoriteBanner).toBeNull();
    });

    it('#4b while the log mutation is pending, handleStageCustomDish is ignored', async () => {
      const setStagedMeal = vi.fn();
      const dish: CustomDish = {
        id: 'dish-pending-stage',
        user_id: 'user-123',
        name: 'Pending Stage Dish',
        calories: 150,
        protein: 5,
        carbs: 20,
        fat: 2,
        fiber: 1,
        kind: 'food',
        use_count: 5,
      };
      const fetchDishDetail = vi.fn().mockResolvedValue({
        ...dish,
        items: [],
      });

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn(), isPending: true },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleStageCustomDish(dish);
      });

      expect(fetchDishDetail).not.toHaveBeenCalled();
      expect(setStagedMeal).not.toHaveBeenCalled();
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('#4b while the log mutation is pending, handleQuickLogCustomDishDirect is ignored', () => {
      const mutate = vi.fn();
      const dish: CustomDish = {
        id: 'dish-pending-quicklog',
        user_id: 'user-123',
        name: 'Pending QuickLog Dish',
        calories: 150,
        protein: 5,
        carbs: 20,
        fat: 2,
        fiber: 1,
        kind: 'food',
        use_count: 5,
      };

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            setStagedMeal: vi.fn(),
            mutation: { mutate, isPending: true },
          }),
        { wrapper }
      );

      act(() => {
        result.current.handleQuickLogCustomDishDirect(dish);
      });

      expect(mutate).not.toHaveBeenCalled();
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('#4b mutation becomes pending during fetchDishDetail -> addition aborted post-fetch', async () => {
      const setStagedMeal = vi.fn();
      const dish: CustomDish = {
        id: 'dish-slow-fetch',
        user_id: 'user-123',
        name: 'Slow Fetch Dish',
        calories: 200,
        protein: 10,
        carbs: 20,
        fat: 5,
        fiber: 2,
        kind: 'food',
        use_count: 1,
      };

      let resolveFetch: (val: any) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });
      const fetchDishDetail = vi.fn().mockReturnValue(fetchPromise);

      const stagedMeal = {
        name: 'Staged Meal',
        mealType: 'Breakfast',
        explanation: '100 kcal',
        items: [],
        calories: 100,
        protein: 10,
        carbs: 10,
        fat: 2,
        fiber: 1,
        servingSize: 1,
        servingUnit: 'serving',
      };

      let mutationState = { mutate: vi.fn(), isPending: false };

      const { result, rerender } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal,
            setStagedMeal,
            fetchDishDetail,
            mutation: mutationState,
          }),
        { wrapper }
      );

      let addPromise: Promise<void>;
      act(() => {
        addPromise = result.current.handleAddCustomDishToStaged(dish);
      });

      expect(fetchDishDetail).toHaveBeenCalledWith('dish-slow-fetch');

      // Now user clicks Log Meal -> mutation becomes pending during fetch
      mutationState = { mutate: vi.fn(), isPending: true };
      rerender();

      await act(async () => {
        resolveFetch!({ ...dish, items: [] });
        await addPromise;
      });

      expect(setStagedMeal).not.toHaveBeenCalled();
      expect(supabase.from).not.toHaveBeenCalled();
      expect(result.current.addedFavoriteBanner).toBeNull();
    });

    it('#7 single-item merge rescales stagedMeal.servingSize and servingUnit', async () => {
      const initialMeal = {
        name: 'Chicken Rice',
        mealType: 'Dinner',
        explanation: '200 kcal',
        items: [
          {
            id: 'it-1',
            name: 'Chicken Rice',
            portion: '150 g',
            quantity: 150,
            unit: 'g' as const,
            calories: 200,
            protein: 20,
            carbs: 25,
            fat: 2,
            fiber: 1,
            baseQuantity: 150,
            baseCalories: 200,
            baseProtein: 20,
            baseCarbs: 25,
            baseFat: 2,
            baseFiber: 1,
            portionMultiplier: 1,
          },
        ],
        calories: 200,
        protein: 20,
        carbs: 25,
        fat: 2,
        fiber: 1,
        servingSize: 150,
        servingUnit: 'g',
      };

      const setStagedMeal = vi.fn();
      const dish: CustomDish = {
        id: 'dish-1',
        user_id: 'user-123',
        name: 'Chicken Rice',
        calories: 200,
        protein: 20,
        carbs: 25,
        fat: 2,
        fiber: 1,
        kind: 'food',
        use_count: 1,
      };

      const fetchDishDetail = vi.fn().mockResolvedValue({
        ...dish,
        items: [
          {
            id: 'dish-it-1',
            name: 'Chicken Rice',
            displayPortion: '150 g',
            quantity: 150,
            unit: 'g',
            calories: 200,
            protein: 20,
            carbs: 25,
            fat: 2,
            fiber: 1,
          },
        ],
      });

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-123',
            selectedDate: '2026-09-26',
            stagedMeal: initialMeal,
            setStagedMeal,
            fetchDishDetail,
            mutation: { mutate: vi.fn() },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleAddCustomDishToStaged(dish);
      });

      expect(setStagedMeal).toHaveBeenCalledTimes(1);
      const nextMeal = setStagedMeal.mock.calls[0][0];
      expect(nextMeal.items).toHaveLength(1);
      expect(nextMeal.items[0].quantity).toBe(300);
      expect(nextMeal.servingSize).toBe(300);
      expect(nextMeal.servingUnit).toBe('g');
    });
  });
});
