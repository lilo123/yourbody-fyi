import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomDishEditor } from './CustomDishEditor';
import { sumItems, type NutritionItem } from '../../utils/itemModel';
import { expectNoA11yViolations } from '../../test/a11y';

function item(over: Partial<NutritionItem> = {}): NutritionItem {
  return {
    id: 'i1',
    name: 'Rolled oats',
    quantity: 80,
    unit: 'g',
    displayPortion: '1 cup',
    calories: 300,
    protein: 10,
    carbs: 54,
    fat: 5,
    fiber: 8,
    ...over,
  };
}

describe('CustomDishEditor', () => {
  it('renders one row per component and a derived dish total', () => {
    render(
      <CustomDishEditor
        items={[item(), item({ id: 'i2', name: 'Whey', calories: 120, protein: 25, carbs: 3, fat: 1, fiber: 0 })]}
        onChange={() => {}}
      />
    );

    expect(screen.getAllByTestId('dish-item-row')).toHaveLength(2);
    const totals = screen.getByTestId('dish-derived-totals');
    // 300 + 120 = 420 kcal, 10 + 25 = 35 g protein.
    expect(totals.textContent).toContain('420');
    expect(totals.textContent).toContain('35');
  });

  it('adds an empty component with a usable default quantity', () => {
    const onChange = vi.fn();
    render(<CustomDishEditor items={[]} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('dish-add-item'));

    const next = onChange.mock.calls[0][0] as NutritionItem[];
    expect(next).toHaveLength(1);
    // A zero quantity would make the row unscalable later.
    expect(next[0].quantity).toBe(1);
    expect(next[0].unit).toBe('unit');
    expect(next[0].calories).toBe(0);
  });

  it('clamps a negative macro to zero rather than passing it to the DB', () => {
    const onChange = vi.fn();
    render(<CustomDishEditor items={[item()]} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('dish-item-calories'), { target: { value: '-50' } });

    expect((onChange.mock.calls[0][0] as NutritionItem[])[0].calories).toBe(0);
  });

  it('treats a cleared macro field as zero, not NaN', () => {
    const onChange = vi.fn();
    render(<CustomDishEditor items={[item()]} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('dish-item-protein'), { target: { value: '' } });

    const value = (onChange.mock.calls[0][0] as NutritionItem[])[0].protein;
    expect(Number.isNaN(value)).toBe(false);
    expect(value).toBe(0);
  });

  it('removes the targeted component and leaves the rest intact', () => {
    const onChange = vi.fn();
    render(
      <CustomDishEditor
        items={[item(), item({ id: 'i2', name: 'Whey' })]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getAllByTestId('dish-item-remove')[0]);

    const next = onChange.mock.calls[0][0] as NutritionItem[];
    expect(next.map((i) => i.id)).toEqual(['i2']);
  });

  it('accepts a decimal quantity without rounding it', () => {
    const onChange = vi.fn();
    render(<CustomDishEditor items={[item()]} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('dish-item-quantity'), { target: { value: '12.5' } });

    expect((onChange.mock.calls[0][0] as NutritionItem[])[0].quantity).toBe(12.5);
  });

  it('accepts decimal comma ("12,5") and rejects ambiguous separators ("1,2,3")', () => {
    const onChange = vi.fn();
    render(<CustomDishEditor items={[item()]} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('dish-item-quantity'), { target: { value: '12,5' } });
    expect((onChange.mock.calls[0][0] as NutritionItem[])[0].quantity).toBe(12.5);

    // Reject "1,2,3" (clears to 0 rather than accepting ambiguous numeric)
    onChange.mockClear();
    fireEvent.change(screen.getByTestId('dish-item-quantity'), { target: { value: '1,2,3' } });
    expect((onChange.mock.calls[0][0] as NutritionItem[])[0].quantity).toBe(0);
  });

  it('shows no totals block when there are no components', () => {
    render(<CustomDishEditor items={[]} onChange={() => {}} />);
    expect(screen.queryByTestId('dish-derived-totals')).toBeNull();
  });

  it('renders spelled out macro labels with matching color classes and 1-decimal values', () => {
    render(
      <CustomDishEditor
        items={[
          item({
            calories: 140.002499999999,
            protein: 24.0075,
            carbs: 1.97999999999999,
            fat: 3.465,
            fiber: 0,
          }),
        ]}
        onChange={() => {}}
      />
    );

    expect(screen.getByText('Calories')).toBeDefined();
    expect(screen.getByText('Protein (g)')).toBeDefined();
    expect(screen.getByText('Carbs (g)')).toBeDefined();
    expect(screen.getByText('Fat (g)')).toBeDefined();
    expect(screen.getByText('Fiber (g)')).toBeDefined();

    // Inputs should format to at most 1 decimal
    expect((screen.getByTestId('dish-item-calories') as HTMLInputElement).value).toBe('140');
    expect((screen.getByTestId('dish-item-protein') as HTMLInputElement).value).toBe('24');
    expect((screen.getByTestId('dish-item-carbs') as HTMLInputElement).value).toBe('2');
    expect((screen.getByTestId('dish-item-fat') as HTMLInputElement).value).toBe('3.5');
    expect((screen.getByTestId('dish-item-fiber') as HTMLInputElement).value).toBe('0');

    // Dish total should color P, C, F, and Fib
    const totals = screen.getByTestId('dish-derived-totals');
    const pSpan = totals.querySelector('.text-cyan-400');
    const cSpan = totals.querySelector('.text-emerald-400');
    const fSpan = totals.querySelector('.text-violet-400');
    const fibSpan = totals.querySelector('.text-teal-400');
    expect(pSpan?.textContent).toBe('P 24');
    expect(cSpan?.textContent).toBe('C 2');
    expect(fSpan?.textContent).toBe('F 3.5');
    expect(fibSpan?.textContent).toBe('Fib 0');
  });

  it('formats fractional quantities to 1 decimal place in input and display portion text', () => {
    const onChange = vi.fn();
    render(
      <CustomDishEditor
        items={[
          item({
            quantity: 33.333333333333336,
            displayPortion: '1/3 portion',
          }),
        ]}
        onChange={onChange}
      />
    );

    const qtyInput = screen.getByTestId('dish-item-quantity') as HTMLInputElement;
    expect(qtyInput.value).toBe('33.3');
    expect(screen.getByText(/was “1\/3 portion” · 33.3 g/)).toBeDefined();

    fireEvent.change(qtyInput, { target: { value: '45.67' } });
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as NutritionItem[];
    expect(updated[0].quantity).toBe(45.7);
  });

  it('associates Qty label with quantity input', () => {
    render(
      <CustomDishEditor
        items={[item()]}
        onChange={() => {}}
      />
    );
    expect(screen.getByLabelText('Qty')).toBe(screen.getByTestId('dish-item-quantity'));
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <CustomDishEditor
        items={[item()]}
        onChange={() => {}}
      />
    );
    await expectNoA11yViolations(container);
  });

  it('accepts decimal comma ("72,5") and decimal period ("72.5") on component macro inputs', () => {
    const onChange = vi.fn();
    render(<CustomDishEditor items={[item()]} onChange={onChange} />);

    // Test decimal comma on calories, protein, carbs, fat, fiber
    fireEvent.change(screen.getByTestId('dish-item-calories'), { target: { value: '72,5' } });
    expect((onChange.mock.calls[0][0] as NutritionItem[])[0].calories).toBe(72.5);

    onChange.mockClear();
    fireEvent.change(screen.getByTestId('dish-item-protein'), { target: { value: '72,5' } });
    expect((onChange.mock.calls[0][0] as NutritionItem[])[0].protein).toBe(72.5);

    onChange.mockClear();
    fireEvent.change(screen.getByTestId('dish-item-carbs'), { target: { value: '72,5' } });
    expect((onChange.mock.calls[0][0] as NutritionItem[])[0].carbs).toBe(72.5);

    onChange.mockClear();
    fireEvent.change(screen.getByTestId('dish-item-fat'), { target: { value: '72,5' } });
    expect((onChange.mock.calls[0][0] as NutritionItem[])[0].fat).toBe(72.5);

    onChange.mockClear();
    fireEvent.change(screen.getByTestId('dish-item-fiber'), { target: { value: '72,5' } });
    expect((onChange.mock.calls[0][0] as NutritionItem[])[0].fiber).toBe(72.5);

    // Test decimal period on macro inputs
    onChange.mockClear();
    fireEvent.change(screen.getByTestId('dish-item-calories'), { target: { value: '72.5' } });
    expect((onChange.mock.calls[0][0] as NutritionItem[])[0].calories).toBe(72.5);

    onChange.mockClear();
    fireEvent.change(screen.getByTestId('dish-item-protein'), { target: { value: '72.5' } });
    expect((onChange.mock.calls[0][0] as NutritionItem[])[0].protein).toBe(72.5);
  });

  describe('Scale nutrition in recipe editor', () => {
    it('checkbox renders when editing a dish, default ticked, and reveals hint when unticked', () => {
      render(
        <CustomDishEditor
          items={[item()]}
          onChange={() => {}}
          isEditing={true}
        />
      );

      const checkbox = screen.getByTestId('scale-nutrition-checkbox') as HTMLInputElement;
      expect(checkbox).toBeInTheDocument();
      expect(checkbox.checked).toBe(true);
      expect(screen.queryByTestId('scale-nutrition-hint')).not.toBeInTheDocument();

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
      const hint = screen.getByTestId('scale-nutrition-hint');
      expect(hint).toBeInTheDocument();
      expect(hint.textContent).toBe('Nutrition stays the same; only the serving size changes');
    });

    it('Qty 1->2 with it ticked doubles that component macros', () => {
      const onChange = vi.fn();
      render(
        <CustomDishEditor
          items={[
            item({
              quantity: 1,
              calories: 100,
              protein: 10,
              carbs: 20,
              fat: 5,
              fiber: 2,
            }),
          ]}
          onChange={onChange}
          isEditing={true}
        />
      );

      fireEvent.change(screen.getByTestId('dish-item-quantity'), { target: { value: '2' } });

      expect(onChange).toHaveBeenCalled();
      const updated = onChange.mock.calls[0][0] as NutritionItem[];
      expect(updated[0].quantity).toBe(2);
      expect(updated[0].calories).toBe(200);
      expect(updated[0].protein).toBe(20);
      expect(updated[0].carbs).toBe(40);
      expect(updated[0].fat).toBe(10);
      expect(updated[0].fiber).toBe(4);
    });

    it('unticked leaves macros unchanged when Qty changes', () => {
      const onChange = vi.fn();
      render(
        <CustomDishEditor
          items={[
            item({
              quantity: 1,
              calories: 100,
              protein: 10,
              carbs: 20,
              fat: 5,
              fiber: 2,
            }),
          ]}
          onChange={onChange}
          isEditing={true}
        />
      );

      // Untick the checkbox
      const checkbox = screen.getByTestId('scale-nutrition-checkbox');
      fireEvent.click(checkbox);

      // Change quantity 1 -> 2
      fireEvent.change(screen.getByTestId('dish-item-quantity'), { target: { value: '2' } });

      expect(onChange).toHaveBeenCalled();
      const updated = onChange.mock.calls[0][0] as NutritionItem[];
      expect(updated[0].quantity).toBe(2);
      expect(updated[0].calories).toBe(100);
      expect(updated[0].protein).toBe(10);
      expect(updated[0].carbs).toBe(20);
      expect(updated[0].fat).toBe(5);
      expect(updated[0].fiber).toBe(2);
    });

    it('saved dish passes the parent=sum check after scaling component quantity', () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <CustomDishEditor
          items={[
            item({
              id: 'c1',
              quantity: 1,
              calories: 100,
              protein: 10,
              carbs: 20,
              fat: 5,
              fiber: 2,
            }),
            item({
              id: 'c2',
              name: 'Peanut Butter',
              quantity: 1,
              calories: 90,
              protein: 4,
              carbs: 3,
              fat: 8,
              fiber: 1,
            }),
          ]}
          onChange={onChange}
          isEditing={true}
        />
      );

      // Scale first component Qty 1 -> 2 (doubles c1 to 200/20/40/10/4)
      const qtyInputs = screen.getAllByTestId('dish-item-quantity');
      fireEvent.change(qtyInputs[0], { target: { value: '2' } });

      expect(onChange).toHaveBeenCalled();
      const updatedItems = onChange.mock.calls[0][0] as NutritionItem[];
      expect(updatedItems[0].quantity).toBe(2);
      expect(updatedItems[0].calories).toBe(200);

      // Re-render with updated items to check totals
      rerender(
        <CustomDishEditor
          items={updatedItems}
          onChange={onChange}
          isEditing={true}
        />
      );

      const totals = sumItems(updatedItems);
      // c1 (200, 20, 40, 10, 4) + c2 (90, 4, 3, 8, 1) = 290 cal, 24 pro, 43 carbs, 18 fat, 5 fiber
      expect(totals.calories).toBe(290);
      expect(totals.protein).toBe(24);
      expect(totals.carbs).toBe(43);
      expect(totals.fat).toBe(18);
      expect(totals.fiber).toBe(5);

      // Parent equals sum of items invariant check (chk_cd_parent_equals_items_sum)
      const sumCal = updatedItems.reduce((acc, it) => acc + it.calories, 0);
      const sumPro = updatedItems.reduce((acc, it) => acc + it.protein, 0);
      const sumCarbs = updatedItems.reduce((acc, it) => acc + it.carbs, 0);
      const sumFat = updatedItems.reduce((acc, it) => acc + it.fat, 0);
      const sumFiber = updatedItems.reduce((acc, it) => acc + it.fiber, 0);
      expect(Math.abs(totals.calories - sumCal)).toBeLessThanOrEqual(0.05 * updatedItems.length);
      expect(Math.abs(totals.protein - sumPro)).toBeLessThanOrEqual(0.05 * updatedItems.length);
      expect(Math.abs(totals.carbs - sumCarbs)).toBeLessThanOrEqual(0.05 * updatedItems.length);
      expect(Math.abs(totals.fat - sumFat)).toBeLessThanOrEqual(0.05 * updatedItems.length);
      expect(Math.abs(totals.fiber - sumFiber)).toBeLessThanOrEqual(0.05 * updatedItems.length);
    });

    it('2-component dish, untick component 1, change component 2 Qty -> component 2 still scales; component 1 does not', () => {
      const onChange = vi.fn();

      const items = [
        item({
          id: 'c1',
          name: 'Oats',
          quantity: 1,
          calories: 100,
          protein: 10,
          carbs: 20,
          fat: 5,
          fiber: 2,
        }),
        item({
          id: 'c2',
          name: 'Whey',
          quantity: 1,
          calories: 120,
          protein: 24,
          carbs: 2,
          fat: 1,
          fiber: 0,
        }),
      ];

      render(
        <CustomDishEditor
          items={items}
          onChange={onChange}
          isEditing={true}
        />
      );

      const checkboxes = screen.getAllByTestId('scale-nutrition-checkbox');
      // Untick component 1
      fireEvent.click(checkboxes[0]);

      // Now change component 2 Qty 1 -> 2
      const qtyInputs = screen.getAllByTestId('dish-item-quantity');
      fireEvent.change(qtyInputs[1], { target: { value: '2' } });

      expect(onChange).toHaveBeenCalled();
      const updated = onChange.mock.calls[0][0] as NutritionItem[];
      // Component 2 MUST still scale (calories: 240, protein: 48)
      expect(updated[1].quantity).toBe(2);
      expect(updated[1].calories).toBe(240);
      expect(updated[1].protein).toBe(48);

      // And component 1 must not scale if its quantity changes
      onChange.mockClear();
      fireEvent.change(qtyInputs[0], { target: { value: '2' } });
      const updatedC1 = onChange.mock.calls[0][0] as NutritionItem[];
      expect(updatedC1[0].quantity).toBe(2);
      expect(updatedC1[0].calories).toBe(100);
      expect(updatedC1[0].protein).toBe(10);
    });
  });
});

