import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '../context/AuthContextTypes';
import { useEntitlement, ENTITLEMENT_DEFAULTS, type EntitlementRpcResponse } from './useEntitlement';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';
import type { AuthContextType } from '../context/AuthContextTypes';

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

describe('useEntitlement', () => {
  let queryClient: QueryClient;
  const mockUser: User = {
    id: 'user-entitlement-test-uuid',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '',
  } as User;

  const createWrapper = (user: User | null = mockUser, client: QueryClient = queryClient) => {
    const authValue: AuthContextType = {
      user,
      profile: null,
      role: 'athlete',
      viewMode: 'athlete',
      isCoachMode: false,
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      updateProfile: vi.fn(),
      switchRole: vi.fn(),
      refreshProfile: vi.fn(),
      resendConfirmation: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
    };

    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 5 * 60 * 1000,
        },
      },
    });
  });

  it('no session -> not fetched: returns safe defaults without calling RPC', () => {
    const { result } = renderHook(() => useEntitlement(), {
      wrapper: createWrapper(null),
    });

    expect(result.current).toEqual(ENTITLEMENT_DEFAULTS);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('success mapping: correctly maps active pro tier subscription', async () => {
    const proResponse: EntitlementRpcResponse = {
      plan_effective: 'pro',
      plan: 'pro',
      paid_until: '2028-01-01T00:00:00+00:00',
      trial_ends_at_effective: '2026-10-24T00:00:00+00:00',
      has_pro: true,
    };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: proResponse as any,
      error: null,
    } as any);

    const { result } = renderHook(() => useEntitlement(), {
      wrapper: createWrapper(mockUser),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isPro).toBe(true);
    });

    expect(result.current).toEqual({
      plan: 'pro',
      isPro: true,
      isPaid: true,
      trialEndsAt: '2026-10-24T00:00:00+00:00',
      paidUntil: '2028-01-01T00:00:00+00:00',
      isLoading: false,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_my_entitlement');
  });

  it('success mapping: correctly maps active basic tier subscription', async () => {
    const basicResponse: EntitlementRpcResponse = {
      plan_effective: 'basic',
      plan: 'basic',
      paid_until: '2028-01-01T00:00:00+00:00',
      trial_ends_at_effective: '2026-10-24T00:00:00+00:00',
      has_pro: false,
    };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: basicResponse as any,
      error: null,
    } as any);

    const { result } = renderHook(() => useEntitlement(), {
      wrapper: createWrapper(mockUser),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.plan).toBe('basic');
    });

    expect(result.current).toEqual({
      plan: 'basic',
      isPro: false,
      isPaid: true,
      trialEndsAt: '2026-10-24T00:00:00+00:00',
      paidUntil: '2028-01-01T00:00:00+00:00',
      isLoading: false,
    });
  });

  it('success mapping: correctly maps trial user', async () => {
    const trialResponse: EntitlementRpcResponse = {
      plan_effective: 'trial',
      plan: null,
      paid_until: null,
      trial_ends_at_effective: '2026-10-24T00:00:00+00:00',
      has_pro: false,
    };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: trialResponse as any,
      error: null,
    } as any);

    const { result } = renderHook(() => useEntitlement(), {
      wrapper: createWrapper(mockUser),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.plan).toBe('trial');
    });

    expect(result.current).toEqual({
      plan: 'trial',
      isPro: false,
      isPaid: false,
      trialEndsAt: '2026-10-24T00:00:00+00:00',
      paidUntil: null,
      isLoading: false,
    });
  });

  it('success mapping: correctly maps expired / free user', async () => {
    const freeResponse: EntitlementRpcResponse = {
      plan_effective: 'free',
      plan: null,
      paid_until: null,
      trial_ends_at_effective: '2026-09-01T00:00:00+00:00',
      has_pro: false,
    };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: freeResponse as any,
      error: null,
    } as any);

    const { result } = renderHook(() => useEntitlement(), {
      wrapper: createWrapper(mockUser),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.plan).toBe('free');
    });

    expect(result.current).toEqual({
      plan: 'free',
      isPro: false,
      isPaid: false,
      trialEndsAt: '2026-09-01T00:00:00+00:00',
      paidUntil: null,
      isLoading: false,
    });
  });

  it('error -> defaults: returns safe defaults when RPC throws an error', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'Network connection failed' },
    } as any);

    const { result } = renderHook(() => useEntitlement(), {
      wrapper: createWrapper(mockUser),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current).toEqual(ENTITLEMENT_DEFAULTS);
  });
});
