const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true if the value is a string matching canonical UUID format (8-4-4-4-12 hex).
 */
export function isUuidLike(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return UUID_REGEX.test(trimmed);
}

/**
 * UI safety net: resolves an exercise label, ensuring raw UUIDs or blank values never reach the screen.
 */
export function resolveExerciseLabel(candidate: unknown, fallback: string = 'Unknown exercise'): string {
  if (typeof candidate !== 'string') {
    return fallback;
  }
  const trimmed = candidate.trim();
  if (trimmed.length === 0 || isUuidLike(trimmed)) {
    return fallback;
  }
  return trimmed;
}
