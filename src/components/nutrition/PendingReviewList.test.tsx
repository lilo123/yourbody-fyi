import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PendingReviewList } from './PendingReviewList';
import type { AiQueueItem, AiQueueCounts } from '../../offline';
import * as offlineModule from '../../offline';

vi.mock('../../offline', async () => {
  const actual = await vi.importActual<typeof import('../../offline')>('../../offline');
  return {
    ...actual,
    discardAiItem: vi.fn().mockResolvedValue(undefined),
    listAiItems: vi.fn().mockResolvedValue([]),
    notifyAiQueueChanged: vi.fn(),
    getOfflineDb: vi.fn(),
  };
});

describe('PendingReviewList', () => {
  const mockUserId = 'user-test-123';
  const emptyCounts: AiQueueCounts = {
    queued: 0,
    analyzing: 0,
    ready: 0,
    failed: 0,
    total: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null when counts.total is 0', () => {
    const { container } = render(
      <PendingReviewList
        userId={mockUserId}
        items={[]}
        counts={emptyCounts}
        onReviewItem={vi.fn()}
        onEnterManually={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders queued and analyzing items with status badges', () => {
    const items: AiQueueItem[] = [
      {
        id: 'item-1',
        userId: mockUserId,
        kind: 'text',
        text: 'Protein shake and banana',
        capturedAt: '2026-10-01T12:00:00Z',
        captureDate: '2026-10-01',
        status: 'queued',
        attempts: 0,
        nextAttemptAt: 0,
      },
      {
        id: 'item-2',
        userId: mockUserId,
        kind: 'photo',
        capturedAt: '2026-10-01T12:05:00Z',
        captureDate: '2026-10-01',
        status: 'analyzing',
        attempts: 1,
        nextAttemptAt: 0,
      },
    ];

    const counts: AiQueueCounts = {
      queued: 1,
      analyzing: 1,
      ready: 0,
      failed: 0,
      total: 2,
    };

    render(
      <PendingReviewList
        userId={mockUserId}
        items={items}
        counts={counts}
        onReviewItem={vi.fn()}
        onEnterManually={vi.fn()}
      />
    );

    expect(screen.getByTestId('pending-review-list')).toBeDefined();
    expect(screen.getByText('Pending AI Analysis (2)')).toBeDefined();
    expect(screen.getByText('Protein shake and banana')).toBeDefined();
    expect(screen.getByText('Queued')).toBeDefined();
    expect(screen.getByText('Analyzing')).toBeDefined();
  });

  it('renders ready item with Review button and fires onReviewItem on click', () => {
    const onReviewItem = vi.fn();
    const readyItem: AiQueueItem = {
      id: 'item-ready-1',
      userId: mockUserId,
      kind: 'photo',
      capturedAt: '2026-10-01T12:10:00Z',
      captureDate: '2026-10-01',
      status: 'ready',
      result: {
        name: 'Chicken Rice Bowl',
        calories: 650,
        protein: 45,
        carbs: 70,
        fat: 15,
        fiber: 5,
        items: [],
      },
      attempts: 1,
      nextAttemptAt: 0,
    };

    const counts: AiQueueCounts = {
      queued: 0,
      analyzing: 0,
      ready: 1,
      failed: 0,
      total: 1,
    };

    render(
      <PendingReviewList
        userId={mockUserId}
        items={[readyItem]}
        counts={counts}
        onReviewItem={onReviewItem}
        onEnterManually={vi.fn()}
      />
    );

    expect(screen.getByText('Ready to review')).toBeDefined();
    const reviewBtn = screen.getByTestId('review-aiq-item-item-ready-1');
    expect(reviewBtn).toBeDefined();

    fireEvent.click(reviewBtn);
    expect(onReviewItem).toHaveBeenCalledTimes(1);
    expect(onReviewItem).toHaveBeenCalledWith(readyItem);
  });

  it('renders failed item with retry, enter manually, and discard buttons', async () => {
    const onEnterManually = vi.fn();
    const failedItem: AiQueueItem = {
      id: 'item-failed-1',
      userId: mockUserId,
      kind: 'text',
      text: 'Non-food object photo',
      capturedAt: '2026-10-01T12:15:00Z',
      captureDate: '2026-10-01',
      status: 'failed',
      lastError: 'NON_FOOD_DETECTED: No food found',
      attempts: 2,
      nextAttemptAt: 0,
    };

    const counts: AiQueueCounts = {
      queued: 0,
      analyzing: 0,
      ready: 0,
      failed: 1,
      total: 1,
    };

    render(
      <PendingReviewList
        userId={mockUserId}
        items={[failedItem]}
        counts={counts}
        onReviewItem={vi.fn()}
        onEnterManually={onEnterManually}
      />
    );

    expect(screen.getByText('Analysis failed')).toBeDefined();
    expect(screen.getByText('NON_FOOD_DETECTED: No food found')).toBeDefined();

    // Enter manually
    const enterManuallyBtn = screen.getByTestId('manual-aiq-item-item-failed-1');
    fireEvent.click(enterManuallyBtn);
    expect(onEnterManually).toHaveBeenCalledWith(failedItem);

    // Discard with confirmation dialog
    const discardBtn = screen.getByTestId('discard-aiq-item-item-failed-1');
    fireEvent.click(discardBtn);

    expect(screen.getByText('Discard AI Capture?')).toBeDefined();
    const confirmDiscardBtn = screen.getByRole('button', { name: 'Discard' });
    fireEvent.click(confirmDiscardBtn);

    await waitFor(() => {
      expect(offlineModule.discardAiItem).toHaveBeenCalledWith(mockUserId, 'item-failed-1');
    });
  });

  it('retries failed item via IDB reset on Retry click', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined);
    const mockGet = vi.fn().mockResolvedValue({
      id: 'item-retry-1',
      userId: mockUserId,
      status: 'failed',
      attempts: 3,
      nextAttemptAt: 5000,
      lastError: 'Network timeout',
    });

    vi.mocked(offlineModule.getOfflineDb).mockResolvedValue({
      get: mockGet,
      put: mockPut,
    } as any);

    const failedItem: AiQueueItem = {
      id: 'item-retry-1',
      userId: mockUserId,
      kind: 'photo',
      capturedAt: '2026-10-01T12:20:00Z',
      captureDate: '2026-10-01',
      status: 'failed',
      lastError: 'Network timeout',
      attempts: 3,
      nextAttemptAt: 5000,
    };

    const counts: AiQueueCounts = {
      queued: 0,
      analyzing: 0,
      ready: 0,
      failed: 1,
      total: 1,
    };

    render(
      <PendingReviewList
        userId={mockUserId}
        items={[failedItem]}
        counts={counts}
        onReviewItem={vi.fn()}
        onEnterManually={vi.fn()}
      />
    );

    const retryBtn = screen.getByTestId('retry-aiq-item-item-retry-1');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('aiq', expect.objectContaining({
        id: 'item-retry-1',
        status: 'queued',
        attempts: 0,
        nextAttemptAt: 0,
      }));
      expect(offlineModule.notifyAiQueueChanged).toHaveBeenCalledWith(mockUserId);
    });
  });
});
