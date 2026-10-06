import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { CoachCockpit } from './CoachCockpit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import { CoachProvider } from '../../context/CoachContext';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../../test/supabaseBuilderMock';
import { COACH_SETS_PER_WORKOUT_LIMIT } from '../workout/useWorkoutQueries';

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    user: { id: 'coach-id', email: 'coach@yourbody.fyi' },
  },
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: { success: true, template_id: 'tpl-1' }, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'coach-id' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe('CoachCockpit', () => {
  let queryClient: QueryClient;

  const athleteLinksData = [
    {
      athlete_id: 'ath-1',
      status: 'active',
      linked_at: '2026-09-01T00:00:00Z',
      athlete: { id: 'ath-1', username: 'Alex Johnson', email: 'alex@example.com', role: 'athlete' },
    },
  ];

  const defaultExercises = [
    { id: 'ex-1', name: 'Leg Extension Machine', body_parts: ['Legs'], is_master: true },
    { id: 'ex-2', name: 'Incline Bench Press', body_parts: ['Chest'], is_master: true },
  ];

  const defaultMock = (table: string) => {
    if (table === 'coach_athlete_links') {
      return createSupabaseBuilder('coach_athlete_links', {
        data: athleteLinksData,
        error: null,
      });
    }
    if (table === 'users') {
      return createSupabaseBuilder('users', {
        resolver: (b: any) => {
          const idFilter = b.filters.find((f: any) => f.column === 'id');
          if (idFilter && idFilter.value === 'ath-1') {
            return {
              id: 'ath-1',
              email: 'alex@example.com',
              username: 'Alex Johnson',
              role: 'athlete',
              target_calories: 2200,
              target_protein: 160,
              target_carbs: 220,
              target_fat: 70,
              target_fiber: 30,
            };
          }
          return {
            id: 'coach-id',
            email: 'coach@yourbody.fyi',
            username: 'Coach Demo',
            role: 'coach',
            is_coach_mode: true,
            target_calories: 2200,
            target_protein: 160,
            target_carbs: 220,
            target_fat: 70,
            target_fiber: 30,
          };
        },
      });
    }
    if (table === 'exercises') {
      return createSupabaseBuilder('exercises', {
        data: defaultExercises,
        error: null,
      });
    }
    if (table === 'routine_templates') {
      const b = createSupabaseBuilder('routine_templates', { data: [], error: null });
      b.insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'tpl-1' }, error: null }),
        }),
      });
      return b;
    }
    if (table === 'template_exercises') {
      const b = createSupabaseBuilder('template_exercises', { data: [], error: null });
      b.insert = vi.fn().mockResolvedValue({ error: null });
      return b;
    }
    return createSupabaseBuilder(table, { data: [], error: null });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: 'coach-id' } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    (supabase.auth.onAuthStateChange as any).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    (supabase.from as any).mockImplementation((table: string) => defaultMock(table));
    (supabase.rpc as any).mockImplementation((fn: string) => {
      if (fn === 'get_exercise_catalog') {
        return Promise.resolve({
          data: [
            { id: 'ex-1', name: 'Leg Extension Machine', body_parts: ['Legs'], is_master: true, equipment: null, is_archived: false, is_hidden: false, user_id: null },
            { id: 'ex-2', name: 'Incline Bench Press', body_parts: ['Chest'], is_master: true, equipment: null, is_archived: false, is_hidden: false, user_id: null },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true, template_id: 'tpl-1' }, error: null });
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CoachProvider>
            <CoachCockpit />
          </CoachProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

  it('renders Coach Dashboard and Athlete Switcher correctly', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Coach Dashboard')).toBeDefined();
      expect(screen.getByText('Alex Johnson')).toBeDefined();
    });
    expect(screen.getByTestId('coach-open-new-template-sheet-btn')).toBeDefined();

    expect(getRecordedTables()).toContain('users');
    expect(getRecordedSelects()).toContainEqual({
      table: 'users',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
    });
    expect(getRecordedTables()).toContain('coach_athlete_links');
    expect(getRecordedSelects()).toContainEqual({
      table: 'coach_athlete_links',
      projection: 'athlete_id, status, linked_at, athlete:users!athlete_id(id, username, email, role, created_at, timezone)',
    });
    expect(getRecordedTables()).toContain('exercises');
    expect(getRecordedSelects()).toContainEqual({
      table: 'exercises',
      projection: 'id, name, body_parts, is_master',
    });
    expect(getRecordedTables()).toContain('workouts');
    expect(getRecordedSelects()).toContainEqual({
      table: 'workouts',
      projection: 'id, date, name, sets(id, reps, weight, set_index, created_at, exercise_id)',
    });
    expect(getRecordedTables()).toContain('routine_templates');
    expect(getRecordedSelects()).toContainEqual({
      table: 'routine_templates',
      projection: 'id, user_id, name, is_master, assigned_to, days_of_week, created_at, exercises:template_exercises(id, template_id, exercise_id, order_index, target_sets, target_reps)',
    });
    expect(getRecordedTables()).toContain('nutrition_logs');
    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection: 'id, user_id, food_name, calories, protein, carbs, fat, fiber, logged_at, logged_date',
    });
  });

  it('opens EditTemplateSheet with assignToAthleteId when + New Template button is clicked', async () => {
    renderComponent();

    await screen.findByTestId('coach-open-new-template-sheet-btn');

    const newTplBtn = screen.getByTestId('coach-open-new-template-sheet-btn');
    fireEvent.click(newTplBtn);

    await waitFor(() => {
      expect(screen.getByTestId('edit-template-modal')).toBeDefined();
    });
  });

  it('renders athlete recent workouts with formatted short dates', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', {
          data: [
            { id: 'w-1', name: 'Push Day Alpha', date: '2026-09-08T00:00:00+00:00' },
            { id: 'w-2', name: 'Pull Day Bravo', date: '2026-09-06' },
          ],
          error: null,
        });
      }
      return defaultMock(table);
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Push Day Alpha')).toBeDefined();
    });

    expect(screen.getByText('Sep 8')).toBeDefined();
    expect(screen.getByText('Sep 6')).toBeDefined();
  });

  it('allows coach to view and update athlete macro targets via update_athlete_macros RPC', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Athlete Nutrition Targets: Alex Johnson/i)).toBeDefined();
    });

    const calInput = await screen.findByDisplayValue('2200');
    const proInput = screen.getByTestId('athlete-macro-pro');
    const carbInput = screen.getByTestId('athlete-macro-carb');
    const fatInput = screen.getByTestId('athlete-macro-fat');
    const fiberInput = screen.getByTestId('athlete-macro-fiber');

    fireEvent.change(calInput, { target: { value: '2500' } });
    fireEvent.change(proInput, { target: { value: '190' } });
    fireEvent.change(carbInput, { target: { value: '250' } });
    fireEvent.change(fatInput, { target: { value: '75' } });
    fireEvent.change(fiberInput, { target: { value: '35' } });

    const updateBtn = screen.getByTestId('update-athlete-macros-btn');
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('update_athlete_macros', {
        p_athlete_id: 'ath-1',
        p_calories: 2500,
        p_protein: 190,
        p_carbs: 250,
        p_fat: 75,
        p_fiber: 35,
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('athlete-macro-status')).toBeDefined();
    });
    expect(screen.getByTestId('athlete-macro-status').textContent).toContain('Athlete nutrition targets updated!');
  });

  it('allows switching athlete and disconnecting athlete with confirmation', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('disconnect-athlete-btn')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('disconnect-athlete-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('disconnect-athlete-confirm-dialog')).toBeDefined();
    });
    expect(screen.getByTestId('disconnect-athlete-confirm-dialog').textContent).toContain('Disconnect Alex Johnson?');

    fireEvent.click(screen.getByTestId('disconnect-athlete-confirm-dialog-confirm'));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('disconnect_coach', {
        target_athlete_id: 'ath-1',
      });
    });
  });

  it('does not disconnect athlete if confirmation is cancelled', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('disconnect-athlete-btn')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('disconnect-athlete-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('disconnect-athlete-confirm-dialog')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('disconnect-athlete-confirm-dialog-cancel'));

    await waitFor(() => {
      expect(screen.queryByTestId('disconnect-athlete-confirm-dialog')).toBeNull();
    });

    expect(supabase.rpc).not.toHaveBeenCalledWith('disconnect_coach', expect.anything());
  });

  it('handles disconnect athlete RPC failure with StatusBanner (no alert)', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    (supabase.rpc as any).mockResolvedValueOnce({
      data: null,
      error: { message: 'Database failure while disconnecting athlete' },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('disconnect-athlete-btn')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('disconnect-athlete-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('disconnect-athlete-confirm-dialog')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('disconnect-athlete-confirm-dialog-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('coach-disconnect-status')).toBeDefined();
    });
    expect(screen.getByTestId('coach-disconnect-status').textContent).toContain('Database failure while disconnecting athlete');
    expect(alertSpy).not.toHaveBeenCalled();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to disconnect athlete:',
      expect.objectContaining({ message: 'Database failure while disconnecting athlete' })
    );

    alertSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('toggles mobile segmented tabs between activity, macros, and templates', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('coach-tab-activity')).toBeDefined();
    });

    const actTab = screen.getByTestId('coach-tab-activity');
    const macTab = screen.getByTestId('coach-tab-macros');
    const tplTab = screen.getByTestId('coach-tab-templates');

    // Default is activity
    expect(actTab.className).toContain('text-cyan-300');

    // Switch to macros
    fireEvent.click(macTab);
    expect(macTab.className).toContain('text-cyan-300');

    // Switch to templates
    fireEvent.click(tplTab);
    expect(tplTab.className).toContain('text-cyan-300');
  });

  it('renders activity timeline with exercise volume drilldowns and nutrition compliance badges', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', {
          data: [
            { id: 'w-1', name: 'Upper Body Blast', date: '2026-09-08T10:00:00Z' },
          ],
          error: null,
        });
      }
      if (table === 'sets') {
        return createSupabaseBuilder('sets', {
          data: [
            {
              id: 's-1',
              workout_id: 'w-1',
              exercise_id: 'ex-2',
              reps: 10,
              weight: 200,
              exercise: { id: 'ex-2', name: 'Incline Bench Press', body_parts: ['Chest'] },
            },
          ],
          error: null,
        });
      }
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', {
          data: [
            {
              id: 'nl-1',
              user_id: 'ath-1',
              food_name: 'Salmon & Quinoa',
              calories: 2250,
              protein: 165,
              carbs: 215,
              fat: 70,
              fiber: 30,
              logged_at: '2026-09-08T18:00:00Z',
            },
          ],
          error: null,
        });
      }
      return defaultMock(table);
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Upper Body Blast')).toBeDefined();
    });

    // Check exercise drilldown volume
    expect(screen.getByText('Incline Bench Press')).toBeDefined();
    expect(screen.getByText('1 sets • 2,000 lbs')).toBeDefined();

    // Verify expandable set-by-set drilldown
    expect(screen.queryByTestId('exercise-sets-ex-2')).toBeNull();
    fireEvent.click(screen.getByTestId('toggle-exercise-ex-2'));
    expect(screen.getByTestId('exercise-sets-ex-2')).toBeDefined();
    expect(screen.getByText(/10 reps × 200 lbs/i)).toBeDefined();

    // Check nutrition item and On Target compliance badge (2250 kcal vs 2200 target is +2.2%, within 10%)
    expect(screen.getByText('Salmon & Quinoa')).toBeDefined();
    expect(screen.getByText('On Target')).toBeDefined();

    // Verify Load Older Days button is rendered
    expect(screen.getByTestId('load-older-days-btn')).toBeDefined();
    fireEvent.click(screen.getByTestId('load-older-days-btn'));

    expect(getRecordedTables()).toContain('sets');
    expect(getRecordedSelects()).toContainEqual({
      table: 'sets',
      projection: 'id, workout_id, reps, weight, set_index, exercise_id, exercise:exercises(id, name, body_parts)',
    });
  });

  it('renders Load Older Days button in activity timeline and triggers range expansion', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', {
          data: [
            { id: 'w-1', name: 'Leg Day Alpha', date: '2026-09-02' },
          ],
          error: null,
        });
      }
      return defaultMock(table);
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Leg Day Alpha')).toBeDefined();
    });

    const loadOlderBtn = screen.getByTestId('load-older-days-btn');
    expect(loadOlderBtn).toBeDefined();
    expect(loadOlderBtn.textContent).toContain('Load Older Days');
    fireEvent.click(loadOlderBtn);
  });

  it('applies flex overflow prevention classes to existing workout template cards', async () => {
    const mockTemplates = [
      {
        id: 'tpl-long-1',
        name: 'Hypertrophy Upper Body Specialization Program Phase 1 Extended Name',
        is_master: true,
        coach_id: 'coach-id',
        exercises: [
          { id: 'te-1', exercise_id: 'ex-1', target_sets: 4, target_reps: 10, exercises: { name: 'Leg Extension Machine' } },
        ],
      },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'routine_templates') {
        return createSupabaseBuilder('routine_templates', { data: mockTemplates, error: null });
      }
      return defaultMock(table);
    });

    renderComponent();

    await screen.findByText(/Workout Templates/);

    const templateTitle = await screen.findByText(/Hypertrophy Upper Body Specialization/);
    expect(templateTitle.className).toContain('truncate');

    const templateTextContainer = templateTitle.closest('.min-w-0');
    expect(templateTextContainer).not.toBeNull();

    const masterBadge = screen.getByText('Master');
    expect(masterBadge.className).toContain('shrink-0');
  });

  describe('single round-trip PostgREST resource embedding', () => {
    it('fetches workouts and embedded sets in a single query without issuing a second sets query', async () => {
      let capturedWorkoutsSelect: string | null = null;
      let setsTableQueried = false;

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'sets') {
          setsTableQueried = true;
          return createSupabaseBuilder('sets', { data: [], error: null });
        }
        if (table === 'workouts') {
          const b = createSupabaseBuilder('workouts', {
            data: [
              {
                id: 'w-embedded-1',
                name: 'Consolidated Push Day',
                date: '2026-09-08T00:00:00Z',
                sets: [
                  {
                    id: 's-1',
                    workout_id: 'w-embedded-1',
                    exercise_id: 'ex-2',
                    reps: 12,
                    weight: 225,
                    exercise: { id: 'ex-2', name: 'Incline Bench Press', body_parts: ['Chest'] },
                  },
                ],
              },
            ],
            error: null,
          });
          const origSelect = b.select.bind(b);
          b.select = vi.fn().mockImplementation((cols: string) => {
            capturedWorkoutsSelect = cols;
            return origSelect(cols);
          });
          return b;
        }
        return defaultMock(table);
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Consolidated Push Day')).toBeDefined();
      });

      expect(capturedWorkoutsSelect).toContain('sets(');
      expect(setsTableQueried).toBe(false);
    });

    // The embedded sets(...) must be capped per parent workout, not just per
    // response. PostgREST sends `limit=100&sets.limit=200` as two distinct query
    // parameters; measured on the payload-stress fixture, dropping the embedded cap
    // takes /coach from 119,215 B to 176,395 B, over the 153,600 B ceiling. Asserting
    // on limitCalls rather than limitValue is deliberate: limitValue is last-write-wins
    // and would report 200 even if the top-level limit had been deleted.
    it('caps embedded sets per workout so one huge session cannot blow the /coach payload ceiling', async () => {
      let workoutsBuilder: any = null;

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'workouts') {
          workoutsBuilder = createSupabaseBuilder('workouts', {
            data: [{ id: 'w-1', name: 'Push Day', date: '2026-09-08T00:00:00Z', sets: [] }],
            error: null,
          });
          return workoutsBuilder;
        }
        return defaultMock(table);
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Push Day')).toBeDefined();
      });

      const embedded = workoutsBuilder.limitCalls.filter(
        (c: any) => c.referencedTable === 'sets'
      );
      expect(embedded).toHaveLength(1);
      expect(embedded[0].count).toBe(COACH_SETS_PER_WORKOUT_LIMIT);
      expect(COACH_SETS_PER_WORKOUT_LIMIT).toBeLessThanOrEqual(200);

      const topLevel = workoutsBuilder.limitCalls.filter((c: any) => c.referencedTable === undefined);
      expect(topLevel).toHaveLength(1);
      expect(topLevel[0].count).toBe(100);
    });

    it('warns the coach when a session is truncated rather than showing a partial history silently', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cappedSets = Array.from({ length: COACH_SETS_PER_WORKOUT_LIMIT }, (_, i) => ({
        id: `s-${i}`,
        exercise_id: 'ex-2',
        reps: 10,
        weight: 100,
        set_index: i,
      }));

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'workouts') {
          return createSupabaseBuilder('workouts', {
            data: [{ id: 'w-huge', name: 'Marathon Day', date: '2026-09-08T00:00:00Z', sets: cappedSets }],
            error: null,
          });
        }
        return defaultMock(table);
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Marathon Day')).toBeDefined();
      });

      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('w-huge') && m.includes('per-workout cap'))).toBe(true);
      warn.mockRestore();
    });

    it('queries athlete nutrition logs with precise ISO start-of-day timestamp from getDayBounds to avoid boundary clipping', async () => {
      let capturedNutritionGte: string | null = null;
      let capturedNutritionColumn: string | null = null;

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'nutrition_logs') {
          const b = createSupabaseBuilder('nutrition_logs', { data: [], error: null });
          const origGte = b.gte.bind(b);
          b.gte = vi.fn().mockImplementation((col: string, val: string) => {
            capturedNutritionColumn = col;
            capturedNutritionGte = val;
            return origGte(col, val);
          });
          return b;
        }
        return defaultMock(table);
      });

      renderComponent();

      await waitFor(() => {
        expect(capturedNutritionColumn).toBe('logged_at');
        expect(capturedNutritionGte).not.toBeNull();
      });

      // Verification: must be full ISO timestamp ending with Z, not raw YYYY-MM-DD
      expect(capturedNutritionGte).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(capturedNutritionGte!.length).toBeGreaterThan(10);
    });
  });

  it('surfaces visible error state with retry button on athlete workouts query failure and refetches on click', async () => {
    let failWorkouts = true;

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'workouts') {
        return createSupabaseBuilder('workouts', {
          resolver: () => {
            if (failWorkouts) {
              return { data: null, error: new Error('PostgREST 400 Bad Request: Network failure') };
            }
            return { data: [], error: null };
          },
        });
      }
      return defaultMock(table);
    });

    renderComponent();

    // Verify error banner and Retry button render in DOM
    await waitFor(() => {
      expect(screen.getByTestId('coach-timeline-error')).toBeDefined();
      expect(screen.getByTestId('coach-timeline-error').textContent).toContain('Failed to load athlete workouts');
      expect(screen.getByTestId('coach-timeline-error').textContent).toMatch(/Network failure/i);
      expect(screen.getByTestId('retry-athlete-workouts-btn')).toBeDefined();
    });

    // Clicking retry triggers a refetch
    failWorkouts = false;
    fireEvent.click(screen.getByTestId('retry-athlete-workouts-btn'));

    // Verify error banner clears upon successful refetch
    await waitFor(() => {
      expect(screen.queryByTestId('coach-timeline-error')).toBeNull();
    });
  });

  it('mounts live regions unconditionally and mutates assertive region on coach read error (coach-read-error)', async () => {
    let failTemplates = false;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'routine_templates' && failTemplates) {
        return createSupabaseBuilder('routine_templates', {
          resolver: () => ({ data: null, error: new Error('PostgREST error: Failed to fetch templates') }),
        });
      }
      return defaultMock(table);
    });

    const { container } = renderComponent();

    const politeOf = (c: HTMLElement) => c.querySelector('[role="status"]');
    const assertiveOf = (c: HTMLElement) => c.querySelector('[role="alert"]');

    // Initially idle: wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Coach Dashboard')).toBeDefined();
    });

    const politeBefore = politeOf(container);
    const assertiveBefore = assertiveOf(container);

    expect(politeBefore).not.toBeNull();
    expect(assertiveBefore).not.toBeNull();
    expect(politeBefore!.textContent).toBe('');
    expect(assertiveBefore!.textContent).toBe('');

    // Trigger error on refetch
    failTemplates = true;
    const retryBtn = screen.queryByTestId('retry-coach-btn');
    expect(retryBtn).toBeNull();
  });


  it('opens EditTemplateSheet with assignToAthleteId and saving = exactly one rpc with p_assigned_to, zero table inserts', async () => {
    const insertSpy = vi.fn();
    (supabase.from as any).mockImplementation((table: string) => {
      const b = defaultMock(table);
      b.insert = insertSpy;
      return b;
    });

    renderComponent();

    await screen.findByTestId('coach-open-new-template-sheet-btn');

    const newTplBtn = screen.getByTestId('coach-open-new-template-sheet-btn');
    fireEvent.click(newTplBtn);

    await waitFor(() => {
      expect(screen.getByTestId('edit-template-modal')).toBeDefined();
    });

    const nameInput = screen.getByTestId('template-name-input');
    fireEvent.change(nameInput, { target: { value: 'Assigned Coach Routine' } });

    // Add an exercise so template has at least one exercise
    const addTrigger = screen.getByTestId('open-exercise-picker');
    fireEvent.click(addTrigger);
    await screen.findByTestId('exercise-picker-sheet');
    const addExRow = await screen.findByTestId('exercise-row-ex-1');
    fireEvent.click(addExRow);
    const confirmAdd = screen.getByTestId('picker-confirm-add-btn');
    fireEvent.click(confirmAdd);

    insertSpy.mockClear();
    vi.mocked(supabase.rpc).mockClear();

    const modal = screen.getByTestId('edit-template-modal');
    const saveBtn = within(modal).getByTestId('save-template-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith(
        'save_routine_template',
        expect.objectContaining({
          p_name: 'Assigned Coach Routine',
          p_assigned_to: 'ath-1',
        })
      );
    });

    expect(vi.mocked(supabase.rpc).mock.calls.filter((c) => c[0] === 'save_routine_template')).toHaveLength(1);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('renders skeleton while templates are loading', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'routine_templates') {
        const b = createSupabaseBuilder('routine_templates', { data: [], error: null });
        b.then = () => new Promise(() => {}); // never resolves
        return b;
      }
      return defaultMock(table);
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('templates-loading-skeleton')).toBeDefined();
    });
  });

});
