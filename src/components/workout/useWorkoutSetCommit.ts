import { useCallback, type RefObject } from 'react';
import type { Exercise, WorkoutSet, RoutineTemplate } from '../../types/database';
import type { UseMutationResult } from '@tanstack/react-query';
import type { SetDraftInput } from '../../utils/workoutSessionStore';
import { isUUID } from './workoutEngineHelpers';
import { useWeightUnit } from '../../hooks/useWeightUnit';
import { resolveWeightInput, type WeightUnit } from '../../utils/weight';

export interface UseWorkoutSetCommitOptions {
  exercises: Exercise[];
  customTemplates?: RoutineTemplate[];
  inputDraftsRef: RefObject<Record<string, SetDraftInput>>;
  targetRepCountsRef: RefObject<Record<string, number>>;
  logSetMutation: UseMutationResult<any, any, any, any>;
  batchLogSetsMutation: UseMutationResult<any, any, any, any>;
  setMutationError: (err: string | null) => void;
  setExerciseError?: (exerciseName: string, message: string) => void;
  unit?: WeightUnit;
}

export function useWorkoutSetCommit({
  exercises,
  customTemplates,
  inputDraftsRef,
  targetRepCountsRef,
  logSetMutation,
  batchLogSetsMutation,
  setMutationError,
  setExerciseError,
  unit: propUnit,
}: UseWorkoutSetCommitOptions) {
  const contextUnit = useWeightUnit();
  const unit = propUnit ?? contextUnit;

  const handleCommitSet = useCallback((
    exName: string,
    setIndex: number,
    ghostValues: { weight: number | ''; reps: number | '' }
  ) => {
    const draftKey = `${exName}_${setIndex}`;
    const draft = inputDraftsRef.current?.[draftKey];

    const originalLb = typeof ghostValues.weight === 'number' ? ghostValues.weight : null;
    const hasDraftWeight = draft?.weight !== undefined && draft.weight.trim() !== '';
    const weightVal = hasDraftWeight
      ? (resolveWeightInput(draft.weight, unit, originalLb) ?? NaN)
      : typeof ghostValues.weight === 'number'
      ? ghostValues.weight
      : NaN;

    const hasDraftReps = draft?.reps !== undefined && draft.reps.trim() !== '';
    const repsVal = hasDraftReps
      ? Number(draft.reps)
      : typeof ghostValues.reps === 'number'
      ? ghostValues.reps
      : NaN;

    if (!Number.isFinite(weightVal) || weightVal < 0 || !Number.isFinite(repsVal) || repsVal <= 0) {
      if (setExerciseError) {
        setExerciseError(exName, 'Please enter weight and reps or use previous set values.');
      } else {
        setMutationError('Please enter weight and reps or use previous set values.');
      }
      return;
    }

    const norm = exName.trim().toLowerCase();
    const matchedEx = exercises.find(
      (e) => e.name.trim().toLowerCase() === norm || e.id === exName
    );
    let exerciseId = matchedEx ? matchedEx.id : isUUID(exName) ? exName : undefined;
    if (!exerciseId && customTemplates) {
      for (const tpl of customTemplates) {
        for (const item of tpl.exercises || []) {
          const itemName = item.exercise?.name || (item as any).exercise_name;
          if (itemName && itemName.trim().toLowerCase() === norm && isUUID(item.exercise_id)) {
            exerciseId = item.exercise_id;
            break;
          }
        }
        if (exerciseId) break;
      }
    }

    logSetMutation.mutate({
      exerciseName: exName,
      exerciseId,
      weight: weightVal,
      reps: repsVal,
      setIndex,
    });
  }, [exercises, customTemplates, logSetMutation, inputDraftsRef, setMutationError, setExerciseError, unit]);

  const handleBatchLogExercise = useCallback((
    exName: string,
    targetCount: number,
    ghostValues: { weight: number | ''; reps: number | '' }[],
    exerciseSetsToday: WorkoutSet[]
  ) => {
    const unloggedSets: {
      exerciseName: string;
      weight: number;
      reps: number;
      setIndex: number;
    }[] = [];

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

      const repsVal = draft?.reps !== undefined && draft.reps.trim() !== ''
        ? Number(draft.reps)
        : typeof ghost.reps === 'number'
        ? ghost.reps
        : targetRepCountsRef.current?.[exName] || NaN;

      if (!Number.isFinite(weightVal) || weightVal < 0 || !Number.isFinite(repsVal) || repsVal <= 0) continue;

      unloggedSets.push({
        exerciseName: exName,
        weight: weightVal,
        reps: repsVal,
        setIndex,
      });
    }

    if (unloggedSets.length > 0) {
      const norm = exName.trim().toLowerCase();
      const matchedEx = exercises.find(
        (e) => e.name.trim().toLowerCase() === norm || e.id === exName
      );
      let exerciseId = matchedEx ? matchedEx.id : isUUID(exName) ? exName : undefined;
      if (!exerciseId && customTemplates) {
        for (const tpl of customTemplates) {
          for (const item of tpl.exercises || []) {
            const itemName = item.exercise?.name || (item as any).exercise_name;
            if (itemName && itemName.trim().toLowerCase() === norm && isUUID(item.exercise_id)) {
              exerciseId = item.exercise_id;
              break;
            }
          }
          if (exerciseId) break;
        }
      }
      const setsWithId = unloggedSets.map((s) => ({ ...s, exerciseId }));
      batchLogSetsMutation.mutate(setsWithId);
    }
  }, [batchLogSetsMutation, exercises, customTemplates, inputDraftsRef, targetRepCountsRef, unit]);

  return {
    handleCommitSet,
    handleBatchLogExercise,
  };
}
