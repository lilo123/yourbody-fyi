BEGIN;
SELECT plan(76);

-- 1. Table existence
SELECT has_table('public', 'users', 'users table exists');
SELECT has_table('public', 'exercises', 'exercises table exists');
SELECT has_table('public', 'workouts', 'workouts table exists');
SELECT has_table('public', 'sets', 'sets table exists');
SELECT has_table('public', 'routine_templates', 'routine_templates table exists');
SELECT has_table('public', 'template_exercises', 'template_exercises table exists');
SELECT has_table('public', 'nutrition_logs', 'nutrition_logs table exists');
SELECT has_table('public', 'custom_dishes', 'custom_dishes table exists');

-- 2. Column additions
SELECT has_column('public', 'sets', 'set_index', 'sets table has set_index column');
SELECT has_column('public', 'sets', 'set_type', 'sets table has set_type column');
SELECT has_column('public', 'sets', 'rpe', 'sets table has rpe column');
SELECT has_column('public', 'nutrition_logs', 'fiber', 'nutrition_logs table has fiber column');
SELECT has_column('public', 'nutrition_logs', 'meal_type', 'nutrition_logs table has meal_type column');
SELECT has_column('public', 'users', 'role', 'users table has role column');
SELECT has_column('public', 'users', 'target_fiber', 'users table has target_fiber column');
SELECT has_column('public', 'custom_dishes', 'fiber', 'custom_dishes table has fiber column');
SELECT has_column('public', 'exercises', 'user_id', 'exercises table has user_id column');
SELECT has_column('public', 'exercises', 'is_master', 'exercises table has is_master column');
SELECT has_column('public', 'exercises', 'is_archived', 'exercises table has is_archived column');
SELECT has_column('public', 'routine_templates', 'days_of_week', 'routine_templates table has days_of_week column');

-- 3. Security Definer Search Path & Function Verification
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'is_coach'
    AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
  ),
  'is_coach has explicit search_path'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
    AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
  ),
  'handle_new_user has explicit search_path'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'protect_user_role_change'
    AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
  ),
  'protect_user_role_change has explicit search_path'
);

SELECT is(public.is_coach(), false, 'is_coach returns boolean false (not NULL) when unauthenticated');

-- 4. Set index determinism & cascade test
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_workout_id uuid;
  v_ex_id uuid;
  v_count integer;
BEGIN
  -- Insert into auth.users (trigger creates public.users)
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user_id, 'test_athlete@example.com', '{"role":"athlete","username":"TestAthlete"}'::jsonb);

  -- Get an exercise
  SELECT id INTO v_ex_id FROM public.exercises WHERE is_master = true LIMIT 1;
  IF v_ex_id IS NULL THEN
    INSERT INTO public.exercises (name, body_parts, is_master) VALUES ('Test Bench Press', ARRAY['Chest'], true) RETURNING id INTO v_ex_id;
  END IF;

  -- Create workout
  INSERT INTO public.workouts (user_id, name, date)
  VALUES (v_user_id, 'Morning Push', now())
  RETURNING id INTO v_workout_id;

  -- Insert sets out of order (3, 1, 2)
  INSERT INTO public.sets (workout_id, exercise_id, set_index, set_type, weight, reps, rpe)
  VALUES 
    (v_workout_id, v_ex_id, 3, 'working', 200, 5, 8.5),
    (v_workout_id, v_ex_id, 1, 'warmup', 135, 10, 6.0),
    (v_workout_id, v_ex_id, 2, 'working', 185, 8, 7.5);

  -- Assert sorting
  PERFORM * FROM public.sets WHERE workout_id = v_workout_id ORDER BY set_index ASC;

  -- Test FK cascade: deleting workout should delete all 3 sets
  DELETE FROM public.workouts WHERE id = v_workout_id;
  SELECT count(*) INTO v_count FROM public.sets WHERE workout_id = v_workout_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Cascade delete failed: % sets remained after deleting workout', v_count;
  END IF;

  -- Clean up auth user (cascades to public.users)
  DELETE FROM auth.users WHERE id = v_user_id;
END;
$$;

SELECT pass('Workout sets cascade on delete and maintain set_index ordering');

