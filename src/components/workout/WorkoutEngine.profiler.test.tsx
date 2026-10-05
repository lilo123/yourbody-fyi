import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { WorkoutEngine } from './WorkoutEngine';
import { GlobalRestTimerPill } from '../common/GlobalRestTimerPill';
import { restTimerStore } from '../../utils/restTimerStore';
import { workoutSessionStore } from '../../utils/workoutSessionStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import { CoachProvider } from '../../context/CoachContext';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../../test/supabaseBuilderMock';

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    user: { id: 'test-user-id', email: 'athlete@example.com' },
  },
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe('WorkoutEngine React Profiler Baseline', () => {
  let queryClient: QueryClient;
  let mockInsert: any;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
    localStorage.clear();
    sessionStorage.clear();
    restTimerStore.resetForTesting();
    workoutSessionStore.resetForTesting();
    localStorage.setItem(
      'yourbody_user',
      JSON.stringify({
        id: 'test-user-id',
        email: 'athlete@example.com',
        username: 'athlete',
        role: 'athlete',
      })
    );
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: 'test-user-id' } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    (supabase.auth.onAuthStateChange as any).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'new-set-id' }, error: null }),
      }),
    });

    (supabase.from as any).mockImplementation((_table: string) => {
      const b = createSupabaseBuilder(_table, { data: [], error: null });
      b.insert = mockInsert;
      b.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
      b.delete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
      return b;
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it('measures React Profiler commits for single character typing and full set-entry interaction', async () => {
    interface CommitRecord {
      id: string;
      phase: 'mount' | 'update' | 'nested-update';
      actualDuration: number;
      baseDuration: number;
      startTime: number;
      commitTime: number;
    }

    const commits: CommitRecord[] = [];
    const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
      commits.push({ id, phase, actualDuration, baseDuration, startTime, commitTime });
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CoachProvider>
            <Profiler id="WorkoutEngine" onRender={onRender}>
              <WorkoutEngine />
            </Profiler>
            <GlobalRestTimerPill />
          </CoachProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

    // Select Workout A
    const routineBtn = screen.getByTestId('routine-select-btn');
    fireEvent.click(routineBtn);
    const workoutABtn = await screen.findByText('Workout A (Push, Quads & Core)');
    fireEvent.click(workoutABtn);

    const weightInput = await screen.findByTestId('ghost-weight-0-0');
    const repsInput = screen.getByTestId('ghost-reps-0-0');
    const commitBtn = screen.getByTestId('commit-set-btn-0-0');

    // Baseline measure 1: Single character typed into weight field
    const commitsBeforeSingleChar = commits.length;
    await userEvent.type(weightInput, '1');
    const singleCharCommits = commits.slice(commitsBeforeSingleChar);

    // Baseline measure 2: Full set entry interaction (completing typing and clicking commit)
    const commitsBeforeFullEntry = commits.length;
    await userEvent.type(weightInput, '85'); // '185' total
    await userEvent.type(repsInput, '8');
    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });
    const fullInteractionCommits = commits.slice(commitsBeforeFullEntry);

    const profilerReport = {
      singleCharacterTyping: {
        totalCommits: singleCharCommits.length,
        actualDurationMs: singleCharCommits.reduce((acc, c) => acc + c.actualDuration, 0),
        baseDurationMs: singleCharCommits[singleCharCommits.length - 1]?.baseDuration || 0,
        phases: singleCharCommits.map((c) => c.phase),
      },
      fullSetEntryInteraction: {
        totalCommits: fullInteractionCommits.length,
        actualDurationMs: fullInteractionCommits.reduce((acc, c) => acc + c.actualDuration, 0),
        baseDurationMs: fullInteractionCommits[fullInteractionCommits.length - 1]?.baseDuration || 0,
        phases: fullInteractionCommits.map((c) => c.phase),
      },
      totalWorkoutEngineCommitsInSession: commits.length,
    };

    console.log('__PROFILER_OUTPUT_JSON__' + JSON.stringify(profilerReport));

    console.log('\n--- React Profiler WorkoutEngine Baseline ---');
    console.log(`Single Character Typing ('1' into weight):`);
    console.log(`  Commits: ${profilerReport.singleCharacterTyping.totalCommits}`);
    console.log(`  Actual Duration: ${profilerReport.singleCharacterTyping.actualDurationMs.toFixed(2)} ms`);
    console.log(`  Base Duration: ${profilerReport.singleCharacterTyping.baseDurationMs.toFixed(2)} ms`);
    console.log(`Full Set-Entry Interaction (type weight, reps, click commit):`);
    console.log(`  Commits: ${profilerReport.fullSetEntryInteraction.totalCommits}`);
    console.log(`  Actual Duration: ${profilerReport.fullSetEntryInteraction.actualDurationMs.toFixed(2)} ms`);
    console.log(`  Base Duration: ${profilerReport.fullSetEntryInteraction.baseDurationMs.toFixed(2)} ms`);
    console.log('---------------------------------------------\n');

    expect(profilerReport.singleCharacterTyping.totalCommits).toBeGreaterThan(0);

    expect(getRecordedTables()).toContain('exercises');
    expect(getRecordedSelects()).toContainEqual({
      table: 'exercises',
      projection: 'id, name, body_parts, is_master',
    });
    expect(getRecordedTables()).toContain('users');
    expect(getRecordedSelects()).toContainEqual({
      table: 'users',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
    });
    expect(getRecordedTables()).toContain('workouts');
    expect(getRecordedSelects()).toContainEqual({
      table: 'workouts',
      projection: 'id',
    });
  });
});
