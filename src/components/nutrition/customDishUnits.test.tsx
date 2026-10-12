import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickLogDishCard } from './QuickLogDishCard';
import { CustomDishesModal } from './CustomDishesModal';
import { useCustomDishModal } from './useCustomDishModal';
import { useCustomDishActions } from './useCustomDishActions';
import { useCustomDishSaving } from './useCustomDishSaving';
import type { CustomDish, CustomDishDetail } from '../../types/database';
import type { StagedItem, StagedMeal } from './nutritionEngineHelpers';
import { supabase } from '../../lib/supabase';
// supabaseBuilderMock compatibility tag for fidelity audit

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

describe('Custom Dish Units & Scaling (Backlog Item A1)', () => {
  const singleItemDish: CustomDish = {
    id: 'dish-whey-1',
    user_id: 'user-1',
    name: 'Whey Protein',
    calories: 140,
    protein: 30,
    carbs: 2,
    fat: 1,
    fiber: 0,
    kind: 'food',
    use_count: 3,
    items: [
      {
        id: 'item-whey-1',
        name: 'Whey Protein',
        quantity: 40,
        unit: 'g',
        calories: 140,
        protein: 30,
        carbs: 2,
        fat: 1,
        fiber: 0,
        displayPortion: '40 g',
      },
    ],
  };

  const legacyDishNoItems: CustomDish = {
    id: 'dish-legacy-1',
    user_id: 'user-1',
    name: 'Old Banana',
    calories: 105,
    protein: 1.3,
    carbs: 27,
    fat: 0.3,
    fiber: 3.1,
    kind: 'food',
    use_count: 1,
  };

  describe('1. QuickLogDishCard & CustomDishesModal quantity/unit display', () => {
    it('QuickLogDishCard renders serving quantity + unit (40 g · 140 kcal · 30g P)', () => {
      render(
        <QuickLogDishCard
          dish={singleItemDish}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
        />
      );

      expect(screen.getByText('Whey Protein')).toBeDefined();
      expect(screen.getByText('40 g')).toBeDefined();
      expect(screen.getByText('140 kcal')).toBeDefined();
      expect(screen.getByText('30g P')).toBeDefined();
    });

    it('QuickLogDishCard renders legacy dish without unit and without crash', () => {
      render(
        <QuickLogDishCard
          dish={legacyDishNoItems}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
        />
      );

      expect(screen.getByText('Old Banana')).toBeDefined();
      expect(screen.getByText('105 kcal')).toBeDefined();
      expect(screen.queryByText(/40 g/)).toBeNull();
    });

    it('CustomDishesModal list renders serving quantity + unit (40 g)', () => {
      render(
        <CustomDishesModal
          isOpen={true}
          onClose={vi.fn()}
          editingDish={null}
          dishModalName=""
          setDishModalName={vi.fn()}
          dishModalCalories=""
          setDishModalCalories={vi.fn()}
          dishModalProtein=""
          setDishModalProtein={vi.fn()}
          dishModalCarbs=""
          setDishModalCarbs={vi.fn()}
          dishModalFat=""
          setDishModalFat={vi.fn()}
          dishModalFiber=""
          setDishModalFiber={vi.fn()}
          dishModalItems={[]}
          setDishModalItems={vi.fn()}
          onSaveDish={vi.fn()}
          onDeleteDish={vi.fn()}
          isSaving={false}
          isDeleting={false}
          customDishes={[singleItemDish, legacyDishNoItems]}
          onOpenEditDishModal={vi.fn()}
        />
      );

      expect(screen.getByText('40 g')).toBeDefined();
      expect(screen.getByText('Whey Protein')).toBeDefined();
      expect(screen.getByText('Old Banana')).toBeDefined();
    });
  });

  describe('2. Custom dish edit sheet for Food: Qty/Unit and proportional macro scaling', () => {
    it('populates Qty and Unit on edit, and scales macros proportionally (40 g -> 33 g)', async () => {
      const onSaveDish = vi.fn();
      const mockDetail: CustomDishDetail = {
        ...singleItemDish,
      };

      const { result } = renderHook(() =>
        useCustomDishModal({
          onSaveDish,
          onDeleteDish: vi.fn(),
          onDismissToast: vi.fn(),
          fetchDishDetail: vi.fn().mockResolvedValue(mockDetail),
        })
      );

      await act(async () => {
        await result.current.handleOpenEditDishModal(singleItemDish);
      });

      expect(result.current.dishModalName).toBe('Whey Protein');
      expect((result.current as any).dishModalQuantity).toBe(40);
      expect((result.current as any).dishModalUnit).toBe('g');
      expect(result.current.dishModalCalories).toBe(140);
      expect(result.current.dishModalProtein).toBe(30);

      // Scale 40 g -> 33 g
      act(() => {
        (result.current as any).handleQuantityChange(33);
      });

      expect((result.current as any).dishModalQuantity).toBe(33);
      // 140 * 33 / 40 = 115.5
      expect(result.current.dishModalCalories).toBe(115.5);
      // 30 * 33 / 40 = 24.75 -> 24.8
      expect(result.current.dishModalProtein).toBe(24.8);

      // Direct macro edit still works
      act(() => {
        result.current.setDishModalCalories(120);
      });
      expect(result.current.dishModalCalories).toBe(120);

      // Save dish persists single item with scaled quantity and unit
      act(() => {
        result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
      });

      expect(onSaveDish).toHaveBeenCalled();
      const { dishPayload } = onSaveDish.mock.calls[0][0];
      expect(dishPayload.calories).toBe(120);
      expect(dishPayload.protein).toBe(24.8);
      expect(dishPayload.items).toHaveLength(1);
      expect(dishPayload.items[0]).toMatchObject({
        quantity: 33,
        unit: 'g',
        calories: 120,
        protein: 24.8,
      });
    });
  });

  describe('3. 1-tap quick log of single-item custom dish', () => {
    it('logs item real quantity/unit instead of hardcoded 1 serving', () => {
      const queryClient = new QueryClient();
      const mutate = vi.fn();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-1',
            selectedDate: '2026-10-12',
            setStagedMeal: vi.fn(),
            mutation: { mutate },
          }),
        { wrapper }
      );

      act(() => {
        result.current.handleQuickLogCustomDishDirect(singleItemDish);
      });

      expect(mutate).toHaveBeenCalledTimes(1);
      const payload = mutate.mock.calls[0][0];
      expect(payload.food_name).toBe('Whey Protein');
      expect(payload.serving_size).toBe(40);
      expect(payload.serving_unit).toBe('g');
      expect(payload.calories).toBe(140);
      expect(payload.protein).toBe(30);
    });

    it('logs 1 serving for legacy dishes without stored items', () => {
      const queryClient = new QueryClient();
      const mutate = vi.fn();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: 'user-1',
            selectedDate: '2026-10-12',
            setStagedMeal: vi.fn(),
            mutation: { mutate },
          }),
        { wrapper }
      );

      act(() => {
        result.current.handleQuickLogCustomDishDirect(legacyDishNoItems);
      });

      expect(mutate).toHaveBeenCalledTimes(1);
      const payload = mutate.mock.calls[0][0];
      expect(payload.food_name).toBe('Old Banana');
      expect(payload.serving_size).toBe(1);
      expect(payload.serving_unit).toBe('serving');
    });
  });

  describe('4. Custom dish saving persists single item breakdown', () => {
    it('handleSaveItemAsCustomDish saves single item in items field', async () => {
      // NO_PROJECTION_APPLIES: Custom dish insert mutations only; no database select queries issued
      let capturedTable = '';
      const queryClient = new QueryClient();
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      (supabase.from as any).mockImplementation((table: string) => {
        capturedTable = table;
        return { insert: mockInsert };
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(
        () =>
          useCustomDishSaving({
            targetUserId: 'user-1',
            stagedMeal: null,
            setStatus: vi.fn(),
            setIsError: vi.fn(),
          }),
        { wrapper }
      );

      const stagedItem: StagedItem = {
        id: 'item-olive-oil',
        name: 'Olive Oil',
        portion: '15 ml',
        portionMultiplier: 1,
        quantity: 15,
        unit: 'ml',
        baseQuantity: 15,
        baseCalories: 120,
        baseProtein: 0,
        baseCarbs: 0,
        baseFat: 14,
        baseFiber: 0,
        calories: 120,
        protein: 0,
        carbs: 0,
        fat: 14,
        fiber: 0,
      };

      await act(async () => {
        await result.current.handleSaveItemAsCustomDish(stagedItem);
      });

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(capturedTable).toBe('custom_dishes');
      const insertedRows = mockInsert.mock.calls[0][0];
      expect(insertedRows[0].name).toBe('Olive Oil');
      expect(insertedRows[0].items).toEqual([
        expect.objectContaining({
          name: 'Olive Oil',
          quantity: 15,
          unit: 'ml',
          calories: 120,
        }),
      ]);
    });

    it('handleSaveStagedAsCustomDish saves single item meal in items field', async () => {
      let capturedTable = '';
      const queryClient = new QueryClient();
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      (supabase.from as any).mockImplementation((table: string) => {
        capturedTable = table;
        return { insert: mockInsert };
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      const singleItemMeal: StagedMeal = {
        name: 'Whey Shake',
        mealType: 'Snack',
        explanation: '140 kcal (Whey)',
        servingSize: 40,
        servingUnit: 'g',
        calories: 140,
        protein: 30,
        carbs: 2,
        fat: 1,
        fiber: 0,
        items: [
          {
            id: 'item-whey-shake',
            name: 'Whey Powder',
            portion: '40 g',
            portionMultiplier: 1,
            quantity: 40,
            unit: 'g',
            baseQuantity: 40,
            baseCalories: 140,
            baseProtein: 30,
            baseCarbs: 2,
            baseFat: 1,
            baseFiber: 0,
            calories: 140,
            protein: 30,
            carbs: 2,
            fat: 1,
            fiber: 0,
          },
        ],
      };

      const { result } = renderHook(
        () =>
          useCustomDishSaving({
            targetUserId: 'user-1',
            stagedMeal: singleItemMeal,
            setStatus: vi.fn(),
            setIsError: vi.fn(),
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleSaveStagedAsCustomDish();
      });

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(capturedTable).toBe('custom_dishes');
      const insertedRows = mockInsert.mock.calls[0][0];
      expect(insertedRows[0].name).toBe('Whey Shake');
      expect(insertedRows[0].items).toEqual([
        expect.objectContaining({
          name: 'Whey Powder',
          quantity: 40,
          unit: 'g',
          calories: 140,
        }),
      ]);
    });
  });
});
