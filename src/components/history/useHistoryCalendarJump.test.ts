import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHistoryCalendarJump } from './useHistoryCalendarJump';
import type { HistorySession } from './useWorkoutHistory';

describe('useHistoryCalendarJump', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const session1: HistorySession = {
    id: 's-1',
    date: '2026-09-20',
    civil_date: '2026-09-20',
    workout_date: '2026-09-20',
    name: 'Leg Day',
    set_count: 5,
    total_volume: 1000,
  };

  const session2: HistorySession = {
    id: 's-2',
    date: '2026-09-10',
    civil_date: '2026-09-10',
    workout_date: '2026-09-10',
    name: 'Push Day',
    set_count: 4,
    total_volume: 800,
  };

  it('immediately highlights when target date is already loaded and clears after 2.5s', async () => {
    const setTimeRange = vi.fn();
    const loadMore = vi.fn();

    const { result } = renderHook(() =>
      useHistoryCalendarJump({
        sessions: [session1],
        hasMore: true,
        isLoadingMore: false,
        loadMore,
        setTimeRange,
        targetUserId: 'u-1',
      })
    );

    act(() => {
      result.current.handleSelectDate('2026-09-20');
    });

    expect(setTimeRange).toHaveBeenCalledWith('all');
    expect(result.current.highlightDate).toBe('2026-09-20');
    expect(result.current.jumpStatusMessage).toBeNull();
    expect(result.current.isCalendarOpen).toBe(false);

    // Fast-forward 2500ms
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    // Highlight is cleared after use
    expect(result.current.highlightDate).toBeUndefined();
  });

  it('stops and shows info message when !hasMore before reaching target date', async () => {
    const setTimeRange = vi.fn();
    const loadMore = vi.fn();

    let hasMore = true;
    let sessions = [session1];

    const { result, rerender } = renderHook(() =>
      useHistoryCalendarJump({
        sessions,
        hasMore,
        isLoadingMore: false,
        loadMore,
        setTimeRange,
        targetUserId: 'u-1',
      })
    );

    act(() => {
      result.current.handleSelectDate('2026-08-01');
    });

    expect(loadMore).toHaveBeenCalledTimes(1);

    // End of history reached: hasMore becomes false
    hasMore = false;
    rerender();

    // Microtask sets status message
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.jumpStatusMessage).toBe('Load older sessions to reach 2026-08-01');
    expect(result.current.highlightDate).toBeUndefined();
  });

  it('caps paging at max 10 pages and displays info banner', async () => {
    const setTimeRange = vi.fn();
    let loadMoreCalls = 0;
    const loadMore = vi.fn(() => {
      loadMoreCalls++;
    });

    let sessions = [session1];

    const { result, rerender } = renderHook(() =>
      useHistoryCalendarJump({
        sessions,
        hasMore: true,
        isLoadingMore: false,
        loadMore,
        setTimeRange,
        targetUserId: 'u-1',
      })
    );

    act(() => {
      result.current.handleSelectDate('2026-01-01');
    });

    // Simulate 10 page loads without finding date
    for (let i = 0; i < 10; i++) {
      sessions = [...sessions, { ...session2, id: `s-${i + 3}`, civil_date: `2026-09-0${i}` }];
      rerender();
    }

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.jumpStatusMessage).toBe('Load older sessions to reach 2026-01-01');
    expect(loadMoreCalls).toBeLessThanOrEqual(10);
  });
});
