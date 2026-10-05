import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttentionBanner } from './AttentionBanner';
import { useAuth } from '../../hooks/useAuth';
import { useOutboxStatus } from './useOutboxStatus';
import { expectNoA11yViolations } from '../../test/a11y';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('./useOutboxStatus', () => ({
  useOutboxStatus: vi.fn(),
}));

vi.mock('./SyncStatusSheet', () => ({
  SyncStatusSheet: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="mock-sync-status-sheet">
        <button onClick={onClose} data-testid="mock-close-sheet">Close</button>
      </div>
    ) : null,
}));

describe('AttentionBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'test-user-id' } as any,
    } as any);
  });

  const baseSummary = {
    pending: 0,
    attention: 0,
    syncing: false,
    authRequired: false,
    lastSyncedCount: 0,
    needsAttentionOps: [],
  };

  it('renders nothing when attention count is 0', () => {
    vi.mocked(useOutboxStatus).mockReturnValue({
      ...baseSummary,
      pending: 0,
      attention: 0,
    });

    const { container } = render(<AttentionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders banner with singular text when 1 change needs attention', () => {
    vi.mocked(useOutboxStatus).mockReturnValue({
      ...baseSummary,
      pending: 1,
      attention: 1,
    });

    render(<AttentionBanner />);
    const banner = screen.getByTestId('attention-banner');
    expect(banner).toBeDefined();
    expect(banner.textContent).toContain('1 change needs attention');
  });

  it('renders banner with plural text when multiple changes need attention', () => {
    vi.mocked(useOutboxStatus).mockReturnValue({
      ...baseSummary,
      pending: 3,
      attention: 3,
    });

    render(<AttentionBanner />);
    const banner = screen.getByTestId('attention-banner');
    expect(banner).toBeDefined();
    expect(banner.textContent).toContain('3 changes need attention');
  });

  it('opens SyncStatusSheet when Review button is clicked', () => {
    vi.mocked(useOutboxStatus).mockReturnValue({
      ...baseSummary,
      pending: 2,
      attention: 2,
    });

    render(<AttentionBanner />);
    expect(screen.queryByTestId('mock-sync-status-sheet')).toBeNull();

    const reviewBtn = screen.getByTestId('review-attention-btn');
    fireEvent.click(reviewBtn);

    expect(screen.getByTestId('mock-sync-status-sheet')).toBeDefined();

    const closeBtn = screen.getByTestId('mock-close-sheet');
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId('mock-sync-status-sheet')).toBeNull();
  });

  it('passes axe accessibility audit when rendered', async () => {
    vi.mocked(useOutboxStatus).mockReturnValue({
      ...baseSummary,
      pending: 2,
      attention: 2,
    });

    const { container } = render(<AttentionBanner />);
    await expectNoA11yViolations(container);
  });
});
