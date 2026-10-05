import { describe, it, expect } from 'vitest';
import { groupNutritionDays } from './nutritionDayGrouping';
import { isWithinDayBounds, normalizeDateStr } from './date';
import type { NutritionLog } from '../types/database';

function createLog(overrides: Partial<NutritionLog> = {}): NutritionLog {
  return {
    id: 'test-log-1',
    user_id: 'test-user',
    food_name: 'Test Food',
    calories: 500,
    protein: 30,
    carbs: 50,
    fat: 20,
    fiber: 5,
    logged_at: '2026-09-21T12:00:00Z',
    ...overrides,
  };
}

describe('groupNutritionDays', () => {
  describe('(a) Regression test: timezone-aware day grouping (HistoryView bug)', () => {
    it('groups a 2026-09-22T02:00:00Z log under 2026-09-21 in America/Los_Angeles (19:00 local)', () => {
      // At 2026-09-22T02:00:00Z, Los Angeles is in PDT (UTC-7), so local time is 2026-09-21 19:00.
      // Without timezone, raw UTC prefix groups this under 2026-09-22 (one day late).
      // With timezone awareness, this correctly groups under 2026-09-21.
      const log = createLog({
        id: 'keto-bar-evening',
        food_name: 'Keto Bar',
        calories: 220,
        protein: 12,
        carbs: 6,
        fat: 16,
        fiber: 3,
        logged_at: '2026-09-22T02:00:00Z',
      });

      const result = groupNutritionDays([log], 'America/Los_Angeles');

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-09-21');
      expect(result[0].meals).toHaveLength(1);
      expect(result[0].meals[0].id).toBe('keto-bar-evening');
    });

    it('three-way agreement: groups a travelled meal with logged_date 2026-09-21 and logged_at 2026-09-22T01:00:00Z under 2026-09-21 in Asia/Tokyo', () => {
      const log = createLog({
        id: 'travel-meal-1',
        food_name: 'Travel Meal',
        calories: 500,
        protein: 30,
        carbs: 40,
        fat: 10,
        fiber: 5,
        logged_date: '2026-09-21',
        logged_at: '2026-09-22T01:00:00Z',
      });

      const result = groupNutritionDays([log], 'Asia/Tokyo');

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-09-21');
      expect(result[0].meals).toHaveLength(1);
      expect(result[0].meals[0].id).toBe('travel-meal-1');
    });
  });

  describe('(b) Cross-path consistency oracle (HistoryView vs Nutrition tab)', () => {
    it('LEGACY rows only (logged_date null): day key matches the selectedDate for which isWithinDayBounds is true, across 24 hours and multiple timezones', () => {
      const timezones = [
        'America/Los_Angeles',
        'America/New_York',
        'UTC',
        'Asia/Tokyo',
      ];

      // Spans a full 24 hours (hourly samples on 2026-09-21)
      const candidateDates = ['2026-09-20', '2026-09-21', '2026-09-22'];

      for (const tz of timezones) {
        for (let hour = 0; hour < 24; hour++) {
          const hh = String(hour).padStart(2, '0');
          const timestamp = `2026-09-21T${hh}:30:00.000Z`;

          const log = createLog({
            id: `log-${tz}-${hh}`,
            food_name: `Meal at ${hh}:30 UTC`,
            logged_at: timestamp,
          });

          // `createLog` leaves `logged_date` undefined, so these fixtures exercise ONLY the legacy
          // fallback branch of the day key. On that branch the key is derived from `logged_at` in
          // the viewer's zone, which is exactly what `isWithinDayBounds` computes -- so it remains
          // a valid independent oracle HERE. It is NOT a general model of the Nutrition tab: the
          // tab now prefers the immutable `logged_date` whenever the row carries one. See test (c).
          const matchingDates = candidateDates.filter((date) =>
            isWithinDayBounds(timestamp, date, tz)
          );
          expect(matchingDates).toHaveLength(1);
          const oracleDate = matchingDates[0];

          // The History tab grouping under test
          const grouped = groupNutritionDays([log], tz);

          expect(grouped).toHaveLength(1);
          expect(grouped[0].date).toBe(oracleDate);
          expect(isWithinDayBounds(log.logged_at, grouped[0].date, tz)).toBe(true);
        }
      }
    });
  });

  describe('(c) Cross-path agreement on the CIVIL date key (travelled rows)', () => {
    // The real invariant behind the coach/athlete discrepancy bug: History (groupNutritionDays)
    // and the athlete Nutrition tab must attribute a row to the SAME civil day. Both derive the
    // key as `logged_date || normalizeDateStr(logged_at, tz)`, but they do so in two separate
    // implementations that have already drifted apart once. This pins them together.
    //
    // `isWithinDayBounds` deliberately is NOT used as the oracle here: for a travelled row it
    // disagrees with both paths by design, because `logged_date` is immutable and the instant
    // bounds are not.
    const nutritionTabDayKey = (log: NutritionLog, tz: string): string =>
      log.logged_date || normalizeDateStr(log.logged_at, tz);

    it('agrees with the Nutrition tab key for rows that carry logged_date, even when the viewer has since travelled', () => {
      // Logged at 19:00 on 09-21 in New York (= 09-21 civil), then the athlete flies to Tokyo,
      // where the same instant reads 08:00 on 09-22. The civil diary date must stay 09-21.
      const travelled = createLog({
        id: 'travelled-meal',
        logged_at: '2026-09-21T23:00:00.000Z',
        logged_date: '2026-09-21',
      });

      for (const tz of ['America/New_York', 'Asia/Tokyo', 'UTC', 'Pacific/Kiritimati']) {
        const grouped = groupNutritionDays([travelled], tz);

        expect(grouped).toHaveLength(1);
        expect(grouped[0].date).toBe('2026-09-21');
        expect(grouped[0].date).toBe(nutritionTabDayKey(travelled, tz));
      }
    });

    it('agrees with the Nutrition tab key across 24 hours and multiple timezones, for both legacy and stamped rows', () => {
      const timezones = ['America/Los_Angeles', 'America/New_York', 'UTC', 'Asia/Tokyo'];

      for (const tz of timezones) {
        for (let hour = 0; hour < 24; hour++) {
          const hh = String(hour).padStart(2, '0');
          const logged_at = `2026-09-21T${hh}:30:00.000Z`;

          // Legacy row: no logged_date, key falls back to the instant in the viewer's zone.
          const legacy = createLog({ id: `legacy-${tz}-${hh}`, logged_at });
          const legacyGrouped = groupNutritionDays([legacy], tz);
          expect(legacyGrouped).toHaveLength(1);
          expect(legacyGrouped[0].date).toBe(nutritionTabDayKey(legacy, tz));

          // Stamped row: logged_date wins outright and is independent of the viewer's zone.
          const stamped = createLog({
            id: `stamped-${tz}-${hh}`,
            logged_at,
            logged_date: '2026-09-19',
          });
          const stampedGrouped = groupNutritionDays([stamped], tz);
          expect(stampedGrouped).toHaveLength(1);
          expect(stampedGrouped[0].date).toBe('2026-09-19');
          expect(stampedGrouped[0].date).toBe(nutritionTabDayKey(stamped, tz));
        }
      }
    });
  });

  describe('macro maths, totals, percentages, and sorting', () => {
    it('accurately computes totals, 4/4/9 macro calories, and percentage residual trick', () => {
      const log1 = createLog({
        id: 'meal-1',
        calories: 300,
        protein: 25, // 100 cal
        carbs: 35,   // 140 cal
        fat: 10,     // 90 cal
        fiber: 4,
        logged_at: '2026-09-21T14:00:00Z',
      });
      const log2 = createLog({
        id: 'meal-2',
        calories: 400,
        protein: 35, // 140 cal
        carbs: 45,   // 180 cal
        fat: 10,     // 90 cal
        fiber: 6,
        logged_at: '2026-09-21T18:00:00Z',
      });

      const [day] = groupNutritionDays([log1, log2], 'UTC');

      expect(day.date).toBe('2026-09-21');
      expect(day.meals).toHaveLength(2);
      expect(day.totals).toEqual({
        calories: 700,
        protein: 60,
        carbs: 80,
        fat: 20,
        fiber: 10,
      });

      // protein cal: 60 * 4 = 240
      // carbs cal: 80 * 4 = 320
      // fat cal: 20 * 9 = 180
      // totalMacroCal = 740
      expect(day.macroCalories).toEqual({
        protein: 240,
        carbs: 320,
        fat: 180,
        total: 740,
      });

      // pPct = Math.round((240 / 740) * 100) = 32
      // cPct = Math.round((320 / 740) * 100) = 43
      // fPct = Math.max(0, 100 - 32 - 43) = 25
      expect(day.percentages).toEqual({
        protein: 32,
        carbs: 43,
        fat: 25,
      });
      expect(day.percentages.protein + day.percentages.carbs + day.percentages.fat).toBe(100);
    });

    it('handles zero macro calories safely with zeroed percentages', () => {
      const log = createLog({
        id: 'water-log',
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        logged_at: '2026-09-21T12:00:00Z',
      });

      const [day] = groupNutritionDays([log], 'UTC');
      expect(day.macroCalories).toEqual({
        protein: 0,
        carbs: 0,
        fat: 0,
        total: 0,
      });
      expect(day.percentages).toEqual({
        protein: 0,
        carbs: 0,
        fat: 0,
      });
    });

    it('sorts multiple days descending by date string', () => {
      const logSep20 = createLog({
        id: 'sep20',
        logged_at: '2026-09-20T12:00:00Z',
      });
      const logSep22 = createLog({
        id: 'sep22',
        logged_at: '2026-09-22T12:00:00Z',
      });
      const logSep21 = createLog({
        id: 'sep21',
        logged_at: '2026-09-21T12:00:00Z',
      });

      const days = groupNutritionDays([logSep20, logSep22, logSep21], 'UTC');
      expect(days.map((d) => d.date)).toEqual(['2026-09-22', '2026-09-21', '2026-09-20']);
    });

    it('skips logs with empty or falsy logged_at', () => {
      const invalidLog1 = createLog({ logged_at: '' });
      const invalidLog2 = createLog({ logged_at: null as any });
      const validLog = createLog({ logged_at: '2026-09-21T12:00:00Z' });

      const days = groupNutritionDays([invalidLog1, invalidLog2, validLog], 'UTC');
      expect(days).toHaveLength(1);
      expect(days[0].date).toBe('2026-09-21');
    });

    it('coerces null and undefined numeric macro values to 0', () => {
      const log = createLog({
        calories: undefined as any,
        protein: null,
        carbs: null,
        fat: null,
        fiber: null,
        logged_at: '2026-09-21T12:00:00Z',
      });

      const [day] = groupNutritionDays([log], 'UTC');
      expect(day.totals).toEqual({
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
      });
    });

    it('falls back to resolvedOptions timezone when timeZone is omitted', () => {
      const log = createLog({
        logged_at: '2026-09-21T12:00:00Z',
      });

      const days = groupNutritionDays([log]);
      expect(days).toHaveLength(1);
      expect(days[0].meals).toHaveLength(1);
    });
  });

  describe('logged_date precedence and travel stability', () => {
    it('proves logged_date takes precedence over logged_at timezone conversion and prevents travel from re-bucketing historical meals', () => {
      // Athlete logged a dinner in New York on Sep 21:
      // logged_date is '2026-09-21', logged_at is 2026-09-22T01:00:00Z (EDT 21:00 Sep 21).
      // When traveling to Tokyo (Asia/Tokyo, UTC+9), logged_at alone evaluates to 2026-09-22 10:00.
      // With logged_date taking precedence, the meal stays bucketed on 2026-09-21.
      const meal = createLog({
        id: 'travel-dinner',
        food_name: 'NYC Dinner',
        logged_at: '2026-09-22T01:00:00Z',
        logged_date: '2026-09-21',
      });

      const result = groupNutritionDays([meal], 'Asia/Tokyo');
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-09-21');
      expect(result[0].meals[0].id).toBe('travel-dinner');

      // Without logged_date, timezone conversion falls back to logged_at which buckets into Sep 22
      const mealWithoutLoggedDate = createLog({
        id: 'travel-dinner-legacy',
        food_name: 'NYC Dinner (Legacy)',
        logged_at: '2026-09-22T01:00:00Z',
        logged_date: undefined,
      });

      const fallbackResult = groupNutritionDays([mealWithoutLoggedDate], 'Asia/Tokyo');
      expect(fallbackResult).toHaveLength(1);
      expect(fallbackResult[0].date).toBe('2026-09-22');
    });
  });
});
