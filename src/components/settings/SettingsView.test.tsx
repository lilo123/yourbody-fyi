import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsView } from './SettingsView';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../../test/supabaseBuilderMock';
import { expectNoA11yViolations } from '../../test/a11y';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    user: { id: 'test-coach-id', email: 'coach@yourbody.fyi' },
  },
}));

vi.mock('../../hooks/useOnlineStatus');

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: 'test-coach-id' } }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'test-coach-id' } }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe('SettingsView', () => {
  let queryClient: QueryClient;
  const mockUpsert = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    localStorage.clear();
    vi.mocked(useOnlineStatus).mockReturnValue(true);
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    (supabase.rpc as any).mockResolvedValue({ data: { success: true }, error: null });
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'users') {
        const b = createSupabaseBuilder('users', {
          data: {
            id: 'test-coach-id',
            email: 'coach@yourbody.fyi',
            username: 'Coach Demo',
            role: 'coach',
            is_coach_mode: true,
            coach_code: 'YB-DEMO01',
            coach_tier: 'pro',
            max_athletes: 10,
            target_calories: 2400,
            target_protein: 180,
            target_carbs: 240,
            target_fat: 70,
            target_fiber: 35,
          },
          error: null,
        });
        b.upsert = mockUpsert;
        return b;
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <SettingsView />
              <ToastHost />
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    );

  it('renders 5-column daily macro goals grid including Calories, Protein, Carbs, Fat, and Fiber', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');
    expect(screen.getByText('Daily Macro Goals')).toBeDefined();
    expect(screen.getByText('Calories (kcal)')).toBeDefined();
    expect(screen.getByText('Protein (g)')).toBeDefined();
    expect(screen.getByText('Carbs (g)')).toBeDefined();
    expect(screen.getByText('Fat (g)')).toBeDefined();
    expect(screen.getByText('Fiber (g)')).toBeDefined();
    expect(screen.getByRole('button', { name: /Save Goals/i })).toBeDefined();

    expect(getRecordedTables()).toContain('users');
    expect(getRecordedSelects()).toContainEqual({
      table: 'users',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
    });
  });

  it('allows updating all 5 macro targets and saves goals', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const saveBtn = screen.getByRole('button', { name: /Save Goals/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // Scoped to the banner: StatusBanner deliberately renders the message in
      // both its permanently-mounted sr-only live region and the visible
      // banner, so an unscoped getByText matches two nodes.
      const banner = screen.getByTestId('settings-status-banner');
      expect(within(banner).getByText('Settings saved')).toBeDefined();
    });
  });

  it('allows toggling between Athlete View and Coach View modes for coach', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const athleteModeBtn = screen.getByRole('button', { name: /Athlete View/i });
    const coachModeBtn = screen.getByRole('button', { name: /Coach View/i });

    expect(athleteModeBtn).toBeDefined();
    expect(coachModeBtn).toBeDefined();

    fireEvent.click(athleteModeBtn);
    await waitFor(() => {
      expect(localStorage.getItem('yourbody_view_mode')).toBe('athlete');
    });
  });

  it('renders Workout Preferences section with auto-start rest timer toggle switch', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    expect(screen.getByText('Workout Preferences')).toBeDefined();
    expect(screen.getByText('Auto-start Rest Timer on Set Log')).toBeDefined();
    const toggleBtn = screen.getByTestId('toggle-auto-timer');
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn.getAttribute('aria-checked')).toBe('true');
    expect(toggleBtn.className).toContain('before:absolute');
    expect(toggleBtn.className).toContain('before:-inset-y-2.5');
    expect(toggleBtn.className).toContain('before:inset-x-0');
    expect(toggleBtn.className).toContain("before:content-['']");
  });

  it('allows toggling auto-start rest timer preference and persists to localStorage and profile', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const toggleBtn = screen.getByTestId('toggle-auto-timer');
    expect(toggleBtn.getAttribute('aria-checked')).toBe('true');

    // Toggle off
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(toggleBtn.getAttribute('aria-checked')).toBe('false');
      expect(localStorage.getItem('yourbody_auto_rest_timer')).toBe('false');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          auto_rest_timer: false,
        })
      );
    });

    // Toggle back on
    fireEvent.click(toggleBtn);
    await waitFor(() => {
      expect(toggleBtn.getAttribute('aria-checked')).toBe('true');
      expect(localStorage.getItem('yourbody_auto_rest_timer')).toBe('true');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          auto_rest_timer: true,
        })
      );
    });
  });

  it('renders error banner with alert styling when saving goals fails', async () => {
    mockUpsert.mockReturnValueOnce({
      eq: vi.fn().mockResolvedValue({ error: { message: 'Database write error' } }),
    });

    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const saveBtn = screen.getByRole('button', { name: /Save Goals/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const banner = screen.getByTestId('settings-status-banner');
      expect(banner).toBeDefined();
      expect(banner.className).toContain('text-rose-300');
      expect(
        within(banner).getByText(/Failed to save settings: Database write error/i)
      ).toBeDefined();
    });
  });

  it('renders Coach Mode & Roster section with coach code, capacity badge, and vanity code editor', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    expect(screen.getByText('Coach Mode & Roster')).toBeDefined();
    expect(screen.getByTestId('active-coach-code').textContent).toContain('YB-DEMO01');
    expect(screen.getByText('0 / 10 Athletes (Coach)')).toBeDefined();
    expect(screen.getByTestId('copy-coach-code-btn')).toBeDefined();
    expect(screen.getByTestId('vanity-code-input')).toBeDefined();
    expect(screen.getByTestId('save-vanity-code-btn')).toBeDefined();
  });

  it('calls set_coach_code RPC when saving a custom vanity code', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const input = screen.getByTestId('vanity-code-input');
    fireEvent.change(input, { target: { value: 'COACH-TEST' } });

    const saveBtn = screen.getByTestId('save-vanity-code-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('set_coach_code', { custom_code: 'COACH-TEST' });
    });

    expect(
      within(await screen.findByTestId('coach-code-status')).getByText(
        'Coach code updated successfully!'
      )
    ).toBeDefined();
  });

  it('rejects vanity code shorter than 4 characters with client-side validation error', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const input = screen.getByTestId('vanity-code-input');
    fireEvent.change(input, { target: { value: 'ABC' } });

    const saveBtn = screen.getByTestId('save-vanity-code-btn');
    fireEvent.click(saveBtn);

    expect(
      within(await screen.findByTestId('coach-code-status')).getByText(
        /Code must be 4-20 characters long/
      )
    ).toBeDefined();
    expect(supabase.rpc).not.toHaveBeenCalledWith('set_coach_code', expect.anything());
  });

  it('accepts vanity code with underscores (e.g. COACH_DEMO) and calls set_coach_code RPC', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const input = screen.getByTestId('vanity-code-input');
    fireEvent.change(input, { target: { value: 'COACH_DEMO' } });

    const saveBtn = screen.getByTestId('save-vanity-code-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('set_coach_code', { custom_code: 'COACH_DEMO' });
    });

    expect(
      within(await screen.findByTestId('coach-code-status')).getByText(
        'Coach code updated successfully!'
      )
    ).toBeDefined();
  });

  it('displays free tier badge when coach_tier is not set', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'users') {
        const b = createSupabaseBuilder('users', {
          data: {
            id: 'test-coach-id',
            email: 'coach@yourbody.fyi',
            username: 'Coach Demo',
            role: 'coach',
            is_coach_mode: true,
            coach_code: 'YB-DEMO01',
            coach_tier: null,
            max_athletes: 3,
          },
          error: null,
        });
        b.upsert = mockUpsert;
        return b;
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    expect(screen.getByText('0 / 3 Athletes (Free)')).toBeDefined();
  });

  it('renders My Coach card and allows linking to a coach via link_to_coach RPC', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    expect(screen.getByText('My Coach')).toBeDefined();
    const linkInput = await screen.findByTestId('link-coach-code-input');
    fireEvent.change(linkInput, { target: { value: 'YB-DEMO01' } });

    const linkBtn = screen.getByTestId('link-coach-btn');
    fireEvent.click(linkBtn);

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('link_to_coach', { input_code: 'YB-DEMO01' });
    });

    expect(
      within(await screen.findByTestId('link-coach-status')).getByText(
        'Successfully linked to coach!'
      )
    ).toBeDefined();
  });

  it('allows disconnecting from coach via disconnect_coach RPC when linked', async () => {
    const linkedCoachData = [
      {
        id: 'link-1',
        coach_id: 'coach-lead',
        linked_at: '2026-09-01T00:00:00Z',
        coach: { username: 'Coach Sarah', email: 'sarah@yourbody.fyi', coach_code: 'SARAH-FIT' },
      },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'users') {
        const b = createSupabaseBuilder('users', {
          data: {
            id: 'test-coach-id',
            email: 'coach@yourbody.fyi',
            username: 'Coach Demo',
            role: 'coach',
            is_coach_mode: true,
            coach_code: 'YB-DEMO01',
            coach_tier: 'pro',
            max_athletes: 10,
            target_calories: 2400,
            target_protein: 180,
            target_carbs: 240,
            target_fat: 70,
            target_fiber: 35,
          },
          error: null,
        });
        b.upsert = mockUpsert;
        return b;
      }
      return createSupabaseBuilder(table, { data: linkedCoachData, error: null });
    });

    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    expect(await screen.findByText('Coach Sarah')).toBeDefined();
    expect(screen.getByText(/SARAH-FIT/)).toBeDefined();

    const disconnectBtn = screen.getByTestId('disconnect-coach-btn');
    fireEvent.click(disconnectBtn);

    const confirmBtn = await screen.findByTestId('disconnect-coach-confirm-dialog-confirm');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('disconnect_coach');
    });

    // StatusBanner renders the copy twice: once in the always-mounted sr-only
    // live region and once in the visible banner, so scope to the banner.
    expect(
      within(await screen.findByTestId('link-coach-status')).getByText(
        'Successfully disconnected from coach.'
      )
    ).toBeDefined();
  });

  it('renders auto-start rest timer toggle switch with an accessible name', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');
    expect(screen.getByRole('switch', { name: /auto-start rest timer/i })).toBeDefined();
  });

  it('renders email address as read-only text rather than a disabled input', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');
    expect(screen.queryByRole('textbox', { name: /email address/i })).toBeNull();
    expect(screen.queryByDisplayValue('coach@yourbody.fyi')).toBeNull();
    const emailEl = screen.getByText('coach@yourbody.fyi');
    expect(emailEl.tagName).toBe('DD');
  });

  it('associates label with Display Name input', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');
    const input = screen.getByLabelText(/Display Name/i);
    expect(input).toBeDefined();
    expect(input.getAttribute('value')).toBe('Coach Demo');
  });

  it('passes axe accessibility audits with no violations', async () => {
    const { container } = renderComponent();
    await screen.findByDisplayValue('Coach Demo');
    await expectNoA11yViolations(container);
  });

  it('renders DataExportCard collapsed by default and expands when clicking Configure Export', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    expect(screen.getByText('Data Extract')).toBeDefined();
    expect(
      screen.getByText('Download your workouts, nutrition logs, routines, or full backup.')
    ).toBeDefined();

    const toggleBtn = screen.getByTestId('toggle-data-export-btn');
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('download-export-btn')).toBeNull();

    fireEvent.click(toggleBtn);

    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('download-export-btn')).toBeDefined();
    expect(screen.getByTestId('export-format-json')).toBeDefined();
    expect(screen.getByTestId('export-format-csv')).toBeDefined();
  });

  it('renders WeightUnitCard with Weight unit heading and options', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');
    expect(screen.getByRole('heading', { name: 'Weight unit' })).toBeDefined();
    expect(
      screen.getByText('Weights are stored in pounds; this changes how they are shown and entered.')
    ).toBeDefined();
    expect(screen.getByTestId('weight-unit-lb')).toBeDefined();
    expect(screen.getByTestId('weight-unit-kg')).toBeDefined();
  });

  it('disables auto rest timer toggle switch and renders helper text when offline', async () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);

    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const toggleBtn = screen.getByTestId('toggle-auto-timer');
    expect(toggleBtn).toBeDisabled();
    expect(toggleBtn.getAttribute('title')).toBe('Available when online');
    expect(screen.getAllByTestId('offline-helper-text').some(el => el.textContent === 'Available when online')).toBe(true);

    const initialChecked = toggleBtn.getAttribute('aria-checked');
    fireEvent.click(toggleBtn);
    expect(toggleBtn.getAttribute('aria-checked')).toBe(initialChecked);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  describe('paywall_enabled feature flag gating', () => {
    it('flag off: does not render Subscription card', async () => {
      renderComponent();
      await screen.findByDisplayValue('Coach Demo');

      expect(screen.queryByTestId('subscription-card')).toBeNull();
    });

    it('flag on: renders Subscription card after Profile & Mode', async () => {
      const useFeatureFlagModule = await import('../../hooks/useFeatureFlag');
      vi.spyOn(useFeatureFlagModule, 'useFeatureFlag').mockImplementation((key) => {
        if (key === 'paywall_enabled') return true;
        return false;
      });

      renderComponent();
      await screen.findByDisplayValue('Coach Demo');

      const card = await screen.findByTestId('subscription-card');
      expect(card).toBeDefined();
    });
  });
});

