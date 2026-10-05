import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomDishEditor } from './CustomDishEditor';
import type { NutritionItem } from '../../utils/itemModel';
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
});
