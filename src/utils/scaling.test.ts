import { describe, it, expect } from 'vitest';
import {
  scaleItem,
  scaleItems,
  scaleItemToQuantity,
  sumItems,
  parentMatchesItems,
  SUM_EPSILON_PER_ITEM,
  type NutritionItem,
} from './itemModel';

function item(overrides: Partial<NutritionItem> = {}): NutritionItem {
  return {
    id: 'i1',
    name: 'Egg Frittata',
    quantity: 100,
    unit: 'g',
    displayPortion: '100 g',
    calories: 182,
    protein: 12.5,
    carbs: 3.2,
    fat: 13.1,
    fiber: 1.2,
    ...overrides,
  };
}

describe('R-02 — scaling must never round on persist', () => {
  // The old handleAdjustPortion applied Math.round to all five macros on every
  // tap. Since ~46% of production protein values and ~53% of fat values are
  // fractional, a single stray tap permanently integerised half the record.
  it('keeps fractional macros fractional', () => {
    const scaled = scaleItem(item(), 0.5);
    expect(scaled.protein).toBe(6.25);
    expect(scaled.carbs).toBe(1.6);
    expect(scaled.fat).toBe(6.55);
    expect(scaled.fiber).toBe(0.6);
    expect(scaled.calories).toBe(91);
  });

  it('produces no integer-valued macro that should have been fractional', () => {
    const scaled = scaleItem(item({ protein: 12.5, fat: 13.1 }), 1.5);
    expect(Number.isInteger(scaled.protein)).toBe(false);
    expect(Number.isInteger(scaled.fat)).toBe(false);
  });

  it('scales the quantity alongside the macros', () => {
    expect(scaleItem(item(), 2).quantity).toBe(200);
  });
});

describe('R-03 — the stranded-multiplier ladder must not reappear', () => {
  // The old control was `Math.max(0.25, mult + delta)` with delta = +/-0.5,
  // producing the one-way ladder 1 -> 0.5 -> 0.25 -> 0.75 -> 1.25. You could
  // not get back to 1. Absolute quantities have no ladder.
  it('reaches the original value in one step from anywhere on the old ladder', () => {
    const base = item();
    for (const stranded of [0.25, 0.5, 0.75, 1.25, 3]) {
      const off = scaleItem(base, stranded);
      const back = scaleItemToQuantity(base, base.quantity);
      expect(off.quantity).not.toBe(base.quantity);
      expect(back).toEqual(base);
    }
  });

  it('is idempotent: re-applying the same absolute quantity does not drift', () => {
    const base = item();
    const once = scaleItemToQuantity(base, 150);
    const twice = scaleItemToQuantity(base, 150);
    expect(once).toEqual(twice);
  });

  it('round-trips: scale away and back gives the original macros', () => {
    const base = item();
    const away = scaleItemToQuantity(base, 37.5);
    expect(away.quantity).toBe(37.5);
    const home = scaleItemToQuantity(base, base.quantity);
    expect(home.calories).toBe(base.calories);
    expect(home.protein).toBe(base.protein);
    expect(home.fat).toBe(base.fat);
  });

  it('never produces the discrete-bar dead end: x1 is always one tap away', () => {
    const base = item();
    for (const factor of [0.5, 1, 1.5, 2]) {
      const scaled = scaleItem(base, factor);
      expect(scaled.quantity).toBe(base.quantity * factor);
    }
    expect(scaleItem(base, 1)).toEqual(base);
  });
});

describe('scaleItemToQuantity edge cases', () => {
  it('scales linearly on quantity', () => {
    const base = item({ quantity: 100, calories: 200 });
    expect(scaleItemToQuantity(base, 50).calories).toBe(100);
    expect(scaleItemToQuantity(base, 250).calories).toBe(500);
  });

  it('accepts zero and yields zero macros, which is recoverable', () => {
    const base = item();
    const zeroed = scaleItemToQuantity(base, 0);
    expect(zeroed.quantity).toBe(0);
    expect(zeroed.calories).toBe(0);
    // and the reference still restores it
    expect(scaleItemToQuantity(base, base.quantity)).toEqual(base);
  });

  it('does not invent macros when the reference quantity is zero', () => {
    const base = item({ quantity: 0 });
    const next = scaleItemToQuantity(base, 50);
    expect(next.quantity).toBe(50);
    expect(next.calories).toBe(base.calories);
  });

  it('ignores a non-finite or negative target and keeps the reference quantity', () => {
    const base = item();
    expect(scaleItemToQuantity(base, NaN).quantity).toBe(base.quantity);
    expect(scaleItemToQuantity(base, -5).quantity).toBe(base.quantity);
    expect(scaleItemToQuantity(base, Infinity).quantity).toBe(base.quantity);
  });

  it('ignores a non-finite scale factor', () => {
    expect(scaleItem(item(), NaN)).toEqual(item());
    expect(scaleItem(item(), -1)).toEqual(item());
  });
});

describe('float safety at the 0.05 constraint epsilon', () => {
  it('a scaled 8-item dish still satisfies the database Sigma CHECK', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      item({ id: `i${i}`, calories: 0.1 + i / 7, protein: 0.3, carbs: 0.7, fat: 0.1, fiber: 0.2 })
    );
    for (const factor of [0.5, 1.5, 2, 0.333333]) {
      const scaled = scaleItems(items, factor);
      const totals = sumItems(scaled);
      expect(parentMatchesItems(totals, scaled)).toBe(true);
      // The residual must be orders of magnitude below the budget, not merely
      // inside it, or the constraint is one refactor away from flapping.
      const budget = SUM_EPSILON_PER_ITEM * scaled.length;
      const residual = Math.abs(
        totals.calories - scaled.reduce((s, it) => s + it.calories, 0)
      );
      expect(residual).toBeLessThan(budget / 1000);
    }
  });

  it('classic 0.1 + 0.2 accumulation stays far inside the epsilon', () => {
    const items = [
      item({ id: 'a', calories: 0.1, protein: 0, carbs: 0, fat: 0, fiber: 0 }),
      item({ id: 'b', calories: 0.2, protein: 0, carbs: 0, fat: 0, fiber: 0 }),
    ];
    const totals = sumItems(items);
    expect(totals.calories).not.toBe(0.3); // 0.30000000000000004
    expect(Math.abs(totals.calories - 0.3)).toBeLessThan(1e-12);
    expect(parentMatchesItems({ calories: 0.3 }, items)).toBe(true);
  });

  it('a 50-item dish (the shape-CHECK ceiling) still sums inside its budget', () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      item({ id: `i${i}`, calories: 1 / 3, protein: 0.07, carbs: 0.11, fat: 0.13, fiber: 0.01 })
    );
    expect(parentMatchesItems(sumItems(items), items)).toBe(true);
  });
});
