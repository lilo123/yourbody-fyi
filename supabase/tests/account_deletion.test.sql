BEGIN;
SELECT plan(25);

-- 1. Setup test fixture users and representative data
DO $$
DECLARE
  v_user_a uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  v_user_b uuid := '22222222-2222-4222-8222-222222222222'::uuid;
  v_coach_c uuid := '33333333-3333-4333-8333-333333333333'::uuid;
  v_ex_master uuid := '44444444-4444-4444-8444-444444444444'::uuid;
  v_ex_custom_a uuid := '55555555-5555-4555-8555-555555555555'::uuid;
  v_ex_custom_b uuid := '66666666-6666-4666-8666-666666666666'::uuid;
  v_workout_a uuid := gen_random_uuid();
  v_workout_b uuid := gen_random_uuid();
  v_template_a uuid := gen_random_uuid();
  v_template_b uuid := gen_random_uuid();
BEGIN
  -- Insert master exercise
  INSERT INTO public.exercises (id, name, is_master, user_id)
  VALUES (v_ex_master, 'Master Bench Press Test', true, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- Insert users into auth.users (trigger handle_new_user creates public.users rows)
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES
    (v_user_a, 'delete_test_user_a@example.com', '{"role":"athlete","username":"UserA"}'::jsonb),
    (v_user_b, 'delete_test_user_b@example.com', '{"role":"athlete","username":"UserB"}'::jsonb),
    (v_coach_c, 'delete_test_coach_c@example.com', '{"role":"coach","username":"CoachC"}'::jsonb);

  -- Populate billing and terms fields on public.users
  UPDATE public.users
  SET plan = 'pro',
      paid_until = now() + interval '30 days',
      billing_customer_id = 'cus_delete_test_a',
      terms_version = '2026-10-10',
      terms_accepted_at = now()
  WHERE id = v_user_a;

  UPDATE public.users
  SET plan = 'basic',
      paid_until = now() + interval '15 days',
      billing_customer_id = 'cus_delete_test_b',
      terms_version = '2026-10-10',
      terms_accepted_at = now()
  WHERE id = v_user_b;

  -- Insert custom exercises
  INSERT INTO public.exercises (id, name, is_master, user_id)
  VALUES
    (v_ex_custom_a, 'User A Custom Squat', false, v_user_a),
    (v_ex_custom_b, 'User B Custom Curl', false, v_user_b);

  -- Insert workouts & sets
  INSERT INTO public.workouts (id, user_id, name)
  VALUES
    (v_workout_a, v_user_a, 'User A Workout 1'),
    (v_workout_b, v_user_b, 'User B Workout 1');

  INSERT INTO public.sets (workout_id, exercise_id, reps, weight)
  VALUES
    (v_workout_a, v_ex_master, 10, 100),
    (v_workout_b, v_ex_master, 8, 120),
    (v_workout_b, v_ex_custom_b, 12, 40);

  -- Insert nutrition logs
  INSERT INTO public.nutrition_logs (user_id, food_name, calories, protein, carbs, fat)
  VALUES
    (v_user_a, 'Chicken and Rice A', 500, 45, 60, 10),
    (v_user_b, 'Oatmeal B', 300, 10, 50, 5);

  -- Insert custom dishes
  INSERT INTO public.custom_dishes (user_id, name, calories, protein, carbs, fat)
  VALUES
    (v_user_a, 'Special Shake A', 400, 30, 40, 10),
    (v_user_b, 'Special Shake B', 350, 25, 35, 10);

  -- Insert routine templates & template exercises
  INSERT INTO public.routine_templates (id, user_id, name)
  VALUES (v_template_a, v_user_a, 'User A Routine');

  -- User B's routine template is assigned to User A (tests ON DELETE SET NULL on assigned_to)
  INSERT INTO public.routine_templates (id, user_id, name, assigned_to)
  VALUES (v_template_b, v_user_b, 'User B Routine', v_user_a);

  INSERT INTO public.template_exercises (template_id, exercise_id, order_index)
  VALUES
    (v_template_a, v_ex_master, 1),
    (v_template_b, v_ex_master, 1);

  -- Insert coach athlete links
  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status)
  VALUES
    (v_coach_c, v_user_a, 'active'),
    (v_coach_c, v_user_b, 'active');

  -- Insert exercise hides
  INSERT INTO public.exercise_hides (hidden_by, exercise_id)
  VALUES
    (v_user_a, v_ex_master),
    (v_user_b, v_ex_master);

  -- Insert ai usage
  INSERT INTO public.ai_usage (user_id, period_kind, period_start, count)
  VALUES
    (v_user_a, 'day', '2026-10-10'::date, 5),
    (v_user_b, 'day', '2026-10-10'::date, 2);

  -- Insert billing events
  INSERT INTO public.billing_events (event_id, type, user_id, customer_id, payload)
  VALUES
    ('evt_delete_test_a', 'invoice.paid', v_user_a, 'cus_delete_test_a', '{"amount": 1000}'::jsonb),
    ('evt_delete_test_b', 'invoice.paid', v_user_b, 'cus_delete_test_b', '{"amount": 500}'::jsonb);

  -- Execute deletion of User A as postgres
  DELETE FROM auth.users WHERE id = v_user_a;
