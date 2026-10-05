import { describe, it, expect } from 'vitest';
import { safeItemsArray, itemsFromLegacyIngredients, sumItems } from './itemModel';

/**
 * TypeScript mirror of the SQL backfill guard.
 *
 * The SQL side (`private.safe_items_array` / `private.items_from_ingredients`)
 * is asserted against the REAL seven production dishes by
 * scripts/verify-hierarchy-migration.sh, which reads the gitignored Phase 0
 * snapshot. The corpus below reproduces the *shapes* of those rows — the item
 * counts 1 / 7 / 1 / 1 / 8 / NULL / 1 and the hostile payloads — without
 * committing another user's food log to the repository.
 */

const DISH_ID = '00000000-0000-0000-0000-0000000000aa';

function ing(n: number, portion = '1 serving') {
  return JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      name: `Component ${i + 1}`,
      portion,
      calories: 10 * (i + 1),
      protein: 1.5,
      carbs: 2.25,
      fat: 0.75,
      fiber: 0.5,
    }))
  );
}

interface Case {
  label: string;
  ingredients: string | null;
  willBackfill: boolean;
  nItems: number;
}

// Mirrors the plan's §8 result table row for row.
const CORPUS: Case[] = [
  { label: 'Hearty Beef Stew with Vegetables (shape)', ingredients: ing(1), willBackfill: true, nItems: 1 },
  { label: 'Berry Cherry Smoothie (shape)', ingredients: ing(7), willBackfill: true, nItems: 7 },
  { label: 'Chicken Broth with White Meat Chicken (shape)', ingredients: ing(1), willBackfill: true, nItems: 1 },
  { label: 'Dried Rice Noodles (shape)', ingredients: ing(1), willBackfill: true, nItems: 1 },
  { label: 'Office Breakfast (shape)', ingredients: ing(8), willBackfill: true, nItems: 8 },
  { label: 'Poached Egg (shape)', ingredients: ing(1), willBackfill: true, nItems: 1 },
  { label: 'Keto Bar (ingredients IS NULL)', ingredients: null, willBackfill: false, nItems: 0 },

  { label: 'empty array', ingredients: '[]', willBackfill: false, nItems: 0 },
  { label: 'empty string', ingredients: '', willBackfill: false, nItems: 0 },
  { label: 'whitespace only', ingredients: '   ', willBackfill: false, nItems: 0 },
  { label: 'json object', ingredients: '{"name":"x"}', willBackfill: false, nItems: 0 },
  { label: 'json scalar', ingredients: '42', willBackfill: false, nItems: 0 },
  { label: 'json string scalar', ingredients: '"oats, whey"', willBackfill: false, nItems: 0 },
  { label: 'plain prose', ingredients: '1 cup oats, 1 scoop whey', willBackfill: false, nItems: 0 },
  { label: 'truncated json', ingredients: '[{"name":"Oats",', willBackfill: false, nItems: 0 },
  { label: 'array of scalars', ingredients: '[1,2,3]', willBackfill: false, nItems: 0 },
  {
    label: 'negative macros',
    ingredients: '[{"name":"Bad","portion":"50 g","calories":-100,"protein":-4}]',
    willBackfill: true,
    nItems: 1,
  },
  {
    label: 'null macros',
    ingredients: '[{"name":"Null","portion":"50 g","calories":null}]',
    willBackfill: true,
    nItems: 1,
  },
  {
    label: 'quote in name (embedded apostrophe)',
    ingredients: '[{"name":"Chef\'s special","portion":"1 bowl","calories":5}]',
    willBackfill: true,
    nItems: 1,
  },
  {
    label: 'unicode name',
    ingredients: '[{"name":"Ph\u1edf B\u00f2 \uD83C\uDF5C","portion":"1 bowl","calories":5}]',
    willBackfill: true,
    nItems: 1,
  },
];

