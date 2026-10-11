import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryView } from '../components/history/HistoryView';
import { invalidateWorkoutDerived } from '../lib/invalidate';
import { supabase } from '../lib/supabase';
import { createSupabaseBuilder, clearMockHistory } from './supabaseBuilderMock';
import { AuthProvider } from '../context/AuthContext';
import { CoachProvider } from '../context/CoachContext';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => createSupabaseBuilder(table, { data: [], error: null })),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-1' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user-1' } } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe('Cross-Tab Invalidation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
    clearMockHistory();
    localStorage.setItem('yourbody_user', JSON.stringify({ id: 'test-user-1', email: 'test@example.com' }));
  });

  it('logging a set triggers invalidateWorkoutDerived and updates History without reload', async () => {
    let sessionCount = 1;
    (supabase.rpc as any).mockImplementation((fn: string) => {
      if (fn === 'get_history_sessions_v2') {
        return Promise.resolve({
          data: [
            {
              id: 'session-1',
              date: '2026-09-01T12:00:00Z',
              civil_date: '2026-09-01',
              name: 'Legs',
              set_count: sessionCount,
              total_volume: 500,
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

    // Simulate set logged in Workout tab: session count becomes 2
    sessionCount = 2;
    await invalidateWorkoutDerived(queryClient, 'test-user-1');

    await waitFor(() => {
      expect(screen.getByText('2 sets completed')).toBeDefined();
    });
  });
});