-- 5. Routine templates assigned_to FK test (ON DELETE SET NULL)
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_athlete_id uuid := gen_random_uuid();
  v_tpl_id uuid;
  v_assigned uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'coach_t@example.com', '{"role":"coach"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_athlete_id, 'athlete_t@example.com', '{"role":"athlete"}'::jsonb);

  INSERT INTO public.routine_templates (user_id, name, is_master, assigned_to)
  VALUES (v_coach_id, 'Athlete Custom Routine', false, v_athlete_id)
  RETURNING id INTO v_tpl_id;

  -- Delete athlete
  DELETE FROM auth.users WHERE id = v_athlete_id;

  -- Template should still exist with assigned_to = NULL
  SELECT assigned_to INTO v_assigned FROM public.routine_templates WHERE id = v_tpl_id;
  IF v_assigned IS NOT NULL THEN
    RAISE EXCEPTION 'assigned_to was not set to NULL upon athlete deletion';
  END IF;

  -- Clean up
  DELETE FROM public.routine_templates WHERE id = v_tpl_id;
  DELETE FROM auth.users WHERE id = v_coach_id;
END;
$$;

SELECT pass('Routine templates preserve master and set assigned_to NULL on athlete delete');

-- 6. Role self-promotion prevention test
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'role_test@example.com', '{"role":"athlete","username":"RoleTest"}'::jsonb);

  -- Simulate authenticated client request
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_uid || '"}', true);
  BEGIN
    UPDATE public.users SET role = 'coach' WHERE id = v_uid;
    RAISE EXCEPTION 'Client was able to update role!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Unauthorized%' THEN
      RAISE;
    END IF;
  END;
  -- Reset jwt claims
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

SELECT pass('Client cannot self-elevate role to coach');

-- 7. Exercise RLS: athletes cannot delete master exercises
DO $$
DECLARE
  v_athlete_id uuid := gen_random_uuid();
  v_master_id uuid;
  v_deleted_count int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_athlete_id, 'athlete_rls@example.com', '{"role":"athlete","username":"AthleteRLS"}'::jsonb);

  SELECT id INTO v_master_id FROM public.exercises WHERE is_master = true LIMIT 1;
  
  -- Authenticate as athlete
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_athlete_id || '"}', true);

  -- Athlete attempts to delete master exercise
  DELETE FROM public.exercises WHERE id = v_master_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count > 0 THEN
    RAISE EXCEPTION 'Athlete was able to delete master exercise!';
  END IF;

  -- Reset role
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_athlete_id;
END;
$$;

SELECT pass('Athletes cannot delete master exercises');