describe('backfill guard — parity with the SQL §8 result table', () => {
  it.each(CORPUS.map((c) => [c.label, c] as const))('%s', (_label, c) => {
    const items = itemsFromLegacyIngredients(DISH_ID, 'Fallback Dish', c.ingredients);
    if (!c.willBackfill) {
      expect(items).toBeNull();
    } else {
      expect(items).not.toBeNull();
      expect(items).toHaveLength(c.nItems);
    }
  });

  it('matches the aggregate outcome: 13 backfill, 9 do not', () => {
    const results = CORPUS.map((c) => itemsFromLegacyIngredients(DISH_ID, 'D', c.ingredients));
    expect(results.filter((r) => r !== null)).toHaveLength(CORPUS.filter((c) => c.willBackfill).length);
    expect(results.filter((r) => r === null)).toHaveLength(CORPUS.filter((c) => !c.willBackfill).length);
  });

  it('never throws, whatever it is handed', () => {
    for (const c of CORPUS) {
      expect(() => itemsFromLegacyIngredients(DISH_ID, 'D', c.ingredients)).not.toThrow();
    }
    expect(() => itemsFromLegacyIngredients(DISH_ID, 'D', undefined)).not.toThrow();
  });
});

describe('safeItemsArray', () => {
  it('never returns an empty array — the client invariant is NULL, not []', () => {
    expect(safeItemsArray('[]')).toBeNull();
    expect(safeItemsArray('')).toBeNull();
    expect(safeItemsArray(null)).toBeNull();
  });

  it('accepts only a non-empty JSON array', () => {
    expect(safeItemsArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });
});

describe('backfill transformation rules', () => {
  it('clamps negative macros to zero (R-08)', () => {
    const items = itemsFromLegacyIngredients(
      DISH_ID,
      'D',
      '[{"name":"Bad","portion":"50 g","calories":-100,"protein":-4,"carbs":-1,"fat":-2,"fiber":-3}]'
    );
    expect(items?.[0]).toMatchObject({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  });

  it('guarantees a non-NULL numeric calories for every item', () => {
    const items = itemsFromLegacyIngredients(DISH_ID, 'D', '[{"name":"X","calories":null},{"name":"Y"}]');
    for (const it of items ?? []) {
      expect(typeof it.calories).toBe('number');
      expect(Number.isFinite(it.calories)).toBe(true);
    }
  });

  it('preserves the original portion string verbatim, always', () => {
    const items = itemsFromLegacyIngredients(
      DISH_ID,
      'D',
      '[{"name":"A","portion":"2 dollops (150g)"},{"name":"B","portion":"\u0663 g"},{"name":"C"}]'
    );
    expect(items?.[0]?.displayPortion).toBe('2 dollops (150g)');
    // Even when the converter could not interpret it, the provenance survives.
    expect(items?.[1]?.displayPortion).toBe('\u0663 g');
    expect(items?.[1]?.quantity).toBe(1);
    expect(items?.[2]?.displayPortion).toBeNull();
  });

  it('falls back to the dish name for a component with no name', () => {
    const items = itemsFromLegacyIngredients(DISH_ID, 'Poached Egg', '[{"portion":"1 large","calories":70}]');
    expect(items?.[0]?.name).toBe('Poached Egg');
  });

  it('mints ids that match the SQL backfill (bf-<dish>-<original index>)', () => {
    const items = itemsFromLegacyIngredients(DISH_ID, 'D', '[{"name":"A"},{"name":"B"}]');
    expect(items?.map((i) => i.id)).toEqual([`bf-${DISH_ID}-0`, `bf-${DISH_ID}-1`]);
  });

  it('skips non-object elements but keeps the original index for the rest', () => {
    const items = itemsFromLegacyIngredients(DISH_ID, 'D', '[1,{"name":"B"},null,{"name":"D"}]');
    expect(items?.map((i) => i.id)).toEqual([`bf-${DISH_ID}-1`, `bf-${DISH_ID}-3`]);
  });

  it('does not round, so the parent sum survives the round trip', () => {
    const items = itemsFromLegacyIngredients(
      DISH_ID,
      'D',
      '[{"name":"A","calories":12.5,"protein":0.25},{"name":"B","calories":0.5,"protein":0.75}]'
    );
    expect(sumItems(items)).toMatchObject({ calories: 13, protein: 1 });
    expect(items?.[0]?.calories).toBe(12.5);
  });
});
