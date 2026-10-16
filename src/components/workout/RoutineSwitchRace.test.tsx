import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkoutEngine } from './WorkoutEngine';
import { useWorkoutSession } from './useWorkoutSession';
import { CoachProvider } from '../../context/CoachContext';
import { ToastProvider } from '../../context/ToastContext';
import { restTimerStore } from '../../utils/restTimerStore';
import { workoutSessionStore } from '../../utils/workoutSessionStore';
import type { RoutineTemplate, Exercise } from '../../types/database';

const {
  testUserId,
  mockEnqueueAndAwait,
  mockGetOutboxOps,
  mockFetchTemplateDetail,
  getQueriesMock,
  setQueriesMock,
} = vi.hoisted(() => {
  const userId = '00000000-0000-4000-8000-000000000001';
  let queriesMock: any = null;
  return {
    testUserId: userId,
    mockEnqueueAndAwait: vi.fn().mockImplementation(async () => ({
      status: 'synced',
      opId: 'test-op-1',
    })),
    mockGetOutboxOps: vi.fn().mockResolvedValue([]),
    mockFetchTemplateDetail: vi.fn(),
    getQueriesMock: () => queriesMock,
    setQueriesMock: (val: any) => {
      queriesMock = val;
    },
  };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: testUserId, email: 'athlete@example.com' },
    profile: null,
  }),
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

vi.mock('./useWorkoutQueries', async () => {
  const actual = await vi.importActual<any>('./useWorkoutQueries');
  return {
    ...actual,
    useWorkoutQueries: () => getQueriesMock(),
    fetchTemplateDetail: (...args: any[]) => mockFetchTemplateDetail(...args),
  };
});

const defaultCustomTemplate: RoutineTemplate = {
  id: 'tpl-custom-workout-a',
  user_id: testUserId,
  name: 'Workout A (Push, Quads & Core)',
  is_master: false,
  assigned_to: null,
  days_of_week: ['Mon'],
  created_at: '2026-01-01T00:00:00Z',
};

const brokenCustomTemplate: RoutineTemplate = {
  id: 'tpl-broken',
  user_id: testUserId,
  name: 'Broken Routine',
  is_master: false,
  assigned_to: null,
  days_of_week: ['Mon'],
  created_at: '2026-01-01T00:00:00Z',
};

