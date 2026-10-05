import { comparePrSets, pickPrSet, e1rm, type PrMode } from '../lib/prComparator';
import { formatSet, formatWeight, type WeightUnit } from './weight';
import type { WorkoutSet, GhostSetValues, ExerciseBenchmarks } from '../types/database';
import {
  normalizeDateStr,
  getLocalDateStr,
  getDayOfWeekAbbr,
  formatShortDate,
  formatLocalTimestamp,
} from './date';

export {
  normalizeDateStr,
  getLocalDateStr,
  getDayOfWeekAbbr,
  formatShortDate,
  formatLocalTimestamp,
};


function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export function computeGhostSets(
  exerciseId: string,
  targetSetCount: number,
  allSets: (WorkoutSet & { workout_date?: string; date?: string })[],
  currentDateStr?: string,
  unit: WeightUnit = 'lb'
): GhostSetValues[] {
  const normCurrentDate = currentDateStr ? normalizeDateStr(currentDateStr) : '';

  // Filter sets for this exercise occurring before or on previous dates (excluding today's active session if specified)
  const pastSets = allSets.filter((s) => {
    if (isUuid(exerciseId) && s.exercise_id) {
      if (s.exercise_id !== exerciseId) return false;
    } else {
      const matchesId = s.exercise_id === exerciseId;
      const matchesName = Boolean(s.exercise_name && s.exercise_name.toLowerCase() === exerciseId.toLowerCase());
      if (!matchesId && !matchesName) return false;
    }
    if (s.weight == null || s.reps == null || isNaN(Number(s.weight)) || isNaN(Number(s.reps))) return false;
    const setDate = normalizeDateStr(s.workout_date || s.date || s.created_at);
    if (!setDate) return false;
    if (normCurrentDate && setDate >= normCurrentDate) return false;
    return true;
  });

  if (pastSets.length === 0) {
    return Array.from({ length: targetSetCount }, () => ({
      weight: '',
      reps: '',
      hintText: '—',
      isFromPrevious: false,
    }));
  }

  // Sort dates descending to find most recent session
  const dates = Array.from(
    new Set(pastSets.map((s) => normalizeDateStr(s.workout_date || s.date || s.created_at)))
  ).sort((a, b) => b.localeCompare(a));

  const mostRecentDate = dates[0];
  const sessionSets = pastSets
    .filter((s) => normalizeDateStr(s.workout_date || s.date || s.created_at) === mostRecentDate)
    .sort((a, b) => (a.set_index || 0) - (b.set_index || 0));

  // Working sets only (RD-9, W6: warm-up and drop sets hidden and excluded)
  const candidateSets = sessionSets.filter((s) => s.set_type === 'working' || !s.set_type);

  const results: GhostSetValues[] = [];

  for (let i = 0; i < targetSetCount; i++) {
    if (i < candidateSets.length) {
      const prev = candidateSets[i];
      results.push({
        weight: prev.weight,
        reps: prev.reps,
        hintText: `${formatWeight(prev.weight, unit, { showUnit: true })} × ${prev.reps}`,
        isFromPrevious: true,
      });
    } else if (candidateSets.length > 0) {
      // Set expansion: inherit the last available set's values
      const lastAvailable = candidateSets[candidateSets.length - 1];
      results.push({
        weight: lastAvailable.weight,
        reps: lastAvailable.reps,
        hintText: `${formatWeight(lastAvailable.weight, unit, { showUnit: true })} × ${lastAvailable.reps}`,
        isFromPrevious: true,
      });
    } else {
      results.push({
        weight: '',
        reps: '',
        hintText: '—',
        isFromPrevious: false,
      });
    }
  }

  return results;
}

