import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalToday } from './useLocalToday';

describe('useLocalToday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T23:50:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to current local date', () => {
    const { result } = renderHook(() => useLocalToday());
    expect(result.current[0]).toBe('2026-10-31');
  });

  it('accepts an explicit initialDate', () => {
    const { result } = renderHook(() => useLocalToday('2026-10-15'));
    expect(result.current[0]).toBe('2026-10-15');
  });

  it('advances date across midnight when visibilitychange fires and viewing today', () => {
    const onRollOver = vi.fn();
    const { result } = renderHook(() => useLocalToday(undefined, { onRollOver }));
    expect(result.current[0]).toBe('2026-10-31');

    act(() => {
      vi.setSystemTime(new Date('2026-11-01T00:05:00'));
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current[0]).toBe('2026-11-01');
    expect(onRollOver).toHaveBeenCalledWith('2026-11-01', '2026-10-31');
  });

  it('does not advance date on visibilitychange when document is hidden', () => {
    const { result } = renderHook(() => useLocalToday());
    expect(result.current[0]).toBe('2026-10-31');

    act(() => {
      vi.setSystemTime(new Date('2026-11-01T00:05:00'));
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current[0]).toBe('2026-10-31');
  });

  it('advances date across midnight on 60-second timer when visible', () => {
    const { result } = renderHook(() => useLocalToday());
    expect(result.current[0]).toBe('2026-10-31');

    act(() => {
      vi.setSystemTime(new Date('2026-11-01T00:01:00'));
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current[0]).toBe('2026-11-01');
  });

  it('advances date across midnight on window focus', () => {
    const { result } = renderHook(() => useLocalToday());
    expect(result.current[0]).toBe('2026-10-31');

    act(() => {
      vi.setSystemTime(new Date('2026-11-01T00:02:00'));
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current[0]).toBe('2026-11-01');
  });

  it('leaves date unchanged if user explicitly picked another date', () => {
    const onRollOver = vi.fn();
    const { result } = renderHook(() => useLocalToday(undefined, { onRollOver }));
    expect(result.current[0]).toBe('2026-10-31');

    // User navigates to a past date
    act(() => {
      result.current[1]('2026-10-25');
    });
    expect(result.current[0]).toBe('2026-10-25');

    // Midnight rolls over
    act(() => {
      vi.setSystemTime(new Date('2026-11-01T00:05:00'));
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current[0]).toBe('2026-10-25');
    expect(onRollOver).not.toHaveBeenCalled();
  });

  it('rolls over on subsequent midnights if user picks the new today', () => {
    const { result } = renderHook(() => useLocalToday());

    // User had picked a past date on Oct 31
    act(() => {
      result.current[1]('2026-10-25');
    });

    // Midnight 1: Oct 31 -> Nov 01 (stays 2026-10-25)
    act(() => {
      vi.setSystemTime(new Date('2026-11-01T08:00:00'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current[0]).toBe('2026-10-25');

    // On Nov 01, user navigates back to today ('2026-11-01')
    act(() => {
      result.current[1]('2026-11-01');
    });
    expect(result.current[0]).toBe('2026-11-01');

    // Midnight 2: Nov 01 -> Nov 02 (advances to 2026-11-02)
    act(() => {
      vi.setSystemTime(new Date('2026-11-02T00:05:00'));
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current[0]).toBe('2026-11-02');
  });

  it('advances multiple days if app was dormant across multiple days while on today', () => {
    const { result } = renderHook(() => useLocalToday());
    expect(result.current[0]).toBe('2026-10-31');

    act(() => {
      vi.setSystemTime(new Date('2026-11-05T09:00:00'));
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current[0]).toBe('2026-11-05');
  });

  it('cleans up event listeners and timer on unmount', () => {
    const removeDocSpy = vi.spyOn(document, 'removeEventListener');
    const removeWinSpy = vi.spyOn(window, 'removeEventListener');
    const clearTimerSpy = vi.spyOn(globalThis, 'clearInterval');

    const { unmount } = renderHook(() => useLocalToday());
    unmount();

    expect(removeDocSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeWinSpy).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(clearTimerSpy).toHaveBeenCalled();
  });
});
