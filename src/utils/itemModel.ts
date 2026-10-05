/**
 * The level-2 component model.
 *
 * A level-1 parent (a nutrition_log or a custom_dish) owns an `items` array of
 * level-2 components. The parent's macros are always the sum of its items —
 * "items win" — because the alternative, preferring a model-supplied top-level
 * scalar, is what generated the only macro drift ever observed in production.
 *
 * Two invariants the database also enforces, restated here because the client
 * is where they are cheap to hold:
 *   * a row with no components stores NULL, never []
 *   * parent macros are never rounded on persist; rounding happens at render
 */

import { convertPortion, parseQuantityInput, type CanonicalUnit } from './unitConverter';
import type { Json } from '../types/supabase';

export interface NutritionItem {
  id: string;
  name: string;
  /** Quantity in `unit`. Never rounded. */
  quantity: number;
  unit: CanonicalUnit;
  /**
   * The original free-text portion string, preserved verbatim. This is the
   * provenance escape hatch: if the converter is ever revisited, this is what
   * makes re-interpretation possible.
   */
  displayPortion?: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  [key: string]: Json | undefined;
}

export interface MacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const;

/** Matches the database epsilon: 0.05 per item. */
export const SUM_EPSILON_PER_ITEM = 0.05;

/** Upper bound on the items array, matching the shape CHECK. */
export const MAX_ITEMS = 50;

const ZERO: MacroTotals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function nonNegative(value: unknown): number {
  return Math.max(0, num(value));
}

function isCanonicalUnit(value: unknown): value is CanonicalUnit {
  return value === 'g' || value === 'ml' || value === 'unit';
}

/**
 * A row with >= 2 components is a level-1 parent. A row with 0 or 1 is a
 * level-2 leaf, and must render without a chevron or a count badge — all 98
 * existing production logs are leaves, and if they all look expandable the
 * feature looks broken on day one.
 */
export function deriveLevel(items: NutritionItem[] | null | undefined): 1 | 2 {
  return items && items.length >= 2 ? 1 : 2;
}

export function isLevel1(items: NutritionItem[] | null | undefined): boolean {
  return deriveLevel(items) === 1;
}

/**
 * Coerce whatever came back from the database (or from an old client) into a
 * usable items array.
 *
 * Returns null — never [] — for anything that is not a usable non-empty array
 * of objects, so callers can persist the result straight back.
 */
export function normalizeItems(raw: unknown): NutritionItem[] | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || value.length === 0) return null;

  const items: NutritionItem[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const row = entry as Record<string, unknown>;
    const displayPortion =
      typeof row.displayPortion === 'string'
        ? row.displayPortion
        : typeof row.portion === 'string'
          ? row.portion
          : null;

    // Legacy rows carry only a free-text portion; derive the canonical pair
    // lazily rather than trusting a second, divergent converter.
    const derived = convertPortion(displayPortion);
    const quantity = Number.isFinite(Number(row.quantity)) && row.quantity !== null && row.quantity !== undefined
      ? Math.max(0, Number(row.quantity))
      : derived.quantity;
    const unit = isCanonicalUnit(row.unit) ? row.unit : derived.unit;

    items.push({
      id: typeof row.id === 'string' && row.id ? row.id : `item-${index}`,
      name: typeof row.name === 'string' && row.name.trim() ? row.name : 'Item',
      quantity,
      unit,
      displayPortion,
      calories: nonNegative(row.calories),
      protein: nonNegative(row.protein),
      carbs: nonNegative(row.carbs),
      fat: nonNegative(row.fat),
      fiber: nonNegative(row.fiber),
    });
  });

  return items.length > 0 ? items : null;
}

/**
 * Client-side mirror of the SQL backfill guard
 * (`private.safe_items_array` in the Phase 2 migration).
 *
 * Returns null — never [] — for NULL, blank, non-JSON, a JSON object, a JSON
 * scalar, truncated JSON, an empty array, or an array containing no objects.
 * Only a non-empty JSON array of objects backfills.
 */
export function safeItemsArray(txt: string | null | undefined): unknown[] | null {
  if (txt === null || txt === undefined) return null;
  if (typeof txt !== 'string' || txt.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(txt);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0) return null;
  return parsed;
}

/**
 * Mirror of `private.items_from_ingredients`. Used when a custom dish has no
 * `items` yet — an un-backfilled row, or one written by a client that predates
 * the column — so the breakdown is still visible instead of collapsing to a
 * single row.
 *
 * Clamps every macro with max(x, 0) and preserves the original portion string
 * verbatim, exactly as the SQL does.
 */
