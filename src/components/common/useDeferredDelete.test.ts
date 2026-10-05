import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDeferredDelete } from './useDeferredDelete';

describe('useDeferredDelete', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits exactly once on expiry', () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeferredDelete<string>({ commit, durationMs: 6000 })
    );

    expect(result.current.pending).toBeNull();

    act(() => {
      result.current.schedule('set-1', 'Set 1');
    });

    expect(result.current.pending).toEqual({ item: 'set-1', label: 'Set 1' });
    expect(commit).not.toHaveBeenCalled();

    // Advance 5900ms - not yet committed
    act(() => {
      vi.advanceTimersByTime(5900);
    });
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.pending).not.toBeNull();

    // Advance to 6000ms - committed exactly once
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('set-1');
    expect(result.current.pending).toBeNull();
  });

  it('makes 0 commits on undo', () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeferredDelete<string>({ commit, durationMs: 6000 })
    );

    act(() => {
      result.current.schedule('set-1', 'Set 1');
    });
    expect(result.current.pending).toEqual({ item: 'set-1', label: 'Set 1' });

    // Undo before expiry
    act(() => {
      vi.advanceTimersByTime(2000);
      result.current.undo();
    });

    expect(result.current.pending).toBeNull();

    // Advance past original 6000ms duration
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(commit).toHaveBeenCalledTimes(0);
  });

  it('flushes (commits) previous when a second is scheduled', () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeferredDelete<string>({ commit, durationMs: 6000 })
    );

    act(() => {
      result.current.schedule('set-1', 'Set 1');
    });
    expect(commit).not.toHaveBeenCalled();

    // Schedule second item while first is pending -> first is committed immediately
    act(() => {
      vi.advanceTimersByTime(2000);
      result.current.schedule('set-2', 'Set 2');
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('set-1');
    expect(result.current.pending).toEqual({ item: 'set-2', label: 'Set 2' });

    // Second item commits on its own expiry
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith('set-2');
    expect(result.current.pending).toBeNull();
  });

  it('commits exactly 1 on unmount-flush', () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDeferredDelete<string>({ commit, durationMs: 6000 })
    );

    act(() => {
      result.current.schedule('set-1', 'Set 1');
    });
    expect(commit).not.toHaveBeenCalled();

    // Unmount while pending
    unmount();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('set-1');

    // Advancing timers afterwards does not trigger duplicate commit
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('flushes on window pagehide event', () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeferredDelete<string>({ commit, durationMs: 6000 })
    );

    act(() => {
      result.current.schedule('set-1', 'Set 1');
    });
    expect(commit).not.toHaveBeenCalled();

    // Trigger window pagehide event
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('set-1');
    expect(result.current.pending).toBeNull();
  });

  it('calls onError if commit throws or rejects', async () => {
    const error = new Error('Network error');
    const commit = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useDeferredDelete<string>({ commit, durationMs: 1000, onError })
    );

    act(() => {
      result.current.schedule('set-error', 'Set with error');
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, 'set-error');
  });
});