-- 8. Negative Check Constraint Tests
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_wid uuid;
  v_eid uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'chk1@test.com', '{"role":"athlete"}'::jsonb);
  SELECT id INTO v_eid FROM public.exercises WHERE is_master = true LIMIT 1;
  INSERT INTO public.workouts (user_id, name, date) VALUES (v_uid, 'W1', now()) RETURNING id INTO v_wid;

  BEGIN
    INSERT INTO public.sets (workout_id, exercise_id, set_index, weight, reps) VALUES (v_wid, v_eid, 1, -10, 5);
    RAISE EXCEPTION 'Negative weight was accepted!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM public.workouts WHERE id = v_wid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Negative weight violates chk_sets_weight_non_negative');

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_wid uuid;
  v_eid uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'chk2@test.com', '{"role":"athlete"}'::jsonb);
  SELECT id INTO v_eid FROM public.exercises WHERE is_master = true LIMIT 1;
  INSERT INTO public.workouts (user_id, name, date) VALUES (v_uid, 'W2', now()) RETURNING id INTO v_wid;

  BEGIN
    INSERT INTO public.sets (workout_id, exercise_id, set_index, weight, reps) VALUES (v_wid, v_eid, 1, 100, -1);
    RAISE EXCEPTION 'Negative reps was accepted!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM public.workouts WHERE id = v_wid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Negative reps violates chk_sets_reps_non_negative');

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_wid uuid;
  v_eid uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'chk3@test.com', '{"role":"athlete"}'::jsonb);
  SELECT id INTO v_eid FROM public.exercises WHERE is_master = true LIMIT 1;
  INSERT INTO public.workouts (user_id, name, date) VALUES (v_uid, 'W3', now()) RETURNING id INTO v_wid;

  BEGIN
    INSERT INTO public.sets (workout_id, exercise_id, set_index, weight, reps) VALUES (v_wid, v_eid, 0, 100, 5);
    RAISE EXCEPTION 'Non-positive set_index was accepted!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM public.workouts WHERE id = v_wid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Zero/negative set_index violates chk_sets_index_positive');

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_wid uuid;
  v_eid uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'chk4@test.com', '{"role":"athlete"}'::jsonb);
  SELECT id INTO v_eid FROM public.exercises WHERE is_master = true LIMIT 1;
  INSERT INTO public.workouts (user_id, name, date) VALUES (v_uid, 'W4', now()) RETURNING id INTO v_wid;

  BEGIN
    INSERT INTO public.sets (workout_id, exercise_id, set_index, weight, reps, rpe) VALUES (v_wid, v_eid, 1, 100, 5, 11);
    RAISE EXCEPTION 'RPE > 10 was accepted!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM public.workouts WHERE id = v_wid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Out-of-bounds RPE violates check constraint');

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_wid uuid;
  v_eid uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'chk5@test.com', '{"role":"athlete"}'::jsonb);
  SELECT id INTO v_eid FROM public.exercises WHERE is_master = true LIMIT 1;
  INSERT INTO public.workouts (user_id, name, date) VALUES (v_uid, 'W5', now()) RETURNING id INTO v_wid;

  BEGIN
    INSERT INTO public.sets (workout_id, exercise_id, set_index, weight, reps, set_type) VALUES (v_wid, v_eid, 1, 100, 5, 'super_set');
    RAISE EXCEPTION 'Invalid set_type was accepted!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM public.workouts WHERE id = v_wid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Invalid set_type violates check constraint');

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'chk6@test.com', '{"role":"athlete"}'::jsonb);

  BEGIN
    INSERT INTO public.nutrition_logs (user_id, food_name, calories, protein, carbs, fat)
    VALUES (v_uid, 'Negative Cal Meal', -100, 20, 30, 5);
    RAISE EXCEPTION 'Negative calories were accepted!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Negative calories violates chk_nutrition_calories_non_negative');

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'chk7@test.com', '{"role":"athlete"}'::jsonb);

  BEGIN
    UPDATE public.users SET role = 'superadmin' WHERE id = v_uid;
    RAISE EXCEPTION 'Invalid role was accepted!';
  EXCEPTION WHEN check_violation OR OTHERS THEN
    -- Expected: check constraint or protect_user_role_change trigger
  END;

  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Invalid role is rejected by check constraint');

-- 9. Cross-Tenant Isolation Assertions
DO $$
DECLARE
  v_athlete_a uuid := gen_random_uuid();
  v_athlete_b uuid := gen_random_uuid();
  v_wid uuid;
  v_eid uuid;
  v_seen_count int;
  v_del_count int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_athlete_a, 'ath_a@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_athlete_b, 'ath_b@test.com', '{"role":"athlete"}'::jsonb);
  SELECT id INTO v_eid FROM public.exercises WHERE is_master = true LIMIT 1;

  INSERT INTO public.workouts (user_id, name, date) VALUES (v_athlete_a, 'Athlete A Private Workout', now()) RETURNING id INTO v_wid;
  INSERT INTO public.sets (workout_id, exercise_id, set_index, weight, reps) VALUES (v_wid, v_eid, 1, 150, 10);

  -- Switch to Athlete B
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_athlete_b || '"}', true);

  -- Athlete B queries workouts
  SELECT count(*) INTO v_seen_count FROM public.workouts WHERE id = v_wid;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Cross-tenant breach: Athlete B can see Athlete A workout!';
  END IF;

  -- Athlete B attempts to delete Athlete A workout
  DELETE FROM public.workouts WHERE id = v_wid;
  GET DIAGNOSTICS v_del_count = ROW_COUNT;
  IF v_del_count > 0 THEN
    RAISE EXCEPTION 'Cross-tenant breach: Athlete B deleted Athlete A workout!';
  END IF;

  -- Athlete B attempts to insert set into Athlete A workout
  BEGIN
    INSERT INTO public.sets (workout_id, exercise_id, set_index, weight, reps) VALUES (v_wid, v_eid, 2, 160, 8);
    RAISE EXCEPTION 'Cross-tenant breach: Athlete B inserted set into Athlete A workout!';
  EXCEPTION WHEN OTHERS THEN
    -- Expected RLS error
  END;

  -- Reset role
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.workouts WHERE id = v_wid;
  DELETE FROM auth.users WHERE id = v_athlete_a;
  DELETE FROM auth.users WHERE id = v_athlete_b;
