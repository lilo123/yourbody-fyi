import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHistorySessionFilter } from './useHistorySessionFilter';
import type { HistorySession, HistorySet } from './useWorkoutHistory';
import type { Exercise } from '../../types/database';

describe('useHistorySessionFilter', () => {
  const mockSessions: HistorySession[] = [
    {
      id: 'sess-1',
      date: '2026-09-20',
      workout_date: '2026-09-20',
      civil_date: '2026-09-20',
      name: 'Push Day Benchmark',
      set_count: 5,
      total_volume: 12000,
      sets: [],
    },
    {
      id: 'sess-2',
      date: '2026-09-18',
      workout_date: '2026-09-18',
      civil_date: '2026-09-18',
      name: 'Pull & Back Hypertrophy',
      set_count: 6,
      total_volume: 8500,
      sets: [],
    },
    {
      id: 'sess-3',
      date: '2026-09-15',
      workout_date: '2026-09-15',
      civil_date: '2026-09-15',
      name: 'Leg Day Squats',
      set_count: 8,
      total_volume: 18000,
      sets: [],
    },
  ];

  const mockSessionSetsMap: Record<string, HistorySet[]> = {
    'sess-1': [
      {
        id: 'set-1',
        workout_id: 'sess-1',
        exercise_id: 'ex-bench',
        exercise_name: 'Barbell Bench Press',
        exercise: {
          id: 'ex-bench',
          name: 'Barbell Bench Press',
          body_parts: ['Chest'],
        },
        weight: 225,
        reps: 5,
        set_index: 1,
        set_type: 'working',
        rpe: 8,
        workout_date: '2026-09-20',
        workout_name: 'Push Day Benchmark',
        created_at: '2026-09-20T10:00:00Z',
      },
    ],
    'sess-2': [
      {
        id: 'set-2',
        workout_id: 'sess-2',
        exercise_id: 'ex-deadlift',
        exercise_name: 'Romanian Deadlift',
        exercise: {
          id: 'ex-deadlift',
          name: 'Romanian Deadlift',
          body_parts: ['Back'],
        },
        weight: 315,
        reps: 6,
        set_index: 1,
        set_type: 'working',
        rpe: 8,
        workout_date: '2026-09-18',
        workout_name: 'Pull & Back Hypertrophy',
        created_at: '2026-09-18T10:00:00Z',
      },
    ],
  };

  const mockExercises: Exercise[] = [
    { id: 'ex-bench', name: 'Barbell Bench Press', body_parts: ['Chest'], is_master: true },
    { id: 'ex-deadlift', name: 'Romanian Deadlift', body_parts: ['Back'], is_master: true },
    { id: 'ex-squat', name: 'Barbell Back Squat', body_parts: ['Legs'], is_master: true },
  ];

  it('returns all sessions when no query and category is All', () => {
    const { result } = renderHook(() =>
      useHistorySessionFilter(mockSessions, mockSessionSetsMap, '', 'All', mockExercises)
    );

    expect(result.current.isFiltering).toBe(false);
    expect(result.current.matchCount).toBe(3);
    expect(result.current.filtered).toHaveLength(3);
  });

  it('filters sessions by session name', () => {
    const { result } = renderHook(() =>
      useHistorySessionFilter(mockSessions, mockSessionSetsMap, 'push', 'All', mockExercises)
    );

    expect(result.current.isFiltering).toBe(true);
    expect(result.current.matchCount).toBe(1);
    expect(result.current.filtered[0].id).toBe('sess-1');
  });

  it('filters sessions by exercise names in loaded sets', () => {
    const { result } = renderHook(() =>
      useHistorySessionFilter(mockSessions, mockSessionSetsMap, 'bench', 'All', mockExercises)
    );

    expect(result.current.isFiltering).toBe(true);
    expect(result.current.matchCount).toBe(1);
    expect(result.current.filtered[0].id).toBe('sess-1');
  });

  it('expands fitness acronyms/aliases like rdl in query', () => {
    const { result } = renderHook(() =>
      useHistorySessionFilter(mockSessions, mockSessionSetsMap, 'rdl', 'All', mockExercises)
    );

    expect(result.current.isFiltering).toBe(true);
    expect(result.current.matchCount).toBe(1);
    expect(result.current.filtered[0].id).toBe('sess-2');
  });

  it('filters by category for sessions with loaded sets', () => {
    const { result } = renderHook(() =>
      useHistorySessionFilter(mockSessions, mockSessionSetsMap, '', 'Chest', mockExercises)
    );

    expect(result.current.isFiltering).toBe(true);
    // sess-1 has Chest in loaded sets. sess-2 has Back. sess-3 is unloaded and has "Leg Day" in name (not Chest).
    expect(result.current.matchCount).toBe(1);
    expect(result.current.filtered[0].id).toBe('sess-1');
  });

  it('allows unloaded sessions if session name matches category token (documented limitation)', () => {
    // sess-3 has no loaded sets in mockSessionSetsMap, but its name is "Leg Day Squats"
    const { result } = renderHook(() =>
      useHistorySessionFilter(mockSessions, mockSessionSetsMap, '', 'Legs', mockExercises)
    );

    expect(result.current.isFiltering).toBe(true);
    expect(result.current.matchCount).toBe(1);
    expect(result.current.filtered[0].id).toBe('sess-3');
  });

  it('excludes unloaded sessions if session name does not match category token', () => {
    // sess-3 has no loaded sets. Query category is "Back". sess-2 has Back in loaded sets. sess-3 does not match.
    const { result } = renderHook(() =>
      useHistorySessionFilter(mockSessions, mockSessionSetsMap, '', 'Back', mockExercises)
    );

    expect(result.current.isFiltering).toBe(true);
    expect(result.current.matchCount).toBe(1);
    expect(result.current.filtered[0].id).toBe('sess-2');
  });

  it('filters by both search query and category simultaneously', () => {
    const { result } = renderHook(() =>
      useHistorySessionFilter(mockSessions, mockSessionSetsMap, 'bench', 'Chest', mockExercises)
    );

    expect(result.current.isFiltering).toBe(true);
    expect(result.current.matchCount).toBe(1);
    expect(result.current.filtered[0].id).toBe('sess-1');

    // Query matches sess-1 (bench), but category is Legs -> 0 matches
    const { result: noMatch } = renderHook(() =>
      useHistorySessionFilter(mockSessions, mockSessionSetsMap, 'bench', 'Legs', mockExercises)
    );

    expect(noMatch.current.isFiltering).toBe(true);
    expect(noMatch.current.matchCount).toBe(0);
    expect(noMatch.current.filtered).toHaveLength(0);
  });
});
