import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  buildStagedItem,
  stagedReference,
  recomputeStagedTotals,
  updateStagedItemNutrition,
  buildStagedMealFromManualData,
  useStagedCardFocus,
  isIdenticalItem,
  mergeOrAppendStagedItems,
  type StagedItem,
} from './nutritionEngineHelpers';
import { scaleItemToQuantity } from '../../utils/itemModel';

describe('buildStagedItem', () => {
  it('assigns baseQuantity from quantity when portion is 1 serving (not 1)', () => {
    const item = buildStagedItem({
      name: 'Beef Stew',
      portion: '1 serving',
      quantity: 540,
      unit: 'g',
      calories: 665,
    });
    expect(item.baseQuantity).toBe(540);
    expect(item.baseQuantity).not.toBe(1);
    expect(item.quantity).toBe(540);
    expect(item.unit).toBe('g');
    expect(item.portion).toBe('1 serving');
  });

  it('assigns baseQuantity from quantity when portion is 1.5 cups cooked (not 1.5)', () => {
    const item = buildStagedItem({
      name: 'Cooked Rice',
      portion: '1.5 cups cooked',
      quantity: 240,
      unit: 'g',
      calories: 300,
    });
    expect(item.baseQuantity).toBe(240);
    expect(item.baseQuantity).not.toBe(1.5);
    expect(item.quantity).toBe(240);
    expect(item.unit).toBe('g');
  });

  it('scales linearly end-to-end without 270x calorie explosion', () => {
    const staged = buildStagedItem({
      name: 'Beef Stew',
      portion: '1 serving',
      quantity: 540,
      unit: 'g',
      calories: 665,
    });
    const reference = stagedReference(staged);
    const halved = scaleItemToQuantity(reference, 270);
    expect(halved.calories).toBeCloseTo(332.5, 1);
    expect(halved.calories).not.toBeCloseTo(179550, 0);
  });

  it('derives baseQuantity from quantity / portionMultiplier when raw.base is present', () => {
    const item = buildStagedItem({
      name: 'Pre-scaled Dish',
      portion: '1 bowl',
      quantity: 6,
      unit: 'unit',
      calories: 200,
      base: { calories: 100, protein: 10, carbs: 10, fat: 5, fiber: 2 },
      portionMultiplier: 2,
    });
    expect(item.baseQuantity).toBe(3);
    expect(item.baseQuantity).not.toBe(1);
  });

  it('guards against degenerate portionMultiplier values without producing Infinity/NaN', () => {
    const degenerateValues = [0, -1, NaN, undefined, -0, -Infinity, Infinity];
    for (const mult of degenerateValues) {
      const item = buildStagedItem({
        name: 'Degenerate Mult',
        portion: '1 serving',
        quantity: 100,
        unit: 'g',
        calories: 200,
        base: { calories: 200, protein: 10, carbs: 10, fat: 5, fiber: 2 },
        portionMultiplier: mult,
      });
      expect(Number.isFinite(item.baseQuantity)).toBe(true);
      expect(Number.isNaN(item.baseQuantity)).toBe(false);
      expect(item.baseQuantity).toBe(100);
    }
  });

  it('preserves fallback to convertPortion when raw.quantity is absent', () => {
    const item = buildStagedItem({
      name: 'Bananas',
      portion: '2 bananas',
      calories: 210,
    });
    expect(item.quantity).toBe(2);
    expect(item.unit).toBe('unit');
    expect(item.baseQuantity).toBe(2);
    expect(item.baseQuantity).not.toBe(1);

    const itemUndefined = buildStagedItem({
      name: 'Apples',
      portion: '3 apples',
      quantity: undefined,
      calories: 285,
    });
    expect(itemUndefined.quantity).toBe(3);
    expect(itemUndefined.baseQuantity).toBe(3);

    const itemNull = buildStagedItem({
      name: 'Oranges',
      portion: '4 oranges',
      quantity: null,
      calories: 240,
    });
    expect(itemNull.quantity).toBe(4);
    expect(itemNull.baseQuantity).toBe(4);
  });
});

