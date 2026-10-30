import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryCalendarSheet } from './HistoryCalendarSheet';
import * as pendingOpsModule from '../workout/useWorkoutPendingOps';
import type { OutboxOp } from '../../offline/types';
import {
  createSupabaseBuilder,
  getRecordedSelects,
  getRecordedTables,
  clearMockHistory,
} from '../../test/supabaseBuilderMock';

const mockUserId = 'user-cal-test-123';

const mockQueryWorkouts = [
  { workout_date: '2026-09-10' },
  { workout_date: '2026-09-20' },
];

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', { data: mockQueryWorkouts, error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    }),
  },
}));

describe('HistoryCalendarSheet', () => {
  let queryClient: QueryClient;
  const mockOnClose = vi.fn();
  const mockOnSelectDate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderComponent = (props: Partial<React.ComponentProps<typeof HistoryCalendarSheet>> = {}) =>
    render(
      <QueryClientProvider client={queryClient}>
        <HistoryCalendarSheet
          open={true}
          onClose={mockOnClose}
          userId={mockUserId}
          sessionDates={['2026-09-27']}
          onSelectDate={mockOnSelectDate}
          {...props}
        />
      </QueryClientProvider>
    );

  it('services workouts table query with exact workout_date projection (mock fidelity)', async () => {
    renderComponent();

    await waitFor(() => {
      expect(getRecordedTables()).toContain('workouts');
      expect(getRecordedSelects()).toContainEqual({
        table: 'workouts',
        projection: 'workout_date',
      });
    });
  });

  it('renders dots on workout days from union of sessionDates and queried workouts', async () => {
    renderComponent({
      sessionDates: ['2026-09-27'], // from props
    });

    // Wait for query to resolve (mockQueryWorkouts has 2026-09-10 and 2026-09-20)
    await waitFor(() => {
      expect(screen.getByTestId('workout-dot-2026-09-10')).toBeDefined();
    });

    // 2026-09-10 (from query) has dot
    expect(screen.getByTestId('workout-dot-2026-09-10')).toBeDefined();
    // 2026-09-20 (from query) has dot
    expect(screen.getByTestId('workout-dot-2026-09-20')).toBeDefined();
    // 2026-09-27 (from sessionDates) has dot
    expect(screen.getByTestId('workout-dot-2026-09-27')).toBeDefined();

    // 2026-09-15 has no workout and therefore no dot
    expect(screen.queryByTestId('workout-dot-2026-09-15')).toBeNull();
  });

  it('marks days without workouts as aria-disabled while keeping them focusable', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('workout-dot-2026-09-27')).toBeDefined();
    });

    const workoutDayBtn = screen.getByRole('button', {
      name: /Sunday, September 27, 2026, workout logged/i,
    });
    expect(workoutDayBtn).not.toBeDisabled();
    expect(workoutDayBtn).toHaveAttribute('data-has-workout', 'true');

    const nonWorkoutDayBtn = screen.getByRole('button', {
      name: /Monday, September 28, 2026/i,
    });
    expect(nonWorkoutDayBtn).not.toBeDisabled();
    expect(nonWorkoutDayBtn).toHaveAttribute('aria-disabled', 'true');
    expect(nonWorkoutDayBtn).toHaveAttribute('data-has-workout', 'false');

    // Clicking a rest day does nothing
    fireEvent.click(nonWorkoutDayBtn);
    expect(mockOnSelectDate).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('calls onSelectDate and onClose when a workout day is tapped', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('workout-dot-2026-09-27')).toBeDefined();
    });

    const workoutDayBtn = screen.getByRole('button', {
      name: /Sunday, September 27, 2026, workout logged/i,
    });

    fireEvent.click(workoutDayBtn);

    expect(mockOnSelectDate).toHaveBeenCalledWith('2026-09-27');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('navigates months with previous and next month buttons', async () => {
    renderComponent({
      sessionDates: ['2026-09-15'],
    });

    // Initial month should be September 2026
    expect(screen.getByTestId('calendar-month-heading').textContent).toContain('September 2026');

    // Click next month
    const nextBtn = screen.getByTestId('calendar-next-month-btn');
    fireEvent.click(nextBtn);

    expect(screen.getByTestId('calendar-month-heading').textContent).toContain('October 2026');

    // Click prev month twice
    const prevBtn = screen.getByTestId('calendar-prev-month-btn');
    fireEvent.click(prevBtn);
    expect(screen.getByTestId('calendar-month-heading').textContent).toContain('September 2026');

    fireEvent.click(prevBtn);
    expect(screen.getByTestId('calendar-month-heading').textContent).toContain('August 2026');
  });

  it('supports keyboard navigation with arrow keys across grid cells including rest days', async () => {
    renderComponent({
      sessionDates: ['2026-09-01', '2026-09-03', '2026-09-08'],
    });

    const day1Btn = screen.getByRole('button', { name: /September 1, 2026/i });
    day1Btn.focus();

    // ArrowRight to day 2 (rest day)
    fireEvent.keyDown(day1Btn, { key: 'ArrowRight' });
    const day2Btn = screen.getByRole('button', { name: /September 2, 2026/i });
    expect(document.activeElement).toBe(day2Btn);
    expect(day2Btn).toHaveAttribute('aria-disabled', 'true');

    // ArrowRight from rest day 2 to workout day 3
    fireEvent.keyDown(day2Btn, { key: 'ArrowRight' });
    const day3Btn = screen.getByRole('button', { name: /September 3, 2026/i });
    expect(document.activeElement).toBe(day3Btn);

    // ArrowDown to day 10 (+7 days)
    fireEvent.keyDown(day3Btn, { key: 'ArrowDown' });
    const day10Btn = screen.getByRole('button', { name: /September 10, 2026/i });
    expect(document.activeElement).toBe(day10Btn);

    // ArrowLeft to day 9
    fireEvent.keyDown(day10Btn, { key: 'ArrowLeft' });
    const day9Btn = screen.getByRole('button', { name: /September 9, 2026/i });
    expect(document.activeElement).toBe(day9Btn);

    // ArrowUp to day 2 (-7 days)
    fireEvent.keyDown(day9Btn, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(day2Btn);
  });

  it('closes when Escape is pressed', async () => {
    renderComponent();

    // Fire Escape keydown on the modal dialog
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('renders workout dot for date with queued set.batchCreate ops', async () => {
    const pendingOps: OutboxOp[] = [
      {
        opId: 'op-batch-1',
        userId: mockUserId,
        seq: 1,
        createdAt: '2026-10-18T10:00:00Z',
        state: 'pending',
        attempts: 0,
        kind: 'set.batchCreate',
        payload: {
          workoutRef: 'w-sess-batch',
          sets: [
            {
              id: 'set-batch-1',
              exercise_id: 'ex-bench',
              weight: 225,
              reps: 8,
              set_index: 1,
              set_type: 'working',
              rpe: 8,
              created_at: '2026-10-18T10:00:00Z',
            },
          ],
        },
      },
    ];

    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue(pendingOps);

    renderComponent({
      sessionDates: ['2026-10-01'],
    });

    await waitFor(() => {
      expect(screen.getByTestId('workout-dot-2026-10-18')).toBeDefined();
    });
  });

  it('renders workout dots for multiple distinct dates present in a set.batchCreate op', async () => {
    const pendingOps: OutboxOp[] = [
      {
        opId: 'op-batch-multi-dates',
        userId: mockUserId,
        seq: 1,
        createdAt: '2026-10-15T10:00:00Z',
        state: 'pending',
        attempts: 0,
        kind: 'set.batchCreate',
        payload: {
          workoutRef: 'w-sess-dates',
          sets: [
            {
              id: 'set-d1',
              exercise_id: 'ex-bench',
              weight: 225,
              reps: 8,
              set_index: 1,
              created_at: '2026-10-15T10:00:00Z',
            },
            {
              id: 'set-d2',
              exercise_id: 'ex-bench',
              weight: 225,
              reps: 8,
              set_index: 2,
              created_at: '2026-10-16T10:00:00Z',
            },
          ],
        },
      },
    ];

    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue(pendingOps);

    renderComponent({
      sessionDates: ['2026-10-01'],
    });

    await waitFor(() => {
      expect(screen.getByTestId('workout-dot-2026-10-15')).toBeDefined();
      expect(screen.getByTestId('workout-dot-2026-10-16')).toBeDefined();
    });
  });
});
