import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../context/AuthContext';
import { CoachProvider } from '../context/CoachContext';
import { MemoryRouter } from 'react-router-dom';
import { HistoryView } from '../components/history/HistoryView';
import { supabase } from '../lib/supabase';
import { createSupabaseBuilder } from './supabaseBuilderMock';
import type { NutritionLog } from '../types/database';

/**
 * Scaffolding for History behavioural tests.
 *
 * References:
 * - HISTORY_AUDIT_REPORT.md line 105:
 *   "Chips, search and category behaviour have no tests (only CSS class / placeholder checks) |
 *    Tests | HistoryView.test.tsx:231,1907-1922; Virtualization.test.tsx:201 V-s |
 *    Add behavioural tests (see acceptance)"
 * - HISTORY_AUDIT_REPORT.md line 255:
 *   "B0 Test infra | Test scaffolding | ... Land first so the other batches' tests
 *    actually exercise the caps and timezones. Other batches add new test files only; nobody edits
 *    HistoryView.test.tsx except B2."
 *
 * Provides shared render helpers, fixture factories, RPC mocks, and user interaction helpers.
 */

export interface MockWorkoutSession {
  id: string;
  date: string;
  name: string;
  set_count: number;
  total_volume: number;
  sets?: MockSet[];
}

export interface MockSet {
  id: string;
  workout_id: string;
  exercise_id: string;
  weight: number;
  reps: number;
  set_index: number;
  rpe?: number;
  created_at: string;
  workouts?: { date: string; name: string };
  exercise?: { id: string; name: string; body_parts: string[] };
}

export interface MockExerciseStat {
  exercise_id: string;
  set_count: number;
  max_weight: number;
  pr_reps: number;
  recent_sets: any[];
}

export interface MockExercise {
  id: string;
  name: string;
  body_parts: string[];
  is_master?: boolean;
}

export function createMockExercise(overrides: Partial<MockExercise> = {}): MockExercise {
  return {
    id: overrides.id || `ex-${Math.random().toString(36).substring(2, 9)}`,
    name: overrides.name || 'Barbell Bench Press',
    body_parts: overrides.body_parts || ['Chest'],
    is_master: overrides.is_master ?? true,
  };
}

export function createMockWorkoutSession(overrides: Partial<MockWorkoutSession> = {}): MockWorkoutSession {
  return {
    id: overrides.id || `w-${Math.random().toString(36).substring(2, 9)}`,
    date: overrides.date || new Date().toISOString(),
    name: overrides.name || 'Upper Body Power',
    set_count: overrides.set_count ?? (overrides.sets?.length || 3),
    total_volume: overrides.total_volume ?? 1500,
    sets: overrides.sets || [],
  };
}

export function createMockSet(overrides: Partial<MockSet> = {}): MockSet {
  return {
    id: overrides.id || `s-${Math.random().toString(36).substring(2, 9)}`,
    workout_id: overrides.workout_id || 'w-default',
    exercise_id: overrides.exercise_id || 'ex-default',
    weight: overrides.weight ?? 135,
    reps: overrides.reps ?? 10,
    set_index: overrides.set_index ?? 0,
    created_at: overrides.created_at || new Date().toISOString(),
    workouts: overrides.workouts,
    exercise: overrides.exercise,
  };
}

export function createMockExerciseStat(overrides: Partial<MockExerciseStat> = {}): MockExerciseStat {
  return {
    exercise_id: overrides.exercise_id || 'ex-default',
    set_count: overrides.set_count ?? 10,
    max_weight: overrides.max_weight ?? 225,
    pr_reps: overrides.pr_reps ?? 5,
    recent_sets: overrides.recent_sets || [],
  };
}

export function createMockNutritionLog(overrides: Partial<NutritionLog> = {}): NutritionLog {
  const ts = overrides.logged_at || new Date().toISOString();
  return {
    id: overrides.id || `log-${Math.random().toString(36).substring(2, 9)}`,
    user_id: overrides.user_id || 'test-athlete-id',
    food_name: overrides.food_name || 'Chicken and Brown Rice',
    meal_type: overrides.meal_type || 'lunch',
    calories: overrides.calories ?? 650,
    protein: overrides.protein ?? 50,
    carbs: overrides.carbs ?? 70,
    fat: overrides.fat ?? 15,
    fiber: overrides.fiber ?? 8,
    serving_size: overrides.serving_size ?? 1,
    serving_unit: overrides.serving_unit || 'serving',
    logged_at: ts,
    logged_date: overrides.logged_date ?? ts.split('T')[0],
    created_at: overrides.created_at || ts,
    has_components: overrides.has_components ?? false,
    ...overrides,
  } as NutritionLog;
}

/**
 * Creates boundary sessions around -29, -30, and -31 days relative to referenceDate,
 * used for testing date filter chips (30d boundary acceptance).
 */
