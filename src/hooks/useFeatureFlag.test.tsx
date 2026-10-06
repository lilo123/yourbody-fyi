import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '../context/AuthContextTypes';
import { useFeatureFlag, APP_CONFIG_QUERY_KEY } from './useFeatureFlag';
import {
  createSupabaseBuilder,
  clearMockHistory,
  assertTableQueried,
  assertSelectRecorded,
} from '../test/supabaseBuilderMock';
import type { User } from '@supabase/supabase-js';
import type { AuthContextType } from '../context/AuthContextTypes';

let mockAppConfigData: Array<{ key: string; value: unknown }> | null = [];
let mockAppConfigError: { message: string } | null = null;
let customResolver: ((builder: unknown) => unknown) | undefined = undefined;

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockImplementation((tableName: string) => {
      if (tableName === 'app_config') {
        if (customResolver) {
          return createSupabaseBuilder('app_config', { resolver: customResolver });
        }
        return createSupabaseBuilder('app_config', {
          data: mockAppConfigData,
          error: mockAppConfigError,
        });
      }
      return createSupabaseBuilder(tableName, { data: [], error: null });
    }),
  },
}));

describe('useFeatureFlag', () => {
  let queryClient: QueryClient;
  const mockUser: User = {
    id: 'user-flag-test-uuid',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '',
  } as User;

  const createWrapper = (
    user: User | null = mockUser,
    client: QueryClient = queryClient,
    omitAuthProvider = false
  ) => {
    if (omitAuthProvider) {
      return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }

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
    clearMockHistory();
    mockAppConfigData = [];
    mockAppConfigError = null;
    customResolver = undefined;
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 5 * 60 * 1000,
        },
      },
    });
  });

  it('default when no session: returns defaultValue when user is null', () => {
    mockAppConfigData = [{ key: 'dark-launch', value: true }];
    const wrapper = createWrapper(null);

    const { result: defaultFalse } = renderHook(() => useFeatureFlag('dark-launch'), {
      wrapper,
    });
    expect(defaultFalse.current).toBe(false);

    const { result: defaultTrue } = renderHook(() => useFeatureFlag('dark-launch', true), {
      wrapper,
    });
    expect(defaultTrue.current).toBe(true);
  });

  it('default when no session: returns defaultValue when AuthProvider is absent', () => {
    mockAppConfigData = [{ key: 'dark-launch', value: true }];
    const wrapper = createWrapper(null, queryClient, true);

    const { result } = renderHook(() => useFeatureFlag('dark-launch', false), {
      wrapper,
    });
    expect(result.current).toBe(false);
  });

  it('default before data: returns defaultValue while query is resolving', () => {
    // Unresolved promise simulates in-flight network request before data arrives
    customResolver = () => new Promise(() => {});

    const wrapper = createWrapper(mockUser);
    const { result } = renderHook(() => useFeatureFlag('dark-launch', false), {
      wrapper,
    });

    expect(result.current).toBe(false);
  });

  it('true/false from data: returns boolean matching database row', async () => {
    mockAppConfigData = [
      { key: 'feature-enabled', value: true },
      { key: 'feature-disabled', value: false },
    ];

    const wrapper = createWrapper(mockUser);
    const { result: enabledResult } = renderHook(() => useFeatureFlag('feature-enabled'), {
      wrapper,
    });
    const { result: disabledResult } = renderHook(
      () => useFeatureFlag('feature-disabled', true),
      { wrapper }
    );

    await waitFor(() => {
      expect(enabledResult.current).toBe(true);
    });
    await waitFor(() => {
      expect(disabledResult.current).toBe(false);
    });

    // Fidelity assertions for scripts/check-mock-fidelity.js
    assertTableQueried('app_config');
    assertSelectRecorded('app_config', 'key,value');
  });

  it('non-boolean value → default: rejects string, number, null, and object values', async () => {
    mockAppConfigData = [
      { key: 'string-flag', value: 'true' },
      { key: 'num-flag', value: 1 },
      { key: 'null-flag', value: null },
      { key: 'obj-flag', value: { enabled: true } },
    ];

    const wrapper = createWrapper(mockUser);
    const { result: stringResult } = renderHook(() => useFeatureFlag('string-flag', false), {
      wrapper,
    });
    const { result: numResult } = renderHook(() => useFeatureFlag('num-flag', true), {
      wrapper,
    });
    const { result: nullResult } = renderHook(() => useFeatureFlag('null-flag', false), {
      wrapper,
    });
    const { result: objResult } = renderHook(() => useFeatureFlag('obj-flag', true), {
      wrapper,
    });

    await waitFor(() => {
      expect(stringResult.current).toBe(false);
    });
    await waitFor(() => {
      expect(numResult.current).toBe(true);
    });
    await waitFor(() => {
      expect(nullResult.current).toBe(false);
    });
    await waitFor(() => {
      expect(objResult.current).toBe(true);
    });
  });

  it('fetch error → default: returns defaultValue when network or server error occurs', async () => {
    mockAppConfigError = { message: 'Database connection failed' };

    const wrapper = createWrapper(mockUser);
    const { result } = renderHook(() => useFeatureFlag('feature-flag', true), {
      wrapper,
    });

    expect(result.current).toBe(true);
  });

  it('cached value retained when a refetch fails (offline)', async () => {
    mockAppConfigData = [{ key: 'offline-retained-flag', value: true }];

    const wrapper = createWrapper(mockUser);
    const { result } = renderHook(() => useFeatureFlag('offline-retained-flag', false), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current).toBe(true);
    });

    // Subsequent refetch simulates offline failure
    mockAppConfigData = null;
    mockAppConfigError = { message: 'Failed to fetch (offline)' };

    try {
      await queryClient.refetchQueries({ queryKey: APP_CONFIG_QUERY_KEY });
    } catch {
      // Absorb query refetch error as React Query would
    }

    // Retains cached true value despite failing refetch
    expect(result.current).toBe(true);
  });

  it('unrecognized key: returns defaultValue when key is not present in data', async () => {
    mockAppConfigData = [{ key: 'other-flag', value: true }];

    const wrapper = createWrapper(mockUser);
    const { result } = renderHook(() => useFeatureFlag('missing-flag', false), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });
});
