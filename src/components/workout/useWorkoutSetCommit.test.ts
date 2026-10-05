import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkoutSetCommit } from './useWorkoutSetCommit';
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

const createWrapper = (weightUnit: 'lb' | 'kg' = 'lb') => {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(AuthContext.Provider, { value: createAuthContextValue(weightUnit) }, children);
};

describe('useWorkoutSetCommit', () => {
  const dummyExercises = [
    { id: '00000000-0000-0000-0000-000000000001', name: 'Bench Press', category: 'Chest' },
  ] as any;

  it('commits set with draft values when present', () => {
    const logSetMutation = { mutate: vi.fn() } as any;
    const batchLogSetsMutation = { mutate: vi.fn() } as any;
    const setMutationError = vi.fn();
    const inputDraftsRef = {
      current: {
        'Bench Press_1': { weight: '150', reps: '8' },
      },
    };
    const targetRepCountsRef = { current: {} };

    const { result } = renderHook(
      () =>
        useWorkoutSetCommit({
          exercises: dummyExercises,
          inputDraftsRef,
          targetRepCountsRef,
          logSetMutation,
          batchLogSetsMutation,
          setMutationError,
        }),
      { wrapper: createWrapper('lb') }
    );

    act(() => {
      result.current.handleCommitSet('Bench Press', 1, { weight: 135, reps: 10 });
    });

    expect(logSetMutation.mutate).toHaveBeenCalledWith({
      exerciseName: 'Bench Press',
      exerciseId: '00000000-0000-0000-0000-000000000001',
      weight: 150,
      reps: 8,
      setIndex: 1,
    });
    expect(setMutationError).not.toHaveBeenCalled();
  });

  it('falls back to ghost values when drafts are absent', () => {
    const logSetMutation = { mutate: vi.fn() } as any;
    const batchLogSetsMutation = { mutate: vi.fn() } as any;
    const setMutationError = vi.fn();
    const inputDraftsRef = { current: {} };
    const targetRepCountsRef = { current: {} };

    const { result } = renderHook(
      () =>
        useWorkoutSetCommit({
          exercises: dummyExercises,
          inputDraftsRef,
          targetRepCountsRef,
          logSetMutation,
          batchLogSetsMutation,
          setMutationError,
        }),
      { wrapper: createWrapper('lb') }
    );

    act(() => {
      result.current.handleCommitSet('Bench Press', 1, { weight: 135, reps: 10 });
    });

    expect(logSetMutation.mutate).toHaveBeenCalledWith({
      exerciseName: 'Bench Press',
      exerciseId: '00000000-0000-0000-0000-000000000001',
      weight: 135,
      reps: 10,
      setIndex: 1,
    });
  });

  it('rejects invalid/empty values with error message', () => {
    const logSetMutation = { mutate: vi.fn() } as any;
    const batchLogSetsMutation = { mutate: vi.fn() } as any;
    const setMutationError = vi.fn();
    const inputDraftsRef = { current: {} };
    const targetRepCountsRef = { current: {} };

    const { result } = renderHook(
      () =>
        useWorkoutSetCommit({
          exercises: dummyExercises,
          inputDraftsRef,
          targetRepCountsRef,
          logSetMutation,
          batchLogSetsMutation,
          setMutationError,
        }),
      { wrapper: createWrapper('lb') }
    );

    act(() => {
      result.current.handleCommitSet('Bench Press', 1, { weight: '', reps: '' });
    });

    expect(logSetMutation.mutate).not.toHaveBeenCalled();
    expect(setMutationError).toHaveBeenCalledWith('Please enter weight and reps or use previous set values.');
  });

  it('converts kg draft weight to canonical lb on commit', () => {
    const logSetMutation = { mutate: vi.fn() } as any;
    const batchLogSetsMutation = { mutate: vi.fn() } as any;
    const setMutationError = vi.fn();
    const inputDraftsRef = {
      current: {
        'Bench Press_1': { weight: '100', reps: '5' },
      },
    };
    const targetRepCountsRef = { current: {} };

    const { result } = renderHook(
      () =>
        useWorkoutSetCommit({
          exercises: dummyExercises,
          inputDraftsRef,
          targetRepCountsRef,
          logSetMutation,
          batchLogSetsMutation,
          setMutationError,
        }),
      { wrapper: createWrapper('kg') }
    );

    act(() => {
      result.current.handleCommitSet('Bench Press', 1, { weight: '', reps: '' });
    });

    expect(logSetMutation.mutate).toHaveBeenCalledWith({
      exerciseName: 'Bench Press',
      exerciseId: '00000000-0000-0000-0000-000000000001',
      weight: expect.closeTo(220.462, 2),
      reps: 5,
      setIndex: 1,
    });
  });

  it('preserves exact original lb when kg draft matches prefilled display weight', () => {
    const logSetMutation = { mutate: vi.fn() } as any;
    const batchLogSetsMutation = { mutate: vi.fn() } as any;
    const setMutationError = vi.fn();
    // 225 lb displays as 102.1 kg
    const inputDraftsRef = {
      current: {
        'Bench Press_1': { weight: '102.1', reps: '5' },
      },
    };
    const targetRepCountsRef = { current: {} };

    const { result } = renderHook(
      () =>
        useWorkoutSetCommit({
          exercises: dummyExercises,
          inputDraftsRef,
          targetRepCountsRef,
          logSetMutation,
          batchLogSetsMutation,
          setMutationError,
        }),
      { wrapper: createWrapper('kg') }
    );

    act(() => {
      // ghostValues.weight is original stored 225 lb
      result.current.handleCommitSet('Bench Press', 1, { weight: 225, reps: 5 });
    });

    expect(logSetMutation.mutate).toHaveBeenCalledWith({
      exerciseName: 'Bench Press',
      exerciseId: '00000000-0000-0000-0000-000000000001',
      weight: 225, // exact preservation
      reps: 5,
      setIndex: 1,
    });
  });

  it('batch logs sets converting kg draft values and preserving unedited ghost weights', () => {
    const logSetMutation = { mutate: vi.fn() } as any;
    const batchLogSetsMutation = { mutate: vi.fn() } as any;
    const setMutationError = vi.fn();
    const inputDraftsRef = {
      current: {
        'Bench Press_1': { weight: '100', reps: '5' },
        'Bench Press_2': { weight: '102.1', reps: '5' }, // matches 225 lb
      },
    };
    const targetRepCountsRef = { current: { 'Bench Press': 5 } };

    const { result } = renderHook(
      () =>
        useWorkoutSetCommit({
          exercises: dummyExercises,
          inputDraftsRef,
          targetRepCountsRef,
          logSetMutation,
          batchLogSetsMutation,
          setMutationError,
        }),
      { wrapper: createWrapper('kg') }
    );

    act(() => {
      result.current.handleBatchLogExercise(
        'Bench Press',
        2,
        [
          { weight: '', reps: '' },
          { weight: 225, reps: 5 },
        ],
        []
      );
    });

    expect(batchLogSetsMutation.mutate).toHaveBeenCalledWith([
      expect.objectContaining({
        exerciseName: 'Bench Press',
        weight: expect.closeTo(220.462, 2),
        reps: 5,
        setIndex: 1,
      }),
      expect.objectContaining({
        exerciseName: 'Bench Press',
        weight: 225,
        reps: 5,
        setIndex: 2,
      }),
    ]);
  });
});
