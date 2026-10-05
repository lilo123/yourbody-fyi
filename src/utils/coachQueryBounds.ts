/**
 * Row bounds for the coach cockpit's athlete queries.
 *
 * Kept out of CoachCockpit.tsx because that file sits against the 600-LOC component
 * budget enforced by scripts/verify-perf-budget.js (maxComponentLoc).
 */

/**
 * Per-day ceiling used to size the coach nutrition query against the selected range.
 *
 * A flat cap silently dropped whole days: at a realistic ~15 items/day a 100-row cap is
 * exhausted after ~6 days, while the default range is 14 days and the selector offers 30.
 * Deriving the bound from the range means truncation can no longer bite inside the window
 * the coach is actually looking at. This is a ceiling, not a fetch size -- the payload only
 * grows for an athlete who genuinely logged that much.
 */
export const NUTRITION_ROWS_PER_DAY_CEILING = 40;

/**
 * Returns the row bound for a nutrition query covering `daysRange` days.
 *
 * Guards against a zero/negative/fractional range so the result is always a positive
 * integer: PostgREST rejects a non-integer limit, and a limit of 0 would return nothing.
 */
export function nutritionRowLimitForRange(daysRange: number): number {
  if (!Number.isFinite(daysRange)) return NUTRITION_ROWS_PER_DAY_CEILING;
  return Math.max(1, Math.ceil(daysRange)) * NUTRITION_ROWS_PER_DAY_CEILING;
}
