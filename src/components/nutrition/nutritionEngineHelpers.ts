import { useState, useEffect, useRef } from 'react';

export const getScrollBehavior = (): ScrollBehavior => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'smooth';
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    return 'smooth';
  }
};

export const useNavHeight = (): number => {
  const [navHeight, setNavHeight] = useState<number>(() => {
    if (typeof document !== 'undefined') {
      const nav = document.querySelector('nav');
      if (nav) {
        const rect = nav.getBoundingClientRect();
        if (rect.height > 0) return Math.round(rect.height);
      }
    }
    return 66;
  });

  useEffect(() => {
    const update = () => {
      const nav = document.querySelector('nav');
      if (nav) {
        const rect = nav.getBoundingClientRect();
        if (rect.height > 0) {
          setNavHeight(Math.round(rect.height));
        }
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return navHeight;
};

import { convertPortion, type CanonicalUnit } from '../../utils/unitConverter';
import { roundTo1Decimal, formatCalories } from '../../utils/nutrition';
import { sumItems, scaleItem, scaleItemToQuantity, type NutritionItem } from '../../utils/itemModel';
import type { ManualMealStagedData } from './useManualMealForm';

export interface StagedItem {
  id: string;
  name: string;
  /** The original free-text portion string, kept verbatim for provenance. */
  portion: string;
  /**
   * Retained only so that a saved custom dish written by an older client still
   * round-trips. Quantity is the authoritative control now.
   */
  portionMultiplier: number;
  /** Canonical quantity in `unit`, derived from `portion` on first staging. */
  quantity: number;
  unit: CanonicalUnit;
  /** The quantity at which base* below were measured. Scaling is relative to this. */
  baseQuantity: number;
  baseCalories: number;
  baseProtein: number;
  baseCarbs: number;
  baseFat: number;
  baseFiber: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  /** Optional flag indicating user explicitly edited the item's nutrition. */
  userOverridden?: boolean;
}

/** The staged component as the shared level-2 model sees it. */
export function stagedToItem(it: StagedItem): NutritionItem {
  return {
    id: it.id,
    name: it.name,
    quantity: it.quantity,
    unit: it.unit,
    displayPortion: it.portion,
    calories: it.calories,
    protein: it.protein,
    carbs: it.carbs,
    fat: it.fat,
    fiber: it.fiber,
  };
}

/** The same component at its reference quantity, for drift-free rescaling. */
export function stagedReference(it: StagedItem): NutritionItem {
  return {
    id: it.id,
    name: it.name,
    quantity: it.baseQuantity,
    unit: it.unit,
    displayPortion: it.portion,
    calories: it.baseCalories,
    protein: it.baseProtein,
    carbs: it.baseCarbs,
    fat: it.baseFat,
    fiber: it.baseFiber,
  };
}

/**
 * Re-anchor a staged component to a new unit and quantity.
 * All base* fields are rewritten so that subsequent portion adjustments
 * scale relative to this new anchor.
 */
export function reanchorStagedItem(item: StagedItem, next: NutritionItem): StagedItem {
  const q = roundTo1Decimal(next.quantity);
  const c = roundTo1Decimal(next.calories);
  const p = roundTo1Decimal(next.protein);
  const cb = roundTo1Decimal(next.carbs);
  const f = roundTo1Decimal(next.fat);
  const fib = roundTo1Decimal(next.fiber);
  return {
    ...item,
    name: next.name,
    quantity: q,
    unit: next.unit,
    calories: c,
    protein: p,
    carbs: cb,
    fat: f,
    fiber: fib,
    baseQuantity: q,
    baseCalories: c,
    baseProtein: p,
    baseCarbs: cb,
    baseFat: f,
    baseFiber: fib,
    portionMultiplier: 1,
  };
}

function sanitizeEditedMacro(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return roundTo1Decimal(n);
}

export interface EditedItemNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

/**
 * Update a staged component's nutrition with user-edited macros.
 * All base* fields are rewritten and baseQuantity is synchronized to current
 * quantity (unless quantity <= 0, in which case baseQuantity is preserved),
 * ensuring subsequent stepper adjustments scale linearly from the edited baseline
 * without precision drift.
 */
export function updateStagedItemNutrition(
  item: StagedItem,
  edited: EditedItemNutrition
): StagedItem {
  const c = sanitizeEditedMacro(edited.calories);
  const p = sanitizeEditedMacro(edited.protein);
  const cb = sanitizeEditedMacro(edited.carbs);
  const f = sanitizeEditedMacro(edited.fat);
  const fib = sanitizeEditedMacro(edited.fiber);
  const baseQuantity = item.quantity > 0 ? item.quantity : item.baseQuantity;

  return {
    ...item,
    calories: c,
    protein: p,
    carbs: cb,
    fat: f,
    fiber: fib,
    baseCalories: c,
    baseProtein: p,
    baseCarbs: cb,
    baseFat: f,
    baseFiber: fib,
    baseQuantity,
    portionMultiplier: 1,
    userOverridden: true,
  };
}

export interface StagedMeal {
  name: string;
  mealType: string;
  explanation: string;
  items: StagedItem[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  servingSize: number;
  servingUnit: string;
  photoUrl?: string;
  notes?: string | null;
  /**
   * D46: whole-meal scale relative to the meal as it was staged / opened
   * (1 or undefined = as staged). UI state only: never persisted, the items
   * themselves carry the scaled amounts.
   */
  scale?: number;
  /** Provenance of the staged meal: 'ai', 'local', or 'manual' */
  source?: 'ai' | 'local' | 'manual';
  /** Original unparsed raw text input if staged locally */
  rawText?: string;
  /** Original ISO capture timestamp from AI queue */
  capturedAt?: string;
  /** Original civil capture date from AI queue */
  captureDate?: string;
  /** AI queue item ID if staged from AI queue */
  aiqItemId?: string;
}

let itemSequence = 0;
export function generateItemId(): string {
  itemSequence += 1;
  return `item-${Date.now()}-${itemSequence}`;
}

export function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build a staged component, deriving its canonical (quantity, unit) from the
 * free-text portion string. The portion string itself is kept verbatim: it is
 * the provenance escape hatch that makes any future re-interpretation possible.
 */
export function buildStagedItem(raw: {
  name: string;
  portion?: string | null;
  calories?: unknown;
  protein?: unknown;
  carbs?: unknown;
  fat?: unknown;
  fiber?: unknown;
  /** Present only when re-staging something that was already scaled. */
  base?: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  quantity?: unknown;
  unit?: unknown;
  portionMultiplier?: unknown;
}): StagedItem {
  const portion = raw.portion || '1 serving';
  const derived = convertPortion(portion);
  const quantity =
    raw.quantity !== undefined && raw.quantity !== null && Number.isFinite(Number(raw.quantity))
      ? Math.max(0, Number(raw.quantity))
      : derived.quantity;
  const unit: CanonicalUnit =
    raw.unit === 'g' || raw.unit === 'ml' || raw.unit === 'unit' ? raw.unit : derived.unit;

  const current = {
    calories: roundTo1Decimal(toNumber(raw.calories)),
    protein: roundTo1Decimal(toNumber(raw.protein)),
    carbs: roundTo1Decimal(toNumber(raw.carbs)),
    fat: roundTo1Decimal(toNumber(raw.fat)),
    fiber: roundTo1Decimal(toNumber(raw.fiber)),
  };
  const base = raw.base
    ? {
        calories: roundTo1Decimal(raw.base.calories),
        protein: roundTo1Decimal(raw.base.protein),
        carbs: roundTo1Decimal(raw.base.carbs),
        fat: roundTo1Decimal(raw.base.fat),
        fiber: roundTo1Decimal(raw.base.fiber),
      }
    : current;

  const mult = Number(raw.portionMultiplier);
  const baseQuantity =
    raw.base && Number.isFinite(mult) && mult > 0
      ? quantity / mult
      : quantity;

  return {
    id: generateItemId(),
    name: raw.name,
    portion,
    portionMultiplier: Number.isFinite(Number(raw.portionMultiplier)) ? Number(raw.portionMultiplier) : 1,
    quantity: roundTo1Decimal(quantity),
    unit,
    baseQuantity: roundTo1Decimal(baseQuantity),
    baseCalories: base.calories,
    baseProtein: base.protein,
    baseCarbs: base.carbs,
    baseFat: base.fat,
    baseFiber: base.fiber,
    ...current,
  };
}

/**
 * D33: Identical item check.
 * Identical item = same name (case-insensitive trimmed), same unit, same per-unit
 * macros (kcal/P/C/F/fiber per unit, compared with epsilon 0.1 or rounded to 1 decimal).
 */
export function isIdenticalItem(existing: StagedItem, incoming: StagedItem): boolean {
  if (existing.name.trim().toLowerCase() !== incoming.name.trim().toLowerCase()) {
    return false;
  }
  if (existing.unit !== incoming.unit) {
    return false;
  }
  const exQty = existing.quantity > 0 ? existing.quantity : 1;
  const inQty = incoming.quantity > 0 ? incoming.quantity : 1;

  const exPerUnit = {
    calories: (existing.calories ?? 0) / exQty,
    protein: (existing.protein ?? 0) / exQty,
    carbs: (existing.carbs ?? 0) / exQty,
    fat: (existing.fat ?? 0) / exQty,
    fiber: (existing.fiber ?? 0) / exQty,
  };
  const inPerUnit = {
    calories: (incoming.calories ?? 0) / inQty,
    protein: (incoming.protein ?? 0) / inQty,
    carbs: (incoming.carbs ?? 0) / inQty,
    fat: (incoming.fat ?? 0) / inQty,
    fiber: (incoming.fiber ?? 0) / inQty,
  };

  const isMacroClose = (a: number, b: number): boolean =>
    Math.abs(a - b) <= Math.max(1e-6, 0.01 * Math.max(Math.abs(a), Math.abs(b)));

  return (
    isMacroClose(exPerUnit.calories, inPerUnit.calories) &&
    isMacroClose(exPerUnit.protein, inPerUnit.protein) &&
    isMacroClose(exPerUnit.carbs, inPerUnit.carbs) &&
    isMacroClose(exPerUnit.fat, inPerUnit.fat) &&
    isMacroClose(exPerUnit.fiber, inPerUnit.fiber)
  );
}

/**
 * D33: Merge identical items by adding quantity, or append non-identical items in order.
 */
export function mergeOrAppendStagedItems(
  existingItems: StagedItem[],
  incomingItems: StagedItem[]
): StagedItem[] {
  const currentItems = [...existingItems];
  for (const incoming of incomingItems) {
    const existingIdx = currentItems.findIndex((ex) => isIdenticalItem(ex, incoming));
    if (existingIdx >= 0) {
      const existing = currentItems[existingIdx];
      const newQuantity = roundTo1Decimal(existing.quantity + incoming.quantity);
      const scaled = scaleItemToQuantity(stagedReference(existing), newQuantity);
      currentItems[existingIdx] = {
        ...existing,
        portion: `${roundTo1Decimal(scaled.quantity)} ${existing.unit}`,
        quantity: roundTo1Decimal(scaled.quantity),
        calories: roundTo1Decimal(scaled.calories),
        protein: roundTo1Decimal(scaled.protein),
        carbs: roundTo1Decimal(scaled.carbs),
        fat: roundTo1Decimal(scaled.fat),
        fiber: roundTo1Decimal(scaled.fiber),
        portionMultiplier: existing.baseQuantity > 0 ? scaled.quantity / existing.baseQuantity : 1,
      };
    } else {
      currentItems.push(incoming);
    }
  }
  return currentItems;
}

/**
 * Re-derive the staged parent from its components. Called after every component
 * edit so `parent = SUM(items)` holds continuously rather than only at save
 * time — which is also exactly what the database constraint checks.
 */
export function recomputeStagedTotals(items: StagedItem[]) {
  const totals = sumItems(items.map(stagedToItem));
  const explanation =
    items.map((it) => `${formatCalories(it.calories)} kcal (${it.name})`).join(' + ') +
    ` = ${formatCalories(totals.calories)} kcal`;
  return {
    calories: roundTo1Decimal(totals.calories),
    protein: roundTo1Decimal(totals.protein),
    carbs: roundTo1Decimal(totals.carbs),
    fat: roundTo1Decimal(totals.fat),
    fiber: roundTo1Decimal(totals.fiber),
    explanation,
  };
}

/** D46: allowed range for the whole-meal scale factor. */
export const MIN_MEAL_SCALE = 0.01;
export const MAX_MEAL_SCALE = 20;

/**
 * Parse what the user typed into the Scale box. Accepts "0.2", ".2", "0,2",
 * a leading "x"/"×", and a simple fraction ("1/5") for keyboards that have
 * a slash. Returns the factor rounded to 2 decimals, or null when it is not a
 * usable number in [MIN_MEAL_SCALE, MAX_MEAL_SCALE].
 */
export function parseMealScaleInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/^[x×*]\s*/i, '').replace(',', '.');
  if (cleaned === '') return null;
  let value: number;
  const fraction = /^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/.exec(cleaned);
  if (fraction) {
    const den = Number(fraction[2]);
    if (!(den > 0)) return null;
    value = Number(fraction[1]) / den;
  } else if (/^\d*\.?\d+$/.test(cleaned)) {
    value = Number(cleaned);
  } else {
    return null;
  }
  const rounded = Math.round(value * 100) / 100;
  if (!Number.isFinite(rounded) || rounded < MIN_MEAL_SCALE || rounded > MAX_MEAL_SCALE) {
    return null;
  }
  return rounded;
}

/** "0.2", "1.5", "2": at most 2 decimals, no trailing zeros. */
export function formatMealScale(scale: number): string {
  return String(Math.round(scale * 100) / 100);
}

/** Quantities keep 4 decimals so ×0.33 then ×1 returns exactly to the start. */
function roundQuantity(q: number): number {
  return Math.round(q * 10000) / 10000;
}

/**
 * D46: scale every item of a meal to `nextScale`, where the scale is relative
 * to the meal as it was staged/opened (1 = as staged).
 *
 * The change is applied as a ratio to the CURRENT items (next / current), so
 * per-item edits made while scaled are kept. Macros are always recomputed
 * from each item's base reference, so repeated scaling never drifts.
 */
export function scaleStagedMeal(meal: StagedMeal, nextScale: number): StagedMeal {
  const current = meal.scale && meal.scale > 0 ? meal.scale : 1;
  if (!(nextScale > 0) || !Number.isFinite(nextScale)) return meal;
  const ratio = nextScale / current;
  if (ratio === 1) return meal;

  const items = meal.items.map((it) => {
    if (!(it.quantity > 0) || !(it.baseQuantity > 0)) {
      // No quantity to scale against (e.g. "1 serving" parsed as 0): scale
      // the macros themselves and leave the quantity as it is.
      const direct = scaleItem(stagedToItem(it), ratio);
      return {
        ...it,
        calories: roundTo1Decimal(direct.calories),
        protein: roundTo1Decimal(direct.protein),
        carbs: roundTo1Decimal(direct.carbs),
        fat: roundTo1Decimal(direct.fat),
        fiber: roundTo1Decimal(direct.fiber),
      };
    }
    const q = roundQuantity(it.quantity * ratio);
    const scaled = scaleItemToQuantity(stagedReference(it), q);
    return {
      ...it,
      quantity: q,
      portion: `${roundTo1Decimal(q)} ${it.unit}`,
      calories: roundTo1Decimal(scaled.calories),
      protein: roundTo1Decimal(scaled.protein),
      carbs: roundTo1Decimal(scaled.carbs),
      fat: roundTo1Decimal(scaled.fat),
      fiber: roundTo1Decimal(scaled.fiber),
    };
  });

  const totals = recomputeStagedTotals(items);
  const single = items.length === 1 ? items[0] : null;
  return {
    ...meal,
    items,
    ...totals,
    ...(single
      ? {
          explanation: `${formatCalories(totals.calories)} kcal (${meal.name})`,
          ...(single.quantity > 0
            ? {
                servingSize: single.quantity,
                servingUnit: single.unit,
              }
            : {}),
        }
      : {}),
    scale: nextScale === 1 ? undefined : nextScale,
  };
}

/**
 * Build a single-item StagedMeal from manual meal form data.
 */
export function buildStagedMealFromManualData(
  data: ManualMealStagedData,
  photoUrl?: string
): StagedMeal {
  const item = buildStagedItem({
    name: data.food_name,
    portion: `${data.serving_size} ${data.serving_unit}`,
    quantity: data.serving_size,
    unit: (data.serving_unit === 'g' || data.serving_unit === 'ml' || data.serving_unit === 'unit')
      ? data.serving_unit
      : 'unit',
    calories: data.calories,
    protein: data.protein,
    carbs: data.carbs,
    fat: data.fat,
    fiber: data.fiber,
  });

  return {
    name: data.food_name,
    mealType: data.meal_type || 'Breakfast',
    explanation: `${formatCalories(data.calories)} kcal (${data.food_name})`,
    items: [item],
    calories: data.calories,
    protein: data.protein,
    carbs: data.carbs,
    fat: data.fat,
    fiber: data.fiber,
    servingSize: data.serving_size,
    servingUnit: data.serving_unit,
    photoUrl,
  };
}

/**
 * Restores focus to the AI input textarea (or section heading if unrendered)
 * when the staged meal card closes, provided focus was inside the card.
 */
export function useStagedCardFocus(isStaged: boolean) {
  const cardContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const prevIsStagedRef = useRef(isStaged);

  const lastPointerTypeRef = useRef<string | null>(null);
  const lastModalityRef = useRef<'keyboard' | 'pointer' | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onPointerDown = (e: PointerEvent) => {
      lastPointerTypeRef.current = e.pointerType || null;
      lastModalityRef.current = 'pointer';
    };

    const onKeyDown = () => {
      lastPointerTypeRef.current = null;
      lastModalityRef.current = 'keyboard';
    };

    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, []);

  const decideFocusRestore = (
    triggerEvent?: React.UIEvent | UIEvent | { detail?: number; pointerType?: string } | null
  ) => {
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    const isInsideCard = Boolean(activeEl && cardContainerRef.current?.contains(activeEl));
    if (!isInsideCard) {
      shouldRestoreFocusRef.current = false;
      return;
    }

    // Explicit pointerType from event or tracked pointerdown
    const eventPointerType =
      (triggerEvent as any)?.pointerType ?? (triggerEvent as any)?.nativeEvent?.pointerType;

    const isTouchOrPen =
      eventPointerType === 'touch' ||
      eventPointerType === 'pen' ||
      lastPointerTypeRef.current === 'touch' ||
      lastPointerTypeRef.current === 'pen';

    if (isTouchOrPen) {
      shouldRestoreFocusRef.current = false;
      return;
    }

    // Keyboard activation:
    // (a) click event.detail === 0 (standard browser behavior for Enter/Space on focused button)
    // (b) last input modality was keydown
    // Keyboard activation strictly wins over coarse pointer heuristics.
    const isKeyboard =
      lastModalityRef.current === 'keyboard' ||
      (triggerEvent && typeof triggerEvent.detail === 'number' && triggerEvent.detail === 0);

    // Mouse on fine pointer:
    const hasFinePointer =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(pointer: fine)').matches
        : true;

    const isMouse =
      (eventPointerType === 'mouse' || lastPointerTypeRef.current === 'mouse') && hasFinePointer;

    const isCoarseOnly =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(pointer: coarse)').matches &&
      !window.matchMedia('(pointer: fine)').matches;

    if (isKeyboard || isMouse) {
      shouldRestoreFocusRef.current = true;
    } else if (isCoarseOnly) {
      shouldRestoreFocusRef.current = false;
    } else if (!triggerEvent && lastPointerTypeRef.current === null) {
      // In tests/helpers without pointerdown on desktop / jsdom:
      shouldRestoreFocusRef.current = true;
    } else {
      shouldRestoreFocusRef.current = false;
    }
  };

  useEffect(() => {
    if (prevIsStagedRef.current && !isStaged) {
      if (shouldRestoreFocusRef.current) {
        shouldRestoreFocusRef.current = false;
        const active = document.activeElement;
        const focusMovedElsewhere =
          active &&
          active !== document.body &&
          active !== document.documentElement &&
          !cardContainerRef.current?.contains(active);

        if (!focusMovedElsewhere) {
          if (textareaRef.current) {
            textareaRef.current.focus();
          } else if (headingRef.current) {
            headingRef.current.focus();
          }
        }
      }
    }
    prevIsStagedRef.current = isStaged;
  }, [isStaged]);

  return {
    cardContainerRef,
    textareaRef,
    headingRef,
    decideFocusRestore,
    cardFocusProps: {
      ref: cardContainerRef,
    },
  };
}