describe('updateStagedItemNutrition', () => {
  it('(a) sets current macros, base macros, baseQuantity to item.quantity, portionMultiplier to 1, and userOverridden flag', () => {
    const item = buildStagedItem({
      name: 'Chicken Breast',
      portion: '50g',
      quantity: 50,
      unit: 'g',
      calories: 104,
      protein: 15,
      carbs: 0,
      fat: 2,
      fiber: 0,
    });

    const updated = updateStagedItemNutrition(item, {
      calories: 150,
      protein: 20,
      carbs: 5,
      fat: 3,
      fiber: 1,
    });

    expect(updated.calories).toBe(150);
    expect(updated.baseCalories).toBe(150);
    expect(updated.protein).toBe(20);
    expect(updated.baseProtein).toBe(20);
    expect(updated.carbs).toBe(5);
    expect(updated.baseCarbs).toBe(5);
    expect(updated.fat).toBe(3);
    expect(updated.baseFat).toBe(3);
    expect(updated.fiber).toBe(1);
    expect(updated.baseFiber).toBe(1);
    expect(updated.baseQuantity).toBe(50);
    expect(updated.portionMultiplier).toBe(1);
    expect(updated.userOverridden).toBe(true);
  });

  it('(b) scales linearly to 75g via the app stepper code path yielding 225 kcal, and back to 50g yields 150 exactly', () => {
    const item = buildStagedItem({
      name: 'Chicken Breast',
      portion: '50g',
      quantity: 50,
      unit: 'g',
      calories: 104,
    });

    const edited = updateStagedItemNutrition(item, {
      calories: 150,
      protein: 20,
      carbs: 0,
      fat: 3,
      fiber: 0,
    });

    // Code path used by ComponentRow.tsx / NutritionEngine.tsx:
    // reference = stagedReference(edited)
    // scaled = scaleItemToQuantity(reference, nextQuantity)
    const ref = stagedReference(edited);
    const scaled75 = scaleItemToQuantity(ref, 75);
    expect(scaled75.calories).toBe(225);

    const scaled50 = scaleItemToQuantity(ref, 50);
    expect(scaled50.calories).toBe(150);
  });

  it('(c) clamps negative and non-finite (NaN, Infinity) inputs to 0', () => {
    const item = buildStagedItem({
      name: 'Test Item',
      portion: '1 serving',
      quantity: 100,
      unit: 'g',
      calories: 200,
    });

    const updated = updateStagedItemNutrition(item, {
      calories: -100,
      protein: NaN,
      carbs: -0.02,
      fat: Infinity,
      fiber: -Infinity,
    });

    expect(updated.calories).toBe(0);
    expect(updated.baseCalories).toBe(0);
    expect(updated.protein).toBe(0);
    expect(updated.baseProtein).toBe(0);
    expect(updated.carbs).toBe(0);
    expect(updated.baseCarbs).toBe(0);
    expect(updated.fat).toBe(0);
    expect(updated.baseFat).toBe(0);
    expect(updated.fiber).toBe(0);
    expect(updated.baseFiber).toBe(0);
  });

  it('(d) recomputeStagedTotals over [edited, other] equals their sum', () => {
    const item1 = buildStagedItem({
      name: 'Item 1',
      portion: '50g',
      quantity: 50,
      unit: 'g',
      calories: 104,
    });
    const edited1 = updateStagedItemNutrition(item1, {
      calories: 150,
      protein: 20,
      carbs: 10,
      fat: 4,
      fiber: 2,
    });

    const item2 = buildStagedItem({
      name: 'Item 2',
      portion: '100g',
      quantity: 100,
      unit: 'g',
      calories: 200,
      protein: 10,
      carbs: 25,
      fat: 5,
      fiber: 3,
    });

    const totals = recomputeStagedTotals([edited1, item2]);
    expect(totals.calories).toBe(350);
    expect(totals.protein).toBe(30);
    expect(totals.carbs).toBe(35);
    expect(totals.fat).toBe(9);
    expect(totals.fiber).toBe(5);
  });

  it('(e) does not mutate the input item object', () => {
    const original = buildStagedItem({
      name: 'Immutable Item',
      portion: '50g',
      quantity: 50,
      unit: 'g',
      calories: 104,
      protein: 15,
      carbs: 2,
      fat: 1,
      fiber: 0,
    });
    const snapshot = JSON.parse(JSON.stringify(original));

    const updated = updateStagedItemNutrition(original, {
      calories: 200,
      protein: 30,
      carbs: 5,
      fat: 4,
      fiber: 1,
    });

    expect(original).toEqual(snapshot);
    expect(updated).not.toBe(original);
  });

  it('preserves baseQuantity if item.quantity <= 0 while updating base macros', () => {
    const item = buildStagedItem({
      name: 'Zero Quantity Item',
      portion: '0g',
      quantity: 0,
      unit: 'g',
      calories: 100,
    });
    const itemWithBase: StagedItem = { ...item, baseQuantity: 50, quantity: 0 };

    const updated = updateStagedItemNutrition(itemWithBase, {
      calories: 180,
      protein: 15,
      carbs: 10,
      fat: 5,
      fiber: 2,
    });

    expect(updated.baseQuantity).toBe(50);
    expect(updated.calories).toBe(180);
    expect(updated.baseCalories).toBe(180);
  });
});

