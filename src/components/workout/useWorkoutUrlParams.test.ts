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
});