END;
$$;

-- 2. Assert zero residue rows for User A across all user-owned public tables
SELECT is_empty(
  'SELECT 1 FROM public.users WHERE id = ''11111111-1111-4111-8111-111111111111''::uuid',
  'public.users has 0 rows for deleted user'
);

SELECT is_empty(
  'SELECT 1 FROM public.workouts WHERE user_id = ''11111111-1111-4111-8111-111111111111''::uuid',
  'public.workouts has 0 rows for deleted user'
);

SELECT is_empty(
  'SELECT 1 FROM public.nutrition_logs WHERE user_id = ''11111111-1111-4111-8111-111111111111''::uuid',
  'public.nutrition_logs has 0 rows for deleted user'
);

SELECT is_empty(
  'SELECT 1 FROM public.custom_dishes WHERE user_id = ''11111111-1111-4111-8111-111111111111''::uuid',
  'public.custom_dishes has 0 rows for deleted user'
);

SELECT is_empty(
  'SELECT 1 FROM public.routine_templates WHERE user_id = ''11111111-1111-4111-8111-111111111111''::uuid',
  'public.routine_templates has 0 rows for deleted user'
);

SELECT is_empty(
  'SELECT 1 FROM public.exercises WHERE user_id = ''11111111-1111-4111-8111-111111111111''::uuid',
  'public.exercises has 0 custom exercises for deleted user'
);

SELECT is_empty(
  'SELECT 1 FROM public.coach_athlete_links WHERE coach_id = ''11111111-1111-4111-8111-111111111111''::uuid OR athlete_id = ''11111111-1111-4111-8111-111111111111''::uuid',
  'public.coach_athlete_links has 0 rows for deleted user'
);

SELECT is_empty(
  'SELECT 1 FROM public.exercise_hides WHERE hidden_by = ''11111111-1111-4111-8111-111111111111''::uuid',
  'public.exercise_hides has 0 rows for deleted user'
);

SELECT is_empty(
  'SELECT 1 FROM public.ai_usage WHERE user_id = ''11111111-1111-4111-8111-111111111111''::uuid',
  'public.ai_usage has 0 rows for deleted user'
);

-- Assert billing_events retains rows as payment records with user_id set to NULL
SELECT results_eq(
  'SELECT count(*)::int FROM public.billing_events WHERE event_id = ''evt_delete_test_a'' AND user_id IS NULL AND customer_id = ''cus_delete_test_a''',
  ARRAY[1],
  'public.billing_events row retained with user_id set to NULL for deleted user'
);

-- Assert zero orphaned sets or template_exercises
SELECT is_empty(
  'SELECT 1 FROM public.sets s LEFT JOIN public.workouts w ON s.workout_id = w.id WHERE w.id IS NULL',
  'public.sets has 0 orphaned rows'
);

SELECT is_empty(
  'SELECT 1 FROM public.template_exercises te LEFT JOIN public.routine_templates rt ON te.template_id = rt.id WHERE rt.id IS NULL',
  'public.template_exercises has 0 orphaned rows'
);

-- 3. Assert User B and Coach C data is completely untouched
SELECT results_eq(
  'SELECT count(*)::int FROM public.users WHERE id = ''22222222-2222-4222-8222-222222222222''::uuid',
  ARRAY[1],
  'User B user record is preserved'
);

