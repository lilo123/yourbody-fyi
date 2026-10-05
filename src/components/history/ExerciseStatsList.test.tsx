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
});
