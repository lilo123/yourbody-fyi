import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './AuthContext';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../test/supabaseBuilderMock';
import type { UserProfile } from '../types/database';
import * as offlineModule from '../offline';
import { NUTRITION_PARSER_MODE_KEY } from '../hooks/useNutritionParserMode';
import { USER_EDITABLE_PROFILE_KEYS } from './AuthContextTypes';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

interface TestConsumerProps {
  onSignOutReady?: (signOut: () => Promise<void>) => void;
  onRefreshProfileReady?: (refreshProfile: () => Promise<void>) => void;
  onUpdateProfileReady?: (
    updateProfile: (updates: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>
  ) => void;
}

const TestConsumer: React.FC<TestConsumerProps> = ({
  onSignOutReady,
  onRefreshProfileReady,
  onUpdateProfileReady,
}) => {
  const { user, profile, loading, signOut, refreshProfile, updateProfile } = useAuth();
  React.useEffect(() => {
    onSignOutReady?.(signOut);
  }, [onSignOutReady, signOut]);
  React.useEffect(() => {
    onRefreshProfileReady?.(refreshProfile);
  }, [onRefreshProfileReady, refreshProfile]);
  React.useEffect(() => {
    onUpdateProfileReady?.(updateProfile);
  }, [onUpdateProfileReady, updateProfile]);
  return (
    <div>
      <div data-testid="auth-loading">{loading ? 'true' : 'false'}</div>
      <div data-testid="auth-user-id">{user?.id || 'none'}</div>
      <div data-testid="auth-user-email">{user?.email || 'none'}</div>
      <div data-testid="auth-profile-username">{profile?.username || 'none'}</div>
      <button data-testid="auth-signout-btn" onClick={() => signOut()}>
        Sign Out
      </button>
      <button data-testid="auth-refresh-btn" onClick={() => refreshProfile()}>
        Refresh Profile
      </button>
    </div>
  );
};

describe('AuthContext - iOS PWA Resilience & Lifecycle', () => {
  let queryClient: QueryClient;

  const mockProfile: UserProfile = {
    id: 'cached-user-123',
    email: 'test@yourbody.fyi',
    username: 'CyberRunner',
    role: 'athlete',
    target_calories: 2200,
    target_protein: 160,
    target_carbs: 220,
    target_fat: 70,
    target_fiber: 30,
    auto_rest_timer: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    localStorage.clear();

    (supabase.from as any).mockImplementation((table: string) => {
      return createSupabaseBuilder(table, mockProfile);
    });

    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: {
          user: { id: mockProfile.id, email: mockProfile.email },
        },
      },
    });

