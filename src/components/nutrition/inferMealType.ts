export type CanonicalMealType =
  | 'Breakfast'
  | 'Lunch'
  | 'Dinner'
  | 'Snack'
  | 'Pre-Workout'
  | 'Post-Workout';

export const CANONICAL_MEAL_TYPES: readonly CanonicalMealType[] = [
  'Breakfast',
  'Lunch',
  'Dinner',
  'Snack',
  'Pre-Workout',
  'Post-Workout',
] as const;

/**
 * Validates whether a value is one of the supported canonical meal types (case-insensitive).
 */
export function isValidMealType(value: unknown): value is CanonicalMealType {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'breakfast' ||
    normalized === 'lunch' ||
    normalized === 'dinner' ||
    normalized === 'snack' ||
    normalized === 'pre-workout' ||
    normalized === 'post-workout'
  );
}

/**
 * Converts a string to its canonical select option value.
 * Defaults to 'Breakfast' if invalid or unparseable.
 */
export function canonicalizeMealType(type?: string | null): CanonicalMealType {
  if (typeof type !== 'string') return 'Breakfast';
  const normalized = type.trim().toLowerCase();
  if (normalized === 'breakfast') return 'Breakfast';
  if (normalized === 'lunch') return 'Lunch';
  if (normalized === 'dinner') return 'Dinner';
  if (normalized === 'snack') return 'Snack';
  if (normalized === 'pre-workout') return 'Pre-Workout';
  if (normalized === 'post-workout') return 'Post-Workout';
  return 'Breakfast';
}

/**
 * Infers the default meal type for a staged meal.
 *
 * Rules:
 * 1. If the staged meal name is a meal word (Breakfast / Lunch / Dinner / Snack, case-insensitive, trimmed;
 *    such as a "Dinner" header line from a paste), use it (return the canonical select value).
 * 2. Else by the user's LOCAL hour of `now`:
 *    - 00:00 - 10:59 -> Breakfast
 *    - 11:00 - 15:59 -> Lunch
 *    - 16:00 - 21:59 -> Dinner
 *    - 22:00 - 23:59 -> Snack
 */
export function inferMealType(name?: string | null, now?: Date | null): CanonicalMealType {
  if (typeof name === 'string') {
    const trimmed = name.trim().toLowerCase();
    if (trimmed === 'breakfast') return 'Breakfast';
    if (trimmed === 'lunch') return 'Lunch';
    if (trimmed === 'dinner') return 'Dinner';
    if (trimmed === 'snack') return 'Snack';
    if (trimmed === 'pre-workout') return 'Pre-Workout';
    if (trimmed === 'post-workout') return 'Post-Workout';
  }

  const currentDate = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  const localHour = currentDate.getHours();

  if (localHour < 11) {
    return 'Breakfast';
  }
  if (localHour < 16) {
    return 'Lunch';
  }
  if (localHour < 22) {
    return 'Dinner';
  }
  return 'Snack';
}
