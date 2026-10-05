import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useHistoryData, addDaysCivil } from './useHistoryData';
import { supabase } from '../../lib/supabase';
import {
  createSupabaseBuilder,
  clearMockHistory,
  getRecordedTables,
  getRecordedSelects,
} from '../../test/supabaseBuilderMock';
import { groupNutritionDays } from '../../utils/nutritionDayGrouping';
import { getLocalDateStr } from '../../utils/date';
import type { NutritionLog } from '../../types/database';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('useHistoryData: 14-day window infinite query (H11, D-P5b-2)', () => {
  let queryClient: QueryClient;
  const targetUserId = 'athlete-paging-test';

  const today = getLocalDateStr();
  const dayMinus5 = addDaysCivil(today, -5);
  const dayMinus13 = addDaysCivil(today, -13);
  const dayMinus20 = addDaysCivil(today, -20);
  const dayMinus35 = addDaysCivil(today, -35);

  const mockDbLogs: NutritionLog[] = [
    // Window 1: [today - 13, today]
    {
      id: 'meal-today-1',
      user_id: targetUserId,
      food_name: 'Breakfast Oats',
      meal_type: 'breakfast',
      calories: 400,
      protein: 20,
      carbs: 60,
      fat: 8,
      fiber: 8,
      logged_at: `${today}T08:00:00Z`,
      logged_date: today,
    },
    {
      id: 'meal-today-2',
      user_id: targetUserId,
      food_name: 'Dinner Salmon',
      meal_type: 'dinner',
      calories: 700,
      protein: 50,
      carbs: 10,
      fat: 40,
      fiber: 4,
      logged_at: `${today}T19:00:00Z`,
      logged_date: today,
    },
    {
      id: 'meal-minus5-1',
      user_id: targetUserId,
      food_name: 'Chicken Rice Bowl',
      meal_type: 'lunch',
      calories: 650,
      protein: 45,
      carbs: 70,
      fat: 15,
      fiber: 6,
      logged_at: `${dayMinus5}T12:30:00Z`,
      logged_date: dayMinus5,
    },
    {
      id: 'meal-minus13-1',
      user_id: targetUserId,
      food_name: 'Window 1 Boundary Snack',
      meal_type: 'snack',
      calories: 200,
      protein: 15,
      carbs: 20,
      fat: 5,
      fiber: 3,
      logged_at: `${dayMinus13}T16:00:00Z`,
      logged_date: dayMinus13,
    },
    // Window 2: [today - 27, today - 14]
    {
      id: 'meal-minus20-1',
      user_id: targetUserId,
      food_name: 'Window 2 Lunch',
      meal_type: 'lunch',
      calories: 550,
      protein: 40,
      carbs: 50,
      fat: 18,
      fiber: 5,
      logged_at: `${dayMinus20}T13:00:00Z`,
      logged_date: dayMinus20,
    },
    // Window 3: [today - 41, today - 28] (oldest recorded meal)
    {
      id: 'meal-minus35-1',
      user_id: targetUserId,
      food_name: 'Oldest Benchmark Feast',
      meal_type: 'dinner',
      calories: 900,
      protein: 60,
      carbs: 90,
      fat: 30,
      fiber: 8,
      logged_at: `${dayMinus35}T20:00:00Z`,
      logged_date: dayMinus35,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercises') {
        return createSupabaseBuilder('exercises', {
          data: [
            { id: 'ex-1', name: 'Bench Press', body_parts: ['Chest'], is_master: true },
          ],
          error: null,
        }) as any;
      }

      if (table === 'nutrition_logs') {
        const builder = createSupabaseBuilder('nutrition_logs', {
          resolver: (b: any) => {
            // Probe query: select('logged_date').eq('user_id', ...).lt('logged_date', windowStart)...
            if (b.projection === 'logged_date') {
              const ltFilter = b.filters?.find(
                (f: any) => f.method === 'lt' && f.column === 'logged_date'
              );
              const ltVal = ltFilter?.value;
              const matches = mockDbLogs
                .filter((log) => !ltVal || (log.logged_date && log.logged_date < ltVal))
                .sort((x, y) => (y.logged_date || '').localeCompare(x.logged_date || ''));
              return matches.slice(0, 1).map((m) => ({ logged_date: m.logged_date }));
            }

            // Window query: gte('logged_date', windowStart), lte('logged_date', windowEnd)
            const gteFilter = b.filters?.find(
              (f: any) => f.method === 'gte' && f.column === 'logged_date'
            );
            const lteFilter = b.filters?.find(
              (f: any) => f.method === 'lte' && f.column === 'logged_date'
            );
            const startVal = gteFilter?.value;
            const endVal = lteFilter?.value;

            const matches = mockDbLogs
              .filter((log) => {
                const d = log.logged_date || '';
                if (startVal && d < startVal) return false;
                if (endVal && d > endVal) return false;
                return true;
              })
              .sort((a, b) => (b.logged_date || '').localeCompare(a.logged_date || ''));

            return matches;
          },
        });
        return builder as any;
      }

      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  it('reaches oldest day across multi-page day windows and respects mock fidelity contracts', async () => {
    const { result } = renderHook(() => useHistoryData(targetUserId), { wrapper });

    // Initial load: Page 1 (Window 1: [today - 13, today])
    await waitFor(() => {
      expect(result.current.isNutritionPending).toBe(false);
      expect(result.current.nutritionLogs.length).toBeGreaterThan(0);
    });

    expect(getRecordedTables()).toContain('exercises');
    expect(getRecordedTables()).toContain('nutrition_logs');
    expect(getRecordedSelects()).toContainEqual({
      table: 'exercises',
      projection: 'id, name, body_parts, is_master',
    });
    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection:
        'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
    });
    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection: 'logged_date',
    });

    // Window 1 contains 4 meals (today: 2, dayMinus5: 1, dayMinus13: 1)
    expect(result.current.nutritionLogs).toHaveLength(4);
    expect(result.current.hasMoreNutrition).toBe(true);
    expect(result.current.nutritionLogs.some((m) => m.id === 'meal-minus35-1')).toBe(false);

    // Page 2: Load older days (Window 2: [today - 27, today - 14])
    await result.current.loadMoreNutrition();

    await waitFor(() => {
      expect(result.current.nutritionLogs).toHaveLength(5);
    });
    expect(result.current.nutritionLogs.some((m) => m.id === 'meal-minus20-1')).toBe(true);
    expect(result.current.hasMoreNutrition).toBe(true);

    // Page 3: Load older days (Window 3: [today - 41, today - 28])
    await result.current.loadMoreNutrition();

    await waitFor(() => {
      expect(result.current.nutritionLogs).toHaveLength(6);
    });

    // Reaches the oldest day (dayMinus35)
    expect(result.current.nutritionLogs.some((m) => m.id === 'meal-minus35-1')).toBe(true);

    // Probe beyond Window 3 finds no older row -> hasMoreNutrition becomes false
    expect(result.current.hasMoreNutrition).toBe(false);
  });

  it('guarantees full per-day totals and a day is never split across pages', async () => {
    const { result } = renderHook(() => useHistoryData(targetUserId), { wrapper });

    await waitFor(() => {
      expect(result.current.isNutritionPending).toBe(false);
      expect(result.current.nutritionLogs.length).toBe(4);
    });

    // Grouping by day produces full daily totals
    const days = groupNutritionDays(result.current.nutritionLogs);
    const todayGroup = days.find((d) => d.date === today);

    expect(todayGroup).toBeDefined();
    // Both meals for today are present together
    expect(todayGroup?.meals).toHaveLength(2);
    // Exact totals: 400 + 700 = 1100 kcal, 20 + 50 = 70g P, 60 + 10 = 70g C, 8 + 40 = 48g F
    expect(todayGroup?.totals.calories).toBe(1100);
    expect(todayGroup?.totals.protein).toBe(70);
    expect(todayGroup?.totals.carbs).toBe(70);
    expect(todayGroup?.totals.fat).toBe(48);

    // Boundary dayMinus13 is completely contained in Window 1
    const minus13Group = days.find((d) => d.date === dayMinus13);
    expect(minus13Group).toBeDefined();
    expect(minus13Group?.meals).toHaveLength(1);
    expect(minus13Group?.totals.calories).toBe(200);

    // Next page loads without splitting any day
    await result.current.loadMoreNutrition();
    await waitFor(() => {
      expect(result.current.nutritionLogs).toHaveLength(5);
    });

    const updatedDays = groupNutritionDays(result.current.nutritionLogs);
    // Boundary dayMinus13 is still intact and not duplicated
    const minus13After = updatedDays.filter((d) => d.date === dayMinus13);
    expect(minus13After).toHaveLength(1);
    expect(minus13After[0].meals).toHaveLength(1);

    // Window 2 dayMinus20 is fully present
    const minus20Group = updatedDays.find((d) => d.date === dayMinus20);
    expect(minus20Group).toBeDefined();
    expect(minus20Group?.meals).toHaveLength(1);
    expect(minus20Group?.totals.calories).toBe(550);
  });

  it('exhaustively returns all visible exercises via paging when catalog has > 1000 items', async () => {
    const manyExercises = Array.from({ length: 1050 }, (_, i) => ({
      id: `ex-${i}`,
      name: `Exercise ${String(i).padStart(4, '0')}`,
      body_parts: ['Chest'],
      is_master: true,
    }));

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercises') {
        return createSupabaseBuilder('exercises', {
          data: manyExercises,
          error: null,
        }) as any;
      }
      return createSupabaseBuilder(table, { data: [], error: null }) as any;
    });

    const { result } = renderHook(() => useHistoryData(targetUserId), { wrapper });

    await waitFor(() => {
      expect(result.current.exercises).toHaveLength(1050);
    });

    expect(result.current.exercises[0].name).toBe('Exercise 0000');
    expect(result.current.exercises[1049].name).toBe('Exercise 1049');
  });
});
