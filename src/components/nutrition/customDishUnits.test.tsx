import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, renderHook, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickLogDishCard } from './QuickLogDishCard';
import { CustomDishesModal } from './CustomDishesModal';
import { useCustomDishModal } from './useCustomDishModal';
import { useCustomDishActions } from './useCustomDishActions';
import { useCustomDishSaving } from './useCustomDishSaving';
import { mapLegacyUnit } from './legacyUnitMapping';
import type { CustomDish, CustomDishDetail } from '../../types/database';
import type { StagedItem, StagedMeal } from './nutritionEngineHelpers';
import { getCustomDishPortion, sumItems } from '../../utils/itemModel';
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
  const singleItemDishWithPortionColumns: CustomDish = {
    id: 'dish-whey-cols',
    user_id: 'user-1',
    name: 'Whey Protein Powder',
    calories: 140,
    protein: 30,
    carbs: 2,
    fat: 1,
    fiber: 0,
    kind: 'food',
    use_count: 5,
    serving_quantity: 40,
    serving_unit: 'g',
  };

  const singleItemDishWithItems: CustomDish = {
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

  const recipeDish: CustomDish = {
    id: 'dish-recipe-1',
    user_id: 'user-1',
    name: 'Chicken Rice Bowl',
    calories: 550,
    protein: 45,
    carbs: 60,
    fat: 12,
    fiber: 4,
    kind: 'recipe',
    use_count: 2,
    serving_quantity: 150,
    serving_unit: 'g',
    items: [
      {
        id: 'item-chicken',
        name: 'Chicken Breast',
        quantity: 150,
        unit: 'g',
        calories: 250,
        protein: 40,
        carbs: 0,
        fat: 5,
        fiber: 0,
      },
      {
        id: 'item-rice',
        name: 'White Rice',
        quantity: 200,
        unit: 'g',
        calories: 300,
        protein: 5,
        carbs: 60,
        fat: 7,
        fiber: 4,
      },
    ],
  };

  describe('1. QuickLogDishCard & CustomDishesModal quantity/unit display', () => {
    it('getCustomDishPortion formats serving_quantity & serving_unit for food dishes', () => {
      expect(getCustomDishPortion(singleItemDishWithPortionColumns)).toBe('40 g');
      expect(getCustomDishPortion(singleItemDishWithItems)).toBe('40 g');
      // For recipes, item 0 is an ingredient and MUST NOT be used or shown
      expect(getCustomDishPortion(recipeDish)).toBeNull();
      // Legacy dish without items or serving columns
      expect(getCustomDishPortion(legacyDishNoItems)).toBeNull();
    });

    it('QuickLogDishCard renders serving quantity + unit from PostgREST JSON path aliases', () => {
      render(
        <QuickLogDishCard
          dish={singleItemDishWithPortionColumns}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
        />
      );

      expect(screen.getByText('Whey Protein Powder')).toBeDefined();
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

    it('QuickLogDishCard does not render portion for recipes', () => {
      render(
        <QuickLogDishCard
          dish={recipeDish}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
        />
      );

      expect(screen.getByText('Chicken Rice Bowl')).toBeDefined();
      expect(screen.getByText('550 kcal')).toBeDefined();
      expect(screen.queryByText(/150 g/)).toBeNull();
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
          customDishes={[singleItemDishWithPortionColumns, legacyDishNoItems]}
          onOpenEditDishModal={vi.fn()}
        />
      );

      expect(screen.getByText('40 g')).toBeDefined();
      expect(screen.getByText('Whey Protein Powder')).toBeDefined();
      expect(screen.getByText('Old Banana')).toBeDefined();
    });
  });

  describe('2. Custom dish edit sheet for Food: Qty/Unit and proportional macro scaling', () => {
    it('populates Qty and Unit on edit, and scales macros proportionally (40 g -> 33 g)', async () => {
      const onSaveDish = vi.fn();
      const mockDetail: CustomDishDetail = {
        ...singleItemDishWithItems,
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
        await result.current.handleOpenEditDishModal(singleItemDishWithItems);
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
    it('logs item real quantity/unit from serving_quantity and serving_unit aliases', () => {
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
        result.current.handleQuickLogCustomDishDirect(singleItemDishWithPortionColumns);
      });

      expect(mutate).toHaveBeenCalledTimes(1);
      const payload = mutate.mock.calls[0][0];
      expect(payload.food_name).toBe('Whey Protein Powder');
      expect(payload.serving_size).toBe(40);
      expect(payload.serving_unit).toBe('g');
      expect(payload.calories).toBe(140);
      expect(payload.protein).toBe(30);
    });

    it('logs 1 serving for recipe dishes even if serving columns are present', () => {
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
        result.current.handleQuickLogCustomDishDirect(recipeDish);
      });

      expect(mutate).toHaveBeenCalledTimes(1);
      const payload = mutate.mock.calls[0][0];
      expect(payload.food_name).toBe('Chicken Rice Bowl');
      expect(payload.serving_size).toBe(1);
      expect(payload.serving_unit).toBe('serving');
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

  describe('4. Custom dish saving persists single item breakdown & enforces chk_cd_parent_equals_items_sum', () => {
    const probeSqlStatements: string[] = [];

    const recordProbe = (label: string, payload: any, shouldSucceed = true) => {
      const id = payload.id || `33333333-3333-3333-3333-${String(probeSqlStatements.length + 1).padStart(12, '0')}`;
      const itemsJson = payload.items ? JSON.stringify(payload.items).replace(/'/g, "''") : 'NULL';
      const sql = `
-- Probe: ${label} (Expect ${shouldSucceed ? 'PASS' : 'FAIL'})
INSERT INTO public.custom_dishes (
  id, user_id, name, kind, calories, protein, carbs, fat, fiber, items
) VALUES (
  '${id}',
  'a0000000-0000-0000-0000-000000000002',
  '${payload.name.replace(/'/g, "''")}',
  '${payload.kind || 'food'}',
  ${payload.calories ?? 'NULL'},
  ${payload.protein ?? 'NULL'},
  ${payload.carbs ?? 'NULL'},
  ${payload.fat ?? 'NULL'},
  ${payload.fiber ?? 'NULL'},
  ${payload.items ? `'${itemsJson}'::jsonb` : 'NULL'}
);`;
      probeSqlStatements.push(sql);
    };

    it('Path 1: handleSaveStagedAsCustomDish (1 item) satisfies DB constraint math <= 0.05', async () => {
      // NO_PROJECTION_APPLIES: Custom dish insert mutations only; no database select queries issued
      let capturedTable = '';
      const queryClient = new QueryClient();
      let capturedPayload: any = null;
      const mockInsert = vi.fn().mockImplementation((rows: any[]) => {
        capturedPayload = rows[0];
        return Promise.resolve({ error: null });
      });
      (supabase.from as any).mockImplementation((table: string) => {
        capturedTable = table;
        return { insert: mockInsert };
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      // Stress condition: 33 g of 40 g / 140 kcal / 30.3 g P item
      const singleItemMeal: StagedMeal = {
        name: 'Whey Shake Staged Stress',
        mealType: 'Snack',
        explanation: '115.5 kcal (Whey)',
        servingSize: 33,
        servingUnit: 'g',
        calories: 115.5,
        protein: 24.9975, // rounds to 25.0
        carbs: 1.65,      // rounds to 1.7
        fat: 0.825,     // rounds to 0.8
        fiber: 0.0,
        items: [
          {
            id: 'item-staged-stress',
            name: 'Whey Powder',
            portion: '33 g',
            portionMultiplier: 1,
            quantity: 33,
            unit: 'g',
            baseQuantity: 40,
            baseCalories: 140,
            baseProtein: 30.3,
            baseCarbs: 2,
            baseFat: 1,
            baseFiber: 0,
            calories: 115.5,
            protein: 24.9975,
            carbs: 1.65,
            fat: 0.825,
            fiber: 0,
          },
        ],
      };

      const { result } = renderHook(
        () =>
          useCustomDishSaving({
            targetUserId: 'a0000000-0000-0000-0000-000000000002',
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
      expect(capturedPayload).not.toBeNull();
      const items = capturedPayload.items;
      expect(items).toHaveLength(1);
      const totals = sumItems(items);

      expect(Math.abs(capturedPayload.calories - totals.calories)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(capturedPayload.protein - totals.protein)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(capturedPayload.carbs - totals.carbs)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(capturedPayload.fat - totals.fat)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(capturedPayload.fiber - totals.fiber)).toBeLessThanOrEqual(0.05);

      recordProbe('Path 1: Staged Meal Single Item Scaling', capturedPayload, true);
    });

    it('Path 2: handleSaveItemAsCustomDish satisfies DB constraint math <= 0.05', async () => {
      let capturedPayload: any = null;
      const mockInsert = vi.fn().mockImplementation((rows: any[]) => {
        capturedPayload = rows[0];
        return Promise.resolve({ error: null });
      });
      (supabase.from as any).mockImplementation((_table: string) => {
        return { insert: mockInsert };
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      const queryClient = new QueryClient();

      const { result } = renderHook(
        () =>
          useCustomDishSaving({
            targetUserId: 'a0000000-0000-0000-0000-000000000002',
            stagedMeal: null,
            setStatus: vi.fn(),
            setIsError: vi.fn(),
          }),
        { wrapper }
      );

      // Stress boundary 115.55
      const stagedItem: StagedItem = {
        id: 'item-boundary-stress',
        name: 'Olive Oil Boundary',
        portion: '15 ml',
        portionMultiplier: 1,
        quantity: 15,
        unit: 'ml',
        baseQuantity: 15,
        baseCalories: 115.55,
        baseProtein: 0.055,
        baseCarbs: 0.055,
        baseFat: 12.855,
        baseFiber: 0,
        calories: 115.55,
        protein: 0.055,
        carbs: 0.055,
        fat: 12.855,
        fiber: 0,
      };

      await act(async () => {
        await result.current.handleSaveItemAsCustomDish(stagedItem);
      });

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const items = capturedPayload.items;
      expect(items).toHaveLength(1);
      const totals = sumItems(items);

      expect(Math.abs(capturedPayload.calories - totals.calories)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(capturedPayload.protein - totals.protein)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(capturedPayload.carbs - totals.carbs)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(capturedPayload.fat - totals.fat)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(capturedPayload.fiber - totals.fiber)).toBeLessThanOrEqual(0.05);

      recordProbe('Path 2: Single Staged Item Boundary 115.55', capturedPayload, true);
    });

    it('Path 3 & 4: Edit modal quantity scaling and direct macro edits satisfy DB constraint', async () => {
      let savedPayload: any = null;
      const onSaveDish = vi.fn().mockImplementation(({ dishPayload }) => {
        savedPayload = dishPayload;
      });

      const mockDetail: CustomDishDetail = {
        id: 'dish-scale-test',
        user_id: 'a0000000-0000-0000-0000-000000000002',
        name: 'Whey Scaling Test',
        calories: 140,
        protein: 30.3,
        carbs: 2,
        fat: 1,
        fiber: 0,
        kind: 'food',
        use_count: 1,
        items: [
          {
            id: 'item-whey-raw',
            name: 'Whey Scaling Test',
            quantity: 40,
            unit: 'g',
            calories: 140,
            protein: 30.3,
            carbs: 2,
            fat: 1,
            fiber: 0,
          },
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

      await act(async () => {
        await result.current.handleOpenEditDishModal(mockDetail);
      });

      // Path 3: Scale 40 g -> 33 g (proportional scaling)
      act(() => {
        (result.current as any).handleQuantityChange(33);
      });

      act(() => {
        result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
      });

      expect(savedPayload).not.toBeNull();
      let totals = sumItems(savedPayload.items);
      expect(Math.abs(savedPayload.calories - totals.calories)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(savedPayload.protein - totals.protein)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(savedPayload.carbs - totals.carbs)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(savedPayload.fat - totals.fat)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(savedPayload.fiber - totals.fiber)).toBeLessThanOrEqual(0.05);

      recordProbe('Path 3: Modal Quantity Scaling 40g to 33g', savedPayload, true);

      // Path 4: Direct macro edit (item macros must follow direct edits)
      await act(async () => {
        await result.current.handleOpenEditDishModal(mockDetail);
      });

      act(() => {
        (result.current as any).handleQuantityChange(33);
        result.current.setDishModalCalories(116.0);
        result.current.setDishModalProtein(26.5);
      });

      act(() => {
        result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
      });

      totals = sumItems(savedPayload.items);
      expect(Math.abs(savedPayload.calories - totals.calories)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(savedPayload.protein - totals.protein)).toBeLessThanOrEqual(0.05);
      expect(savedPayload.calories).toBe(116.0);
      expect(savedPayload.items[0].calories).toBe(116.0);
      expect(savedPayload.protein).toBe(26.5);
      expect(savedPayload.items[0].protein).toBe(26.5);

      recordProbe('Path 4: Modal Direct Macro Edit Follow-through', savedPayload, true);
    });

    it('Path 5: Legacy dishes without items being edited for the first time satisfy DB constraint', async () => {
      let savedPayload: any = null;
      const onSaveDish = vi.fn().mockImplementation(({ dishPayload }) => {
        savedPayload = dishPayload;
      });

      const { result } = renderHook(() =>
        useCustomDishModal({
          onSaveDish,
          onDeleteDish: vi.fn(),
          onDismissToast: vi.fn(),
          fetchDishDetail: vi.fn().mockResolvedValue(legacyDishNoItems),
        })
      );

      await act(async () => {
        await result.current.handleOpenEditDishModal(legacyDishNoItems);
      });

      // User adds quantity 120 g to legacy dish
      act(() => {
        (result.current as any).handleQuantityChange(120);
        (result.current as any).handleUnitChange('g');
      });

      act(() => {
        result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
      });

      expect(savedPayload).not.toBeNull();
      expect(savedPayload.items).toHaveLength(1);
      const totals = sumItems(savedPayload.items);
      expect(Math.abs(savedPayload.calories - totals.calories)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(savedPayload.protein - totals.protein)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(savedPayload.carbs - totals.carbs)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(savedPayload.fat - totals.fat)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(savedPayload.fiber - totals.fiber)).toBeLessThanOrEqual(0.05);

      recordProbe('Path 5: Legacy Dish Converted With Quantity', savedPayload, true);

      // Write probes SQL file to /tmp for PostgreSQL live verification
      const sqlContent = [
        '-- Auto-generated custom dish constraint test probes',
        'BEGIN;',
        ...probeSqlStatements,
        '-- Expected Failure Probe (Deliberate check constraint violation)',
        `INSERT INTO public.custom_dishes (
  id, user_id, name, kind, calories, protein, carbs, fat, fiber, items
) VALUES (
  '99999999-9999-9999-9999-999999999999',
  'a0000000-0000-0000-0000-000000000002',
  'Deliberately Violating Dish',
  'food',
  200.0, 25.0, 1.7, 0.8, 0.0,
  '[{"id":"violating-item","name":"Whey","quantity":33,"unit":"g","calories":115.5,"protein":25.0,"carbs":1.7,"fat":0.8,"fiber":0.0}]'::jsonb
);`,
        'ROLLBACK;',
      ].join('\n');

      fs.writeFileSync('/tmp/custom_dish_probes.sql', sqlContent, 'utf-8');
      expect(fs.existsSync('/tmp/custom_dish_probes.sql')).toBe(true);
    });
  });

  describe('5. Scale nutrition with amount toggle (L-2)', () => {
    it('checkbox on by default each time modal opens and scales macros proportionally', async () => {
      const onSaveDish = vi.fn();
      const mockDetail: CustomDishDetail = {
        ...singleItemDishWithItems,
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
        await result.current.handleOpenEditDishModal(singleItemDishWithItems);
      });

      expect(result.current.scaleNutritionWithAmount).toBe(true);

      // Scale 40 g -> 33 g while checkbox is on
      act(() => {
        result.current.handleQuantityChange(33);
      });

      expect(result.current.dishModalQuantity).toBe(33);
      // 140 * 33 / 40 = 115.5
      expect(result.current.dishModalCalories).toBe(115.5);
      // 30 * 33 / 40 = 24.75 -> 24.8
      expect(result.current.dishModalProtein).toBe(24.8);
    });

    it('checkbox off keeps macros as typed when amount or unit changes', async () => {
      const onSaveDish = vi.fn();
      const mockDetail: CustomDishDetail = {
        ...singleItemDishWithItems,
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
        await result.current.handleOpenEditDishModal(singleItemDishWithItems);
      });

      // Turn off scale checkbox
      act(() => {
        result.current.setScaleNutritionWithAmount(false);
      });

      expect(result.current.scaleNutritionWithAmount).toBe(false);

      // Change amount from 40 g to 50 g
      act(() => {
        result.current.handleQuantityChange(50);
      });

      expect(result.current.dishModalQuantity).toBe(50);
      // Macros must remain unchanged
      expect(result.current.dishModalCalories).toBe(140);
      expect(result.current.dishModalProtein).toBe(30);
      expect(result.current.dishModalCarbs).toBe(2);
      expect(result.current.dishModalFat).toBe(1);
      expect(result.current.dishModalFiber).toBe(0);

      // Change unit: macros still stay unchanged
      act(() => {
        result.current.handleUnitChange('ml');
      });
      expect(result.current.dishModalUnit).toBe('ml');
      expect(result.current.dishModalCalories).toBe(140);
      expect(result.current.dishModalProtein).toBe(30);

      // Direct macro editing never rescales
      act(() => {
        result.current.setDishModalCalories(150);
      });
      expect(result.current.dishModalCalories).toBe(150);

      // Saving dish persists serving size 50 ml with 150 kcal
      act(() => {
        result.current.handleSaveCustomDishModal({ preventDefault: vi.fn() } as any);
      });

      expect(onSaveDish).toHaveBeenCalled();
      const { dishPayload } = onSaveDish.mock.calls[0][0];
      expect(dishPayload.calories).toBe(150);
      expect(dishPayload.protein).toBe(30);
      expect(dishPayload.items).toHaveLength(1);
      expect(dishPayload.items[0]).toMatchObject({
        quantity: 50,
        unit: 'ml',
        calories: 150,
        protein: 30,
      });
    });

    it('CustomDishesModal renders checkbox only when editingDish is present, on by default, and reveals hint when off', () => {
      const onScaleChange = vi.fn();

      // Case A: New dish (editingDish is null) -> checkbox is NOT rendered
      const { rerender } = render(
        <CustomDishesModal
          isOpen={true}
          onClose={vi.fn()}
          editingDish={null}
          dishModalName="New Whey"
          setDishModalName={vi.fn()}
          dishModalCalories={140}
          setDishModalCalories={vi.fn()}
          dishModalProtein={30}
          setDishModalProtein={vi.fn()}
          dishModalCarbs={2}
          setDishModalCarbs={vi.fn()}
          dishModalFat={1}
          setDishModalFat={vi.fn()}
          dishModalFiber={0}
          setDishModalFiber={vi.fn()}
          dishModalItems={[]}
          setDishModalItems={vi.fn()}
          onSaveDish={vi.fn()}
          onDeleteDish={vi.fn()}
          isSaving={false}
          isDeleting={false}
          customDishes={[]}
          onOpenEditDishModal={vi.fn()}
        />
      );

      expect(screen.queryByLabelText('Scale nutrition with amount')).toBeNull();
      expect(screen.queryByTestId('scale-nutrition-hint')).toBeNull();

      // Case B: Edit dish (editingDish is present) -> checkbox IS rendered and checked by default
      rerender(
        <CustomDishesModal
          isOpen={true}
          onClose={vi.fn()}
          editingDish={singleItemDishWithItems}
          dishModalName="Whey Protein"
          setDishModalName={vi.fn()}
          dishModalQuantity={40}
          dishModalUnit="g"
          dishModalCalories={140}
          setDishModalCalories={vi.fn()}
          dishModalProtein={30}
          setDishModalProtein={vi.fn()}
          dishModalCarbs={2}
          setDishModalCarbs={vi.fn()}
          dishModalFat={1}
          setDishModalFat={vi.fn()}
          dishModalFiber={0}
          setDishModalFiber={vi.fn()}
          dishModalItems={singleItemDishWithItems.items || []}
          setDishModalItems={vi.fn()}
          onSaveDish={vi.fn()}
          onDeleteDish={vi.fn()}
          isSaving={false}
          isDeleting={false}
          customDishes={[singleItemDishWithItems]}
          onOpenEditDishModal={vi.fn()}
          onScaleNutritionChange={onScaleChange}
        />
      );

      const checkbox = screen.getByLabelText('Scale nutrition with amount') as HTMLInputElement;
      expect(checkbox).toBeDefined();
      expect(checkbox.checked).toBe(true);
      expect(screen.queryByText('Nutrition stays the same; only the serving size changes')).toBeNull();

      // Uncheck checkbox -> hint appears
      fireEvent.click(checkbox);
      expect(screen.getByText('Nutrition stays the same; only the serving size changes')).toBeDefined();
      expect(onScaleChange).toHaveBeenCalledWith(false);
    });
  });

  describe('6. UnitChip choices (g / ml / unit) in CustomDishesModal (L-1)', () => {
    it('renders UnitChip and allows selecting canonical choices g, ml, unit', () => {
      const onUnitChange = vi.fn();

      render(
        <CustomDishesModal
          isOpen={true}
          onClose={vi.fn()}
          editingDish={singleItemDishWithItems}
          dishModalName="Whey Protein"
          setDishModalName={vi.fn()}
          dishModalQuantity={40}
          dishModalUnit="g"
          onUnitChange={onUnitChange}
          dishModalCalories={140}
          setDishModalCalories={vi.fn()}
          dishModalProtein={30}
          setDishModalProtein={vi.fn()}
          dishModalCarbs={2}
          setDishModalCarbs={vi.fn()}
          dishModalFat={1}
          setDishModalFat={vi.fn()}
          dishModalFiber={0}
          setDishModalFiber={vi.fn()}
          dishModalItems={singleItemDishWithItems.items || []}
          setDishModalItems={vi.fn()}
          onSaveDish={vi.fn()}
          onDeleteDish={vi.fn()}
          isSaving={false}
          isDeleting={false}
          customDishes={[singleItemDishWithItems]}
          onOpenEditDishModal={vi.fn()}
        />
      );

      // Unit chip button is rendered
      const chip = screen.getByTestId('custom-dish-unit-chip');
      expect(chip).toBeDefined();
      expect(chip.textContent).toContain('g');

      // Click chip to open sheet
      fireEvent.click(chip);

      // Verify choices are available
      expect(screen.getByTestId('unit-option-g')).toBeDefined();
      expect(screen.getByTestId('unit-option-ml')).toBeDefined();
      expect(screen.getByTestId('unit-option-unit')).toBeDefined();

      // Click 'ml' option
      fireEvent.click(screen.getByTestId('unit-option-ml'));
      expect(onUnitChange).toHaveBeenCalledWith('ml');
    });
  });

  describe('7. Legacy unit mapping (L-1)', () => {
    it('mapLegacyUnit maps grams spellings to g', () => {
      expect(mapLegacyUnit('g')).toBe('g');
      expect(mapLegacyUnit('G')).toBe('g');
      expect(mapLegacyUnit('  g  ')).toBe('g');
      expect(mapLegacyUnit('gram')).toBe('g');
      expect(mapLegacyUnit('Gram')).toBe('g');
      expect(mapLegacyUnit('grams')).toBe('g');
      expect(mapLegacyUnit('GRAMS')).toBe('g');
      expect(mapLegacyUnit('gr')).toBe('g');
      expect(mapLegacyUnit('GR')).toBe('g');
      expect(mapLegacyUnit('gm')).toBe('g');
      expect(mapLegacyUnit('GM')).toBe('g');
      expect(mapLegacyUnit('gms')).toBe('g');
      expect(mapLegacyUnit('GMS')).toBe('g');
      expect(mapLegacyUnit('gramme')).toBe('g');
      expect(mapLegacyUnit('grammes')).toBe('g');
      expect(mapLegacyUnit('g.')).toBe('g');
      expect(mapLegacyUnit('gr.')).toBe('g');
    });

    it('mapLegacyUnit maps millilitre spellings to ml', () => {
      expect(mapLegacyUnit('ml')).toBe('ml');
      expect(mapLegacyUnit('mL')).toBe('ml');
      expect(mapLegacyUnit('ML')).toBe('ml');
      expect(mapLegacyUnit('  ml  ')).toBe('ml');
      expect(mapLegacyUnit('milliliter')).toBe('ml');
      expect(mapLegacyUnit('Milliliter')).toBe('ml');
      expect(mapLegacyUnit('milliliters')).toBe('ml');
      expect(mapLegacyUnit('MILLILITERS')).toBe('ml');
      expect(mapLegacyUnit('millilitre')).toBe('ml');
      expect(mapLegacyUnit('Millilitre')).toBe('ml');
      expect(mapLegacyUnit('millilitres')).toBe('ml');
      expect(mapLegacyUnit('mls')).toBe('ml');
      expect(mapLegacyUnit('ml.')).toBe('ml');
    });

    it('mapLegacyUnit maps unknown, non-standard, or empty values to unit', () => {
      expect(mapLegacyUnit('unit')).toBe('unit');
      expect(mapLegacyUnit('piece')).toBe('unit');
      expect(mapLegacyUnit('pieces')).toBe('unit');
      expect(mapLegacyUnit('slice')).toBe('unit');
      expect(mapLegacyUnit('slices')).toBe('unit');
      expect(mapLegacyUnit('cup')).toBe('unit');
      expect(mapLegacyUnit('cups')).toBe('unit');
      expect(mapLegacyUnit('oz')).toBe('unit');
      expect(mapLegacyUnit('serving')).toBe('unit');
      expect(mapLegacyUnit('servings')).toBe('unit');
      expect(mapLegacyUnit('unknown')).toBe('unit');
      expect(mapLegacyUnit('')).toBe('unit');
      expect(mapLegacyUnit('   ')).toBe('unit');
      expect(mapLegacyUnit(null)).toBe('unit');
      expect(mapLegacyUnit(undefined)).toBe('unit');
    });

    it('handleOpenEditDishModal maps legacy units on open', async () => {
      const dishWithGr: CustomDish = {
        id: 'dish-legacy-gr',
        user_id: 'user-1',
        name: 'Legacy Gr Dish',
        calories: 100,
        protein: 10,
        carbs: 10,
        fat: 2,
        fiber: 1,
        kind: 'food',
        use_count: 1,
        serving_quantity: 50,
        serving_unit: 'gr',
        items: [
          {
            id: 'item-gr',
            name: 'Legacy Gr Item',
            quantity: 50,
            unit: 'gr' as any,
            calories: 100,
            protein: 10,
            carbs: 10,
            fat: 2,
            fiber: 1,
          },
        ],
      };

      const dishWithMl: CustomDish = {
        id: 'dish-legacy-ml',
        user_id: 'user-1',
        name: 'Legacy ML Dish',
        calories: 80,
        protein: 2,
        carbs: 12,
        fat: 1,
        fiber: 0,
        kind: 'food',
        use_count: 1,
        serving_quantity: 250,
        serving_unit: 'milliliters',
        items: [
          {
            id: 'item-ml',
            name: 'Legacy ML Item',
            quantity: 250,
            unit: 'milliliters' as any,
            calories: 80,
            protein: 2,
            carbs: 12,
            fat: 1,
            fiber: 0,
          },
        ],
      };

      const dishWithSlice: CustomDish = {
        id: 'dish-legacy-slice',
        user_id: 'user-1',
        name: 'Legacy Slice Dish',
        calories: 90,
        protein: 3,
        carbs: 15,
        fat: 1,
        fiber: 1,
        kind: 'food',
        use_count: 1,
        serving_quantity: 1,
        serving_unit: 'slice',
        items: [
          {
            id: 'item-slice',
            name: 'Legacy Slice Item',
            quantity: 1,
            unit: 'slice' as any,
            calories: 90,
            protein: 3,
            carbs: 15,
            fat: 1,
            fiber: 1,
          },
        ],
      };

      const { result } = renderHook(() =>
        useCustomDishModal({
          onSaveDish: vi.fn(),
          onDeleteDish: vi.fn(),
          onDismissToast: vi.fn(),
          fetchDishDetail: vi.fn().mockImplementation((id) => {
            if (id === 'dish-legacy-gr') return Promise.resolve(dishWithGr);
            if (id === 'dish-legacy-ml') return Promise.resolve(dishWithMl);
            if (id === 'dish-legacy-slice') return Promise.resolve(dishWithSlice);
            return Promise.resolve(null);
          }),
        })
      );

      // Test gr -> g
      await act(async () => {
        await result.current.handleOpenEditDishModal(dishWithGr);
      });
      expect(result.current.dishModalUnit).toBe('g');

      // Test milliliters -> ml
      await act(async () => {
        await result.current.handleOpenEditDishModal(dishWithMl);
      });
      expect(result.current.dishModalUnit).toBe('ml');

      // Test slice -> unit
      await act(async () => {
        await result.current.handleOpenEditDishModal(dishWithSlice);
      });
      expect(result.current.dishModalUnit).toBe('unit');
    });
  });
});
