import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExerciseRemoval, type RemovedExerciseState } from './useExerciseRemoval';
import type { WorkoutSet } from '../../types/database';

describe('useExerciseRemoval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const mockSet1: WorkoutSet = {
    id: 's1',
    workout_id: 'w1',
    exercise_id: 'Bench Press',
    weight: 185,
    reps: 8,
    set_index: 1,
    created_at: new Date().toISOString(),
    set_type: 'working',
  };

  const defaultProps = {
    onCommitDeleteSets: vi.fn(),
    onRestoreExercise: vi.fn(),
    onRemoveExerciseLocally: vi.fn(),
    onCollapseExercise: vi.fn(),
    getSetsForExercise: vi.fn(),
    activeExercises: ['Bench Press', 'Squat'],
    targetSetCounts: { 'Bench Press': 3, 'Squat': 4 },
    targetRepCounts: { 'Bench Press': 8, 'Squat': 5 },
    inputDrafts: { 'Bench Press_2': { weight: '190', reps: '6' } },
    timeoutMs: 6000,
  };

  it('0 logged sets: removes locally immediately, shows UndoToast, and Undo restores position/drafts with 0 DELETEs', () => {
    const onRestoreExercise = vi.fn();
    const onRemoveExerciseLocally = vi.fn();
    const onCommitDeleteSets = vi.fn();

    const { result } = renderHook(() =>
      useExerciseRemoval({
        ...defaultProps,
        getSetsForExercise: () => [], // 0 logged sets
        onRestoreExercise,
        onRemoveExerciseLocally,
        onCommitDeleteSets,
      })
    );

    // Remove exercise index 0 (Bench Press)
    act(() => {
      result.current.requestRemoveExercise(0);
    });

    // Did NOT open sheet
    expect(result.current.sheetState.isOpen).toBe(false);
    // Removed locally immediately
    expect(onRemoveExerciseLocally).toHaveBeenCalledWith(0);
    // Undo toast is active
    expect(result.current.toast).toBeDefined();
    expect(result.current.toast?.subject).toBe('Bench Press');
    expect(result.current.toast?.detail).toBe('0 sets logged');

    // Trigger Undo
    act(() => {
      result.current.toast?.onUndo?.();
    });

    expect(onRestoreExercise).toHaveBeenCalledTimes(1);
    const restored: RemovedExerciseState = onRestoreExercise.mock.calls[0][0];
    expect(restored.exerciseName).toBe('Bench Press');
    expect(restored.index).toBe(0);
    expect(restored.targetSetCount).toBe(3);
    expect(restored.targetRepCount).toBe(8);
    expect(restored.drafts['Bench Press_2']).toEqual({ weight: '190', reps: '6' });

    // Advance timers - no deletes committed
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onCommitDeleteSets).not.toHaveBeenCalled();
  });

  it('with logged sets: opens RemoveExerciseSheet; "Keep sets, collapse card" collapses without deleting', () => {
    const onCollapseExercise = vi.fn();
    const onRemoveExerciseLocally = vi.fn();

    const { result } = renderHook(() =>
      useExerciseRemoval({
        ...defaultProps,
        getSetsForExercise: () => [mockSet1],
        onCollapseExercise,
        onRemoveExerciseLocally,
      })
    );

    act(() => {
      result.current.requestRemoveExercise(0);
    });

    expect(result.current.sheetState.isOpen).toBe(true);
    expect(result.current.sheetState.exerciseName).toBe('Bench Press');
    expect(result.current.sheetState.loggedSetsCount).toBe(1);
    expect(onRemoveExerciseLocally).not.toHaveBeenCalled();

    // Select "Keep sets, collapse card"
    act(() => {
      result.current.handleKeepSetsAndCollapse();
    });

    expect(result.current.sheetState.isOpen).toBe(false);
    expect(onCollapseExercise).toHaveBeenCalledWith('Bench Press');
    expect(onRemoveExerciseLocally).not.toHaveBeenCalled();
  });

  it('with logged sets: "Remove & delete N logged sets" schedules deferred delete, sends N DELETEs on expiry, 0 on Undo', () => {
    const onRemoveExerciseLocally = vi.fn();
    const onCommitDeleteSets = vi.fn();
    const onRestoreExercise = vi.fn();

    const { result } = renderHook(() =>
      useExerciseRemoval({
        ...defaultProps,
        getSetsForExercise: () => [mockSet1],
        onRemoveExerciseLocally,
        onCommitDeleteSets,
        onRestoreExercise,
      })
    );

    act(() => {
      result.current.requestRemoveExercise(0);
    });

    // Choose Remove & delete
    act(() => {
      result.current.handleConfirmRemoveAndDelete();
    });

    expect(onRemoveExerciseLocally).toHaveBeenCalledWith(0);
    expect(result.current.pendingDeletedSetIds.has('s1')).toBe(true);
    expect(result.current.toast).toBeDefined();
    expect(result.current.toast?.detail).toContain('1 set deleted');

    // 0 DELETEs before expiry
    expect(onCommitDeleteSets).not.toHaveBeenCalled();

    // Advance 6000ms
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    // Exactly N DELETEs committed on expiry
    expect(onCommitDeleteSets).toHaveBeenCalledWith(['s1']);
  });

  it('commit failure restores exercise rows and surfaces error via onError', async () => {
    const onRestoreExercise = vi.fn();
    const onError = vi.fn();
    const onCommitDeleteSets = vi.fn().mockRejectedValue(new Error('Network error on delete'));

    const { result } = renderHook(() =>
      useExerciseRemoval({
        ...defaultProps,
        getSetsForExercise: () => [mockSet1],
        onCommitDeleteSets,
        onRestoreExercise,
        onError,
      })
    );

    act(() => {
      result.current.requestRemoveExercise(0);
    });

    act(() => {
      result.current.handleConfirmRemoveAndDelete();
    });

    // Advance 6000ms to trigger commit
    await act(async () => {
      vi.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    expect(onCommitDeleteSets).toHaveBeenCalledWith(['s1']);
    expect(onRestoreExercise).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      exerciseName: 'Bench Press',
    }));
  });

  it('loggedSetsCount updates dynamically while sheet is open when underlying sets change', () => {
    let sets = [mockSet1];
    const { result, rerender } = renderHook(() =>
      useExerciseRemoval({
        ...defaultProps,
        getSetsForExercise: () => sets,
      })
    );

    // Open sheet when 1 set exists
    act(() => {
      result.current.requestRemoveExercise(0);
    });

    expect(result.current.sheetState.isOpen).toBe(true);
    expect(result.current.sheetState.loggedSetsCount).toBe(1);

    // Second set finishes syncing / arrives while sheet is open
    const mockSet2: WorkoutSet = {
      ...mockSet1,
      id: 's2',
      set_index: 2,
    };
    sets = [mockSet1, mockSet2];
    rerender();

    // loggedSetsCount must immediately reflect 2 sets while open
    expect(result.current.sheetState.loggedSetsCount).toBe(2);
  });
});
