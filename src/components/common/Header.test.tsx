import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { Header } from './Header';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import { CoachProvider } from '../../context/CoachContext';
import { expectNoA11yViolations } from '../../test/a11y';
import {
  updateUserCache,
  setSyncingStatus,
  setAuthRequiredStatus,
  resetOutboxForTesting,
} from '../../offline/outbox';

import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../../test/supabaseBuilderMock';

const { mockUserProfile } = vi.hoisted(() => ({
  mockUserProfile: {
    id: 'test-user',
    role: 'coach',
    email: 'coach@yourbody.fyi',
  },
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return createSupabaseBuilder('users', mockUserProfile);
      }
      return createSupabaseBuilder(table, []);
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user', email: 'coach@yourbody.fyi' } } }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'test-user', email: 'coach@yourbody.fyi' } } },
      }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe('Header connection status badge', () => {
  let queryClient: QueryClient;
  const originalOnLine = navigator.onLine;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    localStorage.clear();
    mockUserProfile.id = 'test-user';
    mockUserProfile.role = 'coach';
    mockUserProfile.email = 'coach@yourbody.fyi';
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: originalOnLine,
    });
  });

  const renderHeader = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <CoachProvider>
              <Header />
            </CoachProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    );

  it('renders Online status badge when navigator is online', async () => {
    renderHeader();

    const badge = screen.getByTestId('connection-status');
    expect(badge).toBeDefined();
    expect(badge.getAttribute('title')).toBe('Online');
    expect(badge.textContent).toContain('Online');
    await waitFor(() => {
      expect(getRecordedTables()).toContain('users');
      expect(getRecordedSelects()).toContainEqual({
        table: 'users',
        projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
      });
      expect(getRecordedTables()).toContain('coach_athlete_links');
      expect(getRecordedSelects()).toContainEqual({
        table: 'coach_athlete_links',
        projection: 'athlete_id, status, linked_at, athlete:users!athlete_id(id, username, email, role, created_at, timezone)',
      });
    });
  });

  it('renders Offline status badge when navigator is offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });

    renderHeader();

    const badge = screen.getByTestId('connection-status');
    expect(badge).toBeDefined();
    expect(badge.getAttribute('title')).toBe('Offline');
    expect(badge.textContent).toContain('Offline');
  });

  it('updates badge dynamically when window network events fire', () => {
    renderHeader();

    const badge = screen.getByTestId('connection-status');
    expect(badge.getAttribute('title')).toBe('Online');

    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(badge.getAttribute('title')).toBe('Offline');
    expect(badge.textContent).toContain('Offline');

    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    expect(badge.getAttribute('title')).toBe('Online');
    expect(badge.textContent).toContain('Online');
  });

  it('renders role switch button with min 44x44px target, accessible name, and unified max-w-xl container', async () => {
    const { container } = renderHeader();

    await waitFor(() => {
      expect(screen.getByTestId('role-switch-button')).toBeDefined();
    });

    const roleButton = screen.getByTestId('role-switch-button');
    expect(roleButton).toBeDefined();

    // Verify accessible name reflects current state and action
    const accessibleName = roleButton.getAttribute('aria-label');
    expect(accessibleName).toBe('Coach mode active. Switch to Athlete mode.');

    // WCAG SC 2.5.3 (Label in Name, Level A) regression guard:
    // Accessible name MUST contain the visible text for voice control and screen reader consistency
    const visibleLabel = roleButton.textContent?.trim() || '';
    expect(visibleLabel).toBe('Coach');
    expect(accessibleName).toContain(visibleLabel);

    // Verify touch target is at least 44x44px (WCAG 2.5.5 / 2.5.8)
    expect(roleButton.className).toContain('min-h-[44px]');
    expect(roleButton.className).toContain('min-w-[44px]');

    // Verify Header container is max-w-xl for shell region unification (B3)
    const innerContainer = container.querySelector('header > div');
    expect(innerContainer?.className).toContain('max-w-xl');

    // Verify accessibility with axe-core
    await expectNoA11yViolations(container);
  });

  it('exposes role="status" on the persistent connection badge and mutates content in place (WCAG SC 4.1.3)', () => {
    renderHeader();

    const badge = screen.getByTestId('connection-status');
    expect(badge.tagName).toBe('BUTTON');
    const liveRegion = badge.querySelector('[role="status"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.getAttribute('aria-live')).toBe('polite');

    // Live region exists while online
    expect(badge.textContent).toContain('Online');

    // When transitioning offline, content mutates on the exact same element
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('connection-status')).toBe(badge);
    expect(badge.textContent).toContain('Offline');
  });

  it('satisfies STD-TYP with no banned font weight or family tokens in brand header', () => {
    const { container } = renderHeader();
    const h1 = container.querySelector('h1');
    expect(h1?.className).toContain('font-bold');
    expect(h1?.className).not.toContain('font-' + 'black');

    const tag = container.querySelector('header h1 + div');
    expect(tag?.className).toContain('text-xs');
    expect(tag?.className).toContain('font-semibold');
    expect(tag?.className).not.toContain('font-' + 'mono');
    expect(tag?.className).not.toContain('text-[10' + 'px]');
  });

  describe('Header coach-dashboard link visibility matrix', () => {
    it('(a) athlete off /coach: link is not rendered', async () => {
      mockUserProfile.role = 'athlete';
      window.history.pushState({}, '', '/workout');
      renderHeader();

      await waitFor(() => {
        expect(screen.getByText('Yourbody.fyi')).toBeDefined();
      });

      expect(screen.queryByTestId('coach-dashboard-link')).toBeNull();
    });

    it('(b) coach in athlete mode off /coach: link is not rendered', async () => {
      mockUserProfile.role = 'coach';
      localStorage.setItem('yourbody_view_mode', 'athlete');
      window.history.pushState({}, '', '/workout');
      renderHeader();

      await waitFor(() => {
        expect(screen.getByTestId('role-switch-button')).toBeDefined();
      });

      const roleBtn = screen.getByTestId('role-switch-button');
      expect(roleBtn.getAttribute('aria-label')).toContain('Athlete mode active');
      expect(screen.queryByTestId('coach-dashboard-link')).toBeNull();
    });

    it('(c) coach mode on /coach: link is not rendered', async () => {
      mockUserProfile.role = 'coach';
      localStorage.setItem('yourbody_view_mode', 'coach');
      window.history.pushState({}, '', '/coach');
      renderHeader();

      await waitFor(() => {
        expect(screen.getByTestId('role-switch-button')).toBeDefined();
      });

      const roleBtn = screen.getByTestId('role-switch-button');
      expect(roleBtn.getAttribute('aria-label')).toContain('Coach mode active');
      expect(screen.queryByTestId('coach-dashboard-link')).toBeNull();
    });

    it('(d) coach mode elsewhere (off /coach): link is rendered (44x44, aria-label, href /coach)', async () => {
      mockUserProfile.role = 'coach';
      localStorage.setItem('yourbody_view_mode', 'coach');
      window.history.pushState({}, '', '/workout');
      const { container } = renderHeader();

      await waitFor(() => {
        expect(screen.getByTestId('coach-dashboard-link')).toBeDefined();
      });

      const link = screen.getByTestId('coach-dashboard-link');
      expect(link.getAttribute('aria-label')).toBe('Coach dashboard');
      expect(link.getAttribute('href')).toBe('/coach');
      expect(link.className).toContain('min-h-[44px]');
      expect(link.className).toContain('min-w-[44px]');

      await expectNoA11yViolations(container);
    });
  });

  describe('Header connection status badge states & A9 sign out confirm', () => {
    beforeEach(() => {
      localStorage.setItem('yourbody_user', JSON.stringify({ id: 'test-user', email: 'coach@yourbody.fyi' }));
    });

    afterEach(() => {
      resetOutboxForTesting();
      localStorage.removeItem('yourbody_user');
    });

    it('renders "Offline" when offline with 0 pending', async () => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: false });
      updateUserCache('test-user', []);

      renderHeader();
      await waitFor(() => {
        const badge = screen.getByTestId('connection-status');
        expect(badge.textContent).toContain('Offline');
        expect(badge.getAttribute('title')).toBe('Offline');
      });
    });

    it('renders "Offline · 12 pending" when offline with 12 pending items', async () => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: false });
      const ops = Array.from({ length: 12 }, (_, i) => ({
        opId: `op-${i}`,
        userId: 'test-user',
        seq: i + 1,
        createdAt: new Date().toISOString(),
        attempts: 0,
        state: 'pending' as const,
        kind: 'set.create' as const,
        payload: { id: `s-${i}`, workoutRef: 'w1', exercise_id: 'e1', weight: 100, reps: 5, set_index: i + 1, created_at: new Date().toISOString() },
      }));
      updateUserCache('test-user', ops);

      renderHeader();
      await waitFor(() => {
        const badge = screen.getByTestId('connection-status');
        expect(badge.textContent).toContain('Offline · 12 pending');
        expect(badge.getAttribute('title')).toBe('Offline · 12 pending');
      });
    });

    it('renders "Syncing · 3" when online and syncing with 3 pending', async () => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: true });
      const ops = Array.from({ length: 3 }, (_, i) => ({
        opId: `op-${i}`,
        userId: 'test-user',
        seq: i + 1,
        createdAt: new Date().toISOString(),
        attempts: 0,
        state: 'pending' as const,
        kind: 'set.create' as const,
        payload: { id: `s-${i}`, workoutRef: 'w1', exercise_id: 'e1', weight: 100, reps: 5, set_index: i + 1, created_at: new Date().toISOString() },
      }));
      updateUserCache('test-user', ops);
      setSyncingStatus(true);

      renderHeader();
      await waitFor(() => {
        const badge = screen.getByTestId('connection-status');
        expect(badge.textContent).toContain('Syncing · 3');
        expect(badge.getAttribute('title')).toBe('Syncing · 3');
      });
    });

    it('renders "2 need attention" with warning tone when attention items exist', async () => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: true });
      const ops = [
        {
          opId: 'op-att-1',
          userId: 'test-user',
          seq: 1,
          createdAt: new Date().toISOString(),
          attempts: 1,
          state: 'attention' as const,
          error: 'FK constraint failed',
          kind: 'set.create' as const,
          payload: { id: 's-1', workoutRef: 'w1', exercise_id: 'e1', weight: 100, reps: 5, set_index: 1, created_at: new Date().toISOString() },
        },
        {
          opId: 'op-att-2',
          userId: 'test-user',
          seq: 2,
          createdAt: new Date().toISOString(),
          attempts: 1,
          state: 'attention' as const,
          error: 'Row deleted',
          kind: 'set.update' as const,
          payload: { id: 's-2', patch: { reps: 8 } },
        },
      ];
      updateUserCache('test-user', ops);

      renderHeader();
      await waitFor(() => {
        const badge = screen.getByTestId('connection-status');
        expect(badge.textContent).toContain('2 need attention');
        expect(badge.getAttribute('title')).toBe('2 need attention');
      });
    });

    it('renders "Sign in to sync" when authRequired is true', async () => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: true });
      setAuthRequiredStatus(true);

      renderHeader();
      await waitFor(() => {
        const badge = screen.getByTestId('connection-status');
        expect(badge.textContent).toContain('Sign in to sync');
        expect(badge.getAttribute('title')).toBe('Sign in to sync');
      });
    });

    it('clicking connection status button opens SyncStatusSheet', async () => {
      renderHeader();
      const badge = screen.getByTestId('connection-status');
      act(() => {
        badge.click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('sync-status-sheet')).toBeDefined();
        expect(screen.getByText('Sync status')).toBeDefined();
      });
    });

    it('A9: asks for confirmation on sign-out when outbox has pending items', async () => {
      const ops = [
        {
          opId: 'op-pending',
          userId: 'test-user',
          seq: 1,
          createdAt: new Date().toISOString(),
          attempts: 0,
          state: 'pending' as const,
          kind: 'set.create' as const,
          payload: { id: 's-1', workoutRef: 'w1', exercise_id: 'e1', weight: 100, reps: 5, set_index: 1, created_at: new Date().toISOString() },
        },
      ];
      updateUserCache('test-user', ops);

      renderHeader();
      await waitFor(() => {
        expect(screen.getByTestId('sign-out-button')).toBeDefined();
      });
      const signOutBtn = screen.getByTestId('sign-out-button');
      await act(async () => {
        signOutBtn.click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('sign-out-confirm-dialog')).toBeDefined();
        expect(screen.getByText(/1 unsynced changes stay on this device and sync the next time you sign in as coach@yourbody\.fyi\. Sign out\?/)).toBeDefined();
      });
    });

    it('D-YB2-1: header inner container has max-w-xl mx-auto px-4 and header has no horizontal padding', () => {
      const { container } = renderHeader();
      const header = container.querySelector('header');
      expect(header).toBeDefined();
      expect(header?.className).not.toMatch(/\bpx-\S+/);
      expect(header?.className).not.toMatch(/\bsm:px-\S+/);

      const innerContainer = container.querySelector('header > div');
      expect(innerContainer?.className).toContain('max-w-xl');
      expect(innerContainer?.className).toContain('mx-auto');
      expect(innerContainer?.className).toContain('px-4');
    });

    it('D-YB2-1: connection status badge hides text below 360px via max-[359px]:sr-only for non-online states', async () => {
      setAuthRequiredStatus(true);
      renderHeader();
      await waitFor(() => {
        const badge = screen.getByTestId('connection-status');
        const statusSpan = badge.querySelector('[role="status"]');
        expect(statusSpan).not.toBeNull();
        expect(statusSpan?.className).toContain('max-[359px]:sr-only');
        expect(statusSpan?.textContent).toBe('Sign in to sync');
      });
    });
  });

  describe('YB3: header polish unit tests', () => {
    it('YB3: Brand name uses text-sm (<sm) and tagline has quieter styling with max-[359px]:hidden', () => {
      const { container } = renderHeader();
      const h1 = container.querySelector('header h1');
      expect(h1).not.toBeNull();
      expect(h1?.className).toContain('text-sm');
      expect(h1?.className).toContain('font-bold');
      expect(h1?.className).toContain('text-zinc-50');
      expect(h1?.className).not.toContain('text-xs');

      const tagline = container.querySelector('header h1 + div');
      expect(tagline).not.toBeNull();
      expect(tagline?.className).toContain('max-[359px]:hidden');
      expect(tagline?.className).toContain('text-cyan-400/70');
      expect(tagline?.className).not.toContain('tracking-wider');
    });

    it('YB3: Controls have no shadow-[ glow classes', async () => {
      mockUserProfile.role = 'coach';
      localStorage.setItem('yourbody_view_mode', 'coach');
      window.history.pushState({}, '', '/workout');
      const { container } = renderHeader();

      await waitFor(() => {
        expect(screen.getByTestId('coach-dashboard-link')).toBeDefined();
        expect(screen.getByTestId('role-switch-button')).toBeDefined();
      });

      const controlsContainer = container.querySelector('header > div > div.flex');
      expect(controlsContainer).not.toBeNull();

      // Check all elements within right controls container have no glow shadows
      const allControlElements = [controlsContainer!, ...Array.from(controlsContainer!.querySelectorAll('*'))];
      for (const el of allControlElements) {
        const cls = (typeof el.className === 'string' ? el.className : el.getAttribute('class')) || '';
        expect(cls).not.toMatch(/shadow-\[/);
      }

      // Check logo tile has no glow shadow
      const logoTile = container.querySelector('header a[href="/workout"] > div:first-child');
      const logoCls = (typeof logoTile?.className === 'string' ? logoTile.className : logoTile?.getAttribute('class')) || '';
      expect(logoCls).not.toMatch(/shadow-\[/);
    });

    it('YB3: Online connection status has no border or background classes and an sr-only status text', () => {
      renderHeader();

      const badge = screen.getByTestId('connection-status');
      expect(badge).toBeDefined();

      // Outer button or inner visual container should not have bg-emerald or border classes
      expect(badge.className).not.toMatch(/bg-emerald/);
      expect(badge.className).not.toMatch(/\bborder\b/);

      const innerVisual = badge.firstElementChild;
      expect(innerVisual).not.toBeNull();
      expect(innerVisual?.className).not.toMatch(/bg-emerald/);
      expect(innerVisual?.className).not.toMatch(/\bborder\b/);

      // Status text is sr-only at all widths
      const statusSpan = badge.querySelector('[role="status"]');
      expect(statusSpan).not.toBeNull();
      expect(statusSpan?.className).toContain('sr-only');

      // Dot has no pulse animation
      const dot = badge.querySelector('span[aria-hidden="true"]');
      expect(dot?.className).toContain('bg-emerald-500');
      expect(dot?.className).not.toContain('animate-pulse');
    });

    it('YB3: Role switch button label has max-sm:sr-only for icon-only mobile display', async () => {
      mockUserProfile.role = 'coach';
      renderHeader();

      await waitFor(() => {
        expect(screen.getByTestId('role-switch-button')).toBeDefined();
      });

      const roleButton = screen.getByTestId('role-switch-button');
      const innerVisual = roleButton.firstElementChild;
      const labelSpan = innerVisual?.querySelector('span:not([aria-hidden])');
      expect(labelSpan).not.toBeNull();
      expect(labelSpan?.className).toContain('max-sm:sr-only');
    });

    it('YB3: Container gaps follow gap-0 min-[360px]:gap-1 sm:gap-2 and brand gap-2', () => {
      const { container } = renderHeader();

      const brandLink = container.querySelector('header a[href="/workout"]');
      expect(brandLink?.className).toContain('gap-2');
      expect(brandLink?.className).not.toContain('gap-0.5');

      const controlsContainer = container.querySelector('header > div > div.flex');
      expect(controlsContainer?.className).toContain('gap-0');
      expect(controlsContainer?.className).toContain('min-[360px]:gap-1');
      expect(controlsContainer?.className).toContain('sm:gap-2');
    });

    it('YB3: Non-coach static Athlete chip is hidden below sm', async () => {
      mockUserProfile.role = 'athlete';
      const { container } = renderHeader();

      await waitFor(() => {
        expect(screen.getByText('Yourbody.fyi')).toBeDefined();
      });

      const athleteChip = container.querySelector('header [title="Athlete Account"]');
      expect(athleteChip).not.toBeNull();
      expect(athleteChip?.className).toContain('hidden');
      expect(athleteChip?.className).toContain('sm:flex');
    });

    it('YB3: Controls have min-w-[44px] min-h-[44px] and inner visuals have h-9 rounded-full', async () => {
      mockUserProfile.role = 'coach';
      localStorage.setItem('yourbody_view_mode', 'coach');
      window.history.pushState({}, '', '/workout');
      renderHeader();

      await waitFor(() => {
        expect(screen.getByTestId('coach-dashboard-link')).toBeDefined();
        expect(screen.getByTestId('role-switch-button')).toBeDefined();
        expect(screen.getByTestId('connection-status')).toBeDefined();
        expect(screen.getByTestId('sign-out-button')).toBeDefined();
      });

      const controlTestIds = ['coach-dashboard-link', 'role-switch-button', 'connection-status', 'sign-out-button'];
      for (const testId of controlTestIds) {
        const ctrl = screen.getByTestId(testId);
        expect(ctrl.className).toContain('min-w-[44px]');
        expect(ctrl.className).toContain('min-h-[44px]');

        const innerVisual = ctrl.firstElementChild;
        expect(innerVisual).not.toBeNull();
        expect(innerVisual?.className).toContain('h-9');
        expect(innerVisual?.className).toContain('rounded-full');
      }
    });
  });
});
