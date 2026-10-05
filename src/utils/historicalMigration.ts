/**
 * Yourbody V1 -> V2 Historical Data Migration Utilities
 *
 * Implements deterministic business logic, duplicate set purging,
 * volume calculations, and exercise aliasing.
 */

/**
 * 12 Pre-seeded master exercises in Yourbody V2 catalog.
 */
export const MASTER_EXERCISE_NAMES = [
  'Incline Bench Press',
  'Cable Lateral Raises',
  'Dips',
  'Leg Extension Machine',
  'Overhead Tricep Cable Pull',
  'Leg Raise',
  'Lat Pull Down',
  'Seated Cable Row',
  'Inclined Bicep Curl',
  'Leg Curl',
  'Face Pulls',
  'Weighted Sit-Up',
] as const;

/**
 * 11 Custom user exercises migrated from legacy spreadsheet catalog.
 */
export const CUSTOM_EXERCISE_NAMES = [
  'Seated Chest Press',
  'L2H Cable Fly',
  'Dumbbell Lateral Raises',
  'Crossover cable rear delt',
  'Dragon Flag',
  'Reverse crunch',
  '45 Degree Back Extension',
  'Lat Cable Prayer',
  'Bicep cable pull',
  'Tricep Cable Pushdown',
  'Preacher Curl',
] as const;

export const MASTER_EXERCISE_SET = new Set(
  MASTER_EXERCISE_NAMES.map((name) => name.toLowerCase())
);

export const CUSTOM_EXERCISE_SET = new Set(
  CUSTOM_EXERCISE_NAMES.map((name) => name.toLowerCase())
);

/**
 * Sample duplicate client submission IDs purged during migration integrity check.
 */
export const PURGED_CLIENT_IDS = new Set([
  'C-PURGE-001',
  'C-PURGE-002',
]);

export interface LegacyLogItem {
  Log_ID?: number | string;
  Workout_ID: string;
  Exercise_ID: string;
  Weight: number | string;
  Reps: number | string;
  Date: string;
  Set_Index: number | string;
  Client_ID: string;
  Timestamp?: string;
}

export interface CleanSetItem {
  clientId: string;
  workoutName: string;
  exerciseName: string;
  date: string;
  weight: number;
  reps: number;
  setIndex: number;
  timestamp: string;
}

/**
 * Aliases legacy exercise names to canonical V2 catalog names:
 * - 'Lat Cable Pulldown' -> 'Lat Cable Prayer'
 * - 'Overhead Tricep Cable Push' -> 'Overhead Tricep Cable Pull'
 */
export function resolveExerciseName(rawName?: string | null): string {
  if (!rawName) return '';
  const norm = rawName.trim().toLowerCase();
  if (norm === 'lat cable pulldown') {
    return 'Lat Cable Prayer';
  }
  if (norm === 'overhead tricep cable push') {
    return 'Overhead Tricep Cable Pull';
  }
  return rawName.trim();
}

/**
 * Checks if a given exercise name is one of the 12 master catalog exercises (including aliases).
 */
export function isMasterExercise(name: string): boolean {
  const resolved = resolveExerciseName(name).toLowerCase();
  return MASTER_EXERCISE_SET.has(resolved);
}

/**
 * Checks if a given exercise name is one of the 11 custom catalog exercises (including aliases).
 */
export function isCustomExercise(name: string): boolean {
  const resolved = resolveExerciseName(name).toLowerCase();
  return CUSTOM_EXERCISE_SET.has(resolved);
}

/**
 * Filters out phantom duplicates and sanitizes legacy logs into clean typed sets.
 */
