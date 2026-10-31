import type { WorkoutSet, Exercise, RoutineTemplate } from '../../types/database';
import {
  getDayOfWeekAbbr,
  getLocalDateStr,
  DEFAULT_EXERCISES_LIST,
  DEFAULT_WORKOUT_TEMPLATES,
} from '../../utils/ghostSets';

import { UUID_REGEX, isValidUUID, isUUID } from '../../utils/uuid';
export { UUID_REGEX, isValidUUID, isUUID };

export function resolveCleanExerciseName(
  rawVal: string,
  exerciseCatalog: Exercise[],
  todaySets: WorkoutSet[] = []
): string {
  if (!isUUID(rawVal) && rawVal.trim().length > 0) {
    return rawVal;
  }
  // Tier 1: DB Exercise Catalog
  const match = exerciseCatalog.find(
    (e) => e.id === rawVal || e.name.toLowerCase() === rawVal.toLowerCase()
  );
  if (match) return match.name;

  // Tier 2: Default Synthetic Exercises Catalog
  const defaultMatch = DEFAULT_EXERCISES_LIST.find(
    (e) => e.id === rawVal || e.name.toLowerCase() === rawVal.toLowerCase()
  );
  if (defaultMatch) return defaultMatch.name;

  // Tier 3: Today's Joined Sets (prioritize set with joined exercise object, then set with clean exercise_name)
  const setWithExercise = todaySets.find(
    (s) => (s.exercise_id === rawVal || s.exercise?.id === rawVal) && Boolean(s.exercise?.name)
  );
  if (setWithExercise?.exercise?.name) return setWithExercise.exercise.name;

  const setWithName = todaySets.find(
    (s) =>
      (s.exercise_id === rawVal || s.exercise?.id === rawVal) &&
      Boolean(s.exercise_name && !isUUID(s.exercise_name))
  );
  if (setWithName?.exercise_name) return setWithName.exercise_name;

  return rawVal;
}

export interface ResolvedRoutineResult {
  routineName: string;
  exercises: string[];
  targetSets: Record<string, number>;
  targetReps: Record<string, number>;
}

