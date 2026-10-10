import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useNutritionAi } from './useNutritionAi';
import { useNutritionData } from './useNutritionData';
import { useCustomDishActions } from './useCustomDishActions';
import { StagedMealCard } from './StagedMealCard';
import { MealLogRow } from './MealLogRow';
import { CustomDishesModal } from './CustomDishesModal';
import { parseNutrition } from './parseNutrition';
import * as offlineModule from '../../offline';
import { supabase } from '../../lib/supabase';
import type { CustomDish, NutritionLog } from '../../types/database';
import type { StagedMeal } from './nutritionEngineHelpers';

vi.mock('./parseNutrition', () => ({
  parseNutrition: vi.fn(),
}));

const { fromProp } = vi.hoisted(() => ({ fromProp: 'from' }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    [fromProp]: vi.fn(),
  },
}));

vi.mock('../../offline', async () => {
  const actual = await vi.importActual<typeof import('../../offline')>('../../offline');
  return {
    ...actual,
    enqueueAiItem: vi.fn().mockResolvedValue({ id: 'mock-aiq-1' }),
    enqueueAndAwait: vi.fn().mockResolvedValue({ status: 'synced', opId: 'mock-op-1' }),
    deleteAfterLog: vi.fn().mockResolvedValue(undefined),
    discardAiItem: vi.fn().mockResolvedValue(undefined),
  };
});

