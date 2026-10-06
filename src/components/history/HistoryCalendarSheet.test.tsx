import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryCalendarSheet } from './HistoryCalendarSheet';
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

  it('disables days without workouts and marks them aria-disabled', async () => {
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
    expect(nonWorkoutDayBtn).toBeDisabled();
    expect(nonWorkoutDayBtn).toHaveAttribute('aria-disabled', 'true');
    expect(nonWorkoutDayBtn).toHaveAttribute('data-has-workout', 'false');
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

  it('supports keyboard navigation with arrow keys across grid cells', async () => {
    renderComponent({
      sessionDates: ['2026-09-01', '2026-09-02', '2026-09-08'],
    });

    const day1Btn = screen.getByRole('button', { name: /September 1, 2026/i });
    day1Btn.focus();

    // ArrowRight to day 2
    fireEvent.keyDown(day1Btn, { key: 'ArrowRight' });
    const day2Btn = screen.getByRole('button', { name: /September 2, 2026/i });
    expect(document.activeElement).toBe(day2Btn);

    // ArrowDown to day 9 (+7 days)
    fireEvent.keyDown(day2Btn, { key: 'ArrowDown' });
    const day9Btn = screen.getByRole('button', { name: /September 9, 2026/i });
    expect(document.activeElement).toBe(day9Btn);

    // ArrowLeft to day 8
    fireEvent.keyDown(day9Btn, { key: 'ArrowLeft' });
    const day8Btn = screen.getByRole('button', { name: /September 8, 2026/i });
    expect(document.activeElement).toBe(day8Btn);

    // ArrowUp to day 1 (-7 days)
    fireEvent.keyDown(day8Btn, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(day1Btn);
  });

  it('closes when Escape is pressed', async () => {
    renderComponent();

    // Fire Escape keydown on the modal dialog
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(mockOnClose).toHaveBeenCalled();
  });
});