export function itemsFromLegacyIngredients(
  dishId: string,
  dishName: string,
  ingredients: string | null | undefined
): NutritionItem[] | null {
  const arr = safeItemsArray(ingredients);
  if (!arr) return null;

  const items: NutritionItem[] = [];
  arr.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const row = entry as Record<string, unknown>;
    const displayPortion = typeof row.portion === 'string' ? row.portion : null;
    const derived = convertPortion(displayPortion);
    items.push({
      id: `bf-${dishId}-${index}`,
      name: typeof row.name === 'string' && row.name.trim() ? row.name : dishName,
      quantity: derived.quantity,
      unit: derived.unit,
      displayPortion,
      calories: nonNegative(row.calories),
      protein: nonNegative(row.protein),
      carbs: nonNegative(row.carbs),
      fat: nonNegative(row.fat),
      fiber: nonNegative(row.fiber),
    });
  });

  return items.length > 0 ? items : null;
}

/**
 * Serialise for persistence. Returns null for an empty list so the caller can
 * hand the result straight to Supabase: the database rejects [].
 */
export function itemsForPersist(items: NutritionItem[] | null | undefined): NutritionItem[] | null {
  if (!items || items.length === 0) return null;
  return items;
}

export function sumItems(items: NutritionItem[] | null | undefined): MacroTotals {
  if (!items || items.length === 0) return { ...ZERO };
  // No rounding. Roughly half of all production macro values are fractional,
  // so rounding here would visibly corrupt about half the user's history.
  return items.reduce<MacroTotals>(
    (acc, item) => ({
      calories: acc.calories + num(item.calories),
      protein: acc.protein + num(item.protein),
      carbs: acc.carbs + num(item.carbs),
      fat: acc.fat + num(item.fat),
      fiber: acc.fiber + num(item.fiber),
    }),
    { ...ZERO }
  );
}

/**
 * Scale one component by a multiplicative factor. Quantity and all five macros
 * move together and linearly. Nothing is rounded — `Math.round` here is exactly
 * the bug (R-02) that integerised every macro on the first portion tap.
 */
export function scaleItem(item: NutritionItem, factor: number): NutritionItem {
  const f = Number.isFinite(factor) && factor >= 0 ? factor : 1;
  return {
    ...item,
    quantity: item.quantity * f,
    calories: item.calories * f,
    protein: item.protein * f,
    carbs: item.carbs * f,
    fat: item.fat * f,
    fiber: item.fiber * f,
  };
}

/**
 * Re-scale a component to an absolute quantity, relative to a reference.
 *
 * `reference` is the component as it was at quantity `reference.quantity`;
 * passing the same object repeatedly is what makes this idempotent and free of
 * the accumulating-error and dead-end problems of a delta-based stepper. There
 * is no ladder to get stranded on: any quantity is reachable in one edit, and
 * so is the original.
 */
export function scaleItemToQuantity(reference: NutritionItem, nextQuantity: number): NutritionItem {
  const q = Number.isFinite(nextQuantity) && nextQuantity >= 0 ? nextQuantity : reference.quantity;
  if (!(reference.quantity > 0)) {
    // No ratio is derivable from a zero reference; move the quantity and leave
    // the macros alone rather than inventing a number.
    return { ...reference, quantity: q };
  }
  return scaleItem(reference, q / reference.quantity);
}

/**
 * Re-express a component in a new unit without changing how much food it is.
 * Macros are preserved exactly.
 */
export function reanchorItemTo(
  item: NutritionItem,
  nextQuantity: number,
  nextUnit: CanonicalUnit
): NutritionItem {
  const parsed = parseQuantityInput(nextQuantity);
  if (parsed === null) {
    return item;
  }
  return {
    ...item,
    quantity: parsed,
    unit: nextUnit,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    fiber: item.fiber,
  };
}

export function scaleItems(items: NutritionItem[], factor: number): NutritionItem[] {
  return items.map((item) => scaleItem(item, factor));
}

/**
 * Does the parent agree with the sum of its items, within the database's
 * item-count-aware epsilon? Mirrors chk_*_parent_equals_items_sum.
 */
export function parentMatchesItems(
  parent: Partial<MacroTotals>,
  items: NutritionItem[] | null | undefined
): boolean {
  if (!items || items.length === 0) return true;
  const totals = sumItems(items);
  const epsilon = SUM_EPSILON_PER_ITEM * items.length;
  return MACRO_KEYS.every((key) => Math.abs(num(parent[key]) - totals[key]) <= epsilon);
}