describe('buildStagedMealFromManualData', () => {
  it('constructs a single-item StagedMeal from manual data with calculated explanation and photos', () => {
    const staged = buildStagedMealFromManualData(
      {
        food_name: 'Grilled Salmon',
        calories: 350,
        protein: 34,
        carbs: 0,
        fat: 22,
        fiber: 0,
        meal_type: 'Dinner',
        serving_size: 200,
        serving_unit: 'g',
      },
      'data:image/jpeg;base64,sample'
    );

    expect(staged.name).toBe('Grilled Salmon');
    expect(staged.mealType).toBe('Dinner');
    expect(staged.photoUrl).toBe('data:image/jpeg;base64,sample');
    expect(staged.calories).toBe(350);
    expect(staged.protein).toBe(34);
    expect(staged.carbs).toBe(0);
    expect(staged.fat).toBe(22);
    expect(staged.fiber).toBe(0);
    expect(staged.servingSize).toBe(200);
    expect(staged.servingUnit).toBe('g');
    expect(staged.explanation).toBe('350 kcal (Grilled Salmon)');

    expect(staged.items).toHaveLength(1);
    const item = staged.items[0];
    expect(item.name).toBe('Grilled Salmon');
    expect(item.portion).toBe('200 g');
    expect(item.quantity).toBe(200);
    expect(item.unit).toBe('g');
    expect(item.calories).toBe(350);
  });

  it('falls back mealType to Breakfast and unit to unit when unspecified or unknown', () => {
    const staged = buildStagedMealFromManualData({
      food_name: 'Custom Snack',
      calories: 120,
      protein: 2,
      carbs: 15,
      fat: 5,
      fiber: 1,
      meal_type: '',
      serving_size: 1,
      serving_unit: 'piece',
    });

    expect(staged.mealType).toBe('Breakfast');
    expect(staged.items[0].unit).toBe('unit');
    expect(staged.photoUrl).toBeUndefined();
  });
});

