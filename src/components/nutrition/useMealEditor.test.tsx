import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useMealEditor } from './useMealEditor';
import { scaleStagedMeal } from './nutritionEngineHelpers';
import type { NutritionLog } from '../../types/database';
import type { NutritionItem } from '../../utils/itemModel';
import { createSupabaseBuilder, clearMockHistory } from '../../test/supabaseBuilderMock';

const mockUpdate = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      const builder = createSupabaseBuilder(table, [{ id: 'log-1' }]);
      builder.update = vi.fn((payload: any) => {
        mockUpdate(payload);
        return createSupabaseBuilder(table, [{ id: 'log-1' }]);
      }) as any;
      return builder;
    }),
  },
}));

function makeComponent(over: Partial<NutritionItem> = {}): NutritionItem {
  return {
    id: 'c1',
    name: 'Oatmeal',
    quantity: 100,
    unit: 'g',
    displayPortion: '100 g',
    calories: 380,
    protein: 13,
    carbs: 68,
    fat: 7,
    fiber: 10,
    ...over,
  };
}

function makeMeal(items: NutritionItem[] | null, over: Partial<NutritionLog> = {}): NutritionLog {
  return {
    id: 'log-1',
    user_id: 'u1',
    food_name: 'Breakfast Bowl',
    calories: 500,
    protein: 38,
    carbs: 71,
    fat: 8,
    fiber: 10,
    meal_type: 'Breakfast',
    serving_size: 1,
    serving_unit: 'serving',
    logged_at: '2026-09-26T08:30:00.000Z',
    logged_date: '2026-09-26',
    items,
    ...over,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useMealEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
  });

  it('initializes draft from multi-component row', () => {
    const items = [
      makeComponent({ id: 'c1', name: 'Oatmeal', calories: 380 }),
      makeComponent({ id: 'c2', name: 'Protein Powder', calories: 120, protein: 25, carbs: 3, fat: 1, fiber: 0 }),
    ];
    const log = makeMeal(items);
    const onClose = vi.fn();

    const { result } = renderHook(
      () =>
        useMealEditor({
          meal: log,
          isOpen: true,
          onClose,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.draft).not.toBeNull();
    expect(result.current.draft?.name).toBe('Breakfast Bowl');
    expect(result.current.draft?.mealType).toBe('Breakfast');
    expect(result.current.draft?.items).toHaveLength(2);
    expect(result.current.draft?.calories).toBe(500);
    expect(result.current.draftDate).toBe('2026-09-26');
    expect(result.current.isDirty).toBe(false);
  });

  it('initializes draft from single-component row', () => {
    const items = [makeComponent({ id: 'c1', name: 'Oatmeal', calories: 380 })];
    const log = makeMeal(items, { calories: 380, protein: 13, carbs: 68, fat: 7, fiber: 10 });
    const onClose = vi.fn();

    const { result } = renderHook(
      () =>
        useMealEditor({
          meal: log,
          isOpen: true,
          onClose,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.draft?.items).toHaveLength(1);
    expect(result.current.draft?.calories).toBe(380);
    expect(result.current.isDirty).toBe(false);
  });

  it('initializes draft from legacy row without items', () => {
    const log = makeMeal(null, {
      food_name: 'Legacy Pasta',
      calories: 450,
      protein: 15,
      carbs: 80,
      fat: 5,
      fiber: 4,
      serving_size: 1.5,
      serving_unit: 'plate',
    });
    const onClose = vi.fn();

    const { result } = renderHook(
      () =>
        useMealEditor({
          meal: log,
          isOpen: true,
          onClose,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.draft?.items).toHaveLength(1);
    const item0 = result.current.draft?.items[0];
    expect(item0?.name).toBe('Legacy Pasta');
    expect(item0?.quantity).toBe(1.5);
    expect(item0?.calories).toBe(450);
    expect(result.current.draft?.calories).toBe(450);
    expect(result.current.isDirty).toBe(false);
  });

  it('D46: whole-meal scale is relative to the draft at open, x1 restores exactly', () => {
    const items = [
      makeComponent({ id: 'c1', name: 'Rice', quantity: 200, unit: 'g', calories: 260, protein: 5, carbs: 57, fat: 1, fiber: 1 }),
      makeComponent({ id: 'c2', name: 'Chicken', quantity: 150, unit: 'g', calories: 247, protein: 46, carbs: 0, fat: 5, fiber: 0 }),
    ];
    const log = makeMeal(items, { calories: 507 });
    const onClose = vi.fn();

    const { result } = renderHook(
      () =>
        useMealEditor({
          meal: log,
          isOpen: true,
          onClose,
        }),
      { wrapper: createWrapper() }
    );

    // Scale to x0.5
    act(() => {
      result.current.setDraft((prev) => (prev ? scaleStagedMeal(prev, 0.5) : prev));
    });
    expect(result.current.draft?.items[0].quantity).toBe(100);
    expect(result.current.draft?.items[0].calories).toBe(130);
    expect(result.current.draft?.items[1].quantity).toBe(75);
    expect(result.current.draft?.calories).toBe(253.5);
    expect(result.current.isDirty).toBe(true);

    // Scale to x2 (anchored from open, so 2x of original 200g & 150g)
    act(() => {
      result.current.setDraft((prev) => (prev ? scaleStagedMeal(prev, 2) : prev));
    });
    expect(result.current.draft?.items[0].quantity).toBe(400);
    expect(result.current.draft?.items[0].calories).toBe(520);
    expect(result.current.draft?.items[1].quantity).toBe(300);
    expect(result.current.draft?.calories).toBe(1014);

    // Scale to x1 restores original quantities exactly
    act(() => {
      result.current.setDraft((prev) => (prev ? scaleStagedMeal(prev, 1) : prev));
    });
    expect(result.current.draft?.items[0].quantity).toBe(200);
    expect(result.current.draft?.items[0].calories).toBe(260);
    expect(result.current.draft?.items[1].quantity).toBe(150);
    expect(result.current.draft?.calories).toBe(507);
    expect(result.current.isDirty).toBe(false);
  });

  it('D46: scaling keeps a per-item quantity edit made while scaled (old bar reset it)', () => {
    const items = [
      makeComponent({ id: 'c1', name: 'Rice', quantity: 200, unit: 'g', calories: 260, protein: 5, carbs: 57, fat: 1, fiber: 1 }),
      makeComponent({ id: 'c2', name: 'Chicken', quantity: 150, unit: 'g', calories: 247, protein: 46, carbs: 0, fat: 5, fiber: 0 }),
    ];
    const log = makeMeal(items, { calories: 507 });

    const { result } = renderHook(
      () => useMealEditor({ meal: log, isOpen: true, onClose: vi.fn() }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.setDraft((prev) => (prev ? scaleStagedMeal(prev, 0.5) : prev));
    });
    // Rice is now 100 g; the user bumps it to 150 g while at x0.5.
    const rice = result.current.draft!.items[0];
    act(() => {
      result.current.applyStagedItemChange(rice.id, { ...rice, quantity: 150 } as never);
    });
    expect(result.current.draft?.items[0].quantity).toBe(150);

    // Back to x1: the edit is kept (150 g at x0.5 -> 300 g), chicken returns to 150 g.
    act(() => {
      result.current.setDraft((prev) => (prev ? scaleStagedMeal(prev, 1) : prev));
    });
    expect(result.current.draft?.items[0].quantity).toBe(300);
    expect(result.current.draft?.items[0].calories).toBe(390);
    expect(result.current.draft?.items[1].quantity).toBe(150);
    expect(result.current.draft?.items[1].calories).toBe(247);
    expect(result.current.draft?.scale).toBeUndefined();
  });

  it('tracks dirty flag on name, mealType, date, and item modifications', () => {
    const items = [makeComponent()];
    const log = makeMeal(items);
    const onClose = vi.fn();

    const { result } = renderHook(
      () =>
        useMealEditor({
          meal: log,
          isOpen: true,
          onClose,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isDirty).toBe(false);

    // Change name
    act(() => {
      result.current.setDraft((prev) => (prev ? { ...prev, name: 'Different Name' } : prev));
    });
    expect(result.current.isDirty).toBe(true);

    // Revert name
    act(() => {
      result.current.setDraft((prev) => (prev ? { ...prev, name: log.food_name } : prev));
    });
    expect(result.current.isDirty).toBe(false);

    // Change date
    act(() => {
      result.current.setDraftDate('2026-09-25');
    });
    expect(result.current.isDirty).toBe(true);

    // Revert date
    act(() => {
      result.current.setDraftDate('2026-09-26');
    });
    expect(result.current.isDirty).toBe(false);

    // Change item quantity via applyStagedItemChange
    act(() => {
      result.current.applyStagedItemChange('c1', {
        ...makeComponent(),
        quantity: 120,
      });
    });
    expect(result.current.isDirty).toBe(true);
  });

  it('saves payload with ONE supabase update enforcing parent = sum(items) and moves logged_at if date changed', async () => {
    const items = [
      makeComponent({ id: 'c1', name: 'Oatmeal', quantity: 100, calories: 380, protein: 13, carbs: 68, fat: 7, fiber: 10 }),
      makeComponent({ id: 'c2', name: 'Milk', quantity: 200, calories: 100, protein: 8, carbs: 10, fat: 2, fiber: 0 }),
    ];
    const log = makeMeal(items, {
      logged_at: '2026-09-26T08:30:00.000Z',
      logged_date: '2026-09-26',
    });
    const onClose = vi.fn();
    const triggerToast = vi.fn();

    const { result } = renderHook(
      () =>
        useMealEditor({
          meal: log,
          isOpen: true,
          onClose,
          triggerToast,
          timeZone: 'UTC',
        }),
      { wrapper: createWrapper() }
    );

    // Change date to 2026-09-25 and change Oatmeal to 150g
    act(() => {
      result.current.setDraftDate('2026-09-25');
      result.current.applyStagedItemChange('c1', {
        ...items[0],
        quantity: 150,
      });
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const payload = mockUpdate.mock.calls[0][0];

    expect(payload.food_name).toBe('Breakfast Bowl');
    expect(payload.meal_type).toBe('Breakfast');
    expect(payload.logged_date).toBe('2026-09-25');
    // Time of day kept: 08:30:00.000Z on 2026-09-25
    expect(payload.logged_at).toBe('2026-09-25T08:30:00.000Z');
    // Parent totals match sum of items
    expect(payload.calories).toBe(670); // 150g oatmeal = 570 kcal + 100 kcal milk = 670
    expect(payload.protein).toBe(27.5); // 19.5 + 8
    expect(payload.carbs).toBe(112); // 102 + 10
    expect(payload.fat).toBe(12.5); // 10.5 + 2
    expect(payload.fiber).toBe(15); // 15 + 0
    expect(payload.items).toHaveLength(2);
    expect(onClose).toHaveBeenCalled();
    expect(triggerToast).toHaveBeenCalledWith(
      { name: 'Breakfast Bowl', calories: 670 },
      expect.objectContaining({
        variant: 'updated',
        dishName: 'Breakfast Bowl',
        calories: 670,
      })
    );
  });

  it('preserves logged_at if date was not changed', async () => {
    const items = [makeComponent()];
    const log = makeMeal(items, {
      logged_at: '2026-09-26T14:15:22.123Z',
      logged_date: '2026-09-26',
    });
    const onClose = vi.fn();

    const { result } = renderHook(
      () =>
        useMealEditor({
          meal: log,
          isOpen: true,
          onClose,
        }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.setDraft((prev) => (prev ? { ...prev, name: 'Updated Bowl' } : prev));
    });

    await act(async () => {
      await result.current.save();
    });

    const payload = mockUpdate.mock.calls[0][0];
    expect(payload.logged_at).toBe('2026-09-26T14:15:22.123Z');
    expect(payload.logged_date).toBe('2026-09-26');
  });

  it('undo restores full previous row snapshot through the same update path', async () => {
    const items = [makeComponent()];
    const log = makeMeal(items, {
      food_name: 'Original Food',
      calories: 380,
      logged_date: '2026-09-26',
    });
    const onClose = vi.fn();
    let toastOptions: any;
    const triggerToast = vi.fn((_dish, opts) => {
      toastOptions = opts;
    });

    const { result } = renderHook(
      () =>
        useMealEditor({
          meal: log,
          isOpen: true,
          onClose,
          triggerToast,
        }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.setDraft((prev) => (prev ? { ...prev, name: 'Renamed' } : prev));
    });

    await act(async () => {
      await result.current.save();
    });

    expect(triggerToast).toHaveBeenCalled();
    expect(toastOptions?.onUndo).toBeDefined();

    mockUpdate.mockClear();

    // Trigger Undo
    await act(async () => {
      await toastOptions.onUndo();
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const undoPayload = mockUpdate.mock.calls[0][0];
    expect(undoPayload.food_name).toBe('Original Food');
    expect(undoPayload.calories).toBe(380);
  });

  it('handles save failure: sets error message and status, does not close sheet', async () => {
    const items = [makeComponent()];
    const log = makeMeal(items);
    const onClose = vi.fn();
    const setStatus = vi.fn();
    const setIsError = vi.fn();

    // Mock update to fail
    vi.mocked(mockUpdate).mockImplementationOnce(() => {
      throw new Error('Database write error');
    });

    const { result } = renderHook(
      () =>
        useMealEditor({
          meal: log,
          isOpen: true,
          onClose,
          setStatus,
          setIsError,
        }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.setDraft((prev) => (prev ? { ...prev, name: 'Changed' } : prev));
    });

    await act(async () => {
      await result.current.save();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toMatch(/Database write error/i);
    expect(setStatus).toHaveBeenCalledWith(expect.stringMatching(/Database write error/i));
    expect(setIsError).toHaveBeenCalledWith(true);
  });
});

  it('leaves use_count untouched (custom_dishes table is not queried or updated)', async () => {
    const items = [makeComponent()];
    const log = makeMeal(items);
    const onClose = vi.fn();

    const { result } = renderHook(
      () =>
        useMealEditor({
          meal: log,
          isOpen: true,
          onClose,
        }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.setDraft((prev) => (prev ? { ...prev, name: 'Touched Name' } : prev));
    });

    await act(async () => {
      await result.current.save();
    });

    const { getRecordedTables } = await import('../../test/supabaseBuilderMock');
    expect(getRecordedTables()).not.toContain('custom_dishes');
  });
