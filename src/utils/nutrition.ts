/**
 * Nutrition calculation and formatting utilities with IEEE-754 precision protection.
 */

export interface DailyMacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface MacroTargets {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  target_calories?: number;
  target_protein?: number;
  target_carbs?: number;
  target_fat?: number;
  target_fiber?: number;
}

export interface FuelItem {
  rawDiff: number;
  formattedValue: string;
  isOver: boolean;
  badgeLabel: string;
}

export interface RemainingFuel {
  calories: FuelItem;
  protein: FuelItem;
  carbs: FuelItem;
  fat: FuelItem;
  fiber: FuelItem;
}

/**
 * Formats calorie values to whole integers, safely handling null/undefined/NaN/Infinity,
 * negative zero, string values, and minor floating-point drift.
 */
export function formatCalories(val: number | string | null | undefined): string {
  if (val == null) return '0';
  const num = Number(val);
  if (isNaN(num) || !isFinite(num) || Math.abs(num) < 0.5) return '0';
  const sign = num < 0 ? -1 : 1;
  const rounded = sign * Math.round(Math.abs(num));
  if (rounded === 0 || Object.is(rounded, -0)) {
    return '0';
  }
  return rounded.toString();
}

/**
 * Formats macronutrient values to at most 1 decimal place with trailing zeros stripped.
 * Sanitizes negative zero, string values, non-finite values, and near-zero drift (< 0.05 -> '0').
 */
export function formatMacro(val: number | string | null | undefined): string {
  if (val == null) return '0';
  const num = Number(val);
  if (isNaN(num) || !isFinite(num) || Math.abs(num) < 0.05) {
    return '0';
  }
  const sign = num < 0 ? -1 : 1;
  const rounded = (sign * Math.round(Math.abs(num) * 10)) / 10;
  if (rounded === 0 || Object.is(rounded, -0) || Math.abs(rounded) < 0.05) {
    return '0';
  }
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
}

/**
 * Rounds a number to at most 1 decimal place, returning a clean numeric float/integer.
 * Sanitizes negative zero, non-finite values, string numbers, and near-zero drift (< 0.05 -> 0).
 */
export function roundTo1Decimal(val: number | string | null | undefined): number {
  if (val == null) return 0;
  const num = Number(val);
  if (isNaN(num) || !isFinite(num) || Math.abs(num) < 0.05) {
    return 0;
  }
  const sign = num < 0 ? -1 : 1;
  const rounded = (sign * Math.round(Math.abs(num) * 10)) / 10;
  if (rounded === 0 || Object.is(rounded, -0) || Math.abs(rounded) < 0.05) {
    return 0;
  }
  return rounded;
}

/**
 * Calculates remaining fuel across all 5 macronutrients compared against daily targets.
 * Handles IEEE-754 floating point arithmetic drift, over-budget states, and partial inputs.
 *
 * For each macro, returns:
 * - rawDiff: target - current (positive when remaining, negative when over)
 * - formattedValue: clean formatted numeric difference
 * - isOver: true if current exceeded target
 * - badgeLabel: "+X kcal over" / "+Xg P over" when over; "X kcal" / "Xg P" when remaining
 */