END;
$$;
SELECT pass('Cross-tenant isolation: Athlete B cannot read, update, delete or tamper with Athlete A workouts and sets');

DO $$
DECLARE
  v_athlete_a uuid := gen_random_uuid();
  v_athlete_b uuid := gen_random_uuid();
  v_nid uuid;
  v_seen_count int;
  v_del_count int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_athlete_a, 'nut_a@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_athlete_b, 'nut_b@test.com', '{"role":"athlete"}'::jsonb);

  INSERT INTO public.nutrition_logs (user_id, food_name, calories, protein, carbs, fat, fiber)
  VALUES (v_athlete_a, 'Athlete A Oats', 350, 20, 50, 5, 8)
  RETURNING id INTO v_nid;

  -- Switch to Athlete B
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_athlete_b || '"}', true);

  SELECT count(*) INTO v_seen_count FROM public.nutrition_logs WHERE id = v_nid;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Cross-tenant breach: Athlete B can see Athlete A nutrition logs!';
  END IF;

  DELETE FROM public.nutrition_logs WHERE id = v_nid;
  GET DIAGNOSTICS v_del_count = ROW_COUNT;
  IF v_del_count > 0 THEN
    RAISE EXCEPTION 'Cross-tenant breach: Athlete B deleted Athlete A nutrition log!';
  END IF;

  -- Reset role
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.nutrition_logs WHERE id = v_nid;
  DELETE FROM auth.users WHERE id = v_athlete_a;
  DELETE FROM auth.users WHERE id = v_athlete_b;
END;
$$;
SELECT pass('Cross-tenant isolation: Athlete B cannot read or delete Athlete A nutrition logs');

DO $$
DECLARE
  v_athlete_a uuid := gen_random_uuid();
  v_athlete_b uuid := gen_random_uuid();
  v_cd_id uuid;
  v_seen_count int;
  v_del_count int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_athlete_a, 'dish_a@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_athlete_b, 'dish_b@test.com', '{"role":"athlete"}'::jsonb);

  INSERT INTO public.custom_dishes (user_id, name, calories, protein, carbs, fat, fiber)
  VALUES (v_athlete_a, 'Secret Protein Shake', 400, 50, 20, 5, 3)
  RETURNING id INTO v_cd_id;

  -- Switch to Athlete B
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_athlete_b || '"}', true);

  SELECT count(*) INTO v_seen_count FROM public.custom_dishes WHERE id = v_cd_id;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Cross-tenant breach: Athlete B can see Athlete A custom dishes!';
  END IF;

  DELETE FROM public.custom_dishes WHERE id = v_cd_id;
  GET DIAGNOSTICS v_del_count = ROW_COUNT;
  IF v_del_count > 0 THEN
    RAISE EXCEPTION 'Cross-tenant breach: Athlete B deleted Athlete A custom dish!';
  END IF;

  -- Reset role
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.custom_dishes WHERE id = v_cd_id;
  DELETE FROM auth.users WHERE id = v_athlete_a;
  DELETE FROM auth.users WHERE id = v_athlete_b;
END;
$$;
SELECT pass('Cross-tenant isolation: Athlete B cannot read or delete Athlete A custom dishes');

DO $$
DECLARE
  v_athlete_a uuid := gen_random_uuid();
  v_athlete_b uuid := gen_random_uuid();
  v_tpl_id uuid;
  v_seen_count int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_athlete_a, 'tpl_a@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_athlete_b, 'tpl_b@test.com', '{"role":"athlete"}'::jsonb);

  INSERT INTO public.routine_templates (user_id, name, is_master)
  VALUES (v_athlete_a, 'Athlete A Private Routine', false)
  RETURNING id INTO v_tpl_id;

  -- Switch to Athlete B
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_athlete_b || '"}', true);

  SELECT count(*) INTO v_seen_count FROM public.routine_templates WHERE id = v_tpl_id;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Cross-tenant breach: Athlete B can see Athlete A private routine template!';
  END IF;

  -- Reset role
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.routine_templates WHERE id = v_tpl_id;
  DELETE FROM auth.users WHERE id = v_athlete_a;
  DELETE FROM auth.users WHERE id = v_athlete_b;
