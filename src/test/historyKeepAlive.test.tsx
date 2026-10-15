import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { createSupabaseBuilder, clearMockHistory } from './supabaseBuilderMock';

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    user: { id: 'test-user-id', email: 'coach@yourbody.fyi' },
  },
}));

let historyMountCount = 0;
let workoutMountCount = 0;
let nutritionMountCount = 0;

vi.mock('../components/history/HistoryView', () => ({
  HistoryView: () => {
    const [count, setCount] = useState(() => {
      historyMountCount++;
      return 0;
    });
    return (
      <div data-testid="mock-history-view">
        <h1>Workout History</h1>
        <span data-testid="history-counter">{count}</span>
        <button
          type="button"
          data-testid="history-increment-btn"
          onClick={() => setCount((c) => c + 1)}
        >
          Increment
        </button>
      </div>
    );
  },
}));

vi.mock('../components/workout/WorkoutEngine', () => ({
  WorkoutEngine: () => {
    useState(() => {
      workoutMountCount++;
      return 0;
    });
    return (
      <div data-testid="mock-workout-view">
        <h1>Workout Engine</h1>
      </div>
    );
  },
}));

vi.mock('../components/nutrition/NutritionEngine', () => ({
  NutritionEngine: () => {
    useState(() => {
      nutritionMountCount++;
      return 0;
    });
    return (
      <div data-testid="mock-nutrition-view">
        <h1>Nutrition Engine</h1>
      </div>
    );
  },
}));