    (supabase.auth.onAuthStateChange as any).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  it('1. synchronously hydrates user and profile from localStorage on initial render', () => {
    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    // Synchronous hydration: loading is false, cached profile and user are rendered without delay
    expect(screen.getByTestId('auth-loading').textContent).toBe('false');
    expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);
    expect(screen.getByTestId('auth-profile-username').textContent).toBe(mockProfile.username);
  });

  it('2. resolves via 3000ms timeout race when getSession hangs and clears loading', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // Simulate stalled network socket: getSession never resolves
    (supabase.auth.getSession as any).mockImplementation(() => new Promise(() => {}));

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    // Without cache, initial loading is true
    expect(screen.getByTestId('auth-loading').textContent).toBe('true');

    // Advance timers by 3000ms to trigger the timeout fallback
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });

    // Timeout triggers, loading becomes false
    expect(screen.getByTestId('auth-loading').textContent).toBe('false');
    expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
  });

  it('2b. retains cached credentials when getSession fast-rejects (e.g. airplane mode / offline)', async () => {
    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));
    (supabase.auth.getSession as any).mockRejectedValue(new Error('Failed to fetch'));

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);
    expect(screen.getByTestId('auth-profile-username').textContent).toBe(mockProfile.username);
    expect(localStorage.getItem('yourbody_user')).not.toBeNull();
  });

  it('3. silently revalidates session upon iOS WebKit resume (visibilitychange and pageshow)', async () => {
    const getSessionSpy = vi.fn().mockResolvedValue({
      data: {
        session: {
          user: { id: 'refreshed-user-id', email: 'refreshed@yourbody.fyi' },
        },
      },
    });
    (supabase.auth.getSession as any).mockImplementation(getSessionSpy);

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading').textContent).toBe('false');
    });

    const initialCallCount = getSessionSpy.mock.calls.length;

    // Simulate returning to app from iOS app switcher
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(getSessionSpy.mock.calls.length).toBeGreaterThan(initialCallCount);
    });

    // Simulate WebKit pageshow event
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });

    await waitFor(() => {
      expect(getSessionSpy.mock.calls.length).toBeGreaterThan(initialCallCount + 1);
    });
  });

  it('3c. handles rejected getSession during resume refresh without unhandledrejection', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unhandledRejections: any[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event.reason);
    };
    window.addEventListener('unhandledrejection', onUnhandled);

    (supabase.auth.getSession as any).mockResolvedValueOnce({
      data: {
        session: {
          user: { id: 'initial-user-id', email: 'initial@yourbody.fyi' },
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading').textContent).toBe('false');
    });

    // Make next getSession call reject (simulating network failure on resume)
    (supabase.auth.getSession as any).mockRejectedValue(new Error('Network drop on resume'));

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[AuthContext] Background resume revalidation error:'),
          expect.any(Error)
        );
      });

      expect(unhandledRejections).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
      window.removeEventListener('unhandledrejection', onUnhandled);
    }
  });

  it('3d. handles rejected syncUserTimezone during resume refresh without unhandledrejection', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unhandledRejections: any[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event.reason);
    };
    window.addEventListener('unhandledrejection', onUnhandled);

    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: {
          user: { id: 'mock-user-tz-fail', email: 'tz@yourbody.fyi' },
        },
      },
    });

    // Make timezone update reject directly
    const updateSpy = vi.fn().mockRejectedValue(new Error('Failed to update timezone table'));
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'users') {
        const builder = createSupabaseBuilder(table, mockProfile);
        builder.update = updateSpy;
        return builder;
      }
      return createSupabaseBuilder(table);
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading').textContent).toBe('false');
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(unhandledRejections).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
      window.removeEventListener('unhandledrejection', onUnhandled);
    }
  });

  it('4. completely cleans up yourbody storage and resets state on signOut()', async () => {
    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));
    localStorage.setItem('yourbody_view_mode', 'coach');
    localStorage.setItem('yourbody_auto_rest_timer', 'true');
    localStorage.setItem('yourbody_extra_custom_key', 'some_val');
    localStorage.setItem('unrelated_app_key', 'preserve_me');

    let signOutFn: () => Promise<void> = async () => {};

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer onSignOutReady={(fn) => { signOutFn = fn; }} />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);
    });

    await act(async () => {
      await signOutFn();
    });

    expect(localStorage.getItem('yourbody_user')).toBeNull();
    expect(localStorage.getItem('yourbody_view_mode')).toBeNull();
    expect(localStorage.getItem('yourbody_auto_rest_timer')).toBeNull();
    expect(localStorage.getItem('yourbody_extra_custom_key')).toBeNull();
    expect(localStorage.getItem('unrelated_app_key')).toBe('preserve_me');
    expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
    expect(screen.getByTestId('auth-profile-username').textContent).toBe('none');
  });

  it('4b. SIGNED_OUT auth event removes staged drafts + parser mode key AND leaves active session and rq cache untouched', async () => {
    const userId = mockProfile.id;
    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));
    localStorage.setItem(NUTRITION_PARSER_MODE_KEY, 'regex');
    localStorage.setItem(`yourbody_active_session_${userId}`, JSON.stringify({ activeWorkoutId: 'w-123' }));
    localStorage.setItem('yourbody_view_mode', 'coach');
    localStorage.setItem('yourbody_auto_rest_timer', 'true');
    localStorage.setItem('unrelated_app_key', 'preserve_me');

    sessionStorage.setItem(`yourbody_staged_meal_draft_${userId}`, JSON.stringify({ name: 'Oats' }));
    sessionStorage.setItem('unrelated_session_key', 'preserve_session_val');

    // Populate IndexedDB with rq read cache
    const db = await offlineModule.getOfflineDb(userId);
    await db.put('rq', { clientState: { mutations: [], queries: [] }, timestamp: Date.now() }, 'persisted-query-cache');
    expect(await db.get('rq', 'persisted-query-cache')).toBeDefined();

    let authStateCallback: any = null;
    (supabase.auth.onAuthStateChange as any).mockImplementation((cb: any) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe(userId);
    });

    // Simulate session expiry / remote logout triggering SIGNED_OUT event
    await act(async () => {
      authStateCallback('SIGNED_OUT', null);
    });

    // yourbody_user and parser mode key are removed
    expect(localStorage.getItem('yourbody_user')).toBeNull();
    expect(localStorage.getItem(NUTRITION_PARSER_MODE_KEY)).toBeNull();

    // User-scoped workout session key and other preferences are LEFT UNTOUCHED
    expect(localStorage.getItem(`yourbody_active_session_${userId}`)).not.toBeNull();
    expect(localStorage.getItem('yourbody_view_mode')).toBe('coach');
    expect(localStorage.getItem('yourbody_auto_rest_timer')).toBe('true');
    expect(localStorage.getItem('unrelated_app_key')).toBe('preserve_me');

    // Staged meal draft cleared from sessionStorage, unrelated session key preserved
    expect(sessionStorage.getItem(`yourbody_staged_meal_draft_${userId}`)).toBeNull();
    expect(sessionStorage.getItem('unrelated_session_key')).toBe('preserve_session_val');

    // rq cache in IndexedDB is LEFT UNTOUCHED
    expect(await db.get('rq', 'persisted-query-cache')).toBeDefined();

    expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
    expect(screen.getByTestId('auth-profile-username').textContent).toBe('none');
  });

  it('4c. offline cached-user behaviour is unchanged when offline and getSession fails', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));
    localStorage.setItem('yourbody_nutrition_parser_mode', 'regex');

    (supabase.auth.getSession as any).mockResolvedValue({
      data: { session: null },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    // Initial render keeps cached user and parser mode while offline
    expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);
    expect(screen.getByTestId('auth-loading').textContent).toBe('false');
    expect(localStorage.getItem('yourbody_user')).not.toBeNull();
    expect(localStorage.getItem('yourbody_nutrition_parser_mode')).toBe('regex');
  });

  it('4d. signOut() synchronously clears the flusher session user before awaiting supabase.auth.signOut', async () => {
    let resolveSignOut: () => void = () => {};
    const signOutPromise = new Promise<{ error: null }>((resolve) => {
      resolveSignOut = () => resolve({ error: null });
    });
    const signOutSpy = vi.spyOn(supabase.auth, 'signOut').mockImplementation(() => signOutPromise);

    offlineModule.setFlusherSessionUser(mockProfile.id);
    expect(offlineModule.getActiveUserId()).toBe(mockProfile.id);

    let signOutFn: () => Promise<void> = async () => {};
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer onSignOutReady={(fn) => { signOutFn = fn; }} />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);
    });

    // Invoke signOut without awaiting to observe synchronous state before await supabase.auth.signOut()
    const signOutPromiseExec = signOutFn();

    try {
      // Synchronously, before supabase.auth.signOut resolves, flusher user must be cleared
      expect(offlineModule.getActiveUserId()).toBeNull();
    } finally {
      resolveSignOut();
      await act(async () => {
        try {
          await signOutPromiseExec;
        } catch {
          // ignore
        }
      });
      signOutSpy.mockRestore();
    }
  });

  it('5. re-fetches user profile successfully on refreshProfile()', async () => {
    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));

    const updatedProfile = {
      ...mockProfile,
      username: 'UpdatedCyberWarrior',
    };

    (supabase.from as any).mockImplementation((table: string) => {
      return createSupabaseBuilder(table, updatedProfile);
    });

    let refreshProfileFn: () => Promise<void> = async () => {};

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer onRefreshProfileReady={(fn) => { refreshProfileFn = fn; }} />
        </AuthProvider>
      </QueryClientProvider>
    );

    expect(screen.getByTestId('auth-profile-username').textContent).toBe(mockProfile.username);

    await act(async () => {
      await refreshProfileFn();
    });

    expect(screen.getByTestId('auth-profile-username').textContent).toBe('UpdatedCyberWarrior');

    expect(getRecordedTables()).toContain('users');
    expect(getRecordedSelects()).toContainEqual({
      table: 'users',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, rest_timer_seconds, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
    });
  });

  it('6. successfully re-authenticates and fetches profile after signOut without being blocked by signedOutRef', async () => {
    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));

    let authStateCallback: any = null;
    (supabase.auth.onAuthStateChange as any).mockImplementation((cb: any) => {
      authStateCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    let signOutFn: () => Promise<void> = async () => {};

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer onSignOutReady={(fn) => { signOutFn = fn; }} />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);
    });

    // Sign out
    await act(async () => {
      await signOutFn();
    });

    expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
    expect(screen.getByTestId('auth-profile-username').textContent).toBe('none');

    // Simulate re-signing in with new credentials
    const newUserProfile: UserProfile = {
      ...mockProfile,
      id: 'new-athlete-789',
      username: 'NeoRacer',
      email: 'neo@yourbody.fyi',
    };

    (supabase.from as any).mockImplementation((table: string) => {
      return createSupabaseBuilder(table, newUserProfile);
    });

    await act(async () => {
      if (authStateCallback) {
        authStateCallback('SIGNED_IN', {
          user: { id: newUserProfile.id, email: newUserProfile.email },
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe(newUserProfile.id);
      expect(screen.getByTestId('auth-profile-username').textContent).toBe(newUserProfile.username);
    });
  });

  it('7. deduplicates concurrent getSession() calls during simultaneous visibilitychange and pageshow lifecycle resumes', async () => {
    let resolveGetSession: (val: any) => void;
    const pendingSessionPromise = new Promise((resolve) => {
      resolveGetSession = resolve;
    });

    const getSessionSpy = vi.fn().mockImplementation(() => pendingSessionPromise);
    (supabase.auth.getSession as any).mockImplementation(getSessionSpy);

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    // Initial mount calls getSession once
    expect(getSessionSpy).toHaveBeenCalledTimes(1);

    // Resolve initial mount call
    await act(async () => {
      resolveGetSession!({
        data: {
          session: {
            user: { id: mockProfile.id, email: mockProfile.email },
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading').textContent).toBe('false');
    });

    const callCountAfterMount = getSessionSpy.mock.calls.length;

    // Set up a pending promise for subsequent getSession calls to simulate in-flight revalidation
    let resolveResumeSession: (val: any) => void;
    const resumeSessionPromise = new Promise((resolve) => {
      resolveResumeSession = resolve;
    });
    getSessionSpy.mockImplementation(() => resumeSessionPromise);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    // Fire both visibilitychange and pageshow concurrently before the first resolves
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
    });

    // Exactly 1 new getSession call should have been triggered despite two concurrent resume events
    expect(getSessionSpy.mock.calls.length).toBe(callCountAfterMount + 1);

    // Now resolve the in-flight revalidation
    await act(async () => {
      resolveResumeSession!({
        data: {
          session: {
            user: { id: mockProfile.id, email: mockProfile.email },
          },
        },
      });
      await resumeSessionPromise;
    });

    // isRevalidatingRef is now reset; a subsequent resume event triggers a new call
    let resolveSecondResume: (val: any) => void;
    const secondResumePromise = new Promise((resolve) => {
      resolveSecondResume = resolve;
    });
    getSessionSpy.mockImplementation(() => secondResumePromise);

    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });

    expect(getSessionSpy.mock.calls.length).toBe(callCountAfterMount + 2);

    await act(async () => {
      resolveSecondResume!({
        data: {
          session: {
            user: { id: mockProfile.id, email: mockProfile.email },
          },
        },
      });
      await secondResumePromise;
    });
  });

  it('8. clears user state and localStorage when background session revalidation determines session is expired/invalid', async () => {
    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));

    // getSession returns null session (expired or revoked)
    (supabase.auth.getSession as any).mockResolvedValue({
      data: { session: null },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    // Synchronously hydrated from cache initially
    expect(screen.getByTestId('auth-loading').textContent).toBe('false');
    expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);

    // After background revalidation resolves as invalid/expired, user state is cleared
    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
      expect(screen.getByTestId('auth-profile-username').textContent).toBe('none');
      expect(localStorage.getItem('yourbody_user')).toBeNull();
    });
  });

  it('9. does not cache in localStorage when timezone sync fails, enabling retry on subsequent revalidation', async () => {
    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));

    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const storageKey = `yourbody_user_timezone_${mockProfile.id}`;

    let updateAttempts = 0;
    let shouldFailUpdate = true;

    (supabase.from as any).mockImplementation((table: string) => {
      const builder = createSupabaseBuilder(table, mockProfile);
      if (table === 'users') {
        const origUpdate = builder.update.bind(builder);
        builder.update = (values: any, options?: any) => {
          origUpdate(values, options);
          updateAttempts++;
          if (shouldFailUpdate) {
            builder.mockResolvedValue({ data: null, error: new Error('Network timeout') });
          } else {
            builder.mockResolvedValue({ data: null, error: null });
          }
          return builder;
        };
      }
      return builder;
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    // Initial mount triggers syncUserTimezone which fails
    await waitFor(() => {
      expect(updateAttempts).toBe(1);
    });

    // Failed update must NOT write to localStorage
    expect(localStorage.getItem(storageKey)).toBeNull();

    // Now restore network so subsequent attempt succeeds
    shouldFailUpdate = false;

    // Trigger re-validation via pageshow event
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });

    // Second sync attempt should execute and succeed
    await waitFor(() => {
      expect(updateAttempts).toBe(2);
      expect(localStorage.getItem(storageKey)).toBe(deviceZone);
    });

    // A third revalidation should see cachedZone === deviceZone and NOT trigger a 3rd update
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });

    expect(updateAttempts).toBe(2);
  });

  describe('D-YB2-2 Auth Flag Recovery & MarkAuthValid Contracts', () => {
    it('11. clears authRequired flag and kicks flushNow on true-to-false transition with valid session', async () => {
      offlineModule.setAuthRequiredStatus(true);
      const flushSpy = vi.spyOn(offlineModule, 'flushNow').mockResolvedValue(0);

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);
      });

      expect(offlineModule.getAuthRequiredStatus()).toBe(false);
      expect(flushSpy).toHaveBeenCalledWith(mockProfile.id);
    });

    it('12. does not kick flushNow if authRequired was already false', async () => {
      offlineModule.setAuthRequiredStatus(false);
      const flushSpy = vi.spyOn(offlineModule, 'flushNow').mockResolvedValue(0);

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);
      });

      expect(offlineModule.getAuthRequiredStatus()).toBe(false);
      expect(flushSpy).not.toHaveBeenCalled();
    });

    it('13. online boot with no session does NOT set authRequired status', async () => {
      offlineModule.setAuthRequiredStatus(false);
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: null },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-loading').textContent).toBe('false');
      });

      expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
      expect(offlineModule.getAuthRequiredStatus()).toBe(false);
    });

    it('14. resume without session sets authRequired status ONLY if a user context existed before', async () => {
      offlineModule.setAuthRequiredStatus(false);
      (supabase.auth.getSession as any).mockResolvedValue({
        data: {
          session: {
            user: { id: mockProfile.id, email: mockProfile.email },
          },
        },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);
      });

      // Session revoked during resume
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: null },
      });

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
      });

      expect(offlineModule.getAuthRequiredStatus()).toBe(true);
    });

    it('15. resume without session does NOT set authRequired status if no user existed before', async () => {
      offlineModule.setAuthRequiredStatus(false);
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: null },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-loading').textContent).toBe('false');
      });

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(offlineModule.getAuthRequiredStatus()).toBe(false);
    });
  });

  describe('Terms consent post-login acceptance', () => {
    const originalEnv = import.meta.env.VITE_FEATURE_TERMS_CONSENT;

    beforeEach(() => {
      (supabase.rpc as any) = vi.fn().mockResolvedValue({ data: {}, error: null });
    });

    afterEach(() => {
      (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = originalEnv;
    });

    it('flag off: does not call accept_terms RPC even when session user has terms_version metadata', async () => {
      (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = undefined;

      (supabase.auth.getSession as any).mockResolvedValue({
        data: {
          session: {
            user: {
              id: mockProfile.id,
              email: mockProfile.email,
              user_metadata: { terms_version: '2026-10-10' },
            },
          },
        },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-loading').textContent).toBe('false');
      });

      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('flag on: calls accept_terms RPC once when metadata has terms_version and profile has no terms_accepted_at', async () => {
      (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = 'true';

      (supabase.auth.getSession as any).mockResolvedValue({
        data: {
          session: {
            user: {
              id: mockProfile.id,
              email: mockProfile.email,
              user_metadata: { terms_version: '2026-10-10' },
            },
          },
        },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith('accept_terms', { p_version: '2026-10-10' });
      });

      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });

    it('flag on: does NOT call accept_terms if profile already has terms_accepted_at', async () => {
      (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = 'true';

      const acceptedProfile: UserProfile = {
        ...mockProfile,
        terms_version: '2026-10-10',
        terms_accepted_at: '2026-10-10T10:00:00Z',
      };

      (supabase.from as any).mockImplementation((table: string) => {
        return createSupabaseBuilder(table, acceptedProfile);
      });

      (supabase.auth.getSession as any).mockResolvedValue({
        data: {
          session: {
            user: {
              id: acceptedProfile.id,
              email: acceptedProfile.email,
              user_metadata: { terms_version: '2026-10-10' },
            },
          },
        },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-loading').textContent).toBe('false');
      });

      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('flag on: does NOT call accept_terms a second time on refreshProfile', async () => {
      (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = 'true';

      (supabase.auth.getSession as any).mockResolvedValue({
        data: {
          session: {
            user: {
              id: mockProfile.id,
              email: mockProfile.email,
              user_metadata: { terms_version: '2026-10-10' },
            },
          },
        },
      });

      let refreshProfileFn: () => Promise<void> = async () => {};

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer onRefreshProfileReady={(fn) => { refreshProfileFn = fn; }} />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
      });

      // Trigger refreshProfile
      await act(async () => {
        await refreshProfileFn();
      });

      expect(screen.getByTestId('auth-profile-username').textContent).toBe(mockProfile.username);

      // RPC still called only once
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });

    it('flag on: fire-and-forget accept_terms RPC warning does not block session resolution', async () => {
      (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = 'true';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      (supabase.rpc as any) = vi.fn().mockRejectedValue(new Error('network offline'));

      (supabase.auth.getSession as any).mockResolvedValue({
        data: {
          session: {
            user: {
              id: mockProfile.id,
              email: mockProfile.email,
              user_metadata: { terms_version: '2026-10-10' },
            },
          },
        },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-loading').textContent).toBe('false');
        expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);
      });

      await waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[AuthContext] accept_terms RPC error:'),
          expect.any(Error)
        );
      });

      warnSpy.mockRestore();
    });
  });

  describe('updateProfile billing and protected field protection', () => {
    it('updateProfile sends only user-editable columns and never sends billing fields to supabase', async () => {
      const profileWithBilling: UserProfile = {
        ...mockProfile,
        plan: 'pro',
        paid_until: '2027-01-01T00:00:00Z',
        trial_ends_at: '2026-12-01T00:00:00Z',
        billing_customer_id: 'cus_profile_123',
        coach_tier: 'pro',
        max_athletes: 10,
      };
      localStorage.setItem('yourbody_user', JSON.stringify(profileWithBilling));

      let capturedPayload: any = null;
      let capturedMethod: string | null = null;
      let updateProfileFn: ((updates: Partial<UserProfile>) => Promise<any>) | null = null;

      (supabase.from as any).mockImplementation((table: string) => {
        const builder = createSupabaseBuilder(table, profileWithBilling);
        const origUpsert = builder.upsert.bind(builder);
        const origUpdate = builder.update.bind(builder);
        builder.upsert = (values: any, options?: any) => {
          capturedMethod = 'upsert';
          capturedPayload = values;
          return origUpsert(values, options);
        };
        builder.update = (values: any, options?: any) => {
          capturedMethod = 'update';
          capturedPayload = values;
          return origUpdate(values, options);
        };
        return builder;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer onUpdateProfileReady={(fn) => { updateProfileFn = fn; }} />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-loading').textContent).toBe('false');
      });

      await act(async () => {
        await updateProfileFn!({
          target_calories: 2500,
          plan: 'basic' as any,
          paid_until: '2030-01-01T00:00:00Z' as any,
          trial_ends_at: '2030-01-01T00:00:00Z' as any,
          billing_customer_id: 'cus_unauthorized' as any,
        });
      });

      expect(capturedPayload).not.toHaveProperty('plan');
      expect(capturedPayload).not.toHaveProperty('paid_until');
      expect(capturedPayload).not.toHaveProperty('trial_ends_at');
      expect(capturedPayload).not.toHaveProperty('billing_customer_id');
      expect(capturedPayload).not.toHaveProperty('role');
      expect(capturedPayload).not.toHaveProperty('coach_tier');
      expect(capturedPayload).not.toHaveProperty('max_athletes');
      expect(capturedMethod).toBe('upsert');
      expect(capturedPayload).toEqual({ id: 'cached-user-123', target_calories: 2500 });
    });

    it('saving settings when cached profile contains billing fields never sends them to supabase', async () => {
      const profileWithBilling: UserProfile = {
        ...mockProfile,
        plan: 'pro',
        paid_until: '2027-01-01T00:00:00Z',
        trial_ends_at: '2026-12-01T00:00:00Z',
        billing_customer_id: 'cus_profile_123',
        coach_tier: 'pro',
        max_athletes: 10,
      };
      localStorage.setItem('yourbody_user', JSON.stringify(profileWithBilling));

      let capturedPayload: any = null;
      let capturedMethod: string | null = null;
      let updateProfileFn: ((updates: Partial<UserProfile>) => Promise<any>) | null = null;

      (supabase.from as any).mockImplementation((table: string) => {
        const builder = createSupabaseBuilder(table, profileWithBilling);
        const origUpsert = builder.upsert.bind(builder);
        const origUpdate = builder.update.bind(builder);
        builder.upsert = (values: any, options?: any) => {
          capturedMethod = 'upsert';
          capturedPayload = values;
          return origUpsert(values, options);
        };
        builder.update = (values: any, options?: any) => {
          capturedMethod = 'update';
          capturedPayload = values;
          return origUpdate(values, options);
        };
        return builder;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TestConsumer onUpdateProfileReady={(fn) => { updateProfileFn = fn; }} />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-loading').textContent).toBe('false');
      });

      // User changes auto rest timer in settings
      await act(async () => {
        await updateProfileFn!({
          auto_rest_timer: false,
          rest_timer_seconds: 120,
        });
      });

      expect(capturedPayload).not.toHaveProperty('plan');
      expect(capturedPayload).not.toHaveProperty('paid_until');
      expect(capturedPayload).not.toHaveProperty('trial_ends_at');
      expect(capturedPayload).not.toHaveProperty('billing_customer_id');
      expect(capturedPayload).not.toHaveProperty('role');
      expect(capturedPayload).not.toHaveProperty('coach_tier');
      expect(capturedPayload).not.toHaveProperty('max_athletes');
      expect(capturedMethod).toBe('upsert');
      expect(capturedPayload).toEqual({
        id: 'cached-user-123',
        auto_rest_timer: false,
        rest_timer_seconds: 120,
      });
    });

    it('USER_EDITABLE_PROFILE_KEYS excludes billing, role, and subscription protected fields', () => {
      expect(USER_EDITABLE_PROFILE_KEYS).not.toContain('plan');
      expect(USER_EDITABLE_PROFILE_KEYS).not.toContain('paid_until');
      expect(USER_EDITABLE_PROFILE_KEYS).not.toContain('trial_ends_at');
      expect(USER_EDITABLE_PROFILE_KEYS).not.toContain('billing_customer_id');
      expect(USER_EDITABLE_PROFILE_KEYS).not.toContain('role');
      expect(USER_EDITABLE_PROFILE_KEYS).not.toContain('coach_tier');
      expect(USER_EDITABLE_PROFILE_KEYS).not.toContain('max_athletes');
      expect(USER_EDITABLE_PROFILE_KEYS).toContain('username');
      expect(USER_EDITABLE_PROFILE_KEYS).toContain('target_calories');
    });
  });
});