export function resolveRoutineAndExercises(
  workoutDate: string,
  todaySets: WorkoutSet[],
  customTemplates: RoutineTemplate[],
  exerciseCatalog: Exercise[],
  removedExercises: string[] = []
): ResolvedRoutineResult {
  let resolvedRoutine = 'Rest Day';
  let resolvedExList: string[] = [];
  let resolvedTargets: Record<string, number> = {};
  let resolvedReps: Record<string, number> = {};

  if (todaySets.length > 0) {
    const isSetForExercise = (s: WorkoutSet, exName: string) => {
      const norm = exName.trim().toLowerCase();
      return (
        (s.exercise?.name && s.exercise.name.trim().toLowerCase() === norm) ||
        (s.exercise_name && s.exercise_name.trim().toLowerCase() === norm) ||
        s.exercise_id === exName ||
        (exerciseCatalog.find((ex) => ex.id === s.exercise_id)?.name.trim().toLowerCase() === norm) ||
        (DEFAULT_EXERCISES_LIST.find((ex) => ex.id === s.exercise_id)?.name.trim().toLowerCase() === norm)
      );
    };

    const loggedRoutineName =
      todaySets[0].workout_name || (todaySets[0] as any)?.workouts?.name || '';
    const normLoggedName = loggedRoutineName.trim().toLowerCase();
    const matchedCustom = customTemplates.find((t) => {
      const tNorm = t.name.trim().toLowerCase();
      return (
        tNorm === normLoggedName ||
        (normLoggedName.length > 0 &&
          (tNorm.startsWith(normLoggedName) || normLoggedName.startsWith(tNorm)))
      );
    });
    const matchedDef = DEFAULT_WORKOUT_TEMPLATES.find((t) => {
      const tNorm = t.name.trim().toLowerCase();
      return (
        tNorm === normLoggedName ||
        (normLoggedName.length > 0 &&
          (tNorm.startsWith(normLoggedName) || normLoggedName.startsWith(tNorm)))
      );
    });

    let baseExercises: string[] = [];
    const setTargets: Record<string, number> = {};
    let repTargets: Record<string, number> = {};

    if (matchedCustom && matchedCustom.exercises) {
      resolvedRoutine = matchedCustom.name;
      const sortedExercises = [...(matchedCustom.exercises || [])].sort(
        (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)
      );
      sortedExercises.forEach((e) => {
        const resolvedName =
          e.exercise?.name ||
          e.exercise_name ||
          exerciseCatalog.find((ex) => ex.id === e.exercise_id)?.name ||
          DEFAULT_EXERCISES_LIST.find((ex) => ex.id === e.exercise_id)?.name ||
          e.exercise_id;
        if (resolvedName) {
          baseExercises.push(resolvedName);
          setTargets[resolvedName] = e.target_sets || 3;
          repTargets[resolvedName] = e.target_reps || 10;
        }
      });
    } else if (matchedDef) {
      resolvedRoutine = matchedDef.name;
      baseExercises = [...matchedDef.exercises];
      Object.assign(setTargets, matchedDef.targetSets);
      repTargets = matchedDef.targetReps ? { ...matchedDef.targetReps } : {};
    } else {
      resolvedRoutine = loggedRoutineName || 'Logged Workout';
      baseExercises = Array.from(
        new Set(
          todaySets
            .map(
              (s) =>
                s.exercise?.name ||
                exerciseCatalog.find((ex) => ex.id === s.exercise_id)?.name ||
                DEFAULT_EXERCISES_LIST.find((ex) => ex.id === s.exercise_id)?.name ||
                s.exercise_name ||
                s.exercise_id
            )
            .filter(Boolean)
        )
      );

      baseExercises.forEach((exName) => {
        const exSets = todaySets.filter((s) => isSetForExercise(s, exName));
        const maxIdx = Math.max(
          ...exSets.map((s) => s.set_index || 0),
          exSets.length,
          3
        );
        setTargets[exName] = maxIdx;
      });
    }

    // Merge logged exercises not in base template
    const loggedExercises = Array.from(
      new Set(
        todaySets
          .map(
            (s) =>
              s.exercise?.name ||
              exerciseCatalog.find((ex) => ex.id === s.exercise_id)?.name ||
              DEFAULT_EXERCISES_LIST.find((ex) => ex.id === s.exercise_id)?.name ||
              s.exercise_name ||
              s.exercise_id
          )
          .filter(Boolean)
      )
    );
    const distinctLoggedNotInBase = loggedExercises.filter((name) => !baseExercises.includes(name));

    const isToday = workoutDate === getLocalDateStr(new Date());
    let effectiveBase = baseExercises;
    if (!isToday && todaySets.length > 0) {
      // For past dates / finished workouts, only include exercises that were actually performed
      effectiveBase = baseExercises.filter((name) => todaySets.some((s) => isSetForExercise(s, name)));
    }

    resolvedExList = [...effectiveBase, ...distinctLoggedNotInBase].filter(
      (name) => !removedExercises.includes(name)
    );
    resolvedTargets = setTargets;
    resolvedReps = repTargets;

    resolvedExList.forEach((exName) => {
      const loggedSetsForEx = todaySets.filter((s) => isSetForExercise(s, exName));
      const currentTarget = resolvedTargets[exName] || 3;
      resolvedTargets[exName] = Math.max(currentTarget, loggedSetsForEx.length);
    });
  } else {
    const dayAbbr = getDayOfWeekAbbr(workoutDate);
    const scheduledCustom = customTemplates.find((t) => t.days_of_week?.includes(dayAbbr));
    const scheduledDef = DEFAULT_WORKOUT_TEMPLATES.find((t) =>
      t.days.some((d) => d === dayAbbr || d.slice(0, 3) === dayAbbr)
    );

    if (scheduledCustom && scheduledCustom.exercises) {
      resolvedRoutine = scheduledCustom.name;
      const sorted = [...scheduledCustom.exercises].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
      sorted.forEach((e) => {
        const name =
          e.exercise?.name ||
          e.exercise_name ||
          exerciseCatalog.find((ex) => ex.id === e.exercise_id)?.name ||
          DEFAULT_EXERCISES_LIST.find((ex) => ex.id === e.exercise_id)?.name ||
          e.exercise_id;
        if (name) {
          resolvedExList.push(name);
          resolvedTargets[name] = e.target_sets || 3;
          resolvedReps[name] = e.target_reps || 10;
        }
      });
    } else if (scheduledDef) {
      resolvedRoutine = scheduledDef.name;
      resolvedExList = [...scheduledDef.exercises];
      resolvedTargets = { ...scheduledDef.targetSets };
      resolvedReps = scheduledDef.targetReps ? { ...scheduledDef.targetReps } : {};
    }
  }

  return {
    routineName: resolvedRoutine,
    exercises: resolvedExList,
    targetSets: resolvedTargets,
    targetReps: resolvedReps,
  };
}

