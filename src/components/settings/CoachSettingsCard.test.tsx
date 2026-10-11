import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CoachSettingsCard } from './CoachSettingsCard';
import { expectNoA11yViolations } from '../../test/a11y';
import type { UserProfile } from '../../types/database';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, clearMockHistory, getRecordedTables, getRecordedSelects } from '../../test/supabaseBuilderMock';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import * as entitlementModule from '../../hooks/useEntitlement';

vi.mock('../../hooks/useOnlineStatus');

vi.mock('../../hooks/useEntitlement', () => ({
  useEntitlement: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => createSupabaseBuilder(table, { data: [], error: null })),
    rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
  },
}));

describe('CoachSettingsCard accessibility', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    vi.mocked(useOnlineStatus).mockReturnValue(true);
    vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
      plan: 'pro',
      isPro: true,
      isPaid: true,
      trialEndsAt: null,
      paidUntil: '2028-01-01T00:00:00Z',
      isLoading: false,
    });
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const mockProfile: UserProfile = {
    id: 'coach-123',
    email: 'coach@test.com',
    username: 'Coach Test',
    role: 'coach',
    is_coach_mode: true,
    coach_code: 'TEST-CODE',
    coach_tier: 'pro',
    max_athletes: 10,
    target_calories: 2000,
    target_protein: 150,
    target_carbs: 200,
    target_fat: 65,
    target_fiber: 30,
    created_at: new Date().toISOString(),
  };

  const renderCard = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <CoachSettingsCard
          profile={mockProfile}
          hasCoachCapability={true}
        />
      </QueryClientProvider>
    );

  it('associates label with Custom Vanity Code input', () => {
    renderCard();
    const input = screen.getByLabelText(/custom vanity code/i);
    expect(input).toBeDefined();
    expect(input.getAttribute('data-testid')).toBe('vanity-code-input');
  });

  it('passes axe accessibility audits with no violations', async () => {
    const { container } = renderCard();
    await expectNoA11yViolations(container);
  });

  it('mounts live regions while idle and mutates in place on vanity code status (hasCoachCapability=true) (WCAG SC 4.1.3)', async () => {
    const { container } = renderCard();

    const polite = container.querySelector('[role="status"]');
    const assertive = container.querySelector('[role="alert"]');

    expect(polite).not.toBeNull();
    expect(assertive).not.toBeNull();
    expect(polite!.textContent).toBe('');
    expect(assertive!.textContent).toBe('');
    expect(screen.queryByTestId('coach-code-status')).toBeNull();

    // Trigger validation error by typing 2-char code
    const input = screen.getByTestId('vanity-code-input');
    const form = input.closest('form')!;

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { value: 'AB' } });
    fireEvent.submit(form);

    expect(container.querySelector('[role="status"]')).toBe(polite);
    expect(container.querySelector('[role="alert"]')).toBe(assertive);
    expect(assertive!.textContent).toContain('Code must be 4-20 characters long');
    expect(polite!.textContent).toBe('');

    const statusBanner = screen.getByTestId('coach-code-status');
    expect(statusBanner.textContent).toContain('Code must be 4-20 characters long');
  });

  it('mounts live regions while idle and mutates in place when unactivated (hasCoachCapability=false) (WCAG SC 4.1.3)', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <CoachSettingsCard
          profile={mockProfile}
          hasCoachCapability={false}
        />
      </QueryClientProvider>
    );

    const polite = container.querySelector('[role="status"]');
    const assertive = container.querySelector('[role="alert"]');

    expect(polite).not.toBeNull();
    expect(assertive).not.toBeNull();
    expect(polite!.textContent).toBe('');
    expect(assertive!.textContent).toBe('');

    const input = container.querySelector('input[type="text"]')!;
    const form = input.closest('form')!;

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { value: 'AB' } });
    fireEvent.submit(form);

    expect(container.querySelector('[role="status"]')).toBe(polite);
    expect(container.querySelector('[role="alert"]')).toBe(assertive);
    expect(assertive!.textContent).toContain('Code must be 4-20 characters long');
  });

  it('queries coach athlete links with exact projection when coach capability is active', async () => {
    renderCard();
    expect(getRecordedTables()).toContain('coach_athlete_links');
    expect(getRecordedSelects()).toContainEqual({
      table: 'coach_athlete_links',
      projection: 'id',
    });
  });

  it('surfaces error banner with Retry when athlete count query fails', async () => {
    let shouldFail = true;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'coach_athlete_links') {
        if (shouldFail) {
          return createSupabaseBuilder('coach_athlete_links', {
            data: null,
            error: new Error('Failed to load roster count'),
          });
        }
        return createSupabaseBuilder('coach_athlete_links', {
          data: [{ id: 'link-1' }, { id: 'link-2' }],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CoachSettingsCard profile={mockProfile} hasCoachCapability={true} />
      </QueryClientProvider>
    );

    const errorBanner = await screen.findByTestId('coach-roster-error');
    expect(errorBanner.textContent).toContain('Failed to load roster count');

    const retryBtn = screen.getByTestId('coach-roster-retry-btn');
    expect(retryBtn).toBeDefined();

    shouldFail = false;
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('coach-roster-error')).toBeNull();
    });
  });

  it('disables vanity code input and button and shows "Available when online" helper text when offline', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);

    renderCard();

    expect(screen.getByTestId('offline-helper-text').textContent).toBe('Available when online');

    const input = screen.getByTestId('vanity-code-input');
    const saveBtn = screen.getByTestId('save-vanity-code-btn');

    expect(input).toBeDisabled();
    expect(input.getAttribute('title')).toBe('Available when online');
    expect(saveBtn).toBeDisabled();
    expect(saveBtn.getAttribute('title')).toBe('Available when online');
  });

  describe('effective athlete limits and tier labels', () => {
    it('renders 10 limit and Coach tier label for pro coach', () => {
      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'pro',
        isPro: true,
        isPaid: true,
        trialEndsAt: null,
        paidUntil: '2028-01-01T00:00:00Z',
        isLoading: false,
      });

      renderCard();

      const badge = screen.getByTestId('coach-capacity-badge');
      expect(badge.textContent).toContain('0 / 10 Athletes (Coach)');
    });

    it('renders 25 limit and Coach Pro tier label for enterprise coach', () => {
      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'pro',
        isPro: true,
        isPaid: true,
        trialEndsAt: null,
        paidUntil: '2028-01-01T00:00:00Z',
        isLoading: false,
      });

      render(
        <QueryClientProvider client={queryClient}>
          <CoachSettingsCard
            profile={{ ...mockProfile, coach_tier: 'enterprise' }}
            hasCoachCapability={true}
          />
        </QueryClientProvider>
      );

      const badge = screen.getByTestId('coach-capacity-badge');
      expect(badge.textContent).toContain('0 / 25 Athletes (Coach Pro)');
    });

    it('renders 3 limit and Free tier label for free tier coach', () => {
      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'free',
        isPro: false,
        isPaid: false,
        trialEndsAt: null,
        paidUntil: null,
        isLoading: false,
      });

      render(
        <QueryClientProvider client={queryClient}>
          <CoachSettingsCard
            profile={{ ...mockProfile, coach_tier: 'free' }}
            hasCoachCapability={true}
          />
        </QueryClientProvider>
      );

      const badge = screen.getByTestId('coach-capacity-badge');
      expect(badge.textContent).toContain('0 / 3 Athletes (Free)');
    });

    it('renders 3 limit and Free tier label for lapsed coach even if coach_tier was pro', () => {
      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'free',
        isPro: false,
        isPaid: false,
        trialEndsAt: null,
        paidUntil: '2020-01-01T00:00:00Z',
        isLoading: false,
      });

      render(
        <QueryClientProvider client={queryClient}>
          <CoachSettingsCard
            profile={{ ...mockProfile, coach_tier: 'pro' }}
            hasCoachCapability={true}
          />
        </QueryClientProvider>
      );

      const badge = screen.getByTestId('coach-capacity-badge');
      expect(badge.textContent).toContain('0 / 3 Athletes (Free)');
    });
  });
});
