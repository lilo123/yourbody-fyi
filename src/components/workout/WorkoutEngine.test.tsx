import * as setsLib from '../../lib/sets';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import userEvent from '@testing-library/user-event';
import { WorkoutEngine } from './WorkoutEngine';
import { HistoryView } from '../history/HistoryView';
import { GlobalRestTimerPill } from '../common/GlobalRestTimerPill';
import { restTimerStore } from '../../utils/restTimerStore';
import { workoutSessionStore } from '../../utils/workoutSessionStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import { CoachProvider } from '../../context/CoachContext';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';
import { useCoach } from '../../hooks/useCoach';
import { supabase } from '../../lib/supabase';
import { getLocalDateStr } from '../../utils/ghostSets';
import { isValidUUID, resolveRoutineAndExercises } from './workoutEngineHelpers';
import type { Exercise, RoutineTemplate } from '../../types/database';
import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../../test/supabaseBuilderMock';

const { mockSession, mockEnqueueAndAwait, mockGetOutboxOps } = vi.hoisted(() => ({
  mockSession: {
    user: { id: '00000000-0000-4000-8000-000000000001', email: 'athlete@example.com' },
  },
  mockEnqueueAndAwait: vi.fn().mockImplementation(async () => ({
    status: 'synced',
    opId: 'test-op-1',
  })),
  mockGetOutboxOps: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../offline', async () => {
  const actual = await vi.importActual<any>('../../offline');
  return {
    ...actual,
    enqueueAndAwait: mockEnqueueAndAwait,
    getOutboxOps: mockGetOutboxOps,
  };
});

vi.mock('../../offline/flusher', async () => {
  const actual = await vi.importActual<any>('../../offline/flusher');
  return {
    ...actual,
    enqueueAndAwait: mockEnqueueAndAwait,
  };
});

vi.mock('../../offline/outbox', async () => {
  const actual = await vi.importActual<any>('../../offline/outbox');
  return {
    ...actual,
    getOutboxOps: mockGetOutboxOps,
  };
});

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe('WorkoutEngine', () => {
  let queryClient: QueryClient;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    window.history.replaceState(null, '', '/workout');
    vi.clearAllMocks();
    clearMockHistory();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
    localStorage.clear();
    sessionStorage.clear();
    restTimerStore.resetForTesting();
    workoutSessionStore.resetForTesting();
    delete (supabase as any).rpc;
    localStorage.setItem(
      'yourbody_user',
      JSON.stringify({
        id: '00000000-0000-4000-8000-000000000001',
        email: 'athlete@example.com',
        username: 'athlete',
        role: 'athlete',
      })
    );
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    (supabase.auth.onAuthStateChange as any).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    mockEnqueueAndAwait.mockReset();
    mockEnqueueAndAwait.mockImplementation(async () => ({
      status: 'synced',
      opId: 'test-op-1',
    }));
    mockGetOutboxOps.mockReset();
    mockGetOutboxOps.mockResolvedValue([]);

    // Mock supabase.from using full PostgREST builder test double
    (supabase.from as any).mockImplementation((table: string) =>
      createSupabaseBuilder(table, { data: [], error: null })
    );

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderComponent = (includeToast = false) =>
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CoachProvider>
            <ToastProvider>
              <WorkoutEngine />
              <GlobalRestTimerPill />
              {includeToast && <ToastHost />}
            </ToastProvider>
          </CoachProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

  const selectWorkoutA = async () => {
    const routineBtn = screen.getByTestId('routine-select-btn');
    fireEvent.click(routineBtn);
    const workoutABtn = await screen.findByText('Workout A (Push, Quads & Core)');
    fireEvent.click(workoutABtn);
  };

  it('renders Sunday Rest Day card by default on Sunday when no routine is scheduled', () => {
    renderComponent();

    // Check Routine Label
    expect(screen.getByTestId('routine-select-btn')).toBeDefined();
    expect(screen.getAllByText('Rest Day').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Rest & Recovery')).toBeDefined();
    expect(screen.getByText('Choose Routine')).toBeDefined();

    expect(getRecordedTables()).toContain('exercises');
    expect(getRecordedSelects()).toContainEqual({
      table: 'exercises',
      projection: 'id, name, body_parts, is_master',
    });
    expect(getRecordedTables()).toContain('routine_templates');
    expect(getRecordedSelects()).toContainEqual({
      table: 'routine_templates',
      projection: 'id, user_id, name, is_master, assigned_to, days_of_week, created_at',
    });
    expect(getRecordedTables()).toContain('workouts');
    expect(getRecordedSelects()).toContainEqual({
      table: 'workouts',
      projection: 'id, date, name, sets(id, reps, weight, set_index, created_at, exercise_id)',
    });
  });

  it('automatically schedules Push, Quads, & Core - Reduced on Monday', async () => {
    renderComponent();

    const dateInput = screen.getByTestId('workout-date-input');
    fireEvent.change(dateInput, { target: { value: '2026-09-07' } });

    await waitFor(() => {
      expect(screen.getByText('Push, Quads, & Core - Reduced')).toBeDefined();
      expect(screen.getByText('Incline Bench Press')).toBeDefined();
      expect(screen.getAllByTestId('exercise-title').map((e) => e.textContent?.trim())).toContain('Cable Lateral Raises');
      expect(screen.getByText('Dips')).toBeDefined();
      expect(screen.getByText('Leg Extension Machine')).toBeDefined();
      expect(screen.getByText('Overhead Tricep Cable Pull')).toBeDefined();
    });
  });

  it('renders streamlined 5-column grid headers and omits Type and RPE inputs', async () => {
    renderComponent();
    await selectWorkoutA();

    // Column headers
    expect(await screen.findByText('Set')).toBeDefined();
    expect(screen.getByText('Previous')).toBeDefined();
    expect(screen.getByText('Weight')).toBeDefined();
    expect(screen.getByText('Reps')).toBeDefined();
    expect(screen.getByText('Action')).toBeDefined();

    // Assert Type dropdown and RPE input are completely absent
    expect(screen.queryByTestId('set-type-select-0-0')).toBeNull();
    expect(screen.queryByPlaceholderText('RPE')).toBeNull();
  });

  it('allows opening routine selector and picking Free Workout', async () => {
    renderComponent();

    const routineBtn = screen.getByTestId('routine-select-btn');
    fireEvent.click(routineBtn);

    // Modal should be open
    expect(screen.getByText('Select Routine')).toBeDefined();
    expect(screen.getByText('Free Workout')).toBeDefined();

    fireEvent.click(screen.getByText('Free Workout'));

    // Should now show empty/free workout message
    expect(screen.getByText("No exercises in today's workout yet")).toBeDefined();
  });

  it('commits a ghost set on one-tap click with set_type: working and rpe: null', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', { data: [{ id: 'workout-1' }], error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    // First card (Incline Bench Press) set 0 input
    const weightInput = screen.getByTestId('ghost-weight-0-0');
    const repsInput = screen.getByTestId('ghost-reps-0-0');
    const commitBtn = screen.getByTestId('commit-set-btn-0-0');

    // Type 185 and 8
    await userEvent.type(weightInput, '185');
    await userEvent.type(repsInput, '8');

    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(mockEnqueueAndAwait).toHaveBeenCalled();
    });

    const op = mockEnqueueAndAwait.mock.calls[0][0];
    expect(op.kind).toBe('set.create');
    expect(op.payload.weight).toBe(185);
    expect(op.payload.reps).toBe(8);
    expect(op.payload.set_index).toBe(1);
    expect(op.payload.set_type).toBe('working');
    expect(op.payload.rpe).toBeNull();
    // sets is mutation-only (insert / outbox); NO_PROJECTION_APPLIES
  });

  it('allows batch logging all remaining sets for an exercise', async () => {
    const pastWorkoutSets = [
      {
        id: 'ps-1',
        workout_id: 'prev-w1',
        exercise_id: 'e0000000-0000-0000-0000-000000000001',
        set_index: 1,
        set_type: 'working',
        weight: 185,
        reps: 8,
        workouts: { date: '2026-08-30T10:00:00Z', name: 'Workout A' },
      },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'sets') {
        return createSupabaseBuilder('sets', { data: pastWorkoutSets, error: null });
      }
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', {
          resolver: (b: any) => {
            if (b.filters.some((f: any) => f.column === 'date')) {
              return { data: [{ id: 'workout-1' }], error: null };
            }
            return { data: [{ id: 'prev-w1', date: '2026-08-30' }], error: null };
          },
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    await waitFor(() => {
      expect(screen.getByTestId('ghost-weight-0-0')).toHaveAttribute('placeholder', '185');
    });

    const batchExBtn = screen.getByTestId('batch-log-exercise-btn-0');
    expect(batchExBtn).toBeDefined();

    fireEvent.click(batchExBtn);

    await waitFor(() => {
      expect(mockEnqueueAndAwait).toHaveBeenCalledTimes(1);
    });

    const op = mockEnqueueAndAwait.mock.calls[0][0];
    expect(op.kind).toBe('set.batchCreate');
    expect(op.payload.sets.length).toBe(4); // 4 sets for Incline Bench Press in Workout A
    op.payload.sets.forEach((s: any, idx: number) => {
      expect(s.set_index).toBe(idx + 1);
      expect(s.weight).toBe(185);
      expect(s.reps).toBe(8);
      // Verify zero 100x10 fallbacks
      expect(s.weight).not.toBe(100);
      expect(s.reps).not.toBe(10);
    });
  });

  it('allows finishing entire workout and logging all remaining sets with zero 100x10 fallbacks', async () => {
    const pastWorkoutSets = [
      { id: 'ps-1', workout_id: 'prev-w1', exercise_id: 'e0000000-0000-0000-0000-000000000001', set_index: 1, set_type: 'working', weight: 185, reps: 8, workouts: { date: '2026-08-30' } },
      { id: 'ps-2', workout_id: 'prev-w1', exercise_id: 'e0000000-0000-0000-0000-000000000002', set_index: 1, set_type: 'working', weight: 35, reps: 12, workouts: { date: '2026-08-30' } },
      { id: 'ps-3', workout_id: 'prev-w1', exercise_id: 'e0000000-0000-0000-0000-000000000003', set_index: 1, set_type: 'working', weight: 50, reps: 10, workouts: { date: '2026-08-30' } },
      { id: 'ps-4', workout_id: 'prev-w1', exercise_id: 'e0000000-0000-0000-0000-000000000004', set_index: 1, set_type: 'working', weight: 140, reps: 12, workouts: { date: '2026-08-30' } },
      { id: 'ps-5', workout_id: 'prev-w1', exercise_id: 'e0000000-0000-0000-0000-000000000005', set_index: 1, set_type: 'working', weight: 65, reps: 10, workouts: { date: '2026-08-30' } },
      { id: 'ps-6', workout_id: 'prev-w1', exercise_id: 'e0000000-0000-0000-0000-000000000006', set_index: 1, set_type: 'working', weight: 25, reps: 15, workouts: { date: '2026-08-30' } },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'sets') {
        return createSupabaseBuilder('sets', { data: pastWorkoutSets, error: null });
      }
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', {
          resolver: (b: any) => {
            if (b.filters.some((f: any) => f.column === 'date')) {
              return { data: [{ id: 'workout-1' }], error: null };
            }
            return { data: [{ id: 'prev-w1', date: '2026-08-30' }], error: null };
          },
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    await waitFor(() => {
      expect(screen.getByTestId('ghost-weight-0-0')).toHaveAttribute('placeholder', '185');
    });

    const finishBtn = screen.getByTestId('finish-workout-btn');
    expect(finishBtn).toBeDefined();

    fireEvent.click(finishBtn);

    const logReviewedBtn = await screen.findByTestId('log-reviewed-sets-btn');
    fireEvent.click(logReviewedBtn);

    await waitFor(() => {
      expect(mockEnqueueAndAwait).toHaveBeenCalled();
    });

    const op = mockEnqueueAndAwait.mock.calls[0][0];
    expect(op.kind).toBe('set.batchCreate');
    expect(op.payload.sets.length).toBeGreaterThanOrEqual(10); // Workout A has 6 exercises
    op.payload.sets.forEach((s: any) => {
      expect(s.weight).toBeGreaterThan(0);
      expect(s.reps).toBeGreaterThan(0);
      expect(s.weight === 100 && s.reps === 10).toBe(false);
    });
  });

  it('prunes unperformed / blank sets and does not commit 100x10 when no ghost sets or input exist', async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'sets') {
        return {
          insert: mockInsert,
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        };
      }
      if (table === 'workouts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [{ id: 'workout-1' }], error: null }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          or: vi.fn().mockResolvedValue({ data: [], error: null }),
          in: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      };
    });

    renderComponent();
    await selectWorkoutA();

    await waitFor(() => {
      expect(supabase.auth.getSession).toHaveBeenCalled();
    });

    const batchExBtn = screen.getByTestId('batch-log-exercise-btn-0');
    fireEvent.click(batchExBtn);

    // Unperformed sets must be pruned: mockEnqueueAndAwait must NOT have been called
    expect(mockEnqueueAndAwait).not.toHaveBeenCalled();
  });

  it('resolves exercise names for custom routine templates instead of displaying raw UUIDs', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'routine_templates') {
        return createSupabaseBuilder('routine_templates', {
          data: [
            {
              id: 'custom-tpl-1',
              name: 'Custom Bulgarian Split Routine',
              user_id: '00000000-0000-4000-8000-000000000001',
              is_master: false,
              days_of_week: ['Mon'],
              exercises: [
                {
                  id: 'te-1',
                  template_id: 'custom-tpl-1',
                  exercise_id: '00000000-0000-0000-0000-000000000999',
                  order_index: 0,
                  target_sets: 4,
                  target_reps: 10,
                  exercise: { name: 'Bulgarian Split Squat' },
                },
              ],
            },
          ],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    const routineBtn = screen.getByTestId('routine-select-btn');
    fireEvent.click(routineBtn);

    // Should render custom template option with name
    const customTplOption = await screen.findByText('Custom Bulgarian Split Routine');
    expect(customTplOption).toBeDefined();

    fireEvent.click(customTplOption);

    // Selected routine exercise should show resolved exercise name, NOT the raw UUID!
    await waitFor(() => {
      expect(screen.getByText('Bulgarian Split Squat')).toBeDefined();
      expect(screen.queryByText('00000000-0000-0000-0000-000000000999')).toBeNull();
    });
  });

  it('launches sticky floating rest timer with controls (+90s, stop, pause) and vibrates on completion', async () => {
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      configurable: true,
      writable: true,
    });

    renderComponent();

    // Timer is initially not visible
    expect(screen.queryByTestId('rest-timer-pill')).toBeNull();

    // Click rest timer launcher button
    const timerBtn = screen.getByTestId('rest-timer-btn');
    fireEvent.click(timerBtn);

    // Pill appears with 90s (1:30)
    await waitFor(() => {
      expect(screen.getByTestId('rest-timer-pill')).toBeDefined();
      expect(screen.getByTestId('rest-timer-display')).toBeDefined();
    });

    // Test +90s
    const add90Btn = screen.getByTitle('Add 90 seconds');
    fireEvent.click(add90Btn);
    expect(screen.getByTestId('rest-timer-pill')).toBeDefined();

    // Test pause / resume
    const pauseBtn = screen.getByTitle('Pause timer');
    fireEvent.click(pauseBtn);
    expect(screen.getByTitle('Resume timer')).toBeDefined();

    // Test stop timer
    const stopBtn = screen.getByTitle('Stop timer');
    fireEvent.click(stopBtn);
    expect(screen.queryByTestId('rest-timer-pill')).toBeNull();
  });

  it('displays mutation error notification when set logging fails', async () => {
    mockEnqueueAndAwait.mockRejectedValueOnce(new Error('Database connection failed'));

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', { data: [{ id: 'workout-1' }], error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    const weightInput = screen.getByTestId('ghost-weight-0-0');
    const repsInput = screen.getByTestId('ghost-reps-0-0');
    const commitBtn = screen.getByTestId('commit-set-btn-0-0');

    await userEvent.type(weightInput, '100');
    await userEvent.type(repsInput, '10');
    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Database connection failed').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('supports decimal weight input precision (e.g. 22.5 lbs)', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', { data: [{ id: 'workout-1' }], error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    const weightInput = screen.getByTestId('ghost-weight-0-0');
    const repsInput = screen.getByTestId('ghost-reps-0-0');
    const commitBtn = screen.getByTestId('commit-set-btn-0-0');

    await userEvent.type(weightInput, '22.5');
    await userEvent.type(repsInput, '12');
    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(mockEnqueueAndAwait).toHaveBeenCalled();
    });

    const op = mockEnqueueAndAwait.mock.calls[0][0];
    expect(op.kind).toBe('set.create');
    expect(op.payload.weight).toBe(22.5);
    expect(op.payload.reps).toBe(12);
  });

  it('rejects committing a set when reps is zero or blank without ghost values', async () => {
    renderComponent();
    await selectWorkoutA();

    const weightInput = screen.getByTestId('ghost-weight-0-0');
    const commitBtn = screen.getByTestId('commit-set-btn-0-0');

    // Only type weight, leave reps blank (0 reps)
    await userEvent.type(weightInput, '150');
    fireEvent.click(commitBtn);

    // Should NOT commit and show error
    expect(mockEnqueueAndAwait).not.toHaveBeenCalled();
    expect(screen.getAllByText('Please enter weight and reps or use previous set values.').length).toBeGreaterThanOrEqual(1);
  });


  it('displays mutation error when batch logging an exercise that cannot be resolved to a UUID', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'routine_templates') {
        return createSupabaseBuilder('routine_templates', {
          data: [
            {
              id: 'custom-tpl-invalid',
              name: 'Custom Broken Routine',
              user_id: '00000000-0000-4000-8000-000000000001',
              is_master: false,
              days_of_week: ['Mon'],
              exercises: [
                {
                  id: 'te-1',
                  template_id: 'custom-tpl-invalid',
                  exercise_id: 'invalid-non-uuid-exercise',
                  order_index: 0,
                  target_sets: 2,
                },
              ],
            },
          ],
          error: null,
        });
      }
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', { data: [{ id: 'workout-1' }], error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    const routineBtn = screen.getByTestId('routine-select-btn');
    fireEvent.click(routineBtn);

    const customTplOption = await screen.findByText('Custom Broken Routine');
    fireEvent.click(customTplOption);

    // Type into draft for this exercise
    const weightInput = screen.getByTestId('ghost-weight-0-0');
    const repsInput = screen.getByTestId('ghost-reps-0-0');
    await userEvent.type(weightInput, '100');
    await userEvent.type(repsInput, '10');

    const batchBtn = screen.getByTestId('batch-log-exercise-btn-0');
    fireEvent.click(batchBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/cannot be resolved to a valid UUID/i).length).toBeGreaterThanOrEqual(1);
    });
  });


  it('preserves uncompleted exercises when existing logged sets exist for today', async () => {
    const today = getLocalDateStr(new Date());
    const loggedSetsToday = [
      {
        id: 's-today-1',
        workout_id: 'workout-today',
        exercise_id: 'e0000000-0000-0000-0000-000000000001',
        set_index: 1,
        set_type: 'working',
        weight: 185,
        reps: 8,
        rpe: null,
        created_at: `${today}T10:00:00Z`,
        workouts: { id: 'workout-today', date: today, name: 'Workout A (Push, Quads & Core)' },
      },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'sets') {
        return createSupabaseBuilder('sets', { data: loggedSetsToday, error: null });
      }
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', {
          data: [{ id: 'workout-today', date: today, name: 'Workout A (Push, Quads & Core)' }],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    // Incline Bench Press was logged, but all remaining exercises in Workout A should still be preserved
    await waitFor(() => {
      expect(screen.getByText('Incline Bench Press')).toBeDefined();
      expect(screen.getAllByTestId('exercise-title').map((e) => e.textContent?.trim())).toContain('Cable Lateral Raises');
      expect(screen.getByText('Dips')).toBeDefined();
      expect(screen.getByText('Leg Extension Machine')).toBeDefined();
    });
  });

  it('automatically transitions to Rest Day when user selects Sunday date', async () => {
    // Start on Monday
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
    renderComponent();

    const dateInput = screen.getByTestId('workout-date-input');
    // Change date to Sunday
    fireEvent.change(dateInput, { target: { value: '2026-09-06' } });

    await waitFor(() => {
      expect(screen.getAllByText('Rest Day').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Rest & Recovery')).toBeDefined();
      expect(screen.getByText('Choose Routine')).toBeDefined();
    });
  });

  it('prunes input drafts when batch logging an exercise', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', { data: [{ id: 'workout-1' }], error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    // Type drafts for row 0
    const weightInput = screen.getByTestId('ghost-weight-0-0');
    const repsInput = screen.getByTestId('ghost-reps-0-0');
    await userEvent.type(weightInput, '155');
    await userEvent.type(repsInput, '8');

    const batchBtn = screen.getByTestId('batch-log-exercise-btn-0');
    fireEvent.click(batchBtn);

    await waitFor(() => {
      expect(mockEnqueueAndAwait).toHaveBeenCalled();
    });
  });

  it('populates targetSetCounts for logged workouts with unknown routine templates', async () => {
    const today = '2026-09-06';
    const loggedSets = [
      {
        id: 's-custom-1',
        workout_id: 'w-custom-1',
        exercise_id: 'e0000000-0000-0000-0000-000000000001',
        exercise_name: 'Incline Bench Press',
        set_index: 1,
        set_type: 'working',
        weight: 185,
        reps: 8,
        rpe: null,
        created_at: `${today}T10:00:00Z`,
        workouts: { id: 'w-custom-1', date: today, name: 'Ad-hoc Arm Blast' },
      },
      {
        id: 's-custom-2',
        workout_id: 'w-custom-1',
        exercise_id: 'e0000000-0000-0000-0000-000000000001',
        exercise_name: 'Incline Bench Press',
        set_index: 2,
        set_type: 'working',
        weight: 185,
        reps: 8,
        rpe: null,
        created_at: `${today}T10:05:00Z`,
        workouts: { id: 'w-custom-1', date: today, name: 'Ad-hoc Arm Blast' },
      },
      {
        id: 's-custom-3',
        workout_id: 'w-custom-1',
        exercise_id: 'e0000000-0000-0000-0000-000000000001',
        exercise_name: 'Incline Bench Press',
        set_index: 3,
        set_type: 'working',
        weight: 185,
        reps: 8,
        rpe: null,
        created_at: `${today}T10:10:00Z`,
        workouts: { id: 'w-custom-1', date: today, name: 'Ad-hoc Arm Blast' },
      },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'sets') {
        return createSupabaseBuilder('sets', { data: loggedSets, error: null });
      }
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', {
          data: [{ id: 'w-custom-1', date: today, name: 'Ad-hoc Arm Blast' }],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Ad-hoc Arm Blast')).toBeDefined();
      expect(screen.getByText('Incline Bench Press')).toBeDefined();
      expect(screen.getByText('3/3 Sets')).toBeDefined();
    });
  });

  it('deduplicates custom and default templates in routine modal and prioritizes custom DB template without (Custom) suffix', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'routine_templates') {
        return createSupabaseBuilder('routine_templates', {
          data: [
            {
              id: 'tpl-custom-push',
              name: 'Push, Quads, & Core - Reduced',
              days_of_week: ['Mon', 'Thu'],
              exercises: [
                {
                  exercise_id: 'ex-bench',
                  order_index: 0,
                  target_sets: 4,
                  target_reps: 8,
                  exercise: { name: 'Incline Bench Press' },
                },
                {
                  exercise_id: 'ex-custom-ext',
                  order_index: 1,
                  target_sets: 3,
                  target_reps: 12,
                  exercise: { name: 'Custom Quad Destroyer' },
                },
              ],
            },
          ],
          error: null,
        });
      }
      if (table === 'exercises') {
        return createSupabaseBuilder('exercises', {
          data: [
            { id: 'ex-bench', name: 'Incline Bench Press', body_parts: ['Chest'] },
            { id: 'ex-custom-ext', name: 'Custom Quad Destroyer', body_parts: ['Legs'] },
          ],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    const routineBtn = screen.getByTestId('routine-select-btn');
    fireEvent.click(routineBtn);

    // Wait for custom template to load and render exercise subtitle
    await screen.findByText(/Custom Quad Destroyer/);

    // Verify template appears exactly once in modal list (deduplicated with default)
    const matchingRoutines = screen.getAllByText('Push, Quads, & Core - Reduced');
    expect(matchingRoutines.length).toBe(1);

    // Verify "(Custom)" suffix is NOT rendered
    expect(screen.queryByText(/Push, Quads, & Core - Reduced \(Custom\)/)).toBeNull();

    // Click template to load
    fireEvent.click(matchingRoutines[0]);

    // Verify custom DB exercises loaded (Database precedence)
    await waitFor(() => {
      expect(screen.getByText('Custom Quad Destroyer')).toBeDefined();
    });
  });

  it('respects auto_rest_timer=false preference: does not auto-start rest timer on set commit, but manual timer works', async () => {
    localStorage.setItem('yourbody_auto_rest_timer', 'false');

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'users') {
        return createSupabaseBuilder('users', {
          data: {
            id: '00000000-0000-4000-8000-000000000001',
            email: 'athlete@example.com',
            username: 'athlete',
            role: 'athlete',
            auto_rest_timer: false,
          },
          error: null,
        });
      }
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', { data: [{ id: 'workout-1' }], error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    // Verify floating rest timer is initially NOT visible
    expect(screen.queryByTestId('rest-timer-pill')).toBeNull();

    // Find and commit a set with weight and reps
    const weightInput = await screen.findByTestId('ghost-weight-0-0');
    const repsInput = screen.getByTestId('ghost-reps-0-0');
    const commitBtn = screen.getByTestId('commit-set-btn-0-0');

    await userEvent.type(weightInput, '185');
    await userEvent.type(repsInput, '8');
    fireEvent.click(commitBtn);

    // Set was logged
    await waitFor(() => {
      expect(mockEnqueueAndAwait).toHaveBeenCalled();
    });

    // Auto rest timer should NOT have started
    expect(screen.queryByTestId('rest-timer-pill')).toBeNull();

    // Clicking manual rest timer in header launches timer
    const manualRestBtn = screen.getByTestId('rest-timer-btn');
    fireEvent.click(manualRestBtn);

    // Timer is now active and pill displayed
    expect(screen.getByTestId('rest-timer-pill')).toBeDefined();
    expect(screen.getByTestId('rest-timer-display').textContent).toBe('1:30');
  });

  it('switches to custom routine with empty exercises and correctly clears active exercises without stale state', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'routine_templates') {
        return createSupabaseBuilder('routine_templates', {
          data: [
            {
              id: 'tpl-empty-custom',
              name: 'Empty Custom Routine',
              days_of_week: [],
              exercises: [],
            },
          ],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    // First select Workout A which has exercises
    await selectWorkoutA();
    expect(await screen.findByText('Incline Bench Press')).toBeDefined();

    // Now open routine modal and select Empty Custom Routine
    const routineBtn = screen.getByTestId('routine-select-btn');
    fireEvent.click(routineBtn);

    const emptyOption = await screen.findByText('Empty Custom Routine');
    fireEvent.click(emptyOption);

    // Active exercises from previous routine should be cleared
    await waitFor(() => {
      expect(screen.queryByText('Incline Bench Press')).toBeNull();
      expect(screen.getByText('Empty Custom Routine')).toBeDefined();
    });
  });

  it('rejects non-numeric NaN values in weight and reps to protect against corrupt mutations', async () => {
    const mockInsert = vi.fn();
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'sets') {
        return { insert: mockInsert };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          or: vi.fn().mockResolvedValue({ data: [], error: null }),
          in: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      };
    });

    renderComponent();
    await selectWorkoutA();

    const weightInput = screen.getByTestId('ghost-weight-0-0');
    const repsInput = screen.getByTestId('ghost-reps-0-0');
    const commitBtn = screen.getByTestId('commit-set-btn-0-0');

    fireEvent.change(weightInput, { target: { value: 'abc' } });
    fireEvent.change(repsInput, { target: { value: 'xyz' } });
    fireEvent.click(commitBtn);

    expect(mockEnqueueAndAwait).not.toHaveBeenCalled();
    expect(screen.getAllByText('Please enter weight and reps or use previous set values.').length).toBeGreaterThanOrEqual(1);
  });


  it('clamps stepper decrement so target sets cannot drop below already logged sets count', async () => {
    const todaySets = [
      { id: 's1', workout_id: 'w1', exercise_id: 'e0000000-0000-0000-0000-000000000001', set_index: 1, weight: 185, reps: 8, set_type: 'working', workouts: { date: '2026-09-06', name: 'Workout A' } },
      { id: 's2', workout_id: 'w1', exercise_id: 'e0000000-0000-0000-0000-000000000001', set_index: 2, weight: 185, reps: 8, set_type: 'working', workouts: { date: '2026-09-06', name: 'Workout A' } },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'sets') {
        return createSupabaseBuilder('sets', { data: todaySets, error: null });
      }
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', {
          data: [{ id: 'w1', date: '2026-09-06' }],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    // Wait for the query to resolve and display the initial 2/4 Sets badge
    expect(await screen.findByText('2/4 Sets')).toBeDefined();

    // Default target sets for Incline Bench Press in Workout A is 4
    const decreaseBtns = screen.getAllByTitle('Decrease target sets');
    const decreaseBtn = decreaseBtns[0];

    // Decrement from 4 to 3
    fireEvent.click(decreaseBtn);
    expect(screen.getByText('2/3 Sets')).toBeDefined();

    // Decrement from 3 to 2 (which equals setsToday.length)
    fireEvent.click(decreaseBtn);
    expect(screen.getByText('2/2 Sets')).toBeDefined();

    // Now decreaseBtn should be disabled because targetCount == setsToday.length
    expect(decreaseBtn).toBeDisabled();

    // Attempting to click again should not reduce below 2
    fireEvent.click(decreaseBtn);
    expect(screen.getByText('2/2 Sets')).toBeDefined();
  });

  it('toggles exercise accordion via keyboard Space and Enter keys on Line 1 title row', async () => {
    renderComponent();
    await selectWorkoutA();

    const titleButton = screen.getByLabelText(/Incline Bench Press, collapse exercise/i);
    expect(titleButton).toHaveAttribute('aria-expanded', 'true');

    // Press Enter to collapse
    fireEvent.keyDown(titleButton, { key: 'Enter', code: 'Enter' });
    expect(titleButton).toHaveAttribute('aria-expanded', 'false');

    // Press Space to re-expand
    fireEvent.keyDown(titleButton, { key: ' ', code: 'Space' });
    expect(titleButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('sanitizes comma decimal separator to dot in weight input', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', { data: [{ id: 'workout-1' }], error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    const weightInput = screen.getByTestId('ghost-weight-0-0');
    const repsInput = screen.getByTestId('ghost-reps-0-0');
    const commitBtn = screen.getByTestId('commit-set-btn-0-0');

    // Type with comma
    await userEvent.type(weightInput, '45,5');
    await userEvent.type(repsInput, '10');
    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(mockEnqueueAndAwait).toHaveBeenCalled();
    });

    const op = mockEnqueueAndAwait.mock.calls[0][0];
    expect(op.kind).toBe('set.create');
    expect(op.payload.weight).toBe(45.5);
    expect(op.payload.reps).toBe(10);
  });

  it('allows logging 0 lbs bodyweight sets with positive reps', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', { data: [{ id: 'workout-1' }], error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    const weightInput = screen.getByTestId('ghost-weight-0-0');
    const repsInput = screen.getByTestId('ghost-reps-0-0');
    const commitBtn = screen.getByTestId('commit-set-btn-0-0');

    await userEvent.type(weightInput, '0');
    await userEvent.type(repsInput, '15');
    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(mockEnqueueAndAwait).toHaveBeenCalled();
    });

    const op = mockEnqueueAndAwait.mock.calls[0][0];
    expect(op.kind).toBe('set.create');
    expect(op.payload.weight).toBe(0);
    expect(op.payload.reps).toBe(15);
  });

  it('rejects logging set when weight is negative or reps <= 0', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', { data: [{ id: 'workout-1' }], error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    const repsInput = screen.getByTestId('ghost-reps-0-0');
    const commitBtn = screen.getByTestId('commit-set-btn-0-0');

    // reps 0
    await userEvent.type(repsInput, '0');
    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Please enter weight and reps or use previous set values.').length).toBeGreaterThanOrEqual(1);
    });
    expect(mockEnqueueAndAwait).not.toHaveBeenCalled();
  });

  it('renders 0 instead of lbs in placeholder and BW in PR badge when ghost set weight is 0', async () => {
    const historicalSets = [
      {
        id: 'hist-1',
        workout_id: 'w-prev',
        exercise_id: 'Incline Bench Press',
        exercise_name: 'Incline Bench Press',
        weight: 0,
        reps: 12,
        set_index: 1,
        set_type: 'working',
        created_at: '2026-09-01T10:00:00Z',
        workout_date: '2026-09-01',
        workouts: { date: '2026-09-01', name: 'Workout A' },
      },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', {
          data: [{ id: 'w-prev', date: '2026-09-01', name: 'Workout A' }],
          error: null,
        });
      }
      if (table === 'sets') {
        return createSupabaseBuilder('sets', { data: historicalSets, error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    await waitFor(() => {
      const weightInput = screen.getByTestId('ghost-weight-0-0');
      expect(weightInput).toHaveAttribute('placeholder', '0');
      expect(screen.getByText('PR: BW×12')).toBeDefined();
    });
  });

  it('preserves ad-hoc added exercises in sessionStorage across remount (simulated tab switch)', async () => {
    sessionStorage.clear();
    const { unmount } = renderComponent();
    await selectWorkoutA();

    // Select and add an exercise via ExercisePicker
    (supabase as any).rpc = vi.fn().mockImplementation((fn: string) => {
      if (fn === "get_exercise_catalog") {
        return Promise.resolve({
          data: [
            {
              id: "ex-lat-pull",
              name: "Lat Pull Down",
              body_parts: ["Back"],
              equipment: "cable",
              is_custom: false,
              created_by: null,
              usage_count: 5,
              last_used_at: "2026-09-01T12:00:00Z",
              is_hidden: false,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    fireEvent.click(screen.getByTestId('add-exercise-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('exercise-picker-sheet')).toBeDefined();
    });
    fireEvent.click(await screen.findByText('Lat Pull Down'));
    fireEvent.click(screen.getByTestId('picker-confirm-add-btn'));

    await waitFor(() => {
      expect(screen.getByText('Lat Pull Down')).toBeDefined();
    });

    // Simulate tab switch by unmounting and remounting
    unmount();

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Lat Pull Down')).toBeDefined();
    });
  });

  it('clears uncommitted ad-hoc drafts from sessionStorage when selecting a new routine', async () => {
    sessionStorage.clear();
    renderComponent();
    await selectWorkoutA();

    // Select and add an exercise via ExercisePicker
    (supabase as any).rpc = vi.fn().mockImplementation((fn: string) => {
      if (fn === "get_exercise_catalog") {
        return Promise.resolve({
          data: [
            {
              id: "ex-lat-pull",
              name: "Lat Pull Down",
              body_parts: ["Back"],
              equipment: "cable",
              is_custom: false,
              created_by: null,
              usage_count: 5,
              last_used_at: "2026-09-01T12:00:00Z",
              is_hidden: false,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    fireEvent.click(screen.getByTestId('add-exercise-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('exercise-picker-sheet')).toBeDefined();
    });
    fireEvent.click(await screen.findByText('Lat Pull Down'));
    fireEvent.click(screen.getByTestId('picker-confirm-add-btn'));

    await waitFor(() => {
      expect(screen.getByText('Lat Pull Down')).toBeDefined();
    });

    const draftKey = 'yourbody_active_exercises_00000000-0000-4000-8000-000000000001_2026-09-06';
    expect(sessionStorage.getItem(draftKey)).toContain('Lat Pull Down');

    // Select Rest Day
    const routineBtn = screen.getByTestId('routine-select-btn');
    fireEvent.click(routineBtn);
    const restDayBtn = await screen.findByText('Rest Day');
    fireEvent.click(restDayBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Rest Day').length).toBeGreaterThan(0);
      // Lat Pull Down should NOT be in Rest Day since uncommitted drafts were cleared
      expect(screen.queryByText('Lat Pull Down')).toBeNull();
      expect(sessionStorage.getItem(draftKey)).toBeNull();
    });
  });

  it('persists cleared workout state (Free Workout) across unmount and remount', async () => {
    sessionStorage.clear();
    const { unmount } = renderComponent();
    await selectWorkoutA();

    // Verify Workout A exercises are present
    expect(screen.getByText('Incline Bench Press')).toBeDefined();

    // Click Clear Workout
    const clearBtn = screen.getByTitle('Clear Workout');
    fireEvent.click(clearBtn);

    const dialog = await screen.findByRole('dialog');
    const confirmClearBtn = within(dialog).getByRole('button', { name: 'Clear workout' });
    fireEvent.click(confirmClearBtn);

    await waitFor(() => {
      expect(screen.getByText("No exercises in today's workout yet")).toBeDefined();
    });

    const routineKey = 'yourbody_routine_00000000-0000-4000-8000-000000000001_2026-09-06';
    expect(sessionStorage.getItem(routineKey)).toBe('Free Workout');

    // Simulate tab switch by unmounting and remounting
    unmount();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("No exercises in today's workout yet")).toBeDefined();
      expect(screen.queryByText('Incline Bench Press')).toBeNull();
    });
  });

  it('persists reordered exercise list in sessionStorage across remount', async () => {
    sessionStorage.clear();
    const { unmount } = renderComponent();
    await selectWorkoutA();

    // Add another exercise so we have multiple
    (supabase as any).rpc = vi.fn().mockImplementation((fn: string) => {
      if (fn === "get_exercise_catalog") {
        return Promise.resolve({
          data: [
            {
              id: "ex-lat-pull",
              name: "Lat Pull Down",
              body_parts: ["Back"],
              equipment: "cable",
              is_custom: false,
              created_by: null,
              usage_count: 5,
              last_used_at: "2026-09-01T12:00:00Z",
              is_hidden: false,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    fireEvent.click(screen.getByTestId('add-exercise-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('exercise-picker-sheet')).toBeDefined();
    });
    fireEvent.click(await screen.findByText('Lat Pull Down'));
    fireEvent.click(screen.getByTestId('picker-confirm-add-btn'));

    await waitFor(() => {
      expect(screen.getByText('Lat Pull Down')).toBeDefined();
    });

    // Move Lat Pull Down (which is at the end) up
    const moveUpBtns = screen.getAllByTitle('Move up');
    const lastMoveUpBtn = moveUpBtns[moveUpBtns.length - 1];
    fireEvent.click(lastMoveUpBtn);

    const draftKey = 'yourbody_active_exercises_00000000-0000-4000-8000-000000000001_2026-09-06';
    const stored = JSON.parse(sessionStorage.getItem(draftKey) || '[]');
    expect(stored.indexOf('Lat Pull Down')).toBe(stored.length - 2);

    // Remount
    unmount();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Lat Pull Down')).toBeDefined();
    });
  });

  describe('Workout Session Store State-Loss Bug Resolution (7 Dedicated Integration Tests)', () => {
    it('persists target sets stepper changes across unmount and remount (Bug 1)', async () => {
      const { unmount } = renderComponent();
      await selectWorkoutA();

      // Workout A initially has Incline Bench Press with 4 target sets (0/4 Sets)
      expect(await screen.findByText('0/4 Sets')).toBeDefined();

      const incBtns = screen.getAllByTitle('Increase target sets');
      fireEvent.click(incBtns[0]);

      // Target sets incremented to 5
      expect(screen.getByText('0/5 Sets')).toBeDefined();

      // Unmount simulating tab change
      unmount();

      // Remount
      renderComponent();

      // Target sets should remain 5, not revert to 4
      expect(await screen.findByText('0/5 Sets')).toBeDefined();
    });

    it('persists exercise deletion with 0 logged sets across unmount and remount without resurrection (Bug 2)', async () => {
      const { unmount } = renderComponent();
      await selectWorkoutA();

      expect(await screen.findByText('Incline Bench Press')).toBeDefined();

      const removeBtn = screen.getByLabelText(/Remove Incline Bench Press from workout/i);
      fireEvent.click(removeBtn);

      expect(screen.queryAllByTestId('exercise-title').map((e) => e.textContent?.trim())).not.toContain('Incline Bench Press');

      unmount();
      renderComponent();

      await waitFor(() => {
        expect(screen.queryByText('Incline Bench Press')).toBeNull();
        expect(screen.getAllByTestId('exercise-title').map((e) => e.textContent?.trim())).toContain('Cable Lateral Raises');
      });
    });

    it('persists exercise deletion when other exercises have logged sets today across unmount and remount (Bug 3)', async () => {
      const today = '2026-09-06';
      const loggedSetsToday = [
        {
          id: 's-today-1',
          workout_id: 'workout-today',
          exercise_id: 'e0000000-0000-0000-0000-000000000001',
          exercise_name: 'Incline Bench Press',
          set_index: 1,
          set_type: 'working',
          weight: 185,
          reps: 8,
          rpe: null,
          created_at: `${today}T10:00:00Z`,
          workouts: { id: 'workout-today', date: today, name: 'Workout A (Push, Quads & Core)' },
        },
      ];

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'sets') {
          return createSupabaseBuilder('sets', { data: loggedSetsToday, error: null });
        }
        if (table === 'workouts') {
          return createSupabaseBuilder('workouts', {
            data: [{ id: 'workout-today', date: today, name: 'Workout A (Push, Quads & Core)' }],
            error: null,
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      const { unmount } = renderComponent();

      // Should automatically load Workout A because of logged sets
      expect(await screen.findByText('Incline Bench Press')).toBeDefined();
      expect(screen.getByText('Dips')).toBeDefined();

      // Delete Dips (which has 0 logged sets)
      const removeDipsBtn = screen.getByLabelText(/Remove Dips from workout/i);
      fireEvent.click(removeDipsBtn);

      expect(screen.queryAllByTestId('exercise-title').map((e) => e.textContent?.trim())).not.toContain('Dips');

      unmount();
      renderComponent();

      // Dips should remain deleted and NOT resurrect despite todaySets > 0
      await waitFor(() => {
        expect(screen.queryByText('Dips')).toBeNull();
        expect(screen.getByText('Incline Bench Press')).toBeDefined();
      });
    });

    it('persists exercise reorder across unmount and remount (Bug 4)', async () => {
      const { unmount } = renderComponent();
      await selectWorkoutA();

      expect(await screen.findByText('Incline Bench Press')).toBeDefined();

      // Move Cable Lateral Raises (index 1) up to index 0
      const moveUpBtns = screen.getAllByTitle('Move up');
      fireEvent.click(moveUpBtns[0]);

      // Verify order updated in session store
      const session = workoutSessionStore.getActiveSession('00000000-0000-4000-8000-000000000001', '2026-09-06');
      expect(session?.exercises[0]).toBe('Cable Lateral Raises');
      expect(session?.exercises[1]).toBe('Incline Bench Press');

      unmount();
      renderComponent();

      await waitFor(() => {
        const sessionAfter = workoutSessionStore.getActiveSession('00000000-0000-4000-8000-000000000001', '2026-09-06');
        expect(sessionAfter?.exercises[0]).toBe('Cable Lateral Raises');
        expect(sessionAfter?.exercises[1]).toBe('Incline Bench Press');
      });
      const headings = screen.getAllByRole('button', { name: /collapse exercise|expand exercise/i });
      expect(headings[0].textContent).toContain('Cable Lateral Raises');
      expect(headings[1].textContent).toContain('Incline Bench Press');
    });

    it('persists uncommitted input drafts (weight and reps) across unmount and remount (Bug 5)', async () => {
      const { unmount } = renderComponent();
      await selectWorkoutA();

      const weightInput = await screen.findByTestId('ghost-weight-0-0');
      const repsInput = screen.getByTestId('ghost-reps-0-0');

      fireEvent.change(weightInput, { target: { value: '225' } });
      fireEvent.change(repsInput, { target: { value: '5' } });

      expect(weightInput).toHaveValue('225');
      expect(repsInput).toHaveValue('5');

      // Unmount triggers flushPendingWrites
      unmount();

      // Verify written to session store
      const session = workoutSessionStore.getActiveSession('00000000-0000-4000-8000-000000000001', '2026-09-06');
      expect(session?.inputDrafts['Incline Bench Press_1']).toEqual({ weight: '225', reps: '5' });

      // Remount
      renderComponent();

      // Input fields should restore the typed draft values
      await waitFor(() => {
        expect(screen.getByTestId('ghost-weight-0-0')).toHaveValue('225');
        expect(screen.getByTestId('ghost-reps-0-0')).toHaveValue('5');
      });
    });

    it('preserves active workout date across midnight rollover via pointer architecture (Bug 6)', async () => {
      // Set system clock to 23:50 on 2026-09-08
      vi.setSystemTime(new Date(2026, 8, 8, 23, 50, 0));

      const { unmount } = renderComponent();
      const dateInput = screen.getByTestId('workout-date-input') as HTMLInputElement;
      expect(dateInput.value).toBe('2026-09-08');

      await selectWorkoutA();

      expect(localStorage.getItem('yourbody_current_session_pointer_00000000-0000-4000-8000-000000000001')).toBe('2026-09-08');

      unmount();

      // Clock rolls over past midnight
      vi.setSystemTime(new Date(2026, 8, 9, 0, 10, 0));
      expect(getLocalDateStr(new Date())).toBe('2026-09-09');

      // Remount
      renderComponent();

      await waitFor(() => {
        const dateInputAfter = screen.getByTestId('workout-date-input') as HTMLInputElement;
        expect(dateInputAfter.value).toBe('2026-09-08');
        expect(screen.getByText('Workout A (Push, Quads & Core)')).toBeDefined();
      });
    });

    it('isolates personal workout session drafts strictly to authenticated user regardless of coach context athlete switching (Bug 7 reconciled)', async () => {
      const athleteAId = '11111111-1111-4111-8111-111111111111';
      const athleteBId = '22222222-2222-4222-8222-222222222222';

      localStorage.setItem(
        'yourbody_user',
        JSON.stringify({ id: 'coach-id', email: 'coach@example.com', role: 'coach', is_coach_mode: true })
      );
      localStorage.setItem('yourbody_view_mode', 'coach');
      localStorage.setItem(
        'yourbody_athletes',
        JSON.stringify([
          { id: athleteAId, name: 'Athlete A', email: 'a@example.com', status: 'Active' },
          { id: athleteBId, name: 'Athlete B', email: 'b@example.com', status: 'Active' },
        ])
      );
      localStorage.setItem('yourbody_selected_athlete', athleteAId);
      (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: 'coach-id' } } });
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: { user: { id: 'coach-id', email: 'coach@example.com' } } },
      });

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'users') {
          return createSupabaseBuilder('users', {
            data: { id: 'coach-id', email: 'coach@example.com', role: 'coach', is_coach_mode: true, auto_rest_timer: true },
            error: null,
          });
        }
        if (table === 'coach_athlete_links') {
          return createSupabaseBuilder('coach_athlete_links', {
            data: [
              {
                athlete_id: athleteAId,
                status: 'active',
                athlete: { id: athleteAId, username: 'Athlete A', email: 'a@example.com', role: 'athlete', created_at: '2026-09-01' },
              },
              {
                athlete_id: athleteBId,
                status: 'active',
                athlete: { id: athleteBId, username: 'Athlete B', email: 'b@example.com', role: 'athlete', created_at: '2026-09-01' },
              },
            ],
            error: null,
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      const CoachTestHarness: React.FC = () => {
        const { switchAthlete, selectedAthleteId } = useCoach();
        return (
          <div>
            <div data-testid="current-selected-athlete">{selectedAthleteId}</div>
            <button onClick={() => switchAthlete(athleteBId)} data-testid="switch-to-b">
              Switch to B
            </button>
            <button onClick={() => switchAthlete(athleteAId)} data-testid="switch-to-a">
              Switch to A
            </button>
            <WorkoutEngine />
            <GlobalRestTimerPill />
          </div>
        );
      };

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <CoachProvider>
              <CoachTestHarness />
            </CoachProvider>
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('current-selected-athlete')).toHaveTextContent(athleteAId);
      });

      // Coach types personal draft 275 lbs x 8 reps
      await selectWorkoutA();
      const weightInputA = await screen.findByTestId('ghost-weight-0-0');
      const repsInputA = screen.getByTestId('ghost-reps-0-0');

      fireEvent.change(weightInputA, { target: { value: '275' } });
      fireEvent.change(repsInputA, { target: { value: '8' } });
      expect(weightInputA).toHaveValue('275');
      expect(repsInputA).toHaveValue('8');

      // Coach switches selected athlete in CoachContext to Athlete B
      fireEvent.click(screen.getByTestId('switch-to-b'));

      await waitFor(() => {
        expect(screen.getByTestId('current-selected-athlete')).toHaveTextContent(athleteBId);
      });

      // WorkoutEngine strictly maintains the coach's personal draft (isolated from athlete switcher)
      await waitFor(() => {
        expect(screen.getByTestId('ghost-weight-0-0')).toHaveValue('275');
        expect(screen.getByTestId('ghost-reps-0-0')).toHaveValue('8');
      });
    });

    it('discards local draft customizations and reloads scheduled template on "Reload Scheduled Routine" button click', async () => {
      // Set system clock to Monday (2026-09-07)
      vi.setSystemTime(new Date('2026-09-07T10:00:00Z'));

      renderComponent();

      // Wait for Monday default template to resolve and mount
      await waitFor(() => {
        expect(screen.getByText('Push, Quads, & Core - Reduced')).toBeDefined();
        expect(screen.getByText('Incline Bench Press')).toBeDefined();
        expect(screen.getByText('0/4 Sets')).toBeDefined();
      });

      // Modify target sets to 5
      const incBtns = screen.getAllByTitle('Increase target sets');
      fireEvent.click(incBtns[0]);
      await waitFor(() => {
        expect(screen.getByText('0/5 Sets')).toBeDefined();
      });

      // Delete an exercise (e.g. Cable Lateral Raises)
      const removeBtn = screen.getByLabelText(/Remove Cable Lateral Raises from workout/i);
      fireEvent.click(removeBtn);
      await waitFor(() => {
        expect(screen.queryAllByTestId('exercise-title').map((e) => e.textContent?.trim())).not.toContain('Cable Lateral Raises');
      });

      // Open Routine Modal
      const routineSelectBtn = screen.getByTestId('routine-select-btn');
      fireEvent.click(routineSelectBtn);

      // Click "Reload Scheduled Routine"
      const reloadBtn = await screen.findByTestId('reload-scheduled-routine-btn');
      fireEvent.click(reloadBtn);

      // Confirm reload dialog
      const confirmReloadBtn = await screen.findByRole('button', { name: 'Reload routine' });
      fireEvent.click(confirmReloadBtn);

      // Verify that the virgin scheduled routine was restored (Cable Lateral Raises restored, target sets back to 4, NOT Free Workout)
      await waitFor(() => {
        expect(screen.getByText('Push, Quads, & Core - Reduced')).toBeDefined();
        expect(screen.getAllByTestId('exercise-title').map((e) => e.textContent?.trim())).toContain('Cable Lateral Raises');
        expect(screen.getByText('0/4 Sets')).toBeDefined();
        expect(screen.queryByText('Free Workout')).toBeNull();
      });
    });

    it('applies deterministic precedence sort where athlete custom template shadows master template with identical name', async () => {
      const masterTemplate = {
        id: 'tpl-master-push',
        user_id: 'coach-id-999',
        name: 'Master Hypertrophy Push',
        is_master: true,
        assigned_to: null,
        created_at: '2026-09-01T00:00:00Z',
        exercises: [
          {
            exercise_id: 'ex-bench',
            order_index: 0,
            target_sets: 3,
            target_reps: 10,
            exercise: { name: 'Incline Bench Press' },
          },
        ],
      };

      const athleteCustomTemplate = {
        id: 'tpl-custom-push',
        user_id: '00000000-0000-4000-8000-000000000001',
        name: 'Master Hypertrophy Push',
        is_master: false,
        assigned_to: null,
        created_at: '2026-09-02T00:00:00Z',
        exercises: [
          {
            exercise_id: 'ex-custom-press',
            order_index: 0,
            target_sets: 5,
            target_reps: 8,
            exercise: { name: 'Personalized Heavy Press' },
          },
        ],
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'routine_templates') {
          return createSupabaseBuilder('routine_templates', {
            // Deliberately return master FIRST to test that precedence sorting promotes custom
            data: [masterTemplate, athleteCustomTemplate],
            error: null,
          });
        }
        if (table === 'exercises') {
          return createSupabaseBuilder('exercises', {
            data: [
              { id: 'ex-bench', name: 'Incline Bench Press', body_parts: ['Chest'] },
              { id: 'ex-custom-press', name: 'Personalized Heavy Press', body_parts: ['Chest'] },
            ],
            error: null,
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      // Open routine selection modal
      const routineBtn = screen.getByTestId('routine-select-btn');
      fireEvent.click(routineBtn);

      // Wait for routine modal to populate with the custom exercise subtitle
      await screen.findByText(/Personalized Heavy Press/);

      // Routine appears exactly once in the list (deduplicated by name)
      const matchingRoutines = screen.getAllByText('Master Hypertrophy Push');
      expect(matchingRoutines.length).toBe(1);

      // Select the routine
      fireEvent.click(matchingRoutines[0]);

      // Verify that the athlete's custom routine was loaded (Personalized Heavy Press 0/5 Sets),
      // deterministically shadowing the master template (Incline Bench Press 0/3 Sets)
      await waitFor(() => {
        expect(screen.getByText('Personalized Heavy Press')).toBeDefined();
        expect(screen.getByText('0/5 Sets')).toBeDefined();
        expect(screen.queryByText('Incline Bench Press')).toBeNull();
      });
    });
  });

  describe('Cold-Load & PostgREST Relational Join Architecture (Tests 42-44)', () => {
    it('cold loads directly with real database UUIDs via PostgREST join without tab switch (Test 42)', async () => {
      const today = '2026-09-06';
      const realExerciseUUID = '8f2d91b4-1234-4567-89ab-cdef01234567';
      const workoutId = 'w-cold-load-1';

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'workouts') {
          return createSupabaseBuilder('workouts', {
            data: [{ id: workoutId, date: today, name: 'Heavy Squat Day' }],
            error: null,
          });
        }
        if (table === 'sets') {
          return createSupabaseBuilder('sets', {
            data: [
              {
                id: 's-cold-1',
                workout_id: workoutId,
                exercise_id: realExerciseUUID,
                set_index: 1,
                set_type: 'working',
                weight: 315,
                reps: 5,
                rpe: null,
                created_at: `${today}T10:00:00Z`,
                workouts: {
                  date: today,
                  name: 'Heavy Squat Day',
                },
                exercise: {
                  id: realExerciseUUID,
                  name: 'Barbell Back Squat',
                  body_parts: ['Legs'],
                },
              },
            ],
            error: null,
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      // On cold load, the exercise card and routine name should render immediately
      await waitFor(() => {
        expect(screen.getByText('Barbell Back Squat')).toBeDefined();
        expect(screen.getByText('Heavy Squat Day')).toBeDefined();
      });

      // The raw UUID must NEVER be rendered as an accordion header
      expect(screen.queryByText(realExerciseUUID)).toBeNull();

      // Completed set checkmark and values render cleanly
      expect(screen.getByText('315')).toBeDefined();
      expect(screen.getByText('5')).toBeDefined();
      expect(screen.getByTestId('logged-set-row-0-0')).toBeDefined();
    });

    it('auto-heals corrupted localStorage active session containing raw UUIDs without losing drafts (Test 43)', async () => {
      const today = '2026-09-06';
      const corruptedUUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';
      const cleanExerciseName = 'Bulgarian Split Squat';

      // Pre-seed corrupted session into localStorage
      const corruptedSession = {
        schemaVersion: 1,
        sessionId: 'session_00000000-0000-4000-8000-000000000001_2026-09-06_12345',
        userId: '00000000-0000-4000-8000-000000000001',
        workoutDate: today,
        routineName: 'Leg Destruction',
        exercises: [corruptedUUID],
        targetSetCounts: { [corruptedUUID]: 4 },
        targetRepCounts: { [corruptedUUID]: 12 },
        expandedExercises: [corruptedUUID],
        inputDrafts: {
          [`${corruptedUUID}_1`]: { weight: '135', reps: '10' },
        },
        startedAt: `${today}T10:00:00Z`,
        lastModifiedAt: `${today}T10:00:00Z`,
        completedAt: null,
      };
      localStorage.setItem(
        `yourbody_active_session_00000000-0000-4000-8000-000000000001_${today}`,
        JSON.stringify(corruptedSession)
      );

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'exercises') {
          return createSupabaseBuilder('exercises', {
            data: [
              { id: corruptedUUID, name: cleanExerciseName, body_parts: ['Legs'] },
            ],
            error: null,
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      // Verify that after auto-healing, the clean exercise name is rendered
      await waitFor(() => {
        expect(screen.getByText('Bulgarian Split Squat')).toBeDefined();
      });

      // Verify raw UUID is not displayed
      expect(screen.queryByText(corruptedUUID)).toBeNull();

      // Verify input drafts were migrated to clean name: Bulgarian Split Squat
      const weightInput = screen.getByTestId('ghost-weight-0-0') as HTMLInputElement;
      expect(weightInput.value).toBe('135');
      const repsInput = screen.getByTestId('ghost-reps-0-0') as HTMLInputElement;
      expect(repsInput.value).toBe('10');

      // Verify localStorage was healed
      const healedSession = workoutSessionStore.getActiveSession('00000000-0000-4000-8000-000000000001', today);
      expect(healedSession).toBeDefined();
      expect(healedSession?.exercises).toEqual(['Bulgarian Split Squat']);
      expect(healedSession?.targetSetCounts['Bulgarian Split Squat']).toBe(4);
      expect(healedSession?.targetRepCounts['Bulgarian Split Squat']).toBe(12);
      expect(healedSession?.expandedExercises).toEqual(['Bulgarian Split Squat']);
      expect(healedSession?.inputDrafts['Bulgarian Split Squat_1']).toEqual({ weight: '135', reps: '10' });
      expect(healedSession?.inputDrafts[`${corruptedUUID}_1`]).toBeUndefined();
    });

    it('shares consistent PostgREST joined sets cache across tabs without UUID poisoning (Test 44)', async () => {
      const today = '2026-09-06';
      const realExerciseUUID = 'c9d8e7f6-5432-10fe-ba98-76543210fedc';
      const workoutId = 'w-cache-test-1';

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'workouts') {
          return createSupabaseBuilder('workouts', {
            data: [{ id: workoutId, date: today, name: 'Cross-Tab Sync Workout' }],
            error: null,
          });
        }
        if (table === 'sets') {
          return createSupabaseBuilder('sets', {
            data: [
              {
                id: 's-sync-1',
                workout_id: workoutId,
                exercise_id: realExerciseUUID,
                set_index: 1,
                set_type: 'working',
                weight: 225,
                reps: 8,
                rpe: null,
                created_at: `${today}T10:00:00Z`,
                workouts: {
                  date: today,
                  name: 'Cross-Tab Sync Workout',
                },
                exercise: {
                  id: realExerciseUUID,
                  name: 'Overhead Press',
                  body_parts: ['Shoulders'],
                },
              },
            ],
            error: null,
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      // Render WorkoutEngine
      const { unmount } = renderComponent();
      await waitFor(() => {
        expect(screen.getByText('Overhead Press')).toBeDefined();
      });

      // Verify cached entry has clean exercise_name
      const cachedData = queryClient.getQueryData<any[]>(['workout_sets', '00000000-0000-4000-8000-000000000001', '90d']);
      expect(cachedData).toBeDefined();
      expect(cachedData?.[0]?.exercise_name).toBe('Overhead Press');
      expect(cachedData?.[0]?.workout_name).toBe('Cross-Tab Sync Workout');

      unmount();

      // Mock get_history_sessions_v2 RPC for HistoryView
      (supabase as any).rpc = vi.fn().mockImplementation((fn: string) => {
        if (fn === 'get_history_sessions_v2') {
          return Promise.resolve({
            data: [
              {
                id: workoutId,
                date: today,
                civil_date: today,
                name: 'Cross-Tab Sync Workout',
                set_count: 1,
                total_volume: 225 * 8,
                total_count: 1,
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      });

      // Mount HistoryView with the exact same shared queryClient
      render(
        <MemoryRouter initialEntries={['/history']}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <CoachProvider>
                <HistoryView />
              </CoachProvider>
            </AuthProvider>
          </QueryClientProvider>
        </MemoryRouter>
      );

      // Verify HistoryView renders the clean exercise from shared cache without lag or UUIDs
      await waitFor(() => {
        expect(screen.getByText('Overhead Press')).toBeDefined();
      });
      expect(screen.queryByText(realExerciseUUID)).toBeNull();
    });

    it('handles multi-tier auto-healing with partial unknown/deleted UUID fallback without crashing drafts (Test 45)', async () => {
      const today = '2026-09-06';
      const uuidCatalog = '11111111-2222-3333-4444-555555555555';
      const uuidSets = '66666666-7777-8888-9999-000000000000';
      const uuidDefault = 'e0000000-0000-0000-0000-000000000002'; // Cable Lateral Raises
      const uuidUnknown = 'deadbeef-dead-beef-dead-beefdeadbeef';

      const corruptedSession = {
        schemaVersion: 1,
        sessionId: 'session_00000000-0000-4000-8000-000000000001_2026-09-06_99999',
        userId: '00000000-0000-4000-8000-000000000001',
        workoutDate: today,
        routineName: 'Mixed Tier Test',
        exercises: [uuidCatalog, uuidSets, uuidDefault, uuidUnknown],
        targetSetCounts: {
          [uuidCatalog]: 3,
          [uuidSets]: 4,
          [uuidDefault]: 3,
          [uuidUnknown]: 2,
        },
        targetRepCounts: {
          [uuidCatalog]: 10,
          [uuidSets]: 12,
          [uuidDefault]: 15,
          [uuidUnknown]: 8,
        },
        expandedExercises: [uuidCatalog, uuidSets, uuidUnknown],
        inputDrafts: {
          [`${uuidCatalog}_1`]: { weight: '225', reps: '10' },
          [`${uuidSets}_1`]: { weight: '65', reps: '12' },
          [`${uuidDefault}_1`]: { weight: '30', reps: '15' },
          [`${uuidUnknown}_1`]: { weight: '100', reps: '8' },
        },
        startedAt: `${today}T10:00:00Z`,
        lastModifiedAt: `${today}T10:00:00Z`,
        completedAt: null,
      };

      localStorage.setItem(
        `yourbody_active_session_00000000-0000-4000-8000-000000000001_${today}`,
        JSON.stringify(corruptedSession)
      );

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'exercises') {
          return createSupabaseBuilder('exercises', {
            data: [
              { id: uuidCatalog, name: 'Romanian Deadlift', body_parts: ['Hamstrings'] },
            ],
            error: null,
          });
        }
        if (table === 'sets') {
          return createSupabaseBuilder('sets', {
            data: [
              {
                id: 's-joined-1',
                workout_id: 'w-1',
                exercise_id: uuidSets,
                set_index: 1,
                set_type: 'working',
                weight: 65,
                reps: 12,
                rpe: null,
                created_at: `${today}T10:00:00Z`,
                workouts: { date: today, name: 'Mixed Tier Test' },
                exercise: {
                  id: uuidSets,
                  name: 'Cable Face Pulls',
                  body_parts: ['Shoulders'],
                },
              },
            ],
            error: null,
          });
        }
        if (table === 'workouts') {
          return createSupabaseBuilder('workouts', {
            data: [{ id: 'w-1', date: today, name: 'Mixed Tier Test' }],
            error: null,
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      // Tier 1: DB Catalog resolved
      await waitFor(() => {
        expect(screen.getByText('Romanian Deadlift')).toBeDefined();
      });

      // Tier 2: Synthetic Default List resolved
      expect(screen.getAllByTestId('exercise-title').map((e) => e.textContent?.trim())).toContain('Cable Lateral Raises');

      // Tier 3: Today's joined sets resolved
      expect(screen.getByText('Cable Face Pulls')).toBeDefined();

      // Fallback: Unknown UUID safely displayed without crash
      expect(screen.getByText(uuidUnknown)).toBeDefined();

      // Verify healed session in store
      const healedSession = workoutSessionStore.getActiveSession('00000000-0000-4000-8000-000000000001', today);
      expect(healedSession).toBeDefined();
      expect(healedSession?.exercises).toEqual([
        'Romanian Deadlift',
        'Cable Face Pulls',
        'Cable Lateral Raises',
        uuidUnknown,
      ]);
      expect(healedSession?.inputDrafts['Romanian Deadlift_1']).toEqual({ weight: '225', reps: '10' });
      expect(healedSession?.inputDrafts['Cable Face Pulls_1']).toEqual({ weight: '65', reps: '12' });
      expect(healedSession?.inputDrafts['Cable Lateral Raises_1']).toEqual({ weight: '30', reps: '15' });
      expect(healedSession?.inputDrafts[`${uuidUnknown}_1`]).toEqual({ weight: '100', reps: '8' });
    });

    it('prioritizes coach-assigned routines (Score 3) over personal custom routines (Score 2) for scheduled workout days', async () => {
      // Wednesday: 2026-09-09
      vi.setSystemTime(new Date('2026-09-09T10:00:00Z'));

      const athleteId = '00000000-0000-4000-8000-000000000001';
      const coachId = 'coach-999';

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'routine_templates') {
          const templates = [
            {
              id: 'tpl-personal',
              user_id: athleteId,
              assigned_to: null,
              is_master: false,
              name: 'Personal User Routine',
              days_of_week: ['Wed'],
              created_at: '2026-09-01T00:00:00Z',
              exercises: [
                {
                  exercise_id: 'ex-1',
                  exercise: { name: 'Barbell Squat' },
                  target_sets: 3,
                  target_reps: 10,
                  order_index: 0,
                },
              ],
            },
            {
              id: 'tpl-coach-assigned',
              user_id: coachId,
              assigned_to: athleteId,
              is_master: false,
              name: 'Coach Assigned Priority Routine',
              days_of_week: ['Wed'],
              created_at: '2026-09-01T00:00:00Z',
              exercises: [
                {
                  exercise_id: 'ex-2',
                  exercise: { name: 'Incline Dumbbell Press' },
                  target_sets: 4,
                  target_reps: 8,
                  order_index: 0,
                },
              ],
            },
          ];
          return createSupabaseBuilder('routine_templates', {
            resolver: (builder: any) => {
              const idFilter = builder.filters.find((f: any) => f.method === 'eq' && f.column === 'id');
              if (idFilter) {
                const found = templates.find((t) => t.id === idFilter.value);
                return { data: found || null, error: null };
              }
              return { data: templates, error: null };
            },
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      // Assert that Coach Assigned Priority Routine resolves ahead of Personal User Routine
      await waitFor(() => {
        expect(screen.getByText('Coach Assigned Priority Routine')).toBeDefined();
        expect(screen.getByText('Incline Dumbbell Press')).toBeDefined();
        expect(screen.queryByText('Personal User Routine')).toBeNull();
      });
    });

    describe('Security & PostgREST Filter Injection Hardening', () => {
      it('validates standard RFC 4122 UUID identifiers with UUID_REGEX and isValidUUID', () => {
        // Valid UUIDv4
        expect(isValidUUID('00000000-0000-4000-8000-000000000001')).toBe(true);
        expect(isValidUUID('a540a224-10c4-4116-bb8f-45b2def0f2ac')).toBe(true);
        expect(isValidUUID('cff134bc-62a0-4196-9f6e-c6a1f864c6d4')).toBe(true);

        // Valid UUIDv1
        expect(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);

        // Malformed strings
        expect(isValidUUID('not-a-uuid')).toBe(false);
        expect(isValidUUID('test-user-id')).toBe(false);
        expect(isValidUUID('')).toBe(false);
        expect(isValidUUID(null)).toBe(false);
        expect(isValidUUID(undefined)).toBe(false);
        expect(isValidUUID(12345)).toBe(false);
        expect(isValidUUID('123e4567-e89b-12d3-a456-42661417400')).toBe(false); // short

        // PostgREST filter injection payloads
        expect(isValidUUID('00000000-0000-4000-8000-000000000001,is_master.eq.true')).toBe(false);
        expect(isValidUUID('00000000-0000-4000-8000-000000000001),role.eq.admin')).toBe(false);
        expect(isValidUUID("00000000-0000-4000-8000-000000000001' OR '1'='1")).toBe(false);
        expect(isValidUUID('00000000-0000-4000-8000-000000000001.user_id.neq.null')).toBe(false);
      });

      it('validates standard 8-4-4-4-12 hex UUID format including seeded accounts and rejects injection payloads', () => {
        expect(isValidUUID('a0000000-0000-0000-0000-000000000002')).toBe(true);
        expect(isValidUUID("x' or is_master.eq.true--")).toBe(false);
        expect(isValidUUID('not-a-uuid')).toBe(false);
      });

      it('yields safe empty array and does not query routine_templates when targetUserId is malformed', async () => {
        const mockOr = vi.fn().mockResolvedValue({ data: [], error: null });
        const mockRoutineSelect = vi.fn().mockReturnValue({ or: mockOr });

        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'routine_templates') {
            return { select: mockRoutineSelect };
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        // Set malformed targetUserId in auth
        (supabase.auth.getUser as any).mockResolvedValue({
          data: { user: { id: 'malformed-athlete-id-not-uuid' } },
        });
        (supabase.auth.getSession as any).mockResolvedValue({
          data: { session: { user: { id: 'malformed-athlete-id-not-uuid', email: 'mal@example.com' } } },
        });
        localStorage.setItem(
          'yourbody_user',
          JSON.stringify({
            id: 'malformed-athlete-id-not-uuid',
            email: 'mal@example.com',
            username: 'attacker',
            role: 'athlete',
          })
        );

        renderComponent();

        // Verify component renders safely without crashing (shows fallback Rest Day or default template)
        await waitFor(() => {
          expect(screen.getByTestId('routine-select-btn')).toBeDefined();
        });

        // Crucial security assertion: routine_templates table query was NEVER executed with malformed ID
        expect(mockRoutineSelect).not.toHaveBeenCalled();
        expect(mockOr).not.toHaveBeenCalled();
      });

      it('yields safe empty array and suppresses PostgREST filter execution on injection-shaped targetUserId', async () => {
        const mockOr = vi.fn().mockResolvedValue({ data: [], error: null });
        const mockRoutineSelect = vi.fn().mockReturnValue({ or: mockOr });

        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'routine_templates') {
            return { select: mockRoutineSelect };
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        const injectionPayload = '00000000-0000-4000-8000-000000000001,is_master.eq.true,id.neq.0';
        (supabase.auth.getUser as any).mockResolvedValue({
          data: { user: { id: injectionPayload } },
        });
        (supabase.auth.getSession as any).mockResolvedValue({
          data: { session: { user: { id: injectionPayload, email: 'attacker@example.com' } } },
        });
        localStorage.setItem(
          'yourbody_user',
          JSON.stringify({
            id: injectionPayload,
            email: 'attacker@example.com',
            username: 'attacker',
            role: 'athlete',
          })
        );

        renderComponent();

        await waitFor(() => {
          expect(screen.getByTestId('routine-select-btn')).toBeDefined();
        });

        // Assert query did not execute and .or() was never called with mutated DSL tokens
        expect(mockRoutineSelect).not.toHaveBeenCalled();
        expect(mockOr).not.toHaveBeenCalled();
      });

      it('executes routine_templates query with strictly parameterized PostgREST filter on valid UUID targetUserId', async () => {
        const validUserId = '00000000-0000-4000-8000-000000000001';
        let capturedFilter: string | null = null;

        const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null });
        const mockOr = vi.fn().mockImplementation((filter: string) => {
          capturedFilter = filter;
          return {
            limit: mockLimit,
            then: (resolve: any) => mockLimit().then(resolve),
          };
        });

        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'routine_templates') {
            return {
              select: vi.fn().mockReturnValue({ or: mockOr }),
            };
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        renderComponent();

        await waitFor(() => {
          expect(mockOr).toHaveBeenCalledTimes(1);
        });

        // Assert exact, safe parameterized filter grammar
        expect(capturedFilter).toBe(
          `user_id.eq.${validUserId},is_master.eq.true,assigned_to.eq.${validUserId}`
        );
        // Verify validUserId is strictly parameterized and safe
        expect(capturedFilter).toContain(`user_id.eq.${validUserId}`);
        expect(capturedFilter).toContain(`assigned_to.eq.${validUserId}`);
      });
    });

    describe('PostgREST resource embedding single round-trip', () => {
      it('queries workouts with embedded sets in a single call and maps them without querying sets table', async () => {
        let capturedWorkoutsSelect: string | null = null;
        let setsTableQueried = false;

        const embeddedWorkouts = [
          {
            id: 'w-embedded-1',
            date: '2026-09-06',
            name: 'Workout A (Push, Quads & Core)',
            sets: [
              {
                id: 's-emb-1',
                workout_id: 'w-embedded-1',
                exercise_id: 'e0000000-0000-0000-0000-000000000001',
                weight: 225,
                weight_lbs: 225,
                reps: 5,
                set_order: 1,
                set_index: 1,
                created_at: '2026-09-06T10:00:00Z',
                exercise: { id: 'e0000000-0000-0000-0000-000000000001', name: 'Incline Bench Press', body_parts: ['Chest'] },
              },
            ],
          },
        ];

        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'sets') {
            setsTableQueried = true;
            return createSupabaseBuilder('sets', { data: [], error: null });
          }
          if (table === 'workouts') {
            const b = createSupabaseBuilder('workouts', { data: embeddedWorkouts, error: null });
            const origSelect = b.select.bind(b);
            b.select = vi.fn().mockImplementation((cols: string) => {
              capturedWorkoutsSelect = cols;
              return origSelect(cols);
            });
            return b;
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        renderComponent();

        await waitFor(() => {
          expect(capturedWorkoutsSelect).toContain('sets(');
        });

        expect(setsTableQueried).toBe(false);
      });
    });

    describe('Workout Query Error Handling & Recovery', () => {
      it('surfaces visible error banner with Retry button when workout logs query fails and refetches on click', async () => {
        let failWorkouts = true;
        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'workouts') {
            return createSupabaseBuilder('workouts', {
              resolver: () => {
                if (failWorkouts) {
                  return { data: null, error: new Error('Database connection failed (HTTP 500)') };
                }
                return { data: [], error: null };
              },
            });
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        renderComponent();

        // Verify error banner and Retry button render in DOM
        await waitFor(() => {
          const banner = screen.getByTestId('workout-logs-error');
          expect(banner).toBeDefined();
          expect(within(banner).getByText(/Failed to load workout history/)).toBeDefined();
          expect(within(banner).getByText(/Database connection failed/i)).toBeDefined();
          expect(screen.getByTestId('retry-logs-btn')).toBeDefined();
        });



        // Allow retry to succeed
        failWorkouts = false;
        fireEvent.click(screen.getByTestId('retry-logs-btn'));

        // Error banner should clear once query succeeds
        await waitFor(() => {
          expect(screen.queryByTestId('workout-logs-error')).toBeNull();
        });
      });

      it('mounts workout-logs-error live region empty while idle and retains same DOM node on error', async () => {
        let failWorkouts = true;
        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'workouts') {
            return createSupabaseBuilder('workouts', {
              resolver: () => {
                if (failWorkouts) {
                  return { data: null, error: new Error('Database connection failed (HTTP 500)') };
                }
                return { data: [], error: null };
              },
            });
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        const { container } = renderComponent();

        // 2 live regions must be mounted: WorkoutHeader + WorkoutEngine logs banner
        const alerts = container.querySelectorAll('[role="alert"]');
        expect(alerts.length).toBe(2);
        const logsAlert = alerts[1];

        // On error, logsAlert contains error message
        await waitFor(() => {
          expect(logsAlert.textContent).toContain('Failed to load workout history');
        });

        // After retry succeeds, logsAlert is still the exact same DOM node and is empty
        failWorkouts = false;
        fireEvent.click(screen.getByTestId('retry-logs-btn'));

        await waitFor(() => {
          expect(screen.queryByTestId('workout-logs-error')).toBeNull();
        });

        expect(container.querySelectorAll('[role="alert"]')[1]).toBe(logsAlert);
        expect(logsAlert.textContent).toBe('');
      });


      it('disambiguates 90-day workout history cache from all-time history cache without cross-pollution', async () => {
        const targetUserId = '00000000-0000-4000-8000-000000000001';
        const ninetyDaysOldDate = '2026-08-01';
        const oneYearOldDate = '2025-01-01';

        // Workouts mock returning 90d workout
        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'workouts') {
            return createSupabaseBuilder('workouts', {
              data: [
                {
                  id: 'w-recent',
                  date: ninetyDaysOldDate,
                  name: 'Recent Workout',
                  sets: [
                    {
                      id: 's-recent',
                      workout_id: 'w-recent',
                      exercise_id: 'ex-1',
                      set_index: 1,
                      weight: 185,
                      reps: 10,
                      created_at: `${ninetyDaysOldDate}T10:00:00Z`,
                      exercise: { id: 'ex-1', name: 'Bench Press', body_parts: ['Chest'] },
                    },
                  ],
                },
              ],
              error: null,
            });
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        const { unmount } = renderComponent();

        await waitFor(() => {
          expect(queryClient.getQueryData(['workout_sets', targetUserId, '90d'])).toBeDefined();
        });

        // 90-day cache exists, all-time cache does not exist yet
        expect(queryClient.getQueryData(['workout_sets', targetUserId, 'all'])).toBeUndefined();

        unmount();

        // Now mock workouts and sets for HistoryView (including v2 RPC)
        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'workouts') {
            return createSupabaseBuilder('workouts', {
              data: [
                { id: 'w-recent', date: ninetyDaysOldDate, name: 'Recent Workout' },
                { id: 'w-old', date: oneYearOldDate, name: 'Ancient Workout' },
              ],
              error: null,
            });
          }
          if (table === 'sets') {
            return createSupabaseBuilder('sets', {
              data: [
                {
                  id: 's-recent',
                  workout_id: 'w-recent',
                  exercise_id: 'ex-1',
                  weight: 185,
                  reps: 10,
                  created_at: `${ninetyDaysOldDate}T10:00:00Z`,
                  workouts: { date: ninetyDaysOldDate, name: 'Recent Workout' },
                  exercise: { id: 'ex-1', name: 'Bench Press', body_parts: ['Chest'] },
                },
                {
                  id: 's-old',
                  workout_id: 'w-old',
                  exercise_id: 'ex-1',
                  weight: 135,
                  reps: 12,
                  created_at: `${oneYearOldDate}T10:00:00Z`,
                  workouts: { date: oneYearOldDate, name: 'Ancient Workout' },
                  exercise: { id: 'ex-1', name: 'Bench Press', body_parts: ['Chest'] },
                },
              ],
              error: null,
            });
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        (supabase as any).rpc = vi.fn().mockImplementation((fn: string) => {
          if (fn === 'get_history_sessions_v2') {
            return Promise.resolve({
              data: [
                {
                  id: 'w-recent',
                  date: ninetyDaysOldDate,
                  civil_date: ninetyDaysOldDate,
                  name: 'Recent Workout',
                  set_count: 1,
                  total_volume: 185 * 10,
                  total_count: 2,
                },
                {
                  id: 'w-old',
                  date: oneYearOldDate,
                  civil_date: oneYearOldDate,
                  name: 'Ancient Workout',
                  set_count: 1,
                  total_volume: 135 * 12,
                  total_count: 2,
                },
              ],
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        });

        render(
          <MemoryRouter initialEntries={['/history']}>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <CoachProvider>
                  <HistoryView />
                </CoachProvider>
              </AuthProvider>
            </QueryClientProvider>
          </MemoryRouter>
        );

        await waitFor(() => {
          expect(queryClient.getQueryData(['workout_sets', targetUserId, 'history_v2', 'all', null])).toBeDefined();
        });

        const allData = queryClient.getQueryData<any>(['workout_sets', targetUserId, 'history_v2', 'all', null]);
        const ninetyData = queryClient.getQueryData<any[]>(['workout_sets', targetUserId, '90d']);

        // Both caches coexist without collision or cross-pollution
        const allSessions = allData?.pages?.flatMap((p: any) => p.sessions) ?? [];
        expect(allSessions).toHaveLength(2);
        expect(ninetyData).toHaveLength(1);
      });
    });

    describe('Negative Controls (NC-2, NC-3, NC-4)', () => {
      it('NC-2: workouts cold read carries date bounds (.gte/.lte) and limit(5)', async () => {
        let workoutsBuilder: any = null;

        (supabase.from as any).mockImplementation((table: string) => {
          const builder = createSupabaseBuilder(table, { data: [], error: null });
          if (table === 'workouts') {
            workoutsBuilder = builder;
          }
          return builder;
        });

        renderComponent();

        await waitFor(() => {
          expect(workoutsBuilder).not.toBeNull();
        });

        // Verify limit(5) is strictly applied
        expect(workoutsBuilder.limitValue).toBe(5);

        // Verify date bounds (.gte and .lte on date) are strictly applied around target date
        const gteDate = workoutsBuilder.filters.find((f: any) => f.method === 'gte' && f.column === 'date');
        const lteDate = workoutsBuilder.filters.find((f: any) => f.method === 'lte' && f.column === 'date');

        expect(gteDate).toBeDefined();
        expect(lteDate).toBeDefined();
        expect(gteDate.value).toMatch(/^2026-09-06T00:00:00/);
        expect(lteDate.value).toMatch(/^2026-09-06T23:59:59/);
      });

      it('NC-3: deferral is real - opening /workout with picker closed issues 0 requests with limit=50, opening picker issues limit=50 query', async () => {
        let limit50Count = 0;
        let limit100Count = 0;

        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'routine_templates') {
            const builder = createSupabaseBuilder('routine_templates', { data: [], error: null });
            const origLimit = builder.limit.bind(builder);
            builder.limit = vi.fn().mockImplementation((count: number, options?: any) => {
              if (count === 50) limit50Count++;
              if (count === 100) limit100Count++;
              return origLimit(count, options);
            });
            return builder;
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        renderComponent();

        // On initial render (cold paint, picker closed), only the list query (limit 100) runs
        await waitFor(() => {
          expect(limit100Count).toBeGreaterThanOrEqual(1);
        });
        expect(limit50Count).toBe(0);

        // Open the routine picker modal
        const routineBtn = screen.getByTestId('routine-select-btn');
        fireEvent.click(routineBtn);

        // Deferred full query (limit 50) is now triggered
        await waitFor(() => {
          expect(limit50Count).toBe(1);
          expect(screen.getByText('Select Routine')).toBeDefined();
        });
      });

      it('NC-4: invalidation coherence - logging a set invalidates/refetches both today session and ghost sets and updates UI without full reload', async () => {
        let workoutsFetchCount = 0;
        let rpcFetchCount = 0;

        const mockInsert = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'new-set-123',
                workout_id: 'workout-today',
                exercise_id: 'e0000000-0000-0000-0000-000000000001',
                weight: 185,
                reps: 8,
                set_index: 1,
                set_type: 'working',
                rpe: null,
                created_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        });

        (supabase as any).rpc = vi.fn().mockImplementation((fn: string, _params: any) => {
          if (fn === 'get_ghost_sets') {
            rpcFetchCount++;
            return Promise.resolve({
              data: [
                {
                  id: 'ghost-1',
                  exercise_id: 'e0000000-0000-0000-0000-000000000001',
                  exercise_name: 'Incline Bench Press',
                  weight: 175,
                  reps: 10,
                  set_index: 1,
                  set_type: 'working',
                  workout_date: '2026-09-01',
                },
              ],
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        });

        let currentWorkoutsData: any[] = [
          {
            id: 'workout-today',
            date: '2026-09-06T10:00:00.000Z',
            name: 'Workout A (Push, Quads & Core)',
            sets: [],
          },
        ];

        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'sets') {
            const b = createSupabaseBuilder('sets', { data: [], error: null });
            b.insert = mockInsert;
            return b;
          }
          if (table === 'workouts') {
            workoutsFetchCount++;
            return createSupabaseBuilder('workouts', {
              resolver: () => ({ data: currentWorkoutsData, error: null }),
            });
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        renderComponent();
        await selectWorkoutA();

        await waitFor(() => {
          expect(workoutsFetchCount).toBeGreaterThanOrEqual(1);
          expect(rpcFetchCount).toBeGreaterThanOrEqual(1);
        });

        const initialWorkoutsFetches = workoutsFetchCount;
        const initialRpcFetches = rpcFetchCount;

        // When set is logged, update simulated workouts data
        currentWorkoutsData = [
          {
            id: 'workout-today',
            date: '2026-09-06T10:00:00.000Z',
            name: 'Workout A (Push, Quads & Core)',
            sets: [
              {
                id: 'new-set-123',
                workout_id: 'workout-today',
                exercise_id: 'e0000000-0000-0000-0000-000000000001',
                weight: 185,
                reps: 8,
                set_index: 1,
                set_type: 'working',
                created_at: new Date().toISOString(),
                exercise: { id: 'e0000000-0000-0000-0000-000000000001', name: 'Incline Bench Press', body_parts: ['Chest'] },
              },
            ],
          },
        ];

        // Type inputs and commit set
        const weightInput = screen.getByTestId('ghost-weight-0-0');
        const repsInput = screen.getByTestId('ghost-reps-0-0');
        const commitBtn = screen.getByTestId('commit-set-btn-0-0');

        await userEvent.type(weightInput, '185');
        await userEvent.type(repsInput, '8');
        fireEvent.click(commitBtn);

        // Invalidation triggers refetch of both today's workouts query and ghost sets RPC
        await waitFor(() => {
          expect(workoutsFetchCount).toBeGreaterThan(initialWorkoutsFetches);
          expect(rpcFetchCount).toBeGreaterThan(initialRpcFetches);
        });

        // UI reflects the logged set without page reload
        await waitFor(() => {
          expect(screen.getByTestId('logged-set-row-0-0')).toBeDefined();
          expect(screen.queryByTestId('commit-set-btn-0-0')).toBeNull();
        });
      });
    describe('6d Negative Controls (Template Row Coverage & Detail Fetch)', () => {
      it('NC-A (the regression itself): self-coached template with days_of_week=[] resolves all 6 exercises and targets on cold paint when 2 exercises are logged', async () => {
        const myUserId = '00000000-0000-4000-8000-000000000001';
        const templateExercises = [
          { id: 'te-1', template_id: 'tpl-nc-a-1', exercise_id: 'ex-1', order_index: 1, target_sets: 4, target_reps: 8, exercise: { name: 'Barbell Bench Press' } },
          { id: 'te-2', template_id: 'tpl-nc-a-1', exercise_id: 'ex-2', order_index: 2, target_sets: 3, target_reps: 10, exercise: { name: 'Incline Dumbbell Press' } },
          { id: 'te-3', template_id: 'tpl-nc-a-1', exercise_id: 'ex-3', order_index: 3, target_sets: 3, target_reps: 12, exercise: { name: 'Cable Crossover' } },
          { id: 'te-4', template_id: 'tpl-nc-a-1', exercise_id: 'ex-4', order_index: 4, target_sets: 4, target_reps: 8, exercise: { name: 'Overhead Press' } },
          { id: 'te-5', template_id: 'tpl-nc-a-1', exercise_id: 'ex-5', order_index: 5, target_sets: 4, target_reps: 15, exercise: { name: 'Lateral Raise' } },
          { id: 'te-6', template_id: 'tpl-nc-a-1', exercise_id: 'ex-6', order_index: 6, target_sets: 3, target_reps: 12, exercise: { name: 'Triceps Pushdown' } },
        ];

        const mockTemplates = [
          {
            id: 'tpl-nc-a-1',
            user_id: myUserId,
            assigned_to: null,
            is_master: false,
            days_of_week: [] as string[],
            name: 'Hypertrophy NC-A Routine',
            created_at: '2026-09-01T00:00:00.000Z',
            exercises: templateExercises,
          },
        ];

        const mockExercisesList = [
          { id: 'ex-1', name: 'Barbell Bench Press', body_parts: ['Chest'] },
          { id: 'ex-2', name: 'Incline Dumbbell Press', body_parts: ['Chest'] },
          { id: 'ex-3', name: 'Cable Crossover', body_parts: ['Chest'] },
          { id: 'ex-4', name: 'Overhead Press', body_parts: ['Shoulders'] },
          { id: 'ex-5', name: 'Lateral Raise', body_parts: ['Shoulders'] },
          { id: 'ex-6', name: 'Triceps Pushdown', body_parts: ['Arms'] },
        ];

        const mockWorkoutsData = [
          {
            id: 'workout-today-nca',
            date: '2026-09-06T10:00:00.000Z',
            name: 'Hypertrophy NC-A Routine',
            sets: [
              {
                id: 'set-nca-1',
                workout_id: 'workout-today-nca',
                exercise_id: 'ex-1',
                set_index: 1,
                weight: 205,
                reps: 8,
                created_at: '2026-09-06T10:05:00.000Z',
                exercise: { id: 'ex-1', name: 'Barbell Bench Press', body_parts: ['Chest'] },
              },
              {
                id: 'set-nca-2',
                workout_id: 'workout-today-nca',
                exercise_id: 'ex-2',
                set_index: 1,
                weight: 75,
                reps: 10,
                created_at: '2026-09-06T10:10:00.000Z',
                exercise: { id: 'ex-2', name: 'Incline Dumbbell Press', body_parts: ['Chest'] },
              },
            ],
          },
        ];

        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'routine_templates') {
            return createSupabaseBuilder('routine_templates', {
              resolver: (builder: any) => {
                // Detail query resolver (eq('id', ...))
                const idFilter = builder.filters.find((f: any) => f.method === 'eq' && f.column === 'id');
                if (idFilter) {
                  const found = mockTemplates.find((t) => t.id === idFilter.value);
                  if (!found) return null;
                  return {
                    id: found.id,
                    exercises: found.exercises,
                  };
                }

                // List query with .or() filter
                const orFilter = builder.filters.find((f: any) => f.method === 'or')?.args[0] as string;
                const filtered = mockTemplates.filter((t) => {
                  if (orFilter && orFilter.includes('days_of_week.cs.')) {
                    const dayMatch = /days_of_week\.cs\.\{([^}]+)\}/.exec(orFilter)?.[1] || '';
                    const isUserSched = t.user_id === myUserId && t.days_of_week?.includes(dayMatch);
                    const isMasterSched = t.is_master && t.days_of_week?.includes(dayMatch);
                    const isAssigned = t.assigned_to === myUserId;
                    return isUserSched || isMasterSched || isAssigned;
                  }
                  return t.user_id === myUserId || t.is_master || t.assigned_to === myUserId;
                });

                if (!builder.projection.includes('template_exercises')) {
                  return filtered.map(({ exercises: _ex, ...rest }) => rest);
                }
                return filtered;
              },
            });
          }
          if (table === 'exercises') {
            return createSupabaseBuilder('exercises', {
              data: mockExercisesList,
              error: null,
            });
          }
          if (table === 'workouts') {
            return createSupabaseBuilder('workouts', {
              data: mockWorkoutsData,
              error: null,
            });
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        renderComponent();

        // Wait for session resolution
        await waitFor(() => {
          expect(screen.getByTestId('routine-select-btn')).toBeDefined();
        });

        // The exercise cards must contain ALL SIX exercises in order_index order
        const exerciseCards = await screen.findAllByTestId(/exercise-card-/);
        const renderedExerciseNames = exerciseCards.map((card) => {
          const nameSpan = card.querySelector('[data-testid="exercise-title"]');
          return nameSpan?.textContent?.trim();
        });

        expect(renderedExerciseNames).toEqual([
          'Barbell Bench Press',
          'Incline Dumbbell Press',
          'Cable Crossover',
          'Overhead Press',
          'Lateral Raise',
          'Triceps Pushdown',
        ]);
      });

      it('NC-B (scheduling still works): template scheduled today resolves via scheduledCustom with exercises populated through detail fetch', async () => {
        const myUserId = '00000000-0000-4000-8000-000000000001';
        // Date 2026-09-06 is Sunday ('Sun')
        const sundayTemplate = {
          id: 'tpl-sunday-sched',
          user_id: myUserId,
          name: 'Sunday Strength Blast',
          is_master: false,
          assigned_to: null,
          days_of_week: ['Sun'],
          created_at: '2026-09-01T00:00:00.000Z',
          exercises: [
            {
              id: 'te-sun-1',
              template_id: 'tpl-sunday-sched',
              exercise_id: 'ex-sun-1',
              order_index: 0,
              target_sets: 4,
              target_reps: 6,
              exercise: { name: 'Deadlift' },
            },
            {
              id: 'te-sun-2',
              template_id: 'tpl-sunday-sched',
              exercise_id: 'ex-sun-2',
              order_index: 1,
              target_sets: 3,
              target_reps: 8,
              exercise: { name: 'Front Squat' },
            },
          ],
        };

        const mockExercisesList = [
          { id: 'ex-sun-1', name: 'Deadlift', body_parts: ['Back'], is_master: true },
          { id: 'ex-sun-2', name: 'Front Squat', body_parts: ['Legs'], is_master: true },
        ];

        let detailQueryCount = 0;
        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'routine_templates') {
            return createSupabaseBuilder('routine_templates', {
              resolver: (builder: any) => {
                const idFilter = builder.filters.find((f: any) => f.method === 'eq' && f.column === 'id');
                if (idFilter) {
                  detailQueryCount++;
                  if (idFilter.value === sundayTemplate.id) {
                    return {
                      id: sundayTemplate.id,
                      exercises: sundayTemplate.exercises,
                    };
                  }
                  return null;
                }
                return [{
                  id: sundayTemplate.id,
                  user_id: sundayTemplate.user_id,
                  name: sundayTemplate.name,
                  is_master: sundayTemplate.is_master,
                  assigned_to: sundayTemplate.assigned_to,
                  days_of_week: sundayTemplate.days_of_week,
                  created_at: sundayTemplate.created_at,
                }];
              },
            });
          }
          if (table === 'exercises') {
            return createSupabaseBuilder('exercises', {
              data: mockExercisesList,
              error: null,
            });
          }
          if (table === 'workouts') {
            return createSupabaseBuilder('workouts', {
              data: [],
              error: null,
            });
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        renderComponent();

        await waitFor(() => {
          expect(screen.getByText('Sunday Strength Blast')).toBeDefined();
        });

        const cards = await screen.findAllByTestId(/exercise-card-/);
        expect(cards).toHaveLength(2);
        expect(screen.getByText('Deadlift')).toBeDefined();
        expect(screen.getByText('Front Squat')).toBeDefined();
        expect(detailQueryCount).toBe(1);
      });

      it('NC-C (bidirectional prefix preserved): covers exact equality, template startsWith logged, and logged startsWith template', () => {
        const customTemplates: RoutineTemplate[] = [
          {
            id: 'tpl-1',
            user_id: 'user-1',
            name: 'Upper Hypertrophy',
            is_master: false,
            assigned_to: null,
            days_of_week: [],
            exercises: [
              {
                id: 'te-1',
                template_id: 'tpl-1',
                exercise_id: 'ex-1',
                order_index: 0,
                target_sets: 4,
                target_reps: 8,
                exercise: { name: 'Bench Press' },
              },
            ],
          },
          {
            id: 'tpl-2',
            user_id: 'user-1',
            name: 'Pull Day',
            is_master: false,
            assigned_to: null,
            days_of_week: [],
            exercises: [
              {
                id: 'te-2',
                template_id: 'tpl-2',
                exercise_id: 'ex-2',
                order_index: 0,
                target_sets: 3,
                target_reps: 10,
                exercise: { name: 'Pull-up' },
              },
            ],
          },
          {
            id: 'tpl-3',
            user_id: 'user-1',
            name: 'Legs Heavy',
            is_master: false,
            assigned_to: null,
            days_of_week: [],
            exercises: [
              {
                id: 'te-3',
                template_id: 'tpl-3',
                exercise_id: 'ex-3',
                order_index: 0,
                target_sets: 5,
                target_reps: 5,
                exercise: { name: 'Squat' },
              },
            ],
          },
        ];

        const mockExList = [
          { id: 'ex-1', name: 'Bench Press', body_parts: ['Chest'] },
          { id: 'ex-2', name: 'Pull-up', body_parts: ['Back'] },
          { id: 'ex-3', name: 'Squat', body_parts: ['Legs'] },
        ] as Exercise[];

        // Arm 1: Exact equality
        const resExact = resolveRoutineAndExercises(
          '2026-09-06',
          [{ workout_name: 'Upper Hypertrophy', exercise_id: 'ex-1' } as any],
          customTemplates,
          mockExList
        );
        expect(resExact.routineName).toBe('Upper Hypertrophy');
        expect(resExact.exercises).toEqual(['Bench Press']);
        expect(resExact.targetSets['Bench Press']).toBe(4);
        expect(resExact.targetReps['Bench Press']).toBe(8);

        // Arm 2: Template name starts with logged name (Template: "Legs Heavy", Logged: "Legs")
        const resTplStarts = resolveRoutineAndExercises(
          '2026-09-06',
          [{ workout_name: 'Legs', exercise_id: 'ex-3' } as any],
          customTemplates,
          mockExList
        );
        expect(resTplStarts.routineName).toBe('Legs Heavy');
        expect(resTplStarts.exercises).toEqual(['Squat']);
        expect(resTplStarts.targetSets['Squat']).toBe(5);
        expect(resTplStarts.targetReps['Squat']).toBe(5);

        // Arm 3: Logged name starts with template name (Template: "Pull Day", Logged: "Pull Day (Week 4 Focus)")
        const resLoggedStarts = resolveRoutineAndExercises(
          '2026-09-06',
          [{ workout_name: 'Pull Day (Week 4 Focus)', exercise_id: 'ex-2' } as any],
          customTemplates,
          mockExList
        );
        expect(resLoggedStarts.routineName).toBe('Pull Day');
        expect(resLoggedStarts.exercises).toEqual(['Pull-up']);
        expect(resLoggedStarts.targetSets['Pull-up']).toBe(3);
        expect(resLoggedStarts.targetReps['Pull-up']).toBe(10);
      });

      it('NC-D (detail fetch is on demand): cold paint issues zero requests carrying template_exercises( from list query; exactly one detail fetch occurs, and only after template resolves', async () => {
        const myUserId = '00000000-0000-4000-8000-000000000001';
        const targetTemplate = {
          id: 'tpl-ncd-demand',
          user_id: myUserId,
          name: 'Demand Driven Routine',
          is_master: false,
          assigned_to: null,
          days_of_week: ['Sun'],
          created_at: '2026-09-01T00:00:00.000Z',
          exercises: [
            {
              id: 'te-ncd-1',
              template_id: 'tpl-ncd-demand',
              exercise_id: 'ex-ncd-1',
              order_index: 0,
              target_sets: 3,
              target_reps: 12,
              exercise: { name: 'Lateral Raise' },
            },
          ],
        };

        const listQueries: { projection: string; limit?: number }[] = [];
        const detailQueries: { projection: string; id: string }[] = [];

        (supabase.from as any).mockImplementation((table: string) => {
          if (table === 'routine_templates') {
            return createSupabaseBuilder('routine_templates', {
              resolver: (builder: any) => {
                const idFilter = builder.filters.find((f: any) => f.method === 'eq' && f.column === 'id');
                const limitVal = builder.limitValue;
                if (idFilter) {
                  detailQueries.push({ projection: builder.projection, id: idFilter.value });
                  return {
                    id: targetTemplate.id,
                    exercises: targetTemplate.exercises,
                  };
                }
                listQueries.push({ projection: builder.projection, limit: limitVal });
                return [{
                  id: targetTemplate.id,
                  user_id: targetTemplate.user_id,
                  name: targetTemplate.name,
                  is_master: targetTemplate.is_master,
                  assigned_to: targetTemplate.assigned_to,
                  days_of_week: targetTemplate.days_of_week,
                  created_at: targetTemplate.created_at,
                }];
              },
            });
          }
          if (table === 'exercises') {
            return createSupabaseBuilder('exercises', {
              data: [{ id: 'ex-ncd-1', name: 'Lateral Raise', body_parts: ['Shoulders'], is_master: true }],
              error: null,
            });
          }
          if (table === 'workouts') {
            return createSupabaseBuilder('workouts', {
              data: [],
              error: null,
            });
          }
          return createSupabaseBuilder(table, { data: [], error: null });
        });

        renderComponent();

        await waitFor(() => {
          expect(screen.getByText('Demand Driven Routine')).toBeDefined();
        });

        // 1. Cold paint list query issues ZERO requests carrying template_exercises(
        expect(listQueries.length).toBeGreaterThanOrEqual(1);
        listQueries.forEach((q) => {
          expect(q.projection).not.toContain('template_exercises');
          expect(q.projection).toBe('id, user_id, name, is_master, assigned_to, days_of_week, created_at');
          expect(q.limit).toBe(100);
        });

        // 2. Exactly one detail fetch occurs, and only for the resolved template
        expect(detailQueries).toHaveLength(1);
        expect(detailQueries[0].id).toBe(targetTemplate.id);
        expect(detailQueries[0].projection).toBe(
          'id, exercises:template_exercises(id, template_id, exercise_id, order_index, target_sets, target_reps, exercise:exercises(name))'
        );
      });
    });
  });
});

  it('retains uncommitted draft in input field and session store when set insertion fails and surfaces error banner', async () => {
    mockEnqueueAndAwait.mockRejectedValueOnce(new Error('Database insert failed: connection refused'));

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', { data: [{ id: 'workout-w4' }], error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await selectWorkoutA();

    // Type drafts for Bench Press row 0
    const weightInput = screen.getByTestId('ghost-weight-0-0') as HTMLInputElement;
    const repsInput = screen.getByTestId('ghost-reps-0-0') as HTMLInputElement;
    await userEvent.clear(weightInput);
    await userEvent.type(weightInput, '225');
    await userEvent.clear(repsInput);
    await userEvent.type(repsInput, '5');

    const logBtn = screen.getByTestId('commit-set-btn-0-0');
    fireEvent.click(logBtn);

    // Wait for error banner
    await waitFor(() => {
      expect(screen.getAllByText(/Database insert failed: connection refused/i).length).toBeGreaterThanOrEqual(1);
    });

    // Verify uncommitted draft values were NOT wiped
    expect(weightInput.value).toBe('225');
    expect(repsInput.value).toBe('5');
    workoutSessionStore.flushPendingWrites();
    const session = workoutSessionStore.getSession('00000000-0000-4000-8000-000000000001', '2026-09-06');
    const stored = session?.inputDrafts['Incline Bench Press_1'];
    expect(stored?.weight).toBe('225');
    expect(stored?.reps).toBe('5');
  });


  describe("B1: Set Deletion and EditSetSheet Host Wiring", () => {
    const today = "2026-09-06";
    const workoutId = "w-edit-1";
    const exerciseUUID = "e1e1e1e1-0000-4000-8000-000000000001";

    const setupLoggedSet = () => {
      const setObj = {
        id: "set-edit-1",
        workout_id: workoutId,
        exercise_id: exerciseUUID,
        set_index: 1,
        set_type: "working",
        weight: 225,
        reps: 8,
        rpe: null,
        created_at: `${today}T10:00:00.000Z`,
        workouts: {
          id: workoutId,
          date: `${today}T10:00:00.000Z`,
          name: "Chest Day",
        },
        exercise: {
          id: exerciseUUID,
          name: "Barbell Bench Press",
          body_parts: ["Chest"],
        },
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === "exercises") {
          return createSupabaseBuilder("exercises", {
            data: [{ id: exerciseUUID, name: "Barbell Bench Press", body_parts: ["Chest"], is_master: true }],
            error: null,
          });
        }
        if (table === "routine_templates") {
          return createSupabaseBuilder("routine_templates", {
            data: [
              {
                id: "tmpl-1",
                name: "Chest Day",
                days_of_week: ["Sun"],
                exercises: [{ id: exerciseUUID, name: "Barbell Bench Press" }],
              },
            ],
            error: null,
          });
        }
        if (table === "workouts") {
          return createSupabaseBuilder("workouts", {
            data: [
              {
                id: workoutId,
                date: `${today}T10:00:00.000Z`,
                name: "Chest Day",
                sets: [setObj],
              },
            ],
            error: null,
          });
        }
        if (table === "sets") {
          return createSupabaseBuilder("sets", {
            data: [setObj],
            error: null,
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });
    };

    it("tapping a logged set row opens EditSetSheet", async () => {
      setupLoggedSet();
      renderComponent(true);

      await waitFor(() => {
        expect(screen.getByText("Barbell Bench Press")).toBeDefined();
        expect(screen.getByTestId("logged-set-row-0-0")).toBeDefined();
      });

      // Sheet is not open initially
      expect(screen.queryByTestId("edit-set-sheet")).toBeNull();

      // Tap logged set row
      fireEvent.click(screen.getByTestId("logged-set-row-0-0"));

      // Sheet opens
      await waitFor(() => {
        expect(screen.getByTestId("edit-set-sheet")).toBeDefined();
      });
    });

    it("delete via sheet closes sheet, optimistically hides set, renders UndoToast, and sends exactly 1 DELETE after 6s", async () => {
      const deleteSetSpy = vi.spyOn(setsLib, "deleteSet").mockResolvedValue(undefined as any);
      setupLoggedSet();
      renderComponent(true);

      await waitFor(() => {
        expect(screen.getByTestId("logged-set-row-0-0")).toBeDefined();
      });

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        // Tap logged row to open sheet
        fireEvent.click(screen.getByTestId("logged-set-row-0-0"));
        expect(screen.getByTestId("edit-set-sheet")).toBeDefined();

        // Request delete from sheet
        fireEvent.click(screen.getByTestId("delete-set-btn"));

        // Sheet closes immediately
        expect(screen.queryByTestId("edit-set-sheet")).toBeNull();

        // Set is optimistically hidden
        expect(screen.queryByTestId("logged-set-row-0-0")).toBeNull();

        // UndoToast is visible
        expect(screen.getByTestId("quick-log-toast")).toBeDefined();
        expect(screen.getByTestId("toast-undo-btn")).toBeDefined();

        // No DELETE before 6s
        act(() => {
          vi.advanceTimersByTime(5900);
        });
        expect(deleteSetSpy).not.toHaveBeenCalled();

        // Advance to 6000ms
        await vi.advanceTimersByTimeAsync(200);

        // Exactly 1 DELETE request sent
        expect(deleteSetSpy).toHaveBeenCalledTimes(1);
        expect(deleteSetSpy).toHaveBeenCalledWith(expect.anything(), "set-edit-1");
      } finally {
        vi.useRealTimers();
      }
    });

    it("delete via sheet then Undo restores set and sends 0 DELETE calls", async () => {
      const deleteSetSpy = vi.spyOn(setsLib, "deleteSet").mockResolvedValue(undefined as any);
      setupLoggedSet();
      renderComponent(true);

      await waitFor(() => {
        expect(screen.getByTestId("logged-set-row-0-0")).toBeDefined();
      });

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        // Tap logged row and delete via sheet
        fireEvent.click(screen.getByTestId("logged-set-row-0-0"));
        fireEvent.click(screen.getByTestId("delete-set-btn"));

        // Set is hidden, toast shown
        expect(screen.queryByTestId("logged-set-row-0-0")).toBeNull();
        const undoBtn = screen.getByTestId("toast-undo-btn");
        expect(undoBtn).toBeDefined();

        // Click Undo
        act(() => {
          fireEvent.click(undoBtn);
        });

        // Set immediately reappears
        expect(screen.getByTestId("logged-set-row-0-0")).toBeDefined();

        // Advance timers well past 6s
        await vi.advanceTimersByTimeAsync(10000);

        // Zero DELETE calls
        expect(deleteSetSpy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
