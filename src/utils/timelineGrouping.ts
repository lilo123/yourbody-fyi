import { normalizeDateStr, getLocalDateStr } from './date';
import { nutritionDayKey } from './nutritionDayKey';
import type { TimelineDay, CoachWorkoutSession, CoachNutritionLog } from '../components/coach/CoachAthleteTimeline';

/**
 * Resolves the effective athlete timezone from profile or link data, falling back
 * to undefined (which defaults to the viewer's resolved timezone) if not captured.
 */
export function resolveAthleteTimeZone(
  athleteProfile?: { timezone?: string | null } | null,
  selectedAthlete?: unknown
): string | undefined {
  const athleteObj = selectedAthlete as { timezone?: string | null } | null | undefined;
  return athleteProfile?.timezone || athleteObj?.timezone || undefined;
}

/**
 * Calculates the starting date string (YYYY-MM-DD) for a timeline range (daysRange days ago)
 * relative to today in the specified timezone (or local viewer timezone if omitted).
 */
export function getTimelineDaysAgoStr(daysRange: number, timeZone?: string): string {
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayStr = normalizeDateStr(new Date(), tz);
  const [y, m, d] = (todayStr || getLocalDateStr()).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - daysRange));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Checks if a date string or Date object represents a civil date stored at UTC midnight.
 * Bare date strings ('YYYY-MM-DD') or ISO timestamps with 00:00:00[.000] at UTC (+00:00 / Z).
 */
export function isMidnightUtc(val: string | Date | null | undefined): boolean {
  if (!val) return false;
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return true;
    const d = new Date(val);
    if (isNaN(d.getTime())) return false;
    return (
      d.getUTCHours() === 0 &&
      d.getUTCMinutes() === 0 &&
      d.getUTCSeconds() === 0 &&
      d.getUTCMilliseconds() === 0
    );
  }
  if (val instanceof Date && !isNaN(val.getTime())) {
    return (
      val.getUTCHours() === 0 &&
      val.getUTCMinutes() === 0 &&
      val.getUTCSeconds() === 0 &&
      val.getUTCMilliseconds() === 0
    );
  }
  return false;
}

/**
 * Groups workout sessions and nutrition logs into calendar days sorted descending by date.
 *
 * - `workouts.date` is treated conditionally:
 *   - If it is a bare civil date ('YYYY-MM-DD') or UTC midnight timestamp (client-written rows),
 *     it is NOT shifted by timezone to avoid erroneously moving workouts into adjacent days.
 *   - If it has a non-midnight time component (e.g. database default `now()`), it is converted
 *     to the target timezone's calendar day so evening workouts group on the correct local day.
 * - `nutrition.logged_at` is a true timestamptz instant and MUST be converted to the target timezone's
 *   calendar day (e.g. 20:00 EDT evening meal stored as UTC next day must group under the local day).
 */
export function groupTimelineDays(
  workouts: CoachWorkoutSession[],
  nutrition: CoachNutritionLog[],
  timeZone?: string
): TimelineDay[] {
  const dayMap = new Map<string, TimelineDay>();

  // Fallback: when timeZone is omitted/undefined (e.g. uncaptured timezone), falls back to viewer's resolved zone.
  // When an athlete has a stored timezone, it is passed explicitly to group on the athlete's civil day.
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  workouts.forEach((w) => {
    // If w.date is a bare civil date or UTC midnight timestamp, preserve the date without timezone shifting.
    // If w.date has a non-midnight time component (e.g. inserted via default timestamp), convert to target timezone.
    const d =
      (isMidnightUtc(w.date) ? normalizeDateStr(w.date) : normalizeDateStr(w.date, tz)) ||
      (w.date ? String(w.date).slice(0, 10) : '');
    if (!d) return;
    if (!dayMap.has(d)) {
      dayMap.set(d, { date: d, workouts: [], nutrition: [] });
    }
    dayMap.get(d)!.workouts.push(w);
  });

  nutrition.forEach((n) => {
    // n.logged_date is the authoritative civil date recorded at log time.
    // Falls back to converting n.logged_at to the target timezone's calendar day.
    const d = nutritionDayKey(n, tz);
    if (!d) return;
    if (!dayMap.has(d)) {
      dayMap.set(d, { date: d, workouts: [], nutrition: [] });
    }
    dayMap.get(d)!.nutrition.push(n);
  });

  return Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date));
}
