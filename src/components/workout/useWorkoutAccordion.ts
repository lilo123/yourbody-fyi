import { useCallback } from 'react';
import { workoutSessionStore } from '../../utils/workoutSessionStore';
import type { WorkoutSet } from '../../types/database';

export interface UseWorkoutAccordionOptions {
  targetUserId: string;
  workoutDate: string;
  activeExercises: string[];
  targetSetCounts: Record<string, number>;
  getSetsForExerciseToday: (exName: string) => WorkoutSet[];
  setExpandedExercises: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useWorkoutAccordion({
  targetUserId,
  workoutDate,
  activeExercises,
  targetSetCounts,
  getSetsForExerciseToday,
  setExpandedExercises,
}: UseWorkoutAccordionOptions) {
  const toggleAccordion = useCallback(
    (exName: string) => {
      setExpandedExercises((prev) => {
        const next = new Set(prev);
        if (next.has(exName)) next.delete(exName);
        else next.add(exName);
        workoutSessionStore.setExpandedExercises(targetUserId, workoutDate, Array.from(next));
        return next;
      });
    },
    [targetUserId, workoutDate, setExpandedExercises]
  );

  const collapseExercise = useCallback(
    (exName: string) => {
      setExpandedExercises((prev) => {
        const next = new Set(prev);
        next.delete(exName);
        workoutSessionStore.setExpandedExercises(targetUserId, workoutDate, Array.from(next));
        return next;
      });
    },
    [targetUserId, workoutDate, setExpandedExercises]
  );

  const collapseCompleted = useCallback(() => {
    const next = new Set<string>();
    activeExercises.forEach((exName) => {
      const logged = getSetsForExerciseToday(exName);
      const target = targetSetCounts[exName] || 3;
      if (logged.length < target) {
        next.add(exName);
      }
    });
    workoutSessionStore.setExpandedExercises(targetUserId, workoutDate, Array.from(next));
    setExpandedExercises(next);
  }, [activeExercises, getSetsForExerciseToday, targetSetCounts, targetUserId, workoutDate, setExpandedExercises]);

  const toggleAllAccordions = useCallback(
    (expand: boolean) => {
      const next = expand ? new Set(activeExercises) : new Set<string>();
      workoutSessionStore.setExpandedExercises(targetUserId, workoutDate, Array.from(next));
      setExpandedExercises(next);
    },
    [activeExercises, targetUserId, workoutDate, setExpandedExercises]
  );

  return {
    toggleAccordion,
    collapseExercise,
    collapseCompleted,
    toggleAllAccordions,
  };
}
