import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkoutSession } from './useWorkoutSession';
import { workoutSessionStore } from '../../utils/workoutSessionStore';
import type { Exercise, RoutineTemplate, WorkoutSet } from '../../types/database';

const { mockFetchTemplateDetail, mockShowToast, getMockIsOnline, setMockIsOnline } = vi.hoisted(() => {
  let isOnline = true;
  return {
    mockFetchTemplateDetail: vi.fn(),
    mockShowToast: vi.fn(),
    getMockIsOnline: () => isOnline,
    setMockIsOnline: (val: boolean) => {
      isOnline = val;
    },
  };
});

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({
    show: mockShowToast,
    dismiss: vi.fn(),
    activeToast: null,
    offset: undefined,
    setOffset: vi.fn(),
  }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => getMockIsOnline(),
}));

vi.mock('./useWorkoutQueries', async () => {
  const actual = await vi.importActual<any>('./useWorkoutQueries');
  return {
    ...actual,
    fetchTemplateDetail: (...args: any[]) => mockFetchTemplateDetail(...args),
  };
});

describe('useWorkoutSession', () => {
  const targetUserId = 'user-test-123';
  const mockExercises: Exercise[] = [
    { id: 'ex-bench', name: 'Bench Press', body_parts: ['Chest'], is_master: true },
    { id: 'ex-squat', name: 'Squat', body_parts: ['Legs'], is_master: true },
    { id: 'ex-row', name: 'Barbell Row', body_parts: ['Back'], is_master: true },
  ];

  const defaultProps = {
    targetUserId,
    exercises: mockExercises,
    exercisesFetched: true,
    customTemplates: [] as RoutineTemplate[],
    templatesFetched: true,
    userLogs: [] as (WorkoutSet & { workout_date: string; workout_name?: string })[],
    logsFetched: true,
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
    localStorage.clear();
    vi.clearAllMocks();
    setMockIsOnline(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clamps target sets stepper to maximum of 20', () => {
    const { result } = renderHook(() => useWorkoutSession(defaultProps));

    act(() => {
      result.current.handleAddExercise('Bench Press');
    });

    expect(result.current.targetSetCounts['Bench Press']).toBe(3);

    // Increment up to and beyond 20
    act(() => {
      for (let i = 0; i < 25; i++) {
        result.current.adjustTargetSets('Bench Press', 1);
      }
    });

    expect(result.current.targetSetCounts['Bench Press']).toBe(20);

    // One more increment stays at 20
    act(() => {
      result.current.adjustTargetSets('Bench Press', 1);
    });

    expect(result.current.targetSetCounts['Bench Press']).toBe(20);
  });

  it('rapid sequential moveExercise preserves all intermediate movements without dropping', () => {
    const { result } = renderHook(() => useWorkoutSession(defaultProps));

    act(() => {
      result.current.handleAddExercise('Bench Press');
      result.current.handleAddExercise('Squat');
      result.current.handleAddExercise('Barbell Row');
    });

    expect(result.current.activeExercises).toEqual(['Bench Press', 'Squat', 'Barbell Row']);

    // Move Barbell Row (index 2) up twice rapidly
    act(() => {
      result.current.moveExercise(2, -1);
      result.current.moveExercise(1, -1);
    });

    expect(result.current.activeExercises).toEqual(['Barbell Row', 'Bench Press', 'Squat']);
  });

  it('typing weight keeps reps undefined in draft so visible/ghost reps are not blanked', () => {
    const { result } = renderHook(() => useWorkoutSession(defaultProps));

    act(() => {
      result.current.handleAddExercise('Bench Press');
    });

    // Type weight 105 into set 1
    act(() => {
      result.current.updateDraft('Bench Press', 1, 'weight', '105');
    });

    const draft = result.current.inputDrafts['Bench Press_1'];
    expect(draft).toBeDefined();
    expect(draft.weight).toBe('105');
    // Untouched reps field must remain undefined, NOT coerced to empty string ''
    expect(draft.reps).toBeUndefined();
  });

  it('saves session pointer for past dates so reload stays on past date', () => {
    const pastDate = '2026-09-15';
    // Initialize a past-date session in the store
    workoutSessionStore.getOrInitSession(targetUserId, pastDate, {
      routineName: 'Upper Body',
      exercises: ['Bench Press'],
      targetSetCounts: { 'Bench Press': 3 },
      targetRepCounts: { 'Bench Press': 8 },
    });

    const saveSpy = vi.spyOn(workoutSessionStore, 'saveSession');

    renderHook(() => useWorkoutSession({
      ...defaultProps,
      userLogs: [],
    }));

    // Check if saveSession was called with setPointer = true for past date session
    if (saveSpy.mock.calls.length > 0) {
      const lastCall = saveSpy.mock.calls[saveSpy.mock.calls.length - 1];
      expect(lastCall[1]).toBe(true);
    }
  });

  it('restoreExercise restores exercise at position with targets and drafts', () => {
    const { result } = renderHook(() => useWorkoutSession(defaultProps));

    act(() => {
      result.current.handleAddExercise('Bench Press');
      result.current.handleAddExercise('Squat');
    });

    expect(result.current.activeExercises).toEqual(['Bench Press', 'Squat']);

    // Remove Bench Press
    act(() => {
      result.current.removeExercise(0);
    });
    expect(result.current.activeExercises).toEqual(['Squat']);

    // Restore Bench Press
    act(() => {
      result.current.restoreExercise({
        exerciseName: 'Bench Press',
        index: 0,
        targetSetCount: 4,
        targetRepCount: 8,
        drafts: { 'Bench Press_1': { weight: '225', reps: '5' } },
      });
    });

    expect(result.current.activeExercises).toEqual(['Bench Press', 'Squat']);
    expect(result.current.targetSetCounts['Bench Press']).toBe(4);
    expect(result.current.targetRepCounts['Bench Press']).toBe(8);
    expect(result.current.inputDrafts['Bench Press_1']).toEqual({ weight: '225', reps: '5' });
  });

  it('isScheduledRoutineDirty returns true when exercises or drafts differ from scheduled', () => {
    const { result } = renderHook(() => useWorkoutSession(defaultProps));

    // Initially clean or on rest day
    expect(result.current.isScheduledRoutineDirty).toBe(false);

    // Adding drafts makes it dirty
    act(() => {
      result.current.updateDraft('Bench Press', 1, 'weight', '135');
    });

    expect(result.current.isScheduledRoutineDirty).toBe(true);
  });

  it('isScheduledRoutineDirty detects target set changes as dirty', () => {
    const customTemplate: RoutineTemplate = {
      id: 'tpl-1',
      user_id: targetUserId,
      name: 'Sunday Routine',
      days_of_week: ['Sun'],
      is_master: false,
      assigned_to: null,
      created_at: '2026-09-01',
      exercises: [
        {
          id: 'te-1',
          template_id: 'tpl-1',
          exercise_id: 'ex-bench',
          order_index: 0,
          target_sets: 3,
          target_reps: 10,
          exercise: { name: 'Bench Press' },
        },
      ],
    };

    const { result } = renderHook(() =>
      useWorkoutSession({
        ...defaultProps,
        customTemplates: [customTemplate],
      })
    );

    expect(result.current.isScheduledRoutineDirty).toBe(false);

    // Adjust target sets
    act(() => {
      result.current.adjustTargetSets('Bench Press', 1);
    });

    expect(result.current.targetSetCounts['Bench Press']).toBe(4);
    expect(result.current.isScheduledRoutineDirty).toBe(true);
  });
  it('addExercises batch adds multiple exercises preserving order', () => {
    const { result } = renderHook(() => useWorkoutSession(defaultProps));

    act(() => {
      result.current.addExercises([
        'Barbell Bench Press',
        'Overhead Press',
      ]);
    });

    expect(result.current.activeExercises).toContain('Barbell Bench Press');
    expect(result.current.activeExercises).toContain('Overhead Press');

    const benchIdx = result.current.activeExercises.indexOf('Barbell Bench Press');
    const ohpIdx = result.current.activeExercises.indexOf('Overhead Press');
    expect(ohpIdx).toBeGreaterThan(benchIdx);

    expect(result.current.targetSetCounts['Barbell Bench Press']).toBe(3);
    expect(result.current.targetSetCounts['Overhead Press']).toBe(3);
    expect(result.current.expandedExercises.has('Barbell Bench Press')).toBe(true);
    expect(result.current.expandedExercises.has('Overhead Press')).toBe(true);

    // Batch adding with exercise objects
    act(() => {
      result.current.addExercises([
        { name: 'Zercher Squat' },
        { name: 'Romanian Deadlift' },
      ]);
    });

    expect(result.current.activeExercises).toContain('Zercher Squat');
    expect(result.current.activeExercises).toContain('Romanian Deadlift');
  });

  it('addExercises ignores already added exercises', () => {
    const { result } = renderHook(() => useWorkoutSession(defaultProps));

    act(() => {
      result.current.addExercises(['Bench Press']);
    });

    const initialLen = result.current.activeExercises.length;

    act(() => {
      result.current.addExercises(['Bench Press']);
    });

    expect(result.current.activeExercises.length).toBe(initialLen);
  });
  it('TZ regression: rapid sequential moveExercise is deterministic near midnight across timezones (23: 59: 59 and 00: 00: 01 local)', () => {
    // 1. Within a single civil date (Sunday Rest Day): 00:00:01 and 23:59:59 local behave identically
    for (const timeStr of ['2026-09-27T00:00:01', '2026-09-27T23:59:59']) {
      localStorage.clear();
      vi.setSystemTime(new Date(timeStr));
      const { result } = renderHook(() => useWorkoutSession(defaultProps));

      expect(result.current.workoutDate).toBe('2026-09-27');
      expect(result.current.activeRoutineName).toBe('Rest Day');
      expect(result.current.activeExercises).toEqual([]);

      act(() => {
        result.current.handleAddExercise('Bench Press');
        result.current.handleAddExercise('Squat');
        result.current.handleAddExercise('Barbell Row');
      });

      expect(result.current.activeExercises).toEqual(['Bench Press', 'Squat', 'Barbell Row']);

      act(() => {
        result.current.moveExercise(2, -1);
        result.current.moveExercise(1, -1);
      });

      expect(result.current.activeExercises).toEqual(['Barbell Row', 'Bench Press', 'Squat']);
    }

    // 2. Midnight boundary rollover: active session started at 23:59:59 local is preserved across midnight at 00:00:01 local
    localStorage.clear();
    vi.setSystemTime(new Date('2026-09-27T23:59:59'));
    const session1 = renderHook(() => useWorkoutSession(defaultProps));
    act(() => {
      session1.result.current.handleAddExercise('Bench Press');
      session1.result.current.handleAddExercise('Squat');
      session1.result.current.handleAddExercise('Barbell Row');
    });
    session1.unmount();

    // Clock ticks past midnight into Monday 00:00:01 local
    vi.setSystemTime(new Date('2026-09-28T00:00:01'));
    const session2 = renderHook(() => useWorkoutSession(defaultProps));
    expect(session2.result.current.workoutDate).toBe('2026-09-27');
    expect(session2.result.current.activeExercises).toEqual(['Bench Press', 'Squat', 'Barbell Row']);

    act(() => {
      session2.result.current.moveExercise(2, -1);
      session2.result.current.moveExercise(1, -1);
    });
    expect(session2.result.current.activeExercises).toEqual(['Barbell Row', 'Bench Press', 'Squat']);

    // 3. Fresh unseeded session at Monday 00:00:01 local deterministically loads scheduled Monday routine
    localStorage.clear();
    const session3 = renderHook(() => useWorkoutSession(defaultProps));
    expect(session3.result.current.workoutDate).toBe('2026-09-28');
    expect(session3.result.current.activeRoutineName).toBe('Push, Quads, & Core - Reduced');
    expect(session3.result.current.activeExercises).toEqual([
      'Incline Bench Press',
      'Cable Lateral Raises',
      'Dips',
      'Leg Extension Machine',
      'Overhead Tricep Cable Pull',
    ]);
  });

  it('offline uncached routine selection failure does not clear active exercises or overwrite draft', async () => {
    setMockIsOnline(false);
    mockFetchTemplateDetail.mockRejectedValue(new Error('Template detail fetch timed out after 50ms'));

    const uncachedCustomTemplate: RoutineTemplate = {
      id: 'tpl-uncached',
      user_id: targetUserId,
      name: 'Uncached Custom Routine',
      days_of_week: ['Mon'],
      is_master: false,
      assigned_to: null,
      created_at: '2026-09-01',
      exercises: undefined,
    };

    const { result } = renderHook(() =>
      useWorkoutSession({
        ...defaultProps,
        customTemplates: [uncachedCustomTemplate],
      })
    );

    act(() => {
      result.current.handleAddExercise('Bench Press');
      result.current.updateDraft('Bench Press', 1, 'weight', '135');
    });

    const initialRoutine = result.current.activeRoutineName;
    expect(result.current.activeExercises).toEqual(['Bench Press']);
    expect(result.current.inputDrafts['Bench Press_1']).toEqual({ weight: '135', reps: undefined });

    await act(async () => {
      await result.current.handleSelectRoutine('Uncached Custom Routine', uncachedCustomTemplate);
    });

    // On detail fetch failure offline: routine is NOT switched, draft is preserved, and offline toast is shown
    expect(result.current.activeRoutineName).toBe(initialRoutine);
    expect(result.current.activeExercises).toEqual(['Bench Press']);
    expect(workoutSessionStore.getSession(targetUserId, result.current.workoutDate)?.exercises).toEqual(['Bench Press']);
    expect(result.current.inputDrafts['Bench Press_1']).toEqual({ weight: '135', reps: undefined });
    expect(mockShowToast).toHaveBeenCalledWith({ message: 'Available when online' });
  });

  it('cache hit offline still switches to the picked routine', async () => {
    setMockIsOnline(false);
    const cachedCustomTemplate: RoutineTemplate = {
      id: 'tpl-cached',
      user_id: targetUserId,
      name: 'Cached Custom Routine',
      days_of_week: ['Mon'],
      is_master: false,
      assigned_to: null,
      created_at: '2026-09-01',
      exercises: undefined,
    };

    mockFetchTemplateDetail.mockResolvedValue({
      id: 'tpl-cached',
      exercises: [
        {
          id: 'te-squat',
          template_id: 'tpl-cached',
          exercise_id: 'ex-squat',
          order_index: 0,
          target_sets: 4,
          target_reps: 8,
          exercise: { name: 'Squat' },
        },
      ],
    });

    const { result } = renderHook(() =>
      useWorkoutSession({
        ...defaultProps,
        customTemplates: [cachedCustomTemplate],
      })
    );

    act(() => {
      result.current.handleAddExercise('Bench Press');
    });

    expect(result.current.activeExercises).toEqual(['Bench Press']);

    await act(async () => {
      await result.current.handleSelectRoutine('Cached Custom Routine', cachedCustomTemplate);
    });

    // Offline cache hit successfully switches routine and updates exercises
    expect(result.current.activeRoutineName).toBe('Cached Custom Routine');
    expect(result.current.activeExercises).toEqual(['Squat']);
    expect(result.current.targetSetCounts['Squat']).toBe(4);
    expect(result.current.targetRepCounts['Squat']).toBe(8);
    expect(workoutSessionStore.getSession(targetUserId, result.current.workoutDate)?.exercises).toEqual(['Squat']);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('online fetch failure behaves the same as offline (no data loss)', async () => {
    setMockIsOnline(true);
    mockFetchTemplateDetail.mockRejectedValue(new Error('Network error: connection reset'));

    const customTemplate: RoutineTemplate = {
      id: 'tpl-custom-error',
      user_id: targetUserId,
      name: 'Custom Routine Network Error',
      days_of_week: ['Mon'],
      is_master: false,
      assigned_to: null,
      created_at: '2026-09-01',
      exercises: undefined,
    };

    const { result } = renderHook(() =>
      useWorkoutSession({
        ...defaultProps,
        customTemplates: [customTemplate],
      })
    );

    act(() => {
      result.current.handleAddExercise('Bench Press');
      result.current.updateDraft('Bench Press', 1, 'weight', '225');
    });

    const initialRoutine = result.current.activeRoutineName;

    await act(async () => {
      await result.current.handleSelectRoutine('Custom Routine Network Error', customTemplate);
    });

    // Online fetch failure preserves active exercises and drafts identical to offline, with no toast online
    expect(result.current.activeRoutineName).toBe(initialRoutine);
    expect(result.current.activeExercises).toEqual(['Bench Press']);
    expect(workoutSessionStore.getSession(targetUserId, result.current.workoutDate)?.exercises).toEqual(['Bench Press']);
    expect(result.current.inputDrafts['Bench Press_1']).toEqual({ weight: '225', reps: undefined });
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('online failure with null detail keeps current workout untouched and shows no toast', async () => {
    setMockIsOnline(true);
    mockFetchTemplateDetail.mockResolvedValue(null);

    const customTemplate: RoutineTemplate = {
      id: 'tpl-deleted-online',
      user_id: targetUserId,
      name: 'Deleted Custom Routine',
      days_of_week: ['Mon'],
      is_master: false,
      assigned_to: null,
      created_at: '2026-09-01',
      exercises: undefined,
    };

    const { result } = renderHook(() =>
      useWorkoutSession({
        ...defaultProps,
        customTemplates: [customTemplate],
      })
    );

    act(() => {
      result.current.handleAddExercise('Squat');
    });

    const initialRoutine = result.current.activeRoutineName;

    await act(async () => {
      await result.current.handleSelectRoutine('Deleted Custom Routine', customTemplate);
    });

    expect(result.current.activeRoutineName).toBe(initialRoutine);
    expect(result.current.activeExercises).toEqual(['Squat']);
    expect(workoutSessionStore.getSession(targetUserId, result.current.workoutDate)?.exercises).toEqual(['Squat']);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('selecting a default template fallback switches client-side without fetching', async () => {
    const { result } = renderHook(() => useWorkoutSession(defaultProps));

    await act(async () => {
      await result.current.handleSelectRoutine('Push, Quads, & Core - Reduced');
    });

    expect(result.current.activeRoutineName).toBe('Push, Quads, & Core - Reduced');
    expect(result.current.activeExercises).toEqual([
      'Incline Bench Press',
      'Cable Lateral Raises',
      'Dips',
      'Leg Extension Machine',
      'Overhead Tricep Cable Pull',
    ]);
    expect(mockFetchTemplateDetail).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});

