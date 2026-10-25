import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CoachAthleteMacros } from './CoachAthleteMacros';
import { expectNoA11yViolations } from '../../test/a11y';

describe('CoachAthleteMacros accessibility', () => {
  const defaultProps = {
    selectedAthlete: { name: 'Alice' },
    athleteCal: 2000,
    setAthleteCal: vi.fn(),
    athletePro: 150,
    setAthletePro: vi.fn(),
    athleteCarb: 200,
    setAthleteCarb: vi.fn(),
    athleteFat: 60,
    setAthleteFat: vi.fn(),
    athleteFiber: 30,
    setAthleteFiber: vi.fn(),
    isUpdatingMacros: false,
    macroStatus: null,
    onUpdateAthleteMacros: vi.fn(),
  };

  it('associates labels with all 5 macro inputs', () => {
    render(<CoachAthleteMacros {...defaultProps} />);

    expect(screen.getByLabelText(/daily calorie target/i)).toBeDefined();
    expect(screen.getByLabelText(/protein/i)).toBeDefined();
    expect(screen.getByLabelText(/carbs/i)).toBeDefined();
    expect(screen.getByLabelText(/^fat$/i)).toBeDefined();
    expect(screen.getByLabelText(/fiber/i)).toBeDefined();
  });

  it('passes axe accessibility audits with no violations', async () => {
    const { container } = render(<CoachAthleteMacros {...defaultProps} />);
    await expectNoA11yViolations(container);
  });

  it('mounts live regions unconditionally and mutates text in place on status changes', () => {
    const politeOf = (c: HTMLElement) => c.querySelector('[role="status"]');
    const assertiveOf = (c: HTMLElement) => c.querySelector('[role="alert"]');

    const { container, rerender } = render(<CoachAthleteMacros {...defaultProps} macroStatus={null} />);
    const politeBefore = politeOf(container);
    const assertiveBefore = assertiveOf(container);

    expect(politeBefore).not.toBeNull();
    expect(assertiveBefore).not.toBeNull();
    expect(politeBefore!.textContent).toBe('');
    expect(assertiveBefore!.textContent).toBe('');

    // Success transition
    rerender(
      <CoachAthleteMacros
        {...defaultProps}
        macroStatus={{ type: 'success', message: 'Athlete nutrition targets updated!' }}
      />
    );
    const politeAfter = politeOf(container);
    const assertiveAfter = assertiveOf(container);

    expect(politeAfter).toBe(politeBefore);
    expect(assertiveAfter).toBe(assertiveBefore);
    expect(politeAfter!.textContent).toBe('Athlete nutrition targets updated!');
    expect(assertiveAfter!.textContent).toBe('');

    // Error transition
    rerender(
      <CoachAthleteMacros
        {...defaultProps}
        macroStatus={{ type: 'error', message: 'Failed to update targets' }}
      />
    );
    expect(politeOf(container)).toBe(politeBefore);
    expect(assertiveOf(container)).toBe(assertiveBefore);
    expect(politeOf(container)!.textContent).toBe('');
    expect(assertiveOf(container)!.textContent).toBe('Failed to update targets');
  });

  it('accepts decimal comma ("72,5") and decimal period ("72.5") on converted macro inputs (protein, carbs, fat, fiber)', () => {
    const setAthletePro = vi.fn();
    const setAthleteCarb = vi.fn();
    const setAthleteFat = vi.fn();
    const setAthleteFiber = vi.fn();
    const onUpdateAthleteMacros = vi.fn((e: React.FormEvent) => e.preventDefault());

    const { rerender } = render(
      <CoachAthleteMacros
        {...defaultProps}
        setAthletePro={setAthletePro}
        setAthleteCarb={setAthleteCarb}
        setAthleteFat={setAthleteFat}
        setAthleteFiber={setAthleteFiber}
        onUpdateAthleteMacros={onUpdateAthleteMacros}
      />
    );

    const proInput = screen.getByTestId('athlete-macro-pro');
    const carbInput = screen.getByTestId('athlete-macro-carb');
    const fatInput = screen.getByTestId('athlete-macro-fat');
    const fiberInput = screen.getByTestId('athlete-macro-fiber');

    // Converted fields use inputMode="decimal" and type="text"
    expect(proInput.getAttribute('type')).toBe('text');
    expect(carbInput.getAttribute('type')).toBe('text');
    expect(fatInput.getAttribute('type')).toBe('text');
    expect(fiberInput.getAttribute('type')).toBe('text');

    // Test decimal comma "72,5"
    fireEvent.change(proInput, { target: { value: '72,5' } });
    expect(setAthletePro).toHaveBeenCalledWith('72.5');

    fireEvent.change(carbInput, { target: { value: '72,5' } });
    expect(setAthleteCarb).toHaveBeenCalledWith('72.5');

    fireEvent.change(fatInput, { target: { value: '72,5' } });
    expect(setAthleteFat).toHaveBeenCalledWith('72.5');

    fireEvent.change(fiberInput, { target: { value: '72,5' } });
    expect(setAthleteFiber).toHaveBeenCalledWith('72.5');

    // Test decimal period "72.5"
    fireEvent.change(proInput, { target: { value: '72.5' } });
    expect(setAthletePro).toHaveBeenCalledWith('72.5');

    fireEvent.change(carbInput, { target: { value: '72.5' } });
    expect(setAthleteCarb).toHaveBeenCalledWith('72.5');

    fireEvent.change(fatInput, { target: { value: '72.5' } });
    expect(setAthleteFat).toHaveBeenCalledWith('72.5');

    fireEvent.change(fiberInput, { target: { value: '72.5' } });
    expect(setAthleteFiber).toHaveBeenCalledWith('72.5');

    // Form submission verifies save handler is called with updated values
    rerender(
      <CoachAthleteMacros
        {...defaultProps}
        athletePro="72.5"
        athleteCarb="72.5"
        athleteFat="72.5"
        athleteFiber="72.5"
        setAthletePro={setAthletePro}
        setAthleteCarb={setAthleteCarb}
        setAthleteFat={setAthleteFat}
        setAthleteFiber={setAthleteFiber}
        onUpdateAthleteMacros={onUpdateAthleteMacros}
      />
    );

    const submitBtn = screen.getByTestId('update-athlete-macros-btn');
    fireEvent.click(submitBtn);
    expect(onUpdateAthleteMacros).toHaveBeenCalledTimes(1);
  });

  it('disables submit button when isLoading is true', () => {
    render(<CoachAthleteMacros {...defaultProps} isLoading={true} />);
    expect(screen.getByTestId('update-athlete-macros-btn')).toBeDisabled();
  });
});
