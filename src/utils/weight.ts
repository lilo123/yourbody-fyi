/**
 * Canonical Weight & Unit Conversion Utilities
 *
 * Guarantees:
 * 1. Canonical storage unit in PostgreSQL is pounds (lb) with full precision.
 * 2. Conversions only happen at display and input boundaries.
 * 3. Display rounding: lb 0.5, kg 0.1.
 * 4. 0 lbs or null bodyweight formats consistently as "BW" / "BW×reps".
 * 5. Uses multiplication symbol "×" (U+00D7) across all formatted sets.
 */

export type WeightUnit = 'lb' | 'kg';

const LB_PER_KG = 2.20462262185;
const KG_PER_LB = 0.45359237;

/**
 * Converts pounds to kilograms.
 */
export function lbToKg(lb: number): number {
  if (!lb || isNaN(lb)) return 0;
  return lb * KG_PER_LB;
}

/**
 * Converts kilograms to pounds.
 */
export function kgToLb(kg: number): number {
  if (!kg || isNaN(kg)) return 0;
  return kg * LB_PER_KG;
}

/**
 * Rounds a number to the nearest 0.5 step.
 */
export function roundToHalf(val: number): number {
  return Math.round(val * 2) / 2;
}

/**
 * Converts a weight value between units.
 * Display rounding: lb rounds to 0.5, kg rounds to 0.1.
 */
export function convertWeight(weight: number, fromUnit: WeightUnit, toUnit: WeightUnit): number {
  if (!weight || isNaN(weight)) return 0;
  if (fromUnit === toUnit) return weight;
  if (fromUnit === 'lb' && toUnit === 'kg') {
    return Math.round(lbToKg(weight) * 10) / 10;
  }
  if (fromUnit === 'kg' && toUnit === 'lb') {
    return roundToHalf(kgToLb(weight));
  }
  return weight;
}

/**
 * Returns the canonical display unit label.
 * The 'lbs' literal lives ONLY here in product code.
 */
export function weightUnitLabel(unit: WeightUnit = 'lb'): 'lbs' | 'kg' {
  return unit === 'kg' ? 'kg' : 'lbs';
}

export interface FormatWeightOptions {
  showUnit?: boolean;
}

/**
 * Formats a weight value for display.
 * 0 or null represents bodyweight ("BW").
 * kg display rounds to 0.1 and drops trailing '.0'.
 */
export function formatWeight(
  weight: number | null | undefined,
  unit: WeightUnit = 'lb',
  options?: FormatWeightOptions
): string {
  if (weight == null || weight === 0 || isNaN(Number(weight))) {
    return 'BW';
  }

  const numWeight = Number(weight);
  const displayVal = unit === 'kg' ? convertWeight(numWeight, 'lb', 'kg') : roundToHalf(numWeight);

  if (options?.showUnit) {
    return `${displayVal} ${weightUnitLabel(unit)}`;
  }

  return String(displayVal);
}

/**
 * Formats a set (weight and reps) into canonical string notation (e.g. "100×8", "102.1×5", "BW×10").
 */
export function formatSet(
  weight: number | null | undefined,
  reps: number | null | undefined,
  unit: WeightUnit = 'lb'
): string {
  const isBW = weight == null || weight === 0 || isNaN(Number(weight));
  const hasReps = reps != null && !isNaN(Number(reps));

  if (isBW) {
    return hasReps ? `BW×${reps}` : 'BW';
  }

  const weightStr = formatWeight(weight, unit);
  return hasReps ? `${weightStr}×${reps}` : weightStr;
}

/**
 * Formats total workout volume in the given unit.
 * Converted once at display boundary with integer en-US grouping and unit suffix.
 */
export function formatVolume(
  lb: number | null | undefined,
  unit: WeightUnit = 'lb'
): string {
  if (lb == null || isNaN(Number(lb))) {
    return `0 ${weightUnitLabel(unit)}`;
  }

  const numWeight = Number(lb);
  const converted = unit === 'kg' ? convertWeight(numWeight, 'lb', 'kg') : numWeight;
  const roundedInt = Math.round(converted);
  return `${roundedInt.toLocaleString('en-US')} ${weightUnitLabel(unit)}`;
}

/**
 * Converts a stored lb weight value to a display number suitable for input prefill.
 * lb: preserved unchanged with full precision (no rounding).
 * kg: rounded to 0.1 decimal.
 */
export function toDisplayWeight(
  lb: number | null | undefined,
  unit: WeightUnit = 'lb'
): number {
  if (lb == null || isNaN(Number(lb))) return 0;
  const numWeight = Number(lb);
  if (unit === 'kg') {
    return convertWeight(numWeight, 'lb', 'kg');
  }
  return numWeight;
}

/**
 * Resolves user weight input into canonical storage pounds (lb).
 * If the input matches the prefilled display representation of originalLb,
 * the original stored value is preserved exactly without round-trip drift.
 * Otherwise, the draft string is parsed in the active unit.
 */
export function resolveWeightInput(
  draft: string,
  unit: WeightUnit = 'lb',
  originalLb?: number | null
): number | null {
  if (typeof originalLb === 'number' && !isNaN(originalLb)) {
    const prefillStr = String(toDisplayWeight(originalLb, unit));
    if (typeof draft === 'string' && draft.trim() === prefillStr) {
      return originalLb;
    }
  }
  return parseWeightInput(draft, unit);
}

/**
 * Parses user weight input into canonical storage pounds (lb).
 * Understands "BW" / "0" as bodyweight (0).
 * Full precision for kg input (100 kg -> 220.462262185 lb).
 */
export function parseWeightInput(input: string, unit: WeightUnit = 'lb'): number | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;

  if (trimmed.toUpperCase() === 'BW' || trimmed === '0') {
    return 0;
  }

  const num = Number(trimmed);
  if (isNaN(num) || num < 0) {
    return null;
  }

  if (unit === 'kg') {
    return kgToLb(num);
  }

  return num;
}
