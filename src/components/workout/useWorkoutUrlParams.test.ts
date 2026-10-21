import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkoutUrlParams, isValidCivilDate } from './useWorkoutUrlParams';
import type { RoutineTemplate } from '../../types/database';

describe('useWorkoutUrlParams (URL-1, URL-2)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/workout');
  });

  it('isValidCivilDate validates YYYY-MM-DD correctly', () => {
    expect(isValidCivilDate('2026-09-20')).toBe(true);
    expect(isValidCivilDate('2026-02-28')).toBe(true);
    expect(isValidCivilDate('2026-02-30')).toBe(false);
    expect(isValidCivilDate('2026-13-01')).toBe(false);
    expect(isValidCivilDate('invalid-date')).toBe(false);
    expect(isValidCivilDate('')).toBe(false);
    expect(isValidCivilDate(null)).toBe(false);
  });

  it('applies valid ?date= param and ignores invalid date', () => {
    const onDateChange = vi.fn();
    const onSelectRoutine = vi.fn();

    // 1. Valid date in URL
    window.history.replaceState(null, '', '/workout?date=2026-09-20');
    renderHook(() =>
      useWorkoutUrlParams({
        customTemplates: [],
        templatesFetched: true,
        onSelectRoutine,
        workoutDate: '2026-09-01',
        onDateChange,
      })
    );

    expect(onDateChange).toHaveBeenCalledWith('2026-09-20');

    // 2. Invalid date in URL
    const onDateChangeInvalid = vi.fn();
    window.history.replaceState(null, '', '/workout?date=not-a-date');
    renderHook(() =>
      useWorkoutUrlParams({
        customTemplates: [],
        templatesFetched: true,
        onSelectRoutine,
        workoutDate: '2026-09-01',
        onDateChange: onDateChangeInvalid,
      })
    );

    expect(onDateChangeInvalid).not.toHaveBeenCalled();
  });

  it('syncDateToUrl updates search param in URL', () => {
    const onDateChange = vi.fn();
    const onSelectRoutine = vi.fn();

    const { result } = renderHook(() =>
      useWorkoutUrlParams({
        customTemplates: [],
        templatesFetched: true,
        onSelectRoutine,
        workoutDate: '2026-09-01',
        onDateChange,
      })
    );

    act(() => {
      result.current.syncDateToUrl('2026-09-25');
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get('date')).toBe('2026-09-25');
  });

  it('resolves routine by UUID and activates it', () => {
    const onSelectRoutine = vi.fn();
    const customTemplates: RoutineTemplate[] = [
      {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Custom Push Day',
        user_id: 'u1',
        is_master: false,
        assigned_to: null,
        created_at: '2026-09-01',
      },
    ];

    window.history.replaceState(
      null,
      '',
      '/workout?routine=11111111-2222-3333-4444-555555555555'
    );

    renderHook(() =>
      useWorkoutUrlParams({
        customTemplates,
        templatesFetched: true,
        onSelectRoutine,
        workoutDate: '2026-09-01',
        onDateChange: vi.fn(),
      })
    );

    expect(onSelectRoutine).toHaveBeenCalledWith(
      'Custom Push Day',
      customTemplates[0]
    );
  });

  it('removes ?routine= param from URL after consuming custom routine while preserving other query params and history state', () => {
    const onSelectRoutine = vi.fn();
    const customTemplates: RoutineTemplate[] = [
      {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Custom Push Day',
        user_id: 'u1',
        is_master: false,
        assigned_to: null,
        created_at: '2026-09-01',
      },
    ];

    const initialHistoryState = { fromSettings: true, scrollY: 120 };
    window.history.replaceState(
      initialHistoryState,
      '',
      '/workout?date=2026-09-20&routine=11111111-2222-3333-4444-555555555555#overview'
    );

    renderHook(() =>
      useWorkoutUrlParams({
        customTemplates,
        templatesFetched: true,
        onSelectRoutine,
        workoutDate: '2026-09-20',
        onDateChange: vi.fn(),
      })
    );

    expect(onSelectRoutine).toHaveBeenCalledWith(
      'Custom Push Day',
      customTemplates[0]
    );

    const searchParams = new URLSearchParams(window.location.search);
    expect(searchParams.has('routine')).toBe(false);
    expect(searchParams.get('date')).toBe('2026-09-20');
    expect(window.location.hash).toBe('#overview');
    expect(window.location.pathname).toBe('/workout');
    expect(window.history.state).toEqual(initialHistoryState);
  });

  it('removes ?routine= param from URL after consuming default routine', () => {
    const onSelectRoutine = vi.fn();

    window.history.replaceState(
      null,
      '',
      '/workout?routine=Workout%20A%20(Push,%20Quads%20%26%20Core)'
    );

    renderHook(() =>
      useWorkoutUrlParams({
        customTemplates: [],
        templatesFetched: true,
        onSelectRoutine,
        workoutDate: '2026-09-01',
        onDateChange: vi.fn(),
      })
    );

    expect(onSelectRoutine).toHaveBeenCalledWith('Workout A (Push, Quads & Core)');

    const searchParams = new URLSearchParams(window.location.search);
    expect(searchParams.has('routine')).toBe(false);
    expect(window.location.pathname).toBe('/workout');
  });


  it('does not re-apply routine param when targetUserId changes after being consumed', () => {
    const onSelectRoutine = vi.fn();
    const athlete1Templates: RoutineTemplate[] = [
      {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Custom Push Day',
        user_id: 'athlete-1',
        is_master: false,
        assigned_to: null,
        created_at: '2026-09-01',
      },
    ];
    const athlete2Templates: RoutineTemplate[] = [
      {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Custom Push Day',
        user_id: 'athlete-2',
        is_master: false,
        assigned_to: null,
        created_at: '2026-09-01',
      },
    ];

    window.history.replaceState(
      null,
      '',
      '/workout?routine=11111111-2222-3333-4444-555555555555'
    );

    const { rerender } = renderHook(
      ({ targetUserId, customTemplates }) =>
        useWorkoutUrlParams({
          customTemplates,
          templatesFetched: true,
          onSelectRoutine,
          workoutDate: '2026-09-01',
          onDateChange: vi.fn(),
          targetUserId,
        }),
      {
        initialProps: { targetUserId: 'athlete-1', customTemplates: athlete1Templates },
      }
    );

    expect(onSelectRoutine).toHaveBeenCalledTimes(1);
    expect(onSelectRoutine).toHaveBeenCalledWith(
      'Custom Push Day',
      athlete1Templates[0]
    );

    // Param is now stripped from URL
    expect(new URLSearchParams(window.location.search).has('routine')).toBe(false);

    // Coach switches athlete -> targetUserId changes and athlete 2 templates load
    rerender({ targetUserId: 'athlete-2', customTemplates: athlete2Templates });

    // onSelectRoutine should NOT be called a second time
    expect(onSelectRoutine).toHaveBeenCalledTimes(1);
  });

  it('does not re-apply routine param on remount after being consumed', () => {
    const onSelectRoutine = vi.fn();
    const customTemplates: RoutineTemplate[] = [
      {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Custom Push Day',
        user_id: 'u1',
        is_master: false,
        assigned_to: null,
        created_at: '2026-09-01',
      },
    ];

    window.history.replaceState(
      null,
      '',
      '/workout?routine=11111111-2222-3333-4444-555555555555'
    );

    const { unmount } = renderHook(() =>
      useWorkoutUrlParams({
        customTemplates,
        templatesFetched: true,
        onSelectRoutine,
        workoutDate: '2026-09-01',
        onDateChange: vi.fn(),
      })
    );

    expect(onSelectRoutine).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(window.location.search).has('routine')).toBe(false);

    // Unmount and remount (simulating page reload or component remount)
    unmount();

    renderHook(() =>
      useWorkoutUrlParams({
        customTemplates,
        templatesFetched: true,
        onSelectRoutine,
        workoutDate: '2026-09-01',
        onDateChange: vi.fn(),
      })
    );

    expect(onSelectRoutine).toHaveBeenCalledTimes(1);
  });
});



