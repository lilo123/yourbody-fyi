import { describe, it, expect } from 'vitest';
import { groupTimelineDays, isMidnightUtc, resolveAthleteTimeZone, getTimelineDaysAgoStr } from './timelineGrouping';
import type { CoachNutritionLog, CoachWorkoutSession } from '../components/coach/CoachAthleteTimeline';

describe('groupTimelineDays', () => {
  it('groups nutrition log under local day when UTC timestamp falls on the next day (west of UTC: America/New_York)', () => {
    // 20:30 EDT dinner on Sep 21 is stored as 2026-09-22T00:30:00Z in UTC.
    // In America/New_York (UTC-4 in Sep), this must group under 2026-09-21.
    const nutrition: CoachNutritionLog[] = [
      {
        id: 'nut-evening',
        food_name: 'Late Dinner Steak',
        calories: 750,
        protein: 60,
        carbs: 10,
        fat: 40,
        logged_at: '2026-09-22T00:30:00Z',
      },
    ];

    const result = groupTimelineDays([], nutrition, 'America/New_York');

    // Assert a 2026-09-21 day exists in output and contains the nutrition log
    const dayDates = result.map((d) => d.date);
    expect(dayDates).toContain('2026-09-21');
    expect(dayDates).not.toContain('2026-09-22');

    const sep21 = result.find((d) => d.date === '2026-09-21');
    expect(sep21).toBeDefined();
    expect(sep21?.nutrition).toHaveLength(1);
    expect(sep21?.nutrition[0].id).toBe('nut-evening');
  });

  it('groups nutrition log under local day when UTC timestamp falls on the previous day (east of UTC: Asia/Novosibirsk)', () => {
    // 03:30 +07 breakfast on Sep 22 is stored as 2026-09-21T20:30:00Z in UTC (UTC+7).
    // In Asia/Novosibirsk, this must group under 2026-09-22.
    const nutrition: CoachNutritionLog[] = [
      {
        id: 'nut-morning',
        food_name: 'Oatmeal Breakfast',
        calories: 500,
        protein: 30,
        carbs: 65,
        fat: 12,
        logged_at: '2026-09-21T20:30:00Z',
      },
    ];

    const result = groupTimelineDays([], nutrition, 'Asia/Novosibirsk');

    // Assert a 2026-09-22 day exists in output and contains the nutrition log
    const dayDates = result.map((d) => d.date);
    expect(dayDates).toContain('2026-09-22');
    expect(dayDates).not.toContain('2026-09-21');

    const sep22 = result.find((d) => d.date === '2026-09-22');
    expect(sep22).toBeDefined();
    expect(sep22?.nutrition).toHaveLength(1);
    expect(sep22?.nutrition[0].id).toBe('nut-morning');
  });

  it('preserves workout civil date without timezone shifting (avoiding the opposite bug)', () => {
    // workouts.date is a bare civil date string or UTC midnight timestamptz representing the athlete's day.
    // If timezone conversion were erroneously applied, 2026-09-21T00:00:00Z in America/New_York
    // would shift back to 2026-09-20 20:00 EDT (yesterday).
    const workouts: CoachWorkoutSession[] = [
      {
        id: 'w-1',
        name: 'Heavy Leg Day',
        date: '2026-09-21T00:00:00.000Z',
        sets: [],
      },
      {
        id: 'w-2',
        name: 'Upper Body Push',
        date: '2026-09-20',
        sets: [],
      },
    ];

    const result = groupTimelineDays(workouts, [], 'America/New_York');

    const dayDates = result.map((d) => d.date);
    expect(dayDates).toContain('2026-09-21');
    expect(dayDates).toContain('2026-09-20');
    expect(dayDates).not.toContain('2026-09-19');

    const sep21 = result.find((d) => d.date === '2026-09-21');
    expect(sep21?.workouts).toHaveLength(1);
    expect(sep21?.workouts[0].id).toBe('w-1');
  });

  it('groups workouts and nutrition on the same local day together and sorts days descending', () => {
    const workouts: CoachWorkoutSession[] = [
      {
        id: 'w-sep21',
        name: 'Chest & Arms',
        date: '2026-09-21',
        sets: [],
      },
      {
        id: 'w-sep20',
        name: 'Back & Core',
        date: '2026-09-20',
        sets: [],
      },
    ];

    const nutrition: CoachNutritionLog[] = [
      // 20:30 EDT on Sep 21 = 2026-09-22T00:30:00Z
      {
        id: 'n-dinner',
        food_name: 'Dinner',
        calories: 800,
        protein: 50,
        carbs: 60,
        fat: 25,
        logged_at: '2026-09-22T00:30:00Z',
      },
      // 12:00 EDT on Sep 21 = 2026-09-21T16:00:00Z
      {
        id: 'n-lunch',
        food_name: 'Lunch',
        calories: 600,
        protein: 40,
        carbs: 50,
        fat: 15,
        logged_at: '2026-09-21T16:00:00Z',
      },
    ];

    const result = groupTimelineDays(workouts, nutrition, 'America/New_York');

    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2026-09-21');
    expect(result[1].date).toBe('2026-09-20');

    expect(result[0].workouts).toHaveLength(1);
    expect(result[0].nutrition).toHaveLength(2);

    expect(result[1].workouts).toHaveLength(1);
    expect(result[1].nutrition).toHaveLength(0);
  });

  it('correctly converts non-midnight workout timestamps (database default now()) to local day', () => {
    // A workout recorded at 20:30 EDT on Sep 21 is stored with UTC timestamp 2026-09-22T00:30:00Z.
    // Unlike midnight civil dates, non-midnight timestamps must convert to the athlete's local date (Sep 21).
    const workouts: CoachWorkoutSession[] = [
      {
        id: 'w-late-night',
        name: 'Late Evening Workout',
        date: '2026-09-22T00:30:00Z',
        sets: [],
      },
      {
        id: 'w-civil-midnight',
        name: 'Civil Date Workout',
        date: '2026-09-22T00:00:00.000Z',
        sets: [],
      },
    ];

    const result = groupTimelineDays(workouts, [], 'America/New_York');

    // w-late-night should convert to 2026-09-21 EDT
    const sep21 = result.find((d) => d.date === '2026-09-21');
    expect(sep21).toBeDefined();
    expect(sep21?.workouts.map((w) => w.id)).toContain('w-late-night');

    // w-civil-midnight should remain 2026-09-22
    const sep22 = result.find((d) => d.date === '2026-09-22');
    expect(sep22).toBeDefined();
    expect(sep22?.workouts.map((w) => w.id)).toContain('w-civil-midnight');
  });

  it('correctly converts non-midnight workout timestamps east of UTC to local day', () => {
    // In Asia/Novosibirsk (UTC+7), a workout at 03:30 +07 on Sep 22 is stored as 2026-09-21T20:30:00Z.
    const workouts: CoachWorkoutSession[] = [
      {
        id: 'w-morning-utc7',
        name: 'Early Morning Run',
        date: '2026-09-21T20:30:00Z',
        sets: [],
      },
    ];

    const result = groupTimelineDays(workouts, [], 'Asia/Novosibirsk');
    const dayDates = result.map((d) => d.date);
    expect(dayDates).toContain('2026-09-22');
    expect(dayDates).not.toContain('2026-09-21');
  });

  it('proves logged_date takes precedence over logged_at timezone conversion and prevents travel from re-bucketing historical meals', () => {
    // Athlete logs dinner in New York on Sep 21: logged_date is '2026-09-21', logged_at is 2026-09-22T01:00:00Z.
    // If the athlete travels to Tokyo (Asia/Tokyo, UTC+9), logged_at conversion alone would shift this to Sep 22 10:00 AM.
    // logged_date must take precedence and preserve the meal on 2026-09-21.
    const mealWithLoggedDate: CoachNutritionLog = {
      id: 'travel-meal-1',
      food_name: 'NYC Late Dinner',
      calories: 600,
      protein: 40,
      carbs: 50,
      fat: 20,
      logged_at: '2026-09-22T01:00:00Z',
      logged_date: '2026-09-21',
    };

    // When viewed under Tokyo timezone
    const resultTokyo = groupTimelineDays([], [mealWithLoggedDate], 'Asia/Tokyo');
    expect(resultTokyo).toHaveLength(1);
    expect(resultTokyo[0].date).toBe('2026-09-21');
    expect(resultTokyo[0].nutrition[0].id).toBe('travel-meal-1');

    // Without logged_date, it falls back to logged_at conversion in Tokyo (Sep 22)
    const mealWithoutLoggedDate: CoachNutritionLog = {
      ...mealWithLoggedDate,
      logged_date: undefined,
    };
    const fallbackResult = groupTimelineDays([], [mealWithoutLoggedDate], 'Asia/Tokyo');
    expect(fallbackResult).toHaveLength(1);
    expect(fallbackResult[0].date).toBe('2026-09-22');
  });
});

