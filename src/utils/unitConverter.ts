/**
 * Portion-string -> canonical (quantity, unit) conversion.
 *
 * This is the TypeScript half of a pair. The other half is
 * `private.portion_to_canonical(text)` in
 * supabase/migrations/20260913160000_nutrition_items_hierarchy.sql, which the
 * backfill uses. The two must agree; unitConverter.test.ts pins them to each
 * other with a literal expectation table for all 17 real production portion
 * strings.
 *
 * Rule order is load-bearing:
 *   1. a parenthesised mass/volume hint beats everything  ('1 g (2 g)' -> 2 g)
 *   2. a leading number immediately followed by a mass/volume unit
 *   3. any fraction -> unsupported, low confidence (do not keep the numerator)
 *   4. a leading number terminated by whitespace or end-of-string -> a count
 *   5. otherwise -> (1, 'unit', 'low')
 *
 * Every numeric capture uses `[0-9]+(\.[0-9]+)?`. A greedy `[\d.]+` matches
 * '1..5', which is not a number: `parseFloat('1..5')` silently returns 1 and
 * `Number('1..5')` returns NaN, so either naive spelling is wrong.
 */

export type CanonicalUnit = 'g' | 'ml' | 'unit';

export type PortionConfidence = 'high' | 'medium' | 'low' | 'default';

export interface CanonicalPortion {
  quantity: number;
  unit: CanonicalUnit;
  confidence: PortionConfidence;
  /** Why the converter gave up, when it did. Absent on a successful parse. */
  reason?: 'negative' | 'fraction' | 'out-of-range' | 'unparseable' | 'empty';
}

/**
 * Sanity ceiling. 100 kg / 100 L of one ingredient is already absurd, and
 * without a ceiling '999999999 g' is accepted verbatim.
 */
export const MAX_QUANTITY = 100000;

/** The eight real parent serving units, plus the three canonical component units. */
export const UNIT_VOCABULARY = [
  'serving',
  'g',
  'ml',
  'meal',
  'bowl',
  'bar',
  'large egg',
  'plate',
] as const;

export const CANONICAL_UNITS: readonly CanonicalUnit[] = ['g', 'ml', 'unit'];

/**
 * Short labels for the unit chip. The chip is width-critical: a chip reading
 * `serving` is 74 px and starves the quantity field to 14 px at a 320 px
 * viewport, where the abbreviated worst case (`plate`) is 44.9 px and leaves
 * 43.1 px. Anything not in the map is already short enough and passes through.
 */
const SHORT_UNIT_LABELS: Readonly<Record<string, string>> = {
  serving: 'srv',
  'large egg': 'egg',
};

export function shortUnitLabel(unit: string | null | undefined): string {
  const key = (unit ?? '').trim().toLowerCase();
  if (!key) return 'unit';
  return SHORT_UNIT_LABELS[key] ?? key;
}

const DEFAULT_PORTION: CanonicalPortion = {
  quantity: 1,
  unit: 'unit',
  confidence: 'default',
  reason: 'empty',
};

function giveUp(reason: CanonicalPortion['reason']): CanonicalPortion {
  return { quantity: 1, unit: 'unit', confidence: 'low', reason };
}

/** Normalise a recognised mass/volume unit to the canonical g / ml. */
function normaliseMassUnit(value: number, rawUnit: string): { quantity: number; unit: CanonicalUnit } {
  switch (rawUnit) {
    case 'kg':
      return { quantity: value * 1000, unit: 'g' };
    case 'mg':
      return { quantity: value / 1000, unit: 'g' };
    case 'l':
      return { quantity: value * 1000, unit: 'ml' };
    case 'ml':
      return { quantity: value, unit: 'ml' };
    default:
      return { quantity: value, unit: 'g' };
  }
}

const PAREN_MASS = /\(\s*([0-9]+(?:\.[0-9]+)?)\s*(kg|mg|g|ml|l)\s*\)/;
const LEADING_MASS = /^([0-9]+(?:\.[0-9]+)?)\s*(kg|mg|g|ml|l)(?![a-z])/;
const FRACTION = /[0-9]\s*\/\s*[0-9]/;
const LEADING_COUNT = /^([0-9]+(?:\.[0-9]+)?)(?:\s|$)/;

export function convertPortion(portion: string | null | undefined): CanonicalPortion {
  if (portion === null || portion === undefined) return DEFAULT_PORTION;

  const s = String(portion).trim().toLowerCase();
  if (s === '') return DEFAULT_PORTION;

  // Rules 1 and 2 share the mass/volume path; the parenthesised hint wins.
  const massMatch = PAREN_MASS.exec(s) ?? LEADING_MASS.exec(s);
  if (massMatch) {
    const raw = Number(massMatch[1]);
    if (!Number.isFinite(raw)) return giveUp('unparseable');
    const { quantity, unit } = normaliseMassUnit(raw, massMatch[2]);
    if (!Number.isFinite(quantity)) return giveUp('unparseable');
    if (quantity <= 0) return giveUp('negative');
    if (quantity > MAX_QUANTITY) return giveUp('out-of-range');
    return { quantity, unit, confidence: 'high' };
  }

  // Rule 3. '1/2 cup' must not be read as '1 cup'.
  if (FRACTION.test(s)) return giveUp('fraction');

  // Rule 4: a bare leading count. '1 tbsp', '2 dollops', '1 cup (unsweetened)'.
  const countMatch = LEADING_COUNT.exec(s);
  if (countMatch) {
    const quantity = Number(countMatch[1]);
    if (!Number.isFinite(quantity)) return giveUp('unparseable');
    if (quantity <= 0) return giveUp('negative');
    if (quantity > MAX_QUANTITY) return giveUp('out-of-range');
    return { quantity, unit: 'unit', confidence: 'medium' };
  }

  // Rule 5. Covers '-5 g' (no leading digit), '1..5 g', '1e3 g' and 'three eggs'.
  return giveUp(s.startsWith('-') ? 'negative' : 'unparseable');
}

export interface ParseDecimalOptions {
  allowNegative?: boolean;
  max?: number;
}

/**
 * Parses free-text numeric input, accepting a single comma as a decimal separator
 * (e.g. "12,5" -> 12.5), mirroring the rules of parseWeightInput in src/utils/weight.ts.
 * Rejects ambiguous inputs (multiple commas, mixed commas and dots, non-finite, negative, or > max).
 * Returns null for unparseable or out-of-range input.
 */
export function parseDecimalInput(
  raw: string | number | null | undefined,
  options?: ParseDecimalOptions
): number | null {
  if (raw === null || raw === undefined) return null;
  const allowNegative = options?.allowNegative ?? false;
  const max = options?.max ?? MAX_QUANTITY;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    if (!allowNegative && raw < 0) return null;
    if (raw > max) return null;
    return raw;
  }

  const trimmed = raw.trim();
  if (trimmed === '') return null;

  let normalized = trimmed;
  if (normalized.includes(',')) {
    if ((normalized.match(/,/g) || []).length > 1 || normalized.includes('.')) {
      return null;
    }
    normalized = normalized.replace(',', '.');
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  if (!allowNegative && n < 0) return null;
  if (n > max) return null;
  return n;
}

/**
 * Guard for the free-text quantity field.
 *
 * Accepts a single comma as decimal separator.
 *
 * Returns null when the input cannot be used, so the caller can keep the
 * previous value rather than silently writing 0.
 */
export function parseQuantityInput(raw: string | number | null | undefined): number | null {
  return parseDecimalInput(raw, { allowNegative: false, max: MAX_QUANTITY });
}
