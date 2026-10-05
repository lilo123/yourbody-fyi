import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkoutSessionHistory } from './WorkoutSessionHistory';
import type { HistorySession } from './useWorkoutHistory';

let mockWeightUnit: 'lb' | 'kg' = 'lb';
let mockIsOnline = true;

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-1' },
    profile: { id: 'test-user-1', weight_unit: mockWeightUnit },
  }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

describe('WorkoutSessionHistory (H4, H29, H43)', () => {
  const mockSessions: HistorySession[] = [
    {
      id: 'session-1',
      date: '2026-09-15T00:00:00.000Z',
      workout_date: '2026-09-15',
      civil_date: '2026-09-15',
      name: 'Leg Day',
      set_count: 5,
      total_volume: 2500,
      sets: [],
    },
    {
      id: 'session-2',
      date: '2026-09-20T00:00:00.000Z',
      workout_date: '2026-09-20',
      civil_date: '2026-09-20',
      name: 'Chest Day',
      set_count: 4,
      total_volume: 3200,
      sets: [],
    },
  ];

  beforeEach(() => {
    mockWeightUnit = 'lb';
    mockIsOnline = true;
  });

  it('H4: renders formatted civil date (Sep 15) and drops raw ISO timestamp text', () => {
    render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={mockSessions}
          filteredSessionsCount={2}
          exercises={[]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
          hasMore={false}
          isLoadingMore={false}
          expandedSessionIds={new Set()}
          onToggleExpand={vi.fn()}
          loadingSessionIds={new Set()}
        />
      </MemoryRouter>
    );

    // Formatted civil date must be displayed
    expect(screen.getByText(/Sep 15/)).toBeDefined();

    // H4: Must NOT contain raw ISO timestamp text like "(2026-09-15T00:00:00.000Z)"
    expect(screen.queryByText(/2026-09-15T00:00:00/)).toBeNull();
    expect(screen.queryByText(/\(2026-09-15/)).toBeNull();
  });

  it('H29: renders data-civil-date on session cards', () => {
    const { container } = render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={mockSessions}
          exercises={[]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
        />
      </MemoryRouter>
    );

    const card1 = container.querySelector('[data-civil-date="2026-09-15"]');
    const card2 = container.querySelector('[data-civil-date="2026-09-20"]');

    expect(card1).toBeDefined();
    expect(card1).not.toBeNull();
    expect(card2).toBeDefined();
    expect(card2).not.toBeNull();
  });

  it('H29: highlights and focuses session card matching highlightDate', async () => {
    const { container } = render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={mockSessions}
          exercises={[]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
          highlightDate="2026-09-20"
        />
      </MemoryRouter>
    );

    const highlightedCard = container.querySelector('[data-civil-date="2026-09-20"]') as HTMLElement;
    expect(highlightedCard).not.toBeNull();
    expect(highlightedCard.className).toContain('ring-2 ring-cyan-400');

    await waitFor(() => {
      expect(document.activeElement).toBe(highlightedCard);
    });
  });

  it('H43: renders filterSummary text when filtering sessions', () => {
    render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={[mockSessions[0]]}
          exercises={[]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
          filterSummary={{ matchCount: 1, loadedCount: 2 }}
        />
      </MemoryRouter>
    );

    const counter = screen.getByTestId('showing-sessions-count');
    expect(counter.textContent).toBe('Showing 1 matches in 2 loaded sessions');
  });

  it('H43: renders empty state with Clear filters CTA when filtering produces 0 matches', () => {
    const mockClearFilters = vi.fn();

    render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={[]}
          totalCount={2}
          exercises={[]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
          onClearFilters={mockClearFilters}
          filterSummary={{ matchCount: 0, loadedCount: 2 }}
        />
      </MemoryRouter>
    );

    const counter = screen.getByTestId('showing-sessions-count');
    expect(counter.textContent).toBe('Showing 0 matches in 2 loaded sessions');

    expect(screen.getByText(/No workout sessions match your search or filters/i)).toBeDefined();

    const clearBtn = screen.getByTestId('clear-filters-btn');
    expect(clearBtn).toBeDefined();

    fireEvent.click(clearBtn);
    expect(mockClearFilters).toHaveBeenCalledTimes(1);
  });

  it('kg-mode: session card volume converted once (13500 lb -> 6,124 kg) and set row displays 102.1 kg × 5 reps', () => {
    mockWeightUnit = 'kg';
    const kgSession: HistorySession = {
      id: 'session-kg',
      date: '2026-09-25T00:00:00.000Z',
      workout_date: '2026-09-25',
      civil_date: '2026-09-25',
      name: 'Heavy Bench',
      set_count: 1,
      total_volume: 13500,
      sets: [
        {
          id: 'set-kg-1',
          workout_id: 'session-kg',
          exercise_id: 'ex-bench',
          exercise_name: 'Bench Press',
          weight: 225,
          reps: 5,
          set_index: 1,
          workout_date: '2026-09-25',
          workout_name: 'Heavy Bench',
          set_type: 'working',
          created_at: '2026-09-25T10:00:00Z',
        },
      ],
    };

    render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={[kgSession]}
          exercises={[{ id: 'ex-bench', name: 'Bench Press', body_parts: ['Chest'] }]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
          expandedSessionIds={new Set(['session-kg'])}
        />
      </MemoryRouter>
    );

    // Session volume converted once
    expect(screen.getByText('6,124 kg')).toBeDefined();
    // Set row formatted in kg
    expect(screen.getByText(/102\.1 kg × 5 reps/)).toBeDefined();
  });

  it('renders pending marks on session header and set row when pending is true', () => {
    const pendingSession: HistorySession & { pending?: boolean } = {
      id: 'session-pending',
      date: '2026-09-28T00:00:00.000Z',
      workout_date: '2026-09-28',
      civil_date: '2026-09-28',
      name: 'Pending Workout',
      set_count: 1,
      total_volume: 1000,
      pending: true,
      sets: [
        {
          id: 'set-pending-1',
          workout_id: 'session-pending',
          exercise_id: 'ex-bench',
          exercise_name: 'Bench Press',
          weight: 100,
          reps: 10,
          set_index: 1,
          workout_date: '2026-09-28',
          workout_name: 'Pending Workout',
          set_type: 'working',
          created_at: '2026-09-28T10:00:00Z',
          pending: true,
        } as any,
      ],
    };

    const { container } = render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={[pendingSession]}
          exercises={[{ id: 'ex-bench', name: 'Bench Press', body_parts: ['Chest'] }]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
          expandedSessionIds={new Set(['session-pending'])}
        />
      </MemoryRouter>
    );

    const pendingMarks = container.querySelectorAll('[data-testid="pending-mark"]');
    expect(pendingMarks.length).toBeGreaterThanOrEqual(2);
  });

  it('disables delete session in overflow menu with helper text when offline', () => {
    mockIsOnline = false;
    const onDeleteSession = vi.fn();

    render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={[mockSessions[0]]}
          exercises={[]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
          onDeleteSession={onDeleteSession}
        />
      </MemoryRouter>
    );

    // Open overflow menu
    const overflowTrigger = screen.getByRole('button', { name: /Session actions for Leg Day/i });
    fireEvent.click(overflowTrigger);

    // Check delete menu item shows Available when online
    const deleteBtn = screen.getByTestId(`delete-session-${mockSessions[0].id}`);
    expect(deleteBtn.textContent).toContain('Available when online');

    // Click delete item
    fireEvent.click(deleteBtn);

    // Confirm dialog must not be opened and onDeleteSession must not be called
    expect(screen.queryByTestId('delete-session-confirm-dialog')).toBeNull();
    expect(onDeleteSession).not.toHaveBeenCalled();
  });
});
