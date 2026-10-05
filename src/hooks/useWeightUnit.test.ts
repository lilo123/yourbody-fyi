import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWeightUnit, useWeightUnitPreference } from './useWeightUnit';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import type { UserProfile } from '../types/database';

vi.mock('./useAuth');

describe('useWeightUnit hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to lb when profile is null or undefined', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: null,
      user: null,
      refreshProfile: vi.fn(),
    } as any);

    const { result } = renderHook(() => useWeightUnit());
    expect(result.current).toBe('lb');
  });

  it('returns kg when profile weight_unit is kg', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { weight_unit: 'kg' } as UserProfile,
      user: { id: 'user-1' } as any,
      refreshProfile: vi.fn(),
    } as any);

    const { result } = renderHook(() => useWeightUnit());
    expect(result.current).toBe('kg');
  });

  it('returns lb when profile weight_unit is lb', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { weight_unit: 'lb' } as UserProfile,
      user: { id: 'user-1' } as any,
      refreshProfile: vi.fn(),
    } as any);

    const { result } = renderHook(() => useWeightUnit());
    expect(result.current).toBe('lb');
  });

  it('falls back to lb when profile weight_unit is invalid', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { weight_unit: 'stone' as any } as UserProfile,
      user: { id: 'user-1' } as any,
      refreshProfile: vi.fn(),
    } as any);

    const { result } = renderHook(() => useWeightUnit());
    expect(result.current).toBe('lb');
  });
});

describe('useWeightUnitPreference hook', () => {
  const userId = 'user-123';
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

  it('updates preference successfully and refreshes profile filtered by own id', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { weight_unit: 'lb' } as UserProfile,
      user: { id: userId } as any,
      refreshProfile: mockRefreshProfile,
    } as any);

    const { result } = renderHook(() => useWeightUnitPreference());
    expect(result.current.unit).toBe('lb');
    expect(result.current.isSaving).toBe(false);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.setUnit('kg');
    });

    expect(mockUpdate).toHaveBeenCalledWith({ weight_unit: 'kg' });
    expect(mockEq).toHaveBeenCalledWith('id', userId);
    expect(mockRefreshProfile).toHaveBeenCalledTimes(1);
    expect(result.current.isSaving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('on failure: throws error, sets error state, and does NOT change unit locally (no optimistic flip)', async () => {
    const dbError = new Error('Database connection failed');
    mockEq.mockResolvedValueOnce({ error: dbError });

    vi.mocked(useAuth).mockReturnValue({
      profile: { weight_unit: 'lb' } as UserProfile,
      user: { id: userId } as any,
      refreshProfile: mockRefreshProfile,
    } as any);

    const { result } = renderHook(() => useWeightUnitPreference());
    expect(result.current.unit).toBe('lb');

    await act(async () => {
      await expect(result.current.setUnit('kg')).rejects.toThrow('Database connection failed');
    });

    expect(result.current.unit).toBe('lb');
    expect(result.current.error).toBe('Database connection failed');
    expect(result.current.isSaving).toBe(false);
    expect(mockRefreshProfile).not.toHaveBeenCalled();
  });

  it('throws error when user is not authenticated', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: null,
      user: null,
      refreshProfile: mockRefreshProfile,
    } as any);

    const { result } = renderHook(() => useWeightUnitPreference());

    await act(async () => {
      await expect(result.current.setUnit('kg')).rejects.toThrow('Not authenticated');
    });

    expect(result.current.unit).toBe('lb');
    expect(result.current.error).toBe('Not authenticated');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
