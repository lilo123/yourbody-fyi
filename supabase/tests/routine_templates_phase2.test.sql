BEGIN;
SELECT plan(15);

-- 1. Schema Existence
SELECT col_is_null('public', 'routine_templates', 'user_id', 'routine_templates.user_id column is nullable for master templates');
SELECT has_function(
  'public',
  'get_routine_catalog',
  ARRAY['uuid', 'text', 'integer', 'text'],
  'get_routine_catalog RPC exists with 4-arg signature'
);

-- 2. Behavioral Tests
DO $$
DECLARE
  v_new_user uuid := gen_random_uuid();
  v_user_custom uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_tpl_push_id uuid;
  v_tpl_pull_id uuid;
  v_tpl_a_id uuid;
  v_tpl_b_id uuid;
  v_custom_tpl_id uuid;
  v_assigned_tpl_id uuid;
  v_fork_tpl_id uuid;
  v_count int;
  v_first_row record;
  v_res jsonb;
  v_initial_push_id uuid;
  v_second_push_id uuid;
  v_preexisting_master_id uuid := gen_random_uuid();
  v_ex_bench uuid;
  v_pre_count_tpl int;
  v_pre_count_ex int;
  v_post_count_tpl int;
  v_post_count_ex int;
  v_pre_target_sets int;
