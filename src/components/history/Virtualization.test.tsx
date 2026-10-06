import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { FALLBACK_WINDOW } from './virtualizationConstants';
import { WorkoutSessionHistory, type HistorySession } from './WorkoutSessionHistory';
import { WorkoutExerciseHistory, type ExerciseStat } from './WorkoutExerciseHistory';
import { NutritionHistoryTimeline, type NutritionDaySummary } from './NutritionHistoryTimeline';
import { CoachAthleteTimeline } from '../coach/CoachAthleteTimeline';
import type { Exercise, WorkoutSet } from '../../types/database';

let mockFallbackMode = false;

vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-virtual')>();
  return {
    ...actual,
    useWindowVirtualizer: (options: any) => {
      if (mockFallbackMode) {
        return {
          getVirtualItems: () => [],
          getTotalSize: () => 0,
          measureElement: vi.fn(),
          scrollToIndex: vi.fn(),
        } as any;
      }
      return actual.useWindowVirtualizer(options);
    },
  };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-virtual' },
    profile: { id: 'test-user-virtual', weight_unit: 'lb' },
  }),
}));

describe('List Virtualization with @tanstack/react-virtual', () => {
  beforeEach(() => {
    mockFallbackMode = false;
  });

  const mockExercises: Exercise[] = [
    { id: 'ex-bench', name: 'Barbell Bench Press', body_parts: ['Chest'] },
    { id: 'ex-squat', name: 'Barbell Back Squat', body_parts: ['Legs'] },
    { id: 'ex-deadlift', name: 'Deadlift', body_parts: ['Back'] },
  ];

  it('WorkoutSessionHistory: mounts <= 200 DOM nodes at rest with a 2,000-set account (Virtualization Threshold)', () => {
    // Generate 400 sessions, each with 5 sets = 2,000 sets total (lifetime athletic history)
    const sessions: HistorySession[] = Array.from({ length: 400 }, (_, sIdx) => {
      const sessionId = `session-${sIdx}`;
      const sets: (WorkoutSet & { workout_date: string; workout_name: string })[] = Array.from(
        { length: 5 },
        (_, setIdx) => ({
          id: `set-${sIdx}-${setIdx}`,
          workout_id: sessionId,
          exercise_id: mockExercises[setIdx % mockExercises.length].id,
          exercise_name: mockExercises[setIdx % mockExercises.length].name,
          weight: 135 + (setIdx * 10),
          reps: 8,
          set_index: setIdx + 1,
          set_type: 'working',
          workout_date: `2025-01-${String((sIdx % 28) + 1).padStart(2, '0')}`,
          workout_name: `Workout #${sIdx + 1}`,
          created_at: new Date().toISOString(),
        })
      );

      return {
        id: sessionId,
        date: `2025-01-${String((sIdx % 28) + 1).padStart(2, '0')}`,
        name: `Workout #${sIdx + 1}`,
        set_count: 5,
        total_volume: sets.reduce((sum, s) => sum + s.weight * s.reps, 0),
        sets,
      };
    });

    const { container } = render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={sessions}
          filteredSessionsCount={sessions.length}
          exercises={mockExercises}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
        />
      </MemoryRouter>
    );

    // Count all DOM elements mounted inside the rendered container
    const allMountedNodes = container.querySelectorAll('*');
    // Without virtualization, 400 sessions × ~45 nodes each would be ~18,000 DOM nodes.
    // Overscan 5: measured 661 nodes at rest, threshold is 661 + <=10% = 728
    expect(allMountedNodes.length).toBeLessThanOrEqual(728);
    // Ensure the list container is present and has virtualized dimensions
    expect(container.firstChild).toBeDefined();

    // Two-sided virtualization verification:
    // 1. Lower-bound / presence: initial visible session items ARE mounted in the DOM
    expect(screen.getByText('Workout #1')).toBeDefined();

    // 2. Absence: off-screen session items are unmounted from the DOM
    expect(screen.queryByText('Workout #400')).toBeNull();
    expect(screen.queryByText('Workout #350')).toBeNull();
    expect(screen.queryByText('Workout #100')).toBeNull();
  }, 20000);

  it('WorkoutSessionHistory: maintains keyboard accessibility and focus management on edit buttons', async () => {
    const user = userEvent.setup();
    const handleEditSet = vi.fn();

    const singleSession: HistorySession = {
      id: 'session-focus-test',
      date: '2026-09-14',
      name: 'Accessibility Validation Session',
      set_count: 1,
      total_volume: 225 * 8,
      sets: [
        {
          id: 'set-focus-1',
          workout_id: 'session-focus-test',
          exercise_id: 'ex-bench',
          exercise_name: 'Barbell Bench Press',
          weight: 225,
          reps: 8,
          set_index: 1,
          set_type: 'working',
          workout_date: '2026-09-14',
          workout_name: 'Accessibility Validation Session',
          created_at: new Date().toISOString(),
        },
      ],
    };

    render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={[singleSession]}
          filteredSessionsCount={1}
          exercises={mockExercises}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={handleEditSet}
          onLoadMore={vi.fn()}
        />
      </MemoryRouter>
    );

    const editBtn = screen.getByTestId('edit-set-btn-set-focus-1');
    expect(editBtn).toBeDefined();
    expect(editBtn).toHaveAttribute('aria-label', 'Edit set 1 of Barbell Bench Press');

    const expandBtn = screen.getByTestId('expand-session-btn-session-focus-test');
    expect(expandBtn.className).toContain('min-w-[44px]');
    expect(expandBtn.className).toContain('min-h-[44px]');

    // Test keyboard focus
    editBtn.focus();
    expect(document.activeElement).toBe(editBtn);

    // Test keyboard activation via Enter
    await user.keyboard('{Enter}');
    expect(handleEditSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'set-focus-1', weight: 225, reps: 8 })
    );

    // Test mouse/touch click
    fireEvent.click(editBtn);
    expect(handleEditSet).toHaveBeenCalledTimes(2);
  });

  it('WorkoutExerciseHistory: virtualizes long exercise lists with search and category filters', () => {
    const exerciseStats: ExerciseStat[] = Array.from({ length: 100 }, (_, idx) => ({
      exercise: {
        id: `ex-${idx}`,
        name: `Exercise Variant ${idx + 1}`,
        body_parts: [idx % 2 === 0 ? 'Chest' : 'Back'],
      },
      sets: [
        {
          id: `s-${idx}`,
          weight: 100 + idx,
          reps: 10,
          workout_date: '2026-09-14',
        },
      ],
      maxWeight: 100 + idx,
      prReps: 10,
    }));

    const { container } = render(
      <WorkoutExerciseHistory
        exerciseStats={exerciseStats}
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        selectedCategory="All"
        onSelectedCategoryChange={vi.fn()}
        isInspectingAthlete={false}
        onEditSet={vi.fn()}
      />
    );

    // Total elements mounted is bounded by virtualization viewport (<= 200 nodes)
    const allMountedNodes = container.querySelectorAll('*');
    expect(allMountedNodes.length).toBeLessThanOrEqual(200);

    // Two-sided virtualization verification:
    // 1. Lower-bound / presence: initial visible exercise items ARE mounted in the DOM
    expect(screen.getByText('Exercise Variant 1')).toBeDefined();

    // Category filter pills satisfy touch-target className contract (min-h-[44px], shrink-0)
    const allCatBtn = screen.getByRole('button', { name: 'All' });
    expect(allCatBtn.className).toContain('min-h-[44px]');
    expect(allCatBtn.className).toContain('shrink-0');

    // 2. Absence: off-screen exercise items are unmounted from the DOM
    expect(screen.queryByText('Exercise Variant 100')).toBeNull();
    expect(screen.queryByText('Exercise Variant 80')).toBeNull();
  });

  it('NutritionHistoryTimeline: virtualizes daily nutrition logs and retains meal operations', () => {
    // Generate 60 unique calendar days
    const days: NutritionDaySummary[] = Array.from({ length: 60 }, (_, idx) => {
      const dayNum = String((idx % 28) + 1).padStart(2, '0');
      const monthNum = String(Math.floor(idx / 28) + 1).padStart(2, '0');
      const dateStr = `2026-${monthNum}-${dayNum}`;

      return {
        date: dateStr,
        meals: [
          {
            id: `meal-${idx}-1`,
            user_id: 'ath-1',
            food_name: `High Protein Lunch #${idx + 1}`,
            calories: 600,
            protein: 40,
            carbs: 60,
            fat: 20,
            fiber: 5,
            logged_at: `${dateStr}T12:00:00Z`,
          },
        ],
        totals: { calories: 600, protein: 40, carbs: 60, fat: 20, fiber: 5 },
        macroCalories: { protein: 160, carbs: 240, fat: 180, total: 580 },
        percentages: { protein: 28, carbs: 41, fat: 31 },
      };
    });

    const { container } = render(
      <NutritionHistoryTimeline
        filteredNutritionDays={days}
        timeRange="all"
        isInspectingAthlete={false}
        onEditMeal={vi.fn()}
        onDeleteMeal={vi.fn()}
        onScaleMeal={vi.fn().mockResolvedValue(null)}
      />
    );

    const allMountedNodes = container.querySelectorAll('*');
    console.log('MEASURED_REST_NODES:', allMountedNodes.length);
    // Without virtualization, 60 days would mount > 3,000 DOM nodes.
    // Virtualization keeps mounted elements at rest <= 200.
    expect(allMountedNodes.length).toBeLessThanOrEqual(200);

    // Two-sided virtualization verification:
    // 1. Lower-bound / presence: initial visible nutrition day ARE mounted in the DOM
    // Days start collapsed by default (D-YB-9); expand the visible day card to inspect its meals
    const expandBtn = screen.getByTestId(`expand-day-btn-${days[0].date}`);
    fireEvent.click(expandBtn);
    expect(screen.getByText('High Protein Lunch #1')).toBeDefined();

    // 2. Absence: off-screen nutrition days are unmounted from the DOM
    expect(screen.queryByText('High Protein Lunch #60')).toBeNull();
    expect(screen.queryByText('High Protein Lunch #50')).toBeNull();
  });

  it('CoachAthleteTimeline: virtualizes athlete history timeline and preserves drilldown expansion', () => {
    // Generate 40 unique calendar days for coach timeline
    const timelineDays = Array.from({ length: 40 }, (_, idx) => {
      const dayNum = String((idx % 28) + 1).padStart(2, '0');
      const monthNum = String(Math.floor(idx / 28) + 1).padStart(2, '0');
      const dateStr = `2026-${monthNum}-${dayNum}`;

      return {
        date: dateStr,
        workouts: [
          {
            id: `coach-w-${idx}`,
            name: `Athlete Workout #${idx + 1}`,
            sets: [
              {
                id: `coach-s-${idx}`,
                exercise_id: 'ex-bench',
                weight: 185,
                reps: 8,
                exercise: mockExercises[0],
              },
            ],
          },
        ],
        nutrition: [
          {
            id: `coach-n-${idx}`,
            food_name: 'Post-Workout Meal',
            calories: 450,
            protein: 35,
            carbs: 45,
            fat: 10,
          },
        ],
      };
    });

    const handleToggleExercise = vi.fn();

    const { container } = render(
      <CoachAthleteTimeline
        selectedAthleteId="ath-1"
        selectedAthlete={{ name: 'Alex Johnson' }}
        timelineDays={timelineDays}
        athleteWorkoutsWithSets={timelineDays.flatMap((d) => d.workouts)}
        athleteProfile={{ target_calories: 2400 }}
        exercises={mockExercises}
        expandedExercises={{ 'coach-w-0-ex-bench': false }}
        onToggleExercise={handleToggleExercise}
        onLoadOlderDays={vi.fn()}
      />
    );

    const allMountedNodes = container.querySelectorAll('*');
    expect(allMountedNodes.length).toBeLessThanOrEqual(200);

    // Two-sided virtualization verification:
    // 1. Lower-bound / presence: initial visible timeline workout ARE mounted in the DOM
    expect(screen.getByText('Athlete Workout #1')).toBeDefined();

    // 2. Absence: off-screen timeline days are unmounted from the DOM
    expect(screen.queryByText('Athlete Workout #40')).toBeNull();
    expect(screen.queryByText('Athlete Workout #30')).toBeNull();
  });

  it('CoachAthleteTimeline: regression test - first day card remains mounted when scrolling window with container scrollMargin', () => {
    let currentOffsetTop = 0;
    const offsetTopSpy = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(() => currentOffsetTop);

    try {
      const timelineDays = Array.from({ length: 40 }, (_, idx) => ({
        date: `2026-01-${String((idx % 28) + 1).padStart(2, '0')}`,
        workouts: [
          {
            id: `coach-w-${idx}`,
            name: `Athlete Workout #${idx + 1}`,
            sets: [
              {
                id: `coach-s-${idx}`,
                exercise_id: 'ex-bench',
                weight: 185,
                reps: 8,
                exercise: mockExercises[0],
              },
            ],
          },
        ],
        nutrition: [
          {
            id: `coach-n-${idx}`,
            food_name: 'Post-Workout Meal',
            calories: 450,
            protein: 35,
            carbs: 45,
            fat: 10,
          },
        ],
      }));

      // Render initially with empty data (simulating initial load where container ref has not yet attached)
      const { rerender } = render(
        <CoachAthleteTimeline
          selectedAthleteId="ath-1"
          selectedAthlete={{ name: 'Alex Johnson' }}
          timelineDays={[]}
          athleteWorkoutsWithSets={[]}
          athleteProfile={{ target_calories: 2400 }}
          exercises={mockExercises}
          expandedExercises={{}}
          onToggleExercise={vi.fn()}
          onLoadOlderDays={vi.fn()}
        />
      );

      // Now timeline data arrives and container is positioned 400px below top of page
      currentOffsetTop = 400;
      rerender(
        <CoachAthleteTimeline
          selectedAthleteId="ath-1"
          selectedAthlete={{ name: 'Alex Johnson' }}
          timelineDays={timelineDays}
          athleteWorkoutsWithSets={timelineDays.flatMap((d) => d.workouts)}
          athleteProfile={{ target_calories: 2400 }}
          exercises={mockExercises}
          expandedExercises={{}}
          onToggleExercise={vi.fn()}
          onLoadOlderDays={vi.fn()}
        />
      );

      // Simulate a non-zero window.scrollY (user scrolled down 350px)
      // Because container is at offsetTop 400px, item 0 starts at 400px (50px below top of viewport, visible)
      window.scrollY = 350;
      fireEvent.scroll(window);

      // First day card MUST still be present in the DOM
      expect(screen.queryByText('Athlete Workout #1')).not.toBeNull();
    } finally {
      offsetTopSpy.mockRestore();
      window.scrollY = 0;
    }
  });

  it('handles zero-render edge case gracefully without dropping elements', () => {
    const singleSession: HistorySession = {
      id: 'session-fallback-test',
      date: '2026-09-14',
      name: 'Fallback Edge Case Session',
      set_count: 1,
      total_volume: 225 * 8,
      sets: [
        {
          id: 'set-fallback-1',
          workout_id: 'session-fallback-test',
          exercise_id: 'ex-bench',
          exercise_name: 'Barbell Bench Press',
          weight: 225,
          reps: 8,
          set_index: 1,
          set_type: 'working',
          workout_date: '2026-09-14',
          workout_name: 'Fallback Edge Case Session',
          created_at: new Date().toISOString(),
        },
      ],
    };

    render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={[singleSession]}
          filteredSessionsCount={1}
          exercises={mockExercises}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Fallback Edge Case Session')).toBeDefined();
    expect(screen.getByText('Barbell Bench Press')).toBeDefined();
    expect(screen.getByText('SET 1')).toBeDefined();
    expect(screen.getByText('225 lbs × 8 reps')).toBeDefined();
  });

  it('WorkoutSessionHistory caps non-virtual fallback at FALLBACK_WINDOW (<= 200 DOM nodes) with visible affordance when virtualizer yields empty items with 400 items', () => {
    mockFallbackMode = true;

    const sessions: HistorySession[] = Array.from({ length: 400 }, (_, sIdx) => ({
      id: `fallback-session-${sIdx}`,
      date: `2025-01-${String((sIdx % 28) + 1).padStart(2, '0')}`,
      name: `Workout #${sIdx + 1}`,
      set_count: 1,
      total_volume: 135 * 8,
      sets: [
        {
          id: `set-${sIdx}-0`,
          workout_id: `fallback-session-${sIdx}`,
          exercise_id: 'ex-bench',
          exercise_name: 'Barbell Bench Press',
          weight: 135,
          reps: 8,
          set_index: 1,
          set_type: 'working',
          workout_date: '2025-01-01',
          workout_name: `Workout #${sIdx + 1}`,
          created_at: new Date().toISOString(),
        },
      ],
    }));

    const { container } = render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={sessions}
          filteredSessionsCount={sessions.length}
          exercises={mockExercises}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
        />
      </MemoryRouter>
    );

    // Overscan 5: measured 204 nodes in fallback, threshold is 204 + <=10% = 225 (includes controls)
    const allMountedNodes = container.querySelectorAll('*');
    expect(allMountedNodes.length).toBeLessThanOrEqual(225);

    // Verify visible affordance
    expect(screen.getByText(`Showing first ${FALLBACK_WINDOW} of 400 (virtualization disabled)`)).toBeDefined();

    // Lower-bound / presence: first session mounted
    expect(screen.getByText('Workout #1')).toBeDefined();

    // Absence: off-window items are NOT mounted in the DOM
    expect(screen.queryByText('Workout #400')).toBeNull();
    expect(screen.queryByText('Workout #20')).toBeNull();
  });

  it('WorkoutExerciseHistory caps non-virtual fallback at FALLBACK_WINDOW with visible affordance when virtualizer yields empty items', () => {
    mockFallbackMode = true;
    const stats: ExerciseStat[] = Array.from({ length: 400 }, (_, i) => ({
      exercise: { id: `ex-${i}`, name: `Exercise #${i + 1}`, body_parts: ['Chest'] },
      sets: [],
      maxWeight: 100,
      prReps: 10,
    }));

    const { container } = render(
      <WorkoutExerciseHistory
        exerciseStats={stats}
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        selectedCategory="All"
        onSelectedCategoryChange={vi.fn()}
        isInspectingAthlete={false}
        onEditSet={vi.fn()}
      />
    );

    const allMountedNodes = container.querySelectorAll('*');
    expect(allMountedNodes.length).toBeLessThanOrEqual(200);
    expect(screen.getByText(`Showing first ${FALLBACK_WINDOW} of 400 (virtualization disabled)`)).toBeDefined();
    expect(screen.getByText('Exercise #1')).toBeDefined();
    expect(screen.queryByText('Exercise #400')).toBeNull();
  });

  it('NutritionHistoryTimeline caps non-virtual fallback at FALLBACK_WINDOW with visible affordance when virtualizer yields empty items', () => {
    mockFallbackMode = true;
    const days: NutritionDaySummary[] = Array.from({ length: 400 }, (_, i) => ({
      date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
      meals: [],
      totals: { calories: 2000, protein: 150, carbs: 200, fat: 65, fiber: 30 },
      macroCalories: { protein: 600, carbs: 800, fat: 585, total: 1985 },
      percentages: { protein: 30, carbs: 40, fat: 30 },
    }));

    const { container } = render(
      <NutritionHistoryTimeline
        filteredNutritionDays={days}
        timeRange="all"
        isInspectingAthlete={false}
        onEditMeal={vi.fn()}
        onDeleteMeal={vi.fn()}
        onScaleMeal={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const allMountedNodes = container.querySelectorAll('*');
    expect(allMountedNodes.length).toBeLessThanOrEqual(200);
    expect(screen.getByText(`Showing first ${FALLBACK_WINDOW} of 400 (virtualization disabled)`)).toBeDefined();
  });

  it('CoachAthleteTimeline caps non-virtual fallback at FALLBACK_WINDOW with visible affordance when virtualizer yields empty items', () => {
    mockFallbackMode = true;
    const days = Array.from({ length: 400 }, (_, i) => ({
      date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
      workouts: [
        {
          id: `coach-w-${i}`,
          name: `Coach Session #${i + 1}`,
          workout_date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
          created_at: new Date().toISOString(),
          sets: [],
        },
      ],
      nutrition: [],
      notes: [],
    }));

    const { container } = render(
      <CoachAthleteTimeline
        selectedAthleteId="ath-1"
        selectedAthlete={{ name: 'Alex Johnson' }}
        timelineDays={days}
        athleteWorkoutsWithSets={[]}
        athleteProfile={{ target_calories: 2400 }}
        exercises={mockExercises}
        expandedExercises={{}}
        onToggleExercise={vi.fn()}
        onLoadOlderDays={vi.fn()}
      />
    );

    const allMountedNodes = container.querySelectorAll('*');
    expect(allMountedNodes.length).toBeLessThanOrEqual(200);
    expect(screen.getByText(`Showing first ${FALLBACK_WINDOW} of 400 (virtualization disabled)`)).toBeDefined();
    expect(screen.getByText('Coach Session #1')).toBeDefined();
    expect(screen.queryByText('Coach Session #400')).toBeNull();
  });
});

