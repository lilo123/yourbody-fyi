import { describe, it, expect } from 'vitest';
import {
  deriveLevel,
  isLevel1,
  normalizeItems,
  itemsForPersist,
  sumItems,
  parentMatchesItems,
  reanchorItemTo,
  MAX_ITEMS,
  SUM_EPSILON_PER_ITEM,
  type NutritionItem,
} from './itemModel';

function item(overrides: Partial<NutritionItem> = {}): NutritionItem {
  return {
    id: 'i1',
    name: 'Egg',
    quantity: 1,
    unit: 'unit',
    displayPortion: '1 large',
    calories: 70,
    protein: 6,
    carbs: 0.5,
    fat: 5,
    fiber: 0,
    ...overrides,
  };
}

describe('deriveLevel', () => {
  it('treats >= 2 components as a level-1 parent', () => {
    expect(deriveLevel([item({ id: 'a' }), item({ id: 'b' })])).toBe(1);
    expect(isLevel1([item({ id: 'a' }), item({ id: 'b' })])).toBe(true);
  });

  it('treats 0 or 1 components as a level-2 leaf', () => {
    // All 98 existing production logs land here. A leaf must not render a
    // chevron or a count badge, or every row looks broken on day one.
    expect(deriveLevel(null)).toBe(2);
    expect(deriveLevel(undefined)).toBe(2);
    expect(deriveLevel([])).toBe(2);
    expect(deriveLevel([item()])).toBe(2);
    expect(isLevel1([item()])).toBe(false);
  });
});

describe('normalizeItems', () => {
  it('returns null, never [], for anything unusable', () => {
    for (const input of [null, undefined, [], '', '   ', '{}', '"x"', '5', 'not json', '[', {}, 42]) {
      expect(normalizeItems(input)).toBeNull();
    }
  });

  it('returns null when an array contains no objects', () => {
    expect(normalizeItems([1, 'two', null])).toBeNull();
  });

  it('parses a JSON string as well as an array', () => {
    const parsed = normalizeItems('[{"name":"Oats","calories":150}]');
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]).toMatchObject({ name: 'Oats', calories: 150 });
  });

  it('derives quantity and unit from a legacy portion string when absent', () => {
    const parsed = normalizeItems([{ name: 'Yogurt', portion: '150g', calories: 90 }]);
    expect(parsed?.[0]).toMatchObject({
      quantity: 150,
      unit: 'g',
      displayPortion: '150g',
    });
  });

  it('prefers an explicit quantity/unit over the derived pair', () => {
    const parsed = normalizeItems([
      { name: 'Yogurt', portion: '150g', quantity: 200, unit: 'g', calories: 90 },
    ]);
    expect(parsed?.[0]).toMatchObject({ quantity: 200, unit: 'g' });
  });

  it('falls back to the derived pair when the stored unit is not canonical', () => {
    const parsed = normalizeItems([{ name: 'Soup', portion: '250 ml', unit: 'litres', calories: 90 }]);
    expect(parsed?.[0]).toMatchObject({ quantity: 250, unit: 'ml' });
  });

  it('clamps negative macros to zero rather than propagating them', () => {
    const parsed = normalizeItems([{ name: 'Bad', calories: -10, protein: -1 }]);
    expect(parsed?.[0]).toMatchObject({ calories: 0, protein: 0 });
  });

  it('coerces non-numeric macros to zero instead of NaN', () => {
    const parsed = normalizeItems([{ name: 'Bad', calories: 'lots', fat: null }]);
    expect(parsed?.[0]?.calories).toBe(0);
    expect(parsed?.[0]?.fat).toBe(0);
  });

  it('preserves unicode and apostrophes in names verbatim', () => {
    const parsed = normalizeItems([{ name: "Ph\u1edf B\u00f2 \uD83C\uDF5C d'\u0153uf", calories: 1 }]);
    expect(parsed?.[0]?.name).toBe("Ph\u1edf B\u00f2 \uD83C\uDF5C d'\u0153uf");
  });
});

describe('itemsForPersist', () => {
  it('persists NULL, never [], when a row has no components', () => {
    expect(itemsForPersist([])).toBeNull();
    expect(itemsForPersist(null)).toBeNull();
    expect(itemsForPersist(undefined)).toBeNull();
  });

  it('passes a non-empty list through untouched', () => {
    const items = [item()];
    expect(itemsForPersist(items)).toBe(items);
  });
});

