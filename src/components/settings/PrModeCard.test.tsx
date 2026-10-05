import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PrModeCard } from './PrModeCard';
import { useAuth } from '../../hooks/useAuth';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { supabase } from '../../lib/supabase';
import { expectNoA11yViolations } from '../../test/a11y';
import type { UserProfile } from '../../types/database';

vi.mock('../../hooks/useAuth');
vi.mock('../../hooks/useOnlineStatus');

describe('PrModeCard', () => {
  const userId = 'athlete-user-123';
  let mockProfile: UserProfile;
  let mockRefreshProfile: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(useOnlineStatus).mockReturnValue(true);
    mockProfile = {
      id: userId,
      email: 'athlete@yourbody.fyi',
      username: 'CyberAthlete',
      role: 'athlete',
      pr_mode: 'weight',
    } as UserProfile;

    mockRefreshProfile = vi.fn().mockImplementation(async () => {});

    vi.mocked(useAuth).mockImplementation(() => ({
      user: { id: userId } as any,
      profile: mockProfile,
      refreshProfile: mockRefreshProfile as any,
      role: 'athlete',
      isCoachMode: false,
      session: null,
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      updateProfile: vi.fn(),
      switchRole: vi.fn(),
    } as any));

    mockEq = vi.fn().mockResolvedValue({ error: null });
    mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'users') {
        return { update: mockUpdate } as any;
      }
      return {} as any;
    }) as any);
  });

  it('renders heading "Personal records" and helper text with default "Max weight" selected', () => {
    render(<PrModeCard />);

    expect(screen.getByRole('heading', { name: 'Personal records' })).toBeDefined();
    expect(
      screen.getByText('Choose how personal records are ranked across exercises.')
    ).toBeDefined();

    const weightTab = screen.getByTestId('pr-mode-weight');
    const e1rmTab = screen.getByTestId('pr-mode-e1rm');

    expect(weightTab.getAttribute('aria-selected')).toBe('true');
    expect(e1rmTab.getAttribute('aria-selected')).toBe('false');
  });

  it('renders "Estimated 1RM" selected when profile has pr_mode = e1rm', () => {
    mockProfile.pr_mode = 'e1rm';

    render(<PrModeCard />);

    const weightTab = screen.getByTestId('pr-mode-weight');
    const e1rmTab = screen.getByTestId('pr-mode-e1rm');

    expect(weightTab.getAttribute('aria-selected')).toBe('false');
    expect(e1rmTab.getAttribute('aria-selected')).toBe('true');
  });

  it('clicking Estimated 1RM updates pr_mode and persists', async () => {
    render(<PrModeCard />);

    const e1rmTab = screen.getByTestId('pr-mode-e1rm');

    fireEvent.click(e1rmTab);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ pr_mode: 'e1rm' });
      expect(mockEq).toHaveBeenCalledWith('id', userId);
      expect(mockRefreshProfile).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId('pr-mode-e1rm').getAttribute('aria-selected')).toBe('true');
  });

  it('failure surfaces error via StatusBanner and reverts', async () => {
    const errorMsg = 'Failed to write preference';
    mockEq.mockResolvedValueOnce({ error: new Error(errorMsg) });

    render(<PrModeCard />);

    const e1rmTab = screen.getByTestId('pr-mode-e1rm');
    fireEvent.click(e1rmTab);

    await waitFor(() => {
      const banner = screen.getByTestId('pr-mode-status-banner');
      expect(banner).toBeDefined();
      expect(banner.textContent).toContain(errorMsg);
    });

    // Reverted back to weight mode
    expect(screen.getByTestId('pr-mode-weight').getAttribute('aria-selected')).toBe('true');
  });

  it('satisfies accessibility standards with no a11y violations', async () => {
    const { container } = render(<PrModeCard />);
    await expectNoA11yViolations(container);
  });

  it('applies sentence case styling matching WeightUnitCard and preserves 44px min-height', () => {
    const { container } = render(<PrModeCard />);

    const weightBtn = screen.getByTestId('pr-mode-weight');
    const e1rmBtn = screen.getByTestId('pr-mode-e1rm');

    expect(weightBtn.textContent).toBe('Max weight');
    expect(e1rmBtn.textContent).toBe('Estimated 1RM');

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.className).toContain('[&_button]:normal-case');
    expect(tablist?.className).toContain('[&_button]:tracking-normal');

    expect(weightBtn.className).toContain('min-h-[44px]');
    expect(e1rmBtn.className).toContain('min-h-[44px]');
  });

  it('disables tabs and displays "Available when online" helper text when offline', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);

    render(<PrModeCard />);

    expect(screen.getByTestId('offline-helper-text').textContent).toBe('Available when online');

    const weightBtn = screen.getByTestId('pr-mode-weight');
    const e1rmBtn = screen.getByTestId('pr-mode-e1rm');

    expect(weightBtn.getAttribute('disabled')).toBe('true');
    expect(weightBtn.getAttribute('title')).toBe('Available when online');
    expect(e1rmBtn.getAttribute('disabled')).toBe('true');
    expect(e1rmBtn.getAttribute('title')).toBe('Available when online');

    fireEvent.click(e1rmBtn);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
