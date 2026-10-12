import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { roundTo1Decimal } from '../../utils/nutrition';
import { itemsForPersist, sumItems, type NutritionItem } from '../../utils/itemModel';
import { stagedToItem, type StagedItem, type StagedMeal } from './nutritionEngineHelpers';
import { useToast } from '../../hooks/useToast';

export interface UseCustomDishSavingOptions {
  targetUserId: string;
  stagedMeal: StagedMeal | null;
  setStatus: (status: string) => void;
  setIsError: (isError: boolean) => void;
}

export function useCustomDishSaving({
  targetUserId,
  stagedMeal,
  setStatus,
  setIsError,
}: UseCustomDishSavingOptions) {
  const queryClient = useQueryClient();
  const { show: showToast, dismiss: dismissToast } = useToast();

  const handleSaveStagedAsCustomDish = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus('Available when online');
      setIsError(true);
      return;
    }
    if (!stagedMeal) return;
    dismissToast();
    try {
      const rawItems = stagedMeal.items.map(stagedToItem);
      let itemsToPersist = rawItems;
      let calories: number;
      let protein: number;
      let carbs: number;
      let fat: number;
      let fiber: number;

      if (rawItems.length === 1) {
        const single = rawItems[0];
        const roundedSingle: NutritionItem = {
          ...single,
          quantity: roundTo1Decimal(single.quantity),
          calories: roundTo1Decimal(single.calories),
          protein: roundTo1Decimal(single.protein),
          carbs: roundTo1Decimal(single.carbs),
          fat: roundTo1Decimal(single.fat),
          fiber: roundTo1Decimal(single.fiber),
        };
        itemsToPersist = [roundedSingle];
        calories = roundedSingle.calories;
        protein = roundedSingle.protein;
        carbs = roundedSingle.carbs;
        fat = roundedSingle.fat;
        fiber = roundedSingle.fiber;
      } else {
        const totals = sumItems(rawItems);
        calories = roundTo1Decimal(totals.calories);
        protein = roundTo1Decimal(totals.protein);
        carbs = roundTo1Decimal(totals.carbs);
        fat = roundTo1Decimal(totals.fat);
        fiber = roundTo1Decimal(totals.fiber);
      }

      const { error } = await supabase.from('custom_dishes').insert([
        {
          user_id: targetUserId,
          name: stagedMeal.name,
          kind: rawItems.length > 1 ? 'recipe' : 'food',
          ingredients: JSON.stringify(stagedMeal.items),
          items: itemsForPersist(itemsToPersist),
          calories,
          protein,
          carbs,
          fat,
          fiber,
          notes: stagedMeal.notes ?? null,
        },
      ]);
      if (error) throw error;
      showToast({ message: 'Saved custom dish', kind: 'success' });
      setStatus('');
      setIsError(false);
      queryClient.invalidateQueries({ queryKey: ['custom_dishes', targetUserId] });
    } catch (err: any) {
      setStatus('Failed to save custom dish: ' + err.message);
      setIsError(true);
    }
  };

  const handleSaveItemAsCustomDish = async (item: StagedItem) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus('Available when online');
      setIsError(true);
      return;
    }
    try {
      const rawItem = stagedToItem(item);
      const roundedItem: NutritionItem = {
        ...rawItem,
        quantity: roundTo1Decimal(rawItem.quantity),
        calories: roundTo1Decimal(rawItem.calories),
        protein: roundTo1Decimal(rawItem.protein),
        carbs: roundTo1Decimal(rawItem.carbs),
        fat: roundTo1Decimal(rawItem.fat),
        fiber: roundTo1Decimal(rawItem.fiber),
      };
      const { error } = await supabase.from('custom_dishes').insert([
        {
          user_id: targetUserId,
          name: item.name,
          kind: 'food',
          ingredients: JSON.stringify([item]),
          items: itemsForPersist([roundedItem]),
          calories: roundedItem.calories,
          protein: roundedItem.protein,
          carbs: roundedItem.carbs,
          fat: roundedItem.fat,
          fiber: roundedItem.fiber,
        },
      ]);
      if (error) throw error;
      showToast({ message: `Saved ${item.name} as custom dish`, kind: 'success' });
      setStatus('');
      setIsError(false);
      queryClient.invalidateQueries({ queryKey: ['custom_dishes', targetUserId] });
    } catch (err: any) {
      setStatus('Failed to save custom dish: ' + err.message);
      setIsError(true);
    }
  };

  return {
    handleSaveStagedAsCustomDish,
    handleSaveItemAsCustomDish,
  };
}
