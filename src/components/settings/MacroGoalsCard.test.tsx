import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
