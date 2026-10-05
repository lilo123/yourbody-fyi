function canonicalizeMealType(type?: string | null): string {
  if (!type) return 'Breakfast';
  const lower = type.toLowerCase().trim();
  if (lower === 'breakfast') return 'Breakfast';
  if (lower === 'lunch') return 'Lunch';
  if (lower === 'dinner') return 'Dinner';
  if (lower === 'snack') return 'Snack';
  if (lower === 'pre-workout') return 'Pre-Workout';
  if (lower === 'post-workout') return 'Post-Workout';
  return type;
}

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { NutritionLog } from '../../types/database';
import { roundTo1Decimal } from '../../utils/nutrition';
import {
  normalizeItems,
  itemsForPersist,
  sumItems,
  scaleItemToQuantity,
  type NutritionItem,
} from '../../utils/itemModel';
import {
  buildStagedItem,
  recomputeStagedTotals,
  stagedToItem,
  stagedReference,
  type StagedItem,
  type StagedMeal,
} from './nutritionEngineHelpers';
import { formatLocalTimestamp } from '../../utils/date';
import { nutritionDayKey } from '../../utils/nutritionDayKey';
import { friendlyError } from '../../utils/nutritionErrors';
import { logItemsMemoryCache } from './useNutritionData';

export interface UseMealEditorProps {
  meal: (NutritionLog & { items?: unknown }) | null;
  isOpen: boolean;
  onClose: () => void;
  targetUserId?: string;
  timeZone?: string | null;
  triggerToast?: (
    dish: { name: string; calories: number | null },
    options?: {
      variant?: 'logged' | 'added' | 'updated';
      dishName?: string;
      calories?: number;
      onUndo?: () => Promise<void> | void;
    }
  ) => void;
  setStatus?: (s: string) => void;
  setIsError?: (e: boolean) => void;
}

interface DraftSnapshot {
  name: string;
  mealType: string;
  date: string;
  items: Array<{
    name: string;
    quantity: number;
    unit: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  }>;
}

function buildSnapshot(draft: StagedMeal, date: string): DraftSnapshot {
  return {
    name: draft.name.trim(),
    mealType: draft.mealType,
    date,
    items: draft.items.map((it) => ({
      name: it.name.trim(),
      quantity: roundTo1Decimal(it.quantity),
      unit: it.unit,
      calories: roundTo1Decimal(it.calories),
      protein: roundTo1Decimal(it.protein),
      carbs: roundTo1Decimal(it.carbs),
      fat: roundTo1Decimal(it.fat),
      fiber: roundTo1Decimal(it.fiber),
    })),
  };
}

function areSnapshotsEqual(a: DraftSnapshot, b: DraftSnapshot): boolean {
  if (a.name !== b.name) return false;
  if (a.mealType !== b.mealType) return false;
  if (a.date !== b.date) return false;
  if (a.items.length !== b.items.length) return false;
  for (let i = 0; i < a.items.length; i++) {
    const itA = a.items[i];
    const itB = b.items[i];
    if (itA.name !== itB.name) return false;
    if (itA.quantity !== itB.quantity) return false;
    if (itA.unit !== itB.unit) return false;
    if (itA.calories !== itB.calories) return false;
    if (itA.protein !== itB.protein) return false;
    if (itA.carbs !== itB.carbs) return false;
    if (itA.fat !== itB.fat) return false;
    if (itA.fiber !== itB.fiber) return false;
  }
  return true;
}

