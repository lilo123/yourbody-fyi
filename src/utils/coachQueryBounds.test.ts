import { describe, it, expect } from 'vitest';
import { nutritionRowLimitForRange, NUTRITION_ROWS_PER_DAY_CEILING } from './coachQueryBounds';

describe('nutritionRowLimitForRange', () => {
  it('scales the bound with the selected range', () => {
    expect(nutritionRowLimitForRange(7)).toBe(7 * NUTRITION_ROWS_PER_DAY_CEILING);
    expect(nutritionRowLimitForRange(14)).toBe(14 * NUTRITION_ROWS_PER_DAY_CEILING);
    expect(nutritionRowLimitForRange(30)).toBe(30 * NUTRITION_ROWS_PER_DAY_CEILING);
  });

  it('covers a realistic logging rate across every range the selector offers', () => {
    // The regression: a flat 100-row cap truncated a 14-day view after ~6 days.
    const REALISTIC_ITEMS_PER_DAY = 15;
    for (const days of [7, 14, 30]) {
      expect(nutritionRowLimitForRange(days)).toBeGreaterThanOrEqual(days * REALISTIC_ITEMS_PER_DAY);
    }
    // ...and specifically beats the old flat cap on the default range.
    expect(nutritionRowLimitForRange(14)).toBeGreaterThan(100);
  });

  it('never returns a non-positive or fractional bound', () => {
    // PostgREST rejects a non-integer limit and a limit of 0 would return nothing.
    for (const bad of [0, -5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const limit = nutritionRowLimitForRange(bad);
      expect(Number.isInteger(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);
    }
  });

  it('rounds a fractional range up rather than down', () => {
    expect(nutritionRowLimitForRange(6.2)).toBe(7 * NUTRITION_ROWS_PER_DAY_CEILING);
  });
});
