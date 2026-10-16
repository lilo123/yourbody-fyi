import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  fetchTemplateDetail,
  clearTemplateDetailCache,
  routineTemplateDetailQueryKey,
  OFFLINE_TEMPLATE_DETAIL_TIMEOUT_MS,
  type RoutineTemplateDetail,
} from './useWorkoutQueries';
import { supabase } from '../../lib/supabase';

describe('fetchTemplateDetail offline resilience and caching', () => {
  let queryClient: QueryClient;
  const originalOnLine = navigator.onLine;

  beforeEach(() => {
    vi.clearAllMocks();
    clearTemplateDetailCache();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    clearTemplateDetailCache();
    Object.defineProperty(navigator, 'onLine', {
      value: originalOnLine,
      configurable: true,
      writable: true,
    });
  });

  it('cached detail returned offline without a network call', async () => {
    const mockDetail: RoutineTemplateDetail = {
      id: 'template-cached-1',
      exercises: [
        {
          id: 'te-1',
          template_id: 'template-cached-1',
          exercise_id: 'ex-1',
          order_index: 0,
          target_sets: 3,
          target_reps: 10,
          exercise: { name: 'Bench Press' },
        },
      ],
    };

    queryClient.setQueryData(
      routineTemplateDetailQueryKey('template-cached-1'),
      mockDetail
    );

    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    });

    const fromSpy = vi.spyOn(supabase, 'from');

    const result = await fetchTemplateDetail('template-cached-1', queryClient);

    expect(result).toEqual(mockDetail);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('first online call populates the cache', async () => {
    const mockDetail: RoutineTemplateDetail = {
      id: 'template-online-1',
      exercises: [
        {
          id: 'te-2',
          template_id: 'template-online-1',
          exercise_id: 'ex-2',
          order_index: 0,
          target_sets: 4,
          target_reps: 8,
          exercise: { name: 'Back Squat' },
        },
      ],
    };

    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: mockDetail,
      error: null,
    });
    const limitMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const eqMock = vi.fn().mockReturnValue({ limit: limitMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: selectMock,
    } as any);

    const result = await fetchTemplateDetail('template-online-1', queryClient);

    expect(result).toEqual(mockDetail);
    expect(
      queryClient.getQueryData(routineTemplateDetailQueryKey('template-online-1'))
    ).toEqual(mockDetail);
  });

  it('offline + no cache rejects within a short bound (fake timers)', async () => {
    vi.useFakeTimers();

    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    });

    const hangingPromise = new Promise(() => {});
    const maybeSingleMock = vi.fn().mockReturnValue(hangingPromise);
    const limitMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const eqMock = vi.fn().mockReturnValue({ limit: limitMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: selectMock,
    } as any);

    const pendingPromise = fetchTemplateDetail('template-offline-uncached', queryClient);
    let capturedError: Error | undefined;
    pendingPromise.catch((caughtError: unknown) => {
      if (caughtError instanceof Error) {
        capturedError = caughtError;
      }
    });

    // Advance fake timers past the offline timeout threshold
    await vi.advanceTimersByTimeAsync(OFFLINE_TEMPLATE_DETAIL_TIMEOUT_MS + 50);

    await expect(pendingPromise).rejects.toThrow(/timed out/i);
    expect(capturedError).toBeDefined();
    expect(capturedError?.message).toMatch(/timed out/i);
  });

  it('serves memory-cached detail offline when queryClient is not provided', async () => {
    const mockDetail: RoutineTemplateDetail = {
      id: 'template-mem-1',
      exercises: [
        {
          id: 'te-3',
          template_id: 'template-mem-1',
          exercise_id: 'ex-3',
          order_index: 0,
          target_sets: 3,
          target_reps: 12,
          exercise: { name: 'Overhead Press' },
        },
      ],
    };

    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: mockDetail,
      error: null,
    });
    const limitMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const eqMock = vi.fn().mockReturnValue({ limit: limitMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: selectMock,
    } as any);

    // Initial fetch populates memory fallback cache
    const initialResult = await fetchTemplateDetail('template-mem-1');
    expect(initialResult).toEqual(mockDetail);

    // Simulate going offline
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    });

    const fromSpy = vi.spyOn(supabase, 'from');
    fromSpy.mockClear();

    // Second fetch without queryClient serves memory cache without network calls
    const offlineResult = await fetchTemplateDetail('template-mem-1');
    expect(offlineResult).toEqual(mockDetail);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('respects custom timeoutMs in options when network request hangs', async () => {
    vi.useFakeTimers();

    const hangingPromise = new Promise(() => {});
    const maybeSingleMock = vi.fn().mockReturnValue(hangingPromise);
    const limitMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const eqMock = vi.fn().mockReturnValue({ limit: limitMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: selectMock,
    } as any);

    const pendingPromise = fetchTemplateDetail('template-custom-timeout', {
      queryClient,
      timeoutMs: 600,
    });
    pendingPromise.catch(() => {});

    await vi.advanceTimersByTimeAsync(650);

    await expect(pendingPromise).rejects.toThrow(/timed out after 600ms/i);
  });
});