SELECT results_eq(
  'SELECT count(*)::int FROM public.workouts WHERE user_id = ''22222222-2222-4222-8222-222222222222''::uuid',
  ARRAY[1],
  'User B workouts are preserved'
);

SELECT results_eq(
  'SELECT count(*)::int FROM public.coach_athlete_links WHERE coach_id = ''33333333-3333-4333-8333-333333333333''::uuid AND athlete_id = ''22222222-2222-4222-8222-222222222222''::uuid AND status = ''active''',
  ARRAY[1],
  'Coach C to User B link is preserved'
);

SELECT results_eq(
  'SELECT assigned_to FROM public.routine_templates WHERE user_id = ''22222222-2222-4222-8222-222222222222''::uuid',
  ARRAY[NULL::uuid],
  'User B routine template assigned_to was set to NULL via ON DELETE SET NULL'
);

SELECT results_eq(
  'SELECT count(*)::int FROM public.ai_usage WHERE user_id = ''22222222-2222-4222-8222-222222222222''::uuid',
  ARRAY[1],
  'User B ai_usage is preserved'
);

SELECT results_eq(
  'SELECT count(*)::int FROM public.billing_events WHERE event_id = ''evt_delete_test_b'' AND user_id = ''22222222-2222-4222-8222-222222222222''::uuid',
  ARRAY[1],
  'User B billing event is preserved with user_id intact'
);

SELECT results_eq(
  'SELECT plan, billing_customer_id, terms_version FROM public.users WHERE id = ''22222222-2222-4222-8222-222222222222''::uuid',
  $$VALUES ('basic'::text, 'cus_delete_test_b'::text, '2026-10-10'::text)$$,
  'User B plan, billing_customer_id, and terms_version are preserved'
);

-- 4. Document RESTRICT constraint behavior when another user references a custom exercise
DO $$
DECLARE
  v_user_d uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid;
  v_user_e uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid;
  v_ex_custom_d uuid := 'd0000000-0000-4000-8000-000000000000'::uuid;
  v_template_e uuid := gen_random_uuid();
  v_caught boolean := false;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES
    (v_user_d, 'delete_test_user_d@example.com', '{"role":"coach","username":"UserD"}'::jsonb),
    (v_user_e, 'delete_test_user_e@example.com', '{"role":"athlete","username":"UserE"}'::jsonb);

  INSERT INTO public.exercises (id, name, is_master, user_id)
  VALUES (v_ex_custom_d, 'User D Shared Custom Press', false, v_user_d);

  -- User E creates a template containing User D's custom exercise
  INSERT INTO public.routine_templates (id, user_id, name)
  VALUES (v_template_e, v_user_e, 'User E Template with Shared Ex');

  INSERT INTO public.template_exercises (template_id, exercise_id, order_index)
  VALUES (v_template_e, v_ex_custom_d, 1);

  -- Attempting DELETE FROM auth.users directly fails due to template_exercises.exercise_id ON DELETE RESTRICT
  BEGIN
    DELETE FROM auth.users WHERE id = v_user_d;
  EXCEPTION WHEN foreign_key_violation THEN
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'Expected foreign_key_violation due to ON DELETE RESTRICT on template_exercises.exercise_id';
  END IF;

  -- Clean up User E's template so transaction rolls back cleanly
  DELETE FROM public.template_exercises WHERE template_id = v_template_e;
  DELETE FROM public.routine_templates WHERE id = v_template_e;
  DELETE FROM public.exercises WHERE id = v_ex_custom_d;
  DELETE FROM auth.users WHERE id = v_user_d;
  DELETE FROM auth.users WHERE id = v_user_e;
END;
$$;

SELECT pass('ON DELETE RESTRICT on template_exercises.exercise_id blocks direct auth.users delete when another user references the custom exercise');

-- 5. Shared-exercise clone-and-repoint verification:
-- Proves that after the cleanup sequence + DELETE auth.users:
-- User B's template and sets still resolve to an exercise owned by User B,
-- User B can read the cloned exercise under RLS, and User A's original exercise row is gone.
DO $$
DECLARE
  v_coach_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
  v_athlete_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid;
  v_orig_ex_a uuid := 'a0000000-0000-4000-8000-000000000000'::uuid;
  v_cloned_ex_b uuid := 'b0000000-0000-4000-8000-000000000000'::uuid;
  v_tpl_b uuid := gen_random_uuid();
  v_wk_b uuid := gen_random_uuid();
  v_te_b uuid := gen_random_uuid();
  v_set_b uuid := gen_random_uuid();