export function getExerciseBenchmarks(
  exerciseId: string,
  allSets: (WorkoutSet & { workout_date?: string; date?: string })[],
  currentDateStr?: string,
  unit: WeightUnit = 'lb',
  mode: PrMode = 'weight'
): ExerciseBenchmarks {
  const resolvedMode: PrMode = mode;
  const normCurrentDate = currentDateStr ? normalizeDateStr(currentDateStr) : '';

  const validSets = allSets.filter((s) => {
    if (isUuid(exerciseId) && s.exercise_id) {
      if (s.exercise_id !== exerciseId) return false;
    } else {
      const matchesId = s.exercise_id === exerciseId;
      const matchesName = Boolean(s.exercise_name && s.exercise_name.toLowerCase() === exerciseId.toLowerCase());
      if (!matchesId && !matchesName) return false;
    }
    if (s.weight == null || s.reps == null) return false;
    // Working sets only (RD-9, W6)
    const type = s.set_type ? s.set_type.toLowerCase() : 'working';
    if (type === 'warmup' || type === 'drop') return false;
    return true;
  });

  // Strict session boundary: prior sessions only (excluding today)
  const priorSets = validSets.filter((s) => {
    const setDate = normalizeDateStr(s.workout_date || s.date || s.created_at);
    if (!setDate) return false;
    if (normCurrentDate && setDate >= normCurrentDate) return false;
    return true;
  });

  // All historical sets up to and including today for PR calculation
  const allTimeSets = validSets.filter((s) => {
    const setDate = normalizeDateStr(s.workout_date || s.date || s.created_at);
    if (!setDate) return false;
    if (normCurrentDate && setDate > normCurrentDate) return false;
    return true;
  });

  // Find last session from priorSets
  const dates = Array.from(
    new Set(priorSets.map((s) => normalizeDateStr(s.workout_date || s.date || s.created_at)).filter(Boolean))
  ).sort((a, b) => b.localeCompare(a));

  let lastSession: ExerciseBenchmarks['lastSession'] = null;
  if (dates.length > 0) {
    const lastDate = dates[0];
    const sessionSets = priorSets
      .filter((s) => normalizeDateStr(s.workout_date || s.date || s.created_at) === lastDate)
      .sort((a, b) => (a.set_index || 0) - (b.set_index || 0));

    const summaryText = sessionSets.map((s) => formatSet(s.weight, s.reps, unit)).join(', ');
    lastSession = {
      date: lastDate,
      summaryText,
      sets: sessionSets,
    };
  }

  // Compute PR from allTimeSets using shared comparator
  const bestSet = pickPrSet(allTimeSets, resolvedMode);

  const pr = bestSet
    ? {
        weight: Number(bestSet.weight),
        reps: Number(bestSet.reps),
        date: normalizeDateStr(bestSet.workout_date || bestSet.date || bestSet.created_at),
        ...(resolvedMode === 'e1rm' ? { e1rm: e1rm(Number(bestSet.weight), Number(bestSet.reps)) } : {}),
      }
    : null;

  return { lastSession, pr };
}

export { DEFAULT_EXERCISES_LIST } from './exerciseCatalog';

export interface WorkoutTemplateDefinition {
  name: string;
  days: string[];
  exercises: string[];
  targetSets: Record<string, number>;
  targetReps?: Record<string, number>;
}

