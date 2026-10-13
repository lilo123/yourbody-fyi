import type { WorkoutSet, Exercise } from '../types/database';
import { pickPrSet } from '../lib/prComparator';
import { formatShortDate } from './date';
import { formatVolume, formatWeight, weightUnitLabel, type WeightUnit } from './weight';

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
 * Selects the best set for an exercise using the canonical PR comparator (weight mode).
 */
export function selectBestSet<T extends { weight: number; reps: number; set_type?: string | null }>(
  sets: T[]
): T | null {
  const workingSets = sets.filter((s) => !s.set_type || s.set_type === 'working');
  if (workingSets.length === 0) return null;
  return pickPrSet(workingSets, 'weight');
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
  const rawTitle = options.sessionName?.trim() || 'Workout Session';
  const title = truncateText(rawTitle, 40);

  const dateFormatted = options.workoutDate ? formatShortDate(options.workoutDate) : '';

  // Group sets by exercise while preserving order of appearance
  const groups: { name: string; sets: (WorkoutSet & { exercise_name?: string })[] }[] = [];
  const exerciseLookup = new Map<string, string>();
  if (options.exercises) {
    for (const ex of options.exercises) {
      if (ex.id && ex.name) {
        exerciseLookup.set(ex.id, ex.name);
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
  const allExerciseSummaries: WorkoutStoryExercise[] = groups.map((g) => {
    const best = selectBestSet(g.sets);
    return {
      name: g.name,
      bestSetFormatted: formatBestSet(best, unit),
      bestWeight: best ? Number(best.weight) || 0 : 0,
      bestReps: best ? Number(best.reps) || 0 : 0,
      setCount: g.sets.length,
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
