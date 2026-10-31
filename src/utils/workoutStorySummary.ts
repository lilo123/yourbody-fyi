import type { WorkoutSet, Exercise } from '../types/database';
import { pickPrSet, type PrMode } from '../lib/prComparator';
import { formatShortDate } from './date';
import { formatVolume, formatWeight, weightUnitLabel, type WeightUnit } from './weight';
import { DEFAULT_EXERCISES_LIST } from './exerciseCatalog';

export interface WorkoutStoryExercise {
  name: string;
  bestSetFormatted: string;
  bestWeight: number;
  bestReps: number;
  setCount: number;
}

export interface WorkoutStoryData {
  title: string;
  dateFormatted: string;
  totalVolumeFormatted: string;
  totalSets: number;
  exercises: WorkoutStoryExercise[];
  overflowCount: number;
}

export interface BuildWorkoutStoryOptions {
  sessionName?: string | null;
  workoutDate?: string | null;
  sets: (WorkoutSet & { exercise_name?: string })[];
  exercises?: Exercise[];
  unit?: WeightUnit;
  totalVolume?: number | null;
  setCount?: number | null;
  prMode?: PrMode;
}

/**
 * Truncates text to maxLength with an ellipsis if it exceeds the limit.
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return text.slice(0, maxLength);
  return text.slice(0, maxLength - 1).trimEnd() + '…';
}

/**
 * Selects the best set for an exercise using the canonical PR comparator.
 * Defaults to 'weight' mode, or uses 'e1rm' mode when specified.
 */
export function selectBestSet<T extends { weight: number; reps: number; set_type?: string | null }>(
  sets: T[],
  mode: PrMode = 'weight'
): T | null {
  const workingSets = sets.filter((candidateSet) => !candidateSet.set_type || candidateSet.set_type === 'working');
  if (workingSets.length === 0) return null;
  const resolvedMode: PrMode = mode === 'e1rm' ? 'e1rm' : 'weight';
  return pickPrSet(workingSets, resolvedMode);
}

/**
 * Formats the best set using the user's weight unit (e.g. "225 lbs × 5" or "102.1 kg × 5" or "BW × 10").
 */
export function formatBestSet(
  set: { weight: number | null | undefined; reps: number | null | undefined } | null,
  unit: WeightUnit = 'lb'
): string {
  if (!set) return '—';
  const isBW = set.weight == null || set.weight === 0 || isNaN(Number(set.weight));
  const reps = set.reps != null && !isNaN(Number(set.reps)) ? set.reps : 0;
  if (isBW) {
    return reps > 0 ? `BW × ${reps}` : 'BW';
  }
  const weightStr = formatWeight(set.weight, unit, { showUnit: true });
  return reps > 0 ? `${weightStr} × ${reps}` : weightStr;
}

/**
 * Pure builder function that aggregates session sets, computes volume and best sets,
 * caps at 6 exercises, and returns structured data for story canvas rendering.
 */
export function buildWorkoutStoryData(options: BuildWorkoutStoryOptions): WorkoutStoryData {
  const unit = options.unit || 'lb';
  const prMode: PrMode = options.prMode === 'e1rm' ? 'e1rm' : 'weight';
  const rawTitle = options.sessionName?.trim() || 'Workout Session';
  const title = truncateText(rawTitle, 40);

  const dateFormatted = options.workoutDate ? formatShortDate(options.workoutDate) : '';

  // Group sets by exercise while preserving order of appearance
  const groups: { name: string; sets: (WorkoutSet & { exercise_name?: string })[] }[] = [];
  const exerciseLookup = new Map<string, string>();

  // Pre-seed lookup with default catalog exercises
  for (const ex of DEFAULT_EXERCISES_LIST) {
    if (ex.id && ex.name) {
      exerciseLookup.set(ex.id, ex.name);
      exerciseLookup.set(ex.name, ex.name);
    }
  }

  if (options.exercises) {
    for (const ex of options.exercises) {
      if (ex.id && ex.name) {
        exerciseLookup.set(ex.id, ex.name);
        exerciseLookup.set(ex.name, ex.name);
      }
    }
  }

  for (const set of options.sets || []) {
    if (set.set_type && set.set_type !== 'working') continue;
    const name =
      set.exercise_name ||
      (set.exercise_id ? exerciseLookup.get(set.exercise_id) : undefined) ||
      'Exercise';
    let group = groups.find((g) => g.name === name);
    if (!group) {
      group = { name, sets: [] };
      groups.push(group);
    }
    group.sets.push(set);
  }

  // Calculate volume & set count from sets if not explicitly provided
  let calculatedVolume = 0;
  let calculatedTotalSets = 0;
  for (const set of options.sets || []) {
    if (set.set_type && set.set_type !== 'working') continue;
    calculatedTotalSets++;
    const w = Number(set.weight) || 0;
    const r = Number(set.reps) || 0;
    calculatedVolume += w * r;
  }

  const volumeToFormat =
    options.totalVolume != null && options.totalVolume > 0
      ? options.totalVolume
      : calculatedVolume;

  const totalVolumeFormatted =
    volumeToFormat > 0
      ? formatVolume(volumeToFormat, unit)
      : `0 ${weightUnitLabel(unit)} (BW)`;

  const totalSets =
    options.setCount != null && options.setCount > 0
      ? options.setCount
      : calculatedTotalSets;

  // Build exercise summaries with best set
  const allExerciseSummaries: WorkoutStoryExercise[] = groups.map((group) => {
    const best = selectBestSet(group.sets, prMode);
    return {
      name: group.name,
      bestSetFormatted: formatBestSet(best, unit),
      bestWeight: best ? Number(best.weight) || 0 : 0,
      bestReps: best ? Number(best.reps) || 0 : 0,
      setCount: group.sets.length,
    };
  });

  const exercises = allExerciseSummaries.slice(0, 6);
  const overflowCount = Math.max(0, allExerciseSummaries.length - 6);

  return {
    title,
    dateFormatted,
    totalVolumeFormatted,
    totalSets,
    exercises,
    overflowCount,
  };
}