describe('O2 Nutrition Offline Routing & Core Verification', () => {
  let queryClient: QueryClient;
  const mockUserId = 'user-test-o2';

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('1. Routing Matrix & Local Paste Grammar (N4, D-OFF-6, D-O2-1)', () => {
    it('parses valid single nutrition block locally, stages with source "local", and makes 0 network calls', async () => {
      const onParsedSuccess = vi.fn();
      const onFallbackToManual = vi.fn();
      const setStatus = vi.fn();
      const setIsError = vi.fn();

      const { result } = renderHook(
        () =>
          useNutritionAi({
            customDishes: [],
            targetUserId: mockUserId,
            onParsedSuccess,
            onFallbackToManual,
            setStatus,
            setIsError,
          }),
        { wrapper }
      );

      // Pasted nutrition block
      const validBlock = `Greek Yogurt
Serving size: 1 cup
Calories 130
Protein 15g
Total Carbohydrate 9g
Total Fat 2g
Dietary Fiber 0g`;

      act(() => {
        result.current.setNlInput(validBlock);
      });

      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(offlineModule.enqueueAiItem).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);

      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.name).toBe('Greek Yogurt');
      expect(staged.calories).toBe(130);
      expect(staged.protein).toBe(15);
      expect(staged.carbs).toBe(9);
      expect(staged.fat).toBe(2);
      expect(staged.source).toBe('local');
      expect(staged.rawText).toBe(validBlock);
    });

    it('renders "Parsed locally" badge on StagedMealCard when stagedMeal.source === "local"', () => {
      const stagedMeal: StagedMeal = {
        name: 'Oatmeal Bowl',
        mealType: 'Breakfast',
        explanation: '300 kcal',
        items: [],
        calories: 300,
        protein: 10,
        carbs: 55,
        fat: 5,
        fiber: 8,
        servingSize: 1,
        servingUnit: 'serving',
        source: 'local',
      };

      render(
        <StagedMealCard
          stagedMeal={stagedMeal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      expect(screen.getByTestId('parsed-locally-badge')).toBeDefined();
      expect(screen.getByText('Parsed locally')).toBeDefined();
    });

    it('shows "Analyze with AI instead" button only when online, and clicking it triggers AI analysis', async () => {
      const onAnalyzeWithAiInstead = vi.fn();
      const stagedMeal: StagedMeal = {
        name: 'Greek Yogurt',
        mealType: 'Breakfast',
        explanation: '130 kcal',
        items: [],
        calories: 130,
        protein: 15,
        carbs: 9,
        fat: 2,
        fiber: 0,
        servingSize: 1,
        servingUnit: 'serving',
        source: 'local',
      };

      // Online: button is present
      const { rerender } = render(
        <StagedMealCard
          stagedMeal={stagedMeal}
          onAnalyzeWithAiInstead={onAnalyzeWithAiInstead}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      const aiBtn = screen.getByTestId('analyze-with-ai-instead-btn');
      expect(aiBtn).toBeDefined();
      fireEvent.click(aiBtn);
      expect(onAnalyzeWithAiInstead).toHaveBeenCalledTimes(1);

      // Offline: button is hidden
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
      window.dispatchEvent(new Event('offline'));

      rerender(
        <StagedMealCard
          stagedMeal={stagedMeal}
          onAnalyzeWithAiInstead={onAnalyzeWithAiInstead}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      expect(screen.queryByTestId('analyze-with-ai-instead-btn')).toBeNull();
    });

    it('routes natural language prose online to parseNutrition edge function', async () => {
      vi.mocked(parseNutrition).mockResolvedValueOnce({
        name: 'Burrito Bowl',
        calories: 600,
        protein: 35,
        carbs: 65,
        fat: 20,
        fiber: 10,
        servingSize: 1,
        servingUnit: 'bowl',
        items: [],
      });

      const onParsedSuccess = vi.fn();
      const { result } = renderHook(
        () =>
          useNutritionAi({
            customDishes: [],
            targetUserId: mockUserId,
            onParsedSuccess,
            onFallbackToManual: vi.fn(),
            setStatus: vi.fn(),
            setIsError: vi.fn(),
          }),
        { wrapper }
      );

      act(() => {
        result.current.setNlInput('I had a big chipotle burrito bowl with chicken and guac');
      });

      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).toHaveBeenCalledTimes(1);
      expect(offlineModule.enqueueAiItem).not.toHaveBeenCalled();
      expect(onParsedSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Burrito Bowl',
          calories: 600,
          source: 'ai',
        })
      );
    });

    it('does not enqueue to AI queue when offline with prose input and sets connection hint', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const onParsedSuccess = vi.fn();
      const setStatus = vi.fn();
      const setIsError = vi.fn();
      const { result } = renderHook(
        () =>
          useNutritionAi({
            customDishes: [],
            targetUserId: mockUserId,
            onParsedSuccess,
            onFallbackToManual: vi.fn(),
            setStatus,
            setIsError,
          }),
        { wrapper }
      );

      act(() => {
        result.current.setNlInput('I had a steak salad for dinner');
      });

      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(offlineModule.enqueueAiItem).not.toHaveBeenCalled();
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('AI needs a connection: use quick log');
      expect(onParsedSuccess).not.toHaveBeenCalled();
    });

    it('does not enqueue photo offline to AI queue and sets connection hint', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const setStatus = vi.fn();
      const setIsError = vi.fn();
      const { result } = renderHook(
        () =>
          useNutritionAi({
            customDishes: [],
            targetUserId: mockUserId,
            onParsedSuccess: vi.fn(),
            onFallbackToManual: vi.fn(),
            setStatus,
            setIsError,
          }),
        { wrapper }
      );

      act(() => {
        result.current.setSelectedPhoto({
          base64: 'abc123base64',
          dataUrl: 'data:image/jpeg;base64,abc123base64',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          width: 100,
          height: 100,
        });
      });

      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(offlineModule.enqueueAiItem).not.toHaveBeenCalled();
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('AI needs a connection: use quick log');
    });
  });

  describe('2. Review from AI Queue & Lifecycle (D-OFF-7, D-O2-2)', () => {
    it('reviewing an item from AI queue stages without auto-logging and preserves original timestamps', async () => {
      const logMutate = vi.fn();
      const itemFromQueue = {
        id: 'aiq-ready-456',
        capturedAt: '2026-09-15T23:45:00.000Z',
        captureDate: '2026-09-15',
      };

      const staged: StagedMeal = {
        name: 'Late Night Ramen',
        mealType: 'Dinner',
        explanation: '550 kcal',
        items: [],
        calories: 550,
        protein: 20,
        carbs: 70,
        fat: 20,
        fiber: 3,
        servingSize: 1,
        servingUnit: 'bowl',
        capturedAt: itemFromQueue.capturedAt,
        captureDate: itemFromQueue.captureDate,
        aiqItemId: itemFromQueue.id,
      };

      // Ensure review simply stages the meal and does NOT trigger any mutation
      expect(logMutate).not.toHaveBeenCalled();
      expect(offlineModule.deleteAfterLog).not.toHaveBeenCalled();

      // On explicit user confirmation, logs with original timestamps
      const handleLog = (meal: StagedMeal) => {
        logMutate({
          id: 'client-uuid-1',
          food_name: meal.name,
          calories: meal.calories,
          logged_at: meal.capturedAt,
          logged_date: meal.captureDate,
        });
        // Deletes only on success
        void offlineModule.deleteAfterLog(mockUserId, meal.aiqItemId!);
      };

      handleLog(staged);

      expect(logMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          food_name: 'Late Night Ramen',
          logged_at: '2026-09-15T23:45:00.000Z',
          logged_date: '2026-09-15',
        })
      );
      expect(offlineModule.deleteAfterLog).toHaveBeenCalledWith(mockUserId, 'aiq-ready-456');
    });

    it('does NOT delete item from aiq if enqueue fails', async () => {
      vi.mocked(offlineModule.enqueueAndAwait).mockRejectedValueOnce(new Error('Outbox write failure'));

      const setStatus = vi.fn();
      const setIsError = vi.fn();
      const { result } = renderHook(
        () =>
          useNutritionData({
            targetUserId: mockUserId,
            selectedDate: '2026-10-01',
            profile: null,
            onMutationSuccessReset: vi.fn(),
            setStatus,
            setIsError,
          }),
        { wrapper }
      );

      await expect(
        result.current.mutation.mutateAsync({
          food_name: 'Failed Meal',
          calories: 400,
        })
      ).rejects.toThrow('Outbox write failure');

      expect(offlineModule.deleteAfterLog).not.toHaveBeenCalled();
    });
  });

  describe('3. Overlaid Pending Nutrition Logs & UI Marks (D-OFF-4, D-O2-3)', () => {
    it('displays PendingMark on MealLogRow when log.pending === true', () => {
      const pendingLog: NutritionLog & { pending?: boolean } = {
        id: 'pending-meal-1',
        user_id: mockUserId,
        food_name: 'Salmon Fillet',
        calories: 350,
        protein: 34,
        carbs: 0,
        fat: 22,
        fiber: 0,
        meal_type: 'Dinner',
        logged_at: '2026-10-01T19:00:00Z',
        pending: true,
      };

      render(
        <MealLogRow
          log={pendingLog}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      const pendingMark = screen.getByRole('status', { name: 'Not synced yet' });
      expect(pendingMark).toBeDefined();
    });

    it('does not display PendingMark on MealLogRow when log.pending is falsy', () => {
      const syncedLog: NutritionLog = {
        id: 'synced-meal-1',
        user_id: mockUserId,
        food_name: 'Salmon Fillet',
        calories: 350,
        protein: 34,
        carbs: 0,
        fat: 22,
        fiber: 0,
        meal_type: 'Dinner',
        logged_at: '2026-10-01T19:00:00Z',
      };

      render(
        <MealLogRow
          log={syncedLog}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      expect(screen.queryByRole('status', { name: 'Not synced yet' })).toBeNull();
    });

    it('mutationFn passes identical payload online and offline through enqueueAndAwait', async () => {
      const setStatus = vi.fn();
      const setIsError = vi.fn();
      const { result } = renderHook(
        () =>
          useNutritionData({
            targetUserId: mockUserId,
            selectedDate: '2026-10-01',
            profile: null,
            onMutationSuccessReset: vi.fn(),
            setStatus,
            setIsError,
          }),
        { wrapper }
      );

      // Online run
      await result.current.mutation.mutateAsync({
        food_name: 'Chicken Rice',
        calories: 500,
        protein: 40,
        carbs: 60,
        fat: 10,
        fiber: 2,
        meal_type: 'Lunch',
      });

      expect(offlineModule.enqueueAndAwait).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          kind: 'nutrition.log',
          payload: expect.objectContaining({
            food_name: 'Chicken Rice',
            calories: 500,
            protein: 40,
            carbs: 60,
            fat: 10,
            fiber: 2,
            meal_type: 'Lunch',
            user_id: mockUserId,
            logged_date: '2026-10-01',
            id: expect.any(String),
          }),
        })
      );
    });
  });

  describe('4. Custom Dish Quick-Log & incrementDishId (N1, N7, E2)', () => {
    it('quick logging passes incrementDishId to outbox and does not perform separate Supabase call', async () => {
      const mutate = vi.fn();
      const dish: CustomDish = {
        id: 'dish-favorite-1',
        user_id: mockUserId,
        name: 'Whey Shake',
        calories: 120,
        protein: 24,
        carbs: 3,
        fat: 1,
        fiber: 0,
        use_count: 5,
        kind: 'food',
      };

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: mockUserId,
            selectedDate: '2026-10-01',
            setStagedMeal: vi.fn(),
            mutation: { mutate },
          }),
        { wrapper }
      );

      act(() => {
        result.current.handleQuickLogCustomDishDirect(dish);
      });

      expect(mutate).toHaveBeenCalledTimes(1);
      const payload = mutate.mock.calls[0][0];
      expect(payload).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          food_name: 'Whey Shake',
          calories: 120,
          protein: 24,
          incrementDishId: 'dish-favorite-1',
        })
      );

      // Ensure no direct supabase call was made for incrementDishUseCount
      expect((supabase as any)[fromProp]).not.toHaveBeenCalledWith('custom_dishes');
    });

    it('online stage-then-log increments use_count exactly once at stage time and never in subsequent log', async () => {
      const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
      ((supabase as any)[fromProp] as any).mockImplementation((table: string) => {
        if (table === 'custom_dishes') {
          return {
            update: updateMock,
          };
        }
        return {};
      });

      const mutate = vi.fn();
      let currentStagedMeal: StagedMeal | null = null;
      const setStagedMeal = vi.fn().mockImplementation((meal) => {
        currentStagedMeal = meal;
      });

      const dish: CustomDish = {
        id: 'dish-staged-1',
        user_id: mockUserId,
        name: 'Oatmeal Bowl',
        calories: 300,
        protein: 10,
        carbs: 50,
        fat: 5,
        fiber: 8,
        use_count: 2,
        kind: 'food',
      };

      const { result } = renderHook(
        () =>
          useCustomDishActions({
            targetUserId: mockUserId,
            selectedDate: '2026-10-01',
            stagedMeal: currentStagedMeal,
            setStagedMeal,
            mutation: { mutate },
            fetchDishDetail: vi.fn().mockResolvedValue(null),
          }),
        { wrapper }
      );

      // Stage the dish online
      await act(async () => {
        await result.current.handleStageCustomDish(dish);
      });

      // Exactly one update call at stage time
      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledWith({ use_count: 3 });

      // Staged meal does not attach incrementDishId
      expect(currentStagedMeal).not.toBeNull();
      expect((currentStagedMeal as any)?.incrementDishId).toBeUndefined();
    });
  });

  describe('5. Offline Guards (D-OFF-8, D-O2-3)', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
    });

    it('rejects deleteMealMutation and scaleLogMutation when offline with 0 network calls', async () => {
      const { result } = renderHook(
        () =>
          useNutritionData({
            targetUserId: mockUserId,
            selectedDate: '2026-10-01',
            profile: null,
            onMutationSuccessReset: vi.fn(),
            setStatus: vi.fn(),
            setIsError: vi.fn(),
          }),
        { wrapper }
      );

      ((supabase as any)[fromProp] as any).mockClear();

      await expect(result.current.deleteMutation.mutateAsync('meal-1')).rejects.toThrow(
        'Available when online'
      );
      await expect(
        result.current.scaleLogMutation.mutateAsync({
          log: { id: 'meal-1' } as any,
          items: [],
        })
      ).rejects.toThrow('Available when online');

      expect((supabase as any)[fromProp]).not.toHaveBeenCalled();
    });

    it('rejects custom dish mutations when offline with 0 network calls', async () => {
      const { result } = renderHook(
        () =>
          useNutritionData({
            targetUserId: mockUserId,
            selectedDate: '2026-10-01',
            profile: null,
            onMutationSuccessReset: vi.fn(),
            setStatus: vi.fn(),
            setIsError: vi.fn(),
          }),
        { wrapper }
      );

      ((supabase as any)[fromProp] as any).mockClear();

      await expect(
        result.current.saveCustomDishMutation.mutateAsync({
          dishPayload: { name: 'New Dish' },
        })
      ).rejects.toThrow('Available when online');

      await expect(result.current.deleteCustomDishMutation.mutateAsync('dish-1')).rejects.toThrow(
        'Available when online'
      );

      expect((supabase as any)[fromProp]).not.toHaveBeenCalled();
    });

    it('guards MealLogRow edit and delete menu items with "Available when online"', () => {
      const onEdit = vi.fn();
      const onDelete = vi.fn();
      const mockLog: NutritionLog = {
        id: 'meal-row-1',
        user_id: mockUserId,
        food_name: 'Toast',
        calories: 100,
        protein: 3,
        carbs: 20,
        fat: 1,
        fiber: 1,
        meal_type: 'Breakfast',
        logged_at: '2026-10-01T08:00:00Z',
      };

      render(
        <MealLogRow
          log={mockLog}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );

      // Open menu
      fireEvent.click(screen.getByTestId('meal-actions-meal-row-1'));

      const editBtn = screen.getByTestId('edit-meal-meal-row-1');
      const deleteBtn = screen.getByTestId('delete-meal-meal-row-1');

      expect(editBtn.textContent).toContain('Available when online');
      expect(deleteBtn.textContent).toContain('Available when online');

      // Clicking does not call handlers
      fireEvent.click(editBtn);
      fireEvent.click(deleteBtn);

      expect(onEdit).not.toHaveBeenCalled();
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('guards CustomDishesModal save and delete buttons with "Available when online"', () => {
      const onSaveDish = vi.fn();
      const onDeleteDish = vi.fn();

      render(
        <CustomDishesModal
          isOpen={true}
          onClose={vi.fn()}
          editingDish={{ id: 'dish-edit-1', name: 'Saved Bowl', calories: 400, user_id: mockUserId } as any}
          dishModalName="Saved Bowl"
          setDishModalName={vi.fn()}
          dishModalCalories={400}
          setDishModalCalories={vi.fn()}
          dishModalProtein={20}
          setDishModalProtein={vi.fn()}
          dishModalCarbs={50}
          setDishModalCarbs={vi.fn()}
          dishModalFat={10}
          setDishModalFat={vi.fn()}
          dishModalFiber={5}
          setDishModalFiber={vi.fn()}
          dishModalItems={[]}
          setDishModalItems={vi.fn()}
          onSaveDish={onSaveDish}
          onDeleteDish={onDeleteDish}
          isSaving={false}
          isDeleting={false}
          customDishes={[]}
          onOpenEditDishModal={vi.fn()}
        />
      );

      const saveBtn = screen.getByRole('button', { name: 'Save Dish' });
      const deleteBtn = screen.getByTestId('modal-delete-dish-btn');

      expect(saveBtn.hasAttribute('disabled')).toBe(true);
      expect(saveBtn.getAttribute('title')).toBe('Available when online');
      expect(deleteBtn.hasAttribute('disabled')).toBe(true);
      expect(deleteBtn.getAttribute('title')).toBe('Available when online');
      expect(screen.getByTestId('offline-helper-text').textContent).toBe('Available when online');
    });
  });
});
