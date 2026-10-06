import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ExercisesView } from './ExercisesView';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import { CoachProvider } from '../../context/CoachContext';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory, SupabaseQueryBuilderMock } from '../../test/supabaseBuilderMock';
import { workoutSessionStore } from '../../utils/workoutSessionStore';

const { mockAthleteSession, mockCoachState } = vi.hoisted(() => ({
  mockAthleteSession: {
    user: { id: 'a0000000-0000-4000-8000-000000000123', email: 'athlete@example.com' },
  },
  mockCoachState: {
    isCoach: false,
    selectedAthleteId: 'a0000000-0000-4000-8000-000000000123',
  },
}));

vi.mock('../../hooks/useCoach', () => ({
  useCoach: () => mockCoachState,
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'a0000000-0000-4000-8000-000000000123' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockAthleteSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe('ExercisesView - Exercise Isolation & Schedule Days', () => {
  let queryClient: QueryClient;
  const mockInsertExercise = vi.fn();
  const mockInsertTemplate = vi.fn();
  const mockUpdateExercise = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 'ex-custom-1' }], error: null }) }) });
  const mockUpdateTemplate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  const mockDeleteTemplate = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 'tpl-1' }], error: null }) }) });
  const mockRpc = vi.fn();
  let currentTemplates: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    localStorage.clear();
    sessionStorage.clear();
    workoutSessionStore.resetForTesting();
    mockCoachState.isCoach = false;
    mockCoachState.selectedAthleteId = 'a0000000-0000-4000-8000-000000000123';
    mockAthleteSession.user.id = 'a0000000-0000-4000-8000-000000000123';

    const sampleExercises = [
      { id: 'ex-master-1', name: 'Barbell Squat', body_parts: ['Legs'], is_master: true, user_id: null, is_archived: false },
      { id: 'ex-custom-1', name: 'My Athlete Curl', body_parts: ['Arms'], is_master: false, user_id: 'a0000000-0000-4000-8000-000000000123', is_archived: false },
    ];

    currentTemplates = [
      {
        id: 'tpl-1',
        user_id: 'a0000000-0000-4000-8000-000000000123',
        name: 'Leg Blast',
        is_master: false,
        days_of_week: ['Mon', 'Thu'],
        exercises: [
          {
            id: 'te-1',
            template_id: 'tpl-1',
            exercise_id: 'ex-master-1',
            order_index: 0,
            target_sets: 3,
            target_reps: 10,
            exercise: { id: 'ex-master-1', name: 'Barbell Squat', body_parts: ['Legs'] },
          },
        ],
      },
    ];

    mockRpc.mockImplementation((name: string) => {
      if (name === 'get_exercise_catalog') {
        const rows = sampleExercises.map((ex) => ({
          ...ex,
          body_parts: ex.body_parts || [],
          equipment: 'Barbell',
          total_count: sampleExercises.length,
          is_hidden: false,
        }));
        return Promise.resolve({ data: rows, error: null });
      }
      if (name === 'get_routine_catalog') {
        return Promise.resolve({ data: currentTemplates, error: null });
      }
      if (name === 'save_routine_template') {
        return Promise.resolve({ data: { id: 'saved-tpl-id' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    (supabase.rpc as any) = mockRpc;

    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockAthleteSession } });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercises') {
        const b = createSupabaseBuilder('exercises', { data: sampleExercises, error: null });
        b.insert = mockInsertExercise.mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'new-ex-id', name: 'Dumbbell Hammer Curl' },
              error: null,
            }),
          }),
        });
        b.update = mockUpdateExercise;
        return b;
      }
      if (table === 'routine_templates') {
        const b = createSupabaseBuilder('routine_templates', {
          resolver: (builder: SupabaseQueryBuilderMock) => {
            const idFilter = builder.filters.find((f: any) => f.column === 'id');
            if (idFilter) {
              const matched = currentTemplates.filter((t) => t.id === idFilter.value);
              return { data: matched, error: null };
            }
            return { data: currentTemplates, error: null };
          },
        });
        b.insert = mockInsertTemplate.mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'new-tpl-id', name: 'Push Routine', days_of_week: ['Mon', 'Wed'] },
              error: null,
            }),
          }),
        });
        b.update = mockUpdateTemplate;
        b.delete = mockDeleteTemplate;
        return b;
      }
      if (table === 'template_exercises') {
        const b = createSupabaseBuilder('template_exercises', { data: [], error: null });
        b.insert = vi.fn().mockResolvedValue({ error: null });
        return b;
      }
      if (table === 'users') {
        return createSupabaseBuilder('users', {
          data: { id: 'a0000000-0000-4000-8000-000000000123', role: 'athlete', username: 'TestAthlete' },
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <CoachProvider>
              <ExercisesView />
            </CoachProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    );

  it('has accessible label association for Exercise Name', async () => {
    renderComponent();
    await screen.findByText('Barbell Squat');
    fireEvent.click(screen.getByTestId('open-create-exercise-btn'));
    expect(screen.getByLabelText(/exercise name/i)).toBeDefined();
  });

  it('renders exercise library with Master badges and isolates delete permission', async () => {
    renderComponent();

    // Both master exercise and custom exercise should appear in library
    expect(await screen.findByText('Barbell Squat')).toBeDefined();
    expect(screen.getByText('Default')).toBeDefined();
    expect(screen.getByText('My Athlete Curl')).toBeDefined();

    // Verify archive button: athlete has 1 custom exercise, so only 1 archive button should be rendered
    await waitFor(() => {
      const archiveButtons = screen.getAllByTestId(/^archive-exercise-/);
      expect(archiveButtons.length).toBe(1);
    });

    expect(getRecordedTables()).toContain('exercises');
    expect(getRecordedSelects()).toContainEqual({
      table: 'exercises',
      projection: 'id, name, body_parts, is_master, is_archived, user_id, created_at',
    });
    expect(getRecordedTables()).toContain('users');
    expect(getRecordedSelects()).toContainEqual({
      table: 'users',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
    });
    // template_exercises is mutation-only (insert); NO_PROJECTION_APPLIES
  });

  it('creates custom exercise scoped to the athlete', async () => {
    renderComponent();
    await screen.findByText('Barbell Squat');
    fireEvent.click(screen.getByTestId('open-create-exercise-btn'));

    const nameInput = await screen.findByPlaceholderText('e.g. Incline Bench Press');
    fireEvent.change(nameInput, { target: { value: 'Dumbbell Hammer Curl' } });

    const armsBtn = screen.getAllByRole('button', { name: 'Arms' })[1];
    fireEvent.click(armsBtn);

    const saveBtn = screen.getByRole('button', { name: 'Save to Library' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockInsertExercise).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Dumbbell Hammer Curl',
          body_parts: ['Arms'],
          is_master: false,
          user_id: 'a0000000-0000-4000-8000-000000000123',
        }),
      );
    });
  });

  it('renders saved routine templates with scheduled days of week badges', async () => {
    renderComponent();

    // Switch to Templates tab
    const templatesTab = screen.getByRole('tab', { name: /Templates/i });
    fireEvent.click(templatesTab);

    // Verify saved template and day badges
    expect(await screen.findByText('Leg Blast')).toBeDefined();
    expect(screen.getAllByText('Mon').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Thu').length).toBeGreaterThanOrEqual(2);
  });

  it('opens EditTemplateModal when Edit button is clicked on user template, edits details, and saves', async () => {
    renderComponent();

    const templatesTab = screen.getByRole('tab', { name: /Templates/i });
    fireEvent.click(templatesTab);

    expect(await screen.findByText('Leg Blast')).toBeDefined();

    const editBtn = screen.getByTestId('edit-template-tpl-1');
    expect(editBtn).toBeDefined();
    fireEvent.click(editBtn);

    // Modal opens prefilled
    expect(screen.getByTestId('edit-template-modal')).toBeDefined();
    const nameInput = await screen.findByTestId('template-name-input');
    expect(nameInput).toHaveValue('Leg Blast');

    // Modify name
    fireEvent.change(nameInput, { target: { value: 'Leg Blast Ultra' } });

    // Toggle Wednesday day pill
    const wedPill = screen.getByTestId('day-pill-Wed');
    fireEvent.click(wedPill);

    // Update target sets using touch stepper inc button
    const incSetsBtn = screen.getByTestId('inc-sets-0');
    fireEvent.click(incSetsBtn);
    const setsInput = screen.getByTestId('sets-input-0');
    expect(setsInput).toHaveValue(4);

    // Save template
    const saveBtn = screen.getByTestId('save-template-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('save_routine_template', expect.objectContaining({
        p_template_id: 'tpl-1',
        p_name: 'Leg Blast Ultra',
        p_days_of_week: ['Mon', 'Thu', 'Wed'],
        p_exercises: [
          expect.objectContaining({
            exercise_id: 'ex-master-1',
            target_sets: 4,
          }),
        ],
        p_user_id: 'a0000000-0000-4000-8000-000000000123',
        p_is_master: false,
      }));
      expect(screen.queryByTestId('edit-template-modal')).toBeNull();
    });

    // EditTemplateSheet fetch-on-open query contract
    expect(getRecordedTables()).toContain('routine_templates');
    expect(getRecordedSelects()).toContainEqual({
      table: 'routine_templates',
      projection: '*, exercises:template_exercises(*, exercise:exercises(*))',
    });
  });

  it('renders Duplicate & Customize button for master routines and allows forking into a personal template', async () => {
    const masterTpl = {
      id: 'tpl-master-1',
      user_id: 'coach-999',
      name: 'Master Hypertrophy Push',
      is_master: true,
      days_of_week: ['Tue', 'Fri'],
      exercises: [
        {
          id: 'te-m1',
          template_id: 'tpl-master-1',
          exercise_id: 'ex-master-1',
          target_sets: 4,
          target_reps: 8,
          order_index: 0,
          exercise: { id: 'ex-master-1', name: 'Barbell Squat', body_parts: ['Legs'] },
        },
      ],
    };
    currentTemplates = [masterTpl];

    renderComponent();

    const templatesTab = screen.getByRole('tab', { name: /Templates/i });
    fireEvent.click(templatesTab);

    expect(await screen.findByText('Master Hypertrophy Push')).toBeDefined();
    expect(screen.getByText('Master')).toBeDefined();

    // Verify Fork button is rendered
    const forkBtn = screen.getByTestId('fork-template-tpl-master-1');
    expect(forkBtn).toBeDefined();

    // Click fork
    fireEvent.click(forkBtn);

    // Modal opens with copy title and prefilled clean name without (Copy)
    expect(screen.getByTestId('edit-template-modal')).toBeDefined();
    expect(screen.getByText('Duplicate & Customize Template')).toBeDefined();
    const nameInput = screen.getByTestId('template-name-input');
    expect(nameInput).toHaveValue('Master Hypertrophy Push');

    // Save forked template
    const saveBtn = screen.getByTestId('save-template-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('save_routine_template', {
        p_template_id: null, // Null template id means insert a new routine
        p_name: 'Master Hypertrophy Push',
        p_days_of_week: ['Tue', 'Fri'],
        p_exercises: [
          expect.objectContaining({
            exercise_id: 'ex-master-1',
            target_sets: 4,
            target_reps: 8,
          }),
        ],
        p_user_id: 'a0000000-0000-4000-8000-000000000123',
        p_is_master: false,
      });
    });
  });

  it('template-save RPC error sends NO fallback table writes and displays error banner', async () => {
    const errTpl = {
      id: 'tpl-master-err',
      user_id: 'coach-999',
      name: 'Master Routine',
      is_master: true,
      days_of_week: ['Mon'],
      exercises: [
        {
          id: 'te-1',
          template_id: 'tpl-master-err',
          exercise_id: 'ex-master-1',
          target_sets: 3,
          target_reps: 10,
          order_index: 0,
          exercise: { id: 'ex-master-1', name: 'Barbell Squat', body_parts: ['Legs'] },
        },
      ],
    };
    currentTemplates = [errTpl];

    mockRpc.mockImplementation((name: string) => {
      if (name === 'get_routine_catalog') {
        return Promise.resolve({ data: currentTemplates, error: null });
      }
      if (name === 'save_routine_template') {
        return Promise.resolve({ data: null, error: { message: 'RPC save error' } });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const mockDeleteTpl = vi.fn();
    const mockInsertTpl = vi.fn();

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'routine_templates') {
        const b = createSupabaseBuilder('routine_templates', {
          resolver: (builder: SupabaseQueryBuilderMock) => {
            const idFilter = builder.filters.find((f: any) => f.column === 'id');
            if (idFilter) {
              const matched = currentTemplates.filter((t) => t.id === idFilter.value);
              return { data: matched, error: null };
            }
            return { data: currentTemplates, error: null };
          },
        });
        b.insert = mockInsertTpl;
        b.delete = mockDeleteTpl;
        return b;
      }
      if (table === 'template_exercises') {
        const b = createSupabaseBuilder('template_exercises', { data: [], error: null });
        b.insert = vi.fn();
        return b;
      }
      if (table === 'exercises') {
        return createSupabaseBuilder('exercises', {
          data: [{ id: 'ex-master-1', name: 'Barbell Squat', body_parts: ['Legs'] }],
          error: null,
        });
      }
      return createSupabaseBuilder(table, {
        data: { id: 'a0000000-0000-4000-8000-000000000123' },
        error: null,
      });
    });

    renderComponent();

    const templatesTab = screen.getByRole('tab', { name: /Templates/i });
    fireEvent.click(templatesTab);

    const forkBtn = await screen.findByTestId('fork-template-tpl-master-err');
    fireEvent.click(forkBtn);

    const saveBtn = screen.getByTestId('save-template-btn');
    fireEvent.click(saveBtn);

    // Should display error banner and execute NO fallback writes
    await waitFor(() => {
      expect(screen.getByTestId('template-error')).toBeDefined();
      expect(mockInsertTpl).not.toHaveBeenCalled();
      expect(mockDeleteTpl).not.toHaveBeenCalled();
    });
  });

  it('updates exercise in library and synchronizes active workout session drafts via renameExercise', async () => {
    // Initialize active session in workoutSessionStore with old exercise name
    workoutSessionStore.getOrInitSession('a0000000-0000-4000-8000-000000000123', '2026-09-08', {
      routineName: 'Arm Day',
      exercises: ['My Athlete Curl'],
      targetSetCounts: { 'My Athlete Curl': 3 },
      targetRepCounts: { 'My Athlete Curl': 10 },
    });
    workoutSessionStore.setDraftInput('a0000000-0000-4000-8000-000000000123', '2026-09-08', 'My Athlete Curl', 0, { weight: '35', reps: '10' });
    workoutSessionStore.flushPendingWrites();

    renderComponent();

    // Verify custom exercise is rendered in library with Edit button
    expect(await screen.findByText('My Athlete Curl')).toBeDefined();
    const editBtn = screen.getByTestId('edit-exercise-ex-custom-1');
    expect(editBtn).toBeDefined();

    // Click edit button
    fireEvent.click(editBtn);

    // Modal opens with existing name
    expect(screen.getByTestId('edit-exercise-modal')).toBeDefined();
    const nameInput = screen.getByTestId('edit-exercise-name-input');
    expect(nameInput).toHaveValue('My Athlete Curl');

    // Update name to 'Bicep Cable Curl'
    fireEvent.change(nameInput, { target: { value: 'Bicep Cable Curl' } });

    // Toggle Core muscle chip in modal
    const modal = screen.getByTestId('edit-exercise-modal');
    const coreChip = within(modal).getByRole('button', { name: /^Core$/i });
    fireEvent.click(coreChip);

    // Save changes
    const saveBtn = screen.getByTestId('save-exercise-btn');
    fireEvent.click(saveBtn);

    // Verify Supabase update call
    await waitFor(() => {
      expect(mockUpdateExercise).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bicep Cable Curl',
          body_parts: expect.arrayContaining(['Arms']),
        })
      );
    });

    // Verify active workout session was synchronized via workoutSessionStore.renameExercise
    const session = workoutSessionStore.getSession('a0000000-0000-4000-8000-000000000123', '2026-09-08');
    expect(session?.exercises).toEqual(['Bicep Cable Curl']);
    expect(session?.targetSetCounts['Bicep Cable Curl']).toBe(3);
    expect(session?.targetSetCounts['My Athlete Curl']).toBeUndefined();
    expect(session?.inputDrafts['Bicep Cable Curl_0']).toEqual({ weight: '35', reps: '10' });
    expect(session?.inputDrafts['My Athlete Curl_0']).toBeUndefined();

    // Modal is closed
    await waitFor(() => {
      expect(screen.queryByTestId('edit-exercise-modal')).toBeNull();
    });
  });

  it('enforces comprehensive permission matrix: coach edits master (with warning banner) vs athlete fork vs coach impersonation', async () => {
    const masterTpl = {
      id: 'tpl-master-matrix',
      user_id: 'coach-999',
      name: 'Master Power Clean',
      is_master: true,
      days_of_week: ['Tue', 'Thu'],
      exercises: [
        {
          id: 'te-m1',
          template_id: 'tpl-master-matrix',
          exercise_id: 'ex-master-1',
          target_sets: 4,
          target_reps: 6,
          order_index: 0,
          exercise: { id: 'ex-master-1', name: 'Barbell Squat', body_parts: ['Legs'] },
        },
      ],
    };
    currentTemplates = [masterTpl];

    // 1. Scenario A: Coach in Catalog Mode (isCoach = true, selectedAthleteId = '')
    mockCoachState.isCoach = true;
    mockCoachState.selectedAthleteId = '';

    const { unmount: unmountA } = renderComponent();
    fireEvent.click(screen.getByRole('tab', { name: /Templates/i }));

    expect(await screen.findByText('Master Power Clean')).toBeDefined();
    // Coach can edit master directly
    const coachEditBtn = screen.getByTestId('edit-template-tpl-master-matrix');
    expect(coachEditBtn).toBeDefined();
    // Coach does NOT see duplicate Fork button in catalog mode
    expect(screen.queryByTestId('fork-template-tpl-master-matrix')).toBeNull();

    // Click Edit button: opens modal showing safety warning banner
    fireEvent.click(coachEditBtn);
    expect(screen.getByTestId('edit-template-modal')).toBeDefined();
    expect(await screen.findByText(/Editing Master Routine — changes will apply to all athletes/i)).toBeDefined();

    // Close modal and unmount
    fireEvent.click(screen.getByTestId('cancel-template-btn'));
    unmountA();

    // 2. Scenario B: Coach Impersonating an Athlete (isCoach = true, selectedAthleteId = 'a0000000-0000-4000-8000-000000000123')
    mockCoachState.isCoach = true;
    mockCoachState.selectedAthleteId = 'a0000000-0000-4000-8000-000000000123';

    const { unmount: unmountB } = renderComponent();
    fireEvent.click(screen.getByRole('tab', { name: /Templates/i }));

    expect(await screen.findByText('Master Power Clean')).toBeDefined();
    // Coach cannot directly edit master while impersonating an athlete
    expect(screen.queryByTestId('edit-template-tpl-master-matrix')).toBeNull();
    // Coach CAN customize/fork master for this specific athlete
    expect(screen.getByTestId('fork-template-tpl-master-matrix')).toBeDefined();
    unmountB();

    // 3. Scenario C: Athlete Mode (isCoach = false, selectedAthleteId = '')
    mockCoachState.isCoach = false;
    mockCoachState.selectedAthleteId = '';

    renderComponent();
    fireEvent.click(screen.getByRole('tab', { name: /Templates/i }));

    expect(await screen.findByText('Master Power Clean')).toBeDefined();
    // Athlete cannot edit master
    expect(screen.queryByTestId('edit-template-tpl-master-matrix')).toBeNull();
    // Athlete CAN customize/fork master
    const athleteForkBtn = screen.getByTestId('fork-template-tpl-master-matrix');
    expect(athleteForkBtn).toBeDefined();

    // Opening fork modal does NOT display the coach master warning banner
    fireEvent.click(athleteForkBtn);
    expect(screen.getByTestId('edit-template-modal')).toBeDefined();
    expect(screen.queryByText(/Editing Master Routine — changes will apply to all athletes/i)).toBeNull();
  });

  it('provides list-first template layout with day filter toolbar and + New Routine create mode trigger', async () => {
    const mondayTemplate = {
      id: 'tpl-mon',
      user_id: 'a0000000-0000-4000-8000-000000000123',
      name: 'Monday Heavy Push',
      is_master: false,
      days_of_week: ['Mon'],
      exercises: [
        {
          id: 'te-1',
          template_id: 'tpl-mon',
          exercise_id: 'ex-master-1',
          target_sets: 3,
          target_reps: 10,
          order_index: 0,
          exercise: { id: 'ex-master-1', name: 'Barbell Squat', body_parts: ['Legs'] },
        },
      ],
    };

    const fridayTemplate = {
      id: 'tpl-fri',
      user_id: 'a0000000-0000-4000-8000-000000000123',
      name: 'Friday Heavy Pull',
      is_master: false,
      days_of_week: ['Fri'],
      exercises: [
        {
          id: 'te-2',
          template_id: 'tpl-fri',
          exercise_id: 'ex-custom-1',
          target_sets: 4,
          target_reps: 8,
          order_index: 0,
          exercise: { id: 'ex-custom-1', name: 'My Athlete Curl', body_parts: ['Arms'] },
        },
      ],
    };
    currentTemplates = [mondayTemplate, fridayTemplate];

    renderComponent();

    const templatesTab = screen.getByRole('tab', { name: /Templates/i });
    fireEvent.click(templatesTab);

    // 1. Saved templates appear immediately at the top (list-first layout)
    expect(await screen.findByText('Monday Heavy Push')).toBeDefined();
    expect(screen.getByText('Friday Heavy Pull')).toBeDefined();

    // 2. Day Filter toolbar filtering
    const monFilterBtn = screen.getByTestId('day-filter-Mon');
    const friFilterBtn = screen.getByTestId('day-filter-Fri');
    const allFilterBtn = screen.getByTestId('day-filter-All');

    // Filter by Mon
    fireEvent.click(monFilterBtn);
    expect(screen.getByText('Monday Heavy Push')).toBeDefined();
    expect(screen.queryByText('Friday Heavy Pull')).toBeNull();

    // Filter by Fri
    fireEvent.click(friFilterBtn);
    expect(screen.queryByText('Monday Heavy Push')).toBeNull();
    expect(screen.getByText('Friday Heavy Pull')).toBeDefined();

    // Reset filter to All
    fireEvent.click(allFilterBtn);
    expect(screen.getByText('Monday Heavy Push')).toBeDefined();
    expect(screen.getByText('Friday Heavy Pull')).toBeDefined();

    // 3. Trigger + New Routine button to open modal in create mode
    const newRoutineBtn = screen.getByTestId('new-template-btn');
    fireEvent.click(newRoutineBtn);

    expect(screen.getByTestId('edit-template-modal')).toBeDefined();
    expect(screen.getByText('Create Routine Template')).toBeDefined();

    const nameInput = screen.getByTestId('template-name-input');
    expect(nameInput).toHaveValue('');

    // Fill in name
    fireEvent.change(nameInput, { target: { value: 'Saturday Arms Blast' } });

    // Select Saturday day pill
    const satPill = screen.getByTestId('day-pill-Sat');
    fireEvent.click(satPill);

    // Open Exercise Picker drawer
    const openPickerBtn = screen.getByTestId('open-exercise-picker');
    fireEvent.click(openPickerBtn);

    // Add Barbell Squat to routine
    const addSquatBtn = screen.getByTestId('add-exercise-btn-ex-master-1');
    fireEvent.click(addSquatBtn);

    // Click Done to return to routine editor
    const donePickerBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(donePickerBtn);

    // Exercise now visible in routine list
    expect(screen.getByText('Barbell Squat')).toBeDefined();

    // Save Routine
    const saveBtn = screen.getByTestId('save-template-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('save_routine_template', {
        p_template_id: null,
        p_name: 'Saturday Arms Blast',
        p_days_of_week: ['Sat'],
        p_exercises: [
          expect.objectContaining({
            exercise_id: 'ex-master-1',
            target_sets: 3,
            target_reps: 10,
          }),
        ],
        p_user_id: 'a0000000-0000-4000-8000-000000000123',
        p_is_master: false,
      });
      expect(screen.queryByTestId('edit-template-modal')).toBeNull();
    });
  });

  it('prevents query string injection and rejects invalid UUIDs in user.id and targetUserId', async () => {
    mockCoachState.selectedAthleteId = "malformed-id',is_master.eq.true";
    mockAthleteSession.user.id = "malformed-id',is_master.eq.true";

    const mockOr = vi.fn();
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      b.or = mockOr;
      return b;
    });

    renderComponent();

    await waitFor(() => {
      // .or() should NEVER be called with the malformed injection string
      expect(mockOr).not.toHaveBeenCalled();
    });
  });

  it('mounts exercises-read-error live region empty while idle and retains same node on error', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercises') {
        return createSupabaseBuilder('exercises', {
          resolver: () => ({ data: null, error: new Error('Failed to fetch exercises') }),
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    const { container } = renderComponent();

    // Live regions exist while loading/idle
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const readAlert = alerts[0];

    // When query fails, readAlert receives error text
    await waitFor(() => {
      expect(readAlert.textContent).toContain('Failed to load exercises');
      expect(readAlert.textContent).toContain('Failed to fetch exercises');
      expect(screen.getByTestId('exercises-read-error')).toBeDefined();
      expect(screen.getByTestId('retry-exercises-btn')).toBeDefined();
    });

    // Alert DOM node is identical (permanent live region)
    expect(container.querySelectorAll('[role="alert"]')[0]).toBe(readAlert);
  });

  it('mounts deleteError live region empty while idle and updates on delete failure', async () => {
    mockCoachState.isCoach = true;
    const mockDelete = vi.fn();
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercises') {
        const b = createSupabaseBuilder('exercises', {
          data: [{ id: 'ex-custom-1', name: 'My Athlete Curl', body_parts: ['Arms'], is_master: false, user_id: 'a0000000-0000-4000-8000-000000000123', is_archived: false }],
          error: null,
        });
        b.update = vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: null, error: { message: 'Update failed' } }),
          }),
        });
        b.delete = mockDelete;
        return b;
      }
      if (table === 'users') {
        return createSupabaseBuilder('users', {
          data: { id: 'a0000000-0000-4000-8000-000000000123', role: 'athlete', username: 'TestAthlete' },
          error: null,
        });
      }

      return createSupabaseBuilder(table, { data: [], error: null });
    });

    const { container } = renderComponent();
    await screen.findByText('My Athlete Curl');

    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(2);
    const deleteAlert = alerts[1];
    expect(deleteAlert.textContent).toBe('');

    await waitFor(() => {
      expect(screen.getAllByTestId(/^archive-exercise-/).length).toBe(1);
    });

    const deleteBtn = screen.getByTestId('archive-exercise-ex-custom-1');
    vi.useFakeTimers();
    try {
      fireEvent.click(deleteBtn);

      // ZERO writes before 6s expiry
      expect(mockDelete).not.toHaveBeenCalled();

      // Advance 6s timer to commit deferred archive
      await vi.advanceTimersByTimeAsync(6000);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      // Archive failure never falls back to DELETE
      expect(mockDelete).not.toHaveBeenCalled();
      expect(deleteAlert.textContent).toContain('Update failed');
    });

    expect(container.querySelectorAll('[role="alert"]')[1]).toBe(deleteAlert);
  });

  it('0-row writes: exercise archive with 0 rows affected throws and displays StatusBanner error', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercises') {
        const b = createSupabaseBuilder('exercises', {
          data: [{ id: 'ex-custom-1', name: 'My Athlete Curl', body_parts: ['Arms'], is_master: false, user_id: 'a0000000-0000-4000-8000-000000000123', is_archived: false }],
          error: null,
        });
        b.update = vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        });
        return b;
      }
      if (table === 'users') {
        return createSupabaseBuilder('users', {
          data: { id: 'a0000000-0000-4000-8000-000000000123', role: 'athlete', username: 'TestAthlete' },
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    await screen.findByText('My Athlete Curl');

    const archiveBtn = await screen.findByTestId('archive-exercise-ex-custom-1');
    vi.useFakeTimers();
    try {
      fireEvent.click(archiveBtn);

      // Advance 6s timer to commit deferred archive
      await vi.advanceTimersByTimeAsync(6000);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(screen.getByTestId('exercise-action-error')).toBeDefined();
      expect(screen.getByTestId('exercise-action-error').textContent).toContain('Exercise could not be archived.');
    });
  });

  it('0-row writes: template delete with 0 rows affected displays StatusBanner error', async () => {
    const userTpl = {
      id: 'tpl-user-1',
      user_id: 'a0000000-0000-4000-8000-000000000123',
      name: 'Athlete Routine',
      is_master: false,
      days_of_week: ['Mon'],
      exercises: [],
    };
    currentTemplates = [userTpl];

    const mockDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'routine_templates') {
        const b = createSupabaseBuilder('routine_templates', {
          resolver: (builder: SupabaseQueryBuilderMock) => {
            const idFilter = builder.filters.find((f: any) => f.column === 'id');
            if (idFilter) {
              const matched = currentTemplates.filter((t) => t.id === idFilter.value);
              return { data: matched, error: null };
            }
            return { data: currentTemplates, error: null };
          },
        });
        b.delete = mockDelete;
        return b;
      }
      if (table === 'users') {
        return createSupabaseBuilder('users', {
          data: { id: 'a0000000-0000-4000-8000-000000000123', role: 'athlete', username: 'TestAthlete' },
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    fireEvent.click(screen.getByRole('tab', { name: /Templates/i }));

    await screen.findByText('Athlete Routine');
    const deleteBtn = screen.getByTestId('delete-template-tpl-user-1');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByTestId('template-action-error')).toBeDefined();
      expect(screen.getByTestId('template-action-error').textContent).toContain('Routine template could not be deleted.');
    });
  });

  it('create-exercise error shows StatusBanner and keeps form input', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercises') {
        const b = createSupabaseBuilder('exercises', { data: [], error: null });
        b.insert = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed: RLS denied' } }),
          }),
        });
        return b;
      }
      if (table === 'users') {
        return createSupabaseBuilder('users', {
          data: { id: 'a0000000-0000-4000-8000-000000000123', role: 'athlete', username: 'TestAthlete' },
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    fireEvent.click(await screen.findByTestId('open-create-exercise-btn'));
    await screen.findByText(/Create Custom Exercise/i);

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'Standing Overhead Press' } });

    fireEvent.click(screen.getByRole('button', { name: /Save to Library/i }));

    await waitFor(() => {
      expect(screen.getByTestId('exercise-action-error')).toBeDefined();
      expect(screen.getByTestId('exercise-action-error').textContent).toContain('Insert failed: RLS denied');
    });

    expect(screen.getByLabelText(/exercise name/i)).toHaveValue('Standing Overhead Press');
  });

  it('inserts personal exercise (user_id = user.id, is_master = false) when coach has 0 athletes', async () => {
    mockCoachState.isCoach = true;
    mockCoachState.selectedAthleteId = '';

    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'new-ex-id', name: 'Coach Personal Lift' },
          error: null,
        }),
      }),
    });
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'exercises') {
        const b = createSupabaseBuilder('exercises', { data: [], error: null });
        b.insert = mockInsert;
        return b;
      }
      if (table === 'users') {
        return createSupabaseBuilder('users', {
          data: { id: 'a0000000-0000-4000-8000-000000000123', role: 'coach', username: 'TestCoach' },
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();
    fireEvent.click(await screen.findByTestId('open-create-exercise-btn'));
    await screen.findByText(/Create Custom Exercise/i);

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'Coach Personal Lift' } });

    fireEvent.click(screen.getByRole('button', { name: /Save to Library/i }));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Coach Personal Lift',
          user_id: 'a0000000-0000-4000-8000-000000000123',
          is_master: false,
        }),
      );
    });
  });

  it('ExercisesView disables save button and displays inline error on whitespace name', async () => {
    renderComponent();
    fireEvent.click(await screen.findByTestId('open-create-exercise-btn'));
    await screen.findByText(/Create Custom Exercise/i);

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: '   ' } });

    const saveBtn = screen.getByRole('button', { name: /Save to Library/i });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByText(/Exercise name cannot be blank or whitespace-only./i)).toBeDefined();
  });
});




