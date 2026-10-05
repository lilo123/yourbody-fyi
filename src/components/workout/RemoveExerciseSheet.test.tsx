import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RemoveExerciseSheet } from './RemoveExerciseSheet';

describe('RemoveExerciseSheet (W8, STD-CMP-1/4/7)', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    exerciseName: 'Bench Press',
    loggedSetsCount: 3,
    onRemoveAndDeleteSets: vi.fn(),
    onKeepSetsAndCollapse: vi.fn(),
    isDeleting: false,
  };

  it('renders exercise name and logged set count', () => {
    render(<RemoveExerciseSheet {...defaultProps} />);

    expect(screen.getByText(/Remove Exercise/i)).toBeDefined();
    expect(screen.getByText(/“Bench Press” has 3 logged sets\./i)).toBeDefined();
    expect(screen.getByTestId('remove-delete-sets-btn')).toBeDefined();
    expect(screen.getByTestId('keep-sets-collapse-btn')).toBeDefined();
    expect(screen.getByTestId('remove-exercise-cancel-btn')).toBeDefined();
  });

  it('clicking "Remove & delete N logged sets" calls onRemoveAndDeleteSets', () => {
    const onRemoveAndDeleteSets = vi.fn();
    render(<RemoveExerciseSheet {...defaultProps} onRemoveAndDeleteSets={onRemoveAndDeleteSets} />);

    fireEvent.click(screen.getByTestId('remove-delete-sets-btn'));
    expect(onRemoveAndDeleteSets).toHaveBeenCalledTimes(1);
  });

  it('clicking "Keep sets, collapse card" calls onKeepSetsAndCollapse', () => {
    const onKeepSetsAndCollapse = vi.fn();
    render(<RemoveExerciseSheet {...defaultProps} onKeepSetsAndCollapse={onKeepSetsAndCollapse} />);

    fireEvent.click(screen.getByTestId('keep-sets-collapse-btn'));
    expect(onKeepSetsAndCollapse).toHaveBeenCalledTimes(1);
  });

  it('clicking Cancel or Close button calls onClose', () => {
    const onClose = vi.fn();
    render(<RemoveExerciseSheet {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('remove-exercise-cancel-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('remove-exercise-sheet-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
