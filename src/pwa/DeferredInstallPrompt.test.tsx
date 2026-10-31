import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DeferredInstallPrompt } from './DeferredInstallPrompt';
import {
  resetInstallPromptStoreForTesting,
  setDeferredPromptForTesting,
  setStandaloneOverrideForTesting,
  hasLoggedFirstActivity,
  markFirstLogCompleted,
  type BeforeInstallPromptEvent,
} from './installPromptStore';

function createMockPromptEvent(): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as any;
  event.platforms = ['web'];
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  return event as BeforeInstallPromptEvent;
}

describe('DeferredInstallPrompt Component', () => {
  beforeEach(() => {
    localStorage.clear();
    resetInstallPromptStoreForTesting();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    resetInstallPromptStoreForTesting();
    localStorage.clear();
  });

  it('becomes eligible and shows prompt when workout_sets query resolves after mount', async () => {
    const queryClient = new QueryClient();
    const mockEvent = createMockPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);

    render(
      <QueryClientProvider client={queryClient}>
        <DeferredInstallPrompt />
      </QueryClientProvider>
    );

    expect(screen.queryByTestId('install-prompt-card')).toBeNull();
    expect(hasLoggedFirstActivity()).toBe(false);

    await act(async () => {
      queryClient.setQueryData(['workout_sets', 'user-1', '2026-10-21'], [
        { id: 'set-1', reps: 10, weight: 100 },
      ]);
    });

    expect(screen.getByTestId('install-prompt-card')).toBeInTheDocument();
    expect(hasLoggedFirstActivity()).toBe(true);
  });

  it('becomes eligible and shows prompt when nutrition_logs query resolves after mount', async () => {
    const queryClient = new QueryClient();
    const mockEvent = createMockPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);

    render(
      <QueryClientProvider client={queryClient}>
        <DeferredInstallPrompt />
      </QueryClientProvider>
    );

    expect(screen.queryByTestId('install-prompt-card')).toBeNull();
    expect(hasLoggedFirstActivity()).toBe(false);

    await act(async () => {
      queryClient.setQueryData(['nutrition_logs', 'user-1'], [
        { id: 'meal-1', food_name: 'Protein Shake', calories: 250 },
      ]);
    });

    expect(screen.getByTestId('install-prompt-card')).toBeInTheDocument();
    expect(hasLoggedFirstActivity()).toBe(true);
  });

  it('does not become eligible when an empty query resolves', async () => {
    const queryClient = new QueryClient();
    const mockEvent = createMockPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);

    render(
      <QueryClientProvider client={queryClient}>
        <DeferredInstallPrompt />
      </QueryClientProvider>
    );

    await act(async () => {
      queryClient.setQueryData(['workout_sets', 'user-1', '2026-10-21'], []);
    });

    expect(screen.queryByTestId('install-prompt-card')).toBeNull();
    expect(hasLoggedFirstActivity()).toBe(false);
  });

  it('does not trigger sync or become eligible when an unrelated query resolves', async () => {
    const queryClient = new QueryClient();
    const mockEvent = createMockPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);

    const getQueriesDataSpy = vi.spyOn(queryClient, 'getQueriesData');

    render(
      <QueryClientProvider client={queryClient}>
        <DeferredInstallPrompt />
      </QueryClientProvider>
    );

    // Initial mount sync calls getQueriesData for workout_sets and nutrition_logs
    expect(getQueriesDataSpy).toHaveBeenCalledTimes(2);
    getQueriesDataSpy.mockClear();

    // Resolving unrelated query keys does NOT trigger sync
    await act(async () => {
      queryClient.setQueryData(['user_profile', 'user-1'], { name: 'Alex' });
      queryClient.setQueryData(['settings', 'preferences'], { darkMode: true });
    });

    expect(getQueriesDataSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('install-prompt-card')).toBeNull();
    expect(hasLoggedFirstActivity()).toBe(false);

    // Resolving a relevant key ('workout_sets') DOES trigger sync
    await act(async () => {
      queryClient.setQueryData(['workout_sets', 'user-1', '2026-10-21'], [
        { id: 'set-1', reps: 10, weight: 100 },
      ]);
    });

    expect(getQueriesDataSpy).toHaveBeenCalled();
    expect(screen.getByTestId('install-prompt-card')).toBeInTheDocument();
    expect(hasLoggedFirstActivity()).toBe(true);
  });

  it('syncs first log immediately on mount if data already in queryClient', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['workout_sets', 'user-1', '2026-10-21'], [
      { id: 'set-1', reps: 5, weight: 120 },
    ]);

    const mockEvent = createMockPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);

    render(
      <QueryClientProvider client={queryClient}>
        <DeferredInstallPrompt />
      </QueryClientProvider>
    );

    expect(hasLoggedFirstActivity()).toBe(true);
    expect(screen.getByTestId('install-prompt-card')).toBeInTheDocument();
  });

  it('skips subscribing to query cache if user has already logged first activity', () => {
    markFirstLogCompleted();
    const queryClient = new QueryClient();
    const cache = queryClient.getQueryCache();
    const subscribeSpy = vi.spyOn(cache, 'subscribe');

    render(
      <QueryClientProvider client={queryClient}>
        <DeferredInstallPrompt />
      </QueryClientProvider>
    );

    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  it('unsubscribes from query cache on unmount', () => {
    const queryClient = new QueryClient();
    const cache = queryClient.getQueryCache();
    let listenerCount = 0;

    const originalSubscribe = cache.subscribe.bind(cache);
    vi.spyOn(cache, 'subscribe').mockImplementation((listener) => {
      listenerCount += 1;
      const unsubscribe = originalSubscribe(listener);
      return () => {
        listenerCount -= 1;
        unsubscribe();
      };
    });

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <DeferredInstallPrompt />
      </QueryClientProvider>
    );

    expect(listenerCount).toBe(1);

    unmount();

    expect(listenerCount).toBe(0);
  });

  it('unsubscribes from query cache once first log is detected', async () => {
    const queryClient = new QueryClient();
    const cache = queryClient.getQueryCache();
    let listenerCount = 0;

    const originalSubscribe = cache.subscribe.bind(cache);
    vi.spyOn(cache, 'subscribe').mockImplementation((listener) => {
      listenerCount += 1;
      const unsubscribe = originalSubscribe(listener);
      return () => {
        listenerCount -= 1;
        unsubscribe();
      };
    });

    render(
      <QueryClientProvider client={queryClient}>
        <DeferredInstallPrompt />
      </QueryClientProvider>
    );

    expect(listenerCount).toBe(1);

    await act(async () => {
      queryClient.setQueryData(['workout_sets', 'user-1', '2026-10-21'], [
        { id: 'set-1', reps: 10, weight: 100 },
      ]);
    });

    expect(listenerCount).toBe(0);
  });

  it('does not show prompt in standalone mode even when queries resolve', async () => {
    const queryClient = new QueryClient();
    const mockEvent = createMockPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(true);

    render(
      <QueryClientProvider client={queryClient}>
        <DeferredInstallPrompt />
      </QueryClientProvider>
    );

    await act(async () => {
      queryClient.setQueryData(['workout_sets', 'user-1', '2026-10-21'], [
        { id: 'set-1', reps: 10, weight: 100 },
      ]);
    });

    expect(hasLoggedFirstActivity()).toBe(true);
    expect(screen.queryByTestId('install-prompt-card')).toBeNull();
  });
});
