import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UpgradeSheet } from './UpgradeSheet';
import * as billingModule from '../../lib/billing';

vi.mock('../../lib/billing', () => ({
  startCheckout: vi.fn(),
}));

describe('UpgradeSheet component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Personal, Coach, and Coach Pro options with spec bullets and 44px tap targets', () => {
    render(<UpgradeSheet {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Choose a Plan' })).toBeDefined();

    // Shared free features line
    expect(
      screen.getByText('Workout and meal tracking, quick log and on-device parsing are free for everyone.')
    ).toBeDefined();

    // Personal bullets
    expect(screen.getByText('AI meal logging, 5 a day')).toBeDefined();
    expect(screen.getByText('Coach up to 3 athletes')).toBeDefined();

    // Coach and Coach Pro bullets
    expect(screen.getAllByText('AI meal logging, 30 a day').length).toBe(2);
    expect(screen.getByText('Coach up to 10 athletes')).toBeDefined();
    expect(screen.getByText('Coach up to 25 athletes')).toBeDefined();
    expect(screen.getAllByText('Each athlete gets AI meal logging, 5 a day').length).toBe(2);

    // Assert none of the removed phrases appear anywhere in the document
    const removedPhrases = [
      'Unlimited AI food logging',
      'templates',
      'photos',
      'cockpit',
      'program assignment',
      'messaging',
      'branding',
      'priority support',
    ];
    for (const phrase of removedPhrases) {
      expect(screen.queryByText(new RegExp(phrase, 'i'))).toBeNull();
    }

    const personalBtn = screen.getByTestId('upgrade-plan-personal-btn');
    const coachBtn = screen.getByTestId('upgrade-plan-coach-btn');
    const coachProBtn = screen.getByTestId('upgrade-plan-coach_pro-btn');

    expect(personalBtn.className).toContain('min-h-[44px]');
    expect(coachBtn.className).toContain('min-h-[44px]');
    expect(coachProBtn.className).toContain('min-h-[44px]');

    const closeBtn = screen.getByTestId('upgrade-sheet-close');
    expect(closeBtn.className).toContain('min-h-[44px]');
    expect(closeBtn.className).toContain('min-w-[44px]');
  });

  it('defaults to yearly interval and displays yearly prices', () => {
    render(<UpgradeSheet {...defaultProps} />);

    const yearToggle = screen.getByTestId('interval-toggle-year');
    expect(yearToggle.getAttribute('aria-checked')).toBe('true');

    expect(screen.getByText('$10/yr')).toBeDefined();
    expect(screen.getByText('$40/yr')).toBeDefined();
    expect(screen.getByText('$80/yr')).toBeDefined();
  });

  it('toggles between monthly and yearly intervals and updates prices', () => {
    render(<UpgradeSheet {...defaultProps} />);

    const monthToggle = screen.getByTestId('interval-toggle-month');
    fireEvent.click(monthToggle);

    expect(monthToggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('$2/mo')).toBeDefined();
    expect(screen.getByText('$5/mo')).toBeDefined();
    expect(screen.getByText('$10/mo')).toBeDefined();

    const yearToggle = screen.getByTestId('interval-toggle-year');
    fireEvent.click(yearToggle);

    expect(yearToggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('$10/yr')).toBeDefined();
    expect(screen.getByText('$40/yr')).toBeDefined();
    expect(screen.getByText('$80/yr')).toBeDefined();
  });

  it('calls startCheckout with { plan: "personal", interval: "year" } when Personal option is selected on default interval', async () => {
    vi.mocked(billingModule.startCheckout).mockResolvedValueOnce({
      ok: true,
      success: true,
      url: 'https://checkout.stripe.test/personal',
    });

    render(<UpgradeSheet {...defaultProps} />);

    const personalBtn = screen.getByTestId('upgrade-plan-personal-btn');
    fireEvent.click(personalBtn);

    expect(billingModule.startCheckout).toHaveBeenCalledWith({
      plan: 'personal',
      interval: 'year',
    });
  });

  it('calls startCheckout with { plan: "coach", interval: "month" } when toggled to monthly', async () => {
    vi.mocked(billingModule.startCheckout).mockResolvedValueOnce({
      ok: true,
      success: true,
      url: 'https://checkout.stripe.test/coach_monthly',
    });

    render(<UpgradeSheet {...defaultProps} />);

    fireEvent.click(screen.getByTestId('interval-toggle-month'));

    const coachBtn = screen.getByTestId('upgrade-plan-coach-btn');
    fireEvent.click(coachBtn);

    expect(billingModule.startCheckout).toHaveBeenCalledWith({
      plan: 'coach',
      interval: 'month',
    });
  });

  it('calls startCheckout with { plan: "coach_pro", interval: "year" } when Coach Pro option is selected', async () => {
    vi.mocked(billingModule.startCheckout).mockResolvedValueOnce({
      ok: true,
      success: true,
      url: 'https://checkout.stripe.test/coach_pro',
    });

    render(<UpgradeSheet {...defaultProps} />);

    const coachProBtn = screen.getByTestId('upgrade-plan-coach_pro-btn');
    fireEvent.click(coachProBtn);

    expect(billingModule.startCheckout).toHaveBeenCalledWith({
      plan: 'coach_pro',
      interval: 'year',
    });
  });

  it('displays loading state and disables buttons while checkout is pending', async () => {
    let resolveCheckout: any;
    vi.mocked(billingModule.startCheckout).mockReturnValueOnce(
      new Promise((res) => {
        resolveCheckout = res;
      })
    );

    render(<UpgradeSheet {...defaultProps} />);

    const coachBtn = screen.getByTestId('upgrade-plan-coach-btn');
    fireEvent.click(coachBtn);

    expect(coachBtn.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('upgrade-plan-personal-btn')).toBeDisabled();
    expect(screen.getByTestId('upgrade-plan-coach_pro-btn')).toBeDisabled();
    expect(coachBtn).toHaveTextContent('Redirecting...');

    resolveCheckout({ ok: false, error: 'Cancelled' });
    await waitFor(() => {
      expect(coachBtn.getAttribute('aria-busy')).toBeNull();
    });
  });

  it('displays error banner when startCheckout returns failure', async () => {
    vi.mocked(billingModule.startCheckout).mockResolvedValueOnce({
      ok: false,
      success: false,
      error: "Billing isn't available yet.",
    });

    render(<UpgradeSheet {...defaultProps} />);

    const coachProBtn = screen.getByTestId('upgrade-plan-coach_pro-btn');
    fireEvent.click(coachProBtn);

    await waitFor(() => {
      expect(screen.getByTestId('upgrade-sheet-error')).toHaveTextContent(
        "Billing isn't available yet."
      );
    });
  });

  it('calls onClose when dismissed', () => {
    const onClose = vi.fn();
    render(<UpgradeSheet {...defaultProps} onClose={onClose} />);

    const closeBtn = screen.getByTestId('upgrade-sheet-close');
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });
});
