import { describe, it, expect } from 'vitest';
import { resolveRoutineAndExercises } from './workoutEngineHelpers';
import { DEFAULT_WORKOUT_TEMPLATES } from '../../utils/ghostSets';
import type { RoutineTemplate, Exercise } from '../../types/database';

describe('resolveRoutineAndExercises - Starter Routines & Precedence', () => {
  const mockCatalog: Exercise[] = [
    { id: 'ex-incline', name: 'Incline Bench Press', body_parts: ['Chest'] },
    { id: 'ex-lat-raise', name: 'Cable Lateral Raises', body_parts: ['Shoulders'] },
    { id: 'ex-dips', name: 'Dips', body_parts: ['Chest'] },
    { id: 'ex-ext', name: 'Leg Extension Machine', body_parts: ['Legs'] },
    { id: 'ex-tri', name: 'Overhead Tricep Cable Pull', body_parts: ['Arms'] },
    { id: 'ex-lat-pull', name: 'Lat Pull Down', body_parts: ['Back'] },
    { id: 'ex-row', name: 'Seated Cable Row', body_parts: ['Back'] },
    { id: 'ex-curl', name: 'Inclined Bicep Curl', body_parts: ['Arms'] },
    { id: 'ex-leg-curl', name: 'Leg Curl', body_parts: ['Legs'] },
    { id: 'ex-face-pull', name: 'Face Pulls', body_parts: ['Shoulders'] },
    { id: 'ex-squat', name: 'Barbell Squat', body_parts: ['Legs'] },
  ];

  const masterPush: RoutineTemplate = {
    id: 'tpl-master-push',
    name: 'Push, Quads, & Core - Reduced',
    is_master: true,
    user_id: '',
    assigned_to: null,
    days_of_week: ['Mon', 'Thu'],
    exercises: [
      { id: 'te-1', template_id: 'tpl-master-push', exercise_id: 'ex-incline', order_index: 0, target_sets: 4, target_reps: 8, exercise: { name: 'Incline Bench Press' } },
      { id: 'te-2', template_id: 'tpl-master-push', exercise_id: 'ex-lat-raise', order_index: 1, target_sets: 3, target_reps: 12, exercise: { name: 'Cable Lateral Raises' } },
      { id: 'te-3', template_id: 'tpl-master-push', exercise_id: 'ex-dips', order_index: 2, target_sets: 3, target_reps: 10, exercise: { name: 'Dips' } },
      { id: 'te-4', template_id: 'tpl-master-push', exercise_id: 'ex-ext', order_index: 3, target_sets: 3, target_reps: 12, exercise: { name: 'Leg Extension Machine' } },
      { id: 'te-5', template_id: 'tpl-master-push', exercise_id: 'ex-tri', order_index: 4, target_sets: 3, target_reps: 12, exercise: { name: 'Overhead Tricep Cable Pull' } },
    ],
  };

  const masterPull: RoutineTemplate = {
    id: 'tpl-master-pull',
    name: 'Pull, Hamstring, & Core - Reduced',
    is_master: true,
    user_id: '',
    assigned_to: null,
    days_of_week: ['Tue', 'Fri'],
    exercises: [
      { id: 'te-6', template_id: 'tpl-master-pull', exercise_id: 'ex-lat-pull', order_index: 0, target_sets: 4, target_reps: 10, exercise: { name: 'Lat Pull Down' } },
      { id: 'te-7', template_id: 'tpl-master-pull', exercise_id: 'ex-row', order_index: 1, target_sets: 3, target_reps: 10, exercise: { name: 'Seated Cable Row' } },
      { id: 'te-8', template_id: 'tpl-master-pull', exercise_id: 'ex-curl', order_index: 2, target_sets: 3, target_reps: 12, exercise: { name: 'Inclined Bicep Curl' } },
      { id: 'te-9', template_id: 'tpl-master-pull', exercise_id: 'ex-leg-curl', order_index: 3, target_sets: 3, target_reps: 12, exercise: { name: 'Leg Curl' } },
      { id: 'te-10', template_id: 'tpl-master-pull', exercise_id: 'ex-face-pull', order_index: 4, target_sets: 3, target_reps: 15, exercise: { name: 'Face Pulls' } },
    ],
  };

  const userCustomMonday: RoutineTemplate = {
    id: 'tpl-custom-mon',
    name: 'My Personal Heavy Push',
    is_master: false,
    user_id: 'user-athlete-1',
    assigned_to: null,
    days_of_week: ['Mon'],
    exercises: [
      { id: 'te-c1', template_id: 'tpl-custom-mon', exercise_id: 'ex-squat', order_index: 0, target_sets: 5, target_reps: 5, exercise: { name: 'Barbell Squat' } },
    ],
  };

  describe('Online Path - New user with no own routines', () => {
    const onlineNewUserTemplates = [masterPush, masterPull];

    it('resolves Monday scheduled default to platform master Push routine', () => {
      // 2026-10-19 is Monday
      const res = resolveRoutineAndExercises('2026-10-19', [], onlineNewUserTemplates, mockCatalog);
      expect(res.routineName).toBe('Push, Quads, & Core - Reduced');
      expect(res.exercises).toEqual([
        'Incline Bench Press',
        'Cable Lateral Raises',
        'Dips',
        'Leg Extension Machine',
        'Overhead Tricep Cable Pull',
      ]);
      expect(res.targetSets['Incline Bench Press']).toBe(4);
      expect(res.targetReps['Incline Bench Press']).toBe(8);
    });

    it('resolves Tuesday scheduled default to platform master Pull routine', () => {
      // 2026-10-20 is Tuesday
      const res = resolveRoutineAndExercises('2026-10-20', [], onlineNewUserTemplates, mockCatalog);
      expect(res.routineName).toBe('Pull, Hamstring, & Core - Reduced');
      expect(res.exercises).toEqual([
        'Lat Pull Down',
        'Seated Cable Row',
        'Inclined Bicep Curl',
        'Leg Curl',
        'Face Pulls',
      ]);
      expect(res.targetSets['Lat Pull Down']).toBe(4);
      expect(res.targetReps['Lat Pull Down']).toBe(10);
    });

    it('resolves Wednesday (no routine scheduled) to Rest Day', () => {
      // 2026-10-21 is Wednesday
      const res = resolveRoutineAndExercises('2026-10-21', [], onlineNewUserTemplates, mockCatalog);
      expect(res.routineName).toBe('Rest Day');
      expect(res.exercises).toEqual([]);
    });
  });

  describe('Online Path - User with own routines takes precedence', () => {
    // Custom routine appears before master routine in customTemplates array
    // (guaranteed by get_routine_catalog precedence sorting: score 2 > score 1)
    const onlineExistingUserTemplates = [userCustomMonday, masterPush, masterPull];

    it('resolves Monday to user personal routine rather than master routine', () => {
      // 2026-10-19 is Monday
      const res = resolveRoutineAndExercises('2026-10-19', [], onlineExistingUserTemplates, mockCatalog);
      expect(res.routineName).toBe('My Personal Heavy Push');
      expect(res.exercises).toEqual(['Barbell Squat']);
      expect(res.targetSets['Barbell Squat']).toBe(5);
      expect(res.targetReps['Barbell Squat']).toBe(5);
    });
  });

  describe('Offline Path - Cache empty falls back to DEFAULT_WORKOUT_TEMPLATES', () => {
    it('falls back to DEFAULT_WORKOUT_TEMPLATES when offline and no custom/master templates cached', () => {
      // 2026-10-19 is Monday with empty templates array
      const res = resolveRoutineAndExercises('2026-10-19', [], [], mockCatalog);
      expect(res.routineName).toBe('Push, Quads, & Core - Reduced');
      expect(res.exercises).toEqual(DEFAULT_WORKOUT_TEMPLATES[0].exercises);
      expect(res.targetSets).toEqual(DEFAULT_WORKOUT_TEMPLATES[0].targetSets);
      expect(res.targetReps).toEqual(DEFAULT_WORKOUT_TEMPLATES[0].targetReps);
    });
  });
});
