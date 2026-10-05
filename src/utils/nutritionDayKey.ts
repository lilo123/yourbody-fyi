import { normalizeDateStr } from './date';

export interface NutritionDayKeyInput {
  logged_date?: string | null;
  logged_at?: string;
}

/**
 * Computes the authoritative civil calendar day (YYYY-MM-DD) for a nutrition log.
 *
 * Prefers the row's immutable civil `logged_date` when present, otherwise falls back
 * to converting the `logged_at` timestamptz instant to the specified timezone's
 * calendar day (defaulting to the runtime's resolved timezone).
 */
export function nutritionDayKey(
  log: NutritionDayKeyInput,
  timeZone?: string
): string {
  return (
    log.logged_date ||
    normalizeDateStr(
      log.logged_at,
      timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
    )
  );
}
