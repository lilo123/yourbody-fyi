import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { CoachAthleteTimeline } from './CoachAthleteTimeline';
import type { CoachAthleteTimelineProps } from './CoachAthleteTimeline';
import { expectNoA11yViolations } from '../../test/a11y';

let mockCoachWeightUnit: 'lb' | 'kg' = 'lb';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'coach-1', role: 'coach' },
    profile: { id: 'coach-1', role: 'coach', weight_unit: mockCoachWeightUnit },
  }),
}));

describe('CoachAthleteTimeline accessibility', () => {
  beforeEach(() => {
    mockCoachWeightUnit = 'lb';
  });

  const defaultProps: CoachAthleteTimelineProps = {
    selectedAthleteId: 'athlete-1',
    selectedAthlete: { name: 'Bob' },
    timelineDays: [],
    athleteWorkoutsWithSets: [],
    athleteProfile: null,
    exercises: [],
    expandedExercises: {},
    onToggleExercise: vi.fn(),
    onLoadOlderDays: vi.fn(),
    isWorkoutsError: false,
    workoutsError: null,
    onRetryWorkouts: vi.fn(),
  };

  it('passes axe accessibility audits with no violations', async () => {
    const { container } = render(<CoachAthleteTimeline {...defaultProps} />);
    await expectNoA11yViolations(container);
  });

  it('mounts live regions unconditionally and mutates assertive region on workout error', () => {
    const politeOf = (c: HTMLElement) => c.querySelector('[role="status"]');
    const assertiveOf = (c: HTMLElement) => c.querySelector('[role="alert"]');

    const { container, rerender } = render(<CoachAthleteTimeline {...defaultProps} />);
    const politeBefore = politeOf(container);
    const assertiveBefore = assertiveOf(container);

    expect(politeBefore).not.toBeNull();
    expect(assertiveBefore).not.toBeNull();
    expect(politeBefore!.textContent).toBe('');
    expect(assertiveBefore!.textContent).toBe('');

    // Error transition
    rerender(
      <CoachAthleteTimeline
        {...defaultProps}
        isWorkoutsError={true}
        workoutsError={new Error('Network failure')}
      />
    );

    const politeAfter = politeOf(container);
    const assertiveAfter = assertiveOf(container);

    expect(politeAfter).toBe(politeBefore);
    expect(assertiveAfter).toBe(assertiveBefore);
    expect(assertiveAfter!.textContent).toContain('Network failure');
    expect(politeAfter!.textContent).toBe('');
  });

  it('renders civil date in timeline day header with zero raw ISO timestamp text', () => {
    const timelineDays = [
      {
        date: '2026-09-15',
        workouts: [
          {
            id: 'w-1',
            date: '2026-09-15T00:00:00.000Z',
            civil_date: '2026-09-15',
            workout_date: '2026-09-15',
            name: 'Push Day',
            sets: [],
          },
        ],
        nutrition: [],
      },
    ];

    const { container } = render(
      <CoachAthleteTimeline
        {...defaultProps}
        timelineDays={timelineDays}
        athleteWorkoutsWithSets={timelineDays[0].workouts}
      />
    );

    // Formatted civil date header
    expect(container.textContent).toContain('Sep 15');
    // Zero raw ISO text
    expect(container.textContent).not.toContain('2026-09-15T00:00:00');
  });

  it('kg coach viewing athlete sees session volume, exercise volume, and sets in kg (athlete unit irrelevant)', () => {
    mockCoachWeightUnit = 'kg';

    const testExercises = [
      { id: 'ex-bench', name: 'Barbell Bench Press', body_parts: ['Chest'] },
    ];

    const timelineDays = [
      {
        date: '2026-09-15',
        workouts: [
          {
            id: 'w-1',
            civil_date: '2026-09-15',
            workout_date: '2026-09-15',
            name: 'Push Day',
            sets: [
              {
                id: 's-1',
                workout_id: 'w-1',
                exercise_id: 'ex-bench',
                exercise_name: 'Barbell Bench Press',
                weight: 225,
                reps: 5,
                set_index: 1,
              },
            ],
          },
        ],
        nutrition: [],
      },
    ];

    const { container } = render(
      <CoachAthleteTimeline
        {...defaultProps}
        timelineDays={timelineDays}
        athleteWorkoutsWithSets={timelineDays[0].workouts}
        exercises={testExercises}
        expandedExercises={{ 'w-1-ex-bench': true }}
        athleteProfile={{ id: 'athlete-1', weight_unit: 'lb' } as any}
      />
    );

    // 225 lb * 5 reps = 1125 lb total vol -> 510 kg in kg mode
    // Session volume: 1 sets • 510 kg vol
    expect(container.textContent).toContain('1 sets • 510 kg vol');
    // Exercise volume: 1 sets • 510 kg
    expect(container.textContent).toContain('1 sets • 510 kg');
    // Set row: 5 reps × 102.1 kg
    expect(container.textContent).toContain('5 reps × 102.1 kg');
  });

  it('lb coach viewing athlete sees session volume, exercise volume, and sets in lbs (athlete unit irrelevant)', () => {
    mockCoachWeightUnit = 'lb';

    const testExercises = [
      { id: 'ex-bench', name: 'Barbell Bench Press', body_parts: ['Chest'] },
    ];

    const timelineDays = [
      {
        date: '2026-09-15',
        workouts: [
          {
            id: 'w-1',
            civil_date: '2026-09-15',
            workout_date: '2026-09-15',
            name: 'Push Day',
            sets: [
              {
                id: 's-1',
                workout_id: 'w-1',
                exercise_id: 'ex-bench',
                exercise_name: 'Barbell Bench Press',
                weight: 225,
                reps: 5,
                set_index: 1,
              },
            ],
          },
        ],
        nutrition: [],
      },
    ];

    const { container } = render(
      <CoachAthleteTimeline
        {...defaultProps}
        timelineDays={timelineDays}
        athleteWorkoutsWithSets={timelineDays[0].workouts}
        exercises={testExercises}
        expandedExercises={{ 'w-1-ex-bench': true }}
        athleteProfile={{ id: 'athlete-1', weight_unit: 'kg' } as any}
      />
    );

    // Session volume: 1 sets • 1,125 lbs vol
    expect(container.textContent).toContain('1 sets • 1,125 lbs vol');
    // Exercise volume: 1 sets • 1,125 lbs
    expect(container.textContent).toContain('1 sets • 1,125 lbs');
    // Set row: 5 reps × 225 lbs
    expect(container.textContent).toContain('5 reps × 225 lbs');
  });

  it('renders skeleton while athlete workouts query is fetching (C23)', () => {
    const { container } = render(
      <CoachAthleteTimeline
        {...defaultProps}
        isLoading={true}
      />
    );
    expect(container.querySelector('[data-testid="timeline-loading-skeleton"]')).not.toBeNull();
    // Empty state is not rendered
    expect(container.textContent).not.toContain('No workouts or nutrition logged for this athlete yet');
  });

  it('formats timeline day calories and macro totals without IEEE-754 float drift (STD-DAT-2)', () => {
    const timelineDays = [
      {
        date: '2026-09-15',
        workouts: [],
        nutrition: [
          {
            id: 'n-1',
            food_name: 'Chicken Snack',
            calories: 100.1,
            protein: 12.1,
            carbs: 10.1,
            fat: 5.1,
          },
          {
            id: 'n-2',
            food_name: 'Protein Shake',
            calories: 200.2,
            protein: 12.7,
            carbs: 10.2,
            fat: 5.2,
          },
        ],
      },
    ];

    const { container } = render(
      <CoachAthleteTimeline
        {...defaultProps}
        timelineDays={timelineDays as any}
      />
    );

    // 12.1 + 12.7 = 24.799999999999997 -> must format as 24.8g P and never raw float
    expect(container.textContent).toContain('24.8g P');
    expect(container.textContent).not.toContain('24.799999999999997');

    // 100.1 + 200.2 = 300.29999999999995 -> must format as whole kcal (300 kcal)
    expect(container.textContent).toContain('Nutrition (300 kcal)');
    expect(container.textContent).not.toContain('300.29999999999995');

    // Individual item calories 100.1 -> 100 kcal, 200.2 -> 200 kcal
    expect(container.textContent).toContain('100 kcal');
    expect(container.textContent).toContain('200 kcal');
    expect(container.textContent).not.toContain('100.1 kcal');
    expect(container.textContent).not.toContain('200.2 kcal');
  });
});