let authCallback: any = null;

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockImplementation((cb: any) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

describe('History Keep-Alive Shell', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    localStorage.clear();
    window.history.pushState({}, '', '/');
    historyMountCount = 0;
    workoutMountCount = 0;
    nutritionMountCount = 0;

    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: 'test-user-id' } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });

    const mockUser = {
      id: 'test-user-id',
      email: 'coach@yourbody.fyi',
      username: 'Coach Demo',
      role: 'athlete',
      target_calories: 2400,
      target_protein: 180,
      target_carbs: 240,
      target_fat: 70,
      target_fiber: 30,
    };

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'users') {
        return createSupabaseBuilder('users', mockUser);
      }
      return createSupabaseBuilder(table, []);
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('(a) History is NOT mounted before first visit (no history query fired on /workout)', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('mock-workout-view', {}, { timeout: 10000 })).toBeDefined();

    expect(screen.queryByTestId('mock-history-view')).toBeNull();
    expect(historyMountCount).toBe(0);

    const nutritionTab = await screen.findByTestId('nav-nutrition', {}, { timeout: 10000 });
    fireEvent.click(nutritionTab);

    expect(await screen.findByTestId('mock-nutrition-view', {}, { timeout: 10000 })).toBeDefined();

    expect(screen.queryByTestId('mock-history-view')).toBeNull();
    expect(historyMountCount).toBe(0);
  }, 15000);

  it('(b) state inside History survives /history -> /workout -> /history (mock HistoryView lazily with a counter component: counter keeps value, mount count 1)', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('mock-workout-view', {}, { timeout: 10000 })).toBeDefined();

    // Navigate to /history
    const historyTab = await screen.findByTestId('nav-history', {}, { timeout: 10000 });
    fireEvent.click(historyTab);

    expect(await screen.findByTestId('mock-history-view', {}, { timeout: 10000 })).toBeDefined();

    expect(historyMountCount).toBe(1);
    expect(screen.getByTestId('history-counter').textContent).toBe('0');

    // Increment counter in History
    fireEvent.click(screen.getByTestId('history-increment-btn'));
    fireEvent.click(screen.getByTestId('history-increment-btn'));
    expect(screen.getByTestId('history-counter').textContent).toBe('2');

    // Navigate to /workout
    const workoutTab = await screen.findByTestId('nav-workout', {}, { timeout: 10000 });
    fireEvent.click(workoutTab);

    expect(await screen.findByTestId('mock-workout-view', {}, { timeout: 10000 })).toBeDefined();

    // Navigate back to /history
    const historyTabAgain = await screen.findByTestId('nav-history', {}, { timeout: 10000 });
    fireEvent.click(historyTabAgain);

    expect(await screen.findByTestId('mock-history-view', {}, { timeout: 10000 })).toBeDefined();

    // State preserved and mount count remains 1
    expect(screen.getByTestId('history-counter').textContent).toBe('2');
    expect(historyMountCount).toBe(1);
  }, 15000);

  it('(c) Workout/Nutrition remount normally (mount count increments)', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('mock-workout-view', {}, { timeout: 10000 })).toBeDefined();
    expect(workoutMountCount).toBe(1);

    // Navigate to /history
    const historyTab = await screen.findByTestId('nav-history', {}, { timeout: 10000 });
    fireEvent.click(historyTab);
    expect(await screen.findByTestId('mock-history-view', {}, { timeout: 10000 })).toBeDefined();

    // Navigate back to /workout
    const workoutTab = await screen.findByTestId('nav-workout', {}, { timeout: 10000 });
    fireEvent.click(workoutTab);
    expect(await screen.findByTestId('mock-workout-view', {}, { timeout: 10000 })).toBeDefined();
    expect(workoutMountCount).toBe(2);

    // Navigate to /nutrition
    const nutritionTab = await screen.findByTestId('nav-nutrition', {}, { timeout: 10000 });
    fireEvent.click(nutritionTab);
    expect(await screen.findByTestId('mock-nutrition-view', {}, { timeout: 10000 })).toBeDefined();
    expect(nutritionMountCount).toBe(1);

    // Navigate back to /workout
    const workoutTabAgain = await screen.findByTestId('nav-workout', {}, { timeout: 10000 });
    fireEvent.click(workoutTabAgain);
    expect(await screen.findByTestId('mock-workout-view', {}, { timeout: 10000 })).toBeDefined();
    expect(workoutMountCount).toBe(3);

    // Navigate back to /nutrition
    const nutritionTabAgain = await screen.findByTestId('nav-nutrition', {}, { timeout: 10000 });
    fireEvent.click(nutritionTabAgain);
    expect(await screen.findByTestId('mock-nutrition-view', {}, { timeout: 10000 })).toBeDefined();
    expect(nutritionMountCount).toBe(2);
  }, 15000);

  it('(d) scroll position restored', async () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('mock-workout-view', {}, { timeout: 10000 })).toBeDefined();

    // Visit /history
    const historyTab = await screen.findByTestId('nav-history', {}, { timeout: 10000 });
    fireEvent.click(historyTab);
    expect(await screen.findByTestId('mock-history-view', {}, { timeout: 10000 })).toBeDefined();

    // Simulate scrolling on /history
    window.scrollY = 350;
    fireEvent.scroll(window);

    // Simulate browser clamping window.scrollY to 0 upon route transition
    window.scrollY = 0;

    // Navigate to /workout
    const workoutTab = await screen.findByTestId('nav-workout', {}, { timeout: 10000 });
    fireEvent.click(workoutTab);
    expect(await screen.findByTestId('mock-workout-view', {}, { timeout: 10000 })).toBeDefined();

    // Navigate back to /history
    const historyTabAgain = await screen.findByTestId('nav-history', {}, { timeout: 10000 });
    fireEvent.click(historyTabAgain);
    expect(await screen.findByTestId('mock-history-view', {}, { timeout: 10000 })).toBeDefined();

    // Scroll position should be restored to 350
    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalledWith(0, 350);
    }, { timeout: 10000 });
  }, 15000);

  it('(e) sign-out unmounts History', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('mock-workout-view', {}, { timeout: 10000 })).toBeDefined();

    // Visit /history and change state
    const historyTab = await screen.findByTestId('nav-history', {}, { timeout: 10000 });
    fireEvent.click(historyTab);
    expect(await screen.findByTestId('mock-history-view', {}, { timeout: 10000 })).toBeDefined();
    expect(historyMountCount).toBe(1);

    fireEvent.click(screen.getByTestId('history-increment-btn'));
    expect(screen.getByTestId('history-counter').textContent).toBe('1');

    // Trigger sign out
    act(() => {
      if (authCallback) {
        authCallback('SIGNED_OUT', null);
      }
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('you@example.com')).toBeDefined();
    }, { timeout: 10000 });

    // HistoryView should be completely unmounted from the DOM
    expect(screen.queryByTestId('mock-history-view')).toBeNull();

    // Sign back in
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: 'test-user-id' } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    act(() => {
      if (authCallback) {
        authCallback('SIGNED_IN', mockSession);
      }
    });

    expect(await screen.findByTestId('mock-workout-view', {}, { timeout: 10000 })).toBeDefined();

    // Before visiting history, history is not mounted
    expect(screen.queryByTestId('mock-history-view')).toBeNull();

    // Visit /history again
    const historyTabAgain = await screen.findByTestId('nav-history', {}, { timeout: 10000 });
    fireEvent.click(historyTabAgain);
    expect(await screen.findByTestId('mock-history-view', {}, { timeout: 10000 })).toBeDefined();

    // New mount count and fresh state
    expect(historyMountCount).toBe(2);
    expect(screen.getByTestId('history-counter').textContent).toBe('0');
  }, 15000);
});
