import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExerciseStatsList, type ExerciseStat } from './ExerciseStatsList';

let mockWeightUnit: 'lb' | 'kg' = 'lb';
let mockPrMode: 'weight' | 'e1rm' = 'weight';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user' },
    profile: { id: 'test-user', weight_unit: mockWeightUnit, pr_mode: mockPrMode },
  }),
}));

describe('ExerciseStatsList (kg-mode & unit display)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockWeightUnit = 'lb';
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const mockExerciseStats: ExerciseStat[] = [
    {
      exercise: { id: 'ex-bench', name: 'Barbell Bench Press', body_parts: ['Chest'] },
      sets: [
        { id: 's1', weight: 225, reps: 5, workout_date: '2026-09-20' },
      ],
      maxWeight: 225,
      prReps: 5,
      setCount: 1,
      prDate: '2026-09-20',
    },
  ];

  it('displays PR line and recent sets in lbs for lb users', () => {
    mockWeightUnit = 'lb';

    render(
      <QueryClientProvider client={queryClient}>
        <ExerciseStatsList
          exerciseStats={mockExerciseStats}
          searchQuery=""
          selectedCategory="All"
          onSearchQueryChange={vi.fn()}
          onSelectedCategoryChange={vi.fn()}
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
        />
      </QueryClientProvider>
    );

    // PR line shows lbs
    expect(screen.getByText(/PR: 225 lbs × 5/)).toBeDefined();
    // Recent set shows lbs
    expect(screen.getByText('225 lbs × 5 reps')).toBeDefined();
  });

  it('displays PR line and recent sets in kg for kg users (225 lb -> 102.1 kg)', () => {
    mockWeightUnit = 'kg';

    render(
      <QueryClientProvider client={queryClient}>
        <ExerciseStatsList
          exerciseStats={mockExerciseStats}
          searchQuery=""
          selectedCategory="All"
          onSearchQueryChange={vi.fn()}
          onSelectedCategoryChange={vi.fn()}
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
        />
      </QueryClientProvider>
    );

    // PR line shows 102.1 kg
    expect(screen.getByText(/PR: 102\.1 kg × 5/)).toBeDefined();
    // Recent set shows 102.1 kg
    expect(screen.getByText('102.1 kg × 5 reps')).toBeDefined();
  });

  it('renders no "e1RM" text anywhere on card when pr_mode is weight', () => {
    mockPrMode = 'weight';

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ExerciseStatsList
          exerciseStats={mockExerciseStats}
          searchQuery=""
          selectedCategory="All"
          onSearchQueryChange={vi.fn()}
          onSelectedCategoryChange={vi.fn()}
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(container.textContent).not.toContain('e1RM');
  });

  it('renders e1RM on badge and keeps title on its own row when pr_mode is e1rm', () => {
    mockPrMode = 'e1rm';

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ExerciseStatsList
          exerciseStats={mockExerciseStats}
          searchQuery=""
          selectedCategory="All"
          onSearchQueryChange={vi.fn()}
          onSelectedCategoryChange={vi.fn()}
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(container.textContent).toContain('e1RM');
    const title = screen.getByRole('heading', { level: 3, name: 'Barbell Bench Press' });
    expect(title).toBeDefined();
    expect(title.className).toContain('break-words');
    expect(title.className).toContain('flex-1');
  });

  it('has accessible name for the search input', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ExerciseStatsList
          exerciseStats={[]}
          searchQuery=""
          selectedCategory="All"
          onSearchQueryChange={vi.fn()}
          onSelectedCategoryChange={vi.fn()}
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
        />
      </QueryClientProvider>
    );
    const searchInput = screen.getByRole('textbox', { name: 'Search exercise library' });
    expect(searchInput).toBeDefined();
    expect(searchInput.getAttribute('aria-label')).toBe('Search exercise library');
  });

  it('draws sparkline chronologically (oldest to newest) when RPC returns recent_sets newest-first', () => {
    const rawExerciseStats = [
      {
        exercise_id: 'ex-bench',
        exercise_name: 'Bench Press',
        set_count: 2,
        max_weight: 225,
        pr_reps: 5,
        pr_date: '2026-10-01',
        // RPC returns recent_sets ordered newest-first:
        recent_sets: [
          { id: 's2', weight: 225, reps: 5, workout_date: '2026-10-01' },
          { id: 's1', weight: 185, reps: 5, workout_date: '2026-09-01' },
        ],
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <ExerciseStatsList
          rawExerciseStats={rawExerciseStats}
          searchQuery=""
          selectedCategory="All"
          onSearchQueryChange={vi.fn()}
          onSelectedCategoryChange={vi.fn()}
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
        />
      </QueryClientProvider>
    );

    // Progression 185 -> 225 must produce sparkline: first 185, last 225
    expect(screen.getByLabelText('Trend: first 185, last 225 over 2 sessions')).toBeDefined();
  });

  it('orders logged exercises by most recent workout date when RPC returns recent_sets newest-first', () => {
    const rawExerciseStats = [
      {
        exercise_id: 'ex-bench',
        exercise_name: 'Bench Press',
        set_count: 2,
        max_weight: 225,
        pr_reps: 5,
        pr_date: '2026-10-20',
        // Most recent workout was 2026-10-20, older was 2026-09-01
        recent_sets: [
          { id: 'b2', weight: 225, reps: 5, workout_date: '2026-10-20' },
          { id: 'b1', weight: 185, reps: 5, workout_date: '2026-09-01' },
        ],
      },
      {
        exercise_id: 'ex-squat',
        exercise_name: 'Squat',
        set_count: 1,
        max_weight: 315,
        pr_reps: 5,
        pr_date: '2026-10-10',
        // Most recent workout was 2026-10-10
        recent_sets: [
          { id: 'sq1', weight: 315, reps: 5, workout_date: '2026-10-10' },
        ],
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <ExerciseStatsList
          rawExerciseStats={rawExerciseStats}
          searchQuery=""
          selectedCategory="All"
          onSearchQueryChange={vi.fn()}
          onSelectedCategoryChange={vi.fn()}
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
        />
      </QueryClientProvider>
    );

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    // Bench Press (performed 2026-10-20) should be before Squat (performed 2026-10-10)
    expect(headings).toEqual(['Bench Press', 'Squat']);
  });

  it('draws sparkline chronologically even when sets are given in oldest-first or shuffled order', () => {
    const rawExerciseStats = [
      {
        exercise_id: 'ex-bench',
        exercise_name: 'Bench Press',
        set_count: 3,
        max_weight: 225,
        pr_reps: 5,
        pr_date: '2026-10-01',
        // Shuffled dates: Sep 15, Oct 1, Sep 1
        recent_sets: [
          { id: 's2', weight: 205, reps: 5, workout_date: '2026-09-15' },
          { id: 's3', weight: 225, reps: 5, workout_date: '2026-10-01' },
          { id: 's1', weight: 185, reps: 5, workout_date: '2026-09-01' },
        ],
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <ExerciseStatsList
          rawExerciseStats={rawExerciseStats}
          searchQuery=""
          selectedCategory="All"
          onSearchQueryChange={vi.fn()}
          onSelectedCategoryChange={vi.fn()}
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(screen.getByLabelText('Trend: first 185, last 225 over 3 sessions')).toBeDefined();
  });

  it('orders logged exercises by latest date even when sets are in oldest-first order', () => {
    const rawExerciseStats = [
      {
        exercise_id: 'ex-bench',
        exercise_name: 'Bench Press',
        set_count: 2,
        max_weight: 225,
        pr_reps: 5,
        pr_date: '2026-10-20',
        // Oldest-first
        recent_sets: [
          { id: 'b1', weight: 185, reps: 5, workout_date: '2026-09-01' },
          { id: 'b2', weight: 225, reps: 5, workout_date: '2026-10-20' },
        ],
      },
      {
        exercise_id: 'ex-squat',
        exercise_name: 'Squat',
        set_count: 1,
        max_weight: 315,
        pr_reps: 5,
        pr_date: '2026-10-10',
        recent_sets: [
          { id: 'sq1', weight: 315, reps: 5, workout_date: '2026-10-10' },
        ],
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <ExerciseStatsList
          rawExerciseStats={rawExerciseStats}
          searchQuery=""
          selectedCategory="All"
          onSearchQueryChange={vi.fn()}
          onSelectedCategoryChange={vi.fn()}
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
        />
      </QueryClientProvider>
    );

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Bench Press', 'Squat']);
  });
});
