import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddItemForm, type AddItemFormProps } from './AddItemForm';
import { expectNoA11yViolations, expectNoA11yViolationsForRules } from '../../test/a11y';

function renderForm(propsOverride: Partial<AddItemFormProps> = {}) {
  const defaultProps: AddItemFormProps = {
    onAddItem: vi.fn(),
    onCancel: vi.fn(),
    ...propsOverride,
  };
  return {
    ...render(<AddItemForm {...defaultProps} />),
    props: defaultProps,
  };
}

describe('AddItemForm', () => {
  it('has no accessibility violations', async () => {
    const { container } = renderForm();
    await expectNoA11yViolations(container);
  });

  it('associates all form labels with their controls', () => {
    renderForm();
    expect(screen.getByLabelText(/Item Name/)).toBe(screen.getByTestId('add-item-name-input'));
    expect(screen.getByLabelText('Quantity')).toBe(screen.getByTestId('add-item-quantity-input'));
    expect(screen.getByLabelText('Unit')).toBe(screen.getByTestId('add-item-unit-input'));
    expect(screen.getByLabelText(/Calories/)).toBe(screen.getByTestId('add-item-calories-input'));
    expect(screen.getByLabelText(/Protein/)).toBe(screen.getByTestId('add-item-protein-input'));
    expect(screen.getByLabelText(/Carbs/)).toBe(screen.getByTestId('add-item-carbs-input'));
    expect(screen.getByLabelText(/Fat/)).toBe(screen.getByTestId('add-item-fat-input'));
    expect(screen.getByLabelText(/Fiber/)).toBe(screen.getByTestId('add-item-fiber-input'));
  });

  it('renders two forms simultaneously without duplicate id violations', async () => {
    const { container } = render(
      <div>
        <AddItemForm onAddItem={vi.fn()} onCancel={vi.fn()} />
        <AddItemForm onAddItem={vi.fn()} onCancel={vi.fn()} />
      </div>
    );
    await expectNoA11yViolationsForRules(container, ['duplicate-id', 'label']);
  });

  it('displays required markers (*) only on Name and Calories', () => {
    renderForm();

    const nameInput = screen.getByTestId('add-item-name-input');
    expect(nameInput).toHaveAttribute('required');

    const caloriesInput = screen.getByTestId('add-item-calories-input');
    expect(caloriesInput).toHaveAttribute('required');

    const proteinInput = screen.getByTestId('add-item-protein-input');
    expect(proteinInput).not.toHaveAttribute('required');

    const carbsInput = screen.getByTestId('add-item-carbs-input');
    expect(carbsInput).not.toHaveAttribute('required');

    const fatInput = screen.getByTestId('add-item-fat-input');
    expect(fatInput).not.toHaveAttribute('required');

    const fiberInput = screen.getByTestId('add-item-fiber-input');
    expect(fiberInput).not.toHaveAttribute('required');

    expect(screen.getByText(/Item Name/).textContent).toContain('*');
    expect(screen.getByText(/Calories/).textContent).toContain('*');
    expect(screen.getByText(/Protein \(g\)/).textContent).not.toContain('*');
    expect(screen.getByText(/Carbs \(g\)/).textContent).not.toContain('*');
    expect(screen.getByText(/Fat \(g\)/).textContent).not.toContain('*');
    expect(screen.getByText(/Fiber \(g\)/).textContent).not.toContain('*');
  });

  it('blocks submission with alert text when name is empty', () => {
    const onAddItem = vi.fn();
    renderForm({ onAddItem });

    fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '150' } });
    fireEvent.click(screen.getByTestId('submit-add-item-button'));

    const alert = screen.getByTestId('add-item-name-error');
    expect(alert).toBeDefined();
    expect(alert.textContent).toBe('Item name is required');
    expect(onAddItem).not.toHaveBeenCalled();
  });

  it('blocks submission with alert text when calories is empty', () => {
    const onAddItem = vi.fn();
    renderForm({ onAddItem });

    fireEvent.change(screen.getByTestId('add-item-name-input'), { target: { value: 'Olive Oil' } });
    fireEvent.click(screen.getByTestId('submit-add-item-button'));

    const alert = screen.getByTestId('add-item-calories-error');
    expect(alert).toBeDefined();
    expect(alert.textContent).toBe('Calories is required');
    expect(onAddItem).not.toHaveBeenCalled();
  });

  it('blocks submission with alert text when calorie value is negative', () => {
    const onAddItem = vi.fn();
    renderForm({ onAddItem });

    fireEvent.change(screen.getByTestId('add-item-name-input'), { target: { value: 'Olive Oil' } });
    fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '-10' } });
    fireEvent.click(screen.getByTestId('submit-add-item-button'));

    const alert = screen.getByTestId('add-item-calories-error');
    expect(alert).toBeDefined();
    expect(alert.textContent).toBe('Must be 0 or more');
    expect(onAddItem).not.toHaveBeenCalled();
  });

  it('blocks submission with alert text when a macro value is negative', () => {
    const onAddItem = vi.fn();
    renderForm({ onAddItem });

    fireEvent.change(screen.getByTestId('add-item-name-input'), { target: { value: 'Olive Oil' } });
    fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '120' } });
    fireEvent.change(screen.getByTestId('add-item-protein-input'), { target: { value: '-2' } });
    fireEvent.click(screen.getByTestId('submit-add-item-button'));

    const alert = screen.getByTestId('add-item-protein-error');
    expect(alert).toBeDefined();
    expect(alert.textContent).toBe('Must be 0 or more');
    expect(onAddItem).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    const onAddItem = vi.fn();
    renderForm({ onCancel, onAddItem });

    fireEvent.click(screen.getByTestId('cancel-add-item-button'));
    expect(onCancel).toHaveBeenCalled();
    expect(onAddItem).not.toHaveBeenCalled();
  });

  it('submits valid item data and defaults blank macros to 0', () => {
    const onAddItem = vi.fn();
    renderForm({ onAddItem });

    fireEvent.change(screen.getByTestId('add-item-name-input'), { target: { value: 'Olive Oil' } });
    fireEvent.change(screen.getByTestId('add-item-quantity-input'), { target: { value: '15' } });
    fireEvent.change(screen.getByTestId('add-item-unit-input'), { target: { value: 'ml' } });
    fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '120' } });
    fireEvent.change(screen.getByTestId('add-item-fat-input'), { target: { value: '14' } });
    // Protein, carbs, fiber left blank

    fireEvent.click(screen.getByTestId('submit-add-item-button'));

    expect(onAddItem).toHaveBeenCalledWith({
      name: 'Olive Oil',
      quantity: 15,
      unit: 'ml',
      calories: 120,
      protein: 0,
      carbs: 0,
      fat: 14,
      fiber: 0,
    });
  });

  it('uses inputMode="decimal" and type="number" with min="0" on numeric fields', () => {
    renderForm();

    const numericTestIds = [
      'add-item-quantity-input',
      'add-item-calories-input',
      'add-item-protein-input',
      'add-item-carbs-input',
      'add-item-fat-input',
      'add-item-fiber-input',
    ];
    numericTestIds.forEach((testId) => {
      const input = screen.getByTestId(testId);
      expect(input.getAttribute('inputmode')).toBe('decimal');
      expect(input.getAttribute('type')).toBe('number');
      expect(input.getAttribute('min')).toBe('0');
      expect(input.getAttribute('step')).toBe('any');
    });
  });

  it('sets noValidate on the form to prevent native browser popups', () => {
    const { container } = renderForm();
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(form?.noValidate).toBe(true);
  });

  it('closes on Escape key press without submitting', () => {
    const onCancel = vi.fn();
    const onAddItem = vi.fn();
    renderForm({ onCancel, onAddItem });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(onAddItem).not.toHaveBeenCalled();
  });

  it('focuses item name input on mount', () => {
    renderForm();
    const nameInput = screen.getByTestId('add-item-name-input');
    expect(document.activeElement).toBe(nameInput);
  });

  it('blocks submission and displays error when quantity is negative', () => {
    const onAddItem = vi.fn();
    renderForm({ onAddItem });

    fireEvent.change(screen.getByTestId('add-item-name-input'), { target: { value: 'Olive Oil' } });
    fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '120' } });
    fireEvent.change(screen.getByTestId('add-item-quantity-input'), { target: { value: '-5' } });
    fireEvent.click(screen.getByTestId('submit-add-item-button'));

    expect(screen.getByTestId('add-item-quantity-error')).toHaveTextContent('Must be 0 or more');
    expect(onAddItem).not.toHaveBeenCalled();
  });
  it('D23: soft kcal-vs-macros hint appears/disappears as values change and does not block submit', () => {
    const onAddItem = vi.fn();
    renderForm({ onAddItem });

    // 1. Live region is present before hint appears
    const hint = screen.getByTestId('macro-mismatch-hint');
    expect(hint).toBeDefined();
    expect(hint).toHaveAttribute('aria-live', 'polite');
    expect(hint.textContent).toBe('');

    // 2. Hint appears when values mismatch (>15% and >50 kcal)
    // est = 4*50 + 4*0 + 9*0 = 200 kcal; kcal = 251 -> diff 51 > 50 and > 15%
    fireEvent.change(screen.getByTestId('add-item-name-input'), { target: { value: 'Protein Powder' } });
    fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '251' } });
    fireEvent.change(screen.getByTestId('add-item-protein-input'), { target: { value: '50' } });
    fireEvent.change(screen.getByTestId('add-item-carbs-input'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('add-item-fat-input'), { target: { value: '0' } });

    expect(hint.textContent).toBe('Macros add up to ≈ 200 kcal');

    // 3. Submit still works while hint is shown
    fireEvent.click(screen.getByTestId('submit-add-item-button'));
    expect(onAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Protein Powder',
        calories: 251,
        protein: 50,
        carbs: 0,
        fat: 0,
      })
    );

    // 4. Hint disappears when a field is cleared
    fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '' } });
    expect(hint.textContent).toBe('');
  });
});