describe('Routine Switch Race Conditions', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    window.history.replaceState(null, '', '/workout');
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    // 2026-10-16 is a Friday (smoke failure date)
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
    localStorage.clear();
    sessionStorage.clear();
    restTimerStore.resetForTesting();
    workoutSessionStore.resetForTesting();

    localStorage.setItem(
      'yourbody_user',
      JSON.stringify({
        id: testUserId,
        email: 'athlete@example.com',
        username: 'athlete',
        role: 'athlete',
      })
    );

    setQueriesMock({
      exercises: [
        { id: 'ex-lat', name: 'Lat Pull Down', body_parts: ['Back'], is_master: true },
        { id: 'ex-incline-bench', name: 'Incline Bench Press', body_parts: ['Chest'], is_master: true },
      ],
      exercisesFetched: true,
      customTemplates: [defaultCustomTemplate],
      templatesFetched: true,
      userLogs: [],
      logsFetched: true,
      availableRoutines: {
        custom: [defaultCustomTemplate],
        defaults: [],
      },
      isLogsError: false,
      logsError: null,
      refetchLogs: vi.fn(),
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderWorkout = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <CoachProvider>
          <ToastProvider>
            <WorkoutEngine />
          </ToastProvider>
        </CoachProvider>
      </QueryClientProvider>
    );

  it('(a) keeps routine modal open while template detail fetch is pending, and shows new exercises only after resolve', async () => {
    let resolveDetailFetch!: (detail: any) => void;
    const pendingDetailPromise = new Promise((resolve) => {
      resolveDetailFetch = resolve;
    });

    mockFetchTemplateDetail.mockImplementation((templateId: string) => {
      if (templateId === 'tpl-custom-workout-a') {
        return pendingDetailPromise;
      }
      return Promise.resolve(null);
    });

    renderWorkout();

    // On Friday 2026-10-16, initial routine is Friday routine ("Pull, Hamstring, & Core - Reduced")
    // Exercise 0 is "Lat Pull Down"
    expect(await screen.findByText('Lat Pull Down')).toBeInTheDocument();

    // Open routine picker modal
    const routineBtn = screen.getByTestId('routine-select-btn');
    fireEvent.click(routineBtn);

    // Modal is open
    expect(screen.getByTestId('routine-picker-modal')).toBeInTheDocument();

    // Click the custom template "Workout A (Push, Quads & Core)"
    const customOption = await screen.findByRole('button', {
      name: /Workout A \(Push, Quads & Core\)/i,
    });
    fireEvent.click(customOption);

    // CRITICAL RACE ASSERTION:
    // Before fetchTemplateDetail resolves, the modal MUST still be open so user cannot interact with old cards!
    expect(screen.getByTestId('routine-picker-modal')).toBeInTheDocument();

    // Now resolve the deferred detail fetch
    await act(async () => {
      resolveDetailFetch({
        id: 'tpl-custom-workout-a',
        exercises: [
          {
            id: 'te-1',
            template_id: 'tpl-custom-workout-a',
            exercise_id: 'ex-incline-bench',
            order_index: 0,
            target_sets: 3,
            target_reps: 8,
            exercise: { name: 'Incline Bench Press' },
          },
        ],
      });
    });

    // After resolve, the modal closes and new exercise is visible
    await waitFor(() => {
      expect(screen.queryByTestId('routine-picker-modal')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Incline Bench Press')).toBeInTheDocument();
  });

  it('(b) the X-then-Y race: when X resolves after Y, only Y is applied', async () => {
    let resolveX!: (value: any) => void;
    let resolveY!: (value: any) => void;
    const promiseX = new Promise((resolve) => {
      resolveX = resolve;
    });
    const promiseY = new Promise((resolve) => {
      resolveY = resolve;
    });

    mockFetchTemplateDetail.mockImplementation((templateId: string) => {
      if (templateId === 'tpl-x') return promiseX;
      if (templateId === 'tpl-y') return promiseY;
      return Promise.resolve(null);
    });

    const mockExercises: Exercise[] = [
      { id: 'ex-x', name: 'Exercise X', body_parts: ['Chest'], is_master: true },
      { id: 'ex-y', name: 'Exercise Y', body_parts: ['Back'], is_master: true },
    ];

    const templateX: RoutineTemplate = {
      id: 'tpl-x',
      user_id: testUserId,
      name: 'Routine X',
      is_master: false,
      assigned_to: null,
      created_at: '2026-01-01',
    };

    const templateY: RoutineTemplate = {
      id: 'tpl-y',
      user_id: testUserId,
      name: 'Routine Y',
      is_master: false,
      assigned_to: null,
      created_at: '2026-01-02',
    };

    const { result } = renderHook(() =>
      useWorkoutSession({
        targetUserId: testUserId,
        exercises: mockExercises,
        exercisesFetched: true,
        customTemplates: [templateX, templateY],
        templatesFetched: true,
        userLogs: [],
        logsFetched: true,
      })
    );

    // 1. Select routine X
    let selectPromiseX: Promise<void> | undefined;
    act(() => {
      selectPromiseX = result.current.handleSelectRoutine('Routine X', templateX);
    });

    // 2. Select routine Y quickly while X is still in flight
    let selectPromiseY: Promise<void> | undefined;
    act(() => {
      selectPromiseY = result.current.handleSelectRoutine('Routine Y', templateY);
    });

    // 3. Resolve Y first
    await act(async () => {
      resolveY({
        id: 'tpl-y',
        exercises: [
          {
            id: 'te-y',
            template_id: 'tpl-y',
            exercise_id: 'ex-y',
            order_index: 0,
            target_sets: 3,
            target_reps: 10,
            exercise: { name: 'Exercise Y' },
          },
        ],
      });
      await selectPromiseY;
    });

    expect(result.current.activeRoutineName).toBe('Routine Y');
    expect(result.current.activeExercises).toEqual(['Exercise Y']);

    // 4. Resolve X AFTER Y has already completed
    await act(async () => {
      resolveX({
        id: 'tpl-x',
        exercises: [
          {
            id: 'te-x',
            template_id: 'tpl-x',
            exercise_id: 'ex-x',
            order_index: 0,
            target_sets: 4,
            target_reps: 8,
            exercise: { name: 'Exercise X' },
          },
        ],
      });
      await selectPromiseX;
    });

    // 5. CRITICAL INVARIANT: Routine Y must remain active. Stale X must be discarded!
    expect(result.current.activeRoutineName).toBe('Routine Y');
    expect(result.current.activeExercises).toEqual(['Exercise Y']);
  });

  it('fetch failure still closes the modal and falls back to empty exercises', async () => {
    mockFetchTemplateDetail.mockRejectedValue(new Error('Network error'));

    setQueriesMock({
      exercises: [
        { id: 'ex-lat', name: 'Lat Pull Down', body_parts: ['Back'], is_master: true },
        { id: 'ex-incline-bench', name: 'Incline Bench Press', body_parts: ['Chest'], is_master: true },
      ],
      exercisesFetched: true,
      customTemplates: [brokenCustomTemplate],
      templatesFetched: true,
      userLogs: [],
      logsFetched: true,
      availableRoutines: {
        custom: [brokenCustomTemplate],
        defaults: [],
      },
      isLogsError: false,
      logsError: null,
      refetchLogs: vi.fn(),
    });

    renderWorkout();

    const routineBtn = screen.getByTestId('routine-select-btn');
    fireEvent.click(routineBtn);

    const brokenOption = await screen.findByRole('button', { name: /Broken Routine/i });
    fireEvent.click(brokenOption);

    // Modal closes despite fetch failure
    await waitFor(() => {
      expect(screen.queryByTestId('routine-picker-modal')).not.toBeInTheDocument();
    });
  });
});
