import { useCallback, useEffect } from 'react';
import { useAiQueueSafe } from './useAiQueueSafe';
import { buildStagedItem, type StagedMeal } from './nutritionEngineHelpers';
import { formatCalories } from '../../utils/nutrition';
import { markFormDirty } from '../../pwa/updateSafety';
import type { AiQueueItem } from '../../offline';
import type { UseManualMealFormReturn } from './useManualMealForm';

interface UseAiQueueReviewOptions {
  targetUserId: string;
  stagedMeal: StagedMeal | null;
  setStagedMeal: (meal: StagedMeal | null) => void;
  showManualForm: boolean;
  manualMealForm: UseManualMealFormReturn;
}

export function useAiQueueReview({
  targetUserId,
  stagedMeal,
  setStagedMeal,
  showManualForm,
  manualMealForm,
}: UseAiQueueReviewOptions) {
  const { items: aiQueueItems, counts: aiQueueCounts } = useAiQueueSafe(targetUserId);

  const handleReviewAiItem = useCallback((item: AiQueueItem) => {
    if (!item.result) return;
    const res = item.result as any;
    const parsedItems = (res.items || []).map((it: any) =>
      buildStagedItem({
        name: it.name,
        portion: it.portion || it.displayPortion || `${it.quantity || 1} ${it.unit || 'serving'}`,
        quantity: it.quantity || 1,
        unit: it.unit || 'serving',
        calories: it.calories,
        protein: it.protein,
        carbs: it.carbs,
        fat: it.fat,
        fiber: it.fiber,
      })
    );

    const meal: StagedMeal = {
      name: res.name || item.text || 'Meal',
      mealType: (item.mealType as any) || 'Breakfast',
      explanation: res.explanation || `${formatCalories(res.calories)} kcal (${res.name || 'Meal'})`,
      items: parsedItems.length > 0 ? parsedItems : [
        buildStagedItem({
          name: res.name || item.text || 'Meal',
          portion: '1 serving',
          quantity: res.servingSize || 1,
          unit: res.servingUnit || 'serving',
          calories: res.calories || 0,
          protein: res.protein || 0,
          carbs: res.carbs || 0,
          fat: res.fat || 0,
          fiber: res.fiber || 0,
        })
      ],
      calories: res.calories || 0,
      protein: res.protein || 0,
      carbs: res.carbs || 0,
      fat: res.fat || 0,
      fiber: res.fiber || 0,
      servingSize: res.servingSize || 1,
      servingUnit: res.servingUnit || 'serving',
      source: 'ai',
      capturedAt: item.capturedAt,
      captureDate: item.captureDate,
      aiqItemId: item.id,
    };
    setStagedMeal(meal);
  }, [setStagedMeal]);

  useEffect(() => {
    markFormDirty('staged-meal', Boolean(stagedMeal));
    return () => {
      markFormDirty('staged-meal', false);
    };
  }, [stagedMeal]);

  useEffect(() => {
    const isManualDirty = Boolean(
      showManualForm &&
        (manualMealForm.manualDishName.trim() ||
          manualMealForm.manualCalories ||
          manualMealForm.manualProtein ||
          manualMealForm.manualCarbs ||
          manualMealForm.manualFat)
    );
    markFormDirty('manual-meal-form', isManualDirty);
    return () => {
      markFormDirty('manual-meal-form', false);
    };
  }, [
    showManualForm,
    manualMealForm.manualDishName,
    manualMealForm.manualCalories,
    manualMealForm.manualProtein,
    manualMealForm.manualCarbs,
    manualMealForm.manualFat,
  ]);

  return {
    aiQueueItems,
    aiQueueCounts,
    handleReviewAiItem,
  };
}
