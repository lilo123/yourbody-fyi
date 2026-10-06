import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StagedMealCard } from './StagedMealCard';
import type { StagedMeal } from './nutritionEngineHelpers';
import { expectNoA11yViolations, expectNoA11yViolationsForRules } from '../../test/a11y';

function makeStagedMeal(): StagedMeal {
  return {
    name: 'Power Breakfast',
    mealType: 'Breakfast',
    explanation: 'Calculated from ingredients',
    servingSize: 1,
    servingUnit: 'serving',
    calories: 600,
    protein: 30,
    carbs: 40,
    fat: 20,
    fiber: 5,
    items: [
      {
        id: 'stage-1',
        name: 'Egg Frittata',
        portion: '1 slice',
        portionMultiplier: 1,
        quantity: 1,
        calories: 600,
        protein: 30,
        carbs: 40,
        fat: 20,
        fiber: 5,
        baseQuantity: 1,
        baseCalories: 600,
        baseProtein: 30,
        baseCarbs: 40,
        baseFat: 20,
        baseFiber: 5,
        unit: 'unit',
      },
    ],
  };
}

function makeMultiItemMeal(): StagedMeal {
  return {
    name: '4-Item Feast',
    mealType: 'Dinner',
    explanation: '104 kcal (Salmon) + 74 kcal (Trout) + 125 kcal (Beef) + 181 kcal (Pork) = 484 kcal',
    servingSize: 1,
    servingUnit: 'serving',
    calories: 484,
    protein: 39.5,
    carbs: 0,
    fat: 34.5,
    fiber: 0,
    items: [
      {
        id: 'item-1',
        name: 'Salmon',
        portion: '50g',
        portionMultiplier: 1,
        quantity: 50,
        unit: 'g',
        calories: 104,
        protein: 10,
        carbs: 0,
        fat: 6.5,
        fiber: 0,
        baseQuantity: 50,
        baseCalories: 104,
        baseProtein: 10,
        baseCarbs: 0,
        baseFat: 6.5,
        baseFiber: 0,
      },
      {
        id: 'item-2',
        name: 'Trout',
        portion: '50g',
        portionMultiplier: 1,
        quantity: 50,
        unit: 'g',
        calories: 74,
        protein: 10.5,
        carbs: 0,
        fat: 3.5,
        fiber: 0,
        baseQuantity: 50,
        baseCalories: 74,
        baseProtein: 10.5,
        baseCarbs: 0,
        baseFat: 3.5,
        baseFiber: 0,
      },
      {
        id: 'item-3',
        name: 'Beef',
        portion: '50g',
        portionMultiplier: 1,
        quantity: 50,
        unit: 'g',
        calories: 125,
        protein: 13,
        carbs: 0,
        fat: 8,
        fiber: 0,
        baseQuantity: 50,
        baseCalories: 125,
        baseProtein: 13,
        baseCarbs: 0,
        baseFat: 8,
        baseFiber: 0,
      },
      {
        id: 'item-4',
        name: 'Pork',
        portion: '50g',
        portionMultiplier: 1,
        quantity: 50,
        unit: 'g',
        calories: 181,
        protein: 6,
        carbs: 0,
        fat: 16.5,
        fiber: 0,
        baseQuantity: 50,
        baseCalories: 181,
        baseProtein: 6,
        baseCarbs: 0,
        baseFat: 16.5,
        baseFiber: 0,
      },
    ],
  };
}