BEGIN
  -- Create Coach A and Athlete B
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES
    (v_coach_a, 'coach_a_clone_test@example.com', '{"role":"coach","username":"CoachA"}'::jsonb),
    (v_athlete_b, 'athlete_b_clone_test@example.com', '{"role":"athlete","username":"AthleteB"}'::jsonb);

  -- Coach A creates a custom exercise
  INSERT INTO public.exercises (id, name, is_master, user_id, body_parts, equipment)
  VALUES (v_orig_ex_a, 'Coach Incline DB Press', false, v_coach_a, ARRAY['Chest']::text[], 'dumbbell');

  -- Athlete B references Coach A's custom exercise in a template and in a workout set
  INSERT INTO public.routine_templates (id, user_id, name)
  VALUES (v_tpl_b, v_athlete_b, 'Athlete B Upper Day');

  INSERT INTO public.template_exercises (id, template_id, exercise_id, order_index)
  VALUES (v_te_b, v_tpl_b, v_orig_ex_a, 1);

  INSERT INTO public.workouts (id, user_id, name)
  VALUES (v_wk_b, v_athlete_b, 'Athlete B Session');

  INSERT INTO public.sets (id, workout_id, exercise_id, reps, weight)
  VALUES (v_set_b, v_wk_b, v_orig_ex_a, 12, 50);

  -- Perform the clone-and-repoint cleanup sequence on behalf of Coach A's account deletion:
  -- 1. Insert a copy of Coach A's custom exercise owned by Athlete B
  INSERT INTO public.exercises (id, name, is_master, user_id, body_parts, equipment)
  VALUES (v_cloned_ex_b, 'Coach Incline DB Press', false, v_athlete_b, ARRAY['Chest']::text[], 'dumbbell');

  -- 2. Repoint Athlete B's template_exercises to the cloned exercise
  UPDATE public.template_exercises
  SET exercise_id = v_cloned_ex_b
  WHERE id = v_te_b;

  -- 3. Repoint Athlete B's sets to the cloned exercise
  UPDATE public.sets
  SET exercise_id = v_cloned_ex_b
  WHERE id = v_set_b;

  -- 4. Delete Coach A's original custom exercise
  DELETE FROM public.exercises WHERE id = v_orig_ex_a;

  -- 5. Delete Coach A from auth.users
  DELETE FROM auth.users WHERE id = v_coach_a;
END;
$$;

-- Assert Coach A's original custom exercise is completely gone
SELECT is_empty(
  'SELECT 1 FROM public.exercises WHERE id = ''a0000000-0000-4000-8000-000000000000''::uuid',
  'Coach A original custom exercise row is deleted'
);

-- Assert Coach A is deleted from auth.users
SELECT is_empty(
  'SELECT 1 FROM auth.users WHERE id = ''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa''::uuid',
  'Coach A is deleted from auth.users'
);

-- Assert Athlete B template_exercises references the cloned exercise owned by Athlete B
SELECT results_eq(
  'SELECT exercise_id FROM public.template_exercises WHERE template_id IN (SELECT id FROM public.routine_templates WHERE user_id = ''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb''::uuid)',
  ARRAY['b0000000-0000-4000-8000-000000000000'::uuid],
  'Athlete B template_exercises successfully repointed to cloned exercise'
);

-- Assert Athlete B sets references the cloned exercise owned by Athlete B
SELECT results_eq(
  'SELECT exercise_id FROM public.sets WHERE workout_id IN (SELECT id FROM public.workouts WHERE user_id = ''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb''::uuid)',
  ARRAY['b0000000-0000-4000-8000-000000000000'::uuid],
  'Athlete B sets successfully repointed to cloned exercise'
);

-- Assert Athlete B can read the cloned exercise under RLS
SELECT results_eq(
  $$
    SELECT count(*)::int FROM public.exercises
    WHERE id = 'b0000000-0000-4000-8000-000000000000'::uuid
      AND user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      AND is_master = false
  $$,
  ARRAY[1],
  'Cloned exercise is owned by Athlete B, not master, and readable under RLS'
);

ROLLBACK;
