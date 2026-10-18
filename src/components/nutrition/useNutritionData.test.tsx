import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useNutritionData, useMealUpdateToast } from './useNutritionData';
import { supabase } from '../../lib/supabase';
import * as toastHook from '../../hooks/useToast';
import { getDayBounds, localCivilToUtcMs, isWithinDayBounds } from '../../utils/date';
import type { CustomDish, CustomDishDetail } from '../../types/database';
import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../../test/supabaseBuilderMock';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('useNutritionData (src/components/nutrition/useNutritionData.ts)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
    clearMockHistory();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('queries PostgREST using widened superset window around getDayBounds (-48h / +48h)', async () => {
    let capturedGte: string | null = null;
    let capturedLte: string | null = null;
    let capturedTable: string | null = null;

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      capturedTable = table;
      const builder = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        const origGte = builder.gte.bind(builder);
        const origLte = builder.lte.bind(builder);
        builder.gte = (col: string, val: any) => {
          capturedGte = val;
          return origGte(col, val);
        };
        builder.lte = (col: string, val: any) => {
          capturedLte = val;
          return origLte(col, val);
        };
      }
      return builder as any;
    });

    const targetDate = '2026-07-04';
    const timeZone = 'America/New_York';
    const expectedBounds = getDayBounds(targetDate, timeZone);
    const expectedStart = new Date(new Date(expectedBounds.startOfDay).getTime() - 48 * 60 * 60 * 1000).toISOString();
    const expectedEnd = new Date(new Date(expectedBounds.endOfDay).getTime() + 48 * 60 * 60 * 1000).toISOString();

    renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-123',
          selectedDate: targetDate,
          timeZone,
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(capturedGte).toBe(expectedStart);
      expect(capturedLte).toBe(expectedEnd);
    });

    expect(capturedTable).toBe('nutrition_logs');
    // Hardcoded alongside the derived assertions above on purpose: lines 77-78 call the same
    // getDayBounds the hook calls, so they would still pass if getDayBounds itself regressed.
    // 2026-07-04 in America/New_York (EDT, UTC-4) starts at 04:00Z; -48h = 2026-07-02T04:00:00Z
    // and the day ends 2026-07-05T03:59:59.999Z, so +48h = 2026-07-07T03:59:59.999Z.
    expect(capturedGte).toBe('2026-07-02T04:00:00.000Z');
    expect(capturedLte).toBe('2026-07-07T03:59:59.999Z');

    expect(getRecordedTables()).toContain('nutrition_logs');
    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components, source',
    });
  });

  it('filters todayLogs in-memory strictly with civil date and timezone fallback across positive offset (Tokyo UTC+9)', async () => {
    const targetDate = '2026-09-08';
    const timeZone = 'Asia/Tokyo';

    // Simulated logs from database spanning boundary (legacy rows without logged_date)
    const mockLogs = [
      {
        id: '1',
        food_name: 'Sept 7 late meal (outside Tokyo Sept 8)',
        calories: 500,
        protein: 30,
        carbs: 40,
        fat: 10,
        fiber: 5,
        logged_at: '2026-09-07T14:59:59.999Z', // 23:59:59.999 Sept 7 JST
        logged_date: null,
      },
      {
        id: '2',
        food_name: 'Sept 8 midnight breakfast (inside Tokyo Sept 8)',
        calories: 400,
        protein: 25,
        carbs: 50,
        fat: 10,
        fiber: 4,
        logged_at: '2026-09-07T15:00:00.000Z', // 00:00:00.000 Sept 8 JST
        logged_date: null,
      },
      {
        id: '3',
        food_name: 'Sept 8 midday lunch',
        calories: 700,
        protein: 45,
        carbs: 60,
        fat: 20,
        fiber: 8,
        logged_at: '2026-09-08T03:00:00.000Z', // 12:00:00.000 Sept 8 JST
        logged_date: null,
      },
      {
        id: '4',
        food_name: 'Sept 8 late night snack',
        calories: 300,
        protein: 20,
        carbs: 20,
        fat: 5,
        fiber: 2,
        logged_at: '2026-09-08T14:59:59.999Z', // 23:59:59.999 Sept 8 JST
        logged_date: null,
      },
      {
        id: '5',
        food_name: 'Sept 9 breakfast (outside Tokyo Sept 8, despite UTC Sept 8 prefix)',
        calories: 600,
        protein: 35,
        carbs: 50,
        fat: 15,
        fiber: 5,
        logged_at: '2026-09-08T23:00:00.000Z', // 08:00:00.000 Sept 9 JST
        logged_date: null,
      },
    ];

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', { data: mockLogs, error: null }) as any;
      }
      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });

    const { result } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-tokyo',
          selectedDate: targetDate,
          timeZone,
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.nutritionLogs.length).toBe(5);
    });

    // Re-expressed removal-counter under the new contract:
    // The server query returns a 3-day superset window (5 mock logs spanning boundaries).
    // The authoritative client filter strips rows from adjacent days (IDs 1 and 5)
    // using normalizeDateStr fallback for legacy null-logged_date rows, leaving exactly IDs 2, 3, 4.
    expect(result.current.nutritionLogs.length - result.current.todayLogs.length).toBe(2);
    // Expected order matches .order('logged_at', { ascending: false }): latest logs first (4, 3, 2)
    expect(result.current.todayLogs.map((l) => l.id)).toEqual(['4', '3', '2']);
    expect(result.current.dailyTotals.calories).toBe(400 + 700 + 300);
    expect(result.current.dailyTotals.protein).toBe(25 + 45 + 20);
    expect(result.current.dailyTotals.carbs).toBe(50 + 60 + 20);
    expect(result.current.dailyTotals.fat).toBe(10 + 20 + 5);
    expect(result.current.dailyTotals.fiber).toBe(4 + 8 + 2);
  });

  it('(a) three-way agreement: places travelled meal (logged_date: 2026-09-21, logged_at: 2026-09-22T01:00:00Z) on 2026-09-21 in Asia/Tokyo', async () => {
    const targetDate = '2026-09-21';
    const timeZone = 'Asia/Tokyo';

    const mockLogs = [
      {
        id: 'travel-meal-1',
        user_id: 'user-travel',
        food_name: 'Travel Meal',
        meal_type: 'dinner',
        calories: 500,
        protein: 30,
        carbs: 40,
        fat: 10,
        fiber: 5,
        serving_size: 1,
        serving_unit: 'serving',
        logged_date: '2026-09-21',
        logged_at: '2026-09-22T01:00:00Z',
        created_at: '2026-09-22T01:00:00Z',
        has_components: false,
      },
    ];

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', { data: mockLogs, error: null }) as any;
      }
      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });

    const { result } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-travel',
          selectedDate: targetDate,
          timeZone,
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.nutritionLogs.length).toBe(1);
    });

    expect(result.current.todayLogs).toHaveLength(1);
    expect(result.current.todayLogs[0].id).toBe('travel-meal-1');
    expect(result.current.todayLogs[0].logged_date).toBe('2026-09-21');
    expect(result.current.dailyTotals.calories).toBe(500);
  });

  it('(b) legacy NULL row: log with logged_date null remains visible on the day its logged_at implies in viewer zone', async () => {
    const targetDate = '2026-09-21';
    const timeZone = 'America/New_York';

    // 20:00 EDT on 2026-09-21 is 2026-09-22T00:00:00Z in UTC.
    // In America/New_York (UTC-4 in September), this falls on 2026-09-21.
    const mockLogs = [
      {
        id: 'legacy-null-log',
        user_id: 'user-legacy',
        food_name: 'Legacy Dinner',
        meal_type: 'dinner',
        calories: 550,
        protein: 40,
        carbs: 45,
        fat: 15,
        fiber: 6,
        serving_size: 1,
        serving_unit: 'serving',
        logged_date: null,
        logged_at: '2026-09-22T00:00:00Z',
        created_at: '2026-09-22T00:00:00Z',
        has_components: false,
      },
    ];

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', { data: mockLogs, error: null }) as any;
      }
      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });

    const { result } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-legacy',
          selectedDate: targetDate,
          timeZone,
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.nutritionLogs.length).toBe(1);
    });

    expect(result.current.todayLogs).toHaveLength(1);
    expect(result.current.todayLogs[0].id).toBe('legacy-null-log');
    expect(result.current.dailyTotals.calories).toBe(550);
  });

  it('(c) no double-counting: logs from selectedDate - 1 and selectedDate + 1 are excluded from todayLogs and do not contribute to dailyTotals', async () => {
    const timeZone = 'Asia/Tokyo';
    // 3 logs returned by the widened 3-day superset fetch:
    // logPrev has logged_date = 2026-09-20. Its logged_at (2026-09-21T01:00:00Z = 10:00 JST Sep 21)
    // would falsely match selectedDate = 2026-09-21 under the old isWithinDayBounds filter!
    const logPrev = {
      id: 'log-prev',
      user_id: 'user-dc',
      food_name: 'Previous Day Meal (logged in Hawaii)',
      meal_type: 'dinner',
      calories: 300,
      protein: 20,
      carbs: 30,
      fat: 10,
      fiber: 2,
      serving_size: 1,
      serving_unit: 'serving',
      logged_date: '2026-09-20',
      logged_at: '2026-09-21T01:00:00Z',
      created_at: '2026-09-21T01:00:00Z',
      has_components: false,
    };
    const logToday = {
      id: 'log-today',
      user_id: 'user-dc',
      food_name: 'Today Lunch',
      meal_type: 'lunch',
      calories: 500,
      protein: 35,
      carbs: 50,
      fat: 15,
      fiber: 5,
      serving_size: 1,
      serving_unit: 'serving',
      logged_date: '2026-09-21',
      logged_at: '2026-09-21T05:00:00Z',
      created_at: '2026-09-21T05:00:00Z',
      has_components: false,
    };
    // logNext has logged_date = 2026-09-22. Its logged_at (2026-09-21T14:00:00Z = 23:00 JST Sep 21)
    // would also falsely match selectedDate = 2026-09-21 under the old isWithinDayBounds filter!
    const logNext = {
      id: 'log-next',
      user_id: 'user-dc',
      food_name: 'Next Day Early Meal',
      meal_type: 'breakfast',
      calories: 400,
      protein: 25,
      carbs: 45,
      fat: 12,
      fiber: 4,
      serving_size: 1,
      serving_unit: 'serving',
      logged_date: '2026-09-22',
      logged_at: '2026-09-21T14:00:00Z',
      created_at: '2026-09-21T14:00:00Z',
      has_components: false,
    };

    const mockLogs = [logPrev, logToday, logNext];

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', { data: mockLogs, error: null }) as any;
      }
      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });

    // 1. Query for selectedDate = 2026-09-21:
    // Must contain ONLY logToday. logPrev and logNext must be EXCLUDED.
    const { result: resToday } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-dc',
          selectedDate: '2026-09-21',
          timeZone,
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(resToday.current.nutritionLogs.length).toBe(3);
    });

    expect(resToday.current.todayLogs).toHaveLength(1);
    expect(resToday.current.todayLogs[0].id).toBe('log-today');
    expect(resToday.current.dailyTotals.calories).toBe(500);

    // 2. Query for selectedDate = 2026-09-20:
    // Must contain ONLY logPrev.
    const { result: resPrev } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-dc',
          selectedDate: '2026-09-20',
          timeZone,
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(resPrev.current.todayLogs).toHaveLength(1);
    });
    expect(resPrev.current.todayLogs[0].id).toBe('log-prev');
    expect(resPrev.current.dailyTotals.calories).toBe(300);

    // 3. Query for selectedDate = 2026-09-22:
    // Must contain ONLY logNext.
    const { result: resNext } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-dc',
          selectedDate: '2026-09-22',
          timeZone,
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(resNext.current.todayLogs).toHaveLength(1);
    });
    expect(resNext.current.todayLogs[0].id).toBe('log-next');
    expect(resNext.current.dailyTotals.calories).toBe(400);
  });

  it('scaleLogMutation: refetches items before scaling when items are omitted and updates database', async () => {
    const mockDetailLog = {
      id: 'log-detail-1',
      items: [
        {
          id: 'item-1',
          name: 'Brown Rice',
          quantity: 200,
          unit: 'g',
          calories: 220,
          protein: 5,
          carbs: 45,
          fat: 2,
          fiber: 4,
        },
      ],
      calories: 220,
      protein: 5,
      carbs: 45,
      fat: 2,
      fiber: 4,
    };

    let capturedUpdatedData: any = null;

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        const builder = createSupabaseBuilder('nutrition_logs', {
          resolver: (b: any) => {
            if (b.projection === 'id, items, calories, protein, carbs, fat, fiber') {
              return mockDetailLog;
            }
            if (b.updatedData) {
              capturedUpdatedData = b.updatedData;
              return { data: [b.updatedData], error: null };
            }
            return [];
          },
        });
        return builder as any;
      }
      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });

    const { result } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-scale-1',
          selectedDate: '2026-09-16',
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    // Call scaleLogMutation without items -> triggers detail refetch
    await result.current.scaleLogMutation.mutateAsync({
      log: {
        id: 'log-detail-1',
        user_id: 'user-scale-1',
        food_name: 'Rice Bowl',
        calories: 220,
        protein: 5,
        carbs: 45,
        fat: 2,
        fiber: 4,
        logged_at: '2026-09-16T12:00:00.000Z',
      },
    });

    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection: 'id, items, calories, protein, carbs, fat, fiber',
    });
    expect(capturedUpdatedData).not.toBeNull();
    expect(capturedUpdatedData.calories).toBe(220);
    expect(capturedUpdatedData.items).toHaveLength(1);
  });

  it('scaleLogMutation: throws error when attempting to rescale a meal without component items', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', {
          resolver: (b: any) => {
            if (b.projection === 'id, items, calories, protein, carbs, fat, fiber') {
              return { id: 'log-no-items', items: null, calories: 100, protein: 0, carbs: 0, fat: 0, fiber: 0 };
            }
            return [];
          },
        }) as any;
      }
      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });

    const { result } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-scale-2',
          selectedDate: '2026-09-16',
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    await expect(
      result.current.scaleLogMutation.mutateAsync({
        log: {
          id: 'log-no-items',
          user_id: 'user-scale-2',
          food_name: 'Mystery Meal',
          calories: 100,
          protein: 0,
          carbs: 0,
          fat: 0,
          fiber: 0,
          logged_at: '2026-09-16T12:00:00.000Z',
        },
      })
    ).rejects.toThrow('Cannot rescale a meal without component items');
  });

  it('scaleLogMutation: prevents data loss by refusing to persist zero macros for non-zero meal', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });

    const { result } = renderHook(
      () =>
        useNutritionData({
          targetUserId: 'user-scale-3',
          selectedDate: '2026-09-16',
          profile: null,
          onMutationSuccessReset: vi.fn(),
          setStatus: vi.fn(),
          setIsError: vi.fn(),
        }),
      { wrapper }
    );

    const zeroCalorieItem = [
      {
        id: 'water-item',
        name: 'Diet Water',
        quantity: 1,
        unit: 'unit' as const,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
      },
    ];

    await expect(
      result.current.scaleLogMutation.mutateAsync({
        log: {
          id: 'log-nonzero-1',
          user_id: 'user-scale-3',
          food_name: 'Hearty Soup',
          calories: 350,
          protein: 20,
          carbs: 30,
          fat: 10,
          fiber: 5,
          logged_at: '2026-09-16T12:00:00.000Z',
        },
        items: zeroCalorieItem,
      })
    ).rejects.toThrow('Refusing to persist zero macros for non-zero meal: data loss prevented');
  });

  describe('todayLogs day filter timezone boundary correctness', () => {
    const targetDate = '2026-09-17';
    const testTimezones = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Pacific/Auckland'];

    it.each(testTimezones)(
      'rejects zero valid records returned by query across 24 hourly timestamps in %s',
      async (tz) => {
        // Generate 24 hourly timestamps + 23:59:59.999 end-of-day boundary
        const timestamps: string[] = [];
        for (let hour = 0; hour < 24; hour++) {
          const utcMs = localCivilToUtcMs(2026, 9, 17, hour, 0, 0, 0, tz);
          timestamps.push(new Date(utcMs).toISOString());
        }
        const endDayMs = localCivilToUtcMs(2026, 9, 17, 23, 59, 59, 999, tz);
        timestamps.push(new Date(endDayMs).toISOString());

        // 1. isWithinDayBounds preserves 100% of the 25 records.
        //    NOTE: the hook no longer calls isWithinDayBounds -- it keys on
        //    `logged_date || normalizeDateStr(logged_at, tz)`. These fixtures carry no
        //    `logged_date`, so they take the legacy fallback, where the two agree by
        //    construction. This step therefore pins that equivalence, NOT the hook's
        //    current mechanism. Rows WITH `logged_date` are covered in
        //    src/utils/nutritionDayGrouping.test.ts describe block (c).
        for (const ts of timestamps) {
          expect(isWithinDayBounds(ts, targetDate, tz)).toBe(true);
        }

        // 2. Component integration via useNutritionData (ordered descending to match .order('logged_at', { ascending: false }))
        const descTimestamps = [...timestamps].reverse();
        const mockLogs = descTimestamps.map((ts, idx) => ({
          id: `log-${tz}-${24 - idx}`,
          user_id: 'user-tz-test',
          food_name: `Meal hour ${24 - idx}`,
          meal_type: 'snack',
          calories: 100,
          protein: 10,
          carbs: 10,
          fat: 2,
          fiber: 1,
          serving_size: 1,
          serving_unit: 'serving',
          logged_at: ts,
          created_at: ts,
          has_components: false,
        }));

        vi.mocked(supabase.from).mockImplementation((table: string) => {
          if (table === 'nutrition_logs') {
            return createSupabaseBuilder('nutrition_logs', { data: mockLogs, error: null }) as any;
          }
          return createSupabaseBuilder(table, { data: [], error: null }) as any;
        });

        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: 'user-tz-test',
              selectedDate: targetDate,
              timeZone: tz,
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        await waitFor(() => {
          expect(result.current.nutritionLogs.length).toBe(25);
        });

        // Defensive check rejects zero valid records: exactly 25/25 records retained in todayLogs
        expect(result.current.todayLogs.length).toBe(25);
        expect(result.current.todayLogs.map((l) => l.id)).toEqual(mockLogs.map((l) => l.id));
        expect(result.current.dailyTotals.calories).toBe(25 * 100);
      }
    );

    it('NC: naive new Date().toDateString() drops 23:59:59 record with differing UTC date, while defensive check preserves it', () => {
      const tz = 'America/New_York';
      // 23:59:59 EDT on 2026-09-17 is 2026-09-18T03:59:59.000Z in UTC
      const lateNightUtcMs = localCivilToUtcMs(2026, 9, 17, 23, 59, 59, 0, tz);
      const lateNightIso = new Date(lateNightUtcMs).toISOString();

      // Verify the UTC calendar date is indeed next day (2026-09-18)
      expect(lateNightIso.startsWith('2026-09-18')).toBe(true);

      const lateNightLog = {
        id: 'log-late-night',
        user_id: 'user-tz-test',
        food_name: 'Late Night Snack',
        meal_type: 'snack',
        calories: 250,
        protein: 15,
        carbs: 20,
        fat: 5,
        fiber: 2,
        serving_size: 1,
        serving_unit: 'serving',
        logged_at: lateNightIso,
        created_at: lateNightIso,
        has_components: false,
      };

      // 1. Prove naive check FAILS (drops the record)
      // The naive check compares local or UTC date string against targetDate '2026-09-17'
      const naiveIsToday = (iso: string, target: string) => {
        // naive comparison as previously done in old code:
        // new Date(iso).toDateString() === new Date(target).toDateString() in UTC context
        const logUtcDate = new Date(iso).toISOString().slice(0, 10);
        return logUtcDate === target;
      };
      expect(naiveIsToday(lateNightLog.logged_at, targetDate)).toBe(false);

      // 2. Prove fixed defensive check PASSES (preserves the record)
      expect(isWithinDayBounds(lateNightLog.logged_at, targetDate, tz)).toBe(true);
    });
  });

  describe('fetchDishDetail resolution order and offline handling (§D-OFF-5b, O2)', () => {
    const mockDishId = 'dish-test-101';
    const mockUserId = 'user-dish-test';
    const leanDish = {
      id: mockDishId,
      user_id: mockUserId,
      name: 'Custom Oatmeal',
      calories: 350,
      protein: 20,
      carbs: 50,
      fat: 6,
      fiber: 5,
    };
    const fullDishDetail = {
      ...leanDish,
      kind: 'food' as const,
      use_count: 5,
      notes: 'Steel cut',
      items: [
        {
          name: 'Oats',
          quantity: 1,
          unit: 'cup',
          calories: 300,
          protein: 15,
          carbs: 45,
          fat: 5,
          fiber: 4,
        },
      ],
      ingredients: null,
    };

    it('resolves from list cache if items are present on the list entry', async () => {
      queryClient.setQueryData(['custom_dishes', mockUserId], [fullDishDetail]);

      const { result } = renderHook(
        () =>
          useNutritionData({
            targetUserId: mockUserId,
            selectedDate: '2026-10-01',
            profile: null,
            onMutationSuccessReset: vi.fn(),
            setStatus: vi.fn(),
            setIsError: vi.fn(),
          }),
        { wrapper }
      );

      vi.mocked(supabase.from).mockClear();
      const detail = await result.current.fetchDishDetail(mockDishId);
      expect(detail).toEqual(fullDishDetail);
      expect(supabase.from).not.toHaveBeenCalledWith('custom_dishes');
    });

    it('resolves from "full" cache when list entry lacks items', async () => {
      // List query has lean dish without items
      queryClient.setQueryData(['custom_dishes', mockUserId], [leanDish]);
      // Full cache has full dish detail with items
      queryClient.setQueryData(['custom_dishes', mockUserId, 'full'], [fullDishDetail]);

      const { result } = renderHook(
        () =>
          useNutritionData({
            targetUserId: mockUserId,
            selectedDate: '2026-10-01',
            profile: null,
            onMutationSuccessReset: vi.fn(),
            setStatus: vi.fn(),
            setIsError: vi.fn(),
          }),
        { wrapper }
      );

      vi.mocked(supabase.from).mockClear();
      const detail = await result.current.fetchDishDetail(mockDishId);
      expect(detail).toEqual(fullDishDetail);
      expect(supabase.from).not.toHaveBeenCalledWith('custom_dishes');
    });

    it('stages a cached custom dish offline using full cache fallback', async () => {
      const originalOnLine = navigator.onLine;
      try {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

        // List query has lean dish
        queryClient.setQueryData(['custom_dishes', mockUserId], [leanDish]);
        // Deferred prefetch populated the 'full' cache
        queryClient.setQueryData(['custom_dishes', mockUserId, 'full'], [fullDishDetail]);

        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: mockUserId,
              selectedDate: '2026-10-01',
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        const detail = await result.current.fetchDishDetail(mockDishId);
        expect(detail).toBeDefined();
        expect(detail?.items).toEqual(fullDishDetail.items);
      } finally {
        Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
      }
    });

    it('throws "Available when online" when offline and dish is not in cache', async () => {
      const originalOnLine = navigator.onLine;
      try {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

        // List has lean dish only, no 'full' cache
        queryClient.setQueryData(['custom_dishes', mockUserId], [leanDish]);
        queryClient.setQueryData(['custom_dishes', mockUserId, 'full'], []);

        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: mockUserId,
              selectedDate: '2026-10-01',
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        await expect(result.current.fetchDishDetail(mockDishId)).rejects.toThrow('Available when online');
      } finally {
        Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
      }
    });

    it('falls back to network when online and dish is not in full cache', async () => {
      const originalOnLine = navigator.onLine;
      try {
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

        vi.mocked(supabase.from).mockImplementation((table: string) => {
          if (table === 'custom_dishes') {
            return createSupabaseBuilder(table, { data: fullDishDetail, error: null });
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        // List has lean dish only, no full cache
        queryClient.setQueryData(['custom_dishes', mockUserId], [leanDish]);

        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: mockUserId,
              selectedDate: '2026-10-01',
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        const detail = await result.current.fetchDishDetail(mockDishId);
        expect(detail).toEqual(fullDishDetail);
        expect(getRecordedTables()).toContain('custom_dishes');
      } finally {
        Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
      }
    });

    describe('saveCustomDishMutation and cache freshness for staged dish', () => {
      const mockUserId = 'user-test-dish-edit';
      const mockDishId = 'dish-protein-ice-cream';

      const leanDish: CustomDish = {
        id: mockDishId,
        user_id: mockUserId,
        name: 'Protein Ice Cream',
        calories: 609,
        protein: 73.9,
        carbs: 42,
        fat: 16.1,
        fiber: 0,
        kind: 'food',
        use_count: 5,
        notes: null,
        serving_quantity: 1,
        serving_unit: 'unit',
      };

      const fullDishDetail: CustomDishDetail = {
        ...leanDish,
        items: [
          {
            id: 'item-1',
            name: 'Protein Ice Cream',
            quantity: 1,
            unit: 'unit',
            displayPortion: '1 unit',
            calories: 609,
            protein: 73.9,
            carbs: 42,
            fat: 16.1,
            fiber: 0,
          },
        ],
        ingredients: null,
      };

      it('updates full cache on dish edit so fetchDishDetail returns fresh values (online and offline)', async () => {
        queryClient.setQueryData(['custom_dishes', mockUserId], [leanDish]);
        queryClient.setQueryData(['custom_dishes', mockUserId, 'full'], [fullDishDetail]);

        const updatedDishDetail: CustomDishDetail = {
          ...leanDish,
          calories: 627,
          protein: 76,
          serving_quantity: 595,
          serving_unit: 'g',
          items: [
            {
              id: 'item-1',
              name: 'Protein Ice Cream',
              quantity: 595,
              unit: 'g',
              displayPortion: '595 g',
              calories: 627,
              protein: 76,
              carbs: 42,
              fat: 16.1,
              fiber: 0,
            },
          ],
        };

        const updatedLeanDish: CustomDish = {
          ...leanDish,
          calories: 627,
          protein: 76,
          serving_quantity: 595,
          serving_unit: 'g',
        };

        vi.mocked(supabase.from).mockImplementation((table: string) => {
          const b = createSupabaseBuilder(table, {
            resolver: (builder: any) => {
              if (builder.projection === 'id, items, ingredients, kind, notes') {
                return updatedDishDetail;
              }
              return [updatedLeanDish];
            },
          });
          b.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [updatedDishDetail], error: null }),
            }),
          });
          return b as any;
        });

        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: mockUserId,
              selectedDate: '2026-10-01',
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        // Perform edit mutation
        await act(async () => {
          await result.current.saveCustomDishMutation.mutateAsync({
            dishPayload: {
              name: 'Protein Ice Cream',
              calories: 627,
              protein: 76,
              carbs: 42,
              fat: 16.1,
              fiber: 0,
              items: updatedDishDetail.items,
            },
            editingDishId: mockDishId,
          });
        });

        // Online fetchDishDetail should return the NEW edited values
        const freshOnline = await result.current.fetchDishDetail(mockDishId);
        expect(freshOnline?.items?.[0].quantity).toBe(595);
        expect(freshOnline?.items?.[0].unit).toBe('g');
        expect(freshOnline?.items?.[0].calories).toBe(627);
        expect(freshOnline?.items?.[0].protein).toBe(76);

        // Offline fetchDishDetail should ALSO return the NEW edited values from cache
        const originalOnLine = navigator.onLine;
        try {
          Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
          const freshOffline = await result.current.fetchDishDetail(mockDishId);
          expect(freshOffline?.items?.[0].quantity).toBe(595);
          expect(freshOffline?.items?.[0].unit).toBe('g');
          expect(freshOffline?.items?.[0].calories).toBe(627);
          expect(freshOffline?.items?.[0].protein).toBe(76);
        } finally {
          Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
        }
      });

      it('updates full cache on edit for a dish without items', async () => {
        const dishNoItemsId = 'dish-no-items-1';
        const initialNoItems: CustomDishDetail = {
          id: dishNoItemsId,
          user_id: mockUserId,
          name: 'Simple Oats',
          calories: 300,
          protein: 10,
          carbs: 50,
          fat: 5,
          fiber: 4,
          kind: 'food',
          use_count: 1,
          notes: null,
          items: null,
          ingredients: null,
        };

        queryClient.setQueryData(['custom_dishes', mockUserId], [initialNoItems]);
        queryClient.setQueryData(['custom_dishes', mockUserId, 'full'], [initialNoItems]);

        const updatedNoItems: CustomDishDetail = {
          ...initialNoItems,
          calories: 350,
          protein: 12,
        };

        const updatedLeanNoItems: CustomDish = {
          id: dishNoItemsId,
          user_id: mockUserId,
          name: 'Simple Oats',
          calories: 350,
          protein: 12,
          carbs: 50,
          fat: 5,
          fiber: 4,
          kind: 'food',
          use_count: 1,
          notes: null,
          serving_quantity: null,
          serving_unit: null,
        };

        vi.mocked(supabase.from).mockImplementation((table: string) => {
          const b = createSupabaseBuilder(table, {
            resolver: (builder: any) => {
              if (builder.projection === 'id, items, ingredients, kind, notes') {
                return updatedNoItems;
              }
              return [updatedLeanNoItems];
            },
          });
          b.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [updatedNoItems], error: null }),
            }),
          });
          return b as any;
        });

        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: mockUserId,
              selectedDate: '2026-10-01',
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        await act(async () => {
          await result.current.saveCustomDishMutation.mutateAsync({
            dishPayload: {
              name: 'Simple Oats',
              calories: 350,
              protein: 12,
              items: null,
            },
            editingDishId: dishNoItemsId,
          });
        });

        const freshDetail = await result.current.fetchDishDetail(dishNoItemsId);
        expect(freshDetail?.calories).toBe(350);
        expect(freshDetail?.protein).toBe(12);
        expect(freshDetail?.items).toBeNull();
      });

      it('evicts dish from full cache on deleteCustomDishMutation', async () => {
        queryClient.setQueryData(['custom_dishes', mockUserId, 'full'], [fullDishDetail]);

        vi.mocked(supabase.from).mockImplementation((table: string) => {
          const b = createSupabaseBuilder(table, { data: [], error: null });
          b.delete = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          });
          return b as any;
        });

        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: mockUserId,
              selectedDate: '2026-10-01',
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        await act(async () => {
          await result.current.deleteCustomDishMutation.mutateAsync(mockDishId);
        });

        const cachedFull = queryClient.getQueryData<CustomDishDetail[]>(['custom_dishes', mockUserId, 'full']);
        expect(cachedFull?.find((d) => d.id === mockDishId)).toBeUndefined();
      });

      it('populates full cache on edit when full cache is initially absent', async () => {
        // Full cache is initially absent (undefined)
        expect(queryClient.getQueryData(['custom_dishes', mockUserId, 'full'])).toBeUndefined();

        const updatedDishDetail: CustomDishDetail = {
          ...leanDish,
          calories: 627,
          protein: 76,
          serving_quantity: 595,
          serving_unit: 'g',
          items: [
            {
              id: 'item-1',
              name: 'Protein Ice Cream',
              quantity: 595,
              unit: 'g',
              displayPortion: '595 g',
              calories: 627,
              protein: 76,
              carbs: 42,
              fat: 16.1,
              fiber: 0,
            },
          ],
        };

        vi.mocked(supabase.from).mockImplementation((table: string) => {
          const builder = createSupabaseBuilder(table, { data: [updatedDishDetail], error: null });
          builder.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [updatedDishDetail], error: null }),
            }),
          });
          return builder as any;
        });

        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: mockUserId,
              selectedDate: '2026-10-01',
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        await act(async () => {
          await result.current.saveCustomDishMutation.mutateAsync({
            dishPayload: {
              name: 'Protein Ice Cream',
              calories: 627,
              protein: 76,
              carbs: 42,
              fat: 16.1,
              fiber: 0,
              items: updatedDishDetail.items,
            },
            editingDishId: mockDishId,
          });
        });

        // Full cache must now be populated with the saved dish
        const fullCache = queryClient.getQueryData<CustomDishDetail[]>(['custom_dishes', mockUserId, 'full']);
        expect(fullCache).toBeDefined();
        expect(fullCache?.length).toBe(1);
        expect(fullCache?.[0].id).toBe(mockDishId);
        expect(fullCache?.[0].calories).toBe(627);

        // Fetching detail resolves immediately from the freshly populated full cache
        const freshDetail = await result.current.fetchDishDetail(mockDishId);
        expect(freshDetail?.calories).toBe(627);
        expect(freshDetail?.items?.[0].quantity).toBe(595);
      });

      it('clears items on edit when server row lacks items without keeping stale items', async () => {
        // Seed full cache and list cache with multi-item dish
        queryClient.setQueryData(['custom_dishes', mockUserId], [leanDish]);
        queryClient.setQueryData(['custom_dishes', mockUserId, 'full'], [fullDishDetail]);

        // Server row returned on update has items: null (e.g. converted to simple food)
        const updatedServerRow: CustomDishDetail = {
          ...leanDish,
          name: 'Protein Shake Simple',
          calories: 400,
          protein: 50,
          items: null,
          ingredients: null,
          serving_quantity: null,
          serving_unit: null,
        };

        const updatedLean: CustomDish = {
          id: mockDishId,
          user_id: mockUserId,
          name: 'Protein Shake Simple',
          calories: 400,
          protein: 50,
          carbs: 42,
          fat: 16.1,
          fiber: 0,
          kind: 'food',
          use_count: 5,
          notes: null,
          serving_quantity: null,
          serving_unit: null,
        };

        vi.mocked(supabase.from).mockImplementation((table: string) => {
          const builder = createSupabaseBuilder(table, {
            resolver: (innerBuilder: any) => {
              if (innerBuilder.projection === 'id, items, ingredients, kind, notes') {
                return updatedServerRow;
              }
              return [updatedLean];
            },
          });
          builder.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [updatedServerRow], error: null }),
            }),
          });
          return builder as any;
        });

        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: mockUserId,
              selectedDate: '2026-10-01',
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        await act(async () => {
          await result.current.saveCustomDishMutation.mutateAsync({
            dishPayload: {
              name: 'Protein Shake Simple',
              calories: 400,
              protein: 50,
              items: null,
            },
            editingDishId: mockDishId,
          });
        });

        // Detail in full cache must NOT retain the stale items from before the edit
        const freshDetail = await result.current.fetchDishDetail(mockDishId);
        expect(freshDetail?.name).toBe('Protein Shake Simple');
        expect(freshDetail?.calories).toBe(400);
        expect(freshDetail?.items).toBeNull();
        expect(freshDetail?.items).not.toEqual(fullDishDetail.items);

        // List cache must also have cleared serving size derived from items
        const listCache = queryClient.getQueryData<CustomDish[]>(['custom_dishes', mockUserId]);
        const listEntry = listCache?.find((dish) => dish.id === mockDishId);
        expect(listEntry?.serving_quantity).toBeNull();
      });

      it('evicts old dish on delete and registers new dish when recreated with same name', async () => {
        const originalDishId = 'dish-protein-bowl-old';
        const newDishId = 'dish-protein-bowl-new';
        const dishName = 'Acai Protein Bowl';

        const originalDish: CustomDishDetail = {
          id: originalDishId,
          user_id: mockUserId,
          name: dishName,
          calories: 350,
          protein: 20,
          carbs: 45,
          fat: 8,
          fiber: 6,
          kind: 'food',
          use_count: 2,
          notes: null,
          items: null,
          ingredients: null,
        };

        const recreatedDish: CustomDishDetail = {
          id: newDishId,
          user_id: mockUserId,
          name: dishName,
          calories: 420,
          protein: 28,
          carbs: 50,
          fat: 10,
          fiber: 7,
          kind: 'food',
          use_count: 0,
          notes: null,
          items: null,
          ingredients: null,
        };

        // Seed cache with original dish
        queryClient.setQueryData(['custom_dishes', mockUserId], [originalDish]);
        queryClient.setQueryData(['custom_dishes', mockUserId, 'full'], [originalDish]);

        vi.mocked(supabase.from).mockImplementation((table: string) => {
          const builder = createSupabaseBuilder(table, { data: [], error: null });
          builder.delete = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          });
          builder.insert = vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: [recreatedDish], error: null }),
          });
          return builder as any;
        });

        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: mockUserId,
              selectedDate: '2026-10-01',
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        // 1. Delete original dish
        await act(async () => {
          await result.current.deleteCustomDishMutation.mutateAsync(originalDishId);
        });

        // Full and list cache should no longer have original dish
        const fullAfterDelete = queryClient.getQueryData<CustomDishDetail[]>(['custom_dishes', mockUserId, 'full']);
        expect(fullAfterDelete?.find((dish) => dish.id === originalDishId)).toBeUndefined();
        const listAfterDelete = queryClient.getQueryData<CustomDish[]>(['custom_dishes', mockUserId]);
        expect(listAfterDelete?.find((dish) => dish.id === originalDishId)).toBeUndefined();

        // 2. Re-create dish with identical name
        await act(async () => {
          await result.current.saveCustomDishMutation.mutateAsync({
            dishPayload: {
              name: dishName,
              calories: 420,
              protein: 28,
              carbs: 50,
              fat: 10,
              fiber: 7,
            },
          });
        });

        // Full cache contains new dish ID with fresh macros, not old ID
        const fullAfterRecreate = queryClient.getQueryData<CustomDishDetail[]>(['custom_dishes', mockUserId, 'full']);
        expect(fullAfterRecreate?.find((dish) => dish.id === originalDishId)).toBeUndefined();
        const newInFull = fullAfterRecreate?.find((dish) => dish.id === newDishId);
        expect(newInFull).toBeDefined();
        expect(newInFull?.name).toBe(dishName);
        expect(newInFull?.calories).toBe(420);

        // Fetching detail by new ID returns recreated dish
        const newDetail = await result.current.fetchDishDetail(newDishId);
        expect(newDetail?.id).toBe(newDishId);
        expect(newDetail?.calories).toBe(420);
      });

      it('enforces cross-user cache isolation when coach views athlete dishes', async () => {
        const coachUserId = 'user-coach-123';
        const athleteUserId = 'user-athlete-456';

        const coachDish: CustomDishDetail = {
          id: 'dish-coach-special',
          user_id: coachUserId,
          name: 'Coach Oatmeal',
          calories: 500,
          protein: 30,
          carbs: 60,
          fat: 10,
          fiber: 8,
          kind: 'food',
          use_count: 10,
          notes: null,
          items: null,
          ingredients: null,
        };

        const athleteDish: CustomDishDetail = {
          id: 'dish-athlete-special',
          user_id: athleteUserId,
          name: 'Athlete Oats',
          calories: 350,
          protein: 20,
          carbs: 45,
          fat: 5,
          fiber: 4,
          kind: 'food',
          use_count: 1,
          notes: null,
          items: null,
          ingredients: null,
        };

        // Seed coach and athlete caches independently
        queryClient.setQueryData(['custom_dishes', coachUserId], [coachDish]);
        queryClient.setQueryData(['custom_dishes', coachUserId, 'full'], [coachDish]);
        queryClient.setQueryData(['custom_dishes', athleteUserId], [athleteDish]);
        queryClient.setQueryData(['custom_dishes', athleteUserId, 'full'], [athleteDish]);

        const updatedAthleteDish: CustomDishDetail = {
          ...athleteDish,
          calories: 380,
          protein: 25,
        };

        vi.mocked(supabase.from).mockImplementation((table: string) => {
          const builder = createSupabaseBuilder(table, { data: [updatedAthleteDish], error: null });
          builder.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [updatedAthleteDish], error: null }),
            }),
          });
          return builder as any;
        });

        // Coach acts on athlete data (targetUserId = athleteUserId)
        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: athleteUserId,
              selectedDate: '2026-10-01',
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        await act(async () => {
          await result.current.saveCustomDishMutation.mutateAsync({
            dishPayload: {
              name: 'Athlete Oats',
              calories: 380,
              protein: 25,
            },
            editingDishId: athleteDish.id,
          });
        });

        // Athlete cache must reflect updated values
        const athleteFull = queryClient.getQueryData<CustomDishDetail[]>(['custom_dishes', athleteUserId, 'full']);
        expect(athleteFull?.find((dish) => dish.id === athleteDish.id)?.calories).toBe(380);

        // Coach cache must remain completely untouched
        const coachFull = queryClient.getQueryData<CustomDishDetail[]>(['custom_dishes', coachUserId, 'full']);
        expect(coachFull?.length).toBe(1);
        expect(coachFull?.[0].id).toBe(coachDish.id);
        expect(coachFull?.[0].calories).toBe(500);

        const coachList = queryClient.getQueryData<CustomDish[]>(['custom_dishes', coachUserId]);
        expect(coachList?.length).toBe(1);
        expect(coachList?.[0].calories).toBe(500);
      });

      it('offline edit queued then staged: rejects offline dish save with "Available when online" and stages cached dish offline', async () => {
        // Seed full cache and list cache with existing dish
        queryClient.setQueryData(['custom_dishes', mockUserId], [leanDish]);
        queryClient.setQueryData(['custom_dishes', mockUserId, 'full'], [fullDishDetail]);

        const originalOnLine = navigator.onLine;
        try {
          Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

          const { result } = renderHook(
            () =>
              useNutritionData({
                targetUserId: mockUserId,
                selectedDate: '2026-10-01',
                profile: null,
                onMutationSuccessReset: vi.fn(),
                setStatus: vi.fn(),
                setIsError: vi.fn(),
              }),
            { wrapper }
          );

          // 1. Offline custom dish edit attempt must reject with "Available when online" (custom dishes require connectivity)
          await expect(
            result.current.saveCustomDishMutation.mutateAsync({
              dishPayload: {
                name: 'Offline Modified Name',
                calories: 999,
              },
              editingDishId: mockDishId,
            })
          ).rejects.toThrow('Available when online');

          // 2. Dish in cache must remain uncorrupted by failed mutation
          const cachedFull = queryClient.getQueryData<CustomDishDetail[]>(['custom_dishes', mockUserId, 'full']);
          expect(cachedFull?.find((dish) => dish.id === mockDishId)?.calories).toBe(609);

          // 3. Staging the dish offline resolves the intact pre-edit cached details
          const offlineDetail = await result.current.fetchDishDetail(mockDishId);
          expect(offlineDetail).toBeDefined();
          expect(offlineDetail?.calories).toBe(609);
          expect(offlineDetail?.items?.[0].quantity).toBe(1);
        } finally {
          Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
        }
      });

      it('offline edit queued then staged: stages freshly edited dish offline immediately without intermediate network fetch', async () => {
        // Seed initial dish in caches
        queryClient.setQueryData(['custom_dishes', mockUserId], [leanDish]);
        queryClient.setQueryData(['custom_dishes', mockUserId, 'full'], [fullDishDetail]);

        const editedDishDetail: CustomDishDetail = {
          ...leanDish,
          calories: 650,
          protein: 80,
          serving_quantity: 600,
          serving_unit: 'g',
          items: [
            {
              id: 'item-1',
              name: 'Protein Ice Cream',
              quantity: 600,
              unit: 'g',
              displayPortion: '600 g',
              calories: 650,
              protein: 80,
              carbs: 45,
              fat: 17,
              fiber: 0,
            },
          ],
        };

        vi.mocked(supabase.from).mockImplementation((table: string) => {
          const builder = createSupabaseBuilder(table, { data: [editedDishDetail], error: null });
          builder.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [editedDishDetail], error: null }),
            }),
          });
          return builder as any;
        });

        const { result } = renderHook(
          () =>
            useNutritionData({
              targetUserId: mockUserId,
              selectedDate: '2026-10-01',
              profile: null,
              onMutationSuccessReset: vi.fn(),
              setStatus: vi.fn(),
              setIsError: vi.fn(),
            }),
          { wrapper }
        );

        // Edit online
        await act(async () => {
          await result.current.saveCustomDishMutation.mutateAsync({
            dishPayload: {
              name: 'Protein Ice Cream',
              calories: 650,
              protein: 80,
              carbs: 45,
              fat: 17,
              fiber: 0,
              items: editedDishDetail.items,
            },
            editingDishId: mockDishId,
          });
        });

        // Immediately transition offline (without any prior online fetchDishDetail call)
        const originalOnLine = navigator.onLine;
        try {
          Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

          // Staging offline must read the write-through updated cache immediately
          const stagedOffline = await result.current.fetchDishDetail(mockDishId);
          expect(stagedOffline).toBeDefined();
          expect(stagedOffline?.calories).toBe(650);
          expect(stagedOffline?.protein).toBe(80);
          expect(stagedOffline?.items?.[0].quantity).toBe(600);
        } finally {
          Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
        }
      });
    });
  });

  describe('triggerToast formatting (STD-DAT-2)', () => {
    it('formats fractional calories to whole kcal in toast detail', () => {
      const mockShowToast = vi.fn();
      vi.spyOn(toastHook, 'useToast').mockReturnValue({
        show: mockShowToast,
        dismiss: vi.fn(),
        activeToast: null,
        offset: 0,
        setOffset: vi.fn(),
      });

      const { result } = renderHook(
        () =>
          useNutritionData({
            targetUserId: 'user-toast-test',
            selectedDate: '2026-10-01',
            profile: null,
            onMutationSuccessReset: vi.fn(),
            setStatus: vi.fn(),
            setIsError: vi.fn(),
          }),
        { wrapper }
      );

      // Invoke triggerToast with fractional calories dish (250.6 kcal -> 251 kcal)
      act(() => {
        result.current.triggerToast(
          { name: 'Rice Bowl', calories: 250.6 },
          { variant: 'updated' }
        );
      });
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ detail: '251 kcal' })
      );

      // Variant 'added'
      act(() => {
        result.current.triggerToast(
          { name: 'Rice Bowl', calories: 250.6 },
          { variant: 'added' }
        );
      });
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ detail: '+251 kcal' })
      );

      // Variant 'logged'
      act(() => {
        result.current.triggerToast(
          { name: 'Rice Bowl', calories: 250.6 },
          { variant: 'logged' }
        );
      });
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ detail: '+251 kcal' })
      );
    });

    it('useMealUpdateToast triggers Updated toast with undo callback and matching copy', () => {
      const mockShowToast = vi.fn();
      vi.spyOn(toastHook, 'useToast').mockReturnValue({
        show: mockShowToast,
        dismiss: vi.fn(),
        activeToast: null,
        offset: undefined,
        setOffset: vi.fn(),
      });

      const { result } = renderHook(() => useMealUpdateToast());
      const onUndo = vi.fn();

      act(() => {
        result.current(
          { name: 'Chicken Salad', calories: 420 },
          {
            variant: 'updated',
            dishName: 'Chicken Salad',
            calories: 420,
            onUndo,
          }
        );
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'undo',
          verb: 'Updated',
          subject: 'Chicken Salad',
          detail: '420 kcal',
          durationMs: 5000,
          onUndo,
          undoAriaLabel: 'Undo update Chicken Salad',
          testId: 'quick-log-toast',
          subjectTestId: 'toast-dish-text',
          undoBtnTestId: 'toast-undo-btn',
          undoSpanTestId: 'undo-add-favorite-btn',
        })
      );
    });
  });
});
