import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('NEW-15: mounts live regions unconditionally and mutates text in place on status changes', () => {
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
});