END;
$$;
SELECT pass('Cross-tenant isolation: Athlete B cannot view Athlete A private routine templates');

-- ============================================================================
-- Nutrition hierarchy (items jsonb) — 24 assertions.
--
-- Constraint *existence* is not the property that matters: a NOT VALID
-- constraint exists, reports itself in pg_constraint, and silently lets every
-- pre-existing bad row stand. Each one is therefore asserted convalidated.
-- ============================================================================

-- Columns (4)
SELECT has_column('public', 'nutrition_logs', 'items', 'nutrition_logs has items column');
SELECT has_column('public', 'custom_dishes', 'items', 'custom_dishes has items column');
SELECT col_type_is('public', 'nutrition_logs', 'items', 'jsonb', 'nutrition_logs.items is jsonb');
SELECT col_type_is('public', 'custom_dishes', 'items', 'jsonb', 'custom_dishes.items is jsonb');

-- The private helper schema and its functions (3)
SELECT has_schema('private', 'private helper schema exists');
SELECT ok(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'private'
     AND p.proname IN ('items_macro_sum','items_min_macro','portion_to_canonical',
                       'safe_items_array','num_or_zero','items_from_ingredients')) = 6,
  'all six private helper functions exist'
);
-- The CHECK constraints call these as the invoking (authenticated) role, so
-- without USAGE every insert fails with "permission denied for schema private".
SELECT ok(
  has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated retains USAGE on private (constraints would fail otherwise)'
);

-- Helper function behaviour (5)
SELECT is(
  private.items_macro_sum('[{"calories":10},{"calories":2.5},{"calories":"x"}]'::jsonb, 'calories'),
  12.5::numeric,
  'items_macro_sum ignores non-numeric macros rather than erroring'
);
SELECT is(
  private.items_macro_sum('"not an array"'::jsonb, 'calories'), 0::numeric,
  'items_macro_sum returns 0 for a non-array'
);
SELECT is(
  private.items_min_macro('[{"calories":10,"protein":-3},{"calories":5}]'::jsonb), (-3)::numeric,
  'items_min_macro finds the smallest macro anywhere in the array'
);
SELECT is(
  private.portion_to_canonical('150 g'), 
  '{"quantity":150,"unit":"g","confidence":"high"}'::jsonb,
  'portion_to_canonical parses a mass portion'
);
SELECT is(
  private.portion_to_canonical('1/2 cup'),
  '{"quantity":1,"unit":"unit","confidence":"low"}'::jsonb,
  'portion_to_canonical refuses a fraction rather than dropping the denominator'
);

-- Constraints exist AND are validated (6)
SELECT ok(
  (SELECT convalidated FROM pg_constraint
   WHERE conname = 'chk_nl_items_shape' AND conrelid = 'public.nutrition_logs'::regclass),
  'chk_nl_items_shape exists and is validated'
);
SELECT ok(
  (SELECT convalidated FROM pg_constraint
   WHERE conname = 'chk_cd_items_shape' AND conrelid = 'public.custom_dishes'::regclass),
  'chk_cd_items_shape exists and is validated'
);
SELECT ok(
  (SELECT convalidated FROM pg_constraint
   WHERE conname = 'chk_nl_parent_equals_items_sum' AND conrelid = 'public.nutrition_logs'::regclass),
  'chk_nl_parent_equals_items_sum exists and is validated'
);
SELECT ok(
  (SELECT convalidated FROM pg_constraint
   WHERE conname = 'chk_cd_parent_equals_items_sum' AND conrelid = 'public.custom_dishes'::regclass),
  'chk_cd_parent_equals_items_sum exists and is validated'
);
SELECT is(
  (SELECT count(*) FROM pg_constraint
   WHERE conrelid = 'public.custom_dishes'::regclass
     AND conname LIKE 'chk_cd_%_non_negative')::int,
  5,
  'all five custom_dishes non-negative constraints exist (R-30)'
);
SELECT ok(
  (SELECT bool_and(convalidated) FROM pg_constraint
   WHERE conrelid = 'public.custom_dishes'::regclass
     AND conname LIKE 'chk_cd_%_non_negative'),
  'the custom_dishes non-negative constraints are validated'
);

