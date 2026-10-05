import { useState, useCallback, type RefObject } from 'react';
import type { Exercise, WorkoutSet } from '../../types/database';
import type { UseMutationResult } from '@tanstack/react-query';
import type { SetDraftInput } from '../../utils/workoutSessionStore';
import { computeGhostSets } from '../../utils/ghostSets';
import { isUUID } from './workoutEngineHelpers';
import type { PendingReviewSet } from './FinishReviewSheet';
import { useWeightUnit } from '../../hooks/useWeightUnit';
import { resolveWeightInput, type WeightUnit } from '../../utils/weight';

export interface UseWorkoutFinishReviewOptions {
  activeExercises: string[];
  getSetsForExerciseToday: (exName: string) => WorkoutSet[];
  pendingSetId: string | null;
  pendingDeletedSetIds: Set<string>;
  targetSetCounts: Record<string, number>;
  targetRepCountsRef: RefObject<Record<string, number>>;
  inputDraftsRef: RefObject<Record<string, SetDraftInput>>;
  userLogs: WorkoutSet[];
  workoutDate: string;
  exercises: Exercise[];
  batchLogSetsMutation: UseMutationResult<any, any, any, any>;
  unit?: WeightUnit;
}

export function useWorkoutFinishReview({
  activeExercises,
  getSetsForExerciseToday,
  pendingSetId,
  pendingDeletedSetIds,
  targetSetCounts,
  targetRepCountsRef,
  inputDraftsRef,
  userLogs,
  workoutDate,
  exercises,
  batchLogSetsMutation,
  unit: propUnit,
}: UseWorkoutFinishReviewOptions) {
  const contextUnit = useWeightUnit();
  const unit = propUnit ?? contextUnit;
  const [isFinishReviewOpen, setIsFinishReviewOpen] = useState(false);
  const [pendingReviewSets, setPendingReviewSets] = useState<PendingReviewSet[]>([]);

  const handleFinishWorkout = useCallback(() => {
    const allPendingSets: PendingReviewSet[] = [];

    for (const exName of activeExercises) {
      const rawSets = getSetsForExerciseToday(exName);
      const exerciseSetsToday = rawSets.filter(
        (s) => s.id !== pendingSetId && (!s.id || !pendingDeletedSetIds.has(s.id))
      );
      const targetCount = targetSetCounts[exName] || 3;
      const ghostValues = computeGhostSets(exName, targetCount, userLogs, workoutDate, unit);

      for (let rowIdx = exerciseSetsToday.length; rowIdx < targetCount; rowIdx++) {
        const setIndex = rowIdx + 1;
        const ghost = ghostValues[rowIdx] || { weight: '', reps: '' };
        const draftKey = `${exName}_${setIndex}`;
        const draft = inputDraftsRef.current?.[draftKey];

        const originalLb = typeof ghost.weight === 'number' ? ghost.weight : null;
        const hasDraftWeight = draft?.weight !== undefined && draft.weight.trim() !== '';
        const weightVal = hasDraftWeight
          ? (resolveWeightInput(draft.weight, unit, originalLb) ?? NaN)
          : typeof ghost.weight === 'number'
          ? ghost.weight
          : NaN;

        const repsVal =
          draft?.reps !== undefined && draft.reps.trim() !== ''
            ? Number(draft.reps)
            : typeof ghost.reps === 'number'
            ? ghost.reps
            : targetRepCountsRef.current?.[exName] || NaN;

        if (!Number.isFinite(weightVal) || weightVal < 0 || !Number.isFinite(repsVal) || repsVal <= 0) continue;

        allPendingSets.push({
          exerciseName: exName,
          weight: weightVal,
          reps: repsVal,
          setIndex,
        });
      }
    }

    if (allPendingSets.length === 0) {
      return;
    }

    setPendingReviewSets(allPendingSets);
    setIsFinishReviewOpen(true);
  }, [
    activeExercises,
    getSetsForExerciseToday,
    pendingSetId,
    pendingDeletedSetIds,
    targetSetCounts,
    targetRepCountsRef,
    inputDraftsRef,
    userLogs,
    workoutDate,
    unit,
  ]);

  const handleConfirmFinishWithSets = useCallback(
    async (reviewedSets: PendingReviewSet[]) => {
      if (batchLogSetsMutation.isPending) return;
      if (reviewedSets.length === 0) {
        setIsFinishReviewOpen(false);
        return;
      }
      const validSets = reviewedSets.filter(
        (s) => Number.isFinite(s.weight) && s.weight >= 0 && Number.isFinite(s.reps) && s.reps > 0
      );
      if (validSets.length === 0) return;

      const setsWithIds = validSets.map((s) => {
        const matchedEx = exercises.find(
          (e) => e.name.toLowerCase() === s.exerciseName.toLowerCase() || e.id === s.exerciseName
        );
        const exerciseId = matchedEx ? matchedEx.id : isUUID(s.exerciseName) ? s.exerciseName : undefined;
        return { ...s, exerciseId };
      });
      try {
        await batchLogSetsMutation.mutateAsync(setsWithIds);
        setIsFinishReviewOpen(false);
      } catch {
        // Keep the sheet open on error so the user does not lose edited values or drafts
      }
    },
    [batchLogSetsMutation, exercises]
  );

  const handleFinishWithoutSets = useCallback(() => {
    setIsFinishReviewOpen(false);
  }, []);

  return {
    isFinishReviewOpen,
    setIsFinishReviewOpen,
    pendingReviewSets,
    handleFinishWorkout,
    handleConfirmFinishWithSets,
    handleFinishWithoutSets,
  };
}
