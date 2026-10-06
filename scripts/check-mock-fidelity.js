#!/usr/bin/env node

/**
 * Yourbody V2 — Supabase Mock Fidelity Checker
 *
 * Enforces per-query database contract fidelity across all test doubles mocking `supabase.from`:
 * 1. Measures mock fidelity at the QUERY level (distinct (table, projection) pairs serviced).
 * 2. Requires exact projection assertions for every read query.
 * 3. Requires table assertion + NO_PROJECTION_APPLIES tag for mutation-only / non-query mocks.
 * 4. Distinctly labels bare .select() post-mutation row returns as WILDCARD_MUTATION_RETURN.
 * 5. Requires 100% asserted queries globally to exit 0.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(rootDir, 'src');

// Registry of serviced queries per test file mocking supabase.from
const SERVICED_QUERIES_REGISTRY = {
  'src/hooks/useFeatureFlag.test.tsx': [
    {
      table: 'app_config',
      type: 'EXACT',
      projection: 'key,value',
      description: 'App configuration feature flags query',
    },
  ],
  'src/App.test.tsx': [
    {
      table: 'users',
      type: 'EXACT',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
      description: 'Profile hydration query',
    },
  ],
  'src/components/auth/LoginView.test.tsx': [
    {
      table: 'users',
      type: 'NO_PROJECTION_APPLIES',
      description: 'Auth UI & form validation only; no database select queries issued',
    },
  ],
  'src/components/auth/ResetPasswordView.test.tsx': [
    {
      table: 'users',
      type: 'NO_PROJECTION_APPLIES',
      description: 'Auth updateUser only; no database select queries issued',
    },
  ],
  'src/components/coach/CoachCockpit.test.tsx': [
    {
      table: 'coach_athlete_links',
      type: 'EXACT',
      projection: 'athlete_id, status, linked_at, athlete:users!athlete_id(id, username, email, role, created_at, timezone)',
      description: 'Coach athlete links query',
    },
    {
      table: 'exercises',
      type: 'EXACT',
      projection: 'id, name, body_parts, is_master',
      description: 'Exercise library lookup query',
    },
    {
      table: 'workouts',
      type: 'EXACT',
      projection: 'id, date, name, sets(id, reps, weight, set_index, created_at, exercise_id)',
      projectionVar: 'WORKOUT_WITH_SETS_PROJECTION',
      description: 'Athlete workout logs query',
    },
    {
      table: 'routine_templates',
      type: 'EXACT',
      projection: 'id, user_id, name, is_master, assigned_to, days_of_week, created_at, exercises:template_exercises(id, template_id, exercise_id, order_index, target_sets, target_reps)',
      description: 'Assigned athlete routines query',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, user_id, food_name, calories, protein, carbs, fat, fiber, logged_at, logged_date',
      description: 'Athlete nutrition logs query',
    },
    {
      table: 'sets',
      type: 'EXACT',
      projection: 'id, workout_id, reps, weight, set_index, exercise_id, exercise:exercises(id, name, body_parts)',
      description: 'Athlete workout sets query',
    },
    {
      table: 'users',
      type: 'EXACT',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
      description: 'Coach user profile query',
    },
    {
      table: 'users',
      type: 'EXACT',
      projection: 'target_calories, target_protein, target_carbs, target_fat, target_fiber',
      description: 'Selected athlete macro targets query',
    },
  ],
  'src/components/common/Header.test.tsx': [
    {
      table: 'users',
      type: 'EXACT',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
      description: 'User profile header badge query',
    },
    {
      table: 'coach_athlete_links',
      type: 'EXACT',
      projection: 'athlete_id, status, linked_at, athlete:users!athlete_id(id, username, email, role, created_at, timezone)',
      description: 'Coach badge athlete links query',
    },
  ],
  'src/components/exercises/ExercisesView.test.tsx': [
    {
      table: 'exercises',
      type: 'EXACT',
      projection: 'id, name, body_parts, is_master, is_archived, user_id, created_at',
      description: 'Exercise library master & custom query',
    },
    {
      table: 'routine_templates',
      type: 'EXACT',
      projection: '*, exercises:template_exercises(*, exercise:exercises(*))',
      description: 'Routine template on-demand fetch on sheet open',
    },
    {
      table: 'users',
      type: 'EXACT',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
      description: 'Profile permissions query',
    },
    {
      table: 'template_exercises',
      type: 'NO_PROJECTION_APPLIES',
      description: 'Mutation-only insert for template creation',
    },
  ],
  'src/components/history/HistoryCalendarSheet.test.tsx': [
    {
      table: 'workouts',
      type: 'EXACT',
      projection: 'workout_date',
      description: 'Calendar month workout dates query',
    },
  ],
  'src/components/history/HistoryView.filters.test.tsx': [
    {
      table: 'exercises',
      type: 'EXACT',
      projection: 'id, name, body_parts, is_master',
      description: 'Exercise lookup query',
    },
    {
      table: 'sets',
      type: 'EXACT',
      projection: 'id, workout_id, exercise_id, weight, reps, set_index, created_at, rpe, set_type',
      description: 'On-demand session sets detail query',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
      description: 'Nutrition history query',
    },
    {
      table: 'users',
      type: 'EXACT',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
      description: 'User profile query',
    },
  ],
  'src/components/history/HistoryView.test.tsx': [
    {
      table: 'exercises',
      type: 'EXACT',
      projection: 'id, name, body_parts, is_master',
      description: 'Exercise lookup query',
    },
    {
      table: 'sets',
      type: 'EXACT',
      projection: 'id, workout_id, exercise_id, weight, reps, set_index, created_at, workouts(date, name), exercise:exercises(id, name, body_part)',
      description: 'Historic sets query',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
      description: 'Nutrition history query',
    },
    {
      table: 'users',
      type: 'EXACT',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
      description: 'User profile query',
    },
    {
      table: 'coach_athlete_links',
      type: 'EXACT',
      projection: 'athlete_id, status, linked_at, athlete:users!athlete_id(id, username, email, role, created_at, timezone)',
      description: 'Coach inspection mode athlete links query',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, items, calories, protein, carbs, fat, fiber',
      description: 'On-demand meal log items and macros query for rescale (useHistoryData.ts:222-226)',
    },
    {
      table: 'sets',
      type: 'EXACT',
      projection: 'id, workout_id, exercise_id, weight, reps, set_index, created_at',
      description: 'On-demand session sets detail query on expand (useHistoryData.ts)',
    },
  ],
  'src/components/nutrition/EditMealModal.test.tsx': [
    {
      table: 'nutrition_logs',
      type: 'WILDCARD_MUTATION_RETURN',
      description: 'Bare .select() post-mutation row return (useNutritionData.ts:198)',
    },
  ],
  'src/components/nutrition/MealLogRow.test.tsx': [
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, items',
      description: 'On-demand meal log items fetch on expand (MealLogRow.tsx:168)',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, items',
      description: 'On-demand meal log items fetch on rescale (MealLogRow.tsx:247)',
    },
  ],
  'src/components/nutrition/useNutritionData.test.tsx': [
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
      description: 'Daily nutrition logs query',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, items, calories, protein, carbs, fat, fiber',
      description: 'On-demand meal log items and macros query for rescale (useNutritionData.ts)',
    },
  ],
  'src/components/NutritionEngine.test.tsx': [
    {
      table: 'custom_dishes',
      type: 'EXACT',
      projection: 'id, user_id, name, calories, protein, carbs, fat, fiber, created_at',
      description: 'Favorite dishes query',
    },
    {
      table: 'custom_dishes',
      type: 'EXACT',
      projection: 'id, items, ingredients',
      description: 'On-demand custom dish detail fetch on stage or edit',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
      description: 'Nutrition logs query',
    },
  ],
  'src/components/settings/SettingsView.test.tsx': [
    {
      table: 'users',
      type: 'EXACT',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
      description: 'Settings profile & macro goals query',
    },
  ],
  'src/components/workout/EditSetModal.test.tsx': [
    {
      table: 'sets',
      type: 'WILDCARD_MUTATION_RETURN',
      description: 'Bare .select() post-mutation row return (useWorkoutMutations.ts:98)',
    },
  ],
  'src/components/workout/WorkoutEngine.profiler.test.tsx': [
    {
      table: 'exercises',
      type: 'EXACT',
      projection: 'id, name, body_parts, is_master',
      description: 'Exercise lookup query',
    },
    {
      table: 'users',
      type: 'EXACT',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
      description: 'User profile query',
    },
    {
      table: 'workouts',
      type: 'EXACT',
      projection: 'id',
      description: 'Workout ID lookup query',
    },
  ],
  'src/components/workout/WorkoutEngine.test.tsx': [
    {
      table: 'exercises',
      type: 'EXACT',
      projection: 'id, name, body_parts, is_master',
      description: 'Exercise library lookup query',
    },
    {
      table: 'routine_templates',
      type: 'EXACT',
      projection: 'id, user_id, name, is_master, assigned_to, days_of_week, created_at',
      description: 'Assigned routine templates list query',
    },
    {
      table: 'routine_templates',
      type: 'EXACT',
      projection: 'id, exercises:template_exercises(id, template_id, exercise_id, order_index, target_sets, target_reps, exercise:exercises(name))',
      description: 'Assigned routine templates detail query',
    },
    {
      table: 'workouts',
      type: 'EXACT',
      projection: 'id, date, name, sets(id, reps, weight, set_index, created_at, exercise_id)',
      projectionVar: 'WORKOUT_WITH_SETS_PROJECTION',
      description: 'Current session workouts query',
    },
    {
      table: 'sets',
      type: 'NO_PROJECTION_APPLIES',
      description: 'Ghost set commit mutation; no select projection',
    },
  ],
  'src/context/AuthContext.test.tsx': [
    {
      table: 'users',
      type: 'EXACT',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
      description: 'Auth profile fetch query',
    },
  ],
  'src/context/AuthDeduplication.test.tsx': [
    {
      table: 'users',
      type: 'EXACT',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
      description: 'Deduplicated profile fetch query',
    },
    {
      table: 'coach_athlete_links',
      type: 'EXACT',
      projection: 'athlete_id, status, linked_at, athlete:users!athlete_id(id, username, email, role, created_at, timezone)',
      description: 'Deduplicated coach athlete links query',
    },
  ],
  'src/components/settings/DataExportCard.test.tsx': [
    {
      table: 'coach_athlete_links',
      type: 'EXACT',
      projection: 'athlete_id, status, linked_at, athlete:users!athlete_id(id, username, email, role, created_at, timezone)',
      description: 'Lazy query for active linked athletes in coach mode',
    },
  ],
  'src/utils/dataExport.test.ts': [
    {
      table: 'workouts',
      type: 'EXACT',
      projection: 'id, date, name, sets(id, reps, weight, set_index, rpe, created_at, exercise:exercises(name, body_parts))',
      projectionVar: 'WORKOUT_EXPORT_PROJECTION',
      description: 'Export workouts page fetch query',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, user_id, food_name, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, created_at, notes, items',
      projectionVar: 'NUTRITION_EXPORT_PROJECTION',
      description: 'Export nutrition logs page fetch query',
    },
    {
      table: 'custom_dishes',
      type: 'EXACT',
      projection: 'id, user_id, name, kind, use_count, calories, protein, carbs, fat, fiber, notes, created_at, items',
      projectionVar: 'CUSTOM_DISH_EXPORT_PROJECTION',
      description: 'Export custom dishes page fetch query',
    },
    {
      table: 'routine_templates',
      type: 'EXACT',
      projection: 'id, user_id, name, days_of_week, is_master, assigned_to, template_exercises(order_index, target_sets, target_reps, exercise:exercises(name, body_parts))',
      projectionVar: 'ROUTINE_EXPORT_PROJECTION',
      description: 'Export routine templates page fetch query',
    },
    {
      table: 'users',
      type: 'EXACT',
      projection: 'id, username, email, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, timezone, weight_unit',
      description: 'Export user profile fetch query',
    },
  ],
  'src/components/workout/RoutinePickerModal.test.tsx': [
    {
      table: 'routine_templates',
      type: 'EXACT',
      projection: 'id, user_id, name, is_master, assigned_to, days_of_week, created_at, exercises:template_exercises(id, template_id, exercise_id, order_index, target_sets, target_reps, exercise:exercises(name))',
      description: 'Routine templates picker query',
    },
  ],
  'src/components/exercises/EditExerciseSheet.test.tsx': [
    {
      table: 'exercises',
      type: 'NO_PROJECTION_APPLIES',
      description: 'Mutation-only exercise update',
    },
  ],
  'src/components/exercises/EditTemplateSheet.test.tsx': [
    {
      table: 'routine_templates',
      type: 'EXACT',
      projection: '*, exercises:template_exercises(*, exercise:exercises(*))',
      description: 'Fetch fresh routine template details with exercises on open',
    },
    {
      table: 'routine_templates',
      type: 'WILDCARD_MUTATION_RETURN',
      description: 'Bare .select() post-insert row return',
    },
    {
      table: 'template_exercises',
      type: 'NO_PROJECTION_APPLIES',
      description: 'Mutation-only template exercise updates',
    },
  ],
  'src/components/exercises/ExerciseListTab.test.tsx': [
    {
      table: 'exercises',
      type: 'WILDCARD_MUTATION_RETURN',
      description: 'Bare .select() post-mutation row return on exercise archive or restore',
    },
    {
      table: 'exercise_hides',
      type: 'NO_PROJECTION_APPLIES',
      description: 'Mutation-only insert and delete on exercise hides',
    },
  ],
  'src/components/exercises/TemplateListTab.test.tsx': [
    {
      table: 'routine_templates',
      type: 'WILDCARD_MUTATION_RETURN',
      description: 'Bare .select() post-delete row return on routine template deletion',
    },
  ],
  'src/components/settings/CoachSettingsCard.test.tsx': [
    {
      table: 'coach_athlete_links',
      type: 'EXACT',
      projection: 'id',
      description: 'Coach active athlete count query',
    },
  ],
  'src/components/settings/MyCoachCard.test.tsx': [
    {
      table: 'coach_athlete_links',
      type: 'EXACT',
      projection: 'id, coach_id, linked_at, coach:users!coach_id(username, email, coach_code)',
      description: 'Athlete active coach link query',
    },
  ],
  'src/components/nutrition/dishNotesSnapshot.test.tsx': [
    {
      table: 'custom_dishes',
      type: 'EXACT',
      projection: 'id, user_id, name, calories, protein, carbs, fat, fiber, created_at, kind, use_count, notes',
      description: 'Custom dishes list query with notes',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
      description: 'Daily nutrition logs query',
    },
  ],
  'src/components/history/rescaleMealRevert.test.tsx': [
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
      description: 'Daily nutrition logs list query',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, items, calories, protein, carbs, fat, fiber',
      description: 'On-demand meal log items and macros query for rescale',
    },
  ],
  'src/components/nutrition/rescaleMealRevert.test.tsx': [
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
      description: 'Daily nutrition logs list query',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, items, calories, protein, carbs, fat, fiber',
      description: 'On-demand meal log items and macros query for rescale',
    },
  ],
  'src/components/history/useHistoryMealDeferredDelete.test.ts': [
    {
      table: 'nutrition_logs',
      type: 'NO_PROJECTION_APPLIES',
      description: 'Meal deferred delete mutation only; no database select queries issued',
    },
  ],
  'src/components/history/useHistoryDataWindow.test.ts': [
    {
      table: 'exercises',
      type: 'EXACT',
      projection: 'id, name, body_parts, is_master',
      description: 'Exercise lookup query',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
      description: 'Nutrition logs 14-day window query',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'logged_date',
      description: 'Older nutrition log probe query',
    },
  ],
  'src/components/nutrition/reviewCaptureTime.test.tsx': [
    {
      table: 'custom_dishes',
      type: 'EXACT',
      projection: 'id, user_id, name, calories, protein, carbs, fat, fiber, created_at, kind, use_count, notes',
      description: 'Custom dishes list query with notes',
    },
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
      description: 'Daily nutrition logs query',
    },
  ],
  'src/offline-prefetch/useOfflinePrefetch.test.ts': [
    {
      table: 'custom_dishes',
      type: 'EXACT',
      projection: 'id, user_id, name, calories, protein, carbs, fat, fiber, created_at, kind, use_count, notes, items, ingredients',
      description: 'Prefetch custom dishes query for offline caching',
    },
  ],
  'src/offline/__tests__/replay.test.ts': [
    {
      table: 'nutrition_logs',
      type: 'EXACT',
      projection: 'id',
      description: 'Nutrition log replay upsert row confirmation query',
    },
    {
      table: 'custom_dishes',
      type: 'EXACT',
      projection: 'use_count',
      description: 'Replay custom dish use_count query on first insert',
    },
  ],
};

function findTestFiles(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(fullPath));
    } else if (
      (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx') ||
       entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.tsx')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function verifyQueryAssertion(content, query) {
  const { table, type, projection, projectionVar } = query;

  // Verify table is asserted
  const assertsTable = (
    content.includes(`'${table}'`) ||
    content.includes(`"${table}"`)
  ) && (
    content.includes('getRecordedTables') ||
    content.includes('capturedTable') ||
    content.includes('getRecordedSelects') ||
    content.includes('tableName')
  );

  if (!assertsTable) {
    return { passed: false, reason: `Table '${table}' not asserted` };
  }

  if (type === 'NO_PROJECTION_APPLIES') {
    const hasTag = content.includes('NO_PROJECTION_APPLIES');
    if (!hasTag) {
      return { passed: false, reason: `Missing NO_PROJECTION_APPLIES tag for table '${table}'` };
    }
    return { passed: true, detail: 'NO_PROJECTION_APPLIES' };
  }

  if (type === 'WILDCARD_MUTATION_RETURN') {
    const assertsWildcard = (
      content.includes('WILDCARD_MUTATION_RETURN') &&
      content.includes(table)
    );
    if (!assertsWildcard) {
      return { passed: false, reason: `Missing WILDCARD_MUTATION_RETURN assertion for table '${table}'` };
    }
    return { passed: true, detail: 'WILDCARD_MUTATION_RETURN' };
  }

  if (type === 'EXACT') {
    const hasExactString = content.includes(projection) || (projectionVar && content.includes(projectionVar));
    const hasTableAndSelectAssert = (
      content.includes('getRecordedSelects') ||
      content.includes('capturedTable') ||
      content.includes('assertSelectRecorded')
    );

    if (!hasExactString || !hasTableAndSelectAssert) {
      return { passed: false, reason: `Missing exact projection assertion for table '${table}'` };
    }
    return { passed: true, detail: `EXACT: ${projection.slice(0, 40)}...` };
  }

  return { passed: false, reason: 'Unknown query type' };
}

function analyzeTestFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(rootDir, filePath);

  const isExcluded =
    relPath === 'src/lib/supabase.test.ts' ||
    relPath === 'src/utils/unitConverter.test.ts' ||
    relPath.startsWith('src/test/') ||
    relPath === 'src/components/nutrition/EditMealSheet.addAi.test.tsx' ||
    relPath === 'src/components/nutrition/EditMealSheet.test.tsx' ||
    relPath === 'src/components/nutrition/NutritionEngine.addAi.test.tsx' ||
    relPath === 'src/components/nutrition/QuickLogToast.integration.test.tsx' ||
    relPath === 'src/components/nutrition/useCustomDishActions.test.tsx' ||
    relPath === 'src/components/nutrition/useMealEditor.test.tsx' ||
    relPath === 'src/components/nutrition/useQuickLogToast.test.tsx' ||
    relPath === 'src/components/NutritionEngine.dateChange.test.tsx';
  const mocksFrom = !isExcluded && (
    content.includes('supabase.from') ||
    content.includes('from:') ||
    content.includes('createSupabaseBuilder')
  );

  if (!mocksFrom) {
    return null;
  }

  const usesSharedMock = content.includes('supabaseBuilderMock');
  const registeredQueries = SERVICED_QUERIES_REGISTRY[relPath];

  if (!registeredQueries) {
    return {
      file: relPath,
      usesSharedMock,
      totalQueries: 0,
      assertedQueries: 0,
      coveragePct: '0.0',
      queries: [],
      pass: false,
      error: 'Uncataloged test file mocking supabase.from: add serviced queries to SERVICED_QUERIES_REGISTRY',
    };
  }

  const queryResults = registeredQueries.map((q) => {
    const res = verifyQueryAssertion(content, q);
    return {
      table: q.table,
      type: q.type,
      description: q.description,
      passed: res.passed,
      detail: res.detail || res.reason,
    };
  });

  const totalQueries = queryResults.length;
  const assertedQueries = queryResults.filter((q) => q.passed).length;
  const coveragePct = totalQueries > 0 ? ((assertedQueries / totalQueries) * 100).toFixed(1) : '0.0';
  const pass = usesSharedMock && assertedQueries === totalQueries;

  return {
    file: relPath,
    usesSharedMock,
    totalQueries,
    assertedQueries,
    coveragePct,
    queries: queryResults,
    pass,
  };
}

function main() {
  console.log('========================================================================');
  console.log('🔍 Yourbody Mock Fidelity Checker — Per-Query Database Contract Verification');
  console.log('========================================================================\n');

  const testFiles = findTestFiles(srcDir);
  const results = [];

  for (const file of testFiles) {
    const analysis = analyzeTestFile(file);
    if (analysis) {
      results.push(analysis);
    }
  }

  results.sort((a, b) => a.file.localeCompare(b.file));

  console.log(`Discovered ${results.length} test file(s) mocking supabase.from.\n`);
  console.log('| Status | Test File | Mocked Queries | Asserted | Coverage | Details |');
  console.log('|---|---|:---:|:---:|:---:|---|');

  let globalTotalQueries = 0;
  let globalAssertedQueries = 0;
  let passingFilesCount = 0;

  for (const r of results) {
    globalTotalQueries += r.totalQueries;
    globalAssertedQueries += r.assertedQueries;
    if (r.pass) passingFilesCount++;

    const status = r.pass ? '✅ PASS' : '❌ FAIL';
    const querySummary = r.queries.map((q) => `${q.table} (${q.passed ? '✓' : '✗'})`).join(', ');
    console.log(`| ${status} | \`${r.file}\` | ${r.totalQueries} | ${r.assertedQueries} | ${r.coveragePct}% | ${querySummary} |`);
  }

  const globalCoveragePct = globalTotalQueries > 0
    ? ((globalAssertedQueries / globalTotalQueries) * 100).toFixed(1)
    : '0.0';

  console.log('\n------------------------------------------------------------------------');
  console.log(`📊 Global Summary:`);
  console.log(`   - Total Serviced Queries: ${globalTotalQueries}`);
  console.log(`   - Asserted Queries:       ${globalAssertedQueries} / ${globalTotalQueries} (${globalCoveragePct}%)`);
  console.log(`   - Passing Test Files:     ${passingFilesCount} / ${results.length} (${((passingFilesCount / results.length) * 100).toFixed(1)}%)`);
  console.log('------------------------------------------------------------------------\n');

  // Breakdown of all serviced queries
  console.log('📋 Per-Query Verification Details:');
  for (const r of results) {
    console.log(`\n  📄 ${r.file} (${r.assertedQueries}/${r.totalQueries} queries asserted):`);
    for (const q of r.queries) {
      const mark = q.passed ? '✅' : '❌';
      console.log(`     ${mark} [${q.table}] [${q.type}] ${q.description}: ${q.detail}`);
    }
  }

  if (globalAssertedQueries < globalTotalQueries || passingFilesCount < results.length) {
    console.error(`\n❌ FAIL: Global query mock fidelity is ${globalCoveragePct}% (< 100.0%).`);
    console.error(`Every distinct (table, projection) query serviced by a mock must have an explicit assertion.`);
    process.exit(1);
  }

  console.log('\n✅ PASS: 100% of distinct database queries serviced by test mocks satisfy table and projection contracts.\n');
  process.exit(0);
}

main();