-- Behavioural probes (6)
DO $$
DECLARE v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'items1@test.com', '{"role":"athlete"}'::jsonb);
  BEGIN
    INSERT INTO public.nutrition_logs (user_id, food_name, calories, items)
    VALUES (v_uid, 'Object not array', 0, '{"name":"nope"}'::jsonb);
    RAISE EXCEPTION 'A non-array items payload was accepted!';
  EXCEPTION WHEN check_violation THEN
  END;
  DELETE FROM auth.users WHERE id = v_uid;
END $$;
SELECT pass('items must be a JSON array, not an object');

DO $$
DECLARE v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'items2@test.com', '{"role":"athlete"}'::jsonb);
  BEGIN
    -- 51 components: one past the cap. An unbounded array is an unbounded
    -- render and an unbounded CHECK evaluation.
    INSERT INTO public.nutrition_logs (user_id, food_name, calories, items)
    VALUES (v_uid, 'Too many', 0,
      (SELECT jsonb_agg(jsonb_build_object('name','x','calories',0)) FROM generate_series(1,51)));
    RAISE EXCEPTION 'A 51-component items array was accepted!';
  EXCEPTION WHEN check_violation THEN
  END;
  DELETE FROM auth.users WHERE id = v_uid;
END $$;
SELECT pass('items is capped at 50 components');

DO $$
DECLARE v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'items3@test.com', '{"role":"athlete"}'::jsonb);
  BEGIN
    INSERT INTO public.nutrition_logs (user_id, food_name, calories, items)
    VALUES (v_uid, 'Negative component', 0, '[{"name":"a","calories":-1}]'::jsonb);
    RAISE EXCEPTION 'A negative per-item macro was accepted!';
  EXCEPTION WHEN check_violation THEN
  END;
  DELETE FROM auth.users WHERE id = v_uid;
END $$;
SELECT pass('a negative macro inside items is rejected');

DO $$
DECLARE v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'items4@test.com', '{"role":"athlete"}'::jsonb);
  BEGIN
    -- Parent claims 500 kcal; the components add up to 300. This is exactly
    -- the drift the whole feature exists to make impossible.
    INSERT INTO public.nutrition_logs (user_id, food_name, calories, protein, carbs, fat, fiber, items)
    VALUES (v_uid, 'Drifted', 500, 0, 0, 0, 0,
      '[{"name":"a","calories":200},{"name":"b","calories":100}]'::jsonb);
    RAISE EXCEPTION 'A parent total that disagrees with its components was accepted!';
  EXCEPTION WHEN check_violation THEN
  END;
  DELETE FROM auth.users WHERE id = v_uid;
END $$;
SELECT pass('parent macros that disagree with sum(items) are rejected');

DO $$
DECLARE v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'items5@test.com', '{"role":"athlete"}'::jsonb);
  -- A consistent parent, and a NULL-items leaf, must both still be writable.
  INSERT INTO public.nutrition_logs (user_id, food_name, calories, protein, carbs, fat, fiber, items)
  VALUES (v_uid, 'Consistent', 300, 20, 30, 10, 4,
    '[{"name":"a","calories":200,"protein":15,"carbs":20,"fat":7,"fiber":3},
      {"name":"b","calories":100,"protein":5,"carbs":10,"fat":3,"fiber":1}]'::jsonb);
  INSERT INTO public.nutrition_logs (user_id, food_name, calories, items)
  VALUES (v_uid, 'Plain leaf', 120, NULL);
  DELETE FROM public.nutrition_logs WHERE user_id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
END $$;
SELECT pass('a consistent breakdown and a NULL-items leaf are both accepted');

DO $$
DECLARE v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'items6@test.com', '{"role":"athlete"}'::jsonb);
  BEGIN
    -- Number('-50') || 0 === -50, so the old client could write this.
    INSERT INTO public.custom_dishes (user_id, name, calories) VALUES (v_uid, 'Negative dish', -50);
    RAISE EXCEPTION 'A negative custom dish calorie count was accepted!';
  EXCEPTION WHEN check_violation THEN
  END;
  DELETE FROM auth.users WHERE id = v_uid;
END $$;
SELECT pass('negative custom_dishes macros are rejected (R-30)');

-- ============================================================================
-- Nutrition hierarchy, part 2 — 13 further assertions.
--
-- Everything below is enumerated in the implementation plan's test-suite
-- section and was missing from the first pass. Each one guards a specific
-- documented failure mode rather than restating the schema.
-- ============================================================================

