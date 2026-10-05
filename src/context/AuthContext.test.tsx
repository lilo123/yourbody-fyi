import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './AuthContext';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../test/supabaseBuilderMock';
import type { UserProfile } from '../types/database';
import * as offlineModule from '../offline';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

const TestConsumer: React.FC = () => {
  const { user, profile, loading, signOut, refreshProfile } = useAuth();
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
    vi.useFakeTimers();
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

  it('4. completely cleans up yourbody storage and resets state on signOut()', async () => {
    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));
    localStorage.setItem('yourbody_view_mode', 'coach');
    localStorage.setItem('yourbody_auto_rest_timer', 'true');
    localStorage.setItem('yourbody_extra_custom_key', 'some_val');
    localStorage.setItem('unrelated_app_key', 'preserve_me');

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

    const signOutBtn = screen.getByTestId('auth-signout-btn');
    await act(async () => {
      fireEvent.click(signOutBtn);
    });

    expect(localStorage.getItem('yourbody_user')).toBeNull();
    expect(localStorage.getItem('yourbody_view_mode')).toBeNull();
    expect(localStorage.getItem('yourbody_auto_rest_timer')).toBeNull();
    expect(localStorage.getItem('yourbody_extra_custom_key')).toBeNull();
    expect(localStorage.getItem('unrelated_app_key')).toBe('preserve_me');
    expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
    expect(screen.getByTestId('auth-profile-username').textContent).toBe('none');
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

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    expect(screen.getByTestId('auth-profile-username').textContent).toBe(mockProfile.username);

    const refreshBtn = screen.getByTestId('auth-refresh-btn');
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-profile-username').textContent).toBe('UpdatedCyberWarrior');
    });

    expect(getRecordedTables()).toContain('users');
    expect(getRecordedSelects()).toContainEqual({
      table: 'users',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
    });
  });

  it('6. successfully re-authenticates and fetches profile after signOut without being blocked by signedOutRef', async () => {
    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));

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
      expect(screen.getByTestId('auth-user-id').textContent).toBe(mockProfile.id);
    });

    // Sign out
    const signOutBtn = screen.getByTestId('auth-signout-btn');
    await act(async () => {
      fireEvent.click(signOutBtn);
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
});

