import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryView } from '../components/history/HistoryView';
import { AuthProvider } from '../context/AuthContext';
import { CoachProvider } from '../context/CoachContext';
import { CoachContext, type CoachContextType } from '../context/CoachContextTypes';
import { supabase } from '../lib/supabase';
import { createSupabaseBuilder, clearMockHistory } from './supabaseBuilderMock';
import { onSynced } from '../offline';
import { invalidateWorkoutDerived, invalidateNutritionDerived } from '../lib/invalidate';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const { syncCallbacks, mockUnsubscribes, mockUser, mockSession } = vi.hoisted(() => {
  const user = { id: 'test-user-sync-1', email: 'athlete@example.com' };
  return {
    syncCallbacks: [] as Array<(count: number) => void>,
    mockUnsubscribes: [] as Array<ReturnType<typeof vi.fn>>,
    mockUser: user,
    mockSession: { user },
  };
});

vi.mock('../offline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../offline')>();
  return {
    ...actual,
    onSynced: vi.fn((cb: (count: number) => void) => {
      syncCallbacks.push(cb);
      const unsub = vi.fn();
      mockUnsubscribes.push(unsub);
      return unsub;
    }),
  };
});

vi.mock('../lib/invalidate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/invalidate')>();
  return {
    ...actual,
    invalidateWorkoutDerived: vi.fn(actual.invalidateWorkoutDerived),
    invalidateNutritionDerived: vi.fn(actual.invalidateNutritionDerived),
  };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockImplementation((table: string) => {
      return createSupabaseBuilder(table, { data: [], error: null });
    }),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe('HistoryView onSynced subscription', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
    clearMockHistory();
    syncCallbacks.length = 0;
    mockUnsubscribes.length = 0;
    localStorage.setItem('yourbody_user', JSON.stringify(mockUser));
  });

  it('subscribes to onSynced on mount and unregisters on unmount', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: [], error: null });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/history']}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <CoachProvider>
              <HistoryView />
            </CoachProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(onSynced).toHaveBeenCalled();
    });

    expect(syncCallbacks.length).toBeGreaterThan(0);

    unmount();

    expect(mockUnsubscribes.some((fn) => fn.mock.calls.length > 0)).toBe(true);
  });

  it('invalidates workout and nutrition caches for target user when onSynced fires', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: [], error: null });

    render(
      <MemoryRouter initialEntries={['/history']}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <CoachProvider>
              <HistoryView />
            </CoachProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(onSynced).toHaveBeenCalled();
    });

    // Fire the onSynced callback as if the outbox flusher just finished
    for (const cb of syncCallbacks) {
      cb(2);
    }

    expect(invalidateWorkoutDerived).toHaveBeenCalledWith(queryClient, 'test-user-sync-1');
    expect(invalidateNutritionDerived).toHaveBeenCalledWith(queryClient, 'test-user-sync-1');
  });

  it('invalidates with selectedAthleteId when coach is inspecting athlete', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: [], error: null });

    const coachUser = { id: 'coach-id-1', email: 'coach@example.com', role: 'coach' as const, is_coach_mode: true };
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: coachUser } } as any);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { user: coachUser } } } as any);
    localStorage.setItem('yourbody_user', JSON.stringify(coachUser));

    const mockCoachContextValue: CoachContextType = {
      isCoach: true,
      selectedAthleteId: 'athlete-inspected-42',
      selectedAthlete: {
        id: 'athlete-inspected-42',
        name: 'Alex Athlete',
        email: 'athlete@example.com',
        timezone: 'America/New_York',
      },
      athletes: [],
      switchAthlete: vi.fn(),
      refreshAthletes: vi.fn().mockResolvedValue(undefined),
    };

    render(
      <MemoryRouter initialEntries={['/history']}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <CoachContext.Provider value={mockCoachContextValue}>
              <HistoryView />
            </CoachContext.Provider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(onSynced).toHaveBeenCalled();
    });

    for (const cb of syncCallbacks) {
      cb(1);
    }

    expect(invalidateWorkoutDerived).toHaveBeenCalledWith(queryClient, 'athlete-inspected-42');
    expect(invalidateNutritionDerived).toHaveBeenCalledWith(queryClient, 'athlete-inspected-42');
  });

  it('refreshes stale sessions without reload when queued changes finish syncing', async () => {
    let sessionCount = 1;
    (supabase.rpc as any).mockImplementation((fn: string) => {
      if (fn === 'get_history_sessions_v2') {
        return Promise.resolve({
          data: [
            {
              id: 'sess-sync-1',
              date: '2026-09-01T12:00:00Z',
              civil_date: '2026-09-01',
              name: 'Leg Day',
              set_count: sessionCount,
              total_volume: 1000,
              total_count: 1,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    render(
      <MemoryRouter initialEntries={['/history']}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <CoachProvider>
              <HistoryView />
            </CoachProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('1 sets completed')).toBeDefined();
    });

    // Simulate background sync completing: new session data in DB, onSynced event emitted
    sessionCount = 3;
    for (const cb of syncCallbacks) {
      cb(1);
    }

    await waitFor(() => {
      expect(screen.getByText('3 sets completed')).toBeDefined();
    });
  });
});