describe('sumItems', () => {
  it('sums all five macros', () => {
    const totals = sumItems([
      item({ id: 'a', calories: 100, protein: 1, carbs: 2, fat: 3, fiber: 4 }),
      item({ id: 'b', calories: 50, protein: 0.5, carbs: 1, fat: 1.5, fiber: 2 }),
    ]);
    expect(totals).toEqual({ calories: 150, protein: 1.5, carbs: 3, fat: 4.5, fiber: 6 });
  });

  it('returns zeros for an empty or missing list', () => {
    expect(sumItems(null)).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
    expect(sumItems([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  });

  it('does not round — roughly half of production macro values are fractional', () => {
    const totals = sumItems([item({ id: 'a', protein: 12.5 }), item({ id: 'b', protein: 0.25 })]);
    expect(totals.protein).toBe(12.75);
  });
});

describe('parentMatchesItems — the client mirror of the database Sigma CHECK', () => {
  const two = [
    item({ id: 'a', calories: 100, protein: 10, carbs: 0, fat: 0, fiber: 0 }),
    item({ id: 'b', calories: 50, protein: 5, carbs: 0, fat: 0, fiber: 0 }),
  ];

  it('accepts an exact parent', () => {
    expect(parentMatchesItems({ calories: 150, protein: 15 }, two)).toBe(true);
  });

  it('accepts drift inside the item-count-aware epsilon', () => {
    expect(parentMatchesItems({ calories: 150 + 2 * SUM_EPSILON_PER_ITEM, protein: 15 }, two)).toBe(true);
  });

  it('rejects the R-04 hazard: a rewritten parent with stale items', () => {
    expect(parentMatchesItems({ calories: 999, protein: 15 }, two)).toBe(false);
  });

  it('rejects the Berry Cherry Smoothie shape: 7 items, fiber off by 0.5', () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      item({ id: `s${i}`, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 1 })
    );
    // epsilon is 7 * 0.05 = 0.35, which is tighter than the 0.5 drift.
    expect(parentMatchesItems({ fiber: 6.5 }, seven)).toBe(false);
  });

  it('is vacuously true for a leaf', () => {
    expect(parentMatchesItems({ calories: 999 }, null)).toBe(true);
    expect(parentMatchesItems({ calories: 999 }, [])).toBe(true);
  });
});

describe('constants match the database', () => {
  it('mirrors the shape CHECK ceiling and the epsilon', () => {
    expect(MAX_ITEMS).toBe(50);
    expect(SUM_EPSILON_PER_ITEM).toBe(0.05);
  });
});

describe('reanchorItemTo', () => {
  it('re-expresses item in new unit and quantity without scaling macros', () => {
    const original = item({ quantity: 1, unit: 'unit', calories: 600, protein: 30, carbs: 40, fat: 20, fiber: 5 });
    const reanchored = reanchorItemTo(original, 540, 'g');

    expect(reanchored.quantity).toBe(540);
    expect(reanchored.unit).toBe('g');
    expect(reanchored.calories).toBe(600);
    expect(reanchored.protein).toBe(30);
    expect(reanchored.carbs).toBe(40);
    expect(reanchored.fat).toBe(20);
    expect(reanchored.fiber).toBe(5);
    expect(reanchored.id).toBe(original.id);
    expect(reanchored.name).toBe(original.name);
  });

  it('preserves unrounded macro values exactly (R-02 invariant)', () => {
    const original = item({
      quantity: 1,
      unit: 'unit',
      calories: 182.3456,
      protein: 12.789,
      carbs: 3.1415,
      fat: 13.999,
      fiber: 1.0001,
    });
    const reanchored = reanchorItemTo(original, 250, 'g');

    expect(reanchored.calories).toBe(182.3456);
    expect(reanchored.protein).toBe(12.789);
    expect(reanchored.carbs).toBe(3.1415);
    expect(reanchored.fat).toBe(13.999);
    expect(reanchored.fiber).toBe(1.0001);
  });

  it('rejects invalid quantities and returns the item as-is', () => {
    const original = item({ quantity: 1, unit: 'unit', calories: 600 });

    expect(reanchorItemTo(original, -5, 'g')).toBe(original);
    expect(reanchorItemTo(original, NaN, 'g')).toBe(original);
    expect(reanchorItemTo(original, Infinity, 'g')).toBe(original);
    expect(reanchorItemTo(original, 100001, 'g')).toBe(original);
  });

  it('accepts 0 quantity', () => {
    const original = item({ quantity: 1, unit: 'unit', calories: 600 });
    const result = reanchorItemTo(original, 0, 'ml');
    expect(result.quantity).toBe(0);
    expect(result.unit).toBe('ml');
    expect(result.calories).toBe(600);
  });
});
