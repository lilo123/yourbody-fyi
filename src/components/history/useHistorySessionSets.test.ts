import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { useHistorySessionSets } from './useHistorySessionSets';
import * as pendingOpsModule from '../workout/useWorkoutPendingOps';
import * as workoutHistoryModule from './useWorkoutHistory';
import type { HistorySession } from './useWorkoutHistory';
import type { OutboxOp } from '../../offline/types';

describe('useHistorySessionSets deduplication', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const session: HistorySession = {
    id: 'w-session-1',
    date: '2026-09-30T10:00:00Z',
    workout_date: '2026-09-30',
    civil_date: '2026-09-30',
    name: 'Chest Day',
    set_count: 1,
    total_volume: 100,
  };

  beforeEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('deduplicates pending set against server fetched rawSets with matching id', async () => {
    // Mock server returning rawSets that already includes the synced set
    vi.spyOn(workoutHistoryModule, 'fetchSessionSets').mockResolvedValue([
      {
        id: 'set-dedup-1',
        workout_id: 'w-session-1',
        exercise_id: 'bench-press',
        weight: 100,
        reps: 10,
        set_index: 0,
        set_type: 'working',
        rpe: null,
        workout_date: '2026-09-30',
        workout_name: 'Chest Day',
        created_at: '2026-09-30T10:00:00Z',
      },
    ]);

    // Mock outbox still having the pending set.create op (e.g. before op deletion completes)
    const pendingOps: OutboxOp[] = [
      {
        opId: 'op-1',
        userId: 'u1',
        seq: 1,
        createdAt: '2026-09-30T10:00:00Z',
        kind: 'set.create',
        payload: {
          id: 'set-dedup-1',
          workoutRef: 'w-session-1',
          exercise_id: 'bench-press',
          weight: 100,
          reps: 10,
          set_index: 0,
          set_type: 'working',
          created_at: '2026-09-30T10:00:00Z',
        },
        state: 'pending',
        attempts: 0,
      },
    ];
    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue(pendingOps);

    const { result } = renderHook(() =>
      useHistorySessionSets({
        targetUserId: 'u1',
        sessions: [session],
        queryClient,
      })
    );

    // Call loadSetsForSession
    await act(async () => {
      await result.current.loadSetsForSession('w-session-1');
    });

    await waitFor(() => {
      expect(result.current.sessionSetsMap['w-session-1']).toBeDefined();
    });

    const sets = result.current.sessionSetsMap['w-session-1'];
    // Must be exactly 1, not duplicated!
    expect(sets).toHaveLength(1);
    expect(sets[0].id).toBe('set-dedup-1');
  });

  it('sorts sets deterministically by set_index, created_at, then id (D-YB-8)', async () => {
    vi.spyOn(workoutHistoryModule, 'fetchSessionSets').mockResolvedValue([
      {
        id: 'set-z',
        workout_id: 'w-session-1',
        exercise_id: 'bench-press',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        rpe: null,
        workout_date: '2026-09-30',
        workout_name: 'Chest Day',
        created_at: '2026-09-30T10:05:00Z',
      },
      {
        id: 'set-a',
        workout_id: 'w-session-1',
        exercise_id: 'bench-press',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        rpe: null,
        workout_date: '2026-09-30',
        workout_name: 'Chest Day',
        created_at: '2026-09-30T10:00:00Z',
      },
      {
        id: 'set-c',
        workout_id: 'w-session-1',
        exercise_id: 'bench-press',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        rpe: null,
        workout_date: '2026-09-30',
        workout_name: 'Chest Day',
        created_at: '2026-09-30T10:00:00Z',
      },
      {
        id: 'set-b',
        workout_id: 'w-session-1',
        exercise_id: 'bench-press',
        weight: 100,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        rpe: null,
        workout_date: '2026-09-30',
        workout_name: 'Chest Day',
        created_at: '2026-09-30T10:00:00Z',
      },
    ]);

    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue([]);

    const { result } = renderHook(() =>
      useHistorySessionSets({
        targetUserId: 'u1',
        sessions: [session],
        queryClient,
      })
    );

    await act(async () => {
      await result.current.loadSetsForSession('w-session-1');
    });

    await waitFor(() => {
      expect(result.current.sessionSetsMap['w-session-1']).toBeDefined();
    });

    const sets = result.current.sessionSetsMap['w-session-1'];
    // For set_index 1 and same created_at (10:00:00Z), id sorts 'set-a', 'set-b', 'set-c', followed by 10:05:00Z 'set-z'
    expect(sets.map((s) => s.id)).toEqual(['set-a', 'set-b', 'set-c', 'set-z']);
  });

  it('awaits in-flight [exercises] query so sets are enriched with exercise names', async () => {
    vi.spyOn(workoutHistoryModule, 'fetchSessionSets').mockResolvedValue([
      {
        id: 'set-enrich-1',
        workout_id: 'w-session-1',
        exercise_id: 'ex-bench-press',
        weight: 135,
        reps: 5,
        set_index: 0,
        set_type: 'working',
        rpe: null,
        workout_date: '2026-09-30',
        workout_name: 'Chest Day',
        created_at: '2026-09-30T10:00:00Z',
      },
    ]);

    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue([]);

    let resolveExercises!: (exercises: Array<{ id: string; name: string }>) => void;
    const exercisesPromise = new Promise<Array<{ id: string; name: string }>>((resolve) => {
      resolveExercises = resolve;
    });

    queryClient.prefetchQuery({
      queryKey: ['exercises'],
      queryFn: () => exercisesPromise,
    });

    const { result } = renderHook(() =>
      useHistorySessionSets({
        targetUserId: 'u1',
        sessions: [session],
        queryClient,
      })
    );

    await act(async () => {
      const load = result.current.loadSetsForSession('w-session-1');
      resolveExercises([{ id: 'ex-bench-press', name: 'Barbell Bench Press' }]);
      await load;
    });

    await waitFor(() => {
      expect(result.current.sessionSetsMap['w-session-1']).toBeDefined();
    });

    const sets = result.current.sessionSetsMap['w-session-1'];
    expect(sets).toHaveLength(1);
    expect(sets[0].exercise_name).toBe('Barbell Bench Press');
  });

  it('offline: falls back to cached sets in 90d cache when network fails and shows sets without error banner', async () => {
    vi.spyOn(workoutHistoryModule, 'fetchSessionSets').mockRejectedValue(new Error('Failed to fetch'));
    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue([]);

    queryClient.setQueryData(['workout_sets', 'u1', '90d'], [
      {
        id: 'cached-set-1',
        workout_id: 'w-session-1',
        exercise_id: 'bench-press',
        exercise_name: 'Bench Press',
        weight: 185,
        reps: 8,
        set_index: 0,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
      {
        id: 'cached-set-other',
        workout_id: 'w-session-other',
        exercise_id: 'squat',
        exercise_name: 'Squat',
        weight: 225,
        reps: 5,
        set_index: 0,
        set_type: 'working',
        created_at: '2026-09-29T10:00:00Z',
      },
    ]);

    const { result } = renderHook(() =>
      useHistorySessionSets({
        targetUserId: 'u1',
        sessions: [session],
        queryClient,
      })
    );

    await act(async () => {
      await result.current.loadSetsForSession('w-session-1');
    });

    expect(result.current.sessionErrorIds.has('w-session-1')).toBe(false);
    expect(result.current.sessionSetsMap['w-session-1']).toBeDefined();
    expect(result.current.sessionSetsMap['w-session-1']).toHaveLength(1);
    expect(result.current.sessionSetsMap['w-session-1'][0].id).toBe('cached-set-1');
  });

  it('offline: falls back to session.sets when network fails and shows sets without error banner', async () => {
    vi.spyOn(workoutHistoryModule, 'fetchSessionSets').mockRejectedValue(new Error('Network error'));
    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue([]);

    const sessionWithSets: HistorySession = {
      ...session,
      sets: [
        {
          id: 'session-set-1',
          workout_id: 'w-session-1',
          exercise_id: 'bench-press',
          exercise_name: 'Bench Press',
          weight: 155,
          reps: 8,
          set_index: 0,
          set_type: 'working',
          workout_date: '2026-09-30',
          workout_name: 'Chest Day',
          created_at: '2026-09-30T10:00:00Z',
        },
      ],
    };

    const { result } = renderHook(() =>
      useHistorySessionSets({
        targetUserId: 'u1',
        sessions: [sessionWithSets],
        queryClient,
      })
    );

    await act(async () => {
      await result.current.loadSetsForSession('w-session-1');
    });

    expect(result.current.sessionErrorIds.has('w-session-1')).toBe(false);
    expect(result.current.sessionSetsMap['w-session-1']).toBeDefined();
    expect(result.current.sessionSetsMap['w-session-1']).toHaveLength(1);
    expect(result.current.sessionSetsMap['w-session-1'][0].id).toBe('session-set-1');
  });

  it('overlays queued set.batchCreate sets into sessionSetsMap', async () => {
    vi.spyOn(workoutHistoryModule, 'fetchSessionSets').mockResolvedValue([]);

    const pendingOps: OutboxOp[] = [
      {
        opId: 'op-batch-1',
        userId: 'u1',
        seq: 1,
        createdAt: '2026-09-30T10:00:00Z',
        state: 'pending',
        attempts: 0,
        kind: 'set.batchCreate',
        payload: {
          workoutRef: 'w-session-1',
          sets: [
            {
              id: 'set-batch-1',
              exercise_id: 'bench-press',
              weight: 225,
              reps: 5,
              set_index: 0,
              set_type: 'working',
              rpe: 8,
              created_at: '2026-09-30T10:00:00Z',
            },
            {
              id: 'set-batch-2',
              exercise_id: 'bench-press',
              weight: 225,
              reps: 5,
              set_index: 1,
              set_type: 'working',
              rpe: 8.5,
              created_at: '2026-09-30T10:02:00Z',
            },
          ],
        },
      },
    ];

    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue(pendingOps);

    const { result } = renderHook(() =>
      useHistorySessionSets({
        targetUserId: 'u1',
        sessions: [session],
        queryClient,
      })
    );

    await act(async () => {
      await result.current.loadSetsForSession('w-session-1');
    });

    await waitFor(() => {
      expect(result.current.sessionSetsMap['w-session-1']).toBeDefined();
    });

    const sets = result.current.sessionSetsMap['w-session-1'];
    expect(sets).toHaveLength(2);
    expect(sets.map((s) => s.id)).toEqual(['set-batch-1', 'set-batch-2']);
  });

  it('matches set.batchCreate by workout_date and applies pending updates and deletes', async () => {
    vi.spyOn(workoutHistoryModule, 'fetchSessionSets').mockResolvedValue([]);

    const pendingOps: OutboxOp[] = [
      {
        opId: 'op-ensure-1',
        userId: 'u1',
        seq: 1,
        createdAt: '2026-09-30T09:00:00Z',
        state: 'pending',
        attempts: 0,
        kind: 'workout.ensure',
        payload: {
          clientWorkoutId: 'client-w-1',
          workout_date: '2026-09-30',
          name: 'Chest Day',
        },
      },
      {
        opId: 'op-batch-2',
        userId: 'u1',
        seq: 2,
        createdAt: '2026-09-30T10:00:00Z',
        state: 'pending',
        attempts: 0,
        kind: 'set.batchCreate',
        payload: {
          workoutRef: 'client-w-1',
          sets: [
            {
              id: 'set-b-keep',
              exercise_id: 'bench-press',
              weight: 200,
              reps: 5,
              set_index: 0,
              set_type: 'working',
              created_at: '2026-09-30T10:00:00Z',
            },
            {
              id: 'set-b-del',
              exercise_id: 'bench-press',
              weight: 200,
              reps: 5,
              set_index: 1,
              set_type: 'working',
              created_at: '2026-09-30T10:02:00Z',
            },
          ],
        },
      },
      {
        opId: 'op-update-1',
        userId: 'u1',
        seq: 3,
        createdAt: '2026-09-30T10:05:00Z',
        state: 'pending',
        attempts: 0,
        kind: 'set.update',
        payload: {
          id: 'set-b-keep',
          patch: { weight: 210, reps: 6 },
        },
      },
      {
        opId: 'op-del-1',
        userId: 'u1',
        seq: 4,
        createdAt: '2026-09-30T10:06:00Z',
        state: 'pending',
        attempts: 0,
        kind: 'set.delete',
        payload: {
          id: 'set-b-del',
        },
      },
    ];

    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue(pendingOps);

    const { result } = renderHook(() =>
      useHistorySessionSets({
        targetUserId: 'u1',
        sessions: [session], // session id is 'w-session-1', civil_date is '2026-09-30'
        queryClient,
      })
    );

    await act(async () => {
      await result.current.loadSetsForSession('w-session-1');
    });

    await waitFor(() => {
      expect(result.current.sessionSetsMap['w-session-1']).toBeDefined();
    });

    const sets = result.current.sessionSetsMap['w-session-1'];
    expect(sets).toHaveLength(1);
    expect(sets[0].id).toBe('set-b-keep');
    expect(sets[0].weight).toBe(210);
    expect(sets[0].reps).toBe(6);
  });

  it('offline: falls back to date-keyed workout_sets cache when network fails', async () => {
    vi.spyOn(workoutHistoryModule, 'fetchSessionSets').mockRejectedValue(new Error('Connection reset'));
    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue([]);

    queryClient.setQueryData(['workout_sets', 'u1', '2026-09-30'], [
      {
        id: 'date-cached-set-1',
        workout_id: 'w-session-1',
        exercise_id: 'incline-bench',
        exercise_name: 'Incline Bench',
        weight: 145,
        reps: 6,
        set_index: 0,
        set_type: 'working',
        created_at: '2026-09-30T10:00:00Z',
      },
    ]);

    const { result } = renderHook(() =>
      useHistorySessionSets({
        targetUserId: 'u1',
        sessions: [session],
        queryClient,
      })
    );

    await act(async () => {
      await result.current.loadSetsForSession('w-session-1');
    });

    expect(result.current.sessionErrorIds.has('w-session-1')).toBe(false);
    expect(result.current.sessionSetsMap['w-session-1']).toBeDefined();
    expect(result.current.sessionSetsMap['w-session-1']).toHaveLength(1);
    expect(result.current.sessionSetsMap['w-session-1'][0].id).toBe('date-cached-set-1');
  });

  it('offline (navigator.onLine false): falls back to cached sets without error banner', async () => {
    const originalNavigator = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { ...originalNavigator, onLine: false },
        configurable: true,
      });

      const fetchSpy = vi.spyOn(workoutHistoryModule, 'fetchSessionSets');
      vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue([]);

      queryClient.setQueryData(['workout_sets', 'u1', '90d'], [
        {
          id: 'offline-cached-set-1',
          workout_id: 'w-session-1',
          exercise_id: 'bench-press',
          exercise_name: 'Bench Press',
          weight: 200,
          reps: 5,
          set_index: 0,
          set_type: 'working',
          created_at: '2026-09-30T10:00:00Z',
        },
      ]);

      const { result } = renderHook(() =>
        useHistorySessionSets({
          targetUserId: 'u1',
          sessions: [session],
          queryClient,
        })
      );

      await act(async () => {
        await result.current.loadSetsForSession('w-session-1');
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.current.sessionErrorIds.has('w-session-1')).toBe(false);
      expect(result.current.sessionSetsMap['w-session-1']).toBeDefined();
      expect(result.current.sessionSetsMap['w-session-1']).toHaveLength(1);
      expect(result.current.sessionSetsMap['w-session-1'][0].id).toBe('offline-cached-set-1');
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it('offline: keeps error banner when nothing is cached and does not swallow into empty array', async () => {
    vi.spyOn(workoutHistoryModule, 'fetchSessionSets').mockRejectedValue(new Error('Network offline'));
    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue([]);

    const { result } = renderHook(() =>
      useHistorySessionSets({
        targetUserId: 'u1',
        sessions: [session],
        queryClient,
      })
    );

    await act(async () => {
      await result.current.loadSetsForSession('w-session-1');
    });

    expect(result.current.sessionErrorIds.has('w-session-1')).toBe(true);
    expect(result.current.sessionSetsMap['w-session-1']).toBeUndefined();
  });

  it('online: loads sets from fetchSessionSets when network succeeds', async () => {
    vi.spyOn(workoutHistoryModule, 'fetchSessionSets').mockResolvedValue([
      {
        id: 'online-set-1',
        workout_id: 'w-session-1',
        exercise_id: 'bench-press',
        exercise_name: 'Bench Press',
        weight: 185,
        reps: 10,
        set_index: 0,
        set_type: 'working',
        rpe: null,
        workout_date: '2026-09-30',
        workout_name: 'Chest Day',
        created_at: '2026-09-30T10:00:00Z',
      },
    ]);
    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue([]);

    const { result } = renderHook(() =>
      useHistorySessionSets({
        targetUserId: 'u1',
        sessions: [session],
        queryClient,
      })
    );

    await act(async () => {
      await result.current.loadSetsForSession('w-session-1');
    });

    expect(result.current.sessionErrorIds.has('w-session-1')).toBe(false);
    expect(result.current.sessionSetsMap['w-session-1']).toBeDefined();
    expect(result.current.sessionSetsMap['w-session-1']).toHaveLength(1);
    expect(result.current.sessionSetsMap['w-session-1'][0].id).toBe('online-set-1');
  });

  it('overlays offline sets matching session local civil date in evening west of UTC', async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      // 18:30 PDT on 2026-10-31 -> UTC is 2026-11-01T01:30:00.000Z
      const createdAt = '2026-11-01T01:30:00.000Z';
      const syntheticSession: HistorySession = {
        id: 'offline-2026-10-31-w-server-synced',
        date: '2026-10-31T12:00:00.000Z',
        workout_date: '2026-10-31',
        civil_date: '2026-10-31',
        name: 'Evening Workout',
        set_count: 1,
        total_volume: 200,
      };

      const pendingOps: OutboxOp[] = [
        {
          opId: 'op-sess-evening',
          userId: 'u1',
          seq: 1,
          createdAt,
          kind: 'set.create',
          payload: {
            id: 'set-sess-evening-1',
            workoutRef: 'w-server-synced',
            exercise_id: 'bench-press',
            weight: 200,
            reps: 8,
            set_index: 0,
            set_type: 'working',
            created_at: createdAt,
          },
          state: 'pending',
          attempts: 0,
        },
      ];

      vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue(pendingOps);

      const { result } = renderHook(() =>
        useHistorySessionSets({
          targetUserId: 'u1',
          sessions: [syntheticSession],
          queryClient,
        })
      );

      await act(async () => {
        await result.current.loadSetsForSession('offline-2026-10-31-w-server-synced');
      });

      await waitFor(() => {
        expect(result.current.sessionSetsMap['offline-2026-10-31-w-server-synced']).toBeDefined();
      });

      const sets = result.current.sessionSetsMap['offline-2026-10-31-w-server-synced'];
      expect(sets).toHaveLength(1);
      expect(sets[0].id).toBe('set-sess-evening-1');
    } finally {
      process.env.TZ = prevTz;
    }
  });
});


