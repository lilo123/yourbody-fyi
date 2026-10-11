import { useState, useCallback } from 'react';
import type { WorkoutSet } from '../../types/database';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateWorkoutDerived } from '../../lib/invalidate';

export interface UseWorkoutEditSheetOptions {
  activeExercises: string[];
  activeRoutineName: string;
  workoutDate: string;
  targetUserId: string;
  getSetsForExerciseToday: (exName: string) => WorkoutSet[];
  pendingSetId: string | null;
  pendingDeletedSetIds: Set<string>;
  scheduleDelete: (set: WorkoutSet) => void;
}

export function useWorkoutEditSheet({
  activeExercises,
  activeRoutineName,
  workoutDate,
  targetUserId,
  getSetsForExerciseToday,
  pendingSetId,
  pendingDeletedSetIds,
  scheduleDelete,
}: UseWorkoutEditSheetOptions) {
  const queryClient = useQueryClient();
  const [editingSet, setEditingSet] = useState<(WorkoutSet & { workout_date?: string; workout_name?: string }) | null>(null);
  const [isEditSheetOpen, setIsEditSheetOpen] = useState(false);

  const handleEditSet = useCallback((exIndex: number, rowIdx: number) => {
    const exName = activeExercises[exIndex];
    if (!exName) return;
    const rawSets = getSetsForExerciseToday(exName);
    const visibleSets = rawSets.filter(
      (s) => s.id !== pendingSetId && (!s.id || !pendingDeletedSetIds.has(s.id))
    );
    const targetSet = visibleSets[rowIdx];
    if (targetSet) {
      setEditingSet({
        ...targetSet,
        workout_date: workoutDate,
        workout_name: activeRoutineName,
      });
      setIsEditSheetOpen(true);
    }
  }, [activeExercises, activeRoutineName, getSetsForExerciseToday, pendingSetId, pendingDeletedSetIds, workoutDate]);

  const handleCloseEditSheet = useCallback(() => {
    setIsEditSheetOpen(false);
    setEditingSet(null);
  }, []);

  const handleSavedEditSet = useCallback(async (_updated: WorkoutSet) => {
    setIsEditSheetOpen(false);
    setEditingSet(null);
    await invalidateWorkoutDerived(queryClient, targetUserId);
  }, [queryClient, targetUserId]);

  const handleDeleteRequested = useCallback((set: WorkoutSet) => {
    setIsEditSheetOpen(false);
    setEditingSet(null);
    scheduleDelete(set);
  }, [scheduleDelete]);

  return {
    editingSet,
    isEditSheetOpen,
    handleEditSet,
    handleCloseEditSheet,
    handleSavedEditSet,
    handleDeleteRequested,
  };
}