BEGIN
  -- Create test users
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_new_user, 'new_user_p2@test.com', '{"role":"athlete"}'::jsonb),
    (v_user_custom, 'user_custom_p2@test.com', '{"role":"athlete"}'::jsonb),
    (v_coach, 'coach_p2@test.com', '{"role":"coach"}'::jsonb);

  UPDATE public.users SET role = 'coach' WHERE id = v_coach;

  -- Link coach and athlete before activating RLS
  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status)
  VALUES (v_coach, v_user_custom, 'active');

  -- Test 1: Verify seed master templates exist and have correct days_of_week
  SELECT id INTO v_tpl_push_id
  FROM public.routine_templates
  WHERE is_master = true AND name = 'Push, Quads, & Core - Reduced';

  IF v_tpl_push_id IS NULL THEN
    RAISE EXCEPTION 'Seed failed: Push, Quads, & Core - Reduced master routine not found';
  END IF;

  SELECT id INTO v_tpl_pull_id
  FROM public.routine_templates
  WHERE is_master = true AND name = 'Pull, Hamstring, & Core - Reduced';

  IF v_tpl_pull_id IS NULL THEN
    RAISE EXCEPTION 'Seed failed: Pull, Hamstring, & Core - Reduced master routine not found';
  END IF;

  SELECT id INTO v_tpl_a_id
  FROM public.routine_templates
  WHERE is_master = true AND name = 'Workout A (Push, Quads & Core)';

  IF v_tpl_a_id IS NULL THEN
    RAISE EXCEPTION 'Seed failed: Workout A (Push, Quads & Core) master routine not found';
  END IF;

  SELECT id INTO v_tpl_b_id
  FROM public.routine_templates
  WHERE is_master = true AND name = 'Workout B (Pull, Hamstrings & Core)';

  IF v_tpl_b_id IS NULL THEN
    RAISE EXCEPTION 'Seed failed: Workout B (Pull, Hamstrings & Core) master routine not found';
  END IF;

  -- Test 2: Pre-existing master with different exercises -> unchanged after seed
  SELECT id INTO v_ex_bench FROM public.exercises WHERE is_master = true LIMIT 1;

  INSERT INTO public.routine_templates (id, user_id, name, is_master, days_of_week)
  VALUES (v_preexisting_master_id, NULL, 'Preexisting Unique Master Routine', true, ARRAY['Wed']::text[]);

  INSERT INTO public.template_exercises (template_id, exercise_id, order_index, target_sets, target_reps)
  VALUES (v_preexisting_master_id, v_ex_bench, 0, 99, 99);

  -- Execute seed block again (simulating migration run on existing database)
  DO $seed$
  DECLARE
    s_tpl_id uuid;
    s_tpl_name text;
    s_days text[];
  BEGIN
    FOR s_tpl_name, s_days IN VALUES
      ('Push, Quads, & Core - Reduced', ARRAY['Mon', 'Thu']::text[]),
      ('Pull, Hamstring, & Core - Reduced', ARRAY['Tue', 'Fri']::text[]),
      ('Workout A (Push, Quads & Core)', ARRAY[]::text[]),
      ('Workout B (Pull, Hamstrings & Core)', ARRAY[]::text[])
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.routine_templates
        WHERE is_master = true AND lower(trim(name)) = lower(trim(s_tpl_name))
      ) THEN
        CONTINUE;
      END IF;

      s_tpl_id := md5('platform_master_routine:' || lower(trim(s_tpl_name)))::uuid;
      INSERT INTO public.routine_templates (id, user_id, name, is_master, assigned_to, days_of_week, created_at)
      VALUES (s_tpl_id, NULL, s_tpl_name, true, NULL, s_days, timezone('utc'::text, now()))
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END $seed$;

  -- Assert pre-existing master's exercises are 100% unchanged
  SELECT target_sets INTO v_pre_target_sets
  FROM public.template_exercises
  WHERE template_id = v_preexisting_master_id;

  IF v_pre_target_sets <> 99 THEN
    RAISE EXCEPTION 'Seed modified pre-existing master exercises!';
  END IF;

  -- Test 3: Seed twice -> same row counts (idempotent, 0 modifications)
  SELECT count(*) INTO v_pre_count_tpl FROM public.routine_templates;
  SELECT count(*) INTO v_pre_count_ex FROM public.template_exercises;

  DO $seed_again$
  DECLARE
    s_tpl_id uuid;
    s_tpl_name text;
    s_days text[];
  BEGIN
    FOR s_tpl_name, s_days IN VALUES
      ('Push, Quads, & Core - Reduced', ARRAY['Mon', 'Thu']::text[]),
      ('Pull, Hamstring, & Core - Reduced', ARRAY['Tue', 'Fri']::text[]),
      ('Workout A (Push, Quads & Core)', ARRAY[]::text[]),
      ('Workout B (Pull, Hamstrings & Core)', ARRAY[]::text[])
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.routine_templates
        WHERE is_master = true AND lower(trim(name)) = lower(trim(s_tpl_name))
      ) THEN
        CONTINUE;
      END IF;

      s_tpl_id := md5('platform_master_routine:' || lower(trim(s_tpl_name)))::uuid;
      INSERT INTO public.routine_templates (id, user_id, name, is_master, assigned_to, days_of_week, created_at)
      VALUES (s_tpl_id, NULL, s_tpl_name, true, NULL, s_days, timezone('utc'::text, now()))
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END $seed_again$;

  SELECT count(*) INTO v_post_count_tpl FROM public.routine_templates;
  SELECT count(*) INTO v_post_count_ex FROM public.template_exercises;

  IF v_pre_count_tpl <> v_post_count_tpl OR v_pre_count_ex <> v_post_count_ex THEN
    RAISE EXCEPTION 'Seed is not idempotent: row counts changed between runs (tpl: % -> %, ex: % -> %)',
      v_pre_count_tpl, v_post_count_tpl, v_pre_count_ex, v_post_count_ex;
  END IF;

  -- Test 4: New User Defaults - Brand new user sees master routines in catalog
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_new_user || '"}', true);

  SELECT count(*) INTO v_count
  FROM public.get_routine_catalog(v_new_user)
  WHERE is_master = true;

  IF v_count < 4 THEN
    RAISE EXCEPTION 'New user catalog failed: received % master routines, expected >= 4', v_count;
  END IF;

  -- Verify scheduled days for starter routines
  SELECT count(*) INTO v_count
  FROM public.get_routine_catalog(v_new_user)
  WHERE id = v_tpl_push_id AND 'Mon' = ANY(days_of_week);

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'New user starter routine Push has wrong days_of_week';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.get_routine_catalog(v_new_user)
  WHERE id = v_tpl_pull_id AND 'Tue' = ANY(days_of_week);

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'New user starter routine Pull has wrong days_of_week';
  END IF;

  -- Test 5: Existing User Precedence (Assigned 3 > Personal 2 > Master 1)
  -- Create personal routine for user_custom
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_custom || '"}', true);

  INSERT INTO public.routine_templates (user_id, name, is_master, days_of_week)
  VALUES (v_user_custom, 'Custom Athlete Routine', false, ARRAY['Mon']::text[])
  RETURNING id INTO v_custom_tpl_id;

  -- Personal routine appears first in catalog
  SELECT id INTO v_first_row
  FROM public.get_routine_catalog(v_user_custom)
  LIMIT 1;

  IF v_first_row.id <> v_custom_tpl_id THEN
    RAISE EXCEPTION 'Precedence failed: personal custom routine did not take precedence over master';
  END IF;

  -- Coach assigns a routine to user_custom
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach || '"}', true);

  INSERT INTO public.routine_templates (user_id, name, is_master, assigned_to, days_of_week)
  VALUES (v_coach, 'Coach Assigned Routine', false, v_user_custom, ARRAY['Mon']::text[])
  RETURNING id INTO v_assigned_tpl_id;

  -- Authenticate as user_custom: assigned routine takes top precedence
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_custom || '"}', true);

  SELECT id INTO v_first_row
  FROM public.get_routine_catalog(v_user_custom)
  LIMIT 1;

  IF v_first_row.id <> v_assigned_tpl_id THEN
    RAISE EXCEPTION 'Precedence failed: coach-assigned routine did not take precedence over personal routine';
  END IF;

  -- Test 6: "Reset to original" - Forking a master excludes it; deleting fork restores master
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_new_user || '"}', true);

  -- User forks Push master
  v_res := public.save_routine_template(
    p_name := 'My Custom Fork of Push',
    p_days_of_week := ARRAY['Mon']::text[],
    p_exercises := '[]'::jsonb,
    p_source_template_id := v_tpl_push_id
  );

  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'save_routine_template fork failed';
  END IF;

  v_fork_tpl_id := (v_res->>'template_id')::uuid;

  -- Master is excluded for new_user
  SELECT count(*) INTO v_count
  FROM public.get_routine_catalog(v_new_user)
  WHERE id = v_tpl_push_id;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Forking failed: original master still returned after fork';
  END IF;

  -- Fork is returned in catalog with source_template_id populated
  SELECT count(*) INTO v_count
  FROM public.get_routine_catalog(v_new_user)
  WHERE id = v_fork_tpl_id AND source_template_id = v_tpl_push_id;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Forking failed: fork not returned with source_template_id';
  END IF;

  -- Unaffected user (user_custom) still sees Push master throughout new_user's fork lifecycle
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_custom || '"}', true);
  SELECT count(*) INTO v_count
  FROM public.get_routine_catalog(v_user_custom)
  WHERE id = v_tpl_push_id;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Fork isolation failed: master disappeared for unaffected user_custom';
  END IF;

  -- "Reset to original" action: Deletes personal copy row from routine_templates
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_new_user || '"}', true);
  DELETE FROM public.routine_templates WHERE id = v_fork_tpl_id;

  -- Master routine returns to catalog for new_user
  SELECT count(*) INTO v_count
  FROM public.get_routine_catalog(v_new_user)
  WHERE id = v_tpl_push_id;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Reset failed: master routine not restored after deleting fork';
  END IF;

  -- Fork is gone
  SELECT count(*) INTO v_count
  FROM public.get_routine_catalog(v_new_user)
  WHERE id = v_fork_tpl_id;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Reset failed: deleted fork still returned';
  END IF;

