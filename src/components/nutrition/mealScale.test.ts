import { describe, it, expect } from 'vitest';
import {
  buildStagedItem,
  formatMealScale,
  parseMealScaleInput,
  recomputeStagedTotals,
  scaleStagedMeal,
  updateStagedItemNutrition,
  type StagedMeal,
} from './nutritionEngineHelpers';

function batchMeal(): StagedMeal {
  const items = [
    buildStagedItem({ name: 'Lean Ground Pork', portion: '990 g', quantity: 990, unit: 'g', calories: 1881, protein: 188.1, carbs: 0, fat: 118.8, fiber: 0 }),
    buildStagedItem({ name: 'Jasmine Rice', portion: '1200 g', quantity: 1200, unit: 'g', calories: 1560, protein: 32.4, carbs: 340.8, fat: 3.6, fiber: 4.8 }),
    buildStagedItem({ name: 'Egg', portion: '1 unit', quantity: 1, unit: 'unit', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, fiber: 0 }),
  ];
  return {
    name: 'Pork & rice meal prep',
    mealType: 'Lunch',
    servingSize: 1,
    servingUnit: 'serving',
    items,
    ...recomputeStagedTotals(items),
  };
}

describe('parseMealScaleInput', () => {
  it.each([
    ['0.2', 0.2],
    ['.2', 0.2],
    ['0,5', 0.5],
    ['2', 2],
    ['x1.5', 1.5],
    ['×3', 3],
    [' 1/5 ', 0.2],
    ['1/3', 0.33],
    ['0.333', 0.33],
    ['20', 20],
    ['0.01', 0.01],
  ])('parses %s as %s', (raw, expected) => {
    expect(parseMealScaleInput(raw)).toBe(expected);
  });

  it.each(['', '   ', '0', '0.001', '21', '-1', 'abc', '1/0', '1..2', '2x'])('rejects %s', (raw) => {
    expect(parseMealScaleInput(raw)).toBeNull();
  });
});

describe('formatMealScale', () => {
  it('drops trailing zeros and keeps at most 2 decimals', () => {
    expect(formatMealScale(1)).toBe('1');
    expect(formatMealScale(0.2)).toBe('0.2');
    expect(formatMealScale(0.3333)).toBe('0.33');
    expect(formatMealScale(1.5)).toBe('1.5');
  });
});

describe('scaleStagedMeal', () => {
  it('scales every item and the totals, and records the scale', () => {
    const meal = batchMeal();
    const fifth = scaleStagedMeal(meal, 0.2);
    expect(fifth.scale).toBe(0.2);
    expect(fifth.items.map((it) => it.quantity)).toEqual([198, 240, 0.2]);
    expect(fifth.items[0].calories).toBe(376.2);
    expect(fifth.items[0].protein).toBe(37.6);
    expect(fifth.items[1].carbs).toBe(68.2);
    // Parent = sum(items) holds after scaling.
    const sum = fifth.items.reduce((a, it) => a + it.calories, 0);
    expect(fifth.calories).toBeCloseTo(sum, 5);
    expect(fifth.explanation).toContain('kcal (Lean Ground Pork)');
  });

  it('is relative to the meal as staged: x0.2 twice stays x0.2, and x1 restores exactly', () => {
    const meal = batchMeal();
    const once = scaleStagedMeal(meal, 0.2);
    const twice = scaleStagedMeal(once, 0.2);
    expect(twice).toBe(once);

    const back = scaleStagedMeal(twice, 1);
    expect(back.scale).toBeUndefined();
    expect(back.items.map((it) => [it.quantity, it.calories, it.protein, it.carbs, it.fat, it.fiber])).toEqual(
      meal.items.map((it) => [it.quantity, it.calories, it.protein, it.carbs, it.fat, it.fiber])
    );
    expect(back.calories).toBe(meal.calories);
  });

  it('does not drift through awkward factors (x0.33 -> x0.2 -> x2 -> x1)', () => {
    const meal = batchMeal();
    let m = meal;
    for (const f of [0.33, 0.2, 2, 1]) m = scaleStagedMeal(m, f);
    expect(m.items.map((it) => it.quantity)).toEqual([990, 1200, 1]);
    expect(m.items.map((it) => it.calories)).toEqual([1881, 1560, 72]);
  });

  it('keeps a nutrition edit made while scaled', () => {
    const meal = scaleStagedMeal(batchMeal(), 0.2);
    // At x0.2 the user corrects the pork to 400 kcal for its 198 g.
    const edited: StagedMeal = {
      ...meal,
      items: meal.items.map((it, i) =>
        i === 0 ? updateStagedItemNutrition(it, { calories: 400, protein: 40, carbs: 0, fat: 25, fiber: 0 }) : it
      ),
    };
    const whole = scaleStagedMeal(edited, 1);
    expect(whole.items[0].quantity).toBe(990);
    expect(whole.items[0].calories).toBe(2000);
    expect(whole.items[0].fat).toBe(125);
    expect(whole.items[1].calories).toBe(1560);
  });

  it('scales macros directly for an item with no quantity reference', () => {
    const meal = batchMeal();
    const zeroQty: StagedMeal = {
      ...meal,
      items: [{ ...meal.items[2], quantity: 0, baseQuantity: 0 }],
    };
    const doubled = scaleStagedMeal(zeroQty, 2);
    expect(doubled.items[0].quantity).toBe(0);
    expect(doubled.items[0].calories).toBe(144);
    expect(doubled.items[0].protein).toBe(12.6);
  });

  it('scales a single-item meal and keeps servingSize, servingUnit, and clean explanation in sync', () => {
    const singleItem = buildStagedItem({
      name: 'Salmon Fillet',
      portion: '200 g',
      quantity: 200,
      unit: 'g',
      calories: 416,
      protein: 40,
      carbs: 0,
      fat: 26,
      fiber: 0,
    });
    const singleMeal: StagedMeal = {
      name: 'Salmon Fillet',
      mealType: 'Dinner',
      servingSize: 200,
      servingUnit: 'g',
      explanation: '416 kcal (Salmon Fillet)',
      items: [singleItem],
      calories: 416,
      protein: 40,
      carbs: 0,
      fat: 26,
      fiber: 0,
    };

    const half = scaleStagedMeal(singleMeal, 0.5);
    expect(half.scale).toBe(0.5);
    expect(half.servingSize).toBe(100);
    expect(half.servingUnit).toBe('g');
    expect(half.items[0].quantity).toBe(100);
    expect(half.calories).toBe(208);
    expect(half.explanation).toBe('208 kcal (Salmon Fillet)');

    // 4-decimal scale factor keeps precision on servingSize
    const third = scaleStagedMeal(singleMeal, 0.33);
    expect(third.servingSize).toBe(66);
    expect(third.items[0].quantity).toBe(66);

    const restored = scaleStagedMeal(third, 1);
    expect(restored.scale).toBeUndefined();
    expect(restored.servingSize).toBe(200);
    expect(restored.servingUnit).toBe('g');
    expect(restored.items[0].quantity).toBe(200);
    expect(restored.calories).toBe(416);
    expect(restored.explanation).toBe('416 kcal (Salmon Fillet)');
  });

  it('ignores non-positive or non-finite factors', () => {
    const meal = batchMeal();
    expect(scaleStagedMeal(meal, 0)).toBe(meal);
    expect(scaleStagedMeal(meal, -1)).toBe(meal);
    expect(scaleStagedMeal(meal, Number.NaN)).toBe(meal);
    expect(scaleStagedMeal(meal, 1)).toBe(meal);
  });
});

