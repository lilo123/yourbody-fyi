import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MacroGoalsCard } from './MacroGoalsCard';
import { expectNoA11yViolations } from '../../test/a11y';

describe('MacroGoalsCard accessibility', () => {
  const defaultProps = {
    targetCalories: 2200,
    setTargetCalories: vi.fn(),
    targetProtein: 160,
    setTargetProtein: vi.fn(),
    targetCarbs: 220,
    setTargetCarbs: vi.fn(),
    targetFat: 70,
    setTargetFat: vi.fn(),
    targetFiber: 30,
    setTargetFiber: vi.fn(),
    loading: false,
    status: null,
    onSave: vi.fn(),
  };

  it('associates labels with all 5 macro goal inputs', () => {
    render(<MacroGoalsCard {...defaultProps} />);

    expect(screen.getByLabelText(/calories/i)).toBeDefined();
    expect(screen.getByLabelText(/protein/i)).toBeDefined();
    expect(screen.getByLabelText(/carbs/i)).toBeDefined();
    expect(screen.getByLabelText(/^fat/i)).toBeDefined();
    expect(screen.getByLabelText(/fiber/i)).toBeDefined();
  });

  it('renders single-line labels without units and unit captions below each input', () => {
    render(<MacroGoalsCard {...defaultProps} />);

    // Labels do not contain inline units
    expect(screen.getByText('Calories')).toBeDefined();
    expect(screen.getByText('Protein')).toBeDefined();
    expect(screen.getByText('Carbs')).toBeDefined();
    expect(screen.getByText('Fat')).toBeDefined();
    expect(screen.getByText('Fiber')).toBeDefined();

    expect(screen.queryByText(/Calories \(kcal\)/i)).toBeNull();
    expect(screen.queryByText(/Protein \(g\)/i)).toBeNull();
    expect(screen.queryByText(/Carbs \(g\)/i)).toBeNull();
    expect(screen.queryByText(/Fat \(g\)/i)).toBeNull();
    expect(screen.queryByText(/Fiber \(g\)/i)).toBeNull();

    // Unit captions rendered below
    expect(screen.getByText('kcal')).toBeDefined();
    expect(screen.getAllByText('g')).toHaveLength(4);
  });

  it('exposes accessible descriptions via aria-describedby for each input', () => {
    render(<MacroGoalsCard {...defaultProps} />);

    const calInput = screen.getByLabelText(/calories/i);
    const proteinInput = screen.getByLabelText(/protein/i);
    const carbsInput = screen.getByLabelText(/carbs/i);
    const fatInput = screen.getByLabelText(/^fat/i);
    const fiberInput = screen.getByLabelText(/fiber/i);

    expect(calInput).toHaveAccessibleDescription('kcal');
    expect(proteinInput).toHaveAccessibleDescription('g');
    expect(carbsInput).toHaveAccessibleDescription('g');
    expect(fatInput).toHaveAccessibleDescription('g');
    expect(fiberInput).toHaveAccessibleDescription('g');
  });

  it('handles save button submission', () => {
    const onSave = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<MacroGoalsCard {...defaultProps} onSave={onSave} />);

    const saveButton = screen.getByRole('button', { name: /save goals/i });
    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('passes axe accessibility audits with no violations', async () => {
    const { container } = render(<MacroGoalsCard {...defaultProps} />);
    await expectNoA11yViolations(container);
  });

  it('mounts live regions while idle and mutates content in place on status change (WCAG SC 4.1.3)', () => {
    const { container, rerender } = render(<MacroGoalsCard {...defaultProps} status={null} />);

    const polite = container.querySelector('[role="status"]');
    const assertive = container.querySelector('[role="alert"]');

    // Both live regions must exist while idle and be empty
    expect(polite).not.toBeNull();
    expect(assertive).not.toBeNull();
    expect(polite!.textContent).toBe('');
    expect(assertive!.textContent).toBe('');
    expect(screen.queryByTestId('settings-status-banner')).toBeNull();

    // Rerender with success status
    rerender(
      <MacroGoalsCard
        {...defaultProps}
        status={{ type: 'success', message: 'Goals updated successfully' }}
      />
    );

    // Node identity preserved across transition (no unmount/remount)
    expect(container.querySelector('[role="status"]')).toBe(polite);
    expect(container.querySelector('[role="alert"]')).toBe(assertive);
    expect(polite!.textContent).toBe('Goals updated successfully');
    expect(assertive!.textContent).toBe('');

    const banner = screen.getByTestId('settings-status-banner');
    expect(banner.textContent).toContain('Goals updated successfully');

    // Rerender with error status
    rerender(
      <MacroGoalsCard
        {...defaultProps}
        status={{ type: 'error', message: 'Failed to update goals' }}
      />
    );

    expect(container.querySelector('[role="status"]')).toBe(polite);
    expect(container.querySelector('[role="alert"]')).toBe(assertive);
    expect(assertive!.textContent).toBe('Failed to update goals');
    expect(polite!.textContent).toBe('');
  });

  it('accepts decimal comma ("72,5") and decimal period ("72.5") on converted macro inputs (protein, carbs, fat, fiber)', () => {
    const setTargetProtein = vi.fn();
    const setTargetCarbs = vi.fn();
    const setTargetFat = vi.fn();
    const setTargetFiber = vi.fn();
    const onSave = vi.fn((e: React.FormEvent) => e.preventDefault());

    const { rerender } = render(
      <MacroGoalsCard
        {...defaultProps}
        setTargetProtein={setTargetProtein}
        setTargetCarbs={setTargetCarbs}
        setTargetFat={setTargetFat}
        setTargetFiber={setTargetFiber}
        onSave={onSave}
      />
    );

    const calInput = screen.getByLabelText(/calories/i);
    const proteinInput = screen.getByLabelText(/protein/i);
    const carbsInput = screen.getByLabelText(/carbs/i);
    const fatInput = screen.getByLabelText(/^fat/i);
    const fiberInput = screen.getByLabelText(/fiber/i);

    // Calorie target remains integer-only type="number"
    expect(calInput.getAttribute('type')).toBe('number');

    // Converted macro inputs are type="text" and inputMode="decimal"
    expect(proteinInput.getAttribute('type')).toBe('text');
    expect(carbsInput.getAttribute('type')).toBe('text');
    expect(fatInput.getAttribute('type')).toBe('text');
    expect(fiberInput.getAttribute('type')).toBe('text');

    // Test decimal comma "72,5"
    fireEvent.change(proteinInput, { target: { value: '72,5' } });
    expect(setTargetProtein).toHaveBeenCalledWith(72.5);

    fireEvent.change(carbsInput, { target: { value: '72,5' } });
    expect(setTargetCarbs).toHaveBeenCalledWith(72.5);

    fireEvent.change(fatInput, { target: { value: '72,5' } });
    expect(setTargetFat).toHaveBeenCalledWith(72.5);

    fireEvent.change(fiberInput, { target: { value: '72,5' } });
    expect(setTargetFiber).toHaveBeenCalledWith(72.5);

    // Test decimal period "72.5"
    fireEvent.change(proteinInput, { target: { value: '72.5' } });
    expect(setTargetProtein).toHaveBeenCalledWith(72.5);

    fireEvent.change(carbsInput, { target: { value: '72.5' } });
    expect(setTargetCarbs).toHaveBeenCalledWith(72.5);

    fireEvent.change(fatInput, { target: { value: '72.5' } });
    expect(setTargetFat).toHaveBeenCalledWith(72.5);

    fireEvent.change(fiberInput, { target: { value: '72.5' } });
    expect(setTargetFiber).toHaveBeenCalledWith(72.5);

    // Form submission verifies save handler
    rerender(
      <MacroGoalsCard
        {...defaultProps}
        targetProtein={72.5}
        targetCarbs={72.5}
        targetFat={72.5}
        targetFiber={72.5}
        setTargetProtein={setTargetProtein}
        setTargetCarbs={setTargetCarbs}
        setTargetFat={setTargetFat}
        setTargetFiber={setTargetFiber}
        onSave={onSave}
      />
    );

    const saveButton = screen.getByRole('button', { name: /save goals/i });
    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('calls setters with "" when inputs are cleared instead of coercing to 0', () => {
    const setTargetCalories = vi.fn();
    const setTargetProtein = vi.fn();
    const setTargetCarbs = vi.fn();
    const setTargetFat = vi.fn();
    const setTargetFiber = vi.fn();

    render(
      <MacroGoalsCard
        {...defaultProps}
        setTargetCalories={setTargetCalories}
        setTargetProtein={setTargetProtein}
        setTargetCarbs={setTargetCarbs}
        setTargetFat={setTargetFat}
        setTargetFiber={setTargetFiber}
      />
    );

    const calInput = screen.getByLabelText(/calories/i);
    const proteinInput = screen.getByLabelText(/protein/i);
    const carbsInput = screen.getByLabelText(/carbs/i);
    const fatInput = screen.getByLabelText(/^fat/i);
    const fiberInput = screen.getByLabelText(/fiber/i);

    fireEvent.change(calInput, { target: { value: '' } });
    expect(setTargetCalories).toHaveBeenCalledWith('');

    fireEvent.change(proteinInput, { target: { value: '' } });
    expect(setTargetProtein).toHaveBeenCalledWith('');

    fireEvent.change(carbsInput, { target: { value: '' } });
    expect(setTargetCarbs).toHaveBeenCalledWith('');

    fireEvent.change(fatInput, { target: { value: '' } });
    expect(setTargetFat).toHaveBeenCalledWith('');

    fireEvent.change(fiberInput, { target: { value: '' } });
    expect(setTargetFiber).toHaveBeenCalledWith('');
  });

  it('does not allow negative calorie goals to be saved and sets min="0"', () => {
    let savedCalories: number | string | null = null;
    function CalorieGoalHarness() {
      const [calories, setCalories] = useState<number | string>(2200);
      return (
        <MacroGoalsCard
          {...defaultProps}
          targetCalories={calories}
          setTargetCalories={setCalories}
          onSave={(e) => {
            e.preventDefault();
            savedCalories = calories;
          }}
        />
      );
    }

    render(<CalorieGoalHarness />);
    const calInput = screen.getByLabelText(/calories/i);

    fireEvent.change(calInput, { target: { value: '-500' } });

    const saveButton = screen.getByRole('button', { name: /save goals/i });
    fireEvent.click(saveButton);

    expect(savedCalories).not.toBe(-500);
    expect(savedCalories).toBe(0);
    expect(calInput.getAttribute('min')).toBe('0');
  });
});