describe('StagedMealCard', () => {
  it('typing a quantity invokes onApplyStagedItemChange with updated scaled nutrition', () => {
    const meal = makeMultiItemMeal();
    const onApplyStagedItemChange = vi.fn();

    render(
      <StagedMealCard
        stagedMeal={meal}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={onApplyStagedItemChange}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    const inputs = screen.getAllByTestId('component-quantity-input');
    fireEvent.change(inputs[0], { target: { value: '100' } });
    fireEvent.blur(inputs[0]);

    expect(onApplyStagedItemChange).toHaveBeenCalledTimes(1);
    expect(onApplyStagedItemChange).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({
        quantity: 100,
        calories: 208,
      })
    );
  });

  it('updates base* fields on re-anchor so subsequent adjustments scale from the new baseline', () => {
    let currentMeal = makeStagedMeal();
    const onUpdateStagedMeal = vi.fn((updated: StagedMeal) => {
      currentMeal = updated;
    });
    const onApplyStagedItemChange = vi.fn();
    const onDeleteItem = vi.fn();
    const onSaveItemAsCustomDish = vi.fn();
    const onLogStagedMeal = vi.fn();
    const onSaveStagedAsCustomDish = vi.fn();
    const onDiscardStagedMeal = vi.fn();

    const { rerender } = render(
      <StagedMealCard
        stagedMeal={currentMeal}
        onUpdateStagedMeal={onUpdateStagedMeal}
        onApplyStagedItemChange={onApplyStagedItemChange}
        onDeleteItem={onDeleteItem}
        onSaveItemAsCustomDish={onSaveItemAsCustomDish}
        onLogStagedMeal={onLogStagedMeal}
        onSaveStagedAsCustomDish={onSaveStagedAsCustomDish}
        onDiscardStagedMeal={onDiscardStagedMeal}
        isPending={false}
      />
    );

    // Switch unit from 'unit' to 'g'
    fireEvent.click(screen.getByTestId('component-unit-chip'));
    fireEvent.click(screen.getByTestId('unit-option-g'));

    // Commit 540g
    const input = screen.getByTestId('component-quantity-input');
    fireEvent.change(input, { target: { value: '540' } });
    fireEvent.blur(input);

    expect(onUpdateStagedMeal).toHaveBeenCalledTimes(1);
    const updated = onUpdateStagedMeal.mock.calls[0][0] as StagedMeal;

    // Verify all base* fields are rewritten and portionMultiplier is reset to 1
    const reanchoredItem = updated.items[0];
    expect(reanchoredItem.unit).toBe('g');
    expect(reanchoredItem.baseQuantity).toBe(540);
    expect(reanchoredItem.baseCalories).toBe(600);
    expect(reanchoredItem.baseProtein).toBe(30);
    expect(reanchoredItem.baseCarbs).toBe(40);
    expect(reanchoredItem.baseFat).toBe(20);
    expect(reanchoredItem.baseFiber).toBe(5);
    expect(reanchoredItem.portionMultiplier).toBe(1);

    // Re-render with the updated meal
    rerender(
      <StagedMealCard
        stagedMeal={currentMeal}
        onUpdateStagedMeal={onUpdateStagedMeal}
        onApplyStagedItemChange={onApplyStagedItemChange}
        onDeleteItem={onDeleteItem}
        onSaveItemAsCustomDish={onSaveItemAsCustomDish}
        onLogStagedMeal={onLogStagedMeal}
        onSaveStagedAsCustomDish={onSaveStagedAsCustomDish}
        onDiscardStagedMeal={onDiscardStagedMeal}
        isPending={false}
      />
    );

    // Now adjust quantity to 594 (which is 1.1x of 540g)
    const nextInput = screen.getByTestId('component-quantity-input');
    fireEvent.change(nextInput, { target: { value: '594' } });
    fireEvent.blur(nextInput);

    expect(onApplyStagedItemChange).toHaveBeenCalledTimes(1);
    const scaled = onApplyStagedItemChange.mock.calls[0][1];
    expect(scaled.quantity).toBe(594);
    expect(scaled.unit).toBe('g');
    expect(scaled.calories).toBe(660);
    expect(scaled.protein).toBe(33);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <StagedMealCard
        stagedMeal={makeStagedMeal()}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );
    await expectNoA11yViolations(container);
  });

  it('renders two StagedMealCards simultaneously without duplicate id violations', async () => {
    const meal1 = makeStagedMeal();
    const meal2 = { ...makeStagedMeal(), name: 'Lunch Meal' };
    const { container } = render(
      <div>
        <StagedMealCard
          stagedMeal={meal1}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
        <StagedMealCard
          stagedMeal={meal2}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      </div>
    );
    await expectNoA11yViolationsForRules(container, ['duplicate-id', 'label']);
  });

  it('omits "Adjust portion or remove item" helper label and formula callout box', () => {
    const meal = makeMultiItemMeal();
    const { container } = render(
      <StagedMealCard
        stagedMeal={meal}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    expect(screen.queryByText(/adjust portion or remove item/i)).toBeNull();
    expect(container.querySelector('.lucide-calculator')).toBeNull();
    expect(screen.getByText(/itemized breakdown \(4\)/i)).toBeDefined();
  });

  it('renders read-only totals with no inputs for multi-item meal and shows 484/39.5/34.5 values', () => {
    const meal = makeMultiItemMeal();
    render(
      <StagedMealCard
        stagedMeal={meal}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    const totalsContainer = screen.getByTestId('staged-meal-totals');
    expect(within(totalsContainer).queryAllByRole('spinbutton')).toHaveLength(0);
    expect(within(totalsContainer).queryAllByRole('textbox')).toHaveLength(0);

    // Verify typography matches ComponentRow: proportional tabular-nums, font-mono absent
    expect(totalsContainer.className).not.toContain('font-mono');
    expect(totalsContainer.className).toContain('tabular-nums');

    // Verify visible read-only non-zero figures via individual testids with exact-number assertions
    expect(screen.getByTestId('staged-total-calories')).toHaveTextContent(/^484\s*kcal$/);
    expect(screen.getByTestId('staged-total-protein')).toHaveTextContent(/^39\.5\s*P$/);
    expect(screen.getByTestId('staged-total-fat')).toHaveTextContent(/^34\.5\s*F$/);

    // Verify zero macros are not rendered (assert absence via queryByTestId === null)
    expect(screen.queryByTestId('staged-total-carbs')).toBeNull();
    expect(screen.queryByTestId('staged-total-fiber')).toBeNull();

    // Verify column headers are absent per user feedback (dropped header row)
    expect(screen.queryByTestId('macro-columns-header')).toBeNull();
    expect(screen.queryByTestId('header-macro-calories')).toBeNull();
    expect(screen.queryByTestId('header-macro-protein')).toBeNull();
    expect(screen.queryByTestId('header-macro-fat')).toBeNull();
    expect(screen.queryByTestId('header-macro-carbs')).toBeNull();
    expect(screen.queryByTestId('header-macro-fiber')).toBeNull();

    expect(screen.getByText(/totals are the sum of items/i)).toBeDefined();

    // Verify absolutely no hidden or visible macro inputs exist on multi-item card
    expect(screen.queryByTestId('calories-input')).toBeNull();
    expect(screen.queryByTestId('protein-input')).toBeNull();
    expect(screen.queryByTestId('carbs-input')).toBeNull();
    expect(screen.queryByTestId('fat-input')).toBeNull();
    expect(screen.queryByTestId('fiber-input')).toBeNull();
  });

  it('renders all macro figures when all macros are non-zero', () => {
    const meal = makeMultiItemMeal();
    meal.items[0].carbs = 20;
    meal.items[0].fiber = 5;
    meal.carbs = 20;
    meal.fiber = 5;
    render(
      <StagedMealCard
        stagedMeal={meal}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    expect(screen.getByTestId('staged-total-calories')).toHaveTextContent(/^484\s*kcal$/);
    expect(screen.getByTestId('staged-total-protein')).toHaveTextContent(/^39\.5\s*P$/);
    expect(screen.getByTestId('staged-total-carbs')).toHaveTextContent(/^20\s*C$/);
    expect(screen.getByTestId('staged-total-fat')).toHaveTextContent(/^34\.5\s*F$/);
    expect(screen.getByTestId('staged-total-fiber')).toHaveTextContent(/^5\s*Fib$/);

    // Verify header row is absent
    expect(screen.queryByTestId('macro-columns-header')).toBeNull();
  });

  it('renders muted 0 C in totals when a visible column has a 0 total', () => {
    const meal = makeMultiItemMeal();
    // One item has carbs so carbs is visible across the meal, but total carbs is 0
    meal.items[0].carbs = 0;
    meal.items[1].carbs = 0;
    meal.items[2].carbs = 0.06;
    meal.items[3].carbs = -0.06;
    meal.carbs = 0;
    render(
      <StagedMealCard
        stagedMeal={meal}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    // Totals carbs renders muted 0 C
    const totalCarbs = screen.getByTestId('staged-total-carbs');
    expect(totalCarbs).toHaveTextContent(/^0\s*C$/);
  });

  it('single-item meal: renders no inputs in the single-item card and hides Itemized Breakdown and This meal row', () => {
    const meal = makeStagedMeal();
    render(
      <StagedMealCard
        stagedMeal={meal}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    // No macro input fields exist on single-item card
    expect(screen.queryByTestId('calories-input')).toBeNull();
    expect(screen.queryByTestId('protein-input')).toBeNull();
    expect(screen.queryByTestId('carbs-input')).toBeNull();
    expect(screen.queryByTestId('fat-input')).toBeNull();
    expect(screen.queryByTestId('fiber-input')).toBeNull();

    // No Itemized Breakdown header or This meal row for 1 item
    expect(screen.queryByText(/itemized breakdown/i)).toBeNull();
    expect(screen.queryByTestId('this-meal-label')).toBeNull();
    expect(screen.queryByTestId('staged-meal-totals')).toBeNull();

    // The single item row is displayed directly
    expect(screen.getByTestId('component-name')).toHaveTextContent('Egg Frittata');
    expect(screen.getByTestId('component-quantity-input')).toHaveValue(1);
  });

  it('single-item meal: renders Day total row with 1 item when dailyTotals and targets provided', () => {
    const meal = makeStagedMeal(); // 600 kcal, 30 P, 40 C, 20 F, 5 Fib
    render(
      <StagedMealCard
        stagedMeal={meal}
        dailyTotals={{ calories: 1200, protein: 70, carbs: 100, fat: 40, fiber: 15 }}
        targets={{ calories: 2000, protein: 150, carbs: 200, fat: 70, fiber: 30 }}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    // Day total row is present even for a single-item meal (dropped isMultiItem gate)
    const dayTotal = screen.getByTestId('staged-meal-day-total');
    expect(dayTotal).toBeInTheDocument();
    expect(screen.getByTestId('day-total-label')).toHaveTextContent('Day total');

    // Day total arithmetic: 1200 + 600 = 1800 kcal, 70 + 30 = 100 P, 100 + 40 = 140 C, 40 + 20 = 60 F, 15 + 5 = 20 Fib
    expect(screen.getByTestId('day-total-val-calories')).toHaveTextContent('1800');
    expect(screen.getByTestId('day-total-val-protein')).toHaveTextContent('100');
    expect(screen.getByTestId('day-total-val-carbs')).toHaveTextContent('140');
    expect(screen.getByTestId('day-total-val-fat')).toHaveTextContent('60');
    expect(screen.getByTestId('day-total-val-fiber')).toHaveTextContent('20');

    // This meal row remains hidden for single item
    expect(screen.queryByTestId('this-meal-label')).toBeNull();
  });

  it('single-item meal: modal edit updates item 0 nutrition and recomputes meal totals', () => {
    const meal = makeStagedMeal();
    let currentMeal = meal;
    const onUpdateStagedMeal = vi.fn((updated: StagedMeal) => {
      currentMeal = updated;
    });
    const onLogStagedMeal = vi.fn();

    const { rerender } = render(
      <StagedMealCard
        stagedMeal={currentMeal}
        onUpdateStagedMeal={onUpdateStagedMeal}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={onLogStagedMeal}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    // Open overflow menu for the item
    fireEvent.click(screen.getByTestId('component-actions'));
    // Click Edit nutrition
    fireEvent.click(screen.getByTestId('component-edit-nutrition'));

    // Modal is open, edit calories and protein
    fireEvent.change(screen.getByTestId('edit-item-calories-input'), { target: { value: '750' } });
    fireEvent.change(screen.getByTestId('edit-item-protein-input'), { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('save-edit-item-nutrition-btn'));

    expect(onUpdateStagedMeal).toHaveBeenCalledTimes(1);
    const updated = onUpdateStagedMeal.mock.calls[0][0] as StagedMeal;

    // Item 0 is updated
    expect(updated.items[0].calories).toBe(750);
    expect(updated.items[0].protein).toBe(45);
    expect(updated.items[0].baseCalories).toBe(750);
    expect(updated.items[0].baseProtein).toBe(45);
    expect(updated.items[0].userOverridden).toBe(true);

    // Meal totals recomputed to match item 0
    expect(updated.calories).toBe(750);
    expect(updated.protein).toBe(45);

    // Rerender with updated meal and verify Log Meal button reflects the edited calories
    rerender(
      <StagedMealCard
        stagedMeal={updated}
        onUpdateStagedMeal={onUpdateStagedMeal}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={onLogStagedMeal}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    expect(screen.getByText('Log Meal (+750 kcal)')).toBeInTheDocument();
  });

  it('deleting from 2 items down to 1: removes This meal row and Itemized Breakdown header without rendering inputs', () => {
    const multiMeal: StagedMeal = {
      name: '2-Item Meal',
      mealType: 'Lunch',
      explanation: 'Calculated from ingredients',
      servingSize: 1,
      servingUnit: 'serving',
      calories: 300,
      protein: 25,
      carbs: 20,
      fat: 10,
      fiber: 2,
      items: [
        {
          id: 'item-1',
          name: 'Chicken Breast',
          portion: '100g',
          portionMultiplier: 1,
          quantity: 100,
          unit: 'g',
          calories: 165,
          protein: 31,
          carbs: 0,
          fat: 3.6,
          fiber: 0,
          baseQuantity: 100,
          baseCalories: 165,
          baseProtein: 31,
          baseCarbs: 0,
          baseFat: 3.6,
          baseFiber: 0,
        },
        {
          id: 'item-2',
          name: 'Brown Rice',
          portion: '100g',
          portionMultiplier: 1,
          quantity: 100,
          unit: 'g',
          calories: 135,
          protein: 3,
          carbs: 28,
          fat: 1,
          fiber: 2,
          baseQuantity: 100,
          baseCalories: 135,
          baseProtein: 3,
          baseCarbs: 28,
          baseFat: 1,
          baseFiber: 2,
        },
      ],
    };

    const onDeleteItem = vi.fn();
    const { rerender } = render(
      <StagedMealCard
        stagedMeal={multiMeal}
        dailyTotals={{ calories: 500, protein: 30, carbs: 50, fat: 20, fiber: 5 }}
        targets={{ calories: 2000, protein: 150, carbs: 200, fat: 70, fiber: 30 }}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={onDeleteItem}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    // Initial 2-item state: shows Itemized Breakdown (2) and This meal row
    expect(screen.getByText(/itemized breakdown \(2\)/i)).toBeInTheDocument();
    expect(screen.getByTestId('this-meal-label')).toHaveTextContent('This meal');
    expect(screen.getByTestId('staged-meal-day-total')).toBeInTheDocument();

    // Trigger delete on item-2
    const actionButtons = screen.getAllByTestId('component-actions');
    fireEvent.click(actionButtons[1]);
    fireEvent.click(screen.getByTestId('component-remove'));
    expect(onDeleteItem).toHaveBeenCalledWith('item-2');

    // Simulate parent state update after delete down to 1 item
    const singleMeal: StagedMeal = {
      ...multiMeal,
      calories: 165,
      protein: 31,
      carbs: 0,
      fat: 3.6,
      fiber: 0,
      items: [multiMeal.items[0]],
    };

    rerender(
      <StagedMealCard
        stagedMeal={singleMeal}
        dailyTotals={{ calories: 500, protein: 30, carbs: 50, fat: 20, fiber: 5 }}
        targets={{ calories: 2000, protein: 150, carbs: 200, fat: 70, fiber: 30 }}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={onDeleteItem}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    // 1-item state: This meal row and Itemized Breakdown are gone!
    expect(screen.queryByText(/itemized breakdown/i)).toBeNull();
    expect(screen.queryByTestId('this-meal-label')).toBeNull();
    expect(screen.queryByTestId('staged-meal-totals')).toBeNull();

    // No inputs appear!
    expect(screen.queryByTestId('calories-input')).toBeNull();
    expect(screen.queryByTestId('protein-input')).toBeNull();

    // Day total remains visible
    expect(screen.getByTestId('staged-meal-day-total')).toBeInTheDocument();
    expect(screen.getByTestId('day-total-val-calories')).toHaveTextContent('665'); // 500 + 165
  });

  it('Option A: wires onEditNutrition to update item nutrition and recompute staged totals', () => {
    const meal = makeMultiItemMeal();
    const onUpdateStagedMeal = vi.fn();
    render(
      <StagedMealCard
        stagedMeal={meal}
        onUpdateStagedMeal={onUpdateStagedMeal}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    // Open overflow menu on the first item (Salmon: 104 kcal)
    const actionButtons = screen.getAllByTestId('component-actions');
    fireEvent.click(actionButtons[0]);

    // Click "Edit nutrition"
    const editBtn = screen.getByTestId('component-edit-nutrition');
    fireEvent.click(editBtn);

    // Edit nutrition modal is open
    const calInput = screen.getByTestId('edit-item-calories-input');
    fireEvent.change(calInput, { target: { value: '150' } });

    // Save
    const saveBtn = screen.getByTestId('save-edit-item-nutrition-btn');
    fireEvent.click(saveBtn);

    expect(onUpdateStagedMeal).toHaveBeenCalledTimes(1);
    const updated = onUpdateStagedMeal.mock.calls[0][0] as StagedMeal;

    // First item updated: 150 kcal
    expect(updated.items[0].calories).toBe(150);
    expect(updated.items[0].baseCalories).toBe(150);
    expect(updated.items[0].userOverridden).toBe(true);

    // Totals recomputed: 484 - 104 + 150 = 530 kcal
    expect(updated.calories).toBe(530);
  });

  it('Task 5 (revised): renders This meal label on totals and Day total row directly under bold totals when dailyTotals and targets provided', () => {
    const meal = makeMultiItemMeal();
    render(
      <StagedMealCard
        stagedMeal={meal}
        dailyTotals={{ calories: 1000, protein: 50, carbs: 0, fat: 30, fiber: 0 }}
        targets={{ calories: 2000, protein: 120, carbs: 200, fat: 70, fiber: 30 }}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    // This meal label on totals
    expect(screen.getByTestId('this-meal-label')).toHaveTextContent('This meal');

    // Day total row
    const dayTotal = screen.getByTestId('staged-meal-day-total');
    expect(dayTotal).toBeInTheDocument();
    expect(screen.getByTestId('day-total-label')).toHaveTextContent('Day total');

    // Multi-item meal has totals: 484 kcal, 39.5 P, 34.5 F
    // Daily totals: 1000 kcal, 50 P, 30 F
    // Day total: 1484 kcal, 89.5 P, 64.5 F
    expect(screen.getByTestId('day-total-val-calories')).toHaveTextContent('1484');
    expect(screen.getByTestId('day-total-val-protein')).toHaveTextContent('89.5');
    expect(screen.getByTestId('day-total-val-fat')).toHaveTextContent('64.5');
  });

  it('Task 5: omits Day total row when neither dailyTotals nor targets provided', () => {
    const meal = makeMultiItemMeal();
    render(
      <StagedMealCard
        stagedMeal={meal}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    expect(screen.queryByTestId('staged-meal-day-total')).toBeNull();
  });

  it('Task 5: highlights red and adds accessible text when over target, keeps standard macro colors otherwise', () => {
    const meal = makeMultiItemMeal(); // 484 kcal, 39.5 P
    render(
      <StagedMealCard
        stagedMeal={meal}
        dailyTotals={{ calories: 1600, protein: 75, carbs: 0, fat: 20, fiber: 0 }}
        targets={{ calories: 2000, protein: 120, carbs: 200, fat: 80, fiber: 30 }}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    // Calories: 1600 + 484 = 2084 > 2000 -> red (text-rose-400), accessible description present
    const calCell = screen.getByTestId('day-total-calories');
    expect(calCell).toHaveClass('text-rose-400');
    expect(screen.getByTestId('day-total-over-calories')).toHaveTextContent('over target by 84 kcal');

    // Protein: 75 + 39.5 = 114.5 <= 120 -> cyan-400 (no amber tier, no red)
    const pCell = screen.getByTestId('day-total-protein');
    expect(pCell).toHaveClass('text-cyan-400');
    expect(pCell).not.toHaveClass('text-rose-400');
    expect(screen.queryByTestId('day-total-over-protein')).toBeNull();
  });
  describe('Batch 3: sticky action row and scrollIntoView', () => {
    it('action row has the sticky class and bottom style set to nav height', () => {
      const meal = makeMultiItemMeal();
      render(
        <StagedMealCard
          stagedMeal={meal}
          navHeight={66}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      const actionRow = screen.getByTestId('staged-card-actions');
      expect(actionRow).toHaveClass('sticky');
      expect(actionRow.className).toContain('sticky');
      expect(actionRow).toHaveStyle({ bottom: '66px' });
    });

    it('scroll called with smooth normally on mount', () => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;

      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const meal = makeMultiItemMeal();
      render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });

    it('scroll called with auto when prefers-reduced-motion matches', () => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;

      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const meal = makeMultiItemMeal();
      render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    });

    it('guards against window.matchMedia being absent in jsdom', () => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;

      const originalMatchMedia = window.matchMedia;
      // @ts-expect-error test absence
      delete window.matchMedia;

      const meal = makeMultiItemMeal();
      render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      window.matchMedia = originalMatchMedia;
    });

    it('does not re-scroll on re-render or quantity change', () => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;

      const meal = makeMultiItemMeal();
      const { rerender } = render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      expect(scrollSpy).toHaveBeenCalledTimes(1);

      const updatedMeal = {
        ...meal,
        items: [
          { ...meal.items[0], quantity: 200, calories: 400 },
          ...meal.items.slice(1),
        ],
      };

      rerender(
        <StagedMealCard
          stagedMeal={updatedMeal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      expect(scrollSpy).toHaveBeenCalledTimes(1);
    });
  });


  it('applies minmax responsive grid template and whitespace-nowrap on totals cells', () => {
    const multiMeal: StagedMeal = {
      name: '2-Item Meal',
      mealType: 'Lunch',
      explanation: 'Calculated from ingredients',
      servingSize: 1,
      servingUnit: 'serving',
      calories: 300,
      protein: 25,
      carbs: 20,
      fat: 10,
      fiber: 2,
      items: [
        {
          id: 'item-1',
          name: 'Chicken Breast',
          portion: '100g',
          portionMultiplier: 1,
          quantity: 100,
          unit: 'g',
          calories: 165,
          protein: 31,
          carbs: 0,
          fat: 3.6,
          fiber: 0,
          baseQuantity: 100,
          baseCalories: 165,
          baseProtein: 31,
          baseCarbs: 0,
          baseFat: 3.6,
          baseFiber: 0,
        },
        {
          id: 'item-2',
          name: 'Brown Rice',
          portion: '100g',
          portionMultiplier: 1,
          quantity: 100,
          unit: 'g',
          calories: 135,
          protein: 3,
          carbs: 28,
          fat: 1,
          fiber: 2,
          baseQuantity: 100,
          baseCalories: 135,
          baseProtein: 3,
          baseCarbs: 28,
          baseFat: 1,
          baseFiber: 2,
        },
      ],
    };

    render(
      <StagedMealCard
        stagedMeal={multiMeal}
        onUpdateStagedMeal={vi.fn()}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onLogStagedMeal={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
        isPending={false}
      />
    );

    const totalsGrid = screen.getByTestId('staged-meal-totals-grid');
    expect(totalsGrid.style.gridTemplateColumns).toBe(
      'minmax(3rem, 4.5rem) minmax(2.5rem, 3.5rem) minmax(2.5rem, 3.5rem) minmax(2.5rem, 3.5rem) minmax(2.5rem, 3.5rem)'
    );

    const calTotal = screen.getByTestId('staged-total-calories');
    expect(calTotal).toHaveClass('whitespace-nowrap');
  });

  describe('Add item flow', () => {
    it('renders + Add item control on single-item card and multi-item card', () => {
      const singleMeal = makeStagedMeal();
      const { unmount } = render(
        <StagedMealCard
          stagedMeal={singleMeal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );
      expect(screen.getByTestId('add-item-button')).toBeDefined();
      expect(screen.getByText('+ Add')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Add item' })).toBeDefined();
      unmount();

      const multiMeal = makeMultiItemMeal();
      render(
        <StagedMealCard
          stagedMeal={multiMeal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );
      expect(screen.getByTestId('add-item-button')).toBeDefined();
    });

    it('renders "+ Add" button with aria-label on single, multi-component, AI and manual staged cards and opens composer', () => {
      const cardTypes: Array<{ type: string; meal: StagedMeal }> = [
        {
          type: 'single-item',
          meal: makeStagedMeal(),
        },
        {
          type: 'multi-component',
          meal: makeMultiItemMeal(),
        },
        {
          type: 'AI-parsed',
          meal: {
            ...makeMultiItemMeal(),
            name: 'AI Parsed Salmon & Rice',
            explanation: 'AI detected 4 items: salmon, rice, broccoli, oil',
          },
        },
        {
          type: 'manual',
          meal: {
            name: 'Quick Chicken Manual',
            explanation: 'Manual entry',
            mealType: 'Lunch',
            servingSize: 1,
            servingUnit: 'serving',
            calories: 350,
            protein: 40,
            carbs: 0,
            fat: 8,
            fiber: 0,
            items: [
              {
                id: 'manual-1',
                name: 'Grilled Chicken Breast',
                portion: '200 g',
                portionMultiplier: 1,
                quantity: 200,
                unit: 'g',
                calories: 350,
                protein: 40,
                carbs: 0,
                fat: 8,
                fiber: 0,
                baseQuantity: 200,
                baseCalories: 350,
                baseProtein: 40,
                baseCarbs: 0,
                baseFat: 8,
                baseFiber: 0,
              },
            ],
          },
        },
      ];

      for (const { type: _type, meal } of cardTypes) {
        const { unmount } = render(
          <StagedMealCard
            stagedMeal={meal}
            onUpdateStagedMeal={vi.fn()}
            onApplyStagedItemChange={vi.fn()}
            onDeleteItem={vi.fn()}
            onSaveItemAsCustomDish={vi.fn()}
            onLogStagedMeal={vi.fn()}
            onSaveStagedAsCustomDish={vi.fn()}
            onDiscardStagedMeal={vi.fn()}
            isPending={false}
          />
        );

        const btn = screen.getByTestId('add-item-button');
        expect(btn).toBeDefined();
        expect(btn.textContent?.trim()).toBe('+ Add');
        expect(btn.getAttribute('aria-label')).toBe('Add item');
        expect(screen.getByRole('button', { name: 'Add item' })).toBeDefined();

        // Clicking + Add opens the inline composer
        expect(screen.queryByTestId('add-items-composer')).toBeNull();
        fireEvent.click(btn);
        expect(screen.getByTestId('add-items-composer')).toBeDefined();

        // Clicking Enter manually inside composer opens AddItemForm
        fireEvent.click(screen.getByRole('button', { name: /enter manually/i }));
        expect(screen.getByTestId('add-item-form')).toBeDefined();

        unmount();
      }
    });

    it('focus returns to "+ Add" button when composer is closed via Cancel', () => {
      const meal = makeStagedMeal();
      render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      const addBtn = screen.getByTestId('add-item-button');
      fireEvent.click(addBtn);

      const composer = screen.getByTestId('add-items-composer');
      expect(composer).toBeDefined();

      const cancelBtn = screen.getByTestId('cancel-composer-button');
      fireEvent.click(cancelBtn);

      expect(screen.queryByTestId('add-items-composer')).toBeNull();
      expect(document.activeElement).toBe(screen.getByTestId('add-item-button'));
    });


    it('clicking + Add item opens the composer, Enter manually opens the inline form, and Cancel closes it without changes', () => {
      const meal = makeStagedMeal();
      const onUpdateStagedMeal = vi.fn();
      render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={onUpdateStagedMeal}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      // Initially inline form is not open
      expect(screen.queryByTestId('add-item-form')).toBeNull();

      // Click + Add item, then Enter manually
      fireEvent.click(screen.getByTestId('add-item-button'));
      expect(screen.getByTestId('add-items-composer')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: /enter manually/i }));
      expect(screen.getByTestId('add-item-form')).toBeDefined();
      expect(screen.queryByTestId('add-item-button')).toBeNull(); // button hidden while form open

      // Click Cancel
      fireEvent.click(screen.getByTestId('cancel-add-item-button'));
      expect(screen.queryByTestId('add-item-form')).toBeNull();
      expect(screen.getByTestId('add-item-button')).toBeDefined();
      expect(onUpdateStagedMeal).not.toHaveBeenCalled();
    });

    it('submitting Add item appends item and updates totals to Σ(items)', () => {
      const meal = makeStagedMeal(); // 600 kcal, 30 P, 40 C, 20 F, 5 Fib (1 item: Egg Frittata)
      let currentMeal = meal;
      const onUpdateStagedMeal = vi.fn((updated) => {
        currentMeal = updated;
      });

      const { rerender } = render(
        <StagedMealCard
          stagedMeal={currentMeal}
          onUpdateStagedMeal={onUpdateStagedMeal}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      fireEvent.click(screen.getByTestId('add-item-button'));
      fireEvent.click(screen.getByRole('button', { name: /enter manually/i }));

      // Fill in new item (White Rice, 200g, 260 kcal, 5 P, 56 C, 1 F, 2 Fib)
      fireEvent.change(screen.getByTestId('add-item-name-input'), { target: { value: 'White Rice' } });
      fireEvent.change(screen.getByTestId('add-item-quantity-input'), { target: { value: '200' } });
      fireEvent.change(screen.getByTestId('add-item-unit-input'), { target: { value: 'g' } });
      fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '260' } });
      fireEvent.change(screen.getByTestId('add-item-protein-input'), { target: { value: '5' } });
      fireEvent.change(screen.getByTestId('add-item-carbs-input'), { target: { value: '56' } });
      fireEvent.change(screen.getByTestId('add-item-fat-input'), { target: { value: '1' } });
      fireEvent.change(screen.getByTestId('add-item-fiber-input'), { target: { value: '2' } });

      fireEvent.click(screen.getByTestId('submit-add-item-button'));

      expect(onUpdateStagedMeal).toHaveBeenCalled();
      expect(currentMeal.items.length).toBe(2);
      expect(currentMeal.items[1].name).toBe('White Rice');
      expect(currentMeal.items[1].calories).toBe(260);

      // Σ(items): 600 + 260 = 860 kcal, 30 + 5 = 35 P, 40 + 56 = 96 C, 20 + 1 = 21 F, 5 + 2 = 7 Fib
      expect(currentMeal.calories).toBe(860);
      expect(currentMeal.protein).toBe(35);
      expect(currentMeal.carbs).toBe(96);
      expect(currentMeal.fat).toBe(21);
      expect(currentMeal.fiber).toBe(7);

      // Rerender with updated meal: multi-item totals row appears, read-only
      rerender(
        <StagedMealCard
          stagedMeal={currentMeal}
          onUpdateStagedMeal={onUpdateStagedMeal}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      expect(screen.getByTestId('this-meal-label')).toBeDefined();
      const totalsBox = screen.getByTestId('staged-meal-totals');
      expect(within(totalsBox).getByTestId('macro-val-calories')).toHaveTextContent('860');
      expect(within(totalsBox).getByTestId('macro-val-protein')).toHaveTextContent('35');
      expect(within(totalsBox).getByTestId('macro-val-carbs')).toHaveTextContent('96');
      expect(within(totalsBox).getByTestId('macro-val-fat')).toHaveTextContent('21');
      expect(within(totalsBox).getByTestId('macro-val-fiber')).toHaveTextContent('7');
    });

    it('preserves single-item nutrition edits when Add item appends second item', () => {
      const meal = makeStagedMeal(); // 600 kcal
      let currentMeal = meal;
      const onUpdateStagedMeal = vi.fn((updated) => {
        currentMeal = updated;
      });

      const { rerender } = render(
        <StagedMealCard
          stagedMeal={currentMeal}
          onUpdateStagedMeal={onUpdateStagedMeal}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      // Step 1: Edit nutrition on single item (600 -> 750 kcal)
      fireEvent.click(screen.getByTestId('component-actions'));
      fireEvent.click(screen.getByTestId('component-edit-nutrition'));
      fireEvent.change(screen.getByTestId('edit-item-calories-input'), { target: { value: '750' } });
      fireEvent.click(screen.getByTestId('save-edit-item-nutrition-btn'));

      expect(onUpdateStagedMeal).toHaveBeenCalled();
      expect(currentMeal.items[0].calories).toBe(750);
      expect(currentMeal.calories).toBe(750);

      // Step 2: Add item to the meal
      rerender(
        <StagedMealCard
          stagedMeal={currentMeal}
          onUpdateStagedMeal={onUpdateStagedMeal}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      fireEvent.click(screen.getByTestId('add-item-button'));
      fireEvent.click(screen.getByRole('button', { name: /enter manually/i }));
      fireEvent.change(screen.getByTestId('add-item-name-input'), { target: { value: 'Side Salad' } });
      fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '50' } });
      fireEvent.click(screen.getByTestId('submit-add-item-button'));

      // Totals = 750 (edited item 0) + 50 (new item) = 800 (no silent discard)
      expect(currentMeal.items[0].calories).toBe(750);
      expect(currentMeal.items[1].calories).toBe(50);
      expect(currentMeal.calories).toBe(800);
    });

    it('clicking Log Meal calls onLogStagedMeal', () => {
      const meal = makeStagedMeal();
      const onLogStagedMeal = vi.fn();
      render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={onLogStagedMeal}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      const logBtn = screen.getByRole('button', { name: /log meal/i });
      fireEvent.click(logBtn);
      expect(onLogStagedMeal).toHaveBeenCalled();
    });

    it('provides accessible name for meal name input and save as custom dish button (F2)', () => {
      const meal = makeStagedMeal();
      render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      const mealNameInput = screen.getByRole('textbox', { name: 'Meal name' });
      expect(mealNameInput).toBe(screen.getByTestId('dish-name-input'));

      const saveDishBtn = screen.getByRole('button', { name: 'Save as Custom Dish' });
      expect(saveDishBtn).toHaveAttribute('aria-label', 'Save as Custom Dish');

      const mealTypeSelect = screen.getByRole('combobox', { name: 'Meal type' });
      expect(mealTypeSelect).toHaveClass('text-base');
    });

    it('applies motion-reduce variants to animations and transitions (F9)', () => {
      const meal = makeStagedMeal();
      render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      const card = screen.getByTestId('staged-meal-card');
      expect(card).toHaveClass('motion-reduce:animate-none');
    });

    it('A2: does not steal focus when user moves focus to another input before autofocus callback runs', async () => {
      const outsideInput = document.createElement('input');
      outsideInput.setAttribute('data-testid', 'outside-input');
      document.body.appendChild(outsideInput);

      // Simulate user already focused another input (e.g. date picker or quick log)
      outsideInput.focus();
      expect(document.activeElement).toBe(outsideInput);

      const meal = makeStagedMeal();
      render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={vi.fn()}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));

      // On old code, dishNameInput unconditionally stole focus
      expect(document.activeElement).toBe(outsideInput);
      document.body.removeChild(outsideInput);
    });

    it('Finding #5: returns focus to Log button when mutation errors and focus was dropped to body', async () => {
      const meal = makeStagedMeal();
      const onLog = vi.fn();
      const { rerender } = render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={onLog}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      const logBtn = screen.getByRole('button', { name: /Log Meal/i });
      logBtn.focus();
      expect(document.activeElement).toBe(logBtn);

      fireEvent.click(logBtn);
      expect(onLog).toHaveBeenCalledTimes(1);

      // Pending state disables button; simulate focus dropping to body
      rerender(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={onLog}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={true}
        />
      );

      document.body.tabIndex = -1;
      document.body.focus();
      expect(document.activeElement).toBe(document.body);

      // Mutation errors, isPending becomes false while card remains mounted
      rerender(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={onLog}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      expect(document.activeElement).toBe(logBtn);
      document.body.removeAttribute('tabindex');
    });

    it('Finding #5: does NOT move focus to Log button on error if user moved focus elsewhere during pending', async () => {
      const meal = makeStagedMeal();
      const onLog = vi.fn();
      const outsideInput = document.createElement('input');
      outsideInput.setAttribute('data-testid', 'outside-input');
      document.body.appendChild(outsideInput);

      const { rerender } = render(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={onLog}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      const logBtn = screen.getByRole('button', { name: /Log Meal/i });
      logBtn.focus();
      expect(document.activeElement).toBe(logBtn);

      fireEvent.click(logBtn);

      // Pending state
      rerender(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={onLog}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={true}
        />
      );

      // User focuses outside input while pending
      outsideInput.focus();
      expect(document.activeElement).toBe(outsideInput);

      // Mutation errors
      rerender(
        <StagedMealCard
          stagedMeal={meal}
          onUpdateStagedMeal={vi.fn()}
          onApplyStagedItemChange={vi.fn()}
          onDeleteItem={vi.fn()}
          onSaveItemAsCustomDish={vi.fn()}
          onLogStagedMeal={onLog}
          onSaveStagedAsCustomDish={vi.fn()}
          onDiscardStagedMeal={vi.fn()}
          isPending={false}
        />
      );

      // Should not steal focus from outsideInput
      expect(document.activeElement).toBe(outsideInput);
      document.body.removeChild(outsideInput);
    });
  });
});

describe('StagedMealCard mode="edit" vs mode="stage"', () => {
  it('default mode="stage" is byte-identical to omitting mode', () => {
    const meal = makeMultiItemMeal();
    const props = {
      stagedMeal: meal,
      onUpdateStagedMeal: vi.fn(),
      onApplyStagedItemChange: vi.fn(),
      onDeleteItem: vi.fn(),
      onSaveItemAsCustomDish: vi.fn(),
      onLogStagedMeal: vi.fn(),
      onSaveStagedAsCustomDish: vi.fn(),
      onDiscardStagedMeal: vi.fn(),
      isPending: false,
      navHeight: 66,
    };

    const { container: c1 } = render(<StagedMealCard {...props} />);
    const { container: c2 } = render(<StagedMealCard {...props} mode="stage" />);

    expect(c1.firstElementChild?.outerHTML).toBe(c2.firstElementChild?.outerHTML);
  });

  it('renders edit mode elements: date row, Scale chip (no scale bar), Save changes button, Cancel button, and star', () => {
    const meal = makeMultiItemMeal();
    const onDateChange = vi.fn();
    const onUpdateStagedMeal = vi.fn();
    const onCancel = vi.fn();
    const onSave = vi.fn();

    const { rerender } = render(
      <StagedMealCard
        mode="edit"
        stagedMeal={meal}
        date="2026-09-26"
        isDirty={false}
        isPending={false}
        onDateChange={onDateChange}
        onCancel={onCancel}
        onLogStagedMeal={onSave}
        onUpdateStagedMeal={onUpdateStagedMeal}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
      />
    );

    // 1. Date input row under header
    const dateInput = screen.getByTestId('edit-meal-date-input') as HTMLInputElement;
    expect(dateInput).toBeInTheDocument();
    expect(dateInput.value).toBe('2026-09-26');
    fireEvent.change(dateInput, { target: { value: '2026-09-25' } });
    expect(onDateChange).toHaveBeenCalledWith('2026-09-25');

    // 2. the x0.5-x2 bar is gone; the header Scale chip scales the draft
    expect(screen.queryByTestId('dish-scale-bar')).toBeNull();
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    const scaleInput = screen.getByTestId('meal-scale-input');
    fireEvent.change(scaleInput, { target: { value: '0.5' } });
    fireEvent.keyDown(scaleInput, { key: 'Enter' });
    expect(onUpdateStagedMeal).toHaveBeenCalledTimes(1);
    const scaled = onUpdateStagedMeal.mock.calls[0][0] as StagedMeal;
    expect(scaled.scale).toBe(0.5);
    expect(scaled.calories).toBeCloseTo(meal.calories / 2, 0);

    // 3. Primary button reads 'Save changes' and is disabled when not dirty
    const saveBtn = screen.getByTestId('save-edit-meal-btn');
    expect(saveBtn).toHaveTextContent('Save changes');
    expect(saveBtn).toBeDisabled();

    // 4. Cancel button replaces discard (x)
    expect(screen.queryByLabelText('Discard staged meal')).toBeNull();
    const cancelBtn = screen.getByTestId('cancel-edit-meal-btn');
    expect(cancelBtn).toHaveTextContent('Cancel');
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalled();

    // 5. Star button (Save as custom dish) stays
    expect(screen.getByLabelText('Save as Custom Dish')).toBeInTheDocument();

    // 6. Action row has bottom 0px (sticks to sheet bottom, not nav)
    const actions = screen.getByTestId('staged-card-actions');
    expect(actions.style.bottom).toBe('0px');

    // 7. When isDirty = true, Save changes button is enabled
    rerender(
      <StagedMealCard
        mode="edit"
        stagedMeal={meal}
        date="2026-09-26"
        isDirty={true}
        isPending={false}
        onDateChange={onDateChange}
        onCancel={onCancel}
        onLogStagedMeal={onSave}
        onUpdateStagedMeal={onUpdateStagedMeal}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
      />
    );
    expect(saveBtn).toBeEnabled();

    // 8. When isPending = true, Save changes button reads 'Saving...' and is disabled
    rerender(
      <StagedMealCard
        mode="edit"
        stagedMeal={meal}
        date="2026-09-26"
        isDirty={true}
        isPending={true}
        onDateChange={onDateChange}
        onCancel={onCancel}
        onLogStagedMeal={onSave}
        onUpdateStagedMeal={onUpdateStagedMeal}
        onApplyStagedItemChange={vi.fn()}
        onDeleteItem={vi.fn()}
        onSaveItemAsCustomDish={vi.fn()}
        onSaveStagedAsCustomDish={vi.fn()}
        onDiscardStagedMeal={vi.fn()}
      />
    );
    expect(saveBtn).toHaveTextContent('Saving...');
    expect(saveBtn).toBeDisabled();
  });
});

describe('Scale chip on the staged card', () => {
  const baseProps = {
    onApplyStagedItemChange: vi.fn(),
    onDeleteItem: vi.fn(),
    onSaveItemAsCustomDish: vi.fn(),
    onLogStagedMeal: vi.fn(),
    onSaveStagedAsCustomDish: vi.fn(),
    onDiscardStagedMeal: vi.fn(),
    isPending: false,
    navHeight: 66,
  };

  it('sits next to "+ Add" in stage mode and scales every item and the totals', () => {
    const meal = makeMultiItemMeal();
    const onUpdateStagedMeal = vi.fn();
    render(<StagedMealCard {...baseProps} stagedMeal={meal} onUpdateStagedMeal={onUpdateStagedMeal} />);

    const scaleBtn = screen.getByTestId('meal-scale-button');
    const addBtn = screen.getByTestId('add-item-button');
    expect(scaleBtn.parentElement).toBe(addBtn.parentElement);
    expect(screen.queryByTestId('dish-scale-bar')).toBeNull();

    fireEvent.click(scaleBtn);
    const input = screen.getByTestId('meal-scale-input');
    fireEvent.change(input, { target: { value: '0.2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateStagedMeal).toHaveBeenCalledTimes(1);
    const next = onUpdateStagedMeal.mock.calls[0][0] as StagedMeal;
    expect(next.scale).toBe(0.2);
    expect(next.items.map((it) => it.quantity)).toEqual(meal.items.map((it) => Math.round(it.quantity * 0.2 * 10000) / 10000));
    expect(next.calories).toBeCloseTo(next.items.reduce((a, it) => a + it.calories, 0), 5);
    expect(next.name).toBe(meal.name);
    expect(next.mealType).toBe(meal.mealType);
  });

  it('shows the active factor and the Log button reflects the scaled total', () => {
    const meal = makeMultiItemMeal();
    const { rerender } = render(<StagedMealCard {...baseProps} stagedMeal={meal} onUpdateStagedMeal={vi.fn()} />);
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    const input = screen.getByTestId('meal-scale-input');
    fireEvent.change(input, { target: { value: '0.5' } });
    const onUpdate = vi.fn();
    rerender(<StagedMealCard {...baseProps} stagedMeal={meal} onUpdateStagedMeal={onUpdate} />);
    fireEvent.keyDown(screen.getByTestId('meal-scale-input'), { key: 'Enter' });
    const scaled = onUpdate.mock.calls[0][0] as StagedMeal;

    rerender(<StagedMealCard {...baseProps} stagedMeal={scaled} onUpdateStagedMeal={vi.fn()} />);
    expect(screen.getByTestId('meal-scale-button')).toHaveTextContent('×0.5');
    expect(screen.getByRole('button', { name: /Log Meal \(\+242 kcal\)/ })).toBeInTheDocument();
  });

  it('is available on a single-item card too and scales servingSize', () => {
    const meal = makeStagedMeal();
    const onUpdate = vi.fn();
    render(<StagedMealCard {...baseProps} stagedMeal={meal} onUpdateStagedMeal={onUpdate} />);
    expect(screen.getByTestId('meal-scale-button')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('meal-scale-button'));
    const input = screen.getByTestId('meal-scale-input');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const scaled = onUpdate.mock.calls[0][0] as StagedMeal;
    expect(scaled.scale).toBe(2);
    expect(scaled.servingSize).toBe(meal.items[0].quantity * 2);
  });

  it('renders a short "Items (n)" label for narrow screens alongside the full label', () => {
    render(<StagedMealCard {...baseProps} stagedMeal={makeMultiItemMeal()} onUpdateStagedMeal={vi.fn()} />);
    expect(screen.getByText('Itemized Breakdown (4)')).toHaveClass('max-[389px]:hidden');
    expect(screen.getByText('Items (4)')).toHaveClass('hidden', 'max-[389px]:inline');
  });

  it('no-ops when re-typing the displayed quantity in ComponentRow without calling onApplyStagedItemChange', () => {
    const meal = makeMultiItemMeal();
    const onApply = vi.fn();
    render(<StagedMealCard {...baseProps} stagedMeal={meal} onUpdateStagedMeal={vi.fn()} onApplyStagedItemChange={onApply} />);
    const inputs = screen.getAllByTestId('component-quantity-input');
    const firstInput = inputs[0] as HTMLInputElement;
    const currentVal = firstInput.value;

    fireEvent.change(firstInput, { target: { value: currentVal } });
    fireEvent.blur(firstInput);

    expect(onApply).not.toHaveBeenCalled();
  });
});

