import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WeightUnitCard } from './WeightUnitCard';
import { useAuth } from '../../hooks/useAuth';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { supabase } from '../../lib/supabase';
import { expectNoA11yViolations } from '../../test/a11y';
import type { UserProfile } from '../../types/database';

vi.mock('../../hooks/useAuth');
vi.mock('../../hooks/useOnlineStatus');

describe('WeightUnitCard', () => {
  const userId = 'athlete-user-123';
  let mockProfile: UserProfile;
  let mockRefreshProfile: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOnlineStatus).mockReturnValue(true);
    mockProfile = {
      id: userId,
      email: 'athlete@yourbody.fyi',
      username: 'CyberAthlete',
      role: 'athlete',
      weight_unit: 'lb',
    } as UserProfile;

    mockRefreshProfile = vi.fn().mockImplementation(async () => {
      // Simulate profile refresh
    });

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

  it('renders heading "Weight unit" and helper text with current unit selected from profile (lb)', () => {
    render(<WeightUnitCard />);

    expect(screen.getByRole('heading', { name: 'Weight unit' })).toBeDefined();
    expect(
      screen.getByText('Weights are stored in pounds; this changes how they are shown and entered.')
    ).toBeDefined();

    const lbBtn = screen.getByTestId('weight-unit-lb');
    const kgBtn = screen.getByTestId('weight-unit-kg');

    expect(lbBtn.getAttribute('aria-pressed')).toBe('true');
    expect(kgBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders current unit selected from profile when kg', () => {
    mockProfile.weight_unit = 'kg';

    render(<WeightUnitCard />);

    const lbBtn = screen.getByTestId('weight-unit-lb');
    const kgBtn = screen.getByTestId('weight-unit-kg');

    expect(lbBtn.getAttribute('aria-pressed')).toBe('false');
    expect(kgBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('selecting kg calls update with {weight_unit: "kg"} filtered by own id and then shows kg selected after profile refresh', async () => {
    const { rerender } = render(<WeightUnitCard />);

    const kgBtn = screen.getByTestId('weight-unit-kg');

    mockRefreshProfile.mockImplementationOnce(async () => {
      mockProfile.weight_unit = 'kg';
    });

    fireEvent.click(kgBtn);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ weight_unit: 'kg' });
      expect(mockEq).toHaveBeenCalledWith('id', userId);
      expect(mockRefreshProfile).toHaveBeenCalledTimes(1);
    });

    // Rerender to reflect updated profile from AuthContext
    rerender(<WeightUnitCard />);
    expect(screen.getByTestId('weight-unit-kg').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('weight-unit-lb').getAttribute('aria-pressed')).toBe('false');
  });

  it('failure -> StatusBanner error + lb still selected + no unhandled rejection', async () => {
    const errorMsg = 'Failed to write preference to database';
    mockEq.mockResolvedValueOnce({ error: new Error(errorMsg) });

    render(<WeightUnitCard />);

    const kgBtn = screen.getByTestId('weight-unit-kg');
    const lbBtn = screen.getByTestId('weight-unit-lb');

    expect(lbBtn.getAttribute('aria-pressed')).toBe('true');

    // Click kg which will fail
    fireEvent.click(kgBtn);

    // Verify error banner appears with message
    await waitFor(() => {
      const banner = screen.getByTestId('weight-unit-status-banner');
      expect(banner).toBeDefined();
      expect(banner.textContent).toContain(errorMsg);
    });

    // lb is still selected (no optimistic flip)
    expect(lbBtn.getAttribute('aria-pressed')).toBe('true');
    expect(kgBtn.getAttribute('aria-pressed')).toBe('false');
    expect(mockRefreshProfile).not.toHaveBeenCalled();
  });

  it('disabled while saving (aria-busy on group)', async () => {
    let resolveUpdate: (value: any) => void;
    const updatePromise = new Promise((resolve) => {
      resolveUpdate = resolve;
    });
    mockEq.mockReturnValueOnce(updatePromise);

    render(<WeightUnitCard />);

    const kgBtn = screen.getByTestId('weight-unit-kg');
    const lbBtn = screen.getByTestId('weight-unit-lb');
    const group = screen.getByRole('group', { name: 'Weight unit' });

    expect(group.getAttribute('aria-busy')).toBe('false');
    expect(kgBtn).not.toBeDisabled();
    expect(lbBtn).not.toBeDisabled();

    fireEvent.click(kgBtn);

    await waitFor(() => {
      expect(group.getAttribute('aria-busy')).toBe('true');
      expect(kgBtn).toBeDisabled();
      expect(lbBtn).toBeDisabled();
    });

    // Resolve the promise
    resolveUpdate!({ error: null });

    await waitFor(() => {
      expect(group.getAttribute('aria-busy')).toBe('false');
      expect(kgBtn).not.toBeDisabled();
      expect(lbBtn).not.toBeDisabled();
    });
  });

  it('keyboard operable: arrow keys and Enter/Space trigger selection and satisfy 44px touch targets', async () => {
    const { rerender } = render(<WeightUnitCard />);

    const lbBtn = screen.getByTestId('weight-unit-lb');
    const kgBtn = screen.getByTestId('weight-unit-kg');

    // 44px touch targets check
    expect(lbBtn.className).toContain('min-h-[44px]');
    expect(kgBtn.className).toContain('min-h-[44px]');

    mockRefreshProfile.mockImplementationOnce(async () => {
      mockProfile.weight_unit = 'kg';
    });

    // ArrowRight on lb triggers kg selection
    fireEvent.keyDown(lbBtn, { key: 'ArrowRight' });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ weight_unit: 'kg' });
      expect(mockEq).toHaveBeenCalledWith('id', userId);
    });

    rerender(<WeightUnitCard />);

    mockUpdate.mockClear();
    mockEq.mockClear();

    mockRefreshProfile.mockImplementationOnce(async () => {
      mockProfile.weight_unit = 'lb';
    });

    // ArrowLeft on kg triggers lb selection
    fireEvent.keyDown(kgBtn, { key: 'ArrowLeft' });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ weight_unit: 'lb' });
      expect(mockEq).toHaveBeenCalledWith('id', userId);
    });

    rerender(<WeightUnitCard />);

    mockUpdate.mockClear();
    mockEq.mockClear();

    // Space on kg triggers kg selection
    fireEvent.keyDown(kgBtn, { key: ' ' });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ weight_unit: 'kg' });
      expect(mockEq).toHaveBeenCalledWith('id', userId);
    });
  });

  it('passes axe accessibility audits with no violations', async () => {
    const { container } = render(<WeightUnitCard />);
    await expectNoA11yViolations(container);
  });

  it('disables lb and kg buttons and shows "Available when online" helper text when offline', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);

    render(<WeightUnitCard />);

    expect(screen.getByTestId('offline-helper-text').textContent).toBe('Available when online');

    const lbBtn = screen.getByTestId('weight-unit-lb');
    const kgBtn = screen.getByTestId('weight-unit-kg');

    expect(lbBtn).toBeDisabled();
    expect(kgBtn).toBeDisabled();
    expect(lbBtn.getAttribute('title')).toBe('Available when online');
    expect(kgBtn.getAttribute('title')).toBe('Available when online');

    fireEvent.click(kgBtn);
    expect(mockUpdate).not.toHaveBeenCalled();

    fireEvent.keyDown(lbBtn, { key: 'ArrowRight' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
