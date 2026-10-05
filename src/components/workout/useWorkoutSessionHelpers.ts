import type { Exercise, RoutineTemplate, WorkoutSet } from '../../types/database';
import type { ActiveWorkoutSession, SetDraftInput } from '../../utils/workoutSessionStore';
import { resolveCleanExerciseName } from './workoutEngineHelpers';

export function cleanSessionUUIDs(
  existingSession: ActiveWorkoutSession,
  exercises: Exercise[],
  todaySets: WorkoutSet[]
): ActiveWorkoutSession {
  const cleanedExercises = existingSession.exercises.map((ex) =>
    resolveCleanExerciseName(ex, exercises, todaySets)
  );

  const newTargets: Record<string, number> = {};
  existingSession.exercises.forEach((ex, i) => {
    const clean = cleanedExercises[i];
    newTargets[clean] = existingSession.targetSetCounts[ex] || 3;
  });

  const newReps: Record<string, number> = {};
  existingSession.exercises.forEach((ex, i) => {
    const clean = cleanedExercises[i];
    if (existingSession.targetRepCounts[ex]) {
      newReps[clean] = existingSession.targetRepCounts[ex];
    }
  });

  const newExpanded = existingSession.expandedExercises.map((ex) =>
    resolveCleanExerciseName(ex, exercises, todaySets)
  );

  const newInputDrafts: Record<string, SetDraftInput> = {};
  Object.entries(existingSession.inputDrafts || {}).forEach(([draftKey, draftValue]) => {
    const lastUnderscore = draftKey.lastIndexOf('_');
    if (lastUnderscore > 0) {
      const rawPrefix = draftKey.slice(0, lastUnderscore);
      const setSuffix = draftKey.slice(lastUnderscore + 1);
      const cleanPrefix = resolveCleanExerciseName(rawPrefix, exercises, todaySets);
      newInputDrafts[`${cleanPrefix}_${setSuffix}`] = draftValue;
    } else {
      newInputDrafts[draftKey] = draftValue;
    }
  });

  return {
    ...existingSession,
    exercises: cleanedExercises,
    targetSetCounts: newTargets,
    targetRepCounts: newReps,
    expandedExercises: newExpanded,
    inputDrafts: newInputDrafts,
  };
}

export function findMatchingTemplate<T extends { name: string }>(templates: T[], routineName: string): T | undefined {
  const rNorm = routineName.trim().toLowerCase();
  return templates.find((t) => {
    const tNorm = t.name.trim().toLowerCase();
    return tNorm === rNorm || (rNorm.length > 0 && (tNorm.startsWith(rNorm) || rNorm.startsWith(tNorm)));
  });
}

export function extractTemplateDetails(
  customTpl: RoutineTemplate | undefined,
  defTpl: any | undefined,
  templateExercises: any[] | undefined,
  exercises: Exercise[]
): {
  resolvedExList: string[];
  resolvedTargets: Record<string, number>;
  resolvedReps: Record<string, number>;
} {
  let resolvedExList: string[] = [];
  const resolvedTargets: Record<string, number> = {};
  const resolvedReps: Record<string, number> = {};

  if (customTpl && templateExercises) {
    resolvedExList = [...templateExercises]
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
      .map(
        (e) =>
          e.exercise?.name ||
          e.exercise_name ||
          exercises.find((ex) => ex.id === e.exercise_id)?.name ||
          e.exercise_id
      )
      .filter(Boolean);
    templateExercises.forEach((e) => {
      const name =
        e.exercise?.name ||
        e.exercise_name ||
        exercises.find((ex) => ex.id === e.exercise_id)?.name ||
        e.exercise_id;
      if (name) {
        resolvedTargets[name] = e.target_sets || 3;
        resolvedReps[name] = e.target_reps || 10;
      }
    });
  } else if (defTpl) {
    resolvedExList = [...defTpl.exercises];
    Object.assign(resolvedTargets, defTpl.targetSets);
    if (defTpl.targetReps) {
      Object.assign(resolvedReps, defTpl.targetReps);
    }
  }

  return { resolvedExList, resolvedTargets, resolvedReps };
}

import {
  DEFAULT_EXERCISES_LIST,
  DEFAULT_WORKOUT_TEMPLATES,
  getDayOfWeekAbbr,
} from '../../utils/ghostSets';

export function getInitialRoutineState(
  initialSession: ActiveWorkoutSession | null | undefined,
  workoutDate: string
) {
  const dayAbbr = getDayOfWeekAbbr(workoutDate);
  const defTpl = DEFAULT_WORKOUT_TEMPLATES.find((t) =>
    t.days.some((d) => d === dayAbbr || d.slice(0, 3) === dayAbbr)
  );

  const activeRoutineName = initialSession
    ? initialSession.routineName
    : defTpl ? defTpl.name : 'Rest Day';

  const activeExercises = initialSession
    ? initialSession.exercises
    : defTpl ? [...defTpl.exercises] : [];

  const targetSetCounts = initialSession
    ? initialSession.targetSetCounts
    : defTpl ? { ...defTpl.targetSets } : {};

  const targetRepCounts = initialSession
    ? initialSession.targetRepCounts
    : defTpl?.targetReps ? { ...defTpl.targetReps } : {};

  const expandedExercises = initialSession
    ? new Set(initialSession.expandedExercises)
    : defTpl && defTpl.exercises.length > 0 ? new Set([defTpl.exercises[0]]) : new Set<string>();

  return {
    activeRoutineName,
    activeExercises,
    targetSetCounts,
    targetRepCounts,
    expandedExercises,
  };
}

export function filterSetsForExercise(
  exName: string,
  todaySets: WorkoutSet[],
  exercises: Exercise[]
): WorkoutSet[] {
  const norm = exName.trim().toLowerCase();
  return todaySets.filter((s) => {
    if (s.exercise_id === exName) return true;
    if (s.exercise?.name && s.exercise.name.trim().toLowerCase() === norm) return true;
    if (s.exercise_name && s.exercise_name.trim().toLowerCase() === norm) return true;
    const matchedEx = exercises.find((e) => e.name.toLowerCase() === norm || e.id === exName);
    if (matchedEx && (s.exercise_id === matchedEx.id || s.exercise?.id === matchedEx.id)) return true;
    const defEx = DEFAULT_EXERCISES_LIST.find((e) => e.name.toLowerCase() === norm || e.id === exName);
    if (defEx && (s.exercise_id === defEx.id || s.exercise?.id === defEx.id)) return true;
    return false;
  });
}

export function sanitizeDraftValue(field: 'weight' | 'reps', value: string): string | null {
  let sanitized = value;
  if (field === 'weight') {
    sanitized = sanitized.replace(',', '.');
    if (sanitized !== '' && !/^\d*\.?\d*$/.test(sanitized)) return null;
  } else if (field === 'reps') {
    if (sanitized !== '' && !/^\d*$/.test(sanitized)) return null;
  }
  return sanitized;
}
