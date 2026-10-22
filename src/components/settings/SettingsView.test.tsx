import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsView } from './SettingsView';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import { AuthContext, type AuthContextType } from '../../context/AuthContextTypes';
import type { UserProfile } from '../../types/database';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../../test/supabaseBuilderMock';
import { expectNoA11yViolations } from '../../test/a11y';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { EXTERNAL_CHAT_NUTRITION_PROMPT } from '../../lib/nutrition/externalPrompt';

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
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: { status: 403 } }) },
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
    expect(screen.getByText('Calories')).toBeDefined();
    expect(screen.getByText('Protein')).toBeDefined();
    expect(screen.getByText('Carbs')).toBeDefined();
    expect(screen.getByText('Fat')).toBeDefined();
    expect(screen.getByText('Fiber')).toBeDefined();
    expect(screen.getByText('kcal')).toBeDefined();
    expect(screen.getAllByText('g')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Save Goals/i })).toBeDefined();

    expect(getRecordedTables()).toContain('users');
    expect(getRecordedSelects()).toContainEqual({
      table: 'users',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, rest_timer_seconds, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
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

  it('allows clearing and retyping macro goals without snapping to 0 or producing leading zero', async () => {
    const user = userEvent.setup();
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const caloriesInput = screen.getByLabelText(/calories/i) as HTMLInputElement;
    expect(caloriesInput.value).toBe('2400');

    await user.clear(caloriesInput);
    expect(caloriesInput.value).toBe('');

    await user.type(caloriesInput, '2500');
    expect(caloriesInput.value).toBe('2500');

    const proteinInput = screen.getByLabelText(/protein/i) as HTMLInputElement;
    expect(proteinInput.value).toBe('180');

    await user.clear(proteinInput);
    expect(proteinInput.value).toBe('');

    await user.type(proteinInput, '5');
    expect(proteinInput.value).toBe('5');

    const saveBtn = screen.getByRole('button', { name: /Save Goals/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          target_calories: 2500,
          target_protein: 5,
        })
      );
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

  it('renders rest timer length select with default 90 s and all 10 duration choices', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    expect(screen.getByText('Rest timer length')).toBeDefined();
    const select = screen.getByTestId('select-rest-duration') as HTMLSelectElement;
    expect(select).toBeDefined();
    expect(select.value).toBe('90');

    const options = Array.from(select.options).map((opt) => ({
      value: Number(opt.value),
      label: opt.text,
    }));
    expect(options).toEqual([
      { value: 30, label: '30 s' },
      { value: 45, label: '45 s' },
      { value: 60, label: '60 s' },
      { value: 75, label: '75 s' },
      { value: 90, label: '90 s' },
      { value: 120, label: '2 min' },
      { value: 150, label: '2 min 30 s' },
      { value: 180, label: '3 min' },
      { value: 240, label: '4 min' },
      { value: 300, label: '5 min' },
    ]);
  });

  it('allows changing rest timer length preference and persists to localStorage and profile', async () => {
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const select = screen.getByTestId('select-rest-duration') as HTMLSelectElement;
    expect(select.value).toBe('90');

    // Change to 120 (2 min)
    fireEvent.change(select, { target: { value: '120' } });

    await waitFor(() => {
      expect(select.value).toBe('120');
      expect(localStorage.getItem('yourbody_rest_timer_seconds')).toBe('120');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          rest_timer_seconds: 120,
        })
      );
    });
  });

  it('falls back to localStorage or default 90 when profile lacks rest_timer_seconds', async () => {
    // 1. With localStorage value
    localStorage.setItem('yourbody_rest_timer_seconds', '180');
    const { unmount } = renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const selectWithStorage = screen.getByTestId('select-rest-duration') as HTMLSelectElement;
    expect(selectWithStorage.value).toBe('180');

    unmount();
    localStorage.removeItem('yourbody_rest_timer_seconds');

    // 2. Without localStorage value
    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const selectDefault = screen.getByTestId('select-rest-duration') as HTMLSelectElement;
    expect(selectDefault.value).toBe('90');
  });

  it('disables rest timer length select when offline', async () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);

    renderComponent();
    await screen.findByDisplayValue('Coach Demo');

    const select = screen.getByTestId('select-rest-duration') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.getAttribute('title')).toBe('Available when online');
    expect(screen.getByTestId('offline-helper-text-rest-duration').textContent).toBe('Available when online');
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
    await screen.findByTestId('coach-capacity-badge');
    await screen.findByTestId('toggle-auto-timer');
    await screen.findByRole('heading', { name: 'Account' });
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

  describe('owner_dashboard_enabled feature flag gating', () => {
    it('flag off: does not render Owner Dashboard card', async () => {
      renderComponent();
      await screen.findByDisplayValue('Coach Demo');

      expect(screen.queryByTestId('owner-dashboard-card')).toBeNull();
    });

    it('flag on: renders Owner Dashboard card', async () => {
      (supabase.functions.invoke as any).mockResolvedValueOnce({
        data: {
          generated_at: '2026-10-11T12:00:00Z',
          tiers: {
            personal: { paying: 1, grandfathered: 0, unpaid: 0, total: 1 },
            coach: { paying: 1, grandfathered: 0, unpaid: 0, total: 1 },
            coach_pro: { paying: 1, grandfathered: 0, unpaid: 0, total: 1 },
            trial: { paying: 0, grandfathered: 0, unpaid: 1, total: 1 },
            free: { paying: 0, grandfathered: 0, unpaid: 1, total: 1 },
          },
          ai_today: { total_uses: 5, distinct_users: 2, by_plan: [] },
        },
        error: null,
      });

      const useFeatureFlagModule = await import('../../hooks/useFeatureFlag');
      vi.spyOn(useFeatureFlagModule, 'useFeatureFlag').mockImplementation((key) => {
        if (key === 'owner_dashboard_enabled') return true;
        return false;
      });

      renderComponent();
      await screen.findByDisplayValue('Coach Demo');

      const card = await screen.findByTestId('owner-dashboard-card');
      expect(card).toBeDefined();
    });

    it('flag on but 403 non-owner: Owner Dashboard card renders nothing', async () => {
      (supabase.functions.invoke as any).mockResolvedValueOnce({
        data: null,
        error: { status: 403, message: 'Forbidden' },
      });

      const useFeatureFlagModule = await import('../../hooks/useFeatureFlag');
      vi.spyOn(useFeatureFlagModule, 'useFeatureFlag').mockImplementation((key) => {
        if (key === 'owner_dashboard_enabled') return true;
        return false;
      });

      renderComponent();
      await screen.findByDisplayValue('Coach Demo');

      await waitFor(() => {
        expect(screen.queryByTestId('owner-dashboard-card')).toBeNull();
      });
    });
  });

  describe('NutritionParserModeCard', () => {
    it('renders Nutrition parsing heading, helper text, and mode options', async () => {
      renderComponent();
      await screen.findByDisplayValue('Coach Demo');

      expect(screen.getByRole('heading', { name: 'Nutrition parsing' })).toBeDefined();
      expect(
        screen.getByText('Choose how meals and foods are parsed from text.')
      ).toBeDefined();

      const autoTab = screen.getByTestId('nutrition-parser-mode-auto');
      const alwaysAiTab = screen.getByTestId('nutrition-parser-mode-always-ai');
      const onDeviceTab = screen.getByTestId('nutrition-parser-mode-on-device');

      expect(autoTab).toBeDefined();
      expect(alwaysAiTab).toBeDefined();
      expect(onDeviceTab).toBeDefined();
      expect(autoTab).toHaveAttribute('aria-selected', 'true');
      expect(alwaysAiTab).toHaveAttribute('aria-selected', 'false');
      expect(onDeviceTab).toHaveAttribute('aria-selected', 'false');
    });

    it('allows switching to Always AI and On-device only, persisting to localStorage', async () => {
      renderComponent();
      await screen.findByDisplayValue('Coach Demo');

      const autoTab = screen.getByTestId('nutrition-parser-mode-auto');
      const alwaysAiTab = screen.getByTestId('nutrition-parser-mode-always-ai');
      const onDeviceTab = screen.getByTestId('nutrition-parser-mode-on-device');

      // Click Always AI
      fireEvent.click(alwaysAiTab);
      await waitFor(() => {
        expect(alwaysAiTab).toHaveAttribute('aria-selected', 'true');
        expect(autoTab).toHaveAttribute('aria-selected', 'false');
        expect(localStorage.getItem('yourbody_nutrition_parser_mode')).toBe('always_ai');
      });

      // Click On-device only
      fireEvent.click(onDeviceTab);
      await waitFor(() => {
        expect(onDeviceTab).toHaveAttribute('aria-selected', 'true');
        expect(alwaysAiTab).toHaveAttribute('aria-selected', 'false');
        expect(localStorage.getItem('yourbody_nutrition_parser_mode')).toBe('on_device');
      });

      // Click Auto
      fireEvent.click(autoTab);
      await waitFor(() => {
        expect(autoTab).toHaveAttribute('aria-selected', 'true');
        expect(onDeviceTab).toHaveAttribute('aria-selected', 'false');
        expect(localStorage.getItem('yourbody_nutrition_parser_mode')).toBe('auto');
      });
    });

    it('initializes active tab from pre-existing localStorage value', async () => {
      localStorage.setItem('yourbody_nutrition_parser_mode', 'always_ai');

      renderComponent();
      await screen.findByDisplayValue('Coach Demo');

      const alwaysAiTab = screen.getByTestId('nutrition-parser-mode-always-ai');
      expect(alwaysAiTab).toHaveAttribute('aria-selected', 'true');
    });

    it('renders the external prompt toggle collapsed by default and expands on click', async () => {
      renderComponent();
      await screen.findByDisplayValue('Coach Demo');

      const toggleBtn = screen.getByTestId('external-prompt-toggle');
      expect(toggleBtn).toBeDefined();
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('external-prompt-preview')).toBeNull();

      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

      const preview = screen.getByTestId('external-prompt-preview') as HTMLTextAreaElement;
      expect(preview).toBeDefined();
      expect(preview.value).toBe(EXTERNAL_CHAT_NUTRITION_PROMPT);
      expect(preview.readOnly).toBe(true);

      const copyBtn = screen.getByTestId('copy-external-prompt-button');
      expect(copyBtn).toBeDefined();
      expect(within(copyBtn).getByText('Copy prompt')).toBeDefined();

      // Click to collapse again
      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('external-prompt-preview')).toBeNull();
    });

    it('copies the external prompt to clipboard and updates button state', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });

      renderComponent();
      await screen.findByDisplayValue('Coach Demo');

      const toggleBtn = screen.getByTestId('external-prompt-toggle');
      fireEvent.click(toggleBtn);

      const copyBtn = screen.getByTestId('copy-external-prompt-button');
      fireEvent.click(copyBtn);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith(EXTERNAL_CHAT_NUTRITION_PROMPT);
        expect(within(copyBtn).getByText('Copied')).toBeDefined();
      });
    });

    it('handles clipboard write failure by selecting text and showing error status', async () => {
      const writeTextMock = vi.fn().mockRejectedValue(new Error('Permission denied'));
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });
      const selectSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'select');

      renderComponent();
      await screen.findByDisplayValue('Coach Demo');

      const toggleBtn = screen.getByTestId('external-prompt-toggle');
      fireEvent.click(toggleBtn);

      const copyBtn = screen.getByTestId('copy-external-prompt-button');
      fireEvent.click(copyBtn);

      await waitFor(() => {
        expect(selectSpy).toHaveBeenCalled();
        expect(screen.getByTestId('copy-prompt-error')).toBeDefined();
      });
    });
  });

  describe('profile refetch resync', () => {
    const baseMockProfile: UserProfile = {
      id: 'test-user-id',
      email: 'athlete@yourbody.fyi',
      username: 'Initial Athlete',
      role: 'athlete',
      target_calories: 2200,
      target_protein: 160,
      target_carbs: 220,
      target_fat: 70,
      target_fiber: 30,
      auto_rest_timer: true,
      rest_timer_seconds: 90,
      created_at: '2026-01-01T00:00:00Z',
      timezone: 'UTC',
      weight_unit: 'lb',
      pr_mode: 'weight',
    };

    const createMockAuth = (
      profileOverrides: Partial<UserProfile> = {},
      authOverrides: Partial<AuthContextType> = {}
    ): AuthContextType => ({
      user: { id: 'test-user-id', email: 'athlete@yourbody.fyi' } as any,
      profile: { ...baseMockProfile, ...profileOverrides },
      role: 'athlete',
      viewMode: 'athlete',
      isCoachMode: false,
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      updateProfile: vi.fn().mockResolvedValue({ success: true }),
      switchRole: vi.fn(),
      refreshProfile: vi.fn(),
      resendConfirmation: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
      ...authOverrides,
    });

    it('resyncs rest timer length and sends refetched value on save when profile updates', async () => {
      const updateProfileMock = vi.fn().mockResolvedValue({ success: true });
      const initialAuth = createMockAuth(
        { rest_timer_seconds: 90, auto_rest_timer: true, username: 'Initial Athlete' },
        { updateProfile: updateProfileMock }
      );

      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthContext.Provider value={initialAuth}>
              <ToastProvider>
                <SettingsView />
                <ToastHost />
              </ToastProvider>
            </AuthContext.Provider>
          </BrowserRouter>
        </QueryClientProvider>
      );

      const select = screen.getByTestId('select-rest-duration') as HTMLSelectElement;
      expect(select.value).toBe('90');

      // Simulate profile refetch from another device with rest_timer_seconds changed to 180
      const refetchedAuth = createMockAuth(
        { rest_timer_seconds: 180, auto_rest_timer: false, username: 'Updated Athlete' },
        { updateProfile: updateProfileMock }
      );

      rerender(
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthContext.Provider value={refetchedAuth}>
              <ToastProvider>
                <SettingsView />
                <ToastHost />
              </ToastProvider>
            </AuthContext.Provider>
          </BrowserRouter>
        </QueryClientProvider>
      );

      expect((screen.getByTestId('select-rest-duration') as HTMLSelectElement).value).toBe('180');
      expect(screen.getByTestId('toggle-auto-timer')).toHaveAttribute('aria-checked', 'false');
      expect((screen.getByLabelText(/Display Name/i) as HTMLInputElement).value).toBe('Updated Athlete');

      const saveBtn = screen.getByRole('button', { name: /Save Goals/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(updateProfileMock).toHaveBeenCalledWith(
          expect.objectContaining({
            rest_timer_seconds: 180,
            auto_rest_timer: false,
            username: 'Updated Athlete',
          })
        );
      });
    });
  });
});

