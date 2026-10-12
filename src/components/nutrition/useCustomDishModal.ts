import { useState, useRef } from 'react';
import type { CustomDish, CustomDishDetail, CustomDishKind } from '../../types/database';
import { roundTo1Decimal } from '../../utils/nutrition';
import {
  itemsForPersist,
  itemsFromLegacyIngredients,
  normalizeItems,
  scaleItemToQuantity,
  sumItems,
  type NutritionItem,
} from '../../utils/itemModel';
import { parseQuantityInput } from '../../utils/unitConverter';
import { newId } from '../../offline';
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
  const [dishModalQuantity, setDishModalQuantity] = useState<number | ''>('');
  const [dishModalUnit, setDishModalUnit] = useState('g');
  const [dishModalCalories, setDishModalCalories] = useState<number | ''>('');
  const [dishModalProtein, setDishModalProtein] = useState<number | ''>('');
  const [dishModalCarbs, setDishModalCarbs] = useState<number | ''>('');
  const [dishModalFat, setDishModalFat] = useState<number | ''>('');
  const [dishModalFiber, setDishModalFiber] = useState<number | ''>('');
  const [dishModalNotes, setDishModalNotes] = useState('');
  const [dishModalItems, setDishModalItems] = useState<NutritionItem[]>([]);
  const foodRef = useRef<NutritionItem | null>(null);

  const resetDishModalFields = () => {
    setDishModalKind('food');
    setDishModalName('');
    setDishModalQuantity('');
    setDishModalUnit('g');
    setDishModalCalories('');
    setDishModalProtein('');
    setDishModalCarbs('');
    setDishModalFat('');
    setDishModalFiber('');
    setDishModalNotes('');
    setDishModalItems([]);
    foodRef.current = null;
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
      items: detail?.items ?? dish.items ?? null,
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
    const normalizedItems = rawItems.map((it) => ({
      ...it,
      quantity: roundTo1Decimal(it.quantity),
      calories: roundTo1Decimal(it.calories),
      protein: roundTo1Decimal(it.protein),
      carbs: roundTo1Decimal(it.carbs),
      fat: roundTo1Decimal(it.fat),
      fiber: roundTo1Decimal(it.fiber),
    }));
    setDishModalItems(normalizedItems);

    if (initialKind === 'food' && normalizedItems.length === 1) {
      const item0 = normalizedItems[0];
      setDishModalQuantity(item0.quantity);
      setDishModalUnit(item0.unit || 'g');
      foodRef.current = { ...item0 };
    } else if (initialKind === 'food') {
      setDishModalQuantity('');
      setDishModalUnit('g');
      foodRef.current = {
        id: newId(),
        name: dish.name,
        quantity: 0,
        unit: 'g' as any,
        calories: Number(dish.calories) || 0,
        protein: Number(dish.protein) || 0,
        carbs: Number(dish.carbs) || 0,
        fat: Number(dish.fat) || 0,
        fiber: Number(dish.fiber) || 0,
      };
    } else {
      setDishModalQuantity('');
      setDishModalUnit('g');
      foodRef.current = null;
    }

    setShowDishModal(true);
  };

  const handleQuantityChange = (nextQty: number | '') => {
    setDishModalQuantity(nextQty);
    if (nextQty === '' || nextQty <= 0) return;
    const parsed = Number(nextQty);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    if (foodRef.current && foodRef.current.quantity > 0) {
      const scaled = scaleItemToQuantity(foodRef.current, parsed);
      setDishModalCalories(roundTo1Decimal(scaled.calories));
      setDishModalProtein(roundTo1Decimal(scaled.protein));
      setDishModalCarbs(roundTo1Decimal(scaled.carbs));
      setDishModalFat(roundTo1Decimal(scaled.fat));
      setDishModalFiber(roundTo1Decimal(scaled.fiber));
    } else {
      foodRef.current = {
        id: foodRef.current?.id || newId(),
        name: dishModalName || '',
        quantity: parsed,
        unit: (dishModalUnit || 'g') as any,
        calories: Number(dishModalCalories) || 0,
        protein: Number(dishModalProtein) || 0,
        carbs: Number(dishModalCarbs) || 0,
        fat: Number(dishModalFat) || 0,
        fiber: Number(dishModalFiber) || 0,
      };
    }
  };

  const handleUnitChange = (nextUnit: string) => {
    setDishModalUnit(nextUnit);
    if (foodRef.current) {
      foodRef.current = {
        ...foodRef.current,
        unit: nextUnit as any,
      };
    }
  };

  const setCalories = (c: number | '') => {
    setDishModalCalories(c);
    if (foodRef.current && typeof dishModalQuantity === 'number' && dishModalQuantity > 0) {
      foodRef.current = {
        ...foodRef.current,
        quantity: dishModalQuantity,
        calories: Number(c) || 0,
      };
    }
  };

  const setProtein = (p: number | '') => {
    setDishModalProtein(p);
    if (foodRef.current && typeof dishModalQuantity === 'number' && dishModalQuantity > 0) {
      foodRef.current = {
        ...foodRef.current,
        quantity: dishModalQuantity,
        protein: Number(p) || 0,
      };
    }
  };

  const setCarbs = (cb: number | '') => {
    setDishModalCarbs(cb);
    if (foodRef.current && typeof dishModalQuantity === 'number' && dishModalQuantity > 0) {
      foodRef.current = {
        ...foodRef.current,
        quantity: dishModalQuantity,
        carbs: Number(cb) || 0,
      };
    }
  };

  const setFat = (f: number | '') => {
    setDishModalFat(f);
    if (foodRef.current && typeof dishModalQuantity === 'number' && dishModalQuantity > 0) {
      foodRef.current = {
        ...foodRef.current,
        quantity: dishModalQuantity,
        fat: Number(f) || 0,
      };
    }
  };

  const setFiber = (fib: number | '') => {
    setDishModalFiber(fib);
    if (foodRef.current && typeof dishModalQuantity === 'number' && dishModalQuantity > 0) {
      foodRef.current = {
        ...foodRef.current,
        quantity: dishModalQuantity,
        fiber: Number(fib) || 0,
      };
    }
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
    if (!editingDish && dishModalKind === 'recipe' && dishModalItems.length === 0) return;

    const clamp = (n: number) => Math.max(0, roundTo1Decimal(n));

    let persistItems: NutritionItem[] | null = null;
    let parentCalories: number;
    let parentProtein: number;
    let parentCarbs: number;
    let parentFat: number;
    let parentFiber: number;

    if (dishModalKind === 'recipe') {
      const normalizedRecipeItems = (dishModalItems || []).map((it) => ({
        ...it,
        quantity: roundTo1Decimal(it.quantity),
        calories: roundTo1Decimal(it.calories),
        protein: roundTo1Decimal(it.protein),
        carbs: roundTo1Decimal(it.carbs),
        fat: roundTo1Decimal(it.fat),
        fiber: roundTo1Decimal(it.fiber),
      }));
      persistItems = itemsForPersist(normalizedRecipeItems);
      if (persistItems && persistItems.length === 1) {
        parentCalories = persistItems[0].calories;
        parentProtein = persistItems[0].protein;
        parentCarbs = persistItems[0].carbs;
        parentFat = persistItems[0].fat;
        parentFiber = persistItems[0].fiber;
      } else {
        const totals = persistItems ? sumItems(persistItems) : null;
        parentCalories = clamp(totals ? totals.calories : Number(dishModalCalories) || 0);
        parentProtein = clamp(totals ? totals.protein : Number(dishModalProtein) || 0);
        parentCarbs = clamp(totals ? totals.carbs : Number(dishModalCarbs) || 0);
        parentFat = clamp(totals ? totals.fat : Number(dishModalFat) || 0);
        parentFiber = clamp(totals ? totals.fiber : Number(dishModalFiber) || 0);
      }
    } else {
      const parsedQty = typeof dishModalQuantity === 'number' && dishModalQuantity > 0
        ? dishModalQuantity
        : parseQuantityInput(dishModalQuantity);

      const unit = dishModalUnit.trim();

      if (parsedQty != null && parsedQty > 0) {
        const qty = roundTo1Decimal(parsedQty);
        const resolvedUnit = unit || 'g';
        const foodItem: NutritionItem = {
          id: editingDish?.items?.[0]?.id || newId(),
          name: dishModalName.trim(),
          quantity: qty,
          unit: resolvedUnit as any,
          calories: clamp(Number(dishModalCalories) || 0),
          protein: clamp(Number(dishModalProtein) || 0),
          carbs: clamp(Number(dishModalCarbs) || 0),
          fat: clamp(Number(dishModalFat) || 0),
          fiber: clamp(Number(dishModalFiber) || 0),
          displayPortion: `${qty} ${resolvedUnit}`,
        };
        persistItems = [foodItem];
        parentCalories = foodItem.calories;
        parentProtein = foodItem.protein;
        parentCarbs = foodItem.carbs;
        parentFat = foodItem.fat;
        parentFiber = foodItem.fiber;
      } else {
        parentCalories = clamp(Number(dishModalCalories) || 0);
        parentProtein = clamp(Number(dishModalProtein) || 0);
        parentCarbs = clamp(Number(dishModalCarbs) || 0);
        parentFat = clamp(Number(dishModalFat) || 0);
        parentFiber = clamp(Number(dishModalFiber) || 0);
      }
    }

    onSaveDish({
      dishPayload: {
        name: dishModalName.trim(),
        kind: dishModalKind,
        calories: parentCalories,
        protein: parentProtein,
        carbs: parentCarbs,
        fat: parentFat,
        fiber: parentFiber,
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
    dishModalQuantity,
    setDishModalQuantity,
    dishModalUnit,
    setDishModalUnit,
    handleQuantityChange,
    handleUnitChange,
    dishModalCalories,
    setDishModalCalories: setCalories,
    dishModalProtein,
    setDishModalProtein: setProtein,
    dishModalCarbs,
    setDishModalCarbs: setCarbs,
    dishModalFat,
    setDishModalFat: setFat,
    dishModalFiber,
    setDishModalFiber: setFiber,
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
