import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTemplateEditor, mapTemplateExercises } from './useTemplateEditor';
import type { Exercise, RoutineTemplate } from '../../types/database';

describe('useTemplateEditor & mapTemplateExercises', () => {
  const mockExercises: Exercise[] = [
    { id: 'ex-1', name: 'Bench Press', body_parts: ['Chest'], is_master: true, created_at: '' },
    { id: 'ex-2', name: 'Squat', body_parts: ['Legs'], is_master: true, created_at: '' },
  ];

  it('mapTemplateExercises sorts by order_index and resolves exercise details', () => {
    const rawItems = [
      { id: 'item-2', exercise_id: 'ex-2', order_index: 1, target_sets: 4, target_reps: 8 },
      { id: 'item-1', exercise_id: 'ex-1', order_index: 0, target_sets: 3, target_reps: 10 },
    ];
    const mapped = mapTemplateExercises(rawItems, mockExercises);
    expect(mapped).toHaveLength(2);
    expect(mapped[0].exercise_name).toBe('Bench Press');
    expect(mapped[0].target_sets).toBe(3);
    expect(mapped[1].exercise_name).toBe('Squat');
    expect(mapped[1].target_sets).toBe(4);
  });

  it('initializes with default values when template is null', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTemplateEditor({
        isOpen: true,
        template: null,
        onClose,
        exercises: mockExercises,
      })
    );

    expect(result.current.name).toBe('');
    expect(result.current.days).toEqual([]);
    expect(result.current.templateExercises).toEqual([]);
    expect(result.current.titleText).toBe('Create Routine Template');
  });

  it('toggleDay toggles day of week in and out of selection', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTemplateEditor({
        isOpen: true,
        template: null,
        onClose,
      })
    );

    act(() => {
      result.current.toggleDay('Mon');
    });
    expect(result.current.days).toEqual(['Mon']);

    act(() => {
      result.current.toggleDay('Wed');
    });
    expect(result.current.days).toEqual(['Mon', 'Wed']);

    act(() => {
      result.current.toggleDay('Mon');
    });
    expect(result.current.days).toEqual(['Wed']);
  });

  it('clamps target sets between 1 and 20, and target reps between 1 and 100', () => {
    const onClose = vi.fn();
    const template: RoutineTemplate = {
      id: 'tpl-1',
      user_id: 'u-1',
      name: 'Push Day',
      is_master: false,
      assigned_to: null,
      days_of_week: ['Mon'],
      exercises: [
        { id: 'i-1', exercise_id: 'ex-1', template_id: 'tpl-1', order_index: 0, target_sets: 3, target_reps: 10 },
      ],
      created_at: '',
    };

    const { result } = renderHook(() =>
      useTemplateEditor({
        isOpen: true,
        template,
        isFork: true, // fork initializes immediately from template without async fetch
        onClose,
        exercises: mockExercises,
      })
    );

    expect(result.current.templateExercises).toHaveLength(1);

    act(() => {
      result.current.updateSets(0, 999);
    });
    expect(result.current.templateExercises[0].target_sets).toBe(20);

    act(() => {
      result.current.updateSets(0, 0);
    });
    expect(result.current.templateExercises[0].target_sets).toBe(1);

    act(() => {
      result.current.updateReps(0, 500);
    });
    expect(result.current.templateExercises[0].target_reps).toBe(100);

    act(() => {
      result.current.updateReps(0, -5);
    });
    expect(result.current.templateExercises[0].target_reps).toBe(1);
  });

  it('reorders and removes exercises with announcements', () => {
    const onClose = vi.fn();
    const template: RoutineTemplate = {
      id: 'tpl-1',
      user_id: 'u-1',
      name: 'Full Body',
      is_master: false,
      assigned_to: null,
      days_of_week: ['Mon'],
      exercises: [
        { id: 'i-1', exercise_id: 'ex-1', template_id: 'tpl-1', order_index: 0, target_sets: 3, target_reps: 10 },
        { id: 'i-2', exercise_id: 'ex-2', template_id: 'tpl-1', order_index: 1, target_sets: 4, target_reps: 8 },
      ],
      created_at: '',
    };

    const { result } = renderHook(() =>
      useTemplateEditor({
        isOpen: true,
        template,
        isFork: true,
        onClose,
        exercises: mockExercises,
      })
    );

    act(() => {
      result.current.moveExercise(0, 1);
    });
    expect(result.current.templateExercises[0].exercise_id).toBe('ex-2');
    expect(result.current.templateExercises[1].exercise_id).toBe('ex-1');
    expect(result.current.reorderAnnouncement).toContain('Moved Bench Press to position 2 of 2');

    act(() => {
      result.current.removeExercise(1);
    });
    expect(result.current.templateExercises).toHaveLength(1);
    expect(result.current.templateExercises[0].exercise_id).toBe('ex-2');
    expect(result.current.reorderAnnouncement).toBe('Removed Bench Press from routine');
  });
});