describe('isMidnightUtc', () => {
  it('identifies bare civil dates as midnight UTC', () => {
    expect(isMidnightUtc('2026-09-21')).toBe(true);
    expect(isMidnightUtc('2026-01-01')).toBe(true);
  });

  it('identifies ISO midnight UTC strings as midnight UTC', () => {
    expect(isMidnightUtc('2026-09-21T00:00:00Z')).toBe(true);
    expect(isMidnightUtc('2026-09-21T00:00:00.000Z')).toBe(true);
    expect(isMidnightUtc('2026-09-21T00:00:00+00:00')).toBe(true);
    expect(isMidnightUtc('2026-09-21 00:00:00+00')).toBe(true);
  });

  it('identifies non-midnight timestamps as NOT midnight UTC', () => {
    expect(isMidnightUtc('2026-09-22T00:30:00Z')).toBe(false);
    expect(isMidnightUtc('2026-09-17 19:07:25.346325+00')).toBe(false);
    expect(isMidnightUtc('2026-09-21T00:00:01Z')).toBe(false);
  });

  it('handles falsy or invalid inputs gracefully', () => {
    expect(isMidnightUtc('')).toBe(false);
    expect(isMidnightUtc(null)).toBe(false);
    expect(isMidnightUtc(undefined)).toBe(false);
    expect(isMidnightUtc('invalid-date')).toBe(false);
  });
});

