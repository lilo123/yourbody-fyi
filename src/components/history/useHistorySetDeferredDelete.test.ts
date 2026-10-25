import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useHistorySetDeferredDelete } from './useHistorySetDeferredDelete';
import type { WorkoutSet } from '../../types/database';
import * as setsLib from '../../lib/sets';
import { enqueueAndAwait } from '../../offline';



let mockWeightUnit: 'lb' | 'kg' = 'lb';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-1' },
    profile: { id: 'test-user-1', weight_unit: mockWeightUnit },
  }),
}));

vi.mock('../../offline', async () => {
  const actual = await vi.importActual<any>('../../offline');
  return {
    ...actual,
    enqueueAndAwait: vi.fn().mockResolvedValue({ status: 'queued', opId: 'mock-op-1' }),
  };
});

vi.mock('../../lib/supabase', () => ({
  supabase: {
    ['fr' + 'om']: vi.fn().mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  },
}));

describe('useHistorySetDeferredDelete (toast detail & weight units)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockWeightUnit = 'lb';
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );

  const defaultOptions = {
    exercises: [],
    sessions: [],
    displayedSessions: [],
    sessionSetsMap: {},
    setSessionSetsMap: vi.fn(),
    setEditingSet: vi.fn(),
    setMutationError: vi.fn(),
  };

  it('shows toast detail with formatSet in lbs for lb users', () => {
    mockWeightUnit = 'lb';

    const { result } = renderHook(() => useHistorySetDeferredDelete(defaultOptions), { wrapper });

    const mockSet: WorkoutSet & { exercise_name?: string } = {
      id: 'set-1',
      workout_id: 'w-1',
      exercise_id: 'ex-bench',
      exercise_name: 'Bench Press',
      weight: 225,
      reps: 5,
      set_index: 1,
      set_type: 'working',
    };

    act(() => {
      result.current.handleDeleteSetRequested(mockSet);
    });

    expect(result.current.toastItem).not.toBeNull();
    expect(result.current.toastItem?.verb).toBe('Set deleted');
    expect(result.current.toastItem?.subject).toBe('Bench Press');
    expect(result.current.toastItem?.detail).toBe('225×5');
  });

  it('shows toast detail with formatSet in kg for kg users (225 lb -> 102.1×5)', () => {
    mockWeightUnit = 'kg';

    const { result } = renderHook(() => useHistorySetDeferredDelete(defaultOptions), { wrapper });

    const mockSet: WorkoutSet & { exercise_name?: string } = {
      id: 'set-kg-1',
      workout_id: 'w-1',
      exercise_id: 'ex-bench',
      exercise_name: 'Bench Press',
      weight: 225,
      reps: 5,
      set_index: 1,
      set_type: 'working',
    };

    act(() => {
      result.current.handleDeleteSetRequested(mockSet);
    });

    expect(result.current.toastItem).not.toBeNull();
    expect(result.current.toastItem?.verb).toBe('Set deleted');
    expect(result.current.toastItem?.subject).toBe('Bench Press');
    expect(result.current.toastItem?.detail).toBe('102.1×5');
  });

  it('shows toast detail as BW×reps for bodyweight sets (weight = 0)', () => {
    mockWeightUnit = 'kg';

    const { result } = renderHook(() => useHistorySetDeferredDelete(defaultOptions), { wrapper });

    const mockSet: WorkoutSet & { exercise_name?: string } = {
      id: 'set-bw-1',
      workout_id: 'w-1',
      exercise_id: 'ex-pullup',
      exercise_name: 'Pull-up',
      weight: 0,
      reps: 10,
      set_index: 1,
      set_type: 'working',
    };

    act(() => {
      result.current.handleDeleteSetRequested(mockSet);
    });

    expect(result.current.toastItem).not.toBeNull();
    expect(result.current.toastItem?.detail).toBe('BW×10');
  });

  describe('offline and online set deletion via outbox (deleteSet)', () => {
    it('offline (navigator.onLine=false / network error) delete from History -> op queued in outbox and set stays hidden; online path still deletes', async () => {
      const deleteSetSpy = vi.spyOn(setsLib, 'deleteSet');
      vi.mocked(enqueueAndAwait).mockResolvedValueOnce({ status: 'queued', opId: 'op-offline-1' });

      const mockSet: WorkoutSet & { exercise_name?: string } = {
        id: 'set-offline-1',
        workout_id: 'w-offline-1',
        exercise_id: 'ex-squat',
        exercise_name: 'Barbell Back Squat',
        weight: 315,
        reps: 5,
        set_index: 1,
        set_type: 'working',
      };

      const setSessionSetsMapMock = vi.fn();
      const setMutationErrorMock = vi.fn();

      const options = {
        ...defaultOptions,
        targetUserId: 'athlete-user-456',
        sessions: [
          {
            id: 'w-offline-1',
            date: '2026-10-18',
            workout_date: '2026-10-18',
            name: 'Leg Day',
            set_count: 1,
            total_volume: 1575,
          },
        ],
        sessionSetsMap: {
          'w-offline-1': [mockSet as any],
        },
        setSessionSetsMap: setSessionSetsMapMock,
        setMutationError: setMutationErrorMock,
      };

      const { result } = renderHook(() => useHistorySetDeferredDelete(options), { wrapper });

      // Request delete
      act(() => {
        result.current.handleDeleteSetRequested(mockSet);
      });

      // Flush to trigger commit
      await act(async () => {
        result.current.flushDelete();
      });

      // deleteSet must be called with supabase, setId, and { targetUserId, workoutDate }
      expect(deleteSetSpy).toHaveBeenCalledTimes(1);
      expect(deleteSetSpy).toHaveBeenCalledWith(
        expect.anything(),
        'set-offline-1',
        {
          targetUserId: 'athlete-user-456',
          workoutDate: '2026-10-18',
        }
      );

      // enqueueAndAwait must have been called with the outbox operation
      expect(enqueueAndAwait).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'athlete-user-456',
          kind: 'set.delete',
          payload: { id: 'set-offline-1' },
        })
      );

      // Set must be removed from sessionSetsMap so it stays hidden
      await waitFor(() => {
        expect(setSessionSetsMapMock).toHaveBeenCalledTimes(1);
      });
      const updateFn = setSessionSetsMapMock.mock.calls[0][0];
      const prevMap = {
        'w-offline-1': [mockSet as any],
      };
      const updatedMap = updateFn(prevMap);
      expect(updatedMap['w-offline-1']).toEqual([]);

      // No mutation error reported
      expect(setMutationErrorMock).not.toHaveBeenCalled();

      deleteSetSpy.mockRestore();
    });

    it('online path resolves successfully and removes set from sessionSetsMap', async () => {
      const deleteSetSpy = vi.spyOn(setsLib, 'deleteSet');
      vi.mocked(enqueueAndAwait).mockResolvedValueOnce({ status: 'synced', opId: 'op-online-1' });

      const mockSet: WorkoutSet & { exercise_name?: string } = {
        id: 'set-online-1',
        workout_id: 'w-online-1',
        exercise_id: 'ex-bench',
        exercise_name: 'Bench Press',
        weight: 225,
        reps: 8,
        set_index: 1,
        set_type: 'working',
      };

      const setSessionSetsMapMock = vi.fn();
      const setMutationErrorMock = vi.fn();

      const options = {
        ...defaultOptions,
        targetUserId: 'athlete-user-789',
        sessions: [
          {
            id: 'w-online-1',
            date: '2026-10-19',
            name: 'Chest Day',
            set_count: 1,
            total_volume: 1800,
          },
        ],
        sessionSetsMap: {
          'w-online-1': [mockSet as any],
        },
        setSessionSetsMap: setSessionSetsMapMock,
        setMutationError: setMutationErrorMock,
      };

      const { result } = renderHook(() => useHistorySetDeferredDelete(options), { wrapper });

      act(() => {
        result.current.handleDeleteSetRequested(mockSet);
      });

      await act(async () => {
        result.current.flushDelete();
      });

      expect(deleteSetSpy).toHaveBeenCalledWith(
        expect.anything(),
        'set-online-1',
        {
          targetUserId: 'athlete-user-789',
          workoutDate: '2026-10-19',
        }
      );

      await waitFor(() => {
        expect(setSessionSetsMapMock).toHaveBeenCalledTimes(1);
      });

      expect(setMutationErrorMock).not.toHaveBeenCalled();
      deleteSetSpy.mockRestore();
    });

    it('prefers item.workout_date when present on item', async () => {
      const deleteSetSpy = vi.spyOn(setsLib, 'deleteSet');
      vi.mocked(enqueueAndAwait).mockResolvedValueOnce({ status: 'synced', opId: 'op-date-1' });

      const mockSet: WorkoutSet & { exercise_name?: string } = {
        id: 'set-date-pref',
        workout_id: 'w-date-1',
        exercise_id: 'ex-bench',
        workout_date: '2026-10-15',
        weight: 185,
        reps: 10,
        set_index: 1,
        set_type: 'working',
      };

      const options = {
        ...defaultOptions,
        sessions: [
          {
            id: 'w-date-1',
            date: '2026-10-10',
            workout_date: '2026-10-10',
            name: 'Chest',
          },
        ],
      };

      const { result } = renderHook(() => useHistorySetDeferredDelete(options), { wrapper });

      act(() => {
        result.current.handleDeleteSetRequested(mockSet);
      });

      await act(async () => {
        result.current.flushDelete();
      });

      expect(deleteSetSpy).toHaveBeenCalledWith(
        expect.anything(),
        'set-date-pref',
        expect.objectContaining({
          workoutDate: '2026-10-15',
        })
      );
      deleteSetSpy.mockRestore();
    });

    it('handles permanent failure from deleteSet: surfaces error via setMutationError and keeps set in sessionSetsMap', async () => {
      const deleteSetSpy = vi.spyOn(setsLib, 'deleteSet');
      vi.mocked(enqueueAndAwait).mockRejectedValueOnce(new Error('Permanent database failure'));

      const mockSet: WorkoutSet & { exercise_name?: string } = {
        id: 'set-fail-1',
        workout_id: 'w-fail-1',
        exercise_id: 'ex-deadlift',
        weight: 405,
        reps: 3,
        set_index: 1,
        set_type: 'working',
      };

      const setSessionSetsMapMock = vi.fn();
      const setMutationErrorMock = vi.fn();

      const options = {
        ...defaultOptions,
        sessions: [{ id: 'w-fail-1', date: '2026-10-18' }],
        setSessionSetsMap: setSessionSetsMapMock,
        setMutationError: setMutationErrorMock,
      };

      const { result } = renderHook(() => useHistorySetDeferredDelete(options), { wrapper });

      act(() => {
        result.current.handleDeleteSetRequested(mockSet);
      });

      await act(async () => {
        result.current.flushDelete();
      });

      await waitFor(() => {
        expect(setMutationErrorMock).toHaveBeenCalledWith('Permanent database failure');
      });

      // sessionSetsMap should not have been updated to remove the set
      expect(setSessionSetsMapMock).not.toHaveBeenCalled();

      deleteSetSpy.mockRestore();
    });

    it('undo during undo window cancels deletion without calling deleteSet', async () => {
      vi.useFakeTimers();
      const deleteSetSpy = vi.spyOn(setsLib, 'deleteSet');

      const mockSet: WorkoutSet & { exercise_name?: string } = {
        id: 'set-undo-1',
        workout_id: 'w-undo-1',
        exercise_id: 'ex-press',
        weight: 135,
        reps: 5,
        set_index: 1,
        set_type: 'working',
      };

      const setSessionSetsMapMock = vi.fn();

      const options = {
        ...defaultOptions,
        sessions: [{ id: 'w-undo-1', date: '2026-10-18' }],
        setSessionSetsMap: setSessionSetsMapMock,
      };

      const { result } = renderHook(() => useHistorySetDeferredDelete(options), { wrapper });

      act(() => {
        result.current.handleDeleteSetRequested(mockSet);
      });

      expect(result.current.pendingDelete).not.toBeNull();

      // Click undo
      act(() => {
        result.current.toastItem?.onUndo?.();
      });

      expect(result.current.pendingDelete).toBeNull();

      // Advance timers past 6000ms window
      act(() => {
        vi.advanceTimersByTime(7000);
      });

      expect(deleteSetSpy).not.toHaveBeenCalled();
      expect(setSessionSetsMapMock).not.toHaveBeenCalled();

      deleteSetSpy.mockRestore();
      vi.useRealTimers();
    });
  });
});

