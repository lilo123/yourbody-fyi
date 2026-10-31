import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { RoutineTemplate, Exercise } from '../../types/database';
import { DEFAULT_WORKOUT_TEMPLATES } from '../../utils/ghostSets';
import { resolveRoutineAndExercises, checkIsScheduledRoutineDirty } from './workoutEngineHelpers';
import { getInitialRoutineState } from './useWorkoutSessionHelpers';
import { useWorkoutSession } from './useWorkoutSession';
import { useWorkoutUrlParams } from './useWorkoutUrlParams';
import { RoutinePickerModal } from './RoutinePickerModal';
import { workoutSessionStore } from '../../utils/workoutSessionStore';
import * as pendingOpsModule from './useWorkoutPendingOps';
import * as onlineModule from '../../hooks/useOnlineStatus';

const mockCatalog: Exercise[] = [
  { id: 'ex-incline', name: 'Incline Bench Press', body_parts: ['Chest'] },
  { id: 'ex-lat-pull', name: 'Lat Pull Down', body_parts: ['Back'] },
  { id: 'ex-row', name: 'Seated Cable Row', body_parts: ['Back'] },
];

const pullRoutine: RoutineTemplate = {
  id: 'tpl-master-pull',
  name: 'Pull, Hamstring, & Core - Reduced',
  is_master: true,
  user_id: '',
  assigned_to: null,
  days_of_week: ['Tue', 'Fri'],
  exercises: [
    {
      id: 'te-pull-1',
      template_id: 'tpl-master-pull',
      exercise_id: 'ex-lat-pull',
      order_index: 0,
      target_sets: 4,
      target_reps: 10,
      exercise: { name: 'Lat Pull Down' },
    },
  ],
};

const customLegDay: RoutineTemplate = {
  id: 'tpl-custom-leg',
  name: 'My Custom Leg Day',
  is_master: false,
  user_id: '00000000-0000-0000-0000-000000000001',
  assigned_to: null,
  days_of_week: ['Wed'],
  exercises: [],
};

