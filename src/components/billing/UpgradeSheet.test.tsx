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

  it('renders Basic and Pro options with benefits and 44px tap targets', () => {
    render(<UpgradeSheet {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Choose a Plan' })).toBeDefined();
    expect(screen.getByText('Essential AI meal analysis and personal workout tracking.')).toBeDefined();
    expect(screen.getByText('Full AI meal analysis with higher limits and advanced features.')).toBeDefined();

    const basicBtn = screen.getByTestId('upgrade-plan-basic-btn');
    const proBtn = screen.getByTestId('upgrade-plan-pro-btn');

    expect(basicBtn.className).toContain('min-h-[44px]');
    expect(proBtn.className).toContain('min-h-[44px]');
  });

  it('calls startCheckout with "basic" when Basic option is selected', async () => {
    vi.mocked(billingModule.startCheckout).mockResolvedValueOnce({
      ok: true,
      success: true,
      url: 'https://checkout.stripe.test/basic',
    });

    render(<UpgradeSheet {...defaultProps} />);

    const basicBtn = screen.getByTestId('upgrade-plan-basic-btn');
    fireEvent.click(basicBtn);

    expect(billingModule.startCheckout).toHaveBeenCalledWith('basic');
  });

  it('calls startCheckout with "pro" when Pro option is selected', async () => {
    vi.mocked(billingModule.startCheckout).mockResolvedValueOnce({
      ok: true,
      success: true,
      url: 'https://checkout.stripe.test/pro',
    });

    render(<UpgradeSheet {...defaultProps} />);

    const proBtn = screen.getByTestId('upgrade-plan-pro-btn');
    fireEvent.click(proBtn);

    expect(billingModule.startCheckout).toHaveBeenCalledWith('pro');
  });

  it('displays loading state and disables buttons while checkout is pending', async () => {
    let resolveCheckout: any;
    vi.mocked(billingModule.startCheckout).mockReturnValueOnce(
      new Promise((res) => {
        resolveCheckout = res;
      })
    );

    render(<UpgradeSheet {...defaultProps} />);

    const proBtn = screen.getByTestId('upgrade-plan-pro-btn');
    fireEvent.click(proBtn);

    expect(proBtn.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('upgrade-plan-basic-btn')).toBeDisabled();
    expect(proBtn).toHaveTextContent('Redirecting...');

    resolveCheckout({ ok: false, error: 'Cancelled' });
    await waitFor(() => {
      expect(proBtn.getAttribute('aria-busy')).toBeNull();
    });
  });

  it('displays error banner when startCheckout returns failure', async () => {
    vi.mocked(billingModule.startCheckout).mockResolvedValueOnce({
      ok: false,
      success: false,
      error: "Billing isn't available yet.",
    });

    render(<UpgradeSheet {...defaultProps} />);

    const proBtn = screen.getByTestId('upgrade-plan-pro-btn');
    fireEvent.click(proBtn);

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
