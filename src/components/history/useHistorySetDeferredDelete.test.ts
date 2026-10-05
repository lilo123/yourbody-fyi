import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useHistorySetDeferredDelete } from './useHistorySetDeferredDelete';
import type { WorkoutSet } from '../../types/database';

let mockWeightUnit: 'lb' | 'kg' = 'lb';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-1' },
    profile: { id: 'test-user-1', weight_unit: mockWeightUnit },
  }),
}));

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
});
