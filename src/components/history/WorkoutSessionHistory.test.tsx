import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkoutSessionHistory } from './WorkoutSessionHistory';
import type { HistorySession } from './useWorkoutHistory';

let mockWeightUnit: 'lb' | 'kg' = 'lb';
let mockPrMode: 'weight' | 'e1rm' = 'weight';
let mockIsOnline = true;

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-1' },
    profile: { id: 'test-user-1', weight_unit: mockWeightUnit, pr_mode: mockPrMode },
  }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

describe('WorkoutSessionHistory', () => {
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
    mockPrMode = 'weight';
    mockIsOnline = true;
  });

  it('renders formatted civil date (Sep 15) and drops raw ISO timestamp text', () => {
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

    // Must NOT contain raw ISO timestamp text like "(2026-09-15T00:00:00.000Z)"
    expect(screen.queryByText(/2026-09-15T00:00:00/)).toBeNull();
    expect(screen.queryByText(/\(2026-09-15/)).toBeNull();
  });

  it('renders data-civil-date on session cards', () => {
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

  it('highlights and focuses session card matching highlightDate', async () => {
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

  it('renders filterSummary text when filtering sessions', () => {
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

  it('renders empty state with Clear filters CTA when filtering produces 0 matches', () => {
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

  it('shows pending offline session with pending-mark while sessions query is pending and offline', () => {
    mockIsOnline = false;
    const pendingSession: HistorySession & { pending?: boolean } = {
      id: 'session-pending-offline',
      date: '2026-10-10T00:00:00.000Z',
      workout_date: '2026-10-10',
      civil_date: '2026-10-10',
      name: 'Offline Push Day',
      set_count: 1,
      total_volume: 1250,
      pending: true,
      sets: [
        {
          id: 'set-pending-offline-1',
          workout_id: 'session-pending-offline',
          exercise_id: 'ex-bench',
          exercise_name: 'Bench Press',
          weight: 125,
          reps: 10,
          set_index: 1,
          workout_date: '2026-10-10',
          workout_name: 'Offline Push Day',
          set_type: 'working',
          created_at: '2026-10-10T10:00:00Z',
          pending: true,
        } as any,
      ],
    };

    render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={[pendingSession]}
          totalCount={1}
          isSessionsPending={true}
          exercises={[{ id: 'ex-bench', name: 'Bench Press', body_parts: ['Chest'] }]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
          expandedSessionIds={new Set(['session-pending-offline'])}
        />
      </MemoryRouter>
    );

    // Skeleton should NOT be shown
    expect(screen.queryByTestId('history-sessions-skeleton')).toBeNull();
    // Offline session name and pending marks should be visible
    expect(screen.getByText('Offline Push Day')).toBeDefined();
    const pendingMarks = screen.getAllByTestId('pending-mark');
    expect(pendingMarks.length).toBeGreaterThanOrEqual(1);
  });

  it('shows skeleton when sessions query is pending and there are no sessions at all', () => {
    mockIsOnline = false;
    render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={[]}
          totalCount={null}
          isSessionsPending={true}
          exercises={[]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('history-sessions-skeleton')).toBeDefined();
    expect(screen.queryByTestId('pending-mark')).toBeNull();
  });

  it('renders a "Share workout" item in the session overflow menu and triggers sharing on select', async () => {
    const shareStoryModule = await import('../../utils/workoutStoryShare');
    const shareSpy = vi.spyOn(shareStoryModule, 'shareWorkoutStory').mockResolvedValue(undefined);

    render(
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

    // Open overflow menu for Leg Day
    const overflowTrigger = screen.getByRole('button', { name: /Session actions for Leg Day/i });
    fireEvent.click(overflowTrigger);

    const shareBtn = screen.getByTestId('share-session-session-1');
    expect(shareBtn).toBeDefined();
    expect(shareBtn.textContent).toContain('Share workout');

    fireEvent.click(shareBtn);
    expect(shareSpy).toHaveBeenCalledWith(
      mockSessions[0],
      [],
      'lb',
      expect.any(Function),
      undefined,
      'weight'
    );

    shareSpy.mockRestore();
  });

  it('passes user pr_mode e1rm to shareWorkoutStory when selected', async () => {
    mockPrMode = 'e1rm';
    const shareStoryModule = await import('../../utils/workoutStoryShare');
    const shareSpy = vi.spyOn(shareStoryModule, 'shareWorkoutStory').mockResolvedValue(undefined);

    render(
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

    const overflowTrigger = screen.getByRole('button', { name: /Session actions for Leg Day/i });
    fireEvent.click(overflowTrigger);

    const shareBtn = screen.getByTestId('share-session-session-1');
    fireEvent.click(shareBtn);

    expect(shareSpy).toHaveBeenCalledWith(
      mockSessions[0],
      [],
      'lb',
      expect.any(Function),
      undefined,
      'e1rm'
    );

    shareSpy.mockRestore();
  });

  it('passes loaded sets from sessionSetsMap to shareWorkoutStory when session.sets is empty', async () => {
    const shareStoryModule = await import('../../utils/workoutStoryShare');
    const shareSpy = vi.spyOn(shareStoryModule, 'shareWorkoutStory').mockResolvedValue(undefined);

    const loadedSets = [
      {
        id: 's1',
        workout_id: 'session-1',
        exercise_id: 'ex-1',
        exercise_name: 'Squat',
        weight: 315,
        reps: 5,
        set_index: 1,
        set_type: 'working' as const,
        workout_date: '2026-09-15',
        workout_name: 'Leg Day',
        created_at: '2026-09-15T00:00:00.000Z',
      },
    ];

    render(
      <MemoryRouter>
        <WorkoutSessionHistory
          displayedSessions={mockSessions}
          exercises={[]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditSet={vi.fn()}
          onLoadMore={vi.fn()}
          sessionSetsMap={{ 'session-1': loadedSets }}
        />
      </MemoryRouter>
    );

    const overflowTrigger = screen.getByRole('button', { name: /Session actions for Leg Day/i });
    fireEvent.click(overflowTrigger);

    const shareBtn = screen.getByTestId('share-session-session-1');
    fireEvent.click(shareBtn);

    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'session-1',
        sets: loadedSets,
      }),
      [],
      'lb',
      expect.any(Function),
      undefined,
      'weight'
    );

    shareSpy.mockRestore();
  });
});