export const DEFAULT_WORKOUT_TEMPLATES: WorkoutTemplateDefinition[] = [
  {
    name: 'Push, Quads, & Core - Reduced',
    days: ['Mon', 'Thu'],
    exercises: [
      'Incline Bench Press',
      'Cable Lateral Raises',
      'Dips',
      'Leg Extension Machine',
      'Overhead Tricep Cable Pull',
    ],
    targetSets: {
      'Incline Bench Press': 4,
      'Cable Lateral Raises': 3,
      'Dips': 3,
      'Leg Extension Machine': 3,
      'Overhead Tricep Cable Pull': 3,
    },
    targetReps: {
      'Incline Bench Press': 8,
      'Cable Lateral Raises': 12,
      'Dips': 10,
      'Leg Extension Machine': 12,
      'Overhead Tricep Cable Pull': 12,
    },
  },
  {
    name: 'Pull, Hamstring, & Core - Reduced',
    days: ['Tue', 'Fri'],
    exercises: [
      'Lat Pull Down',
      'Seated Cable Row',
      'Inclined Bicep Curl',
      'Leg Curl',
      'Face Pulls',
    ],
    targetSets: {
      'Lat Pull Down': 4,
      'Seated Cable Row': 3,
      'Inclined Bicep Curl': 3,
      'Leg Curl': 3,
      'Face Pulls': 3,
    },
    targetReps: {
      'Lat Pull Down': 10,
      'Seated Cable Row': 10,
      'Inclined Bicep Curl': 12,
      'Leg Curl': 12,
      'Face Pulls': 15,
    },
  },
  {
    name: 'Workout A (Push, Quads & Core)',
    days: [],
    exercises: [
      'Incline Bench Press',
      'Cable Lateral Raises',
      'Dips',
      'Leg Extension Machine',
      'Overhead Tricep Cable Pull',
      'Leg Raise',
    ],
    targetSets: {
      'Incline Bench Press': 4,
      'Cable Lateral Raises': 3,
      'Dips': 3,
      'Leg Extension Machine': 3,
      'Overhead Tricep Cable Pull': 3,
      'Leg Raise': 3,
    },
    targetReps: {
      'Incline Bench Press': 8,
      'Cable Lateral Raises': 12,
      'Dips': 10,
      'Leg Extension Machine': 12,
      'Overhead Tricep Cable Pull': 12,
      'Leg Raise': 15,
    },
  },
  {
    name: 'Workout B (Pull, Hamstrings & Core)',
    days: [],
    exercises: [
      'Lat Pull Down',
      'Seated Cable Row',
      'Inclined Bicep Curl',
      'Leg Curl',
      'Face Pulls',
      'Weighted Sit-Up',
    ],
    targetSets: {
      'Lat Pull Down': 4,
      'Seated Cable Row': 3,
      'Inclined Bicep Curl': 3,
      'Leg Curl': 3,
      'Face Pulls': 3,
      'Weighted Sit-Up': 3,
    },
    targetReps: {
      'Lat Pull Down': 10,
      'Seated Cable Row': 10,
      'Inclined Bicep Curl': 12,
      'Leg Curl': 12,
      'Face Pulls': 15,
      'Weighted Sit-Up': 15,
    },
  },
];

/**
 * Merges server benchmarks with today's committed working sets in real-time (W1, RD-4, RD-9).
 * Working sets only: warm-up and drop sets are strictly excluded.
 * Ties broken by: higher weight, then higher reps, then earliest date (RD-4).
 */
export function mergeBenchmarks(
  benchmarks: Record<string, ExerciseBenchmarks>,
  todaySets: Array<WorkoutSet & { workout_date?: string; date?: string }>,
  mode: PrMode = 'weight'
): Record<string, ExerciseBenchmarks> {
  const resolvedMode: PrMode = mode;
  const result: Record<string, ExerciseBenchmarks> = {};

  // Clone existing benchmarks
  for (const [key, bm] of Object.entries(benchmarks)) {
    result[key] = {
      lastSession: bm.lastSession ? { ...bm.lastSession, sets: [...(bm.lastSession.sets || [])] } : null,
      pr: bm.pr ? { ...bm.pr } : null,
    };
  }

  // Filter today's sets to working sets only
  const workingTodaySets = (todaySets || []).filter((s) => {
    if (s.weight == null || s.reps == null || isNaN(Number(s.weight)) || isNaN(Number(s.reps))) return false;
    const type = s.set_type ? s.set_type.toLowerCase() : 'working';
    return type !== 'warmup' && type !== 'drop';
  });

  for (const s of workingTodaySets) {
    const exId = s.exercise_id;
    if (!exId) continue;

    const weight = Number(s.weight);
    const reps = Number(s.reps);
    const setDate = normalizeDateStr(s.workout_date || s.date || s.created_at);

    if (!result[exId]) {
      result[exId] = {
        lastSession: null,
        pr: null,
      };
    }

    const currentPR = result[exId].pr;
    const candidatePR = {
      id: s.id,
      weight,
      reps,
      date: setDate,
      created_at: s.created_at,
      set_index: s.set_index,
    };

    if (!currentPR) {
      result[exId].pr = {
        weight,
        reps,
        date: setDate,
        ...(resolvedMode === 'e1rm' ? { e1rm: e1rm(weight, reps) } : {}),
      };
    } else {
      const currentCandidate = {
        weight: currentPR.weight,
        reps: currentPR.reps,
        date: currentPR.date,
      };
      if (comparePrSets(candidatePR, currentCandidate, resolvedMode) < 0) {
        result[exId].pr = {
          weight,
          reps,
          date: setDate,
          ...(resolvedMode === 'e1rm' ? { e1rm: e1rm(weight, reps) } : {}),
        };
      }
    }
  }

  return result;
}
