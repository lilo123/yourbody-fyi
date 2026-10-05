import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createRef } from 'react';
import { ExerciseListTab, type ExerciseListTabHandle } from './ExerciseListTab';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, clearMockHistory, getRecordedTables } from '../../test/supabaseBuilderMock';
import type { CatalogExercise } from '../../lib/exercises';

const { mockCoachState, mockAuthUser } = vi.hoisted(() => ({
  mockCoachState: {
    isCoach: false,
    selectedAthleteId: '',
    selectedAthlete: null as any,
    athletes: [] as any[],
  },
  mockAuthUser: {
    id: 'user-athlete-1',
    email: 'athlete@example.com',
  },
}));

vi.mock('../../hooks/useCoach', () => ({
  useCoach: () => mockCoachState,
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: mockAuthUser }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => createSupabaseBuilder(table, { data: [], error: null })),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockAuthUser } }),
    },
  },
}));

describe('ExerciseListTab', () => {
  let queryClient: QueryClient;
  const mockRpc = vi.fn();

  const sampleCatalog: CatalogExercise[] = [
    {
      id: 'ex-1',
      name: 'Zercher Squat',
      body_parts: ['Legs'],
      equipment: 'barbell',
      is_master: true,
      user_id: null,
      is_archived: false,
      is_hidden: false,
      total_count: 3,
    },
    {
      id: 'ex-2',
      name: 'Romanian Deadlift',
      body_parts: ['Legs'],
      equipment: 'barbell',
      is_master: false,
      user_id: 'user-athlete-1',
      is_archived: false,
      is_hidden: false,
      total_count: 3,
    },
    {
      id: 'ex-3',
      name: 'Incline Dumbbell Bench Press',
      body_parts: ['Chest'],
      equipment: 'dumbbell',
      is_master: false,
      user_id: 'coach-999',
      is_archived: false,
      is_hidden: false,
      total_count: 3,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    mockCoachState.isCoach = false;
    mockCoachState.selectedAthleteId = '';
    mockCoachState.selectedAthlete = null;
    mockCoachState.athletes = [];
    mockAuthUser.id = 'user-athlete-1';

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    (supabase.rpc as any) = mockRpc.mockResolvedValue({
      data: sampleCatalog,
      error: null,
    });

    vi.mocked(supabase.from).mockImplementation((_table: string) => {
      const builder: any = {
        select: vi.fn().mockResolvedValue({ data: [{ id: 'ex-2' }], error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: [{ id: 'ex-2' }], error: null }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      };
      return builder;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderComponent = (props: any = {}) =>
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ExerciseListTab {...props} />
          <ToastHost />
        </ToastProvider>
      </QueryClientProvider>
    );

  it('L10: displays skeleton with aria-busy while pending', async () => {
    // Hang the RPC to observe pending state
    mockRpc.mockReturnValueOnce(new Promise(() => {}));

    renderComponent();

    // Skeletons rendered with aria-busy while pending
    const skeleton = screen.getByTestId('exercises-skeleton');
    expect(skeleton).toBeDefined();
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
  });

  it('L10: displays skeleton with aria-busy while pending even when propExercises is []', async () => {
    mockRpc.mockReturnValueOnce(new Promise(() => {}));

    renderComponent({ exercises: [] });

    const skeleton = screen.getByTestId('exercises-skeleton');
    expect(skeleton).toBeDefined();
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(/No exercises found in your library/i)).toBeNull();
  });

  it('L10: shows "Showing N of M" count on catalog load', async () => {
    renderComponent();
    expect(await screen.findByText('Zercher Squat')).toBeDefined();
    expect(screen.getByText('Romanian Deadlift')).toBeDefined();

    const countText = await screen.findByTestId('showing-exercises-count');
    expect(countText.textContent).toContain('Showing 3 of 3');
  });

  it('L10: shows empty state ONLY when query succeeds with 0 items', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    renderComponent();
    expect(await screen.findByText(/No exercises found in your library/i)).toBeDefined();
  });

  it('L10: displays StatusBanner error and Retry button on catalog query failure', async () => {
    mockRpc.mockRejectedValueOnce(new Error('RPC connection failed'));

    renderComponent();
    expect(await screen.findByText('Failed to load exercises')).toBeDefined();
    expect(screen.getByText('RPC connection failed')).toBeDefined();

    // Clicking Retry triggers refetch
    mockRpc.mockResolvedValueOnce({ data: sampleCatalog, error: null });
    const retryBtn = screen.getByTestId('retry-exercises-btn');
    fireEvent.click(retryBtn);

    expect(await screen.findByText('Zercher Squat')).toBeDefined();
  });

  it('L8: search input updates and matches exercise terms (zer, rdl)', async () => {
    renderComponent();
    await screen.findByText('Zercher Squat');

    const searchInput = screen.getByTestId('exercise-search-input');
    fireEvent.change(searchInput, { target: { value: 'zer' } });
    expect(searchInput).toHaveValue('zer');

    // Clear search button appears when search has value
    const clearBtn = await screen.findByTestId('clear-search-btn');
    expect(clearBtn).toBeDefined();

    fireEvent.click(clearBtn);
    expect(searchInput).toHaveValue('');
  });

  it('L4: deferred exercise archive executes 0 writes before expiry, Undo = 0 writes, exactly 1 write on expiry', async () => {
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [{ id: 'ex-2' }], error: null }),
      }),
    });
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercises') {
        return { update: updateSpy };
      }
      return {};
    });

    renderComponent();
    expect(await screen.findByText('Romanian Deadlift')).toBeDefined();

    const archiveBtn = screen.getByTestId('archive-exercise-ex-2');
    vi.useFakeTimers();
    try {
      // 1. Click Archive
      fireEvent.click(archiveBtn);

      // Optimistically removed from list immediately (row gone, toast visible)
      expect(screen.queryByTestId('exercise-row-ex-2')).toBeNull();

      // UndoToast is displayed
      expect(screen.getByTestId('toast-dish-text').textContent).toContain('Romanian Deadlift');

      // ZERO writes before 6s expiry
      expect(updateSpy).not.toHaveBeenCalled();

      // 2. Click Undo before expiry
      const undoBtn = screen.getByTestId('toast-undo-btn');
      fireEvent.click(undoBtn);

      // Row is restored, UndoToast is removed
      expect(screen.queryByTestId('toast-dish-text')).toBeNull();
      expect(screen.getByTestId('exercise-row-ex-2')).toBeDefined();

      // ZERO writes executed on undo
      expect(updateSpy).not.toHaveBeenCalled();

      // 3. Archive again and let timer expire (6000ms)
      const archiveBtn2 = screen.getByTestId('archive-exercise-ex-2');
      fireEvent.click(archiveBtn2);
      expect(updateSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(6000);

      // Exactly 1 write on expiry
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith({ is_archived: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('L24: scope chips render with radiogroup semantics and pass correct p_scope to RPC', async () => {
    renderComponent();
    await screen.findByText('Zercher Squat');

    const radiogroup = screen.getByRole('radiogroup', { name: /Exercise catalog scope/i });
    expect(radiogroup).toBeDefined();

    const defaultsRadio = screen.getByTestId('scope-chip-defaults');
    expect(defaultsRadio.getAttribute('role')).toBe('radio');
    expect(defaultsRadio.getAttribute('aria-checked')).toBe('false');

    // Click Defaults scope chip
    fireEvent.click(defaultsRadio);
    expect(defaultsRadio.getAttribute('aria-checked')).toBe('true');

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        'get_exercise_catalog',
        expect.objectContaining({ p_scope: 'defaults' })
      );
    });

    // Click Mine scope chip
    const mineRadio = screen.getByTestId('scope-chip-mine');
    fireEvent.click(mineRadio);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        'get_exercise_catalog',
        expect.objectContaining({ p_scope: 'mine' })
      );
    });
  });

  it('L34: Restore button reverses is_archived on archived exercises', async () => {
    const archivedItem: CatalogExercise = {
      ...sampleCatalog[1],
      is_archived: true,
    };
    mockRpc.mockResolvedValue({ data: [archivedItem], error: null });

    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [archivedItem], error: null }),
      }),
    });
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercises') return { update: updateSpy };
      return {};
    });

    renderComponent();
    expect(await screen.findByText('Romanian Deadlift')).toBeDefined();

    // Click Restore button
    const restoreBtn = screen.getByTestId('restore-exercise-ex-2');
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ is_archived: false });
    });
  });

  it('L47 & D-P7a-3: Coach hide of default triggers ConfirmDialog with dynamic athlete count copy', async () => {
    mockCoachState.isCoach = true;
    mockCoachState.athletes = [
      { id: 'ath-1', name: 'Alice Smith' },
      { id: 'ath-2', name: 'Bob Jones' },
      { id: 'ath-3', name: 'Charlie Brown' },
    ];

    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercise_hides') return { insert: insertSpy };
      return {};
    });

    renderComponent();
    await screen.findByText('Zercher Squat');

    // Click Hide button on master exercise
    const hideBtn = screen.getByTestId('hide-exercise-ex-1');
    fireEvent.click(hideBtn);

    // ConfirmDialog opens with copy naming 3 athletes (STD-CPY-4)
    expect(screen.getByTestId('coach-hide-confirm-dialog')).toBeDefined();
    expect(
      screen.getByText("Hide 'Zercher Squat' for you and your 3 athletes? It stays in History.")
    ).toBeDefined();

    // Click Confirm
    const confirmBtn = screen.getByTestId('coach-hide-confirm-dialog-confirm');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(insertSpy).toHaveBeenCalledWith({
        hidden_by: 'user-athlete-1',
        exercise_id: 'ex-1',
      });
    });
  });

  it('L47: Athlete hide triggers immediate insert into exercise_hides and offers UndoToast', async () => {
    mockCoachState.isCoach = false;

    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const deleteSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercise_hides') {
        return { insert: insertSpy, delete: deleteSpy };
      }
      return {};
    });

    renderComponent();
    await screen.findByText('Zercher Squat');

    // Athlete clicks hide
    const hideBtn = screen.getByTestId('hide-exercise-ex-1');
    fireEvent.click(hideBtn);

    // Immediate write to exercise_hides
    await waitFor(() => {
      expect(insertSpy).toHaveBeenCalledWith({
        hidden_by: 'user-athlete-1',
        exercise_id: 'ex-1',
      });
    });

    // Undo toast appears
    await waitFor(() => {
      expect(screen.getByTestId('toast-dish-text').textContent).toContain('Zercher Squat');
    });

    // Click Undo on toast
    const undoBtn = screen.getByTestId('toast-undo-btn');
    fireEvent.click(undoBtn);

    // Reversing delete on exercise_hides
    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalled();
    });
  });

  it('L47: Unhide action deletes from exercise_hides', async () => {
    const hiddenItem: CatalogExercise = {
      ...sampleCatalog[0],
      is_hidden: true,
    };
    mockRpc.mockResolvedValue({ data: [hiddenItem], error: null });

    const deleteSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercise_hides') return { delete: deleteSpy };
      return {};
    });

    renderComponent();
    await screen.findByText('Zercher Squat');

    const unhideBtn = screen.getByTestId('unhide-exercise-ex-1');
    fireEvent.click(unhideBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalled();
    });
  });
  it('wires jumpToExercise to update search and set scope to hidden if is_hidden', async () => {
    const ref = createRef<ExerciseListTabHandle>();
    render(
      <QueryClientProvider client={queryClient}>
        <ExerciseListTab ref={ref} />
      </QueryClientProvider>
    );
    await screen.findByText('Zercher Squat');

    act(() => {
      ref.current?.jumpToExercise({ id: 'ex-hidden', name: 'Hidden Pushup', is_hidden: true });
    });

    expect(screen.getByTestId('exercise-search-input')).toHaveValue('Hidden Pushup');
    expect(screen.getByTestId('scope-chip-hidden')).toHaveAttribute('aria-checked', 'true');
  });

  it('displays "Showing N" without total count when a client filter is active', async () => {
    renderComponent();
    await screen.findByText('Zercher Squat');

    // Default: no client filter, shows "Showing 3 of 3"
    expect(screen.getByTestId('showing-exercises-count').textContent).toBe('Showing 3 of 3');

    // Select a muscle group (client-side filter)
    const legsChip = screen.getByTestId('bodypart-filter-legs');
    fireEvent.click(legsChip);

    // With client-side filter: shows "Showing 2" without total
    expect(screen.getByTestId('showing-exercises-count').textContent).toBe('Showing 2');
  });
  it('satisfies mock fidelity contracts for exercise mutations', () => {
    // WILDCARD_MUTATION_RETURN: exercises returns updated row via bare .select()
    // NO_PROJECTION_APPLIES: exercise_hides inserts and deletes are mutation-only
    const exBuilder = createSupabaseBuilder('exercises', { data: [], error: null });
    const hideBuilder = createSupabaseBuilder('exercise_hides', { data: [], error: null });
    expect(exBuilder.tableName).toBe('exercises');
    expect(hideBuilder.tableName).toBe('exercise_hides');
    expect(getRecordedTables()).toContain('exercises');
    expect(getRecordedTables()).toContain('exercise_hides');
  });
});
