import { describe, it, expect } from 'vitest';
import {
  computeGhostSets,
  getExerciseBenchmarks,
  mergeBenchmarks,
  normalizeDateStr,
  getLocalDateStr,
  getDayOfWeekAbbr,
  DEFAULT_WORKOUT_TEMPLATES,
} from './ghostSets';
import type { WorkoutSet } from '../types/database';

describe('Ghost Sets Algorithm & Benchmarks', () => {
  it('normalizes date strings correctly', () => {
    expect(normalizeDateStr('2026-09-01T12:00:00Z')).toBe('2026-09-01');
    expect(normalizeDateStr('2026-09-01')).toBe('2026-09-01');
    expect(normalizeDateStr(new Date(2026, 8, 1, 12, 0, 0))).toBe('2026-09-01');
    expect(normalizeDateStr('')).toBe('');
  });

  it('returns empty ghost sets when no previous workout history exists', () => {
    const ghosts = computeGhostSets('ex-bench', 3, [], '2026-09-02');
    expect(ghosts).toHaveLength(3);
    expect(ghosts[0]).toEqual({
      weight: '',
      reps: '',
      hintText: '—',
      isFromPrevious: false,
    });
    expect(ghosts[1].isFromPrevious).toBe(false);
    expect(ghosts[2].isFromPrevious).toBe(false);
  });

  it('maps 1:1 previous working sets correctly', () => {
    const history: (WorkoutSet & { workout_date: string })[] = [
      {
        exercise_id: 'ex-bench',
        set_index: 1,
        set_type: 'working',
        weight: 185,
        reps: 8,
        workout_date: '2026-08-28',
      },
      {
        exercise_id: 'ex-bench',
        set_index: 2,
        set_type: 'working',
        weight: 185,
        reps: 7,
        workout_date: '2026-08-28',
      },
      {
        exercise_id: 'ex-bench',
        set_index: 3,
        set_type: 'working',
        weight: 190,
        reps: 5,
        workout_date: '2026-08-28',
      },
    ];

    const ghosts = computeGhostSets('ex-bench', 3, history, '2026-09-01');
    expect(ghosts).toHaveLength(3);
    expect(ghosts[0]).toEqual({
      weight: 185,
      reps: 8,
      hintText: '185 lbs × 8',
      isFromPrevious: true,
    });
    expect(ghosts[1]).toEqual({
      weight: 185,
      reps: 7,
      hintText: '185 lbs × 7',
      isFromPrevious: true,
    });
    expect(ghosts[2]).toEqual({
      weight: 190,
      reps: 5,
      hintText: '190 lbs × 5',
      isFromPrevious: true,
    });
  });

  it('handles set expansion by propagating the last available set values', () => {
    const history: (WorkoutSet & { workout_date: string })[] = [
      {
        exercise_id: 'ex-bench',
        set_index: 1,
        set_type: 'working',
        weight: 135,
        reps: 10,
        workout_date: '2026-08-25',
      },
      {
        exercise_id: 'ex-bench',
        set_index: 2,
        set_type: 'working',
        weight: 155,
        reps: 8,
        workout_date: '2026-08-25',
      },
    ];

    // User is doing 4 sets today
    const ghosts = computeGhostSets('ex-bench', 4, history, '2026-08-29');
    expect(ghosts).toHaveLength(4);
    expect(ghosts[0].weight).toBe(135);
    expect(ghosts[1].weight).toBe(155);
    // Set 3 and Set 4 inherit Set 2
    expect(ghosts[2].weight).toBe(155);
    expect(ghosts[2].reps).toBe(8);
    expect(ghosts[3].weight).toBe(155);
    expect(ghosts[3].reps).toBe(8);
  });

  it('handles set contraction by limiting to target set count', () => {
    const history: (WorkoutSet & { workout_date: string })[] = [
      {
        exercise_id: 'ex-squat',
        set_index: 1,
        set_type: 'working',
        weight: 225,
        reps: 5,
        workout_date: '2026-08-20',
      },
      {
        exercise_id: 'ex-squat',
        set_index: 2,
        set_type: 'working',
        weight: 245,
        reps: 5,
        workout_date: '2026-08-20',
      },
      {
        exercise_id: 'ex-squat',
        set_index: 3,
        set_type: 'working',
        weight: 265,
        reps: 3,
        workout_date: '2026-08-20',
      },
    ];

    // User only wants 2 sets today
    const ghosts = computeGhostSets('ex-squat', 2, history, '2026-08-25');
    expect(ghosts).toHaveLength(2);
    expect(ghosts[0].weight).toBe(225);
    expect(ghosts[1].weight).toBe(245);
  });

  it('prefers working sets and filters out warmup sets from ghost values when working sets exist', () => {
    const history: (WorkoutSet & { workout_date: string })[] = [
      {
        exercise_id: 'ex-deadlift',
        set_index: 1,
        set_type: 'warmup',
        weight: 135,
        reps: 10,
        workout_date: '2026-08-22',
      },
      {
        exercise_id: 'ex-deadlift',
        set_index: 2,
        set_type: 'warmup',
        weight: 225,
        reps: 5,
        workout_date: '2026-08-22',
      },
      {
        exercise_id: 'ex-deadlift',
        set_index: 3,
        set_type: 'working',
        weight: 315,
        reps: 5,
        workout_date: '2026-08-22',
      },
      {
        exercise_id: 'ex-deadlift',
        set_index: 4,
        set_type: 'working',
        weight: 335,
        reps: 3,
        workout_date: '2026-08-22',
      },
    ];

    const ghosts = computeGhostSets('ex-deadlift', 2, history, '2026-08-29');
    expect(ghosts).toHaveLength(2);
    expect(ghosts[0].weight).toBe(315);
    expect(ghosts[0].reps).toBe(5);
    expect(ghosts[1].weight).toBe(335);
    expect(ghosts[1].reps).toBe(3);
  });

  it('selects the strictly most recent previous session and computes PR correctly', () => {
    const history: (WorkoutSet & { workout_date: string })[] = [
      {
        exercise_id: 'ex-press',
        set_index: 1,
        set_type: 'working',
        weight: 100,
        reps: 10,
        workout_date: '2026-08-01',
      },
      {
        exercise_id: 'ex-press',
        set_index: 1,
        set_type: 'working',
        weight: 120,
        reps: 5,
        workout_date: '2026-08-15',
      },
      {
        exercise_id: 'ex-press',
        set_index: 1,
        set_type: 'working',
        weight: 115,
        reps: 6,
        workout_date: '2026-08-25',
      },
    ];

    const benchmarks = getExerciseBenchmarks('ex-press', history, '2026-08-30');
    expect(benchmarks.lastSession).not.toBeNull();
    expect(benchmarks.lastSession?.date).toBe('2026-08-25');
    expect(benchmarks.lastSession?.summaryText).toBe('115×6');

    // PR is the heaviest set (120 lbs)
    expect(benchmarks.pr).not.toBeNull();
    expect(benchmarks.pr?.weight).toBe(120);
    expect(benchmarks.pr?.reps).toBe(5);
    expect(benchmarks.pr?.date).toBe('2026-08-15');
  });

  it('correctly generates local YYYY-MM-DD date string without UTC timezone shifts', () => {
    const customDate = new Date(2026, 8, 6, 23, 59, 59); // Sep 6, 2026 local
    expect(getLocalDateStr(customDate)).toBe('2026-09-06');
    expect(getLocalDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('safely extracts 3-letter day of week abbreviation using local date parts', () => {
    expect(getDayOfWeekAbbr('2026-09-06')).toBe('Sun');
    expect(getDayOfWeekAbbr('2026-09-07')).toBe('Mon');
    expect(getDayOfWeekAbbr('2026-09-08')).toBe('Tue');
    expect(getDayOfWeekAbbr('2026-09-09')).toBe('Wed');
    expect(getDayOfWeekAbbr('2026-09-10')).toBe('Thu');
    expect(getDayOfWeekAbbr('2026-09-11')).toBe('Fri');
    expect(getDayOfWeekAbbr('2026-09-12')).toBe('Sat');
    expect(getDayOfWeekAbbr('')).toBe('');
    expect(getDayOfWeekAbbr('invalid')).toBe('');
    expect(getDayOfWeekAbbr('2026-99-99')).toBe('');
    expect(getDayOfWeekAbbr(undefined as any)).toBe('');
  });

  it('strictly excludes today from lastSession benchmark while including today in PR trophy', () => {
    const history: (WorkoutSet & { workout_date: string })[] = [
      {
        exercise_id: 'ex-bench',
        set_index: 1,
        set_type: 'working',
        weight: 185,
        reps: 8,
        workout_date: '2026-08-28',
      },
      {
        exercise_id: 'ex-bench',
        set_index: 2,
        set_type: 'working',
        weight: 185,
        reps: 7,
        workout_date: '2026-08-28',
      },
      // Today's set logged 30 seconds ago with PR weight
      {
        exercise_id: 'ex-bench',
        set_index: 1,
        set_type: 'working',
        weight: 195,
        reps: 5,
        workout_date: '2026-09-06',
      },
    ];

    const benchmarks = getExerciseBenchmarks('ex-bench', history, '2026-09-06');

    // lastSession must be strictly previous session (2026-08-28), NOT today!
    expect(benchmarks.lastSession).not.toBeNull();
    expect(benchmarks.lastSession?.date).toBe('2026-08-28');
    expect(benchmarks.lastSession?.summaryText).toBe('185×8, 185×7');

    // PR trophy must immediately recognize today's new personal record (195x5)
    expect(benchmarks.pr).not.toBeNull();
    expect(benchmarks.pr?.weight).toBe(195);
    expect(benchmarks.pr?.reps).toBe(5);
    expect(benchmarks.pr?.date).toBe('2026-09-06');
  });

  it('verifies DEFAULT_WORKOUT_TEMPLATES use 3-letter day codes and define targetReps', () => {
    expect(DEFAULT_WORKOUT_TEMPLATES).toHaveLength(4);

    const pushReduced = DEFAULT_WORKOUT_TEMPLATES.find((t) => t.name === 'Push, Quads, & Core - Reduced');
    expect(pushReduced).toBeDefined();
    expect(pushReduced?.days).toEqual(['Mon', 'Thu']);
    expect(pushReduced?.targetReps).toBeDefined();
    expect(pushReduced?.targetReps?.['Incline Bench Press']).toBe(8);

    const pullReduced = DEFAULT_WORKOUT_TEMPLATES.find((t) => t.name === 'Pull, Hamstring, & Core - Reduced');
    expect(pullReduced).toBeDefined();
    expect(pullReduced?.days).toEqual(['Tue', 'Fri']);
    expect(pullReduced?.targetReps).toBeDefined();
    expect(pullReduced?.targetReps?.['Lat Pull Down']).toBe(10);
  });

  it('resolves previous session matched by exercise name rather than id', () => {
    const history: (WorkoutSet & { workout_date: string; exercise_name?: string })[] = [
      {
        exercise_id: 'legacy-uuid-different',
        exercise_name: 'Barbell Bench Press',
        set_index: 1,
        set_type: 'working',
        weight: 225,
        reps: 5,
        workout_date: '2026-08-20',
      },
      {
        exercise_id: 'legacy-uuid-different',
        exercise_name: 'Barbell Bench Press',
        set_index: 2,
        set_type: 'working',
        weight: 225,
        reps: 5,
        workout_date: '2026-08-20',
      },
    ];

    // Look up by exercise name "Barbell Bench Press" (differing from legacy-uuid-different)
    const ghosts = computeGhostSets('Barbell Bench Press', 2, history, '2026-08-25');
    expect(ghosts).toHaveLength(2);
    expect(ghosts[0].isFromPrevious).toBe(true);
    expect(ghosts[0].weight).toBe(225);
    expect(ghosts[0].reps).toBe(5);
    expect(ghosts[0].hintText).toBe('225 lbs × 5');
  });

  it('correctly resolves prior session when most recent prior session is older than previous day (e.g. 5 days ago)', () => {
    const history: (WorkoutSet & { workout_date: string })[] = [
      {
        exercise_id: 'ex-squat',
        set_index: 1,
        set_type: 'working',
        weight: 315,
        reps: 5,
        workout_date: '2026-08-10', // 15 days ago
      },
      {
        exercise_id: 'ex-squat',
        set_index: 1,
        set_type: 'working',
        weight: 335,
        reps: 3,
        workout_date: '2026-08-20', // 5 days ago (older than yesterday 2026-08-24)
      },
    ];

    // Today is 2026-08-25. Yesterday was 2026-08-24. Most recent prior workout is 2026-08-20 (5 days ago).
    const ghosts = computeGhostSets('ex-squat', 1, history, '2026-08-25');
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].isFromPrevious).toBe(true);
    expect(ghosts[0].weight).toBe(335);
    expect(ghosts[0].reps).toBe(3);
    expect(ghosts[0].hintText).toBe('335 lbs × 3');
  });

  describe('Ghost Sets Fidelity Control (RPC vs 90-Day Path)', () => {
    const workoutDate = '2026-09-16';

    const exercises = [
      { id: 'e56beb0c-f2d7-41e5-9202-783733d8ca1f', name: 'Cable Lateral Raises' },
      { id: 'aab52aa2-ed99-422b-a0ee-1a991988ec89', name: 'Dips' },
      { id: 'c717751b-5701-41da-9f29-b1af341f9579', name: 'Face Pulls' },
      { id: 'f74968ad-a7b0-417a-8925-cefda6cfe57a', name: 'Incline Bench Press' },
      { id: '7238133f-89e9-4695-9e26-d0faee0d3e65', name: 'Inclined Bicep Curl' },
      { id: 'bf138fb5-4612-49cc-a471-93a96229ff09', name: 'Lat Pull Down' },
      { id: 'abc88ce2-91c7-41e1-b7ae-6f8b558e3f15', name: 'Leg Curl' },
      { id: '54c20ffc-4c16-4b96-bea5-3a1d9af3d48f', name: 'Leg Extension Machine' },
      { id: 'da52bef7-5a02-4e94-962a-c1e36852a5a9', name: 'Leg Raise' },
      { id: '4943face-1ed7-48a7-adc2-e8c6e8197677', name: 'Overhead Tricep Cable Pull' },
      { id: '2f143760-241b-4f5d-9941-11f8b3b72b4d', name: 'Seated Cable Row' },
      { id: '33d3fd97-7dea-4ffa-ab13-7dad2e2e716b', name: 'Weighted Sit-Up' },
    ];

    // The 12 sets returned by get_ghost_sets RPC for bench-athlete on 2026-09-16
    const rpcSets: (WorkoutSet & { workout_date: string; exercise_name: string })[] = [
      {
        id: 'd7fd4088-72eb-4817-b0b4-76014048a576',
        workout_id: '10c72db6-ae31-4834-ac0a-129c241d6ec5',
        exercise_id: 'e56beb0c-f2d7-41e5-9202-783733d8ca1f',
        exercise_name: 'Cable Lateral Raises',
        weight: 135,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-09-14',
        created_at: '2026-09-14T09:33:00+00:00',
      },
      {
        id: '6fb78b55-202e-46dd-a7b2-3977e1b57353',
        workout_id: '3df0512b-cf06-417c-a17c-e7c397fc6932',
        exercise_id: 'aab52aa2-ed99-422b-a0ee-1a991988ec89',
        exercise_name: 'Dips',
        weight: 135,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-09-15',
        created_at: '2026-09-15T09:33:00+00:00',
      },
      {
        id: '840e89c7-59d8-45f6-b4f2-4573e3ed8289',
        workout_id: '1984b84e-abc2-4c85-819a-a6a69d156ac3',
        exercise_id: 'c717751b-5701-41da-9f29-b1af341f9579',
        exercise_name: 'Face Pulls',
        weight: 135,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-09-11',
        created_at: '2026-09-11T09:33:00+00:00',
      },
      {
        id: '3e5d24da-4849-420d-b10c-058b8a254c25',
        workout_id: '80a625d1-375b-4300-8a7e-8ba69d4b25ee',
        exercise_id: 'f74968ad-a7b0-417a-8925-cefda6cfe57a',
        exercise_name: 'Incline Bench Press',
        weight: 135,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-09-13',
        created_at: '2026-09-13T09:33:00+00:00',
      },
      {
        id: 'd1dcbb9e-b1dc-4301-a9bb-bfcd80a1b7d8',
        workout_id: '111593cd-679f-4386-8bf6-bcffb8bfb030',
        exercise_id: '7238133f-89e9-4695-9e26-d0faee0d3e65',
        exercise_name: 'Inclined Bicep Curl',
        weight: 135,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-09-09',
        created_at: '2026-09-09T09:33:00+00:00',
      },
      {
        id: '03c6b93e-7f82-4dc6-aa7c-c4e33ade727d',
        workout_id: '642e0ac7-13a5-425d-9a5c-e4e7d9832130',
        exercise_id: 'bf138fb5-4612-49cc-a471-93a96229ff09',
        exercise_name: 'Lat Pull Down',
        weight: 135,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-09-07',
        created_at: '2026-09-07T09:33:00+00:00',
      },
      {
        id: '61d8022f-3061-4872-a13b-5aed129530fc',
        workout_id: '4954fcb3-c46c-4636-8d9b-7b5468a65edc',
        exercise_id: 'abc88ce2-91c7-41e1-b7ae-6f8b558e3f15',
        exercise_name: 'Leg Curl',
        weight: 135,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-09-10',
        created_at: '2026-09-10T09:33:00+00:00',
      },
      {
        id: '9bfdba10-d55c-4db3-8887-e7b435f35cde',
        workout_id: '3df0512b-cf06-417c-a17c-e7c397fc6932',
        exercise_id: '54c20ffc-4c16-4b96-bea5-3a1d9af3d48f',
        exercise_name: 'Leg Extension Machine',
        weight: 135,
        reps: 10,
        set_index: 2,
        set_type: 'working',
        workout_date: '2026-09-15',
        created_at: '2026-09-15T09:36:00+00:00',
      },
      {
        id: '2847b038-f994-475a-9881-561cf5630503',
        workout_id: 'efa31627-89d6-486b-963c-2b0cd5dc73d8',
        exercise_id: 'da52bef7-5a02-4e94-962a-c1e36852a5a9',
        exercise_name: 'Leg Raise',
        weight: 135,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-09-06',
        created_at: '2026-09-06T09:33:00+00:00',
      },
      {
        id: '2ffe4a39-524d-45ae-8b8e-72b442c61cc7',
        workout_id: 'd3e92471-93ee-45f0-9de5-4198275cb263',
        exercise_id: '4943face-1ed7-48a7-adc2-e8c6e8197677',
        exercise_name: 'Overhead Tricep Cable Pull',
        weight: 135,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-09-05',
        created_at: '2026-09-05T09:33:00+00:00',
      },
      {
        id: 'bc061967-d154-4036-8d69-549315469210',
        workout_id: '663ca203-3b9e-4ab9-8c58-0dab4a14023a',
        exercise_id: '2f143760-241b-4f5d-9941-11f8b3b72b4d',
        exercise_name: 'Seated Cable Row',
        weight: 135,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-09-08',
        created_at: '2026-09-08T09:33:00+00:00',
      },
      {
        id: 'da5ce521-8be6-44ea-baaa-8c5b51789bce',
        workout_id: 'f785a803-7622-4a9c-a217-c203a6ccf74d',
        exercise_id: '33d3fd97-7dea-4ffa-ab13-7dad2e2e716b',
        exercise_name: 'Weighted Sit-Up',
        weight: 135,
        reps: 10,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-09-12',
        created_at: '2026-09-12T09:33:00+00:00',
      },
    ];

    // Deterministically reconstructed full 90-day sets from stress seed (workouts 1..49 + workout 50)
    const fullNinetyDaySets: (WorkoutSet & { workout_date: string; exercise_name: string })[] = [];

    // Workouts 1..49: 2 sets per workout
    for (let i = 1; i <= 49; i++) {
      const daysAgo = 50 - i;
      const date = new Date(new Date(workoutDate).getTime() - daysAgo * 86400000).toISOString().split('T')[0];
      for (let s = 1; s <= 2; s++) {
        const exIndex = (s + i) % exercises.length;
        const ex = exercises[exIndex];
        fullNinetyDaySets.push({
          id: `set-stress-${i}-${s}`,
          workout_id: `workout-stress-${i}`,
          exercise_id: ex.id,
          exercise_name: ex.name,
          reps: 10,
          weight: 135,
          set_index: s,
          set_type: 'working',
          workout_date: date,
          created_at: `${date}T09:30:00Z`,
        });
      }
    }

    // Workout 50: Today's workout with 500 sets (which computeGhostSets ignores for past ghosts)
    for (let s = 1; s <= 500; s++) {
      const exIndex = s % exercises.length;
      const ex = exercises[exIndex];
      fullNinetyDaySets.push({
        id: `set-today-500-${s}`,
        workout_id: 'workout-today-50',
        exercise_id: ex.id,
        exercise_name: ex.name,
        reps: 8 + (s % 5),
        weight: 100 + (s % 100),
        set_index: s,
        set_type: 'working',
        workout_date: workoutDate,
        created_at: `${workoutDate}T09:30:00Z`,
      });
    }

    it('verifies 100% exact parity on GhostSetValues[] across all 12 exercises between RPC and 90-day legacy path', () => {
      expect(exercises).toHaveLength(12);

      for (const ex of exercises) {
        const legacyGhostSets = computeGhostSets(ex.id, 3, fullNinetyDaySets, workoutDate);
        const rpcGhostSets = computeGhostSets(ex.id, 3, rpcSets, workoutDate);

        // Verify lengths match
        expect(rpcGhostSets).toHaveLength(3);
        expect(legacyGhostSets).toHaveLength(3);

        // Verify exact parity per set across weight, reps, hintText, and isFromPrevious
        for (let s = 0; s < 3; s++) {
          expect(rpcGhostSets[s].weight).toBe(legacyGhostSets[s].weight);
          expect(rpcGhostSets[s].reps).toBe(legacyGhostSets[s].reps);
          expect(rpcGhostSets[s].hintText).toBe(legacyGhostSets[s].hintText);
          expect(rpcGhostSets[s].isFromPrevious).toBe(legacyGhostSets[s].isFromPrevious);
        }

        // Assert deep equality
        expect(rpcGhostSets).toEqual(legacyGhostSets);
      }
    });

    it('rejects with divergence if weight, reps, hintText, or isFromPrevious differs', () => {
      const ex = exercises[0];
      const legacyGhostSets = computeGhostSets(ex.id, 3, fullNinetyDaySets, workoutDate);

      // Mutate a ghost set to verify test rejection sensitivity
      const mutatedRpcSets = rpcSets.map((s) =>
        s.exercise_id === ex.id ? { ...s, weight: (Number(s.weight) || 0) + 5 } : s
      );
      const mutatedGhosts = computeGhostSets(ex.id, 3, mutatedRpcSets, workoutDate);

      expect(mutatedGhosts).not.toEqual(legacyGhostSets);
    });
  });

  describe('6c: Dynamic Date-Shifted Ghost Sets Fidelity Control', () => {
    it('guarantees all qualifying exercises receive ghost sets under dynamic date-shifted query against prior 500-set workout', async () => {
      const cpMod = 'node:child_process';
      const cp = (await import(/* @vite-ignore */ cpMod)) as any;

      // 1. Resolve fixture data dynamically from the live database:
      // - bench athlete id by email ('bench-athlete@yourbody.fyi')
      // - target date as max(date) + 1 day
      // - exercise id and names dynamically from public.exercises
      // - qualifying truth sessions and expected capped set counts per exercise
      const fixtureQuery = `
        SELECT json_build_object(
          'benchAthleteId', (SELECT id FROM auth.users WHERE email = 'bench-athlete@yourbody.fyi'),
          'targetDate', (SELECT (max((date AT TIME ZONE 'UTC')::date) + 1)::text FROM public.workouts WHERE user_id = (SELECT id FROM auth.users WHERE email = 'bench-athlete@yourbody.fyi')),
          'exercises', (SELECT json_agg(json_build_object('id', id, 'name', name)) FROM (SELECT id, name FROM public.exercises ORDER BY name) e),
          'qualifyingTruth', (
            WITH bench_user AS (
              SELECT id FROM auth.users WHERE email = 'bench-athlete@yourbody.fyi'
            ),
            target AS (
              SELECT (max((date AT TIME ZONE 'UTC')::date) + 1) AS target_date, (SELECT id FROM bench_user) AS user_id
              FROM public.workouts
              WHERE user_id = (SELECT id FROM bench_user)
            ),
            valid_sets AS (
              SELECT
                s.id AS set_id,
                s.exercise_id,
                COALESCE(e.name, s.exercise_id::text) AS exercise_name,
                lower(COALESCE(e.name, s.exercise_id::text)) AS exercise_key,
                s.weight,
                s.reps,
                s.set_index,
                w.id AS workout_id,
                (w.date AT TIME ZONE 'UTC')::date AS workout_date,
                w.created_at AS workout_created_at
              FROM target t
              JOIN public.workouts w ON w.user_id = t.user_id
              JOIN public.sets s ON s.workout_id = w.id
              LEFT JOIN public.exercises e ON e.id = s.exercise_id
              WHERE (w.date AT TIME ZONE 'UTC')::date < t.target_date
                AND (w.date AT TIME ZONE 'UTC')::date >= (t.target_date - interval '90 days')
                AND s.weight IS NOT NULL
                AND s.reps IS NOT NULL
            ),
            ranked_sessions AS (
              SELECT
                vs.*,
                DENSE_RANK() OVER (
                  PARTITION BY vs.exercise_key
                  ORDER BY vs.workout_date DESC, vs.workout_created_at DESC, vs.workout_id DESC
                ) AS session_rank
              FROM valid_sets vs
            )
            SELECT json_agg(json_build_object(
              'exercise_name', exercise_name,
              'exercise_key', exercise_key,
              'truth_sets', truth_sets,
              'expected_capped_sets', LEAST(truth_sets, 20)
            ))
            FROM (
              SELECT exercise_name, exercise_key, COUNT(*) AS truth_sets
              FROM ranked_sessions
              WHERE session_rank = 1
              GROUP BY exercise_name, exercise_key
              ORDER BY exercise_name
            ) q
          )
        );
      `;

      const dbUrl = 'postgresql://postgres:postgres@127.0.0.1:58822/postgres';
      let fixtureJson: string;
      try {
        fixtureJson = cp.execFileSync(
          'psql',
          [dbUrl, '-t', '-A', '-c', fixtureQuery],
          { encoding: 'utf-8' }
        );
      } catch (err: any) {
        throw new Error(`Failed to query test fixture from Postgres: ${err.message || err}`);
      }

      const fixture = JSON.parse(fixtureJson.trim()) as {
        benchAthleteId: string;
        targetDate: string;
        exercises: { id: string; name: string }[];
        qualifyingTruth: {
          exercise_name: string;
          exercise_key: string;
          truth_sets: number;
          expected_capped_sets: number;
        }[];
      };

      if (!fixture.benchAthleteId || !fixture.targetDate || !fixture.exercises?.length || !fixture.qualifyingTruth?.length) {
        throw new Error(
          `Postgres returned incomplete fixture data for dynamic ghost sets test: ${JSON.stringify(fixture)}`
        );
      }

      const { benchAthleteId, targetDate, exercises, qualifyingTruth } = fixture;

      // 2. Query get_ghost_sets RPC from live Postgres database
      const rpcQuery = `SELECT json_agg(t) FROM (SELECT id, workout_id, exercise_id, exercise_name, weight, reps, set_index, set_type, workout_date, workout_name, created_at FROM public.get_ghost_sets('${benchAthleteId}', '${targetDate}'::date)) t;`;
      let rpcSetsJson: string;
      try {
        rpcSetsJson = cp.execFileSync(
          'psql',
          [dbUrl, '-t', '-A', '-c', rpcQuery],
          { encoding: 'utf-8' }
        );
      } catch (err: any) {
        throw new Error(`Failed to execute get_ghost_sets RPC on Postgres: ${err.message || err}`);
      }

      const rpcSets = JSON.parse(rpcSetsJson.trim() || '[]') as (WorkoutSet & { workout_date: string; exercise_name: string })[];

      // Derived expectations based on database ground truth:
      // - Total returned sets must equal sum of expected_capped_sets
      // - Distinct exercises returned must equal qualifyingTruth.length
      // Under old global LIMIT 200 SQL, only 5 exercises received rows, causing distinctExerciseNames.size to fail against qualifyingTruth.length
      const expectedTotalSets = qualifyingTruth.reduce((sum, q) => sum + q.expected_capped_sets, 0);
      const distinctExerciseNames = new Set(rpcSets.map((s) => s.exercise_name));

      expect(distinctExerciseNames.size).toBe(qualifyingTruth.length);
      expect(rpcSets.length).toBe(expectedTotalSets);

      for (const truth of qualifyingTruth) {
        expect(distinctExerciseNames.has(truth.exercise_name)).toBe(true);

        const exerciseSets = rpcSets.filter((s) => s.exercise_name === truth.exercise_name);
        expect(exerciseSets.length).toBe(truth.expected_capped_sets);

        const ex = exercises.find((e) => e.name === truth.exercise_name);
        expect(ex).toBeDefined();
        if (!ex) continue;

        const ghosts = computeGhostSets(ex.id, 3, rpcSets, targetDate);
        expect(ghosts).toHaveLength(3);
        expect(ghosts[0].isFromPrevious).toBe(true);
        expect(ghosts[0].hintText).not.toBe('—');
      }
    });
  });

  describe('mergeBenchmarks & working-sets filters', () => {
    it('mergeBenchmarks updates PR when today logs a new best working set', () => {
      const initialBenchmarks = {
        'ex-uuid-1': {
          lastSession: {
            date: '2026-09-20',
            summaryText: '205×5',
            sets: [{ id: 's1', exercise_id: 'ex-uuid-1', weight: 205, reps: 5 }],
          },
          pr: { weight: 225, reps: 3, date: '2026-09-01' },
        },
      };

      const todaySets = [
        {
          id: 'today-1',
          exercise_id: 'ex-uuid-1',
          weight: 230,
          reps: 1,
          set_type: 'working',
          workout_date: '2026-09-27',
        },
      ];

      const merged = mergeBenchmarks(initialBenchmarks as any, todaySets as any);
      expect(merged['ex-uuid-1'].pr).toEqual({
        weight: 230,
        reps: 1,
        date: '2026-09-27',
      });
      // Last session remains untouched by today's in-progress session
      expect(merged['ex-uuid-1'].lastSession?.date).toBe('2026-09-20');
    });

    it('mergeBenchmarks ignores warm-up and drop sets (acceptance)', () => {
      const initialBenchmarks = {
        'ex-uuid-1': {
          lastSession: null,
          pr: { weight: 200, reps: 5, date: '2026-09-01' },
        },
      };

      // Heavy warmup 240x1 logged today must be ignored
      const todaySets = [
        {
          id: 'today-warmup',
          exercise_id: 'ex-uuid-1',
          weight: 240,
          reps: 1,
          set_type: 'warmup',
          workout_date: '2026-09-27',
        },
      ];

      const merged = mergeBenchmarks(initialBenchmarks as any, todaySets as any);
      expect(merged['ex-uuid-1'].pr).toEqual({
        weight: 200,
        reps: 5,
        date: '2026-09-01',
      });
    });

    it('formats bodyweight (0 lbs) as BW in lastSession summaryText', () => {
      const history = [
        {
          id: 's-bw',
          exercise_id: 'ex-pullup',
          weight: 0,
          reps: 8,
          workout_date: '2026-09-20',
          set_type: 'working',
        },
      ];

      const bm = getExerciseBenchmarks('ex-pullup', history as any, '2026-09-27');
      expect(bm.lastSession?.summaryText).toBe('BW×8');
    });

    it('isolates custom vs master same-named exercises by exercise_id UUID', () => {
      const customExId = '00000000-0000-0000-0000-000000000001';
      const masterExId = '00000000-0000-0000-0000-000000000002';

      const history = [
        {
          id: 's-master',
          exercise_id: masterExId,
          exercise_name: 'Bench Press',
          weight: 315,
          reps: 1,
          workout_date: '2026-09-20',
          set_type: 'working',
        },
        {
          id: 's-custom',
          exercise_id: customExId,
          exercise_name: 'Bench Press',
          weight: 185,
          reps: 5,
          workout_date: '2026-09-21',
          set_type: 'working',
        },
      ];

      const customBm = getExerciseBenchmarks(customExId, history as any, '2026-09-27');
      expect(customBm.pr?.weight).toBe(185);
      expect(customBm.lastSession?.sets[0].exercise_id).toBe(customExId);

      const masterBm = getExerciseBenchmarks(masterExId, history as any, '2026-09-27');
      expect(masterBm.pr?.weight).toBe(315);
      expect(masterBm.lastSession?.sets[0].exercise_id).toBe(masterExId);
    });

    it('getExerciseBenchmarks in e1rm mode ranks by e1rm (90x10 beats 100x3) and computes e1rm', () => {
      const exId = 'ex-bench-e1rm';
      const sets = [
        {
          id: 's1',
          exercise_id: exId,
          weight: 100,
          reps: 3,
          set_type: 'working' as const,
          workout_date: '2026-03-01',
        },
        {
          id: 's2',
          exercise_id: exId,
          weight: 90,
          reps: 10,
          set_type: 'working' as const,
          workout_date: '2026-03-02',
        },
      ];

      const bmWeight = getExerciseBenchmarks(exId, sets as any, '2026-03-05', 'lb', 'weight');
      expect(bmWeight.pr?.weight).toBe(100);
      expect(bmWeight.pr?.reps).toBe(3);

      const bmE1rm = getExerciseBenchmarks(exId, sets as any, '2026-03-05', 'lb', 'e1rm');
      expect(bmE1rm.pr?.weight).toBe(90);
      expect(bmE1rm.pr?.reps).toBe(10);
      expect((bmE1rm.pr as any)?.e1rm).toBe(120);
    });

    it('mergeBenchmarks in e1rm mode updates PR when higher e1rm set is logged', () => {
      const exId = 'ex-merge-e1rm';
      const initialBenchmarks: Record<string, any> = {
        [exId]: {
          lastSession: null,
          pr: { weight: 100, reps: 3, date: '2026-03-01' },
        },
      };

      const todaySets = [
        {
          id: 's-today',
          exercise_id: exId,
          weight: 90,
          reps: 10,
          set_type: 'working' as const,
          workout_date: '2026-03-02',
        },
      ];

      // In weight mode: 90x10 does NOT beat 100x3
      const mergedWeight = mergeBenchmarks(initialBenchmarks, todaySets as any, 'weight');
      expect(mergedWeight[exId].pr?.weight).toBe(100);

      // In e1rm mode: 90x10 beats 100x3
      const mergedE1rm = mergeBenchmarks(initialBenchmarks, todaySets as any, 'e1rm');
      expect(mergedE1rm[exId].pr?.weight).toBe(90);
      expect(mergedE1rm[exId].pr?.reps).toBe(10);
      expect((mergedE1rm[exId].pr as any)?.e1rm).toBe(120);
    });

    it('formats ghost hint in active unit (102.1 kg × 5) and benchmark summary in kg', () => {
      const history = [
        {
          id: 's-1',
          exercise_id: 'ex-bench',
          weight: 225,
          reps: 5,
          workout_date: '2026-09-20',
          set_type: 'working',
        },
      ];

      const ghosts = computeGhostSets('ex-bench', 1, history as any, '2026-09-27', 'kg');
      expect(ghosts[0].hintText).toBe('102.1 kg × 5');

      const bm = getExerciseBenchmarks('ex-bench', history as any, '2026-09-27', 'kg');
      expect(bm.lastSession?.summaryText).toBe('102.1×5');
    });
  });
});

