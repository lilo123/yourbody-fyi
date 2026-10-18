import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { ManualMealForm, type ManualMealFormProps } from './ManualMealForm';
import { useManualMealForm } from './useManualMealForm';
import { expectNoA11yViolations, expectNoA11yViolationsForRules } from '../../test/a11y';

function renderForm(propsOverride: Partial<ManualMealFormProps> = {}) {
  const defaultProps: ManualMealFormProps = {
    show: true,
    onClose: vi.fn(),
    selectedPhoto: null,
    onRemovePhoto: vi.fn(),
    manualName: 'Oatmeal',
    onManualNameChange: vi.fn(),
    manualMealType: 'Breakfast',
    onManualMealTypeChange: vi.fn(),
    manualCalories: 350,
    onManualCaloriesChange: vi.fn(),
    manualProtein: 12,
    onManualProteinChange: vi.fn(),
    manualCarbs: 60,
    onManualCarbsChange: vi.fn(),
    manualFat: 5,
    onManualFatChange: vi.fn(),
    manualFiber: 8,
    onManualFiberChange: vi.fn(),
    manualServingSize: 1,
    onManualServingSizeChange: vi.fn(),
    manualServingUnit: 'bowl',
    onManualServingUnitChange: vi.fn(),
    onSubmit: vi.fn(),
    isPending: false,
    ...propsOverride,
  };
  return {
    ...render(<ManualMealForm {...defaultProps} />),
    props: defaultProps,
  };
}

