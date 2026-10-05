import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkoutFinishReview } from './useWorkoutFinishReview';
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

describe('useWorkoutFinishReview', () => {
  const dummyExercises = [
    { id: 'ex-1', name: 'Bench Press', category: 'Chest' },
    { id: 'ex-2', name: 'Squat', category: 'Legs' },
  ] as any;

  it('opens sheet when pending sets exist with ghost or draft values', () => {
    const inputDraftsRef = {
      current: {
        'Bench Press_1': { weight: '135', reps: '10' },
      },
    };
    const targetRepCountsRef = { current: { 'Bench Press': 10 } };
    const batchLogSetsMutation = { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue([]), isPending: false } as any;

    const { result } = renderHook(
      () =>
        useWorkoutFinishReview({
          activeExercises: ['Bench Press'],
          getSetsForExerciseToday: () => [],
          pendingSetId: null,
          pendingDeletedSetIds: new Set(),
          targetSetCounts: { 'Bench Press': 1 },
          targetRepCountsRef,
          inputDraftsRef,
          userLogs: [],
          workoutDate: '2026-09-27',
          exercises: dummyExercises,
          batchLogSetsMutation,
        }),
      { wrapper: createWrapper('lb') }
    );

    expect(result.current.isFinishReviewOpen).toBe(false);

    act(() => {
      result.current.handleFinishWorkout();
    });

    expect(result.current.isFinishReviewOpen).toBe(true);
    expect(result.current.pendingReviewSets).toHaveLength(1);
    expect(result.current.pendingReviewSets[0]).toEqual({
      exerciseName: 'Bench Press',
      weight: 135,
      reps: 10,
      setIndex: 1,
    });
  });

  it('does not open sheet if all pending sets have no valid values', () => {
    const inputDraftsRef = { current: {} };
    const targetRepCountsRef = { current: {} };
    const batchLogSetsMutation = { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue([]), isPending: false } as any;

    const { result } = renderHook(
      () =>
        useWorkoutFinishReview({
          activeExercises: ['Bench Press'],
          getSetsForExerciseToday: () => [],
          pendingSetId: null,
          pendingDeletedSetIds: new Set(),
          targetSetCounts: { 'Bench Press': 1 },
          targetRepCountsRef,
          inputDraftsRef,
          userLogs: [], // no previous logs = no ghost sets
          workoutDate: '2026-09-27',
          exercises: dummyExercises,
          batchLogSetsMutation,
        }),
      { wrapper: createWrapper('lb') }
    );

    act(() => {
      result.current.handleFinishWorkout();
    });

    expect(result.current.isFinishReviewOpen).toBe(false);
  });

  it('calls batchLogSetsMutation with mapped exerciseId when confirmed', () => {
    const inputDraftsRef = { current: {} };
    const targetRepCountsRef = { current: {} };
    const batchLogSetsMutation = { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue([]), isPending: false } as any;

    const { result } = renderHook(
      () =>
        useWorkoutFinishReview({
          activeExercises: ['Bench Press'],
          getSetsForExerciseToday: () => [],
          pendingSetId: null,
          pendingDeletedSetIds: new Set(),
          targetSetCounts: {},
          targetRepCountsRef,
          inputDraftsRef,
          userLogs: [],
          workoutDate: '2026-09-27',
          exercises: dummyExercises,
          batchLogSetsMutation,
        }),
      { wrapper: createWrapper('lb') }
    );

    act(() => {
      result.current.handleConfirmFinishWithSets([
        { exerciseName: 'Bench Press', weight: 200, reps: 5, setIndex: 1 },
      ]);
    });

    expect(batchLogSetsMutation.mutateAsync).toHaveBeenCalledWith([
      { exerciseName: 'Bench Press', exerciseId: 'ex-1', weight: 200, reps: 5, setIndex: 1 },
    ]);
  });

  it('keeps sheet open on error and prevents double-submit while isPending', async () => {
    const inputDraftsRef = { current: {} };
    const targetRepCountsRef = { current: {} };
    const batchLogSetsMutation = {
      mutateAsync: vi.fn().mockRejectedValue(new Error('Server error')),
      isPending: false,
    } as any;

    const { result } = renderHook(
      () =>
        useWorkoutFinishReview({
          activeExercises: ['Bench Press'],
          getSetsForExerciseToday: () => [],
          pendingSetId: null,
          pendingDeletedSetIds: new Set(),
          targetSetCounts: {},
          targetRepCountsRef,
          inputDraftsRef,
          userLogs: [],
          workoutDate: '2026-09-27',
          exercises: dummyExercises,
          batchLogSetsMutation,
        }),
      { wrapper: createWrapper('lb') }
    );

    act(() => {
      result.current.setIsFinishReviewOpen(true);
    });
    expect(result.current.isFinishReviewOpen).toBe(true);

    await act(async () => {
      await result.current.handleConfirmFinishWithSets([
        { exerciseName: 'Bench Press', weight: 200, reps: 5, setIndex: 1 },
      ]);
    });

    // Sheet remains open on error
    expect(result.current.isFinishReviewOpen).toBe(true);

    // Double submit guard: when mutation isPending, calls are ignored
    batchLogSetsMutation.isPending = true;
    batchLogSetsMutation.mutateAsync.mockClear();

    await act(async () => {
      await result.current.handleConfirmFinishWithSets([
        { exerciseName: 'Bench Press', weight: 200, reps: 5, setIndex: 1 },
      ]);
    });

    expect(batchLogSetsMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('converts kg draft values to canonical lb and preserves unedited ghost weights', () => {
    const inputDraftsRef = {
      current: {
        'Bench Press_1': { weight: '100', reps: '5' },
        'Bench Press_2': { weight: '102.1', reps: '5' }, // 225 lb
      },
    };
    const targetRepCountsRef = { current: { 'Bench Press': 5 } };
    const batchLogSetsMutation = { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue([]), isPending: false } as any;

    // Previous log with 225 lb
    const previousLogs = [
      {
        id: 'set-prev',
        workout_id: 'w-prev',
        exercise_name: 'Bench Press',
        exercise_id: 'ex-1',
        weight: 225,
        reps: 5,
        set_index: 2,
        workout_date: '2026-09-20',
      },
    ] as any;

    const { result } = renderHook(
      () =>
        useWorkoutFinishReview({
          activeExercises: ['Bench Press'],
          getSetsForExerciseToday: () => [],
          pendingSetId: null,
          pendingDeletedSetIds: new Set(),
          targetSetCounts: { 'Bench Press': 2 },
          targetRepCountsRef,
          inputDraftsRef,
          userLogs: previousLogs,
          workoutDate: '2026-09-27',
          exercises: dummyExercises,
          batchLogSetsMutation,
        }),
      { wrapper: createWrapper('kg') }
    );

    act(() => {
      result.current.handleFinishWorkout();
    });

    expect(result.current.isFinishReviewOpen).toBe(true);
    expect(result.current.pendingReviewSets).toHaveLength(2);
    // Set 1: draft was 100 kg -> ~220.462 lb
    expect(result.current.pendingReviewSets[0].weight).toBeCloseTo(220.462, 2);
    // Set 2: draft was 102.1 kg, matching original 225 lb -> exact 225 lb preserved
    expect(result.current.pendingReviewSets[1].weight).toBe(225);
  });
});
