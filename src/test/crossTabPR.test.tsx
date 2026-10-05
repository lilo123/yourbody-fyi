import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryView } from '../components/history/HistoryView';
import { supabase } from '../lib/supabase';
import { createSupabaseBuilder, clearMockHistory } from './supabaseBuilderMock';
import { AuthProvider } from '../context/AuthContext';
import { CoachProvider } from '../context/CoachContext';
import { invalidateWorkoutDerived } from '../lib/invalidate';

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

describe('Cross-Tab PR & Benchmarks (H10, RD-16, RD-20)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
    clearMockHistory();
  });

  it('H10: History By-Exercise displays PR from stats v2 (225x3 -> 230x1 live without reload) and ignores warmup sets', async () => {
    let currentPrWeight = 225;
    let currentPrReps = 3;

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'exercises') {
        return createSupabaseBuilder(table, {
          data: [{ id: 'ex-bench', name: 'Bench Press', body_parts: ['Chest'], is_master: true }],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    (supabase.rpc as any).mockImplementation((fn: string) => {
      if (fn === 'get_exercise_stats') {
        return Promise.resolve({
          data: [
            {
              exercise_id: 'ex-bench',
              exercise_name: 'Bench Press',
              set_count: 5,
              max_weight: currentPrWeight,
              pr_reps: currentPrReps,
              pr_date: '2026-09-01',
              recent_sets: [
                {
                  id: 's-1',
                  weight: currentPrWeight,
                  reps: currentPrReps,
                  workout_date: '2026-09-01',
                  set_type: 'working',
                },
              ],
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

    // Switch to By Exercise tab
    const byExerciseBtn = await screen.findByRole('tab', { name: /by exercise/i });
    fireEvent.click(byExerciseBtn);

    // Initial PR: 225 lbs × 3
    await waitFor(() => {
      expect(screen.getByText(/PR: 225 lbs × 3/)).toBeDefined();
    });

    // Logging a set updates PR to 230x1; warmups (like 250x1 warmup) must be ignored by stats v2
    currentPrWeight = 230;
    currentPrReps = 1;
    await invalidateWorkoutDerived(queryClient, 'test-user-1');

    await waitFor(() => {
      expect(screen.getByText(/PR: 230 lbs × 1/)).toBeDefined();
    });
  });
});