export function checkIsScheduledRoutineDirty({
  workoutDate,
  activeRoutineName,
  activeExercises,
  customTemplates,
  exercises,
  inputDrafts,
  targetSetCounts,
  targetRepCounts,
}: {
  workoutDate: string;
  activeRoutineName: string;
  activeExercises: string[];
  customTemplates: RoutineTemplate[];
  exercises: Exercise[];
  inputDrafts: Record<string, any>;
  targetSetCounts?: Record<string, number>;
  targetRepCounts?: Record<string, number>;
}): boolean {
  const dayAbbr = getDayOfWeekAbbr(workoutDate);
  const scheduledCustom = customTemplates.find((t) => t.days_of_week?.includes(dayAbbr));
  const scheduledDef = DEFAULT_WORKOUT_TEMPLATES.find((t) =>
    t.days.some((d) => d === dayAbbr || d.slice(0, 3) === dayAbbr)
  );
  const scheduledName = scheduledCustom?.name || scheduledDef?.name || 'Rest Day';
  if (activeRoutineName !== scheduledName) return true;

  const hasDrafts = Object.values(inputDrafts).some(
    (d: any) => (d.weight && d.weight.trim() !== '') || (d.reps && d.reps.trim() !== '')
  );
  if (hasDrafts) return true;

  let scheduledExercises: string[] = [];
  const scheduledTargetSets: Record<string, number> = {};
  const scheduledTargetReps: Record<string, number> = {};

  if (scheduledCustom && scheduledCustom.exercises) {
    const sorted = [...scheduledCustom.exercises].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    scheduledExercises = sorted
      .map((e) => {
        const name = e.exercise?.name || e.exercise_name || exercises.find((ex) => ex.id === e.exercise_id)?.name || e.exercise_id;
        if (name) {
          scheduledTargetSets[name] = e.target_sets || 3;
          if (e.target_reps) scheduledTargetReps[name] = e.target_reps;
        }
        return name;
      })
      .filter(Boolean);
  } else if (scheduledDef) {
    scheduledExercises = [...scheduledDef.exercises];
    Object.assign(scheduledTargetSets, scheduledDef.targetSets);
    if (scheduledDef.targetReps) Object.assign(scheduledTargetReps, scheduledDef.targetReps);
  }

  if (activeExercises.length !== scheduledExercises.length) return true;
  for (let i = 0; i < activeExercises.length; i++) {
    if (activeExercises[i] !== scheduledExercises[i]) return true;
  }

  if (targetSetCounts) {
    for (const exName of activeExercises) {
      const scheduledTarget = scheduledTargetSets[exName] ?? 3;
      if (targetSetCounts[exName] !== undefined && targetSetCounts[exName] !== scheduledTarget) {
        return true;
      }
    }
  }

  if (targetRepCounts) {
    for (const exName of activeExercises) {
      if (scheduledTargetReps[exName] !== undefined && targetRepCounts[exName] !== undefined && targetRepCounts[exName] !== scheduledTargetReps[exName]) {
        return true;
      }
    }
  }

  return false;
}