function buildInitialDraft(
  log: NutritionLog & { items?: unknown },
  resolvedItems: NutritionItem[] | null,
  timeZone?: string
): { draft: StagedMeal; date: string } {
  let stagedItems: StagedItem[];
  if (resolvedItems && resolvedItems.length > 0) {
    stagedItems = resolvedItems.map((it) => {
      const built = buildStagedItem({
        name: it.name,
        portion: it.displayPortion || `${it.quantity} ${it.unit}`,
        quantity: it.quantity,
        unit: it.unit,
        calories: it.calories,
        protein: it.protein,
        carbs: it.carbs,
        fat: it.fat,
        fiber: it.fiber,
      });
      return {
        ...built,
        id: it.id || built.id,
      };
    });
  } else {
    // Single item in exactly the shape the log path writes for a single-item staged meal
    const servingSize = log.serving_size ?? 1;
    const servingUnit = (log.serving_unit === 'g' || log.serving_unit === 'ml' || log.serving_unit === 'unit')
      ? log.serving_unit
      : 'unit';
    const single = buildStagedItem({
      name: log.food_name,
      portion: `${servingSize} ${log.serving_unit || 'serving'}`,
      quantity: servingSize,
      unit: servingUnit,
      calories: log.calories,
      protein: log.protein,
      carbs: log.carbs,
      fat: log.fat,
      fiber: log.fiber,
    });
    stagedItems = [single];
  }

  const totals = recomputeStagedTotals(stagedItems);
  const date = nutritionDayKey(log, timeZone);

  const draft: StagedMeal = {
    name: log.food_name,
    mealType: canonicalizeMealType(log.meal_type),
    explanation: totals.explanation,
    items: stagedItems,
    calories: totals.calories,
    protein: totals.protein,
    carbs: totals.carbs,
    fat: totals.fat,
    fiber: totals.fiber,
    servingSize: log.serving_size ?? 1,
    servingUnit: log.serving_unit || 'serving',
    notes: log.notes ?? null,
  };

  return { draft, date };
}

function computeInitialEditorState(isOpen: boolean, meal: NutritionLog | null, tz?: string) {
  if (!isOpen || !meal) {
    return { draft: null, date: "", anchorItems: null, snapshot: null };
  }
  let itemsSource: unknown = (meal as any).items;
  if (itemsSource === undefined && logItemsMemoryCache.has(meal.id)) {
    itemsSource = logItemsMemoryCache.get(meal.id);
  }
  const norm = normalizeItems(itemsSource);
  const { draft, date } = buildInitialDraft(meal, norm, tz);
  return {
    draft,
    date,
    anchorItems: draft.items,
    snapshot: buildSnapshot(draft, date),
  };
}