describe('useStagedCardFocus', () => {
  it('focuses section heading when textarea is not rendered and card unmounts with focus inside (F5)', () => {
    let isStaged = true;
    const { result, rerender } = renderHook(() => useStagedCardFocus(isStaged));

    const card = document.createElement('div');
    const childBtn = document.createElement('button');
    card.appendChild(childBtn);
    const mockHeading = document.createElement('h3');
    mockHeading.tabIndex = -1;
    document.body.appendChild(card);
    document.body.appendChild(mockHeading);
    const focusSpy = vi.spyOn(mockHeading, 'focus');

    // Attach heading ref but leave textarea ref null
    (result.current.cardContainerRef as any).current = card;
    (result.current.headingRef as any).current = mockHeading;
    expect(result.current.textareaRef.current).toBeNull();

    childBtn.focus();
    expect(document.activeElement).toBe(childBtn);

    act(() => {
      result.current.decideFocusRestore();
    });

    // Card unmounts
    isStaged = false;
    rerender();

    expect(focusSpy).toHaveBeenCalledTimes(1);
    document.body.removeChild(card);
    document.body.removeChild(mockHeading);
  });

  it('prioritizes focusing textarea when both textarea and heading are rendered (F5)', () => {
    let isStaged = true;
    const { result, rerender } = renderHook(() => useStagedCardFocus(isStaged));

    const card = document.createElement('div');
    const childBtn = document.createElement('button');
    card.appendChild(childBtn);
    const mockTextarea = document.createElement('textarea');
    const mockHeading = document.createElement('h3');
    document.body.appendChild(card);
    document.body.appendChild(mockTextarea);
    document.body.appendChild(mockHeading);
    const textareaFocusSpy = vi.spyOn(mockTextarea, 'focus');
    const headingFocusSpy = vi.spyOn(mockHeading, 'focus');

    (result.current.cardContainerRef as any).current = card;
    (result.current.textareaRef as any).current = mockTextarea;
    (result.current.headingRef as any).current = mockHeading;

    childBtn.focus();
    expect(document.activeElement).toBe(childBtn);

    act(() => {
      result.current.decideFocusRestore();
    });

    isStaged = false;
    rerender();

    expect(textareaFocusSpy).toHaveBeenCalledTimes(1);
    expect(headingFocusSpy).not.toHaveBeenCalled();

    document.body.removeChild(card);
    document.body.removeChild(mockTextarea);
    document.body.removeChild(mockHeading);
  });
  it('decides to restore focus when activeElement is inside cardContainerRef', () => {
    let isStaged = true;
    const { result, rerender } = renderHook(() => useStagedCardFocus(isStaged));

    const card = document.createElement('div');
    const childBtn = document.createElement('button');
    card.appendChild(childBtn);
    const mockTextarea = document.createElement('textarea');
    document.body.appendChild(card);
    document.body.appendChild(mockTextarea);

    const textareaFocusSpy = vi.spyOn(mockTextarea, 'focus');

    (result.current.cardContainerRef as any).current = card;
    (result.current.textareaRef as any).current = mockTextarea;

    childBtn.focus();
    expect(document.activeElement).toBe(childBtn);

    act(() => {
      result.current.decideFocusRestore();
    });

    isStaged = false;
    rerender();

    expect(textareaFocusSpy).toHaveBeenCalledTimes(1);

    document.body.removeChild(card);
    document.body.removeChild(mockTextarea);
  });

  it('decides NOT to restore focus when activeElement is outside cardContainerRef', () => {
    let isStaged = true;
    const { result, rerender } = renderHook(() => useStagedCardFocus(isStaged));

    const card = document.createElement('div');
    const outsideInput = document.createElement('input');
    const mockTextarea = document.createElement('textarea');
    document.body.appendChild(card);
    document.body.appendChild(outsideInput);
    document.body.appendChild(mockTextarea);

    const textareaFocusSpy = vi.spyOn(mockTextarea, 'focus');

    (result.current.cardContainerRef as any).current = card;
    (result.current.textareaRef as any).current = mockTextarea;

    outsideInput.focus();
    expect(document.activeElement).toBe(outsideInput);

    act(() => {
      result.current.decideFocusRestore();
    });

    isStaged = false;
    rerender();

    expect(textareaFocusSpy).not.toHaveBeenCalled();

    document.body.removeChild(card);
    document.body.removeChild(outsideInput);
    document.body.removeChild(mockTextarea);
  });

  it('restores focus when focus was inside at decision time even if focus dropped to body before unmount (A1)', () => {
    let isStaged = true;
    const { result, rerender } = renderHook(() => useStagedCardFocus(isStaged));

    const card = document.createElement('div');
    const childBtn = document.createElement('button');
    card.appendChild(childBtn);
    const mockTextarea = document.createElement('textarea');
    document.body.appendChild(card);
    document.body.appendChild(mockTextarea);

    const textareaFocusSpy = vi.spyOn(mockTextarea, 'focus');

    (result.current.cardContainerRef as any).current = card;
    (result.current.textareaRef as any).current = mockTextarea;

    // Focus child button inside card and decide focus restore
    childBtn.focus();
    expect(document.activeElement).toBe(childBtn);

    act(() => {
      result.current.decideFocusRestore();
    });

    // Button disabled during pending mutation drops focus to body
    document.body.tabIndex = -1;
    document.body.focus();
    expect(document.activeElement).toBe(document.body);

    // Card unmounts after mutation success
    isStaged = false;
    rerender();

    expect(textareaFocusSpy).toHaveBeenCalledTimes(1);

    document.body.removeChild(card);
    document.body.removeChild(mockTextarea);
  });

  it('does not restore focus if focus moved to an outside input after decision before unmount (A1)', () => {
    let isStaged = true;
    const { result, rerender } = renderHook(() => useStagedCardFocus(isStaged));

    const card = document.createElement('div');
    const childBtn = document.createElement('button');
    const outsideInput = document.createElement('input');
    card.appendChild(childBtn);
    const mockTextarea = document.createElement('textarea');
    document.body.appendChild(card);
    document.body.appendChild(outsideInput);
    document.body.appendChild(mockTextarea);

    const textareaFocusSpy = vi.spyOn(mockTextarea, 'focus');

    (result.current.cardContainerRef as any).current = card;
    (result.current.textareaRef as any).current = mockTextarea;

    // Focus inside card and decide restore
    childBtn.focus();
    act(() => {
      result.current.decideFocusRestore();
    });

    // While pending, user deliberately focuses an outside input (e.g. date picker)
    outsideInput.focus();
    expect(document.activeElement).toBe(outsideInput);

    // Card unmounts
    isStaged = false;
    rerender();

    // Should NOT steal focus from outsideInput
    expect(textareaFocusSpy).not.toHaveBeenCalled();

    document.body.removeChild(card);
    document.body.removeChild(outsideInput);
    document.body.removeChild(mockTextarea);
  });

  it('does NOT restore focus if Log was triggered via touch/pen tap (Finding #5)', () => {
    let isStaged = true;
    const { result, rerender } = renderHook(() => useStagedCardFocus(isStaged));

    const card = document.createElement('div');
    const childBtn = document.createElement('button');
    card.appendChild(childBtn);
    const mockTextarea = document.createElement('textarea');
    document.body.appendChild(card);
    document.body.appendChild(mockTextarea);

    const textareaFocusSpy = vi.spyOn(mockTextarea, 'focus');

    (result.current.cardContainerRef as any).current = card;
    (result.current.textareaRef as any).current = mockTextarea;

    // Simulate touch tap: pointerdown with pointerType 'touch'
    const pointerEvent = new Event('pointerdown', { bubbles: true }) as any;
    pointerEvent.pointerType = 'touch';
    window.dispatchEvent(pointerEvent);

    childBtn.focus();
    expect(document.activeElement).toBe(childBtn);

    act(() => {
      // decideFocusRestore called on touch tap
      result.current.decideFocusRestore({ detail: 1, pointerType: 'touch' } as any);
    });

    isStaged = false;
    rerender();

    // Must NOT focus mockTextarea after touch tap
    expect(textareaFocusSpy).not.toHaveBeenCalled();

    document.body.removeChild(card);
    document.body.removeChild(mockTextarea);
  });

  it('restores focus if Log was activated via keyboard Enter/Space (click event.detail === 0)', () => {
    let isStaged = true;
    const { result, rerender } = renderHook(() => useStagedCardFocus(isStaged));

    const card = document.createElement('div');
    const childBtn = document.createElement('button');
    card.appendChild(childBtn);
    const mockTextarea = document.createElement('textarea');
    document.body.appendChild(card);
    document.body.appendChild(mockTextarea);

    const textareaFocusSpy = vi.spyOn(mockTextarea, 'focus');

    (result.current.cardContainerRef as any).current = card;
    (result.current.textareaRef as any).current = mockTextarea;

    // Simulate keyboard navigation: keydown Enter
    const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    window.dispatchEvent(keyEvent);

    childBtn.focus();
    expect(document.activeElement).toBe(childBtn);

    act(() => {
      result.current.decideFocusRestore({ detail: 0 } as any);
    });

    isStaged = false;
    rerender();

    // Must restore focus on keyboard activation
    expect(textareaFocusSpy).toHaveBeenCalledTimes(1);

    document.body.removeChild(card);
    document.body.removeChild(mockTextarea);
  });

  it('restores focus on coarse-pointer device when activated via keyboard (keyboard wins over coarse pointer)', () => {
    // Mock coarse-only pointer environment
    const origMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      let isStaged = true;
      const { result, rerender } = renderHook(() => useStagedCardFocus(isStaged));

      const card = document.createElement('div');
      const childBtn = document.createElement('button');
      card.appendChild(childBtn);
      const mockTextarea = document.createElement('textarea');
      document.body.appendChild(card);
      document.body.appendChild(mockTextarea);

      const textareaFocusSpy = vi.spyOn(mockTextarea, 'focus');

      (result.current.cardContainerRef as any).current = card;
      (result.current.textareaRef as any).current = mockTextarea;

      // Simulate prior touch event on screen, then keyboard activation
      const pointerEvent = new Event('pointerdown', { bubbles: true }) as any;
      pointerEvent.pointerType = 'touch';
      window.dispatchEvent(pointerEvent);

      // Now user presses Enter
      const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      window.dispatchEvent(keyEvent);

      childBtn.focus();
      act(() => {
        result.current.decideFocusRestore({ detail: 0 } as any);
      });

      isStaged = false;
      rerender();

      expect(textareaFocusSpy).toHaveBeenCalledTimes(1);

      document.body.removeChild(card);
      document.body.removeChild(mockTextarea);
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });

  it('does NOT restore focus if user typed in textarea earlier but activated Log via touch tap (touch wins for this activation)', () => {
    let isStaged = true;
    const { result, rerender } = renderHook(() => useStagedCardFocus(isStaged));

    const card = document.createElement('div');
    const childBtn = document.createElement('button');
    card.appendChild(childBtn);
    const mockTextarea = document.createElement('textarea');
    document.body.appendChild(card);
    document.body.appendChild(mockTextarea);

    const textareaFocusSpy = vi.spyOn(mockTextarea, 'focus');

    (result.current.cardContainerRef as any).current = card;
    (result.current.textareaRef as any).current = mockTextarea;

    // Earlier keydown in textarea
    const keyEvent = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    window.dispatchEvent(keyEvent);

    // Later touch tap on Log button
    const pointerEvent = new Event('pointerdown', { bubbles: true }) as any;
    pointerEvent.pointerType = 'touch';
    window.dispatchEvent(pointerEvent);

    childBtn.focus();

    act(() => {
      result.current.decideFocusRestore({ detail: 1, pointerType: 'touch' } as any);
    });

    isStaged = false;
    rerender();

    // Touch tap on Log must win over earlier typing
    expect(textareaFocusSpy).not.toHaveBeenCalled();

    document.body.removeChild(card);
    document.body.removeChild(mockTextarea);
  });
});

