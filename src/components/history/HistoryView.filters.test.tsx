import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryView } from './HistoryView';
import { AuthProvider } from '../../context/AuthContext';
import { CoachProvider } from '../../context/CoachContext';
import * as workoutHistoryModule from './useWorkoutHistory';
import {
  createSupabaseBuilder,
  getRecordedSelects,
  clearMockHistory,
} from '../../test/supabaseBuilderMock';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const { mockUser, mockSession } = vi.hoisted(() => {
  const user = { id: 'user-filter-test-1', email: 'filter@test.com' };
  return {
    mockUser: user,
    mockSession: { user },
  };
});

const mockExercises = [
  { id: 'ex-1', name: 'Barbell Bench Press', body_parts: ['Chest'], is_master: true },
  { id: 'ex-2', name: 'Incline Dumbbell Press', body_parts: ['Chest'], is_master: true },
  { id: 'ex-3', name: 'Barbell Back Squat', body_parts: ['Legs'], is_master: true },
  { id: 'ex-4', name: 'Pull-Up (Café Edition)', body_parts: ['Back'], is_master: true },
];

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'exercises') {
        return createSupabaseBuilder('exercises', { data: mockExercises, error: null });
      }
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', { data: [], error: null });
      }
      if (table === 'users') {
        return createSupabaseBuilder('users', { data: [mockUser], error: null });
      }
      if (table === 'coach_athlete_links') {
        return createSupabaseBuilder('coach_athlete_links', { data: [], error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    }),
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'get_exercise_stats') {
        return Promise.resolve({
          data: [
            {
              exercise_id: 'ex-1',
              exercise_name: 'Barbell Bench Press',
              set_count: 12,
              max_weight: 225,
              pr_reps: 8,
              recent_sets: [{ weight: 225, reps: 8, workout_date: '2026-09-01' }],
            },
            {
              exercise_id: 'ex-4',
              exercise_name: 'Pull-Up (Café Edition)',
              set_count: 5,
              max_weight: 0,
              pr_reps: 10,
              recent_sets: [{ weight: 0, reps: 10, workout_date: '2026-08-20' }],
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe('HistoryView Filters & Range Integration', () => {
  let queryClient: QueryClient;
  let mockHookReturn: any;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    mockHookReturn = {
      sessions: [
        {
          id: 'sess-1',
          date: '2026-09-20',
          civil_date: '2026-09-20',
          name: 'Heavy Chest Day',
          set_count: 5,
          total_volume: 12500,
          sets: [],
        },
        {
          id: 'sess-2',
          date: '2026-09-10',
          civil_date: '2026-09-10',
          name: 'Leg Day Volume',
          set_count: 8,
          total_volume: 24000,
          sets: [],
        },
      ],
      totalCount: 15,
      hasMore: true,
      loadMore: vi.fn(),
      isLoadingMore: false,
      loadMoreError: null,
      isSessionsPending: false,
      isSessionsError: false,
      sessionsError: null,
      refetchSessions: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      isDeletingSession: false,
    };

    vi.spyOn(workoutHistoryModule, 'useWorkoutHistory').mockImplementation((_targetUserId, _range, _userTimeZone) => {
      return {
        ...mockHookReturn,
      };
    });
  });

  const renderComponent = () =>
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

  describe('Date Range Chips', () => {
    it('services expected database query contracts for exercises, sets, nutrition, and user profile', async () => {
      renderComponent();
      await waitFor(() => {
        expect(getRecordedSelects()).toContainEqual({
          table: 'exercises',
          projection: 'id, name, body_parts, is_master',
        });
      });
      await waitFor(() => {
        expect(getRecordedSelects()).toContainEqual({
          table: 'users',
          projection:
            'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
        });
      });
      await waitFor(() => {
        expect(getRecordedSelects()).toContainEqual({
          table: 'nutrition_logs',
          projection:
            'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
        });
      });
      await waitFor(() => {
        expect(getRecordedSelects()).toContainEqual({
          table: 'sets',
          projection: 'id, workout_id, exercise_id, weight, reps, set_index, created_at, rpe, set_type',
        });
      });
    });

    it('renders 4 date range chips (All, 1Y, 90D, 30D) with touch targets and aria-pressed', () => {
      renderComponent();

      const chipAll = screen.getByTestId('history-range-all');
      const chip1Y = screen.getByRole('button', { name: '1Y' });
      const chip90D = screen.getByRole('button', { name: '90D' });
      const chip30D = screen.getByRole('button', { name: '30D' });

      expect(chipAll).toBeDefined();
      expect(chip1Y).toBeDefined();
      expect(chip90D).toBeDefined();
      expect(chip30D).toBeDefined();

      // "All" is active by default
      expect(chipAll).toHaveAttribute('aria-pressed', 'true');
      expect(chip1Y).toHaveAttribute('aria-pressed', 'false');
      expect(chip90D).toHaveAttribute('aria-pressed', 'false');
      expect(chip30D).toHaveAttribute('aria-pressed', 'false');

      // Touch target min-h-[44px]
      expect(chipAll.className).toContain('min-h-[44px]');
      expect(chip1Y.className).toContain('min-h-[44px]');
      expect(chip90D.className).toContain('min-h-[44px]');
      expect(chip30D.className).toContain('min-h-[44px]');
    });

    it('clicking range chip updates aria-pressed and drives hook range argument', async () => {
      const hookSpy = vi.spyOn(workoutHistoryModule, 'useWorkoutHistory');
      renderComponent();

      // Wait for auth to settle
      await waitFor(() => {
        expect(hookSpy).toHaveBeenCalledWith(mockUser.id, 'all', undefined);
      });

      // Click 30D chip
      const chip30D = screen.getByRole('button', { name: '30D' });
      fireEvent.click(chip30D);

      expect(chip30D).toHaveAttribute('aria-pressed', 'true');
      const chipAll = screen.getByTestId('history-range-all');
      expect(chipAll).toHaveAttribute('aria-pressed', 'false');

      // Hook was called with '30d' range
      await waitFor(() => {
        expect(hookSpy).toHaveBeenLastCalledWith(
          mockUser.id,
          '30d',
          undefined
        );
      });
    });

    it('hides date range chips and displays All-time stats caption in By Exercise view', async () => {
      renderComponent();

      // In session view, date chips exist
      expect(screen.getByTestId('history-range-all')).toBeDefined();
      expect(screen.queryByText(/All-time stats/i)).toBeNull();

      // Switch to By Exercise
      const exerciseTab = screen.getByRole('tab', { name: /By Exercise/i });
      fireEvent.click(exerciseTab);

      // Range chips should not be present
      expect(screen.queryByRole('button', { name: '30D' })).toBeNull();
      // "All-time stats" caption must be visible
      expect(screen.getByText(/All-time stats/i)).toBeDefined();
    });
  });

  describe('Session Count and keystone Pagination', () => {
    it('displays Showing N of M sessions counter when totalCount is provided', () => {
      renderComponent();

      expect(screen.getByText('Showing 2 of 15 sessions')).toBeDefined();
    });

    it('renders Load More Sessions button when hasMore is true and invokes loadMore on click', () => {
      renderComponent();

      const loadMoreBtn = screen.getByTestId('load-more-sessions-btn');
      expect(loadMoreBtn).toBeDefined();
      expect(loadMoreBtn.className).toContain('min-h-[44px]');

      fireEvent.click(loadMoreBtn);
      expect(mockHookReturn.loadMore).toHaveBeenCalledTimes(1);
    });

    it('hides Load More button when hasMore is false', () => {
      mockHookReturn.hasMore = false;
      renderComponent();

      expect(screen.queryByTestId('load-more-sessions-btn')).toBeNull();
    });
  });

  describe('Search & Category Filtering in By Exercise', () => {
    it('folds diacritics, case, and whitespace in exercise search query (normalizeSearch)', async () => {
      renderComponent();

      // Switch to By Exercise
      fireEvent.click(screen.getByRole('tab', { name: /By Exercise/i }));

      // Wait for exercises to render
      expect(await screen.findByText('Pull-Up (Café Edition)')).toBeDefined();

      const searchInput = screen.getByPlaceholderText(/search/i);

      // Search with folded diacritics and uppercase: "CAFE" matches "Café"
      fireEvent.change(searchInput, { target: { value: '  CAFE  ' } });

      expect(screen.getByText('Pull-Up (Café Edition)')).toBeDefined();
      expect(screen.queryByText('Barbell Bench Press')).toBeNull();
    });

    it('filters exercises by category and exposes aria-pressed on category chips', async () => {
      renderComponent();

      fireEvent.click(screen.getByRole('tab', { name: /By Exercise/i }));

      expect(await screen.findByText('Barbell Bench Press')).toBeDefined();

      // Find category chip "Back"
      const backChip = screen.getByRole('button', { name: 'Back' });
      expect(backChip).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(backChip);

      expect(backChip).toHaveAttribute('aria-pressed', 'true');
      // Bench press (Chest) is excluded, Pull-Up (Back) remains
      expect(screen.queryByText('Barbell Bench Press')).toBeNull();
      expect(screen.getByText('Pull-Up (Café Edition)')).toBeDefined();
    });
  });

  describe('Empty States and Skeletons', () => {
    it('renders 3 skeleton cards while isSessionsPending is true', () => {
      mockHookReturn.isSessionsPending = true;
      mockHookReturn.sessions = [];
      const { container } = renderComponent();

      expect(screen.queryByText(/No workout sessions recorded/i)).toBeNull();
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThanOrEqual(1);
    });

    it('shows Clear filters button when range is active and 0 sessions return', () => {
      mockHookReturn.sessions = [];
      mockHookReturn.totalCount = 0;
      mockHookReturn.hasMore = false;
      renderComponent();

      // Select 30D chip
      fireEvent.click(screen.getByRole('button', { name: '30D' }));

      expect(screen.getByText(/No workout sessions recorded in this time range/i)).toBeDefined();
      const clearBtn = screen.getByRole('button', { name: /Clear filters/i });
      expect(clearBtn).toBeDefined();

      // Clicking Clear filters resets to 'all'
      fireEvent.click(clearBtn);
      const chipAll = screen.getByTestId('history-range-all');
      expect(chipAll).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows Start a workout primary CTA navigating to /workout when all history is empty', async () => {
      mockHookReturn.sessions = [];
      mockHookReturn.totalCount = 0;
      mockHookReturn.hasMore = false;
      renderComponent();

      expect(await screen.findByText(/No workout sessions recorded yet/i)).toBeDefined();
      const startBtn = screen.getByRole('button', { name: /Start a workout/i });
      expect(startBtn).toBeDefined();

      fireEvent.click(startBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/workout');
    });
  });
});