export function useMealEditor({
  meal,
  isOpen,
  onClose,
  targetUserId,
  timeZone,
  triggerToast,
  setStatus,
  setIsError,
}: UseMealEditorProps) {
  const tz = timeZone || undefined;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StagedMeal | null>(() => computeInitialEditorState(isOpen, meal, tz).draft);
  const [draftDate, setDraftDate] = useState<string>(() => computeInitialEditorState(isOpen, meal, tz).date);
  const [initialDate, setInitialDate] = useState<string>(() => computeInitialEditorState(isOpen, meal, tz).date);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [initialAnchorItems, setInitialAnchorItems] = useState<StagedItem[] | null>(
    () => computeInitialEditorState(isOpen, meal, tz).anchorItems
  );
  const [initialSnapshot, setInitialSnapshot] = useState<DraftSnapshot | null>(
    () => computeInitialEditorState(isOpen, meal, tz).snapshot
  );

  // Initialize draft when modal opens or meal changes
  useEffect(() => {
    if (!isOpen || !meal) {
      setDraft(null);
      setDraftDate('');
      setInitialDate('');
      setInitialAnchorItems(null);
      setInitialSnapshot(null);
      setErrorMessage(null);
      return;
    }

    let itemsSource: unknown = meal.items;
    if (itemsSource === undefined && logItemsMemoryCache.has(meal.id)) {
      itemsSource = logItemsMemoryCache.get(meal.id);
    }

    const norm = normalizeItems(itemsSource);
    const { draft: initialDraft, date } = buildInitialDraft(meal, norm, tz);

    setDraft(initialDraft);
    setDraftDate(date);
    setInitialDate(date);
    setInitialAnchorItems(initialDraft.items);
    setInitialSnapshot(buildSnapshot(initialDraft, date));
    setErrorMessage(null);

    let active = true;

    // If items were undefined but has_components is true and not in cache, fetch on-demand
    if (meal.items === undefined && !norm && meal.has_components) {
      void (async () => {
        try {
          // payload-gate: detail-fetch — loaded on demand when user opens EditMealSheet
          const { data, error } = await supabase
            .from('nutrition_logs')
            .select('id, items')
            .eq('id', meal.id)
            .maybeSingle();
          if (!active || error) return;
          if (data?.items) {
            const fetchedNorm = normalizeItems(data.items);
            if (active && fetchedNorm && fetchedNorm.length > 0) {
              logItemsMemoryCache.set(meal.id, data.items);
              const { draft: updatedDraft } = buildInitialDraft(meal, fetchedNorm, tz);
              if (!active) return;
              setDraft((current) => {
                if (!current) return updatedDraft;
                return {
                  ...updatedDraft,
                  name: current.name,
                  mealType: current.mealType,
                  notes: current.notes,
                };
              });
              setInitialAnchorItems(updatedDraft.items);
              setInitialSnapshot(buildSnapshot(updatedDraft, date));
            }
          }
        } catch {
          // Keep current fallback draft
        }
      })();
    }

    return () => {
      active = false;
    };
  }, [isOpen, meal, tz]);

  const isDirty = useMemo(() => {
    if (!draft || !initialSnapshot) return false;
    const currentSnapshot = buildSnapshot(draft, draftDate);
    return !areSnapshotsEqual(initialSnapshot, currentSnapshot);
  }, [draft, draftDate, initialSnapshot]);

  const applyStagedItemChange = useCallback((id: string, next: NutritionItem) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const updated = prev.items.map((it) => {
        if (it.id !== id) return it;
        const ref = stagedReference(it);
        const scaled = scaleItemToQuantity(ref, next.quantity);
        return {
          ...it,
          quantity: roundTo1Decimal(scaled.quantity),
          portion: `${roundTo1Decimal(scaled.quantity)} ${it.unit}`,
          calories: roundTo1Decimal(scaled.calories),
          protein: roundTo1Decimal(scaled.protein),
          carbs: roundTo1Decimal(scaled.carbs),
          fat: roundTo1Decimal(scaled.fat),
          fiber: roundTo1Decimal(scaled.fiber),
        };
      });
      const totals = recomputeStagedTotals(updated);
      return { ...prev, items: updated, ...totals };
    });
  }, []);

  const handleDeleteItem = useCallback((id: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const updated = prev.items.filter((it) => it.id !== id);
      const totals = recomputeStagedTotals(updated);
      return { ...prev, items: updated, ...totals };
    });
  }, []);

  const save = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setErrorMessage('Available when online');
      return;
    }
    if (!draft || !meal) return;
    if (!draft.name.trim()) {
      setErrorMessage("Meal name is required");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const items = draft.items.map(stagedToItem);
      const totals = sumItems(items);
      const isSingle = items.length <= 1;
      const item0 = items[0];

      // D29 / logged_date semantics:
      // If date changed, move logged_at to same time of day on new date; else preserve logged_at
      let loggedAt = meal.logged_at;
      if (draftDate !== initialDate) {
        loggedAt = formatLocalTimestamp(
          draftDate,
          meal.logged_at ? new Date(meal.logged_at) : new Date(),
          tz
        );
      }

      const payload = {
        food_name: draft.name.trim(),
        calories: isSingle && item0 ? roundTo1Decimal(item0.calories) : roundTo1Decimal(totals.calories),
        protein: isSingle && item0 ? roundTo1Decimal(item0.protein) : roundTo1Decimal(totals.protein),
        carbs: isSingle && item0 ? roundTo1Decimal(item0.carbs) : roundTo1Decimal(totals.carbs),
        fat: isSingle && item0 ? roundTo1Decimal(item0.fat) : roundTo1Decimal(totals.fat),
        fiber: isSingle && item0 ? roundTo1Decimal(item0.fiber) : roundTo1Decimal(totals.fiber),
        meal_type: draft.mealType,
        serving_size: isSingle && item0 ? (Number(item0.quantity) || 1) : (Number(draft.servingSize) || 1),
        serving_unit: isSingle && item0 ? (item0.unit || 'serving') : (draft.servingUnit || 'serving'),
        logged_at: loggedAt,
        logged_date: draftDate,
        items: items.length > 1 ? itemsForPersist(items) : null,
        notes: draft.notes ?? null,
      };

      const { error } = await supabase
        .from('nutrition_logs')
        .update(payload)
        .eq('id', meal.id)
        .select();

      if (error) throw error;

      if (items.length > 1) {
        logItemsMemoryCache.set(meal.id, itemsForPersist(items));
      } else {
        logItemsMemoryCache.delete(meal.id);
      }

      queryClient.invalidateQueries({ queryKey: ['nutrition_logs'] });
      if (targetUserId) {
        queryClient.invalidateQueries({ queryKey: ['nutrition_logs', targetUserId] });
      }

      // Snapshot for Undo
      let prevItems = meal.items;
      if (prevItems === undefined && logItemsMemoryCache.has(meal.id)) {
        prevItems = logItemsMemoryCache.get(meal.id);
      }
      if (prevItems === undefined && initialAnchorItems && initialAnchorItems.length > 1) {
        prevItems = itemsForPersist(initialAnchorItems.map(stagedToItem));
      }
      const parsedPrevItems = prevItems
        ? (typeof prevItems === 'string' ? JSON.parse(prevItems) : prevItems)
        : null;

      const previousSnapshot = {
        food_name: meal.food_name,
        meal_type: meal.meal_type,
        logged_date: meal.logged_date,
        logged_at: meal.logged_at,
        items: parsedPrevItems,
        calories: meal.calories,
        protein: meal.protein,
        carbs: meal.carbs,
        fat: meal.fat,
        fiber: meal.fiber,
        serving_size: meal.serving_size,
        serving_unit: meal.serving_unit,
        notes: meal.notes,
      };
      const mealId = meal.id;

      onClose();

      if (triggerToast) {
        triggerToast(
          { name: payload.food_name, calories: payload.calories },
          {
            variant: 'updated',
            dishName: payload.food_name,
            calories: payload.calories,
            onUndo: async () => {
              try {
                const { error: undoErr } = await supabase
                  .from('nutrition_logs')
                  .update(previousSnapshot)
                  .eq('id', mealId)
                  .select();
                if (undoErr) throw undoErr;
                if (previousSnapshot.items) {
                  logItemsMemoryCache.set(mealId, previousSnapshot.items);
                } else {
                  logItemsMemoryCache.delete(mealId);
                }
                queryClient.invalidateQueries({ queryKey: ['nutrition_logs'] });
                if (targetUserId) {
                  queryClient.invalidateQueries({ queryKey: ['nutrition_logs', targetUserId] });
                }
              } catch (err: unknown) {
                const msg = friendlyError(err);
                setStatus?.(msg);
                setIsError?.(true);
              }
            },
          }
        );
      }
    } catch (err: unknown) {
      const msg = friendlyError(err);
      setErrorMessage(msg);
      setStatus?.(msg);
      setIsError?.(true);
    } finally {
      setIsSaving(false);
    }
  }, [
    draft,
    meal,
    draftDate,
    initialDate,
    initialAnchorItems,
    tz,
    targetUserId,
    onClose,
    triggerToast,
    queryClient,
    setStatus,
    setIsError,
  ]);

  return {
    draft,
    setDraft,
    draftDate,
    setDraftDate,
    isDirty,
    isSaving,
    errorMessage,
    applyStagedItemChange,
    handleDeleteItem,
    save,
  };
}