export function sanitizeHistoricalLogs(logs: LegacyLogItem[]): CleanSetItem[] {
  return logs
    .filter((l) => Boolean(l.Client_ID) && !PURGED_CLIENT_IDS.has(l.Client_ID))
    .map((l) => {
      const parsedWeight =
        typeof l.Weight === 'number'
          ? l.Weight
          : parseFloat(String(l.Weight ?? 0));
      const parsedReps =
        typeof l.Reps === 'number'
          ? l.Reps
          : parseInt(String(l.Reps ?? 0), 10);
      const parsedSetIndex =
        typeof l.Set_Index === 'number'
          ? l.Set_Index
          : parseInt(String(l.Set_Index ?? 1), 10);

      return {
        clientId: l.Client_ID,
        workoutName: (l.Workout_ID || '').trim(),
        exerciseName: resolveExerciseName(l.Exercise_ID),
        date: (l.Date || '').trim(),
        weight: Number.isFinite(parsedWeight) && parsedWeight >= 0 ? parsedWeight : 0,
        reps: Number.isFinite(parsedReps) && parsedReps >= 0 ? parsedReps : 0,
        setIndex: Number.isFinite(parsedSetIndex) && parsedSetIndex >= 1 ? parsedSetIndex : 1,
        timestamp: l.Timestamp || `${(l.Date || '').trim()}T00:00:00Z`,
      };
    });
}

/**
 * Calculates total training volume (weight * reps) rounded to 1 decimal place.
 */
export function calculateTotalVolume(sets: { weight: number; reps: number }[]): number {
  const sum = sets.reduce((acc, s) => {
    const w = Number.isFinite(s.weight) && s.weight > 0 ? s.weight : 0;
    const r = Number.isFinite(s.reps) && s.reps > 0 ? s.reps : 0;
    return acc + w * r;
  }, 0);
  return Math.round(sum * 10) / 10;
}

export interface PostMigrationMetrics {
  workoutsCount: number;
  setsCount: number;
  totalVolume: number;
  templatesCount: number;
  templateExercisesCount: number;
  nutritionLogsCount: number;
  catalogExercisesCount: number;
}

export const EXPECTED_HISTORICAL_METRICS: PostMigrationMetrics = {
  workoutsCount: 20,
  setsCount: 200,
  totalVolume: 50000.0,
  templatesCount: 4,
  templateExercisesCount: 20,
  nutritionLogsCount: 40,
  catalogExercisesCount: 20,
};

/**
 * Asserts all 7 post-migration invariants match historical specifications.
 */
export function assertMigrationIntegrity(metrics: PostMigrationMetrics): void {
  if (metrics.workoutsCount !== EXPECTED_HISTORICAL_METRICS.workoutsCount) {
    throw new Error(`Expected ${EXPECTED_HISTORICAL_METRICS.workoutsCount} workouts, got ${metrics.workoutsCount}`);
  }
  if (metrics.setsCount !== EXPECTED_HISTORICAL_METRICS.setsCount) {
    throw new Error(`Expected ${EXPECTED_HISTORICAL_METRICS.setsCount} sets, got ${metrics.setsCount}`);
  }
  if (Math.abs(metrics.totalVolume - EXPECTED_HISTORICAL_METRICS.totalVolume) > 0.05) {
    throw new Error(`Expected ${EXPECTED_HISTORICAL_METRICS.totalVolume} lb volume, got ${metrics.totalVolume}`);
  }
  if (metrics.templatesCount !== EXPECTED_HISTORICAL_METRICS.templatesCount) {
    throw new Error(`Expected ${EXPECTED_HISTORICAL_METRICS.templatesCount} routine templates, got ${metrics.templatesCount}`);
  }
  if (metrics.templateExercisesCount !== EXPECTED_HISTORICAL_METRICS.templateExercisesCount) {
    throw new Error(`Expected ${EXPECTED_HISTORICAL_METRICS.templateExercisesCount} template exercises, got ${metrics.templateExercisesCount}`);
  }
  if (metrics.nutritionLogsCount !== EXPECTED_HISTORICAL_METRICS.nutritionLogsCount) {
    throw new Error(`Expected ${EXPECTED_HISTORICAL_METRICS.nutritionLogsCount} nutrition logs, got ${metrics.nutritionLogsCount}`);
  }
  if (metrics.catalogExercisesCount !== EXPECTED_HISTORICAL_METRICS.catalogExercisesCount) {
    throw new Error(`Expected ${EXPECTED_HISTORICAL_METRICS.catalogExercisesCount} catalog exercises, got ${metrics.catalogExercisesCount}`);
  }
}