describe('Hidden routines stay hidden (confirm-first tests)', () => {
  let queryClient: QueryClient;
  const targetUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    workoutSessionStore.resetForTesting();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue([]);
    vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  describe('(1) useWorkoutSession integration and dirty checking', () => {
    it('passes customTemplates and loaded flag into session resolution; Monday does not pick deleted routine', () => {
      // 2026-10-19 is Monday. Catalog has loaded (templatesFetched = true) with only pullRoutine.
      const { result } = renderHook(
        () =>
          useWorkoutSession({
            targetUserId,
            exercises: mockCatalog,
            exercisesFetched: true,
            customTemplates: [pullRoutine],
            templatesFetched: true,
            userLogs: [],
            logsFetched: true,
            hasLoadedCatalog: true,
          }),
        { wrapper }
      );

      // On Monday, with pullRoutine (Tue/Fri) and no push routine, resolves to Rest Day
      expect(result.current.activeRoutineName).not.toBe('Push, Quads, & Core - Reduced');
      expect(result.current.activeRoutineName).toBe('Rest Day');
      expect(result.current.isScheduledRoutineDirty).toBe(false);
    });

    it('checkIsScheduledRoutineDirty evaluates against catalog schedule without injecting defaults', () => {
      const isDirty = checkIsScheduledRoutineDirty({
        workoutDate: '2026-10-19', // Monday
        activeRoutineName: 'Rest Day',
        activeExercises: [],
        customTemplates: [pullRoutine],
        exercises: mockCatalog,
        inputDrafts: {},
        hasLoadedCatalog: true,
      });
      // Monday scheduledName resolves to 'Rest Day' (not Push template), so active 'Rest Day' is not dirty
      expect(isDirty).toBe(false);
    });
  });

  describe('(2) hiding all masters (catalog has custom-only or empty)', () => {
    const allHiddenMasters = new Set(
      DEFAULT_WORKOUT_TEMPLATES.map((template) => template.name.toLowerCase())
    );

    it('schedule on Monday resolves to Rest Day with custom-only templates, never falling back to defaults', () => {
      // Catalog has loaded (hasLoadedCatalog = true), but user hid every master routine
      const res = resolveRoutineAndExercises(
        '2026-10-19', // Monday
        [],
        [customLegDay], // only a Wednesday custom routine
        mockCatalog,
        [],
        true,
        allHiddenMasters
      );
      expect(res.routineName).not.toBe('Push, Quads, & Core - Reduced');
      expect(res.routineName).toBe('Rest Day');
      expect(res.exercises).toEqual([]);
    });

    it('getInitialRoutineState resolves to Rest Day when masters are hidden', () => {
      const state = getInitialRoutineState(
        null,
        '2026-10-19',
        [customLegDay],
        true, // hasLoadedCatalog
        false, // isCatalogPending
        allHiddenMasters
      );
      expect(state.activeRoutineName).toBe('Rest Day');
      expect(state.activeExercises).toEqual([]);
    });

    it('picker shows no default routines when all masters are hidden', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <RoutinePickerModal
            isOpen={true}
            onClose={() => {}}
            onReloadScheduledRoutine={() => {}}
            onSelectRoutine={() => {}}
            activeRoutineName="Rest Day"
            currentDayAbbr="Mon"
            customTemplates={[customLegDay]}
            defaultTemplates={DEFAULT_WORKOUT_TEMPLATES}
            exercises={mockCatalog}
            hasLoadedCatalog={true}
            hiddenRoutineNames={allHiddenMasters}
          />
        </QueryClientProvider>
      );

      expect(screen.queryByText('Push, Quads, & Core - Reduced')).toBeNull();
      expect(screen.queryByText('Pull, Hamstring, & Core - Reduced')).toBeNull();
      expect(screen.getByText('My Custom Leg Day')).toBeDefined();
    });

    it('offers "Workout A (Push, Quads & Core)" when catalog loads without it and it is not hidden', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <RoutinePickerModal
            isOpen={true}
            onClose={() => {}}
            onReloadScheduledRoutine={() => {}}
            onSelectRoutine={() => {}}
            activeRoutineName="Rest Day"
            currentDayAbbr="Mon"
            customTemplates={[customLegDay]}
            defaultTemplates={DEFAULT_WORKOUT_TEMPLATES}
            exercises={mockCatalog}
            hasLoadedCatalog={true}
            hiddenRoutineNames={new Set<string>()}
          />
        </QueryClientProvider>
      );

      expect(screen.getByText('Workout A (Push, Quads & Core)')).toBeDefined();
    });

    it('does NOT offer "Workout A (Push, Quads & Core)" when it is hidden', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <RoutinePickerModal
            isOpen={true}
            onClose={() => {}}
            onReloadScheduledRoutine={() => {}}
            onSelectRoutine={() => {}}
            activeRoutineName="Rest Day"
            currentDayAbbr="Mon"
            customTemplates={[customLegDay]}
            defaultTemplates={DEFAULT_WORKOUT_TEMPLATES}
            exercises={mockCatalog}
            hasLoadedCatalog={true}
            hiddenRoutineNames={new Set(['workout a (push, quads & core)'])}
          />
        </QueryClientProvider>
      );

      expect(screen.queryByText('Workout A (Push, Quads & Core)')).toBeNull();
    });
  });

  describe('(3) ?routine= URL parameter handling', () => {
    it('does not resolve through DEFAULT_WORKOUT_TEMPLATES once catalog is loaded', () => {
      const onSelectRoutine = vi.fn();

      // Mock searchParams with ?routine=Push, Quads, & Core - Reduced
      window.history.pushState({}, '', '/workout?routine=Push%2C+Quads%2C+%26+Core+-+Reduced');

      renderHook(() =>
        useWorkoutUrlParams({
          customTemplates: [pullRoutine],
          templatesFetched: true,
          hasLoadedCatalog: true,
          onSelectRoutine,
          workoutDate: '2026-10-19',
          onDateChange: vi.fn(),
          targetUserId,
        })
      );

      // Must not call onSelectRoutine with the deleted master routine
      expect(onSelectRoutine).not.toHaveBeenCalledWith('Push, Quads, & Core - Reduced');
      expect(onSelectRoutine).not.toHaveBeenCalled();

      // Clean up URL
      window.history.pushState({}, '', '/workout');
    });
  });

  describe('(5) fresh online start with catalog PENDING vs cold offline', () => {
    it('online pending: picker shows no defaults and initial state does not lock a default into a draft', () => {
      // While catalog query is pending online:
      const state = getInitialRoutineState(
        null,
        '2026-10-19', // Monday
        [],
        false, // hasLoadedCatalog
        true // isCatalogPending
      );
      // Must not auto-schedule default routine into state or draft while pending
      expect(state.activeRoutineName).toBe('Rest Day');
      expect(state.activeExercises).toEqual([]);

      // In picker modal while pending:
      render(
        <QueryClientProvider client={queryClient}>
          <RoutinePickerModal
            isOpen={true}
            onClose={() => {}}
            onReloadScheduledRoutine={() => {}}
            onSelectRoutine={() => {}}
            activeRoutineName="Rest Day"
            currentDayAbbr="Mon"
            customTemplates={[]}
            defaultTemplates={DEFAULT_WORKOUT_TEMPLATES}
            exercises={mockCatalog}
            hasLoadedCatalog={false}
            isCatalogPending={true}
          />
        </QueryClientProvider>
      );
      expect(screen.queryByText('Push, Quads, & Core - Reduced')).toBeNull();
    });

    it('cold offline start: picker shows defaults and initial state falls back to defaults', () => {
      // True cold offline start: not loaded and not pending
      const state = getInitialRoutineState(
        null,
        '2026-10-19', // Monday
        [],
        false, // hasLoadedCatalog
        false // isCatalogPending
      );
      expect(state.activeRoutineName).toBe('Push, Quads, & Core - Reduced');
      expect(state.activeExercises).toEqual(DEFAULT_WORKOUT_TEMPLATES[0].exercises);

      render(
        <QueryClientProvider client={queryClient}>
          <RoutinePickerModal
            isOpen={true}
            onClose={() => {}}
            onReloadScheduledRoutine={() => {}}
            onSelectRoutine={() => {}}
            activeRoutineName="Rest Day"
            currentDayAbbr="Mon"
            customTemplates={[]}
            defaultTemplates={DEFAULT_WORKOUT_TEMPLATES}
            exercises={mockCatalog}
            hasLoadedCatalog={false}
            isCatalogPending={false}
          />
        </QueryClientProvider>
      );
      expect(screen.getByText('Push, Quads, & Core - Reduced')).toBeDefined();
    });
  });
});