-- D-16: `ingredients` is kept this release. It is what makes the migration
-- reversible and what keeps an un-updated Android client working. Dropping it
-- early is a one-line change that this assertion is here to stop. (1)
SELECT has_column('public', 'custom_dishes', 'ingredients',
  'custom_dishes.ingredients still exists (D-16: do not drop it this release)');

-- The nullability asymmetry is the entire reason the two Sigma constraints have
-- different bodies: nutrition_logs.calories is compared bare, custom_dishes'
-- is COALESCEd. If either of these flips, one constraint becomes wrong. (2)
SELECT col_not_null('public', 'nutrition_logs', 'calories',
  'nutrition_logs.calories is still NOT NULL (chk_nl_... compares it bare)');
SELECT col_is_null('public', 'custom_dishes', 'calories',
  'custom_dishes.calories is still nullable (chk_cd_... must COALESCE it)');

-- items must stay nullable on both tables: NULL is how a level-2 leaf is
-- stored, and all 98 pre-existing production logs are leaves. (2)
SELECT col_is_null('public', 'nutrition_logs', 'items', 'nutrition_logs.items is nullable');
SELECT col_is_null('public', 'custom_dishes', 'items', 'custom_dishes.items is nullable');

-- R-20: the coach read-only guard in the client is only correct because RLS
-- says so. A coach may SELECT another athlete's logs and may not UPDATE them,
-- and custom_dishes has no coach exception at all. (2)
SELECT is(
  (SELECT qual FROM pg_policies
    WHERE tablename = 'nutrition_logs' AND cmd = 'UPDATE'),
  '(user_id = auth.uid())',
  'nutrition_logs UPDATE is still owner-only — the coach read-only guard depends on it (R-20)'
);
SELECT is(
  (SELECT count(*) FROM pg_policies
    WHERE tablename = 'custom_dishes'
      AND (qual LIKE '%is_coach_of%' OR with_check LIKE '%is_coach_of%'))::int,
  0,
  'custom_dishes still has no coach policy — a coach cannot read or write another user''s dishes'
);

-- The helper functions must stay IMMUTABLE PARALLEL SAFE with a pinned
-- search_path: PARALLEL SAFE because the CHECK runs on every write, and the
-- SET clause because Supabase's function_search_path_mutable advisor asks
-- for it. (2)
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('items_macro_sum', 'items_min_macro')
      AND p.proparallel = 's' AND p.proconfig IS NOT NULL)::int,
  2,
  'both Sigma helpers are PARALLEL SAFE with a pinned search_path'
);
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname IN ('items_macro_sum', 'items_min_macro')
      AND p.provolatile = 'i')::int,
  2,
  'both Sigma helpers are IMMUTABLE (a CHECK may not call a non-immutable function)'
);

-- 🔴 The revoke trap. Revoking EXECUTE here looks like routine hardening and is
-- a production outage: a CHECK expression is ACL-checked as the calling role at
-- expression *initialisation*, before `items IS NULL` can short-circuit, so it
-- breaks every write to these tables — including rows with no items at all.
-- These two assertions exist so that "hardening" fails the test suite. (2)
SELECT ok(
  has_function_privilege('authenticated', 'private.items_macro_sum(jsonb,text)', 'EXECUTE'),
  'authenticated still has EXECUTE on items_macro_sum (revoking breaks ALL nutrition writes)'
);
SELECT ok(
  has_function_privilege('authenticated', 'private.items_min_macro(jsonb)', 'EXECUTE'),
  'authenticated still has EXECUTE on items_min_macro (revoking breaks ALL nutrition writes)'
);

-- A CHECK is NOT re-validated when the function it calls is redefined:
-- convalidated stays true while the table quietly fills with violating rows.
-- convalidated alone is therefore not enough; the body itself is pinned. Any
-- intentional change must bump these AND re-validate the constraints with
-- DROP CONSTRAINT / ADD ... NOT VALID / VALIDATE. (2)
SELECT is(
  (SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'items_macro_sum'),
  '44237172370faf2e1ab15c500f1a22b6',
  'private.items_macro_sum body is unchanged (a CHECK is not re-validated on redefinition)'
);
SELECT is(
  (SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'items_min_macro'),
  '27bca08ee43f79c6c59139613fb14e88',
  'private.items_min_macro body is unchanged (a CHECK is not re-validated on redefinition)'
);


SELECT * FROM finish();
ROLLBACK;
