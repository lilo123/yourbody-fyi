import { useState } from 'react';
import type { CustomDish, CustomDishDetail, CustomDishKind } from '../../types/database';
import { roundTo1Decimal } from '../../utils/nutrition';
import {
  itemsForPersist,
  itemsFromLegacyIngredients,
  normalizeItems,
  sumItems,
  type NutritionItem,
} from '../../utils/itemModel';
import { fetchDishDetail as defaultFetchDishDetail } from './useNutritionData';

export interface UseCustomDishModalOptions {
  onSaveDish: (args: { dishPayload: Partial<CustomDishDetail>; editingDishId?: string }) => void;
  onDeleteDish: (dishId: string) => void;
  onDismissToast: () => void;
  fetchDishDetail?: (dishId: string) => Promise<CustomDishDetail | null>;
  onFetchError?: (err: Error, retry: () => void) => void;
}

export function useCustomDishModal({
  onSaveDish,
  onDeleteDish,
  onDismissToast,
  fetchDishDetail,
  onFetchError,
}: UseCustomDishModalOptions) {
  const [showDishModal, setShowDishModal] = useState(false);
  const [editingDish, setEditingDish] = useState<CustomDishDetail | null>(null);
  const [dishFetchError, setDishFetchError] = useState<{ message: string; retry: () => void } | null>(null);
  const [dishModalKind, setDishModalKind] = useState<CustomDishKind>('food');
  const [dishModalName, setDishModalName] = useState('');
  const [dishModalCalories, setDishModalCalories] = useState<number | ''>('');
  const [dishModalProtein, setDishModalProtein] = useState<number | ''>('');
  const [dishModalCarbs, setDishModalCarbs] = useState<number | ''>('');
  const [dishModalFat, setDishModalFat] = useState<number | ''>('');
  const [dishModalFiber, setDishModalFiber] = useState<number | ''>('');
  const [dishModalNotes, setDishModalNotes] = useState('');
  const [dishModalItems, setDishModalItems] = useState<NutritionItem[]>([]);

  const resetDishModalFields = () => {
    setDishModalKind('food');
    setDishModalName('');
    setDishModalCalories('');
    setDishModalProtein('');
    setDishModalCarbs('');
    setDishModalFat('');
    setDishModalFiber('');
    setDishModalNotes('');
    setDishModalItems([]);
  };

  const handleOpenNewDishModal = () => {
    onDismissToast();
    setDishFetchError(null);
    setEditingDish(null);
    resetDishModalFields();
    setShowDishModal(true);
  };

  const handleOpenEditDishModal = async (dish: CustomDish) => {
    onDismissToast();
    setDishFetchError(null);
    let detail: CustomDishDetail | null = null;
    const fetcher = fetchDishDetail || defaultFetchDishDetail;
    try {
      detail = await fetcher(dish.id);
    } catch (err: any) {
      const msg = err?.message || 'Failed to load dish details';
      const retry = () => {
        void handleOpenEditDishModal(dish);
      };
      setDishFetchError({ message: msg, retry });
      onFetchError?.(err, retry);
      return;
    }

    const mergedDish: CustomDishDetail = {
      ...dish,
      items: detail?.items ?? null,
      ingredients: detail?.ingredients ?? null,
    };
    setEditingDish(mergedDish);
    setDishModalName(dish.name);
    setDishModalCalories(dish.calories != null ? roundTo1Decimal(dish.calories) : '');
    setDishModalProtein(dish.protein != null ? roundTo1Decimal(dish.protein) : '');
    setDishModalCarbs(dish.carbs != null ? roundTo1Decimal(dish.carbs) : '');
    setDishModalFat(dish.fat != null ? roundTo1Decimal(dish.fat) : '');
    setDishModalFiber(dish.fiber != null ? roundTo1Decimal(dish.fiber) : '');
    setDishModalNotes(dish.notes ?? '');
    const rawItems =
      normalizeItems(mergedDish.items) ??
      itemsFromLegacyIngredients(mergedDish.id, mergedDish.name, mergedDish.ingredients) ??
      [];
    const initialKind: CustomDishKind =
      dish.kind ?? (rawItems.length > 1 ? 'recipe' : 'food');
    setDishModalKind(initialKind);
    setDishModalItems(
      rawItems.map((it) => ({
        ...it,
        quantity: roundTo1Decimal(it.quantity),
        calories: roundTo1Decimal(it.calories),
        protein: roundTo1Decimal(it.protein),
        carbs: roundTo1Decimal(it.carbs),
        fat: roundTo1Decimal(it.fat),
        fiber: roundTo1Decimal(it.fiber),
      }))
    );
    setShowDishModal(true);
  };

  const handleCloseDishModal = () => {
    setShowDishModal(false);
    setEditingDish(null);
    setDishFetchError(null);
    resetDishModalFields();
  };

  const handleSaveCustomDishModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dishModalName.trim()) return;
    // A new recipe's totals are Σ(components); with no components there is
    // nothing to derive and the parent-macro inputs are not rendered, so this
    // would persist a silent all-zero dish. When editing, the parent macros are
    // already seeded from the existing row, so there is nothing to corrupt.
    if (!editingDish && dishModalKind === 'recipe' && dishModalItems.length === 0) return;

    const persistItems = itemsForPersist(dishModalItems);
    const totals = persistItems ? sumItems(persistItems) : null;
    const clamp = (n: number) => Math.max(0, roundTo1Decimal(n));

    onSaveDish({
      dishPayload: {
        name: dishModalName.trim(),
        kind: dishModalKind,
        calories: clamp(totals ? totals.calories : Number(dishModalCalories) || 0),
        protein: clamp(totals ? totals.protein : Number(dishModalProtein) || 0),
        carbs: clamp(totals ? totals.carbs : Number(dishModalCarbs) || 0),
        fat: clamp(totals ? totals.fat : Number(dishModalFat) || 0),
        fiber: clamp(totals ? totals.fiber : Number(dishModalFiber) || 0),
        notes: dishModalNotes.trim() ? dishModalNotes.trim().slice(0, 500) : null,
        items: persistItems,
      },
      editingDishId: editingDish?.id,
    });
    handleCloseDishModal();
  };

  const handleDeleteCustomDish = (dishId: string) => {
    onDeleteDish(dishId);
    handleCloseDishModal();
  };

  return {
    showDishModal,
    editingDish,
    dishModalKind,
    setDishModalKind,
    dishModalName,
    setDishModalName,
    dishModalCalories,
    setDishModalCalories,
    dishModalProtein,
    setDishModalProtein,
    dishModalCarbs,
    setDishModalCarbs,
    dishModalFat,
    setDishModalFat,
    dishModalFiber,
    setDishModalFiber,
    dishModalNotes,
    setDishModalNotes,
    dishModalItems,
    setDishModalItems,
    handleOpenNewDishModal,
    handleOpenEditDishModal,
    handleCloseDishModal,
    handleSaveCustomDishModal,
    handleDeleteCustomDish,
    dishFetchError,
    setDishFetchError,
  };
}