export function calculateRemainingFuel(
  dailyTotals?: Partial<DailyMacroTotals> | null,
  targets?: Partial<MacroTargets> | null
): RemainingFuel {
  const safeTotals = dailyTotals ?? {};
  const safeTargets = targets ?? {};

  // Calorie calculation
  const targetCal = Number(safeTargets.calories ?? safeTargets.target_calories) || 0;
  const currentCal = Number(safeTotals.calories) || 0;
  let rawCalDiff = targetCal - currentCal;
  if (Math.abs(rawCalDiff) < 0.5 || Object.is(rawCalDiff, -0)) {
    rawCalDiff = 0;
  } else {
    rawCalDiff = Math.round(rawCalDiff);
  }
  const calOver = rawCalDiff < 0;
  const calAbs = Math.abs(rawCalDiff);
  const calFormatted = formatCalories(calAbs);
  const calBadgeLabel = calOver ? `+${calFormatted} kcal over` : `${calFormatted} kcal`;

  // Helper for gram-based macronutrients
  const computeMacroFuel = (
    current: number | string | null | undefined,
    target: number | string | null | undefined,
    unitSuffix: string
  ): FuelItem => {
    const c = Number(current) || 0;
    const t = Number(target) || 0;
    let diff = t - c;
    // Sanitize near-zero drift (< 0.05) and negative zero
    if (Math.abs(diff) < 0.05 || Object.is(diff, -0)) {
      diff = 0;
    } else {
      diff = Math.round(diff * 10) / 10;
    }
    const isOver = diff < 0;
    const absDiff = Math.abs(diff);
    const formattedValue = formatMacro(absDiff);
    const badgeLabel = isOver
      ? `+${formattedValue}g ${unitSuffix} over`
      : `${formattedValue}g ${unitSuffix}`;

    return {
      rawDiff: diff,
      formattedValue,
      isOver,
      badgeLabel,
    };
  };

  const protein = computeMacroFuel(
    safeTotals.protein,
    safeTargets.protein ?? safeTargets.target_protein,
    'P'
  );

  const carbs = computeMacroFuel(
    safeTotals.carbs,
    safeTargets.carbs ?? safeTargets.target_carbs,
    'C'
  );

  const fat = computeMacroFuel(
    safeTotals.fat,
    safeTargets.fat ?? safeTargets.target_fat,
    'F'
  );

  const fiber = computeMacroFuel(
    safeTotals.fiber,
    safeTargets.fiber ?? safeTargets.target_fiber,
    'Fib'
  );

  return {
    calories: {
      rawDiff: rawCalDiff,
      formattedValue: calFormatted,
      isOver: calOver,
      badgeLabel: calBadgeLabel,
    },
    protein,
    carbs,
    fat,
    fiber,
  };
}

/**
 * Formats a ratio as an adaptive percentage string.
 * Non-zero contributions strictly less than 1% are formatted as `<1%`.
 * Zero, negative, non-finite, or zero-total values format as `0%`.
 * Other values format as rounded whole percentages, e.g. `45%`.
 */
export function formatPercentage(
  val: number | string | null | undefined,
  total: number | string | null | undefined
): string {
  if (val == null || total == null) return '0%';
  const numVal = Number(val);
  const numTotal = Number(total);
  if (
    !Number.isFinite(numVal) ||
    !Number.isFinite(numTotal) ||
    numTotal <= 0 ||
    numVal <= 0
  ) {
    return '0%';
  }
  const pct = (numVal / numTotal) * 100;
  if (pct >= 0.005 && pct < 1) {
    return '<1%';
  }
  if (pct < 0.005) {
    return '0%';
  }
  return `${Math.round(pct)}%`;
}

export interface KcalMacroMismatchParams {
  kcal?: number | string | null;
  calories?: number | string | null;
  protein?: number | string | null;
  carbs?: number | string | null;
  fat?: number | string | null;
  fiber?: number | string | null;
}

export interface KcalMacroMismatchResult {
  estimatedKcal: number;
  diff: number;
  message: string;
}

function parseMacroInput(val: number | string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    const num = Number(trimmed);
    if (!Number.isFinite(num) || isNaN(num) || num < 0) return null;
    return num;
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || isNaN(val) || val < 0) return null;
    return val;
  }
  return null;
}

/**
 * Computes calorie vs macronutrient estimate (4*P + 4*C + 9*F; fiber ignored).
 * Returns null if any of kcal/P/C/F is empty or unparseable.
 * Shows hint when |kcal - est| > 0.15 * est AND |kcal - est| > 50 (both strict).
 * If est == 0, percentage condition is met and only diff > 50 decides.
 */
export function kcalMacroMismatch(
  params: KcalMacroMismatchParams
): KcalMacroMismatchResult | null {
  const rawKcal = params.kcal !== undefined ? params.kcal : params.calories;
  const k = parseMacroInput(rawKcal);
  const p = parseMacroInput(params.protein);
  const c = parseMacroInput(params.carbs);
  const f = parseMacroInput(params.fat);

  if (k === null || p === null || c === null || f === null) {
    return null;
  }

  const est = 4 * p + 4 * c + 9 * f;
  const diff = Math.abs(k - est);

  const percentCondition = est === 0 ? true : diff > 0.15 * est;
  const diffCondition = diff > 50;

  if (percentCondition && diffCondition) {
    const rounded = Math.round(est);
    return {
      estimatedKcal: rounded,
      diff,
      message: `Macros add up to ≈ ${formatCalories(rounded)} kcal`,
    };
  }

  return null;
}
