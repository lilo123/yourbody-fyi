import { describe, it, expect } from 'vitest';
import {
  truncateText,
  selectBestSet,
  formatBestSet,
  buildWorkoutStoryData,
} from './workoutStorySummary';
import type { WorkoutSet } from '../types/database';

describe('workoutStorySummary pure functions', () => {
  describe('truncateText helper', () => {
    it('returns empty string when given empty text', () => {
      expect(truncateText('', 10)).toBe('');
    });

    it('returns original string when length is within maxLength', () => {
      expect(truncateText('Bench Press', 20)).toBe('Bench Press');
      expect(truncateText('Bench Press', 11)).toBe('Bench Press');
    });

    it('truncates text with an ellipsis when length exceeds maxLength', () => {
      const longName = 'Incline Dumbbell Overhead Tricep Extension';
      const truncated = truncateText(longName, 20);
      expect(truncated.length).toBeLessThanOrEqual(20);
      expect(truncated.endsWith('…')).toBe(true);
      expect(truncated).toBe('Incline Dumbbell Ov…');
    });

    it('handles small maxLength edge cases safely', () => {
      expect(truncateText('Abc', 1)).toBe('A');
      expect(truncateText('Abc', 2)).toBe('A…');
    });
  });

  describe('selectBestSet helper', () => {
    it('returns null when given empty sets', () => {
      expect(selectBestSet([])).toBeNull();
    });

    it('selects the set with heaviest weight', () => {
      const sets: WorkoutSet[] = [
        { id: '1', workout_id: 'w1', exercise_id: 'e1', weight: 135, reps: 10, set_index: 1, set_type: 'working', created_at: '2026-09-01T10:00:00Z', workout_date: '2026-09-01' },
        { id: '2', workout_id: 'w1', exercise_id: 'e1', weight: 185, reps: 8, set_index: 2, set_type: 'working', created_at: '2026-09-01T10:05:00Z', workout_date: '2026-09-01' },
        { id: '3', workout_id: 'w1', exercise_id: 'e1', weight: 155, reps: 12, set_index: 3, set_type: 'working', created_at: '2026-09-01T10:10:00Z', workout_date: '2026-09-01' },
      ];
      const best = selectBestSet(sets);
      expect(best?.id).toBe('2');
      expect(best?.weight).toBe(185);
      expect(best?.reps).toBe(8);
    });

    it('breaks ties on equal weight by higher reps', () => {
      const sets: WorkoutSet[] = [
        { id: '1', workout_id: 'w1', exercise_id: 'e1', weight: 200, reps: 5, set_index: 1, set_type: 'working', created_at: '2026-09-01T10:00:00Z', workout_date: '2026-09-01' },
        { id: '2', workout_id: 'w1', exercise_id: 'e1', weight: 200, reps: 8, set_index: 2, set_type: 'working', created_at: '2026-09-01T10:05:00Z', workout_date: '2026-09-01' },
      ];
      const best = selectBestSet(sets);
      expect(best?.id).toBe('2');
      expect(best?.reps).toBe(8);
    });

    it('ignores warmup sets and only selects from working sets', () => {
      const sets: WorkoutSet[] = [
        { id: '1', workout_id: 'w1', exercise_id: 'e1', weight: 225, reps: 5, set_index: 1, set_type: 'warmup', created_at: '2026-09-01T10:00:00Z', workout_date: '2026-09-01' },
        { id: '2', workout_id: 'w1', exercise_id: 'e1', weight: 185, reps: 5, set_index: 2, set_type: 'working', created_at: '2026-09-01T10:05:00Z', workout_date: '2026-09-01' },
      ];
      const best = selectBestSet(sets);
      expect(best?.id).toBe('2');
      expect(best?.weight).toBe(185);
    });

    it('picks higher e1rm set (200x8) over heavier set (220x1) when mode is e1rm', () => {
      const sets: WorkoutSet[] = [
        { id: '1', workout_id: 'w1', exercise_id: 'e1', weight: 220, reps: 1, set_index: 1, set_type: 'working', created_at: '2026-09-01T10:00:00Z', workout_date: '2026-09-01' },
        { id: '2', workout_id: 'w1', exercise_id: 'e1', weight: 200, reps: 8, set_index: 2, set_type: 'working', created_at: '2026-09-01T10:05:00Z', workout_date: '2026-09-01' },
      ];
      const best = selectBestSet(sets, 'e1rm');
      expect(best?.id).toBe('2');
      expect(best?.weight).toBe(200);
      expect(best?.reps).toBe(8);
    });

    it('picks heavier set (220x1) over higher e1rm set (200x8) when mode is weight or omitted', () => {
      const sets: WorkoutSet[] = [
        { id: '1', workout_id: 'w1', exercise_id: 'e1', weight: 220, reps: 1, set_index: 1, set_type: 'working', created_at: '2026-09-01T10:00:00Z', workout_date: '2026-09-01' },
        { id: '2', workout_id: 'w1', exercise_id: 'e1', weight: 200, reps: 8, set_index: 2, set_type: 'working', created_at: '2026-09-01T10:05:00Z', workout_date: '2026-09-01' },
      ];
      const bestExplicit = selectBestSet(sets, 'weight');
      const bestDefault = selectBestSet(sets);
      expect(bestExplicit?.id).toBe('1');
      expect(bestExplicit?.weight).toBe(220);
      expect(bestExplicit?.reps).toBe(1);
      expect(bestDefault?.id).toBe('1');
    });
  });

  describe('formatBestSet helper', () => {
    it('formats weighted set in lb unit', () => {
      expect(formatBestSet({ weight: 225, reps: 5 }, 'lb')).toBe('225 lbs × 5');
    });

    it('formats weighted set in kg unit with accurate conversion', () => {
      expect(formatBestSet({ weight: 225, reps: 5 }, 'kg')).toBe('102.1 kg × 5');
    });

    it('formats bodyweight set (0 weight or null weight) as BW', () => {
      expect(formatBestSet({ weight: 0, reps: 10 }, 'lb')).toBe('BW × 10');
      expect(formatBestSet({ weight: null, reps: 8 }, 'kg')).toBe('BW × 8');
    });

    it('returns placeholder when set is null', () => {
      expect(formatBestSet(null, 'lb')).toBe('—');
    });
  });

  describe('buildWorkoutStoryData builder', () => {
    it('computes volume, best sets, total sets, and formats date in lb mode', () => {
      const sets: (WorkoutSet & { exercise_name?: string })[] = [
        { id: '1', workout_id: 'w1', exercise_id: 'e1', exercise_name: 'Bench Press', weight: 200, reps: 5, set_index: 1, set_type: 'working', created_at: '2026-09-15T10:00:00Z', workout_date: '2026-09-15' },
        { id: '2', workout_id: 'w1', exercise_id: 'e1', exercise_name: 'Bench Press', weight: 220, reps: 5, set_index: 2, set_type: 'working', created_at: '2026-09-15T10:05:00Z', workout_date: '2026-09-15' },
        { id: '3', workout_id: 'w1', exercise_id: 'e2', exercise_name: 'Overhead Press', weight: 115, reps: 8, set_index: 1, set_type: 'working', created_at: '2026-09-15T10:15:00Z', workout_date: '2026-09-15' },
      ];

      const data = buildWorkoutStoryData({
        sessionName: 'Push Day Heavy',
        workoutDate: '2026-09-15',
        sets,
        unit: 'lb',
      });

      expect(data.title).toBe('Push Day Heavy');
      expect(data.dateFormatted).toBe('Sep 15');
      // Calculated volume: 200*5 + 220*5 + 115*8 = 1000 + 1100 + 920 = 3020 lbs
      expect(data.totalVolumeFormatted).toBe('3,020 lbs');
      expect(data.totalSets).toBe(3);
      expect(data.exercises).toHaveLength(2);
      expect(data.exercises[0]).toEqual({
        name: 'Bench Press',
        bestSetFormatted: '220 lbs × 5',
        bestWeight: 220,
        bestReps: 5,
        setCount: 2,
      });
      expect(data.exercises[1]).toEqual({
        name: 'Overhead Press',
        bestSetFormatted: '115 lbs × 8',
        bestWeight: 115,
        bestReps: 8,
        setCount: 1,
      });
      expect(data.overflowCount).toBe(0);
    });

    it('converts volume and sets accurately in kg mode', () => {
      const sets: (WorkoutSet & { exercise_name?: string })[] = [
        { id: '1', workout_id: 'w1', exercise_id: 'e1', exercise_name: 'Squat', weight: 315, reps: 5, set_index: 1, set_type: 'working', created_at: '2026-09-20T10:00:00Z', workout_date: '2026-09-20' },
      ];

      const data = buildWorkoutStoryData({
        sessionName: 'Leg Day',
        workoutDate: '2026-09-20',
        sets,
        unit: 'kg',
        totalVolume: 13500,
      });

      // 13500 lbs converted to kg is 6,124 kg
      expect(data.totalVolumeFormatted).toBe('6,124 kg');
      // 315 lbs is 142.9 kg
      expect(data.exercises[0].bestSetFormatted).toBe('142.9 kg × 5');
    });

    it('enforces 6-exercise cap and computes overflow count for sessions with > 6 exercises', () => {
      const sets: (WorkoutSet & { exercise_name?: string })[] = [];
      for (let i = 1; i <= 9; i++) {
        sets.push({
          id: `s-${i}`,
          workout_id: 'w1',
          exercise_id: `e-${i}`,
          exercise_name: `Movement ${i}`,
          weight: 100 + i * 10,
          reps: 10,
          set_index: 1,
          set_type: 'working',
          created_at: `2026-09-22T10:0${i}:00Z`,
          workout_date: '2026-09-22',
        });
      }

      const data = buildWorkoutStoryData({
        sessionName: 'Full Body Endurance',
        workoutDate: '2026-09-22',
        sets,
        unit: 'lb',
      });

      expect(data.exercises).toHaveLength(6);
      expect(data.overflowCount).toBe(3);
      expect(data.exercises[0].name).toBe('Movement 1');
      expect(data.exercises[5].name).toBe('Movement 6');
    });

    it('resolves exercise names from exercise catalog when exercise_id is present', () => {
      const sets: (WorkoutSet & { exercise_name?: string })[] = [
        { id: '1', workout_id: 'w1', exercise_id: 'ex-uuid-1', weight: 135, reps: 10, set_index: 1, set_type: 'working', created_at: '2026-09-22T10:00:00Z', workout_date: '2026-09-22' },
      ];

      const exercises = [
        { id: 'ex-uuid-1', name: 'Barbell Row', body_parts: ['Back'] },
      ];

      const data = buildWorkoutStoryData({
        sessionName: 'Back Day',
        workoutDate: '2026-09-22',
        sets,
        exercises: exercises as any,
        unit: 'lb',
      });

      expect(data.exercises[0].name).toBe('Barbell Row');
    });

    it('handles empty session with 0 sets safely without NaN or errors', () => {
      const data = buildWorkoutStoryData({
        sessionName: '',
        workoutDate: '',
        sets: [],
        unit: 'lb',
      });

      expect(data.title).toBe('Workout Session');
      expect(data.totalVolumeFormatted).toBe('0 lbs (BW)');
      expect(data.totalSets).toBe(0);
      expect(data.exercises).toEqual([]);
      expect(data.overflowCount).toBe(0);
    });

    it('selects best set respecting prMode in buildWorkoutStoryData', () => {
      const sets: (WorkoutSet & { exercise_name?: string })[] = [
        { id: '1', workout_id: 'w1', exercise_id: 'e1', exercise_name: 'Bench Press', weight: 220, reps: 1, set_index: 1, set_type: 'working', created_at: '2026-09-15T10:00:00Z', workout_date: '2026-09-15' },
        { id: '2', workout_id: 'w1', exercise_id: 'e1', exercise_name: 'Bench Press', weight: 200, reps: 8, set_index: 2, set_type: 'working', created_at: '2026-09-15T10:05:00Z', workout_date: '2026-09-15' },
      ];

      const dataE1rm = buildWorkoutStoryData({
        sessionName: 'Chest Day',
        workoutDate: '2026-09-15',
        sets,
        unit: 'lb',
        prMode: 'e1rm',
      });
      expect(dataE1rm.exercises[0].bestSetFormatted).toBe('200 lbs × 8');
      expect(dataE1rm.exercises[0].bestWeight).toBe(200);
      expect(dataE1rm.exercises[0].bestReps).toBe(8);

      const dataWeight = buildWorkoutStoryData({
        sessionName: 'Chest Day',
        workoutDate: '2026-09-15',
        sets,
        unit: 'lb',
        prMode: 'weight',
      });
      expect(dataWeight.exercises[0].bestSetFormatted).toBe('220 lbs × 1');
      expect(dataWeight.exercises[0].bestWeight).toBe(220);
      expect(dataWeight.exercises[0].bestReps).toBe(1);

      const dataDefault = buildWorkoutStoryData({
        sessionName: 'Chest Day',
        workoutDate: '2026-09-15',
        sets,
        unit: 'lb',
      });
      expect(dataDefault.exercises[0].bestSetFormatted).toBe('220 lbs × 1');
    });
  });
});
