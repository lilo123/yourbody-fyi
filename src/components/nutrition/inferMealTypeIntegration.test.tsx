import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { useNutritionAi } from './useNutritionAi';
import { StagedMealCard, type StagedMealCardProps } from './StagedMealCard';
import { useManualMealForm } from './useManualMealForm';
import { useStagedMealDraft } from './useStagedMealDraft';
import {
  saveStagedMealDraft,
  loadStagedMealDraft,
  clearAllStagedMealDrafts,
} from './stagedMealDraft';
import {
  buildStagedItem,
  type StagedMeal,
} from './nutritionEngineHelpers';
import { parseNutrition } from './parseNutrition';

vi.mock('./parseNutrition', () => ({
  parseNutrition: vi.fn(),
  formatQuotaExceededMessage: vi.fn().mockReturnValue('Quota exceeded'),
}));

vi.mock('../../offline', () => ({
  enqueueAiItem: vi.fn(),
  enqueueAndAwait: vi.fn(),
  deleteAfterLog: vi.fn(),
  discardAiItem: vi.fn(),
}));

describe('Meal type inference integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAllStagedMealDrafts();
  });

  describe('device paste staging', () => {
    it('device single-item paste with "Dinner" header stages with Dinner', async () => {
      // 08:00 morning local time - time-of-day would be Breakfast, but "Dinner" header must win
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 15, 8, 0));

      const onParsedSuccess = vi.fn();
      const { result } = renderHook(() =>
        useNutritionAi({
          customDishes: [],
          setStatus: vi.fn(),
          setIsError: vi.fn(),
          onParsedSuccess,
          onFallbackToManual: vi.fn(),
        })
      );

      const pasteText = [
        'Dinner',
        'Calories: 450',
        'Protein: 30g',
        'Carbs: 45g',
        'Fat: 15g',
      ].join('\n');

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: pasteText });
      });

      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged = onParsedSuccess.mock.calls[0][0] as StagedMeal;
      expect(staged.name).toBe('Dinner');
      expect(staged.mealType).toBe('Dinner');
      expect(staged.source).toBe('local');
    });

    it('device multi-item paste with "Dinner" header stages with Dinner', async () => {
      // 08:00 morning local time
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 15, 8, 0));

      const onParsedSuccess = vi.fn();
      const { result } = renderHook(() =>
        useNutritionAi({
          customDishes: [],
          setStatus: vi.fn(),
          setIsError: vi.fn(),
          onParsedSuccess,
          onFallbackToManual: vi.fn(),
        })
      );

      const pasteText = [
        'Meal: Dinner',
        'Component Breakdown:',
        '* Grilled Chicken: 100g | 165 kcal | 31g protein | 0g carbs | 3.6g fat',
        '* Brown Rice: 100g | 135 kcal | 3g protein | 28g carbs | 1g fat',
      ].join('\n');

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: pasteText });
      });

      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged = onParsedSuccess.mock.calls[0][0] as StagedMeal;
      expect(staged.name).toBe('Dinner');
      expect(staged.mealType).toBe('Dinner');
      expect(staged.items.length).toBe(2);
      expect(staged.source).toBe('local');
    });

    it('device paste without a meal word falls back to time of day', async () => {
      vi.useFakeTimers();

      const testTimes = [
        { hour: 8, minute: 0, expected: 'Breakfast' },
        { hour: 12, minute: 30, expected: 'Lunch' },
        { hour: 19, minute: 0, expected: 'Dinner' },
        { hour: 23, minute: 30, expected: 'Snack' },
      ];

      for (const { hour, minute, expected } of testTimes) {
        vi.setSystemTime(new Date(2026, 9, 15, hour, minute));
        const onParsedSuccess = vi.fn();
        const { result } = renderHook(() =>
          useNutritionAi({
            customDishes: [],
            setStatus: vi.fn(),
            setIsError: vi.fn(),
            onParsedSuccess,
            onFallbackToManual: vi.fn(),
          })
        );

        const pasteText = [
          'Post-Workout Fuel',
          'Calories: 450',
          'Protein: 30g',
          'Carbs: 45g',
          'Fat: 15g',
        ].join('\n');

        await act(async () => {
          await result.current.handleAnalyze({ overrideText: pasteText });
        });

        expect(onParsedSuccess).toHaveBeenCalledTimes(1);
        const staged = onParsedSuccess.mock.calls[0][0] as StagedMeal;
        expect(staged.mealType).toBe(expected);
      }
    });
  });

  describe('staged meal card select interaction', () => {
    it('the meal type select can still be changed by the user', () => {
      const stagedMeal: StagedMeal = {
        name: 'Dinner',
        mealType: 'Dinner',
        explanation: '450 kcal',
        items: [
          buildStagedItem({
            name: 'Salmon',
            portion: '1 serving',
            calories: 450,
            protein: 40,
            carbs: 0,
            fat: 30,
            fiber: 0,
          }),
        ],
        calories: 450,
        protein: 40,
        carbs: 0,
        fat: 30,
        fiber: 0,
        servingSize: 1,
        servingUnit: 'serving',
        source: 'local',
      };

      const onUpdateStagedMeal = vi.fn();
      const defaultProps: StagedMealCardProps = {
        stagedMeal,
        onUpdateStagedMeal,
        onApplyStagedItemChange: vi.fn(),
        onDeleteItem: vi.fn(),
        onSaveItemAsCustomDish: vi.fn(),
        onLogStagedMeal: vi.fn(),
        onSaveStagedAsCustomDish: vi.fn(),
        onDiscardStagedMeal: vi.fn(),
        isPending: false,
      };

      render(<StagedMealCard {...defaultProps} />);

      const select = screen.getByRole('combobox', { name: /Meal type/i }) as HTMLSelectElement;
      expect(select.value).toBe('Dinner');

      // Change from Dinner to Snack
      fireEvent.change(select, { target: { value: 'Snack' } });
      expect(onUpdateStagedMeal).toHaveBeenCalledWith(
        expect.objectContaining({ mealType: 'Snack' })
      );
    });
  });

  describe('restored draft invariant', () => {
    it('a restored draft keeps its saved meal type (e.g. saved Lunch restored at 19:00 stays Lunch)', () => {
      const testUserId = 'user-saved-lunch-123';
      const testDateStr = '2026-10-15';

      const savedLunchDraft: StagedMeal = {
        name: 'Tuna Salad',
        mealType: 'Lunch',
        explanation: '350 kcal',
        items: [
          buildStagedItem({
            name: 'Tuna Salad',
            portion: '1 serving',
            calories: 350,
            protein: 30,
            carbs: 10,
            fat: 20,
            fiber: 2,
          }),
        ],
        calories: 350,
        protein: 30,
        carbs: 10,
        fat: 20,
        fiber: 2,
        servingSize: 1,
        servingUnit: 'serving',
        source: 'local',
      };

      saveStagedMealDraft(testUserId, testDateStr, savedLunchDraft);

      // Now it is 19:00 local time (Dinner time)
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 15, 19, 0));

      // 1. Direct draft loader check
      const restored = loadStagedMealDraft(testUserId, testDateStr);
      expect(restored).not.toBeNull();
      expect(restored?.mealType).toBe('Lunch');

      // 2. Hook level check
      const { result } = renderHook(() => useStagedMealDraft(testUserId));
      expect(result.current.stagedMeal).not.toBeNull();
      expect(result.current.stagedMeal?.mealType).toBe('Lunch');
    });
  });

  describe('AI parse meal type preservation and inference', () => {
    it('preserves valid meal type returned by AI response', async () => {
      // 19:00 local time (Dinner time)
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 15, 19, 0));

      const mockAiResult = {
        name: 'Mid-Day Protein Shake',
        mealType: 'Snack',
        explanation: '200 kcal',
        items: [
          buildStagedItem({
            name: 'Protein Shake',
            portion: '1 scoop',
            calories: 200,
            protein: 30,
            carbs: 5,
            fat: 2,
            fiber: 1,
          }),
        ],
        calories: 200,
        protein: 30,
        carbs: 5,
        fat: 2,
        fiber: 1,
        servingSize: 1,
        servingUnit: 'serving',
        source: 'ai' as const,
        confidence: 'exact' as const,
      };

      vi.mocked(parseNutrition).mockResolvedValueOnce(mockAiResult as any);

      const onParsedSuccess = vi.fn();
      const { result } = renderHook(() =>
        useNutritionAi({
          customDishes: [],
          setStatus: vi.fn(),
          setIsError: vi.fn(),
          onParsedSuccess,
          onFallbackToManual: vi.fn(),
        })
      );

      await act(async () => {
        await result.current.handleAnalyze({
          overrideText: 'protein shake',
          forceAi: true,
        });
      });

      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged = onParsedSuccess.mock.calls[0][0] as StagedMeal;
      // Must keep the AI response's valid meal type 'Snack', not overwrite with time-of-day 'Dinner'
      expect(staged.mealType).toBe('Snack');
    });

    it('infers meal type from name on AI parse if AI mealType is missing', async () => {
      // 08:00 morning local time
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 15, 8, 0));

      const mockAiResult = {
        name: 'Dinner',
        explanation: '600 kcal',
        items: [
          buildStagedItem({
            name: 'Steak',
            portion: '200g',
            calories: 600,
            protein: 50,
            carbs: 0,
            fat: 40,
            fiber: 0,
          }),
        ],
        calories: 600,
        protein: 50,
        carbs: 0,
        fat: 40,
        fiber: 0,
        servingSize: 1,
        servingUnit: 'serving',
        source: 'ai' as const,
        confidence: 'exact' as const,
      };

      vi.mocked(parseNutrition).mockResolvedValueOnce(mockAiResult as any);

      const onParsedSuccess = vi.fn();
      const { result } = renderHook(() =>
        useNutritionAi({
          customDishes: [],
          setStatus: vi.fn(),
          setIsError: vi.fn(),
          onParsedSuccess,
          onFallbackToManual: vi.fn(),
        })
      );

      await act(async () => {
        await result.current.handleAnalyze({
          overrideText: 'steak dinner',
          forceAi: true,
        });
      });

      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged = onParsedSuccess.mock.calls[0][0] as StagedMeal;
      expect(staged.name).toBe('Dinner');
      expect(staged.mealType).toBe('Dinner');
    });
  });

  describe('manual meal form time-of-day defaulting', () => {
    it('defaults manual meal type by time of day', () => {
      vi.useFakeTimers();

      // At 19:00 -> Dinner
      vi.setSystemTime(new Date(2026, 9, 15, 19, 0));
      const { result: dinnerForm } = renderHook(() =>
        useManualMealForm({ onStageMeal: vi.fn() })
      );
      expect(dinnerForm.current.manualMealType).toBe('Dinner');

      // At 08:00 -> Breakfast
      vi.setSystemTime(new Date(2026, 9, 15, 8, 0));
      const { result: breakfastForm } = renderHook(() =>
        useManualMealForm({ onStageMeal: vi.fn() })
      );
      expect(breakfastForm.current.manualMealType).toBe('Breakfast');

      // At 13:00 -> Lunch
      vi.setSystemTime(new Date(2026, 9, 15, 13, 0));
      const { result: lunchForm } = renderHook(() =>
        useManualMealForm({ onStageMeal: vi.fn() })
      );
      expect(lunchForm.current.manualMealType).toBe('Lunch');

      // At 23:00 -> Snack
      vi.setSystemTime(new Date(2026, 9, 15, 23, 0));
      const { result: snackForm } = renderHook(() =>
        useManualMealForm({ onStageMeal: vi.fn() })
      );
      expect(snackForm.current.manualMealType).toBe('Snack');
    });
  });
});