export function createBoundarySessions(referenceDate: Date = new Date()): MockWorkoutSession[] {
  const refMs = referenceDate.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const session29 = createMockWorkoutSession({
    id: 'session-29d',
    name: 'Session 29 Days Ago',
    date: new Date(refMs - 29 * dayMs).toISOString(),
    set_count: 3,
    total_volume: 1200,
  });

  const session30 = createMockWorkoutSession({
    id: 'session-30d',
    name: 'Session 30 Days Ago',
    date: new Date(refMs - 30 * dayMs).toISOString(),
    set_count: 4,
    total_volume: 1600,
  });

  const session31 = createMockWorkoutSession({
    id: 'session-31d',
    name: 'Session 31 Days Ago',
    date: new Date(refMs - 31 * dayMs).toISOString(),
    set_count: 5,
    total_volume: 2000,
  });

  return [session29, session30, session31];
}

export interface SetupHistoryOptions {
  exercises?: MockExercise[];
  sessions?: MockWorkoutSession[];
  stats?: MockExerciseStat[];
  nutritionLogs?: NutritionLog[];
  user?: any;
}

export function setupHistoryMocks(options: SetupHistoryOptions = {}) {
  const exercises = options.exercises || [
    createMockExercise({ id: 'ex-1', name: 'Barbell Bench Press', body_parts: ['Chest'] }),
    createMockExercise({ id: 'ex-2', name: 'Barbell Squat', body_parts: ['Legs'] }),
    createMockExercise({ id: 'ex-3', name: 'Deadlift', body_parts: ['Back'] }),
  ];
  const sessions = options.sessions || [];
  const stats = options.stats || [];
  const nutritionLogs = options.nutritionLogs || [];
  const user = options.user || {
    id: 'test-athlete-id',
    email: 'athlete@example.com',
    username: 'athlete_1',
    role: 'athlete',
    target_calories: 2200,
    target_protein: 160,
    target_carbs: 220,
    target_fat: 65,
    target_fiber: 30,
    timezone: 'UTC',
  };

  (supabase.auth.getUser as any).mockResolvedValue({ data: { user } });
  (supabase.auth.getSession as any).mockResolvedValue({
    data: { session: { user, access_token: 'mock-token' } },
  });

  (supabase.from as any).mockImplementation((table: string) => {
    if (table === 'exercises') {
      return createSupabaseBuilder('exercises', { data: exercises, error: null });
    }
    if (table === 'workouts') {
      return createSupabaseBuilder('workouts', { data: sessions, error: null });
    }
    if (table === 'sets') {
      const allSets = sessions.flatMap((s) => s.sets || []);
      return createSupabaseBuilder('sets', { data: allSets, error: null });
    }
    if (table === 'nutrition_logs') {
      return createSupabaseBuilder('nutrition_logs', { data: nutritionLogs, error: null });
    }
    if (table === 'users') {
      return createSupabaseBuilder('users', { data: user, error: null });
    }
    if (table === 'coach_athlete_links') {
      return createSupabaseBuilder('coach_athlete_links', { data: [], error: null });
    }
    return createSupabaseBuilder(table, { data: [], error: null });
  });

  (supabase.rpc as any).mockImplementation((fn: string) => {
    if (fn === 'get_history_sessions_v2') {
      const rows = sessions.map((s: any) => ({
        ...s,
        civil_date: s.civil_date || (s.date ? String(s.date).split('T')[0] : ''),
        total_count: sessions.length,
      }));
      return Promise.resolve({ data: rows, error: null });
    }
    if (fn === 'get_exercise_stats') {
      return Promise.resolve({ data: stats, error: null });
    }
    return Promise.resolve({ data: [], error: null });
  });
}

export function renderHistoryView(customQueryClient?: QueryClient) {
  const queryClient = customQueryClient || new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        AuthProvider,
        null,
        React.createElement(
          CoachProvider,
          null,
          React.createElement(
            MemoryRouter,
            { initialEntries: ['/history'] },
            React.createElement(HistoryView, null)
          )
        )
      )
    )
  );
}

// User interaction helpers for behavioural testing
export function clickTimeRangeChip(range: 'all' | '90d' | '30d' | '1y') {
  const chip = screen.getByTestId(`history-range-${range}`);
  fireEvent.click(chip);
  return chip;
}

export function searchExercisesInput(text: string) {
  const input = screen.getByPlaceholderText('Search exercise library...') as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  return input;
}

export function toggleHistoryDomain(domain: 'workouts' | 'nutrition') {
  const btn = screen.getByTestId(`history-tab-${domain}`);
  fireEvent.click(btn);
  return btn;
}

export function toggleWorkoutViewMode(mode: 'session' | 'exercise') {
  const label = mode === 'session' ? 'By Session' : 'By Exercise';
  const btn = screen.getByText(label);
  fireEvent.click(btn);
  return btn;
}
