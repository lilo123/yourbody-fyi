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
});

