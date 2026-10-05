import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { NutritionLog } from '../../types/database';
import { useDeferredDelete } from '../common/useDeferredDelete';
import { deleteCachedLogItems } from '../nutrition/useNutritionData';
import { formatCalories } from '../../utils/nutrition';
import { useToast } from '../../hooks/useToast';
import type { UndoToastItem } from '../common/UndoToast';

export interface UseHistoryMealDeferredDeleteOptions {
  targetUserId?: string;
  setMutationError: (msg: string | null) => void;
  isActive?: boolean;
  meals?: NutritionLog[];
}

export function useHistoryMealDeferredDelete({
  targetUserId,
  setMutationError,
  isActive = true,
  meals,
}: UseHistoryMealDeferredDeleteOptions) {
  const queryClient = useQueryClient();

  const { show: showToast } = useToast();
  const { pending, schedule, undo, flush } = useDeferredDelete<NutritionLog>({
    durationMs: 6000,
    commit: async (item: NutritionLog) => {
      if (!item?.id) return;
      const { error } = await supabase.from('nutrition_logs').delete().eq('id', item.id);
      if (error) {
        throw error;
      }
      deleteCachedLogItems(item.id);
      await queryClient.invalidateQueries({ queryKey: ['nutrition_logs', targetUserId] });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message || 'Failed to delete meal log.';
      setMutationError(msg);
    },
  });

  // Keep-alive: HistoryView remains mounted in <Activity> on tab switch.
  // When route leaves /history (isActive turns false), flush pending delete immediately.
  const prevActiveRef = useRef(isActive);
  useEffect(() => {
    if (prevActiveRef.current && !isActive) {
      flush();
    }
    prevActiveRef.current = isActive;
  }, [isActive, flush]);

  const handleDeleteMealRequested = useCallback(
    (mealOrId: NutritionLog | string) => {
      const resolvedMeal: NutritionLog = typeof mealOrId === 'string'
        ? (meals?.find((m) => m.id === mealOrId) || ({
            id: mealOrId,
            food_name: 'Meal',
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            fiber: 0,
            logged_at: new Date().toISOString(),
          } as NutritionLog))
        : mealOrId;

      const label = resolvedMeal.food_name || 'Meal';
      schedule(resolvedMeal, label);
      const kcalStr = formatCalories(resolvedMeal.calories);
      showToast({
        kind: 'undo',
        verb: 'Meal deleted',
        subject: label,
        detail: `${kcalStr} kcal`,
        durationMs: 6000,
        onUndo: undo,
        onCommit: flush,
        undoAriaLabel: `Undo delete ${label}`,
        testId: 'quick-log-toast',
      });
    },
    [schedule, meals, showToast, undo, flush]
  );

  const toastItem: UndoToastItem | null = useMemo(() => {
    if (!pending) return null;
    const meal = pending.item;
    const foodName = meal.food_name || 'Meal';
    const kcalStr = formatCalories(meal.calories);
    return {
      verb: 'Meal deleted',
      subject: foodName,
      detail: `${kcalStr} kcal`,
      onUndo: undo,
      undoAriaLabel: `Undo delete ${foodName}`,
    };
  }, [pending, undo]);

  return {
    pendingDelete: pending,
    pendingDeleteMealId: pending?.item.id ?? null,
    handleDeleteMealRequested,
    request: handleDeleteMealRequested,
    flushDelete: flush,
    undoDelete: undo,
    toastItem,
    isMealPendingDelete: useCallback(
      (id: string) => pending?.item.id === id,
      [pending]
    ),
  };
}
