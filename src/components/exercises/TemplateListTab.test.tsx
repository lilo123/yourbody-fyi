import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TemplateListTab } from './TemplateListTab';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, clearMockHistory, getRecordedTables } from '../../test/supabaseBuilderMock';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import type { Exercise, RoutineTemplate } from '../../types/database';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockUser = { id: 'user-athlete-1', email: 'athlete@yourbody.fyi' };
const mockCoachState = {
  isCoach: false,
  selectedAthleteId: null as string | null,
};

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('../../hooks/useCoach', () => ({
  useCoach: () => mockCoachState,
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => createSupabaseBuilder(table, { data: [], error: null })),
    rpc: vi.fn(),
  },
}));

describe('TemplateListTab - Routine Features', () => {
  let queryClient: QueryClient;

  const mockExercises: Exercise[] = [
    {
      id: 'ex-bench',
      name: 'Barbell Bench Press',
      body_parts: ['Chest'],
      is_archived: false,
    },
    {
      id: 'ex-incline',
      name: 'Incline Dumbbell Press',
      body_parts: ['Chest'],
      is_archived: true, // Archived exercise for testing
    },
    {
      id: 'ex-fly',
      name: 'Cable Fly',
      body_parts: ['Chest'],
      is_archived: false,
    },
  ];

  const mockTemplates: RoutineTemplate[] = [
    {
      id: 'tpl-push',
      user_id: 'user-athlete-1',
      name: 'Chest & Triceps Push',
      is_master: false,
      assigned_to: null,
      days_of_week: ['Mon', 'Thu'],
      exercises: [
        {
          id: 'te-1',
          template_id: 'tpl-push',
          exercise_id: 'ex-bench',
          order_index: 0,
          target_sets: 4,
          target_reps: 8,
          exercise: { name: 'Barbell Bench Press' },
        },
        {
          id: 'te-2',
          template_id: 'tpl-push',
          exercise_id: 'ex-incline',
          order_index: 1,
          target_sets: 3,
          target_reps: 10,
          exercise: { name: 'Incline Dumbbell Press' },
        },
      ],
    },
    {
      id: 'tpl-legs',
      user_id: 'user-athlete-1',
      name: 'Leg Day Blast',
      is_master: false,
      assigned_to: null,
      days_of_week: ['Tue', 'Fri'],
      exercises: [
        {
          id: 'te-3',
          template_id: 'tpl-legs',
          exercise_id: 'ex-fly',
          order_index: 0,
          target_sets: 3,
          target_reps: 12,
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    vi.mocked(useOnlineStatus).mockReturnValue(true);
    (supabase.rpc as any).mockImplementation((fn: string) => {
      if (fn === 'get_routine_catalog') {
        return Promise.resolve({ data: mockTemplates, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderComponent = (props: Partial<Parameters<typeof TemplateListTab>[0]> = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ToastProvider>
            <TemplateListTab
              exercises={mockExercises}
              targetUserId="user-athlete-1"
              {...props}
            />
            <ToastHost />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  describe('Deferred Delete', () => {
    it('sends 0 DELETE calls before 6s expiry, and exactly 1 DELETE after expiry', async () => {
      vi.useFakeTimers();

      const mockDeleteSelect = vi.fn().mockResolvedValue({
        data: [{ id: 'tpl-push' }],
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ select: mockDeleteSelect });
      const mockDelete = vi.fn().mockReturnValue({ eq: mockEq });
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'routine_templates') {
          return { delete: mockDelete };
        }
        return {};
      });

      renderComponent({ deleteTimeoutMs: 6000 });

      // Resolve query with fake timers
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      // Find the delete button for tpl-push
      const deleteBtn = screen.getByTestId('delete-template-tpl-push');
      expect(deleteBtn).toBeDefined();

      // Click delete
      fireEvent.click(deleteBtn);

      // Card is optimistically hidden from template list immediately
      expect(screen.queryByTestId('delete-template-tpl-push')).toBeNull();
      expect(screen.queryByTestId('start-routine-tpl-push')).toBeNull();

      // Undo toast is visible with Undo button and subject
      expect(screen.getByTestId('quick-log-toast')).toBeDefined();
      expect(screen.getByTestId('toast-undo-btn')).toBeDefined();
      expect(screen.getByTestId('toast-dish-text').textContent).toContain('Chest & Triceps Push');

      // At 0ms: 0 DELETE calls sent
      expect(mockDelete).not.toHaveBeenCalled();

      // Advance 5900ms (before 6000ms expiry): still 0 DELETE calls
      act(() => {
        vi.advanceTimersByTime(5900);
      });
      expect(mockDelete).not.toHaveBeenCalled();

      // Advance past 6000ms expiry: exactly 1 DELETE call executed
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockEq).toHaveBeenCalledWith('id', 'tpl-push');
      expect(mockDeleteSelect).toHaveBeenCalledTimes(1);
    });

    it('clicking Undo restores template and sends 0 DELETE calls', async () => {
      vi.useFakeTimers();

      const mockDelete = vi.fn();
      vi.mocked(supabase.from).mockImplementation(() => ({ delete: mockDelete }));

      renderComponent({ deleteTimeoutMs: 6000 });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      const deleteBtn = screen.getByTestId('delete-template-tpl-push');
      fireEvent.click(deleteBtn);

      // Template card is optimistically hidden
      expect(screen.queryByTestId('delete-template-tpl-push')).toBeNull();

      // Click Undo button
      const undoBtn = screen.getByTestId('toast-undo-btn');
      fireEvent.click(undoBtn);

      // Template card is restored to the list
      expect(screen.getByTestId('delete-template-tpl-push')).toBeDefined();
      expect(screen.getByTestId('start-routine-tpl-push')).toBeDefined();

      // Advance past 6000ms: still 0 DELETE calls
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('displays StatusBanner error and restores row when delete fails', async () => {
      vi.useFakeTimers();

      // Mock failure (0 rows affected)
      const mockDeleteSelect = vi.fn().mockResolvedValue({
        data: [],
        error: null,
      });
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'routine_templates') {
          return {
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: mockDeleteSelect,
              }),
            }),
          };
        }
        return {};
      });

      renderComponent({ deleteTimeoutMs: 6000 });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      const deleteBtn = screen.getByTestId('delete-template-tpl-push');
      fireEvent.click(deleteBtn);

      // Advance past 6000ms to trigger commit
      await act(async () => {
        vi.advanceTimersByTime(6100);
      });

      // Error banner displays
      const errorBanner = screen.getByTestId('template-action-error');
      expect(errorBanner).toBeDefined();
      expect(errorBanner.textContent).toContain('Routine template could not be deleted.');

      // Row is restored in the list
      expect(screen.getByTestId('delete-template-tpl-push')).toBeDefined();
    });
  });

  describe('Accordion Preview & Archived Pill', () => {
    it('toggles accordion preview with aria-expanded and displays exercises with sets x reps', async () => {
      renderComponent();

      const accordionBtn = await screen.findByTestId('template-accordion-btn-tpl-push');
      expect(accordionBtn).toHaveAttribute('aria-expanded', 'false');
      expect(accordionBtn).toHaveAttribute('aria-controls', 'template-preview-tpl-push');

      // Exercises should not be visible before expanding
      expect(screen.queryByTestId('template-preview-tpl-push')).toBeNull();

      // Click to expand
      fireEvent.click(accordionBtn);
      expect(accordionBtn).toHaveAttribute('aria-expanded', 'true');

      const previewContainer = screen.getByTestId('template-preview-tpl-push');
      expect(previewContainer).toBeDefined();

      // Assert exercise names are rendered
      expect(screen.getByText('Barbell Bench Press')).toBeDefined();
      expect(screen.getByText('Incline Dumbbell Press')).toBeDefined();

      // Assert sets x reps formatting
      expect(screen.getByText('4 × 8')).toBeDefined();
      expect(screen.getByText('3 × 10')).toBeDefined();

      // Click again to collapse
      fireEvent.click(accordionBtn);
      expect(accordionBtn).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('template-preview-tpl-push')).toBeNull();
    });

    it('marks archived exercise in preview with an "Archived" Tag pill', async () => {
      renderComponent();

      // Expand accordion
      const accordionBtn = await screen.findByTestId('template-accordion-btn-tpl-push');
      fireEvent.click(accordionBtn);

      // ex-incline is archived (is_archived: true)
      const archivedPill = screen.getByTestId('archived-pill-te-2');
      expect(archivedPill).toBeDefined();
      expect(archivedPill.textContent).toContain('Archived');

      // ex-bench is NOT archived
      expect(screen.queryByTestId('archived-pill-te-1')).toBeNull();
    });
  });

  describe('"Start routine" Deep Link Navigation', () => {
    it('clicking "Start routine" navigates to /workout?routine=${template.id}', async () => {
      renderComponent();

      const startBtn = await screen.findByTestId('start-routine-tpl-push');
      expect(startBtn).toBeDefined();
      expect(startBtn.textContent).toContain('Start routine');

      fireEvent.click(startBtn);

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/workout?routine=tpl-push');
    });

    it('calls optional onStartRoutine callback when provided', async () => {
      const onStartRoutine = vi.fn();
      renderComponent({ onStartRoutine });

      const startBtn = await screen.findByTestId('start-routine-tpl-legs');
      fireEvent.click(startBtn);

      expect(onStartRoutine).toHaveBeenCalledWith(mockTemplates[1]);
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Day Filter Toolbar Radiogroup', () => {
    it('has role="radiogroup" and day buttons with role="radio" and aria-checked', async () => {
      renderComponent();

      const radiogroup = await screen.findByRole('radiogroup', { name: /filter templates by day/i });
      expect(radiogroup).toBeDefined();

      const allRadio = screen.getByTestId('day-filter-All');
      expect(allRadio).toHaveAttribute('role', 'radio');
      expect(allRadio).toHaveAttribute('aria-checked', 'true');

      const monRadio = screen.getByTestId('day-filter-Mon');
      expect(monRadio).toHaveAttribute('role', 'radio');
      expect(monRadio).toHaveAttribute('aria-checked', 'false');

      // Filter by Mon
      fireEvent.click(monRadio);
      expect(monRadio).toHaveAttribute('aria-checked', 'true');
      expect(allRadio).toHaveAttribute('aria-checked', 'false');

      // Mon matches tpl-push (scheduled on Mon, Thu), but not tpl-legs (Tue, Fri)
      expect(screen.getByTestId('delete-template-tpl-push')).toBeDefined();
      expect(screen.queryByTestId('delete-template-tpl-legs')).toBeNull();
    });
  });

  it('satisfies mock fidelity contracts for routine template deletion', () => {
    // WILDCARD_MUTATION_RETURN: routine_templates returns deleted row via bare .select()
    const tplBuilder = createSupabaseBuilder('routine_templates', { data: [], error: null });
    expect(tplBuilder.tableName).toBe('routine_templates');
    expect(getRecordedTables()).toContain('routine_templates');

    // NO_PROJECTION_APPLIES: routine_template_hides inserts and deletes are mutation-only
    const hideBuilder = createSupabaseBuilder('routine_template_hides', { data: [], error: null });
    expect(hideBuilder.tableName).toBe('routine_template_hides');
    expect(getRecordedTables()).toContain('routine_template_hides');
  });

  describe('get_routine_catalog integration', () => {
    it('loads routines via get_routine_catalog RPC with targetUserId', async () => {
      renderComponent();

      await screen.findByText('Chest & Triceps Push');

      expect(supabase.rpc).toHaveBeenCalledWith('get_routine_catalog', {
        p_user_id: 'user-athlete-1',
        p_limit: 50,
      });
    });

    it('renders routine items and exercise count returned by get_routine_catalog', async () => {
      renderComponent();

      // Verifies it renders routines from get_routine_catalog
      await screen.findByText('Chest & Triceps Push');
      expect(screen.getByText('Leg Day Blast')).toBeDefined();
    });

    it('displays error banner when get_routine_catalog fails', async () => {
      (supabase.rpc as any).mockImplementation((fn: string) => {
        if (fn === 'get_routine_catalog') {
          return Promise.resolve({ data: null, error: new Error('Catalog RPC failure') });
        }
        return Promise.resolve({ data: null, error: null });
      });

      renderComponent();

      const errorElements = await screen.findAllByText(/Catalog RPC failure/);
      expect(errorElements.length).toBeGreaterThanOrEqual(1);
    });

    it('disables New Routine button and delete button with helper text when offline', async () => {
      vi.mocked(useOnlineStatus).mockReturnValue(false);

      renderComponent();

      await screen.findByText('Chest & Triceps Push');

      expect(screen.getByTestId('offline-new-template-helper').textContent).toBe('Available when online');

      const createBtn = screen.getByTestId('new-template-btn');
      expect(createBtn).toBeDisabled();
      expect(createBtn.getAttribute('title')).toBe('Available when online');

      const deleteBtn = screen.getByTestId('delete-template-tpl-push');
      expect(deleteBtn).toBeDisabled();
      expect(deleteBtn.getAttribute('title')).toBe('Available when online');
    });
  });

  describe('Master Template Library - Copy-on-Write and Hide/Unhide', () => {
    const mockMasterTemplate: RoutineTemplate = {
      id: 'tpl-master-1',
      user_id: 'coach-1',
      name: 'Master Hypertrophy Push',
      is_master: true,
      assigned_to: null,
      days_of_week: ['Mon', 'Thu'],
      exercises: [
        {
          id: 'te-m1',
          template_id: 'tpl-master-1',
          exercise_id: 'ex-bench',
          order_index: 0,
          target_sets: 4,
          target_reps: 8,
          exercise: { name: 'Barbell Bench Press' },
        },
      ],
    };

    it('clicking Edit on master opens EditTemplateSheet in fork mode with sourceTemplateId', async () => {
      (supabase.rpc as any).mockImplementation((fn: string) => {
        if (fn === 'get_routine_catalog') {
          return Promise.resolve({ data: [mockMasterTemplate], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      renderComponent();

      const editBtn = await screen.findByTestId('edit-template-tpl-master-1');
      expect(editBtn).toBeDefined();

      fireEvent.click(editBtn);

      // Sheet opens in fork mode
      expect(screen.getByTestId('edit-template-modal')).toBeDefined();
      expect(screen.getByText('Duplicate & Customize Template')).toBeDefined();
      expect(screen.getByTestId('template-name-input')).toHaveValue('Master Hypertrophy Push');
    });

    it('clicking Delete on master triggers deferred hide and inserts into routine_template_hides', async () => {
      vi.useFakeTimers();

      const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'routine_template_hides') {
          return { insert: mockInsert } as any;
        }
        return {} as any;
      });

      (supabase.rpc as any).mockImplementation((fn: string) => {
        if (fn === 'get_routine_catalog') {
          return Promise.resolve({ data: [mockMasterTemplate], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      renderComponent({ deleteTimeoutMs: 6000 });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      const hideBtn = screen.getByTestId('delete-template-tpl-master-1');
      expect(hideBtn).toBeDefined();
      expect(hideBtn).toHaveAttribute('aria-label', 'Hide routine');

      fireEvent.click(hideBtn);

      // Card is optimistically hidden
      expect(screen.queryByTestId('delete-template-tpl-master-1')).toBeNull();

      // Toast shows "Hide routine"
      expect(screen.getByTestId('toast-dish-text').textContent).toContain('Master Hypertrophy Push');

      // Before expiry: 0 writes
      expect(mockInsert).not.toHaveBeenCalled();

      // Advance past 6s
      await act(async () => {
        vi.advanceTimersByTime(6100);
      });

      // Insert committed to routine_template_hides
      expect(mockInsert).toHaveBeenCalledWith({
        hidden_by: 'user-athlete-1',
        template_id: 'tpl-master-1',
      });
    });

    it('clicking Undo on master hide restores the template and sends 0 insert calls', async () => {
      vi.useFakeTimers();

      const mockInsert = vi.fn();
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'routine_template_hides') {
          return { insert: mockInsert } as any;
        }
        return {} as any;
      });

      (supabase.rpc as any).mockImplementation((fn: string) => {
        if (fn === 'get_routine_catalog') {
          return Promise.resolve({ data: [mockMasterTemplate], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      renderComponent({ deleteTimeoutMs: 6000 });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      const hideBtn = screen.getByTestId('delete-template-tpl-master-1');
      fireEvent.click(hideBtn);

      expect(screen.queryByTestId('delete-template-tpl-master-1')).toBeNull();

      const undoBtn = screen.getByTestId('toast-undo-btn');
      fireEvent.click(undoBtn);

      expect(screen.getByTestId('delete-template-tpl-master-1')).toBeDefined();

      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('toggling "Show hidden routines" displays hidden routines and clicking "Unhide" deletes the hide record', async () => {
      const mockHiddenMaster: RoutineTemplate = {
        id: 'tpl-hidden-1',
        user_id: 'coach-1',
        name: 'Hidden Master Routine',
        is_master: true,
        assigned_to: null,
      };

      const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
      const mockDelete = vi.fn().mockReturnValue({ eq: mockEq1 });

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'routine_template_hides') {
          return { delete: mockDelete } as any;
        }
        return {} as any;
      });

      (supabase.rpc as any).mockImplementation((fn: string) => {
        if (fn === 'get_routine_catalog') {
          return Promise.resolve({ data: [], error: null });
        }
        if (fn === 'get_hidden_routine_templates') {
          return Promise.resolve({ data: [mockHiddenMaster], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      renderComponent();

      const toggleBtn = await screen.findByTestId('show-hidden-routines-toggle');
      expect(toggleBtn.textContent).toBe('Show hidden routines');

      // Click toggle to show hidden routines
      fireEvent.click(toggleBtn);

      const unhideBtn = await screen.findByTestId('unhide-template-tpl-hidden-1');
      expect(unhideBtn).toBeDefined();
      expect(unhideBtn.textContent).toBe('Unhide');
      expect(screen.getByText('Hidden Master Routine')).toBeDefined();

      // Click Unhide
      fireEvent.click(unhideBtn);

      expect(mockDelete).toHaveBeenCalled();
      expect(mockEq1).toHaveBeenCalledWith('template_id', 'tpl-hidden-1');
      expect(mockEq2).toHaveBeenCalledWith('hidden_by', 'user-athlete-1');
    });
  });
});
