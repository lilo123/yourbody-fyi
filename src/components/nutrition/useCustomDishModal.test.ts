import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCustomDishModal } from './useCustomDishModal';
import type { CustomDish } from '../../types/database';

describe('useCustomDishModal', () => {
  it('defaults dishModalKind to "food" for a new dish and emits kind in save payload', () => {
    const onSaveDish = vi.fn();
    const { result } = renderHook(() =>
      useCustomDishModal({
        onSaveDish,
        onDeleteDish: vi.fn(),
        onDismissToast: vi.fn(),
      })
    );

    act(() => {
      result.current.handleOpenNewDishModal();
    });

    expect((result.current as any).dishModalKind).toBe('food');

    act(() => {
      result.current.setDishModalName('Single Apple');
      result.current.setDishModalCalories(95);
    });

    act(() => {
      result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
    });

    expect(onSaveDish).toHaveBeenCalled();
    const { dishPayload } = onSaveDish.mock.calls[0][0];
    expect(dishPayload.name).toBe('Single Apple');
    expect(dishPayload.kind).toBe('food');
    expect(dishPayload.calories).toBe(95);
  });

  it('refuses to save a recipe that has no components', () => {
    const onSaveDish = vi.fn();
    const { result } = renderHook(() =>
      useCustomDishModal({
        onSaveDish,
        onDeleteDish: vi.fn(),
        onDismissToast: vi.fn(),
      })
    );

    act(() => {
      result.current.handleOpenNewDishModal();
    });

    act(() => {
      result.current.setDishModalName('Empty Recipe');
      (result.current as any).setDishModalKind('recipe');
    });

    act(() => {
      result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
    });

    // A recipe derives its totals from Σ(components). With zero components the
    // parent-macro inputs are not rendered, so saving here would silently
    // persist a 0 kcal dish.
    expect(onSaveDish).not.toHaveBeenCalled();
  });

  it('populates dishModalKind from dish.kind on edit and preserves kind in save payload', async () => {
    const onSaveDish = vi.fn();
    const { result } = renderHook(() =>
      useCustomDishModal({
        onSaveDish,
        onDeleteDish: vi.fn(),
        onDismissToast: vi.fn(),
        fetchDishDetail: vi.fn().mockResolvedValue(null),
      })
    );

    const recipeDish: CustomDish = {
      id: 'dish-recipe-1',
      user_id: 'user-1',
      name: 'Custom Salad',
      calories: 350,
      protein: 15,
      carbs: 25,
      fat: 12,
      fiber: 6,
      kind: 'recipe',
      use_count: 5,
    };

    await act(async () => {
      await result.current.handleOpenEditDishModal(recipeDish);
    });

    expect((result.current as any).dishModalKind).toBe('recipe');

    act(() => {
      result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
    });

    expect(onSaveDish).toHaveBeenCalled();
    const { dishPayload, editingDishId } = onSaveDish.mock.calls[0][0];
    expect(editingDishId).toBe('dish-recipe-1');
    expect(dishPayload.kind).toBe('recipe');
  });

  it('falls back to recipe if kind is missing but dish has multiple items', async () => {
    const onSaveDish = vi.fn();
    const mockDetail = {
      id: 'dish-legacy-1',
      user_id: 'user-1',
      name: 'Legacy Combo',
      calories: 400,
      protein: 20,
      carbs: 40,
      fat: 10,
      fiber: 5,
      kind: undefined as any,
      use_count: 0,
      items: [
        { id: '1', name: 'Item 1', quantity: 1, unit: 'serving' as const, calories: 200, protein: 10, carbs: 20, fat: 5, fiber: 2 },
        { id: '2', name: 'Item 2', quantity: 1, unit: 'serving' as const, calories: 200, protein: 10, carbs: 20, fat: 5, fiber: 3 },
      ],
    };

    const { result } = renderHook(() =>
      useCustomDishModal({
        onSaveDish,
        onDeleteDish: vi.fn(),
        onDismissToast: vi.fn(),
        fetchDishDetail: vi.fn().mockResolvedValue(mockDetail),
      })
    );

    const legacyDish: CustomDish = {
      id: 'dish-legacy-1',
      user_id: 'user-1',
      name: 'Legacy Combo',
      calories: 400,
      protein: 20,
      carbs: 40,
      fat: 10,
      fiber: 5,
      kind: undefined as any,
      use_count: 0,
    };

    await act(async () => {
      await result.current.handleOpenEditDishModal(legacyDish);
    });

    expect((result.current as any).dishModalKind).toBe('recipe');
  });

  it('populates dishModalNotes on edit and includes trimmed notes in save payload', async () => {
    const onSaveDish = vi.fn();
    const { result } = renderHook(() =>
      useCustomDishModal({
        onSaveDish,
        onDeleteDish: vi.fn(),
        onDismissToast: vi.fn(),
        fetchDishDetail: vi.fn().mockResolvedValue({ items: null }),
      })
    );

    const dishWithNotes: CustomDish = {
      id: 'dish-note-1',
      user_id: 'user-1',
      name: 'Protein Shake',
      calories: 250,
      protein: 30,
      carbs: 10,
      fat: 3,
      fiber: 2,
      kind: 'food',
      use_count: 5,
      notes: 'Mix with 300ml unsweetened almond milk',
    };

    await act(async () => {
      await result.current.handleOpenEditDishModal(dishWithNotes);
    });

    expect(result.current.dishModalNotes).toBe('Mix with 300ml unsweetened almond milk');

    act(() => {
      result.current.setDishModalNotes('  Updated: mix with cold water instead  ');
    });

    act(() => {
      result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
    });

    expect(onSaveDish).toHaveBeenCalled();
    const { dishPayload } = onSaveDish.mock.calls[0][0];
    expect(dishPayload.notes).toBe('Updated: mix with cold water instead');
  });

  it('sets notes to null in save payload when dishModalNotes is empty or only whitespace', () => {
    const onSaveDish = vi.fn();
    const { result } = renderHook(() =>
      useCustomDishModal({
        onSaveDish,
        onDeleteDish: vi.fn(),
        onDismissToast: vi.fn(),
      })
    );

    act(() => {
      result.current.handleOpenNewDishModal();
      result.current.setDishModalName('Plain Rice');
      result.current.setDishModalCalories(200);
      result.current.setDishModalNotes('   ');
    });

    act(() => {
      result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
    });

    expect(onSaveDish).toHaveBeenCalled();
    const { dishPayload } = onSaveDish.mock.calls[0][0];
    expect(dishPayload.notes).toBeNull();
  });

  it('reproduces bug: edit in Food tab, switch to Recipe, save -> stale item / wrong totals', async () => {
    const onSaveDish = vi.fn();
    const existingDish: CustomDish = {
      id: 'dish-icecream-1',
      user_id: 'user-1',
      name: 'Protein Ice Cream',
      calories: 609,
      protein: 73.9,
      carbs: 42,
      fat: 16.1,
      fiber: 0,
      kind: 'food',
      use_count: 3,
      items: [
        {
          id: 'item-1',
          name: 'Protein Ice Cream',
          quantity: 1,
          unit: 'unit',
          calories: 609,
          protein: 73.9,
          carbs: 42,
          fat: 16.1,
          fiber: 0,
        },
      ],
    };

    const { result } = renderHook(() =>
      useCustomDishModal({
        onSaveDish,
        onDeleteDish: vi.fn(),
        onDismissToast: vi.fn(),
        fetchDishDetail: vi.fn().mockResolvedValue(existingDish),
      })
    );

    await act(async () => {
      await result.current.handleOpenEditDishModal(existingDish);
    });

    expect(result.current.dishModalKind).toBe('food');

    // User edits macros in Food tab
    act(() => {
      result.current.setDishModalCalories(627);
      result.current.setDishModalProtein(76);
    });

    // User switches to Recipe tab
    act(() => {
      result.current.setDishModalKind('recipe');
    });

    // User saves
    act(() => {
      result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
    });

    expect(onSaveDish).toHaveBeenCalled();
    const { dishPayload } = onSaveDish.mock.calls[0][0];
    // Expected: user's edits (627 kcal, 76 protein) are preserved
    // Actual on origin/main: stale values (609 kcal, 73.9 protein) are saved because Recipe tab kept separate state
    expect(dishPayload.calories).toBe(627);
    expect(dishPayload.protein).toBe(76);
    expect(dishPayload.items?.[0]?.calories).toBe(627);
    expect(dishPayload.items?.[0]?.protein).toBe(76);
  });

  it('synthesizes 1 component on open for dishes with items: null keeping exact grams', async () => {
    const onSaveDish = vi.fn();
    const dishWithGrams: any = {
      id: 'dish-grams-1',
      user_id: 'user-1',
      name: 'High Protein Bowl',
      calories: 627,
      protein: 76,
      carbs: 45,
      fat: 15,
      fiber: 8,
      kind: 'food',
      serving_quantity: 595,
      serving_unit: 'g',
      items: null,
      use_count: 2,
    };

    const { result } = renderHook(() =>
      useCustomDishModal({
        onSaveDish,
        onDeleteDish: vi.fn(),
        onDismissToast: vi.fn(),
        fetchDishDetail: vi.fn().mockResolvedValue(null),
      })
    );

    await act(async () => {
      await result.current.handleOpenEditDishModal(dishWithGrams);
    });

    expect(result.current.dishModalItems).toHaveLength(1);
    const item = result.current.dishModalItems[0];
    expect(item.name).toBe('High Protein Bowl');
    expect(item.quantity).toBe(595);
    expect(item.unit).toBe('g');
    expect(item.calories).toBe(627);
    expect(item.protein).toBe(76);
    expect(item.carbs).toBe(45);
    expect(item.fat).toBe(15);
    expect(item.fiber).toBe(8);

    act(() => {
      result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
    });

    expect(onSaveDish).toHaveBeenCalled();
    const { dishPayload, editingDishId } = onSaveDish.mock.calls[0][0];
    expect(editingDishId).toBe('dish-grams-1');
    expect(dishPayload.items).toHaveLength(1);
    expect(dishPayload.items[0].quantity).toBe(595);
    expect(dishPayload.items[0].unit).toBe('g');
    expect(dishPayload.calories).toBe(627);
    expect(dishPayload.protein).toBe(76);
    expect(dishPayload.kind).toBe('food');
  });

  it('synthesizes 1 component on open for dishes with items: null without portion columns', async () => {
    const onSaveDish = vi.fn();
    const legacyDish: any = {
      id: 'dish-no-portion-1',
      user_id: 'user-1',
      name: 'Old Dish',
      calories: 300,
      protein: 20,
      carbs: 35,
      fat: 8,
      fiber: 4,
      kind: 'food',
      items: null,
      use_count: 1,
    };

    const { result } = renderHook(() =>
      useCustomDishModal({
        onSaveDish,
        onDeleteDish: vi.fn(),
        onDismissToast: vi.fn(),
        fetchDishDetail: vi.fn().mockResolvedValue(null),
      })
    );

    await act(async () => {
      await result.current.handleOpenEditDishModal(legacyDish);
    });

    expect(result.current.dishModalItems).toHaveLength(1);
    const item = result.current.dishModalItems[0];
    expect(item.name).toBe('Old Dish');
    expect(item.quantity).toBe(1);
    expect(item.unit).toBe('unit');
    expect(item.calories).toBe(300);
    expect(item.protein).toBe(20);
  });

  it('synthesizes 1 component for legacy dish with items: null with decimal macros and saves exact sum (constraint holds)', async () => {
    const onSaveDish = vi.fn();
    const legacyDish: any = {
      id: 'dish-legacy-decimals',
      user_id: 'user-1',
      name: 'Protein Ice Cream',
      calories: 609,
      protein: 73.9,
      carbs: 50.6,
      fat: 15.7,
      fiber: 1.2,
      kind: 'food',
      serving_quantity: 595,
      serving_unit: 'g',
      items: null,
      use_count: 5,
    };

    const { result } = renderHook(() =>
      useCustomDishModal({
        onSaveDish,
        onDeleteDish: vi.fn(),
        onDismissToast: vi.fn(),
        fetchDishDetail: vi.fn().mockResolvedValue(null),
      })
    );

    await act(async () => {
      await result.current.handleOpenEditDishModal(legacyDish);
    });

    expect(result.current.dishModalItems).toHaveLength(1);
    const item = result.current.dishModalItems[0];
    expect(item.name).toBe('Protein Ice Cream');
    expect(item.quantity).toBe(595);
    expect(item.unit).toBe('g');
    expect(item.calories).toBe(609);
    expect(item.protein).toBe(73.9);
    expect(item.carbs).toBe(50.6);
    expect(item.fat).toBe(15.7);
    expect(item.fiber).toBe(1.2);

    // Save WITHOUT changes
    act(() => {
      result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
    });

    expect(onSaveDish).toHaveBeenCalled();
    const { dishPayload, editingDishId } = onSaveDish.mock.calls[0][0];
    expect(editingDishId).toBe('dish-legacy-decimals');
    expect(dishPayload.items).toHaveLength(1);
    expect(dishPayload.items[0].quantity).toBe(595);
    expect(dishPayload.items[0].unit).toBe('g');
    // Exact totals preserved without rounding drift
    expect(dishPayload.calories).toBe(609);
    expect(dishPayload.protein).toBe(73.9);
    expect(dishPayload.carbs).toBe(50.6);
    expect(dishPayload.fat).toBe(15.7);
    expect(dishPayload.fiber).toBe(1.2);
    // Mathematical consistency for chk_cd_parent_equals_items_sum
    expect(Math.abs(dishPayload.calories - dishPayload.items[0].calories)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(dishPayload.protein - dishPayload.items[0].protein)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(dishPayload.carbs - dishPayload.items[0].carbs)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(dishPayload.fat - dishPayload.items[0].fat)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(dishPayload.fiber - dishPayload.items[0].fiber)).toBeLessThanOrEqual(0.05);
  });

  it('saving an existing single-item dish unchanged preserves exact item ID, quantity, unit, and derived parent macros', async () => {
    const onSaveDish = vi.fn();
    const existingDish: CustomDish = {
      id: 'dish-existing-1',
      user_id: 'user-1',
      name: 'Unchanged Oatmeal',
      calories: 320,
      protein: 12,
      carbs: 54,
      fat: 6,
      fiber: 8,
      kind: 'food',
      use_count: 4,
      items: [
        {
          id: 'item-existing-abc',
          name: 'Rolled Oats',
          quantity: 80,
          unit: 'g',
          calories: 320,
          protein: 12,
          carbs: 54,
          fat: 6,
          fiber: 8,
        },
      ],
    };

    const { result } = renderHook(() =>
      useCustomDishModal({
        onSaveDish,
        onDeleteDish: vi.fn(),
        onDismissToast: vi.fn(),
        fetchDishDetail: vi.fn().mockResolvedValue(existingDish),
      })
    );

    await act(async () => {
      await result.current.handleOpenEditDishModal(existingDish);
    });

    act(() => {
      result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
    });

    expect(onSaveDish).toHaveBeenCalled();
    const { dishPayload, editingDishId } = onSaveDish.mock.calls[0][0];
    expect(editingDishId).toBe('dish-existing-1');
    expect(dishPayload.name).toBe('Unchanged Oatmeal');
    expect(dishPayload.kind).toBe('food');
    expect(dishPayload.calories).toBe(320);
    expect(dishPayload.protein).toBe(12);
    expect(dishPayload.carbs).toBe(54);
    expect(dishPayload.fat).toBe(6);
    expect(dishPayload.fiber).toBe(8);
    expect(dishPayload.items).toHaveLength(1);
    expect(dishPayload.items[0].id).toBe('item-existing-abc');
    expect(dishPayload.items[0].name).toBe('Rolled Oats');
    expect(dishPayload.items[0].quantity).toBe(80);
    expect(dishPayload.items[0].unit).toBe('g');
  });
});

