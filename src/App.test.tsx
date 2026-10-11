import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from './lib/supabase';
import { restTimerStore } from './utils/restTimerStore';

import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from './test/supabaseBuilderMock';

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    user: { id: 'test-user-id', email: 'coach@yourbody.fyi' },
  },
}));

vi.mock('./lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

describe('App Shell & Navigation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    localStorage.clear();
    window.history.pushState({}, '', '/');
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: 'test-user-id' } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    (supabase.auth.onAuthStateChange as any).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    const mockUser = {
      id: 'test-user-id',
      email: 'coach@yourbody.fyi',
      username: 'Coach Demo',
      role: 'coach',
      target_calories: 2400,
      target_protein: 180,
      target_carbs: 240,
      target_fat: 70,
      target_fiber: 30,
    };

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'users') {
        return createSupabaseBuilder('users', mockUser);
      }
      return createSupabaseBuilder(table, []);
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it('renders top Header and bottom navigation tabs', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    // Wait for auth initialization and header render
    await waitFor(() => {
      expect(screen.getByText('Yourbody.fyi')).toBeDefined();
      expect(screen.getByText('Fitness & Nutrition')).toBeDefined();
      expect(screen.getByTestId('nav-workout')).toBeDefined();
      expect(screen.getByTestId('nav-nutrition')).toBeDefined();
      expect(screen.getByTestId('nav-history')).toBeDefined();
    });

    expect(getRecordedTables()).toContain('users');
    expect(getRecordedSelects()).toContainEqual({
      table: 'users',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
    });
  });

  it('navigates to Nutrition tab when bottom nav item is clicked', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('nav-nutrition')).toBeDefined();
    });

    const nutritionTab = screen.getByTestId('nav-nutrition');
    fireEvent.click(nutritionTab);

    await waitFor(() => {
      expect(screen.getByText("Today's Nutrition")).toBeDefined();
    }, { timeout: 10000 });
  });

  it('redirects to /login when session expires (SIGNED_OUT event)', async () => {
    let authCallback: any = null;
    (supabase.auth.onAuthStateChange as any).mockImplementation((cb: any) => {
      authCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Yourbody.fyi')).toBeDefined();
    });

    // Trigger SIGNED_OUT
    if (authCallback) {
      act(() => {
        authCallback('SIGNED_OUT', null);
      });
    }

    await waitFor(() => {
      expect(screen.getAllByText('Sign In').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByPlaceholderText('you@example.com')).toBeDefined();
    });
  });

  it('persists global rest timer pill across /workout, /nutrition, and /history navigation', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Yourbody.fyi')).toBeDefined();
    });

    // Start timer globally
    act(() => {
      restTimerStore.start(90);
    });

    // Pill is visible on /workout
    await waitFor(() => {
      expect(screen.getByTestId('rest-timer-pill')).toBeDefined();
      expect(screen.getByTestId('rest-timer-display').textContent).toBe('1:30');
    });

    // Navigate to /nutrition
    const nutritionTab = screen.getByTestId('nav-nutrition');
    fireEvent.click(nutritionTab);

    await waitFor(() => {
      expect(screen.getByText("Today's Nutrition")).toBeDefined();
      expect(screen.getByTestId('rest-timer-pill')).toBeDefined();
      expect(screen.getByTestId('rest-timer-display')).toBeDefined();
    }, { timeout: 3000 });

    // Navigate to /history
    const historyTab = screen.getByTestId('nav-history');
    fireEvent.click(historyTab);

    await waitFor(() => {
      expect(screen.getByTestId('history-tab-workouts')).toBeDefined();
      expect(screen.getByTestId('rest-timer-pill')).toBeDefined();
      expect(screen.getByTestId('rest-timer-display')).toBeDefined();
    }, { timeout: 10000 });
  });

  it('renders Cyberpunk pulse spinner and retry button in ProtectedRoute when loading exceeds 2s', async () => {
    window.history.pushState({}, '', '/workout');
    vi.useFakeTimers();
    try {
      (supabase.auth.getSession as any).mockImplementation(() => new Promise(() => {}));
      localStorage.clear();

      render(
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      );

      expect(screen.getByText('Connecting to Yourbody...')).toBeDefined();
      expect(screen.queryByTestId('auth-retry-button')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.getByTestId('auth-retry-button')).toBeDefined();
      expect(screen.getByText('Connecting to Yourbody... Tap to Retry')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders protected content immediately without showing loading spinner when cached user exists in localStorage', () => {
    (supabase.auth.getSession as any).mockImplementation(() => new Promise(() => {}));

    const cachedProfile = {
      id: 'cached-athlete-1',
      email: 'athlete@yourbody.fyi',
      username: 'FastRunner',
      role: 'athlete',
      target_calories: 2200,
      target_protein: 160,
      target_carbs: 220,
      target_fat: 70,
      target_fiber: 30,
      auto_rest_timer: true,
    };
    localStorage.setItem('yourbody_user', JSON.stringify(cachedProfile));

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    // Spinner should NOT be displayed
    expect(screen.queryByText('Connecting to Yourbody...')).toBeNull();
    // App header shell is rendered immediately
    expect(screen.getByText('Yourbody.fyi')).toBeDefined();
    expect(screen.getByTestId('nav-workout')).toBeDefined();
  });

  it('renders exactly 5 tabs in BottomNav with Coach absent, and reaches Coach view via Header mode switch', async () => {
    localStorage.setItem('yourbody_view_mode', 'athlete');

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    // Wait for auth initialization
    await waitFor(() => {
      expect(screen.getByText('Yourbody.fyi')).toBeDefined();
      expect(screen.getByTestId('role-switch-button')).toBeDefined();
    });

    // Assert rendered bottom nav tab count is 5
    const navItems = screen.getAllByTestId(/^nav-/);
    expect(navItems).toHaveLength(5);
    expect(screen.getByTestId('nav-workout')).toBeDefined();
    expect(screen.getByTestId('nav-nutrition')).toBeDefined();
    expect(screen.getByTestId('nav-exercises')).toBeDefined();
    expect(screen.getByTestId('nav-history')).toBeDefined();
    expect(screen.getByTestId('nav-settings')).toBeDefined();

    // Coach entry must be absent from bottom nav
    expect(screen.queryByTestId('nav-coach')).toBeNull();

    // Initially in Athlete mode
    const roleButton = screen.getByTestId('role-switch-button');
    expect(roleButton.getAttribute('aria-label')).toBe('Athlete mode active. Switch to Coach mode.');
    expect(roleButton.getAttribute('aria-label')).toContain(roleButton.textContent?.trim() || '');

    // Toggle to Coach mode -> navigates to /coach and renders Coach view
    fireEvent.click(roleButton);

    await waitFor(() => {
      expect(screen.getByText('Coach Dashboard')).toBeDefined();
      expect(roleButton.getAttribute('aria-label')).toBe('Coach mode active. Switch to Athlete mode.');
      expect(roleButton.getAttribute('aria-label')).toContain(roleButton.textContent?.trim() || '');
    }, { timeout: 10000 });

    // Toggle back to Athlete mode -> navigates to /workout
    fireEvent.click(roleButton);

    await waitFor(() => {
      expect(roleButton.getAttribute('aria-label')).toBe('Athlete mode active. Switch to Coach mode.');
      expect(roleButton.getAttribute('aria-label')).toContain(roleButton.textContent?.trim() || '');
      expect(screen.queryByText('Coach Dashboard')).toBeNull();
    }, { timeout: 10000 });
  });

  it('renders landing headline for a logged-out browser visitor at /', async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: null } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } });
    localStorage.clear();
    window.history.pushState({}, '', '/');

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Track workouts and meals\. Even without signal\./i })
      ).toBeDefined();
    });
    expect(screen.getAllByText('Start free').length).toBeGreaterThanOrEqual(1);
  });

  it('redirects and does not render landing headline for a standalone-mode visitor at /', async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: null } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } });
    localStorage.clear();
    window.history.pushState({}, '', '/');

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      );

      // In standalone mode, root redirect kicks in: does NOT display landing headline
      await waitFor(() => {
        expect(
          screen.queryByRole('heading', { name: /Track workouts and meals\. Even without signal\./i })
        ).toBeNull();
      });

      // Instead, it redirected to /workout where unauthenticated user eventually hits login
      await waitFor(() => {
        expect(screen.getAllByText('Sign In').length).toBeGreaterThanOrEqual(1);
      });
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('renders auth loading fallback at / while loading without cached user (no landing rendered, no redirect)', () => {
    (supabase.auth.getSession as any).mockImplementation(() => new Promise(() => {}));
    localStorage.clear();
    window.history.pushState({}, '', '/');

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    // Auth loading fallback is rendered
    expect(screen.getByText('Connecting to Yourbody...')).toBeDefined();

    // No landing headline is rendered
    expect(
      screen.queryByRole('heading', { name: /Track workouts and meals\. Even without signal\./i })
    ).toBeNull();
    expect(screen.queryByText('Start free')).toBeNull();

    // No redirect occurred: stays at '/' and neither login nor workout engine is mounted
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByPlaceholderText('you@example.com')).toBeNull();
  });
});


