import { useRef, useEffect, useCallback } from 'react';
import { roundTo1Decimal } from '../../utils/nutrition';
import {
  mergeOrAppendStagedItems,
  recomputeStagedTotals,
  type StagedItem,
  type StagedMeal,
} from './nutritionEngineHelpers';

export interface UseStagedMealAddAiOptions {
  stagedMeal: StagedMeal | null;
  setStagedMeal: (m: StagedMeal | null) => void;
  triggerToast?: (dish: { name: string; calories: number | null }, options?: any) => void;
}

export function useStagedMealAddAi({
  stagedMeal,
  setStagedMeal,
  triggerToast,
}: UseStagedMealAddAiOptions) {
  const latestStagedMealRef = useRef<StagedMeal | null>(stagedMeal);

  useEffect(() => {
    latestStagedMealRef.current = stagedMeal;
  }, [stagedMeal]);

  const handleAddParsedItems = useCallback(
    (items: StagedItem[], mealAtStart?: StagedMeal) => {
      const currentStaged = latestStagedMealRef.current;
      if (!currentStaged) {
        // Discarded or logged while parsing -> drop silently
        return;
      }
      if (mealAtStart && currentStaged !== mealAtStart) {
        // Staged meal was replaced -> drop silently
        return;
      }

      const mergedItems = mergeOrAppendStagedItems(currentStaged.items, items);
      const tot = recomputeStagedTotals(mergedItems);
      const nextStagedMeal: StagedMeal = {
        ...currentStaged,
        items: mergedItems,
        ...tot,
        explanation: currentStaged.explanation,
      };

      latestStagedMealRef.current = nextStagedMeal;
      setStagedMeal(nextStagedMeal);

      const dishName = items.length === 1 ? items[0].name : `${items.length} items`;
      const addedCalories = roundTo1Decimal(items.reduce((s, it) => s + it.calories, 0));

      const onUndo = () => {
        if (
          latestStagedMealRef.current === nextStagedMeal ||
          latestStagedMealRef.current === currentStaged
        ) {
          latestStagedMealRef.current = currentStaged;
          setStagedMeal(currentStaged);
        }
      };

      triggerToast?.(
        { name: dishName, calories: addedCalories },
        {
          variant: 'added',
          dishName,
          calories: addedCalories,
          onUndo,
          forMeal: nextStagedMeal,
          preMeal: currentStaged,
        }
      );
    },
    [setStagedMeal, triggerToast]
  );

  return {
    latestStagedMealRef,
    handleAddParsedItems,
  };
}
