import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { RoutineTemplate, Exercise } from '../../types/database';
import { DEFAULT_WORKOUT_TEMPLATES } from '../../utils/ghostSets';
import { resolveRoutineAndExercises } from './workoutEngineHelpers';
import { useWorkoutQueries } from './useWorkoutQueries';
import { RoutinePickerModal } from './RoutinePickerModal';
import { supabase } from '../../lib/supabase';
import * as pendingOpsModule from './useWorkoutPendingOps';

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

describe('Hidden routines stay hidden (confirm-first tests)', () => {
  let queryClient: QueryClient;
  const targetUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.spyOn(pendingOpsModule, 'useWorkoutPendingOps').mockReturnValue([]);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  describe('(1) catalog without "Push, Quads, & Core - Reduced"', () => {
    it('schedule does not pick "Push, Quads, & Core - Reduced" on Monday or Thursday', () => {
      // 2026-10-19 is Monday; catalog only contains Pull routine (Tue/Fri)
      const mondayRes = resolveRoutineAndExercises(
        '2026-10-19',
        [],
        [pullRoutine],
        mockCatalog,
        [],
        true
      );
      expect(mondayRes.routineName).not.toBe('Push, Quads, & Core - Reduced');
      expect(mondayRes.routineName).toBe('Rest Day');

      // 2026-10-22 is Thursday
      const thursdayRes = resolveRoutineAndExercises(
        '2026-10-22',
        [],
        [pullRoutine],
        mockCatalog,
        [],
        true
      );
      expect(thursdayRes.routineName).not.toBe('Push, Quads, & Core - Reduced');
      expect(thursdayRes.routineName).toBe('Rest Day');
    });

    it('picker does not show "Push, Quads, & Core - Reduced" when catalog omits it', async () => {
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'exercises') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: mockCatalog, error: null }),
                  range: vi.fn().mockResolvedValue({ data: mockCatalog, error: null }),
                }),
              }),
            }),
          } as any;
        }
        if (table === 'routine_templates') {
          return {
            select: vi.fn().mockReturnValue({
              or: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [pullRoutine],
                    error: null,
                  }),
                }),
              }),
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const { result } = renderHook(
        () => useWorkoutQueries(targetUserId, '2026-10-19'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.templatesFetched).toBe(true);
      });

      // availableRoutines.defaults must NOT contain "Push, Quads, & Core - Reduced"
      const pushDefault = result.current.availableRoutines.defaults.find(
        (t) => t.name === 'Push, Quads, & Core - Reduced'
      );
      expect(pushDefault).toBeUndefined();

      // In the rendered picker modal with availableRoutines passed:
      render(
        <QueryClientProvider client={queryClient}>
          <RoutinePickerModal
            isOpen={true}
            onClose={() => {}}
            onReloadScheduledRoutine={() => {}}
            onSelectRoutine={() => {}}
            activeRoutineName="Rest Day"
            currentDayAbbr="Mon"
            customTemplates={result.current.availableRoutines.custom}
            defaultTemplates={result.current.availableRoutines.defaults}
            exercises={mockCatalog}
          />
        </QueryClientProvider>
      );

      expect(screen.queryByText('Push, Quads, & Core - Reduced')).toBeNull();
    });
  });

  describe('(2) catalog loaded but empty', () => {
    it('schedule resolves to Rest Day with no defaults injected', () => {
      // Catalog has loaded (templatesFetched = true) but contains 0 templates
      const res = resolveRoutineAndExercises(
        '2026-10-19',
        [],
        [],
        mockCatalog,
        [],
        true
      );
      expect(res.routineName).not.toBe('Push, Quads, & Core - Reduced');
      expect(res.routineName).toBe('Rest Day');
      expect(res.exercises).toEqual([]);
    });

    it('picker injects no defaults when catalog is loaded and empty', async () => {
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'exercises') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: mockCatalog, error: null }),
                  range: vi.fn().mockResolvedValue({ data: mockCatalog, error: null }),
                }),
              }),
            }),
          } as any;
        }
        if (table === 'routine_templates') {
          return {
            select: vi.fn().mockReturnValue({
              or: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const { result } = renderHook(
        () => useWorkoutQueries(targetUserId, '2026-10-19'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.templatesFetched).toBe(true);
      });

      expect(result.current.availableRoutines.defaults).toEqual([]);
      expect(result.current.availableRoutines.custom).toEqual([]);
    });
  });

  describe('(3) no catalog data (cold offline)', () => {
    it('schedule still falls back to defaults on cold offline start', () => {
      // hasLoadedCatalog is false (no catalog data loaded / cached)
      const res = resolveRoutineAndExercises(
        '2026-10-19',
        [],
        [],
        mockCatalog,
        [],
        false
      );
      expect(res.routineName).toBe('Push, Quads, & Core - Reduced');
      expect(res.exercises).toEqual(DEFAULT_WORKOUT_TEMPLATES[0].exercises);
      expect(res.targetSets).toEqual(DEFAULT_WORKOUT_TEMPLATES[0].targetSets);
    });

    it('picker still shows defaults when cold offline with no cached data', () => {
      // Query has not fetched and cache is empty
      const { result } = renderHook(
        () => useWorkoutQueries(targetUserId, '2026-10-19'),
        { wrapper }
      );

      expect(result.current.templatesFetched).toBe(false);
      expect(result.current.availableRoutines.defaults).toEqual(DEFAULT_WORKOUT_TEMPLATES);
    });
  });
});
