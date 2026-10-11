import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SubscriptionCard } from './SubscriptionCard';
import * as entitlementModule from '../../hooks/useEntitlement';
import * as authModule from '../../hooks/useAuth';
import * as billingModule from '../../lib/billing';
import { supabase } from '../../lib/supabase';

const mockToastShow = vi.fn();
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({
    show: mockToastShow,
  }),
}));

vi.mock('../../hooks/useEntitlement', () => ({
  useEntitlement: vi.fn(),
  getEntitlementQueryKey: (userId: string | null | undefined) => ['entitlement', userId ?? null] as const,
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../lib/billing', () => ({
  openBillingPortal: vi.fn(),
  startCheckout: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

describe('SubscriptionCard component', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.mocked(authModule.useAuth).mockReturnValue({
      user: { id: 'test-user-id', email: 'test@example.com' } as any,
      profile: { coach_tier: 'pro' } as any,
      role: 'coach',
      isCoachMode: true,
      loading: false,
      updateProfile: vi.fn(),
      switchRole: vi.fn(),
      refreshProfile: vi.fn(),
      signOut: vi.fn(),
    } as any);
  });

  const renderCard = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <SubscriptionCard />
      </QueryClientProvider>
    );

  describe('badge variants and coach limits', () => {
    it('renders "Coach" badge variant and athlete limit 10 for pro coach', () => {
      vi.mocked(authModule.useAuth).mockReturnValue({
        user: { id: 'test-user-id', email: 'test@example.com' } as any,
        profile: { coach_tier: 'pro' } as any,
        role: 'coach',
        isCoachMode: true,
        loading: false,
        updateProfile: vi.fn(),
        switchRole: vi.fn(),
        refreshProfile: vi.fn(),
        signOut: vi.fn(),
      } as any);

      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'pro',
        isPro: true,
        isPaid: true,
        trialEndsAt: null,
        paidUntil: '2027-10-10T00:00:00Z',
        isLoading: false,
      });

      renderCard();

      const badge = screen.getByTestId('subscription-plan-badge');
      expect(badge.textContent).toBe('Coach');
      expect(screen.queryByTestId('subscription-upgrade-btn')).toBeNull();
      expect(screen.getByTestId('subscription-manage-billing-btn')).toBeDefined();
      expect(screen.getByTestId('subscription-active-until')).toBeDefined();
      expect(screen.getByTestId('subscription-athletes-count').textContent).toBe('0 / 10 athletes');
    });

    it('renders "Coach Pro" badge variant and athlete limit 25 for enterprise coach', () => {
      vi.mocked(authModule.useAuth).mockReturnValue({
        user: { id: 'test-user-id', email: 'test@example.com' } as any,
        profile: { coach_tier: 'enterprise' } as any,
        role: 'coach',
        isCoachMode: true,
        loading: false,
        updateProfile: vi.fn(),
        switchRole: vi.fn(),
        refreshProfile: vi.fn(),
        signOut: vi.fn(),
      } as any);

      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'pro',
        isPro: true,
        isPaid: true,
        trialEndsAt: null,
        paidUntil: '2027-10-10T00:00:00Z',
        isLoading: false,
      });

      renderCard();

      const badge = screen.getByTestId('subscription-plan-badge');
      expect(badge.textContent).toBe('Coach Pro');
      expect(screen.queryByTestId('subscription-upgrade-btn')).toBeNull();
      expect(screen.getByTestId('subscription-manage-billing-btn')).toBeDefined();
      expect(screen.getByTestId('subscription-active-until')).toBeDefined();
      expect(screen.getByTestId('subscription-athletes-count').textContent).toBe('0 / 25 athletes');
    });

    it('renders athlete count and limit returned from my_coach_limits RPC', async () => {
      vi.mocked(authModule.useAuth).mockReturnValue({
        user: { id: 'test-user-id', email: 'test@example.com' } as any,
        profile: { coach_tier: 'pro' } as any,
        role: 'coach',
        isCoachMode: true,
        loading: false,
        updateProfile: vi.fn(),
        switchRole: vi.fn(),
        refreshProfile: vi.fn(),
        signOut: vi.fn(),
      } as any);

      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'pro',
        isPro: true,
        isPaid: true,
        trialEndsAt: null,
        paidUntil: '2027-10-10T00:00:00Z',
        isLoading: false,
      });

      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [{ athlete_count: 7, athlete_limit: 10 }],
        error: null,
      } as any);

      renderCard();

      await waitFor(() => {
        expect(screen.getByTestId('subscription-athletes-count').textContent).toBe('7 / 10 athletes');
      });
    });

    it('renders "Personal" badge variant for basic paid subscriber', () => {
      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'basic',
        isPro: false,
        isPaid: true,
        trialEndsAt: null,
        paidUntil: '2027-10-10T00:00:00Z',
        isLoading: false,
      });

      renderCard();

      const badge = screen.getByTestId('subscription-plan-badge');
      expect(badge.textContent).toBe('Personal');
      expect(screen.getByTestId('subscription-upgrade-btn')).toBeDefined();
      expect(screen.getByTestId('subscription-manage-billing-btn')).toBeDefined();
      expect(screen.queryByTestId('subscription-athletes-count')).toBeNull();
    });

    it('renders "Trial" badge variant when not paid and trialEndsAt is in future', () => {
      const futureTrial = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'trial',
        isPro: false,
        isPaid: false,
        trialEndsAt: futureTrial,
        paidUntil: null,
        isLoading: false,
      });

      renderCard();

      const badge = screen.getByTestId('subscription-plan-badge');
      expect(badge.textContent).toBe('Trial');
      expect(screen.getByTestId('subscription-upgrade-btn')).toBeDefined();
      expect(screen.queryByTestId('subscription-manage-billing-btn')).toBeNull();
      expect(screen.queryByTestId('subscription-active-until')).toBeNull();
      expect(screen.queryByTestId('subscription-athletes-count')).toBeNull();
    });

    it('renders "Free" badge variant when expired or free plan', () => {
      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'free',
        isPro: false,
        isPaid: false,
        trialEndsAt: null,
        paidUntil: null,
        isLoading: false,
      });

      renderCard();

      const badge = screen.getByTestId('subscription-plan-badge');
      expect(badge.textContent).toBe('Free');
      expect(screen.getByTestId('subscription-upgrade-btn')).toBeDefined();
      expect(screen.queryByTestId('subscription-manage-billing-btn')).toBeNull();
      expect(screen.queryByTestId('subscription-athletes-count')).toBeNull();
    });
  });

  describe('manage billing actions', () => {
    it('calls openBillingPortal when "Manage billing" button is clicked', async () => {
      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'pro',
        isPro: true,
        isPaid: true,
        trialEndsAt: null,
        paidUntil: '2027-10-10T00:00:00Z',
        isLoading: false,
      });

      vi.mocked(billingModule.openBillingPortal).mockResolvedValueOnce({
        ok: true,
        success: true,
        url: 'https://billing.stripe.test/portal',
      });

      renderCard();

      const manageBtn = screen.getByTestId('subscription-manage-billing-btn');
      fireEvent.click(manageBtn);

      expect(billingModule.openBillingPortal).toHaveBeenCalledTimes(1);
    });

    it('displays error banner if openBillingPortal returns 503 billing_not_configured', async () => {
      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'pro',
        isPro: true,
        isPaid: true,
        trialEndsAt: null,
        paidUntil: '2027-10-10T00:00:00Z',
        isLoading: false,
      });

      vi.mocked(billingModule.openBillingPortal).mockResolvedValueOnce({
        ok: false,
        success: false,
        error: "Billing isn't available yet.",
      });

      renderCard();

      const manageBtn = screen.getByTestId('subscription-manage-billing-btn');
      fireEvent.click(manageBtn);

      await waitFor(() => {
        expect(screen.getByTestId('subscription-error-banner')).toHaveTextContent(
          "Billing isn't available yet."
        );
      });
    });
  });

  describe('return url handling', () => {
    it('handles billing=success, emits success toast, invalidates entitlement query and strips search param', async () => {
      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'pro',
        isPro: true,
        isPaid: true,
        trialEndsAt: null,
        paidUntil: '2027-10-10T00:00:00Z',
        isLoading: false,
      });

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

      delete (window as any).location;
      window.location = {
        pathname: '/settings',
        search: '?billing=success',
        hash: '',
      } as any;

      renderCard();

      expect(mockToastShow).toHaveBeenCalledWith({
        message: 'Subscription updated successfully!',
        kind: 'success',
      });
      expect(screen.queryByTestId('billing-status-banner')).toBeNull();
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['entitlement', 'test-user-id'],
      });
      expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/settings');
    });

    it('handles billing=cancelled, shows cancellation message and strips search param', () => {
      vi.mocked(entitlementModule.useEntitlement).mockReturnValue({
        plan: 'free',
        isPro: false,
        isPaid: false,
        trialEndsAt: null,
        paidUntil: null,
        isLoading: false,
      });

      const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

      delete (window as any).location;
      window.location = {
        pathname: '/settings',
        search: '?billing=cancelled',
        hash: '',
      } as any;

      renderCard();

      expect(screen.getByTestId('billing-status-banner')).toHaveTextContent(
        'Checkout was cancelled.'
      );
      expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/settings');
    });
  });
});
