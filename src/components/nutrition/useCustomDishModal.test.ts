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
});

