import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkoutHeader } from './WorkoutHeader';
import { expectNoA11yViolations } from '../../test/a11y';

describe('WorkoutHeader', () => {
  const defaultProps = {
    mutationError: null,
    onClearMutationError: vi.fn(),
    activeRoutineName: 'Chest Day',
    onOpenRoutineModal: vi.fn(),
    workoutDate: '2026-09-21',
    onDateChange: vi.fn(),
    onClearWorkout: vi.fn(),
  };

  it('mounts live regions empty while idle and retains same DOM node on error mutation', () => {
    const onClear = vi.fn();
    const { rerender, container } = render(
      <WorkoutHeader {...defaultProps} mutationError={null} onClearMutationError={onClear} />
    );

    const assertiveBefore = container.querySelector('[role="alert"]');
    const politeBefore = container.querySelector('[role="status"]');

    expect(assertiveBefore).not.toBeNull();
    expect(politeBefore).not.toBeNull();
    expect(assertiveBefore!.textContent).toBe('');
    expect(politeBefore!.textContent).toBe('');

    // Rerender with mutation error
    rerender(
      <WorkoutHeader
        {...defaultProps}
        mutationError="Failed to save workout set"
        onClearMutationError={onClear}
      />
    );

    const assertiveAfter = container.querySelector('[role="alert"]');
    expect(assertiveAfter).toBe(assertiveBefore);
    expect(assertiveAfter!.textContent).toBe('Failed to save workout set');

    // Dismiss button works and satisfies touch-target className contract (min-w-[44px] min-h-[44px])
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss error' });
    expect(dismissBtn.className).toContain('min-w-[44px]');
    expect(dismissBtn.className).toContain('min-h-[44px]');
    fireEvent.click(dismissBtn);
    expect(onClear).toHaveBeenCalledTimes(1);

    // Rerender back to idle
    rerender(
      <WorkoutHeader {...defaultProps} mutationError={null} onClearMutationError={onClear} />
    );

    expect(container.querySelector('[role="alert"]')).toBe(assertiveBefore);
    expect(assertiveBefore!.textContent).toBe('');
  });

  it('satisfies touch target and typography requirements on all controls', () => {
    const onClear = vi.fn();
    const onDateChange = vi.fn();
    const onOpenRoutine = vi.fn();
    const { container } = render(
      <WorkoutHeader
        {...defaultProps}
        onClearWorkout={onClear}
        onDateChange={onDateChange}
        onOpenRoutineModal={onOpenRoutine}
      />
    );

    // One semantic h1/h2 heading present
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toBeInTheDocument();

    // Routine button >= 44px hit
    const routineBtn = screen.getByTestId('routine-select-btn');
    expect(routineBtn.className).toContain('min-h-[44px]');
    expect(routineBtn.className).toContain('min-w-[44px]');
    fireEvent.click(routineBtn);
    expect(onOpenRoutine).toHaveBeenCalledTimes(1);

    // Rest timer button >= 44px hit
    const timerBtn = screen.getByTestId('rest-timer-btn');
    expect(timerBtn.className).toContain('min-h-[44px]');
    expect(timerBtn.className).toContain('min-w-[44px]');

    // Date input >= 44px hit, 16px text (text-base), tabular-nums, no font-mono
    const dateInput = screen.getByTestId('workout-date-input');
    expect(dateInput.className).toContain('min-h-[44px]');
    expect(dateInput.className).toContain('text-base');
    expect(dateInput.className).toContain('tabular-nums');
    expect(dateInput.className).not.toContain('font-mono');

    // Clear button >= 44px hit, visible label 'Clear', title 'Clear Workout', accessible name 'Clear workout'
    const clearBtn = screen.getByTitle('Clear Workout');
    expect(clearBtn).toBeInTheDocument();
    expect(clearBtn.className).toContain('min-h-[44px]');
    expect(clearBtn.className).toContain('min-w-[44px]');
    expect(clearBtn.getAttribute('aria-label')).toBe('Clear workout');
    expect(clearBtn.textContent).toContain('Clear');
    fireEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalledTimes(1);

    // STD-TYP: no font-black or font-extrabold
    expect(container.innerHTML).not.toContain('font-black');
    expect(container.innerHTML).not.toContain('font-extrabold');
  });

  it('passes axe accessibility audit with zero violations', async () => {
    const { container } = render(
      <WorkoutHeader
        {...defaultProps}
        mutationError="Test mutation error"
      />
    );
    await expectNoA11yViolations(container);
  });
});