describe('ManualMealForm', () => {
  it('numeric inputs have inputMode="decimal" and appropriate enterKeyHint (F4)', () => {
    renderForm();
    const cal = screen.getByTestId('calories-input');
    const p = screen.getByTestId('protein-input');
    const c = screen.getByTestId('carbs-input');
    const f = screen.getByTestId('fat-input');
    const fib = screen.getByTestId('fiber-input');

    for (const input of [cal, p, c, f, fib]) {
      expect(input.getAttribute('inputmode')).toBe('decimal');
      expect(input.getAttribute('enterkeyhint')).toBe('next');
    }
  });
  it('has no accessibility violations', async () => {
    const { container } = renderForm();
    await expectNoA11yViolations(container);
  });

  it('associates all form labels with their controls', () => {
    renderForm();
    expect(screen.getByLabelText(/Dish \/ Meal Name/)).toBe(screen.getByTestId('dish-name-input'));
    expect(screen.getByLabelText('Meal Type')).toBeDefined();
    expect(screen.getByLabelText(/Calories/)).toBe(screen.getByTestId('calories-input'));
    expect(screen.getByLabelText(/Protein/)).toBe(screen.getByTestId('protein-input'));
    expect(screen.getByLabelText(/Carbs/)).toBe(screen.getByTestId('carbs-input'));
    expect(screen.getByLabelText(/Fat/)).toBe(screen.getByTestId('fat-input'));
    expect(screen.getByLabelText(/Fiber/)).toBe(screen.getByTestId('fiber-input'));
    expect(screen.getByLabelText('Serving Size')).toBeDefined();
    expect(screen.getByLabelText('Serving Unit')).toBeDefined();
  });

  it('renders two forms simultaneously without duplicate id violations', async () => {
    const { container } = render(
      <div>
        <ManualMealForm
          show={true}
          onClose={vi.fn()}
          selectedPhoto={null}
          onRemovePhoto={vi.fn()}
          manualName="Meal 1"
          onManualNameChange={vi.fn()}
          manualMealType="Breakfast"
          onManualMealTypeChange={vi.fn()}
          manualCalories={300}
          onManualCaloriesChange={vi.fn()}
          manualProtein={10}
          onManualProteinChange={vi.fn()}
          manualCarbs={50}
          onManualCarbsChange={vi.fn()}
          manualFat={4}
          onManualFatChange={vi.fn()}
          manualFiber={6}
          onManualFiberChange={vi.fn()}
          manualServingSize={1}
          onManualServingSizeChange={vi.fn()}
          manualServingUnit="bowl"
          onManualServingUnitChange={vi.fn()}
          onSubmit={vi.fn()}
          isPending={false}
        />
        <ManualMealForm
          show={true}
          onClose={vi.fn()}
          selectedPhoto={null}
          onRemovePhoto={vi.fn()}
          manualName="Meal 2"
          onManualNameChange={vi.fn()}
          manualMealType="Lunch"
          onManualMealTypeChange={vi.fn()}
          manualCalories={500}
          onManualCaloriesChange={vi.fn()}
          manualProtein={30}
          onManualProteinChange={vi.fn()}
          manualCarbs={40}
          onManualCarbsChange={vi.fn()}
          manualFat={15}
          onManualFatChange={vi.fn()}
          manualFiber={5}
          onManualFiberChange={vi.fn()}
          manualServingSize={1}
          onManualServingSizeChange={vi.fn()}
          manualServingUnit="plate"
          onManualServingUnitChange={vi.fn()}
          onSubmit={vi.fn()}
          isPending={false}
        />
      </div>
    );
    await expectNoA11yViolationsForRules(container, ['duplicate-id', 'label']);
  });

  it('blocks submission with alert text when calorie value is negative (-5 kcal)', () => {
    const onSubmit = vi.fn();
    renderForm({ manualCalories: -5, onSubmit });

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.textContent).toBe('Must be 0 or more');

    fireEvent.click(screen.getByRole('button', { name: 'Log Meal' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks submission and does not call onSubmit when isPending is true', () => {
    const onSubmit = vi.fn();
    const { container } = renderForm({ isPending: true, onSubmit });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prevents double submission when Enter is pressed while mutation is pending', () => {
    const onSubmit = vi.fn();
    const { rerender, container, props } = renderForm({ onSubmit, isPending: false });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Mutation is now pending
    rerender(<ManualMealForm {...props} isPending={true} />);
    fireEvent.submit(form);

    // Still only called once
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('blocks submission with alert text when a macro value is negative', () => {
    const onSubmit = vi.fn();
    renderForm({ manualProtein: -2, onSubmit });

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.textContent).toBe('Must be 0 or more');

    fireEvent.click(screen.getByRole('button', { name: 'Log Meal' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('displays required markers (*) only on Name and Calories', () => {
    renderForm();

    const nameInput = screen.getByTestId('dish-name-input');
    expect(nameInput).toHaveAttribute('required');

    const caloriesInput = screen.getByTestId('calories-input');
    expect(caloriesInput).toHaveAttribute('required');

    const proteinInput = screen.getByTestId('protein-input');
    expect(proteinInput).not.toHaveAttribute('required');

    const carbsInput = screen.getByTestId('carbs-input');
    expect(carbsInput).not.toHaveAttribute('required');

    const fatInput = screen.getByTestId('fat-input');
    expect(fatInput).not.toHaveAttribute('required');

    const fiberInput = screen.getByTestId('fiber-input');
    expect(fiberInput).not.toHaveAttribute('required');

    expect(screen.getByText(/Dish \/ Meal Name/).textContent).toContain('*');
    expect(screen.getByText(/Calories/).textContent).toContain('*');
    expect(screen.getByText(/Protein \(g\)/).textContent).not.toContain('*');
    expect(screen.getByText(/Carbs \(g\)/).textContent).not.toContain('*');
    expect(screen.getByText(/Fat \(g\)/).textContent).not.toContain('*');
    expect(screen.getByText(/Fiber \(g\)/).textContent).not.toContain('*');
  });

  it('uses inputMode="decimal" and type="text" with min="0" on all macro fields', () => {
    renderForm();

    const macroTestIds = ['calories-input', 'protein-input', 'carbs-input', 'fat-input', 'fiber-input'];
    macroTestIds.forEach((testId) => {
      const input = screen.getByTestId(testId);
      expect(input.getAttribute('inputmode')).toBe('decimal');
      expect(input.getAttribute('type')).toBe('text');
      expect(input.getAttribute('min')).toBe('0');
      expect(input.getAttribute('step')).toBe('any');
    });
  });

  it('accepts decimal comma ("12,5" and sequential "1","2",",","5") and rejects ambiguous separators ("1,2,3")', () => {
    const onManualProteinChange = vi.fn();
    renderForm({ onManualProteinChange, manualProtein: '' });

    // Sequential typing simulation on protein input: "1" -> "12" -> "12," -> "12,5"
    const proteinInput = screen.getByTestId('protein-input');
    fireEvent.change(proteinInput, { target: { value: '1' } });
    expect(onManualProteinChange).toHaveBeenLastCalledWith(1);

    fireEvent.change(proteinInput, { target: { value: '12' } });
    expect(onManualProteinChange).toHaveBeenLastCalledWith(12);

    fireEvent.change(proteinInput, { target: { value: '12,' } });
    expect((proteinInput as HTMLInputElement).value).toBe('12,');

    fireEvent.change(proteinInput, { target: { value: '12,5' } });
    expect((proteinInput as HTMLInputElement).value).toBe('12,5');
    expect(onManualProteinChange).toHaveBeenLastCalledWith(12.5);

    // Reject "1,2,3"
    fireEvent.change(proteinInput, { target: { value: '1,2,3' } });
    const lastCall = onManualProteinChange.mock.calls[onManualProteinChange.mock.calls.length - 1][0];
    expect(Number.isNaN(lastCall)).toBe(true);
  });

  it('sets noValidate on the form to prevent native browser popups', () => {
    const { container } = renderForm();
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(form?.noValidate).toBe(true);
  });

  describe('useManualMealForm', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 15, 8, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('stages blank P/C/F/Fib as 0 in staged data', () => {
      const onStageMeal = vi.fn();
      const { result } = renderHook(() =>
        useManualMealForm({
          onStageMeal,
        })
      );

      act(() => {
        result.current.setManualDishName('Black Coffee');
        result.current.setManualCalories(5);
        // Protein, Carbs, Fat, Fiber remain ''
      });

      act(() => {
        result.current.handleManualSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
      });

      expect(onStageMeal).toHaveBeenCalledWith(
        expect.objectContaining({
          food_name: 'Black Coffee',
          calories: 5,
          protein: 0,
          carbs: 0,
          fat: 0,
          fiber: 0,
          serving_size: 1,
          serving_unit: 'serving',
        })
      );
    });

    it('blocks staging when calories is negative', () => {
      const onStageMeal = vi.fn();
      const { result } = renderHook(() =>
        useManualMealForm({
          onStageMeal,
        })
      );

      act(() => {
        result.current.setManualDishName('Test Meal');
        result.current.setManualCalories(-5);
      });

      act(() => {
        result.current.handleManualSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
      });

      expect(onStageMeal).not.toHaveBeenCalled();
    });

    it('blocks staging when dish name is empty', () => {
      const onStageMeal = vi.fn();
      const { result } = renderHook(() =>
        useManualMealForm({
          onStageMeal,
        })
      );

      act(() => {
        result.current.setManualDishName('   ');
        result.current.setManualCalories(100);
      });

      act(() => {
        result.current.handleManualSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
      });

      expect(onStageMeal).not.toHaveBeenCalled();
    });

    it('stages meal via onStageMeal with complete macro data', () => {
      const onStageMeal = vi.fn();
      const { result } = renderHook(() =>
        useManualMealForm({
          onStageMeal,
        })
      );

      act(() => {
        result.current.setManualDishName('Grilled Chicken Bowl');
        result.current.setManualCalories(450);
        result.current.setManualProtein(40);
        result.current.setManualCarbs(35);
        result.current.setManualFat(12);
        result.current.setManualFiber(4);
        result.current.setManualServingSize(1);
        result.current.setManualServingUnit('bowl');
      });

      act(() => {
        result.current.handleManualSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
      });

      expect(onStageMeal).toHaveBeenCalledWith({
        food_name: 'Grilled Chicken Bowl',
        calories: 450,
        protein: 40,
        carbs: 35,
        fat: 12,
        fiber: 4,
        meal_type: 'Breakfast',
        serving_size: 1,
        serving_unit: 'bowl',
      });
    });

    it('blocks staging when inputs are invalid', () => {
      const onStageMeal = vi.fn();
      const { result } = renderHook(() =>
        useManualMealForm({
          onStageMeal,
        })
      );

      // Negative protein
      act(() => {
        result.current.setManualDishName('Valid Name');
        result.current.setManualCalories(200);
        result.current.setManualProtein(-5);
      });
      act(() => {
        result.current.handleManualSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
      });
      expect(onStageMeal).not.toHaveBeenCalled();
    });
    it('soft kcal-vs-macros hint appears/disappears as values change and does not block submit', () => {
      const onSubmit = vi.fn();
      const { rerender } = renderForm({
        manualName: 'Oatmeal',
        manualCalories: 350,
        manualProtein: 12,
        manualCarbs: 60,
        manualFat: 5,
        onSubmit,
      });

      // 1. Live region is always mounted before hint appears (takes 0 text)
      const hint = screen.getByTestId('macro-mismatch-hint');
      expect(hint).toBeDefined();
      expect(hint).toHaveAttribute('aria-live', 'polite');
      expect(hint.textContent).toBe('');

      // 2. Hint appears when values mismatch (>15% and >50 kcal)
      // est = 4*12 + 4*60 + 9*5 = 333 kcal; kcal = 500 -> diff 167 > 50 and > 15%
      rerender(
        <ManualMealForm
          show={true}
          onClose={vi.fn()}
          selectedPhoto={null}
          onRemovePhoto={vi.fn()}
          manualName="Oatmeal"
          onManualNameChange={vi.fn()}
          manualMealType="Breakfast"
          onManualMealTypeChange={vi.fn()}
          manualCalories={500}
          onManualCaloriesChange={vi.fn()}
          manualProtein={12}
          onManualProteinChange={vi.fn()}
          manualCarbs={60}
          onManualCarbsChange={vi.fn()}
          manualFat={5}
          onManualFatChange={vi.fn()}
          manualFiber={8}
          onManualFiberChange={vi.fn()}
          manualServingSize={1}
          onManualServingSizeChange={vi.fn()}
          manualServingUnit="bowl"
          onManualServingUnitChange={vi.fn()}
          onSubmit={onSubmit}
          isPending={false}
        />
      );
      expect(hint.textContent).toBe('Macros add up to ≈ 333 kcal');

      // 3. Submit still works while hint is shown (non-blocking)
      const submitBtn = screen.getByRole('button', { name: /Log Meal/i });
      fireEvent.click(submitBtn);
      expect(onSubmit).toHaveBeenCalled();

      // 4. Hint disappears when field is empty
      rerender(
        <ManualMealForm
          show={true}
          onClose={vi.fn()}
          selectedPhoto={null}
          onRemovePhoto={vi.fn()}
          manualName="Oatmeal"
          onManualNameChange={vi.fn()}
          manualMealType="Breakfast"
          onManualMealTypeChange={vi.fn()}
          manualCalories=""
          onManualCaloriesChange={vi.fn()}
          manualProtein={12}
          onManualProteinChange={vi.fn()}
          manualCarbs={60}
          onManualCarbsChange={vi.fn()}
          manualFat={5}
          onManualFatChange={vi.fn()}
          manualFiber={8}
          onManualFiberChange={vi.fn()}
          manualServingSize={1}
          onManualServingSizeChange={vi.fn()}
          manualServingUnit="bowl"
          onManualServingUnitChange={vi.fn()}
          onSubmit={onSubmit}
          isPending={false}
        />
      );
      expect(hint.textContent).toBe('');
    });
  });

  describe('useManualMealForm prefillForm', () => {
    it('prefills found macros and leaves missing macros empty (never 0)', () => {
      const onStageMeal = vi.fn();
      const { result } = renderHook(() => useManualMealForm({ onStageMeal }));

      act(() => {
        result.current.prefillForm({
          name: 'Protein Shake',
          calories: 180,
          protein: 30,
        });
      });

      expect(result.current.manualDishName).toBe('Protein Shake');
      expect(result.current.manualCalories).toBe(180);
      expect(result.current.manualProtein).toBe(30);
      expect(result.current.manualCarbs).toBe('');
      expect(result.current.manualFat).toBe('');
      expect(result.current.manualFiber).toBe('');
    });
  });

  describe('scrollIntoView on open', () => {
    it('opening Manual Entry calls scrollIntoView once; closing does not', () => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;

      const { rerender, props } = renderForm({ show: false });
      expect(scrollSpy).not.toHaveBeenCalled();

      rerender(<ManualMealForm {...props} show={true} />);
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' });

      rerender(<ManualMealForm {...props} show={false} />);
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    });

    it('respects prefers-reduced-motion when scrolling on open', () => {
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

      const { rerender, props } = renderForm({ show: false });
      expect(scrollSpy).not.toHaveBeenCalled();

      rerender(<ManualMealForm {...props} show={true} />);
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'auto', block: 'end' });
    });
  });
});
