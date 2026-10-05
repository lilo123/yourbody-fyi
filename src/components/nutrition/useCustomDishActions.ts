import { useCallback, useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { CustomDish, CustomDishDetail } from '../../types/database';
import { formatLocalTimestamp } from '../../utils/date';
import { formatCalories, roundTo1Decimal } from '../../utils/nutrition';
import { newId } from '../../offline';
import {
  itemsFromLegacyIngredients,
  normalizeItems,
} from '../../utils/itemModel';
import { fetchDishDetail as defaultFetchDishDetail } from './useNutritionData';
import {
  buildStagedItem,
  recomputeStagedTotals,
  mergeOrAppendStagedItems,
  type StagedItem,
  type StagedMeal,
} from './nutritionEngineHelpers';

export interface AddedFavoriteBanner {
  message: string;
  onUndo: () => void;
  dishName?: string;
  addedCalories?: number;
}

interface BannerState {
  forMeal: StagedMeal;
  preMeal: StagedMeal;
  message: string;
  dishName: string;
  addedCalories: number;
  onUndo: () => void;
}

export interface UseCustomDishActionsOptions {
  targetUserId: string;
  selectedDate: string;
  timeZone?: string;
  stagedMeal?: StagedMeal | null;
  setStagedMeal: (meal: StagedMeal | null) => void;
  setDishFetchError?: (error: { message: string; retry: () => void } | null) => void;
  fetchDishDetail?: (dishId: string) => Promise<CustomDishDetail | null>;
  mutation: { mutate: (payload: any, options?: any) => void; isPending?: boolean };
  triggerToast?: (dish: CustomDish | { name: string; calories: number | null }, options?: any) => void;
}

export function buildItemsFromDish(dish: CustomDish, detail: CustomDishDetail | null): StagedItem[] {
  const stored =
    normalizeItems(detail?.items) ?? itemsFromLegacyIngredients(dish.id, dish.name, detail?.ingredients);

  let items: StagedItem[] = (stored ?? []).map((it) =>
    buildStagedItem({
      name: it.name,
      portion: it.displayPortion,
      quantity: it.quantity,
      unit: it.unit,
      calories: it.calories,
      protein: it.protein,
      carbs: it.carbs,
      fat: it.fat,
      fiber: it.fiber,
    })
  );

  if (items.length === 0) {
    items = [
      buildStagedItem({
        name: dish.name,
        portion: '1 serving',
        calories: dish.calories,
        protein: dish.protein,
        carbs: dish.carbs,
        fat: dish.fat,
        fiber: dish.fiber,
      }),
    ];
  }
  return items;
}

export function useCustomDishActions({
  targetUserId,
  selectedDate,
  timeZone,
  stagedMeal,
  setStagedMeal,
  setDishFetchError,
  fetchDishDetail,
  mutation,
  triggerToast,
}: UseCustomDishActionsOptions) {
  const queryClient = useQueryClient();
  const [bannerState, setBannerState] = useState<BannerState | null>(null);
  const previousStagedMealRef = useRef<StagedMeal | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestStagedMealRef = useRef<StagedMeal | null>(stagedMeal ?? null);
  const mutationRef = useRef(mutation);

  useEffect(() => {
    mutationRef.current = mutation;
  });

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    latestStagedMealRef.current = stagedMeal ?? null;
    if (
      !stagedMeal ||
      (bannerState &&
        stagedMeal !== bannerState.forMeal &&
        stagedMeal !== bannerState.preMeal)
    ) {
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
      previousStagedMealRef.current = null;
    }
  }, [stagedMeal, bannerState]);

  const incrementDishUseCount = useCallback(
    async (dish: CustomDish) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      try {
        await supabase
          .from('custom_dishes')
          .update({ use_count: (dish.use_count ?? 0) + 1 })
          .eq('id', dish.id);
        queryClient.invalidateQueries({ queryKey: ['custom_dishes', targetUserId] });
      } catch (err: unknown) {
        console.warn('[useCustomDishActions] Failed to increment custom dish use count:', err);
      }
    },
    [queryClient, targetUserId]
  );

  const handleStageCustomDish = useCallback(
    async function stageDish(dish: CustomDish) {
      if (mutationRef.current?.isPending) return;
      setDishFetchError?.(null);
      let detail: CustomDishDetail | null = null;
      const fetcher = fetchDishDetail || defaultFetchDishDetail;
      try {
        detail = await fetcher(dish.id);
      } catch (err: any) {
        // Offline with no cached full rows (deferred prefetch not done yet): stage from the dish summary
        // (buildItemsFromDish falls back to one item with the dish macros). Online errors still surface.
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          detail = null;
        } else {
          if (mutationRef.current?.isPending) return;
          const msg = err?.message || 'Failed to load dish details';
          setDishFetchError?.({
            message: msg,
            retry: () => {
              void stageDish(dish);
            },
          });
          return;
        }
      }

      if (mutationRef.current?.isPending) return;

      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
      setBannerState(null);
      previousStagedMealRef.current = null;

      const items = buildItemsFromDish(dish, detail);
      const { explanation, ...tot } = recomputeStagedTotals(items);

      setStagedMeal({
        name: dish.name,
        mealType: 'Breakfast',
        explanation:
          items.length > 1 ? explanation : `${formatCalories(tot.calories)} kcal (${dish.name})`,
        items,
        ...tot,
        servingSize: 1,
        servingUnit: 'serving',
        notes: dish.notes ?? null,
      });

      incrementDishUseCount(dish);
    },
    [fetchDishDetail, incrementDishUseCount, setDishFetchError, setStagedMeal]
  );

  const handleAddCustomDishToStaged = useCallback(
    async function addDishToStaged(dish: CustomDish) {
      if (mutationRef.current?.isPending) return;
      if (!latestStagedMealRef.current) return;
      setDishFetchError?.(null);
      let detail: CustomDishDetail | null = null;
      const fetcher = fetchDishDetail || defaultFetchDishDetail;
      try {
        detail = await fetcher(dish.id);
      } catch (err: any) {
        // Offline with no cached full rows (deferred prefetch not done yet): stage from the dish summary
        // (buildItemsFromDish falls back to one item with the dish macros). Online errors still surface.
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          detail = null;
        } else {
          if (mutationRef.current?.isPending || !latestStagedMealRef.current) return;
          const msg = err?.message || 'Failed to load dish details';
          setDishFetchError?.({
            message: msg,
            retry: () => {
              void addDishToStaged(dish);
            },
          });
          return;
        }
      }

      if (mutationRef.current?.isPending) return;
      const currentStagedMeal = latestStagedMealRef.current;
      if (!currentStagedMeal) {
        return;
      }

      const incomingItems = buildItemsFromDish(dish, detail);
      const snapshot = currentStagedMeal;
      previousStagedMealRef.current = snapshot;

      const mergedItems = mergeOrAppendStagedItems(currentStagedMeal.items, incomingItems);
      const { explanation, ...tot } = recomputeStagedTotals(mergedItems);

      const nextStagedMeal: StagedMeal = {
        ...currentStagedMeal,
        items: mergedItems,
        ...tot,
        explanation:
          mergedItems.length > 1 ? explanation : `${formatCalories(tot.calories)} kcal (${currentStagedMeal.name})`,
        ...(mergedItems.length === 1
          ? {
              servingSize: mergedItems[0].quantity,
              servingUnit: mergedItems[0].unit,
            }
          : {}),
      };

      latestStagedMealRef.current = nextStagedMeal;
      setStagedMeal(nextStagedMeal);

      incrementDishUseCount(dish);

      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }

      const onUndo = () => {
        if (bannerTimerRef.current) {
          clearTimeout(bannerTimerRef.current);
          bannerTimerRef.current = null;
        }
        if (
          previousStagedMealRef.current &&
          (latestStagedMealRef.current === nextStagedMeal ||
            latestStagedMealRef.current === snapshot)
        ) {
          latestStagedMealRef.current = previousStagedMealRef.current;
          setStagedMeal(previousStagedMealRef.current);
          previousStagedMealRef.current = null;
        }
        setBannerState(null);
      };

      const dishCalories = roundTo1Decimal(dish.calories ?? 0);
      setBannerState({
        forMeal: nextStagedMeal,
        preMeal: snapshot,
        message: `Added ${dish.name} to staged meal`,
        dishName: dish.name,
        addedCalories: dishCalories,
        onUndo,
      });

      triggerToast?.(dish, {
        variant: 'added',
        dishName: dish.name,
        calories: dishCalories,
        onUndo,
        forMeal: nextStagedMeal,
        preMeal: snapshot,
      });

      bannerTimerRef.current = setTimeout(() => {
        setBannerState(null);
        bannerTimerRef.current = null;
      }, 5000);
    },
    [fetchDishDetail, incrementDishUseCount, setDishFetchError, setStagedMeal, triggerToast]
  );

  const handleQuickLogCustomDishDirect = useCallback(
    (dish: CustomDish, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (mutationRef.current?.isPending) return;
      setBannerState(null);
      previousStagedMealRef.current = null;
      const clientLogId = newId();
      const payload = {
        id: clientLogId,
        food_name: dish.name,
        calories: roundTo1Decimal(dish.calories),
        protein: roundTo1Decimal(dish.protein),
        carbs: roundTo1Decimal(dish.carbs),
        fat: roundTo1Decimal(dish.fat),
        fiber: roundTo1Decimal(dish.fiber),
        meal_type: 'Breakfast',
        serving_size: 1,
        serving_unit: 'serving',
        logged_at: formatLocalTimestamp(selectedDate, undefined, timeZone),
        logged_date: selectedDate,
        notes: dish.notes ?? null,
        incrementDishId: dish.id,
      };
      mutation.mutate(payload, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['custom_dishes', targetUserId] });
        },
      });
      triggerToast?.(dish);
    },
    [mutation, queryClient, selectedDate, targetUserId, timeZone, triggerToast]
  );

  const isBannerActive =
    bannerState !== null &&
    stagedMeal !== null &&
    stagedMeal !== undefined &&
    (stagedMeal === bannerState.forMeal || stagedMeal === bannerState.preMeal);

  return {
    handleStageCustomDish,
    handleQuickLogCustomDishDirect,
    handleAddCustomDishToStaged,
    addedFavoriteBanner: isBannerActive
      ? {
          message: bannerState.message,
          dishName: bannerState.dishName,
          addedCalories: bannerState.addedCalories,
          onUndo: bannerState.onUndo,
        }
      : null,
  };
}
