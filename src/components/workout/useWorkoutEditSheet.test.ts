import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkoutEditSheet } from './useWorkoutEditSheet';

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

describe('useWorkoutEditSheet', () => {
  const dummySet = {
    id: 's-1',
    exercise_name: 'Bench Press',
    weight: 135,
    reps: 10,
    set_order: 1,
  } as any;

  it('opens sheet with target set on handleEditSet', () => {
    const scheduleDelete = vi.fn();
    const { result } = renderHook(() =>
      useWorkoutEditSheet({
        activeExercises: ['Bench Press'],
        activeRoutineName: 'Chest Day',
        workoutDate: '2026-09-27',
        targetUserId: 'user-1',
        getSetsForExerciseToday: () => [dummySet],
        pendingSetId: null,
        pendingDeletedSetIds: new Set(),
        scheduleDelete,
      })
    );

    expect(result.current.isEditSheetOpen).toBe(false);
    expect(result.current.editingSet).toBeNull();

    act(() => {
      result.current.handleEditSet(0, 0);
    });

    expect(result.current.isEditSheetOpen).toBe(true);
    expect(result.current.editingSet).toEqual({
      ...dummySet,
      workout_date: '2026-09-27',
      workout_name: 'Chest Day',
    });
  });

  it('closes sheet and schedules delete on handleDeleteRequested', () => {
    const scheduleDelete = vi.fn();
    const { result } = renderHook(() =>
      useWorkoutEditSheet({
        activeExercises: ['Bench Press'],
        activeRoutineName: 'Chest Day',
        workoutDate: '2026-09-27',
        targetUserId: 'user-1',
        getSetsForExerciseToday: () => [dummySet],
        pendingSetId: null,
        pendingDeletedSetIds: new Set(),
        scheduleDelete,
      })
    );

    act(() => {
      result.current.handleEditSet(0, 0);
    });

    act(() => {
      result.current.handleDeleteRequested(dummySet);
    });

    expect(result.current.isEditSheetOpen).toBe(false);
    expect(result.current.editingSet).toBeNull();
    expect(scheduleDelete).toHaveBeenCalledWith(dummySet);
  });
});
