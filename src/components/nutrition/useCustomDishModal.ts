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
import { newId } from '../../offline';
import { fetchDishDetail as defaultFetchDishDetail } from './useNutritionData';
import { mapLegacyUnit } from './legacyUnitMapping';

export interface UseCustomDishModalOptions {
  onSaveDish: (args: { dishPayload: Partial<CustomDishDetail>; editingDishId?: string }) => Promise<unknown> | void;
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
  const [dishSaveError, setDishSaveError] = useState<string | null>(null);
  const [dishModalKind, setDishModalKind] = useState<CustomDishKind>('food');
  const [dishModalName, setDishModalName] = useState('');
  const [dishModalQuantity, setDishModalQuantity] = useState<number | ''>('');
  const [dishModalUnit, setDishModalUnit] = useState('g');
  const [scaleNutritionWithAmount, setScaleNutritionWithAmount] = useState(true);
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
    setScaleNutritionWithAmount(true);
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
    setDishSaveError(null);
    setEditingDish(null);
    resetDishModalFields();
    setShowDishModal(true);
  };

  const handleOpenEditDishModal = async (dish: CustomDish) => {
    onDismissToast();
    setDishFetchError(null);
    setDishSaveError(null);
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

    const rawDishItems = Array.isArray(mergedDish.items)
      ? mergedDish.items.map((it) => {
          if (it && typeof it === 'object') {
            return {
              ...it,
              unit: mapLegacyUnit((it as any).unit),
            };
          }
          return it;
        })
      : mergedDish.items;

    let rawItems =
      normalizeItems(rawDishItems) ??
      itemsFromLegacyIngredients(mergedDish.id, mergedDish.name, mergedDish.ingredients) ??
      [];

    if (rawItems.length === 0) {
      const parsedQty =
        (mergedDish as any).serving_quantity != null && Number((mergedDish as any).serving_quantity) > 0
          ? roundTo1Decimal(Number((mergedDish as any).serving_quantity))
          : 1;
      const parsedUnit = mapLegacyUnit((mergedDish as any).serving_unit);
      const displayPortion =
        (mergedDish as any).serving_quantity != null && (mergedDish as any).serving_unit
          ? `${parsedQty} ${parsedUnit}`
          : null;
      rawItems = [
        {
          id: newId(),
          name: mergedDish.name,
          quantity: parsedQty,
          unit: parsedUnit,
          calories: mergedDish.calories != null ? roundTo1Decimal(Number(mergedDish.calories)) : 0,
          protein: mergedDish.protein != null ? roundTo1Decimal(Number(mergedDish.protein)) : 0,
          carbs: mergedDish.carbs != null ? roundTo1Decimal(Number(mergedDish.carbs)) : 0,
          fat: mergedDish.fat != null ? roundTo1Decimal(Number(mergedDish.fat)) : 0,
          fiber: mergedDish.fiber != null ? roundTo1Decimal(Number(mergedDish.fiber)) : 0,
          displayPortion,
        },
      ];
    }

    const normalizedItems = rawItems.map((it) => ({
      ...it,
      unit: mapLegacyUnit(it.unit),
      quantity: roundTo1Decimal(it.quantity),
      calories: roundTo1Decimal(it.calories),
      protein: roundTo1Decimal(it.protein),
      carbs: roundTo1Decimal(it.carbs),
      fat: roundTo1Decimal(it.fat),
      fiber: roundTo1Decimal(it.fiber),
    }));
    setDishModalItems(normalizedItems);
    setScaleNutritionWithAmount(true);

    const initialKind: CustomDishKind =
      dish.kind ?? (normalizedItems.length > 1 ? 'recipe' : 'food');
    setDishModalKind(initialKind);

    if (normalizedItems.length === 1) {
      const item0 = normalizedItems[0];
      setDishModalQuantity(item0.quantity);
      setDishModalUnit(item0.unit);
      setDishModalCalories(item0.calories);
      setDishModalProtein(item0.protein);
      setDishModalCarbs(item0.carbs);
      setDishModalFat(item0.fat);
      setDishModalFiber(item0.fiber);
      foodRef.current = item0;
    } else {
      setDishModalQuantity('');
      setDishModalUnit('g');
      foodRef.current = null;
    }

    setShowDishModal(true);
  };

  const handleQuantityChange = (
    nextQty: number | '',
    shouldScale: boolean = scaleNutritionWithAmount
  ) => {
    setDishModalQuantity(nextQty);
    if (nextQty === '' || nextQty <= 0) return;
    const parsed = Number(nextQty);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    if (shouldScale) {
      if (foodRef.current && foodRef.current.quantity > 0) {
        const scaled = scaleItemToQuantity(foodRef.current, parsed);
        const scaledCal = roundTo1Decimal(scaled.calories);
        const scaledPro = roundTo1Decimal(scaled.protein);
        const scaledCarbs = roundTo1Decimal(scaled.carbs);
        const scaledFat = roundTo1Decimal(scaled.fat);
        const scaledFib = roundTo1Decimal(scaled.fiber);
        setDishModalCalories(scaledCal);
        setDishModalProtein(scaledPro);
        setDishModalCarbs(scaledCarbs);
        setDishModalFat(scaledFat);
        setDishModalFiber(scaledFib);
        setDishModalItems((prev) => {
          if (prev.length === 0) return prev;
          return [
            {
              ...prev[0],
              quantity: roundTo1Decimal(parsed),
              calories: scaledCal,
              protein: scaledPro,
              carbs: scaledCarbs,
              fat: scaledFat,
              fiber: scaledFib,
            },
            ...prev.slice(1),
          ];
        });
      } else {
        const baseItem: NutritionItem = {
          id: foodRef.current?.id || newId(),
          name: dishModalName || '',
          quantity: parsed,
          unit: mapLegacyUnit(dishModalUnit),
          calories: Number(dishModalCalories) || 0,
          protein: Number(dishModalProtein) || 0,
          carbs: Number(dishModalCarbs) || 0,
          fat: Number(dishModalFat) || 0,
          fiber: Number(dishModalFiber) || 0,
        };
        foodRef.current = baseItem;
        setDishModalItems((prev) => {
          if (prev.length === 0) return [baseItem];
          return [{ ...prev[0], quantity: parsed }, ...prev.slice(1)];
        });
      }
    } else {
      if (foodRef.current) {
        foodRef.current = {
          ...foodRef.current,
          quantity: parsed,
          calories: Number(dishModalCalories) || 0,
          protein: Number(dishModalProtein) || 0,
          carbs: Number(dishModalCarbs) || 0,
          fat: Number(dishModalFat) || 0,
          fiber: Number(dishModalFiber) || 0,
        };
      }
      setDishModalItems((prev) => {
        if (prev.length === 0) return prev;
        return [{ ...prev[0], quantity: roundTo1Decimal(parsed) }, ...prev.slice(1)];
      });
    }
  };

  const handleUnitChange = (nextUnit: string) => {
    const canonical = mapLegacyUnit(nextUnit);
    setDishModalUnit(canonical);
    if (foodRef.current) {
      foodRef.current = {
        ...foodRef.current,
        unit: canonical,
      };
    }
    setDishModalItems((prev) => {
      if (prev.length === 0) return prev;
      return [{ ...prev[0], unit: canonical }, ...prev.slice(1)];
    });
  };

  const handleScaleNutritionChange = (enabled: boolean) => {
    setScaleNutritionWithAmount(enabled);
    if (!enabled && foodRef.current && typeof dishModalQuantity === 'number' && dishModalQuantity > 0) {
      foodRef.current = {
        ...foodRef.current,
        quantity: dishModalQuantity,
        calories: Number(dishModalCalories) || 0,
        protein: Number(dishModalProtein) || 0,
        carbs: Number(dishModalCarbs) || 0,
        fat: Number(dishModalFat) || 0,
        fiber: Number(dishModalFiber) || 0,
      };
    }
  };

  const updateFirstItemMacro = (key: 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber', val: number | '') => {
    const numVal = val === '' ? 0 : Number(val);
    const rounded = roundTo1Decimal(numVal);
    setDishModalItems((prev) => {
      if (prev.length === 0) return prev;
      return [{ ...prev[0], [key]: rounded }, ...prev.slice(1)];
    });
    if (foodRef.current && typeof dishModalQuantity === 'number' && dishModalQuantity > 0) {
      foodRef.current = {
        ...foodRef.current,
        quantity: dishModalQuantity,
        calories: Number(key === 'calories' ? rounded : dishModalCalories) || 0,
        protein: Number(key === 'protein' ? rounded : dishModalProtein) || 0,
        carbs: Number(key === 'carbs' ? rounded : dishModalCarbs) || 0,
        fat: Number(key === 'fat' ? rounded : dishModalFat) || 0,
        fiber: Number(key === 'fiber' ? rounded : dishModalFiber) || 0,
      };
    }
  };

  const setCalories = (c: number | '') => {
    setDishModalCalories(c);
    updateFirstItemMacro('calories', c);
  };

  const setProtein = (p: number | '') => {
    setDishModalProtein(p);
    updateFirstItemMacro('protein', p);
  };

  const setCarbs = (cb: number | '') => {
    setDishModalCarbs(cb);
    updateFirstItemMacro('carbs', cb);
  };

  const setFat = (f: number | '') => {
    setDishModalFat(f);
    updateFirstItemMacro('fat', f);
  };

  const setFiber = (fib: number | '') => {
    setDishModalFiber(fib);
    updateFirstItemMacro('fiber', fib);
  };

  const handleCloseDishModal = () => {
    setShowDishModal(false);
    setEditingDish(null);
    setDishFetchError(null);
    setDishSaveError(null);
    resetDishModalFields();
  };

  const handleSaveCustomDishModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dishModalName.trim()) return;

    const clamp = (n: number) => Math.max(0, roundTo1Decimal(n));

    const normalizedRecipeItems = dishModalItems.map((it, idx) => ({
      ...it,
      name: it.name.trim() || (dishModalItems.length === 1 ? dishModalName.trim() : `Component ${idx + 1}`),
      quantity: roundTo1Decimal(it.quantity),
      unit: mapLegacyUnit(it.unit),
      calories: clamp(it.calories),
      protein: clamp(it.protein),
      carbs: clamp(it.carbs),
      fat: clamp(it.fat),
      fiber: clamp(it.fiber),
    }));

    let persistItems = itemsForPersist(normalizedRecipeItems);
    if (!persistItems || persistItems.length === 0) {
      if (
        dishModalCalories !== '' ||
        dishModalProtein !== '' ||
        dishModalCarbs !== '' ||
        dishModalFat !== '' ||
        dishModalFiber !== ''
      ) {
        const foodItem: NutritionItem = {
          id: newId(),
          name: dishModalName.trim(),
          quantity: 1,
          unit: 'unit',
          calories: clamp(Number(dishModalCalories) || 0),
          protein: clamp(Number(dishModalProtein) || 0),
          carbs: clamp(Number(dishModalCarbs) || 0),
          fat: clamp(Number(dishModalFat) || 0),
          fiber: clamp(Number(dishModalFiber) || 0),
          displayPortion: null,
        };
        persistItems = [foodItem];
      } else {
        return;
      }
    }

    let parentCalories: number;
    let parentProtein: number;
    let parentCarbs: number;
    let parentFat: number;
    let parentFiber: number;

    if (persistItems.length === 1) {
      parentCalories = persistItems[0].calories;
      parentProtein = persistItems[0].protein;
      parentCarbs = persistItems[0].carbs;
      parentFat = persistItems[0].fat;
      parentFiber = persistItems[0].fiber;
    } else {
      const totals = sumItems(persistItems);
      parentCalories = clamp(totals.calories);
      parentProtein = clamp(totals.protein);
      parentCarbs = clamp(totals.carbs);
      parentFat = clamp(totals.fat);
      parentFiber = clamp(totals.fiber);
    }

    const kind: CustomDishKind =
      persistItems.length > 1 ? 'recipe' : (editingDish?.kind ?? dishModalKind ?? 'food');

    try {
      setDishSaveError(null);
      const maybePromise = onSaveDish({
        dishPayload: {
          name: dishModalName.trim(),
          kind,
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

      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        return (async () => {
          try {
            await maybePromise;
            handleCloseDishModal();
          } catch (err: any) {
            const rawMsg = err?.message || 'Failed to save custom dish';
            const msg = rawMsg.startsWith('Failed to save custom dish')
              ? rawMsg
              : `Failed to save custom dish: ${rawMsg}`;
            setDishSaveError(msg);
          }
        })();
      }

      handleCloseDishModal();
    } catch (err: any) {
      const rawMsg = err?.message || 'Failed to save custom dish';
      const msg = rawMsg.startsWith('Failed to save custom dish')
        ? rawMsg
        : `Failed to save custom dish: ${rawMsg}`;
      setDishSaveError(msg);
    }
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
    scaleNutritionWithAmount,
    setScaleNutritionWithAmount: handleScaleNutritionChange,
    handleScaleNutritionChange,
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
    dishSaveError,
    setDishSaveError,
  };
}