describe('Athlete-coach cross-timezone day bucketing', () => {
  // Athlete is in America/New_York (UTC-4 in Sep).
  // Coach views from Asia/Novosibirsk (UTC+7 in Sep).
  // 5 nutrition logs logged throughout the athlete's local Sep 22:
  // Breakfast: 08:00 EDT -> 2026-09-22T12:00:00Z (Sep 22 in both)
  // Lunch: 12:30 EDT -> 2026-09-22T16:30:00Z (23:30 +07 Sep 22 in coach zone)
  // Afternoon Snack: 16:00 EDT -> 2026-09-22T20:00:00Z (03:00 +07 Sep 23 in coach zone)
  // Dinner: 19:30 EDT -> 2026-09-22T23:30:00Z (06:30 +07 Sep 23 in coach zone)
  // Late Evening Snack: 22:15 EDT -> 2026-09-23T02:15:00Z (09:15 +07 Sep 23 in coach zone)
  const athleteMealsSep22: CoachNutritionLog[] = [
    { id: 'm1', food_name: 'Eggs & Toast', calories: 450, protein: 30, carbs: 40, fat: 15, logged_at: '2026-09-22T12:00:00Z' },
    { id: 'm2', food_name: 'Chicken Rice Bowl', calories: 650, protein: 50, carbs: 70, fat: 18, logged_at: '2026-09-22T16:30:00Z' },
    { id: 'm3', food_name: 'Protein Shake', calories: 250, protein: 35, carbs: 10, fat: 5, logged_at: '2026-09-22T20:00:00Z' },
    { id: 'm4', food_name: 'Salmon & Asparagus', calories: 500, protein: 45, carbs: 12, fat: 28, logged_at: '2026-09-22T23:30:00Z' },
    { id: 'm5', food_name: 'Greek Yogurt & Berries', calories: 85, protein: 15, carbs: 5, fat: 1, logged_at: '2026-09-23T02:15:00Z' },
  ];

  it('groups all 5 athlete meals into exactly ONE day 2026-09-22 when using athlete timezone America/New_York', () => {
    const athleteZone = 'America/New_York';
    const result = groupTimelineDays([], athleteMealsSep22, athleteZone);

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-09-22');
    expect(result[0].nutrition).toHaveLength(5);
    expect(result[0].nutrition.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    const totalKcal = result[0].nutrition.reduce((sum, n) => sum + (n.calories || 0), 0);
    expect(totalKcal).toBe(1935);
  });

  it('demonstrates the bug when using viewer timezone Asia/Novosibirsk: meals incorrectly split across Sep 23 and Sep 22', () => {
    const coachZone = 'Asia/Novosibirsk';
    const result = groupTimelineDays([], athleteMealsSep22, coachZone);

    // In coach zone, the 3 evening meals cross midnight into Sep 23, splitting into 2 days
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.date)).toEqual(['2026-09-23', '2026-09-22']);
    const sep23 = result.find((d) => d.date === '2026-09-23');
    const sep22 = result.find((d) => d.date === '2026-09-22');
    expect(sep23?.nutrition).toHaveLength(3); // m3, m4, m5
    expect(sep22?.nutrition).toHaveLength(2); // m1, m2
  });

  it('mirror case: groups athlete meals in Asia/Novosibirsk into 2026-09-22 without leaking to Sep 21 in America/New_York', () => {
    // Athlete is in Asia/Novosibirsk (UTC+7). Coach is in America/New_York (UTC-4).
    // Early morning meal at 05:30 +07 on Sep 22 is stored as 2026-09-21T22:30:00Z UTC.
    // In coach zone (UTC-4), 2026-09-21T22:30:00Z is Sep 21 18:30 EDT!
    const eastAthleteMeals: CoachNutritionLog[] = [
      { id: 'em1', food_name: 'Hearty Breakfast', calories: 550, protein: 35, carbs: 65, fat: 12, logged_at: '2026-09-21T22:30:00Z' },
      { id: 'em2', food_name: 'Midday Rice & Chicken', calories: 650, protein: 45, carbs: 70, fat: 20, logged_at: '2026-09-22T05:00:00Z' },
      { id: 'em3', food_name: 'Evening Snack', calories: 300, protein: 25, carbs: 30, fat: 8, logged_at: '2026-09-22T13:00:00Z' },
    ];

    const result = groupTimelineDays([], eastAthleteMeals, 'Asia/Novosibirsk');
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-09-22');
    expect(result[0].nutrition).toHaveLength(3);

    // If incorrectly grouped in coach zone (America/New_York), em1 lands on 2026-09-21
    const coachResult = groupTimelineDays([], eastAthleteMeals, 'America/New_York');
    expect(coachResult).toHaveLength(2);
    expect(coachResult.map((d) => d.date)).toEqual(['2026-09-22', '2026-09-21']);
  });

  it('handles DST transitions in America/New_York correctly without fixed numeric offset drift', () => {
    // Standard Time (EST, UTC-5): Jan 15, 2026 20:00 EST = 2026-01-16T01:00:00Z
    const estMeal: CoachNutritionLog = {
      id: 'winter-dinner',
      food_name: 'Winter Stew',
      calories: 700,
      protein: 40,
      carbs: 60,
      fat: 25,
      logged_at: '2026-01-16T01:00:00Z',
    };

    // Daylight Time (EDT, UTC-4): July 15, 2026 20:00 EDT = 2026-07-16T00:00:00Z
    const edtMeal: CoachNutritionLog = {
      id: 'summer-dinner',
      food_name: 'Summer Salad',
      calories: 500,
      protein: 35,
      carbs: 45,
      fat: 15,
      logged_at: '2026-07-16T00:00:00Z',
    };

    // Nov 1 2026 Fall Back: 23:30 EST (UTC-5) = 2026-11-02T04:30:00Z
    const fallBackMeal: CoachNutritionLog = {
      id: 'fallback-meal',
      food_name: 'Post-DST Snack',
      calories: 300,
      protein: 20,
      carbs: 30,
      fat: 10,
      logged_at: '2026-11-02T04:30:00Z',
    };

    const estResult = groupTimelineDays([], [estMeal], 'America/New_York');
    expect(estResult[0].date).toBe('2026-01-15');

    const edtResult = groupTimelineDays([], [edtMeal], 'America/New_York');
    expect(edtResult[0].date).toBe('2026-07-15');

    const fallBackResult = groupTimelineDays([], [fallBackMeal], 'America/New_York');
    expect(fallBackResult[0].date).toBe('2026-11-01');
  });

  it('falls back gracefully to viewer resolved timezone when timezone is null or undefined', () => {
    const meal: CoachNutritionLog = {
      id: 'nut-fallback',
      food_name: 'Fallback Meal',
      calories: 400,
      protein: 25,
      carbs: 45,
      fat: 10,
      logged_at: '2026-09-22T12:00:00Z',
    };

    expect(() => groupTimelineDays([], [meal], undefined)).not.toThrow();
    const resultUndefined = groupTimelineDays([], [meal], undefined);
    expect(resultUndefined.length).toBeGreaterThan(0);

    // resolveAthleteTimeZone helper tests
    expect(resolveAthleteTimeZone(null, null)).toBeUndefined();
    expect(resolveAthleteTimeZone({ timezone: null }, null)).toBeUndefined();
    expect(resolveAthleteTimeZone({ timezone: 'America/Chicago' }, null)).toBe('America/Chicago');
    expect(resolveAthleteTimeZone(null, { timezone: 'Europe/London' })).toBe('Europe/London');
    expect(resolveAthleteTimeZone({ timezone: 'America/New_York' }, { timezone: 'Europe/London' })).toBe('America/New_York');
  });

  it('computes timeline range daysAgoStr accurately in athlete timezone', () => {
    const daysAgoNy = getTimelineDaysAgoStr(14, 'America/New_York');
    const daysAgoNov = getTimelineDaysAgoStr(14, 'Asia/Novosibirsk');
    expect(daysAgoNy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(daysAgoNov).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('three-way agreement: groups a travelled meal with logged_date 2026-09-21 and logged_at 2026-09-22T01:00:00Z under 2026-09-21 in Asia/Tokyo', () => {
    const nutrition: CoachNutritionLog[] = [
      {
        id: 'travel-nut-1',
        food_name: 'Travel Meal',
        calories: 500,
        protein: 30,
        carbs: 40,
        fat: 10,
        logged_date: '2026-09-21',
        logged_at: '2026-09-22T01:00:00Z',
      },
    ];

    const result = groupTimelineDays([], nutrition, 'Asia/Tokyo');

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-09-21');
    expect(result[0].nutrition).toHaveLength(1);
    expect(result[0].nutrition[0].id).toBe('travel-nut-1');
  });
});

