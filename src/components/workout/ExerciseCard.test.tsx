import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExerciseCard, type ExerciseCardProps } from './ExerciseCard';
import type { WorkoutSet } from '../../types/database';
import { expectNoA11yViolations } from '../../test/a11y';
import { AuthContext, type AuthContextType } from '../../context/AuthContextTypes';

const createAuthContextValue = (weightUnit: 'lb' | 'kg' = 'lb', prMode: 'weight' | 'e1rm' = 'weight'): AuthContextType => ({
  user: { id: 'test-user-id' } as any,
  profile: { id: 'test-user-id', weight_unit: weightUnit, pr_mode: prMode } as any,
  role: 'athlete',
  viewMode: 'athlete',
  isCoachMode: false,
  loading: false,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  updateProfile: vi.fn(),
  switchRole: vi.fn(),
  refreshProfile: vi.fn(),
  resendConfirmation: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
});

function renderWithAuth(ui: React.ReactElement, weightUnit: 'lb' | 'kg' = 'lb', prMode: 'weight' | 'e1rm' = 'weight') {
  return render(
    <AuthContext.Provider value={createAuthContextValue(weightUnit, prMode)}>
      {ui}
    </AuthContext.Provider>
  );
}

describe('ExerciseCard', () => {
  const baseBenchmarks = {
    lastSession: {
      date: '2026-09-20',
      summaryText: '185×8, 185×8, 185×7',
    },
    pr: {
      weight: 225,
      reps: 5,
      date: '2026-08-15',
    },
  };

  const baseSetsToday: WorkoutSet[] = [
    {
      id: 'set-1',
      workout_id: 'workout-1',
      exercise_id: 'bench',
      set_index: 1,
      weight: 185,
      reps: 8,
      set_type: 'working',
      rpe: null,
      created_at: new Date().toISOString(),
    },
  ];

  const defaultProps: ExerciseCardProps = {
    exName: 'Bench Press',
    exIndex: 0,
    activeExercisesLength: 2,
    setsToday: baseSetsToday,
    benchmarks: baseBenchmarks,
    targetCount: 3,
    ghostValues: [
      { weight: 185, reps: 8, hintText: '185×8', isFromPrevious: true },
      { weight: 185, reps: 8, hintText: '185×8', isFromPrevious: true },
      { weight: 185, reps: 8, hintText: '185×8', isFromPrevious: true },
    ],
    isExpanded: true,
    inputDrafts: {},
    isMutating: false,
    isBatchPending: false,
    onToggleAccordion: vi.fn(),
    onAdjustTargetSets: vi.fn(),
    onMoveExercise: vi.fn(),
    onRemoveExercise: vi.fn(),
    onUpdateDraft: vi.fn(),
    onCommitSet: vi.fn(),
    onEditSet: vi.fn(),
    onBatchLogExercise: vi.fn(),
  };

  it('renders card title, index badge and chips (W7, W13)', () => {
    renderWithAuth(<ExerciseCard {...defaultProps} />);

    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByTestId('exercise-index-0')).toHaveTextContent('1');

    // W13: Last chip text visible without 140px clipping
    const lastChip = screen.getByTestId('last-chip-0');
    expect(lastChip).toBeInTheDocument();
    expect(lastChip.textContent).toContain('Last: 185×8, 185×8, 185×7');
    expect(lastChip.className).toContain('truncate');
    expect(lastChip.className).not.toContain('max-w-none');

    // W7: PR chip formatted
    const prChip = screen.getByTestId('pr-chip-0');
    expect(prChip).toBeInTheDocument();
    expect(prChip.textContent).toContain('PR: 225×5');

    // Sets count chip
    expect(screen.getByTestId('sets-progress-chip-0')).toHaveTextContent('1/3 Sets');
  });

  it('renders bodyweight PR as BW×reps (W7)', () => {
    const bwProps: ExerciseCardProps = {
      ...defaultProps,
      exName: 'Pull Up',
      benchmarks: {
        lastSession: null,
        pr: { weight: 0, reps: 15, date: '2026-08-01' },
      },
    };

    renderWithAuth(<ExerciseCard {...bwProps} />);
    expect(screen.getByTestId('pr-chip-0')).toHaveTextContent('PR: BW×15');
    expect(screen.getByText('No prior session')).toBeInTheDocument();
  });

  it('handles target sets stepper decrease and increase with unified 12px/700 type scale (HF-A)', () => {
    const onAdjustTargetSets = vi.fn();
    renderWithAuth(<ExerciseCard {...defaultProps} onAdjustTargetSets={onAdjustTargetSets} />);

    const decreaseBtn = screen.getByTitle('Decrease target sets');
    const increaseBtn = screen.getByTitle('Increase target sets');
    // HF-A: Stepper -/+ buttons and value have same size (12px / 700 text-xs font-bold)
    expect(decreaseBtn.className).toContain('text-xs');
    expect(decreaseBtn.className).toContain('font-bold');
    expect(increaseBtn.className).toContain('text-xs');
    expect(increaseBtn.className).toContain('font-bold');

    fireEvent.click(increaseBtn);
    expect(onAdjustTargetSets).toHaveBeenCalledWith('Bench Press', 1);

    fireEvent.click(decreaseBtn);
    expect(onAdjustTargetSets).toHaveBeenCalledWith('Bench Press', -1);
  });

  it('disables decrease button when targetCount equals completed sets', () => {
    renderWithAuth(
      <ExerciseCard
        {...defaultProps}
        targetCount={1}
        setsToday={baseSetsToday}
      />
    );

    const decreaseBtn = screen.getByTitle('Decrease target sets');
    expect(decreaseBtn).toBeDisabled();
  });

  it('handles move down and remove actions', () => {
    const onMoveExercise = vi.fn();
    const onRemoveExercise = vi.fn();

    renderWithAuth(
      <ExerciseCard
        {...defaultProps}
        onMoveExercise={onMoveExercise}
        onRemoveExercise={onRemoveExercise}
      />
    );

    const moveDownBtn = screen.getByTitle('Move down');
    fireEvent.click(moveDownBtn);
    expect(onMoveExercise).toHaveBeenCalledWith(0, 1);

    const removeBtn = screen.getByTitle('Remove from workout');
    fireEvent.click(removeBtn);
    expect(onRemoveExercise).toHaveBeenCalledWith(0);
  });

  it('toggles accordion when clicking header button', () => {
    const onToggleAccordion = vi.fn();
    renderWithAuth(<ExerciseCard {...defaultProps} onToggleAccordion={onToggleAccordion} />);

    const headerBtn = screen.getByRole('button', { name: /Bench Press, collapse exercise/i });
    fireEvent.click(headerBtn);
    expect(onToggleAccordion).toHaveBeenCalledWith('Bench Press');
  });

  describe('W36 memo comparator', () => {
    it('does not re-render when typing in another exercise card', () => {
      let renderCount = 0;
      const SpyCard = (props: ExerciseCardProps) => {
        renderCount++;
        return <ExerciseCard {...props} />;
      };

      const { rerender } = renderWithAuth(<SpyCard {...defaultProps} />);
      expect(renderCount).toBe(1);

      // Rerender with inputDrafts change in Squat (unrelated card)
      rerender(
        <AuthContext.Provider value={createAuthContextValue('lb')}>
          <SpyCard
            {...defaultProps}
            inputDrafts={{
              'Squat_1': { weight: '225', reps: '5' },
            }}
          />
        </AuthContext.Provider>
      );
    });

    it('re-renders when benchmarks change by value', () => {
      const { rerender } = renderWithAuth(<ExerciseCard {...defaultProps} />);
      expect(screen.getByTestId('pr-chip-0')).toHaveTextContent('PR: 225×5');

      // Update PR benchmark
      const updatedBenchmarks = {
        ...baseBenchmarks,
        pr: { weight: 230, reps: 5, date: '2026-09-27' },
      };

      rerender(
        <AuthContext.Provider value={createAuthContextValue('lb')}>
          <ExerciseCard {...defaultProps} benchmarks={updatedBenchmarks} />
        </AuthContext.Provider>
      );
      expect(screen.getByTestId('pr-chip-0')).toHaveTextContent('PR: 230×5');
    });

    it('re-renders when input draft for this exercise changes', () => {
      const { rerender } = renderWithAuth(<ExerciseCard {...defaultProps} />);
      expect((screen.getByTestId('ghost-weight-0-1') as HTMLInputElement).value).toBe('185');

      rerender(
        <AuthContext.Provider value={createAuthContextValue('lb')}>
          <ExerciseCard
            {...defaultProps}
            inputDrafts={{
              'Bench Press_2': { weight: '190', reps: '8' },
            }}
          />
        </AuthContext.Provider>
      );

      expect((screen.getByTestId('ghost-weight-0-1') as HTMLInputElement).value).toBe('190');
    });
  });

  it('satisfies accessibility standards', async () => {
    const { container } = renderWithAuth(<ExerciseCard {...defaultProps} />);
    await expectNoA11yViolations(container);
  });

  it('formats PR chip and prefills ghost weight in kg mode (P6, W3)', () => {
    const kgProps: ExerciseCardProps = {
      ...defaultProps,
      benchmarks: {
        lastSession: null,
        pr: { weight: 225, reps: 5, date: '2026-08-15' },
      },
      ghostValues: [
        { weight: 225, reps: 5, hintText: '102.1 kg × 5', isFromPrevious: true },
        { weight: 225, reps: 5, hintText: '102.1 kg × 5', isFromPrevious: true },
      ],
      setsToday: [],
    };

    renderWithAuth(<ExerciseCard {...kgProps} />, 'kg');

    const prChip = screen.getByTestId('pr-chip-0');
    expect(prChip).toHaveTextContent('PR: 102.1×5');

    const weightInput0 = screen.getByTestId('ghost-weight-0-0') as HTMLInputElement;
    expect(weightInput0.value).toBe('102.1');
  });
  it('renders inline error alert with retry and dismiss buttons when error prop is provided', async () => {
    const mockRetry = vi.fn();
    const mockDismiss = vi.fn();

    const { rerender, container } = renderWithAuth(
      <ExerciseCard
        {...defaultProps}
        error={{ message: 'Exercise "Bench Press" cannot be resolved to a valid UUID.', onRetry: mockRetry }}
        onDismissError={mockDismiss}
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Bench Press:');
    expect(alert).toHaveTextContent('Exercise "Bench Press" cannot be resolved to a valid UUID.');

    // Retry button triggers onRetry
    const retryBtn = screen.getByTestId('retry-exercise-btn-0');
    fireEvent.click(retryBtn);
    expect(mockRetry).toHaveBeenCalledTimes(1);

    // Dismiss button triggers onDismissError
    const dismissBtn = screen.getByTestId('dismiss-exercise-error-btn-0');
    fireEvent.click(dismissBtn);
    expect(mockDismiss).toHaveBeenCalledWith('Bench Press');

    // Also renders when collapsed
    rerender(
      <AuthContext.Provider value={createAuthContextValue('lb')}>
        <ExerciseCard
          {...defaultProps}
          isExpanded={false}
          error={{ message: 'Exercise "Bench Press" cannot be resolved to a valid UUID.', onRetry: mockRetry }}
          onDismissError={mockDismiss}
        />
      </AuthContext.Provider>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
  it('displays e1RM suffix on PR chip when pr_mode is e1rm (D-P8.1-8)', () => {
    const prProps: ExerciseCardProps = {
      ...defaultProps,
      benchmarks: {
        lastSession: null,
        pr: { weight: 225, reps: 5, date: '2026-08-15' },
      },
    };

    renderWithAuth(<ExerciseCard {...prProps} />, 'lb', 'e1rm');
    const prChip = screen.getByTestId('pr-chip-0');
    // 225 * (1 + 5/30) = 262.5 lbs
    expect(prChip).toHaveTextContent('PR: 225×5 · e1RM 262.5 lbs');
  });

  it('displays converted e1RM suffix in kg mode when pr_mode is e1rm', () => {
    const prProps: ExerciseCardProps = {
      ...defaultProps,
      benchmarks: {
        lastSession: null,
        pr: { weight: 225, reps: 5, date: '2026-08-15' },
      },
    };

    renderWithAuth(<ExerciseCard {...prProps} />, 'kg', 'e1rm');
    const prChip = screen.getByTestId('pr-chip-0');
    // 225 lb = 102.1 kg; 262.5 lb = 119.1 kg
    expect(prChip).toHaveTextContent('PR: 102.1×5 · e1RM 119.1 kg');
  });

  it('omits e1RM suffix for bodyweight sets even when pr_mode is e1rm', () => {
    const bwProps: ExerciseCardProps = {
      ...defaultProps,
      benchmarks: {
        lastSession: null,
        pr: { weight: 0, reps: 15, date: '2026-08-01' },
      },
    };

    renderWithAuth(<ExerciseCard {...bwProps} />, 'lb', 'e1rm');
    const prChip = screen.getByTestId('pr-chip-0');
    expect(prChip).toHaveTextContent('PR: BW×15');
    expect(prChip.textContent).not.toContain('e1RM');
  });

  it('omits e1RM suffix for ineligible sets (reps > 12) in e1rm mode', () => {
    const highRepProps: ExerciseCardProps = {
      ...defaultProps,
      benchmarks: {
        lastSession: null,
        pr: { weight: 100, reps: 15, date: '2026-08-01' },
      },
    };

    renderWithAuth(<ExerciseCard {...highRepProps} />, 'lb', 'e1rm');
    const prChip = screen.getByTestId('pr-chip-0');
    expect(prChip).toHaveTextContent('PR: 100×15');
    expect(prChip.textContent).not.toContain('e1RM');
  });

  it('renders pending mark in header when any set in setsToday is pending', () => {
    const pendingProps: ExerciseCardProps = {
      ...defaultProps,
      setsToday: [
        { id: 's1', exercise_id: 'e1', set_index: 1, weight: 100, reps: 10, set_type: 'working', pending: true } as any,
      ],
    };

    const { rerender } = renderWithAuth(<ExerciseCard {...pendingProps} />);
    const headerButton = screen.getByRole('button', { name: /Bench Press.*exercise/ });
    expect(headerButton.querySelector('[data-testid="pending-mark"]')).toBeInTheDocument();

    const syncedProps: ExerciseCardProps = {
      ...defaultProps,
      setsToday: [
        { id: 's1', exercise_id: 'e1', set_index: 1, weight: 100, reps: 10, set_type: 'working', pending: false } as any,
      ],
    };
    rerender(
      <AuthContext.Provider value={createAuthContextValue()}>
        <ExerciseCard {...syncedProps} />
      </AuthContext.Provider>
    );
    expect(headerButton.querySelector('[data-testid="pending-mark"]')).toBeNull();
  });
});
