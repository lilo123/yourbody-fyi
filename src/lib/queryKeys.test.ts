/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { queryKeys, QUERY_KEY_ROOTS } from './queryKeys';
import type { QueryKeyRoot } from './queryKeys';

describe('React Query Key Registry (src/lib/queryKeys.ts)', () => {
  describe('Deep equality against existing call site literals', () => {
    // athlete_profile
    it('matches athlete_profile call sites (src/components/coach/CoachCockpit.tsx:32, 302)', () => {
      const selectedAthleteId = 'ath-123';
      // src/components/coach/CoachCockpit.tsx:32
      // src/components/coach/CoachCockpit.tsx:302
      expect(queryKeys.athleteProfile.byId(selectedAthleteId)).toEqual([
        'athlete_profile',
        'ath-123',
      ]);
      expect(queryKeys.athleteProfile.all).toEqual(['athlete_profile']);
    });

    // coach_templates
    it('matches coach_templates call site (src/components/coach/CoachCockpit.tsx:356)', () => {
      // src/components/coach/CoachCockpit.tsx:356
      expect(queryKeys.coachTemplates.all).toEqual(['coach_templates']);
    });

    // coach_athletes
    it('matches coach_athletes call site (src/components/coach/CoachCockpit.tsx:406)', () => {
      // src/components/coach/CoachCockpit.tsx:406
      expect(queryKeys.coachAthletes.all).toEqual(['coach_athletes']);
    });

    // coach_athlete_timeline_workouts
    it('matches coach_athlete_timeline_workouts call site (src/components/coach/CoachCockpit.tsx:123)', () => {
      const selectedAthleteId = 'ath-1';
      const daysRange = 30;
      const athleteTimeZone = 'America/New_York';
      // src/components/coach/CoachCockpit.tsx:123
      expect(
        queryKeys.coachAthleteTimelineWorkouts.byAthlete(
          selectedAthleteId,
          daysRange,
          athleteTimeZone
        )
      ).toEqual(['coach_athlete_timeline_workouts', 'ath-1', 30, 'America/New_York']);
    });

    // coach_athlete_timeline_nutrition
    it('matches coach_athlete_timeline_nutrition call site (src/components/coach/CoachCockpit.tsx:223)', () => {
      const selectedAthleteId = 'ath-1';
      const daysRange = 14;
      const athleteTimeZone = 'Asia/Tokyo';
      // src/components/coach/CoachCockpit.tsx:223
      expect(
        queryKeys.coachAthleteTimelineNutrition.byAthlete(
          selectedAthleteId,
          daysRange,
          athleteTimeZone
        )
      ).toEqual(['coach_athlete_timeline_nutrition', 'ath-1', 14, 'Asia/Tokyo']);
    });

    // coach_active_athletes_count
    it('matches coach_active_athletes_count call site (src/components/settings/CoachSettingsCard.tsx:29)', () => {
      const profile = { id: 'prof-1' };
      // src/components/settings/CoachSettingsCard.tsx:29
      expect(queryKeys.coachActiveAthletesCount.byProfile(profile?.id)).toEqual([
        'coach_active_athletes_count',
        'prof-1',
      ]);
    });

    // coach_athlete_links_for_export
    it('matches coach_athlete_links_for_export call site (src/components/settings/DataExportCard.tsx:56)', () => {
      const profile = { id: 'prof-2' };
      // src/components/settings/DataExportCard.tsx:56
      expect(queryKeys.coachAthleteLinksForExport.byProfile(profile?.id)).toEqual([
        'coach_athlete_links_for_export',
        'prof-2',
      ]);
    });

    // my_coach_link
    it('matches my_coach_link call sites (src/components/settings/MyCoachCard.tsx:27, 67, 92)', () => {
      const profile = { id: 'prof-3' };
      // src/components/settings/MyCoachCard.tsx:27
      expect(queryKeys.myCoachLink.byProfile(profile?.id)).toEqual(['my_coach_link', 'prof-3']);
      // src/components/settings/MyCoachCard.tsx:67, 92
      expect(queryKeys.myCoachLink.all).toEqual(['my_coach_link']);
    });

    // exercises
    it('matches exercises call sites (src/components/exercises/EditExerciseModal.tsx:103, ExercisesView.tsx:64, 150, 174, 522, CoachCockpit.tsx:80, useHistoryData.ts:170, useWorkoutQueries.ts:99)', () => {
      const user = { id: 'user-lib-1' };
      // src/components/exercises/EditExerciseModal.tsx:103
      // src/components/exercises/ExercisesView.tsx:150, 174, 522
      // src/components/history/useHistoryData.ts:170
      expect(queryKeys.exercises.all).toEqual(['exercises']);
      // src/components/coach/CoachCockpit.tsx:80
      expect(queryKeys.exercises.coach()).toEqual(['exercises', 'coach']);
      // src/components/exercises/ExercisesView.tsx:64
      expect(queryKeys.exercises.library(user?.id)).toEqual(['exercises', 'library', 'user-lib-1']);
      // src/components/workout/useWorkoutQueries.ts:99
      expect(queryKeys.exercises.workout()).toEqual(['exercises', 'workout']);
    });

    // routine_templates
    it('matches routine_templates call sites (src/components/exercises/EditExerciseModal.tsx:104, ExercisesView.tsx:88, 185, 538, CoachCockpit.tsx:100, 357, RoutinePickerModal.tsx:37, useWorkoutQueries.ts:122, MyCoachCard.tsx:68, 93)', () => {
      const user = { id: 'user-coach-1' };
      const targetUserId = 'target-u-1';
      // src/components/coach/CoachCockpit.tsx:357
      // src/components/exercises/EditExerciseModal.tsx:104
      // src/components/exercises/ExercisesView.tsx:185, 538
      // src/components/settings/MyCoachCard.tsx:68, 93
      expect(queryKeys.routineTemplates.all).toEqual(['routine_templates']);
      // src/components/coach/CoachCockpit.tsx:100
      expect(queryKeys.routineTemplates.coach(user?.id)).toEqual([
        'routine_templates',
        'user-coach-1',
        'coach',
      ]);
      // src/components/exercises/ExercisesView.tsx:88
      expect(queryKeys.routineTemplates.exercises(targetUserId)).toEqual([
        'routine_templates',
        'target-u-1',
        'exercises',
      ]);
      // src/components/workout/RoutinePickerModal.tsx:37
      expect(queryKeys.routineTemplates.picker(targetUserId)).toEqual([
        'routine_templates',
        'target-u-1',
        'picker',
      ]);
      // src/components/workout/useWorkoutQueries.ts:122
      expect(queryKeys.routineTemplates.workout(targetUserId)).toEqual([
        'routine_templates',
        'target-u-1',
        'workout',
      ]);
    });

    // routine_template_detail
    it('matches routine_template_detail call site (src/components/workout/useWorkoutQueries.ts:335)', () => {
      const resolvedTemplateId = 'tmpl-456';
      // src/components/workout/useWorkoutQueries.ts:335
      expect(queryKeys.routineTemplateDetail.byId(resolvedTemplateId)).toEqual([
        'routine_template_detail',
        'tmpl-456',
      ]);
    });

    // workout_sets
    it('matches workout_sets call sites (src/components/exercises/EditExerciseModal.tsx:105, EditSetSheet.tsx:77, 82, 106, 111, useWorkoutMutations.ts:105, 170, 187, useWorkoutQueries.ts:158, useWorkoutHistory.ts:45)', () => {
      const targetUserId = 'target-user-wo';
      // src/components/exercises/EditExerciseModal.tsx:105
      // src/components/sets/EditSetSheet.tsx:77, 106
      expect(queryKeys.workoutSets.all).toEqual(['workout_sets']);
      // src/components/sets/EditSetSheet.tsx:82, 111
      // src/components/workout/useWorkoutMutations.ts:105, 170, 187
      expect(queryKeys.workoutSets.byUser(targetUserId)).toEqual([
        'workout_sets',
        'target-user-wo',
      ]);
      // src/components/workout/useWorkoutQueries.ts:158
      expect(queryKeys.workoutSets.recent90d(targetUserId)).toEqual([
        'workout_sets',
        'target-user-wo',
        '90d',
      ]);
      // legacy all
      expect(queryKeys.workoutSets.allForUser(targetUserId)).toEqual([
        'workout_sets',
        'target-user-wo',
        'all',
      ]);
      // src/components/history/useWorkoutHistory.ts (history_v2)
      expect(queryKeys.workoutSets.historyV2(targetUserId, '30d', '2026-08-28')).toEqual([
        'workout_sets',
        'target-user-wo',
        'history_v2',
        '30d',
        '2026-08-28',
      ]);
      expect(queryKeys.workoutSets.historyV2(targetUserId, 'all')).toEqual([
        'workout_sets',
        'target-user-wo',
        'history_v2',
        'all',
        null,
      ]);
    });

    // workouts
    it('matches workouts call sites (src/components/settings/MyCoachCard.tsx:69, 94)', () => {
      // src/components/settings/MyCoachCard.tsx:69, 94
      expect(queryKeys.workouts.all).toEqual(['workouts']);
    });

    // history_sessions
    it('matches history_sessions call sites (src/components/sets/EditSetSheet.tsx:78, 83, 107, 112)', () => {
      const targetUserId = 'hist-user-1';
      // src/components/sets/EditSetSheet.tsx:78, 107
      expect(queryKeys.historySessions.all).toEqual(['history_sessions']);
      // src/components/sets/EditSetSheet.tsx:83, 112
      expect(queryKeys.historySessions.byUser(targetUserId)).toEqual([
        'history_sessions',
        'hist-user-1',
      ]);
    });

    // session_sets
    it('matches session_sets call sites (src/components/sets/EditSetSheet.tsx:80, 109, HistoryView.tsx:107)', () => {
      const sessionId = 'sess-789';
      // src/components/sets/EditSetSheet.tsx:80, 109
      expect(queryKeys.sessionSets.all).toEqual(['session_sets']);
      // src/components/history/HistoryView.tsx:107
      expect(queryKeys.sessionSets.bySession(sessionId)).toEqual(['session_sets', 'sess-789']);
    });

    // exercise_stats
    it('matches exercise_stats call sites (src/components/sets/EditSetSheet.tsx:79, 84, 108, 113, useWorkoutHistory.ts:80)', () => {
      const targetUserId = 'stat-user-1';
      // src/components/sets/EditSetSheet.tsx:79, 108
      expect(queryKeys.exerciseStats.all).toEqual(['exercise_stats']);
      // src/components/sets/EditSetSheet.tsx:84, 113
      // src/components/history/useWorkoutHistory.ts
      expect(queryKeys.exerciseStats.byUser(targetUserId)).toEqual([
        'exercise_stats',
        'stat-user-1',
      ]);
    });

    // custom_dishes
    it('matches custom_dishes call sites (src/components/nutrition/useNutritionData.ts:91, 333, 350, useCustomDishActions.ts:133, useCustomDishSaving.ts:45, 71)', () => {
      const targetUserId = 'nutri-user-1';
      // src/components/nutrition/useNutritionData.ts:91, 333, 350
      // src/components/nutrition/useCustomDishActions.ts:133
      // src/components/nutrition/useCustomDishSaving.ts:45, 71
      expect(queryKeys.customDishes.byUser(targetUserId)).toEqual([
        'custom_dishes',
        'nutri-user-1',
      ]);
    });

    // nutrition_logs
    it('matches nutrition_logs call sites (src/components/history/useHistoryData.ts:234, 261, 317, useMealEditor.ts:392, 394, 448, 450, useNutritionData.ts:116, 223, 242, 296, MyCoachCard.tsx:70, 95)', () => {
      const targetUserId = 'nutri-user-2';
      const selectedDate = '2026-09-26';
      const timeZone = 'America/Los_Angeles';

      // src/components/nutrition/useMealEditor.ts:392, 448
      // src/components/settings/MyCoachCard.tsx:70, 95
      expect(queryKeys.nutritionLogs.all).toEqual(['nutrition_logs']);

      // src/components/history/useHistoryData.ts:234, 261, 317
      // src/components/nutrition/useMealEditor.ts:394, 450
      // src/components/nutrition/useNutritionData.ts:223, 242, 296
      expect(queryKeys.nutritionLogs.byUser(targetUserId)).toEqual([
        'nutrition_logs',
        'nutri-user-2',
      ]);

      // src/components/nutrition/useNutritionData.ts:116
      const callSiteLiteral = ['nutrition_logs', targetUserId, selectedDate, timeZone].filter(
        Boolean
      );
      expect(queryKeys.nutritionLogs.byDate(targetUserId, selectedDate, timeZone)).toEqual(
        callSiteLiteral
      );
    });
  });

  describe('Planned query keys for upcoming phases', () => {
    it('provides planned keys for P2, P4, P5a, P6', () => {
      expect(queryKeys.exerciseCatalog.all).toEqual(['exercise_catalog']);
      expect(
        queryKeys.exerciseCatalog.list({ search: 'bench', equipment: 'Barbell' })
      ).toEqual(['exercise_catalog', { search: 'bench', equipment: 'Barbell' }]);

      expect(queryKeys.routineCatalog.all).toEqual(['routine_catalog']);
      expect(queryKeys.routineCatalog.list({ search: 'push' })).toEqual([
        'routine_catalog',
        { search: 'push' },
      ]);

      expect(queryKeys.exerciseBenchmarks.all).toEqual(['exercise_benchmarks']);
      expect(
        queryKeys.exerciseBenchmarks.byUserAndDate('u-1', '2026-09-26', ['ex-1'])
      ).toEqual(['exercise_benchmarks', 'u-1', '2026-09-26', ['ex-1']]);

      expect(queryKeys.exerciseStatsV2.all).toEqual(['exercise_stats_v2']);
      expect(queryKeys.exerciseStatsV2.byUser('u-1')).toEqual(['exercise_stats_v2', 'u-1']);

      expect(queryKeys.historySessionsV2.all).toEqual(['history_sessions_v2']);
      expect(queryKeys.historySessionsV2.infinite('u-1', '2026-08-01')).toEqual([
        'history_sessions_v2',
        'u-1',
        '2026-08-01',
      ]);

      expect(queryKeys.exerciseHistory.all).toEqual(['exercise_history']);
      expect(queryKeys.exerciseHistory.byExercise('u-1', 'ex-1')).toEqual([
        'exercise_history',
        'u-1',
        'ex-1',
        undefined,
      ]);

      expect(queryKeys.userWeightUnit.all).toEqual(['user_weight_unit']);
      expect(queryKeys.userWeightUnit.byUser('u-1')).toEqual(['user_weight_unit', 'u-1']);

      expect(queryKeys.exerciseHides.all).toEqual(['exercise_hides']);
      expect(queryKeys.exerciseHides.byUser('u-1')).toEqual(['exercise_hides', 'u-1']);
    });
  });

  describe('Drift guard: scans src/**/*.ts(x) for queryKey: [ literals', () => {
    function getSourceFiles(dir: string): string[] {
      const results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name !== 'node_modules' &&
            entry.name !== '.git' &&
            entry.name !== 'dist' &&
            entry.name !== 'test'
          ) {
            results.push(...getSourceFiles(fullPath));
          }
        } else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          !entry.name.includes('.test.') &&
          !entry.name.includes('.spec.')
        ) {
          results.push(fullPath);
        }
      }
      return results;
    }

    it('ensures every queryKey array literal first element is registered in QUERY_KEY_ROOTS', () => {
      const srcDir = path.resolve(process.cwd(), 'src');
      const files = getSourceFiles(srcDir);
      const queryKeyRegex = /queryKey:\s*\[\s*['"`]([a-zA-Z0-9_-]+)['"`]/g;
      const discoveredKeys: { file: string; root: string; line: number }[] = [];

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let match: RegExpExecArray | null;
          queryKeyRegex.lastIndex = 0;
          while ((match = queryKeyRegex.exec(line)) !== null) {
            discoveredKeys.push({
              file: path.relative(srcDir, file),
              root: match[1],
              line: i + 1,
            });
          }
        }
      }

      expect(discoveredKeys.length).toBeGreaterThan(0);

      const unregistered: typeof discoveredKeys = [];
      for (const item of discoveredKeys) {
        if (!QUERY_KEY_ROOTS.includes(item.root as QueryKeyRoot)) {
          unregistered.push(item);
        }
      }

      if (unregistered.length > 0) {
        const details = unregistered
          .map((u) => `${u.file}:${u.line} uses unregistered key root "${u.root}"`)
          .join('\n');
        throw new Error(
          `Drift guard failed! Found unregistered queryKey roots:\n${details}`
        );
      }

      expect(unregistered).toHaveLength(0);
    });
  });
});
