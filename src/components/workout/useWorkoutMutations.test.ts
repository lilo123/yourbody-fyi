import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useWorkoutMutations } from './useWorkoutMutations';
import * as setsLib from '../../lib/sets';
import * as invalidateLib from '../../lib/invalidate';
import { workoutSessionStore } from '../../utils/workoutSessionStore';
import { supabase } from '../../lib/supabase';

describe('useWorkoutMutations (P2 / W4 / W20 / W35 / H2)', () => {
  let queryClient: QueryClient;
  const mockSetMutationError = vi.fn();
  const targetUserId = '00000000-0000-0000-0000-000000000001';
  const workoutDate = '2026-09-27';
  const exerciseId = '00000000-0000-0000-0000-000000000002';
  const exercises = [
    { id: exerciseId, name: 'Bench Press', body_parts: ['Chest'], is_master: true },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    workoutSessionStore.resetForTesting();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  it('W35: optimistically updates cache on logSet and rolls back on failure', async () => {
    const queryKey = ['workout_sets', targetUserId, workoutDate];
    queryClient.setQueryData(queryKey, [
      { id: 'existing-1', weight: 185, reps: 5, set_index: 1, workout_date: workoutDate },
    ]);

    // Mock insert failure
    vi.spyOn(setsLib, 'getOrCreateWorkout').mockResolvedValue('w-123');
    vi.spyOn(setsLib, 'insertSet').mockRejectedValue(new Error('Network insert failure'));

    const { result } = renderHook(
      () =>
        useWorkoutMutations({
          targetUserId,
          workoutDate,
          activeRoutineName: 'Chest Day',
          exercises: exercises as any,
          autoRestTimer: false,
          setMutationError: mockSetMutationError,
        }),
      { wrapper }
    );

    await act(async () => {
      try {
        await result.current.logSetMutation.mutateAsync({
          exerciseName: 'Bench Press',
          weight: 225,
          reps: 3,
          setIndex: 2,
        });
      } catch {
        // Expected mutation failure
      }
    });

    // Error is routed to exerciseErrors for the exercise card, mutationError stays null
    expect(result.current.exerciseErrors['Bench Press']?.message).toBe('Network insert failure');
    expect(result.current.mutationError).toBeNull();

    // Cache must have rolled back to the initial 1 set
    const currentData = queryClient.getQueryData<any[]>(queryKey);
    expect(currentData).toHaveLength(1);
    expect(currentData?.[0].id).toBe('existing-1');
  });

  it('W4: preserves draft inputs on mutation failure and clears them on success', async () => {
    // Stage draft input in workoutSessionStore
    workoutSessionStore.getOrInitSession(targetUserId, workoutDate, {
      routineName: 'Chest Day',
      exercises: ['Bench Press'],
      targetSetCounts: { 'Bench Press': 3 },
      targetRepCounts: { 'Bench Press': 5 },
    });
    workoutSessionStore.setDraftInput(targetUserId, workoutDate, exerciseId, 1, {
      weight: '225',
      reps: '5',
    });
    workoutSessionStore.flushPendingWrites();

    // 1. Failure case: insert fails -> draft must NOT be wiped
    vi.spyOn(setsLib, 'getOrCreateWorkout').mockResolvedValue('w-123');
    vi.spyOn(setsLib, 'insertSet').mockRejectedValueOnce(new Error('500 DB error'));

    const { result } = renderHook(
      () =>
        useWorkoutMutations({
          targetUserId,
          workoutDate,
          activeRoutineName: 'Chest Day',
          exercises: exercises as any,
          autoRestTimer: false,
          setMutationError: mockSetMutationError,
        }),
      { wrapper }
    );

    await act(async () => {
      try {
        await result.current.logSetMutation.mutateAsync({
          exerciseName: 'Bench Press',
          weight: 225,
          reps: 5,
          setIndex: 1,
        });
      } catch {
        // Expected
      }
    });

    // Draft must still be intact
    const sessionAfterFail = workoutSessionStore.getSession(targetUserId, workoutDate);
    expect(sessionAfterFail?.inputDrafts[`${exerciseId}_1`]).toEqual({
      weight: '225',
      reps: '5',
    });

    // 2. Success case: insert succeeds -> draft must be cleared
    vi.spyOn(setsLib, 'insertSet').mockResolvedValueOnce({
      id: 'logged-set-1',
      workout_id: 'w-123',
      exercise_id: exerciseId,
      weight: 225,
      reps: 5,
      set_index: 1,
      set_type: 'working',
      rpe: null,
      created_at: new Date().toISOString(),
    });

    await act(async () => {
      await result.current.logSetMutation.mutateAsync({
        exerciseName: 'Bench Press',
        weight: 225,
        reps: 5,
        setIndex: 1,
      });
    });

    const sessionAfterSuccess = workoutSessionStore.getSession(targetUserId, workoutDate);
    expect(sessionAfterSuccess?.inputDrafts[`${exerciseId}_1`]).toBeUndefined();
  });

  it('W20 & H2: invalidates workout-derived queries via invalidateWorkoutDerived', async () => {
    const invalidateSpy = vi.spyOn(invalidateLib, 'invalidateWorkoutDerived').mockResolvedValue();
    vi.spyOn(setsLib, 'getOrCreateWorkout').mockResolvedValue('w-123');
    vi.spyOn(setsLib, 'insertSet').mockResolvedValue({
      id: 'logged-set-1',
      workout_id: 'w-123',
      exercise_id: exerciseId,
      weight: 185,
      reps: 8,
      set_index: 1,
      set_type: 'working',
      rpe: null,
      created_at: new Date().toISOString(),
    });

    const { result } = renderHook(
      () =>
        useWorkoutMutations({
          targetUserId,
          workoutDate,
          activeRoutineName: 'Chest Day',
          exercises: exercises as any,
          autoRestTimer: false,
          setMutationError: mockSetMutationError,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.logSetMutation.mutateAsync({
        exerciseName: 'Bench Press',
        weight: 185,
        reps: 8,
        setIndex: 1,
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(expect.anything(), targetUserId);
  });
  it('resolves 210th exercise from a 210-row catalog and logs set successfully', async () => {
    const catalog210 = Array.from({ length: 210 }, (_, i) => ({
      id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
      name: i === 209 ? 'Zottman Curl' : `Exercise ${String(i + 1).padStart(3, '0')}`,
      body_parts: ['Arms'],
      is_master: true,
    }));

    const insertSpy = vi.spyOn(setsLib, 'insertSet').mockResolvedValue({
      id: 'logged-set-zottman',
      workout_id: 'w-123',
      exercise_id: catalog210[209].id,
      weight: 35,
      reps: 10,
      set_index: 1,
      set_type: 'working',
      rpe: null,
      created_at: new Date().toISOString(),
    });
    vi.spyOn(setsLib, 'getOrCreateWorkout').mockResolvedValue('w-123');

    const { result } = renderHook(
      () =>
        useWorkoutMutations({
          targetUserId,
          workoutDate,
          activeRoutineName: 'Arm Day',
          exercises: catalog210 as any,
          autoRestTimer: false,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.logSetMutation.mutateAsync({
        exerciseName: 'Zottman Curl',
        weight: 35,
        reps: 10,
        setIndex: 1,
      });
    });

    expect(insertSpy).toHaveBeenCalledWith(
      expect.anything(),
      'w-123',
      expect.objectContaining({
        exerciseId: catalog210[209].id,
        weight: 35,
        reps: 10,
      })
    );
  });

  it('falls back to single scoped lookup when exercise is not in loaded exercises list', async () => {
    const lookupExId = '00000000-0000-0000-0000-000000000999';
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'exercises') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: lookupExId, name: 'Weighted Sit-Up' },
            error: null,
          }),
        } as any;
      }
      return {} as any;
    });

    const insertSpy = vi.spyOn(setsLib, 'insertSet').mockResolvedValue({
      id: 'logged-set-weighted-situp',
      workout_id: 'w-123',
      exercise_id: lookupExId,
      weight: 45,
      reps: 15,
      set_index: 1,
      set_type: 'working',
      rpe: null,
      created_at: new Date().toISOString(),
    });
    vi.spyOn(setsLib, 'getOrCreateWorkout').mockResolvedValue('w-123');

    const { result } = renderHook(
      () =>
        useWorkoutMutations({
          targetUserId,
          workoutDate,
          activeRoutineName: 'Core Day',
          exercises: [],
          autoRestTimer: false,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.logSetMutation.mutateAsync({
        exerciseName: 'Weighted Sit-Up',
        weight: 45,
        reps: 15,
        setIndex: 1,
      });
    });

    expect(insertSpy).toHaveBeenCalledWith(
      expect.anything(),
      'w-123',
      expect.objectContaining({
        exerciseId: lookupExId,
        weight: 45,
        reps: 15,
      })
    );
  });

  it('resolves exercise ID carried by customTemplates item when present', async () => {
    const templateExId = '00000000-0000-0000-0000-000000000888';
    const mockTemplates = [
      {
        id: 'tmpl-1',
        name: 'Shoulder Day',
        exercises: [
          { exercise_id: templateExId, exercise: { name: 'Face Pull' } },
        ],
      },
    ];

    const insertSpy = vi.spyOn(setsLib, 'insertSet').mockResolvedValue({
      id: 'logged-set-facepull',
      workout_id: 'w-123',
      exercise_id: templateExId,
      weight: 50,
      reps: 15,
      set_index: 1,
      set_type: 'working',
      rpe: null,
      created_at: new Date().toISOString(),
    });
    vi.spyOn(setsLib, 'getOrCreateWorkout').mockResolvedValue('w-123');

    const { result } = renderHook(
      () =>
        useWorkoutMutations({
          targetUserId,
          workoutDate,
          activeRoutineName: 'Shoulder Day',
          exercises: [],
          customTemplates: mockTemplates as any,
          autoRestTimer: false,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.logSetMutation.mutateAsync({
        exerciseName: 'Face Pull',
        weight: 50,
        reps: 15,
        setIndex: 1,
      });
    });

    expect(insertSpy).toHaveBeenCalledWith(
      expect.anything(),
      'w-123',
      expect.objectContaining({
        exerciseId: templateExId,
        weight: 50,
        reps: 15,
      })
    );
  });

  it('isolates exercise mutation errors to exerciseErrors and leaves mutationError null', async () => {
    vi.spyOn(setsLib, 'getOrCreateWorkout').mockResolvedValue('w-123');
    vi.spyOn(setsLib, 'insertSet').mockRejectedValue(new Error('Card error only'));

    const { result } = renderHook(
      () =>
        useWorkoutMutations({
          targetUserId,
          workoutDate,
          activeRoutineName: 'Chest Day',
          exercises: exercises as any,
          autoRestTimer: false,
          setMutationError: mockSetMutationError,
        }),
      { wrapper }
    );

    await act(async () => {
      try {
        await result.current.logSetMutation.mutateAsync({
          exerciseName: 'Bench Press',
          weight: 225,
          reps: 3,
          setIndex: 1,
        });
      } catch {
        // Expected mutation failure
      }
    });

    expect(result.current.exerciseErrors['Bench Press']?.message).toBe('Card error only');
    expect(result.current.mutationError).toBeNull();
    expect(mockSetMutationError).not.toHaveBeenCalled();

    act(() => {
      result.current.clearExerciseError('Bench Press');
    });
    expect(result.current.exerciseErrors['Bench Press']).toBeUndefined();
  });

  it('passes targetUserId to deleteSet in deleteSetMutation', async () => {
    const deleteSpy = vi.spyOn(setsLib, 'deleteSet').mockResolvedValue(undefined as any);

    const { result } = renderHook(
      () =>
        useWorkoutMutations({
          targetUserId,
          workoutDate,
          activeRoutineName: 'Chest Day',
          exercises: exercises as any,
          autoRestTimer: false,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.deleteSetMutation.mutateAsync('set-to-delete-123');
    });

    expect(deleteSpy).toHaveBeenCalledWith(
      expect.anything(),
      'set-to-delete-123'
    );
  });

  it('Product Bug 1: with offline network and networkMode: "always", logSet mutation reaches enqueue', async () => {
    const { onlineManager } = await import('@tanstack/react-query');
    try {
      onlineManager.setOnline(false);

      const enqueueSpy = vi.spyOn(setsLib, 'insertSet').mockResolvedValue({
        id: 'offline-set-1',
        workout_id: 'w-123',
        exercise_id: exerciseId,
        weight: 225,
        reps: 5,
        set_index: 1,
        set_type: 'working',
        rpe: null,
        created_at: new Date().toISOString(),
      });
      vi.spyOn(setsLib, 'getOrCreateWorkout').mockResolvedValue('w-123');

      // 1. With buggy default (networkMode 'online'), mutation is paused and never executes
      const onlineClient = new QueryClient({
        defaultOptions: {
          queries: { networkMode: 'offlineFirst' },
          // mutations default to 'online'
        },
      });
      const { result: pausedResult } = renderHook(
        () =>
          useWorkoutMutations({
            targetUserId,
            workoutDate,
            activeRoutineName: 'Chest Day',
            exercises: exercises as any,
            autoRestTimer: false,
          }),
        { wrapper: ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: onlineClient }, children) }
      );

      // Mutate while offline with default options -> pauses, never calls insertSet
      pausedResult.current.logSetMutation.mutate({
        exerciseName: 'Bench Press',
        weight: 225,
        reps: 5,
        setIndex: 1,
      });
      const mutation = onlineClient.getMutationCache().getAll()[0];
      expect(mutation?.state.isPaused).toBe(true);
      expect(enqueueSpy).not.toHaveBeenCalled();

      // 2. With fixed default (networkMode 'always'), mutation executes immediately while offline
      const alwaysClient = new QueryClient({
        defaultOptions: {
          queries: { networkMode: 'offlineFirst' },
          mutations: { networkMode: 'always' },
        },
      });
      const { result: activeResult } = renderHook(
        () =>
          useWorkoutMutations({
            targetUserId,
            workoutDate,
            activeRoutineName: 'Chest Day',
            exercises: exercises as any,
            autoRestTimer: false,
          }),
        { wrapper: ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: alwaysClient }, children) }
      );

      await act(async () => {
        await activeResult.current.logSetMutation.mutateAsync({
          exerciseName: 'Bench Press',
          weight: 225,
          reps: 5,
          setIndex: 1,
        });
      });

      expect(enqueueSpy).toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
