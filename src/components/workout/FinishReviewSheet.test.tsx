import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FinishReviewSheet, type PendingReviewSet } from './FinishReviewSheet';
import { AuthContext, type AuthContextType } from '../../context/AuthContextTypes';

const createAuthContextValue = (weightUnit: 'lb' | 'kg' = 'lb'): AuthContextType => ({
  user: { id: 'user-789' } as any,
  profile: { id: 'user-789', weight_unit: weightUnit } as any,
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

const renderWithAuth = (ui: React.ReactElement, weightUnit: 'lb' | 'kg' = 'lb') => {
  return render(
    <AuthContext.Provider value={createAuthContextValue(weightUnit)}>
      {ui}
    </AuthContext.Provider>
  );
};

describe('FinishReviewSheet (STD CMP 1 4 7)', () => {
  const mockPendingSets: PendingReviewSet[] = [
    { exerciseName: 'Bench Press', weight: 185, reps: 8, setIndex: 2 },
    { exerciseName: 'Bench Press', weight: 185, reps: 8, setIndex: 3 },
    { exerciseName: 'Squat', weight: 225, reps: 5, setIndex: 1 },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    pendingSets: mockPendingSets,
    onConfirmFinishWithSets: vi.fn(),
    onFinishWithoutSets: vi.fn(),
    isSubmitting: false,
  };

  it('renders all pending sets with initial values', () => {
    renderWithAuth(<FinishReviewSheet {...defaultProps} />);

    expect(screen.getByText('Review Pending Sets')).toBeDefined();
    expect(screen.getByText(/Review the 3 pending set\(s\)/i)).toBeDefined();
    expect(screen.getAllByText('Bench Press')).toHaveLength(2);
    expect(screen.getByText('Squat')).toBeDefined();

    expect(screen.getByTestId('finish-review-weight-0')).toHaveValue('185');
    expect(screen.getByTestId('finish-review-reps-0')).toHaveValue('8');

    expect(screen.getByTestId('log-reviewed-sets-btn')).toHaveTextContent('Log 3 sets & finish');
  });

  it('allows editing weight and reps of pending sets', () => {
    const onConfirmFinishWithSets = vi.fn();
    renderWithAuth(<FinishReviewSheet {...defaultProps} onConfirmFinishWithSets={onConfirmFinishWithSets} />);

    const weightInput = screen.getByTestId('finish-review-weight-0');
    fireEvent.change(weightInput, { target: { value: '195' } });
    expect(weightInput).toHaveValue('195');

    const repsInput = screen.getByTestId('finish-review-reps-0');
    fireEvent.change(repsInput, { target: { value: '10' } });
    expect(repsInput).toHaveValue('10');

    fireEvent.click(screen.getByTestId('log-reviewed-sets-btn'));
    expect(onConfirmFinishWithSets).toHaveBeenCalledWith([
      { exerciseName: 'Bench Press', weight: 195, reps: 10, setIndex: 2, exerciseId: undefined },
      { exerciseName: 'Bench Press', weight: 185, reps: 8, setIndex: 3, exerciseId: undefined },
      { exerciseName: 'Squat', weight: 225, reps: 5, setIndex: 1, exerciseId: undefined },
    ]);
  });

  it('allows removing a pending set', () => {
    const onConfirmFinishWithSets = vi.fn();
    renderWithAuth(<FinishReviewSheet {...defaultProps} onConfirmFinishWithSets={onConfirmFinishWithSets} />);

    fireEvent.click(screen.getByTestId('finish-review-remove-1'));

    expect(screen.getByTestId('log-reviewed-sets-btn')).toHaveTextContent('Log 2 sets & finish');

    fireEvent.click(screen.getByTestId('log-reviewed-sets-btn'));
    expect(onConfirmFinishWithSets).toHaveBeenCalledWith([
      { exerciseName: 'Bench Press', weight: 185, reps: 8, setIndex: 2, exerciseId: undefined },
      { exerciseName: 'Squat', weight: 225, reps: 5, setIndex: 1, exerciseId: undefined },
    ]);
  });

  it('clicking "Finish without them" calls onFinishWithoutSets', () => {
    const onFinishWithoutSets = vi.fn();
    renderWithAuth(<FinishReviewSheet {...defaultProps} onFinishWithoutSets={onFinishWithoutSets} />);

    fireEvent.click(screen.getByTestId('finish-without-sets-btn'));
    expect(onFinishWithoutSets).toHaveBeenCalledTimes(1);
  });

  it('renders 0 weight as "0" for bodyweight exercises and validates positive reps', () => {
    const onConfirmFinishWithSets = vi.fn();
    const bodyweightSets: PendingReviewSet[] = [
      { exerciseName: 'Pull-up', weight: 0, reps: 10, setIndex: 1 },
    ];

    renderWithAuth(
      <FinishReviewSheet
        {...defaultProps}
        pendingSets={bodyweightSets}
        onConfirmFinishWithSets={onConfirmFinishWithSets}
      />
    );

    const weightInput = screen.getByTestId('finish-review-weight-0');
    expect(weightInput).toHaveValue('0');

    const logBtn = screen.getByTestId('log-reviewed-sets-btn');
    expect(logBtn).toBeEnabled();

    // Setting reps to 0 marks set invalid and disables submit
    const repsInput = screen.getByTestId('finish-review-reps-0');
    fireEvent.change(repsInput, { target: { value: '0' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/valid reps/i);
    expect(logBtn).toBeDisabled();
  });

  it('displays weights in kg, preserves unedited original lb, and converts edited kg input', () => {
    const onConfirmFinishWithSets = vi.fn();
    const kgSets: PendingReviewSet[] = [
      { exerciseName: 'Bench Press', weight: 225, reps: 5, setIndex: 1 },
      { exerciseName: 'Squat', weight: 315, reps: 3, setIndex: 1 },
    ];

    renderWithAuth(
      <FinishReviewSheet
        {...defaultProps}
        pendingSets={kgSets}
        onConfirmFinishWithSets={onConfirmFinishWithSets}
      />,
      'kg'
    );

    // 225 lb in kg displays as 102.1
    const weight0 = screen.getByTestId('finish-review-weight-0');
    expect(weight0).toHaveValue('102.1');

    // Edit Squat from display to 100 kg
    const weight1 = screen.getByTestId('finish-review-weight-1');
    fireEvent.change(weight1, { target: { value: '100' } });

    fireEvent.click(screen.getByTestId('log-reviewed-sets-btn'));

    expect(onConfirmFinishWithSets).toHaveBeenCalledWith([
      // Unedited set 0 preserves exact 225 lb
      { exerciseName: 'Bench Press', weight: 225, reps: 5, setIndex: 1, exerciseId: undefined },
      // Edited set 1 converts 100 kg to ~220.462 lb
      expect.objectContaining({
        exerciseName: 'Squat',
        weight: expect.closeTo(220.462, 2),
        reps: 3,
        setIndex: 1,
      }),
    ]);
  });
});
