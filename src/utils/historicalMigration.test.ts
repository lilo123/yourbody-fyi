import { describe, it, expect } from 'vitest';
import {
  resolveExerciseName,
  sanitizeHistoricalLogs,
  calculateTotalVolume,
  assertMigrationIntegrity,
  isMasterExercise,
  isCustomExercise,
  MASTER_EXERCISE_NAMES,
  CUSTOM_EXERCISE_NAMES,
  PURGED_CLIENT_IDS,
} from './historicalMigration';

describe('Historical Data Migration Utilities', () => {

  it('aliases Lat Cable Pulldown to Lat Cable Prayer and normalizes Push to Pull', () => {
    expect(resolveExerciseName('Lat Cable Pulldown')).toBe('Lat Cable Prayer');
    expect(resolveExerciseName('lat cable pulldown ')).toBe('Lat Cable Prayer');
    expect(resolveExerciseName('Overhead Tricep Cable Push')).toBe('Overhead Tricep Cable Pull');
    expect(resolveExerciseName('Incline Bench Press')).toBe('Incline Bench Press');
    expect(resolveExerciseName('Dips')).toBe('Dips');
  });

  it('purges the 2 phantom duplicate submissions from historical logs', () => {
    const sampleLogs = [
      {
        Workout_ID: 'Push Workout A',
        Exercise_ID: 'Dips',
        Weight: 100,
        Reps: 10,
        Date: '2026-01-05',
        Set_Index: 1,
        Client_ID: 'C-KEEP-001',
      },
      {
        Workout_ID: 'Push Workout A',
        Exercise_ID: 'Dips',
        Weight: 100,
        Reps: 10,
        Date: '2026-01-05',
        Set_Index: 1,
        Client_ID: 'C-PURGE-001',
      },
      {
        Workout_ID: 'Pull Workout A',
        Exercise_ID: 'Lat Pull Down',
        Weight: 150,
        Reps: 10,
        Date: '2026-01-05',
        Set_Index: 1,
        Client_ID: 'C-KEEP-002',
      },
      {
        Workout_ID: 'Pull Workout A',
        Exercise_ID: 'Lat Pull Down',
        Weight: 150,
        Reps: 10,
        Date: '2026-01-05',
        Set_Index: 1,
        Client_ID: 'C-PURGE-002',
      },
      {
        Workout_ID: 'Pull Workout A',
        Exercise_ID: 'Lat Pull Down',
        Weight: 150,
        Reps: 10,
        Date: '2026-01-05',
        Set_Index: 2,
        Client_ID: 'C-KEEP-003',
      },
      {
        Workout_ID: 'Push Workout A',
        Exercise_ID: 'Lat Cable Pulldown',
        Weight: 50,
        Reps: 15,
        Date: '2026-01-05',
        Set_Index: 1,
        Client_ID: 'C-KEEP-004',
      },
    ];

    expect(PURGED_CLIENT_IDS.has('C-PURGE-001')).toBe(true);
    expect(PURGED_CLIENT_IDS.has('C-PURGE-002')).toBe(true);

    const sanitized = sanitizeHistoricalLogs(sampleLogs);
    expect(sanitized).toHaveLength(4);

    // Verify duplicates removed
    const clientIds = sanitized.map((s) => s.clientId);
    expect(clientIds).not.toContain('C-PURGE-001');
    expect(clientIds).not.toContain('C-PURGE-002');
    expect(clientIds).toContain('C-KEEP-001');
    expect(clientIds).toContain('C-KEEP-002');

    // Verify aliased exercise
    const aliasedSet = sanitized.find((s) => s.clientId === 'C-KEEP-004');
    expect(aliasedSet?.exerciseName).toBe('Lat Cable Prayer');
  });

  it('correctly calculates total volume including decimal bodyweights', () => {
    const sampleSets = [
      { weight: 100.5, reps: 10 },
      { weight: 150.0, reps: 10 },
      { weight: 0.0, reps: 20 },
      { weight: 120.0, reps: 10 },
    ];

    const volume = calculateTotalVolume(sampleSets);
    expect(volume).toBe(3705.0);
  });

  it('validates migration integrity assertion gates', () => {
    const validMetrics = {
      workoutsCount: 20,
      setsCount: 200,
      totalVolume: 50000.0,
      templatesCount: 4,
      templateExercisesCount: 20,
      nutritionLogsCount: 40,
      catalogExercisesCount: 20,
    };

    expect(() => assertMigrationIntegrity(validMetrics)).not.toThrow();

    // Mismatched sets
    expect(() =>
      assertMigrationIntegrity({ ...validMetrics, setsCount: 205 })
    ).toThrowError(/Expected 200 sets, got 205/);

    // Mismatched volume
    expect(() =>
      assertMigrationIntegrity({ ...validMetrics, totalVolume: 51000.0 })
    ).toThrowError(/Expected 50000 lb volume/);

    // Mismatched workouts
    expect(() =>
      assertMigrationIntegrity({ ...validMetrics, workoutsCount: 19 })
    ).toThrowError(/Expected 20 workouts/);

    // Mismatched templates
    expect(() =>
      assertMigrationIntegrity({ ...validMetrics, templatesCount: 3 })
    ).toThrowError(/Expected 4 routine templates/);

    // Mismatched template exercises
    expect(() =>
      assertMigrationIntegrity({ ...validMetrics, templateExercisesCount: 18 })
    ).toThrowError(/Expected 20 template exercises/);

    // Mismatched nutrition logs
    expect(() =>
      assertMigrationIntegrity({ ...validMetrics, nutritionLogsCount: 38 })
    ).toThrowError(/Expected 40 nutrition logs/);

    // Mismatched catalog exercises
    expect(() =>
      assertMigrationIntegrity({ ...validMetrics, catalogExercisesCount: 24 })
    ).toThrowError(/Expected 20 catalog exercises/);
  });

  it('correctly classifies master vs custom exercises', () => {
    // 12 master exercises
    expect(MASTER_EXERCISE_NAMES).toHaveLength(12);
    expect(isMasterExercise('Incline Bench Press')).toBe(true);
    expect(isMasterExercise('dips')).toBe(true);
    expect(isMasterExercise('Overhead Tricep Cable Pull')).toBe(true);
    // Legacy catalog alias
    expect(isMasterExercise('Overhead Tricep Cable Push')).toBe(true);

    // 11 custom exercises
    expect(CUSTOM_EXERCISE_NAMES).toHaveLength(11);
    expect(isCustomExercise('Dragon Flag')).toBe(true);
    expect(isCustomExercise('L2H Cable Fly')).toBe(true);
    expect(isCustomExercise('Lat Cable Prayer')).toBe(true);
    // Legacy logging alias
    expect(isCustomExercise('Lat Cable Pulldown')).toBe(true);

    // Cross-check mutual exclusivity
    expect(isMasterExercise('Dragon Flag')).toBe(false);
    expect(isCustomExercise('Incline Bench Press')).toBe(false);
    expect(isMasterExercise('Unknown Exercise')).toBe(false);
    expect(isCustomExercise('Unknown Exercise')).toBe(false);
  });

  it('safely handles null/undefined inputs and invalid numbers', () => {
    expect(resolveExerciseName(null)).toBe('');
    expect(resolveExerciseName(undefined)).toBe('');
    expect(resolveExerciseName('')).toBe('');

    const corruptedLogs = [
      {
        Workout_ID: 'Workout Test',
        Exercise_ID: 'Dips',
        Weight: -10, // negative weight
        Reps: 'invalid', // NaN reps
        Date: '2026-08-20',
        Set_Index: 0, // invalid index < 1
        Client_ID: 'C-valid-1',
      },
      {
        Workout_ID: 'Workout Test',
        Exercise_ID: 'Dips',
        Weight: 100,
        Reps: 10,
        Date: '2026-08-20',
        Set_Index: 1,
        Client_ID: '', // empty client id
      },
    ];

    const sanitized = sanitizeHistoricalLogs(corruptedLogs as any);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].weight).toBe(0);
    expect(sanitized[0].reps).toBe(0);
    expect(sanitized[0].setIndex).toBe(1);

    // Volume calculation ignores invalid/negative values
    expect(
      calculateTotalVolume([
        { weight: -50, reps: 10 },
        { weight: 100, reps: -5 },
        { weight: NaN, reps: 10 },
        { weight: 50, reps: 10 },
      ])
    ).toBe(500);
  });
});
