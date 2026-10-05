import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentRow } from './ComponentRow';
import type { NutritionItem } from '../../utils/itemModel';

function component(over: Partial<NutritionItem> = {}): NutritionItem {
  return {
    id: 'c1',
    name: 'Baked Egg Frittata',
    quantity: 150,
    unit: 'g',
    displayPortion: '1 slice (150g)',
    calories: 182,
    protein: 12.5,
    carbs: 3.2,
    fat: 13.1,
    fiber: 1.2,
    ...over,
  };
}

describe('ComponentRow', () => {
  it('renders compact row: name, non-zero macros, and controls without portion chip', () => {
    const item = component();
    render(<ComponentRow item={item} reference={item} onChange={() => {}} />);

    // Name & absence of portion chip (D1)
    expect(screen.getByTestId('component-name').textContent).toBe(item.name);
    expect(screen.queryByTestId('component-portion-chip')).toBeNull();

    // Non-zero macros
    expect(screen.getByTestId('component-macro-calories')).toHaveTextContent('182 kcal');
    expect(screen.getByTestId('component-macro-protein')).toHaveTextContent('12.5 P');
    expect(screen.getByTestId('component-macro-carbs')).toHaveTextContent('3.2 C');
    expect(screen.getByTestId('component-macro-fat')).toHaveTextContent('13.1 F');
    expect(screen.getByTestId('component-macro-fiber')).toHaveTextContent('1.2 Fib');
    expect(screen.getByText(/182 kcal, protein 12.5 g, carbs 3.2 g, fat 13.1 g, fiber 1.2 g/)).toBeDefined();

    // Stepper, input, unit chip
    expect(screen.getByTestId('component-quantity-input')).toBeDefined();
    expect((screen.getByTestId('component-quantity-input') as HTMLInputElement).value).toBe('150');
    expect(screen.getByTestId('component-quantity-input')).toHaveAttribute('enterkeyhint', 'done');
    expect(screen.getByTestId('component-quantity-input')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByTestId('component-unit-chip')).toBeDefined();
  });

  it('does not render portion chip and drops raw portion string (D1)', () => {
    const item = component({
      quantity: 540,
      unit: 'g',
      displayPortion: '1 serving',
    });
    render(<ComponentRow item={item} reference={item} onChange={() => {}} />);

    expect(screen.queryByTestId('component-portion-chip')).toBeNull();
    expect(screen.queryByText('1 serving')).toBeNull();
  });

  it('hides zero-value macros when filtered, and displays muted 0 + suffix in visible columns (D2)', () => {
    const item = component({
      calories: 104,
      protein: 10,
      carbs: 0,
      fat: 6.5,
      fiber: 0,
    });
    const { rerender } = render(
      <ComponentRow
        item={item}
        reference={item}
        macroColumns={['calories', 'protein', 'fat']}
        onChange={() => {}}
      />
    );

    // Visible columns kcal, P, F only
    expect(screen.getByTestId('component-macro-calories')).toHaveTextContent('104 kcal');
    expect(screen.getByTestId('component-macro-protein')).toHaveTextContent('10 P');
    expect(screen.getByTestId('component-macro-fat')).toHaveTextContent('6.5 F');
    expect(screen.queryByTestId('component-macro-carbs')).toBeNull();
    expect(screen.queryByTestId('component-macro-fiber')).toBeNull();

    // When all 5 columns are visible, 0 values display muted 0 with suffix
    rerender(<ComponentRow item={item} reference={item} onChange={() => {}} />);
    expect(screen.getByTestId('component-macro-carbs')).toHaveTextContent('0 C');
    expect(screen.getByTestId('component-macro-fiber')).toHaveTextContent('0 Fib');
  });

  it('displays muted 0 kcal when calories is 0', () => {
    const item = component({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
    });
    render(<ComponentRow item={item} reference={item} onChange={() => {}} />);

    const calCell = screen.getByTestId('component-macro-calories');
    expect(calCell).toHaveTextContent('0 kcal');
  });

  it('input, unit chip, and overflow menu are present and typing quantity invokes onChange', () => {
    const item = component({ quantity: 50, calories: 100 });
    const onChange = vi.fn();
    const onRemove = vi.fn();
    render(<ComponentRow item={item} reference={item} onChange={onChange} onRemove={onRemove} />);

    expect(screen.getByTestId('component-quantity-input')).toBeDefined();
    expect(screen.getByTestId('component-unit-chip')).toBeDefined();
    expect(screen.getByTestId('component-actions')).toBeDefined();

    const input = screen.getByTestId('component-quantity-input');
    fireEvent.change(input, { target: { value: '75' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    const scaled = onChange.mock.calls[0][0] as NutritionItem;
    expect(scaled.quantity).toBe(75);
    expect(scaled.calories).toBe(150);
  });


  it('preserves edited unit when quantity is subsequently adjusted', () => {
    // Reference has initial unit 'g'
    const reference = component({ quantity: 100, unit: 'g' });
    // Item has been updated by user to 'ml'
    const itemWithNewUnit = component({ quantity: 100, unit: 'ml' });
    const onChange = vi.fn();

    render(<ComponentRow item={itemWithNewUnit} reference={reference} onChange={onChange} />);

    // Adjust quantity via input
    const input = screen.getByTestId('component-quantity-input');
    fireEvent.change(input, { target: { value: '101' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    const result = onChange.mock.calls[0][0] as NutritionItem;

    // Must preserve 'ml', NOT revert to reference's 'g'
    expect(result.unit).toBe('ml');
    expect(result.quantity).toBe(101);

    // Also verify commit via text input preserves unit
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.blur(input);

    const committed = onChange.mock.calls[1][0] as NutritionItem;
    expect(committed.unit).toBe('ml');
    expect(committed.quantity).toBe(250);
  });

  it('hides mutating controls when read-only', () => {
    const item = component();
    render(
      <ComponentRow
        item={item}
        reference={item}
        readOnly
        onRemove={() => {}}
        onSaveToQuickLog={() => {}}
      />
    );

    expect(screen.getByTestId('component-name')).toBeDefined();
    expect(screen.queryByTestId('component-quantity-input')).toBeNull();
    expect(screen.queryByTestId('component-unit-chip')).toBeNull();
    expect(screen.queryByTestId('component-actions')).toBeNull();
  });

  it('exposes overflow actions for save to quick log and remove', () => {
    const onSave = vi.fn();
    const onRemove = vi.fn();
    const item = component();
    render(
      <ComponentRow
        item={item}
        reference={item}
        onChange={() => {}}
        onSaveToQuickLog={onSave}
        onRemove={onRemove}
      />
    );

    fireEvent.click(screen.getByTestId('component-actions'));
    expect(screen.getByTestId('component-save-quick-log')).toBeDefined();
    expect(screen.getByTestId('component-remove')).toBeDefined();

    fireEvent.click(screen.getByTestId('component-save-quick-log'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('renders colored macro badges and an elegant constrained quantity stepper', () => {
    const item = component();
    render(<ComponentRow item={item} reference={item} onChange={() => {}} />);

    // Macro color classes
    expect(screen.getByTestId('component-macro-calories').className).toContain('text-amber-400');
    expect(screen.getByTestId('component-macro-protein').className).toContain('text-cyan-400');
    expect(screen.getByTestId('component-macro-carbs').className).toContain('text-emerald-400');
    expect(screen.getByTestId('component-macro-fat').className).toContain('text-violet-400');
    expect(screen.getByTestId('component-macro-fiber').className).toContain('text-teal-400');

    // Stepper input should be elegantly constrained rather than stretching full-width
    const input = screen.getByTestId('component-quantity-input');
    const field = screen.getByTestId('component-quantity-field');
    const box = screen.getByTestId('component-quantity-box');
    expect(box.className).toContain('w-[100px]');
    expect(field.className).toContain('w-[46px]');
    expect(input.className).not.toContain('w-full');
    // text-base on mobile prevents iOS Safari auto-zoom on input focus
    expect(input.className).toContain('text-base');
  });

  it('formats floating point quantity drift to 1 decimal place', () => {
    const item = component({ quantity: 40.00000000001 });
    render(<ComponentRow item={item} reference={item} onChange={() => {}} />);

    const input = screen.getByTestId('component-quantity-input') as HTMLInputElement;
    expect(input.value).toBe('40');
  });

  it('rounds scaled macros to 1 decimal place on commit', () => {
    // 33g reference with fractional macros
    const ref = component({
      quantity: 33,
      calories: 115.5,
      protein: 19.806,
      carbs: 1.633,
      fat: 2.858,
      fiber: 0,
    });
    const onChange = vi.fn();
    render(<ComponentRow item={ref} reference={ref} onChange={onChange} />);

    const input = screen.getByTestId('component-quantity-input');
    fireEvent.change(input, { target: { value: '40' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    const scaled = onChange.mock.calls[0][0] as NutritionItem;
    // 40 / 33 * 115.5 = 140.0025 -> 140
    expect(scaled.calories).toBe(140);
    // 40 / 33 * 19.806 = 24.0072 -> 24
    expect(scaled.protein).toBe(24);
    // 40 / 33 * 1.633 = 1.979 -> 2
    expect(scaled.carbs).toBe(2);
    // 40 / 33 * 2.858 = 3.464 -> 3.5
    expect(scaled.fat).toBe(3.5);
    expect(scaled.fiber).toBe(0);
  });

  it('re-anchors component when unit changes: clears quantity, freezes macros, and commits new quantity without scaling', () => {
    const item = component({ quantity: 1, unit: 'unit', calories: 600, protein: 30, carbs: 40, fat: 20, fiber: 5 });
    const onChange = vi.fn();
    const onReanchor = vi.fn();

    render(<ComponentRow item={item} reference={item} onChange={onChange} onReanchor={onReanchor} />);

    // Switch to unit g
    fireEvent.click(screen.getByTestId('component-unit-chip'));
    fireEvent.click(screen.getByTestId('unit-option-g'));

    // Quantity clears with hint
    const input = screen.getByTestId('component-quantity-input') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByTestId('component-reanchor-hint').textContent).toContain('amount in g for this 600 kcal');

    // Macros remain frozen at 600 kcal on screen
    expect(screen.getAllByText(/600 kcal/).length).toBeGreaterThanOrEqual(1);

    // Commit 540
    fireEvent.change(input, { target: { value: '540' } });
    fireEvent.blur(input);

    expect(onReanchor).toHaveBeenCalledTimes(1);
    const reanchored = onReanchor.mock.calls[0][0] as NutritionItem;
    expect(reanchored.quantity).toBe(540);
    expect(reanchored.unit).toBe('g');
    expect(reanchored.calories).toBe(600);
    expect(reanchored.protein).toBe(30);
    expect(reanchored.carbs).toBe(40);
    expect(reanchored.fat).toBe(20);
    expect(reanchored.fiber).toBe(5);
  });

  it('resumes scaling from the new reference after re-anchoring (avoids dead-end / 540x bug)', () => {
    let currentItem = component({ quantity: 1, unit: 'unit', calories: 600, protein: 30, carbs: 40, fat: 20, fiber: 5 });
    let currentReference = currentItem;
    const onChange = vi.fn((next: NutritionItem) => {
      currentItem = next;
    });
    const onReanchor = vi.fn((next: NutritionItem) => {
      currentItem = next;
      currentReference = next;
    });

    const { rerender } = render(
      <ComponentRow
        item={currentItem}
        reference={currentReference}
        onChange={onChange}
        onReanchor={onReanchor}
      />
    );

    // Switch to unit g and commit 540
    fireEvent.click(screen.getByTestId('component-unit-chip'));
    fireEvent.click(screen.getByTestId('unit-option-g'));

    const input = screen.getByTestId('component-quantity-input');
    fireEvent.change(input, { target: { value: '540' } });
    fireEvent.blur(input);

    expect(onReanchor).toHaveBeenCalledTimes(1);

    // Re-render with new item and reference
    rerender(
      <ComponentRow
        item={currentItem}
        reference={currentReference}
        onChange={onChange}
        onReanchor={onReanchor}
      />
    );

    // Step/type 594: 594 / 540 = 1.1x -> 660 kcal (NOT 356,400 kcal)
    fireEvent.change(screen.getByTestId('component-quantity-input'), { target: { value: '594' } });
    fireEvent.blur(screen.getByTestId('component-quantity-input'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const scaled = onChange.mock.calls[0][0] as NutritionItem;
    expect(scaled.quantity).toBe(594);
    expect(scaled.unit).toBe('g');
    expect(scaled.calories).toBe(660);
    expect(scaled.protein).toBe(33);
  });

  it('treats clicking already-selected unit as a no-op', () => {
    const item = component({ quantity: 100, unit: 'g', calories: 200 });
    const onChange = vi.fn();
    const onReanchor = vi.fn();

    render(<ComponentRow item={item} reference={item} onChange={onChange} onReanchor={onReanchor} />);

    // Open sheet and select g (already g)
    fireEvent.click(screen.getByTestId('component-unit-chip'));
    fireEvent.click(screen.getByTestId('unit-option-g'));

    // Input does not clear
    const input = screen.getByTestId('component-quantity-input') as HTMLInputElement;
    expect(input.value).toBe('100');

    // No callbacks called
    expect(onChange).not.toHaveBeenCalled();
    expect(onReanchor).not.toHaveBeenCalled();
  });

  it('while unit change is pending, typing quantity and pressing Enter re-anchors to the pending unit instead of linear scaling', () => {
    const item = component({ quantity: 1, unit: 'unit', calories: 200, protein: 10, carbs: 20, fat: 5, fiber: 2 });
    const onChange = vi.fn();
    const onReanchor = vi.fn();

    render(<ComponentRow item={item} reference={item} onChange={onChange} onReanchor={onReanchor} />);

    // Switch unit to ml
    fireEvent.click(screen.getByTestId('component-unit-chip'));
    fireEvent.click(screen.getByTestId('unit-option-ml'));

    const input = screen.getByTestId('component-quantity-input') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByTestId('component-reanchor-hint').textContent).toContain('amount in ml for this 200 kcal');

    // Type 250 and press Enter
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onReanchor).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    const reanchored = onReanchor.mock.calls[0][0] as NutritionItem;
    expect(reanchored.quantity).toBe(250);
    expect(reanchored.unit).toBe('ml');
    expect(reanchored.calories).toBe(200);
    expect(reanchored.protein).toBe(10);
    expect(reanchored.carbs).toBe(20);
    expect(reanchored.fat).toBe(5);
    expect(reanchored.fiber).toBe(2);
    expect(screen.queryByTestId('component-reanchor-hint')).toBeNull();
  });

  it('while unit change is pending, committing quantity invokes onChange when onReanchor is omitted', () => {
    const item = component({ quantity: 1, unit: 'unit', calories: 200, protein: 10, carbs: 20, fat: 5, fiber: 2 });
    const onChange = vi.fn();

    render(<ComponentRow item={item} reference={item} onChange={onChange} />);

    // Switch unit to g
    fireEvent.click(screen.getByTestId('component-unit-chip'));
    fireEvent.click(screen.getByTestId('unit-option-g'));

    const input = screen.getByTestId('component-quantity-input');
    fireEvent.change(input, { target: { value: '180' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    const reanchored = onChange.mock.calls[0][0] as NutritionItem;
    expect(reanchored.quantity).toBe(180);
    expect(reanchored.unit).toBe('g');
    expect(reanchored.calories).toBe(200);
  });

  it('while unit change is pending, empty, 0, or invalid input on blur or Enter does not invoke onChange and keeps pending state', () => {
    const item = component({ quantity: 1, unit: 'unit', calories: 200 });
    const onChange = vi.fn();
    const onReanchor = vi.fn();

    render(<ComponentRow item={item} reference={item} onChange={onChange} onReanchor={onReanchor} />);

    // Switch to ml
    fireEvent.click(screen.getByTestId('component-unit-chip'));
    fireEvent.click(screen.getByTestId('unit-option-ml'));

    const input = screen.getByTestId('component-quantity-input') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByTestId('component-reanchor-hint')).toBeDefined();

    // Blur on empty input
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(onReanchor).not.toHaveBeenCalled();
    expect(screen.getByTestId('component-reanchor-hint')).toBeDefined();
    expect(input.value).toBe('');

    // Type 0 and blur
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(onReanchor).not.toHaveBeenCalled();
    expect(screen.getByTestId('component-reanchor-hint')).toBeDefined();
    expect(input.value).toBe('');

    // Type 0 and press Enter
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(onReanchor).not.toHaveBeenCalled();
    expect(screen.getByTestId('component-reanchor-hint')).toBeDefined();
    expect(input.value).toBe('');

    // Type invalid non-numeric/negative and blur
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(onReanchor).not.toHaveBeenCalled();
    expect(screen.getByTestId('component-reanchor-hint')).toBeDefined();
    expect(input.value).toBe('');
  });

  it('while unit change is pending, re-selecting the base unit cancels pending re-anchor and restores original quantity', () => {
    const item = component({ quantity: 150, unit: 'g', calories: 182 });
    const onChange = vi.fn();
    const onReanchor = vi.fn();

    render(<ComponentRow item={item} reference={item} onChange={onChange} onReanchor={onReanchor} />);

    // Switch to unit ml
    fireEvent.click(screen.getByTestId('component-unit-chip'));
    fireEvent.click(screen.getByTestId('unit-option-ml'));

    const input = screen.getByTestId('component-quantity-input') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByTestId('component-reanchor-hint')).toBeDefined();

    // Re-select base unit 'g'
    fireEvent.click(screen.getByTestId('component-unit-chip'));
    fireEvent.click(screen.getByTestId('unit-option-g'));

    // Cancels pending: restores 150, removes hint, does not invoke callbacks
    expect(input.value).toBe('150');
    expect(screen.queryByTestId('component-reanchor-hint')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onReanchor).not.toHaveBeenCalled();

    // Subsequent edit operates in base unit
    fireEvent.change(input, { target: { value: '300' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    const scaled = onChange.mock.calls[0][0] as NutritionItem;
    expect(scaled.quantity).toBe(300);
    expect(scaled.unit).toBe('g');
    expect(scaled.calories).toBeCloseTo(364, 1);
  });

  it('while unit change is pending, re-anchoring preserves per-item D7 nutrition edit and uses it for subsequent scaling', () => {
    // Reference has initial values
    const reference = component({ quantity: 1, unit: 'unit', calories: 100, protein: 5, carbs: 10, fat: 2, fiber: 1 });
    // Item has custom D7 edited nutrition (e.g. corrected via ItemNutritionModal)
    let currentItem = component({
      quantity: 1,
      unit: 'unit',
      calories: 250,
      protein: 30,
      carbs: 15,
      fat: 8,
      fiber: 4,
    });
    let currentRef = reference;

    const onChange = vi.fn((next: NutritionItem) => {
      currentItem = next;
    });
    const onReanchor = vi.fn((next: NutritionItem) => {
      currentItem = next;
      currentRef = next;
    });

    const { rerender } = render(
      <ComponentRow
        item={currentItem}
        reference={currentRef}
        onChange={onChange}
        onReanchor={onReanchor}
      />
    );

    // Switch to g
    fireEvent.click(screen.getByTestId('component-unit-chip'));
    fireEvent.click(screen.getByTestId('unit-option-g'));

    const input = screen.getByTestId('component-quantity-input') as HTMLInputElement;
    expect(screen.getByTestId('component-reanchor-hint').textContent).toContain('amount in g for this 250 kcal');

    // Type 120 and Enter
    fireEvent.change(input, { target: { value: '120' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onReanchor).toHaveBeenCalledTimes(1);
    const reanchored = onReanchor.mock.calls[0][0] as NutritionItem;
    expect(reanchored.quantity).toBe(120);
    expect(reanchored.unit).toBe('g');
    // D7 edited values preserved, NOT reset to reference's 100 kcal / 5 P
    expect(reanchored.calories).toBe(250);
    expect(reanchored.protein).toBe(30);
    expect(reanchored.carbs).toBe(15);
    expect(reanchored.fat).toBe(8);
    expect(reanchored.fiber).toBe(4);

    // Re-render with new item and reference, then scale to 240g (2x)
    rerender(
      <ComponentRow
        item={currentItem}
        reference={currentRef}
        onChange={onChange}
        onReanchor={onReanchor}
      />
    );

    fireEvent.change(screen.getByTestId('component-quantity-input'), { target: { value: '240' } });
    fireEvent.blur(screen.getByTestId('component-quantity-input'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const scaled = onChange.mock.calls[0][0] as NutritionItem;
    expect(scaled.quantity).toBe(240);
    expect(scaled.unit).toBe('g');
    // Scales linearly from the D7 edited macros: 2x 250 = 500 kcal, 2x 30 = 60 P
    expect(scaled.calories).toBe(500);
    expect(scaled.protein).toBe(60);
    expect(scaled.carbs).toBe(30);
    expect(scaled.fat).toBe(16);
    expect(scaled.fiber).toBe(8);
  });


  it('surfaces inline confirm affordance when multiplying row calories by >20x and handles apply/cancel', () => {
    const item = component({ quantity: 1, calories: 100, unit: 'unit' });
    const onChange = vi.fn();

    render(<ComponentRow item={item} reference={item} onChange={onChange} />);

    const input = screen.getByTestId('component-quantity-input');
    // Change quantity to 25 (25 * 100 = 2500 kcal, which is 25x > 20x)
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.blur(input);

    // onChange was not called yet
    expect(onChange).not.toHaveBeenCalled();

    // Confirm affordance is visible
    expect(screen.getByTestId('absurd-edit-confirm')).toBeDefined();
    expect(screen.getByTestId('confirm-apply-edit')).toBeDefined();
    expect(screen.getByTestId('cancel-apply-edit')).toBeDefined();

    // Clicking Cancel dismisses affordance and restores previous quantity
    fireEvent.click(screen.getByTestId('cancel-apply-edit'));
    expect(screen.queryByTestId('absurd-edit-confirm')).toBeNull();
    expect((screen.getByTestId('component-quantity-input') as HTMLInputElement).value).toBe('1');
    expect(onChange).not.toHaveBeenCalled();

    // Now trigger it again and click Apply anyway
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('absurd-edit-confirm')).toBeDefined();

    fireEvent.click(screen.getByTestId('confirm-apply-edit'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const applied = onChange.mock.calls[0][0] as NutritionItem;
    expect(applied.quantity).toBe(25);
    expect(applied.calories).toBe(2500);
  });

  it('selects input text on focus for rapid single-tap replacement (defect F3/NEW-01)', () => {
    const item = component({ quantity: 150 });
    render(<ComponentRow item={item} reference={item} onChange={() => {}} />);
    const input = screen.getByTestId('component-quantity-input') as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');
    fireEvent.focus(input);
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });


  it('does not render "Edit nutrition" option in overflow menu when onEditNutrition is omitted', () => {
    const item = component();
    render(<ComponentRow item={item} reference={item} onChange={() => {}} onRemove={() => {}} />);

    fireEvent.click(screen.getByTestId('component-actions'));
    expect(screen.queryByTestId('component-edit-nutrition')).toBeNull();
    expect(screen.getByTestId('component-remove')).toBeDefined();
  });

  it('renders "Edit nutrition" FIRST in overflow menu when onEditNutrition is provided', () => {
    const item = component();
    render(
      <ComponentRow
        item={item}
        reference={item}
        onChange={() => {}}
        onSaveToQuickLog={() => {}}
        onRemove={() => {}}
        onEditNutrition={() => {}}
      />
    );

    fireEvent.click(screen.getByTestId('component-actions'));
    const editBtn = screen.getByTestId('component-edit-nutrition');
    const saveQuickBtn = screen.getByTestId('component-save-quick-log');
    const removeBtn = screen.getByTestId('component-remove');

    expect(editBtn).toBeDefined();
    expect(saveQuickBtn).toBeDefined();
    expect(removeBtn).toBeDefined();

    // Verify ordering: Edit nutrition precedes Save to quick log and Remove
    const menuContainer = editBtn.closest('[role="menu"]');
    expect(menuContainer).not.toBeNull();
    const menuItems = menuContainer?.querySelectorAll('[role="menuitem"]') ?? [];
    expect(menuItems[0]).toBe(editBtn);
    expect(menuItems[1]).toBe(saveQuickBtn);
    expect(menuItems[2]).toBe(removeBtn);
  });

  it('supports full flow: open modal via menu -> change calories to 150 -> Save calls onEditNutrition', () => {
    const item = component({
      calories: 104,
      protein: 10,
      carbs: 0,
      fat: 6.5,
      fiber: 0,
    });
    const onEditNutrition = vi.fn();

    render(
      <ComponentRow
        item={item}
        reference={item}
        onChange={() => {}}
        onEditNutrition={onEditNutrition}
      />
    );

    // Open overflow menu
    fireEvent.click(screen.getByTestId('component-actions'));

    // Click Edit nutrition
    fireEvent.click(screen.getByTestId('component-edit-nutrition'));

    // Modal is opened with prefilled values
    const calInput = screen.getByTestId('edit-item-calories-input') as HTMLInputElement;
    expect(calInput.value).toBe('104');

    // Change calories to 150
    fireEvent.change(calInput, { target: { value: '150' } });
    expect(calInput.value).toBe('150');

    // Save
    fireEvent.click(screen.getByTestId('save-edit-item-nutrition-btn'));

    // Verify onEditNutrition called with parsed numbers
    expect(onEditNutrition).toHaveBeenCalledTimes(1);
    expect(onEditNutrition).toHaveBeenCalledWith({
      calories: 150,
      protein: 10,
      carbs: 0,
      fat: 6.5,
      fiber: 0,
    });

    // Modal closed
    expect(screen.queryByTestId('edit-item-nutrition-modal')).toBeNull();
  });

  it('restores focus to the overflow menu trigger when modal closes via Cancel', () => {
    const item = component();
    render(
      <ComponentRow
        item={item}
        reference={item}
        onChange={() => {}}
        onEditNutrition={() => {}}
      />
    );

    const trigger = screen.getByTestId('component-actions');
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByTestId('component-edit-nutrition'));
    expect(screen.getByTestId('edit-item-nutrition-modal')).toBeDefined();

    fireEvent.click(screen.getByTestId('cancel-edit-item-nutrition-btn'));
    expect(screen.queryByTestId('edit-item-nutrition-modal')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('saves entered quantity and invokes onChange when Enter is pressed', () => {
    const item = component({ quantity: 50, calories: 100 });
    const onChange = vi.fn();
    render(<ComponentRow item={item} reference={item} onChange={onChange} />);

    const input = screen.getByTestId('component-quantity-input');
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    const scaled = onChange.mock.calls[0][0] as NutritionItem;
    expect(scaled.quantity).toBe(80);
    expect(scaled.calories).toBe(160);
  });

  it('reverts to the previous quantity when input is cleared and committed', () => {
    const item = component({ quantity: 50, calories: 100 });
    const onChange = vi.fn();
    render(<ComponentRow item={item} reference={item} onChange={onChange} />);

    const input = screen.getByTestId('component-quantity-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('50');
  });

  it('reverts to the previous quantity when 0 is entered and committed', () => {
    const item = component({ quantity: 50, calories: 100 });
    const onChange = vi.fn();
    render(<ComponentRow item={item} reference={item} onChange={onChange} />);

    const input = screen.getByTestId('component-quantity-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('50');
  });

  it('renders item name with line-clamp-2 and break-words classes for 2-line wrapping', () => {
    const item = component({
      name: 'Grilled Salmon Fillet with Lemon Butter Sauce and Roasted Vegetables',
    });
    render(<ComponentRow item={item} reference={item} onChange={() => {}} />);

    const nameEl = screen.getByTestId('component-name');
    expect(nameEl.className).toContain('line-clamp-2');
    expect(nameEl.className).toContain('break-words');
    expect(nameEl.className).not.toContain('truncate');
    expect(nameEl.textContent).toBe(item.name);
  });

  it('applies D24 minmax responsive grid template and whitespace-nowrap on macro cells', () => {
    const item = component();
    render(<ComponentRow item={item} reference={item} onChange={() => {}} />);

    const macrosGrid = screen.getByTestId('component-macros');
    expect(macrosGrid.style.gridTemplateColumns).toBe(
      'minmax(3rem, 4.5rem) minmax(2.5rem, 3.5rem) minmax(2.5rem, 3.5rem) minmax(2.5rem, 3.5rem) minmax(2.5rem, 3.5rem)'
    );

    const calCell = screen.getByTestId('component-macro-calories');
    expect(calCell).toHaveClass('whitespace-nowrap');
  });

  it('clicking inside the open unit sheet (backdrop and non-option area) does NOT focus qty input and choosing an option changes unit', async () => {
    const user = userEvent.setup();
    const item = component({ quantity: 100, unit: 'g' });
    const onChange = vi.fn();
    render(<ComponentRow item={item} reference={item} onChange={onChange} />);

    const input = screen.getByTestId('component-quantity-input');
    const chip = screen.getByTestId('component-unit-chip');

    // 1. Open the unit sheet
    await user.click(chip);
    const unitSheet = screen.getByTestId('unit-sheet');
    expect(unitSheet).toBeDefined();

    // Blur input so we can test what clicking the sheet does
    input.blur();
    expect(document.activeElement).not.toBe(input);

    // 2. Click on a non-option area inside the sheet (the "Unit" header text)
    const header = screen.getByText('Unit');
    await user.click(header);
    expect(document.activeElement).not.toBe(input);

    // 3. Click on the backdrop (unitSheet itself) to close
    await user.click(unitSheet);
    expect(document.activeElement).not.toBe(input);

    // 4. Choosing an option still changes the unit (sets pending unit in ComponentRow)
    await user.click(chip);
    await user.click(screen.getByTestId('unit-option-ml'));
    expect(screen.getByTestId('component-reanchor-hint')).toBeDefined();
  });
});
