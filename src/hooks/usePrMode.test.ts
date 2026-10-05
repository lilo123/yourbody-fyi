import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrMode } from './usePrMode';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import type { UserProfile } from '../types/database';

vi.mock('./useAuth');

describe('usePrMode hook', () => {
  const userId = 'test-user-id';
  let mockRefreshProfile: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshProfile = vi.fn().mockResolvedValue(undefined);
    mockEq = vi.fn().mockResolvedValue({ error: null });
    mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'users') {
        return { update: mockUpdate } as any;
      }
      return {} as any;
    }) as any);
  });

  it('defaults to weight when profile is null or unauthenticated', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: null,
      user: null,
      refreshProfile: mockRefreshProfile,
    } as any);

    const { result } = renderHook(() => usePrMode());
    expect(result.current.mode).toBe('weight');
  });

  it('returns e1rm when profile pr_mode is e1rm', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { pr_mode: 'e1rm' } as UserProfile,
      user: { id: userId } as any,
      refreshProfile: mockRefreshProfile,
    } as any);

    const { result } = renderHook(() => usePrMode());
    expect(result.current.mode).toBe('e1rm');
  });

  it('returns weight when profile pr_mode is weight', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { pr_mode: 'weight' } as UserProfile,
      user: { id: userId } as any,
      refreshProfile: mockRefreshProfile,
    } as any);

    const { result } = renderHook(() => usePrMode());
    expect(result.current.mode).toBe('weight');
  });

  it('falls back to weight when profile pr_mode is invalid', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { pr_mode: 'invalid' } as any,
      user: { id: userId } as any,
      refreshProfile: mockRefreshProfile,
    } as any);

    const { result } = renderHook(() => usePrMode());
    expect(result.current.mode).toBe('weight');
  });

  it('updates preference successfully and refreshes profile', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { pr_mode: 'weight' } as UserProfile,
      user: { id: userId } as any,
      refreshProfile: mockRefreshProfile,
    } as any);

    const { result } = renderHook(() => usePrMode());

    await act(async () => {
      await result.current.setMode('e1rm');
    });

    expect(result.current.mode).toBe('e1rm');
    expect(mockUpdate).toHaveBeenCalledWith({ pr_mode: 'e1rm' });
    expect(mockEq).toHaveBeenCalledWith('id', userId);
    expect(mockRefreshProfile).toHaveBeenCalled();
  });

  it('on failure: reverts optimistic update, sets error state, and throws', async () => {
    mockEq.mockResolvedValueOnce({ error: new Error('Network error') });

    vi.mocked(useAuth).mockReturnValue({
      profile: { pr_mode: 'weight' } as UserProfile,
      user: { id: userId } as any,
      refreshProfile: mockRefreshProfile,
    } as any);

    const { result } = renderHook(() => usePrMode());

    let caughtError: any = null;
    await act(async () => {
      try {
        await result.current.setMode('e1rm');
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeTruthy();
    expect(result.current.mode).toBe('weight');
    expect(result.current.error).toBe('Network error');
  });

  it('throws error when user is not authenticated', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: null,
      user: null,
      refreshProfile: mockRefreshProfile,
    } as any);

    const { result } = renderHook(() => usePrMode());

    let caughtError: any = null;
    await act(async () => {
      try {
        await result.current.setMode('e1rm');
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeTruthy();
    expect(result.current.error).toBe('Not authenticated');
  });
});
