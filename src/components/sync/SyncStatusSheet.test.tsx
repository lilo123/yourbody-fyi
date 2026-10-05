import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SyncStatusSheet } from './SyncStatusSheet';
import { useAuth } from '../../hooks/useAuth';
import { useOutboxStatus } from './useOutboxStatus';
import { useAttentionOps } from './useAttentionOps';
import { expectNoA11yViolations } from '../../test/a11y';
import type { OutboxOp } from '../../offline';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('./useOutboxStatus', () => ({
  useOutboxStatus: vi.fn(),
}));

vi.mock('./useAttentionOps', () => ({
  useAttentionOps: vi.fn(),
}));

describe('SyncStatusSheet', () => {
  const mockOnClose = vi.fn();
  const mockRetry = vi.fn().mockResolvedValue(undefined);
  const mockDiscard = vi.fn().mockResolvedValue(undefined);

  const baseSummary = {
    pending: 0,
    attention: 0,
    syncing: false,
    authRequired: false,
    lastSyncedCount: 0,
    needsAttentionOps: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'test-user-id' } as any,
    } as any);

    vi.mocked(useOutboxStatus).mockReturnValue({
      ...baseSummary,
      pending: 0,
      attention: 0,
    });

    vi.mocked(useAttentionOps).mockReturnValue({
      ops: [],
      count: 0,
      retry: mockRetry,
      discard: mockDiscard,
    });
  });

  const renderSheet = (isOpen = true) =>
    render(
      <MemoryRouter>
        <SyncStatusSheet isOpen={isOpen} onClose={mockOnClose} />
      </MemoryRouter>
    );

  it('renders "All changes synced" when pending is 0', () => {
    renderSheet();
    expect(screen.getByText('All changes synced')).toBeDefined();
    expect(screen.getByText('Your device is up to date with the server')).toBeDefined();
  });

  it('renders pending count and syncing status when changes are pending', () => {
    vi.mocked(useOutboxStatus).mockReturnValue({
      ...baseSummary,
      pending: 3,
      attention: 0,
      syncing: true,
    });

    renderSheet();
    expect(screen.getByText('3 changes pending')).toBeDefined();
    expect(screen.getByText('Syncing in progress...')).toBeDefined();
  });

  it('renders authRequired banner and navigates to /login on Sign In click', () => {
    vi.mocked(useOutboxStatus).mockReturnValue({
      ...baseSummary,
      pending: 1,
      attention: 0,
      authRequired: true,
    });

    renderSheet();
    expect(screen.getByTestId('auth-required-row')).toBeDefined();
    expect(screen.getByText('Sign in to sync your changes')).toBeDefined();

    const signInBtn = screen.getByTestId('sync-sheet-sign-in-btn');
    fireEvent.click(signInBtn);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('renders attention ops list with formatOpKind, formatted time, and error', () => {
    const mockOp: OutboxOp = {
      opId: 'op-123',
      userId: 'test-user-id',
      clientMutationId: 'client-mut-123',
      kind: 'set.create',
      table: 'workout_sets',
      rowId: 'row-123',
      payload: { weight: 135, reps: 10 },
      createdAt: '2026-09-30T12:00:00.000Z',
      retryCount: 3,
      status: 'attention',
      error: 'Foreign key violation or permission denied',
    } as any;

    vi.mocked(useAttentionOps).mockReturnValue({
      ops: [mockOp],
      count: 1,
      retry: mockRetry,
      discard: mockDiscard,
    });

    renderSheet();
    expect(screen.getByTestId('needs-attention-section')).toBeDefined();
    expect(screen.getByText('Needs attention (1)')).toBeDefined();
    expect(screen.getByText('Create set (135 × 10)')).toBeDefined();
    expect(screen.getByText('Foreign key violation or permission denied')).toBeDefined();
  });

  it('formats fractional weight without float drift (STD-DAT-2)', () => {
    const mockOp: OutboxOp = {
      opId: 'op-drift',
      userId: 'test-user-id',
      clientMutationId: 'client-mut-drift',
      kind: 'set.create',
      table: 'workout_sets',
      rowId: 'row-drift',
      payload: { weight: 220.462262185, reps: 10 },
      createdAt: '2026-09-30T12:00:00.000Z',
      retryCount: 1,
      status: 'attention',
      error: 'Sync error',
    } as any;

    vi.mocked(useAttentionOps).mockReturnValue({
      ops: [mockOp],
      count: 1,
      retry: mockRetry,
      discard: mockDiscard,
    });

    renderSheet();
    expect(screen.getByText('Create set (220.5 × 10)')).toBeDefined();
    expect(screen.queryByText(/220\.4622/)).toBeNull();
  });

  it('calls retry when Retry button is clicked on an attention item', async () => {
    const mockOp: OutboxOp = {
      opId: 'op-456',
      userId: 'test-user-id',
      clientMutationId: 'client-mut-456',
      kind: 'set.delete',
      table: 'workout_sets',
      rowId: 'row-456',
      payload: {},
      createdAt: '2026-09-30T12:00:00.000Z',
      retryCount: 2,
      status: 'attention',
      error: 'Network timeout during retry',
    } as any;

    vi.mocked(useAttentionOps).mockReturnValue({
      ops: [mockOp],
      count: 1,
      retry: mockRetry,
      discard: mockDiscard,
    });

    renderSheet();
    const retryBtn = screen.getByTestId('retry-op-btn-op-456');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockRetry).toHaveBeenCalledWith('op-456');
    });
  });

  it('opens ConfirmDialog on Discard and removes op on confirm', async () => {
    const mockOp: OutboxOp = {
      opId: 'op-789',
      userId: 'test-user-id',
      clientMutationId: 'client-mut-789',
      kind: 'workout.rename',
      table: 'workouts',
      rowId: 'row-789',
      payload: { name: 'Leg Day Blast' },
      createdAt: '2026-09-30T12:00:00.000Z',
      retryCount: 1,
      status: 'attention',
      error: 'Conflict: workout already deleted',
    } as any;

    vi.mocked(useAttentionOps).mockReturnValue({
      ops: [mockOp],
      count: 1,
      retry: mockRetry,
      discard: mockDiscard,
    });

    renderSheet();
    const discardBtn = screen.getByTestId('discard-op-btn-op-789');
    fireEvent.click(discardBtn);

    // Confirm dialog should be open
    expect(screen.getByText('Discard change?')).toBeDefined();
    expect(screen.getByText(/permanently removed from your sync queue/)).toBeDefined();

    // Cancel first
    const cancelBtn = screen.getByText('Keep change');
    fireEvent.click(cancelBtn);
    expect(mockDiscard).not.toHaveBeenCalled();

    // Open again and confirm
    fireEvent.click(discardBtn);
    const confirmBtn = screen.getByText('Discard change');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockDiscard).toHaveBeenCalledWith('op-789');
    });
  });

  it('passes axe accessibility audit when open', async () => {
    const mockOp: OutboxOp = {
      opId: 'op-123',
      userId: 'test-user-id',
      clientMutationId: 'client-mut-123',
      kind: 'set.create',
      table: 'workout_sets',
      rowId: 'row-123',
      payload: { weight: 135, reps: 10 },
      createdAt: '2026-09-30T12:00:00.000Z',
      retryCount: 1,
      status: 'attention',
      error: 'Sync error',
    } as any;

    vi.mocked(useAttentionOps).mockReturnValue({
      ops: [mockOp],
      count: 1,
      retry: mockRetry,
      discard: mockDiscard,
    });

    const { container } = renderSheet();
    await expectNoA11yViolations(container);
  });
});
