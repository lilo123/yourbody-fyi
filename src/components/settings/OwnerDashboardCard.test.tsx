import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OwnerDashboardCard } from './OwnerDashboardCard';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { fetchOwnerStats } from '../../lib/ownerStats';
import { expectNoA11yViolations } from '../../test/a11y';

vi.mock('../../hooks/useFeatureFlag');
vi.mock('../../lib/ownerStats');

const MOCK_STATS_DATA = {
  generated_at: '2026-10-11T14:00:00Z',
  tiers: {
    personal: { paying: 12, grandfathered: 1, unpaid: 0, total: 13 },
    coach: { paying: 4, grandfathered: 2, unpaid: 0, total: 6 },
    coach_pro: { paying: 2, grandfathered: 0, unpaid: 0, total: 2 },
    trial: { paying: 0, grandfathered: 0, unpaid: 8, total: 8 },
    free: { paying: 0, grandfathered: 0, unpaid: 25, total: 25 },
  },
  ai_today: {
    total_uses: 50,
    distinct_users: 10,
    by_plan: [
      { plan: 'pro', uses: 30 },
      { plan: 'trial', uses: 20 },
    ],
  },
};

describe('OwnerDashboardCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when feature flag owner_dashboard_enabled is false', () => {
    vi.mocked(useFeatureFlag).mockReturnValue(false);
    const { container } = render(<OwnerDashboardCard />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('owner-dashboard-card')).toBeNull();
  });

  it('renders nothing when edge function returns 403 (forbidden/not owner)', async () => {
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    vi.mocked(fetchOwnerStats).mockResolvedValue({
      data: null,
      isForbidden: true,
      error: new Error('Forbidden: Not an owner'),
    });

    const { container } = render(<OwnerDashboardCard />);

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    expect(screen.queryByTestId('owner-dashboard-card')).toBeNull();
  });

  it('renders numbers and data when edge function returns 200 with stats', async () => {
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    vi.mocked(fetchOwnerStats).mockResolvedValue({
      data: MOCK_STATS_DATA,
      isForbidden: false,
      error: null,
    });

    render(<OwnerDashboardCard />);

    await screen.findByTestId('owner-dashboard-card');
    expect(screen.getByText('Owner Dashboard')).toBeDefined();
    expect(screen.getByText('Paying Users by Tier')).toBeDefined();
    expect(screen.getByText('AI Usage Today (UTC)')).toBeDefined();

    // Check tier numbers
    expect(screen.getByText('Personal')).toBeDefined();
    expect(screen.getByText('Coach')).toBeDefined();
    expect(screen.getByText('Coach Pro')).toBeDefined();
    expect(screen.getByText('Trial Users')).toBeDefined();
    expect(screen.getByText('Free Accounts')).toBeDefined();

    // Check AI stats
    expect(screen.getByText('50')).toBeDefined();
    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('pro')).toBeDefined();
    expect(screen.getByText('30')).toBeDefined();
  });

  it('renders error state on non-403 failure', async () => {
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    vi.mocked(fetchOwnerStats).mockResolvedValue({
      data: null,
      isForbidden: false,
      error: new Error('Server connection error'),
    });

    render(<OwnerDashboardCard />);

    await screen.findByTestId('owner-dashboard-card');
    const errorEl = await screen.findByTestId('owner-dashboard-error');
    expect(errorEl.textContent).toContain('Server connection error');
  });

  it('passes axe accessibility audits with no violations', async () => {
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    vi.mocked(fetchOwnerStats).mockResolvedValue({
      data: MOCK_STATS_DATA,
      isForbidden: false,
      error: null,
    });

    const { container } = render(<OwnerDashboardCard />);
    await screen.findByTestId('owner-dashboard-card');
    await expectNoA11yViolations(container);
  });
});