END $$;

-- 3. Assertions confirming contracts
SELECT is(
  (SELECT count(*)::int FROM public.routine_templates
   WHERE is_master = true AND user_id IS NULL AND lower(trim(name)) IN (
     'push, quads, & core - reduced',
     'pull, hamstring, & core - reduced',
     'workout a (push, quads & core)',
     'workout b (pull, hamstrings & core)'
   )),
  4,
  'platform seeded master routines have user_id IS NULL'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.get_routine_catalog()
    WHERE name = 'Workout A (Push, Quads & Core)' AND is_master = true
  ),
  'Workout A (Push, Quads & Core) is selectable in catalog for prod smoke'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.get_routine_catalog()
    WHERE name = 'Push, Quads, & Core - Reduced' AND 'Mon' = ANY(days_of_week)
  ),
  'Starter routine Push has Mon in days_of_week'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.get_routine_catalog()
    WHERE name = 'Pull, Hamstring, & Core - Reduced' AND 'Tue' = ANY(days_of_week)
  ),
  'Starter routine Pull has Tue in days_of_week'
);

SELECT is(
  (SELECT count(*)::int FROM public.routine_templates
   WHERE is_master = true AND lower(trim(name)) IN (
     'push, quads, & core - reduced',
     'pull, hamstring, & core - reduced',
     'workout a (push, quads & core)',
     'workout b (pull, hamstrings & core)'
   )),
  4,
  'exactly 4 platform master routines exist (no duplicates)'
);

SELECT pass('master routines exist with scheduled days');
SELECT pass('pre-existing master with different exercises remains unchanged after seed');
SELECT pass('seed twice yields identical row counts (idempotent insert-only)');
SELECT pass('new users receive master routines as defaults in get_routine_catalog');
SELECT pass('starter routines have correct days_of_week');
SELECT pass('personal routines take precedence over master routines');
SELECT pass('coach-assigned routines take precedence over personal routines');
SELECT pass('forking a master excludes the master from caller catalog');

ROLLBACK;
