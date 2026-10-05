import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ExerciseHistorySheet } from './ExerciseHistorySheet';
import { supabase } from '../../lib/supabase';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

let mockWeightUnit: 'lb' | 'kg' = 'lb';
let mockPrMode: 'weight' | 'e1rm' = 'weight';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123' },
    profile: { id: 'test-user-123', weight_unit: mockWeightUnit, pr_mode: mockPrMode },
  }),
}));

describe('ExerciseHistorySheet', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockWeightUnit = 'lb';
    mockPrMode = 'weight';
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 0,
        },
      },
    });
  });

  const renderComponent = (props: Partial<React.ComponentProps<typeof ExerciseHistorySheet>> = {}) => {
    const defaultProps: React.ComponentProps<typeof ExerciseHistorySheet> = {
      open: true,
      onClose: vi.fn(),
      userId: 'test-user-123',
      exercise: { id: 'ex-bench', name: 'Barbell Bench Press', body_parts: ['Chest'] },
      prDate: '2026-09-15',
      prWeight: 225,
      prReps: 8,
      isReadOnly: false,
      timeZone: 'America/New_York',
      onEditSet: vi.fn(),
    };

    return render(
      <QueryClientProvider client={queryClient}>
        <ExerciseHistorySheet {...defaultProps} {...props} />
      </QueryClientProvider>
    );
  };

  it('1. groups sessions with human date (STD-DAT-5) and displays set rows as "W lbs × R"', async () => {
    const mockRows = [
      {
        workout_id: 'w-sess-1',
        civil_date: '2026-09-20',
        workout_name: 'Push Day Heavy',
        set_id: 'set-1',
        set_index: 1,
        weight: 225,
        reps: 8,
        rpe: 8.5,
        created_at: '2026-09-20T10:00:00Z',
        total_sessions: 2,
      },
      {
        workout_id: 'w-sess-1',
        civil_date: '2026-09-20',
        workout_name: 'Push Day Heavy',
        set_id: 'set-2',
        set_index: 2,
        weight: 235,
        reps: 6,
        rpe: 9,
        created_at: '2026-09-20T10:05:00Z',
        total_sessions: 2,
      },
      {
        workout_id: 'w-sess-2',
        civil_date: '2025-08-15',
        workout_name: 'Old Summer Push',
        set_id: 'set-3',
        set_index: 1,
        weight: 185,
        reps: 10,
        rpe: null,
        created_at: '2025-08-15T10:00:00Z',
        total_sessions: 2,
      },
    ];

    vi.mocked(supabase.rpc).mockResolvedValue({ data: mockRows, error: null } as any);

    renderComponent();

    // Check session names rendered
    expect(await screen.findByText('Push Day Heavy')).toBeDefined();
    expect(screen.getByText('Old Summer Push')).toBeDefined();

    // Check STD-DAT-5 date formatting: current year excludes year, prior year includes year
    // 2026-09-20 is Sunday -> Sun, Sep 20
    expect(screen.getByText(/Sun, Sep 20/i)).toBeDefined();
    // 2025-08-15 is Friday -> Fri, Aug 15, 2025
    expect(screen.getByText(/Fri, Aug 15, 2025/i)).toBeDefined();

    // Check set rows formatted as 'W lbs × R'
    expect(screen.getByText('225 lbs × 8')).toBeDefined();
    expect(screen.getByText('235 lbs × 6')).toBeDefined();
    expect(screen.getByText('185 lbs × 10')).toBeDefined();
    expect(screen.getByText('@8.5')).toBeDefined();
  });

  it('2. marks PR row with the PR badge when weight, reps, and date match', async () => {
    const mockRows = [
      {
        workout_id: 'w-1',
        civil_date: '2026-09-15',
        workout_name: 'Benchmark Push',
        set_id: 'set-pr',
        set_index: 1,
        weight: 225,
        reps: 8,
        rpe: 9,
        created_at: '2026-09-15T10:00:00Z',
        total_sessions: 2,
      },
      {
        workout_id: 'w-2',
        civil_date: '2026-09-10',
        workout_name: 'Earlier Push',
        set_id: 'set-non-pr',
        set_index: 1,
        weight: 215,
        reps: 8,
        rpe: 8,
        created_at: '2026-09-10T10:00:00Z',
        total_sessions: 2,
      },
    ];

    vi.mocked(supabase.rpc).mockResolvedValue({ data: mockRows, error: null } as any);

    renderComponent({
      prDate: '2026-09-15',
      prWeight: 225,
      prReps: 8,
    });

    // Wait for content to render
    expect(await screen.findByText('Benchmark Push')).toBeDefined();

    // The PR badge must be present only for the matching set
    const prBadges = screen.getAllByTestId('pr-badge');
    expect(prBadges.length).toBe(1);
    expect(prBadges[0].textContent).toContain('PR');
  });

  it('2b. RD-4 tie-breaking: ties broken by more reps then earliest date then earliest set', async () => {
    const mockRows = [
      {
        workout_id: 'w-early',
        civil_date: '2026-09-10',
        workout_name: 'Earlier Push',
        set_id: 'set-tie-1',
        set_index: 1,
        weight: 225,
        reps: 8,
        rpe: 9,
        created_at: '2026-09-10T10:00:00Z',
        total_sessions: 2,
      },
      {
        workout_id: 'w-late',
        civil_date: '2026-09-15',
        workout_name: 'Later Push',
        set_id: 'set-tie-2',
        set_index: 1,
        weight: 225,
        reps: 8,
        rpe: 9,
        created_at: '2026-09-15T10:00:00Z',
        total_sessions: 2,
      },
    ];

    vi.mocked(supabase.rpc).mockResolvedValue({ data: mockRows, error: null } as any);

    renderComponent({
      prDate: null,
      prWeight: 225,
      prReps: 8,
    });

    expect(await screen.findByText('Earlier Push')).toBeDefined();

    const prBadges = screen.getAllByTestId('pr-badge');
    expect(prBadges.length).toBe(1);

    const earlySetEl = screen.getByTestId('exercise-history-set-set-tie-1');
    expect(earlySetEl.querySelector('[data-testid="pr-badge"]')).not.toBeNull();

    const lateSetEl = screen.getByTestId('exercise-history-set-set-tie-2');
    expect(lateSetEl.querySelector('[data-testid="pr-badge"]')).toBeNull();
  });

  it('3. pages by session cursor (p_before = oldest loaded civil_date) on "Load older" click', async () => {
    const user = userEvent.setup();

    // Generate page 1: 10 sessions (limit = 10)
    const page1Rows = Array.from({ length: 10 }, (_, idx) => ({
      workout_id: `w-p1-${idx}`,
      civil_date: `2026-09-${String(20 - idx).padStart(2, '0')}`,
      workout_name: `Session 1-${idx + 1}`,
      set_id: `s-p1-${idx}`,
      set_index: 1,
      weight: 200,
      reps: 8,
      rpe: null,
      created_at: `2026-09-${String(20 - idx).padStart(2, '0')}T10:00:00Z`,
      total_sessions: 15,
    }));

    // Page 2: 5 sessions (oldest reaches end)
    const page2Rows = Array.from({ length: 5 }, (_, idx) => ({
      workout_id: `w-p2-${idx}`,
      civil_date: `2026-08-${String(25 - idx).padStart(2, '0')}`,
      workout_name: `Session 2-${idx + 1}`,
      set_id: `s-p2-${idx}`,
      set_index: 1,
      weight: 195,
      reps: 8,
      rpe: null,
      created_at: `2026-08-${String(25 - idx).padStart(2, '0')}T10:00:00Z`,
      total_sessions: 15,
    }));

    vi.mocked(supabase.rpc).mockImplementation(((fn: string, params: any) => {
      if (fn === 'get_exercise_history') {
        if (!params.p_before) {
          return Promise.resolve({ data: page1Rows, error: null });
        }
        if (params.p_before === '2026-09-11') {
          return Promise.resolve({ data: page2Rows, error: null });
        }
      }
      return Promise.resolve({ data: [], error: null });
    }) as any);

    renderComponent();

    expect(await screen.findByText('Session 1-1')).toBeDefined();

    // "Load older" button must be visible
    const loadOlderBtn = screen.getByTestId('load-older-btn');
    expect(loadOlderBtn).toBeDefined();

    // Click Load older
    await user.click(loadOlderBtn);

    // Verify RPC was called with p_before = oldest loaded civil_date ('2026-09-11')
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('get_exercise_history', expect.objectContaining({
        p_before: '2026-09-11',
      }));
    });

    // Page 2 sessions now visible
    expect(await screen.findByText('Session 2-1')).toBeDefined();

    // "Load older" button disappears because total_sessions (15) reached
    await waitFor(() => {
      expect(screen.queryByTestId('load-older-btn')).toBeNull();
    });
  });

  it('4. range chips update p_since query param (30D, 90D, 1Y, All)', async () => {
    const user = userEvent.setup();

    vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as any);

    renderComponent({ timeZone: 'America/New_York' });

    // Initial query is 'All' -> p_since is null
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('get_exercise_history', expect.objectContaining({
        p_since: null,
      }));
    });

    // Click 30D chip
    const chip30D = screen.getByTestId('range-chip-30d');
    await user.click(chip30D);

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('get_exercise_history', expect.objectContaining({
        p_since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }));
    });

    // Click All chip -> p_since null
    const chipAll = screen.getByTestId('range-chip-all');
    await user.click(chipAll);

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('get_exercise_history', expect.objectContaining({
        p_since: null,
      }));
    });
  });

  it('5. allows owner to tap a set to call onEditSet', async () => {
    const user = userEvent.setup();
    const handleEditSet = vi.fn();

    const mockRows = [
      {
        workout_id: 'w-edit-1',
        civil_date: '2026-09-20',
        workout_name: 'Chest Strength',
        set_id: 'set-edit-target',
        set_index: 2,
        weight: 225,
        reps: 8,
        rpe: 8,
        created_at: '2026-09-20T10:00:00Z',
        total_sessions: 1,
      },
    ];

    vi.mocked(supabase.rpc).mockResolvedValue({ data: mockRows, error: null } as any);

    renderComponent({
      isReadOnly: false,
      onEditSet: handleEditSet,
    });

    const setBtn = await screen.findByTestId('exercise-history-set-set-edit-target');
    expect(setBtn.tagName).toBe('BUTTON');

    await user.click(setBtn);

    expect(handleEditSet).toHaveBeenCalledTimes(1);
    expect(handleEditSet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'set-edit-target',
        workout_id: 'w-edit-1',
        exercise_id: 'ex-bench',
        weight: 225,
        reps: 8,
        workout_date: '2026-09-20',
        workout_name: 'Chest Strength',
      })
    );
  });

  it('6. coach view is read-only (no edit affordance, rows are not buttons)', async () => {
    const handleEditSet = vi.fn();

    const mockRows = [
      {
        workout_id: 'w-coach-1',
        civil_date: '2026-09-20',
        workout_name: 'Athlete Session',
        set_id: 'set-coach-view',
        set_index: 1,
        weight: 185,
        reps: 10,
        rpe: null,
        created_at: '2026-09-20T10:00:00Z',
        total_sessions: 1,
      },
    ];

    vi.mocked(supabase.rpc).mockResolvedValue({ data: mockRows, error: null } as any);

    renderComponent({
      isReadOnly: true,
      onEditSet: handleEditSet,
    });

    const setRow = await screen.findByTestId('exercise-history-set-set-coach-view');
    // Row is a non-interactive DIV, not a BUTTON
    expect(setRow.tagName).toBe('DIV');

    // No edit button / icon inside the row
    expect(setRow.querySelector('button')).toBeNull();

    // Clicking row does NOT call onEditSet
    fireEvent.click(setRow);
    expect(handleEditSet).not.toHaveBeenCalled();

    // Shows Coach View pill
    expect(screen.getByText(/Coach View \(Read-only\)/i)).toBeDefined();
  });

  it('7. renders trend chart sparkline when >= 2 sessions exist', async () => {
    const mockRows = [
      {
        workout_id: 'w-trend-1',
        civil_date: '2026-09-20',
        workout_name: 'Recent',
        set_id: 's-t1',
        set_index: 1,
        weight: 225,
        reps: 5,
        rpe: null,
        created_at: '2026-09-20T10:00:00Z',
        total_sessions: 2,
      },
      {
        workout_id: 'w-trend-2',
        civil_date: '2026-09-10',
        workout_name: 'Older',
        set_id: 's-t2',
        set_index: 1,
        weight: 185,
        reps: 8,
        rpe: null,
        created_at: '2026-09-10T10:00:00Z',
        total_sessions: 2,
      },
    ];

    vi.mocked(supabase.rpc).mockResolvedValue({ data: mockRows, error: null } as any);

    renderComponent();

    const sparkline = await screen.findByTestId('exercise-history-sparkline');
    expect(sparkline).toBeDefined();
    expect(sparkline.getAttribute('role')).toBe('img');
    // Chronological order: older (185) -> recent (225) over 2 sessions
    expect(sparkline.getAttribute('aria-label')).toBe('Trend: first 185, last 225 over 2 sessions');
  });

  it('8. displays error state with retry button on RPC failure', async () => {
    const user = userEvent.setup();

    vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error('Database network timeout'));

    renderComponent();

    expect(await screen.findByTestId('exercise-history-error')).toBeDefined();
    expect(screen.getByText('Database network timeout')).toBeDefined();

    // Now make retry succeed
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as any);

    const retryBtn = screen.getByTestId('retry-exercise-history-btn');
    await user.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('exercise-history-error')).toBeNull();
    });
  });

  it('9. kg-mode: displays PR summary and set rows in kg (225 lb -> 102.1 kg)', async () => {
    mockWeightUnit = 'kg';
    const mockRows = [
      {
        workout_id: 'w-sess-kg',
        civil_date: '2026-09-20',
        workout_name: 'Push Day Heavy',
        set_id: 'set-kg-1',
        set_index: 1,
        weight: 225,
        reps: 8,
        rpe: 8.5,
        created_at: '2026-09-20T10:00:00Z',
        total_sessions: 1,
      },
    ];

    vi.mocked(supabase.rpc).mockResolvedValue({ data: mockRows, error: null } as any);

    renderComponent({ prWeight: 225, prReps: 8 });

    // PR summary displays in kg
    expect(await screen.findByText(/PR: 102\.1 kg × 8/)).toBeDefined();

    // Set row displays in kg
    expect(await screen.findByText('102.1 kg × 8')).toBeDefined();
  });

  it('renders no "e1RM" text anywhere on sheet when pr_mode is weight', async () => {
    mockPrMode = 'weight';
    renderComponent({ prWeight: 225, prReps: 8 });

    const summary = screen.getByTestId('exercise-sheet-pr-summary');
    expect(summary.textContent).not.toContain('e1RM');
  });

  it('renders e1RM summary on sheet with 2-line badge when pr_mode is e1rm', async () => {
    mockPrMode = 'e1rm';
    renderComponent({ prWeight: 225, prReps: 8 });

    const summary = screen.getByTestId('exercise-sheet-pr-summary');
    expect(summary.textContent).toContain('e1RM');
    expect(summary.className).toContain('max-w-full');
  });
});
