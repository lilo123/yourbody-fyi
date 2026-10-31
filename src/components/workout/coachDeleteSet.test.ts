import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useWorkoutMutations } from './useWorkoutMutations';
import { enqueueAndAwait, getActiveUserId } from '../../offline';

vi.mock('../../offline', async () => {
  const actual = await vi.importActual<any>('../../offline');
  return {
    ...actual,
    enqueueAndAwait: vi.fn(),
    getActiveUserId: vi.fn(),
  };
});

describe('coach deleting athlete set - outbox target user routing', () => {
  let queryClient: QueryClient;
  const coachUserId = '00000000-0000-4000-8000-0000000000c1';
  const athleteUserId = '00000000-0000-4000-8000-0000000000a1';
  const workoutDate = '2026-10-18';
  const exerciseId = '00000000-0000-4000-8000-0000000000e1';
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
    vi.mocked(getActiveUserId).mockReturnValue(coachUserId);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  it('stores outbox set.delete op under the athlete targetUserId rather than the coach activeUserId', async () => {
    vi.mocked(enqueueAndAwait).mockResolvedValueOnce({
      status: 'synced',
      opId: 'op-del-1',
    });

    const { result } = renderHook(
      () =>
        useWorkoutMutations({
          targetUserId: athleteUserId,
          workoutDate,
          activeRoutineName: 'Chest Day',
          exercises: exercises as any,
          autoRestTimer: false,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.deleteSetMutation.mutateAsync('set-athlete-1');
    });

    // The data-level outbox operation must be keyed to the athlete, NOT the active coach
    expect(enqueueAndAwait).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: athleteUserId,
        kind: 'set.delete',
        payload: { id: 'set-athlete-1', workoutDate: '2026-10-18' },
      })
    );
  });
});