describe('isIdenticalItem and mergeOrAppendStagedItems', () => {
  it('isIdenticalItem returns true for identical items and false for differing unit or macros', () => {
    const item1 = buildStagedItem({
      name: 'Rolled Oats',
      portion: '1 serving',
      quantity: 1,
      unit: 'unit',
      calories: 150,
      protein: 5,
      carbs: 27,
      fat: 3,
      fiber: 4,
    });
    const item2 = buildStagedItem({
      name: '  rolled oats  ',
      portion: '1 serving',
      quantity: 1,
      unit: 'unit',
      calories: 150,
      protein: 5,
      carbs: 27,
      fat: 3,
      fiber: 4,
    });
    // Name is case- and whitespace-insensitive
    expect(isIdenticalItem(item1, item2)).toBe(true);

    // Different unit -> not identical
    const itemDiffUnit = buildStagedItem({
      name: 'Rolled Oats',
      portion: '40g',
      quantity: 40,
      unit: 'g',
      calories: 150,
      protein: 5,
      carbs: 27,
      fat: 3,
      fiber: 4,
    });
    expect(isIdenticalItem(item1, itemDiffUnit)).toBe(false);

    // Per-unit macro differs by > relative epsilon (1%) -> not identical
    const itemDiffMacro = buildStagedItem({
      name: 'Rolled Oats',
      portion: '1 serving',
      quantity: 1,
      unit: 'unit',
      calories: 160,
      protein: 5,
      carbs: 27,
      fat: 3,
      fiber: 4,
    });
    expect(isIdenticalItem(item1, itemDiffMacro)).toBe(false);

    // Per-unit macro differs by <= epsilon (0.05) -> identical
    const itemCloseMacro = buildStagedItem({
      name: 'Rolled Oats',
      portion: '1 serving',
      quantity: 1,
      unit: 'unit',
      calories: 150.05,
      protein: 5,
      carbs: 27,
      fat: 3,
      fiber: 4,
    });
    expect(isIdenticalItem(item1, itemCloseMacro)).toBe(true);
  });

  it('identical items merge: qty summed and macros scaled exactly', () => {
    const existing = [
      buildStagedItem({
        name: 'Rolled Oats',
        portion: '1 serving',
        quantity: 1,
        unit: 'unit',
        calories: 150,
        protein: 5,
        carbs: 27,
        fat: 3,
        fiber: 4,
      }),
    ];
    const incoming = [
      buildStagedItem({
        name: 'Rolled Oats',
        portion: '1 serving',
        quantity: 1,
        unit: 'unit',
        calories: 150,
        protein: 5,
        carbs: 27,
        fat: 3,
        fiber: 4,
      }),
    ];

    const result = mergeOrAppendStagedItems(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(2);
    expect(result[0].calories).toBe(300);
    expect(result[0].protein).toBe(10);
    expect(result[0].carbs).toBe(54);
    expect(result[0].fat).toBe(6);
    expect(result[0].fiber).toBe(8);
  });

  it('name matching is case-insensitive and trims whitespace', () => {
    const existing = [
      buildStagedItem({
        name: '  Almonds  ',
        portion: '1 oz',
        quantity: 1,
        unit: 'unit',
        calories: 160,
        protein: 6,
        carbs: 6,
        fat: 14,
        fiber: 3,
      }),
    ];
    const incoming = [
      buildStagedItem({
        name: 'almonds',
        portion: '1 oz',
        quantity: 1,
        unit: 'unit',
        calories: 160,
        protein: 6,
        carbs: 6,
        fat: 14,
        fiber: 3,
      }),
    ];

    const result = mergeOrAppendStagedItems(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(2);
    expect(result[0].calories).toBe(320);
  });

  it('different unit -> appended rather than merged', () => {
    const existing = [
      buildStagedItem({
        name: 'Milk',
        portion: '100 ml',
        quantity: 100,
        unit: 'ml',
        calories: 50,
        protein: 3,
        carbs: 5,
        fat: 2,
        fiber: 0,
      }),
    ];
    const incoming = [
      buildStagedItem({
        name: 'Milk',
        portion: '1 cup',
        quantity: 1,
        unit: 'unit',
        calories: 50,
        protein: 3,
        carbs: 5,
        fat: 2,
        fiber: 0,
      }),
    ];

    const result = mergeOrAppendStagedItems(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[0].unit).toBe('ml');
    expect(result[0].quantity).toBe(100);
    expect(result[1].unit).toBe('unit');
    expect(result[1].quantity).toBe(1);
  });

  it('per-unit macro differs by > epsilon -> appended rather than merged', () => {
    const existing = [
      buildStagedItem({
        name: 'Apple',
        portion: '1 medium',
        quantity: 1,
        unit: 'unit',
        calories: 95,
        protein: 0.5,
        carbs: 25,
        fat: 0.3,
        fiber: 4.4,
      }),
    ];
    const incoming = [
      buildStagedItem({
        name: 'Apple',
        portion: '1 medium',
        quantity: 1,
        unit: 'unit',
        calories: 98,
        protein: 0.5,
        carbs: 25,
        fat: 0.3,
        fiber: 4.4,
      }),
    ];

    const result = mergeOrAppendStagedItems(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[0].calories).toBe(95);
    expect(result[1].calories).toBe(98);
  });

  it('an item whose nutrition was edited is compared by its CURRENT per-unit values', () => {
    const originalItem = buildStagedItem({
      name: 'Chicken Breast',
      portion: '100g',
      quantity: 100,
      unit: 'g',
      calories: 165,
      protein: 31,
      carbs: 0,
      fat: 3.6,
      fiber: 0,
    });

    // User edits nutrition
    const editedItem = updateStagedItemNutrition(originalItem, {
      calories: 200,
      protein: 40,
      carbs: 0,
      fat: 5,
      fiber: 0,
    });

    const existing = [editedItem];

    // Incoming with matching edited per-unit macros (2 kcal/g, 0.4 protein/g)
    const matchingIncoming = buildStagedItem({
      name: 'Chicken Breast',
      portion: '100g',
      quantity: 100,
      unit: 'g',
      calories: 200,
      protein: 40,
      carbs: 0,
      fat: 5,
      fiber: 0,
    });

    expect(isIdenticalItem(editedItem, matchingIncoming)).toBe(true);

    const merged = mergeOrAppendStagedItems(existing, [matchingIncoming]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(200);
    expect(merged[0].calories).toBe(400);
    expect(merged[0].protein).toBe(80);

    // Incoming with pre-edit macros (165 kcal, 1.65 kcal/g != 2.0 kcal/g) -> not identical, appended
    const uneditedIncoming = buildStagedItem({
      name: 'Chicken Breast',
      portion: '100g',
      quantity: 100,
      unit: 'g',
      calories: 165,
      protein: 31,
      carbs: 0,
      fat: 3.6,
      fiber: 0,
    });

    expect(isIdenticalItem(editedItem, uneditedIncoming)).toBe(false);
    const appended = mergeOrAppendStagedItems(existing, [uneditedIncoming]);
    expect(appended).toHaveLength(2);
    expect(appended[0].calories).toBe(200);
    expect(appended[1].calories).toBe(165);
  });

  it('multiple incoming items incl. two identical to each other merge properly', () => {
    const existing = [
      buildStagedItem({
        name: 'Eggs',
        portion: '2 eggs',
        quantity: 2,
        unit: 'unit',
        calories: 140,
        protein: 12,
        carbs: 2,
        fat: 10,
        fiber: 0,
      }),
    ];

    const toast1 = buildStagedItem({
      name: 'Toast',
      portion: '1 slice',
      quantity: 1,
      unit: 'unit',
      calories: 80,
      protein: 3,
      carbs: 15,
      fat: 1,
      fiber: 1,
    });
    const butter = buildStagedItem({
      name: 'Butter',
      portion: '1 pat',
      quantity: 1,
      unit: 'unit',
      calories: 35,
      protein: 0,
      carbs: 0,
      fat: 4,
      fiber: 0,
    });
    const toast2 = buildStagedItem({
      name: 'Toast',
      portion: '1 slice',
      quantity: 1,
      unit: 'unit',
      calories: 80,
      protein: 3,
      carbs: 15,
      fat: 1,
      fiber: 1,
    });

    const result = mergeOrAppendStagedItems(existing, [toast1, butter, toast2]);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('Eggs');
    expect(result[0].quantity).toBe(2);
    expect(result[1].name).toBe('Toast');
    expect(result[1].quantity).toBe(2);
    expect(result[1].calories).toBe(160);
    expect(result[2].name).toBe('Butter');
    expect(result[2].quantity).toBe(1);
  });

  it('order of existing items and appended incoming items is preserved', () => {
    const itemA = buildStagedItem({ name: 'Alpha', quantity: 1, unit: 'unit', calories: 10 });
    const itemB = buildStagedItem({ name: 'Beta', quantity: 1, unit: 'unit', calories: 20 });
    const itemC = buildStagedItem({ name: 'Gamma', quantity: 1, unit: 'unit', calories: 30 });
    const itemD = buildStagedItem({ name: 'Delta', quantity: 1, unit: 'unit', calories: 40 });

    const result = mergeOrAppendStagedItems([itemA, itemB], [itemC, itemD]);
    expect(result.map((it) => it.name)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  it('input arrays and objects are not mutated', () => {
    const itemA = buildStagedItem({ name: 'Alpha', quantity: 1, unit: 'unit', calories: 10 });
    const itemB = buildStagedItem({ name: 'Beta', quantity: 1, unit: 'unit', calories: 20 });
    const existing = [itemA];
    const incoming = [itemB];

    const existingBefore = JSON.stringify(existing);
    const incomingBefore = JSON.stringify(incoming);

    mergeOrAppendStagedItems(existing, incoming);

    expect(JSON.stringify(existing)).toBe(existingBefore);
    expect(JSON.stringify(incoming)).toBe(incomingBefore);
  });

  describe('isIdenticalItem relative tolerance & edited nutrition', () => {
    it('per-gram protein 0.027 vs 0.07 -> NOT identical', () => {
      const itemA = buildStagedItem({
        name: 'Greek Yogurt',
        portion: '100g',
        quantity: 100,
        unit: 'g',
        calories: 100,
        protein: 2.7, // 0.027 g/g
        carbs: 5,
        fat: 0,
        fiber: 0,
      });
      const itemB = buildStagedItem({
        name: 'Greek Yogurt',
        portion: '100g',
        quantity: 100,
        unit: 'g',
        calories: 100,
        protein: 7.0, // 0.070 g/g
        carbs: 5,
        fat: 0,
        fiber: 0,
      });
      expect(isIdenticalItem(itemA, itemB)).toBe(false);
    });

    it('1.30 vs 1.305 kcal/g -> identical', () => {
      const itemA = buildStagedItem({
        name: 'Energy Bar',
        portion: '100g',
        quantity: 100,
        unit: 'g',
        calories: 130, // 1.30 kcal/g
        protein: 10,
        carbs: 20,
        fat: 2,
        fiber: 1,
      });
      const itemB = buildStagedItem({
        name: 'Energy Bar',
        portion: '100g',
        quantity: 100,
        unit: 'g',
        calories: 130.5, // 1.305 kcal/g (diff is 0.005 <= 0.01 * 1.305 = 0.01305)
        protein: 10,
        carbs: 20,
        fat: 2,
        fiber: 1,
      });
      expect(isIdenticalItem(itemA, itemB)).toBe(true);
    });

    it('edited item vs original -> not identical', () => {
      // Original 150g favorite: 4g protein, 0.5g fat, 195 kcal
      const original = buildStagedItem({
        name: 'Rice & Beans',
        portion: '150g',
        quantity: 150,
        unit: 'g',
        calories: 195,
        protein: 4,
        carbs: 35,
        fat: 0.5,
        fiber: 3,
      });
      // User edit: 15g protein, 7g fat, 215 kcal
      const d7Edited = buildStagedItem({
        name: 'Rice & Beans',
        portion: '150g',
        quantity: 150,
        unit: 'g',
        calories: 215,
        protein: 15,
        carbs: 35,
        fat: 7,
        fiber: 3,
      });
      expect(isIdenticalItem(d7Edited, original)).toBe(false);
    });

    it('handles undefined fiber vs 0 gracefully without NaN', () => {
      const itemA = buildStagedItem({
        name: 'Rice',
        portion: '100g',
        quantity: 100,
        unit: 'g',
        calories: 130,
        protein: 2.7,
        carbs: 28,
        fat: 0.3,
        fiber: 0,
      });
      const itemB = {
        ...itemA,
        fiber: undefined as unknown as number,
      };
      expect(isIdenticalItem(itemA, itemB)).toBe(true);
    });
  });

  describe('Audit Fix #7: mergeOrAppendStagedItems portion rescaling', () => {
    it('merging into an item rescales its portion text', () => {
      const existing = [
        buildStagedItem({
          name: 'Chicken Rice',
          portion: '150 g',
          quantity: 150,
          unit: 'g',
          calories: 200,
          protein: 20,
          carbs: 25,
          fat: 2,
          fiber: 1,
        }),
      ];
      const incoming = [
        buildStagedItem({
          name: 'Chicken Rice',
          portion: '150 g',
          quantity: 150,
          unit: 'g',
          calories: 200,
          protein: 20,
          carbs: 25,
          fat: 2,
          fiber: 1,
        }),
      ];

      const merged = mergeOrAppendStagedItems(existing, incoming);
      expect(merged).toHaveLength(1);
      expect(merged[0].quantity).toBe(300);
      expect(merged[0].portion).toBe('300 g');
    });
  });
});
