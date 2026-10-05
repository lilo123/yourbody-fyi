import { nutritionDayKey } from './nutritionDayKey';
import type { NutritionLog } from '../types/database';
import type { NutritionDaySummary } from '../components/history/NutritionHistoryTimeline';

/**
 * Groups nutrition logs into calendar days sorted descending by date with macro distributions.
 *
 * - `logs.logged_at` is a timestamptz instant and is converted to the target timezone's
 *   calendar day so evening meals group under the correct local date rather than raw UTC.
 */
export function groupNutritionDays(
  logs: NutritionLog[],
  timeZone?: string
): NutritionDaySummary[] {
  const map = new Map<string, NutritionDaySummary>();
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  logs.forEach((log) => {
    const date = nutritionDayKey(log, tz);
    if (!date) return;
    if (!map.has(date)) {
      map.set(date, {
        date,
        meals: [],
        totals: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
        macroCalories: { protein: 0, carbs: 0, fat: 0, total: 0 },
        percentages: { protein: 0, carbs: 0, fat: 0 },
      });
    }
    const entry = map.get(date)!;
    entry.meals.push(log);
    const cal = Number(log.calories) || 0;
    const p = Number(log.protein) || 0;
    const c = Number(log.carbs) || 0;
    const f = Number(log.fat) || 0;
    const fib = Number(log.fiber) || 0;

    entry.totals.calories += cal;
    entry.totals.protein += p;
    entry.totals.carbs += c;
    entry.totals.fat += f;
    entry.totals.fiber += fib;
  });

  // Calculate caloric ratio distribution for each day
  map.forEach((day) => {
    const pCal = day.totals.protein * 4;
    const cCal = day.totals.carbs * 4;
    const fCal = day.totals.fat * 9;
    const totalMacroCal = pCal + cCal + fCal;

    day.macroCalories = {
      protein: pCal,
      carbs: cCal,
      fat: fCal,
      total: totalMacroCal,
    };

    if (totalMacroCal > 0) {
      const pPct = Math.round((pCal / totalMacroCal) * 100);
      const cPct = Math.round((cCal / totalMacroCal) * 100);
      const fPct = Math.max(0, 100 - pPct - cPct);
      day.percentages = {
        protein: pPct,
        carbs: cPct,
        fat: fPct,
      };
    }
  });

  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}
