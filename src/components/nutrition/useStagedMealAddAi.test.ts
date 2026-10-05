import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStagedMealAddAi } from './useStagedMealAddAi';
import { buildStagedItem, type StagedMeal } from './nutritionEngineHelpers';

describe('useStagedMealAddAi', () => {
  const baseMeal: StagedMeal = {
    name: 'Lunch',
    mealType: 'Lunch',
    explanation: '300 kcal (Rice) = 300 kcal',
    items: [
      buildStagedItem({
        name: 'Rice',
        portion: '150 g',
        quantity: 150,
        unit: 'g',
        calories: 300,
        protein: 6,
        carbs: 65,
        fat: 1,
        fiber: 1,
      }),
    ],
    calories: 300,
    protein: 6,
    carbs: 65,
    fat: 1,
    fiber: 1,
    servingSize: 1,
    servingUnit: 'serving',
  };

  it('appends non-identical items, recomputes totals, keeps meal name/type/explanation unchanged, and triggers toast', () => {
    let currentMeal: StagedMeal | null = baseMeal;
    const setStagedMeal = vi.fn((m) => {
      currentMeal = m;
    });
    const triggerToast = vi.fn();

    const { result, rerender } = renderHook(
      ({ meal }: { meal: StagedMeal | null }) =>
        useStagedMealAddAi({
          stagedMeal: meal,
          setStagedMeal,
          triggerToast,
        }),
      { initialProps: { meal: currentMeal as StagedMeal | null } }
    );

    const newItem = buildStagedItem({
      name: 'Egg',
      portion: '1 large',
      quantity: 1,
      unit: 'unit',
      calories: 70,
      protein: 6,
      carbs: 0.5,
      fat: 5,
      fiber: 0,
    });

    act(() => {
      result.current.handleAddParsedItems([newItem], baseMeal);
    });

    expect(setStagedMeal).toHaveBeenCalled();
    const updatedMeal = setStagedMeal.mock.calls[0][0];
    expect(updatedMeal.items).toHaveLength(2);
    expect(updatedMeal.calories).toBe(370);
    expect(updatedMeal.protein).toBe(12);
    expect(updatedMeal.carbs).toBe(65.5);
    expect(updatedMeal.name).toBe('Lunch');
    expect(updatedMeal.mealType).toBe('Lunch');
    expect(updatedMeal.explanation).toBe('300 kcal (Rice) = 300 kcal');

    expect(triggerToast).toHaveBeenCalledWith(
      { name: 'Egg', calories: 70 },
      expect.objectContaining({
        variant: 'added',
        dishName: 'Egg',
        calories: 70,
      })
    );

    // Test Undo
    const toastOpts = triggerToast.mock.calls[0][1];
    rerender({ meal: updatedMeal });
    act(() => {
      toastOpts.onUndo();
    });
    expect(setStagedMeal).toHaveBeenLastCalledWith(baseMeal);
  });

  it('merges identical items per D36', () => {
    let currentMeal: StagedMeal | null = baseMeal;
    const setStagedMeal = vi.fn((m) => {
      currentMeal = m;
    });
    const triggerToast = vi.fn();

    const { result } = renderHook(() =>
      useStagedMealAddAi({
        stagedMeal: currentMeal,
        setStagedMeal,
        triggerToast,
      })
    );

    const identicalRice = buildStagedItem({
      name: 'rice', // case-insensitive match
      portion: '150 g',
      quantity: 150,
      unit: 'g',
      calories: 300,
      protein: 6,
      carbs: 65,
      fat: 1,
      fiber: 1,
    });

    act(() => {
      result.current.handleAddParsedItems([identicalRice], baseMeal);
    });

    const updatedMeal = setStagedMeal.mock.calls[0][0];
    expect(updatedMeal.items).toHaveLength(1);
    expect(updatedMeal.items[0].quantity).toBe(300);
    expect(updatedMeal.calories).toBe(600);
    expect(updatedMeal.protein).toBe(12);
  });

  it('formats toast line 2 as "<n> items · +<kcal> kcal" for multi-item additions', () => {
    let currentMeal: StagedMeal | null = baseMeal;
    const setStagedMeal = vi.fn();
    const triggerToast = vi.fn();

    const { result } = renderHook(() =>
      useStagedMealAddAi({
        stagedMeal: currentMeal,
        setStagedMeal,
        triggerToast,
      })
    );

    const item1 = buildStagedItem({ name: 'Apple', calories: 60 });
    const item2 = buildStagedItem({ name: 'Banana', calories: 100 });

    act(() => {
      result.current.handleAddParsedItems([item1, item2], baseMeal);
    });

    expect(triggerToast).toHaveBeenCalledWith(
      { name: '2 items', calories: 160 },
      expect.objectContaining({
        variant: 'added',
        dishName: '2 items',
        calories: 160,
      })
    );
  });

  it('drops result silently when staged meal was discarded/logged while parsing', () => {
    let currentMeal: StagedMeal | null = baseMeal;
    const setStagedMeal = vi.fn();
    const triggerToast = vi.fn();

    const { result, rerender } = renderHook<
      ReturnType<typeof useStagedMealAddAi>,
      { meal: StagedMeal | null }
    >(
      ({ meal }) =>
        useStagedMealAddAi({
          stagedMeal: meal,
          setStagedMeal,
          triggerToast,
        }),
      { initialProps: { meal: currentMeal } }
    );

    // Simulate meal logged or discarded while parsing
    currentMeal = null;
    rerender({ meal: null });

    const newItem = buildStagedItem({ name: 'Apple', calories: 60 });
    act(() => {
      result.current.handleAddParsedItems([newItem], baseMeal);
    });

    expect(setStagedMeal).not.toHaveBeenCalled();
    expect(triggerToast).not.toHaveBeenCalled();
  });

  it('drops result silently when staged meal was replaced while parsing', () => {
    let currentMeal: StagedMeal | null = baseMeal;
    const setStagedMeal = vi.fn();
    const triggerToast = vi.fn();

    const { result, rerender } = renderHook(
      ({ meal }) =>
        useStagedMealAddAi({
          stagedMeal: meal,
          setStagedMeal,
          triggerToast,
        }),
      { initialProps: { meal: currentMeal } }
    );

    // Simulate meal replaced
    const differentMeal: StagedMeal = {
      ...baseMeal,
      name: 'Dinner',
    };
    currentMeal = differentMeal;
    rerender({ meal: differentMeal });

    const newItem = buildStagedItem({ name: 'Apple', calories: 60 });
    act(() => {
      result.current.handleAddParsedItems([newItem], baseMeal);
    });

    expect(setStagedMeal).not.toHaveBeenCalled();
    expect(triggerToast).not.toHaveBeenCalled();
  });
});
